/**
 * 受付セッション（`POST /api/staff/reception-sessions` /
 * `PATCH /api/staff/reception-sessions/:sessionId` /
 * `POST /api/staff/reception-sessions/:sessionId/close`）。
 *
 * 見るのは **D1 の `reception_sessions` 1 行**である。5 工程のあいだ伺った内容は
 * 端末のメモリに持たない（iPadOS の Safari は裏に回ったタブを容易に捨てる）ので、
 * 「始まった行が進行中で残る」「下書きが打ちかけの文字ごと戻る」「終わった受付は
 * もう動かない」の 3 つが崩れると、受けかけのご予約へ戻る道がその場で無くなる。
 *
 * 読み直しは D1 を直に引くほか、端末が実際に叩く `GET /api/staff/reception-sessions/:sessionId/draft`
 * からも確かめる。`/draft` を落とした `GET /api/staff/reception-sessions/:sessionId` は
 * 履歴の面（`04-api.md` §3.7 の `ReceptionHistoryDetail`）の持ちもので、下書きを持たない。
 *
 * 組織 id は毎回 `orgId()` で作る（D1 はテストファイル内で共有される）。
 */

import { env, SELF } from 'cloudflare:test'
import { ReceptionSession } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  authed,
  BASE,
  insertBusinessHours,
  insertEquipment,
  insertShift,
  insertSlotRules,
  insertStaff,
  insertStore,
  insertVisitPurpose,
  jstAt,
  LEDGER_DATE,
  orgId,
  tokenFor,
} from './helpers'

/** 受け付けられる店舗ひとそろい。確定まで通したいので担当・設備・ご用件を置く。 */
async function receptionTenant() {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await insertStore(org)
  await insertBusinessHours(org, storeId)
  await insertSlotRules(org, storeId, { slotMinutes: 30, cleanupMinutes: 10, maxParallel: 3 })
  const staffId = await insertStaff(org, storeId, {
    displayName: '佐藤 美咲',
    maxParallelReservations: 1,
  })
  await insertShift(org, storeId, staffId)
  const purposeId = await insertVisitPurpose(org, storeId, {
    nameInternal: 'メガネを新しく作る',
    nameShort: '新調相談',
    durationMinutes: 60,
  })
  const equipmentId = await insertEquipment(org, storeId, { name: '視力測定機 A', sortOrder: 0 })
  return { org, token, storeId, staffId, purposeId, equipmentId }
}

type SessionRow = {
  reservation_id: string | null
  ended_at: string | null
  outcome: string | null
  draft_json: string | null
  store_id: string
}

/** その受付 1 行を D1 から読み直す（読む API はこのフェーズに無い）。 */
async function readSession(org: string, sessionId: string): Promise<SessionRow | null> {
  return await env.DB.prepare(
    'SELECT store_id, reservation_id, ended_at, outcome, draft_json FROM reception_sessions WHERE organization_id = ? AND id = ?',
  )
    .bind(org, sessionId)
    .first<SessionRow>()
}

async function startSession(token: string, storeId: string) {
  const res = await SELF.fetch(`${BASE}/api/staff/reception-sessions`, {
    method: 'POST',
    headers: authed(token),
    body: JSON.stringify({ storeId }),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

async function patchDraft(token: string, sessionId: string, draft: Record<string, unknown>) {
  const res = await SELF.fetch(`${BASE}/api/staff/reception-sessions/${sessionId}`, {
    method: 'PATCH',
    headers: authed(token),
    body: JSON.stringify({ draft }),
  })
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<string, unknown> | null,
  }
}

/** 端末が受けかけの受付へ戻るときに叩く口。履歴の詳細とは別の `/draft` である。 */
async function readDraft(token: string, sessionId: string) {
  const res = await SELF.fetch(`${BASE}/api/staff/reception-sessions/${sessionId}/draft`, {
    headers: authed(token),
  })
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<string, unknown> | null,
  }
}

async function closeSession(token: string, sessionId: string) {
  const res = await SELF.fetch(`${BASE}/api/staff/reception-sessions/${sessionId}/close`, {
    method: 'POST',
    headers: authed(token),
    body: JSON.stringify({ outcome: 'discarded' }),
  })
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<string, unknown> | null,
  }
}

/** その受付を指してご予約を確定する。 */
async function confirmWith(
  t: { token: string; storeId: string; purposeId: string; staffId: string },
  sessionId: string,
  time: string,
) {
  const res = await SELF.fetch(`${BASE}/api/staff/reservations`, {
    method: 'POST',
    headers: { ...authed(t.token), 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({
      storeId: t.storeId,
      startsAt: jstAt(LEDGER_DATE, time),
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      source: 'phone',
      receptionSessionId: sessionId,
    }),
  })
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as Record<string, unknown> | null,
  }
}

