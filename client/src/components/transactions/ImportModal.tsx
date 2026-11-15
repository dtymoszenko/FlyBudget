import { useState, useCallback, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
import { formatMoney } from '../../utils/currency';
import { minorUnits } from '../../utils/currencies';
import { useAccountCurrency } from '../../hooks/useCurrency';
import type { ImportPreviewRow } from '../../types';
import type { ImportRow } from '../../api/transactions';
import { t } from '../../i18n';
import { IS_DEMO } from '../../demo/demoApi';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  accountId: string;
}

type Step = 'upload' | 'statement' | 'map' | 'preview' | 'done';

// Ids as data: the names come from en.json (import.delimiters, import.roles)
const DELIMITERS: Record<Delimiter, 'comma' | 'semicolon' | 'tab'> = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
};

const COLUMN_ROLES: ColumnRole[] = [
  'date',
  'payee',
  'amount',
  'inflow',
  'outflow',
  'direction',
  'notes',
  'skip',
];

// Examples of how a file writes dates and amounts, not text
const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  // i18n-ignore
  mdy: 'MM/DD/YYYY',
  // i18n-ignore
  dmy: 'DD/MM/YYYY',
  // i18n-ignore
  ymd: 'YY/MM/DD',
};

const NUMBER_FORMAT_LABELS: Record<NumberFormat, string> = {
  // i18n-ignore
  dot: '1,234.56',
  // i18n-ignore
  comma: '1.234,56',
};

// The encodings' names, by id: standard names aren't text, the others are in en.json
const ENCODING_NAMES: Partial<Record<CsvEncoding, string>> = {
  // i18n-ignore
  'utf-8': 'UTF-8',
  // i18n-ignore
  'utf-16le': 'UTF-16 LE',
  // i18n-ignore
  'utf-16be': 'UTF-16 BE',
};

function encodingLabel(encoding: CsvEncoding): string {
  switch (encoding) {
    case 'auto':
      return t('import.encodings.auto');
    case 'windows-1252':
      return t('import.encodings.windows1252');
    case 'windows-1250':
      return t('import.encodings.windows1250');
    case 'iso-8859-2':
      return t('import.encodings.iso88592');
    default:
      return ENCODING_NAMES[encoding] ?? encoding;
  }
}

const selectClass = 'w-full text-xs border border-border rounded px-1.5 py-1 bg-surface text-text';
const optionLabelClass = 'text-xs font-medium text-text-tertiary space-y-1';

const settingsKey = (accountId: string) => ['import-settings', accountId];

/** Settings still being saved, by account: the next import of a file waits for them */
const pendingSaves = new Map<string, Promise<void>>();

/** The most rows one import may send (the server's limit) */
const MAX_IMPORT_ROWS = 100_000;

