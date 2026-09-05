import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { completeSeededTerminalStart } from './support/terminal'

/**
 * 来店受付とウォークイン（008-reception-and-walkin）の受け入れ基準を、実ブラウザと
 * 実 Worker で確かめる。`vite preview` が実 workerd を動かし、D1 は `seed.mjs` が入れた
 * EYE 銀座店である（`playwright test` を叩くたびに使い捨ての D1 が作り直される）。
 *
 * 1 本の test の直前の行に `// @e2e-covers <ID> ...` を置く。UC は対になる AC の test に
 * 相乗りさせ、45 件（UC-RECEP-01..16 / AC-RECEP-01..29）をちょうど 1 回ずつ並べる。
 *
 * **なぜ「当日」で組み立てるのか（この面だけの決め）**:
 * `GET /api/staff/visits/board` は現在時刻を `new Date()` で作り、`visit_events` を
 * **盤面の日付の窓**（その JST 暦日の 00:00〜24:00）で引く。時刻を渡す口が無いので、
 * 台帳の e2e のように 2026年8月27日 へ固定すると、その場で書いた工程が 1 行も見えない
 * （書いた瞬間の `occurred_at` は実時刻だからである）。よってこの面は
 *   - 盤面・受付・退店 …… **実時刻の JST 暦日（`TODAY`）**の上で組み立て、
 *   - お待たせの分数 …… 「いま」からの差を `occurredAt` に明示して仕込む
 *     （ブラウザの時計を進めない）
 * という形にしてある。
 *
 * **火曜の扱い**: 定休のままでは当日予約を作れないため、suite開始時に限って
 * 当日を特別営業にし、受付に必要な勤務を展開する。suite終了時に元の例外と勤務へ戻す。
 *
 * **D1 を書き換える**: この面は盤面へ行を足す唯一の e2e である。件数を数える test は
 * 先に `clearBoard` で当日の盤面を空にしてから始める（D1 は 1 本しか無く、前の test が
 * 残した行がそのまま「ご来店中 N名」に混ざるため）。承認済みモックとの突き合わせ
 * （mock project）はこの面より先に走る（playwright.config.ts の project の並び）。
 *
 * **まだ器に載っていない入口**（このフェーズの実装が届いていないところ。該当する test の
 * コメントにも同じことを書いてある）:
 *   - 予約を「ご来店がなかった」として残す口（`POST /api/staff/reservations/:id/cancel` は
 *     `009-change-and-cancel` の仕事で、`no_show` を作る経路がアプリにまだ 1 本も無い）
 *   - 台帳リストの行の「ご来店」の行き先（`ReservationList` のボタンは置き物のまま）
 *   - 担当が勤務外の「次にやること」（`POST /api/staff/reservations` が `staff_off` で
 *     断るので実データで作れない。AC-RECEP-14 / 15 だけ盤面の応答を差し替える）
 */

const ORG = 'eye'
/** seed.mjs が固定 id で入れる EYE 銀座店。 */
const GINZA = '11111111-1111-4111-8111-111111111111'
const INTERNAL_KEY = 'dev-internal-key'
/**
 * dev grant の担当店舗は全 E2E で同じ行を配り直す。別 id を使うと
 * `(organization_id, user_id, store_id)` の一意制約に衝突する。
 */
const RECEPTION_E2E_MEMBERSHIP = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'

/** seed の id は `${区分}-0000-4000-8000-${連番}`（`seed.mjs` の `uid`）。 */
const uid = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`
const SATO = uid('c0010000', 0)
const MEASURE_A = uid('d0010000', 0)
/** ご来店の目的（並び順 = id の連番）。「今のメガネを調整したい」は 20 分で技能を要らない。 */
const ADJUST = uid('e0010000', 1)
/** 田中 花子 様（4回目・090-1234-5678・注意ごと 1 件）。 */
const HANAKO = uid('0a010000', 7)

const MS_PER_MINUTE = 60_000
const MS_PER_DAY = 86_400_000

/* --- 日付と時刻 ----------------------------------------------------------- */

/** 瞬間 → JST の暦日。 */
function jstDate(at: number): string {
  return new Date(at + 9 * 60 * MS_PER_MINUTE).toISOString().slice(0, 10)
}

/** JST の壁時計 `HH:MM`。 */
function jstClock(iso: string): string {
  const shifted = new Date(Date.parse(iso) + 9 * 60 * MS_PER_MINUTE)
  return `${String(shifted.getUTCHours()).padStart(2, '0')}:${String(shifted.getUTCMinutes()).padStart(2, '0')}`
}

/** その暦日の壁時計 → UTC の ISO8601。 */
const atJst = (date: string, hhmm: string) =>
  new Date(Date.parse(`${date}T${hhmm}:00.000+09:00`)).toISOString()

const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * MS_PER_DAY).toISOString().slice(0, 10)

/** 「2026年8月27日（木）」。盤面の右上と受付履歴の見出しが使う語。 */
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
function dateLabel(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`)
  return `${day.getUTCFullYear()}年${day.getUTCMonth() + 1}月${day.getUTCDate()}日（${WEEKDAYS[day.getUTCDay()]}）`
}

