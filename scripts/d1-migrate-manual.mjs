#!/usr/bin/env node
/**
 * 人が手で叩く D1 マイグレーション（`db:migrate:local` / `db:migrate:remote`）。
 *
 * 宛先の D1 は `wrangler.jsonc` と `CLOUDFLARE_ENV` から解決する。DB 名を
 * package.json に直書きすると、staging のつもりで叩いた `db:migrate:remote` が
 * **production の D1 に当たる**。seed と同じ事故で、seed だけ塞いでも逃げ道が残る。
 *
 * CI の経路は `scripts/d1-migrate.mjs` で、そちらは Terraform 出力との突合も通す。
 * こちらは手元から叩く道なので突合は無いが、宛先は必ず印字する。
 *
 * cwd はサービスのディレクトリ（pnpm の script として呼ばれる前提）。
 * 使い方: node ../../scripts/d1-migrate-manual.mjs --remote|--local
 */
import { execFileSync } from 'node:child_process'
import { readWranglerConfig, resolveSeedTarget } from './lib/wrangler-config.mjs'

const remote = process.argv.includes('--remote')
const local = process.argv.includes('--local')
if (remote === local) {
  console.error('使い方: node ../../scripts/d1-migrate-manual.mjs --remote|--local')
  process.exit(2)
}

const envName = process.env.CLOUDFLARE_ENV ?? ''
const { dbName, envArgs } = resolveSeedTarget(readWranglerConfig('wrangler.jsonc'), envName)

const where = remote ? `REMOTE(${envName || 'production'})` : 'local'
console.log(`▶ ${dbName} [${where}] へマイグレーションを適用します`)
execFileSync(
  'pnpm',
  [
    'exec',
    'wrangler',
    'd1',
    'migrations',
    'apply',
    dbName,
    remote ? '--remote' : '--local',
    ...envArgs,
  ],
  { stdio: 'inherit' },
)
