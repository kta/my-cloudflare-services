/**
 * 受付の録音の代表フローを**実 D1・実 R2・実 KV**の上で通す。
 *
 * 見たいのは 1 本の線である —「受付が始まった瞬間に 1 本だけ録り始め、終わったら
 * 非公開の保管庫へ置き、置けなかったら予約の成立とは切り分けて数え、聞くときは
 * ダウンロード URL を出さずに Worker が仲介し、決めた期間より前には消せない」。
 *
 * **応答に `r2Key` とダウンロード URL が載らないこと**は、契約の `strictObject` だけに
 * 任せず本文の生の文字列でも確かめる（剥がし忘れは 200 で外へ出るので、型が通っただけでは
 * 足りない）。再生の記録（`recording.played`）は best-effort にしない — 誰が聞いたかが
 * 残らない再生は、要配慮情報の持ち出しと区別が付かない。
 *
 * D1 / KV / R2 はテストファイル内で共有されるので、組織 id は毎回 `crypto.randomUUID()`
 * から作る。時刻は保守の経路の `now` で注入し、**実時刻に依存した境界を書かない**。
 */
import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  authed,
  BASE,
  FIXED_NOW,
  INTERNAL_HEADERS,
  insertBusinessHours,
  insertReservation,
  insertShift,
  insertSlotRules,
  insertStaff,
  insertStore,
  JSON_HEADERS,
  jstAt,
  LEDGER_DATE,
  orgId,
  tokenFor,
} from './helpers'

type Json = Record<string, unknown>

/** 成立予約は 30 日、破棄受付は 24 時間（`design/09-open-questions.md` Q-02）。 */
const RETAIN_BOOKED_MS = 2_592_000_000
const RETAIN_DISCARDED_MS = 86_400_000

/** 音声そのもの。中身は問わないので、判別できる短い並びを 1 つ置く。 */
const AUDIO = new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112, 77, 52, 65, 32])

/**
 * 録音を持てる店舗ひとそろい。再生と保全はサーバ側で権限を強制する（Q-03）ので、
 * 既定のトークンには `recording.read` と `recording.manage` の両方を配っておき、
 * 「権限が無いと通らない」側は `permissions.test.ts` の表で見る。
 */
async function recordingTenant(permissions: string[] = ['recording.read', 'recording.manage']) {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await insertStore(org)
  await insertBusinessHours(org, storeId)
  await insertSlotRules(org, storeId)
  const staffId = await insertStaff(org, storeId, { displayName: '中村 彩' })
  await insertShift(org, storeId, staffId)
  await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      organizationId: org,
      storeId,
      userId: `dev:${org}`,
      permissions,
      createdAt: FIXED_NOW,
    }),
  })
  return { org, token, storeId, staffId }
}

/** 受付セッション 1 行。開始の API は P5 にあるが、予約の有無を作り分けたいので直に置く。 */
async function startSession(
  org: string,
  storeId: string,
  input: { reservationId?: string | null; outcome?: string | null } = {},
): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO reception_sessions (id, organization_id, store_id, reservation_id, terminal_id, actor_id, started_at, ended_at, outcome, draft_json, created_at) VALUES (?,?,?,?,NULL,NULL,?,NULL,?,NULL,?)',
  )
    .bind(
      id,
      org,
      storeId,
      input.reservationId ?? null,
      FIXED_NOW,
      input.outcome ?? null,
      FIXED_NOW,
    )
    .run()
  return id
}

