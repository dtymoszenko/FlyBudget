// In-browser demo stand-in for db/secretCrypto.ts: the demo never stores bank credentials,
// so encrypted columns are kept as plain text (see README.md here).
import type { SecretCipher } from '../db/secretCrypto.js';

export type { SecretCipher };

export const isEncrypted = () => false;

export function createSecretCipher(): SecretCipher {
  return secretCipher;
}

export const secretCipher: SecretCipher = {
  enabled: false,
  encrypt: (value: string) => value,
  decrypt: (value: string) => value,
};
