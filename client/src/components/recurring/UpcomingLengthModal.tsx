import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { usePreferencesStore } from '../../store/preferencesStore';
import {
  DEFAULT_UPCOMING_LENGTH,
  UPCOMING_PRESETS,
  upcomingPresetLabel,
  getUpcomingDays,
  isCustomUpcomingLength,
} from './scheduleFormat';

const UNITS = ['day', 'week', 'month', 'year'] as const;

const selectCls =
  'text-sm border border-border rounded-md px-2 py-1.5 bg-surface text-text focus:outline-none focus:ring-1 focus:ring-brand-600 focus:border-brand-600 cursor-pointer';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** Port of Actual Budget's "Change upcoming length" dialog (presets + custom n-unit). */
export default function UpcomingLengthModal({ isOpen, onClose }: Props) {
  const { t } = useTranslation();
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
    <Modal isOpen={isOpen} onClose={onClose} title={t('recurring.lengthModal.title')} size="md">
      <div className="space-y-3 text-sm text-text-secondary">
        <p>
          <Trans i18nKey="recurring.lengthModal.intro" components={{ strong: <strong /> }} />
        </p>
        <p className="text-xs text-text-tertiary">{t('recurring.lengthModal.note')}</p>
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
            <option key={p} value={p}>
              {upcomingPresetLabel(p)}
            </option>
          ))}
          <option value="custom">{t('recurring.lengthModal.custom')}</option>
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
                <option key={u} value={u}>
                  {t(`recurring.lengthModal.units.${u}`)}
                </option>
              ))}
            </select>
          </div>
        )}

        <p className="text-xs text-text-tertiary">
          <Trans
            i18nKey="recurring.lengthModal.window"
            count={days}
            components={{ days: <span className="font-medium text-text-secondary" /> }}
          />
        </p>
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('common.actions.cancel')}
        </Button>
        <Button
          size="sm"
          disabled={temp === saved}
          onClick={() => {
            setUpcomingLength(temp);
            onClose();
          }}
        >
          {t('common.actions.save')}
        </Button>
      </div>
    </Modal>
  );
}
