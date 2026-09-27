import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: {
      // Modules that import db/index.ts open SQLite on load — never touch budget.db in tests.
      DB_PATH: ':memory:',
      // Fixed test key so credential columns are encrypted like in the desktop app
      FLYBUDGET_DATA_KEY: Buffer.alloc(32, 7).toString('base64'),
    },
  },
});
