import { useState, useCallback, useMemo } from 'react';
import { Upload, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useCanSave } from '../../hooks/useConnection';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import {
  parseCsv,
  normalizeDate,
  generateImportId,
  readImportAmount,
  readDirection,
  guessColumnRoles,
  decodeCsvBytes,
  detectDelimiter,
  detectDateFormat,
  detectNumberFormat,
  type ColumnRole,
  type DateFormat,
  type Delimiter,
  type NumberFormat,
} from '../../utils/csv';
import { importPreview } from '../../api/transactions';
import { useImportConfirm } from '../../hooks/useTransactions';
import { formatCurrency } from '../../utils/currency';
import type { ImportPreviewRow } from '../../types';
import type { ImportRow } from '../../api/transactions';
import { IS_DEMO } from '../../demo/demoApi';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
}

type Step = 'upload' | 'map' | 'preview' | 'done';

const DELIMITERS: { value: Delimiter; label: string }[] = [
  { value: ',', label: 'Comma' },
  { value: ';', label: 'Semicolon' },
  { value: '\t', label: 'Tab' },
];

const selectClass = 'w-full text-xs border border-border rounded px-1.5 py-1 bg-surface text-text';

export function ImportModal({ isOpen, onClose, accountId }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const canSave = useCanSave();
  const [text, setText] = useState('');
  const [delimiter, setDelimiter] = useState<Delimiter>(',');
  // null = what the file looks like (detectDateFormat / detectNumberFormat)
  const [dateFormatChoice, setDateFormatChoice] = useState<DateFormat | null>(null);
  const [numberFormatChoice, setNumberFormatChoice] = useState<NumberFormat | null>(null);
  const [unreadable, setUnreadable] = useState(0);
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
    setText('');
    setDelimiter(',');
    setDateFormatChoice(null);
    setNumberFormatChoice(null);
    setUnreadable(0);
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

  const loadText = useCallback((content: string, sep: Delimiter) => {
    const { headers: h, rows: r } = parseCsv(content, sep);
    if (h.length === 0) {
      setError('Could not parse CSV file');
      return;
    }
    setError(null);
    setText(content);
    setDelimiter(sep);
    setHeaders(h);
    setRawRows(r.filter((row) => row.some((cell) => cell.length > 0)));
    setRoles(guessColumnRoles(h));
    setDateFormatChoice(null);
    setNumberFormatChoice(null);
    setStep('map');
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      setError(null);
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = decodeCsvBytes(e.target?.result as ArrayBuffer);
        loadText(content, detectDelimiter(content));
      };
      reader.readAsArrayBuffer(file);
    },
    [loadText],
  );

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

  // How the file writes dates and amounts, judged from the columns mapped to them
  const detected = useMemo(() => {
    const column = (role: ColumnRole) => {
      const idx = roles.indexOf(role);
      return idx === -1 ? [] : rawRows.map((row) => row[idx] ?? '');
    };
    const amounts = [...column('amount'), ...column('inflow'), ...column('outflow')];
    return {
      dateFormat: detectDateFormat(column('date')),
      numberFormat: detectNumberFormat(amounts),
      // Values that really could be read two ways, to quote in the warning
      dateSample: column('date').find((d) => {
        const m = d.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-]/);
        return m && +m[1] <= 12 && +m[2] <= 12 && +m[1] !== +m[2];
      }),
      amountSample: amounts.find((a) => /^[^\d.,]*\d{1,3}[.,]\d{3}[^\d.,]*$/.test(a.trim())),
    };
  }, [rawRows, roles]);
  const dateFormat = dateFormatChoice ?? detected.dateFormat;
  const numberFormat = numberFormatChoice ?? detected.numberFormat;

  /** The rows to import and how many couldn't be read, or a message saying why there are none */
  function buildImportRows(): { rows: ImportRow[]; unreadable: number } | string {
    const dateIdx = roles.indexOf('date');
    const payeeIdx = roles.indexOf('payee');
    const amountIdx = roles.indexOf('amount');
    const inflowIdx = roles.indexOf('inflow');
    const outflowIdx = roles.indexOf('outflow');
    const notesIdx = roles.indexOf('notes');
    const directionIdx = roles.indexOf('direction');

    if (dateIdx === -1) return 'Date column is required';
    if (amountIdx === -1 && inflowIdx === -1 && outflowIdx === -1) {
      return 'At least one amount column is required';
    }
    // Never guess: swapped days and months, or amounts off by 100x, would look plausible
    if (!dateFormat) return 'Choose how this file writes dates';
    if (!numberFormat) return 'Choose how this file writes amounts';

    /** Cents, 0 for an empty cell, or null if the cell holds something that isn't a number */
    const cellAmount = (idx: number, raw: string[]) => {
      const cell = raw[idx]?.trim() ?? '';
      return cell === '' ? 0 : readImportAmount(cell, numberFormat);
    };

    const rows: ImportRow[] = [];
    let unreadableRows = 0;
    const seen = new Map<string, number>();
    for (const raw of rawRows) {
      const date = normalizeDate(raw[dateIdx] ?? '', dateFormat);
      if (!date) {
        unreadableRows++;
        continue;
      }

      let amount: number;
      if (amountIdx !== -1) {
        const value = cellAmount(amountIdx, raw);
        if (value === null) {
          unreadableRows++;
          continue;
        }
        amount = value;
      } else {
        // Some banks write debits in the outflow column as negative numbers
        const inf = inflowIdx !== -1 ? cellAmount(inflowIdx, raw) : 0;
        const out = outflowIdx !== -1 ? cellAmount(outflowIdx, raw) : 0;
        if (inf === null || out === null) {
          unreadableRows++;
          continue;
        }
        amount = inf !== 0 ? Math.abs(inf) : -Math.abs(out);
      }
      if (directionIdx !== -1) {
        // Banks like ING write every amount as positive and the direction beside it
        const direction = readDirection(raw[directionIdx]);
        if (!direction) {
          unreadableRows++;
          continue;
        }
        amount = direction === 'out' ? -Math.abs(amount) : Math.abs(amount);
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
    return { rows, unreadable: unreadableRows };
  }

  async function handlePreview() {
    setError(null);
    const built = buildImportRows();
    if (typeof built === 'string' || !built.rows.length) {
      setError(typeof built === 'string' ? built : 'No valid rows found');
      return;
    }

    setLoading(true);
    try {
      const preview = await importPreview(accountId, built.rows);
      setUnreadable(built.unreadable);
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
    { value: 'direction', label: 'Direction (in/out)' },
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
          {IS_DEMO && (
            <p className="text-xs text-text-tertiary">
              Demo: your file stays in this browser tab and isn't saved.
            </p>
          )}
          <input
            id="csv-file-input"
            type="file"
            accept=".csv,.tsv,.txt"
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-xs font-medium text-text-tertiary space-y-1">
              <span>Separator</span>
              <select
                value={delimiter}
                onChange={(e) => loadText(text, e.target.value as Delimiter)}
                className={selectClass}
              >
                {DELIMITERS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-text-tertiary space-y-1">
              <span>Dates</span>
              <select
                value={dateFormat ?? ''}
                onChange={(e) => setDateFormatChoice(e.target.value as DateFormat)}
                className={selectClass}
              >
                {!dateFormat && <option value="">Choose…</option>}
                <option value="mdy">MM/DD/YYYY</option>
                <option value="dmy">DD/MM/YYYY</option>
              </select>
            </label>
            <label className="text-xs font-medium text-text-tertiary space-y-1">
              <span>Amounts</span>
              <select
                value={numberFormat ?? ''}
                onChange={(e) => setNumberFormatChoice(e.target.value as NumberFormat)}
                className={selectClass}
              >
                {!numberFormat && <option value="">Choose…</option>}
                <option value="dot">1,234.56</option>
                <option value="comma">1.234,56</option>
              </select>
            </label>
          </div>
          {(!dateFormat || !numberFormat) && (
            <div className="flex items-start gap-2 px-3 py-2 text-sm bg-caution-subtle text-caution rounded-lg">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                {!dateFormat &&
                  (detected.dateSample
                    ? `This file doesn't show whether ${detected.dateSample} has the day or the month first. `
                    : 'Rows in this file write dates in different orders. ')}
                {!numberFormat &&
                  (detected.amountSample
                    ? `This file doesn't show whether ${detected.amountSample} uses a decimal point or a decimal comma. `
                    : 'Rows in this file write amounts in different formats. ')}
                Choose the format your bank uses.
              </span>
            </div>
          )}
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
                        className={selectClass}
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
            {unreadable > 0 &&
              ` ${unreadable} ${unreadable === 1 ? "row couldn't be read and is" : "rows couldn't be read and are"} left out.`}
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
          <SavingPausedHint className="text-right" />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setStep('map')}
              className="px-3 py-1.5 text-sm text-text-secondary border border-border rounded-lg hover:bg-hover"
            >
              Back
            </button>
            <button
              onClick={handleConfirm}
              disabled={
                confirmMutation.isPending || previewRows.length === excluded.size || !canSave
              }
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