/** その組織のご予約の件数。「200 が返って予約だけ増える」を捕まえる。 */
async function countReservations(org: string): Promise<number> {
  return (
    (
      await env.DB.prepare('SELECT COUNT(*) AS n FROM reservations WHERE organization_id = ?')
        .bind(org)
        .first<{ n: number }>()
    )?.n ?? 0
  )
}

describe('受付セッション', () => {
  it('始めると進行中（outcome も ended_at も NULL）の行が 1 件できる', async () => {
    const t = await receptionTenant()
    const started = await startSession(t.token, t.storeId)
    expect(started.status).toBe(200)
    expect(started.body.storeId).toBe(t.storeId)
    expect(started.body.outcome).toBeNull()
    expect(started.body.endedAt).toBeNull()
    expect(started.body.reservationId).toBeNull()
    expect(started.body.draft).toBeNull()

    const rows = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM reception_sessions WHERE organization_id = ?',
    )
      .bind(t.org)
      .first<{ n: number }>()
    expect(rows?.n).toBe(1)

    const row = await readSession(t.org, String(started.body.id))
    expect(row).not.toBeNull()
    expect(row?.outcome).toBeNull()
    expect(row?.ended_at).toBeNull()
    expect(row?.store_id).toBe(t.storeId)
  })

  it('下書きを保存して読み直すと、選んだ id と打ちかけの文字が戻る', async () => {
    const t = await receptionTenant()
    const started = await startSession(t.token, t.storeId)
    const sessionId = String(started.body.id)
    const draft = {
      purposeIds: [t.purposeId],
      staffId: t.staffId,
      equipmentIds: [t.equipmentId],
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      durationMinutes: 60,
      // 打ちかけの文字。まだお客様を指す値ではない（台帳と結びつけるのは P4）。
      phoneTyped: '090-1234-5',
      nameTyped: '田中',
      kanaTyped: 'たなか',
      noteTyped: '窓際の席がよいとのこと',
    }
    const patched = await patchDraft(t.token, sessionId, draft)
    expect(patched.status).toBe(200)
    expect(patched.body?.draft).toMatchObject(draft)

    // 端末を落として読み直した形（サーバの行だけが正本）。
    const row = await readSession(t.org, sessionId)
    expect(row?.draft_json).not.toBeNull()
    expect(JSON.parse(String(row?.draft_json))).toMatchObject(draft)
    expect(row?.outcome).toBeNull()

    /*
     * 端末が実際に叩く口から、その形のまま読めること。
     * 隣の `GET /api/staff/reception-sessions/:sessionId` は受付履歴の詳細を返す
     * 別の口で、下書きを持たない。そちらを読んでいたころは端末側の `safeParse` が
     * 必ず落ち、タブが捨てられて戻るたびに工程 1 からやり直しになっていた。
     */
    const resumed = await readDraft(t.token, sessionId)
    expect(resumed.status).toBe(200)
    expect(ReceptionSession.safeParse(resumed.body).success).toBe(true)
    expect(resumed.body?.draft).toMatchObject(draft)
    expect(resumed.body?.id).toBe(sessionId)
    expect(resumed.body?.outcome).toBeNull()
  })

  it('受けかけの受付を読む口は、履歴の詳細ではなく下書きそのものを返す', async () => {
    const t = await receptionTenant()
    const started = await startSession(t.token, t.storeId)
    const sessionId = String(started.body.id)

    // まだ何も伺っていない受付でも、始めた形のまま読める（draft は null）。
    const fresh = await readDraft(t.token, sessionId)
    expect(fresh.status).toBe(200)
    expect(ReceptionSession.safeParse(fresh.body).success).toBe(true)
    expect(fresh.body?.draft).toBeNull()

    // 知らない id は 404。端末はこれを見て新しい受付を始める。
    const missing = await readDraft(t.token, crypto.randomUUID())
    expect(missing.status).toBe(404)
  })

  it('下書きにお客様の氏名・電話番号そのものを入れて送ると 400 で落ちる', async () => {
    const t = await receptionTenant()
    const started = await startSession(t.token, t.storeId)
    const sessionId = String(started.body.id)
    // 確定したお客様のお名前・お電話番号を持つ欄は下書きに無い（`07-nfr.md` §6.6）。
    for (const stale of [
      { customerName: '田中 花子' },
      { customerPhone: '090-1234-5678' },
      { name: '田中 花子' },
      { phone: '090-1234-5678' },
    ]) {
      const bad = await patchDraft(t.token, sessionId, { phoneTyped: '090', ...stale })
      expect(bad.status).toBe(400)
    }
    // 400 で落ちた要求は 1 文字も書かない。
    const row = await readSession(t.org, sessionId)
    expect(row?.draft_json).toBeNull()
  })

  it('確定すると outcome=booked・reservation_id が入り、draft_json が NULL に戻る', async () => {
    const t = await receptionTenant()
    const started = await startSession(t.token, t.storeId)
    const sessionId = String(started.body.id)
    await patchDraft(t.token, sessionId, { purposeIds: [t.purposeId], phoneTyped: '090-1234-5678' })

    const res = await SELF.fetch(`${BASE}/api/staff/reservations`, {
      method: 'POST',
      headers: { ...authed(t.token), 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        storeId: t.storeId,
        startsAt: jstAt(LEDGER_DATE, '11:00'),
        purposeIds: [t.purposeId],
        staffId: t.staffId,
        source: 'phone',
        receptionSessionId: sessionId,
      }),
    })
    expect(res.status).toBe(200)
    const reservation = (await res.json()) as { id: string }

    const row = await readSession(t.org, sessionId)
    expect(row?.outcome).toBe('booked')
    expect(row?.reservation_id).toBe(reservation.id)
    expect(row?.ended_at).not.toBeNull()
    // 伺った内容は予約の行に移ったので、下書きは残さない（同じことを 2 か所に置かない）。
    expect(row?.draft_json).toBeNull()
  })

  it('やめると outcome=discarded で行は残り、reservation_id は NULL のまま', async () => {
    const t = await receptionTenant()
    const started = await startSession(t.token, t.storeId)
    const sessionId = String(started.body.id)
    await patchDraft(t.token, sessionId, { phoneTyped: '090-1234-5678' })

    const closed = await closeSession(t.token, sessionId)
    expect(closed.status).toBe(200)
    expect(closed.body?.outcome).toBe('discarded')
    expect(closed.body?.draft).toBeNull()

    // 破棄でも行は残す（録音も捨てない。破棄した受付も記録に残す）。
    const row = await readSession(t.org, sessionId)
    expect(row).not.toBeNull()
    expect(row?.outcome).toBe('discarded')
    expect(row?.reservation_id).toBeNull()
    expect(row?.ended_at).not.toBeNull()
    expect(row?.draft_json).toBeNull()
  })

  it('成立した受付の id では 2 件目を確定できない（409 invalid_transition）', async () => {
    const t = await receptionTenant()
    const started = await startSession(t.token, t.storeId)
    const sessionId = String(started.body.id)
    const first = await confirmWith(t, sessionId, '11:00')
    expect(first.status).toBe(200)

    // 確定のバッチが打つ `UPDATE … WHERE outcome IS NULL` は 0 行でも失敗しないので、
    // ここで断らないと 200 が返りながら 2 件目と受付の結び付きだけが黙って切れる。
    const second = await confirmWith(t, sessionId, '13:00')
    expect(second.status).toBe(409)
    expect(second.body?.error).toBe('invalid_transition')

    const row = await readSession(t.org, sessionId)
    expect(row?.outcome).toBe('booked')
    expect(row?.reservation_id).toBe(String(first.body?.id))
    expect(await countReservations(t.org)).toBe(1)
  })

  it('やめた受付の id でも確定できない（409 invalid_transition）', async () => {
    const t = await receptionTenant()
    const started = await startSession(t.token, t.storeId)
    const sessionId = String(started.body.id)
    expect((await closeSession(t.token, sessionId)).status).toBe(200)

    const late = await confirmWith(t, sessionId, '11:00')
    expect(late.status).toBe(409)
    expect(late.body?.error).toBe('invalid_transition')

    // 破棄のまま。`discarded` の行に予約が結び付いた形を残さない。
    const row = await readSession(t.org, sessionId)
    expect(row?.outcome).toBe('discarded')
    expect(row?.reservation_id).toBeNull()
    expect(await countReservations(t.org)).toBe(0)
  })

  it('終わった受付の下書きは更新できない（409 invalid_transition）', async () => {
    const t = await receptionTenant()
    const started = await startSession(t.token, t.storeId)
    const sessionId = String(started.body.id)
    expect((await closeSession(t.token, sessionId)).status).toBe(200)

    const late = await patchDraft(t.token, sessionId, { phoneTyped: '090-9999-9999' })
    expect(late.status).toBe(409)
    expect(late.body?.error).toBe('invalid_transition')

    // 2 度目の「やめる」も通さない（同じ受付を 2 回閉じない）。
    const twice = await closeSession(t.token, sessionId)
    expect(twice.status).toBe(409)
    expect(twice.body?.error).toBe('invalid_transition')

    const row = await readSession(t.org, sessionId)
    expect(row?.draft_json).toBeNull()
    expect(row?.outcome).toBe('discarded')
  })
})
