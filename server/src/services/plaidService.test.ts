import { describe, expect, it } from 'vitest';
import { PlaidEnvironments } from 'plaid';
import { plaidAmountToCents, plaidBasePath } from './plaidService.js';

describe('plaidBasePath', () => {
  it('uses Production only when explicitly configured', () => {
    expect(plaidBasePath('production')).toBe(PlaidEnvironments.production);
    expect(plaidBasePath('sandbox')).toBe(PlaidEnvironments.sandbox);
  });

  it('keeps retired "development" configs on Sandbox, where they have always gone', () => {
    expect(plaidBasePath('development')).toBe(PlaidEnvironments.sandbox);
    expect(plaidBasePath('anything-else')).toBe(PlaidEnvironments.sandbox);
  });

  it('only ever talks to Plaid over https', () => {
    for (const env of ['production', 'sandbox', 'development']) {
      expect(plaidBasePath(env)).toMatch(/^https:\/\/[a-z]+\.plaid\.com$/);
    }
  });
});

describe('plaidAmountToCents', () => {
  it('flips Plaid sign (positive = money out) to app sign (negative = outflow)', () => {
    expect(plaidAmountToCents(12.34)).toBe(-1234);
    expect(plaidAmountToCents(-50)).toBe(5000);
  });
});
