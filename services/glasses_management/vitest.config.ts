import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// workerd(Miniflare)の中で、wrangler.jsonc の実バインディングを使って走らせる。
// D1 マイグレーションは Node 側で読み、バインディングとして注入してから
// test/setup.ts でテスト DB へ適用する。
const migrations = await readD1Migrations('./migrations')

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          // wrangler vars から機密を撤去したぶん、テストは自前で dev 値を供給する
          INTERNAL_KEY: 'dev-internal-key',
          JWT_SECRET: 'dev-jwt-secret-change-me',
          AUTH_DEV_GRANT: 'true',
          // 受付履歴の「今月まで広げる」候補を、CI の実行日ではなく世界観データの
          // 基準時刻で検証する。
          TEST_NOW: '2026-08-27T02:08:00.000Z',
        },
        // notifier への同期送信はスタブで受ける。呼び出しの有無と本文を
        // vi.spyOn(env.NOTIFIER, 'fetch') で検証する。
        serviceBindings: {
          NOTIFIER: () =>
            new Response(JSON.stringify({ status: 'sent', id: 'stub' }), { status: 200 }),
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'], // e2e/ は Playwright なので拾わせない
    setupFiles: ['./test/setup.ts'],
    coverage: {
      provider: 'istanbul', // Workers プールでは V8 coverage が使えない
      reporter: ['text'],
      include: ['src/worker/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
