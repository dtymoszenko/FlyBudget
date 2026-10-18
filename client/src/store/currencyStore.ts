import { create } from 'zustand';

/**
 * The budget's currency (ISO 4217), as the server last said (GET /api/currency, kept up to
 * date by useBudgetCurrency). Null while none is chosen: amounts then show the device's
 * symbol preference, as before currencies existed. Kept here, outside TanStack Query, so the
 * one-argument formatters (formatCurrency, used as chart callbacks) can read it.
 */
interface CurrencyState {
  budgetCurrency: string | null;
  setBudgetCurrency: (currency: string | null) => void;
}

export const useCurrencyStore = create<CurrencyState>()((set) => ({
  budgetCurrency: null,
  setBudgetCurrency: (budgetCurrency) => set({ budgetCurrency }),
}));
