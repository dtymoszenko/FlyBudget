import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, verify } from 'crypto';
import { classifyError, parsePrivateKey, signJwt } from './enableBankingService.js';

describe('signJwt', () => {
  it('signs an RS256 token Enable Banking accepts: the app id as key id, valid for an hour', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const now = Date.UTC(2026, 9, 17, 12);
    const [h, p, s] = signJwt('app-1', privateKey, now).split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({
      typ: 'JWT',
      alg: 'RS256',
      kid: 'app-1',
    });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({
      iss: 'enablebanking.com',
      aud: 'api.enablebanking.com',
      iat: now / 1000,
      exp: now / 1000 + 3600,
    });
    expect(
      verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url')),
    ).toBe(true);
  });
});

describe('parsePrivateKey', () => {
  it('takes RSA keys only', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    expect(
      parsePrivateKey(rsa.export({ type: 'pkcs8', format: 'pem' }).toString()).asymmetricKeyType,
    ).toBe('rsa');
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    expect(() => parsePrivateKey(ec.export({ type: 'pkcs8', format: 'pem' }).toString())).toThrow();
    expect(() => parsePrivateKey('-----BEGIN PUBLIC KEY-----')).toThrow();
  });
});

describe('classifyError', () => {
  it.each([
    [401, 'EXPIRED_SESSION', 'login_required'],
    [400, 'REVOKED_SESSION', 'login_required'],
    [429, null, 'rate_limited'],
    [400, 'ASPSP_RATE_LIMIT_EXCEEDED', 'rate_limited'],
    [422, 'REDIRECT_URI_NOT_ALLOWED', 'redirect_not_allowed'],
    [400, 'PSU_HEADER_NOT_PROVIDED', 'psu_header_required'],
    [401, null, 'bad_credentials'],
    [503, null, 'bank_error'],
    [400, 'ASPSP_ERROR', 'bank_error'],
    [422, 'WRONG_REQUEST_PARAMETERS', 'invalid_request'],
  ] as const)('%i %s → %s', (status, code, kind) => {
    expect(classifyError(status, code)).toBe(kind);
  });
});
