import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { restoreBackup } from '../../api/backup';
import { IS_DEMO, downloadFromApi } from '../../demo/demoApi';

const API_BASE = '/api/export';

// The server sends these as downloads; the demo's in-browser API can only answer fetch
const download = (url: string) =>
  IS_DEMO ? void downloadFromApi(url) : void (window.location.href = url);

export function DataExport() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ name: string; data: unknown } | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const queryClient = useQueryClient();

  async function chooseBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (!file) return;
    setRestoreMessage(null);
    try {
      setPending({ name: file.name, data: JSON.parse(await file.text()) });
    } catch {
      setRestoreMessage({ ok: false, text: `${file.name} is not a FlyBudget backup file.` });
    }
  }

  async function confirmRestore() {
    if (!pending) return;
    setRestoring(true);
    try {
      const result = await restoreBackup(pending.data);
      const count = result.restored.transactions ?? 0;
      setRestoreMessage({
        ok: true,
        text:
          `Restored ${pending.name} (${count.toLocaleString()} transactions).` +
          (result.safetyCopy
            ? ` Your previous data was saved as ${result.safetyCopy} next to the database.`
            : ''),
      });
      // Everything on screen is from before the restore
      await queryClient.invalidateQueries();
    } catch (err) {
      setRestoreMessage({ ok: false, text: err instanceof Error ? err.message : 'Restore failed' });
    } finally {
      setRestoring(false);
      setPending(null);
    }
  }

  function downloadCsv() {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    download(`${API_BASE}/transactions/csv${qs ? `?${qs}` : ''}`);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-text">Data Export</h2>
        <p className="text-xs text-text-tertiary mt-0.5">
          Download your data for backup or analysis.
        </p>
      </div>

      <div className="bg-surface-alt rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-text">Export Transactions</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Download all transactions as a CSV file. Optionally filter by date range.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-text-tertiary mb-1">From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-1.5 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-tertiary mb-1">To</label>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-1.5 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600"
            />
          </div>
          <Button onClick={downloadCsv} size="sm">
            <Download size={14} /> Download CSV
          </Button>
        </div>
      </div>

      <div className="bg-surface-alt rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-text">Full Backup</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Download a complete JSON backup of all your data — accounts, transactions, budgets,
            categories, payees, rules, recurring transactions, goals, reports and dashboards. Bank
            connection credentials are not included.
          </p>
        </div>
        <button
          onClick={() => {
            download(`${API_BASE}/backup`);
          }}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium text-white bg-text-secondary rounded-md hover:opacity-90 transition-colors"
        >
          <Download size={14} /> Download Backup
        </button>
      </div>

      <div className="bg-surface-alt rounded-lg p-5 space-y-4">
        <div>
          <h3 className="text-sm font-medium text-text">Restore from Backup</h3>
          <p className="text-xs text-text-tertiary mt-0.5">
            Replace all of your data with a backup file. A copy of your current data is saved first.
          </p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="Backup file"
          onChange={chooseBackup}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={restoring}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={14} /> {restoring ? 'Restoring…' : 'Restore Backup…'}
        </Button>
        {restoreMessage && (
          <p
            role="status"
            className={`text-xs ${restoreMessage.ok ? 'text-text-secondary' : 'text-red-600'}`}
          >
            {restoreMessage.text}
          </p>
        )}
      </div>

      <ConfirmModal
        isOpen={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={confirmRestore}
        title="Restore this backup?"
        message={`All of your current data will be replaced with the contents of ${pending?.name ?? 'the backup'}. Bank connections stay connected.`}
        confirmLabel="Replace my data"
        danger
      />
    </div>
  );
}
