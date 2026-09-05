#!/usr/bin/env node
/**
 * service binding の参照先が未作成なら、空の踏み台 Worker を先に置く。
 *
 * admin ⇄ glasses_management は相互に service binding を張っているので、
 * 初回デプロイはどちらを先にしても「参照先の Worker が無い」で落ちる。
 * 依存順の並べ替えでは解けないため、閉路を踏み台で一度だけ切る。
 * 詳細は scripts/lib/worker-bootstrap.mjs のコメント。
 *
 * 冪等: 既に実在する Worker には触らない。何も足りなければ何もしない。
 *
 * 使い方: node scripts/bootstrap-workers.mjs <service...> --env <name>
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planWorkerBootstrap } from './lib/worker-bootstrap.mjs'
import { readWranglerConfig, resolveEnv } from './lib/wrangler-config.mjs'

const argv = process.argv.slice(2)

function optionValue(name) {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

/** `--x value` の value を取り除いた、位置引数だけの並び。 */
function positional() {
  const out = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      i++ // その値を読み飛ばす
      continue
    }
    out.push(argv[i])
  }
  return out
}

const envName = optionValue('env') ?? ''
const services = positional()

if (services.length === 0) {
  console.error('使い方: node scripts/bootstrap-workers.mjs <service...> --env <name>')
  process.exit(2)
}

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
const apiToken = process.env.CLOUDFLARE_API_TOKEN
if (!accountId || !apiToken) {
  console.error('❌ CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_API_TOKEN が要ります')
  process.exit(2)
}

/** アカウントに実在する Worker 名。script の `id` が Worker 名。 */
async function listExistingWorkers() {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
    { headers: { Authorization: `Bearer ${apiToken}` } },
  )
  const body = await res.json()
  if (!res.ok || body.success === false) {
    throw new Error(`Worker 一覧の取得に失敗: ${res.status} ${JSON.stringify(body.errors ?? body)}`)
  }
  return (body.result ?? []).map((s) => s.id)
}

const workers = services.map((service) => {
  const config = readWranglerConfig(`services/${service}/wrangler.jsonc`)
  const resolved = resolveEnv(config, envName)
  return {
    service,
    workerName: resolved.workerName,
    compatibilityDate: config.compatibility_date,
    services: resolved.services,
  }
})

const existing = await listExistingWorkers()
const { create, unknown } = planWorkerBootstrap({ workers, existing })

for (const u of unknown) {
  console.warn(
    `⚠️ ${u.from} の ${u.binding} が ${u.service} を指していますが、このリポジトリの管理外です。踏み台は作りません`,
  )
}

if (create.length === 0) {
  console.log('✅ service binding の参照先は全て実在します(踏み台は不要)')
  process.exit(0)
}

// バインディングを持たない最小の Worker。本物のデプロイが直後に上書きする。
// 誤って残っても本番トラフィックを受けないよう 503 を返す。
const dir = mkdtempSync(join(tmpdir(), 'worker-bootstrap-'))
const entry = join(dir, 'placeholder.mjs')
writeFileSync(
  entry,
  "export default { fetch: () => new Response('bootstrap placeholder', { status: 503 }) }\n",
)

for (const worker of create) {
  console.log(`▶ ${worker.workerName}: 未作成なので踏み台を置きます`)
  // entry point を引数で渡すと wrangler は設定ファイルのバインディングを載せない。
  // 参照先がまだ無い状態でも上げられる、バインディング無しの Worker になる。
  execFileSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'deploy',
      entry,
      '--name',
      worker.workerName,
      '--compatibility-date',
      worker.compatibilityDate,
      '--no-bundle',
    ],
    { cwd: `services/${worker.service}`, stdio: 'inherit' },
  )
}
console.log(`✅ 踏み台を ${create.length} 個置きました。本物のデプロイが上書きします`)
