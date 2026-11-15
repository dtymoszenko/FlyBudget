import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { PencilLine, Loader2, ShieldCheck, ChevronRight, Clock, Euro } from 'lucide-react';
import logoUrl from '/logo.png';
import { useAccounts } from '../hooks/useAccounts';
import { usePlaidStatus } from '../hooks/usePlaid';
import { useAppMode } from '../hooks/useServer';
import { usePreferencesStore } from '../store/preferencesStore';
import { AddAccountModal } from '../components/accounts/AddAccountModal';
import { ConnectBankModal } from '../components/plaid/ConnectBankModal';
import { PlaidSetupModal } from '../components/plaid/PlaidSetupModal';
import { SimplefinConnectModal } from '../components/simplefin/SimplefinConnectModal';
import { ConnectEnableBankingModal } from '../components/enablebanking/ConnectEnableBankingModal';
import { HelpFooter } from '../components/layout/HelpFooter';
import { ExternalLink } from '../components/ui/ExternalLink';
import { PlaidLogo, SimplefinLogo } from '../components/ui/BankLogos';
import { BrandName } from '../components/ui/BrandName';
import { docsUrl } from '../utils/project';

interface OptionProps {
  icon: React.ReactNode;
  /** Its texts: a title, a tag (what it costs or involves), roughly how long setup takes,
   * what it does and the button */
  option: 'plaid' | 'simplefin' | 'europe' | 'manual';
  onClick: () => void;
}

/** One way to add accounts. All of them look alike: none is pushed over the others. */
function SetupOption({ icon, option, onClick }: OptionProps) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col bg-surface border-2 border-border hover:border-brand-500 rounded-xl p-5 text-left transition-all duration-200 hover:shadow-hover"
    >
      <span
        aria-hidden
        className="w-11 h-11 rounded-lg flex items-center justify-center mb-4 bg-surface border border-border-light"
      >
        {icon}
      </span>
      <span className="text-sm font-semibold text-text">
        {t(`welcome.options.${option}.title`)}
      </span>
      <span className="flex flex-wrap items-center gap-1.5 mt-1.5">
        <span className="bg-surface-alt text-text-secondary text-[11px] font-medium px-2 py-0.5 rounded-md">
          {t(`welcome.options.${option}.tag`)}
        </span>
        <span className="inline-flex items-center gap-1 bg-surface-alt text-text-secondary text-[11px] font-medium px-2 py-0.5 rounded-md">
          <Clock size={11} aria-hidden />
          <span className="sr-only">{t('welcome.setupTime')}</span>{' '}
          {t(`welcome.options.${option}.time`)}
        </span>
      </span>
      <span className="text-xs text-text-tertiary mt-2 leading-relaxed flex-1">
        {t(`welcome.options.${option}.description`)}
      </span>
      <span className="mt-3 inline-flex items-center gap-0.5 text-xs font-medium text-brand-600 group-hover:text-brand-700">
        {t(`welcome.options.${option}.action`)} <ChevronRight size={13} aria-hidden />
      </span>
    </button>
  );
}

export default function WelcomePage() {
  const { t } = useTranslation();
  const { data: accounts = [], isLoading } = useAccounts();
  const { data: plaidStatus } = usePlaidStatus();
  const plaidConfigured = plaidStatus?.configured ?? false;
  const setSetupSkipped = usePreferencesStore((s) => s.setSetupSkipped);
  const mode = useAppMode();
  const navigate = useNavigate();

  const [showPlaid, setShowPlaid] = useState(false);
  const [showPlaidSetup, setShowPlaidSetup] = useState(false);
  const [showSimplefin, setShowSimplefin] = useState(false);
  const [showEnableBanking, setShowEnableBanking] = useState(false);
  const [showManual, setShowManual] = useState(false);

  if (isLoading) {
    return (
      <div className="h-dvh flex items-center justify-center bg-page">
        <Loader2 size={32} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (accounts.length > 0) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="h-dvh overflow-y-auto bg-page">
      <div className="min-h-full flex flex-col items-center px-4 sm:px-6">
        <main className="flex-1 w-full max-w-3xl flex flex-col justify-center py-10 text-center">
          <img src={logoUrl} alt="" className="w-20 h-20 mx-auto mb-5" />

          <h1 className="text-2xl sm:text-3xl font-semibold text-text tracking-tight">
            <Trans i18nKey="welcome.title" components={{ brand: <BrandName /> }} />
          </h1>
          <p className="text-sm sm:text-base text-text-secondary mt-2 max-w-lg mx-auto">
            {t('welcome.intro')}
          </p>

          <div className="grid gap-4 mt-8 grid-cols-1 sm:grid-cols-2">
            <SetupOption
              icon={<PlaidLogo size={24} className="text-text" />}
              option="plaid"
              onClick={() => (plaidConfigured ? setShowPlaid(true) : setShowPlaidSetup(true))}
            />
            <SetupOption
              icon={<SimplefinLogo size={26} />}
              option="simplefin"
              onClick={() => setShowSimplefin(true)}
            />
            <SetupOption
              icon={<Euro size={20} className="text-brand-600" />}
              option="europe"
              onClick={() => setShowEnableBanking(true)}
            />
            <SetupOption
              icon={<PencilLine size={20} className="text-text-secondary" />}
              option="manual"
              onClick={() => setShowManual(true)}
            />
          </div>

          <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-text-tertiary">
            <ShieldCheck size={14} className="text-positive shrink-0" aria-hidden />
            {t(mode === 'server' ? 'welcome.privacyServer' : 'welcome.privacyLocal')}{' '}
            <ExternalLink
              href={docsUrl('bank-sync')}
              className="font-medium text-brand-600 hover:text-brand-700"
            >
              {t('welcome.compare')}
            </ExternalLink>
          </p>

          <button
            onClick={() => {
              setSetupSkipped(true);
              navigate('/dashboard');
            }}
            className="mt-6 mx-auto text-sm text-text-tertiary hover:text-text-secondary underline-offset-4 hover:underline transition-colors max-md:min-h-11"
          >
            {t('welcome.skip')}
          </button>
        </main>

        <HelpFooter className="w-full border-t border-border-light" />
      </div>

      <ConnectBankModal isOpen={showPlaid} onClose={() => setShowPlaid(false)} />
      <PlaidSetupModal
        isOpen={showPlaidSetup}
        onClose={() => setShowPlaidSetup(false)}
        onConfigured={() => setShowPlaid(true)}
      />
      <SimplefinConnectModal isOpen={showSimplefin} onClose={() => setShowSimplefin(false)} />
      <ConnectEnableBankingModal
        isOpen={showEnableBanking}
        onClose={() => setShowEnableBanking(false)}
      />
      <AddAccountModal isOpen={showManual} onClose={() => setShowManual(false)} />
    </div>
  );
}
