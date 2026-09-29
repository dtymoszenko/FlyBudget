import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  FIRST_RETRY_MS,
  MAX_RETRY_MS,
  connectionSecurity,
  describeUserAgent,
  isUnreachableResponse,
  retryDelayMs,
  secondsUntil,
  waitProgress,
} from './connection';

describe('retry backoff (property-based)', () => {
  it('follows 2s, 4s, 8s, 16s, then stays at 30s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 50].map(retryDelayMs)).toEqual([
      2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, 30_000,
    ]);
  });

  it('is always between the first delay and the cap, for any input', () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.double()), (attempt) => {
        const delay = retryDelayMs(attempt);
        expect(delay).toBeGreaterThanOrEqual(FIRST_RETRY_MS);
        expect(delay).toBeLessThanOrEqual(MAX_RETRY_MS);
        expect(Number.isFinite(delay)).toBe(true);
      }),
    );
  });

  it('never shrinks as failures add up, and at most doubles each time', () => {
    fc.assert(
      fc.property(fc.nat({ max: 10_000 }), (attempt) => {
        const now = retryDelayMs(attempt);
        const next = retryDelayMs(attempt + 1);
        expect(next).toBeGreaterThanOrEqual(now);
        expect(next).toBeLessThanOrEqual(now * 2);
      }),
    );
  });

  it('keeps retrying at a pace that stays well under the server’s limits', () => {
    // However long an outage lasts, a tab checks at most about twice a minute after the
    // first minute (and never hits login routes: only /api/health)
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 10_000 }), (attempt) => {
        expect(retryDelayMs(attempt)).toBe(MAX_RETRY_MS);
      }),
    );
  });
});

describe('countdown helpers (property-based)', () => {
  const time = fc.integer({ min: 0, max: 2 ** 45 });

  it('secondsUntil is never negative and rounds up', () => {
    fc.assert(
      fc.property(time, time, (now, retryAt) => {
        const s = secondsUntil(now, retryAt);
        expect(s).toBeGreaterThanOrEqual(0);
        if (retryAt > now) expect(s * 1000).toBeGreaterThanOrEqual(retryAt - now);
        else expect(s).toBe(0);
      }),
    );
  });

  it('waitProgress stays within 0..1 and grows with time', () => {
    fc.assert(
      fc.property(time, time, time, fc.nat({ max: 60_000 }), (start, wait, now, step) => {
        const retryAt = start + (wait % 60_000);
        const a = waitProgress(now, start, retryAt);
        const b = waitProgress(now + step, start, retryAt);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        expect(b).toBeGreaterThanOrEqual(a);
      }),
    );
  });
});

describe('isUnreachableResponse', () => {
  it('only treats gateway errors and non-JSON 500s as "server unreachable"', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 599 }),
        fc.constantFrom(null, 'text/plain', 'text/html', 'application/json; charset=utf-8'),
        (status, type) => {
          const expected =
            (status >= 502 && status <= 504) ||
            (status === 500 && !(type ?? '').includes('application/json'));
          expect(isUnreachableResponse(status, type)).toBe(expected);
        },
      ),
    );
    // A login that expired is not a connection problem
    expect(isUnreachableResponse(401, 'application/json')).toBe(false);
  });
});

describe('connectionSecurity', () => {
  it('HTTPS is encrypted; plain HTTP is only fine on this computer', () => {
    fc.assert(
      fc.property(fc.domain(), (host) => {
        expect(connectionSecurity('https:', host)).toBe('encrypted');
        expect(connectionSecurity('http:', host)).toBe('unencrypted');
      }),
    );
    expect(connectionSecurity('http:', 'localhost')).toBe('local');
    expect(connectionSecurity('http:', '127.0.0.1')).toBe('local');
  });
});

describe('describeUserAgent', () => {
  it('names common browsers', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome on Windows');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iPhone');
    expect(describeUserAgent(null)).toBe('Unknown browser');
  });

  it('always gives a short, non-empty name', () => {
    fc.assert(
      fc.property(fc.option(fc.string({ maxLength: 300 })), (ua) => {
        const name = describeUserAgent(ua);
        expect(name.length).toBeGreaterThan(0);
        expect(name.length).toBeLessThanOrEqual(30);
      }),
    );
  });
});
