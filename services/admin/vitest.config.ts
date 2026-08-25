import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const migrations = await readD1Migrations('./migrations')

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          // wrangler vars から機密を撤去したぶん、テストは自前で dev 値を供給する
          JWT_SECRET: 'dev-jwt-secret-change-me',
          AUTH_PEPPER: 'dev-auth-pepper-change-me',
          AUTH_DEV_GRANT: 'true',
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'], // NOT e2e/ — those are Playwright specs
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text'],
      include: ['src/worker/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
