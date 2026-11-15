import { Download, Landmark } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { DOWNLOAD_URL } from './DemoBanner';

/** Shown in the demo instead of bank connection setup (see ConnectedAccounts). */
export function NotInDemo() {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 p-4 rounded-lg border border-border-light bg-surface-alt">
      <Landmark size={20} className="text-brand-600 shrink-0 mt-0.5" aria-hidden />
      <div className="text-sm">
        <p className="font-medium text-text">{t('demo.notAvailable.title')}</p>
        <p className="text-text-secondary mt-1 leading-relaxed">{t('demo.notAvailable.banks')}</p>
        <a
          href={DOWNLOAD_URL}
          className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 max-md:min-h-11 text-xs font-medium rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors"
        >
          <Download size={12} aria-hidden /> {t('demo.download')}
        </a>
      </div>
    </div>
  );
}

/** The bank connection dialogs, in the demo (they open from the sidebar and first-run screen). */
export function NotInDemoModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('demo.notAvailable.connectBank')} size="sm">
      <p className="text-sm text-text-secondary leading-relaxed">{t('demo.notAvailable.banks')}</p>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>
          {t('common.actions.close')}
        </Button>
        <a
          href={DOWNLOAD_URL}
          className="inline-flex items-center gap-1.5 px-4 py-2 max-md:min-h-11 text-sm font-medium rounded-md bg-brand-600 text-white hover:bg-brand-700 transition-colors"
        >
          <Download size={14} aria-hidden /> {t('demo.download')}
        </a>
      </div>
    </Modal>
  );
}
