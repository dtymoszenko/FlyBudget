import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  usePreferencesStore,
  type Theme,
  type DateFormatOption,
  type SidebarMode,
  type AmountFormat,
  type SymbolPosition,
} from '../../store/preferencesStore';
import {
  availableLanguages,
  deviceLanguages,
  languageInfo,
  resolveLanguage,
  type LanguagePreference,
} from '../../i18n/languages';
import { amountStyle, formatAmount, formatMoney, useAmountStyle } from '../../utils/currency';
import { Link } from 'react-router-dom';
import { useCurrencySettings } from '../../hooks/useCurrency';
import { ConfirmModal } from '../ui/ConfirmModal';
import { IS_DEMO } from '../../demo/isDemo';
import { SIDEBAR_DEFAULT_WIDTH } from '../../utils/sidebarWidth';
import { formatDay } from '../../utils/dates';

const themeOptions: Theme[] = ['light', 'dark', 'system'];

const sidebarModes = [
  { value: 'persistent', id: 'pinned' },
  { value: 'auto-hide', id: 'autoHide' },
] as const satisfies { value: SidebarMode; id: string }[];

// Shown as written; each with 5 January 2026 as an example
const dateFormats: DateFormatOption[] = [
  'MMM d, yyyy',
  'MM/dd/yyyy',
  'dd/MM/yyyy',
  'dd.MM.yyyy',
  'yyyy-MM-dd',
];

const amountFormats: (AmountFormat | 'auto')[] = ['auto', 'dot', 'comma', 'space', 'apostrophe'];

const symbolPositions: (SymbolPosition | 'auto')[] = ['auto', 'before', 'after'];

/** 1,234.56 in a format, without a symbol */
const numberExample = (format: AmountFormat) =>
  formatAmount(123_456, { format, position: 'before', symbol: '' });

const choiceClass = (selected: boolean) =>
  `flex items-center justify-between gap-2 px-3 py-1.5 text-sm rounded-md border transition-colors max-md:min-h-11 tabular-nums ${
    selected
      ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
      : 'border-border bg-surface text-text-secondary hover:border-border'
  }`;

// Changing the language draws the app again (LanguageRoot), so the select it was chosen in is a
// new element: this puts the focus back on it
let refocusLanguage = false;

