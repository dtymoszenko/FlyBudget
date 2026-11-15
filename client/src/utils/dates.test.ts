import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { format, parse, setDefaultOptions } from 'date-fns';
import { nl } from 'date-fns/locale/nl';
import {
  formatDay,
  formatShortDay,
  formatWeekday,
  monthNames,
  shortDayPattern,
  weekdayNames,
} from './dates';
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

describe('month and weekday names', () => {
  // setDefaultOptions({}) keeps what was set: undefined takes an option off
  afterEach(() => setDefaultOptions({ locale: undefined, weekStartsOn: undefined }));

  it('are the English ones by default, Sunday first', () => {
    expect(monthNames()).toEqual('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' '));
    expect(monthNames({ long: true })[8]).toBe('September');
    expect(weekdayNames()).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
    expect(weekdayNames('narrow')).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
    expect(weekdayNames('long')[6]).toBe('Saturday');
  });

  it('follow the app’s language, and weeks still start on Sunday', () => {
    setDefaultOptions({ locale: nl, weekStartsOn: 0 });
    expect(monthNames({ long: true })[2]).toBe('maart');
    expect(weekdayNames('long')).toEqual([
      'zondag',
      'maandag',
      'dinsdag',
      'woensdag',
      'donderdag',
      'vrijdag',
      'zaterdag',
    ]);
  });

  it('are every month and weekday once, in calendar order, whatever the week start', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(undefined, nl),
        fc.constantFrom(0, 1, 2, 3, 4, 5, 6) as fc.Arbitrary<0 | 1 | 2 | 3 | 4 | 5 | 6>,
        fc.constantFrom('narrow', 'short', 'long') as fc.Arbitrary<'narrow' | 'short' | 'long'>,
        fc.boolean(),
        (locale, weekStartsOn, width, long) => {
          setDefaultOptions({ locale, weekStartsOn });
          const months = monthNames({ long });
          expect(months).toEqual(
            Array.from({ length: 12 }, (_, m) =>
              format(new Date(2000, m, 1), long ? 'MMMM' : 'MMM'),
            ),
          );
          const days = weekdayNames(width);
          // Sunday first: January 2, 2000 was a Sunday
          const pattern = { narrow: 'EEEEE', short: 'EEE', long: 'EEEE' }[width];
          expect(days).toEqual(
            Array.from({ length: 7 }, (_, d) => format(new Date(2000, 0, 2 + d), pattern)),
          );
          if (width !== 'narrow') expect(new Set(days).size).toBe(7);
          setDefaultOptions({ locale: undefined, weekStartsOn: undefined });
        },
      ),
    );
  });
});
