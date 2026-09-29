// ui-only state — selected month, sidebar, active account
import { create } from 'zustand';
import { format } from 'date-fns';

interface AppState {
  selectedMonth: string;
  sidebarCollapsed: boolean;
  activeAccountId: string | null;
  setSelectedMonth: (month: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActiveAccountId: (id: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedMonth: format(new Date(), 'yyyy-MM'),
  sidebarCollapsed: false,
  activeAccountId: null,
  setSelectedMonth: (selectedMonth) => set({ selectedMonth }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setActiveAccountId: (activeAccountId) => set({ activeAccountId }),
}));
