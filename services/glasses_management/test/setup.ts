import { applyD1Migrations, env } from 'cloudflare:test'

// Drizzle が生成したマイグレーションを、テスト用 D1 へ一度だけ適用する。
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