function callAs(token: string) {
  return async (method: string, path: string, body?: unknown) => {
    const res = await SELF.fetch(`${BASE}${path}`, {
      method,
      headers: authed(token),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: res.status, body: (await res.json().catch(() => null)) as never as Json }
  }
}

/** 録音を 1 本立てる。`state='recording'` の行と `EY-R-NNNN` が返る。 */
async function startRecording(
  tenant: { org: string; token: string; storeId: string },
  sessionId: string,
): Promise<Json> {
  const created = await callAs(tenant.token)('POST', '/api/staff/recordings', {
    receptionSessionId: sessionId,
    storeId: tenant.storeId,
    startedAt: FIXED_NOW,
  })
  expect(created.status).toBe(200)
  return created.body
}

/** 本体を送る。生 body を受ける唯一のルートなので `callAs` を通さない。 */
async function putContent(
  token: string,
  recordingId: string,
  input: { body?: BodyInit; contentType?: string; durationSeconds?: number } = {},
) {
  const query =
    input.durationSeconds === undefined ? '' : `?durationSeconds=${input.durationSeconds}`
  const res = await SELF.fetch(`${BASE}/api/staff/recordings/${recordingId}/content${query}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': input.contentType ?? 'audio/mp4',
    },
    body: input.body ?? AUDIO,
  })
  return { status: res.status, text: await res.text() }
}

/** D1 の行そのもの（応答に出ない `r2_key` と `retain_until` を確かめるため）。 */
async function recordingRow(recordingId: string) {
  return await env.DB.prepare(
    'SELECT id, code, state, r2_key AS r2Key, retain_until AS retainUntil, legal_hold AS legalHold, ' +
      'upload_attempts AS uploadAttempts, reservation_id AS reservationId, updated_at AS updatedAt, ' +
      'deleted_at AS deletedAt FROM recordings WHERE id = ?',
  )
    .bind(recordingId)
    .first<{
      id: string
      code: string
      state: string
      r2Key: string
      retainUntil: string | null
      legalHold: string
      uploadAttempts: number
      reservationId: string | null
      updatedAt: string
      deletedAt: string | null
    }>()
}

/** その組織の録音が保管庫に置いた実体の数。手書きメモ（`notes/`）は数えない。 */
async function storedObjects(org: string): Promise<string[]> {
  const listed = await env.RECORDINGS.list({ prefix: `recordings/${org}/` })
  return listed.objects.map((object) => object.key).sort()
}

/** 1 本の録音に残った操作を古い順に。 */
async function auditActions(recordingId: string): Promise<string[]> {
  const found = await env.DB.prepare(
    "SELECT action FROM audit_events WHERE target_type = 'recording' AND target_id = ? ORDER BY occurred_at ASC, rowid ASC",
  )
    .bind(recordingId)
    .all<{ action: string }>()
  return found.results.map((row) => row.action)
}

describe('録音の開始', () => {
  it("受付セッションを指して作ると state='recording' と EY-R-NNNN が返る", async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)

    const recording = await startRecording(tenant, sessionId)
    expect(recording).toMatchObject({
      receptionSessionId: sessionId,
      state: 'recording',
      contentType: 'audio/mp4',
      legalHold: false,
      uploadAttempts: 0,
      retainUntil: null,
    })
    // 組織で通しの 4 桁ゼロ埋め。1 本目なので 0001 から始まる。
    expect(recording.code).toBe('EY-R-0001')
  })

  it('同じ受付セッションに 2 本目を作ろうとしても 1 本しか立たない', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)

    const first = await startRecording(tenant, sessionId)
    const second = await startRecording(tenant, sessionId)
    // 工程を戻しても画面が作り直しても、受付 1 回につき録音は 1 本である（AC-REC-02）。
    expect(second.id).toBe(first.id)
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM recordings WHERE organization_id = ? AND reception_session_id = ?',
    )
      .bind(tenant.org, sessionId)
      .first<{ n: number }>()
    expect(count?.n).toBe(1)
  })

  it('知らない受付セッションを指すと 404 not_found', async () => {
    const tenant = await recordingTenant()
    const denied = await callAs(tenant.token)('POST', '/api/staff/recordings', {
      receptionSessionId: crypto.randomUUID(),
      storeId: tenant.storeId,
      startedAt: FIXED_NOW,
    })
    expect(denied.status).toBe(404)
    expect(denied.body).toMatchObject({ error: 'not_found' })
  })
})

describe('本体の受け取り', () => {
  it("audio/mp4 を送ると R2 に 1 オブジェクトが増え state='stored' になる", async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)
    expect(await storedObjects(tenant.org)).toEqual([])

    const sent = await putContent(tenant.token, String(recording.id), { durationSeconds: 192 })
    expect(sent.status).toBe(200)
    expect(JSON.parse(sent.text)).toMatchObject({
      id: recording.id,
      state: 'stored',
      durationSeconds: 192,
      bytes: AUDIO.byteLength,
    })

    const keys = await storedObjects(tenant.org)
    expect(keys).toHaveLength(1)
    // 手書きメモ（`notes/`）と混ざらない前置。
    expect(keys[0]).toMatch(
      new RegExp(`^recordings/${tenant.org}/${tenant.storeId}/\\d{4}/\\d{2}/`),
    )
  })

  it('応答に r2Key もダウンロード URL も含まれない', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)

    const sent = await putContent(tenant.token, String(recording.id))
    expect(sent.status).toBe(200)
    // 生の本文で見る。型が通っただけでは剥がし忘れに気づけない。
    expect(sent.text).not.toContain('r2Key')
    expect(sent.text).not.toContain('recordings/')
    expect(sent.text).not.toContain('https://')

    const row = await recordingRow(String(recording.id))
    expect(row?.r2Key).toContain('recordings/')
  })

  it('成立予約の retainUntil は stored の 30 日後になる', async () => {
    const tenant = await recordingTenant()
    const reservationId = await insertReservation(tenant.org, {
      storeId: tenant.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      staffId: null,
    })
    const sessionId = await startSession(tenant.org, tenant.storeId, { reservationId })
    const recording = await startRecording(tenant, sessionId)

    expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)
    const row = await recordingRow(String(recording.id))
    expect(row?.reservationId).toBe(reservationId)
    // 実時刻を読まずに境界を見る。保管した時刻（updated_at）からの差だけを確かめる。
    expect(Date.parse(String(row?.retainUntil)) - Date.parse(String(row?.updatedAt))).toBe(
      RETAIN_BOOKED_MS,
    )
  })

  it('破棄受付の retainUntil は stored の 24 時間後になる', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId, { outcome: 'discarded' })
    const recording = await startRecording(tenant, sessionId)

    expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)
    const row = await recordingRow(String(recording.id))
    expect(row?.reservationId).toBeNull()
    expect(Date.parse(String(row?.retainUntil)) - Date.parse(String(row?.updatedAt))).toBe(
      RETAIN_DISCARDED_MS,
    )
  })

  it('100MB を 1 バイト超えると 413 payload_too_large', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)

    // 100MB を実際に流すとテストが端末ごと詰まるので、宣言された長さで断る
    // （宣言が無い / 嘘の場合は読みながら数えた実バイト数で断る）。
    const res = await SELF.fetch(`${BASE}/api/staff/recordings/${recording.id}/content`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${tenant.token}`,
        'content-type': 'audio/mp4',
        'content-length': '104857601',
      },
      body: AUDIO,
    })
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: 'payload_too_large' })

    // 413 も 1 回の送信失敗として数える（3 回でお知らせに上げる対象になる）。
    expect((await recordingRow(String(recording.id)))?.uploadAttempts).toBe(1)
    expect(await storedObjects(tenant.org)).toEqual([])
  })

  it('許可リストに無い Content-Type は 400', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)

    const sent = await putContent(tenant.token, String(recording.id), {
      contentType: 'audio/ogg',
    })
    expect(sent.status).toBe(400)
    expect(await storedObjects(tenant.org)).toEqual([])
  })
})