/** 「8月31日」。受付履歴の絞り込みの札。 */
const dayLabel = (date: string) => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`

/** 実時刻の JST 暦日。盤面はこの日の上で組み立てる。 */
const TODAY = jstDate(Date.now())
const DAY_START = Date.parse(`${TODAY}T00:00:00.000+09:00`)

/** 早朝でも未来の受付を作らず、当日の範囲に収める。 */
const minutesAgo = (minutes: number) =>
  new Date(
    Math.max(Date.now() - minutes * MS_PER_MINUTE, DAY_START + (60 - minutes) * 1_000),
  ).toISOString()

/**
 * seed が 12 件のご予約を置いている日（モックが描いている 2026年8月27日（木））。
 *
 * **お客様の付いたご予約はこの日にしか無い。**`POST /api/staff/reservations` は
 * `customerId` を受け取りながら `reservations.customer_id` に NULL しか書かないので
 * （`domain/booking.ts` の `bookingStatements`）、当日作ったご予約の行は盤面で
 * 「お客様」のままである。お名前・来店回数・注意ごとを見る 2 本だけ、seed のこの日を開く。
 */
const SEED_DAY = '2026-08-27'
/** その日の 11:00、田中 花子 様（4回目）のご予約。 */
const SEED_STARTS_AT = atJst(SEED_DAY, '11:00')

/* --- API を直に叩く（前提づくりと、まだ器に載っていない入口の代わり） ------- */

async function authed(request: APIRequestContext): Promise<{ headers: Record<string, string> }> {
  const res = await request.post('/api/auth/token', {
    data: { organizationId: ORG, role: 'staff' },
  })
  expect(res.status()).toBe(200)
  const { token } = (await res.json()) as { token: string }
  return { headers: { authorization: `Bearer ${token}` } }
}

type CalendarExceptionSnapshot = {
  id: string
  date: string
  kind: 'closed' | 'special'
  opensAt: string | null
  closesAt: string | null
  note: string | null
}

type WeeklyShiftSnapshot = {
  weekday: number
  isOff: boolean
  startsAt: string | null
  endsAt: string | null
  breaks: { startsAt: string; endsAt: string }[]
}

type ReceptionFixture = {
  calendarException: CalendarExceptionSnapshot | undefined
  weekly: WeeklyShiftSnapshot[]
  insertedExceptionId: string
}

async function grantReceptionPermission(request: APIRequestContext): Promise<void> {
  const membership = await request.post('/api/internal/store-memberships/sync', {
    headers: { 'x-internal-key': INTERNAL_KEY },
    data: {
      id: RECEPTION_E2E_MEMBERSHIP,
      organizationId: ORG,
      storeId: GINZA,
      userId: `dev:${ORG}`,
      permissions: ['settings.manage'],
      createdAt: '2026-08-27T00:00:00.000Z',
    },
  })
  expect(membership.status()).toBe(200)
}

/**
 * seed を暦日へ依存させず、使い捨てE2E状態の火曜だけを特別営業へ上書きする。
 * 当日例外と勤務の実効値を残すので、suite終了時に正確に戻せる。
 */
async function installReceptionFixture(
  request: APIRequestContext,
): Promise<ReceptionFixture | undefined> {
  if (new Date(`${TODAY}T00:00:00.000Z`).getUTCDay() !== 2) return undefined
  await grantReceptionPermission(request)
  const headers = await authed(request)
  const exceptions = await request.get(`/api/staff/stores/${GINZA}/calendar-exceptions`, {
    ...headers,
    params: { from: TODAY, to: TODAY },
  })
  expect(exceptions.status()).toBe(200)
  const [calendarException] = (await exceptions.json()) as CalendarExceptionSnapshot[]
  const shiftResponse = await request.get(`/api/staff/stores/${GINZA}/staff-shifts`, {
    ...headers,
    params: { from: TODAY, to: shiftDate(TODAY, 6), staffId: SATO },
  })
  expect(shiftResponse.status()).toBe(200)
  const savedShifts = (await shiftResponse.json()) as {
    date: string
    startsAt: string
    endsAt: string
    kind: 'work' | 'break'
  }[]
  const weekly = Array.from({ length: 7 }, (_, index) => {
    const date = shiftDate(TODAY, index)
    const rows = savedShifts.filter((row) => row.date === date)
    const work = rows.find((row) => row.kind === 'work')
    const rest = rows.find((row) => row.kind === 'break')
    return {
      weekday: new Date(`${date}T00:00:00.000Z`).getUTCDay(),
      isOff: work === undefined,
      startsAt: work?.startsAt ?? null,
      endsAt: work?.endsAt ?? null,
      breaks: rest === undefined ? [] : [{ startsAt: rest.startsAt, endsAt: rest.endsAt }],
    }
  })
  const response = await request.post(`/api/staff/stores/${GINZA}/calendar-exceptions`, {
    ...headers,
    data: {
      date: TODAY,
      kind: 'special',
      opensAt: '10:00',
      closesAt: '19:00',
      note: '受付 E2E の当日特別営業',
    },
  })
  expect(response.status(), await response.text()).toBe(200)
  const insertedException = (await response.json()) as CalendarExceptionSnapshot

  const hours = await request.get(`/api/staff/stores/${GINZA}/business-hours`, {
    ...headers,
  })
  expect(hours.status()).toBe(200)
  const { version } = (await hours.json()) as { version: number }
  const shifts = await request.put(`/api/staff/stores/${GINZA}/staff-shifts`, {
    ...headers,
    data: {
      staffId: SATO,
      effectiveFrom: TODAY,
      version,
      weekly: [
        { weekday: 0, isOff: false, startsAt: '12:00', endsAt: '19:00', breaks: [] },
        { weekday: 1, isOff: false, startsAt: '10:00', endsAt: '19:00', breaks: [] },
        { weekday: 2, isOff: false, startsAt: '10:00', endsAt: '19:00', breaks: [] },
        { weekday: 3, isOff: false, startsAt: '10:00', endsAt: '19:00', breaks: [] },
        { weekday: 4, isOff: false, startsAt: '10:00', endsAt: '19:00', breaks: [] },
        { weekday: 5, isOff: true, startsAt: null, endsAt: null, breaks: [] },
        { weekday: 6, isOff: false, startsAt: '10:00', endsAt: '19:00', breaks: [] },
      ],
    },
  })
  expect(shifts.status(), await shifts.text()).toBe(200)
  await revokeReceptionPermission(request)
  return { calendarException, weekly, insertedExceptionId: insertedException.id }
}

/** 受付用の settings.manage は fixture の設置／撤去以外へ持ち越さない。 */
async function revokeReceptionPermission(request: APIRequestContext): Promise<void> {
  if (new Date(`${TODAY}T00:00:00.000Z`).getUTCDay() !== 2) return
  const membership = await request.post('/api/internal/store-memberships/sync', {
    headers: { 'x-internal-key': INTERNAL_KEY },
    data: {
      id: RECEPTION_E2E_MEMBERSHIP,
      organizationId: ORG,
      storeId: GINZA,
      userId: `dev:${ORG}`,
      permissions: [],
      createdAt: '2026-08-27T00:00:00.000Z',
    },
  })
  expect(membership.status()).toBe(200)
}

async function removeReceptionFixture(
  request: APIRequestContext,
  fixture: ReceptionFixture | undefined,
): Promise<void> {
  if (fixture === undefined) return
  await grantReceptionPermission(request)
  const headers = await authed(request)
  try {
    const hours = await request.get(`/api/staff/stores/${GINZA}/business-hours`, { ...headers })
    expect(hours.status()).toBe(200)
    const { version } = (await hours.json()) as { version: number }
    const shifts = await request.put(`/api/staff/stores/${GINZA}/staff-shifts`, {
      ...headers,
      data: { staffId: SATO, effectiveFrom: TODAY, version, weekly: fixture.weekly },
    })
    expect(shifts.status(), await shifts.text()).toBe(200)
    if (fixture.calendarException === undefined) {
      const removed = await request.delete(
        `/api/staff/stores/${GINZA}/calendar-exceptions/${fixture.insertedExceptionId}`,
        { ...headers },
      )
      expect(removed.status(), await removed.text()).toBe(200)
    } else {
      const restored = await request.post(`/api/staff/stores/${GINZA}/calendar-exceptions`, {
        ...headers,
        data: {
          date: fixture.calendarException.date,
          kind: fixture.calendarException.kind,
          opensAt: fixture.calendarException.opensAt,
          closesAt: fixture.calendarException.closesAt,
          note: fixture.calendarException.note,
        },
      })
      expect(restored.status(), await restored.text()).toBe(200)
    }
  } finally {
    await revokeReceptionPermission(request)
  }
}

type Walkin = {
  id: string
  ticketNo: number
  arrivedAt: string
  reservationId: string
  status: string
  version: number
}

/** 「ウォークイン 005」。整理番号は 3 桁ゼロ埋め（`domain/walkin.ts` の `formatTicket`）。 */
const ticketName = (ticketNo: number) => `ウォークイン ${String(ticketNo).padStart(3, '0')}`

/**
 * その日のまだ誰も取っていない 30 分の枠を 1 つずつ配る。
 *
 * `POST /api/staff/walkins` は `startsAt` を省くと**受付時刻そのもの**を枠にするので、
 * 続けて受け付けると全員が同じ 30 分に積み上がり、担当未定の上限（`max_parallel` = 3）で
 * 4 人目から 409 `slot_taken` になる。この面は 20 件以上のウォークインを作るので、
 * 枠だけを日の頭から順に配る（上限そのものは AC-RECEP-29 が 1 本で数え切る）。
 */
const slotCursor = new Map<string, number>()
function freeSlot(date: string): string {
  const index = slotCursor.get(date) ?? 0
  slotCursor.set(date, index + 1)
  const minutes = index * 30
  const hhmm = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${minutes % 60 === 0 ? '00' : '30'}`
  return atJst(date, hhmm)
}

/** 1 日ぶんの枠の本数（30 分刻み）。これを配り切ったら諦める。 */
const SLOTS_PER_DAY = 48

/** 来店回数に数えられる、いま以前の枠を使う。 */
let pastSlotIndex = 0
function pastSlot(): string {
  pastSlotIndex += 1
  return new Date(
    Math.max(Date.now() - pastSlotIndex * 30 * MS_PER_MINUTE, DAY_START),
  ).toISOString()
}

async function createWalkin(
  request: APIRequestContext,
  body: Record<string, unknown>,
  nextSlot?: () => string,
): Promise<Walkin> {
  const { headers } = await authed(request)
  const arrivedAt = typeof body.arrivedAt === 'string' ? body.arrivedAt : new Date().toISOString()
  const date = jstDate(Date.parse(arrivedAt))
  let last = ''
  /*
   * 埋まっていたら次の枠へ送る。**手元の数え上げを当てにしない** —— Playwright は
   * test が落ちるとワーカを作り直すので、この moduleの数はそこで 0 に戻る。
   * 断られた事実を見て次を探すのが、走らせ方に依らない唯一の形である。
   */
  for (let attempt = 0; attempt < SLOTS_PER_DAY; attempt += 1) {
    const startsAt =
      typeof body.startsAt === 'string' ? body.startsAt : (nextSlot?.() ?? freeSlot(date))
    const res = await request.post('/api/staff/walkins', {
      headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
      data: {
        storeId: GINZA,
        // 20 分（＋片付け 10 分）でちょうど 1 枠に収める。既定の 30 分だと 2 枠にまたがり、
        // 次に配った枠と重なって 409 `slot_taken` になる。
        durationMinutes: 20,
        ...body,
        startsAt,
      },
    })
    if (res.status() === 200) return (await res.json()) as Walkin
    last = `${startsAt} / ${await res.text()}`
    if (res.status() !== 409 || typeof body.startsAt === 'string') break
  }
  throw new Error(`ウォークインを受け付けられなかった: ${last}`)
}

async function addVisit(request: APIRequestContext, body: Record<string, unknown>): Promise<void> {
  const res = await request.post('/api/staff/visits', {
    ...(await authed(request)),
    data: { storeId: GINZA, ...body },
  })
  expect(res.status(), await res.text()).toBe(200)
}

/*
 * 前提づくりのご予約を 1 件書く。
 *
 * **枠が埋まっていたら、サーバが返した空きへ寄せて取り直す。**この面が使うのは
 * 実時刻の当日で、同じ日を予約フローの e2e も歩くため、通しで走らせると
 * 同時受付の上限（`seed.mjs` の 3 件）を先に使い切られて 409 slot_taken になる。
 * 時刻そのものはこの面の主題ではないので、**取れた時刻を呼び出し側へ返す**
 * （行を探す文字列もそこから作る）。
 */
