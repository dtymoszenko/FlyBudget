import { createHash, randomBytes, timingSafeEqual } from 'crypto';

// One-time setup code for server mode (like Jenkins' initial admin password).
// Until a password is set, whoever reaches the server first could set it, including
// a malicious website using DNS rebinding. Setup therefore also needs this code,
// which is only printed in the server log, so only someone with access to the
// server (`docker logs flybudget`) can complete it. It lives in memory: a restart
// prints a new one, and it's discarded once the password is set.

// 32 characters without look-alikes (0/O, 1/I): 16 characters = 80 random bits
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LENGTH = 16;

let code: string | undefined;

const normalize = (input: string) => input.toUpperCase().replace(/[^A-Z0-9]/g, '');
const digest = (value: string) => createHash('sha256').update(value).digest();

/** The current setup code, creating it (and printing it to the log) if needed. */
export function setupCode(): string {
  if (!code) {
    // 256 is a multiple of 32, so `byte % 32` picks every character equally
    code = [...randomBytes(LENGTH)].map((b) => ALPHABET[b % ALPHABET.length]).join('');
    console.log(
      '\nFlyBudget needs a password. Open it in your browser and enter this setup code:\n\n' +
        `    ${formatSetupCode(code)}\n`,
    );
  }
  return formatSetupCode(code);
}

export const formatSetupCode = (value: string) =>
  normalize(value)
    .match(/.{1,4}/g)!
    .join('-');

/** Compares in constant time; dashes, spaces and case don't matter. */
export function checkSetupCode(input: unknown): boolean {
  if (!code || typeof input !== 'string' || input.length > 100) return false;
  return timingSafeEqual(digest(normalize(input)), digest(code));
}

/** Called once the password is set. */
export function clearSetupCode() {
  code = undefined;
}
