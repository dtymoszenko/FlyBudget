import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Button } from './Button';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  danger = false,
}: Props) {
  const { t } = useTranslation();
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-text-secondary">{message}</p>
      <div className="flex justify-end gap-3 mt-6">
        <Button variant="secondary" onClick={onClose}>
          {t('common.actions.cancel')}
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel ?? t('common.actions.confirm')}
        </Button>
      </div>
    </Modal>
  );
}