async function createReservation(
  request: APIRequestContext,
  body: Record<string, unknown>,
): Promise<{ id: string; startsAt: string; clock: string }> {
  const wanted = String(body.startsAt)
  let startsAt = wanted
  let last = ''
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await request.post('/api/staff/reservations', {
      ...(await authed(request)),
      data: { storeId: GINZA, source: 'phone', ...body, startsAt },
    })
    if (res.status() === 200) {
      const created = (await res.json()) as { id: string }
      return { id: created.id, startsAt, clock: jstClock(startsAt) }
    }
    last = `${startsAt} / ${await res.text()}`
    if (res.status() !== 409) break
    const alternatives = (
      JSON.parse(last.slice(last.indexOf('{'))) as {
        alternatives?: { startsAt: string }[]
      }
    ).alternatives
    const next = alternatives?.find((slot) => slot.startsAt !== startsAt)?.startsAt
    if (next === undefined) break
    startsAt = next
  }
  throw new Error(`ご予約を書けなかった（希望 ${wanted}）: ${last}`)
}

type BoardRow = {
  subjectType: string
  subjectId: string
  displayName: string
  cells: { at: string | null }[]
}
type Board = { date: string; activeCount: number; rows: BoardRow[]; serverNow: string }

async function readBoard(
  request: APIRequestContext,
  date = TODAY,
  scope: 'active' | 'all' = 'active',
): Promise<Board> {
  const res = await request.get('/api/staff/visits/board', {
    ...(await authed(request)),
    params: { storeId: GINZA, date, scope },
  })
  expect(res.status()).toBe(200)
  return (await res.json()) as Board
}

type WalkinRow = { id: string; ticketNo: number; purposeNote: string | null; status: string }

async function readWalkins(
  request: APIRequestContext,
  date = TODAY,
  status?: string,
): Promise<WalkinRow[]> {
  const res = await request.get('/api/staff/walkins', {
    ...(await authed(request)),
    params: { storeId: GINZA, date, ...(status === undefined ? {} : { status }) },
  })
  expect(res.status()).toBe(200)
  return (await res.json()) as WalkinRow[]
}

/**
 * 受け付けたあとのウォークインをお客様へ結びつける。
 *
 * **受け付けと同時にお客様を渡しても、盤面と受付履歴にはお名前が出ない** ——
 * `POST /api/staff/walkins` は `walk_ins.customer_id` にしか書かず、盤面と受付履歴が
 * 読む `reservations.customer_id` を埋めるのは `PATCH /api/staff/walkins/:walkinId`
 * だけだからである（あとから結びつける経路がそのまま名前の出どころになっている）。
 */
async function linkCustomer(
  request: APIRequestContext,
  walkin: Walkin,
  customerId: string,
): Promise<void> {
  const res = await request.patch(`/api/staff/walkins/${walkin.id}`, {
    ...(await authed(request)),
    data: { version: walkin.version, customerId },
  })
  expect(res.status(), await res.text()).toBe(200)
}

/**
 * その日の盤面を空にする。**件数を数える test の前に必ず呼ぶ** —— D1 は 1 本しか無く、
 * 前の test が残した行がそのまま「ご来店中 N名」に混ざるからである。
 */
async function clearBoard(request: APIRequestContext, date = TODAY): Promise<void> {
  const board = await readBoard(request, date)
  const serverNow = Date.parse(board.serverNow)
  for (const row of board.rows) {
    const lastAt = Math.max(
      serverNow,
      ...row.cells.map((cell) => (cell.at === null ? 0 : Date.parse(cell.at))),
    )
    await addVisit(request, {
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      stage: 'left',
      occurredAt: new Date(lastAt + 1_000).toISOString(),
    })
  }
  expect((await readBoard(request, date)).activeCount).toBe(0)
}

type HistoryList = {
  items: { entryId: string; displayName: string }[]
  total: number
  nextCursor: string | null
  relaxations: { label: string; count: number }[]
}

async function readHistory(
  request: APIRequestContext,
  params: Record<string, string | number>,
): Promise<HistoryList> {
  const res = await request.get('/api/staff/reception-sessions', {
    ...(await authed(request)),
    params: { storeId: GINZA, limit: 20, ...params },
  })
  expect(res.status()).toBe(200)
  return (await res.json()) as HistoryList
}

/* --- 画面を開く ----------------------------------------------------------- */

async function startWork(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(ORG)
  await page.getByRole('button', { name: '業務を始める' }).click()
  await completeSeededTerminalStart(page)
  await expect(page.locator('header').first()).toContainText('EYE 銀座店')
}

const destination = (page: Page, label: string) =>
  page
    .getByRole('navigation', { name: '画面の切り替え' })
    .getByRole('button', { name: label, exact: true })

const board = (page: Page) => page.getByRole('grid', { name: '来店受付ボード　お客様ごとの工程' })

/** 来店受付ボードを開く（盤面が 0 名のときは格子そのものが出ない）。 */
async function openBoard(page: Page, expectRows = true): Promise<void> {
  await startWork(page)
  await destination(page, '来店受付').click()
  if (expectRows) await expect(board(page)).toBeVisible()
  else await expect(page.getByRole('heading', { name: 'ご来店中のお客様はいません' })).toBeVisible()
}

/**
 * ご予約のお客様の受け付けを開く。**入口は台帳の予約リストの「ご来店」の 1 つだけ**である ——
 * 来店受付ボードに載るのは「もうお着きの方」だけなので、まだお着きでないご予約は
 * 盤面から探せない（`worker/domain/visit-board.ts` の `isPresent`）。
 */
async function openCheckin(
  page: Page,
  clock: string,
  scope: 'all' | 'upcoming' = 'all',
): Promise<void> {
  await openLedger(page)
  await page
    .getByRole('group', { name: '表示のかたち' })
    .getByRole('button', { name: '予約リスト' })
    .click()
  // 一覧は 8 行までなので、この面が作ったウォークインで頭が埋まるときは「これから」に絞る。
  if (scope === 'upcoming') await page.getByRole('button', { name: /^これから/ }).click()
  const list = page.getByRole('table', { name: '本日のご予約' })
  await expect(list).toBeVisible()
  await list
    .getByRole('row')
    .filter({ hasText: clock })
    .getByRole('button', { name: 'ご来店' })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'ご来店を受け付けます' })).toBeVisible()
}

async function openLedger(page: Page): Promise<void> {
  await startWork(page)
  await destination(page, '予約台帳').click()
  await expect(page.getByRole('grid', { name: '予約台帳' })).toBeVisible()
}

/**
 * 台帳の応答の `serverNow` を**その日の開店前**へ据える。
 *
 * 「これから」の絞り込みは応答の `serverNow` だけを読む（`filterLedgerRows`）ので、
 * 実時刻がご予約の時刻を過ぎた時間帯に走らせると、この日のために作ったご予約が
 * 「これから」から落ちて一覧そのものが消える —— 夕方に回した回だけ赤くなる、
 * 時計まかせの試験になっていた。開店前に据えれば、その日のご予約は全部が
 * 「これから」なので、札の件数も `counts.all` と等しくなる（嘘の数字を置かない）。
 * 端末の時計は「最初にどの日を尋ねるか」しか読まないので触らない。
 */
async function pinLedgerToBeforeOpening(page: Page): Promise<void> {
  const beforeOpening = atJst(TODAY, '08:00')
  await page.route(
    (url) => url.pathname === '/api/staff/ledger',
    async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as {
        serverNow: string
        counts: { all: number; upcoming: number; pendingReview: number }
      }
      await route.fulfill({
        response,
        json: {
          ...body,
          serverNow: beforeOpening,
          counts: { ...body.counts, upcoming: body.counts.all },
        },
      })
    },
  )
}

async function openHistory(page: Page): Promise<void> {
  await startWork(page)
  await destination(page, '受付履歴').click()
  await expect(page.getByRole('main', { name: '受付履歴' })).toBeVisible()
}

/** 受付履歴の期間を明示して開き直す（既定の 1 週間は実時刻で動くので固定しない）。 */
async function pickSpan(page: Page, from: string, to: string): Promise<void> {
  await filterChip(page, '期間').click()
  await page.getByLabel('おわりの日').fill(to)
  await page.getByLabel('はじめの日').fill(from)
  await filterChip(page, '期間').click()
  await expect(filterChip(page, '期間')).toContainText(dayLabel(from))
}

/** 「結果」を 1 つ選ぶ。 */
async function pickResult(page: Page, label: string): Promise<void> {
  await filterChip(page, '結果').click()
  await page.getByRole('button', { name: label, exact: true }).click()
}

