import { useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, Download, Trash2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { ExternalLink } from '../ui/ExternalLink';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import { CurrencySelect } from '../currency/CurrencySelect';
import { useCanSave } from '../../hooks/useConnection';
import {
  useAddRate,
  useCurrencySettings,
  useDeleteRate,
  useDownloadRates,
  useRates,
  useRecalculate,
  useSetBudgetCurrency,
  useSetRateDownload,
} from '../../hooks/useCurrency';
import { usePreferencesStore, type SymbolPosition } from '../../store/preferencesStore';
import {
  currencyConvention,
  currencyName,
  currencySymbol,
  formatMoney,
  guessCurrency,
} from '../../utils/currency';
import { parseRate } from '../../utils/money';
import { formatDay } from '../../utils/dates';
import { docsUrl } from '../../utils/project';

const section = 'bg-surface-alt rounded-lg p-5 space-y-4';
const inputClass =
  'text-sm border border-border rounded-md px-3 py-1.5 max-md:min-h-11 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600';

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : 'Something went wrong. Try again.';

/**
 * Settings → Currencies: the budget's currency, exchange rates (typed in, or downloaded from
 * the ECB when turned on) and how each currency is written on this device
 */
export function CurrencySettings() {
  const { data: settings } = useCurrencySettings();
  if (!settings) return null;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-text">Currencies</h2>
        <p className="text-xs text-text-tertiary mt-0.5">
          Your budget has one currency. Accounts can each have their own: their amounts stay in it,
          and the budget and reports count them in yours at each day&apos;s exchange rate.{' '}
          <ExternalLink href={docsUrl('currencies')}>How currencies work</ExternalLink>
        </p>
      </div>
      <BudgetCurrency current={settings.currency} />
      {settings.currency && (
        <>
          <MissingRates />
          <Rates />
          <RateDownload />
          <Display />
        </>
      )}
    </div>
  );
}

