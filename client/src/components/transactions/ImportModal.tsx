import { useState, useCallback } from 'react';
import { Upload, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import {
  parseCsv,
  normalizeDate,
  generateImportId,
  parseImportAmount,
  guessColumnRoles,
  type ColumnRole,
} from '../../utils/csv';
import { importPreview } from '../../api/transactions';
import { useImportConfirm } from '../../hooks/useTransactions';
import { formatCurrency } from '../../utils/currency';
import type { ImportPreviewRow } from '../../types';
import type { ImportRow } from '../../api/transactions';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
}

type Step = 'upload' | 'map' | 'preview' | 'done';

export function ImportModal({ isOpen, onClose, accountId }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [roles, setRoles] = useState<ColumnRole[]>([]);
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const confirmMutation = useImportConfirm();

  function reset() {
    setStep('upload');
    setHeaders([]);
    setRawRows([]);
    setRoles([]);
    setPreviewRows([]);
    setExcluded(new Set());
    setResult(null);
    setError(null);
    setLoading(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  const handleFile = useCallback((file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers: h, rows: r } = parseCsv(text);
      if (h.length === 0) {
        setError('Could not parse CSV file');
        return;
      }
      setHeaders(h);
      setRawRows(r.filter((row) => row.some((cell) => cell.length > 0)));
      setRoles(guessColumnRoles(h));
      setStep('map');
    };
    reader.readAsText(file);
  }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function setRole(idx: number, role: ColumnRole) {
    setRoles((prev) => {
      const next = [...prev];
      next[idx] = role;
      return next;
    });
  }

  /** The rows to import, or a message saying why there are none */
  function buildImportRows(): ImportRow[] | string {
    const dateIdx = roles.indexOf('date');
    const payeeIdx = roles.indexOf('payee');
    const amountIdx = roles.indexOf('amount');
    const inflowIdx = roles.indexOf('inflow');
    const outflowIdx = roles.indexOf('outflow');
    const notesIdx = roles.indexOf('notes');

    if (dateIdx === -1) return 'Date column is required';
    if (amountIdx === -1 && inflowIdx === -1 && outflowIdx === -1) {
      return 'At least one amount column is required';
    }

    const rows: ImportRow[] = [];
    const seen = new Map<string, number>();
    for (const raw of rawRows) {
      const date = normalizeDate(raw[dateIdx] ?? '');
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

      let amount: number;
      if (amountIdx !== -1) {
        amount = parseImportAmount(raw[amountIdx]);
      } else {
        // Some banks write debits in the outflow column as negative numbers
        const inf = Math.abs(inflowIdx !== -1 ? parseImportAmount(raw[inflowIdx]) : 0);
        const out = Math.abs(outflowIdx !== -1 ? parseImportAmount(raw[outflowIdx]) : 0);
        amount = inf > 0 ? inf : -out;
      }
      if (amount === 0) continue;

      // Same limits as the server, so one long memo can't fail the whole import
      const payeeName = payeeIdx !== -1 ? raw[payeeIdx]?.slice(0, 500) || null : null;
      const notes = notesIdx !== -1 ? raw[notesIdx]?.slice(0, 5000) || null : null;
      const key = generateImportId(date, amount, payeeName ?? '');
      const occurrence = (seen.get(key) ?? 0) + 1;
      seen.set(key, occurrence);
      const importedId = generateImportId(date, amount, payeeName ?? '', occurrence);
      rows.push({ date, amount, payeeName, notes, importedId });
    }
    return rows;
  }

  async function handlePreview() {
    setError(null);
    const rows = buildImportRows();
    if (typeof rows === 'string' || !rows.length) {
      setError(typeof rows === 'string' ? rows : 'No valid rows found');
      return;
    }

    setLoading(true);
    try {
      const preview = await importPreview(accountId, rows);
      setPreviewRows(preview);
      setExcluded(new Set(preview.map((r, i) => (r.isDuplicate ? i : -1)).filter((i) => i >= 0)));
      setStep('preview');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setLoading(false);
    }
  }

  function handleConfirm() {
    const rows = previewRows
      .filter((_, i) => !excluded.has(i))
      .map(({ isDuplicate: _, ...row }) => row as ImportRow);

    if (!rows.length) {
      setError('No rows selected');
      return;
    }

    confirmMutation.mutate(
      { accountId, rows },
      {
        onSuccess: (data) => {
          setResult(data);
          setStep('done');
        },
        onError: (e) => setError(e instanceof Error ? e.message : 'Import failed'),
      },
    );
  }

  function toggleExclude(idx: number) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  const roleOptions: { value: ColumnRole; label: string }[] = [
    { value: 'date', label: 'Date' },
    { value: 'payee', label: 'Payee' },
    { value: 'amount', label: 'Amount' },
    { value: 'inflow', label: 'Inflow' },
    { value: 'outflow', label: 'Outflow' },
    { value: 'notes', label: 'Notes' },
    { value: 'skip', label: 'Skip' },
  ];

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Import Transactions" size="lg">
      {error && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 text-sm bg-negative-subtle text-negative rounded-lg">
          <AlertTriangle size={14} /> {error}
          <button onClick={() => setError(null)} className="ml-auto" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {step === 'upload' && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="flex flex-col items-center justify-center gap-3 py-12 border-2 border-dashed border-border rounded-lg hover:border-brand-400 transition-colors cursor-pointer"
          onClick={() => document.getElementById('csv-file-input')?.click()}
        >
          <Upload size={32} className="text-text-tertiary" />
          <p className="text-sm text-text-secondary">
            Drag and drop a CSV file, or click to browse
          </p>
          <p className="text-xs text-text-tertiary">Supports .csv files</p>
          <input
            id="csv-file-input"
            type="file"
            accept=".csv"
            aria-label="CSV file"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Map each column to a field. Found {rawRows.length} rows.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} className="px-2 py-1 text-left border-b border-border">
                      <div className="text-xs font-medium text-text-tertiary mb-1">{h}</div>
                      <select
                        value={roles[i]}
                        aria-label={`Column ${h}`}
                        onChange={(e) => setRole(i, e.target.value as ColumnRole)}
                        className="w-full text-xs border border-border rounded px-1.5 py-1 bg-surface text-text"
                      >
                        {roleOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rawRows.slice(0, 3).map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="px-2 py-1 text-xs text-text-secondary border-b border-border-light max-w-[150px] truncate"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setStep('upload')}
              className="px-3 py-1.5 text-sm text-text-secondary border border-border rounded-lg hover:bg-hover"
            >
              Back
            </button>
            <button
              onClick={handlePreview}
              disabled={loading}
              className="px-4 py-1.5 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              {loading ? 'Checking...' : 'Preview'}
            </button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            {previewRows.length} transactions found.{' '}
            {previewRows.filter((r) => r.isDuplicate).length} duplicates detected.{' '}
            {previewRows.length - excluded.size} will be imported.
          </p>
          <div className="max-h-64 overflow-y-auto border border-border rounded-lg">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-surface-alt">
                <tr>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-text-tertiary w-8"></th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-text-tertiary">
                    Date
                  </th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-text-tertiary">
                    Payee
                  </th>
                  <th className="px-2 py-1.5 text-right text-xs font-medium text-text-tertiary">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-t border-border-light ${excluded.has(i) ? 'opacity-40' : ''} ${row.isDuplicate ? 'bg-caution-subtle' : ''}`}
                  >
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={!excluded.has(i)}
                        onChange={() => toggleExclude(i)}
                        aria-label={`Import ${row.payeeName ?? 'row'} on ${row.date}`}
                        className="w-3.5 h-3.5 accent-brand-600"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-xs text-text-secondary">{row.date}</td>
                    <td className="px-2 py-1.5 text-xs text-text flex items-center gap-1">
                      {row.payeeName ?? '—'}
                      {row.isDuplicate && (
                        <span className="text-[10px] px-1 py-0.5 bg-caution-subtle text-caution rounded">
                          duplicate
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-xs text-right tabular-nums ${row.amount < 0 ? 'text-text' : 'text-positive'}`}
                    >
                      {formatCurrency(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setStep('map')}
              className="px-3 py-1.5 text-sm text-text-secondary border border-border rounded-lg hover:bg-hover"
            >
              Back
            </button>
            <button
              onClick={handleConfirm}
              disabled={confirmMutation.isPending || previewRows.length === excluded.size}
              className="px-4 py-1.5 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50"
            >
              {confirmMutation.isPending
                ? 'Importing...'
                : `Import ${previewRows.length - excluded.size} Transactions`}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="flex flex-col items-center gap-4 py-6">
          <CheckCircle size={40} className="text-positive" />
          <div className="text-center">
            <p className="text-sm font-medium text-text">Import complete</p>
            <p className="text-sm text-text-secondary mt-1">
              {result.imported} imported, {result.skipped} skipped
            </p>
          </div>
          <button
            onClick={handleClose}
            className="px-4 py-1.5 text-sm font-medium bg-brand-600 text-white rounded-lg hover:bg-brand-700"
          >
            Done
          </button>
        </div>
      )}
    </Modal>
  );
}