/**
 * 絞り込みの札 1 つ。**0 件の面の緩和候補にも「結果の絞り込みを外す」という名前の
 * ボタンが出る**ので、札は必ず絞り込みの箱の中から取る。
 */
const filterChip = (page: Page, term: string) =>
  page
    .getByRole('group', { name: '受付履歴の絞り込み' })
    .getByRole('button', { name: new RegExp(`^${term}`) })

/** 盤面の 1 行の、ある工程の欄。読み上げ名は「お客様の名前　工程の名前　…」である。 */
const cell = (page: Page, name: string, stage: string) =>
  board(page).getByRole('gridcell', { name: new RegExp(`^${name}\\s+${stage}`) })

/** その行を選んで、行にできることの帯を出す。 */
async function selectRow(page: Page, name: string): Promise<void> {
  await board(page)
    .getByRole('rowheader', { name: new RegExp(`^${name}`) })
    .click()
  await expect(page.getByRole('group', { name: `${name} にできること` })).toBeVisible()
}

/**
 * 「次にやること」に注意が付いた盤面を 1 行だけ返させる（AC-RECEP-14 / 15）。
 * 勤務外の担当・点検中の設備を指したご予約は `POST /api/staff/reservations` が
 * `staff_off` / `maintenance` で断るので、実データでこの姿を作れない。注意の文の
 * 組み立ては `test/visit-board.test.ts`（T-006）が押さえているので、ここは
 * **その応答が来たときに画面が色だけでなく文字で出すか**だけを見る。
 */
async function stubBoard(
  page: Page,
  step: { displayName: string; stage: string; label: string; note: string },
): Promise<void> {
  const stages = ['received', 'consulting', 'fitting', 'measuring', 'checkout', 'handover']
  await page.route(
    (url) => url.pathname === '/api/staff/visits/board',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          date: TODAY,
          activeCount: 1,
          serverNow: new Date().toISOString(),
          rows: [
            {
              subjectType: 'reservation',
              subjectId: '00000000-0000-4000-8000-0000000000ff',
              displayName: step.displayName,
              visitCount: 4,
              purposeLabel: '調整',
              isWaitingTooLong: false,
              cells: stages.map((stage) =>
                stage === step.stage
                  ? {
                      stage,
                      state: 'next',
                      at: null,
                      label: step.label,
                      note: step.note,
                      needsAttention: true,
                    }
                  : {
                      stage,
                      state: 'empty',
                      at: null,
                      label: '',
                      note: null,
                      needsAttention: false,
                    },
              ),
            },
          ],
        }),
      })
    },
  )
}

/* ========================================================================= */

let receptionFixture: ReceptionFixture | undefined

test.beforeAll(async ({ request }) => {
  receptionFixture = await installReceptionFixture(request)
})

test.afterAll(async ({ request }) => {
  await removeReceptionFixture(request, receptionFixture)
})

// @e2e-covers AC-RECEP-01 UC-RECEP-01
test('来店受付の画面は「11:00 のご予約　5分早くお着きです」と、お名前ひとまとめのカードを出す', async ({
  page,
}) => {
  /*
   * お客様の付いたご予約は seed の 2026年8月27日 にしかない（`TODAY` の定数のコメント）。
   * 盤面はその日を開き、予定時刻との差の出どころである**応答の `serverNow`** だけを
   * 10:55 に据える（端末の時計は「最初にどの日を尋ねるか」しか読まない）。
   */
  await page.clock.setFixedTime(new Date(atJst(SEED_DAY, '11:08')))
  const fiveEarly = new Date(Date.parse(SEED_STARTS_AT) - 5 * MS_PER_MINUTE).toISOString()
  await page.route(
    (url) => url.pathname === '/api/staff/visits/board',
    async (route) => {
      const response = await route.fetch()
      const body = (await response.json()) as Board
      await route.fulfill({ response, json: { ...body, serverNow: fiveEarly } })
    },
  )

  await openCheckin(page, '11:00')
  await expect(page.getByText('11:00 のご予約　5分早くお着きです')).toBeVisible()
  const card = page.getByRole('region', { name: 'お客様' })
  await expect(card).toContainText('田中 花子 様')
  await expect(card).toContainText('4回目')
  await expect(card).toContainText('11:00 〜 12:00')
  await expect(card).toContainText('新調相談')
  await expect(card).toContainText('佐藤 美咲')
})

// @e2e-covers AC-RECEP-02
test('「ご来店を受け付ける」を押すと盤面へ戻り、その行の「受付」が済みましたになる', async ({
  page,
  request,
}) => {
  await clearBoard(request)
  const booked = await createReservation(request, {
    startsAt: atJst(TODAY, '14:30'),
    purposeIds: [ADJUST],
    staffId: SATO,
  })

  /*
   * まだお着きでないご予約は盤面に載らない。受け付ける入口は台帳の予約リストである。
   * **絞り込みは「すべて」で開く。**「これから」は台帳がサーバの**実時計**で数えるので、
   * 14:30 を回ってからこの e2e を走らせると 0 件になって行が見つからない
   * （上の `clearBoard` が今日のご予約を空にしてあるので、「すべて」でも 1 行しか出ない）。
   */
  await openCheckin(page, booked.clock)
  await page.getByRole('button', { name: 'ご来店を受け付ける', exact: true }).click()

  await expect(board(page)).toBeVisible()
  await expect(cell(page, 'お客様', '受付')).toHaveAccessibleName(
    /^お客様\s+受付\s+済みました\s+\d{2}:\d{2}$/,
  )
})

// @e2e-covers AC-RECEP-03 UC-RECEP-02
test('注意ごとの行だけが「要確認」の札を持ち、確かめ済みと未確認が札で見分けられる', async ({
  page,
}) => {
  // 注意ごとを持つお客様は seed の 田中 花子 様 だけで、そのご予約は 2026年8月27日 にある。
  await page.clock.setFixedTime(new Date(atJst(SEED_DAY, '11:08')))
  await openCheckin(page, '11:00')

  // 既定の 2 行 ＋ 注意ごと 1 件（seed の「金属アレルギーのお申し出があります。」）。
  await expect(page.getByRole('checkbox')).toHaveCount(3)
  await expect(page.getByText('要確認')).toHaveCount(1)
  await expect(page.getByText('金属アレルギーのお申し出があります。')).toBeVisible()

  // 未確認の行は「確かめました」を持たない。押すと札が付く（色と枠だけで分けない）。
  await expect(page.getByText('確かめました', { exact: true })).toHaveCount(0)
  await page.getByText('お名前を確かめました').click()
  await expect(page.getByText('確かめました', { exact: true })).toHaveCount(1)
  await expect(
    page.getByRole('checkbox', { name: '金属アレルギーのお申し出があります。' }),
  ).not.toBeChecked()
  // 1 つも済んでいなくても主操作は押せる（必須の行を設けない）。
  await expect(page.getByRole('button', { name: 'ご来店を受け付ける', exact: true })).toBeEnabled()
})

// @e2e-covers AC-RECEP-04 UC-RECEP-03
test('「お待ちいただく」を押すと盤面に行が残り、受け付けがまだ済んでいないことが分かる', async ({
  page,
  request,
}) => {
  await clearBoard(request)
  const booked = await createReservation(request, {
    startsAt: atJst(TODAY, '15:30'),
    purposeIds: [ADJUST],
    staffId: SATO,
  })

  await pinLedgerToBeforeOpening(page)
  await openCheckin(page, booked.clock, 'upcoming')
  await page.getByRole('button', { name: 'お待ちいただく' }).click()

  await expect(board(page)).toBeVisible()
  // 「受付」の欄は空のまま（＝まだ受け付けていない）。読み上げ名も済みましたを言わない。
  await expect(cell(page, 'お客様', '受付')).toHaveAccessibleName('お客様　受付')
  // 待ちの行なので、受け付ける操作はまだ残っている。
  await selectRow(page, 'お客様')
  await expect(page.getByRole('button', { name: 'ご来店を受け付ける', exact: true })).toBeVisible()
})

