/**
 * 業務 API の**権限マトリクス**を表駆動で固定する。
 *
 * ゲートは default-deny（`/api/*` に一括適用）なので、ルートを足しただけで
 * 守られる。その性質が壊れていないことを、未知パスへのアクセスでも確かめる。
 * 期限切れは「権限なし(403)」ではなく「未認証(401)」に写像されなければならない
 * — クライアントの再ログイン判定がこの区別に依存している。
 *
 * 設定の**読み取りは店舗の誰でも、書き込みは `settings.manage` を持つ人だけ**（AC-SET-17）。
 * 判定は JWT の `role` ではなく `store_memberships` の許可リストで行うので、
 * 主体は「店長（settings.manage あり）」と「スタッフ（settings.read まで）」を別に立てる。
 *
 * 新しいルートを足したら、この表に 1 行足す。
 */
import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  BASE,
  createTerminal,
  INTERNAL_HEADERS,
  insertAlert,
  insertBusinessHours,
  insertReservation,
  insertShift,
  insertSlotRules,
  insertStaff,
  insertStore,
  insertVisitPurpose,
  JSON_HEADERS,
  JWT_SECRET,
  jstAt,
  LEDGER_DATE,
  orgId,
  setStaffPin,
  startSession as startTerminalSession,
  tokenFor,
} from './helpers'

type ActorName =
  | 'none'
  | 'staff'
  | 'admin'
  | 'manager'
  | 'clerk'
  | 'reader'
  | 'keeper'
  | 'expired'
  | 'wrong-secret'
  // P10: どちらも **manager と同じ JWT** で、違うのは端末セッションの状態だけである。
  // 「権限が足りない(403 forbidden)」と「個人モードが足りない(403 personal_mode_required)」を
  // 取り違えないことを、この 2 主体で表から見る。
  | 'shared-session'
  | 'personal-session'

const ORG = orgId()
const NOW = '2026-08-27T02:08:00.000Z'
/** 端末の店舗共通の暗証番号と、中村 彩 の暗証番号。どちらも弱くない 4 桁。 */
const TERMINAL_PIN = '4831'
const STAFF_PIN = '2748'
const tokens: Record<Exclude<ActorName, 'none'>, string> = {
  staff: '',
  admin: '',
  manager: '',
  clerk: '',
  reader: '',
  keeper: '',
  expired: '',
  'wrong-secret': '',
  'shared-session': '',
  'personal-session': '',
}

/** 表が叩く実在の行。設定の書き込みが 200 になる形を用意しておく。 */
const fixture = {
  storeId: '',
  staffId: '',
  equipmentId: '',
  maintenanceId: '',
  purposeId: '',
  exceptionId: '',
  // 台帳・空き枠・ご予約 1 件を叩くための、受付条件がそろった別の店舗。
  // 銀座店（`storeId`）は「予約の間隔がまだ無い店舗は 404」を表で見るために、
  // わざと未設定のままにしてある。同じ店舗を使い回すと表の行の順序に依存する。
  ledgerStoreId: '',
  reservationId: '',
  // P3 の 6 ルートが 200 で返る足場。受付セッションは 1 行を使い回すもの（下書きの保存）と、
  // 1 回しか閉じられないもの（やめる）を分けて持つ。
  ledgerPurposeId: '',
  receptionSessionId: '',
  closableSessionIds: [] as string[],
  // P4 の 11 ルートが 200 で返る足場。おまとめは 1 度しか通らないので、
  // 表の主体ぶん叩かれても状態が食い違わないよう専用の 2 件を分けて持つ。
  customerId: '',
  noteId: '',
  mergePrimaryId: '',
  mergeSecondaryId: '',
  // P5 の 7 ルートが 200 で返る足場。受付は店舗を書き込むので、同時受付の上限に
  // 余裕のある専用の店舗を持つ（表は主体 5 種ぶん叩くので、上限 3 の店舗だと
  // 主体の並び順で 409 に化ける）。
  walkinStoreId: '',
  walkinId: '',
  visitReservationId: '',
  // 取消は 1 件につき 1 度しか通らないので、表の主体ぶん（5 種）を分けて持つ。
  cancellableReservationIds: [] as string[],
  // P7 の 11 ルートが 200 で返る足場。状態を進める 3 本（本体・状態更新・再送）は
  // 1 行につき 1 度しか通らないので、表が叩く回数ぶん（主体 7 種）を分けて持つ。
  recordingSessionId: '',
  startableSessionId: '',
  contentRecordingIds: [] as string[],
  patchRecordingIds: [] as string[],
  retryRecordingIds: [] as string[],
  playbackRecordingId: '',
  streamRecordingId: '',
  streamTicket: '',
  holdRecordingId: '',
  deletableRecordingId: '',
  // P8 の 11 ルートが 200 で返る足場。公開面は未認証で通るので、店舗 slug と
  // 実在するご予約番号・確認番号を持っておかないと「通った」が見えない
  // （401 `invalid_management_code` は未認証の 401 と見分けが付かない）。
  webStoreId: '',
  webStoreSlug: '',
  webPurposeId: '',
  webStartsAt: '',
  webBookingCode: '',
  webManagementCode: '',
  reviewableWebBookingId: '',
  // P10 の 11 ルートが 200 で返る足場。
  // 端末は 2 台に分ける — 表の `POST .../sessions` が置き場所を引き継いで
  // 前のセッションを失効させるので、`personal-session` の足場を同じ台に置くと、
  // 表の行の順序で 403 personal_mode_required に化ける。
  terminalId: '',
  sessionTerminalId: '',
  sharedSessionId: '',
  personalSessionId: '',
  pinStaffId: '',
  alertId: '',
}

/** dev グラントが載せる `sub`。membership の `userId` はこれに合わせる。 */
const subOf = (org: string, suffix = '') => `dev:${org}${suffix}`

async function syncMembership(org: string, storeId: string, userId: string, permissions: string[]) {
  await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      organizationId: org,
      storeId,
      userId,
      permissions,
      createdAt: NOW,
    }),
  })
}

