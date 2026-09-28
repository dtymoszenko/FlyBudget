import dns from 'dns';
import type { LookupAddress } from 'dns';
import ipaddr from 'ipaddr.js';
import { Agent, fetch, Headers, type RequestInit, type Response } from 'undici';

// Outbound HTTP for URLs that come from outside the app (SimpleFIN setup tokens
// and access URLs). Hardened against server-side request forgery (SSRF): a
// crafted token must not be able to make FlyBudget talk to localhost, the LAN,
// or cloud metadata endpoints, or leak bank credentials through redirects.
//
// Unlike a check-then-fetch approach, the address is validated at connect time
// (custom DNS lookup on the connection agent), so DNS rebinding between the
// check and the request can't bypass it.

export class UnsafeUrlError extends Error {}

/** Only globally routable unicast addresses are reachable (no loopback, private, link-local, reserved…). */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  // Unwraps IPv4-mapped IPv6 (::ffff:127.0.0.1) so it's classified as IPv4
  return ipaddr.process(address).range() === 'unicast';
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

function publicOnlyLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const blocked = addresses.find((a) => !isPublicAddress(a.address));
    if (addresses.length === 0 || blocked) {
      return callback(
        new UnsafeUrlError(`Refusing to connect to non-public address for ${hostname}`),
        [],
      );
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

const publicOnlyAgent = new Agent({ connect: { lookup: publicOnlyLookup } });

export function assertSafeUrl(raw: string | URL): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError('Invalid URL');
  }
  if (url.protocol !== 'https:') throw new UnsafeUrlError('Only https:// URLs are allowed');
  // Literal IPs skip DNS, so check them here too (bracketed IPv6 included)
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  // localhost always means loopback; reject it here for a clear error (connecting would fail anyway)
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new UnsafeUrlError('Refusing to connect to a non-public address');
  }
  if (ipaddr.isValid(host) && !isPublicAddress(host)) {
    throw new UnsafeUrlError('Refusing to connect to a non-public address');
  }
  return url;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
}

/**
 * fetch() restricted to public https endpoints. Redirects are followed manually
 * (at most `maxRedirects`), each hop is re-validated, and the Authorization
 * header is dropped if a redirect leaves the original origin.
 */
export async function safeFetch(
  raw: string | URL,
  init: RequestInit = {},
  { timeoutMs = 30_000, maxRedirects = 3 }: SafeFetchOptions = {},
): Promise<Response> {
  let url = assertSafeUrl(raw);
  const origin = url.origin;
  const headers = new Headers(init.headers);
  const signal = AbortSignal.timeout(timeoutMs);

  for (let hop = 0; ; hop++) {
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: 'manual',
      signal,
      dispatcher: publicOnlyAgent,
    });
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) return response;

    await response.body?.cancel();
    if (hop >= maxRedirects) throw new UnsafeUrlError('Too many redirects');
    url = assertSafeUrl(new URL(location, url));
    if (url.origin !== origin) headers.delete('authorization');
  }
}

/** Reads a response body as text, refusing to buffer more than `maxBytes`. */
export async function readTextLimited(response: Response, maxBytes = 10 * 1024 * 1024) {
  const declared = Number(response.headers.get('content-length'));
  if (declared > maxBytes) throw new Error('Response too large');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body ?? []) {
    total += chunk.byteLength;
    // Throwing out of the loop cancels the stream
    if (total > maxBytes) throw new Error('Response too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
