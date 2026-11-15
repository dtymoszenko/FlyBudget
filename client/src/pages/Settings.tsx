import { useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import {
  Layers,
  ArrowUpDown,
  Coins,
  Download,
  SlidersHorizontal,
  Link2,
  Server,
} from 'lucide-react';
import { ServerSettings } from '../components/settings/ServerSettings';
import { CategoryManager } from '../components/settings/CategoryManager';
import { AccountReorder } from '../components/settings/AccountReorder';
import { DataExport } from '../components/settings/DataExport';
import { PreferencesPanel } from '../components/settings/PreferencesPanel';
import { CurrencySettings } from '../components/settings/CurrencySettings';
import { ConnectedAccounts } from '../components/settings/ConnectedAccounts';
import { LICENSE_URL, SOURCE_CODE_URL } from '../utils/project';

const tabs = [
  { id: 'categories', icon: Layers },
  { id: 'accounts', icon: ArrowUpDown },
  { id: 'connections', icon: Link2 },
  // The budget's currency, exchange rates and how each currency is written
  { id: 'currencies', icon: Coins },
  { id: 'data', icon: Download },
  { id: 'preferences', icon: SlidersHorizontal },
  // Where the data lives; on a self-hosted server also security, devices and password
  { id: 'server', icon: Server },
] as const;

type TabId = (typeof tabs)[number]['id'];

const tabIds = new Set<string>(tabs.map((tab) => tab.id));

export default function SettingsPage() {
  const { t } = useTranslation();
  // The tab lives in the URL (?tab=server), so links like the sidebar's "Server settings"
  // can open it
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: TabId = tabParam && tabIds.has(tabParam) ? (tabParam as TabId) : 'categories';
  const setActiveTab = (tab: TabId) => setSearchParams({ tab }, { replace: true });

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-6 py-4 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold text-text">{t('settings.title')}</h1>
        <div className="flex gap-0 mt-3 border-b border-border-light -mb-px overflow-x-auto [scrollbar-width:none]">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors border-b-2 -mb-px ${
                  isActive
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-text-tertiary hover:text-text-secondary'
                }`}
              >
                <Icon size={14} />
                {t(`settings.tabs.${tab.id}`)}
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
          {activeTab === 'currencies' && <CurrencySettings />}
          {activeTab === 'data' && <DataExport />}
          {activeTab === 'preferences' && <PreferencesPanel />}
          {activeTab === 'server' && <ServerSettings onOpenTab={setActiveTab} />}

          <p className="mt-10 pt-4 border-t border-border-light text-xs text-text-tertiary">
            <Trans
              i18nKey="settings.footer"
              components={{
                license: (
                  <a
                    href={LICENSE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-text-secondary"
                  />
                ),
                repo: (
                  <a
                    href={SOURCE_CODE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-text-secondary"
                  />
                ),
              }}
            />
          </p>
        </div>
      </div>
    </div>
  );
}