beforeAll(async () => {
  tokens.staff = await tokenFor(ORG, 'staff')
  tokens.admin = await tokenFor(ORG, 'admin')
  // 店長とスタッフは同じ組織の別人。dev グラントは組織ごとに 1 つの sub しか作らないので、
  // 2 人ぶんのトークンは署名から自分で作る。
  tokens.manager = await signAccessToken(
    { sub: subOf(ORG, ':manager'), org: ORG, email: 'manager@example.test', role: 'staff' },
    JWT_SECRET,
  )
  tokens.clerk = await signAccessToken(
    { sub: subOf(ORG, ':clerk'), org: ORG, email: 'clerk@example.test', role: 'staff' },
    JWT_SECRET,
  )
  // P10 の 2 主体は **manager と同じ JWT** を持ち、違いは `x-terminal-session` だけ。
  tokens['shared-session'] = tokens.manager
  tokens['personal-session'] = tokens.manager
  // 録音は閲覧（再生・一覧）と保全（保全・削除）で権限が分かれる（Q-03）。
  // 2 つを 1 人に持たせると「読めるが消せない」が表から消えるので、別々の人にする。
  tokens.reader = await signAccessToken(
    { sub: subOf(ORG, ':reader'), org: ORG, email: 'reader@example.test', role: 'staff' },
    JWT_SECRET,
  )
  tokens.keeper = await signAccessToken(
    { sub: subOf(ORG, ':keeper'), org: ORG, email: 'keeper@example.test', role: 'staff' },
    JWT_SECRET,
  )
  // 期限切れは固定の過去時刻から作る（`now` を引数で注入するので実時刻に依存しない）。
  const issuedAt = Math.floor(Date.parse('2020-01-01T00:00:00.000Z') / 1000)
  tokens.expired = await signAccessToken(
    { sub: 'dev:expired', org: ORG, email: 'a@example.test', role: 'staff' },
    JWT_SECRET,
    1,
    issuedAt,
  )
  tokens['wrong-secret'] = await signAccessToken(
    { sub: 'dev:other', org: ORG, email: 'a@example.test', role: 'staff' },
    'another-secret-entirely',
  )

  fixture.storeId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO stores (id, organization_id, name, slug, phone, address, access_note, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      fixture.storeId,
      ORG,
      'EYEX 銀座店',
      `ginza-${crypto.randomUUID().slice(0, 8)}`,
      '',
      '',
      '',
      '1',
      NOW,
    )
    .run()
  // 店長は分析も開ける（`analytics.read`）。持たないスタッフは 403 になる。
  // 端末の管理と監査の読み返しも店長が持つ（membership は org × store × user で 1 行なので、
  // ここで 1 度に渡す。2 度に分けると unique 制約でぶつかって後の 1 回が落ちる）。
  await syncMembership(ORG, fixture.storeId, subOf(ORG, ':manager'), [
    'settings.read',
    'settings.manage',
    'analytics.read',
    'terminal.manage',
    'audit.read',
  ])
  await syncMembership(ORG, fixture.storeId, subOf(ORG, ':clerk'), ['settings.read'])
  await syncMembership(ORG, fixture.storeId, subOf(ORG, ':reader'), ['recording.read'])
  await syncMembership(ORG, fixture.storeId, subOf(ORG, ':keeper'), ['recording.manage'])

  fixture.staffId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO staff (id, organization_id, store_id, display_name, role, max_parallel_reservations, is_active, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(fixture.staffId, ORG, fixture.storeId, '佐藤 美咲', 'staff', 1, '1', 0, NOW, NOW)
    .run()

  fixture.equipmentId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO equipment (id, organization_id, store_id, name, kind, role_label, capacity, is_active, ledger_display, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      fixture.equipmentId,
      ORG,
      fixture.storeId,
      '視力測定機 A',
      'measure',
      '視力測定',
      1,
      '1',
      'grey',
      0,
      NOW,
      NOW,
    )
    .run()

  fixture.maintenanceId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO equipment_maintenance (id, organization_id, store_id, equipment_id, starts_at, ends_at, note, created_at) VALUES (?,?,?,?,?,?,?,?)',
  )
    .bind(
      fixture.maintenanceId,
      ORG,
      fixture.storeId,
      fixture.equipmentId,
      '2026-08-28T01:00:00.000Z',
      '2026-08-28T03:00:00.000Z',
      '定期点検',
      NOW,
    )
    .run()

  fixture.exceptionId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO store_calendar_exceptions (id, organization_id, store_id, date, kind, note, created_at) VALUES (?,?,?,?,?,?,?)',
  )
    .bind(fixture.exceptionId, ORG, fixture.storeId, '2026-09-30', 'closed', '棚卸しのため', NOW)
    .run()

  fixture.purposeId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO visit_purposes (id, organization_id, store_id, name_internal, name_public, name_short, duration_minutes, is_web_published, is_active, sort_order, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(
      fixture.purposeId,
      ORG,
      fixture.storeId,
      'メガネを新しく作る',
      '新しいメガネを作る',
      '新調相談',
      60,
      '1',
      '1',
      0,
      1,
      NOW,
      NOW,
    )
    .run()

  // P2 の 3 本（台帳・空き枠・ご予約 1 件）が 200 で返る足場。
  // 予約を書く API は P3 なので、材料は `helpers.ts` の直 INSERT で置く。
  fixture.ledgerStoreId = await insertStore(ORG, 'EYEX 台帳確認店')
  await insertBusinessHours(ORG, fixture.ledgerStoreId)
  await insertSlotRules(ORG, fixture.ledgerStoreId)
  fixture.ledgerPurposeId = await insertVisitPurpose(ORG, fixture.ledgerStoreId, {
    nameInternal: '今のメガネを調整したい',
    nameShort: '調整',
    durationMinutes: 20,
  })
  const ledgerPurpose = fixture.ledgerPurposeId
  // ご予約の確定は 8 条件（`domain/availability.ts`）を通るので、接客できる担当が
  // 1 名は勤務している必要がある。居ないと 409 `purpose_unavailable` になり、
  // この表が見たい「権限では落ちない」がその 409 に隠れる。
  const ledgerStaffId = await insertStaff(ORG, fixture.ledgerStoreId, {
    displayName: '中村 彩',
  })
  await insertShift(ORG, fixture.ledgerStoreId, ledgerStaffId)
  fixture.reservationId = await insertReservation(ORG, {
    storeId: fixture.ledgerStoreId,
    startsAt: jstAt(LEDGER_DATE, '11:00'),
    durationMinutes: 30,
    staffId: null,
    purposes: [{ id: ledgerPurpose }],
  })

  // 受付セッションは進行中の行が要る。下書きの保存は同じ行を何度でも受けるので 1 行、
  // やめるのは 1 行につき 1 度しか通らないので、表が叩く回数（主体 5 種）ぶん用意する。
  const startSession = async (): Promise<string> => {
    const id = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO reception_sessions (id, organization_id, store_id, reservation_id, terminal_id, actor_id, started_at, ended_at, outcome, draft_json, created_at) VALUES (?,?,?,NULL,NULL,NULL,?,NULL,NULL,NULL,?)',
    )
      .bind(id, ORG, fixture.ledgerStoreId, NOW, NOW)
      .run()
    return id
  }
  fixture.receptionSessionId = await startSession()
  for (const _ of [0, 1, 2, 3, 4]) fixture.closableSessionIds.push(await startSession())

  // P4 の足場。お客様の行は組織単位で 1 本なので店舗に紐づけない。
  const seedCustomer = async (name: string, customerNumber: string): Promise<string> => {
    const id = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO customers (id, organization_id, customer_number, name, kana, phone, phone_normalized, phone_last4, email, birth_date, address, memo, first_visit_at, last_visit_at, visit_count, merged_into_id, version, created_store_id, created_terminal_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,NULL,NULL,0,NULL,1,NULL,NULL,?,?)',
    )
      .bind(
        id,
        ORG,
        customerNumber,
        name,
        'たなか はなこ',
        '090-1234-5678',
        '09012345678',
        '5678',
        '',
        NOW,
        NOW,
      )
      .run()
    return id
  }
  fixture.customerId = await seedCustomer('田中 花子', 'G-01842')
  fixture.mergePrimaryId = await seedCustomer('田中 花子', 'G-01843')
  fixture.mergeSecondaryId = await seedCustomer('田中 花子', 'G-02310')
  fixture.noteId = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO customer_notes (id, organization_id, customer_id, store_id, kind, body, handwriting_key, author_id, revision, status, created_at, updated_at) VALUES (?,?,?,?,'memo',?,NULL,NULL,1,'draft',?,?)",
  )
    .bind(fixture.noteId, ORG, fixture.customerId, fixture.storeId, '覚えておくこと', NOW, NOW)
    .run()

  // P5 の足場。ウォークインは 1 行を PATCH で使い回し（版は送る直前に読み直す）、
  // 工程は追記だけなので同じご予約へ何度でも積める。
  fixture.walkinStoreId = await insertStore(ORG, 'EYEX 受付確認店')
  await insertBusinessHours(ORG, fixture.walkinStoreId)
  await insertSlotRules(ORG, fixture.walkinStoreId, { maxParallel: 8 })
  const walkinStaffId = await insertStaff(ORG, fixture.walkinStoreId, { displayName: '伊藤 健' })
  await insertShift(ORG, fixture.walkinStoreId, walkinStaffId)
  fixture.visitReservationId = await insertReservation(ORG, {
    storeId: fixture.walkinStoreId,
    startsAt: jstAt(LEDGER_DATE, '14:00'),
    durationMinutes: 30,
    staffId: null,
  })
  const seededWalkinReservation = await insertReservation(ORG, {
    storeId: fixture.walkinStoreId,
    startsAt: jstAt(LEDGER_DATE, '15:00'),
    durationMinutes: 20,
    source: 'walkin',
    staffId: null,
  })
  // 取消は 1 件につき 1 度しか通らない。P5 の「ご来店がなかった」と P6 の「理由を選んで
  // 取り消す」がそれぞれ主体 5 種ぶん食べるので、10 件を先に積んでおく。
  for (const _ of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    fixture.cancellableReservationIds.push(
      await insertReservation(ORG, {
        storeId: fixture.walkinStoreId,
        startsAt: jstAt(LEDGER_DATE, '17:00'),
        durationMinutes: 20,
        staffId: null,
      }),
    )
  }
  fixture.walkinId = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO walk_ins (id, organization_id, store_id, visit_date, ticket_no, arrived_at, purpose_id, purpose_note, customer_id, reservation_id, status, left_at, version, created_at) VALUES (?,?,?,?,?,?,NULL,?,NULL,?,'waiting',NULL,1,?)",
  )
    .bind(
      fixture.walkinId,
      ORG,
      fixture.walkinStoreId,
      LEDGER_DATE,
      900,
      jstAt(LEDGER_DATE, '15:02'),
      'フレームの相談',
      seededWalkinReservation,
      jstAt(LEDGER_DATE, '15:02'),
    )
    .run()

  // P7 の足場。録音の行と保管庫の実体を直に置く（開始の API は表そのものが叩くので、
  // 足場づくりに使うと行の順序で表の期待値が動く）。
  fixture.recordingSessionId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO reception_sessions (id, organization_id, store_id, reservation_id, terminal_id, actor_id, started_at, ended_at, outcome, draft_json, created_at) VALUES (?,?,?,NULL,NULL,NULL,?,NULL,NULL,NULL,?)',
  )
    .bind(fixture.recordingSessionId, ORG, fixture.storeId, NOW, NOW)
    .run()

  fixture.startableSessionId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO reception_sessions (id, organization_id, store_id, reservation_id, terminal_id, actor_id, started_at, ended_at, outcome, draft_json, created_at) VALUES (?,?,?,NULL,NULL,NULL,?,NULL,NULL,NULL,?)',
  )
    .bind(fixture.startableSessionId, ORG, fixture.storeId, NOW, NOW)
    .run()

  let recordingSeq = 0
  const seedRecording = async (state: string, retainUntil: string | null): Promise<string> => {
    const id = crypto.randomUUID()
    recordingSeq += 1
    const key = `recordings/${ORG}/${fixture.storeId}/2026/08/${id}.m4a`
    await env.DB.prepare(
      'INSERT INTO recordings (id, organization_id, store_id, code, reception_session_id, reservation_id, r2_key, content_type, duration_seconds, bytes, state, retain_until, legal_hold, upload_attempts, created_at, updated_at, deleted_at) ' +
        "VALUES (?,?,?,?,?,NULL,?,'audio/mp4',192,4,?,?,'0',0,?,?,NULL)",
    )
      .bind(
        id,
        ORG,
        fixture.storeId,
        `EY-R-${String(9000 + recordingSeq)}`,
        fixture.recordingSessionId,
        key,
        state,
        retainUntil,
        NOW,
        NOW,
      )
      .run()
    await env.RECORDINGS.put(key, new Uint8Array([1, 2, 3, 4]))
    return id
  }

  // 表は主体 7 種ぶん同じ行を叩く。状態が 1 度しか進まない 3 本は 1 主体 1 行にする。
  for (const _ of [0, 1, 2, 3, 4, 5, 6]) {
    fixture.contentRecordingIds.push(await seedRecording('recording', null))
    fixture.patchRecordingIds.push(await seedRecording('recording', null))
    fixture.retryRecordingIds.push(await seedRecording('failed', null))
  }
  fixture.playbackRecordingId = await seedRecording('stored', '2026-09-30T00:00:00.000Z')
  fixture.streamRecordingId = await seedRecording('stored', '2026-09-30T00:00:00.000Z')
  fixture.holdRecordingId = await seedRecording('stored', '2026-09-30T00:00:00.000Z')
  // 消せるのは最低保持期限を過ぎたものだけ。表が見たいのは「権限で落ちない」ことなので、
  // 409 `recording_retained` に化けないよう期限を過去へ置く。
  fixture.deletableRecordingId = await seedRecording('stored', '2020-01-01T00:00:00.000Z')

  // ストリームは Authorization の**上乗せ**でチケットを要求する。表で見たいのは
  // 権限のほうなので、チケットは先に置いておく（無いと `recording.read` を持つ人まで 401）。
  fixture.streamTicket = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')
  await env.SHORT_LIVED.put(
    `play:${ORG}:${fixture.streamTicket}`,
    JSON.stringify({
      recordingId: fixture.streamRecordingId,
      storeId: fixture.storeId,
      staffId: null,
    }),
    { expirationTtl: 900 },
  )

  /* --- P8 お客様向け Web 予約 --- */
  // 受付の窓（何時間先から・何日先まで）は実時刻を見るので、`LEDGER_DATE`（過去の 1 日）
  // では 409 `store_closed` に化ける。この店舗だけは「きょうから 1 週間先」で組む。
  fixture.webStoreId = await insertStore(ORG, 'EYEX Web受付店')
  fixture.webStoreSlug = `web-${crypto.randomUUID().slice(0, 12)}`
  await env.DB.prepare('UPDATE stores SET slug = ?, name_public = ?, sort_order = ? WHERE id = ?')
    .bind(fixture.webStoreSlug, 'EYEX 銀座店', 900, fixture.webStoreId)
    .run()
  await insertBusinessHours(ORG, fixture.webStoreId, { closedWeekdays: [] })
  await insertSlotRules(ORG, fixture.webStoreId)
  fixture.webPurposeId = await insertVisitPurpose(ORG, fixture.webStoreId, {
    nameInternal: 'メガネ新調',
    nameShort: '新調',
    durationMinutes: 30,
  })
  const webStaffId = await insertStaff(ORG, fixture.webStoreId, { displayName: '山本 遥' })
  for (let day = 0; day <= 10; day += 1) {
    await insertShift(ORG, fixture.webStoreId, webStaffId, { date: futureDate(day) })
  }
  await env.DB.prepare(
    'INSERT INTO web_booking_settings (id, organization_id, store_id, is_published, opens_at, ' +
      'closes_at, accept_from_hours, accept_until_days, change_deadline_days, requires_approval, ' +
      "message, version, updated_at, created_at) VALUES (?,?,?,'1','10:30','18:00',2,30,1,'1',NULL,1,?,?)",
  )
    .bind(crypto.randomUUID(), ORG, fixture.webStoreId, NOW, NOW)
    .run()
  fixture.webStartsAt = jstAt(futureDate(7), '11:00')

  // 承認の表が 1 度だけ通る「確認待ち」と、本人確認の表が使う番号 2 つ。
  const created = await SELF.fetch(`${BASE}/api/public/stores/${fixture.webStoreSlug}/bookings`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, 'idempotency-key': crypto.randomUUID() },
    body: JSON.stringify({
      purposeId: fixture.webPurposeId,
      startsAt: jstAt(futureDate(8), '11:00'),
      contactName: '山口 真央',
      contactKana: 'やまぐち まお',
      contactPhone: '080-2345-6789',
      contactEmail: 'm.yamaguchi@example.jp',
    }),
  })
  const receipt = (await created.json()) as { code: string; managementCode: string }
  fixture.webBookingCode = receipt.code
  fixture.webManagementCode = receipt.managementCode
  fixture.reviewableWebBookingId =
    (
      await env.DB.prepare(
        'SELECT id FROM web_bookings WHERE organization_id = ? AND public_code = ?',
      )
        .bind(ORG, receipt.code)
        .first<{ id: string }>()
    )?.id ?? crypto.randomUUID()

  /* --- P10 端末・監査・お知らせ --- */
  // 自動ロックは上限の 1800 秒にする。既定の 120 秒だと、表を流し切る前に
  // `personal-session` の足場が期限切れになり、403 のはずが 403 の別の理由で通る。
  const terminal = await createTerminal(tokens.manager, {
    storeId: fixture.storeId,
    name: '銀座店 レジ横iPad',
    pin: TERMINAL_PIN,
    autoLockSeconds: 1800,
  })
  fixture.terminalId = String(terminal.body?.id ?? crypto.randomUUID())
  const sessionTerminal = await createTerminal(tokens.manager, {
    storeId: fixture.storeId,
    name: '銀座店 受付台iPad',
    pin: TERMINAL_PIN,
    autoLockSeconds: 1800,
  })
  fixture.sessionTerminalId = String(sessionTerminal.body?.id ?? crypto.randomUUID())

  fixture.pinStaffId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO staff (id, organization_id, store_id, display_name, role, max_parallel_reservations, is_active, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(fixture.pinStaffId, ORG, fixture.storeId, '中村 彩', 'staff', 1, '1', 1, NOW, NOW)
    .run()
  await setStaffPin(tokens.manager, fixture.storeId, fixture.pinStaffId, STAFF_PIN)

  // 共有と個人の 2 つの足場。**別々の端末に置く**（1 端末に生きたセッションは 1 本だけ）。
  const shared = await startTerminalSession(tokens.manager, fixture.terminalId, {
    mode: 'shared',
    pin: TERMINAL_PIN,
  })
  fixture.sharedSessionId = String(shared.body?.id ?? crypto.randomUUID())
  const personalTerminal = await createTerminal(tokens.manager, {
    storeId: fixture.storeId,
    name: '佐藤 美咲の iPad',
    kind: 'personal',
    autoLockSeconds: 1800,
  })
  const personal = await startTerminalSession(tokens.manager, String(personalTerminal.body?.id), {
    mode: 'personal',
    staffId: fixture.pinStaffId,
    pin: STAFF_PIN,
  })
  fixture.personalSessionId = String(personal.body?.id ?? crypto.randomUUID())

  fixture.alertId = await insertAlert(ORG, fixture.storeId)
})

