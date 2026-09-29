// ui-only state — selected month, active account
import { create } from 'zustand';
import { format } from 'date-fns';

interface AppState {
  selectedMonth: string;
  activeAccountId: string | null;
  setSelectedMonth: (month: string) => void;
  setActiveAccountId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedMonth: format(new Date(), 'yyyy-MM'),
  activeAccountId: null,
  setSelectedMonth: (selectedMonth) => set({ selectedMonth }),
  setActiveAccountId: (activeAccountId) => set({ activeAccountId }),
}));
