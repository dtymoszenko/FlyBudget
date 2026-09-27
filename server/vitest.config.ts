import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Modules that import db/index.ts open SQLite on load — never touch budget.db in tests.
    env: { DB_PATH: ':memory:' },
  },
});