/** 端末の版。表の主体が順に更新するので、送る直前に読み直す。 */
async function currentTerminalVersion(): Promise<number> {
  const row = await env.DB.prepare('SELECT version FROM terminals WHERE id = ?')
    .bind(fixture.terminalId)
    .first<{ version: number }>()
  return row?.version ?? 1
}

/** 取消の表が 1 行ずつ食べるご予約。使い切ったら「無いご予約」を指す。 */
function nextCancellableReservation(): string {
  return fixture.cancellableReservationIds.shift() ?? crypto.randomUUID()
}

/** やめるの表が 1 行ずつ食べる受付。使い切ったら「無い受付」を指す（401 の主体も 1 つ食べる）。 */
function nextClosableSession(): string {
  return fixture.closableSessionIds.shift() ?? crypto.randomUUID()
}

/** 録音の表が 1 行ずつ食べる録音。使い切ったら「無い録音」を指す。 */
function nextRecording(pool: string[]): string {
  return pool.shift() ?? crypto.randomUUID()
}

function headersFor(actor: ActorName): HeadersInit {
  if (actor === 'none') return JSON_HEADERS
  const base = { ...JSON_HEADERS, authorization: `Bearer ${tokens[actor]}` }
  // 端末セッションは JWT に載らない（同じ人が共有端末と個人端末を持ち替える）。
  // どのセッションで叩いているかは `x-terminal-session` で運ぶ。
  if (actor === 'shared-session') {
    return { ...base, 'x-terminal-session': fixture.sharedSessionId }
  }
  if (actor === 'personal-session') {
    return { ...base, 'x-terminal-session': fixture.personalSessionId }
  }
  return base
}

/** いまの設定の版。店長の保存が 1 行ごとに版を進めるので、送る直前に読み直す。 */
async function currentVersion(): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT version FROM store_settings_revision WHERE organization_id = ? AND store_id = ?',
  )
    .bind(ORG, fixture.storeId)
    .first<{ version: number }>()
  return row?.version ?? 1
}

/** 目的だけは行そのものの版で衝突を見る（チェーン共通の行があるため）。 */
async function currentPurposeVersion(): Promise<number> {
  const row = await env.DB.prepare('SELECT version FROM visit_purposes WHERE id = ?')
    .bind(fixture.purposeId)
    .first<{ version: number }>()
  return row?.version ?? 1
}

/** お客様の版。表の主体が順に保存するので、送る直前に読み直す。 */
async function currentCustomerVersion(): Promise<number> {
  const row = await env.DB.prepare('SELECT version FROM customers WHERE id = ?')
    .bind(fixture.customerId)
    .first<{ version: number }>()
  return row?.version ?? 1
}

/** ウォークインの版。表の主体が順に PATCH するので、送る直前に読み直す。 */
async function currentWalkinVersion(): Promise<number> {
  const row = await env.DB.prepare('SELECT version FROM walk_ins WHERE id = ?')
    .bind(fixture.walkinId)
    .first<{ version: number }>()
  return row?.version ?? 1
}

/** ご予約の版。表の主体が順に変更するので、送る直前に読み直す。 */
async function currentReservationVersion(): Promise<number> {
  const row = await env.DB.prepare('SELECT version FROM reservations WHERE id = ?')
    .bind(fixture.reservationId)
    .first<{ version: number }>()
  return row?.version ?? 1
}

/** メモの改訂。読み取った文字を直すたびに +1 される。 */
async function currentNoteRevision(): Promise<number> {
  const row = await env.DB.prepare('SELECT revision FROM customer_notes WHERE id = ?')
    .bind(fixture.noteId)
    .first<{ revision: number }>()
  return row?.revision ?? 1
}

type Row = {
  name: string
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  path: () => string
  body?: () => Promise<unknown> | unknown
  /** 主体のトークンに足すヘッダー（`Idempotency-Key` など）。 */
  headers?: () => Record<string, string>
  expected: Partial<Record<ActorName, number>>
}

/** 読み取りは店舗の誰でも通る。未認証・期限切れ・別 secret だけが 401。 */
const READ = {
  none: 401,
  staff: 200,
  manager: 200,
  clerk: 200,
  expired: 401,
  'wrong-secret': 401,
} as const
/** 書き込みは `settings.manage` を持つ店長だけ。持たない人は 403（401 にしない）。 */
const WRITE = {
  none: 401,
  staff: 403,
  manager: 200,
  clerk: 403,
  expired: 401,
  'wrong-secret': 401,
} as const

