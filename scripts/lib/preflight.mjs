/**
 * デプロイの入口で、環境の取り違えと secrets の欠落を止める。
 *
 * ここを通らない限り terraform も wrangler も走らせない。secrets は GitHub
 * Environment が唯一の源泉なので、欠けているなら「設定し忘れ」であって
 * 「無くても動く」ではない。
 */

/** ブランチ → その環境の姿。ここに無いブランチはデプロイしない。 */
const ENVIRONMENTS = {
  main: { cloudflareEnv: '', environment: 'production' },
  develop: { cloudflareEnv: 'staging', environment: 'staging' },
}

const COMMON_REQUIRED = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'R2_STATE_ACCESS_KEY_ID',
  'R2_STATE_SECRET_ACCESS_KEY',
  'WORKER_INTERNAL_KEY',
  'WORKER_JWT_SECRET',
  'WORKER_AUTH_PEPPER',
  'WORKER_DOMAIN_AUTH_KEY',
]

const REQUIRED = {
  production: [...COMMON_REQUIRED, 'WORKER_RESEND_API_KEY'],
  staging: [...COMMON_REQUIRED, 'WORKER_STAGING_ACCESS_TOKEN', 'WORKER_STAGING_ADMIN_PASSWORD'],
}

/** その環境に**あってはいけない**もの。混ざると事故になる secret を名指しで拒む。 */
const FORBIDDEN = {
  // 本番に staging の抜け道を持ち込ませない。
  production: ['WORKER_STAGING_ACCESS_TOKEN', 'WORKER_STAGING_ADMIN_PASSWORD'],
  // staging から実メールを飛ばさない(notifier は未設定なら fail close する)。
  staging: ['WORKER_RESEND_API_KEY'],
}

export function checkPreflight({ ref, cloudflareEnv, environment, secrets }) {
  const errors = []
  const expected = ENVIRONMENTS[ref]
  if (!expected) {
    return {
      ok: false,
      errors: [`ブランチ ${ref} はデプロイ対象ではありません(main / develop のみ)`],
    }
  }
  if ((cloudflareEnv ?? '') !== expected.cloudflareEnv) {
    errors.push(
      `CLOUDFLARE_ENV がブランチと噛み合いません (ref=${ref} なら "${expected.cloudflareEnv}" のはずが "${cloudflareEnv ?? ''}")`,
    )
  }
  if (environment !== expected.environment) {
    errors.push(
      `GitHub environment がブランチと噛み合いません (ref=${ref} なら ${expected.environment} のはずが ${environment})`,
    )
  }
  for (const name of REQUIRED[expected.environment]) {
    if (!secrets[name])
      errors.push(`secret ${name} が ${expected.environment} に設定されていません`)
  }
  for (const name of FORBIDDEN[expected.environment]) {
    if (secrets[name]) {
      errors.push(`secret ${name} は ${expected.environment} に設定してはいけません`)
    }
  }
  return { ok: errors.length === 0, errors }
}