// @e2e-covers AC-RECEP-05 UC-RECEP-06
test('お客様を「あとで登録する」のまま受け付けて、そのままご相談を始められる', async ({
  page,
  request,
}) => {
  await clearBoard(request)
  // 受付パネルの入口は来店受付ボードの「＋ ご来店を受け付ける」の 1 つだけである。
  await openBoard(page, false)
  await page.getByRole('button', { name: '＋ ご来店を受け付ける' }).click()
  await expect(page.getByRole('heading', { name: '店頭のお客様を受け付けます' })).toBeVisible()
  await page.getByRole('button', { name: /^メガネを新しく作る/ }).click()
  // お客様は伺わない。「あとで登録する」を押したまま主操作が押せる。
  await expect(page.getByRole('button', { name: 'あとで登録する' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '受付して台帳に載せる' }).click()
  await expect(page.getByRole('heading', { name: '店頭のお客様を受け付けます' })).toHaveCount(0)

  const rows = await readWalkins(request, TODAY, 'waiting')
  expect(rows).toHaveLength(1)
  const ticket = ticketName(rows[0]?.ticketNo ?? 0)

  await destination(page, '来店受付').click()
  await expect(board(page)).toBeVisible()
  // 一度もお客様の登録を求められていない。行の名前は整理番号のままである。
  await expect(board(page).getByRole('rowheader', { name: new RegExp(`^${ticket}`) })).toBeVisible()

  /*
   * 盤面から工程を進められるのは「次にやること」の欄だけで、その欄が立つのは
   * **設備を押さえたご予約**だけである（`GET /api/staff/visits/board` の `next`）。
   * ウォークインは設備を押さえないので、盤面に押せる欄が立たない。接客が始められること
   * そのものは記録の側で確かめ、行の名前が整理番号のままであることを盤面で見る。
   */
  await addVisit(request, {
    subjectType: 'walkin',
    subjectId: rows[0]?.id ?? '',
    stage: 'consulting',
  })
  await destination(page, 'トップ').click()
  await destination(page, '来店受付').click()
  await expect(cell(page, ticket, 'ご相談')).toHaveAccessibleName(
    new RegExp(`^${ticket}\\s+ご相談\\s+対応中`),
  )
  await expect(board(page).getByRole('rowheader', { name: new RegExp(`^${ticket}`) })).toBeVisible()
})

// @e2e-covers AC-RECEP-06 UC-RECEP-07
test('受付パネルは「いまお待ち N名」と次の整理番号を出し、その番号で受付履歴に載る', async ({
  page,
  request,
}) => {
  await clearBoard(request)
  const before = await readHistory(request, { from: TODAY, to: TODAY })
  const first = await createWalkin(request, { purposeId: ADJUST })
  await createWalkin(request, { purposeId: ADJUST })

  await openBoard(page)
  await page.getByRole('button', { name: '＋ ご来店を受け付ける' }).click()
  const status = page.getByRole('group', { name: 'いまの待ち状況' })
  await expect(status).toContainText('いまお待ち 2名')
  await expect(status).toContainText(ticketName(first.ticketNo + 2))
  // 目安は空き枠エンジンからしか出さないので、出せないときは数字を置かない。
  await expect(status).not.toContainText('目安')

  await page.getByRole('button', { name: /^今のメガネを調整したい/ }).click()
  await page.getByRole('button', { name: '受付して台帳に載せる' }).click()
  await expect(page.getByRole('heading', { name: '店頭のお客様を受け付けます' })).toHaveCount(0)

  const after = await readHistory(request, { from: TODAY, to: TODAY })
  expect(after.total).toBe(before.total + 3)
  expect(after.items.map((item) => item.displayName)).toContain(ticketName(first.ticketNo + 2))
})

// @e2e-covers AC-RECEP-07
test('台帳の最下段に「ご来店お待ち」の帯が出て、お待ちの人数とご用件が読める', async ({
  page,
  request,
}) => {
  await clearBoard(request)
  await createWalkin(request, { purposeNote: 'フレームの相談', arrivedAt: minutesAgo(8) })
  await createWalkin(request, { purposeNote: 'フレームの相談', arrivedAt: minutesAgo(5) })

  await openLedger(page)
  const grid = page.getByRole('grid', { name: '予約台帳' })
  const names = await grid.getByRole('rowheader').allInnerTexts()
  expect(names[names.length - 1]).toContain('ご来店お待ち')
  expect(names[names.length - 1]).toContain('2名')
  await expect(grid.getByRole('gridcell', { name: 'お待ちのお客様　2名' })).toBeVisible()

  /*
   * モックが帯の中に描く「ウォークイン 004　受付 11:02　お待ち 6分」「フレームの相談」の
   * 1 本ずつの行は `005-availability-and-ledger`（P2）が描く場所で、いまは人数だけを
   * 出している。整理番号・受付時刻・ご用件そのものは `GET /api/staff/walkins` が返す。
   */
  const rows = await readWalkins(request, TODAY, 'waiting')
  expect(rows).toHaveLength(2)
  expect(rows[0]?.purposeNote).toBe('フレームの相談')
  expect(rows.map((row) => row.status)).toEqual(['waiting', 'waiting'])
})

// @e2e-covers AC-RECEP-08 UC-RECEP-08
test('受け付けたあとのウォークインを今までのお客様へ結びつけると、表示がお名前に変わる', async ({
  page,
  request,
}) => {
  await clearBoard(request)
  const walkin = await createWalkin(request, { purposeId: ADJUST }, pastSlot)
  await openBoard(page)
  await expect(
    board(page).getByRole('rowheader', { name: new RegExp(`^${ticketName(walkin.ticketNo)}`) }),
  ).toBeVisible()

  // 電話番号の下 4 桁で見つけたお客様（田中 花子 様・090-1234-5678）を、その行から結びつける。
  await board(page)
    .getByRole('rowheader', { name: new RegExp(`^${ticketName(walkin.ticketNo)}`) })
    .click()
  await page
    .getByRole('group', { name: `${ticketName(walkin.ticketNo)} にできること` })
    .getByRole('button', { name: 'お客様を結びつける' })
    .click()
  const panel = page.getByRole('complementary', { name: 'お客様を結びつける' })
  await expect(panel.getByRole('heading', { name: 'お客様を結びつけます' })).toBeVisible()
  await panel.getByRole('textbox', { name: '電話番号で探す（下4桁でも探せます）' }).fill('5678')
  // 同じ番号のお客様が複数いても、来店回数まで読めるので seed の 4回目の方を選べる
  // （ほかの e2e が同じ番号で作った「初めて」の行と取り違えない）。
  await panel.getByRole('button', { name: /^田中 花子 様 4回/ }).click()

  await expect(board(page).getByRole('rowheader', { name: /^田中 花子 様/ })).toBeVisible()
  await expect(
    board(page).getByRole('rowheader', { name: new RegExp(`^${ticketName(walkin.ticketNo)}`) }),
  ).toHaveCount(0)
})

// @e2e-covers AC-RECEP-09 UC-RECEP-09
test('新しく登録したお客様へ結びつけると、その来店がそのお客様の初めてのご来店になる', async ({
  page,
  request,
}) => {
  await clearBoard(request)
  const walkin = await createWalkin(request, { purposeId: ADJUST })
  await openBoard(page)

  // 盤面のその行から、お名前とふりがなを入れて新しいお客様を作り、そのまま結びつける。
  const name = `受付 太郎 ${walkin.ticketNo}`
  await board(page)
    .getByRole('rowheader', { name: new RegExp(`^${ticketName(walkin.ticketNo)}`) })
    .click()
  await page
    .getByRole('group', { name: `${ticketName(walkin.ticketNo)} にできること` })
    .getByRole('button', { name: 'お客様を結びつける' })
    .click()
  const panel = page.getByRole('complementary', { name: 'お客様を結びつける' })
  await panel.getByRole('textbox', { name: 'お名前' }).fill(name)
  await panel.getByRole('textbox', { name: 'ふりがな' }).fill('うけつけ たろう')
  const creating = page.waitForResponse(
    (res) => res.url().endsWith('/api/staff/customers') && res.request().method() === 'POST',
  )
  await panel.getByRole('button', { name: '登録して結びつける' }).click()
  const customer = (await (await creating).json()) as { id: string; visitCount: number }
  // 登録したばかりのお客様は 0 回目である（数えるのはご来店が終わったとき）。
  expect(customer.visitCount).toBe(0)
  await expect(board(page).getByRole('rowheader', { name: new RegExp(`^${name}`) })).toBeVisible()

  // 来店回数が上がるのは**そのご来店が終わったとき**である（`bumpVisitCount`）。
  await addVisit(request, { subjectType: 'walkin', subjectId: walkin.id, stage: 'received' })
  await addVisit(request, { subjectType: 'walkin', subjectId: walkin.id, stage: 'left' })

  const after = await request.get(`/api/staff/customers/${customer.id}`, await authed(request))
  const detail = (await after.json()) as { visitCount: number; firstVisitAt: string | null }
  expect(detail.visitCount).toBe(1)
  expect(detail.firstVisitAt).not.toBeNull()
})

// @e2e-covers AC-RECEP-10 UC-RECEP-10
test('前日に受け付けて退店したウォークインを、期間を広げて受付履歴から見つけられる', async ({
  page,
  request,
}) => {
  const yesterday = shiftDate(TODAY, -1)
  const walkin = await createWalkin(request, {
    purposeNote: 'フレームの相談',
    arrivedAt: atJst(yesterday, '10:50'),
  })
  await addVisit(request, {
    subjectType: 'walkin',
    subjectId: walkin.id,
    stage: 'left',
    occurredAt: atJst(yesterday, '11:20'),
  })

  await openHistory(page)
  await pickSpan(page, yesterday, yesterday)
  const list = page.getByRole('group', { name: '受付の一覧' })
  const row = list.getByRole('button', { name: new RegExp(ticketName(walkin.ticketNo)) })
  await expect(row).toBeVisible()
  // 受付時刻が同じ行に出る（等幅の壁時計）。
  await expect(row).toContainText(jstClock(walkin.arrivedAt))
})

// @e2e-covers AC-RECEP-11 UC-RECEP-04
test('来店受付ボードは 7 列をこの順で並べ、右上にその日とご来店中の人数を出す', async ({
  page,
  request,
}) => {
  await clearBoard(request)
  for (let i = 0; i < 4; i += 1) await createWalkin(request, { purposeId: ADJUST })

  await openBoard(page)
  expect(await board(page).getByRole('columnheader').allInnerTexts()).toEqual([
    'お客様',
    '受付',
    'ご相談',
    'フレーム選び',
    '視力測定',
    'レンズ・お会計',
    'お渡し',
  ])
  await expect(page.getByText(`${dateLabel(TODAY)}　ご来店中 4名`)).toBeVisible()
  /*
   * 何も起きていない欄は空のまま。文字を足さない。受け付けたばかりのウォークインは
   * 「受付」だけが埋まる（`arrivedAt` が工程の記録の代わりになる）ので、その次の
   * 「ご相談」の欄を見る。
   */
  await expect(board(page).getByRole('row').nth(1).getByRole('gridcell').nth(1)).toHaveText('')
})

// @e2e-covers AC-RECEP-12 UC-RECEP-05
test('「次にやること　視力測定機 A」を押すと対応中になり、前の工程が済みましたに変わる', async ({
  page,
  request,
}) => {
  await clearBoard(request)
  const reservation = await createReservation(request, {
    startsAt: atJst(TODAY, '16:00'),
    purposeIds: [ADJUST],
    staffId: SATO,
    equipmentIds: [MEASURE_A],
  })
  await addVisit(request, {
    subjectType: 'reservation',
    subjectId: reservation.id,
    stage: 'received',
  })
  await addVisit(request, {
    subjectType: 'reservation',
    subjectId: reservation.id,
    stage: 'fitting',
  })

  await openBoard(page)
  await expect(cell(page, 'お客様', 'フレーム選び')).toHaveAccessibleName(
    /^お客様\s+フレーム選び\s+対応中/,
  )
  await expect(cell(page, 'お客様', '視力測定')).toHaveAccessibleName(
    /^お客様\s+視力測定\s+次にやること\s+視力測定機 A/,
  )

  await cell(page, 'お客様', '視力測定').click()
  await expect(cell(page, 'お客様', '視力測定')).toHaveAccessibleName(
    /^お客様\s+視力測定\s+対応中\s+\d{2}:\d{2}から$/,
  )
  await expect(cell(page, 'お客様', 'フレーム選び')).toHaveAccessibleName(
    /^お客様\s+フレーム選び\s+済みました\s+\d{2}:\d{2}$/,
  )
})

test('工程を進めた直後に「元に戻す」が出て、押すと前の工程へ戻る', async ({ page, request }) => {
  /*
   * 押す前に確認を挟むと、1 日に何十回も押す操作が毎回止まる。だから押させてから
   * 数秒だけ戻せる形にした（UX 監査 NEW-04。それまで製品には元に戻す手立てが
   * 1 つも無かった）。
   */
  await clearBoard(request)
  const reservation = await createReservation(request, {
    startsAt: atJst(TODAY, '18:00'),
    purposeIds: [ADJUST],
    staffId: SATO,
    equipmentIds: [MEASURE_A],
  })
  await addVisit(request, {
    subjectType: 'reservation',
    subjectId: reservation.id,
    stage: 'received',
  })
  await addVisit(request, {
    subjectType: 'reservation',
    subjectId: reservation.id,
    stage: 'fitting',
  })

  await openBoard(page)
  await cell(page, 'お客様', '視力測定').click()
  await expect(cell(page, 'お客様', '視力測定')).toHaveAccessibleName(
    /^お客様\s+視力測定\s+対応中\s+\d{2}:\d{2}から$/,
  )

  await page.getByRole('button', { name: '元に戻す' }).click()
  await expect(cell(page, 'お客様', 'フレーム選び')).toHaveAccessibleName(
    /^お客様\s+フレーム選び\s+対応中/,
  )
  await expect(cell(page, 'お客様', '視力測定')).toHaveAccessibleName(
    /^お客様\s+視力測定\s+次にやること\s+視力測定機 A/,
  )
})

// @e2e-covers AC-RECEP-13
test('お待たせしている行は赤地と「お待たせ中　18分」の両方で分かる', async ({ page, request }) => {
  await clearBoard(request)
  // お待たせの起点は最後の記録である。18 分前を `occurredAt` で明示して仕込む
  // （ブラウザの時計を進めない）。
  const receivedAt = new Date(Date.now() - 18 * MS_PER_MINUTE - 5_000).toISOString()
  const walkin = await createWalkin(request, {
    purposeNote: 'フレームの相談',
    arrivedAt: receivedAt,
  })
  await addVisit(request, {
    subjectType: 'walkin',
    subjectId: walkin.id,
    stage: 'received',
    occurredAt: receivedAt,
  })

  await openBoard(page)
  const name = ticketName(walkin.ticketNo)
  await expect(board(page).getByRole('rowheader', { name: new RegExp(`^${name}`) })).toHaveClass(
    /bg-danger-soft/,
  )
  const waiting = cell(page, name, 'ご相談')
  await expect(waiting).toHaveAccessibleName(`${name}　ご相談　お待たせ中　18分`)
  await expect(waiting).toContainText('お待たせ中')
  await expect(waiting).toContainText('18分')
})

// @e2e-covers AC-RECEP-14
test('「次にやること」の担当が勤務に入っていない欄は、文字でも担当を決め直すよう促す', async ({
  page,
}) => {
  await stubBoard(page, {
    displayName: '田中 花子 様',
    stage: 'measuring',
    label: '視力測定機 A',
    note: '本日はお休みです。担当を決め直してください。',
  })
  await openBoard(page)

  const target = cell(page, '田中 花子 様', '視力測定')
  await expect(target).toContainText('本日はお休みです。担当を決め直してください。')
  await expect(target).toHaveAccessibleName(
    '田中 花子 様　視力測定　次にやること　視力測定機 A　本日はお休みです。担当を決め直してください。',
  )
})

// @e2e-covers AC-RECEP-15
test('「次にやること」の設備が点検で止まっている欄は、設備名を差し込んだ文で分かる', async ({
  page,
}) => {
  await stubBoard(page, {
    displayName: '田中 花子 様',
    stage: 'measuring',
    label: '視力測定機 A',
    note: '視力測定機 A は点検で止まっています。',
  })
  await openBoard(page)

  const target = cell(page, '田中 花子 様', '視力測定')
  // 設備名は `label` に残ったまま、注意は別の文として添う（色だけに頼らない）。
  await expect(target).toContainText('視力測定機 A')
  await expect(target).toContainText('視力測定機 A は点検で止まっています。')
  await expect(target).toHaveClass(/bg-amber-soft/)
})

// @e2e-covers AC-RECEP-16 UC-RECEP-11
test('受付履歴の「結果」は 成立・取消・ご来店なし の 3 語を選び分けられる', async ({
  page,
  request,
}) => {
  await createWalkin(request, { purposeId: ADJUST })

  await openHistory(page)
  await pickSpan(page, TODAY, TODAY)
  await filterChip(page, '結果').click()
  for (const label of ['すべての結果', '成立', '取消', 'ご来店なし']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
  }
  await page.getByRole('button', { name: 'ご来店なし', exact: true }).click()

  /*
   * 「ご来店がなかった」として残す経路がアプリにまだ 1 本も無い
   * （`POST /api/staff/reservations/:id/cancel` は `009-change-and-cancel` の仕事）ので、
   * この絞り込みは 0 件になる。結果の 3 語が別々の集合に落ちることは HTTP で押さえる。
   */
  await expect(page.getByText('該当 0件')).toBeVisible()
  expect((await readHistory(request, { from: TODAY, to: TODAY, status: 'no_show' })).total).toBe(0)
  expect((await readHistory(request, { from: TODAY, to: TODAY, status: 'cancelled' })).total).toBe(
    0,
  )
  expect(
    (
      await readHistory(request, {
        from: TODAY,
        to: TODAY,
        status: 'confirmed,arrived,serving,done',
      })
    ).total,
  ).toBeGreaterThan(0)
})

// @e2e-covers AC-RECEP-17 UC-RECEP-12
test('1 件を選ぶと、受け付けた時刻と手段と、そのあとの変更が古い順に読める', async ({
  page,
  request,
}) => {
  const walkin = await createWalkin(request, { purposeId: ADJUST })
  await addVisit(request, { subjectType: 'walkin', subjectId: walkin.id, stage: 'received' })

  await openHistory(page)
  await pickSpan(page, TODAY, TODAY)
  await page
    .getByRole('group', { name: '受付の一覧' })
    .getByRole('button', { name: new RegExp(ticketName(walkin.ticketNo)) })
    .click()

  const detail = page.getByRole('region', { name: '選んだ受付の中身' })
  await expect(detail).toContainText('受け付け')
  const changes = detail.getByRole('list', { name: 'そのあとの変更' }).getByRole('listitem')
  // 受け付けた 2 行（ご予約とウォークイン）は同じ時刻なので並びが決まらない。
  // **古い順**であることは、そのあとの工程が最後に来ることで見る。
  const list = detail.getByRole('list', { name: 'そのあとの変更' })
  await expect(list).toContainText('新しく受け付けました')
  await expect(list).toContainText('店頭のお客様を受け付けました')
  await expect(changes.last()).toContainText('ご来店を受け付けました')
  // 「受付のときの録音」の欄はこのフェーズでは出さない（P7）。
  await expect(detail).not.toContainText('録音')
})

// @e2e-covers AC-RECEP-18 UC-RECEP-13
test('絞りすぎて 0 件になると、条件を 1 つ緩めた候補が件数つきで並び、押すと開き直せる', async ({
  page,
  request,
}) => {
  await createWalkin(request, { purposeId: ADJUST })

  await openHistory(page)
  const yesterday = shiftDate(TODAY, -1)
  await pickSpan(page, yesterday, yesterday)
  // 取り消したご予約は前日に 1 件も無いので、この 2 つで 0 件になる。
  await pickResult(page, '取消')

  await expect(page.getByText('条件に合う受付履歴はありませんでした')).toBeVisible()
  await expect(
    page.getByRole('group', { name: '条件を変えると見つかります' }).getByRole('button').first(),
  ).toBeVisible()
  const clearAll = page.getByRole('button', { name: /^絞り込みをすべて外す（\d+件）$/ })
  await expect(clearAll).toBeVisible()

  // 押す前に見えていた件数と、押したあとに見える一覧の件数が食い違わない。
  const promised = (await clearAll.innerText()).match(/（(\d+)件）/)?.[1]
  expect(promised).toBeDefined()
  await clearAll.click()
  const list = page.getByRole('group', { name: '受付の一覧' })
  await expect(list).toBeVisible()
  await expect(list.getByRole('heading').first()).toContainText(`${promised}件`)
})

// @e2e-covers AC-RECEP-19
test('来店受付ボードは表として読まれ、どの欄もお客様の名前と工程の名前と一緒に読まれる', async ({
  page,
  request,
}) => {
  await clearBoard(request)
  const walkin = await createWalkin(request, { purposeId: ADJUST })

  await openBoard(page)
  const name = ticketName(walkin.ticketNo)
  await expect(board(page)).toHaveAttribute('aria-label', '来店受付ボード　お客様ごとの工程')
  for (const stage of ['受付', 'ご相談', 'フレーム選び', '視力測定', 'レンズ・お会計', 'お渡し']) {
    await expect(cell(page, name, stage)).toHaveCount(1)
  }
})

// @e2e-covers AC-RECEP-20
test('盤面はキーボードだけでたどれて、Tab で通り抜けるのに何十回も押さずに済む', async ({
  page,
  request,
}) => {
  await clearBoard(request)
  const reservation = await createReservation(request, {
    startsAt: atJst(TODAY, '16:30'),
    purposeIds: [ADJUST],
    staffId: SATO,
    equipmentIds: [MEASURE_A],
  })
  await addVisit(request, {
    subjectType: 'reservation',
    subjectId: reservation.id,
    stage: 'received',
  })

  await openBoard(page)
  // 格子の中で焦点を持つのは 1 つだけ（roving tabindex）。Tab は 1 回で通り抜ける。
  await expect(board(page).locator('[data-board-cell][tabindex="0"]')).toHaveCount(1)

  await board(page).locator('[data-board-cell][tabindex="0"]').focus()
  for (let i = 0; i < 4; i += 1) await page.keyboard.press('ArrowRight')
  await expect(cell(page, 'お客様', '視力測定')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(cell(page, 'お客様', '視力測定')).toHaveAccessibleName(/^お客様\s+視力測定\s+対応中/)
})

// @e2e-covers AC-RECEP-21
test('0 件になったことは割り込まない知らせとして読み上げられ、候補の名前に件数が入る', async ({
  page,
  request,
}) => {
  await createWalkin(request, { purposeId: ADJUST })

  await openHistory(page)
  await pickSpan(page, TODAY, TODAY)
  await pickResult(page, '取消')

  // `role="status"`（割り込まない）で言う。`role="alert"` にはしない。
  await expect(
    page.getByRole('status').filter({ hasText: '条件に合う受付履歴はありませんでした' }),
  ).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  // 押せる操作の名前に件数が入る（読み上げでも件数が読まれる）。
  await expect(
    page.getByRole('group', { name: '条件を変えると見つかります' }).getByRole('button').first(),
  ).toHaveAccessibleName(/\d+件\s+この条件で見る$/)
  // 絞り込みの値は消さない（0 件になっても条件が画面に残る）。
  await expect(filterChip(page, '結果')).toContainText('取消')
  await expect(filterChip(page, '期間')).toContainText(dayLabel(TODAY))
})

// @e2e-covers AC-RECEP-22
test('台帳リストの行にも「ご来店」の入口があり、来店受付の画面は 1 つである', async ({
  page,
  request,
}) => {
  await clearBoard(request)
  const booked = await createReservation(request, {
    startsAt: atJst(TODAY, '17:00'),
    purposeIds: [ADJUST],
    staffId: SATO,
  })

  await pinLedgerToBeforeOpening(page)
  await openLedger(page)
  await page
    .getByRole('group', { name: '表示のかたち' })
    .getByRole('button', { name: '予約リスト' })
    .click()
  // この面が作ったウォークインが一覧の頭を埋めるので、「これから」に絞ってから見る
  // （一覧は 8 行までで、残りは末尾の 1 行にまとまる決めである）。
  await page.getByRole('button', { name: /^これから/ }).click()
  const list = page.getByRole('table', { name: '本日のご予約' })
  await expect(list).toBeVisible()
  /*
   * ご予約のお客様を受け付ける入口は**この 1 つ**である。まだお着きでないご予約は
   * 来店受付ボードに載らない（盤面に載るのはお着きの方だけ）ので、盤面には同じ入口を
   * 二重に置かない —— 着く先は「ご来店を受け付けます」の 1 枚だけになる。
   */
  await expect(list.getByRole('button', { name: 'ご来店' }).first()).toBeVisible()
  await list
    .getByRole('row')
    .filter({ hasText: booked.clock })
    .getByRole('button', { name: 'ご来店' })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: 'ご来店を受け付けます' })).toBeVisible()
  // 盤面の側にはこの入口が無い（まだお着きでないご予約はそもそも行を持たない）。
  await page.getByRole('button', { name: '‹ 来店受付ボードへ戻る' }).click()
  await expect(board(page).getByRole('rowheader')).toHaveCount(0)
})