function BudgetCurrency({ current }: { current: string | null }) {
  const legacySymbol = usePreferencesStore((s) => s.currencySymbol);
  const [choice, setChoice] = useState(current ?? guessCurrency(legacySymbol));
  const save = useSetBudgetCurrency();
  const canSave = useCanSave();
  const changed = choice !== current;

  return (
    <section className={section} aria-labelledby="budget-currency-heading">
      <div>
        <h3 id="budget-currency-heading" className="text-sm font-medium text-text">
          Budget currency
        </h3>
        <p className="text-xs text-text-tertiary mt-0.5">
          {current
            ? 'What your budget, reports and net worth are counted in. It can be corrected while no account in another currency has transactions.'
            : 'Choose the currency your amounts are in. Nothing is converted: it only names the currency, so accounts in other currencies can be added.'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CurrencySelect
          value={choice}
          onChange={setChoice}
          first={current ? [current] : []}
          aria-label="Budget currency"
          className="max-w-xs"
        />
        <Button
          size="sm"
          onClick={() => save.mutate(choice)}
          disabled={!changed || save.isPending || !canSave}
        >
          {current ? 'Change' : 'Use this currency'}
        </Button>
      </div>
      {save.isError && (
        <p role="alert" className="text-xs text-negative">
          {errorText(save.error)}
        </p>
      )}
      <SavingPausedHint />
    </section>
  );
}

/** Transactions waiting for a rate, and recalculating values after rates were corrected */
function MissingRates() {
  const { data: settings } = useCurrencySettings();
  const recalculate = useRecalculate();
  const canSave = useCanSave();
  const missing = settings?.missing;
  if (!settings || !settings.foreignCurrencies.length) return null;

  return (
    <section className={section} aria-labelledby="missing-heading">
      <div>
        <h3 id="missing-heading" className="text-sm font-medium text-text">
          Values in {settings.currency}
        </h3>
        {missing && missing.count > 0 ? (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-caution">
            <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />
            {missing.count} transaction{missing.count === 1 ? '' : 's'} in{' '}
            {missing.currencies.join(', ')} {missing.count === 1 ? 'has' : 'have'} no exchange rate
            for {missing.count === 1 ? 'its' : 'their'} day yet, so the budget counts{' '}
            {missing.count === 1 ? 'it' : 'them'} as nothing. Add a rate below, or turn on
            downloading.
          </p>
        ) : (
          <p className="text-xs text-text-tertiary mt-0.5">
            Every transaction in another currency has its value in {settings.currency}. Values stay
            as they were when a rate changes; recalculate after correcting a rate.
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => recalculate.mutate({})}
          disabled={recalculate.isPending || !canSave}
        >
          Recalculate from rates
        </Button>
        {recalculate.isSuccess && (
          <span role="status" className="text-xs text-text-secondary">
            {recalculate.data.changed
              ? `${recalculate.data.changed} value${recalculate.data.changed === 1 ? '' : 's'} updated.`
              : 'Nothing to update.'}{' '}
            Values you typed in stay.
          </span>
        )}
      </div>
    </section>
  );
}

function Rates() {
  const { data: settings } = useCurrencySettings();
  const budget = settings?.currency ?? null;
  const foreign = settings?.foreignCurrencies ?? [];
  const [currency, setCurrency] = useState(foreign[0] ?? (budget === 'USD' ? 'EUR' : 'USD'));
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [rate, setRate] = useState('');
  const add = useAddRate();
  const remove = useDeleteRate();
  const canSave = useCanSave();
  const { data: typedIn = [] } = useRates(
    { quote: budget ?? undefined, source: 'manual' },
    !!budget,
  );
  if (!budget) return null;

  const rateText = rate.trim().replace(',', '.');
  const rateValid = parseRate(rateText) !== null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!rateValid || currency === budget) return;
    add.mutate(
      { date, base: currency, quote: budget!, rate: rateText },
      { onSuccess: () => setRate('') },
    );
  }

  return (
    <section className={section} aria-labelledby="rates-heading">
      <div>
        <h3 id="rates-heading" className="text-sm font-medium text-text">
          Exchange rates
        </h3>
        <p className="text-xs text-text-tertiary mt-0.5">
          A day without a rate uses the closest earlier one, up to a month back. A rate you type in
          wins over a downloaded one for its day.
        </p>
      </div>

      {settings!.latestRates.length > 0 && (
        <ul className="divide-y divide-border-light rounded-md border border-border bg-surface">
          {settings!.latestRates.map((r) => (
            <li key={r.currency} className="flex flex-wrap items-center gap-x-3 px-3 py-2 text-sm">
              <span className="font-medium text-text">
                1 {r.currency} = {r.rate ?? '—'} {budget}
              </span>
              <span className="text-xs text-text-tertiary">
                {r.date
                  ? `${formatDay(r.date)} · ${r.source === 'manual' ? 'typed in' : 'ECB'}`
                  : 'No rate in the last month'}
              </span>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <div>
          <label
            htmlFor="rate-currency"
            className="block text-xs font-medium text-text-tertiary mb-1"
          >
            Currency
          </label>
          <CurrencySelect
            id="rate-currency"
            value={currency}
            onChange={setCurrency}
            first={foreign}
            className="w-48"
          />
        </div>
        <div>
          <label htmlFor="rate-date" className="block text-xs font-medium text-text-tertiary mb-1">
            Day
          </label>
          <input
            id="rate-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="rate-value" className="block text-xs font-medium text-text-tertiary mb-1">
            1 {currency} in {budget}
          </label>
          <input
            id="rate-value"
            type="text"
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="1.0812"
            aria-invalid={(rate !== '' && !rateValid) || undefined}
            className={`${inputClass} w-32`}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          disabled={!rateValid || currency === budget || add.isPending || !canSave || !date}
        >
          Add rate
        </Button>
      </form>
      {rate !== '' && !rateValid && (
        <p role="alert" className="text-xs text-negative">
          Type the rate as a positive number, like 1.0812.
        </p>
      )}
      {add.isError && (
        <p role="alert" className="text-xs text-negative">
          {errorText(add.error)}
        </p>
      )}

      {typedIn.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-1.5">Rates you typed in</h4>
          <ul className="divide-y divide-border-light rounded-md border border-border bg-surface">
            {typedIn.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-3 py-1.5 text-sm">
                <span className="flex-1 min-w-0 truncate text-text">
                  {formatDay(r.date)}: 1 {r.base} = {r.rate} {r.quote}
                </span>
                <button
                  type="button"
                  onClick={() => remove.mutate(r.id)}
                  disabled={!canSave}
                  aria-label={`Delete the rate for ${r.base} on ${formatDay(r.date)}`}
                  className="p-1.5 rounded text-text-tertiary hover:text-negative max-md:min-h-11 max-md:min-w-11 disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <SavingPausedHint />
    </section>
  );
}

function RateDownload() {
  const { data: settings } = useCurrencySettings();
  const setDownload = useSetRateDownload();
  const download = useDownloadRates();
  const canSave = useCanSave();
  const [url, setUrl] = useState(settings?.ratesUrl ?? '');
  if (!settings) return null;
  const server = settings.ratesUrl || settings.defaultRatesUrl || 'the rates server';
  const host = (() => {
    try {
      return new URL(server).host;
    } catch {
      return server;
    }
  })();

  return (
    <section className={section} aria-labelledby="download-heading">
      <div>
        <h3 id="download-heading" className="text-sm font-medium text-text">
          Download rates
        </h3>
        <p className="text-xs text-text-tertiary mt-0.5">
          The European Central Bank&apos;s daily reference rates, from {host} (Frankfurter, open
          source). Only currency codes and dates are sent, never anything about your budget. Off
          until you turn it on; then it checks every few hours.
        </p>
      </div>
      {!settings.canDownload ? (
        <p className="text-xs text-text-secondary">
          Not available in the demo: rates can be typed in above.
        </p>
      ) : (
        <>
          <label className="flex items-center gap-3 cursor-pointer max-md:min-h-11">
            <input
              type="checkbox"
              checked={settings.ratesEnabled}
              onChange={(e) => setDownload.mutate({ enabled: e.target.checked })}
              disabled={!canSave || setDownload.isPending}
              className="h-4 w-4 rounded border-border text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm text-text-secondary">Download ECB reference rates</span>
          </label>
          {settings.ratesEnabled && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => download.mutate()}
                  disabled={download.isPending || !canSave}
                >
                  <Download size={13} /> {download.isPending ? 'Downloading…' : 'Download now'}
                </Button>
                <span className="text-xs text-text-tertiary" role="status">
                  {settings.lastFetchedAt
                    ? `Last downloaded ${formatDay(settings.lastFetchedAt.slice(0, 10))}`
                    : 'Not downloaded yet'}
                  {download.data?.unsupported.length
                    ? `. The ECB has no rates for ${download.data.unsupported.join(', ')}: type those in.`
                    : ''}
                </span>
              </div>
              {settings.lastError && (
                <p role="alert" className="text-xs text-negative">
                  {settings.lastError}
                </p>
              )}
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  setDownload.mutate({ url: url.trim() || null });
                }}
              >
                <div className="flex-1 min-w-56">
                  <label
                    htmlFor="rates-url"
                    className="block text-xs font-medium text-text-tertiary mb-1"
                  >
                    Server (optional, for your own Frankfurter)
                  </label>
                  <input
                    id="rates-url"
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={settings.defaultRatesUrl ?? ''}
                    className={`${inputClass} w-full`}
                  />
                </div>
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={(url.trim() || null) === settings.ratesUrl || !canSave}
                >
                  Save server
                </Button>
              </form>
              {setDownload.isError && (
                <p role="alert" className="text-xs text-negative">
                  {errorText(setDownload.error)}
                </p>
              )}
            </div>
          )}
          <SavingPausedHint />
        </>
      )}
    </section>
  );
}

const POSITIONS: { value: SymbolPosition | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'before', label: 'Before' },
  { value: 'after', label: 'After' },
];

/** How each currency in use is written on this device: its symbol and which side it goes */
function Display() {
  const { data: settings } = useCurrencySettings();
  const styles = usePreferencesStore((s) => s.currencyStyles);
  const setStyle = usePreferencesStore((s) => s.setCurrencyStyle);
  const budget = settings?.currency;
  if (!budget) return null;
  const currencies = [budget, ...(settings?.foreignCurrencies ?? [])];

  return (
    <section className={section} aria-labelledby="display-heading">
      <div>
        <h3 id="display-heading" className="text-sm font-medium text-text">
          How amounts are written
        </h3>
        <p className="text-xs text-text-tertiary mt-0.5">
          On this device. Automatic writes each currency as at home: 1 234,56 zł, $1,234.56, CHF
          1&apos;234.56 (the number format is in Preferences). {budget}&apos;s position is the
          Preferences one.
        </p>
      </div>
      <ul className="space-y-3">
        {currencies.map((code) => {
          const own = styles[code] ?? {};
          const position = own.position ?? 'auto';
          return (
            <li key={code} className="flex flex-wrap items-center gap-2">
              <span className="w-40 text-sm text-text">
                {code} <span className="text-xs text-text-tertiary">{currencyName(code)}</span>
              </span>
              <input
                type="text"
                aria-label={`${code} symbol`}
                value={own.symbol ?? ''}
                placeholder={currencySymbol(code)}
                maxLength={5}
                onChange={(e) => setStyle(code, { ...own, symbol: e.target.value || undefined })}
                className={`${inputClass} w-20 text-center`}
              />
              <div role="group" aria-label={`${code} symbol position`} className="flex gap-1">
                {POSITIONS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    aria-pressed={position === p.value}
                    onClick={() =>
                      setStyle(code, {
                        ...own,
                        position: p.value === 'auto' ? undefined : p.value,
                      })
                    }
                    className={`px-2.5 py-1 text-xs rounded-md border max-md:min-h-11 ${
                      position === p.value
                        ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                        : 'border-border bg-surface text-text-secondary'
                    }`}
                  >
                    {p.value === 'auto'
                      ? `Automatic (${currencyConvention(code).position === 'after' ? 'after' : 'before'})`
                      : p.label}
                  </button>
                ))}
              </div>
              <span className="text-sm tabular-nums text-text-secondary">
                {formatMoney(-123_456, code)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