/** Only when there's more than one language to choose from */
function LanguageSetting() {
  const { t } = useTranslation();
  const language = usePreferencesStore((s) => s.language);
  const setLanguage = usePreferencesStore((s) => s.setLanguage);
  const languages = availableLanguages();
  if (languages.length < 2) return null;
  const automatic = languageInfo(resolveLanguage('auto', deviceLanguages())).name;

  return (
    <div className="bg-surface-alt rounded-lg p-5 space-y-3">
      <h3 id="language-heading" className="text-sm font-medium text-text">
        {t('settings.preferences.language.title')}
      </h3>
      <select
        ref={(el) => {
          if (el && refocusLanguage) {
            refocusLanguage = false;
            el.focus();
          }
        }}
        value={language}
        onChange={(e) => {
          refocusLanguage = true;
          setLanguage(e.target.value as LanguagePreference);
        }}
        aria-labelledby="language-heading"
        aria-describedby="language-hint"
        className="block w-full sm:w-72 rounded-lg border border-border bg-surface px-3 py-2 max-md:min-h-11 text-sm text-text focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        <option value="auto">
          {t('settings.preferences.language.automatic', { language: automatic })}
        </option>
        {languages.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
      <p id="language-hint" className="text-xs text-text-tertiary">
        {t('settings.preferences.language.hint')}
      </p>
    </div>
  );
}

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
    setSidebarWidth,
    setShowMerchantIcons,
    setShowCategoryIcons,
    setShowAccountIcons,
    setLanguage,
  } = usePreferencesStore();
  const { t } = useTranslation();
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
    setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    setCurrencySymbol('$');
    setAmountFormat('auto');
    setSymbolPosition('auto');
    setDateFormat('MMM d, yyyy');
    setShowMerchantIcons(true);
    setShowCategoryIcons(true);
    setShowAccountIcons(true);
    setLanguage('auto');
    setResetOpen(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text">{t('settings.preferences.title')}</h2>
          <p className="text-xs text-text-tertiary mt-0.5">
            {t(IS_DEMO ? 'settings.preferences.savedDemo' : 'settings.preferences.saved')}
          </p>
        </div>
        <button
          onClick={() => setResetOpen(true)}
          className="text-xs text-text-tertiary hover:text-text-secondary transition-colors"
        >
          {t('settings.preferences.reset.button')}
        </button>
      </div>

      <ConfirmModal
        isOpen={resetOpen}
        onClose={() => setResetOpen(false)}
        onConfirm={handleReset}
        title={t('settings.preferences.reset.title')}
        message={t('settings.preferences.reset.message')}
        confirmLabel={t('settings.preferences.reset.confirm')}
        danger
      />

      <LanguageSetting />

      <div className="bg-surface-alt rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-medium text-text">{t('settings.preferences.theme.title')}</h3>
        <div className="flex gap-3">
          {themeOptions.map((opt) => (
            <button
              key={opt}
              onClick={() => setTheme(opt)}
              className={`px-4 py-2 text-sm rounded-md border transition-colors ${
                theme === opt
                  ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                  : 'border-border bg-surface text-text-secondary hover:border-border'
              }`}
            >
              {t(`settings.preferences.theme.${opt}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-surface-alt rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-medium text-text">{t('settings.preferences.sidebar.title')}</h3>
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
              <span>{t(`settings.preferences.sidebar.${opt.id}`)}</span>
              <span className="text-xs text-text-tertiary font-normal mt-0.5">
                {t(`settings.preferences.sidebar.${opt.id}Hint`)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-surface-alt rounded-lg p-5 space-y-5">
        <h3 className="text-sm font-medium text-text">{t('settings.preferences.icons.title')}</h3>
        {(
          [
            { id: 'merchant', value: showMerchantIcons, setter: setShowMerchantIcons },
            { id: 'category', value: showCategoryIcons, setter: setShowCategoryIcons },
            { id: 'account', value: showAccountIcons, setter: setShowAccountIcons },
          ] as const
        ).map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-sm text-text">{t(`settings.preferences.icons.${row.id}`)}</div>
              <div className="text-xs text-text-tertiary mt-0.5">
                {t(`settings.preferences.icons.${row.id}Hint`)}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {[
                { v: true, l: t('settings.preferences.icons.show') },
                { v: false, l: t('settings.preferences.icons.hide') },
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
            {t('settings.preferences.amounts.title')}
          </h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            {t('settings.preferences.amounts.hint')}
          </p>
        </div>

        <div
          className="space-y-2"
          role="group"
          aria-label={t('settings.preferences.amounts.numberFormat')}
        >
          <div className="text-xs font-medium text-text-secondary">
            {t('settings.preferences.amounts.numberFormat')}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {amountFormats.map((opt) => (
              <button
                key={opt}
                type="button"
                aria-pressed={amountFormat === opt}
                aria-label={
                  opt === 'auto' ? t('settings.preferences.amounts.automatic') : numberExample(opt)
                }
                onClick={() => setAmountFormat(opt)}
                className={choiceClass(amountFormat === opt)}
              >
                <span>
                  {opt === 'auto'
                    ? t('settings.preferences.amounts.automatic')
                    : numberExample(opt)}
                </span>
                {opt === 'auto' && (
                  <span className="text-xs text-text-tertiary">{numberExample(auto.format)}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div
          className="space-y-2"
          role="group"
          aria-label={t('settings.preferences.amounts.symbolPosition')}
        >
          <div className="text-xs font-medium text-text-secondary">
            {budgetCurrency
              ? t('settings.preferences.amounts.currencySymbolFor', { currency: budgetCurrency })
              : t('settings.preferences.amounts.currencySymbol')}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!budgetCurrency && (
              <input
                type="text"
                aria-label={t('settings.preferences.amounts.currencySymbol')}
                value={currencySymbol}
                onChange={(e) => setCurrencySymbol(e.target.value.slice(0, 3))}
                maxLength={3}
                className="w-20 text-center text-sm border border-border rounded-md px-3 py-1.5 max-md:min-h-11 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
              />
            )}
            {symbolPositions.map((opt) => (
              <button
                key={opt}
                type="button"
                aria-pressed={symbolPosition === opt}
                onClick={() => setSymbolPosition(opt)}
                className={choiceClass(symbolPosition === opt)}
              >
                {t(`settings.preferences.amounts.position.${opt}`)}
              </button>
            ))}
          </div>
          <p className="text-xs text-text-tertiary">
            <Trans
              i18nKey={
                budgetCurrency
                  ? 'settings.preferences.amounts.automaticHint'
                  : 'settings.preferences.amounts.symbolHint'
              }
              values={{ currency: budgetCurrency }}
              components={{
                currencies: (
                  <Link to="/settings?tab=currencies" className="underline hover:no-underline" />
                ),
              }}
            />
          </p>
        </div>

        <p className="text-sm text-text-secondary">
          {t('settings.preferences.amounts.example')}{' '}
          <span className="font-medium text-text tabular-nums">{example}</span>
          {otherExamples.map((e) => (
            <span key={e} className="font-medium text-text tabular-nums">
              {' · '}
              {e}
            </span>
          ))}
        </p>
      </section>

      <div className="bg-surface-alt rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-medium text-text">
          {t('settings.preferences.dateFormat.title')}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {dateFormats.map((opt) => (
            <button
              key={opt}
              onClick={() => setDateFormat(opt)}
              className={`flex items-center justify-between px-4 py-2.5 text-sm rounded-md border transition-colors ${
                dateFormat === opt
                  ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                  : 'border-border bg-surface text-text-secondary hover:border-border'
              }`}
            >
              <span>{opt}</span>
              <span className="text-xs text-text-tertiary">{formatDay('2026-01-05', opt)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