// @e2e-covers AC-RECEP-23 UC-RECEP-14
test('退店を記録するとご来店中から外れ、人数が 1 減り、来店回数に 1 件数えられる', async ({
  page,
  request,
}) => {
  await clearBoard(request)
  const walkin = await createWalkin(request, { purposeId: ADJUST })
  await linkCustomer(request, walkin, HANAKO)
  for (let i = 0; i < 3; i += 1) await createWalkin(request, { purposeId: ADJUST })
  // 「お渡し」が対応中の行を退店させる（AC の姿）。
  await addVisit(request, { subjectType: 'walkin', subjectId: walkin.id, stage: 'handover' })
  const before = await request.get(`/api/staff/customers/${HANAKO}`, await authed(request))
  const visits = ((await before.json()) as { visitCount: number }).visitCount

  await openBoard(page)
  await expect(page.getByText(`${dateLabel(TODAY)}　ご来店中 4名`)).toBeVisible()
  await expect(cell(page, '田中 花子 様', 'お渡し')).toHaveAccessibleName(
    /^田中 花子 様\s+お渡し\s+対応中/,
  )
  await selectRow(page, '田中 花子 様')
  await page.getByRole('button', { name: '退店を記録する' }).click()

  await expect(page.getByText(`${dateLabel(TODAY)}　ご来店中 3名`)).toBeVisible()
  await expect(board(page).getByRole('rowheader', { name: /^田中 花子 様/ })).toHaveCount(0)
  // 「本日すべて」には残る。
  await page.getByRole('button', { name: '本日すべて' }).click()
  await expect(
    board(page)
      .getByRole('rowheader', { name: /^田中 花子 様/ })
      .first(),
  ).toBeVisible()

  const after = await request.get(`/api/staff/customers/${HANAKO}`, await authed(request))
  expect(((await after.json()) as { visitCount: number }).visitCount).toBe(visits + 1)
})

