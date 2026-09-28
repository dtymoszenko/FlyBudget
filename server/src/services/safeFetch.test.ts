import { describe, expect, it, vi } from 'vitest';
import dns from 'dns';
import fc from 'fast-check';
import { Response } from 'undici';
import { assertSafeUrl, isPublicAddress, readTextLimited, safeFetch } from './safeFetch.js';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1', // loopback
    '10.0.0.5', // private
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata (link-local)
    '100.64.0.1', // carrier-grade NAT
    '0.0.0.0',
    '255.255.255.255',
    '240.0.0.1', // reserved
    '::1',
    '::',
    'fe80::1', // IPv6 link-local
    'fc00::1', // IPv6 unique local
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:169.254.169.254',
    'not-an-ip',
  ])('blocks %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])(
    'allows %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );

  it('never allows any 127.x, 10.x, 192.168.x or 169.254.x address (property-based)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('127', '10', '192.168', '169.254'),
        fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 3, maxLength: 3 }),
        (prefix, octets) => {
          const parts = [...prefix.split('.'), ...octets.map(String)].slice(0, 4);
          expect(isPublicAddress(parts.join('.'))).toBe(false);
          expect(isPublicAddress(`::ffff:${parts.join('.')}`)).toBe(false);
        },
      ),
    );
  });
});

describe('assertSafeUrl', () => {
  it.each([
    'http://bridge.simplefin.org/claim', // not https
    'file:///etc/passwd',
    'ftp://example.com/',
    'https://127.0.0.1/claim',
    'https://[::1]/claim',
    'https://[::ffff:7f00:1]/claim',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.0.0.1/',
    'https://localhost/claim',
    'https://api.LOCALHOST/claim',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => assertSafeUrl(url)).toThrow();
  });

  it('accepts public https URLs', () => {
    expect(assertSafeUrl('https://beta-bridge.simplefin.org/simplefin/claim/abc').hostname).toBe(
      'beta-bridge.simplefin.org',
    );
  });
});

describe('safeFetch', () => {
  it('refuses private addresses without making a request', async () => {
    await expect(safeFetch('https://127.0.0.1:1/')).rejects.toThrow(/non-public/);
    await expect(safeFetch('http://example.com/')).rejects.toThrow(/https/);
  });

  it('refuses a public-looking hostname whose DNS answer is private (checked at connect time)', async () => {
    // Simulates DNS rebinding: the name passes the URL check, then resolves to loopback
    const lookup = vi
      .spyOn(dns, 'lookup')
      .mockImplementation(((
        _host: string,
        _opts: unknown,
        cb: (err: null, addrs: { address: string; family: number }[]) => void,
      ) => cb(null, [{ address: '127.0.0.1', family: 4 }])) as never);
    try {
      const err = await safeFetch('https://rebind.example.com/').catch((e) => e);
      expect(lookup).toHaveBeenCalled();
      expect(String(err?.cause ?? err)).toMatch(/non-public address for rebind\.example\.com/);
    } finally {
      lookup.mockRestore();
    }
  });
});

describe('readTextLimited', () => {
  it('reads bodies within the limit', async () => {
    expect(await readTextLimited(new Response('hello'), 10)).toBe('hello');
  });

  it('rejects bodies over the limit', async () => {
    await expect(readTextLimited(new Response('x'.repeat(11)), 10)).rejects.toThrow(/too large/);
  });

  it('rejects an oversized declared Content-Length up front', async () => {
    const res = new Response('small', { headers: { 'content-length': '999999999' } });
    await expect(readTextLimited(res, 10)).rejects.toThrow(/too large/);
  });
});
