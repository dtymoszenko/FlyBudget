import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from '../db/index.js';
import { plaidConfig, plaidItems, simplefinConnections } from '../db/schema.js';
import { encryptStoredCredentials } from './credentialEncryption.js';

// vitest.config.ts runs server tests against an in-memory DB with a test key
const raw = (table: string, column: string) =>
  db.$client.prepare(`select ${column} as v from ${table}`).all() as { v: string }[];

describe('encryptStoredCredentials', () => {
  beforeAll(() => {
    migrate(db, { migrationsFolder: 'src/db/migrations' });
    // Rows as an older version of the app would have written them: plaintext
    db.$client
      .prepare(
        `insert into plaid_config (id, client_id, secret, environment) values ('cfg', 'client', 'plaid-secret', 'sandbox')`,
      )
      .run();
    db.$client
      .prepare(
        `insert into plaid_items (id, plaid_item_id, institution_id, institution_name, access_token) values ('item', 'pi', 'ins_1', 'Bank', 'access-sandbox-abc')`,
      )
      .run();
    db.$client
      .prepare(
        `insert into simplefin_connections (id, access_url, connection_name) values ('sf', 'https://user:pass@bridge.simplefin.org/simplefin', 'SF')`,
      )
      .run();
  });

  it('encrypts plaintext credentials already in the database', () => {
    expect(encryptStoredCredentials()).toBe(3);
    for (const [table, column] of [
      ['plaid_config', 'secret'],
      ['plaid_items', 'access_token'],
      ['simplefin_connections', 'access_url'],
    ]) {
      const [{ v }] = raw(table, column);
      expect(v.startsWith('enc:v1:'), `${table}.${column}`).toBe(true);
    }
    expect(
      JSON.stringify(db.$client.prepare('select * from simplefin_connections').all()),
    ).not.toContain('pass@');
  });

  it('still reads the original values through the app', () => {
    expect(db.select().from(plaidConfig).get()?.secret).toBe('plaid-secret');
    expect(db.select().from(plaidItems).get()?.accessToken).toBe('access-sandbox-abc');
    expect(db.select().from(simplefinConnections).get()?.accessUrl).toBe(
      'https://user:pass@bridge.simplefin.org/simplefin',
    );
  });

  it('is idempotent, and new credentials are encrypted on write', () => {
    expect(encryptStoredCredentials()).toBe(0);
    db.insert(plaidItems)
      .values({
        id: 'item2',
        plaidItemId: 'pi2',
        institutionId: 'ins_2',
        institutionName: 'B2',
        accessToken: 'access-new',
      })
      .run();
    const stored = raw('plaid_items', 'access_token').map((r) => r.v);
    expect(stored.every((v) => v.startsWith('enc:v1:'))).toBe(true);
    expect(encryptStoredCredentials()).toBe(0);
  });
});
