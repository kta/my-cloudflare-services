import { defineConfig } from 'drizzle-kit'

// Generate SQL into the same directory Wrangler applies to D1. Production
// migrations are applied with `wrangler d1 migrations apply`, not Drizzle's
// interactive migration runner.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/worker/db/schema.ts',
  out: './migrations',
})