// @e2e-covers AC-RECEP-24 UC-RECEP-15
test('お待ちのまま帰られた来店は待ちの帯から外れ、受付履歴には残る', async ({ page, request }) => {
  await clearBoard(request)
  const stayed = await createWalkin(request, {
    purposeNote: 'フレームの相談',
    arrivedAt: minutesAgo(8),
  })
  const left = await createWalkin(request, {
    purposeNote: 'フレームの相談',
    arrivedAt: minutesAgo(5),
  })

  await openLedger(page)
  const grid = page.getByRole('grid', { name: '予約台帳' })
  await expect(grid.getByRole('gridcell', { name: 'お待ちのお客様　2名' })).toBeVisible()

  await destination(page, '来店受付').click()
  await selectRow(page, ticketName(left.ticketNo))
  await page.getByRole('button', { name: '退店を記録する' }).click()
  await expect(
    board(page).getByRole('rowheader', { name: new RegExp(`^${ticketName(left.ticketNo)}`) }),
  ).toHaveCount(0)

  await destination(page, '予約台帳').click()
  await expect(grid.getByRole('gridcell', { name: 'お待ちのお客様　1名' })).toBeVisible()
  // お待ち時間の集計の母数から落ちない（受付履歴には両方が残る）。
  // この面のほかの test も当日の受付を残すので、読み足しの 1 ページに収めず全部取る。
  const history = await readHistory(request, { from: TODAY, to: TODAY, limit: 200 })
  expect(history.items.map((item) => item.displayName)).toContain(ticketName(left.ticketNo))
  expect(history.items.map((item) => item.displayName)).toContain(ticketName(stayed.ticketNo))
})

