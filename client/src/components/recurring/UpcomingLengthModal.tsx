import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { usePreferencesStore } from '../../store/preferencesStore';
import {
  DEFAULT_UPCOMING_LENGTH,
  UPCOMING_PRESETS,
  getUpcomingDays,
  isCustomUpcomingLength,
} from './scheduleFormat';

const UNITS = [
  { value: 'day', label: 'Days' },
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
  { value: 'year', label: 'Years' },
];

const selectCls =
  'text-sm border border-border rounded-md px-2 py-1.5 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600 cursor-pointer';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** Port of Actual Budget's "Change upcoming length" dialog (presets + custom n-unit). */
export default function UpcomingLengthModal({ isOpen, onClose }: Props) {
  const saved = usePreferencesStore((s) => s.upcomingLength) || DEFAULT_UPCOMING_LENGTH;
  const setUpcomingLength = usePreferencesStore((s) => s.setUpcomingLength);
  const [temp, setTemp] = useState(saved);
  const [custom, setCustom] = useState(isCustomUpcomingLength(saved));

  useEffect(() => {
    if (isOpen) {
      setTemp(saved);
      setCustom(isCustomUpcomingLength(saved));
    }
  }, [isOpen, saved]);

  const [num, unit] = custom && temp.includes('-') ? temp.split('-') : ['1', 'day'];
  const days = getUpcomingDays(temp);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Change upcoming length" size="md">
      <div className="space-y-3 text-sm text-text-secondary">
        <p>
          Change how many days before its date a recurring item shows as <strong>Upcoming</strong>.
          Later items show as <strong>Scheduled</strong>.
        </p>
        <p className="text-xs text-text-tertiary">
          This only affects how recurring items are displayed. It can be changed at any time.
        </p>
      </div>

      <div className="mt-4 space-y-3">
        <select
          value={custom ? 'custom' : temp}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'custom') {
              setCustom(true);
              setTemp('1-week');
            } else {
              setCustom(false);
              setTemp(v);
            }
          }}
          className={`${selectCls} w-full`}
        >
          {UPCOMING_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom length</option>
        </select>

        {custom && (
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              value={num}
              onChange={(e) => setTemp(`${Math.max(1, parseInt(e.target.value, 10) || 1)}-${unit}`)}
              className={`${selectCls} w-24 cursor-text`}
            />
            <select
              value={unit}
              onChange={(e) => setTemp(`${num}-${e.target.value}`)}
              className={`${selectCls} flex-1`}
            >
              {UNITS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <p className="text-xs text-text-tertiary">
          Items due within the next{' '}
          <span className="font-medium text-text-secondary">
            {days} {days === 1 ? 'day' : 'days'}
          </span>{' '}
          will show as Upcoming.
        </p>
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={temp === saved}
          onClick={() => {
            setUpcomingLength(temp);
            onClose();
          }}
        >
          Save
        </Button>
      </div>
    </Modal>
  );
}
