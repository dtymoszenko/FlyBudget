import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { IS_DEMO } from '../demo/isDemo';

export type Theme = 'light' | 'dark' | 'system';
export type DateFormatOption =
  'MMM d, yyyy' | 'MM/dd/yyyy' | 'dd/MM/yyyy' | 'dd.MM.yyyy' | 'yyyy-MM-dd';
/** How amounts are written: 1,234.56 / 1.234,56 / 1 234,56 / 1'234.56 */
export type AmountFormat = 'dot' | 'comma' | 'space' | 'apostrophe';
/** Whether the currency symbol goes before (€12.50) or after (12,50 €) the amount */
export type SymbolPosition = 'before' | 'after';
export type SidebarMode = 'persistent' | 'auto-hide';
/** How one currency's amounts are shown, when its own convention isn't wanted */
export interface CurrencyDisplay {
  position?: SymbolPosition;
  /** Shown instead of the usual symbol ("zł", "USD", "US$") */
  symbol?: string;
}

interface PreferencesState {
  theme: Theme;
  currencySymbol: string;
  /** 'auto' = as the device's language writes amounts */
  amountFormat: AmountFormat | 'auto';
  /**
   * Where the budget currency's symbol goes; 'auto' = as that currency is written (12,50 zł,
   * $12.50). Other currencies follow their own convention unless set in currencyStyles.
   */
  symbolPosition: SymbolPosition | 'auto';
  /** Per currency (ISO code): its symbol or position on this device */
  currencyStyles: Record<string, CurrencyDisplay>;
  dateFormat: DateFormatOption;
  savingsGoal: number;
  sidebarMode: SidebarMode;
  showMerchantIcons: boolean;
  showCategoryIcons: boolean;
  showAccountIcons: boolean;
  /** Actual Budget-style upcoming window token: '1' | '7' | '14' | 'oneMonth' | 'currentMonth' | '<n>-<day|week|month|year>' */
  upcomingLength: string;
  /** Keep a copy of the budget on this device, to open it when the server can't be reached */
  keepOfflineCopy: boolean;
  /** "Skip for now" on the welcome screen: open the app even with no accounts */
  setupSkipped: boolean;
  /** The getting started checklist on the dashboard was hidden */
  gettingStartedHidden: boolean;
  setTheme: (theme: Theme) => void;
  setCurrencySymbol: (symbol: string) => void;
  setAmountFormat: (format: AmountFormat | 'auto') => void;
  setSymbolPosition: (position: SymbolPosition | 'auto') => void;
  /** Null goes back to the currency's own convention */
  setCurrencyStyle: (currency: string, style: CurrencyDisplay | null) => void;
  setDateFormat: (format: DateFormatOption) => void;
  setSavingsGoal: (goal: number) => void;
  setSidebarMode: (mode: SidebarMode) => void;
  setShowMerchantIcons: (show: boolean) => void;
  setShowCategoryIcons: (show: boolean) => void;
  setShowAccountIcons: (show: boolean) => void;
  setUpcomingLength: (length: string) => void;
  setKeepOfflineCopy: (keep: boolean) => void;
  setSetupSkipped: (skipped: boolean) => void;
  setGettingStartedHidden: (hidden: boolean) => void;
}

const PREFERENCES_KEY = 'budget-preferences';

/** 1: amount format and symbol position (Automatic for new installs) */
export const PREFERENCES_VERSION = 1;

/**
 * Preferences saved by an older version, brought up to date. Installs from before the amount
 * format existed keep 1,234.56 with the symbol first, as they had: switching them to their
 * device's language (Automatic, the default for new installs) would change every amount on
 * screen and the CSV files their spreadsheets expect, without them asking.
 */
export function migratePreferences(persisted: unknown, version: number): unknown {
  const state = persisted && typeof persisted === 'object' ? { ...persisted } : {};
  if (version < 1) {
    Object.assign(state, { amountFormat: 'dot', symbolPosition: 'before' });
  }
  return state;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: 'light',
      currencySymbol: '$',
      amountFormat: 'auto',
      symbolPosition: 'auto',
      currencyStyles: {},
      dateFormat: 'MMM d, yyyy',
      savingsGoal: 20,
      sidebarMode: 'persistent',
      showMerchantIcons: true,
      showCategoryIcons: true,
      showAccountIcons: true,
      upcomingLength: '7',
      keepOfflineCopy: true,
      setupSkipped: false,
      gettingStartedHidden: false,
      setTheme: (theme) => set({ theme }),
      setCurrencySymbol: (currencySymbol) => set({ currencySymbol }),
      setAmountFormat: (amountFormat) => set({ amountFormat }),
      setSymbolPosition: (symbolPosition) => set({ symbolPosition }),
      setCurrencyStyle: (currency, style) =>
        set((s) => {
          const next = { ...s.currencyStyles };
          if (style && (style.position || style.symbol)) next[currency] = style;
          else delete next[currency];
          return { currencyStyles: next };
        }),
      setDateFormat: (dateFormat) => set({ dateFormat }),
      setSavingsGoal: (savingsGoal) => set({ savingsGoal }),
      setSidebarMode: (sidebarMode) => set({ sidebarMode }),
      setShowMerchantIcons: (showMerchantIcons) => set({ showMerchantIcons }),
      setShowCategoryIcons: (showCategoryIcons) => set({ showCategoryIcons }),
      setShowAccountIcons: (showAccountIcons) => set({ showAccountIcons }),
      setUpcomingLength: (upcomingLength) => set({ upcomingLength }),
      setKeepOfflineCopy: (keepOfflineCopy) => set({ keepOfflineCopy }),
      setSetupSkipped: (setupSkipped) => set({ setupSkipped }),
      setGettingStartedHidden: (gettingStartedHidden) => set({ gettingStartedHidden }),
    }),
    {
      name: PREFERENCES_KEY,
      // The demo (website "Try the demo") shares the website's storage: keep its preferences
      // in this tab only, so they're gone with the demo budget when the tab closes
      storage: createJSONStorage(() => (IS_DEMO ? sessionStorage : localStorage)),
      version: PREFERENCES_VERSION,
      migrate: (persisted, version) => migratePreferences(persisted, version) as PreferencesState,
    },
  ),
);

/** Back to the defaults (the demo's "Start over"). */
export function resetPreferences() {
  usePreferencesStore.setState(usePreferencesStore.getInitialState(), true);
}
