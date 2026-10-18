import { useState } from 'react';
import {
  usePreferencesStore,
  type Theme,
  type DateFormatOption,
  type SidebarMode,
  type AmountFormat,
  type SymbolPosition,
} from '../../store/preferencesStore';
import { amountStyle, formatAmount, formatMoney, useAmountStyle } from '../../utils/currency';
import { Link } from 'react-router-dom';
import { useCurrencySettings } from '../../hooks/useCurrency';
import { ConfirmModal } from '../ui/ConfirmModal';
import { IS_DEMO } from '../../demo/isDemo';

const themeOptions: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const sidebarModes: { value: SidebarMode; label: string; description: string }[] = [
  { value: 'persistent', label: 'Pinned', description: 'Always open' },
  { value: 'auto-hide', label: 'Auto-hide', description: 'Collapsed, opens on hover' },
];

const dateFormats: { value: DateFormatOption; label: string; example: string }[] = [
  { value: 'MMM d, yyyy', label: 'MMM d, yyyy', example: 'Jan 5, 2026' },
  { value: 'MM/dd/yyyy', label: 'MM/dd/yyyy', example: '01/05/2026' },
  { value: 'dd/MM/yyyy', label: 'dd/MM/yyyy', example: '05/01/2026' },
  { value: 'dd.MM.yyyy', label: 'dd.MM.yyyy', example: '05.01.2026' },
  { value: 'yyyy-MM-dd', label: 'yyyy-MM-dd', example: '2026-01-05' },
];

const amountFormats: (AmountFormat | 'auto')[] = ['auto', 'dot', 'comma', 'space', 'apostrophe'];

const symbolPositions: { value: SymbolPosition | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Automatic' },
  { value: 'before', label: 'Before' },
  { value: 'after', label: 'After' },
];

/** 1,234.56 in a format, without a symbol */
const numberExample = (format: AmountFormat) =>
  formatAmount(123_456, { format, position: 'before', symbol: '' });

const choiceClass = (selected: boolean) =>
  `flex items-center justify-between gap-2 px-3 py-1.5 text-sm rounded-md border transition-colors max-md:min-h-11 tabular-nums ${
    selected
      ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
      : 'border-border bg-surface text-text-secondary hover:border-border'
  }`;

