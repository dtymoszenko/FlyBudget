import { useSearchParams } from 'react-router-dom';
import { Layers, ArrowUpDown, Download, SlidersHorizontal, Link2, Server } from 'lucide-react';
import { ServerSettings } from '../components/settings/ServerSettings';
import { CategoryManager } from '../components/settings/CategoryManager';
import { AccountReorder } from '../components/settings/AccountReorder';
import { DataExport } from '../components/settings/DataExport';
import { PreferencesPanel } from '../components/settings/PreferencesPanel';
import { ConnectedAccounts } from '../components/settings/ConnectedAccounts';
import { LICENSE_URL, SOURCE_CODE_URL } from '../utils/project';

const tabs = [
  { id: 'categories', label: 'Categories', icon: Layers },
  { id: 'accounts', label: 'Accounts', icon: ArrowUpDown },
  { id: 'connections', label: 'Connected Banks', icon: Link2 },
  { id: 'data', label: 'Data', icon: Download },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  // Where the data lives; on a self-hosted server also security, devices and password
  { id: 'server', label: 'Server', icon: Server },
] as const;

type TabId = (typeof tabs)[number]['id'];

const tabIds = new Set<string>(tabs.map((t) => t.id));

export default function SettingsPage() {
  // The tab lives in the URL (?tab=server), so links like the sidebar's "Server settings"
  // can open it
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabId = tabParam && tabIds.has(tabParam) ? (tabParam as TabId) : 'categories';
  const setActiveTab = (tab: TabId) => setSearchParams({ tab }, { replace: true });

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold text-text">Settings</h1>
        <div className="flex gap-0 mt-3 border-b border-border-light -mb-px">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  isActive
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-text-tertiary hover:text-text-secondary'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-2xl">
          {activeTab === 'categories' && <CategoryManager />}
          {activeTab === 'accounts' && <AccountReorder />}
          {activeTab === 'connections' && <ConnectedAccounts />}
          {activeTab === 'data' && <DataExport />}
          {activeTab === 'preferences' && <PreferencesPanel />}
          {activeTab === 'server' && <ServerSettings onOpenTab={setActiveTab} />}

          <p className="mt-10 pt-4 border-t border-border-light text-xs text-text-tertiary">
            FlyBudget is free software under the{' '}
            <a
              href={LICENSE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-text-secondary"
            >
              GNU AGPL v3
            </a>
            .{' '}
            <a
              href={SOURCE_CODE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-text-secondary"
            >
              Source code
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
