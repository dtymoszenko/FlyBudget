import { BrowserRouter, HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { AuthGate } from './components/auth/AuthGate';
import { IS_DEMO } from './demo/demoApi';
import WelcomePage from './pages/Welcome';
import DashboardPage from './pages/Dashboard';
import AccountsPage from './pages/Accounts';
import AccountTransactionsPage from './pages/AccountTransactions';
import BudgetPage from './pages/Budget';
import TransactionsPage from './pages/Transactions';
import ReportsPage from './pages/Reports';
import CustomReportBuilder from './pages/CustomReportBuilder';
import ReportWidgetView from './pages/ReportWidgetView';
import PayeesPage from './pages/Payees';
import RulesPage from './pages/Rules';
import ReconcilePage from './pages/ReconcilePage';
import RecurringTransactionsPage from './pages/RecurringTransactions';
import SettingsPage from './pages/Settings';
import GoalsPage from './pages/Goals';
import CashFlowPage from './pages/CashFlow';
import CategoryDetailPage from './pages/CategoryDetail';

// electron loads via file:// and the demo is a static page under /demo/ on the website, so
// both use hash routing
const isElectron = Boolean((window as any).__API_BASE__);
const Router = isElectron || IS_DEMO ? HashRouter : BrowserRouter;

export default function App() {
  return (
    <AuthGate>
      <Router>
        <Routes>
          <Route path="/welcome" element={<WelcomePage />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/budget" element={<BudgetPage />} />
            <Route path="/budget/category/:id" element={<CategoryDetailPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/accounts/:id/reconcile" element={<ReconcilePage />} />
            <Route path="/accounts/:id" element={<AccountTransactionsPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/recurring" element={<RecurringTransactionsPage />} />
            <Route path="/cash-flow" element={<CashFlowPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reports/custom" element={<CustomReportBuilder />} />
            <Route path="/reports/custom/:id" element={<CustomReportBuilder />} />
            <Route path="/reports/widget/:id" element={<ReportWidgetView />} />
            <Route path="/payees" element={<PayeesPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/goals" element={<GoalsPage />} />
          </Route>
        </Routes>
      </Router>
    </AuthGate>
  );
}