/**
 * 台帳・空き枠・ご予約 1 件は**読み取りだけ**の面なので、店舗の membership を要求しない
 * （`store_memberships` を見るのは設定の保存だけ。AC-SET-17）。したがってこの 3 本に
 * 403 の行は無く、落ちるのは未認証・期限切れ・別 secret 署名の 401 だけである。
 */
const LEDGER_READ = {
  none: 401,
  staff: 200,
  admin: 200,
  manager: 200,
  clerk: 200,
  expired: 401,
  'wrong-secret': 401,
} as const

/**
 * ご予約の受付（P3 の 6 ルート）は**店長限定ではない**。お電話を取った人がそのまま
 * 受け切る面なので、`store_memberships` の許可リストを見ない。403 の行は 1 つも無く、
 * 落ちるのは未認証・期限切れ・別 secret 署名の 401 だけである。
 */
const BOOKING = {
  none: 401,
  staff: 200,
  admin: 200,
  expired: 401,
  'wrong-secret': 401,
} as const
/** 対象が無いときは 404。**権限では落とさない**（403 で存在を漏らさないのと同じ考え）。 */
const BOOKING_MISSING = {
  none: 401,
  staff: 404,
  admin: 404,
  expired: 401,
  'wrong-secret': 401,
} as const

/**
 * 顧客台帳の 9 本は**店長限定ではない**。お電話を取った人がそのまま探して登録する面なので、
 * `store_memberships` の許可リストを見ない。403 の行は 1 つも無い。
 * **他店で書かれた度数・手書き・履歴にも権限を足さない**（お客様の行は組織単位で 1 本）。
 */
const CUSTOMER = {
  none: 401,
  staff: 200,
  admin: 200,
  manager: 200,
  clerk: 200,
  expired: 401,
  'wrong-secret': 401,
} as const

/**
 * おまとめ（下見と実行）だけが店長のものである。
 * 店長は `StorePermission` の `settings.manage` を持つ人で、**JWT の `role` では決まらない** —
 * `admin` の行が 403 なのはそのためで、`requireRole('admin')` を店長判定に使っていない証拠になる。
 * 下見も閉じるのは、AC-CUST-16 が「入口が画面のどこにも出ず」と要求するからである。
 */
const MERGE = {
  none: 401,
  staff: 403,
  admin: 403,
  manager: 200,
  clerk: 403,
  expired: 401,
  'wrong-secret': 401,
} as const

/**
 * 録音の受付そのもの（開始・本体・状態更新・再送）は**権限を要求しない**。
 * お電話を取った人がそのまま録り始める操作なので、`store_memberships` を見ない
 * （`04-api.md` §2.2 が権限を挙げているのは一覧・再生・保全・削除の 4 つだけ）。
 */
const RECORDING_OPEN = {
  none: 401,
  staff: 200,
  admin: 200,
  manager: 200,
  clerk: 200,
  reader: 200,
  keeper: 200,
  expired: 401,
  'wrong-secret': 401,
} as const

/**
 * 一覧・再生・ストリームは `recording.read`（Q-03 のいまの前提でサーバが強制する）。
 * `recording.manage` しか持たない人（`keeper`）が 403 になることまで見る —
 * 2 つを 1 つの権限に畳むと「消せる人は何でも聞ける」になる。
 */
const RECORDING_READ = {
  none: 401,
  staff: 403,
  admin: 403,
  manager: 403,
  clerk: 403,
  reader: 200,
  keeper: 403,
  expired: 401,
  'wrong-secret': 401,
} as const

/** 保全と削除は `recording.manage`。聞けるだけの人（`reader`）は 403。 */
const RECORDING_MANAGE = {
  none: 401,
  staff: 403,
  admin: 403,
  manager: 403,
  clerk: 403,
  reader: 403,
  keeper: 200,
  expired: 401,
  'wrong-secret': 401,
} as const

/** お知らせは店舗の誰でも読める（ALERTS は受付の面で、店長に絞らない）。 */
const ALERT_READ = {
  none: 401,
  staff: 200,
  admin: 200,
  manager: 200,
  clerk: 200,
  reader: 200,
  keeper: 200,
  expired: 401,
  'wrong-secret': 401,
} as const

/** 保守は共有鍵の経路。テナントのトークンは、どれだけ権限を持っていても越えられない。 */
const MAINTENANCE = {
  none: 401,
  staff: 401,
  admin: 401,
  manager: 401,
  clerk: 401,
  reader: 401,
  keeper: 401,
  expired: 401,
  'wrong-secret': 401,
} as const

/**
 * 公開面（`/api/public/**`）は**未認証で通る**。default-deny の例外に入っているので、
 * トークンを付けても・期限が切れていても・別の secret で署名されていても答えが変わらない。
 * 401 の行が 1 つも無いことがそのまま「未認証で通る」の証明になる。
 */
const PUBLIC = {
  none: 200,
  staff: 200,
  admin: 200,
  manager: 200,
  clerk: 200,
  expired: 200,
  'wrong-secret': 200,
} as const

/** 公開面の未知パスは、未認証のまま 404 になる（401 に化けたら例外が効いていない）。 */
const PUBLIC_MISSING = {
  none: 404,
  staff: 404,
  admin: 404,
  manager: 404,
  clerk: 404,
  expired: 404,
  'wrong-secret': 404,
} as const

/**
 * 分析は `analytics.read` を持つ人だけ。持たない人は 403（401 にしない）。
 * 別 org のトークンも 403 で、**その店舗が在ることを 404 で漏らさない**。
 */
const ANALYTICS = {
  none: 401,
  staff: 403,
  admin: 403,
  manager: 200,
  clerk: 403,
  reader: 403,
  keeper: 403,
  expired: 401,
  'wrong-secret': 401,
} as const

/** きょうから N 日先の JST 暦日。Web 予約の受付の窓は実時刻を見る。 */
function futureDate(days: number): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000 + days * 86_400_000)
  return jst.toISOString().slice(0, 10)
}

/** 公開面の予約は表の主体ぶん叩かれるので、同じ鍵・同じ本文で 1 件に畳む。 */
const PERMISSION_WEB_BOOKING_KEY = crypto.randomUUID()

/** 置いていない押さえ。どの主体が消しにきても 404 になる。 */
const MISSING_HOLD_ID = crypto.randomUUID()
/** 確定の表が使い回す冪等キー。2 人目からは保存した応答がそのまま返る。 */
const PERMISSION_BOOKING_KEY = crypto.randomUUID()

const sevenRows = () =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isClosed: false,
    opensAt: '10:00',
    closesAt: '19:00',
  }))

const weeklyShifts = () =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isOff: false,
    startsAt: '10:00',
    endsAt: '19:00',
    breaks: [],
  }))

/**
 * 期待値は「その主体がそのパスを叩いたときの status」。
 * 200 系は経路が通ったこと、401 は未認証、403 は権限不足、404 は存在しないこと。
 */
let permissionVisitMinute = 5

/**
 * P10 の 3 つの期待。
 *
 * `TERMINAL_READ` は置き場所の一覧（誰でも読める）。
 * `TERMINAL_WRITE` は端末の登録・更新（`terminal.manage` を持つ店長だけ）。
 * `SESSION_ANY` は業務の開始・終了・昇格（**JWT だけ**。共有端末は個人ログイン無しで
 * 業務を回すのが目的なので、ここに権限の壁を置かない）。
 *
 * `shared-session` が 403 になるのは**権限ではなく個人モードが足りない**からで、
 * `personal_mode_required` という別のコードで返る（下の 3 本で直接見る）。
 * 端末セッションが 1 本も無い主体（`manager` など）は `system` として通す —
 * ここで止めると、端末を 1 台も登録していない最初の 1 回が永久に通らない。
 */
const TERMINAL_READ = {
  none: 401,
  staff: 200,
  manager: 200,
  clerk: 200,
  expired: 401,
  'wrong-secret': 401,
  'shared-session': 200,
  'personal-session': 200,
} as const
const TERMINAL_WRITE = {
  none: 401,
  staff: 403,
  manager: 200,
  clerk: 403,
  expired: 401,
  'wrong-secret': 401,
  'shared-session': 403,
  'personal-session': 200,
} as const
const SESSION_ANY = {
  none: 401,
  staff: 200,
  manager: 200,
  clerk: 200,
  expired: 401,
  'wrong-secret': 401,
} as const
const AUDIT_READ = {
  none: 401,
  staff: 403,
  manager: 200,
  clerk: 403,
  expired: 401,
  'wrong-secret': 401,
} as const

