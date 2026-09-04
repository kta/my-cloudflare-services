import { defineConfig, devices } from '@playwright/test'

/*
 * E2E は「実 workerd で動く Worker + 実コーパスサイドカー」に対して行う。
 *
 * `vite preview` は本物の Worker を workerd で走らせるので、同一オリジンの /api が生きている。
 * コーパスは Node のプロセスなので、もう 1 つの webServer として合成データで起こす
 * （実データは E2E に持ち込まない。合成なら決定的で、公報の本文をリポジトリに置かずに済む）。
 *
 * workerd から 127.0.0.1 のサイドカーへ outbound fetch が届くことは実測で確認済み。
 */

const CORPUS_PORT = 8898
const APP_PORT = 4177
const CORPUS_DB = '.wrangler/e2e-corpus.db'

function withDisposableState(command: string): string {
  return `E2E_STATE_PATH="$(mktemp -d)" && export E2E_STATE_PATH && trap 'rm -rf "$E2E_STATE_PATH"' EXIT && ${command}`
}

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // コーパスサイドカーの状態（起動・停止）を跨いで検証する scenario があるので直列に走らせる。
  workers: 1,
  use: { baseURL: `http://localhost:${APP_PORT}`, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `INTERNAL_KEY=dev-internal-key bash e2e/fixtures/build-corpus.sh ${CORPUS_DB} ${CORPUS_PORT}`,
      url: `http://127.0.0.1:${CORPUS_PORT}/health`,
      name: 'コーパスサイドカー',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: withDisposableState(
        'pnpm exec wrangler d1 migrations apply patent_research --local --persist-to "$E2E_STATE_PATH" && pnpm run build && pnpm exec vite preview --port 4177 --strictPort',
      ),
      url: `http://localhost:${APP_PORT}`,
      name: '典拠 patent_research',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
