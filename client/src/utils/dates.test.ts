import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { format, parse } from 'date-fns';
import { formatDay, formatShortDay, formatWeekday, shortDayPattern } from './dates';
import type { DateFormatOption } from '../store/preferencesStore';

const PATTERNS: DateFormatOption[] = [
  'MMM d, yyyy',
  'MM/dd/yyyy',
  'dd/MM/yyyy',
  'dd.MM.yyyy',
  'yyyy-MM-dd',
];

// Any day from 1990 to 2100, as stored: yyyy-MM-dd
const day = fc
  .date({ min: new Date(1990, 0, 1), max: new Date(2100, 11, 31), noInvalidDate: true })
  .map((d) => format(d, 'yyyy-MM-dd'));

describe('dates shown in the Date Format preference (property-based)', () => {
  it('formatDay writes the chosen pattern, and reads back as the same day', () => {
    fc.assert(
      fc.property(day, fc.constantFrom(...PATTERNS), (iso, pattern) => {
        const shown = formatDay(iso, pattern);
        expect(format(parse(shown, pattern, new Date()), 'yyyy-MM-dd')).toBe(iso);
      }),
    );
    expect(formatDay('2026-01-05', 'dd.MM.yyyy')).toBe('05.01.2026');
    expect(formatDay('2026-01-05', 'MMM d, yyyy')).toBe('Jan 5, 2026');
  });

  it('puts the weekday first', () => {
    expect(formatWeekday('2026-01-05', {}, 'dd.MM.yyyy')).toBe('Mon, 05.01.2026');
    expect(formatWeekday('2026-01-05', { long: true }, 'MMM d, yyyy')).toBe(
      'Monday, January 5, 2026',
    );
  });

  it('writes short days in the order of the preference', () => {
    expect(formatShortDay('2026-01-05', {}, 'MMM d, yyyy')).toBe('Jan 5');
    expect(formatShortDay('2026-01-05', {}, 'MM/dd/yyyy')).toBe('Jan 5');
    expect(formatShortDay('2026-01-05', {}, 'yyyy-MM-dd')).toBe('Jan 5');
    expect(formatShortDay('2026-01-05', {}, 'dd/MM/yyyy')).toBe('5 Jan');
    expect(formatShortDay('2026-01-05', { long: true }, 'dd.MM.yyyy')).toBe('5. January');
    expect(format(new Date(2026, 0, 5), shortDayPattern({ year: true }, 'dd.MM.yyyy'))).toBe(
      "5. Jan '26",
    );
  });
});
