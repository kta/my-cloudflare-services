import { defineConfig, devices } from '@playwright/test'

function withDisposableState(command: string): string {
  return `E2E_STATE_PATH="$(mktemp -d)" && export E2E_STATE_PATH && trap 'rm -rf "$E2E_STATE_PATH"' EXIT && ${command}`
}

// Keep the manual E2E job self-contained: it builds the same Worker/SPA and
// applies migrations to a disposable local D1 state instead of a developer's
// persisted .wrangler state.
/*
 * すでに立っている preview サーバへ相乗りするための逃げ道。E2E_BASE_URL を渡すと
 * webServer を起動しない（複数の spec を別プロセスで並行に流すとき、同じ dist を
 * 同時に build して壊し合うのを避けるため）。既定の挙動は従来どおり。
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:4175'
const EXTERNAL_SERVER = process.env.E2E_BASE_URL !== undefined

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: BASE_URL, trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: EXTERNAL_SERVER
    ? undefined
    : {
        command: withDisposableState(
          'pnpm exec wrangler d1 migrations apply glasses_management --local --persist-to "$E2E_STATE_PATH" && pnpm run build && pnpm exec vite preview --port 4175 --strictPort',
        ),
        url: BASE_URL,
        name: 'Glasses management',
        reuseExistingServer: false,
        timeout: 120_000,
      },
})
