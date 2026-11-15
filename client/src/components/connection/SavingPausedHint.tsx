import { useTranslation } from 'react-i18next';
import { useCanSave } from '../../hooks/useConnection';
import { useCanAddTransaction } from '../../hooks/useOffline';

/** Explains a disabled save button while FlyBudget can't reach its server. */
export function SavingPausedHint({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const canSave = useCanSave();
  if (canSave) return null;
  return <p className={`text-xs text-caution ${className}`}>{t('connection.savingPaused')}</p>;
}

/** Next to "add transaction" buttons: offline, a new transaction waits on this device. */
export function SavedOnDeviceHint({ className = '' }: { className?: string }) {
  const { t } = useTranslation();
  const { allowed, onDevice } = useCanAddTransaction();
  if (!onDevice) return null;
  if (!allowed) return <SavingPausedHint className={className} />;
  return <p className={`text-xs text-caution ${className}`}>{t('connection.savedOnDevice')}</p>;
}
