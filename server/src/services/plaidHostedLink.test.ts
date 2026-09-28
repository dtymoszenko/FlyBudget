import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stand in for Plaid: each test decides what /link/token/get returns
const plaid = vi.hoisted(() => ({
  createHostedLink: vi.fn(),
  getHostedLinkOutcome: vi.fn(),
}));
vi.mock('./plaidService.js', () => plaid);

const { startHostedLink, pollHostedLink, cancelHostedLink, _resetHostedLinkSessions } =
  await import('./plaidHostedLink.js');

beforeEach(() => {
  _resetHostedLinkSessions();
  vi.clearAllMocks();
  plaid.createHostedLink.mockResolvedValue({
    linkToken: 'link-sandbox-secret-token',
    url: 'https://hosted.plaid.com/link/abc',
  });
});

describe('Plaid Hosted Link sessions', () => {
  it('gives the UI an opaque session id and URL, never the link token', async () => {
    const started = await startHostedLink({ kind: 'new' });
    expect(started.url).toBe('https://hosted.plaid.com/link/abc');
    expect(started.sessionId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(JSON.stringify(started)).not.toContain('link-sandbox');
  });

  it('reports pending, then completes exactly once even if polled concurrently', async () => {
    const { sessionId } = await startHostedLink({ kind: 'new' });
    const complete = vi.fn(async () => ({ itemId: 'item-1' }));

    plaid.getHostedLinkOutcome.mockResolvedValueOnce({ status: 'pending' });
    expect(await pollHostedLink(sessionId, complete)).toEqual({ status: 'pending' });

    plaid.getHostedLinkOutcome.mockResolvedValue({
      status: 'success',
      publicToken: 'public-sandbox-123',
      institution: { id: 'ins_1', name: 'Test Bank' },
    });
    const [a, b, c] = await Promise.all([
      pollHostedLink(sessionId, complete),
      pollHostedLink(sessionId, complete),
      pollHostedLink(sessionId, complete),
    ]);
    // The public token is single-use: it must be exchanged once, not three times
    expect(complete).toHaveBeenCalledTimes(1);
    for (const r of [a, b, c])
      expect(r).toEqual({ status: 'success', result: { itemId: 'item-1' } });

    // Later polls return the cached result without calling Plaid again
    const calls = plaid.getHostedLinkOutcome.mock.calls.length;
    expect(await pollHostedLink(sessionId, complete)).toEqual({
      status: 'success',
      result: { itemId: 'item-1' },
    });
    expect(plaid.getHostedLinkOutcome.mock.calls.length).toBe(calls);
  });

  it('passes update-mode sessions through with their item id', async () => {
    const { sessionId } = await startHostedLink({ kind: 'update', itemId: 'item-9' }, 'access-x');
    expect(plaid.createHostedLink).toHaveBeenCalledWith('access-x');
    plaid.getHostedLinkOutcome.mockResolvedValue({ status: 'success', institution: null });
    const complete = vi.fn(async (_outcome: unknown, _mode: unknown) => null);
    await pollHostedLink(sessionId, complete);
    expect(complete.mock.calls[0][1]).toEqual({ kind: 'update', itemId: 'item-9' });
  });

  it('reports when the user quits Plaid, without completing', async () => {
    const { sessionId } = await startHostedLink({ kind: 'new' });
    plaid.getHostedLinkOutcome.mockResolvedValue({ status: 'exited' });
    const complete = vi.fn();
    expect(await pollHostedLink(sessionId, complete)).toEqual({ status: 'exited' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('treats unknown, cancelled, and timed-out sessions as expired', async () => {
    expect(await pollHostedLink('does-not-exist', vi.fn())).toEqual({ status: 'expired' });

    const { sessionId } = await startHostedLink({ kind: 'new' });
    cancelHostedLink(sessionId);
    expect(await pollHostedLink(sessionId, vi.fn())).toEqual({ status: 'expired' });

    vi.useFakeTimers();
    try {
      const late = await startHostedLink({ kind: 'new' });
      vi.advanceTimersByTime(36 * 60 * 1000);
      expect(await pollHostedLink(late.sessionId, vi.fn())).toEqual({ status: 'expired' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a failed completion be retried instead of caching the failure', async () => {
    const { sessionId } = await startHostedLink({ kind: 'new' });
    plaid.getHostedLinkOutcome.mockResolvedValue({
      status: 'success',
      publicToken: 'public-sandbox-1',
      institution: null,
    });
    const complete = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ itemId: 'ok' });
    await expect(pollHostedLink(sessionId, complete)).rejects.toThrow('network');
    expect(await pollHostedLink(sessionId, complete)).toEqual({
      status: 'success',
      result: { itemId: 'ok' },
    });
  });
});