// @e2e-covers AC-RECEP-25
test('「お客様名で探す」は期間・結果の絞り込みを保ったまま効く', async ({ page, request }) => {
  await clearBoard(request)
  await linkCustomer(request, await createWalkin(request, { purposeId: ADJUST }), HANAKO)
  const other = await createWalkin(request, { purposeId: ADJUST })

  await openHistory(page)
  await pickSpan(page, TODAY, TODAY)
  await pickResult(page, '成立')

  const list = page.getByRole('group', { name: '受付の一覧' })
  await expect(
    list.getByRole('button', { name: new RegExp(ticketName(other.ticketNo)) }),
  ).toBeVisible()
  await page.getByRole('searchbox', { name: 'お客様名で探す' }).fill('田中')

  // 田中 花子 様 の受付はこの面のほかの test も残しているので、残る行がすべて
  // 田中 花子 様 であること（ウォークインの行が 1 つも無いこと）で見る。
  await expect(list.getByRole('button', { name: /田中 花子 様/ }).first()).toBeVisible()
  await expect(list.getByRole('button', { name: /^ウォークイン/ })).toHaveCount(0)
  // 期間と結果はそのまま残っている。
  await expect(filterChip(page, '結果')).toContainText('成立')
  await expect(filterChip(page, '期間')).toContainText(dayLabel(TODAY))
})

// @e2e-covers AC-RECEP-26 UC-RECEP-16
test('選んだ 1 件から「予約を開く」でご予約へ移り、戻ると同じ絞り込みの受付履歴に戻る', async ({
  page,
  request,
}) => {
  await clearBoard(request)
  await linkCustomer(request, await createWalkin(request, { purposeId: ADJUST }), HANAKO)

  await openHistory(page)
  await pickSpan(page, TODAY, TODAY)
  await page.getByRole('searchbox', { name: 'お客様名で探す' }).fill('田中')
  await page
    .getByRole('group', { name: '受付の一覧' })
    .getByRole('button', { name: /田中 花子 様/ })
    .first()
    .click()

  const detail = page.getByRole('region', { name: '選んだ受付の中身' })
  await expect(detail.getByRole('button', { name: '予約を開く' })).toBeVisible()
  await detail.getByRole('button', { name: '予約を開く' }).click()
  await expect(page.getByRole('grid', { name: '予約台帳' })).toBeVisible()

  await destination(page, '受付履歴').click()
  await expect(page.getByRole('searchbox', { name: 'お客様名で探す' })).toHaveValue('田中')
  await expect(filterChip(page, '期間')).toContainText(dayLabel(TODAY))
})

// @e2e-covers AC-RECEP-27
test('ご来店中が 0 名のときは、見出し 1 行と理由 1 行と次の一手だけが残る', async ({
  page,
  request,
}) => {
  await clearBoard(request)

  await openBoard(page, false)
  await expect(page.getByRole('heading', { name: 'ご来店中のお客様はいません' })).toBeVisible()
  await expect(page.getByText('まだどなたもお着きになっていません。')).toBeVisible()
  await expect(page.getByRole('button', { name: '＋ ご来店を受け付ける' })).toHaveCount(1)
  // 行き止まりにしない。次の一手は台帳（店頭の受付パネル）へ繋がっている。
  await page.getByRole('button', { name: '＋ ご来店を受け付ける' }).click()
  await expect(page.getByRole('grid', { name: '予約台帳' })).toBeVisible()
})

// @e2e-covers AC-RECEP-28
test('受付履歴は新しい順に 20 件まで出て、残りは 1 行にまとまり、押すと読み足される', async ({
  page,
  request,
}) => {
  /*
   * **この 1 本だけが使う日に置く。** 以前は TODAY-2 に置いており、同じ日へ行を足す
   * ほかの面が先に走ると total が 23 を超えて落ちていた（23 のはずが 32）。
   * 28 日ちょうど戻すので曜日は変わらない（定休日の扱いも同じ）。
   */
  const day = shiftDate(TODAY, -30)
  expect(
    (await readHistory(request, { from: day, to: day })).total,
    'この日はこの test だけが使う。ほかの面が使い始めたら別の日へ移す。',
  ).toBe(0)
  for (let i = 0; i < 23; i += 1) {
    // 30 分ずつずらす（1 枠 1 件になり、同時受付の上限に当たらない）。
    const hhmm = `${String(10 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`
    await createWalkin(request, { purposeId: ADJUST, arrivedAt: atJst(day, hhmm) })
  }
  expect((await readHistory(request, { from: day, to: day })).total).toBe(23)

  await openHistory(page)
  await pickSpan(page, day, day)
  const list = page.getByRole('group', { name: '受付の一覧' })
  await expect(list.getByRole('button')).toHaveCount(20)
  const more = page.getByRole('button', { name: /^ほか 3件\s+\d+月\d+日まで$/ })
  await expect(more).toBeVisible()

  await more.click()
  await expect(list.getByRole('button')).toHaveCount(23)
  await expect(page.getByRole('button', { name: /^ほか \d+件/ })).toHaveCount(0)
})

// @e2e-covers AC-RECEP-29
test('担当を決めずに受け付ける 2 人目も同じ枠に載り、上限の 3 件目までは受け付けられる', async ({
  request,
}) => {
  // 同時受付の上限は seed の `store_slot_rules.max_parallel` = 3。ほかの test が触らない
  // 日の 11:00 に置いて、この 1 本だけで枠を数え切る。
  // ほかの e2e が触らない日の閉店後（21:00）に置く。営業時間の中だと、予約の受付を
  // 確かめる面（`booking.spec.ts`）が同じ枠を先に取っていることがある。
  const day = shiftDate(TODAY, 9)
  const startsAt = atJst(day, '21:00')
  const first = await createWalkin(request, { purposeId: ADJUST, startsAt, arrivedAt: startsAt })
  const second = await createWalkin(request, { purposeId: ADJUST, startsAt, arrivedAt: startsAt })
  const third = await createWalkin(request, { purposeId: ADJUST, startsAt, arrivedAt: startsAt })
  expect(new Set([first.id, second.id, third.id]).size).toBe(3)

  const { headers } = await authed(request)
  const fourth = await request.post('/api/staff/walkins', {
    headers: { ...headers, 'Idempotency-Key': crypto.randomUUID() },
    data: { storeId: GINZA, purposeId: ADJUST, startsAt, arrivedAt: startsAt },
  })
  expect(fourth.status()).toBe(409)
  expect(await fourth.json()).toEqual({ error: 'slot_taken' })

  // 枠が取れなかったので、予約もウォークインも 1 行も書かれていない。
  expect(await readWalkins(request, day)).toHaveLength(3)
})
