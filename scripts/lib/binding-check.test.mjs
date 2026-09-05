import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BINDING_MAP, checkBindings, planD1Migration } from './binding-check.mjs'

const RESOLVED = {
  workerName: 'admin',
  d1: [{ binding: 'DB', database_name: 'admin', database_id: 'd1-real' }],
  kv: [{ binding: 'AUTH_RL', id: 'kv-real' }],
  r2: [],
  services: [],
  crons: [],
}
const TF = {
  admin_d1_database_id: { value: 'd1-real' },
  auth_rl_kv_namespace_id: { value: 'kv-real' },
}

test('全バインディングが Terraform 出力と一致すれば ok', () => {
  const r = checkBindings({ service: 'admin', resolved: RESOLVED, tfOutputs: TF })
  assert.equal(r.ok, true)
  assert.deepEqual(r.errors, [])
})

test('D1 の ID がずれていたら両方の値を挙げて落とす', () => {
  const r = checkBindings({
    service: 'admin',
    resolved: {
      ...RESOLVED,
      d1: [{ binding: 'DB', database_name: 'admin', database_id: 'other' }],
    },
    tfOutputs: TF,
  })
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /DB/)
  assert.match(r.errors[0], /other/)
  assert.match(r.errors[0], /d1-real/)
})

test('placeholder はそれと分かる文言で落とす', () => {
  const r = checkBindings({
    service: 'admin',
    resolved: {
      ...RESOLVED,
      d1: [
        {
          binding: 'DB',
          database_name: 'admin',
          database_id: '00000000-0000-0000-0000-000000000000',
        },
      ],
    },
    tfOutputs: TF,
  })
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /placeholder/)
})

test('Terraform 出力にキーが無ければ落とす', () => {
  const r = checkBindings({ service: 'admin', resolved: RESOLVED, tfOutputs: {} })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /admin_d1_database_id/)
})

test('設定に無いバインディングは落とす(書き落とし検知)', () => {
  const r = checkBindings({ service: 'admin', resolved: { ...RESOLVED, kv: [] }, tfOutputs: TF })
  assert.equal(r.ok, false)
  assert.match(r.errors.join('\n'), /AUTH_RL/)
})

test('未知のサービスは落とす', () => {
  const r = checkBindings({ service: 'nope', resolved: RESOLVED, tfOutputs: TF })
  assert.equal(r.ok, false)
})

test('突合が通れば production のマイグレーション引数を組む', () => {
  const p = planD1Migration({ service: 'admin', resolved: RESOLVED, tfOutputs: TF, envName: '' })
  assert.equal(p.databaseName, 'admin')
  assert.deepEqual(p.args, ['d1', 'migrations', 'apply', 'admin', '--remote'])
})

test('staging は --env staging を付ける', () => {
  const resolved = {
    ...RESOLVED,
    workerName: 'admin-staging',
    d1: [{ binding: 'DB', database_name: 'admin_staging', database_id: 'd1-stg' }],
    kv: [{ binding: 'AUTH_RL', id: 'kv-stg' }],
  }
  const tf = {
    admin_d1_database_id: { value: 'd1-stg' },
    auth_rl_kv_namespace_id: { value: 'kv-stg' },
  }
  const p = planD1Migration({ service: 'admin', resolved, tfOutputs: tf, envName: 'staging' })
  assert.equal(p.databaseName, 'admin_staging')
  assert.deepEqual(p.args, [
    'd1',
    'migrations',
    'apply',
    'admin_staging',
    '--remote',
    '--env',
    'staging',
  ])
})

test('突合が落ちたらマイグレーションを組み立てない', () => {
  assert.throws(
    () => planD1Migration({ service: 'admin', resolved: RESOLVED, tfOutputs: {}, envName: '' }),
    /admin_d1_database_id/,
  )
})

test('DB バインディングが無ければマイグレーションを組み立てない', () => {
  assert.throws(
    () =>
      planD1Migration({
        service: 'notifier',
        resolved: { ...RESOLVED, d1: [], kv: [{ binding: 'DEDUPE', id: 'kv-dedupe' }] },
        tfOutputs: { notifier_dedupe_kv_namespace_id: { value: 'kv-dedupe' } },
        envName: '',
      }),
    /DB/,
  )
})

test('BINDING_MAP は notifier と glasses_management も覆う', () => {
  assert.ok(BINDING_MAP.notifier.some((b) => b.binding === 'DEDUPE'))
  assert.ok(BINDING_MAP.glasses_management.some((b) => b.binding === 'RECORDINGS'))
})

test('placeholder のとき、貼り替える実値を Terraform 出力から示す', () => {
  const r = checkBindings({
    service: 'admin',
    resolved: {
      ...RESOLVED,
      d1: [
        {
          binding: 'DB',
          database_name: 'admin',
          database_id: '00000000-0000-0000-0000-000000000000',
        },
      ],
    },
    tfOutputs: TF,
  })
  assert.equal(r.ok, false)
  // 初回デプロイの鶏と卵はここでしか解けない。値を出さないと人が Actions のログを
  // 遡って terraform output を探すことになる。
  assert.match(r.errors[0], /d1-real/)
})

test('Terraform 出力がまだ無い placeholder は、値を出しようがないので文言だけ', () => {
  const r = checkBindings({
    service: 'admin',
    resolved: {
      ...RESOLVED,
      d1: [
        {
          binding: 'DB',
          database_name: 'admin',
          database_id: '00000000-0000-0000-0000-000000000000',
        },
      ],
    },
    tfOutputs: { auth_rl_kv_namespace_id: { value: 'kv-real' } },
  })
  assert.equal(r.ok, false)
  assert.match(r.errors[0], /placeholder/)
})
