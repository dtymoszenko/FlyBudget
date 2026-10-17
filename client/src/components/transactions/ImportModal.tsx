import { useState, useCallback, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Upload, AlertTriangle, CheckCircle, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useCanSave } from '../../hooks/useConnection';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import {
  parseCsvRecords,
  normalizeDate,
  buildImportRows,
  describeSkippedRows,
  unknownDirectionWords,
  columnRolesFor,
  columnKeys,
  decodeCsvBytes,
  detectDelimiter,
  detectSkipRows,
  detectDateFormat,
  detectNumberFormat,
  CSV_ENCODINGS,
  type ColumnRole,
  type CsvEncoding,
  type DateFormat,
  type Delimiter,
  type ImportSettings,
  type NumberFormat,
  type SkippedRow,
} from '../../utils/csv';
import {
  decodeCamtBytes,
  looksLikeCamt,
  parseCamt,
  statementAccountKey,
  type CamtStatement,
} from '../../utils/camt';
import { importPreview } from '../../api/transactions';
import { getImportSettings, saveImportSettings, saveStatementAccount } from '../../api/accounts';
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

type Step = 'upload' | 'statement' | 'map' | 'preview' | 'done';

const DELIMITERS: { value: Delimiter; label: string }[] = [
  { value: ',', label: 'Comma' },
  { value: ';', label: 'Semicolon' },
  { value: '\t', label: 'Tab' },
];

const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  mdy: 'MM/DD/YYYY',
  dmy: 'DD/MM/YYYY',
  ymd: 'YY/MM/DD',
};

const NUMBER_FORMAT_LABELS: Record<NumberFormat, string> = {
  dot: '1,234.56',
  comma: '1.234,56',
};

const selectClass = 'w-full text-xs border border-border rounded px-1.5 py-1 bg-surface text-text';
const optionLabelClass = 'text-xs font-medium text-text-tertiary space-y-1';

const settingsKey = (accountId: string) => ['import-settings', accountId];

/** Settings still being saved, by account: the next import of a file waits for them */
const pendingSaves = new Map<string, Promise<void>>();

/** The most rows one import may send (the server's limit) */
const MAX_IMPORT_ROWS = 100_000;

