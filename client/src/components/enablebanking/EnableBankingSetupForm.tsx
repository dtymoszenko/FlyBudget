import { useState } from 'react';
import { AlertTriangle, Check, Copy, ExternalLink, FileKey2, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { useCanSave } from '../../hooks/useConnection';
import { SavingPausedHint } from '../connection/SavingPausedHint';
import {
  useConfigureEnableBanking,
  useEnableBankingStatus,
  useRemoveEnableBankingConfig,
} from '../../hooks/useEnableBanking';
import { docsUrl } from '../../utils/project';
import type { EnableBankingConfigureResult } from '../../types';

const CONTROL_PANEL_URL = 'https://enablebanking.com/cp/applications';
export const ENABLE_BANKING_GUIDE_URL = `${docsUrl('bank-sync')}#enable-banking`;

const inputClass =
  'w-full text-sm border border-border rounded-md px-3 py-2 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600';

/** The redirect URL to register in the Enable Banking application, with a copy button. */
export function RedirectUrlField({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code
        className="flex-1 min-w-0 truncate text-xs bg-surface border border-border rounded-md px-2.5 py-2 text-text"
        title={url}
      >
        {url}
      </code>
      <Button
        variant="secondary"
        size="sm"
        aria-label="Copy the redirect URL"
        onClick={() => {
          navigator.clipboard?.writeText(url).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            },
            () => {},
          );
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

const environmentLabel = (env: string | null) =>
  env
    ? env.toUpperCase() === 'SANDBOX'
      ? 'Sandbox'
      : env.toUpperCase() === 'PRODUCTION'
        ? 'Production'
        : env
    : null;

/**
 * Setting up the user's own Enable Banking application: the steps on Enable Banking's side,
 * then its application ID and private key (checked with Enable Banking before they're saved).
 */
export function EnableBankingSetupForm({
  onConfigured,
}: {
  onConfigured?: (result: EnableBankingConfigureResult) => void;
}) {
  const { data: status } = useEnableBankingStatus();
  const configure = useConfigureEnableBanking();
  const remove = useRemoveEnableBankingConfig();
  const canSave = useCanSave();
  const [replacing, setReplacing] = useState(false);
  const [applicationId, setApplicationId] = useState('');
  const [keyFile, setKeyFile] = useState<{ name: string; text: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<EnableBankingConfigureResult | null>(null);

  const redirectUrl = status?.redirectUrl ?? null;

  async function handleFile(file: File | undefined) {
    setFileError(null);
    setKeyFile(null);
    if (!file) return;
    if (file.size > 16_384) {
      setFileError(
        'That file is too big to be a private key. Choose the .pem file from Enable Banking.',
      );
      return;
    }
    const text = await file.text();
    if (!text.includes('PRIVATE KEY')) {
      setFileError(
        "That file isn't a private key. Choose the .pem file Enable Banking downloaded.",
      );
      return;
    }
    setKeyFile({ name: file.name, text });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!applicationId.trim() || !keyFile) return;
    try {
      const result = await configure.mutateAsync({
        applicationId: applicationId.trim(),
        privateKey: keyFile.text,
      });
      setLastResult(result);
      setReplacing(false);
      setApplicationId('');
      setKeyFile(null);
      onConfigured?.(result);
    } catch {
      // Shown from the mutation state
    }
  }

  if (status?.configured && !replacing) {
    const env = environmentLabel(status.environment);
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5 font-medium text-text">
            <Check size={14} className="text-positive" />
            {status.applicationName || 'Your application'}
          </span>
          {env && <span className="text-xs text-text-tertiary">{env}</span>}
        </div>
        {env === 'Sandbox' && (
          <p className="text-xs text-text-secondary">
            A Sandbox application only reaches Enable Banking&apos;s test banks. Create a Production
            application to connect your real bank (it&apos;s free for your own accounts).
          </p>
        )}
        {lastResult?.redirectUrlRegistered === false && redirectUrl && (
          <p className="flex items-start gap-1.5 text-xs text-caution">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            Your application doesn&apos;t list the redirect URL below yet. Add it in the Enable
            Banking Control Panel, or your bank can&apos;t send you back to FlyBudget.
          </p>
        )}
        {redirectUrl && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-text-tertiary">Redirect URL</p>
            <RedirectUrlField url={redirectUrl} />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setReplacing(true)}>
            Replace application
          </Button>
          {status.connectionCount === 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => remove.mutate()}
              disabled={remove.isPending || !canSave}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <ol className="list-decimal pl-5 space-y-2 text-xs text-text-secondary leading-relaxed">
        <li>
          Sign up at{' '}
          <a
            href={CONTROL_PANEL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-brand-600 hover:text-brand-700 font-medium"
          >
            Enable Banking <ExternalLink size={10} />
          </a>{' '}
          and create a <strong>Production</strong> application. It&apos;s free for your own
          accounts.
        </li>
        {redirectUrl && (
          <li className="space-y-1.5">
            <span>Add this redirect URL to the application:</span>
            <RedirectUrlField url={redirectUrl} />
            {status?.insecureRedirect && (
              <span className="flex items-start gap-1.5 text-caution">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                This server is on plain HTTP. Enable Banking needs an https:// redirect URL: put
                FlyBudget behind HTTPS (see the self-hosting guide), or you&apos;ll paste the
                address back by hand after each bank login.
              </span>
            )}
          </li>
        )}
        <li>
          Save the <strong>.pem</strong> file your browser downloads: it&apos;s the
          application&apos;s private key, and Enable Banking can&apos;t show it again.
        </li>
        <li>
          Click <strong>Activate by linking accounts</strong> and log in to your bank there. Free
          applications can only use the accounts you link, so link every account you want in
          FlyBudget.
        </li>
        <li>Copy the application ID and choose the .pem file below.</li>
      </ol>

      <div>
        <label htmlFor="eb-app-id" className="block text-xs font-medium text-text-tertiary mb-1">
          Application ID
        </label>
        <input
          id="eb-app-id"
          type="text"
          value={applicationId}
          onChange={(e) => setApplicationId(e.target.value)}
          placeholder="e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6"
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
      </div>
      <div>
        <label htmlFor="eb-key" className="block text-xs font-medium text-text-tertiary mb-1">
          Private key (.pem file)
        </label>
        <label
          htmlFor="eb-key"
          className="flex items-center gap-2 cursor-pointer border border-dashed border-border rounded-md px-3 py-2 max-md:min-h-11 bg-surface text-sm text-text-secondary hover:bg-surface-alt"
        >
          <FileKey2 size={16} className="shrink-0 text-text-tertiary" />
          <span className="truncate">{keyFile ? keyFile.name : 'Choose the .pem file…'}</span>
        </label>
        <input
          id="eb-key"
          type="file"
          accept=".pem,.key,application/x-pem-file"
          className="sr-only"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {fileError && <p className="text-xs text-negative mt-1">{fileError}</p>}
        <p className="text-[11px] text-text-tertiary mt-1">
          The key stays in FlyBudget, encrypted, and is only used to sign requests to Enable
          Banking.
        </p>
      </div>

      <SavingPausedHint />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          disabled={!applicationId.trim() || !keyFile || configure.isPending || !canSave}
        >
          {configure.isPending ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Checking…
            </>
          ) : (
            'Check and save'
          )}
        </Button>
        {replacing && (
          <Button variant="secondary" onClick={() => setReplacing(false)}>
            Cancel
          </Button>
        )}
        <a
          href={ENABLE_BANKING_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium ml-auto"
        >
          Step-by-step guide <ExternalLink size={11} />
        </a>
      </div>
      {configure.isError && (
        <p className="text-xs text-negative" role="alert">
          {(configure.error as Error).message}
        </p>
      )}
    </form>
  );
}
