import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  claimAccessUrl,
  parseAccessUrl,
  parseSimplefinResponse,
  simpleFinAmountToCents,
} from './simplefinService.js';

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('parseAccessUrl', () => {
  it('splits credentials out of the URL into a Basic auth header', () => {
    const { baseUrl, authorization } = parseAccessUrl(
      'https://user:p%40ss@beta-bridge.simplefin.org/simplefin/',
    );
    expect(baseUrl).toBe('https://beta-bridge.simplefin.org/simplefin');
    expect(baseUrl).not.toContain('user');
    expect(Buffer.from(authorization.replace('Basic ', ''), 'base64').toString()).toBe('user:p@ss');
  });

  it.each([
    'http://user:pass@bridge.simplefin.org/simplefin', // not https
    'https://bridge.simplefin.org/simplefin', // no credentials
    'https://user@bridge.simplefin.org/simplefin', // no password
    'https://user:pass@127.0.0.1/simplefin',
    'https://user:pass@localhost/simplefin',
    'https://user:pass@169.254.169.254/latest',
    'https://user:pass@bridge.simplefin.org/simplefin?x=1',
    'Forbidden',
    '',
  ])('rejects %s', (url) => {
    expect(() => parseAccessUrl(url)).toThrow(/Invalid SimpleFIN access URL/);
  });
});

describe('claimAccessUrl input validation (no network)', () => {
  it.each([
    ['not base64', 'this is not base64!'],
    ['http claim URL', b64('http://beta-bridge.simplefin.org/simplefin/claim/abc')],
    ['loopback claim URL', b64('https://127.0.0.1/claim/abc')],
    ['metadata claim URL', b64('https://169.254.169.254/latest/meta-data/')],
    ['localhost claim URL', b64('https://localhost:3001/api/plaid/sync-all')],
    ['file URL', b64('file:///C:/Windows/win.ini')],
    ['oversized token', 'A'.repeat(5000)],
  ])('rejects %s', async (_label, token) => {
    await expect(claimAccessUrl(token)).rejects.toThrow(/Invalid setup token/);
  });
});

describe('parseSimplefinResponse', () => {
  const valid = {
    errors: [],
    connections: [{ conn_id: 'c1', name: 'My Bank' }],
    accounts: [
      {
        id: 'a1',
        name: 'Checking',
        currency: 'USD',
        balance: '100.23',
        'balance-date': 1_700_000_000,
        transactions: [
          { id: 't1', posted: 1_700_000_000, amount: '-12.34', description: 'Coffee' },
        ],
      },
    ],
  };

  it('accepts a well-formed response', () => {
    expect(parseSimplefinResponse(JSON.stringify(valid)).accounts[0].transactions).toHaveLength(1);
  });

  it.each([
    ['non-JSON', 'Forbidden'],
    [
      'NaN amount',
      JSON.stringify({ ...valid, accounts: [{ ...valid.accounts[0], balance: 'NaN' }] }),
    ],
    [
      'exponent amount',
      JSON.stringify({ ...valid, accounts: [{ ...valid.accounts[0], balance: '1e400' }] }),
    ],
    [
      'timestamp past year 9999',
      JSON.stringify({ ...valid, accounts: [{ ...valid.accounts[0], 'balance-date': 1e15 }] }),
    ],
    ['missing accounts', JSON.stringify({ errors: [] })],
  ])('rejects %s', (_label, body) => {
    expect(() => parseSimplefinResponse(body)).toThrow();
  });
});

describe('simpleFinAmountToCents (property-based)', () => {
  it('converts any 2-decimal amount exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e13, max: 1e13 }), (cents) => {
        const s = `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
        expect(
          simpleFinAmountToCents(s) === cents || (cents === 0 && simpleFinAmountToCents(s) === 0),
        ).toBe(true);
      }),
    );
  });

  it('rounds extra decimals half away from zero', () => {
    expect(simpleFinAmountToCents('1.005')).toBe(101);
    expect(simpleFinAmountToCents('-1.005')).toBe(-101);
    expect(simpleFinAmountToCents('1.004')).toBe(100);
    expect(simpleFinAmountToCents('7')).toBe(700);
  });

  it('rejects anything that is not a plain decimal', () => {
    for (const bad of ['', 'NaN', '1e5', '1,000.00', '--1', '0x10', ' 1']) {
      expect(() => simpleFinAmountToCents(bad), bad).toThrow();
    }
  });
});
