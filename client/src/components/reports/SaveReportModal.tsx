import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  initialName?: string;
  isUpdating?: boolean;
}

export default function SaveReportModal({
  isOpen,
  onClose,
  onSave,
  initialName = '',
  isUpdating,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) onSave(name.trim());
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isUpdating ? t('reports.saved.modal.update') : t('reports.saved.modal.save')}
      size="sm"
    >
      <form onSubmit={handleSubmit}>
        <label className="block text-sm font-medium text-text-secondary mb-1">
          {t('reports.saved.modal.name')}
        </label>
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('reports.saved.modal.placeholder')}
          aria-label={t('reports.saved.modal.nameLabel')}
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.actions.cancel')}
          </Button>
          <Button type="submit" disabled={!name.trim()}>
            {isUpdating ? t('reports.saved.modal.updateButton') : t('common.actions.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
