import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  clampSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from './sidebarWidth';

describe('clampSidebarWidth', () => {
  it('always gives a whole width within the limits', () => {
    fc.assert(
      fc.property(fc.double(), (width) => {
        const clamped = clampSidebarWidth(width);
        expect(Number.isInteger(clamped)).toBe(true);
        expect(clamped).toBeGreaterThanOrEqual(SIDEBAR_MIN_WIDTH);
        expect(clamped).toBeLessThanOrEqual(SIDEBAR_MAX_WIDTH);
      }),
    );
  });

  it('keeps any whole width within the limits as it is', () => {
    fc.assert(
      fc.property(fc.integer({ min: SIDEBAR_MIN_WIDTH, max: SIDEBAR_MAX_WIDTH }), (width) => {
        expect(clampSidebarWidth(width)).toBe(width);
      }),
    );
  });

  it('starts at the default, which is within the limits', () => {
    expect(clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});
