#!/usr/bin/env node
/** CI の入口。環境変数から preflight を回し、1 つでも問題があれば非ゼロで止める。 */
import { checkPreflight } from './lib/preflight.mjs'

const { ok, errors } = checkPreflight({
  ref: process.env.GITHUB_REF_NAME ?? '',
  cloudflareEnv: process.env.CLOUDFLARE_ENV ?? '',
  environment: process.env.DEPLOY_ENVIRONMENT ?? '',
  secrets: process.env,
})

if (!ok) {
  console.error('❌ preflight に失敗しました。デプロイを中止します。')
  for (const e of errors) console.error(`   - ${e}`)
  process.exit(1)
}
console.log(
  `✅ preflight OK (ref=${process.env.GITHUB_REF_NAME} env=${process.env.DEPLOY_ENVIRONMENT})`,
)
