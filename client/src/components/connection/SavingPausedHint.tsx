import { useCanSave } from '../../hooks/useConnection';

/** Explains a disabled save button while FlyBudget can't reach its server. */
export function SavingPausedHint({ className = '' }: { className?: string }) {
  const canSave = useCanSave();
  if (canSave) return null;
  return (
    <p className={`text-xs text-caution ${className}`}>
      Saving is paused until FlyBudget reconnects.
    </p>
  );
}
