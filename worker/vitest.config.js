import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ADMIN_SECRET: 'test-admin-secret',
            PIN_PEPPER: 'test-pepper',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.js'],
      fileParallelism: false,
    },
  };
});
