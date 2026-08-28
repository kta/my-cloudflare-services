import { defineConfig } from 'drizzle-kit'

// Drizzle スキーマから ./migrations へ SQL を生成する。ここは wrangler の
// `migrations_dir` と同じ場所で、適用は `wrangler d1 migrations apply` で行う
// (`drizzle-kit migrate` は使わない)。local Miniflare と remote D1 が同じ列を持つ。
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/worker/db/schema.ts',
  out: './migrations',
})
