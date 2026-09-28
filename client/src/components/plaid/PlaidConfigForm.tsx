import { useState } from 'react';
import { KeyRound, ExternalLink } from 'lucide-react';
import { useConfigurePlaid } from '../../hooks/usePlaid';
import { PlaidEnvironmentSelect, type PlaidEnvironment } from './PlaidEnvironmentSelect';
import { Button } from '../ui/Button';

export function PlaidConfigForm() {
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [environment, setEnvironment] = useState<PlaidEnvironment>('production');
  const configure = useConfigurePlaid();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId.trim() || !secret.trim()) return;
    await configure.mutateAsync({
      clientId: clientId.trim(),
      secret: secret.trim(),
      environment,
    });
  }

  return (
    <div className="space-y-6">
      <div className="bg-brand-50 border border-brand-100 rounded-lg p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
            <KeyRound size={20} className="text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text">Set Up Bank Sync</h3>
            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
              Connect your bank accounts to automatically import transactions using Plaid. A
              developer account is free and always includes up to 10 bank connections.
            </p>
            <a
              href="https://dashboard.plaid.com/signup"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium mt-2"
            >
              Get Plaid credentials <ExternalLink size={11} />
            </a>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-surface-alt rounded-lg p-5 space-y-4">
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
        <Button type="submit" disabled={!clientId.trim() || !secret.trim() || configure.isPending}>
          {configure.isPending ? 'Saving...' : 'Save Credentials'}
        </Button>
        {configure.isError && (
          <p className="text-xs text-negative">
            Failed to save credentials. Please check your input and try again.
          </p>
        )}
      </form>
    </div>
  );
}
