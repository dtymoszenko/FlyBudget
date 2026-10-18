import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetAuthSessions,
  cancelAuth,
  createAuthSession,
  pollAuth,
  receivePastedUrl,
  receiveRedirect,
} from './enableBankingAuth.js';
import { parseState } from './enableBankingTransactions.js';

const bank = { name: 'Nordea', country: 'FI' };
const until = new Date('2027-01-01');
const fail = () => 'failed';

beforeEach(() => _resetAuthSessions());

describe('bank logins in progress', () => {
  it('puts the port in a random state for the relay page', () => {
    const { state } = createAuthSession({ kind: 'new' }, bank, until, 58342);
    expect(parseState(state)?.port).toBe(58342);
    expect(createAuthSession({ kind: 'new' }, bank, until, 58342).state).not.toBe(state);
  });

  it('exchanges the code exactly once, even with polls at the same time', async () => {
    const { authId, state } = createAuthSession({ kind: 'new' }, bank, until, 1);
    expect(await pollAuth(authId, async () => 'x', fail)).toEqual({ status: 'pending' });
    expect(receiveRedirect({ state, code: 'c' })).toEqual({ authId });
    let calls = 0;
    const complete = async (code: string) => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return code.toUpperCase();
    };
    const polls = await Promise.all([1, 2, 3].map(() => pollAuth(authId, complete, fail)));
    expect(polls.every((p) => p.status === 'success' && p.result === 'C')).toBe(true);
    expect(await pollAuth(authId, complete, fail)).toEqual({ status: 'success', result: 'C' });
    expect(calls).toBe(1);
  });

  it('refuses unknown, replayed and cancelled states', () => {
    const { authId, state } = createAuthSession({ kind: 'new' }, bank, until, 1);
    expect(receiveRedirect({ state: state + 'x', code: 'c' })).toEqual({ error: 'unknown' });
    expect(receiveRedirect({ code: 'c' })).toEqual({ error: 'unknown' });
    receiveRedirect({ state, code: 'c' });
    expect(receiveRedirect({ state, code: 'other' })).toEqual({ error: 'used' });
    cancelAuth(authId);
    expect(receiveRedirect({ state, code: 'c' })).toEqual({ error: 'unknown' });
  });

  it("accepts a pasted address only with this login's own state", () => {
    const a = createAuthSession({ kind: 'new' }, bank, until, 1);
    const b = createAuthSession({ kind: 'new' }, bank, until, 1);
    expect(
      receivePastedUrl(a.authId, `https://flybudget.org/bank-callback/?state=${b.state}&code=c`),
    ).toEqual({
      error: 'unknown',
    });
    expect(receivePastedUrl(a.authId, 'not a url')).toEqual({ error: 'unknown' });
    expect(receivePastedUrl(a.authId, `https://x.example/cb?code=c&state=${a.state}`)).toEqual({
      authId: a.authId,
    });
  });

  it('pasting the address after the redirect already arrived carries on with the same login', async () => {
    const { authId, state } = createAuthSession({ kind: 'new' }, bank, until, 1);
    receiveRedirect({ state, code: 'c' });
    expect(
      receivePastedUrl(authId, `https://flybudget.org/bank-callback/?code=c&state=${state}`),
    ).toEqual({
      authId,
    });
    expect(await pollAuth(authId, async () => 'done', fail)).toEqual({
      status: 'success',
      result: 'done',
    });
    expect(
      receivePastedUrl(authId, `https://flybudget.org/bank-callback/?code=c&state=${state}`),
    ).toEqual({
      authId,
    });
  });

  it('a failed exchange is final (a code works once) and says why', async () => {
    const { authId, state } = createAuthSession({ kind: 'new' }, bank, until, 1);
    receiveRedirect({ state, code: 'c' });
    const boom = async () => {
      throw new Error('internal detail');
    };
    expect(await pollAuth(authId, boom, fail)).toEqual({ status: 'error', message: 'failed' });
    expect(await pollAuth(authId, async () => 'late', fail)).toEqual({
      status: 'error',
      message: 'failed',
    });
  });

  it('a cancelled login at the bank becomes an error', async () => {
    const { authId, state } = createAuthSession({ kind: 'new' }, bank, until, 1);
    receiveRedirect({ state, error: 'access_denied' });
    const poll = await pollAuth(authId, async () => 'x', fail);
    expect(poll).toMatchObject({ status: 'error', message: expect.stringMatching(/cancelled/) });
  });
});
