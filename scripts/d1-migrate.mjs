#!/usr/bin/env node
/**
 * 環境ごとの D1 へマイグレーションを当てる。
 *
 * DB 名を人が二重管理しないため、宛先は wrangler.jsonc から解決する。適用の直前に
 * Terraform 出力と突き合わせる — マイグレーションだけが取り返しのつかない操作なので、
 * CI の突合ステップと二重にする。
 *
 * 使い方: node scripts/d1-migrate.mjs <service> --env <name> --tf-output <file> [--dry-run]
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { planD1Migration } from './lib/binding-check.mjs'
import { readWranglerConfig, resolveEnv } from './lib/wrangler-config.mjs'

const argv = process.argv.slice(2)

function optionValue(name) {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

const service = argv[0]
const envName = optionValue('env') ?? ''
const tfOutputPath = optionValue('tf-output')
const dryRun = argv.includes('--dry-run')

if (!service || service.startsWith('--') || !tfOutputPath) {
  console.error(
    '使い方: node scripts/d1-migrate.mjs <service> --env <name> --tf-output <file> [--dry-run]',
  )
  process.exit(2)
}

const tfOutputs = JSON.parse(readFileSync(tfOutputPath, 'utf8'))
const config = readWranglerConfig(`services/${service}/wrangler.jsonc`)
const resolved = resolveEnv(config, envName)
const { databaseName, args } = planD1Migration({ service, resolved, tfOutputs, envName })

console.log(
  `▶ ${service}: ${databaseName} へマイグレーションを適用します (worker=${resolved.workerName})`,
)
if (dryRun) {
  console.log(`(dry-run) wrangler ${args.join(' ')}`)
  process.exit(0)
}
execFileSync('pnpm', ['exec', 'wrangler', ...args], {
  cwd: `services/${service}`,
  stdio: 'inherit',
})
