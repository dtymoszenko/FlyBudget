import { useState } from 'react';
import { Link2, ExternalLink, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSetupSimplefin } from '../../hooks/useSimplefin';
import { Button } from '../ui/Button';
import type { SimplefinSetupResult } from '../../types';

interface Props {
  onSetupComplete: (result: SimplefinSetupResult) => void;
}

export function SimplefinConfigForm({ onSetupComplete }: Props) {
  const { t } = useTranslation();
  const [token, setToken] = useState('');
  const setup = useSetupSimplefin();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    try {
      const result = await setup.mutateAsync(token.trim());
      setToken('');
      onSetupComplete(result);
    } catch {
      // Error handled by mutation state
    }
  }

  return (
    <div className="space-y-6">
      <div className="bg-brand-50 border border-brand-100 rounded-lg p-5">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-brand-600 flex items-center justify-center shrink-0">
            <Link2 size={20} className="text-white" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text">{t('banks.config.title')}</h3>
            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
              {t('banks.simplefin.config.hint')}
            </p>
            <a
              href="https://beta-bridge.simplefin.org/simplefin/create"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium mt-2"
            >
              {t('banks.simplefin.config.getToken')} <ExternalLink size={11} />
            </a>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="bg-surface-alt rounded-lg p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-text-tertiary mb-1">
            {t('banks.simplefin.config.token')}
          </label>
          <input
            type="text"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={t('banks.simplefin.config.placeholder')}
            className="w-full text-sm border border-border rounded-md px-3 py-2 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600 font-mono"
          />
        </div>
        <Button type="submit" disabled={!token.trim() || setup.isPending}>
          {setup.isPending ? (
            <>
              <Loader2 size={16} className="animate-spin" />{' '}
              {t('banks.simplefin.connect.connecting')}
            </>
          ) : (
            t('banks.simplefin.connect.button')
          )}
        </Button>
        {setup.isError && (
          <p className="text-xs text-negative">{t('banks.simplefin.connect.error')}</p>
        )}
      </form>
    </div>
  );
}
