#!/usr/bin/env node
/**
 * Terraform 出力と wrangler.jsonc のバインディングを突き合わせる。
 * 不一致があれば非ゼロで終了し、CI をそこで止める。
 *
 * 使い方: node scripts/check-binding-ids.mjs <service...> --env <name> --tf-output <file>
 */
import { readFileSync } from 'node:fs'
import { checkBindings } from './lib/binding-check.mjs'
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
const tfOutputPath = optionValue('tf-output')
const services = positional()

if (!tfOutputPath || services.length === 0) {
  console.error(
    '使い方: node scripts/check-binding-ids.mjs <service...> --env <name> --tf-output <file>',
  )
  process.exit(2)
}

const tfOutputs = JSON.parse(readFileSync(tfOutputPath, 'utf8'))
let failed = false
for (const service of services) {
  const config = readWranglerConfig(`services/${service}/wrangler.jsonc`)
  const resolved = resolveEnv(config, envName)
  const { ok, errors } = checkBindings({ service, resolved, tfOutputs })
  if (ok) {
    console.log(`✅ ${service} (${resolved.workerName}): バインディングは Terraform 出力と一致`)
  } else {
    failed = true
    for (const e of errors) console.error(`❌ ${e}`)
  }
}
process.exit(failed ? 1 : 0)
