import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync } from 'fs';

// Encryption at rest for bank credentials (Plaid secret and access tokens,
// SimpleFIN access URLs). The desktop app supplies a 256-bit key protected by the
// OS (Windows DPAPI / macOS Keychain / Linux secret service, via Electron
// safeStorage), so a copied or backed-up budget.db doesn't leak bank access.
// Without a key (plain `npm run dev`) values are stored as before.

const PREFIX = 'enc:v1:';
const IV_BYTES = 12; // recommended nonce size for GCM
const TAG_BYTES = 16;

export interface SecretCipher {
  readonly enabled: boolean;
  encrypt(plaintext: string): string;
  decrypt(stored: string): string;
}

export const isEncrypted = (stored: string) => stored.startsWith(PREFIX);

export function createSecretCipher(keyBase64: string | undefined): SecretCipher {
  const key = keyBase64 ? Buffer.from(keyBase64, 'base64') : undefined;
  if (key && key.length !== 32) {
    throw new Error(
      'The credential encryption key must be 32 bytes, base64-encoded. Create one with: openssl rand -base64 32',
    );
  }

  return {
    enabled: key !== undefined,

    encrypt(plaintext) {
      if (!key) return plaintext;
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
    },

    decrypt(stored) {
      // Startup (encryptStoredCredentials) ensures every stored credential is encrypted
      if (!isEncrypted(stored)) return stored;
      if (!key) {
        throw new Error(
          'Bank credentials are encrypted but no key is available — reconnect the bank in Settings',
        );
      }
      const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
      const iv = raw.subarray(0, IV_BYTES);
      const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag); // GCM: any modification makes final() throw
      return Buffer.concat([
        decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}

/**
 * The key, read once at startup: FLYBUDGET_DATA_KEY (electron/main.ts sets it and
 * removes it from the environment afterwards), or FLYBUDGET_DATA_KEY_FILE, a file
 * containing it (Docker secrets are mounted as files).
 */
function loadDataKey(): string | undefined {
  if (process.env.FLYBUDGET_DATA_KEY) return process.env.FLYBUDGET_DATA_KEY;
  const file = process.env.FLYBUDGET_DATA_KEY_FILE;
  if (!file) return undefined;
  try {
    return readFileSync(file, 'utf8').trim();
  } catch (err) {
    throw new Error(
      `Can't read the encryption key file ${file} (${(err as NodeJS.ErrnoException).code}). ` +
        'It must exist and be readable by the user FlyBudget runs as (user id 1000 in Docker).',
    );
  }
}

export const secretCipher = createSecretCipher(loadDataKey());
