import { useState } from 'react';
import { KeyRound, Loader2, CheckCircle2 } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { PlaidEnvironmentSelect, type PlaidEnvironment } from './PlaidEnvironmentSelect';
import { useConfigurePlaid } from '../../hooks/usePlaid';
import { IS_DEMO } from '../../demo/demoApi';
import { NotInDemoModal } from '../demo/NotInDemo';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfigured: () => void;
}

// The demo has no server to talk to the bank, so it explains that instead
export function PlaidSetupModal(props: Props) {
  return IS_DEMO ? (
    <NotInDemoModal isOpen={props.isOpen} onClose={props.onClose} />
  ) : (
    <PlaidSetupModalDialog {...props} />
  );
}

function PlaidSetupModalDialog({ isOpen, onClose, onConfigured }: Props) {
  const { t } = useTranslation();
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
    <Modal isOpen={isOpen} onClose={handleClose} title={t('banks.plaid.setup.title')} size="lg">
      {!done ? (
        <div className="space-y-5">
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-lg bg-brand-50 flex items-center justify-center mx-auto mb-4">
              <KeyRound size={32} className="text-brand-600" />
            </div>
            <h3 className="text-sm font-semibold text-text">{t('banks.plaid.setup.heading')}</h3>
            <p className="text-xs text-text-secondary mt-2 max-w-sm mx-auto leading-relaxed">
              <Trans
                i18nKey="banks.plaid.setup.intro"
                components={{
                  accountLink: (
                    <a
                      href="https://dashboard.plaid.com/signup"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-600 underline"
                    />
                  ),
                }}
              />
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-tertiary mb-1">
                {t('banks.plaid.credentials.clientId')}
              </label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder={t('banks.plaid.credentials.clientIdPlaceholder')}
                className="w-full text-sm border border-border rounded-md px-3 py-2 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-tertiary mb-1">
                {t('banks.plaid.credentials.secret')}
              </label>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder={t('banks.plaid.credentials.secretPlaceholder')}
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
                    <Loader2 size={16} className="animate-spin" />{' '}
                    {t('banks.plaid.credentials.saving')}
                  </>
                ) : (
                  t('banks.plaid.credentials.save')
                )}
              </Button>
            </div>
          </div>

          {configure.isError && (
            <p className="text-xs text-negative text-center">
              {t('banks.plaid.credentials.error')}
            </p>
          )}
        </div>
      ) : (
        <div className="text-center py-10">
          <div className="w-16 h-16 rounded-full bg-positive-subtle flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-positive" />
          </div>
          <h3 className="text-sm font-semibold text-text">{t('banks.plaid.setup.configured')}</h3>
          <p className="text-xs text-text-secondary mt-1">
            {t('banks.plaid.setup.configuredHint')}
          </p>
          <Button onClick={handleContinue} className="mt-6">
            {t('banks.plaid.connect.button')}
          </Button>
        </div>
      )}
    </Modal>
  );
}
