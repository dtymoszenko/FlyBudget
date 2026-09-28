export type PlaidEnvironment = 'production' | 'sandbox';

// Plaid's free tier ("limited Production") connects real banks; Sandbox only has test data.
export function PlaidEnvironmentSelect({
  value,
  onChange,
}: {
  value: PlaidEnvironment;
  onChange: (value: PlaidEnvironment) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-tertiary mb-1">Environment</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PlaidEnvironment)}
        className="w-full text-sm border border-border rounded-md px-3 py-2 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
      >
        <option value="production">Production — your real bank accounts</option>
        <option value="sandbox">Sandbox — test data only (for developers)</option>
      </select>
      <p className="text-[11px] text-text-tertiary mt-1">
        Use the secret that matches this environment in your Plaid dashboard.
      </p>
    </div>
  );
}
