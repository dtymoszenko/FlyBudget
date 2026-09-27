import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

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
  if (key && key.length !== 32) throw new Error('Credential encryption key must be 32 bytes');

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
      // Rows written before encryption was enabled are migrated on startup
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

// Read once at startup; electron/main.ts sets it before loading the server and
// removes it from the environment afterwards.
export const secretCipher = createSecretCipher(process.env.FLYBUDGET_DATA_KEY);
