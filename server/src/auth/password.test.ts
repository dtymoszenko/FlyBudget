import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('password hashing (scrypt)', () => {
  it('verifies the right password and rejects others', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('uses a random salt, so the same password hashes differently each time', async () => {
    const a = await hashPassword('same password');
    const b = await hashPassword('same password');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^scrypt\$131072\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toContain('same password');
  });

  it('treats equivalent Unicode forms of a password as the same', async () => {
    const stored = await hashPassword('café'); // é as one character
    expect(await verifyPassword('café', stored)).toBe(true); // e + combining accent
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    for (const bad of ['', 'plaintext', 'bcrypt$10$abc', 'scrypt$131072$8$1$$']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });
});
