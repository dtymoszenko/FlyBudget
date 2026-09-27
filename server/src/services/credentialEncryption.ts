import { eq, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { db } from '../db/index.js';
import { plaidConfig, plaidItems, simplefinConnections } from '../db/schema.js';
import { secretCipher } from '../db/secretCrypto.js';

const notEncrypted = (column: SQLiteColumn): SQL => sql`${column} not like 'enc:v1:%'`;

/**
 * Encrypts bank credentials stored before encryption was enabled. Reading a
 * plaintext value and writing it back runs it through the encrypted column type.
 * Returns the number of rows encrypted.
 */
export function encryptStoredCredentials(): number {
  if (!secretCipher.enabled) return 0;
  let count = 0;
  db.transaction((tx) => {
    for (const row of tx.select().from(plaidConfig).where(notEncrypted(plaidConfig.secret)).all()) {
      tx.update(plaidConfig).set({ secret: row.secret }).where(eq(plaidConfig.id, row.id)).run();
      count++;
    }
    for (const row of tx
      .select()
      .from(plaidItems)
      .where(notEncrypted(plaidItems.accessToken))
      .all()) {
      tx.update(plaidItems)
        .set({ accessToken: row.accessToken })
        .where(eq(plaidItems.id, row.id))
        .run();
      count++;
    }
    for (const row of tx
      .select()
      .from(simplefinConnections)
      .where(notEncrypted(simplefinConnections.accessUrl))
      .all()) {
      tx.update(simplefinConnections)
        .set({ accessUrl: row.accessUrl })
        .where(eq(simplefinConnections.id, row.id))
        .run();
      count++;
    }
  });
  return count;
}
