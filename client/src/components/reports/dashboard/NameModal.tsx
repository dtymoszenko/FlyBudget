import { useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Input } from '../../ui/Input';
import { Button } from '../../ui/Button';

interface Props {
  title: string;
  label: string;
  initialName?: string;
  placeholder?: string;
  submitLabel: string;
  onClose: () => void;
  onSave: (name: string) => void;
  isOpen?: boolean;
}

/** Asks for a name (dashboard or widget title). Mount it only while open so it starts fresh. */
export default function NameModal({
  title,
  label,
  initialName = '',
  placeholder,
  submitLabel,
  onClose,
  onSave,
  isOpen = true,
}: Props) {
  const [name, setName] = useState(initialName);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim()) onSave(name.trim());
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="sm">
      <form onSubmit={handleSubmit}>
        <label className="block text-sm font-medium text-text-secondary mb-1">{label}</label>
        <Input
          type="text"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          placeholder={placeholder}
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!name.trim()}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
