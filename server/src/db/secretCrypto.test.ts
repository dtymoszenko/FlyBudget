import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { randomBytes } from 'crypto';
import { createSecretCipher, isEncrypted } from './secretCrypto.js';

const newKey = () => randomBytes(32).toString('base64');
const arbSecret = fc.string({ unit: 'grapheme', maxLength: 200 });

describe('credential encryption (property-based)', () => {
  const cipher = createSecretCipher(newKey());

  it('decrypts back to the original for any string', () => {
    fc.assert(
      fc.property(arbSecret, (secret) => {
        const stored = cipher.encrypt(secret);
        expect(isEncrypted(stored)).toBe(true);
        expect(cipher.decrypt(stored)).toBe(secret);
      }),
    );
  });

  it('never stores the plaintext, and encrypts the same value differently each time', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 8, maxLength: 100 }), (secret) => {
        const a = cipher.encrypt(secret);
        const b = cipher.encrypt(secret);
        expect(a).not.toContain(secret);
        expect(a).not.toBe(b);
      }),
    );
  });

  it('detects any modification of the stored value', () => {
    fc.assert(
      fc.property(arbSecret, fc.nat(), fc.integer({ min: 1, max: 255 }), (secret, pos, flip) => {
        const stored = cipher.encrypt(secret);
        const raw = Buffer.from(stored.slice('enc:v1:'.length), 'base64');
        raw[pos % raw.length] ^= flip;
        expect(() => cipher.decrypt('enc:v1:' + raw.toString('base64'))).toThrow();
      }),
    );
  });

  it('cannot be decrypted with a different key', () => {
    fc.assert(
      fc.property(arbSecret, (secret) => {
        const other = createSecretCipher(newKey());
        expect(() => other.decrypt(cipher.encrypt(secret))).toThrow();
      }),
      { numRuns: 25 },
    );
  });

  it('passes through values stored before encryption was enabled', () => {
    fc.assert(
      fc.property(
        arbSecret.filter((s) => !isEncrypted(s)),
        (legacy) => {
          expect(cipher.decrypt(legacy)).toBe(legacy);
        },
      ),
    );
  });
});

describe('credential encryption without a key', () => {
  const plain = createSecretCipher(undefined);

  it('stores values as-is (plain `npm run dev`)', () => {
    expect(plain.enabled).toBe(false);
    expect(plain.encrypt('access-sandbox-123')).toBe('access-sandbox-123');
    expect(plain.decrypt('access-sandbox-123')).toBe('access-sandbox-123');
  });

  it('refuses to hand out encrypted values it cannot decrypt', () => {
    const stored = createSecretCipher(newKey()).encrypt('secret');
    expect(() => plain.decrypt(stored)).toThrow(/reconnect/);
  });

  it('rejects keys that are not 256 bits', () => {
    expect(() => createSecretCipher(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
