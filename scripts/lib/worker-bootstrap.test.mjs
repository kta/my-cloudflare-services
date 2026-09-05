import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planWorkerBootstrap } from './worker-bootstrap.mjs'

/** notifier ← glasses_management ⇄ admin。EYE スタックの実際の参照関係。 */
const WORKERS = [
  {
    service: 'notifier',
    workerName: 'notifier-staging',
    compatibilityDate: '2026-06-25',
    services: [],
  },
  {
    service: 'glasses_management',
    workerName: 'glasses-management-staging',
    compatibilityDate: '2026-06-25',
    services: [
      { binding: 'NOTIFIER', service: 'notifier-staging' },
      { binding: 'ADMIN', service: 'admin-staging' },
    ],
  },
  {
    service: 'admin',
    workerName: 'admin-staging',
    compatibilityDate: '2026-06-25',
    services: [{ binding: 'GLASSES_MANAGEMENT', service: 'glasses-management-staging' }],
  },
]

test('参照先が全部あるなら踏み台は作らない', () => {
  const r = planWorkerBootstrap({
    workers: WORKERS,
    existing: ['notifier-staging', 'glasses-management-staging', 'admin-staging'],
  })
  assert.deepEqual(r.create, [])
  assert.deepEqual(r.unknown, [])
})

test('相互参照の初回は、参照されている未作成の Worker だけを踏み台にする', () => {
  const r = planWorkerBootstrap({ workers: WORKERS, existing: [] })
  assert.deepEqual(
    r.create.map((w) => w.workerName),
    ['notifier-staging', 'admin-staging', 'glasses-management-staging'],
  )
})

test('既にある Worker は踏み台で上書きしない', () => {
  const r = planWorkerBootstrap({
    workers: WORKERS,
    existing: ['notifier-staging', 'glasses-management-staging'],
  })
  assert.deepEqual(
    r.create.map((w) => w.workerName),
    ['admin-staging'],
  )
})

test('踏み台には参照先の compatibility_date を持たせる', () => {
  const r = planWorkerBootstrap({ workers: WORKERS, existing: ['notifier-staging'] })
  const admin = r.create.find((w) => w.workerName === 'admin-staging')
  assert.equal(admin.compatibilityDate, '2026-06-25')
  assert.equal(admin.service, 'admin')
})

test('同じ Worker を複数から参照していても踏み台は 1 つ', () => {
  const workers = [
    ...WORKERS,
    {
      service: 'other',
      workerName: 'other-staging',
      compatibilityDate: '2026-06-25',
      services: [{ binding: 'ADMIN', service: 'admin-staging' }],
    },
  ]
  const r = planWorkerBootstrap({ workers, existing: ['notifier-staging'] })
  assert.equal(r.create.filter((w) => w.workerName === 'admin-staging').length, 1)
})

test('このリポジトリが持たない Worker への参照は作らず、報告だけする', () => {
  const workers = [
    {
      service: 'admin',
      workerName: 'admin-staging',
      compatibilityDate: '2026-06-25',
      services: [{ binding: 'EXTERNAL', service: 'someone-elses-worker' }],
    },
  ]
  const r = planWorkerBootstrap({ workers, existing: [] })
  assert.deepEqual(r.create, [])
  assert.deepEqual(r.unknown, [
    { from: 'admin-staging', binding: 'EXTERNAL', service: 'someone-elses-worker' },
  ])
})
