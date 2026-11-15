import { useState } from 'react';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
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
import { t } from '../../i18n';

const section = 'bg-surface-alt rounded-lg p-5 space-y-4';
const inputClass =
  'text-sm border border-border rounded-md px-3 py-1.5 max-md:min-h-11 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600';

const errorText = (err: unknown) =>
  err instanceof Error ? err.message : t('common.errors.tryAgain');

/**
 * Settings → Currencies: the budget's currency, exchange rates (typed in, or downloaded from
 * the ECB when turned on) and how each currency is written on this device
 */
export function CurrencySettings() {
  const { t } = useTranslation();
  const { data: settings } = useCurrencySettings();
  if (!settings) return null;
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-text">{t('settings.currencies.title')}</h2>
        <p className="text-xs text-text-tertiary mt-0.5">
          {t('settings.currencies.hint')}{' '}
          <ExternalLink href={docsUrl('currencies')}>
            {t('settings.currencies.learnMore')}
          </ExternalLink>
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
  const { t } = useTranslation();
  const legacySymbol = usePreferencesStore((s) => s.currencySymbol);
  const [choice, setChoice] = useState(current ?? guessCurrency(legacySymbol));
  const save = useSetBudgetCurrency();
  const canSave = useCanSave();
  const changed = choice !== current;

  return (
    <section className={section} aria-labelledby="budget-currency-heading">
      <div>
        <h3 id="budget-currency-heading" className="text-sm font-medium text-text">
          {t('settings.currencies.budget.title')}
        </h3>
        <p className="text-xs text-text-tertiary mt-0.5">
          {t(current ? 'settings.currencies.budget.hint' : 'settings.currencies.budget.chooseHint')}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CurrencySelect
          value={choice}
          onChange={setChoice}
          first={current ? [current] : []}
          aria-label={t('settings.currencies.budget.title')}
          className="max-w-xs"
        />
        <Button
          size="sm"
          onClick={() => save.mutate(choice)}
          disabled={!changed || save.isPending || !canSave}
        >
          {t(current ? 'settings.currencies.budget.change' : 'settings.currencies.budget.use')}
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
  const { t } = useTranslation();
  const { data: settings } = useCurrencySettings();
  const recalculate = useRecalculate();
  const canSave = useCanSave();
  const missing = settings?.missing;
  if (!settings || !settings.foreignCurrencies.length) return null;

  return (
    <section className={section} aria-labelledby="missing-heading">
      <div>
        <h3 id="missing-heading" className="text-sm font-medium text-text">
          {t('settings.currencies.values.title', { currency: settings.currency })}
        </h3>
        {missing && missing.count > 0 ? (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-caution">
            <AlertTriangle size={13} className="mt-px shrink-0" aria-hidden />
            {t('settings.currencies.values.missing', {
              count: missing.count,
              currencies: missing.currencies.join(', '),
            })}
          </p>
        ) : (
          <p className="text-xs text-text-tertiary mt-0.5">
            {t('settings.currencies.values.hint', { currency: settings.currency })}
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
          {t('settings.currencies.values.recalculate')}
        </Button>
        {recalculate.isSuccess && (
          <span role="status" className="text-xs text-text-secondary">
            {recalculate.data.changed
              ? t('settings.currencies.values.updated', { count: recalculate.data.changed })
              : t('settings.currencies.values.nothingToUpdate')}{' '}
            {t('settings.currencies.values.typedInStay')}
          </span>
        )}
      </div>
    </section>
  );
}

function Rates() {
  const { t } = useTranslation();
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
          {t('settings.currencies.rates.title')}
        </h3>
        <p className="text-xs text-text-tertiary mt-0.5">{t('settings.currencies.rates.hint')}</p>
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
                  ? `${formatDay(r.date)} · ${r.source === 'manual' ? t('settings.currencies.rates.typedIn') : 'ECB'}`
                  : t('settings.currencies.rates.noRecentRate')}
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
            {t('settings.currencies.rates.currency')}
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
            {t('settings.currencies.rates.day')}
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
            {t('settings.currencies.rates.rate', { currency, budget })}
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
          {t('settings.currencies.rates.add')}
        </Button>
      </form>
      {rate !== '' && !rateValid && (
        <p role="alert" className="text-xs text-negative">
          {t('settings.currencies.rates.invalid')}
        </p>
      )}
      {add.isError && (
        <p role="alert" className="text-xs text-negative">
          {errorText(add.error)}
        </p>
      )}

      {typedIn.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-text-secondary mb-1.5">
            {t('settings.currencies.rates.typedInTitle')}
          </h4>
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
                  aria-label={t('settings.currencies.rates.delete', {
                    currency: r.base,
                    date: formatDay(r.date),
                  })}
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
  const { t } = useTranslation();
  const { data: settings } = useCurrencySettings();
  const setDownload = useSetRateDownload();
  const download = useDownloadRates();
  const canSave = useCanSave();
  const [url, setUrl] = useState(settings?.ratesUrl ?? '');
  if (!settings) return null;
  const server = settings.ratesUrl || settings.defaultRatesUrl;
  const host = (() => {
    if (!server) return null;
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
          {t('settings.currencies.download.title')}
        </h3>
        <p className="text-xs text-text-tertiary mt-0.5">
          {host
            ? t('settings.currencies.download.hint', { host })
            : t('settings.currencies.download.hintNoServer')}
        </p>
      </div>
      {!settings.canDownload ? (
        <p className="text-xs text-text-secondary">{t('settings.currencies.download.notInDemo')}</p>
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
            <span className="text-sm text-text-secondary">
              {t('settings.currencies.download.enable')}
            </span>
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
                  <Download size={13} />{' '}
                  {t(
                    download.isPending
                      ? 'settings.currencies.download.downloading'
                      : 'settings.currencies.download.now',
                  )}
                </Button>
                <span className="text-xs text-text-tertiary" role="status">
                  {downloadStatus(
                    settings.lastFetchedAt
                      ? t('settings.currencies.download.last', {
                          date: formatDay(settings.lastFetchedAt.slice(0, 10)),
                        })
                      : t('settings.currencies.download.never'),
                    download.data?.unsupported ?? [],
                  )}
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
                    {t('settings.currencies.download.server')}
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
                  {t('settings.currencies.download.saveServer')}
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

/** When the download went, and which currencies it has no rates for */
const downloadStatus = (status: string, unsupported: string[]) =>
  unsupported.length
    ? t('settings.currencies.download.unsupported', { status, currencies: unsupported.join(', ') })
    : status;

const POSITIONS: (SymbolPosition | 'auto')[] = ['auto', 'before', 'after'];

/** How each currency in use is written on this device: its symbol and which side it goes */
function Display() {
  const { t } = useTranslation();
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
          {t('settings.currencies.display.title')}
        </h3>
        <p className="text-xs text-text-tertiary mt-0.5">
          {t('settings.currencies.display.hint', { budget })}
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
                aria-label={t('settings.currencies.display.symbol', { currency: code })}
                value={own.symbol ?? ''}
                placeholder={currencySymbol(code)}
                maxLength={5}
                onChange={(e) => setStyle(code, { ...own, symbol: e.target.value || undefined })}
                className={`${inputClass} w-20 text-center`}
              />
              <div
                role="group"
                aria-label={t('settings.currencies.display.position', { currency: code })}
                className="flex gap-1"
              >
                {POSITIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={position === p}
                    onClick={() =>
                      setStyle(code, {
                        ...own,
                        position: p === 'auto' ? undefined : p,
                      })
                    }
                    className={`px-2.5 py-1 text-xs rounded-md border max-md:min-h-11 ${
                      position === p
                        ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                        : 'border-border bg-surface text-text-secondary'
                    }`}
                  >
                    {p === 'auto'
                      ? t(
                          currencyConvention(code).position === 'after'
                            ? 'settings.currencies.display.autoAfter'
                            : 'settings.currencies.display.autoBefore',
                        )
                      : t(`settings.currencies.display.${p}`)}
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