const TABLE: Row[] = [
  {
    name: 'ヘルスチェックは誰でも通る',
    method: 'GET',
    path: () => '/api/health',
    expected: { none: 200, staff: 200, admin: 200, expired: 200, 'wrong-secret': 200 },
  },
  {
    name: '店舗一覧はテナントの JWT を要求する',
    method: 'GET',
    path: () => '/api/staff/stores',
    expected: { none: 401, staff: 200, admin: 200, expired: 401, 'wrong-secret': 401 },
  },
  {
    name: '未知パスも default-deny の対象（ルートを足し忘れても漏れない）',
    method: 'GET',
    path: () => '/api/staff/not-a-route',
    expected: { none: 401, staff: 404, admin: 404, expired: 401, 'wrong-secret': 401 },
  },
  {
    name: '内部 API はテナント JWT では越えられない（共有鍵が要る）',
    method: 'GET',
    path: () => '/api/internal/organizations',
    expected: { none: 401, staff: 401, admin: 401, expired: 401, 'wrong-secret': 401 },
  },

  /* --- 店舗の情報 --- */
  {
    name: '店舗の情報は誰でも読める',
    method: 'GET',
    path: () => `/api/staff/stores/${fixture.storeId}`,
    expected: READ,
  },
  {
    name: '店舗の情報の保存は店長だけ',
    method: 'PATCH',
    path: () => `/api/staff/stores/${fixture.storeId}`,
    body: async () => ({ name: 'EYEX 銀座店', version: await currentVersion() }),
    expected: WRITE,
  },

  /* --- 営業時間 --- */
  {
    name: '営業時間は誰でも読める',
    method: 'GET',
    path: () => `/api/staff/stores/${fixture.storeId}/business-hours`,
    expected: READ,
  },
  {
    name: '営業時間の保存は店長だけ',
    method: 'PUT',
    path: () => `/api/staff/stores/${fixture.storeId}/business-hours`,
    body: async () => ({ rows: sevenRows(), version: await currentVersion() }),
    expected: WRITE,
  },

  /* --- 営業日 --- */
  {
    name: '営業日は誰でも読める',
    method: 'GET',
    path: () =>
      `/api/staff/stores/${fixture.storeId}/calendar-exceptions?from=2026-09-01&to=2026-10-31`,
    expected: READ,
  },
  {
    name: '臨時のお休みの追加は店長だけ',
    method: 'POST',
    path: () => `/api/staff/stores/${fixture.storeId}/calendar-exceptions`,
    body: () => ({ date: '2026-09-29', kind: 'closed' }),
    expected: WRITE,
  },
  {
    name: '臨時のお休みの取り消しは店長だけ',
    method: 'DELETE',
    path: () => `/api/staff/stores/${fixture.storeId}/calendar-exceptions/${fixture.exceptionId}`,
    expected: WRITE,
  },

  /* --- 予約の間隔 --- */
  {
    name: '予約の間隔は誰でも読める（まだ保存が無ければ 404）',
    method: 'GET',
    path: () => `/api/staff/stores/${fixture.storeId}/slot-rules`,
    expected: {
      none: 401,
      staff: 404,
      manager: 404,
      clerk: 404,
      expired: 401,
      'wrong-secret': 401,
    },
  },
  {
    name: '予約の間隔の保存は店長だけ',
    method: 'PUT',
    path: () => `/api/staff/stores/${fixture.storeId}/slot-rules`,
    body: async () => ({
      slotMinutes: 30,
      cleanupMinutes: 10,
      maxParallel: 3,
      version: await currentVersion(),
    }),
    expected: WRITE,
  },

  /* --- スタッフと技能 --- */
  {
    name: 'スタッフの一覧は誰でも読める',
    method: 'GET',
    path: () => `/api/staff/stores/${fixture.storeId}/staff`,
    expected: READ,
  },
  {
    name: 'スタッフの追加は店長だけ',
    method: 'POST',
    path: () => `/api/staff/stores/${fixture.storeId}/staff`,
    body: () => ({ displayName: '中村 彩' }),
    expected: WRITE,
  },
  {
    name: 'スタッフの更新は店長だけ',
    method: 'PATCH',
    path: () => `/api/staff/stores/${fixture.storeId}/staff/${fixture.staffId}`,
    body: async () => ({ jobLabel: '視力測定', version: await currentVersion() }),
    expected: WRITE,
  },
  {
    name: '技能の置き換えは店長だけ',
    method: 'PUT',
    path: () => `/api/staff/stores/${fixture.storeId}/staff/${fixture.staffId}/skills`,
    body: () => ({ skills: ['measure'] }),
    expected: WRITE,
  },
  {
    name: '勤務時間は誰でも読める',
    method: 'GET',
    path: () => `/api/staff/stores/${fixture.storeId}/staff-shifts?from=2026-08-27&to=2026-09-27`,
    expected: READ,
  },
  {
    name: '勤務時間の保存は店長だけ',
    method: 'PUT',
    path: () => `/api/staff/stores/${fixture.storeId}/staff-shifts`,
    body: async () => ({
      staffId: fixture.staffId,
      weekly: weeklyShifts(),
      effectiveFrom: '2026-08-27',
      version: await currentVersion(),
    }),
    expected: WRITE,
  },

  /* --- 設備と点検 --- */
  {
    name: '設備の一覧は誰でも読める',
    method: 'GET',
    path: () => `/api/staff/stores/${fixture.storeId}/equipment`,
    expected: READ,
  },
  {
    name: '設備の追加は店長だけ',
    method: 'POST',
    path: () => `/api/staff/stores/${fixture.storeId}/equipment`,
    body: () => ({ name: '相談カウンター 1', kind: 'counter', roleLabel: '接客・ご相談' }),
    expected: WRITE,
  },
  {
    name: '設備の更新は店長だけ',
    method: 'PATCH',
    path: () => `/api/staff/stores/${fixture.storeId}/equipment/${fixture.equipmentId}`,
    body: async () => ({ capacity: 1, version: await currentVersion() }),
    expected: WRITE,
  },
  {
    name: '点検の予定は誰でも読める',
    method: 'GET',
    path: () =>
      `/api/staff/stores/${fixture.storeId}/equipment/${fixture.equipmentId}/maintenance?from=2026-08-01&to=2026-08-31`,
    expected: READ,
  },
  {
    name: '点検の追加は店長だけ',
    method: 'POST',
    path: () => `/api/staff/stores/${fixture.storeId}/equipment/${fixture.equipmentId}/maintenance`,
    body: () => ({
      startsAt: '2026-09-01T01:00:00.000Z',
      endsAt: '2026-09-01T03:00:00.000Z',
    }),
    expected: WRITE,
  },
  {
    name: '点検の取り消しは店長だけ',
    method: 'DELETE',
    path: () =>
      `/api/staff/stores/${fixture.storeId}/equipment/${fixture.equipmentId}/maintenance/${fixture.maintenanceId}`,
    expected: WRITE,
  },

  /* --- ご来店の目的 --- */
  {
    name: 'ご来店の目的は誰でも読める',
    method: 'GET',
    path: () => '/api/staff/purposes',
    expected: READ,
  },
  {
    name: '目的の追加は店長だけ',
    method: 'POST',
    path: () => '/api/staff/purposes',
    body: () => ({
      nameInternal: '視力測定だけ',
      namePublic: '視力測定',
      nameShort: '視力',
      durationMinutes: 30,
    }),
    expected: WRITE,
  },
  {
    name: '目的の更新は店長だけ',
    method: 'PATCH',
    path: () => `/api/staff/purposes/${fixture.purposeId}`,
    body: async () => ({ durationMinutes: 60, version: await currentPurposeVersion() }),
    expected: WRITE,
  },
  {
    name: '必要な技能・設備の置き換えは店長だけ',
    method: 'PUT',
    path: () => `/api/staff/purposes/${fixture.purposeId}/requirements`,
    body: () => ({ requirements: [{ kind: 'skill', value: 'measure' }] }),
    expected: WRITE,
  },
  {
    name: '目的の並べ替えは店長だけ',
    method: 'PUT',
    path: () => '/api/staff/purposes/order',
    body: () => ({ purposeIds: [fixture.purposeId] }),
    expected: WRITE,
  },

  /* --- 予約台帳と空き枠（P2。読み取りだけ） --- */
  {
    name: '台帳は店舗の誰でも読める',
    method: 'GET',
    path: () => `/api/staff/ledger?storeId=${fixture.ledgerStoreId}&date=${LEDGER_DATE}`,
    expected: LEDGER_READ,
  },
  {
    name: '空き枠は店舗の誰でも読める',
    method: 'GET',
    path: () => `/api/staff/availability?storeId=${fixture.ledgerStoreId}&date=${LEDGER_DATE}`,
    expected: LEDGER_READ,
  },
  {
    name: 'ご予約 1 件は店舗の誰でも読める',
    method: 'GET',
    path: () => `/api/staff/reservations/${fixture.reservationId}`,
    expected: LEDGER_READ,
  },

  /* --- 電話・店頭からの予約受付（P3。店長限定にしない） --- */
  {
    name: '枠の仮の押さえは店舗の誰でも打てる',
    method: 'POST',
    path: () => '/api/staff/holds',
    body: () => ({
      storeId: fixture.ledgerStoreId,
      startsAt: jstAt(LEDGER_DATE, '15:00'),
      durationMinutes: 60,
    }),
    expected: BOOKING,
  },
  {
    name: '無い押さえの取り消しは 404（権限では落とさない）',
    method: 'DELETE',
    path: () => `/api/staff/holds/${MISSING_HOLD_ID}`,
    expected: BOOKING_MISSING,
  },
  {
    name: 'ご予約の確定は店舗の誰でも通る',
    method: 'POST',
    path: () => '/api/staff/reservations',
    // 同じ鍵・同じ本文なので、2 人目からは保存した応答がそのまま返る（どちらも 200）。
    headers: () => ({ 'idempotency-key': PERMISSION_BOOKING_KEY }),
    body: () => ({
      storeId: fixture.ledgerStoreId,
      startsAt: jstAt(LEDGER_DATE, '16:00'),
      purposeIds: [fixture.ledgerPurposeId],
      staffId: null,
      source: 'phone',
    }),
    expected: BOOKING,
  },
  {
    name: '受付を始めるのは店舗の誰でもできる',
    method: 'POST',
    path: () => '/api/staff/reception-sessions',
    body: () => ({ storeId: fixture.ledgerStoreId }),
    expected: BOOKING,
  },
  {
    name: '下書きの保存は店舗の誰でもできる',
    method: 'PATCH',
    path: () => `/api/staff/reception-sessions/${fixture.receptionSessionId}`,
    body: () => ({ draft: { purposeIds: [fixture.ledgerPurposeId], phoneTyped: '090' } }),
    expected: BOOKING,
  },
  {
    name: '受付をやめるのは店舗の誰でもできる',
    method: 'POST',
    path: () => `/api/staff/reception-sessions/${nextClosableSession()}/close`,
    body: () => ({ outcome: 'discarded' }),
    expected: BOOKING,
  },

  /* --- 保存の前に見せる影響（読み取り専用なので店長を要求しない） --- */
  {
    name: '影響の試算は読み取りなので店長を要求しない',
    method: 'POST',
    path: () => '/api/staff/settings/impact',
    body: () => ({
      storeId: fixture.storeId,
      kind: 'equipment_stop',
      draft: {
        equipmentId: fixture.equipmentId,
        startsAt: '2026-09-01T01:00:00.000Z',
        endsAt: '2026-09-01T03:00:00.000Z',
      },
    }),
    expected: READ,
  },

  /* --- 顧客台帳（P4。おまとめだけが店長のもの） --- */
  {
    name: 'お客様の一覧は店舗の誰でも読める',
    method: 'GET',
    path: () => '/api/staff/customers?limit=8',
    expected: CUSTOMER,
  },
  {
    name: 'お客様の候補は店舗の誰でも読める',
    method: 'GET',
    path: () => '/api/staff/customers/lookup?phone=09012345678',
    expected: CUSTOMER,
  },
  {
    name: 'お客様 1 名は店舗の誰でも読める',
    method: 'GET',
    path: () => `/api/staff/customers/${fixture.customerId}`,
    expected: CUSTOMER,
  },
  {
    name: 'お客様の登録は店舗の誰でもできる',
    method: 'POST',
    path: () => '/api/staff/customers',
    body: () => ({ name: '新規 太郎' }),
    expected: CUSTOMER,
  },
  {
    name: 'お客様の更新は店舗の誰でもできる',
    method: 'PATCH',
    path: () => `/api/staff/customers/${fixture.customerId}`,
    body: async () => ({ memo: '覚えておくこと', version: await currentCustomerVersion() }),
    expected: CUSTOMER,
  },
  {
    name: 'メモの一覧は店舗の誰でも読める',
    method: 'GET',
    path: () => `/api/staff/customers/${fixture.customerId}/notes`,
    expected: CUSTOMER,
  },
  {
    name: 'メモの追加は店舗の誰でもできる',
    method: 'POST',
    path: () => `/api/staff/customers/${fixture.customerId}/notes`,
    body: () => ({ kind: 'memo', storeId: fixture.storeId, body: '伺ったこと' }),
    expected: CUSTOMER,
  },
  {
    name: '読み取った文字の修正は店舗の誰でもできる',
    method: 'PATCH',
    path: () => `/api/staff/customers/${fixture.customerId}/notes/${fixture.noteId}`,
    body: async () => ({ revision: await currentNoteRevision(), body: '直した文字' }),
    expected: CUSTOMER,
  },
  {
    name: '注意ごとへの申し込みは店舗の誰でもできる',
    method: 'POST',
    path: () => `/api/staff/customers/${fixture.customerId}/notes/${fixture.noteId}/publish`,
    body: async () => ({ revision: await currentNoteRevision(), body: '注意ごとの申し込み' }),
    expected: CUSTOMER,
  },
  {
    name: 'おまとめの下見は店長だけ',
    method: 'POST',
    path: () => '/api/staff/customers/merge/preview',
    body: () => ({ primaryId: fixture.mergePrimaryId, secondaryId: fixture.mergeSecondaryId }),
    expected: MERGE,
  },
  {
    name: 'おまとめの実行は店長だけ',
    method: 'POST',
    path: () => '/api/staff/customers/merge',
    body: () => ({
      primaryId: fixture.mergePrimaryId,
      secondaryId: fixture.mergeSecondaryId,
      primaryVersion: 1,
      secondaryVersion: 1,
      fields: [
        {
          field: 'name',
          primaryValue: '田中 花子',
          secondaryValue: '田中 花子',
          choice: 'primary',
        },
      ],
    }),
    expected: MERGE,
  },
  /* --- 来店受付とウォークイン（P5。受付は手の空いた人がやるので店長限定にしない） --- */
  {
    name: '店頭のお客様の受付は店舗の誰でもできる',
    method: 'POST',
    path: () => '/api/staff/walkins',
    body: () => ({
      storeId: fixture.walkinStoreId,
      purposeNote: 'フレームの相談',
      arrivedAt: jstAt(LEDGER_DATE, '11:02'),
      startsAt: jstAt(LEDGER_DATE, '11:00'),
      durationMinutes: 20,
      staffId: null,
    }),
    expected: BOOKING,
  },
  {
    name: 'お待ちの一覧は店舗の誰でも読める',
    method: 'GET',
    path: () => `/api/staff/walkins?storeId=${fixture.walkinStoreId}&date=${LEDGER_DATE}`,
    expected: BOOKING,
  },
  {
    name: 'ウォークインの更新は店舗の誰でもできる',
    method: 'PATCH',
    path: () => `/api/staff/walkins/${fixture.walkinId}`,
    body: async () => ({ version: await currentWalkinVersion(), status: 'waiting' }),
    expected: BOOKING,
  },
  {
    name: '工程を進めるのは店舗の誰でもできる（担当以外も進める）',
    method: 'POST',
    path: () => '/api/staff/visits',
    body: () => ({
      storeId: fixture.walkinStoreId,
      subjectType: 'reservation',
      subjectId: fixture.visitReservationId,
      stage: 'consulting',
      occurredAt: jstAt(LEDGER_DATE, `14:${String(permissionVisitMinute++).padStart(2, '0')}`),
    }),
    expected: BOOKING,
  },
  {
    name: '来店受付ボードは店舗の誰でも読める',
    method: 'GET',
    path: () => `/api/staff/visits/board?storeId=${fixture.walkinStoreId}&date=${LEDGER_DATE}`,
    expected: BOOKING,
  },
  {
    name: '受付履歴の一覧は店舗の誰でも読める',
    method: 'GET',
    path: () => `/api/staff/reception-sessions?from=${LEDGER_DATE}&to=${LEDGER_DATE}`,
    expected: BOOKING,
  },
  {
    name: '受付履歴の 1 件は店舗の誰でも読める',
    method: 'GET',
    path: () => `/api/staff/reception-sessions/${fixture.visitReservationId}`,
    expected: BOOKING,
  },
  {
    name: 'ご来店がなかったとして残すのは店舗の誰でもできる',
    method: 'POST',
    path: () => `/api/staff/reservations/${nextCancellableReservation()}/cancel`,
    body: () => ({ version: 1, reason: 'no_show' }),
    expected: BOOKING,
  },
  /* --- 予約の検索・変更・取消（P6。お電話を取った人がそのまま直す面なので店長限定にしない） --- */
  {
    name: 'ご予約の検索は店舗の誰でも読める',
    method: 'GET',
    path: () =>
      `/api/staff/reservations?storeId=${fixture.ledgerStoreId}&from=${LEDGER_DATE}&to=${LEDGER_DATE}`,
    expected: BOOKING,
  },
  {
    name: 'ご予約の変更は店舗の誰でもできる',
    method: 'PATCH',
    path: () => `/api/staff/reservations/${fixture.reservationId}`,
    body: async () => ({
      version: await currentReservationVersion(),
      noteInternal: 'お電話で日時のご相談',
    }),
    expected: BOOKING,
  },
  {
    name: '理由を選んでの取り消しは店舗の誰でもできる',
    method: 'POST',
    path: () => `/api/staff/reservations/${nextCancellableReservation()}/cancel`,
    body: () => ({ version: 1, reason: 'customer' }),
    expected: BOOKING,
  },
  {
    name: 'ご予約の経緯は店舗の誰でも読める',
    method: 'GET',
    path: () => `/api/staff/reservations/${fixture.reservationId}/history`,
    expected: BOOKING,
  },

  /* --- 受付の録音（P7） --- */
  {
    name: '録音の開始は権限を要求しない（受付そのものの操作）',
    method: 'POST',
    path: () => '/api/staff/recordings',
    body: () => ({
      receptionSessionId: fixture.startableSessionId,
      storeId: fixture.storeId,
      startedAt: NOW,
    }),
    expected: RECORDING_OPEN,
  },
  {
    name: '録音の本体は権限を要求しない',
    method: 'PUT',
    path: () => `/api/staff/recordings/${nextRecording(fixture.contentRecordingIds)}/content`,
    // 生 body を受ける唯一のルート。表の既定（application/json）では 400 になる。
    headers: () => ({ 'content-type': 'audio/mp4' }),
    body: () => 'audio',
    expected: RECORDING_OPEN,
  },
  {
    name: '録音の状態更新は権限を要求しない',
    method: 'PATCH',
    path: () => `/api/staff/recordings/${nextRecording(fixture.patchRecordingIds)}`,
    body: () => ({ state: 'failed' }),
    expected: RECORDING_OPEN,
  },
  {
    name: '録音の再送は権限を要求しない',
    method: 'POST',
    path: () => `/api/staff/recordings/${nextRecording(fixture.retryRecordingIds)}/retry`,
    expected: RECORDING_OPEN,
  },
  {
    name: '録音の一覧は recording.read を要求する',
    method: 'GET',
    path: () => `/api/staff/recordings?storeId=${fixture.storeId}`,
    expected: RECORDING_READ,
  },
  {
    name: '再生のチケットは recording.read を要求する',
    method: 'POST',
    path: () => `/api/staff/recordings/${fixture.playbackRecordingId}/playback`,
    expected: RECORDING_READ,
  },
  {
    name: '録音のストリームは recording.read を要求する（チケットは上乗せ）',
    method: 'GET',
    path: () =>
      `/api/staff/recordings/${fixture.streamRecordingId}/stream?token=${fixture.streamTicket}`,
    expected: RECORDING_READ,
  },
  {
    name: '録音の保全は recording.manage を要求する',
    method: 'POST',
    path: () => `/api/staff/recordings/${fixture.holdRecordingId}/hold`,
    body: () => ({ legalHold: true, reason: '照会に備えるため' }),
    expected: RECORDING_MANAGE,
  },
  {
    name: '録音の削除は recording.manage を要求する',
    method: 'DELETE',
    path: () => `/api/staff/recordings/${fixture.deletableRecordingId}`,
    expected: RECORDING_MANAGE,
  },
  {
    name: 'お知らせは店舗の誰でも読める',
    method: 'GET',
    path: () => `/api/staff/alerts?storeId=${fixture.storeId}`,
    expected: ALERT_READ,
  },

  /* --- お客様向け Web 予約（P8）--- */
  {
    name: 'Web予約の公開設定は店舗の誰でも読める',
    method: 'GET',
    path: () => `/api/staff/web-booking-settings/${fixture.storeId}`,
    expected: READ,
  },
  {
    name: 'Web予約の公開設定の保存は店長だけ',
    method: 'PUT',
    path: () => `/api/staff/web-booking-settings/${fixture.storeId}`,
    body: () => ({
      isPublished: false,
      opensAt: '10:30',
      closesAt: '18:00',
      acceptFromHours: 2,
      acceptUntilDays: 30,
      changeDeadlineDays: 1,
      requiresApproval: true,
      message: '',
      publishedPurposeIds: [],
      version: 0,
    }),
    expected: WRITE,
  },
  {
    name: 'お客様の画面の見え方は店舗の誰でも読める',
    method: 'GET',
    path: () => `/api/staff/web-booking-settings/${fixture.storeId}/preview`,
    expected: READ,
  },
  {
    name: '確認待ちの Web 予約を確かめられるのは店長だけ',
    method: 'POST',
    path: () => `/api/staff/web-bookings/${fixture.reviewableWebBookingId}/review`,
    body: () => ({ decision: 'approve', reason: '' }),
    expected: WRITE,
  },
  {
    name: '公開の店舗一覧は未認証で通る',
    method: 'GET',
    path: () => '/api/public/stores',
    expected: PUBLIC,
  },
  {
    name: '公開のご用件は未認証で通る',
    method: 'GET',
    path: () => `/api/public/stores/${fixture.webStoreSlug}/purposes`,
    expected: PUBLIC,
  },
  {
    name: 'お客様の予約は未認証で通る',
    method: 'POST',
    path: () => `/api/public/stores/${fixture.webStoreSlug}/bookings`,
    headers: () => ({ 'idempotency-key': PERMISSION_WEB_BOOKING_KEY }),
    body: () => ({
      purposeId: fixture.webPurposeId,
      startsAt: fixture.webStartsAt,
      contactName: '山口 真央',
      contactKana: 'やまぐち まお',
      contactPhone: '080-2345-6789',
      contactEmail: 'm.yamaguchi@example.jp',
    }),
    expected: PUBLIC,
  },
  {
    name: 'お客様の本人確認は未認証で通る',
    method: 'POST',
    path: () => '/api/public/reservations/verify',
    headers: () => ({ 'x-management-code': fixture.webManagementCode }),
    body: () => ({ code: fixture.webBookingCode, contactEmail: 'm.yamaguchi@example.jp' }),
    expected: PUBLIC,
  },
  {
    name: 'Web 予約の保守はテナントのトークンでは越えられない（共有鍵の経路）',
    method: 'POST',
    path: () => '/api/internal/maintenance/web-publications/apply',
    body: () => ({}),
    expected: MAINTENANCE,
  },
  {
    name: '公開面の未知パスは未認証のまま 404（default-deny の例外が効いている）',
    method: 'GET',
    path: () => '/api/public/not-a-route',
    expected: PUBLIC_MISSING,
  },

  {
    name: '録音の掃除はテナントのトークンでは越えられない（共有鍵の経路）',
    method: 'POST',
    path: () => '/api/internal/maintenance/recordings/purge',
    body: () => ({}),
    expected: MAINTENANCE,
  },
  {
    name: '録音の未知パスも default-deny で塞がる',
    method: 'GET',
    path: () => '/api/staff/recordings/not-a-route',
    expected: {
      none: 401,
      staff: 404,
      admin: 404,
      manager: 404,
      clerk: 404,
      reader: 404,
      keeper: 404,
      expired: 401,
      'wrong-secret': 401,
    },
  },
  {
    name: '分析は analytics.read を持つ人だけが開ける',
    method: 'GET',
    path: () =>
      `/api/staff/analytics?storeId=${fixture.storeId}&metric=overview&from=2026-08-01&to=2026-08-31`,
    expected: ANALYTICS,
  },
  {
    name: '分析の目安も analytics.read を持つ人だけが読める',
    method: 'GET',
    path: () => `/api/staff/analytics/targets?storeId=${fixture.storeId}`,
    expected: ANALYTICS,
  },
  {
    name: '分析の未知パスも default-deny で塞がる',
    method: 'GET',
    path: () => '/api/staff/analytics/not-a-route',
    expected: {
      none: 401,
      staff: 404,
      manager: 404,
      clerk: 404,
      expired: 401,
      'wrong-secret': 401,
    },
  },
  {
    name: '未知の顧客パスも既定の拒否に落ちる',
    method: 'GET',
    path: () => '/api/staff/customers/not-a-route',
    expected: {
      none: 401,
      staff: 404,
      admin: 404,
      manager: 404,
      clerk: 404,
      expired: 401,
      'wrong-secret': 401,
    },
  },
  /* --- P10 端末・監査・お知らせ --- */
  {
    name: '置き場所の一覧は誰でも読める',
    method: 'GET',
    path: () => `/api/staff/terminals?storeId=${fixture.storeId}`,
    expected: TERMINAL_READ,
  },
  {
    name: '端末の登録は terminal.manage を持つ店長が、個人モードで行う',
    method: 'POST',
    path: () => `/api/staff/terminals?storeId=${fixture.storeId}`,
    body: () => ({
      name: '銀座店 予備iPad',
      kind: 'shared',
      placeNote: '',
      deviceLabel: '',
      autoLockSeconds: 1800,
      isActive: true,
      pin: TERMINAL_PIN,
    }),
    // 登録は行が増えるので 201（更新の 200 と取り違えない）。
    expected: { ...TERMINAL_WRITE, manager: 201, 'personal-session': 201 },
  },
  {
    name: '端末の更新は terminal.manage を持つ店長が、個人モードで行う',
    method: 'PATCH',
    path: () => `/api/staff/terminals/${fixture.terminalId}`,
    body: async () => ({ version: await currentTerminalVersion(), name: '銀座店 レジ横iPad' }),
    expected: TERMINAL_WRITE,
  },
  {
    name: '業務の開始は JWT だけで通る（共有端末は個人ログインを求めない）',
    method: 'POST',
    path: () => `/api/staff/terminals/${fixture.sessionTerminalId}/sessions`,
    body: () => ({ mode: 'shared', pin: TERMINAL_PIN }),
    expected: { ...SESSION_ANY, staff: 201, manager: 201, clerk: 201 },
  },
  {
    name: '無いセッションの終了は 404（権限では落とさない）',
    method: 'DELETE',
    path: () => `/api/staff/terminals/${fixture.sessionTerminalId}/sessions/${crypto.randomUUID()}`,
    expected: { ...SESSION_ANY, staff: 404, manager: 404, clerk: 404 },
  },
  {
    name: '個人モードへの昇格は JWT だけで通る（通ったあとに個人モードになる）',
    method: 'POST',
    path: () => `/api/staff/terminals/${fixture.sessionTerminalId}/elevate`,
    body: () => ({ staffId: fixture.pinStaffId, pin: STAFF_PIN, reason: 'settings' }),
    expected: { ...SESSION_ANY, staff: 201, manager: 201, clerk: 201 },
  },
  {
    name: '監査の読み返しは audit.read を持つ店長だけ',
    method: 'GET',
    path: () => `/api/staff/audit?storeId=${fixture.storeId}`,
    expected: AUDIT_READ,
  },
  {
    name: 'お知らせは店舗の誰でも読める',
    method: 'GET',
    path: () => `/api/staff/alerts?storeId=${fixture.storeId}`,
    expected: READ,
  },
  {
    name: 'お知らせ 1 件の更新は店舗の誰でもできる',
    method: 'PATCH',
    path: () => `/api/staff/alerts/${fixture.alertId}`,
    body: () => ({ readAt: NOW }),
    expected: READ,
  },
  {
    name: 'すべて既読にするは店舗の誰でもできる',
    method: 'POST',
    path: () => '/api/staff/alerts/read-all',
    body: () => ({ storeId: fixture.storeId }),
    expected: READ,
  },
  {
    name: '本人の暗証番号の設定は settings.manage を持つ店長が、個人モードで行う',
    method: 'PUT',
    path: () => `/api/staff/stores/${fixture.storeId}/staff/${fixture.pinStaffId}/pin`,
    body: () => ({ pin: STAFF_PIN }),
    expected: TERMINAL_WRITE,
  },
  {
    name: '端末の未知パスも default-deny の対象',
    method: 'GET',
    path: () => '/api/staff/terminals/not-a-route',
    expected: { none: 401, staff: 404, manager: 404, expired: 401, 'wrong-secret': 401 },
  },
]

