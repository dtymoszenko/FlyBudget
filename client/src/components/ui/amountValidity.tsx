import { createContext, useCallback, useContext, useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';

// Which amount fields hold text that isn't an amount, so a dialog can keep its save button
// disabled until they're fixed (a field never saves such text, but the dialog would save the
// amount the field had before).

type Report = (field: string, valid: boolean) => void;

const AmountValidityContext = createContext<Report | null>(null);

/** In a dialog: `allValid` is false while any amount field inside `<AmountFields>` can't be read */
export function useAmountValidity() {
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(() => new Set());
  const report = useCallback<Report>((field, valid) => {
    setInvalid((prev) => {
      if (valid !== prev.has(field)) return prev; // no change
      const next = new Set(prev);
      if (valid) next.delete(field);
      else next.add(field);
      return next;
    });
  }, []);
  return { allValid: invalid.size === 0, report };
}

/** The amount fields whose validity `report` (from useAmountValidity) collects */
export function AmountFields({ report, children }: { report: Report; children: ReactNode }) {
  return <AmountValidityContext.Provider value={report}>{children}</AmountValidityContext.Provider>;
}

/** For an amount field: tells the dialog around it whether its text is an amount */
export function useReportAmountValidity(valid: boolean) {
  const report = useContext(AmountValidityContext);
  const field = useId();
  useEffect(() => {
    report?.(field, valid);
  }, [report, field, valid]);
  // A field that goes away (a removed split part) no longer holds anything up
  useEffect(() => () => report?.(field, true), [report, field]);
}