export function PreferencesPanel() {
  const {
    theme,
    currencySymbol,
    amountFormat,
    symbolPosition,
    dateFormat,
    sidebarMode,
    showMerchantIcons,
    showCategoryIcons,
    showAccountIcons,
    setTheme,
    setCurrencySymbol,
    setAmountFormat,
    setSymbolPosition,
    setDateFormat,
    setSidebarMode,
    setShowMerchantIcons,
    setShowCategoryIcons,
    setShowAccountIcons,
  } = usePreferencesStore();
  const [resetOpen, setResetOpen] = useState(false);
  const style = useAmountStyle();
  const example = formatAmount(-123_456, style);
  // Once the budget has a currency, its symbol comes from it; other currencies show too
  const { data: currencySettings } = useCurrencySettings();
  const budgetCurrency = currencySettings?.currency ?? null;
  const otherExamples = (currencySettings?.foreignCurrencies ?? []).map((c) =>
    formatMoney(-123_456, c),
  );
  // What Automatic means on this device
  const auto = amountStyle({ amountFormat: 'auto', symbolPosition: 'auto', currencySymbol });

  function handleReset() {
    setTheme('light');
    setSidebarMode('persistent');
    setCurrencySymbol('$');
    setAmountFormat('auto');
    setSymbolPosition('auto');
    setDateFormat('MMM d, yyyy');
    setShowMerchantIcons(true);
    setShowCategoryIcons(true);
    setShowAccountIcons(true);
    setResetOpen(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text">Preferences</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            {IS_DEMO
              ? 'Settings are kept in this tab while you try the demo.'
              : 'Settings are saved automatically to your browser.'}
          </p>
        </div>
        <button
          onClick={() => setResetOpen(true)}
          className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
        >
          Reset to defaults
        </button>
      </div>

      <ConfirmModal
        isOpen={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={handleReset}
        title="Reset preferences"
        message="Are you sure you want to reset all preferences to their default values?"
        confirmLabel="Reset"
        danger
      />

      <div className="bg-surface-alt rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-medium text-text">Theme</h3>
        <div className="flex gap-3">
          {themeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setTheme(opt.value)}
              className={`px-4 py-2 text-sm rounded-md border transition-colors ${
                theme === opt.value
                  ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                  : 'border-border bg-surface text-text-secondary hover:border-border'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-surface-alt rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-medium text-text">Sidebar</h3>
        <div className="flex gap-3">
          {sidebarModes.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSidebarMode(opt.value)}
              className={`flex flex-col px-4 py-2 text-sm rounded-md border transition-colors ${
                sidebarMode === opt.value
                  ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                  : 'border-border bg-surface text-text-secondary hover:border-border'
              }`}
            >
              <span>{opt.label}</span>
              <span className="text-xs text-text-tertiary font-normal mt-0.5">
                {opt.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-surface-alt rounded-lg p-5 space-y-5">
        <h3 className="text-sm font-medium text-text">Icons</h3>
        {(
          [
            {
              label: 'Merchant',
              description: 'Merchant logos (or colored initials) next to merchant names',
              value: showMerchantIcons,
              setter: setShowMerchantIcons,
            },
            {
              label: 'Category',
              description: 'Emoji icons next to category names',
              value: showCategoryIcons,
              setter: setShowCategoryIcons,
            },
            {
              label: 'Account',
              description: 'Account logos (or colored initials) next to account names',
              value: showAccountIcons,
              setter: setShowAccountIcons,
            },
          ] as const
        ).map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-text">{row.label}</div>
              <div className="text-xs text-text-tertiary mt-0.5">{row.description}</div>
            </div>
            <div className="flex gap-2 shrink-0">
              {[
                { v: true, l: 'Show' },
                { v: false, l: 'Hide' },
              ].map((opt) => (
                <button
                  key={String(opt.v)}
                  onClick={() => row.setter(opt.v)}
                  className={`px-3 py-1.5 text-xs rounded-md border transition-colors cursor-pointer ${
                    row.value === opt.v
                      ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                      : 'border-border bg-surface text-text-secondary hover:border-border'
                  }`}
                >
                  {opt.l}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <section
        aria-labelledby="amounts-heading"
        className="bg-surface-alt rounded-lg p-5 space-y-4"
      >
        <div>
          <h3 id="amounts-heading" className="text-sm font-medium text-text">
            Amounts
          </h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            How amounts are shown and typed on this device. Automatic follows your device's
            language. You can always type 12.50 or 12,50.
          </p>
        </div>

        <div className="space-y-2" role="group" aria-label="Number format">
          <div className="text-xs font-medium text-text-secondary">Number format</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {amountFormats.map((opt) => (
              <button
                key={opt}
                type="button"
                aria-pressed={amountFormat === opt}
                aria-label={opt === 'auto' ? 'Automatic' : numberExample(opt)}
                onClick={() => setAmountFormat(opt)}
                className={choiceClass(amountFormat === opt)}
              >
                <span>{opt === 'auto' ? 'Automatic' : numberExample(opt)}</span>
                {opt === 'auto' && (
                  <span className="text-xs text-text-tertiary">{numberExample(auto.format)}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2" role="group" aria-label="Currency symbol position">
          <div className="text-xs font-medium text-text-secondary">
            {budgetCurrency ? `${budgetCurrency} symbol` : 'Currency symbol'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!budgetCurrency && (
              <input
                type="text"
                aria-label="Currency symbol"
                value={currencySymbol}
                onChange={(e) => setCurrencySymbol(e.target.value.slice(0, 3))}
                maxLength={3}
                className="w-20 text-center text-sm border border-border rounded-md px-3 py-1.5 max-md:min-h-11 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
              />
            )}
            {symbolPositions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                aria-pressed={symbolPosition === opt.value}
                onClick={() => setSymbolPosition(opt.value)}
                className={choiceClass(symbolPosition === opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-tertiary">
            {budgetCurrency ? (
              <>
                Automatic writes it as {budgetCurrency} is written at home. Symbols of other
                currencies are in{' '}
                <Link to="/settings?tab=currencies" className="underline hover:no-underline">
                  Currencies
                </Link>
                .
              </>
            ) : (
              <>
                Up to 3 characters (e.g. $, €, EUR, kr). Or choose your budget&apos;s currency in{' '}
                <Link to="/settings?tab=currencies" className="underline hover:no-underline">
                  Currencies
                </Link>
                .
              </>
            )}
          </p>
        </div>

        <p className="text-sm text-text-secondary">
          Example: <span className="font-medium text-text tabular-nums">{example}</span>
          {otherExamples.map((e) => (
            <span key={e} className="font-medium text-text tabular-nums">
              {' · '}
              {e}
            </span>
          ))}
        </p>
      </section>

      <div className="bg-surface-alt rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-medium text-text">Date Format</h3>
        <div className="grid grid-cols-2 gap-2">
          {dateFormats.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDateFormat(opt.value)}
              className={`flex items-center justify-between px-4 py-2.5 text-sm rounded-md border transition-colors ${
                dateFormat === opt.value
                  ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                  : 'border-border bg-surface text-text-secondary hover:border-border'
              }`}
            >
              <span>{opt.label}</span>
              <span className="text-xs text-text-tertiary">{opt.example}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
