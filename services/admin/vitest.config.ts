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
          INTERNAL_KEY: 'dev-internal-key',
          DOMAIN_AUTH_KEY: 'dev-domain-auth-key',
        },
        // The domain Worker is a separate deployable service. Tests keep the
        // call boundary local and observable instead of starting a second
        // workerd; production uses the Wrangler service binding below.
        serviceBindings: {
          GLASSES_MANAGEMENT: async (request: Request) =>
            new Response(await request.text(), {
              headers: { 'content-type': 'application/json' },
            }),
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
