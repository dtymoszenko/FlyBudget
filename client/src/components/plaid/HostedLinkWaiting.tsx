import { ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '../ui/Button';

/** Shown while the user finishes connecting their bank on Plaid's page in their browser. */
export function HostedLinkWaiting({
  onReopen,
  onCancel,
}: {
  onReopen: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="text-center space-y-4 py-2">
      <Loader2 size={28} className="animate-spin text-brand-600 mx-auto" />
      <div>
        <h3 className="text-sm font-semibold text-text">Finish connecting in your browser</h3>
        <p className="text-xs text-text-secondary mt-1 max-w-sm mx-auto leading-relaxed">
          Plaid opened in your web browser. Log in to your bank there — FlyBudget will continue
          automatically when you&apos;re done.
        </p>
      </div>
      <p className="inline-flex items-center gap-1.5 text-[11px] text-text-tertiary">
        <ShieldCheck size={12} /> Your bank login happens on Plaid&apos;s secure site, never in
        FlyBudget.
      </p>
      <div className="flex justify-center gap-2">
        <Button variant="secondary" onClick={onReopen}>
          <ExternalLink size={14} /> Open Plaid again
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
