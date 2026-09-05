import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseWranglerConfig,
  readWranglerConfig,
  resolveEnv,
  resolveSeedTarget,
  stripJsonc,
} from './wrangler-config.mjs'

test('行コメントを落とす', () => {
  assert.equal(stripJsonc('{\n // これは注釈\n "a": 1\n}'), '{\n \n "a": 1\n}')
})

test('ブロックコメントを落とす', () => {
  assert.equal(stripJsonc('{/* 注釈 */"a": 1}'), '{"a": 1}')
})

test('文字列リテラルの中の // は残す', () => {
  const src = '{"url": "https://example.test/x"}'
  assert.equal(stripJsonc(src), src)
})

test('文字列リテラルの中の /* は残す', () => {
  const src = '{"glob": "src/*/index.ts", "c": "/* not a comment */"}'
  assert.equal(stripJsonc(src), src)
})

test('エスケープされた引用符で文字列の終端を誤判定しない', () => {
  const src = '{"a": "quote\\" // still string", "b": 1}'
  assert.equal(stripJsonc(src), src)
})

test('末尾カンマを落とす', () => {
  assert.equal(JSON.parse(stripJsonc('{"a": [1, 2,], "b": 1,}')).a.length, 2)
})

test('コメントと末尾カンマを含む設定をパースできる', () => {
  const cfg = parseWranglerConfig('{\n // name\n "name": "admin",\n "vars": { "X": "" },\n}')
  assert.equal(cfg.name, 'admin')
})

const CONFIG = {
  name: 'admin',
  d1_databases: [{ binding: 'DB', database_name: 'admin', database_id: 'prod-d1' }],
  kv_namespaces: [{ binding: 'AUTH_RL', id: 'prod-kv' }],
  services: [{ binding: 'GLASSES_MANAGEMENT', service: 'glasses-management' }],
  triggers: { crons: ['0 15 * * *'] },
  env: {
    staging: {
      d1_databases: [{ binding: 'DB', database_name: 'admin_staging', database_id: 'stg-d1' }],
      kv_namespaces: [{ binding: 'AUTH_RL', id: 'stg-kv' }],
      services: [{ binding: 'GLASSES_MANAGEMENT', service: 'glasses-management-staging' }],
      triggers: { crons: [] },
    },
  },
}

test('環境未指定なら上位のバインディングを返す', () => {
  const r = resolveEnv(CONFIG, undefined)
  assert.equal(r.workerName, 'admin')
  assert.equal(r.d1[0].database_name, 'admin')
  assert.equal(r.d1[0].database_id, 'prod-d1')
  assert.equal(r.kv[0].id, 'prod-kv')
  assert.deepEqual(r.crons, ['0 15 * * *'])
})

test('staging は env.staging を返し、Worker 名にサフィックスが付く', () => {
  const r = resolveEnv(CONFIG, 'staging')
  assert.equal(r.workerName, 'admin-staging')
  assert.equal(r.d1[0].database_name, 'admin_staging')
  assert.equal(r.kv[0].id, 'stg-kv')
  assert.deepEqual(r.crons, [])
  assert.equal(r.services[0].service, 'glasses-management-staging')
})

test('空文字の環境名は「上位」と同じに扱う', () => {
  assert.equal(resolveEnv(CONFIG, '').workerName, 'admin')
})

test('存在しない環境は失敗させる', () => {
  assert.throws(() => resolveEnv(CONFIG, 'qa'), /env\.qa/)
})

test('非継承キーの書き落としを失敗させる', () => {
  const broken = { ...CONFIG, env: { staging: { kv_namespaces: [] } } }
  assert.throws(() => resolveEnv(broken, 'staging'), /d1_databases/)
})

test('リポジトリの実物の wrangler.jsonc を読める', () => {
  const path = new URL('../../services/admin/wrangler.jsonc', import.meta.url)
  const cfg = readWranglerConfig(path)
  assert.equal(cfg.name, 'admin')
  const r = resolveEnv(cfg, '')
  assert.equal(r.d1.find((d) => d.binding === 'DB').database_name, 'admin')
  assert.ok(r.kv.some((k) => k.binding === 'AUTH_RL'))
})

test('seed の宛先: 環境未指定なら上位の DB を返し、--env を付けない', () => {
  const t = resolveSeedTarget(CONFIG, '')
  assert.equal(t.dbName, 'admin')
  assert.deepEqual(t.envArgs, [])
})

test('seed の宛先: staging は env.staging の DB と --env staging を返す', () => {
  const t = resolveSeedTarget(CONFIG, 'staging')
  assert.equal(t.dbName, 'admin_staging')
  assert.deepEqual(t.envArgs, ['--env', 'staging'])
})

test('seed の宛先: DB バインディングが無ければ失敗させる', () => {
  const noDb = { ...CONFIG, d1_databases: [{ binding: 'OTHER', database_name: 'x' }], env: {} }
  assert.throws(() => resolveSeedTarget(noDb, ''), /DB/)
})

/*
 * 宛先の取り違えは静かに成功する（INSERT OR IGNORE）ので、実物の設定で押さえる。
 * glasses_management の seed は DB 名を直書きしていて、staging の seed が本番の
 * D1 へ当たっていた。ここが名前を返さなくなったら、それは再発である。
 */
test('seed の宛先: 実物の glasses_management は staging で staging の D1 を指す', () => {
  const cfg = readWranglerConfig(
    new URL('../../services/glasses_management/wrangler.jsonc', import.meta.url),
  )
  assert.equal(resolveSeedTarget(cfg, '').dbName, 'glasses_management')
  assert.equal(resolveSeedTarget(cfg, 'staging').dbName, 'glasses_management_staging')
})
