import { ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';

/** Shown while the user finishes connecting their bank on Plaid's page in their browser. */
export function HostedLinkWaiting({
  onReopen,
  onCancel,
}: {
  onReopen: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="text-center space-y-4 py-2">
      <Loader2 size={28} className="animate-spin text-brand-600 mx-auto" />
      <div>
        <h3 className="text-sm font-semibold text-text">{t('banks.plaid.waiting.title')}</h3>
        <p className="text-xs text-text-secondary mt-1 max-w-sm mx-auto leading-relaxed">
          {t('banks.plaid.waiting.hint')}
        </p>
      </div>
      <p className="inline-flex items-center gap-1.5 text-[11px] text-text-tertiary">
        <ShieldCheck size={12} /> {t('banks.plaid.waiting.secure')}
      </p>
      <div className="flex justify-center gap-2">
        <Button variant="secondary" onClick={onReopen}>
          <ExternalLink size={14} /> {t('banks.plaid.waiting.reopen')}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {t('common.actions.cancel')}
        </Button>
      </div>
    </div>
  );
}
