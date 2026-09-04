import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkPreflight } from './preflight.mjs'

const PROD_SECRETS = {
  CLOUDFLARE_API_TOKEN: 't',
  CLOUDFLARE_ACCOUNT_ID: 'a',
  R2_STATE_ACCESS_KEY_ID: 'k',
  R2_STATE_SECRET_ACCESS_KEY: 's',
  WORKER_INTERNAL_KEY: 'i',
  WORKER_JWT_SECRET: 'j',
  WORKER_AUTH_PEPPER: 'p',
  WORKER_DOMAIN_AUTH_KEY: 'd',
  WORKER_RESEND_API_KEY: 'r',
}
const STAGING_SECRETS = {
  CLOUDFLARE_API_TOKEN: 't',
  CLOUDFLARE_ACCOUNT_ID: 'a',
  R2_STATE_ACCESS_KEY_ID: 'k',
  R2_STATE_SECRET_ACCESS_KEY: 's',
  WORKER_INTERNAL_KEY: 'i',
  WORKER_JWT_SECRET: 'j',
  WORKER_AUTH_PEPPER: 'p',
  WORKER_DOMAIN_AUTH_KEY: 'd',
  WORKER_STAGING_ACCESS_TOKEN: 'g',
  WORKER_STAGING_ADMIN_PASSWORD: 'w',
}

test('main / 空 env / production は通る', () => {
  const r = checkPreflight({
    ref: 'main',
    cloudflareEnv: '',
    environment: 'production',
    secrets: PROD_SECRETS,
  })
  assert.deepEqual(r.errors, [])
  assert.equal(r.ok, true)
})

test('develop / staging / staging は通る', () => {
  const r = checkPreflight({
    ref: 'develop',
    cloudflareEnv: 'staging',
    environment: 'staging',
    secrets: STAGING_SECRETS,
  })
  assert.equal(r.ok, true)
})

test('develop なのに CLOUDFLARE_ENV が空なら落ちる(本番へ出る事故)', () => {
  const r = checkPreflight({
    ref: 'develop',
    cloudflareEnv: '',
    environment: 'staging',
    secrets: STAGING_SECRETS,
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /CLOUDFLARE_ENV/)
})

test('main なのに staging 環境なら落ちる', () => {
  const r = checkPreflight({
    ref: 'main',
    cloudflareEnv: 'staging',
    environment: 'production',
    secrets: PROD_SECRETS,
  })
  assert.equal(r.ok, false)
})

test('Environment 名がブランチと噛み合わなければ落ちる', () => {
  const r = checkPreflight({
    ref: 'main',
    cloudflareEnv: '',
    environment: 'staging',
    secrets: PROD_SECRETS,
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /environment/i)
})

test('デプロイ対象外のブランチは落ちる', () => {
  const r = checkPreflight({
    ref: 'feature/x',
    cloudflareEnv: '',
    environment: 'production',
    secrets: PROD_SECRETS,
  })
  assert.equal(r.ok, false)
})

test('欠けている secret を名指しで挙げる', () => {
  const { WORKER_JWT_SECRET: _omitted, ...rest } = PROD_SECRETS
  const r = checkPreflight({
    ref: 'main',
    cloudflareEnv: '',
    environment: 'production',
    secrets: rest,
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /WORKER_JWT_SECRET/)
})

test('空文字の secret は未設定として扱う', () => {
  const r = checkPreflight({
    ref: 'main',
    cloudflareEnv: '',
    environment: 'production',
    secrets: { ...PROD_SECRETS, WORKER_INTERNAL_KEY: '' },
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /WORKER_INTERNAL_KEY/)
})

test('production に staging 用 secret が混ざっていたら落ちる', () => {
  const r = checkPreflight({
    ref: 'main',
    cloudflareEnv: '',
    environment: 'production',
    secrets: { ...PROD_SECRETS, WORKER_STAGING_ACCESS_TOKEN: 'g' },
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /WORKER_STAGING_ACCESS_TOKEN/)
})

test('production に staging admin パスワードが混ざっていたら落ちる', () => {
  const r = checkPreflight({
    ref: 'main',
    cloudflareEnv: '',
    environment: 'production',
    secrets: { ...PROD_SECRETS, WORKER_STAGING_ADMIN_PASSWORD: 'w' },
  })
  assert.equal(r.ok, false)
})

test('staging に RESEND キーが混ざっていたら落ちる(実メール送信の事故)', () => {
  const r = checkPreflight({
    ref: 'develop',
    cloudflareEnv: 'staging',
    environment: 'staging',
    secrets: { ...STAGING_SECRETS, WORKER_RESEND_API_KEY: 'r' },
  })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /WORKER_RESEND_API_KEY/)
})
