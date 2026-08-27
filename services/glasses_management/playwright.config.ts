import { defineConfig, devices } from '@playwright/test'

function withDisposableState(command: string): string {
  return `E2E_STATE_PATH="$(mktemp -d)" && export E2E_STATE_PATH && trap 'rm -rf "$E2E_STATE_PATH"' EXIT && ${command}`
}

// Keep the manual E2E job self-contained: it builds the same Worker/SPA and
// applies migrations to a disposable local D1 state instead of a developer's
// persisted .wrangler state.
export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: 'http://localhost:4175', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: withDisposableState(
      'pnpm exec wrangler d1 migrations apply glasses_management --local --persist-to "$E2E_STATE_PATH" && pnpm run build && pnpm exec vite preview --port 4175 --strictPort',
    ),
    url: 'http://localhost:4175',
    name: 'Glasses management',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