export function ImportModal({ isOpen, onClose, accountId }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const canSave = useCanSave();
  const queryClient = useQueryClient();
  const [source, setSource] = useState<'csv' | 'camt'>('csv');
  // CSV: the file, how it's read, and the settings this account's last import used
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [encoding, setEncoding] = useState<CsvEncoding>('auto');
  const [delimiter, setDelimiter] = useState<Delimiter>(',');
  const [records, setRecords] = useState<string[][]>([]);
  const [skipRows, setSkipRows] = useState(0);
  // What's typed in "Rows above the header" while it isn't a number yet (an emptied field)
  const [skipRowsDraft, setSkipRowsDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState<ImportSettings | null>(null);
  const [usingSaved, setUsingSaved] = useState(false);
  // null = what the file looks like (detectDateFormat / detectNumberFormat)
  const [dateFormatChoice, setDateFormatChoice] = useState<DateFormat | null>(null);
  const [numberFormatChoice, setNumberFormatChoice] = useState<NumberFormat | null>(null);
  const [outWord, setOutWord] = useState('');
  // CAMT: the statements in the file (one per account)
  const [statements, setStatements] = useState<CamtStatement[]>([]);
  const [statementIdx, setStatementIdx] = useState(0);
  // The account number of the last statement imported into this account, if any
  const [knownStatementAccount, setKnownStatementAccount] = useState<string | null>(null);
  // Pending or unreadable CAMT entries (CSV rows left out are listed in skippedRows)
  const [skippedEntries, setSkippedEntries] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [roles, setRoles] = useState<ColumnRole[]>([]);
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [skippedRows, setSkippedRows] = useState<SkippedRow[]>([]);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const confirmMutation = useImportConfirm();
  // Counts file loads and closings: a load that finishes after the dialog was closed (or
  // another file was chosen) is dropped, so the next opening starts at the upload step
  const loadId = useRef(0);

  function reset() {
    loadId.current++;
    setStep('upload');
    setSource('csv');
    setBytes(null);
    setEncoding('auto');
    setDelimiter(',');
    setRecords([]);
    setSkipRows(0);
    setSkipRowsDraft(null);
    setSaved(null);
    setUsingSaved(false);
    setDateFormatChoice(null);
    setNumberFormatChoice(null);
    setOutWord('');
    setStatements([]);
    setStatementIdx(0);
    setKnownStatementAccount(null);
    setSkippedEntries(0);
    setHeaders([]);
    setRawRows([]);
    setRoles([]);
    setPreviewRows([]);
    setExcluded(new Set());
    setSkippedRows([]);
    setResult(null);
    setError(null);
    setLoading(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  /**
   * Shows the rows under the header, with columns mapped as last time or guessed, or as
   * `keepRoles` when the table has as many columns (the same table, read in another encoding
   * or under another header row)
   */
  const showTable = useCallback(
    (
      all: string[][],
      skip: number,
      savedSettings: ImportSettings | null,
      keepRoles?: ColumnRole[],
    ) => {
      const h = all[skip] ?? [];
      setSkipRows(skip);
      setHeaders(h);
      setRawRows(all.slice(skip + 1));
      setRoles(
        keepRoles?.length === h.length ? keepRoles : columnRolesFor(h, savedSettings?.columns),
      );
    },
    [],
  );

  /** Reads the text as CSV; `skip` null finds the header by itself */
  const loadCsv = useCallback(
    (
      content: string,
      sep: Delimiter,
      skip: number | null,
      savedSettings: ImportSettings | null,
      keepRoles?: ColumnRole[],
    ) => {
      const all = parseCsvRecords(content, sep);
      if (all.length === 0) {
        setError('Could not parse CSV file');
        return;
      }
      setError(null);
      setRecords(all);
      setDelimiter(sep);
      const header = Math.min(skip ?? detectSkipRows(all), all.length - 1);
      showTable(all, header, savedSettings, keepRoles);
      setStep('map');
    },
    [showTable],
  );

  async function runPreview(rows: ImportRow[], skipped: SkippedRow[], camtSkipped = 0) {
    const load = loadId.current;
    // The server's limit: say so, rather than fail the whole file with a generic error
    if (rows.length > MAX_IMPORT_ROWS) {
      setError(
        `This file has ${rows.length.toLocaleString()} transactions. FlyBudget imports up to ${MAX_IMPORT_ROWS.toLocaleString()} at a time: split it into smaller files.`,
      );
      return;
    }
    setLoading(true);
    try {
      const preview = await importPreview(accountId, rows);
      if (load !== loadId.current) return; // closed while checking
      setSkippedRows(skipped);
      setSkippedEntries(camtSkipped);
      setPreviewRows(preview);
      setExcluded(new Set(preview.map((r, i) => (r.isDuplicate ? i : -1)).filter((i) => i >= 0)));
      setStep('preview');
    } catch (e: unknown) {
      if (load === loadId.current) setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      if (load === loadId.current) setLoading(false);
    }
  }

  function previewStatement(statement: CamtStatement) {
    if (!statement.transactions.length) {
      setError('There are no booked transactions in this statement');
      return;
    }
    setError(null);
    return runPreview(statement.transactions, [], statement.skipped);
  }

  async function handleFile(file: File) {
    setError(null);
    const load = ++loadId.current;
    setLoading(false); // a preview of the file before is abandoned
    try {
      await readFile(file, load);
    } catch {
      if (load === loadId.current) setError("Couldn't read this file");
    }
  }

  /** What this account's last imports remembered, or null offline */
  async function savedImport() {
    await pendingSaves.get(accountId);
    try {
      return await queryClient.fetchQuery({
        queryKey: settingsKey(accountId),
        queryFn: () => getImportSettings(accountId),
        retry: false, // offline, don't keep the file waiting
      });
    } catch {
      return null; // Offline: work everything out from the file
    }
  }

  async function readFile(file: File, load: number) {
    const buffer = await file.arrayBuffer();
    if (load !== loadId.current) return;

    // Decoded like the whole file would be, so a UTF-16 statement is recognized too
    const start = decodeCsvBytes(buffer.slice(0, 4096), 'auto');
    if (/\.xml$/i.test(file.name) || looksLikeCamt(start)) {
      const found = parseCamt(decodeCamtBytes(buffer));
      if (!found?.length) {
        setError("This file isn't a bank statement FlyBudget can read (CAMT.053)");
        return;
      }
      const known = (await savedImport())?.statementAccount ?? null;
      if (load !== loadId.current) return;
      setSource('camt');
      setStatements(found);
      setKnownStatementAccount(known);
      // A file with several accounts: the one this account imported last time, if it's there
      const idx = Math.max(
        0,
        found.findIndex((s) => known !== null && statementAccountKey(s.account) === known),
      );
      setStatementIdx(idx);
      if (found.length === 1) await previewStatement(found[0]);
      else setStep('statement');
      return;
    }

    setSource('csv');
    const savedSettings = (await savedImport())?.settings ?? null;
    if (load !== loadId.current) return; // closed (or another file chosen) meanwhile
    setSaved(savedSettings);
    setBytes(buffer);
    setDateFormatChoice(null);
    setNumberFormatChoice(null);
    setOutWord('');

    // The last import's settings, as long as this file still fits them (the same columns)
    if (savedSettings) {
      const content = decodeCsvBytes(buffer, savedSettings.encoding);
      const header = parseCsvRecords(content, savedSettings.delimiter)[savedSettings.skipRows];
      const known = savedSettings.columns;
      const sameColumns = header && columnKeys(header).every((key) => Object.hasOwn(known, key));
      if (header && header.length >= 2 && sameColumns) {
        setEncoding(savedSettings.encoding);
        setUsingSaved(true);
        // Only with the rest of the settings: it means something for this bank's files only
        setOutWord(savedSettings.outWord ?? '');
        loadCsv(content, savedSettings.delimiter, savedSettings.skipRows, savedSettings);
        return;
      }
    }
    setEncoding('auto');
    setUsingSaved(false);
    const content = decodeCsvBytes(buffer, 'auto');
    loadCsv(content, detectDelimiter(content), null, savedSettings);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = ''; // so choosing the same file again still loads it
  }

  function changeEncoding(next: CsvEncoding) {
    if (!bytes) return;
    setEncoding(next);
    setUsingSaved(false);
    loadCsv(decodeCsvBytes(bytes, next), delimiter, skipRows, saved, roles);
  }

  function changeDelimiter(next: Delimiter) {
    if (!bytes) return;
    setUsingSaved(false);
    loadCsv(decodeCsvBytes(bytes, encoding), next, null, saved);
  }

  function setRole(idx: number, role: ColumnRole) {
    setRoles((prev) => {
      const next = [...prev];
      next[idx] = role;
      return next;
    });
  }

  // How the file writes dates, amounts and directions, judged from the columns mapped to them
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
        const readings = (['mdy', 'dmy', 'ymd'] as const)
          .map((f) => normalizeDate(d, f))
          .filter((r) => r !== '');
        return new Set(readings).size > 1;
      }),
      amountSample: amounts.find((a) => /^[^\d.,]*\d{1,3}[.,]\d{3}[^\d.,]*$/.test(a.trim())),
      unknownDirections: unknownDirectionWords(column('direction')),
    };
  }, [rawRows, roles]);
  // What the user chose now, else what the file shows, else what they chose last time for a
  // file with these columns (another layout may be another bank, with other formats)
  const lastTime = usingSaved ? saved : null;
  const dateFormat = dateFormatChoice ?? detected.dateFormat ?? lastTime?.dateFormat ?? null;
  const numberFormat =
    numberFormatChoice ?? detected.numberFormat ?? lastTime?.numberFormat ?? null;
  // Formats the file couldn't show, taken from the last import (named in the dialog)
  const fromLastTime = [
    !dateFormatChoice &&
      !detected.dateFormat &&
      lastTime?.dateFormat && { what: 'dates', format: DATE_FORMAT_LABELS[lastTime.dateFormat] },
    !numberFormatChoice &&
      !detected.numberFormat &&
      lastTime?.numberFormat && {
        what: 'amounts',
        format: NUMBER_FORMAT_LABELS[lastTime.numberFormat],
      },
  ].filter((f): f is { what: string; format: string } => !!f);
  const hasDirection = roles.includes('direction');
  const needsOutWord = hasDirection && !outWord.trim() && detected.unknownDirections.length > 0;

  function handlePreview() {
    setError(null);
    // Never guess: swapped days and months, or amounts off by 100x, would look plausible
    if (!dateFormat) return setError('Choose how this file writes dates');
    if (!numberFormat) return setError('Choose how this file writes amounts');
    if (needsOutWord) return setError('Type the word your bank uses for money going out');
    const built = buildImportRows(rawRows, roles, { dateFormat, numberFormat, outWord });
    if (typeof built === 'string') {
      setError(built);
      return;
    }
    const { rows, skipped } = built;
    if (!rows.length) {
      setError(
        skipped.length
          ? `No rows could be imported. ${describeSkippedRows(skipped)}`
          : 'No valid rows found',
      );
      return;
    }
    void runPreview(rows, skipped);
  }

  /** Remembers how this account's bank writes its files, for the next import */
  function rememberSettings() {
    type Saved = Awaited<ReturnType<typeof getImportSettings>>;
    let request: Promise<Partial<Saved>>;
    if (source === 'camt') {
      // Which account the statement was for, to notice a statement for another account
      const account = statementAccountKey(statements[statementIdx]?.account ?? null);
      if (!account) return;
      request = saveStatementAccount(accountId, account);
    } else {
      if (!dateFormat || !numberFormat) return;
      const columns: Record<string, ColumnRole> = {};
      // At most 200 columns (the server's limit); longer files are worked out each time
      if (headers.length > 200) return;
      columnKeys(headers).forEach((key, i) => {
        columns[key] = roles[i];
      });
      const settings: ImportSettings = {
        delimiter,
        encoding,
        skipRows,
        columns,
        dateFormat,
        numberFormat,
        outWord: outWord.trim().slice(0, 50) || null,
      };
      request = saveImportSettings(accountId, settings);
    }
    const save: Promise<void> = request
      .then((stored) => {
        // The server keeps the part that wasn't saved; so does the cache
        queryClient.setQueryData<Saved>(settingsKey(accountId), (old) => ({
          settings: null,
          statementAccount: null,
          ...old,
          ...stored,
        }));
      })
      .catch(() => {
        // Not worth an error: the next import works the settings out again
      })
      .finally(() => {
        if (pendingSaves.get(accountId) === save) pendingSaves.delete(accountId);
      });
    pendingSaves.set(accountId, save);
  }

  function handleConfirm() {
    const rows = previewRows
      .filter((_, i) => !excluded.has(i))
      .map(({ isDuplicate: _, ...row }) => row as ImportRow);

    if (!rows.length) {
      setError('No rows selected');
      return;
    }

    const load = loadId.current;
    confirmMutation.mutate(
      { accountId, rows },
      {
        onSuccess: (data) => {
          rememberSettings(); // the import happened, even if the dialog was closed meanwhile
          if (load !== loadId.current) return; // closed: the next opening starts afresh
          setResult(data);
          setStep('done');
        },
        onError: (e) => {
          if (load === loadId.current) setError(e instanceof Error ? e.message : 'Import failed');
        },
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

  function previewBack() {
    if (source === 'csv') setStep('map');
    else setStep(statements.length > 1 ? 'statement' : 'upload');
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

  // A statement for another account than the one imported here last time
  const statementAccount =
    source === 'camt' ? statementAccountKey(statements[statementIdx]?.account ?? null) : null;
  const otherStatementAccount =
    statementAccount && knownStatementAccount && statementAccount !== knownStatementAccount
      ? statementAccount
      : null;
  const entriesLeftOut = `${skippedEntries} ${skippedEntries === 1 ? 'entry is' : 'entries are'} pending or couldn't be read, and left out.`;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Import Transactions" size="lg">
      {error && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 text-sm bg-negative-subtle text-negative rounded-lg">
          <AlertTriangle size={14} /> {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-auto flex items-center justify-center max-md:min-h-11 max-md:min-w-11"
            aria-label="Dismiss"
          >
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
            Drag and drop a file from your bank, or click to browse
          </p>
          <p className="text-xs text-text-tertiary">CSV, or a CAMT.053 bank statement (XML)</p>
          {loading && <p className="text-xs text-text-tertiary">Checking…</p>}
          {IS_DEMO && (
            <p className="text-xs text-text-tertiary">
              Demo: your file stays in this browser tab and isn't saved.
            </p>
          )}
          <input
            id="csv-file-input"
            type="file"
            accept=".csv,.tsv,.txt,.xml"
            aria-label="Bank file"
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      )}

      {step === 'statement' && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            This file has statements for {statements.length} accounts. Which one belongs to this
            account?
          </p>
          <label className={optionLabelClass}>
            <span>Statement</span>
            <select
              value={statementIdx}
              onChange={(e) => setStatementIdx(Number(e.target.value))}
              className={selectClass}
            >
              {statements.map((s, i) => (
                <option key={i} value={i}>
                  {s.account ?? 'Account without a number'} ({s.transactions.length} transactions)
                  {knownStatementAccount !== null &&
                    statementAccountKey(s.account) === knownStatementAccount &&
                    ', imported here before'}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep('upload')}>
              Back
            </Button>
            <Button
              onClick={() => void previewStatement(statements[statementIdx])}
              disabled={loading}
            >
              {loading ? 'Checking...' : 'Preview'}
            </Button>
          </div>
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            Map each column to a field. Found {rawRows.length} rows.
            {usingSaved && ' Using the settings from your last import into this account.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className={optionLabelClass}>
              <span>Separator</span>
              <select
                value={delimiter}
                onChange={(e) => changeDelimiter(e.target.value as Delimiter)}
                className={selectClass}
              >
                {DELIMITERS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={optionLabelClass}>
              <span>Encoding</span>
              <select
                value={encoding}
                onChange={(e) => changeEncoding(e.target.value as CsvEncoding)}
                className={selectClass}
              >
                {CSV_ENCODINGS.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={optionLabelClass}>
              <span>Rows above the header</span>
              <input
                type="number"
                min={0}
                max={Math.max(records.length - 1, 0)}
                value={skipRowsDraft ?? skipRows}
                onChange={(e) => {
                  // An emptied field is being retyped: keep the table until there's a number
                  setSkipRowsDraft(e.target.value);
                  if (e.target.value.trim() === '') return;
                  const n = Math.trunc(Number(e.target.value));
                  if (Number.isFinite(n) && n >= 0 && n < records.length) {
                    showTable(records, n, saved, roles);
                  }
                }}
                onBlur={() => setSkipRowsDraft(null)}
                className={selectClass}
              />
            </label>
            <label className={optionLabelClass}>
              <span>Dates</span>
              <select
                value={dateFormat ?? ''}
                onChange={(e) => setDateFormatChoice(e.target.value as DateFormat)}
                className={selectClass}
              >
                {!dateFormat && <option value="">Choose…</option>}
                {Object.entries(DATE_FORMAT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={optionLabelClass}>
              <span>Amounts</span>
              <select
                value={numberFormat ?? ''}
                onChange={(e) => setNumberFormatChoice(e.target.value as NumberFormat)}
                className={selectClass}
              >
                {!numberFormat && <option value="">Choose…</option>}
                {Object.entries(NUMBER_FORMAT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {hasDirection && (
              <label className={optionLabelClass}>
                <span>Word for money out</span>
                <input
                  type="text"
                  value={outWord}
                  maxLength={50}
                  placeholder="Optional, e.g. Af"
                  onChange={(e) => setOutWord(e.target.value)}
                  className={selectClass}
                />
              </label>
            )}
          </div>
          {(!dateFormat || !numberFormat || needsOutWord) && (
            <div className="flex items-start gap-2 px-3 py-2 text-sm bg-caution-subtle text-caution rounded-lg">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                {!dateFormat &&
                  (detected.dateSample
                    ? `This file doesn't show in which order ${detected.dateSample} is written. `
                    : 'Rows in this file write dates in different orders. ')}
                {!numberFormat &&
                  (detected.amountSample
                    ? `This file doesn't show whether ${detected.amountSample} uses a decimal point or a decimal comma. `
                    : 'Rows in this file write amounts in different formats. ')}
                {(!dateFormat || !numberFormat) && 'Choose the format your bank uses. '}
                {needsOutWord &&
                  `FlyBudget doesn't know what ${detected.unknownDirections
                    .slice(0, 3)
                    .map((w) => `"${w}"`)
                    .join(
                      ', ',
                    )} means in the direction column. Type the word your bank uses for money going out; other words it doesn't know count as money in.`}
              </span>
            </div>
          )}
          {fromLastTime.length > 0 && (
            <p className="text-xs text-text-tertiary">
              This file doesn't show how it writes {fromLastTime.map((f) => f.what).join(' or ')}:
              using {fromLastTime.map((f) => f.format).join(' and ')}, as in your last import into
              this account.
            </p>
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
            <Button variant="secondary" onClick={() => setStep('upload')}>
              Back
            </Button>
            <Button onClick={handlePreview} disabled={loading}>
              {loading ? 'Checking...' : 'Preview'}
            </Button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            {previewRows.length} transactions found.{' '}
            {previewRows.filter((r) => r.isDuplicate).length} duplicates detected.{' '}
            {previewRows.length - excluded.size} will be imported.
            {skippedEntries > 0 && ` ${entriesLeftOut}`}
          </p>
          {otherStatementAccount && (
            <p
              role="alert"
              className="flex items-start gap-2 px-3 py-2 text-sm bg-caution-subtle text-caution rounded-lg"
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                This statement is for account {otherStatementAccount}, but the last statement
                imported into this account was for {knownStatementAccount}. Check that you're
                importing it into the right account.
              </span>
            </p>
          )}
          {skippedRows.length > 0 && (
            <p
              role="status"
              className="flex items-start gap-2 px-3 py-2 text-sm bg-caution-subtle text-caution rounded-lg"
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                {describeSkippedRows(skippedRows)} Fix the file and import it again to include them.
              </span>
            </p>
          )}
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
            <Button variant="secondary" onClick={previewBack}>
              Back
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={
                confirmMutation.isPending || previewRows.length === excluded.size || !canSave
              }
            >
              {confirmMutation.isPending
                ? 'Importing...'
                : `Import ${previewRows.length - excluded.size} Transactions`}
            </Button>
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
          <Button onClick={handleClose}>Done</Button>
        </div>
      )}
    </Modal>
  );
}