describe('保存の失敗', () => {
  it('failed へ落とすと upload_attempts が 1 増える', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)

    const patched = await callAs(tenant.token)('PATCH', `/api/staff/recordings/${recording.id}`, {
      state: 'failed',
      failureReason: '通信が切れました',
    })
    expect(patched.status).toBe(200)
    expect(patched.body).toMatchObject({ state: 'failed', uploadAttempts: 1 })
  })

  it('3 回目の失敗で alerts に 1 行だけ立つ（4 回目で増えない）', async () => {
    const tenant = await recordingTenant()
    const reservationId = await insertReservation(tenant.org, {
      storeId: tenant.storeId,
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      staffId: null,
    })
    const sessionId = await startSession(tenant.org, tenant.storeId, { reservationId })
    const recording = await startRecording(tenant, sessionId)
    const call = callAs(tenant.token)

    const countAlerts = async (): Promise<number> => {
      const row = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM alerts WHERE organization_id = ? AND code = 'recording.upload_failed' AND target_id = ?",
      )
        .bind(tenant.org, recording.id)
        .first<{ n: number }>()
      return row?.n ?? 0
    }

    for (const attempt of [1, 2]) {
      await call('PATCH', `/api/staff/recordings/${recording.id}`, { state: 'failed' })
      expect(await countAlerts()).toBe(0)
      await call('POST', `/api/staff/recordings/${recording.id}/retry`)
      expect(attempt).toBeGreaterThan(0)
    }
    await call('PATCH', `/api/staff/recordings/${recording.id}`, { state: 'failed' })
    expect(await countAlerts()).toBe(1)

    // 4 回目。**同じ原因で連打しない**（未解決の 1 行があれば作らない）。
    await call('POST', `/api/staff/recordings/${recording.id}/retry`)
    await call('PATCH', `/api/staff/recordings/${recording.id}`, { state: 'failed' })
    expect(await countAlerts()).toBe(1)

    const listed = await call('GET', `/api/staff/alerts?storeId=${tenant.storeId}`)
    expect(listed.status).toBe(200)
    const items = (listed.body as unknown as { items: Json[] }).items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      code: 'recording.upload_failed',
      severity: 'action',
      title: '録音の保存に3回失敗しました',
      targetType: 'recording',
      targetId: recording.id,
    })
    expect(String(items[0]?.body)).toContain(String(recording.code))
  })

  it('再送が成功すると stored になり、同じ R2 キーを上書きする', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)
    const call = callAs(tenant.token)

    // 1 回目は送れなかった。端末はまだ音声を持っている。
    await call('PATCH', `/api/staff/recordings/${recording.id}`, { state: 'failed' })
    const retried = await call('POST', `/api/staff/recordings/${recording.id}/retry`)
    expect(retried.status).toBe(200)
    expect(retried.body).toMatchObject({ state: 'uploading' })

    expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)
    expect((await recordingRow(String(recording.id)))?.state).toBe('stored')
    const firstKeys = await storedObjects(tenant.org)
    expect(firstKeys).toHaveLength(1)

    // 同じ録音をもう一度送っても、保管庫に 2 つ目が生まれない。
    // 1 録音 = 1 キー。分割も別名も作らない（キーが第 2 の冪等キーである）。
    expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)
    expect(await storedObjects(tenant.org)).toEqual(firstKeys)
  })

  it('stored の録音に retry を投げると 409 invalid_transition', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)
    expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)

    const denied = await callAs(tenant.token)('POST', `/api/staff/recordings/${recording.id}/retry`)
    expect(denied.status).toBe(409)
    expect(denied.body).toMatchObject({ error: 'invalid_transition' })
  })

  it('録り始めたばかりの録音に retry を投げても 409（戻せるのは送信の失敗からだけ）', async () => {
    // 「もう一度送る」は失敗の面にしか出ない操作である。まだ録っている録音を
    // `uploading` へ動かせると、端末が送り終える前にサーバが送信中を名乗る。
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)

    const denied = await callAs(tenant.token)('POST', `/api/staff/recordings/${recording.id}/retry`)
    expect(denied.status).toBe(409)
    expect(denied.body).toMatchObject({ error: 'invalid_transition' })
    expect((await recordingRow(String(recording.id)))?.state).toBe('recording')
  })

  it('保管済みの録音は 413 を返しても stored のまま（掃除が拾えない行を作らない）', async () => {
    // `failed` へ落とすと保持期限の掃除（`state='stored'` を引く）が二度と拾わず、
    // 実体だけが期限を過ぎても保管庫に残り続ける。**消し忘れは消しすぎと同じ事故**である。
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)
    expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)

    const res = await SELF.fetch(`${BASE}/api/staff/recordings/${recording.id}/content`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${tenant.token}`,
        'content-type': 'audio/mp4',
        'content-length': '104857601',
      },
      body: AUDIO,
    })
    expect(res.status).toBe(413)

    const row = await recordingRow(String(recording.id))
    expect(row?.state).toBe('stored')
    expect(row?.retainUntil).not.toBeNull()
  })

  it('失敗が 99 回を越えても upload_attempts は 99 で止まる（一覧が 500 に化けない）', async () => {
    // 契約の `Recording.uploadAttempts` は 0..99 である。5 分ごとの自動再送は
    // 8 時間あまりで 100 回に届くので、素直に +1 し続けると応答を組み立てる
    // `Recording.parse` が落ちる。**壊れるのは状態更新だけではない** — 桁のあふれた
    // 行が 1 本混ざるだけで `GET /api/staff/recordings` が組織まるごと 500 になり、
    // 「録音の保存に3回失敗しました」を追う側の一覧が読めなくなる。
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)
    const call = callAs(tenant.token)
    await env.DB.prepare('UPDATE recordings SET upload_attempts = 99 WHERE id = ?')
      .bind(recording.id)
      .run()

    await call('PATCH', `/api/staff/recordings/${recording.id}`, { state: 'uploading' })
    const failed = await call('PATCH', `/api/staff/recordings/${recording.id}`, { state: 'failed' })
    expect(failed.status, JSON.stringify(failed.body)).toBe(200)
    expect(failed.body).toMatchObject({ uploadAttempts: 99 })

    const listed = await call('GET', `/api/staff/recordings?storeId=${tenant.storeId}`)
    expect(listed.status).toBe(200)
    expect(listed.body.items).toHaveLength(1)
  })

  it('送り直しても最低保持期限は伸びない（消せない録音を作らない）', async () => {
    // 一度決まった期限を送り直しのたびに引き直すと、5 分ごとの再送を続けるだけで
    // 期限が前へ逃げ続け、削除が永久に 409 `recording_retained` で拒まれる。
    // `PATCH` 側は最初からこれを避けているので、本体の経路も同じ決めに揃える。
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)
    expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)

    // 先に決まっている期限。ここから動かないことを見る（**未来へ置く** —
    // 過ぎた期限を置くと、同じ D1 を共有する掃除のテストがこの 1 本を拾ってしまう）。
    const fixed = '2099-01-01T00:00:00.000Z'
    await env.DB.prepare('UPDATE recordings SET retain_until = ? WHERE id = ?')
      .bind(fixed, recording.id)
      .run()
    expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)
    expect((await recordingRow(String(recording.id)))?.retainUntil).toBe(fixed)
  })

  it('PATCH で stored へ進めた録音にも最低保持期限が付く', async () => {
    // 端末が「送り終えた」とだけ知らせてくる経路。ここで `retain_until` を書かないと、
    // 掃除の絞り込み（`retain_until IS NOT NULL`）から外れて永久に残る行ができる。
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)
    const call = callAs(tenant.token)

    await call('PATCH', `/api/staff/recordings/${recording.id}`, { state: 'uploading' })
    const stored = await call('PATCH', `/api/staff/recordings/${recording.id}`, { state: 'stored' })
    expect(stored.status).toBe(200)

    const row = await recordingRow(String(recording.id))
    expect(row?.state).toBe('stored')
    expect(Date.parse(String(row?.retainUntil)) - Date.parse(String(row?.updatedAt))).toBe(
      RETAIN_DISCARDED_MS,
    )
  })
})

describe('再生', () => {
  /** 保管済みの録音を 1 本。再生の 5 本が共通で要る足場。 */
  async function storedRecording() {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)
    expect(
      (await putContent(tenant.token, String(recording.id), { durationSeconds: 372 })).status,
    ).toBe(200)
    return { tenant, recordingId: String(recording.id) }
  }

  it('playback が 900 秒のチケットを返し、KV に play:<org>:<token> が 1 本置かれる', async () => {
    const { tenant, recordingId } = await storedRecording()
    const issued = await callAs(tenant.token)(
      'POST',
      `/api/staff/recordings/${recordingId}/playback`,
    )
    expect(issued.status).toBe(200)
    const token = String(issued.body.token)
    expect(token.length).toBeGreaterThanOrEqual(32)
    expect(issued.body).toMatchObject({ durationSeconds: 372 })

    // 900 秒（Q-06）。300 秒では 6分12秒 の録音を 1 回聞き通せない。
    const listed = await env.SHORT_LIVED.list({ prefix: `play:${tenant.org}:` })
    expect(listed.keys.map((key) => key.name)).toEqual([`play:${tenant.org}:${token}`])
    const held = await env.SHORT_LIVED.get(`play:${tenant.org}:${token}`)
    expect(JSON.parse(String(held))).toMatchObject({ recordingId, storeId: tenant.storeId })
    // 保管庫の鍵もダウンロード URL もチケットに載せない。
    expect(JSON.stringify(issued.body)).not.toContain('recordings/')
  })

  it('チケットつきの stream が音声そのものを返す（JSON ではない）', async () => {
    const { tenant, recordingId } = await storedRecording()
    const issued = await callAs(tenant.token)(
      'POST',
      `/api/staff/recordings/${recordingId}/playback`,
    )
    const res = await SELF.fetch(
      `${BASE}/api/staff/recordings/${recordingId}/stream?token=${issued.body.token}`,
      { headers: authed(tenant.token) },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mp4')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(AUDIO)
  })

  it('Range ヘッダーを付けると 206 と Content-Range が返る', async () => {
    const { tenant, recordingId } = await storedRecording()
    const issued = await callAs(tenant.token)(
      'POST',
      `/api/staff/recordings/${recordingId}/playback`,
    )
    const res = await SELF.fetch(
      `${BASE}/api/staff/recordings/${recordingId}/stream?token=${issued.body.token}`,
      { headers: { ...authed(tenant.token), range: 'bytes=4-7' } },
    )
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(`bytes 4-7/${AUDIO.byteLength}`)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(AUDIO.slice(4, 8))
  })

  it('Range の終端が実体より後ろでも Content-Range は実体に収まる', async () => {
    // `bytes 4-999/12` と答えると HTTP として不正で、`<audio>` の頭出しが壊れる。
    // R2 は要求より短い範囲を返すので、ヘッダーの終端も実体で頭打ちにする。
    const { tenant, recordingId } = await storedRecording()
    const issued = await callAs(tenant.token)(
      'POST',
      `/api/staff/recordings/${recordingId}/playback`,
    )
    const res = await SELF.fetch(
      `${BASE}/api/staff/recordings/${recordingId}/stream?token=${issued.body.token}`,
      { headers: { ...authed(tenant.token), range: 'bytes=4-999' } },
    )
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe(
      `bytes 4-${AUDIO.byteLength - 1}/${AUDIO.byteLength}`,
    )
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(AUDIO.slice(4))
  })

  it('チケット無しの stream は 401 unauthorized', async () => {
    const { tenant, recordingId } = await storedRecording()
    const res = await SELF.fetch(`${BASE}/api/staff/recordings/${recordingId}/stream`, {
      headers: authed(tenant.token),
    })
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'unauthorized' })
  })

  it('KV にもう無いチケットでは開けない（期限切れは 401 で断る）', async () => {
    const { tenant, recordingId } = await storedRecording()
    const issued = await callAs(tenant.token)(
      'POST',
      `/api/staff/recordings/${recordingId}/playback`,
    )
    // 900 秒を過ぎた鍵は KV が自分で捨てる。捨てられたあとを実時刻で待たずに作る。
    await env.SHORT_LIVED.delete(`play:${tenant.org}:${issued.body.token}`)

    const res = await SELF.fetch(
      `${BASE}/api/staff/recordings/${recordingId}/stream?token=${issued.body.token}`,
      { headers: authed(tenant.token) },
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'unauthorized' })
  })

  it('壊れたチケットは「無い」として断る（500 にしない）', async () => {
    // 読めない鍵で再生を通さないのはもちろん、**500 にもしない** —
    // 500 は `app.onError` の面になり、聞けない理由が受付に伝わらない。
    const { tenant, recordingId } = await storedRecording()
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')
    await env.SHORT_LIVED.put(`play:${tenant.org}:${token}`, 'これは JSON ではない', {
      expirationTtl: 900,
    })

    const res = await SELF.fetch(
      `${BASE}/api/staff/recordings/${recordingId}/stream?token=${token}`,
      { headers: authed(tenant.token) },
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'unauthorized' })
  })

  it('別の録音のチケットでは開けない', async () => {
    const { tenant, recordingId } = await storedRecording()
    const otherSession = await startSession(tenant.org, tenant.storeId)
    const other = await startRecording(tenant, otherSession)
    expect((await putContent(tenant.token, String(other.id))).status).toBe(200)

    const issued = await callAs(tenant.token)('POST', `/api/staff/recordings/${other.id}/playback`)
    const res = await SELF.fetch(
      `${BASE}/api/staff/recordings/${recordingId}/stream?token=${issued.body.token}`,
      { headers: authed(tenant.token) },
    )
    expect(res.status).toBe(401)
  })
})

describe('保全と削除', () => {
  it('hold を立てると legalHold が true になる', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)
    expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)

    const held = await callAs(tenant.token)('POST', `/api/staff/recordings/${recording.id}/hold`, {
      legalHold: true,
      reason: '当日のやり取りの確認を求められているため',
    })
    expect(held.status).toBe(200)
    expect(held.body).toMatchObject({ legalHold: true })
    expect((await recordingRow(String(recording.id)))?.legalHold).toBe('1')
  })

  it('期限内の削除は 409 recording_retained で retainUntil と legalHold を返す', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId, { outcome: 'discarded' })
    const recording = await startRecording(tenant, sessionId)
    expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)
    const row = await recordingRow(String(recording.id))

    const denied = await callAs(tenant.token)('DELETE', `/api/staff/recordings/${recording.id}`)
    expect(denied.status).toBe(409)
    expect(denied.body).toEqual({
      error: 'recording_retained',
      retainUntil: row?.retainUntil,
      legalHold: false,
    })
    // 拒まれたのだから、保管庫の実体も行も動いていない。
    expect(await storedObjects(tenant.org)).toHaveLength(1)
    expect((await recordingRow(String(recording.id)))?.state).toBe('stored')
  })

  it("期限後・保全なしの削除は R2 のオブジェクトを消して state='deleted' にする（行は残る）", async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId, { outcome: 'discarded' })
    const recording = await startRecording(tenant, sessionId)
    expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)
    // 24 時間と 1 秒を過ぎた形にする（境界そのものは `recording.time.test.ts`）。
    await env.DB.prepare('UPDATE recordings SET retain_until = ? WHERE id = ?')
      .bind('2020-01-01T00:00:00.000Z', recording.id)
      .run()

    const removed = await callAs(tenant.token)('DELETE', `/api/staff/recordings/${recording.id}`)
    expect(removed.status).toBe(200)
    expect(removed.body).toMatchObject({ id: recording.id, deleted: true })
    expect(await storedObjects(tenant.org)).toEqual([])

    // **行は消さない。**いつ消したかが分からなくなる。
    const row = await recordingRow(String(recording.id))
    expect(row?.state).toBe('deleted')
    expect(row?.deletedAt).not.toBeNull()
  })
})

describe('録音の一覧', () => {
  it('state=failed で絞ると失敗した録音だけが items / nextCursor / total の形で返る', async () => {
    const tenant = await recordingTenant()
    const call = callAs(tenant.token)
    const failed: string[] = []
    for (const index of [0, 1, 2]) {
      const sessionId = await startSession(tenant.org, tenant.storeId)
      const recording = await startRecording(tenant, sessionId)
      if (index === 2) {
        expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)
      } else {
        await call('PATCH', `/api/staff/recordings/${recording.id}`, { state: 'failed' })
        failed.push(String(recording.id))
      }
    }

    // 同じ時刻に立った録音は id で並ぶ（`(created_at, id)` の複合カーソル）。
    failed.sort()

    const listed = await call(
      'GET',
      `/api/staff/recordings?storeId=${tenant.storeId}&state=failed&limit=1`,
    )
    expect(listed.status).toBe(200)
    const page = listed.body as unknown as {
      items: Json[]
      nextCursor: string | null
      total: number
    }
    expect(page.total).toBe(2)
    expect(page.items.map((item) => item.id)).toEqual([failed[0]])
    expect(page.nextCursor).not.toBeNull()

    const next = await call(
      'GET',
      `/api/staff/recordings?storeId=${tenant.storeId}&state=failed&limit=1&cursor=${encodeURIComponent(String(page.nextCursor))}`,
    )
    const second = next.body as unknown as { items: Json[]; nextCursor: string | null }
    expect(second.items.map((item) => item.id)).toEqual([failed[1]])
    // 最後のページで空でないカーソルを返さない。
    expect(second.nextCursor).toBeNull()
  })
})

describe('録音の監査', () => {
  it('開始・保存・失敗・再生・保全・解除・削除が audit_events に 1 行ずつ残る', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId, { outcome: 'discarded' })
    const recording = await startRecording(tenant, sessionId)
    const call = callAs(tenant.token)
    const id = String(recording.id)

    await call('PATCH', `/api/staff/recordings/${id}`, { state: 'failed' })
    expect((await putContent(tenant.token, id)).status).toBe(200)
    await call('POST', `/api/staff/recordings/${id}/playback`)
    await call('POST', `/api/staff/recordings/${id}/hold`, {
      legalHold: true,
      reason: '確認のため',
    })
    await call('POST', `/api/staff/recordings/${id}/hold`, {
      legalHold: false,
      reason: '確認が済んだ',
    })
    await env.DB.prepare('UPDATE recordings SET retain_until = ? WHERE id = ?')
      .bind('2020-01-01T00:00:00.000Z', id)
      .run()
    expect((await call('DELETE', `/api/staff/recordings/${id}`)).status).toBe(200)

    expect(await auditActions(id)).toEqual([
      'recording.started',
      'recording.failed',
      'recording.stored',
      'recording.played',
      'recording.hold_set',
      'recording.hold_cleared',
      'recording.deleted',
    ])
  })

  it('再生は必ず残る（チケットを出すたびに 1 行）', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)
    expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)
    const call = callAs(tenant.token)

    for (const _ of [0, 1, 2]) {
      expect((await call('POST', `/api/staff/recordings/${recording.id}/playback`)).status).toBe(
        200,
      )
    }
    const played = (await auditActions(String(recording.id))).filter(
      (action) => action === 'recording.played',
    )
    // 聞いた回数だけ残る。**best-effort にしない**（誰が何回聞いたかが要る）。
    expect(played).toHaveLength(3)
  })

  it('1 本の録音に対する操作を時系列で引ける', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId)
    const recording = await startRecording(tenant, sessionId)
    expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)
    await callAs(tenant.token)('POST', `/api/staff/recordings/${recording.id}/playback`)

    const found = await env.DB.prepare(
      'SELECT action, actor_type AS actorType, occurred_at AS occurredAt, store_id AS storeId ' +
        "FROM audit_events WHERE organization_id = ? AND target_type = 'recording' AND target_id = ? " +
        'ORDER BY occurred_at ASC, rowid ASC',
    )
      .bind(tenant.org, recording.id)
      .all<{ action: string; actorType: string; occurredAt: string; storeId: string }>()

    expect(found.results.map((row) => row.action)).toEqual([
      'recording.started',
      'recording.stored',
      'recording.played',
    ])
    // 誰が・いつ・どの録音に、が 1 行ずつそろっている。
    for (const row of found.results) {
      expect(row.storeId).toBe(tenant.storeId)
      expect(Number.isNaN(Date.parse(row.occurredAt))).toBe(false)
    }
    // 端末が作ったのではない書き込み（保管の完了）は system として残す。
    expect(found.results.map((row) => row.actorType)).toEqual(['staff', 'system', 'staff'])
  })
})

describe('保守の掃除', () => {
  /** 掃除の対象になる録音を 1 本作り、保持期限を指定の時刻へ寄せる。 */
  async function agedRecording(
    tenant: { org: string; token: string; storeId: string },
    retainUntil: string,
  ): Promise<string> {
    const sessionId = await startSession(tenant.org, tenant.storeId, { outcome: 'discarded' })
    const recording = await startRecording(tenant, sessionId)
    expect((await putContent(tenant.token, String(recording.id))).status).toBe(200)
    await env.DB.prepare('UPDATE recordings SET retain_until = ? WHERE id = ?')
      .bind(retainUntil, recording.id)
      .run()
    return String(recording.id)
  }

  const purge = async (body: Json) => {
    const res = await SELF.fetch(`${BASE}/api/internal/maintenance/recordings/purge`, {
      method: 'POST',
      headers: INTERNAL_HEADERS,
      body: JSON.stringify(body),
    })
    return { status: res.status, body: (await res.json()) as never as Json }
  }

  it('保持期限を過ぎた録音の実体だけを消し、行は deleted として残す', async () => {
    const tenant = await recordingTenant()
    const expired = await agedRecording(tenant, '2026-08-01T00:00:00.000Z')

    const result = await purge({ now: '2026-08-27T02:08:00.000Z' })
    expect(result.status).toBe(200)
    expect(result.body).toMatchObject({ deleted: 1, skippedHeld: 0, failed: 0 })
    expect(Number(result.body.examined)).toBeGreaterThanOrEqual(1)

    const row = await recordingRow(expired)
    expect(row?.state).toBe('deleted')
    expect(await storedObjects(tenant.org)).toEqual([])
  })

  it('保全を立てた録音は期限を過ぎても消えず、外すと同じ掃除で消える', async () => {
    const tenant = await recordingTenant()
    const held = await agedRecording(tenant, '2026-08-01T00:00:00.000Z')
    await callAs(tenant.token)('POST', `/api/staff/recordings/${held}/hold`, {
      legalHold: true,
      reason: '照会に備えるため',
    })

    const first = await purge({ now: '2026-08-27T02:08:00.000Z' })
    expect(first.body).toMatchObject({ deleted: 0, skippedHeld: 1 })
    expect((await recordingRow(held))?.state).toBe('stored')
    expect(await storedObjects(tenant.org)).toHaveLength(1)

    await callAs(tenant.token)('POST', `/api/staff/recordings/${held}/hold`, {
      legalHold: false,
      reason: '照会が済んだため',
    })
    const second = await purge({ now: '2026-08-27T02:08:00.000Z' })
    expect(second.body).toMatchObject({ deleted: 1, skippedHeld: 0 })
    expect((await recordingRow(held))?.state).toBe('deleted')
  })

  it('保持期限がまだ来ていない録音には触らない', async () => {
    const tenant = await recordingTenant()
    const fresh = await agedRecording(tenant, '2026-09-30T00:00:00.000Z')

    const result = await purge({ now: '2026-08-27T02:08:00.000Z' })
    expect(result.body).toMatchObject({ deleted: 0 })
    expect((await recordingRow(fresh))?.state).toBe('stored')
    expect(await storedObjects(tenant.org)).toHaveLength(1)
  })

  it('24 時間動かない録音は failed に落ち、お知らせが 1 件立つ', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId, { outcome: 'discarded' })
    const recording = await startRecording(tenant, sessionId)
    // 録り始めたまま丸 1 日と 1 秒。端末はもう戻ってこない。
    await env.DB.prepare('UPDATE recordings SET created_at = ? WHERE id = ?')
      .bind('2026-08-26T02:07:59.000Z', recording.id)
      .run()

    const result = await purge({ now: '2026-08-27T02:08:00.000Z' })
    expect(result.status).toBe(200)
    expect((await recordingRow(String(recording.id)))?.state).toBe('failed')

    const alert = await env.DB.prepare(
      "SELECT title, severity, body FROM alerts WHERE organization_id = ? AND target_id = ? AND code = 'recording.upload_failed'",
    )
      .bind(tenant.org, recording.id)
      .all<{ title: string; severity: string; body: string | null }>()
    expect(alert.results).toHaveLength(1)
    expect(alert.results[0]).toMatchObject({
      title: '録音の保存に3回失敗しました',
      severity: 'action',
    })
  })

  it('一度お知らせを立てた録音は、次の掃除で枠を占め続けない', async () => {
    // `failed` の行は 24 時間の物差しから二度と外れない。候補のまま残すと、
    // 打ち切り済みの古い行が毎晩 `limit` を食い尽くし、**新しく動かなくなった録音に
    // いつまでも順番が回らない**（同じお知らせが毎晩立ち直りもする）。
    const tenant = await recordingTenant()
    const older = await startRecording(
      tenant,
      await startSession(tenant.org, tenant.storeId, { outcome: 'discarded' }),
    )
    const newer = await startRecording(
      tenant,
      await startSession(tenant.org, tenant.storeId, { outcome: 'discarded' }),
    )
    await env.DB.prepare('UPDATE recordings SET created_at = ? WHERE id = ?')
      .bind('2026-08-24T00:00:00.000Z', older.id)
      .run()
    await env.DB.prepare('UPDATE recordings SET created_at = ? WHERE id = ?')
      .bind('2026-08-25T00:00:00.000Z', newer.id)
      .run()

    // 1 晩に 1 本しか見ない設定でも、2 晩で 2 本とも片づく。
    await purge({ now: '2026-08-27T02:08:00.000Z', limit: 1 })
    expect((await recordingRow(String(older.id)))?.state).toBe('failed')
    await purge({ now: '2026-08-27T02:08:00.000Z', limit: 1 })
    expect((await recordingRow(String(newer.id)))?.state).toBe('failed')

    // 打ち切りのお知らせは 1 本につき 1 件のまま（毎晩立ち直らない）。
    const alerts = await env.DB.prepare(
      "SELECT target_id AS targetId FROM alerts WHERE organization_id = ? AND code = 'recording.upload_failed'",
    )
      .bind(tenant.org)
      .all<{ targetId: string }>()
    expect(alerts.results).toHaveLength(2)
  })

  it('24 時間で打ち切る録音は、送りかけの実体も保管庫に残さない', async () => {
    // 本体を R2 へ書いたあとで D1 の書き込みが落ちると、`stored` にならないまま
    // 実体だけが残る。掃除の 1 段目は `state='stored'` しか引かないので、この実体は
    // 二度と拾われず、**保持期限を持たない声**が保管庫に居座り続ける。
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId, { outcome: 'discarded' })
    const recording = await startRecording(tenant, sessionId)
    const key = String((await recordingRow(String(recording.id)))?.r2Key)
    await env.RECORDINGS.put(key, AUDIO)
    await env.DB.prepare('UPDATE recordings SET created_at = ? WHERE id = ?')
      .bind('2026-08-26T02:07:59.000Z', recording.id)
      .run()

    await purge({ now: '2026-08-27T02:08:00.000Z' })
    expect((await recordingRow(String(recording.id)))?.state).toBe('failed')
    expect(await env.RECORDINGS.head(key)).toBeNull()
  })

  it('打ち切る録音でも、保全が立っていれば実体を消さない', async () => {
    const tenant = await recordingTenant()
    const sessionId = await startSession(tenant.org, tenant.storeId, { outcome: 'discarded' })
    const recording = await startRecording(tenant, sessionId)
    const key = String((await recordingRow(String(recording.id)))?.r2Key)
    await env.RECORDINGS.put(key, AUDIO)
    await callAs(tenant.token)('POST', `/api/staff/recordings/${recording.id}/hold`, {
      legalHold: true,
      reason: '苦情の申し立てを調べているため',
    })
    await env.DB.prepare('UPDATE recordings SET created_at = ? WHERE id = ?')
      .bind('2026-08-26T02:07:59.000Z', recording.id)
      .run()

    await purge({ now: '2026-08-27T02:08:00.000Z' })
    expect(await env.RECORDINGS.head(key)).not.toBeNull()
  })

  it('掃除は手書きメモ（notes/）を巻き込まない', async () => {
    const tenant = await recordingTenant()
    await agedRecording(tenant, '2026-08-01T00:00:00.000Z')
    const noteKey = `notes/${tenant.org}/${crypto.randomUUID()}/${crypto.randomUUID()}.svg`
    await env.RECORDINGS.put(noteKey, '<svg/>')

    await purge({ now: '2026-08-27T02:08:00.000Z' })
    // 行が指すキーだけを消す。プレフィクス走査で消すと手書きが道連れになる。
    expect(await env.RECORDINGS.head(noteKey)).not.toBeNull()
  })

  it('共有鍵が無ければ保守の経路に入れない', async () => {
    const denied = await SELF.fetch(`${BASE}/api/internal/maintenance/recordings/purge`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    })
    expect(denied.status).toBe(401)
  })
})
