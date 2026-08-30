/**
 * 台帳・空き枠が読む行数を「予約件数」ではなく「その日の件数」に縛る。
 *
 * `reservation_assignments` と `reservation_purposes` は `store_id` も日付も持たない。
 * 1 日分に絞る手段は「`reservations` を外側の輪にすること」しかないのに、素直な JOIN も
 * `IN (SELECT ...)` も**プランナ任せ**で、統計の有無で計画がひっくり返る。ひっくり返ると
 * 子表を `organization_id = ?` だけを頼りに組織まるごと走査するので、rows read が
 * **予約件数に比例して**伸びる（3 店舗・1 日 20 予約・年 300 営業日なら 1 年で
 * 1 日 291M 行。D1 無料枠はアカウント全体で 5M 行/日なので、`admin` /
 * `example_service` まで巻き添えで止まる。`07-nfr.md` §4.4 / §9.2）。
 *
 * ここで見るのは応答ではなく **`EXPLAIN QUERY PLAN` そのもの**である。応答は
 * どちらの計画でも同じなので、既存のテストはこの壊れ方を 1 本も捕まえられない。
 * **統計が無い状態と `ANALYZE` 済みの状態の両方**で確かめる（実際にひっくり返るのは
 * この 2 つの間である）。
 */
import { env, SELF } from 'cloudflare:test'
import type { D1Database } from '@cloudflare/workers-types'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  authed,
  BASE,
  insertBusinessHours,
  insertReservation,
  insertSlotRules,
  insertStaff,
  insertStore,
  insertVisitPurpose,
  jstAt,
  LEDGER_DATE,
  orgId,
  tokenFor,
} from './helpers'

/** 組織まるごとを走査したら困る表。 */
const HISTORY_TABLES = ['reservations', 'reservation_assignments', 'reservation_purposes']

type Fixture = { org: string; token: string; storeId: string; purposeId: string }

let fx: Fixture

/**
 * 台帳と空き枠を 1 回ずつ叩き、その間に `prepare` へ渡った SQL を集める。
 * 実装の文をそのまま読むので、クエリを書き換えるとこのテストが必ず一緒に動く。
 */
async function capturedSql(): Promise<string[]> {
  const real = env.DB as unknown as D1Database
  const sqls: string[] = []
  const spy = new Proxy(real, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (sql: string) => {
          sqls.push(sql)
          return real.prepare(sql)
        }
      }
      const value = Reflect.get(target, property, receiver) as unknown
      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })
  ;(env as unknown as { DB: D1Database }).DB = spy
  try {
    const ledger = await SELF.fetch(
      `${BASE}/api/staff/ledger?storeId=${fx.storeId}&date=${LEDGER_DATE}`,
      { headers: authed(fx.token) },
    )
    expect(ledger.status).toBe(200)
    const availability = await SELF.fetch(
      `${BASE}/api/staff/availability?storeId=${fx.storeId}&date=${LEDGER_DATE}&purposeIds=${fx.purposeId}`,
      { headers: authed(fx.token) },
    )
    expect(availability.status).toBe(200)
  } finally {
    ;(env as unknown as { DB: D1Database }).DB = real
  }
  return sqls
}

/** `EXPLAIN QUERY PLAN` の 1 行 1 行。値は計画に効かないので `?` の数だけ詰める。 */
async function planOf(sql: string): Promise<string[]> {
  const placeholders = (sql.match(/\?/g) ?? []).length
  const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .bind(...Array.from({ length: placeholders }, () => 'x'))
    .all<{ detail: string }>()
  return plan.results.map((row) => row.detail)
}

/** 予約の 3 表のどれかを読む文だけを見る（設定の表は小さいので対象外）。 */
const touchesHistory = (sql: string): boolean =>
  /reservation_assignments|reservation_purposes/.test(sql)

async function assertBoundedPlans(): Promise<void> {
  const statements = (await capturedSql()).filter(touchesHistory)
  // 台帳の割当・台帳のご用件・空き枠の塞がりの 3 本。
  expect(statements).toHaveLength(3)

  for (const sql of statements) {
    const plan = await planOf(sql)
    const joined = plan.join(' | ')
    // その日に絞れるのは `reservations` だけなので、必ず外側の輪になる。
    expect(joined).toContain('SEARCH reservations USING INDEX reservations_org_store_start_idx')
    for (const table of HISTORY_TABLES) {
      expect(joined).not.toContain(`SCAN ${table}`)
    }
  }
}

beforeAll(async () => {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await insertStore(org)
  await insertBusinessHours(org, storeId)
  await insertSlotRules(org, storeId)
  const sato = await insertStaff(org, storeId, { displayName: '佐藤 美咲', skills: ['measure'] })
  const purposeId = await insertVisitPurpose(org, storeId, {
    nameInternal: '今のメガネを調整したい',
    nameShort: '調整',
    durationMinutes: 30,
  })
  // その日の 2 件と、別の日の 40 件。**計画が正しければ後者は 1 行も読まない。**
  for (const date of [LEDGER_DATE, LEDGER_DATE]) {
    await insertReservation(org, {
      storeId,
      startsAt: jstAt(date, '11:00'),
      staffId: sato,
      purposes: [{ id: purposeId }],
    })
  }
  for (let n = 0; n < 40; n++) {
    await insertReservation(org, {
      storeId,
      startsAt: jstAt('2026-09-10', '11:00'),
      staffId: sato,
      purposes: [{ id: purposeId }],
    })
  }
  fx = { org, token, storeId, purposeId }
})

describe('台帳・空き枠が読む行数', () => {
  it('統計が無い状態でも、子表は「その日の予約」から引く', async () => {
    await assertBoundedPlans()
  })

  it('ANALYZE 済みでも計画がひっくり返らない', async () => {
    // 実運用の D1 は行が入ったあと統計を持つ。素直な JOIN はここでひっくり返り、
    // 子表を組織まるごと走査する形になる（実測）。
    await env.DB.prepare('ANALYZE').run()
    await assertBoundedPlans()
  })
})