export function ImportModal({ isOpen, onClose, accountId }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('upload');
  // Amounts are read in the account's currency (no decimals for yen)
  const currency = useAccountCurrency()(accountId);
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
        setError(t('import.errors.parse'));
        return;
      }
      setError(null);
      setRecords(all);
      setDelimiter(sep);
      const header = Math.min(skip ?? detectSkipRows(all), all.length - 1);
      showTable(all, header, savedSettings, keepRoles);
      setStep('map');
    },
    [showTable, t],
  );

  async function runPreview(rows: ImportRow[], skipped: SkippedRow[], camtSkipped = 0) {
    const load = loadId.current;
    // The server's limit: say so, rather than fail the whole file with a generic error
    if (rows.length > MAX_IMPORT_ROWS) {
      setError(
        t('import.errors.tooManyRows', {
          count: rows.length,
          max: MAX_IMPORT_ROWS.toLocaleString(),
        }),
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
      if (load === loadId.current)
        setError(e instanceof Error ? e.message : t('import.errors.previewFailed'));
    } finally {
      if (load === loadId.current) setLoading(false);
    }
  }

  function previewStatement(statement: CamtStatement) {
    if (!statement.transactions.length) {
      setError(t('import.errors.noBooked'));
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
      if (load === loadId.current) setError(t('import.errors.unreadable'));
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
        setError(t('import.errors.notStatement'));
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
  const datesFromLastTime =
    !dateFormatChoice && !detected.dateFormat && lastTime?.dateFormat
      ? DATE_FORMAT_LABELS[lastTime.dateFormat]
      : null;
  const amountsFromLastTime =
    !numberFormatChoice && !detected.numberFormat && lastTime?.numberFormat
      ? NUMBER_FORMAT_LABELS[lastTime.numberFormat]
      : null;
  const hasDirection = roles.includes('direction');
  const needsOutWord = hasDirection && !outWord.trim() && detected.unknownDirections.length > 0;

  function handlePreview() {
    setError(null);
    // Never guess: swapped days and months, or amounts off by 100x, would look plausible
    if (!dateFormat) return setError(t('import.errors.chooseDates'));
    if (!numberFormat) return setError(t('import.errors.chooseAmounts'));
    if (needsOutWord) return setError(t('import.errors.needOutWord'));
    const built = buildImportRows(rawRows, roles, {
      dateFormat,
      numberFormat,
      outWord,
      minor: minorUnits(currency),
    });
    if (typeof built === 'string') {
      setError(built);
      return;
    }
    const { rows, skipped } = built;
    if (!rows.length) {
      setError(
        skipped.length
          ? t('import.errors.noneImported', { skipped: describeSkippedRows(skipped) })
          : t('import.errors.noValidRows'),
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
      setError(t('import.errors.noneSelected'));
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
          if (load === loadId.current)
            setError(e instanceof Error ? e.message : t('import.errors.importFailed'));
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

  // A statement for another account than the one imported here last time
  const statementAccount =
    source === 'camt' ? statementAccountKey(statements[statementIdx]?.account ?? null) : null;
  const otherStatementAccount =
    statementAccount && knownStatementAccount && statementAccount !== knownStatementAccount
      ? statementAccount
      : null;
  // A statement in another currency than this account's: its amounts would mean something else
  const statementCurrency = source === 'camt' ? (statements[statementIdx]?.currency ?? null) : null;
  const otherCurrency =
    statementCurrency && currency && statementCurrency !== currency ? statementCurrency : null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('import.title')} size="lg">
      {error && (
        <div className="mb-4 flex items-center gap-2 px-3 py-2 text-sm bg-negative-subtle text-negative rounded-lg">
          <AlertTriangle size={14} /> {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-auto flex items-center justify-center max-md:min-h-11 max-md:min-w-11"
            aria-label={t('import.dismiss')}
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
          <p className="text-sm text-text-secondary">{t('import.upload.drop')}</p>
          <p className="text-xs text-text-tertiary">{t('import.upload.formats')}</p>
          {loading && <p className="text-xs text-text-tertiary">{t('import.upload.checking')}</p>}
          {IS_DEMO && <p className="text-xs text-text-tertiary">{t('import.upload.demo')}</p>}
          <input
            id="csv-file-input"
            type="file"
            accept=".csv,.tsv,.txt,.xml"
            aria-label={t('import.upload.bankFile')}
            className="hidden"
            onChange={handleFileInput}
          />
        </div>
      )}

      {step === 'statement' && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            {t('import.statement.intro', { count: statements.length })}
          </p>
          <label className={optionLabelClass}>
            <span>{t('import.statement.label')}</span>
            <select
              value={statementIdx}
              onChange={(e) => setStatementIdx(Number(e.target.value))}
              className={selectClass}
            >
              {statements.map((s, i) => (
                <option key={i} value={i}>
                  {t(
                    knownStatementAccount !== null &&
                      statementAccountKey(s.account) === knownStatementAccount
                      ? 'import.statement.optionKnown'
                      : 'import.statement.option',
                    {
                      account: s.account ?? t('import.statement.noNumber'),
                      count: s.transactions.length,
                    },
                  )}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep('upload')}>
              {t('import.back')}
            </Button>
            <Button
              onClick={() => void previewStatement(statements[statementIdx])}
              disabled={loading}
            >
              {loading ? t('import.checking') : t('import.preview.button')}
            </Button>
          </div>
        </div>
      )}

      {step === 'map' && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            {t('import.map.intro', { count: rawRows.length })}
            {usingSaved && ` ${t('import.map.usingSaved')}`}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className={optionLabelClass}>
              <span>{t('import.map.separator')}</span>
              <select
                value={delimiter}
                onChange={(e) => changeDelimiter(e.target.value as Delimiter)}
                className={selectClass}
              >
                {(Object.keys(DELIMITERS) as Delimiter[]).map((d) => (
                  <option key={d} value={d}>
                    {t(`import.delimiters.${DELIMITERS[d]}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className={optionLabelClass}>
              <span>{t('import.map.encoding')}</span>
              <select
                value={encoding}
                onChange={(e) => changeEncoding(e.target.value as CsvEncoding)}
                className={selectClass}
              >
                {CSV_ENCODINGS.map((e) => (
                  <option key={e} value={e}>
                    {encodingLabel(e)}
                  </option>
                ))}
              </select>
            </label>
            <label className={optionLabelClass}>
              <span>{t('import.map.skipRows')}</span>
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
              <span>{t('import.map.dates')}</span>
              <select
                value={dateFormat ?? ''}
                onChange={(e) => setDateFormatChoice(e.target.value as DateFormat)}
                className={selectClass}
              >
                {!dateFormat && <option value="">{t('import.map.choose')}</option>}
                {Object.entries(DATE_FORMAT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className={optionLabelClass}>
              <span>{t('import.map.amounts')}</span>
              <select
                value={numberFormat ?? ''}
                onChange={(e) => setNumberFormatChoice(e.target.value as NumberFormat)}
                className={selectClass}
              >
                {!numberFormat && <option value="">{t('import.map.choose')}</option>}
                {Object.entries(NUMBER_FORMAT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {hasDirection && (
              <label className={optionLabelClass}>
                <span>{t('import.map.outWord')}</span>
                <input
                  type="text"
                  value={outWord}
                  maxLength={50}
                  placeholder={t('import.map.outWordPlaceholder')}
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
                {[
                  !dateFormat &&
                    (detected.dateSample
                      ? t('import.map.warn.dateSample', { sample: detected.dateSample })
                      : t('import.map.warn.dateMixed')),
                  !numberFormat &&
                    (detected.amountSample
                      ? t('import.map.warn.amountSample', { sample: detected.amountSample })
                      : t('import.map.warn.amountMixed')),
                  (!dateFormat || !numberFormat) && t('import.map.warn.chooseFormat'),
                  needsOutWord &&
                    t('import.map.warn.outWord', {
                      words: detected.unknownDirections
                        .slice(0, 3)
                        .map((w) => t('import.skipped.quoted', { value: w }))
                        .join(', '),
                    }),
                ]
                  .filter(Boolean)
                  .join(' ')}
              </span>
            </div>
          )}
          {(datesFromLastTime || amountsFromLastTime) && (
            <p className="text-xs text-text-tertiary">
              {datesFromLastTime && amountsFromLastTime
                ? t('import.map.fromLastTime.both', {
                    dateFormat: datesFromLastTime,
                    numberFormat: amountsFromLastTime,
                  })
                : datesFromLastTime
                  ? t('import.map.fromLastTime.dates', { format: datesFromLastTime })
                  : t('import.map.fromLastTime.amounts', { format: amountsFromLastTime })}
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
                        aria-label={t('import.map.column', { name: h })}
                        onChange={(e) => setRole(i, e.target.value as ColumnRole)}
                        className={selectClass}
                      >
                        {COLUMN_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {t(`import.roles.${role}`)}
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
              {t('import.back')}
            </Button>
            <Button onClick={handlePreview} disabled={loading}>
              {loading ? t('import.checking') : t('import.preview.button')}
            </Button>
          </div>
        </div>
      )}

      {step === 'preview' && (
        <div className="space-y-4">
          <p className="text-sm text-text-secondary">
            {t('import.preview.found', { count: previewRows.length })}{' '}
            {t('import.preview.duplicates', {
              count: previewRows.filter((r) => r.isDuplicate).length,
            })}{' '}
            {t('import.preview.willImport', { count: previewRows.length - excluded.size })}
            {skippedEntries > 0 &&
              ` ${t('import.preview.entriesLeftOut', { count: skippedEntries })}`}
          </p>
          {otherCurrency && (
            <p
              role="alert"
              className="flex items-start gap-2 px-3 py-2 text-sm bg-caution-subtle text-caution rounded-lg"
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                {t('import.preview.otherCurrency', { statementCurrency: otherCurrency, currency })}
              </span>
            </p>
          )}
          {otherStatementAccount && (
            <p
              role="alert"
              className="flex items-start gap-2 px-3 py-2 text-sm bg-caution-subtle text-caution rounded-lg"
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                {t('import.preview.otherAccount', {
                  statementAccount: otherStatementAccount,
                  knownAccount: knownStatementAccount,
                })}
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
                {describeSkippedRows(skippedRows)} {t('import.preview.fixFile')}
              </span>
            </p>
          )}
          <div className="max-h-64 overflow-y-auto border border-border rounded-lg">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-surface-alt">
                <tr>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-text-tertiary w-8"></th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-text-tertiary">
                    {t('import.preview.columns.date')}
                  </th>
                  <th className="px-2 py-1.5 text-left text-xs font-medium text-text-tertiary">
                    {t('import.preview.columns.payee')}
                  </th>
                  <th className="px-2 py-1.5 text-right text-xs font-medium text-text-tertiary">
                    {t('import.preview.columns.amount')}
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
                        aria-label={
                          row.payeeName
                            ? t('import.preview.rowLabel', { payee: row.payeeName, date: row.date })
                            : t('import.preview.rowLabelNoPayee', { date: row.date })
                        }
                        className="w-3.5 h-3.5 accent-brand-600"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-xs text-text-secondary">{row.date}</td>
                    <td className="px-2 py-1.5 text-xs text-text flex items-center gap-1">
                      {row.payeeName ?? '—'}
                      {row.isDuplicate && (
                        <span className="text-[10px] px-1 py-0.5 bg-caution-subtle text-caution rounded">
                          {t('import.preview.duplicate')}
                        </span>
                      )}
                    </td>
                    <td
                      className={`px-2 py-1.5 text-xs text-right tabular-nums ${row.amount < 0 ? 'text-text' : 'text-positive'}`}
                    >
                      {formatMoney(row.amount, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <SavingPausedHint className="text-right" />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={previewBack}>
              {t('import.back')}
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={
                confirmMutation.isPending ||
                previewRows.length === excluded.size ||
                !canSave ||
                // A statement in another currency would be read as this account's
                !!otherCurrency
              }
            >
              {confirmMutation.isPending
                ? t('import.preview.importing')
                : t('import.preview.import', { count: previewRows.length - excluded.size })}
            </Button>
          </div>
        </div>
      )}

      {step === 'done' && result && (
        <div className="flex flex-col items-center gap-4 py-6">
          <CheckCircle size={40} className="text-positive" />
          <div className="text-center">
            <p className="text-sm font-medium text-text">{t('import.done.title')}</p>
            <p className="text-sm text-text-secondary mt-1">
              {t('import.done.summary', {
                imported: t('import.done.imported', { count: result.imported }),
                skipped: t('import.done.skipped', { count: result.skipped }),
              })}
            </p>
          </div>
          <Button onClick={handleClose}>{t('common.actions.done')}</Button>
        </div>
      )}
    </Modal>
  );
}
