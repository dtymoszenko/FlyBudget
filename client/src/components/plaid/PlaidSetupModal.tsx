import { useState } from 'react';
import { KeyRound, Loader2, CheckCircle2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { PlaidEnvironmentSelect, type PlaidEnvironment } from './PlaidEnvironmentSelect';
import { useConfigurePlaid } from '../../hooks/usePlaid';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfigured: () => void;
}

export function PlaidSetupModal({ isOpen, onClose, onConfigured }: Props) {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [environment, setEnvironment] = useState<PlaidEnvironment>('production');
  const [done, setDone] = useState(false);
  const configure = useConfigurePlaid();

  async function handleSubmit() {
    if (!clientId.trim() || !secret.trim()) return;
    try {
      await configure.mutateAsync({
        clientId: clientId.trim(),
        secret: secret.trim(),
        environment,
      });
      setDone(true);
    } catch {
      // Error handled by mutation state
    }
  }

  function handleClose() {
    setClientId('');
    setSecret('');
    setDone(false);
    onClose();
  }

  function handleContinue() {
    handleClose();
    onConfigured();
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Connect via Plaid" size="lg">
      {!done ? (
        <div className="space-y-5">
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-lg bg-brand-50 flex items-center justify-center mx-auto mb-4">
              <KeyRound size={32} className="text-brand-600" />
            </div>
            <h3 className="text-sm font-semibold text-text">Connect with Plaid</h3>
            <p className="text-xs text-text-secondary mt-2 max-w-sm mx-auto leading-relaxed">
              Create a free{' '}
              <a
                href="https://dashboard.plaid.com/signup"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 underline"
              >
                Plaid developer account
              </a>{' '}
              to get your API credentials, then enter them below.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-tertiary mb-1">Client ID</label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Enter your Plaid Client ID"
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-tertiary mb-1">Secret</label>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="Enter your Plaid Secret"
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
              />
            </div>
            <PlaidEnvironmentSelect value={environment} onChange={setEnvironment} />
            <div className="flex justify-center">
              <Button
                onClick={handleSubmit}
                disabled={!clientId.trim() || !secret.trim() || configure.isPending}
              >
                {configure.isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Saving...
                  </>
                ) : (
                  'Save Credentials'
                )}
              </Button>
            </div>
          </div>

          {configure.isError && (
            <p className="text-xs text-negative text-center">
              Failed to save credentials. Please check your input and try again.
            </p>
          )}
        </div>
      ) : (
        <div className="text-center py-10">
          <div className="w-16 h-16 rounded-full bg-positive-subtle flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-positive" />
          </div>
          <h3 className="text-sm font-semibold text-text">Plaid Configured</h3>
          <p className="text-xs text-text-secondary mt-1">
            Your credentials have been saved. You can now connect your bank.
          </p>
          <Button onClick={handleContinue} className="mt-6">
            Connect Bank
          </Button>
        </div>
      )}
    </Modal>
  );
}
