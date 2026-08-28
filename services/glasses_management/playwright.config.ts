import { defineConfig, devices } from '@playwright/test'

function withDisposableState(command: string): string {
  return `E2E_STATE_PATH="$(mktemp -d)" && export E2E_STATE_PATH && trap 'rm -rf "$E2E_STATE_PATH"' EXIT && ${command}`
}

// ビルドして `vite preview` で配る。preview は実 Worker を workerd で動かすので
// 同一オリジンの /api がそのまま生きており、業務フロー全体を通せる。毎回まっさらな
// ローカル D1 を作り、開発者の .wrangler/state は使わない。
// 業務画面は iPad 横向き 1194x834、お客様向け Web 予約は iPhone 390x844 で撮る。
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: 'http://localhost:4175', trace: 'on-first-retry' },
  /*
   * 承認済みモックを基準画像として使う。参照するのは images/ ではなく reference/ —
   * モックは端末そのものを描いていて上に iPadOS のステータスバーが乗っているが、
   * 実装はブラウザの中で動くのでその帯を持たない。reference/ はその帯を外した派生物
   * （`node docs/frontend/mockups/eyex/reference.mjs` が作る）。
   * `expect(page).toHaveScreenshot('<画面ID>.png')` が重ねて差分を出す
   * （不一致のときは test-results/ に -diff.png が残る）。
   * モックは deviceScaleFactor 2 で撮ってあるので、突き合わせる project も 2 にする。
   */
  snapshotPathTemplate: '{testDir}/../../../docs/frontend/mockups/eyex/reference/{arg}{ext}',
  projects: [
    {
      name: 'ipad',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1194, height: 834 } },
      testIgnore: [/web-booking\.spec\.ts$/, /mock-compare\.spec\.ts$/],
    },
    {
      name: 'iphone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false },
      testMatch: /web-booking\.spec\.ts$/,
    },
    {
      /*
       * 実装とモックの突き合わせだけを走らせる面（iPad）。画素で比べるので倍率を揃える。
       * 高さ 810 = 端末 834 − iPadOS のステータスバー 24。ブラウザに与えられる実際の
       * 描画領域と同じ高さであり、基準画像 reference/ の高さでもある。
       */
      name: 'mock',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1194, height: 810 },
        deviceScaleFactor: 2,
      },
      testMatch: /mock-compare\.spec\.ts$/,
    },
    {
      /* 同じくお客様向け Web 予約（iPhone）。高さ 800 = 844 − ステータスバー 44。 */
      name: 'mock-phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 800 },
        deviceScaleFactor: 2,
      },
      testMatch: /mock-compare-web\.spec\.ts$/,
    },
  ],
  webServer: {
    command: withDisposableState(
      'pnpm exec wrangler d1 migrations apply glasses_management --local --persist-to "$E2E_STATE_PATH" && pnpm run build && pnpm exec vite preview --port 4175 --strictPort',
    ),
    url: 'http://localhost:4175',
    name: 'EYEX予約',
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
