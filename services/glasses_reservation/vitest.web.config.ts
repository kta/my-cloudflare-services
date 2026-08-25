import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/web/test/setup.ts'],
    include: ['src/web/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'istanbul',
      thresholds: { lines: 60, functions: 60, branches: 60, statements: 60 },
    },
  },
})