describe('権限マトリクス', () => {
  for (const row of TABLE) {
    for (const [actor, expected] of Object.entries(row.expected) as [ActorName, number][]) {
      it(`${row.name} — ${actor} は ${expected}`, async () => {
        const body = row.body === undefined ? undefined : await row.body()
        const res = await SELF.fetch(`${BASE}${row.path()}`, {
          method: row.method,
          headers: { ...headersFor(actor), ...(row.headers?.() ?? {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        expect(res.status).toBe(expected)
      })
    }
  }
})

describe('受付履歴は店長に絞らない', () => {
  it('受付履歴はスタッフも読める（店長に絞らない）', async () => {
    // `settings.read` しか持たない人でも読める。閉じるのではなく、閲覧そのものを
    // 監査に残す（`design/09-open-questions.md` Q-03 のいまの前提）。
    const res = await SELF.fetch(
      `${BASE}/api/staff/reception-sessions?from=${LEDGER_DATE}&to=${LEDGER_DATE}`,
      { headers: headersFor('clerk') },
    )
    expect(res.status).toBe(200)
  })

  it('未知パス /api/staff/not-a-reception-route は 404 のまま', async () => {
    const anonymous = await SELF.fetch(`${BASE}/api/staff/not-a-reception-route`, {
      headers: headersFor('none'),
    })
    expect(anonymous.status).toBe(401)

    const authenticated = await SELF.fetch(`${BASE}/api/staff/not-a-reception-route`, {
      headers: headersFor('staff'),
    })
    expect(authenticated.status).toBe(404)
  })
})

describe('設定の書き込みは membership だけで決まる', () => {
  it('担当店舗の membership がまったく無い利用者は、設定の保存が 403 になる', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/stores/${fixture.storeId}`, {
      method: 'PATCH',
      headers: headersFor('staff'),
      body: JSON.stringify({ name: '書き換えたい', version: await currentVersion() }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'forbidden' })
  })

  it('他店舗の membership で settings.manage を持っていても、この店舗の保存は 403 になる', async () => {
    const otherStore = crypto.randomUUID()
    await env.DB.prepare(
      'INSERT INTO stores (id, organization_id, name, slug, phone, address, access_note, is_active, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    )
      .bind(
        otherStore,
        ORG,
        'EYEX 丸の内店',
        `marunouchi-${crypto.randomUUID().slice(0, 8)}`,
        '',
        '',
        '',
        '1',
        NOW,
      )
      .run()
    const sub = subOf(ORG, ':other-store-manager')
    await syncMembership(ORG, otherStore, sub, ['settings.read', 'settings.manage'])
    const token = await signAccessToken(
      { sub, org: ORG, email: 'other@example.test', role: 'staff' },
      JWT_SECRET,
    )

    const res = await SELF.fetch(`${BASE}/api/staff/stores/${fixture.storeId}`, {
      method: 'PATCH',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: '書き換えたい', version: await currentVersion() }),
    })
    expect(res.status).toBe(403)
    // 自分の店舗なら同じ本文が通る（権限そのものは持っている）。
    const allowed = await SELF.fetch(`${BASE}/api/staff/stores/${otherStore}`, {
      method: 'PATCH',
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'EYEX 丸の内店', version: 1 }),
    })
    expect(allowed.status).toBe(200)
  })

  it('未知の設定パスは、未認証なら 401 で経路の有無を漏らさず、認証済みで初めて 404 になる', async () => {
    const anonymous = await SELF.fetch(`${BASE}/api/staff/settings/not-a-route`, {
      headers: headersFor('none'),
    })
    expect(anonymous.status).toBe(401)

    const authenticated = await SELF.fetch(`${BASE}/api/staff/settings/not-a-route`, {
      headers: headersFor('clerk'),
    })
    expect(authenticated.status).toBe(404)
  })
})

describe('おまとめは店長だけができる', () => {
  it('スタッフが実行しても、どちらの登録も 1 行も変わらない', async () => {
    const before = await env.DB.prepare(
      'SELECT id, version, merged_into_id AS mergedIntoId FROM customers WHERE organization_id = ? ORDER BY customer_number',
    )
      .bind(ORG)
      .all<{ id: string; version: number; mergedIntoId: string | null }>()

    const res = await SELF.fetch(`${BASE}/api/staff/customers/merge`, {
      method: 'POST',
      headers: headersFor('clerk'),
      body: JSON.stringify({
        primaryId: fixture.mergePrimaryId,
        secondaryId: fixture.mergeSecondaryId,
        primaryVersion: 1,
        secondaryVersion: 1,
        fields: [],
      }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'forbidden' })

    const after = await env.DB.prepare(
      'SELECT id, version, merged_into_id AS mergedIntoId FROM customers WHERE organization_id = ? ORDER BY customer_number',
    )
      .bind(ORG)
      .all<{ id: string; version: number; mergedIntoId: string | null }>()
    expect(after.results).toEqual(before.results)
  })

  it('内部 API の共有鍵では顧客のルートに入れない', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/customers`, { headers: INTERNAL_HEADERS })
    expect(res.status).toBe(401)
  })
})

describe('内部 API の共有鍵', () => {
  it('正しい鍵なら通る', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/organizations`, {
      headers: INTERNAL_HEADERS,
    })
    expect(res.status).toBe(200)
  })

  it('鍵が違えば 401', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/organizations`, {
      headers: { ...JSON_HEADERS, 'x-internal-key': 'not-the-key' },
    })
    expect(res.status).toBe(401)
  })

  it('鍵が無ければ 401', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/organizations`, { headers: JSON_HEADERS })
    expect(res.status).toBe(401)
  })
})

describe('dev トークングラント', () => {
  it('組織 id が空なら 400', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/token`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ organizationId: '', role: 'staff' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('録音の権限は 401 と 403 を取り違えない', () => {
  it('期限切れトークンは 403 ではなく 401 を返す（固定の過去時刻で作る）', async () => {
    // 403 を返すと、画面は「権限が足りない」と読んで再ログインへ導かない。
    const res = await SELF.fetch(`${BASE}/api/staff/recordings?storeId=${fixture.storeId}`, {
      headers: headersFor('expired'),
    })
    expect(res.status).toBe(401)
  })

  it('テナントのトークンでは保守の経路に触れない', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/maintenance/recordings/purge`, {
      method: 'POST',
      headers: headersFor('keeper'),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })

  it('違う共有鍵の保守呼び出しは 401', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/maintenance/recordings/purge`, {
      method: 'POST',
      headers: { ...JSON_HEADERS, 'x-internal-key': 'not-the-key' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })

  it('鍵なしの保守呼び出しは 401', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/maintenance/recordings/purge`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })

  it('録音の未知パスは、未認証なら 401 で経路の有無を漏らさず、認証済みで初めて 404 になる', async () => {
    const anonymous = await SELF.fetch(`${BASE}/api/staff/recordings/not-a-route`, {
      headers: headersFor('none'),
    })
    expect(anonymous.status).toBe(401)

    const authenticated = await SELF.fetch(`${BASE}/api/staff/recordings/not-a-route`, {
      headers: headersFor('reader'),
    })
    expect(authenticated.status).toBe(404)
  })
})

describe('分析は 401 と 403 と 400 を取り違えない', () => {
  it('storeId を書かない要求は、認可の前に入力検証で 400 になる', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/analytics?metric=overview`, {
      headers: headersFor('clerk'),
    })
    // 403 を返すと「権限が足りない」と読めてしまう。落ちているのは入力である。
    expect(res.status).toBe(400)
  })

  it('期限切れトークンは 403 ではなく 401 を返す（固定の過去時刻で作る）', async () => {
    const res = await SELF.fetch(`${BASE}/api/staff/analytics/targets?storeId=${fixture.storeId}`, {
      headers: headersFor('expired'),
    })
    expect(res.status).toBe(401)
  })

  it('別 org のトークンは 403 で、その店舗が在ることを 404 で漏らさない', async () => {
    const other = orgId()
    const token = await tokenFor(other)
    const res = await SELF.fetch(`${BASE}/api/staff/analytics/targets?storeId=${fixture.storeId}`, {
      headers: { ...JSON_HEADERS, authorization: `Bearer ${token}` },
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'forbidden' })
  })

  it('日次集計の保守はテナントのトークンでは越えられない', async () => {
    const res = await SELF.fetch(`${BASE}/api/internal/maintenance/analytics/rollup`, {
      method: 'POST',
      headers: headersFor('manager'),
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(401)
  })
})

describe('端末は 401 と 403 の 2 種類を取り違えない', () => {
  it('期限切れのトークンは 401 で、個人モードがあっても通らない', async () => {
    // 個人モードの足場（`x-terminal-session`）を添えても、JWT が切れていれば 401。
    const res = await SELF.fetch(`${BASE}/api/staff/terminals?storeId=${fixture.storeId}`, {
      headers: { ...headersFor('expired'), 'x-terminal-session': fixture.personalSessionId },
    })
    expect(res.status).toBe(401)
  })

  it('権限が足りないのは 403 forbidden、個人モードが足りないのは 403 personal_mode_required で、コードが違う', async () => {
    const body = JSON.stringify({ version: await currentTerminalVersion(), name: '別の名前' })
    const noPermission = await SELF.fetch(`${BASE}/api/staff/terminals/${fixture.terminalId}`, {
      method: 'PATCH',
      headers: headersFor('clerk'),
      body,
    })
    expect(noPermission.status).toBe(403)
    expect(await noPermission.json()).toMatchObject({ error: 'forbidden' })

    const noPersonalMode = await SELF.fetch(`${BASE}/api/staff/terminals/${fixture.terminalId}`, {
      method: 'PATCH',
      headers: headersFor('shared-session'),
      body,
    })
    expect(noPersonalMode.status).toBe(403)
    expect(await noPersonalMode.json()).toMatchObject({ error: 'personal_mode_required' })
  })

  it('個人モードの期限が切れた直後は 403 personal_mode_required になる（401 にしない）', async () => {
    // 401 を返すと、画面は再ログインへ導いてしまう。切れているのは端末セッションの
    // 昇格であって、JWT ではない。
    await env.DB.prepare('UPDATE terminal_sessions SET expires_at = ? WHERE id = ?')
      .bind('2020-01-01T00:00:00.000Z', fixture.personalSessionId)
      .run()
    const res = await SELF.fetch(`${BASE}/api/staff/terminals/${fixture.terminalId}`, {
      method: 'PATCH',
      headers: headersFor('personal-session'),
      body: JSON.stringify({ version: await currentTerminalVersion(), name: 'まだ別の名前' }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'personal_mode_required' })
  })

  it('未知パス /api/staff/terminals/not-a-route は 404 で、認証の前に漏れない', async () => {
    const anonymous = await SELF.fetch(`${BASE}/api/staff/terminals/not-a-route`, {
      headers: headersFor('none'),
    })
    expect(anonymous.status).toBe(401)

    const authenticated = await SELF.fetch(`${BASE}/api/staff/terminals/not-a-route`, {
      headers: headersFor('staff'),
    })
    expect(authenticated.status).toBe(404)
  })
})
