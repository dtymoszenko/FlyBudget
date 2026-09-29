import { useState } from 'react';
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
  const [name, setName] = useState(initialName);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) onSave(name.trim());
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isUpdating ? 'Update Report' : 'Save Report'}
      size="sm"
    >
      <form onSubmit={handleSubmit}>
        <label className="block text-sm font-medium text-text-secondary mb-1">Report Name</label>
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Monthly Spending by Payee"
          aria-label="Report name"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim()}>
            {isUpdating ? 'Update' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
