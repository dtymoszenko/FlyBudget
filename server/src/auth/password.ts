import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'crypto';

// Password hashing with scrypt (built into Node, no native dependency), using
// OWASP's recommended cost: N=2^17, r=8, p=1. Stored as
// "scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>" so the cost can be raised later.

const N = 2 ** 17;
const R = 8;
const P = 1;
const KEY_LEN = 64;

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

function derive(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LEN,
      { ...opts, maxmem: 256 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
