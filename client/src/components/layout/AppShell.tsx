import { Navigate, Outlet } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAccounts } from '../../hooks/useAccounts';
import { useAppStore } from '../../store/appStore';
import { useUndoKeyboard } from '../../hooks/useUndoKeyboard';
import { UndoToast } from '../ui/UndoToast';
import { ConnectionBanner } from '../connection/ConnectionBanner';
import { Sidebar } from './Sidebar';

export function AppShell() {
  useUndoKeyboard();
  const { data: accounts = [], isLoading } = useAccounts();
  const setupSkipped = useAppStore((s) => s.setupSkipped);

  if (isLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-page">
        <Loader2 size={32} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (accounts.length === 0 && !setupSkipped) {
    return <Navigate to="/welcome" replace />;
  }

  return (
    <div className="flex h-screen bg-page overflow-hidden">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <ConnectionBanner />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <UndoToast />
    </div>
  );
}
