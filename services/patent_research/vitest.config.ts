import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'
import { corpusStub } from './test/corpus-stub.ts'

// Runs tests inside workerd (Miniflare) with the real bindings from
// wrangler.jsonc. D1 migrations are read in Node and injected as a binding,
// then applied to the test DB in test/setup.ts.
//
// コーパスサイドカーは Node のプロセスなので workerd からは起動できない。Worker 側は
// コーパスへの口を Fetcher（`env.CORPUS`）として受け取る形にしてあるので、テストでは
// ここに代役を挿す。代役の状態は Node 側に住み、テストは `/__stub/*` 経由で操作する。
const migrations = await readD1Migrations('./migrations')

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          INTERNAL_KEY: 'dev-internal-key',
          JWT_SECRET: 'dev-jwt-secret-change-me',
          AUTH_DEV_GRANT: 'true',
          CORPUS_URL: 'http://corpus.test',
          // 時刻の注入口。実時刻に依存したテストを書かないため（TEST_RULE）。
          TEST_NOW: '2026-03-01T04:05:06.000Z',
        },
        serviceBindings: {
          CORPUS: corpusStub,
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'], // NOT e2e/ — those are Playwright specs
    setupFiles: ['./test/setup.ts'],
    // コーパスの代役の状態は Node 側の 1 つの module に住むので、テストファイルを
    // 並列に走らせると互いの「コーパスが落ちている」状態を踏む。D1 の状態が
    // ファイル内で共有されるのと同じ事情なので、直列に固定する。
    fileParallelism: false,
    coverage: {
      provider: 'istanbul', // V8 coverage is unsupported in the Workers pool
      reporter: ['text'],
      include: ['src/worker/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
