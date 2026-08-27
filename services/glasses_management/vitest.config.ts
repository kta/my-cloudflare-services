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
          INTERNAL_KEY: 'dev-internal-key',
          ADMIN_DOMAIN_AUTH_KEY: 'dev-domain-auth-key',
          JWT_SECRET: 'dev-jwt-secret-change-me',
          TEST_CLOCK_NOW: '2026-08-31T00:00:00.000Z',
        },
        // Keep service-binding calls local and deterministic in the Workers
        // pool. Production resolves this binding from wrangler.jsonc.
        serviceBindings: {
          NOTIFIER: async (request) => {
            const job = (await request.json()) as { id?: string; payload?: { to?: string } }
            if (job.payload?.to === 'notify-failed@example.test') {
              return new Response(JSON.stringify({ error: 'send_failed' }), {
                status: 502,
                headers: { 'content-type': 'application/json' },
              })
            }
            if (job.payload?.to === 'notify-duplicate@example.test') {
              return new Response(JSON.stringify({ status: 'duplicate', id: job.id }), {
                headers: { 'content-type': 'application/json' },
              })
            }
            return new Response(JSON.stringify({ status: 'sent', id: job.id }), {
              headers: { 'content-type': 'application/json' },
            })
          },
          ADMIN: async (request) => {
            const path = new URL(request.url).pathname
            if (path.endsWith('/domain-auth/login')) {
              if (request.headers.get('x-internal-key') !== 'dev-internal-key') {
                return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
              }
              if (request.headers.get('x-forwarded-for') !== '203.0.113.44') {
                return new Response(JSON.stringify({ error: 'missing_client_ip' }), { status: 400 })
              }
              return new Response(
                JSON.stringify({
                  token: 'access-token',
                  refreshToken: 'refresh-token',
                  user: { id: 'user-id', email: 'staff@example.test', role: 'staff' },
                  organization: { id: 'org-id', name: '組織', plan: 'free', isDisabled: false },
                }),
                { headers: { 'content-type': 'application/json' } },
              )
            }
            if (path.endsWith('/domain-auth/refresh')) {
              if (request.headers.get('x-internal-key') !== 'dev-internal-key') {
                return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })
              }
              return new Response(
                JSON.stringify({
                  token: 'refreshed-access-token',
                  refreshToken: 'rotated-refresh-token',
                }),
                {
                  headers: { 'content-type': 'application/json' },
                },
              )
            }
            return new Response(JSON.stringify({ verified: true }), {
              headers: { 'content-type': 'application/json' },
            })
          },
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'], // NOT e2e/ — those are Playwright specs
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'istanbul', // V8 coverage is unsupported in the Workers pool
      reporter: ['text'],
      include: ['src/worker/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
