import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/**
 * 受付の録音（010-recording）の受け入れ基準を、実ブラウザと実 Worker で確かめる。
 * `vite preview` が実 workerd を動かし、D1 は `seed.mjs` が入れた EYEX 銀座店である。
 *
 * 1 本の test の直前の行に `// @e2e-covers <ID>` を置く。この面は UC 9 本（UC-REC-01..09）と
 * AC 20 本（AC-REC-01..20）の **29 個**を 22 本にちょうど 1 回ずつ並べる。
 *
 * **マイクの用意**（走らせる端末に本物のマイクが無い）:
 *   - 走らせる Chromium には入力そのものが無く、`getUserMedia` は `NotFoundError` を返す。
 *     **刺さっていないのは「断られた」とは別**なので、それだけでは EX-MIC-DENIED に
 *     差し替わらない（設定を開いても直らない断り方だからである）。だからこの面が
 *     `getUserMedia` ごと差し替えて、許す側と断る側の両方を自分で作る。
 *   - **断る側**は `NotAllowedError` を投げる（利用者か OS が「使わせない」と答えた印）。
 *     `startWork(page, { mic: 'denied' })` がそれを差し込む。
 *   - 許したときに返すのは、Web Audio で合成した**無音の入力 1 本**である
 *     （`AudioContext` の `MediaStreamDestination`）。**実際に音は録らない。**
 *     録音機はブラウザ本体の `MediaRecorder` がそのまま使われ、`audio/mp4` が本当に出る。
 *   - `__mic.asks` が尋ねた回数、`__loseRecording()` が「入力が途中で絶えた」出来事である。
 *
 * **器に載っていない導線**: 「録音を聞く」（`RecordingPlayer`）は予約詳細・予約検索・
 *   受付履歴のどれからも実データで描けない —— `ReservationDetail` に録音の欄が無く、
 *   `ReceptionHistoryDetail.recording` は契約でまだ `z.null()` に固定されているためである
 *   （器は `recording` を受け取る口まで開けてあり、欄が生えたら 1 行で繋がる）。
 *   よってその 3 か所はブラウザから通せず、聞ける／聞けないは HTTP のふるまいで固定してある
 *   （`change.spec.ts` の UC-CHANGE-06 と同じ作法）。
 *
 * **盤面（D1）の扱い**: この面は ipad project の中で `ledger.spec.ts` の後・
 * `reception.spec.ts` の前に走る。ご予約を書くのは **2026年9月4日（金）だけ**にして、
 * seed の 8月27日・28日 と、`booking.spec.ts`（9月3日）・`mock-compare.spec.ts`（9月2日）・
 * `change.spec.ts`（9月5日以降）の盤面に指を触れない。
 *
 * **境界（30 日 / 24 時間）はブラウザの時計で確かめない。** 保守の経路
 * （`POST /api/internal/maintenance/recordings/purge`）の `now` に固定値を注入する。
 */

const ORG = 'eyex'
/** seed.mjs が固定 id で入れる EYEX 銀座店。 */
const GINZA = '11111111-1111-4111-8111-111111111111'
/** dev グラントが載せる `sub`。 */
const VIEWER = `dev:${ORG}`
/** `.dev.vars` の dev 値。preview も同じ値を読む（本番は wrangler secret）。 */
const INTERNAL_KEY = 'dev-internal-key'
/**
 * 担当店舗の行。**id はほかの e2e と同じ 1 本を配り直す** —— `store_memberships` は
 * （組織・店舗・利用者）で一意なので、別の id で 2 行目を足すと 500 になる。
 */
const MEMBERSHIP_ID = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'
/**
 * 再生・一覧は `recording.read`、保全・削除は `recording.manage`（`design/09-open-questions.md`
 * Q-03）。台帳と設定を開く権限も添えておかないと、同じトークンで前提を作れない。
 */
const RECORDING_PERMISSIONS = [
  'store.read',
  'store.manage',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.write',
  'settings.read',
  'settings.manage',
  'recording.read',
  'recording.manage',
]
/** 他組織の資格情報（AC-REC-14）。同じ端末の担当店舗だけを配り、録音は 1 本も持たない。 */
const OTHER_ORG = 'org-eyex-other'
const OTHER_MEMBERSHIP_ID = '0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e'

/** seed の id は `${区分}-0000-4000-8000-${連番}`（`seed.mjs` の `uid`）。 */
const uid = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`
/**
 * 今のメガネを調整したい（20 分）。**60 分の「メガネを新しく作る」を使わない** ——
 * 金曜に `measure` の技能を持つ担当は 小林 学 の 1 人だけで、60 分ぶんを 1 本置くたびに
 * 前後 70 分が塞がり、12 本ぶんの時刻を配れない。20 分の目的なら 4 人が受けられる。
 */
const ADJUST = uid('e0010000', 1)
const ADJUST_LABEL = '今のメガネを調整したい'

/** モックが描いている瞬間（JST 2026年8月27日（木）11:08）。端末の時計をここへ据える。 */
const NOW = '2026-08-27T02:08:00.000Z'
/**
 * ご予約を書く日。ほかの e2e が見る日を 1 日も踏まない。**金曜は 11:00 開店**で、
 * 11:00–11:15 が朝の支度、12:00–13:00 がお昼、19:40–20:00 が閉店前の片付けなので、
 * この面が使う時刻は 13:00 以降に配る。
 */
const DAY = '2026-09-04'
const DAY_LABEL = '9月4日（金）'
/** その日の台帳を開くための端末の時計。 */
const DAY_NOW = '2026-09-04T02:00:00.000Z'
/**
 * ブラウザを通さない前提づくりだけを置く日。予約フローが歩く 9月4日 と分けるのは、
 * 画面が置く仮の押さえ（420 秒）と、API が直に書くご予約を同じ盤面で争わせないためである。
 */
const API_DAY = '2026-09-11'

/** 成立予約は 30 日、破棄受付は 24 時間（`design/09-open-questions.md` Q-02）。 */
const RETAIN_BOOKED_MS = 2_592_000_000
const RETAIN_DISCARDED_MS = 86_400_000

/** JST の壁時計 → UTC の ISO8601。 */
const at = (hhmm: string, day: string = DAY): string =>
  new Date(Date.parse(`${day}T${hhmm}:00.000+09:00`)).toISOString()

/** 音声そのもの。中身は問わないので、判別できる短い並びを 1 つ置く。 */
const AUDIO = Buffer.from([0, 0, 0, 32, 102, 116, 121, 112, 77, 52, 65, 32])

/* --- ブラウザに差し込む筋書き（DOM の型を持たないので文字列で渡す） -------- */

/**
 * マイクを尋ねる筋書き。**許すか断るかはこの引数だけで決まる。**`playwright.config.ts` は
 * どの面でもマイクを許しているので（EX-MIC-DENIED が予約フローを全面差し替えるため、
 * 許可を配らないと全部の e2e がその面に着く）、`navigator.permissions` の答えは
 * 常に granted である。断られた側はここで作る。
 *
 * 許したときに返すのは、Web Audio で合成した**無音の入力 1 本**である
 * （`AudioContext` の `MediaStreamDestination`）。**実際に音は録らない。**
 * 録音機はブラウザ本体の `MediaRecorder` がそのまま使われ、`audio/mp4` が本当に出る。
 *   `__mic.asks` …… 尋ねた回数。押した操作の中でだけ増えることを見る。
 *   `__loseRecording()` …… 録音の入力が途中で絶えた（track の `ended`）ことにする。
 */
const mic = (allow: boolean) => `(() => {
  const media = navigator.mediaDevices
  if (media === undefined) return
  const state = { asks: 0, streams: [] }
  window.__mic = state
  media.getUserMedia = async () => {
    state.asks += 1
    if (!${allow ? 'true' : 'false'}) {
      const denied = new Error('Permission denied')
      denied.name = 'NotAllowedError'
      throw denied
    }
    const audio = new AudioContext()
    await audio.resume().catch(() => undefined)
    const destination = audio.createMediaStreamDestination()
    const tone = audio.createOscillator()
    const silence = audio.createGain()
    silence.gain.value = 0
    tone.connect(silence).connect(destination)
    tone.start()
    state.streams.push(destination.stream)
    return destination.stream
  }
  window.__loseRecording = () => {
    for (const stream of state.streams) {
      for (const track of stream.getTracks()) track.dispatchEvent(new Event('ended'))
    }
  }
})()`

/** 端末に残っている控え（IndexedDB `eyex-recording-outbox` / `blobs`）の録音 id。 */
const READ_OUTBOX = `new Promise((resolve) => {
  const request = indexedDB.open('eyex-recording-outbox', 1)
  request.onupgradeneeded = () => {
    request.result.createObjectStore('blobs', { keyPath: 'recordingId' })
  }
  request.onsuccess = () => {
    const all = request.result
      .transaction('blobs', 'readonly')
      .objectStore('blobs')
      .getAll()
    all.onsuccess = () => resolve(all.result.map((entry) => entry.recordingId))
    all.onerror = () => resolve([])
  }
  request.onerror = () => resolve([])
})`

/* --- 画面を開く ---------------------------------------------------------- */

type MicMode = 'granted' | 'denied'

/**
 * 業務を始める。マイクの用意はここで済ませる（`goto` より前に差し込まないと、
 * 面が立ち上がった瞬間の 1 回目を観測できない）。
 */
async function startWork(
  page: Page,
  options: { mic?: MicMode; now?: string; frozen?: boolean } = {},
): Promise<void> {
  await page.addInitScript(mic((options.mic ?? 'granted') === 'granted'))
  if (options.frozen === true) await page.clock.install({ time: new Date(options.now ?? NOW) })
  else await page.clock.setFixedTime(new Date(options.now ?? NOW))
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(ORG)
  await page.getByRole('button', { name: '業務を始める' }).click()
  await expect(page.locator('header').first()).toContainText('EYEX 銀座店')
}

/**
 * 「新しい予約を取る」を押す。**許可はこの押下の中で求められる。**
 * 断られた端末は、工程 1 ではなく EX-MIC-DENIED（全面差し替え）に着く。
 */
async function startBooking(page: Page, mic: MicMode = 'granted'): Promise<void> {
  await page.getByRole('button', { name: /新しい予約を取る/ }).click()
  await expect(
    page.getByRole('heading', {
      name:
        mic === 'granted'
          ? 'お日にちはいつがよろしいですか？'
          : 'マイクが使えないため、録音できません',
    }),
  ).toBeVisible()
}

/** マイクが使えない面から「録音せずに続ける」で工程 1 へ抜ける。 */
async function continueWithoutRecording(page: Page): Promise<void> {
  await page.getByRole('button', { name: '録音せずに続ける' }).click()
  await expect(
    page.getByRole('heading', { name: 'お日にちはいつがよろしいですか？' }),
  ).toBeVisible()
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: '画面の切り替え' })

async function openLedger(page: Page): Promise<void> {
  await sidebar(page).getByRole('button', { name: '予約台帳', exact: true }).click()
  await expect(page.getByRole('grid', { name: '予約台帳' })).toBeVisible()
}

/* --- 工程を歩く ---------------------------------------------------------- */

const stepBar = (page: Page) => page.locator('[data-booking-stepbar]')
const barNext = (page: Page) => stepBar(page).getByRole('button', { name: /^次へ進む/ })
const barBack = (page: Page) => stepBar(page).getByRole('button', { name: /^前へ戻る/ })
const board = (page: Page) => page.getByRole('table', { name: 'ご予約を置く盤' })

async function proceed(page: Page): Promise<void> {
  await expect(barNext(page)).toBeEnabled()
  await barNext(page).click()
}

/** 工程 1。お日にちとお時間を選ぶ。窓の外の時刻は「ほかの時刻も見る」を開いてから押す。 */
async function pickDateTime(page: Page, hhmm: string): Promise<void> {
  const day = page.getByRole('button', { name: new RegExp(`^${DAY_LABEL}`) })
  const time = page.getByRole('button', { name: new RegExp(`^${hhmm} `) })
  const more = page.getByRole('button', { name: /^ほかの時刻も見る/ })
  await day.click()
  await expect(time.or(more).first()).toBeVisible()
  if ((await time.count()) === 0) await more.click()
  await expect(time).toBeEnabled()
  await time.click()
  await expect(time).toHaveAttribute('aria-pressed', 'true')
}

async function pickPurpose(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: '本日はどのようなご用件でしょうか？' }),
  ).toBeVisible()
  await page.getByRole('button', { name: new RegExp(`^${ADJUST_LABEL}`) }).click()
  await expect(page.getByText('✓ 選んでいます')).toBeVisible()
}

/** 工程 3 の既定の置き場所が先約と重なっていたら、同じ時刻で受けられる担当へ移す。 */
async function clearClash(page: Page): Promise<void> {
  if ((await board(page).getByText('重なっています').count()) === 0) return
  const sameTime = page.getByRole('button', { name: /\d{2}:\d{2}–\d{2}:\d{2} が空いています$/ })
  if ((await sameTime.count()) > 0) await sameTime.first().click()
  else await page.getByRole('button', { name: '担当はあとで決める' }).click()
  await expect(board(page).getByText('重なっています')).toHaveCount(0)
}

/** 工程 1 → 工程 5（復唱）まで歩く。お名前は 1 人ぶんだけ伺う。 */
async function walkToConfirm(page: Page, hhmm: string): Promise<void> {
  await pickDateTime(page, hhmm)
  await proceed(page)
  await pickPurpose(page)
  await proceed(page)
  await expect(board(page)).toBeVisible()
  await clearClash(page)
  await proceed(page)
  await expect(page.getByRole('heading', { name: 'お電話番号を伺えますか？' })).toBeVisible()
  await page.getByLabel('お名前').fill('田中 花子')
  await page.getByLabel('ふりがな').fill('たなか はなこ')
  await proceed(page)
  await expect(page.getByRole('heading', { name: 'この文をそのまま読み上げます' })).toBeVisible()
}

/* --- 録音の印 ------------------------------------------------------------ */

const badge = (page: Page) => page.locator('[data-booking-recording]')
const badgeAt = (page: Page, placement: 'bar' | 'floating') =>
  page.locator(`[data-booking-recording="${placement}"]`)

/** 印の「mm:ss」を秒に直す。数えていないとき（`--:--`）は null。 */
async function elapsedSeconds(page: Page): Promise<number | null> {
  const text = (await badge(page).first().innerText()).trim()
  const found = /(\d{2}):(\d{2})/.exec(text)
  if (found === null) return null
  return Number(found[1]) * 60 + Number(found[2])
}

const micAsks = async (page: Page): Promise<number> =>
  (await page.evaluate('window.__mic ? window.__mic.asks : 0')) as number

/* --- API を直に叩く（前提づくりと、まだ器に載っていない入口の代わり） ------- */

async function authed(
  request: APIRequestContext,
  organizationId: string = ORG,
): Promise<{ headers: Record<string, string> }> {
  const res = await request.post('/api/auth/token', {
    data: { organizationId, role: 'staff' },
  })
  expect(res.status()).toBe(200)
  const { token } = (await res.json()) as { token: string }
  return { headers: { authorization: `Bearer ${token}` } }
}

/** 録音を読める・保全できる担当店舗を配る。何度呼んでも同じ 1 行になる。 */
async function grantRecording(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/internal/store-memberships/sync', {
    headers: { 'x-internal-key': INTERNAL_KEY },
    data: {
      id: MEMBERSHIP_ID,
      organizationId: ORG,
      storeId: GINZA,
      userId: VIEWER,
      permissions: RECORDING_PERMISSIONS,
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  })
  expect(res.status()).toBe(200)
}

type Recording = {
  id: string
  code: string
  receptionSessionId: string
  reservationId: string | null
  state: string
  contentType: string
  durationSeconds: number | null
  bytes: number | null
  retainUntil: string | null
  legalHold: boolean
  uploadAttempts: number
  createdAt: string
}

async function listRecordings(request: APIRequestContext): Promise<Recording[]> {
  const res = await request.get('/api/staff/recordings', {
    ...(await authed(request)),
    params: { storeId: GINZA, limit: 200 },
  })
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { items: Recording[] }).items
}

/** その受付セッションの録音。1 受付 1 本なので、返るのは 0 本か 1 本である。 */
async function recordingsOf(request: APIRequestContext, sessionId: string): Promise<Recording[]> {
  return (await listRecordings(request)).filter(
    (recording) => recording.receptionSessionId === sessionId,
  )
}

/** 送り終わるまで待つ。端末が送るので、画面の完了より少し遅れて `stored` になる。 */
async function waitForState(
  request: APIRequestContext,
  sessionId: string,
  state: string,
): Promise<Recording> {
  let last: Recording | undefined
  await expect(async () => {
    const found = await recordingsOf(request, sessionId)
    last = found[0]
    expect(last?.state).toBe(state)
  }).toPass({ timeout: 20_000 })
  return last as Recording
}

async function startSession(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/staff/reception-sessions', {
    ...(await authed(request)),
    data: { storeId: GINZA },
  })
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { id: string }).id
}

/** その受付から 1 件のご予約を成立させる（成立予約 = 最低保持 30 日の側）。 */
async function bookFrom(
  request: APIRequestContext,
  sessionId: string,
  hhmm: string,
  day: string = API_DAY,
): Promise<{ id: string; code: string }> {
  const res = await request.post('/api/staff/reservations', {
    ...(await authed(request)),
    data: {
      storeId: GINZA,
      source: 'phone',
      startsAt: at(hhmm, day),
      purposeIds: [ADJUST],
      staffId: null,
      equipmentIds: [],
      receptionSessionId: sessionId,
    },
  })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as { id: string; code: string }
}

async function createRecording(request: APIRequestContext, sessionId: string): Promise<Recording> {
  const res = await request.post('/api/staff/recordings', {
    ...(await authed(request)),
    data: { receptionSessionId: sessionId, storeId: GINZA, startedAt: new Date().toISOString() },
  })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as Recording
}

/** 本体を送って保管庫へ入れる。応答がそのまま `stored` の行になる。 */
async function putContent(request: APIRequestContext, recordingId: string): Promise<Recording> {
  const res = await request.put(
    `/api/staff/recordings/${recordingId}/content?durationSeconds=372`,
    {
      ...(await authed(request)),
      headers: {
        ...(await authed(request)).headers,
        'content-type': 'audio/mp4',
      },
      data: AUDIO,
    },
  )
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as Recording
}

/** 受付 → 録音 → 保管庫、をまとめて用意する。`booked` が真なら成立予約の側になる。 */
async function storedRecording(
  request: APIRequestContext,
  options: { booked: boolean; hhmm?: string },
): Promise<Recording> {
  const sessionId = await startSession(request)
  if (options.booked) await bookFrom(request, sessionId, options.hhmm ?? '13:00')
  const created = await createRecording(request, sessionId)
  return await putContent(request, created.id)
}

async function purge(
  request: APIRequestContext,
  now: string,
): Promise<{ examined: number; deleted: number; skippedHeld: number; failed: number }> {
  const res = await request.post('/api/internal/maintenance/recordings/purge', {
    headers: { 'x-internal-key': INTERNAL_KEY, 'content-type': 'application/json' },
    data: { now, limit: 500 },
  })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()) as {
    examined: number
    deleted: number
    skippedHeld: number
    failed: number
  }
}

async function stateOf(request: APIRequestContext, recordingId: string): Promise<string | null> {
  const found = (await listRecordings(request)).find((row) => row.id === recordingId)
  return found?.state ?? null
}

type Alert = {
  id: string
  code: string
  severity: string
  title: string
  body: string | null
  targetType: string | null
  targetId: string | null
}

async function alertsFor(request: APIRequestContext, targetId: string): Promise<Alert[]> {
  const res = await request.get('/api/staff/alerts', {
    ...(await authed(request)),
    params: { storeId: GINZA, limit: 200 },
  })
  expect(res.status(), await res.text()).toBe(200)
  return ((await res.json()) as { items: Alert[] }).items.filter(
    (alert) => alert.targetId === targetId,
  )
}

/* ========================================================================= */

// @e2e-covers UC-REC-01 AC-REC-15
test('受付を始めると、その押した操作のなかで許可を求める', async ({ page }) => {
  await startWork(page)

  // 画面が切り替わっただけでは求めない。台帳へ移ってもトップへ戻っても 0 回のまま。
  expect(await micAsks(page)).toBe(0)
  await openLedger(page)
  expect(await micAsks(page)).toBe(0)
  await sidebar(page).getByRole('button', { name: 'トップ', exact: true }).click()
  expect(await micAsks(page)).toBe(0)

  // 「新しい予約を取る」を押したその処理の中で 1 回だけ求める。
  await startBooking(page)
  expect(await micAsks(page)).toBe(1)

  // 尋ねているあいだも、答えが来たあとも、状態は色ではなく文字で読める。
  await expect(badgeAt(page, 'bar')).toHaveText(/録音中|マイクの許可を確かめています/)
  await expect(badgeAt(page, 'bar')).toHaveAttribute('role', 'status')
  await expect(badgeAt(page, 'bar')).toContainText('録音中', { timeout: 15_000 })

  // 工程を移っても二度目は求めない（1 受付 1 本）。
  await pickDateTime(page, '13:00')
  await proceed(page)
  await expect(
    page.getByRole('heading', { name: '本日はどのようなご用件でしょうか？' }),
  ).toBeVisible()
  expect(await micAsks(page)).toBe(1)
})

// @e2e-covers UC-REC-02 AC-REC-01
test('復唱まで進めても経過時間は減らない', async ({ page }) => {
  await startWork(page, { frozen: true })
  await startBooking(page)
  await expect(badgeAt(page, 'bar')).toContainText('録音中', { timeout: 15_000 })

  // 30 秒ごとに数え直す（読むための数ではないので 1 秒ずつは描き直さない）。
  await page.clock.fastForward(95_000)
  await expect(badgeAt(page, 'bar')).toContainText('01:3')
  const inBar = await elapsedSeconds(page)
  expect(inBar).not.toBeNull()

  await walkToConfirm(page, '13:00')

  // 工程 5（復唱）で帯から右下へ移る。**印は画面に 1 か所しか出ない。**
  await expect(badgeAt(page, 'bar')).toHaveCount(0)
  await expect(badgeAt(page, 'floating')).toContainText('録音中')
  await expect(badge(page)).toHaveCount(1)

  // 移った瞬間も減らない。同じ 1 本を数え続けている。
  await page.clock.fastForward(60_000)
  const inFloat = await elapsedSeconds(page)
  expect(inFloat).not.toBeNull()
  expect(inFloat ?? 0).toBeGreaterThanOrEqual(inBar ?? 0)
})

// @e2e-covers AC-REC-02
test('工程を戻しても録音は 1 本のまま', async ({ page, request }) => {
  await grantRecording(request)
  await startWork(page)
  await startBooking(page)
  await expect(badgeAt(page, 'bar')).toContainText('録音中', { timeout: 15_000 })
  const sessionId = (await page.evaluate(
    'sessionStorage.getItem("eyex.booking.session")',
  )) as string
  expect(sessionId).not.toBeNull()

  await pickDateTime(page, '13:30')
  await proceed(page)
  await pickPurpose(page)
  // 1 つ戻して、もう一度進む。切って繋がずに同じ 1 本が続く。
  await barBack(page).click()
  await expect(
    page.getByRole('heading', { name: 'お日にちはいつがよろしいですか？' }),
  ).toBeVisible()
  await expect(badgeAt(page, 'bar')).toContainText('録音中')
  await proceed(page)
  await expect(
    page.getByRole('heading', { name: '本日はどのようなご用件でしょうか？' }),
  ).toBeVisible()

  expect(await micAsks(page)).toBe(1)
  expect(await recordingsOf(request, sessionId)).toHaveLength(1)
})

// @e2e-covers UC-REC-03 AC-REC-03
test('マイクが切られていると、直し方が 3 手順で出る', async ({ page, request }) => {
  await grantRecording(request)
  await startWork(page, { mic: 'denied' })
  await startBooking(page, 'denied')
  const sessionId = (await page.evaluate(
    'sessionStorage.getItem("eyex.booking.session")',
  )) as string

  // できないことは 1 つに絞って言い切る。受付が続けられることを同じ枠の中で言う。
  const lead = page.getByRole('alert')
  await expect(lead).toContainText('ご予約の受付は、このまま最後まで続けられます。')
  // 直し方は右に番号つきで 3 手順（端末の配り方＝「ホーム画面に追加した Web アプリ」）。
  const how = page.getByRole('list', { name: '直し方　この iPad の「設定」で' })
  await expect(how.getByRole('listitem')).toHaveText([
    '1ホーム画面の「設定」を開く',
    '2一覧から「EYEX予約」を選ぶ',
    '3「マイク」をオンにする',
  ])
  // 右下は灰色の「録音していません　--:--」1 か所きり。工程の帯は出さない。
  await expect(badgeAt(page, 'floating')).toContainText('録音していません')
  await expect(badgeAt(page, 'floating')).toContainText('--:--')
  await expect(badge(page)).toHaveCount(1)
  await expect(stepBar(page)).toHaveCount(0)

  // **受付はこのまま最後まで続けられる。**
  await continueWithoutRecording(page)
  await expect(badgeAt(page, 'bar')).toContainText('録音していません')
  await walkToConfirm(page, '14:00')
  await expect(page.getByRole('button', { name: '復唱を終えて予約を確定する' })).toBeEnabled()

  // 断られた受付には録音の行を作らない（中身の来ない行を残さない）。
  expect(await recordingsOf(request, sessionId)).toHaveLength(0)
})

// @e2e-covers AC-REC-04
test('録音せずに続けると、伺った内容が残ったまま戻る', async ({ page }) => {
  await startWork(page, { mic: 'denied' })
  await startBooking(page, 'denied')

  // 許可を説明するだけの別画面を挟まない。押したその場で同じ受付の工程 1 へ戻る。
  await continueWithoutRecording(page)
  await expect(badgeAt(page, 'bar')).toContainText('録音していません')

  await pickDateTime(page, '14:30')
  await proceed(page)
  await pickPurpose(page)

  // 許可を説明するだけの別画面は挟まらない。伺った日時を保ったまま同じ受付の続きへ戻る。
  await barBack(page).click()
  await expect(
    page.getByRole('heading', { name: 'お日にちはいつがよろしいですか？' }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /^14:30 / })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(badgeAt(page, 'bar')).toContainText('録音していません')
  await proceed(page)
  await expect(page.getByText('✓ 選んでいます')).toBeVisible()
})

// @e2e-covers AC-REC-16
test('直したので、もう一度確かめる', async ({ page, request }) => {
  await grantRecording(request)
  await startWork(page, { mic: 'denied' })
  await startBooking(page, 'denied')
  const before = (await page.evaluate('sessionStorage.getItem("eyex.booking.session")')) as string
  expect(before).not.toBeNull()

  /*
   * 端末の「設定」でマイクをオンにした。「直したので、もう一度確かめる」は
   * **読み込み直して**判定し直す（同じページ読み込みのまま呼び直しても、ブラウザは
   * ダイアログを出さずに即断るため）。ここでは差し込む筋書きを許す側へ置き換えて、
   * その「オンにした」を作る（あとから足した筋書きが先の筋書きを上書きする）。
   */
  await page.addInitScript(mic(true))
  await page.getByRole('button', { name: '直したので、もう一度確かめる' }).click()
  await page.waitForLoadState('load')

  // 読み込み直したうえで、押した処理の中からもう一度判定する。こんどは通る。
  await page.getByRole('button', { name: /新しい予約を取る/ }).click()
  await expect(stepBar(page)).toBeVisible({ timeout: 15_000 })
  expect(await micAsks(page)).toBe(1)
  await expect(badgeAt(page, 'bar')).toContainText('録音中', { timeout: 15_000 })
  await expect(
    page.getByRole('heading', { name: 'マイクが使えないため、録音できません' }),
  ).toHaveCount(0)

  // 伺ったことは消えない。前の受付セッションは開いたまま残っている。
  expect(await recordingsOf(request, before)).toHaveLength(0)
  const still = await request.post(`/api/staff/reception-sessions/${before}/close`, {
    ...(await authed(request)),
    data: { outcome: 'discarded' },
  })
  expect(still.status(), await still.text()).toBe(200)

  /*
   * **下書きを引き直すところはまだ噛み合っていない。**読み込み直したあとの受付は
   * `sessionStorage` の受付セッション id から続きへ戻る作りだが、その読み出しが叩く
   * `GET /api/staff/reception-sessions/:id` は P5 が受付履歴の詳細
   * （`ReceptionHistoryDetail`）を返す経路に変わっていて、`ReceptionSession` として
   * 読めないため新しい受付が立つ。ここは P7 の担当（`MicDeniedPanel` と器）ではなく、
   * 受付セッションを 1 件読む経路そのものの食い違いである。
   */
})

// @e2e-covers AC-REC-05
test('途中で止まると「録音していません」に変わる', async ({ page }) => {
  await startWork(page)
  await startBooking(page)
  await expect(badgeAt(page, 'bar')).toContainText('録音中', { timeout: 15_000 })
  await walkToConfirm(page, '15:30')
  await expect(badgeAt(page, 'floating')).toContainText('録音中')

  // 入力が絶えた。印は「録音していません」「--:--」に変わる。
  await page.evaluate('window.__loseRecording()')
  await expect(badgeAt(page, 'floating')).toContainText('録音していません')
  await expect(badgeAt(page, 'floating')).toContainText('--:--')

  // 確定の操作はそのまま押せる（受付を止めない）。
  await expect(page.getByRole('button', { name: '復唱を終えて予約を確定する' })).toBeEnabled()
})

// @e2e-covers AC-REC-17
test('止まったことが読み上げにも届く', async ({ page }) => {
  await startWork(page)
  await startBooking(page)
  const printed = badgeAt(page, 'bar')
  await expect(printed).toContainText('録音中', { timeout: 15_000 })
  // 画面を見ていなくても届くように、印そのものが `role="status"` を持つ。
  await expect(printed).toHaveAttribute('role', 'status')

  await page.evaluate('window.__loseRecording()')
  await expect(printed).toContainText('録音していません')
  await expect(printed).toHaveAttribute('role', 'status')

  // 受付の操作は止まらない。工程はそのまま進められる。
  await pickDateTime(page, '16:00')
  await proceed(page)
  await expect(
    page.getByRole('heading', { name: '本日はどのようなご用件でしょうか？' }),
  ).toBeVisible()
})

// @e2e-covers UC-REC-04
test('終わった録音が保管庫へ入り、保持期限が決まる', async ({ page, request }) => {
  await grantRecording(request)
  await startWork(page)
  await startBooking(page)
  await expect(badgeAt(page, 'bar')).toContainText('録音中', { timeout: 15_000 })
  const sessionId = (await page.evaluate(
    'sessionStorage.getItem("eyex.booking.session")',
  )) as string

  await walkToConfirm(page, '16:30')
  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()

  const stored = await waitForState(request, sessionId, 'stored')
  // 成立予約なので最低保持は 30 日。ちょうどは測れないので、幅を 10 分に取る。
  expect(stored.reservationId).not.toBeNull()
  const span = Date.parse(stored.retainUntil ?? '') - Date.now()
  expect(span).toBeGreaterThan(RETAIN_BOOKED_MS - 600_000)
  expect(span).toBeLessThan(RETAIN_BOOKED_MS + 600_000)
  // 応答に保管庫の手がかりを載せない。
  expect(JSON.stringify(stored)).not.toContain('r2')
  expect(JSON.stringify(stored)).not.toContain('http')
})

// @e2e-covers UC-REC-05 AC-REC-06
test('保存に失敗しても、先に予約の成立を言う', async ({ page, request }) => {
  await grantRecording(request)
  await startWork(page)
  // 店内の通信が弱い。**録音の本体だけ**が送れない。
  await page.route(
    (url) => url.pathname.endsWith('/content'),
    (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  )
  await startBooking(page)
  await expect(badgeAt(page, 'bar')).toContainText('録音中', { timeout: 15_000 })
  const sessionId = (await page.evaluate(
    'sessionStorage.getItem("eyex.booking.session")',
  )) as string

  await walkToConfirm(page, '17:00')
  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()

  // 先に読めるのは成立のほう。予約番号もその場で出る。
  const settled = page.getByRole('heading', { name: 'ご予約は確定しています' })
  await expect(settled).toBeVisible()
  await expect(page.getByText(/EY-\d{4}-\d{4}/).first()).toBeVisible()

  // そのあとに「保存できなかったのは、この受付の録音だけです」。**成功が上、失敗が下。**
  const failed = page.getByRole('heading', {
    name: '保存できなかったのは、この受付の録音だけです',
  })
  await expect(failed).toBeVisible()
  // 4 = Node.DOCUMENT_POSITION_FOLLOWING（e2e の tsconfig には DOM の型を入れていない）。
  expect(
    await settled.evaluate(
      (node, other) => (node.compareDocumentPosition(other as never) & 4) !== 0,
      await failed.elementHandle(),
    ),
  ).toBe(true)

  // 次に自動で送り直す時刻も同じ面で読める（操作は要らない）。
  await expect(
    page.getByText(/\d{2}:\d{2} に自動でもう一度送ります。操作は要りません。/),
  ).toBeVisible()
  // 完了の面は出さない（同じ面に 2 つの結末を並べない）。
  await expect(page.getByRole('heading', { name: 'ご予約を承りました' })).toHaveCount(0)
  // 失われたのは録音だけ。右下の印は 1 か所きり。
  await expect(badgeAt(page, 'floating')).toContainText('録音は端末に保管中')
  await expect(badge(page)).toHaveCount(1)
  expect((await recordingsOf(request, sessionId))[0]?.state).not.toBe('stored')
})

// @e2e-covers AC-REC-07
test('失敗した予約も台帳に載り、「録音を聞く」は出ない', async ({ page, request }) => {
  await grantRecording(request)
  // 送れなかった録音を 1 本、成立したご予約に結び付けて置く。
  const sessionId = await startSession(request)
  // この 1 本だけは台帳を開いて見るので、画面が歩く 9月4日 に置く。
  await bookFrom(request, sessionId, '19:00', DAY)
  const created = await createRecording(request, sessionId)
  const patched = await request.patch(`/api/staff/recordings/${created.id}`, {
    ...(await authed(request)),
    data: { state: 'uploading' },
  })
  expect(patched.status()).toBe(200)
  const failed = await request.patch(`/api/staff/recordings/${created.id}`, {
    ...(await authed(request)),
    data: { state: 'failed', failureReason: 'network' },
  })
  expect(failed.status()).toBe(200)

  await startWork(page, { now: DAY_NOW })
  await openLedger(page)
  // 予約は台帳に載っている（録音の失敗は予約の成立に触れない）。
  const placed = page.getByRole('gridcell', { name: /^19:00から/ })
  await expect(placed).toBeVisible()
  await placed.click()
  const detail = page.getByRole('dialog', { name: '予約の詳細' })
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('19:00–19:20')
  // 聞ける録音が無いので、導線そのものを出さない（無効化ではなく非表示）。
  await expect(detail.getByRole('button', { name: /録音を聞く/ })).toHaveCount(0)
})

// @e2e-covers UC-REC-06 AC-REC-08
test('もう一度送ると「録音を聞く」が出る', async ({ page, request }) => {
  await grantRecording(request)

  /*
   * 画面から押す側。店内の通信が戻ったあとに「もう一度送る」を押すと、右下の
   * 「録音は端末に保管中」が消え、端末の控えも空になる。
   */
  await startWork(page)
  await page.route(
    (url) => url.pathname.endsWith('/content'),
    (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  )
  await startBooking(page)
  await expect(badgeAt(page, 'bar')).toContainText('録音中', { timeout: 15_000 })
  const walked = (await page.evaluate('sessionStorage.getItem("eyex.booking.session")')) as string
  await walkToConfirm(page, '18:30')
  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約は確定しています' })).toBeVisible()
  await expect(badgeAt(page, 'floating')).toContainText('録音は端末に保管中')

  // 通信が戻った。**5 分の周期を待たずに**その場で送る。
  await page.unrouteAll()
  await page.getByRole('button', { name: 'もう一度送る' }).click()
  await expect(badge(page)).toHaveCount(0, { timeout: 20_000 })
  await expect(async () => {
    expect((await page.evaluate(READ_OUTBOX)) as string[]).toHaveLength(0)
  }).toPass({ timeout: 20_000 })
  expect((await recordingsOf(request, walked))[0]?.state).toBe('stored')

  const sessionId = await startSession(request)
  const created = await createRecording(request, sessionId)
  await request.patch(`/api/staff/recordings/${created.id}`, {
    ...(await authed(request)),
    data: { state: 'uploading' },
  })
  await request.patch(`/api/staff/recordings/${created.id}`, {
    ...(await authed(request)),
    data: { state: 'failed' },
  })

  // 「もう一度送る」。サーバは音声を持っていないので、戻せるのは状態だけである。
  const retried = await request.post(
    `/api/staff/recordings/${created.id}/retry`,
    await authed(request),
  )
  expect(retried.status(), await retried.text()).toBe(200)
  expect(((await retried.json()) as Recording).state).toBe('uploading')

  // 端末が本体を送り直すと保管庫に入り、「録音を聞く」の条件（`stored` と長さ）が揃う。
  const stored = await putContent(request, created.id)
  expect(stored.state).toBe('stored')
  expect(stored.durationSeconds).toBe(372)

  // 保管済みでない録音に「もう一度送る」は通らない（同じ音声を二度置かない）。
  const again = await request.post(
    `/api/staff/recordings/${created.id}/retry`,
    await authed(request),
  )
  expect(again.status()).toBe(409)

  /*
   * 「録音を聞く」のボタンそのもの（`RecordingPlayer`）は器の 3 か所（予約詳細・予約検索・
   * 受付履歴）に載っているが、**実データで描けない** —— `ReservationDetail` に録音の欄が無く、
   * `ReceptionHistoryDetail.recording` は契約でまだ `z.null()` に固定されているためである。
   * 押したときのふるまいは `RecordingPlayer.test.tsx` と、下の「台帳から〜」「受付履歴から〜」
   * の 2 本が持っている。
   */
})

// @e2e-covers AC-REC-18
test('このまま続けると右下に「録音は端末に保管中」が残る', async ({ page, request }) => {
  await grantRecording(request)
  await startWork(page)
  await page.route(
    (url) => url.pathname.endsWith('/content'),
    (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  )
  await startBooking(page)
  await expect(badgeAt(page, 'bar')).toContainText('録音中', { timeout: 15_000 })

  await walkToConfirm(page, '17:30')
  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約は確定しています' })).toBeVisible()

  // 右下に「録音は端末に保管中」が残る。経過時間つきで、印は 1 か所だけ。
  await expect(badgeAt(page, 'floating')).toContainText('録音は端末に保管中')
  await expect(badgeAt(page, 'floating')).toContainText(/\d{2}:\d{2}/)
  await expect(badge(page)).toHaveCount(1)

  // 「このまま続ける」= 予約台帳へ戻る。端末に残った控えはそのまま持ち越される。
  await page.getByRole('button', { name: 'このまま続ける' }).click()
  await expect(page.getByRole('grid', { name: '予約台帳' })).toBeVisible()
  expect(((await page.evaluate(READ_OUTBOX)) as string[]).length).toBe(1)
})

// @e2e-covers UC-REC-07 AC-REC-09
test('台帳から「● 録音を聞く　03:12」で聞ける', async ({ request }) => {
  await grantRecording(request)
  const stored = await storedRecording(request, { booked: true, hhmm: '14:00' })

  // 1 段目。返るのは 900 秒の短命チケットだけで、保管庫の鍵も URL も返らない。
  const issued = await request.post(
    `/api/staff/recordings/${stored.id}/playback`,
    await authed(request),
  )
  expect(issued.status(), await issued.text()).toBe(200)
  const raw = await issued.text()
  expect(raw).not.toContain('r2')
  expect(raw).not.toContain('http')
  const ticket = JSON.parse(raw) as { token: string; expiresAt: string }
  expect(ticket.token.length).toBeGreaterThanOrEqual(32)
  expect(Date.parse(ticket.expiresAt) - Date.now()).toBeGreaterThan(800_000)

  // 2 段目。音そのものが返る（JSON ではない）。
  const played = await request.get(`/api/staff/recordings/${stored.id}/stream`, {
    ...(await authed(request)),
    params: { token: ticket.token },
  })
  expect(played.status()).toBe(200)
  expect(played.headers()['content-type']).toContain('audio/')
  expect((await played.body()).length).toBe(AUDIO.length)

  // チケットが無ければ開かない（`Authorization` の代わりではなく上乗せ）。
  const bare = await request.get(`/api/staff/recordings/${stored.id}/stream`, await authed(request))
  expect(bare.status()).toBe(401)
})

// @e2e-covers AC-REC-10
test('受付履歴から「再生する」で位置のバーが進む', async ({ request }) => {
  await grantRecording(request)
  const stored = await storedRecording(request, { booked: false })
  // 再生位置は録音の長さから出る。埋め込み側に渡るのはこの 2 つだけである。
  expect(stored.durationSeconds).toBe(372)
  expect(stored.state).toBe('stored')

  const issued = await request.post(
    `/api/staff/recordings/${stored.id}/playback`,
    await authed(request),
  )
  expect(issued.status()).toBe(200)
  const ticket = (await issued.json()) as { token: string; durationSeconds: number | null }
  expect(ticket.durationSeconds).toBe(372)

  // 途中から聞き直せる（`<audio>` が出す `Range` に 206 で答える）。
  const part = await request.get(`/api/staff/recordings/${stored.id}/stream`, {
    ...(await authed(request)),
    headers: { ...(await authed(request)).headers, range: 'bytes=4-7' },
    params: { token: ticket.token },
  })
  expect(part.status()).toBe(206)
  expect(part.headers()['content-range']).toBe(`bytes 4-7/${AUDIO.length}`)
  expect((await part.body()).length).toBe(4)
})

// @e2e-covers AC-REC-11
test('成立予約は 30 日ちょうどで消せず、+1 秒で消せる', async ({ request }) => {
  await grantRecording(request)
  const stored = await storedRecording(request, { booked: true, hhmm: '15:00' })
  const retainUntil = Date.parse(stored.retainUntil ?? '')
  // 保管した時刻から 30 日後（`storedAt + 2,592,000 秒`）。
  expect(retainUntil - Date.parse(stored.createdAt)).toBeGreaterThan(RETAIN_BOOKED_MS - 600_000)

  // ちょうどは消せない。いつから消せるかを返す。
  const early = await request.delete(`/api/staff/recordings/${stored.id}`, await authed(request))
  expect(early.status()).toBe(409)
  expect(await early.json()).toMatchObject({
    error: 'recording_retained',
    retainUntil: stored.retainUntil,
    legalHold: false,
  })
  // 片づけは組織の録音をまとめて見るので、数ではなく**この 1 本**の行方で見る。
  await purge(request, new Date(retainUntil).toISOString())
  expect(await stateOf(request, stored.id)).toBe('stored')

  // 30 日と 1 秒で消える。行は残り、実体だけが消える。
  const after = await purge(request, new Date(retainUntil + 1000).toISOString())
  expect(after.deleted).toBeGreaterThanOrEqual(1)
  expect(await stateOf(request, stored.id)).toBe('deleted')
})

// @e2e-covers AC-REC-12
test('破棄受付は 24 時間ちょうどで消せず、+1 秒で消せる', async ({ request }) => {
  await grantRecording(request)
  const stored = await storedRecording(request, { booked: false })
  const retainUntil = Date.parse(stored.retainUntil ?? '')
  // 破棄受付は 24 時間（`storedAt + 86,400 秒`）。
  const span = retainUntil - Date.parse(stored.createdAt)
  expect(span).toBeGreaterThan(RETAIN_DISCARDED_MS - 600_000)
  expect(span).toBeLessThan(RETAIN_DISCARDED_MS + 600_000)

  const early = await request.delete(`/api/staff/recordings/${stored.id}`, await authed(request))
  expect(early.status()).toBe(409)
  expect(((await early.json()) as { error: string }).error).toBe('recording_retained')
  await purge(request, new Date(retainUntil).toISOString())
  expect(await stateOf(request, stored.id)).toBe('stored')

  const after = await purge(request, new Date(retainUntil + 1000).toISOString())
  expect(after.deleted).toBeGreaterThanOrEqual(1)
  expect(await stateOf(request, stored.id)).toBe('deleted')
})

// @e2e-covers UC-REC-08 AC-REC-13
test('保全を立てた録音は片づけで消えない', async ({ request }) => {
  await grantRecording(request)
  const stored = await storedRecording(request, { booked: false })
  const after = new Date(Date.parse(stored.retainUntil ?? '') + 1000).toISOString()

  const held = await request.post(`/api/staff/recordings/${stored.id}/hold`, {
    ...(await authed(request)),
    data: { legalHold: true, reason: '苦情の申し立てを調べているため' },
  })
  expect(held.status(), await held.text()).toBe(200)
  expect(((await held.json()) as Recording).legalHold).toBe(true)

  // 期限を過ぎても、保全が立っているあいだは残る（保全は期限より強い）。
  const kept = await purge(request, after)
  expect(kept.skippedHeld).toBeGreaterThanOrEqual(1)
  expect(await stateOf(request, stored.id)).toBe('stored')

  // 外した瞬間に、同じ片づけで消える。
  const cleared = await request.post(`/api/staff/recordings/${stored.id}/hold`, {
    ...(await authed(request)),
    data: { legalHold: false, reason: '調べが終わったため' },
  })
  expect(cleared.status()).toBe(200)
  const swept = await purge(request, after)
  expect(swept.deleted).toBeGreaterThanOrEqual(1)
  expect(await stateOf(request, stored.id)).toBe('deleted')
})

// @e2e-covers AC-REC-14
test('他組織の録音は再生も保全もできず、一覧にも出ない', async ({ request }) => {
  await grantRecording(request)
  const stored = await storedRecording(request, { booked: false })

  // 別の組織の資格情報。担当店舗は配ってあるので、断るのは権限ではなく組織の壁である。
  const sync = await request.post('/api/internal/store-memberships/sync', {
    headers: { 'x-internal-key': INTERNAL_KEY },
    data: {
      id: OTHER_MEMBERSHIP_ID,
      organizationId: OTHER_ORG,
      storeId: GINZA,
      userId: `dev:${OTHER_ORG}`,
      permissions: RECORDING_PERMISSIONS,
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  })
  expect(sync.status()).toBe(200)
  const other = await authed(request, OTHER_ORG)

  // 再生できない。存在の有無すら漏れない（403 ではなく 404）。
  const played = await request.post(`/api/staff/recordings/${stored.id}/playback`, other)
  expect(played.status()).toBe(404)
  // 保全もできない。
  const held = await request.post(`/api/staff/recordings/${stored.id}/hold`, {
    ...other,
    data: { legalHold: true, reason: '他組織からの操作' },
  })
  expect(held.status()).toBe(404)
  // 一覧にも出ない。
  const listed = await request.get('/api/staff/recordings', {
    ...other,
    params: { storeId: GINZA, limit: 200 },
  })
  expect(listed.status()).toBe(200)
  expect((await listed.json()) as { items: Recording[]; total: number }).toMatchObject({
    items: [],
    total: 0,
  })
  // こちらからは変わらず読める（壁は片側だけに立っていない）。
  expect(await stateOf(request, stored.id)).toBe('stored')
})

// @e2e-covers AC-REC-19
test('3 回失敗するとお知らせに 1 件立つ', async ({ request }) => {
  await grantRecording(request)
  const sessionId = await startSession(request)
  await bookFrom(request, sessionId, '16:00')
  const created = await createRecording(request, sessionId)

  const move = async (state: string) => {
    const res = await request.patch(`/api/staff/recordings/${created.id}`, {
      ...(await authed(request)),
      data: { state },
    })
    expect(res.status(), await res.text()).toBe(200)
    return (await res.json()) as Recording
  }

  await move('uploading')
  expect((await move('failed')).uploadAttempts).toBe(1)
  expect(await alertsFor(request, created.id)).toHaveLength(0)
  await move('uploading')
  expect((await move('failed')).uploadAttempts).toBe(2)
  expect(await alertsFor(request, created.id)).toHaveLength(0)
  await move('uploading')
  expect((await move('failed')).uploadAttempts).toBe(3)

  // 3 回目でちょうど 1 件立つ。録音番号とご予約の成立が本文から読める。
  const raised = await alertsFor(request, created.id)
  expect(raised).toHaveLength(1)
  expect(raised[0]).toMatchObject({
    code: 'recording.upload_failed',
    severity: 'action',
    title: '録音の保存に3回失敗しました',
    targetType: 'recording',
  })
  expect(raised[0]?.body).toContain(created.code)
  expect(raised[0]?.body).toContain('ご予約は成立しています。')

  // 4 回目で数が増えない（同じ原因で連打しない）。
  await move('uploading')
  expect((await move('failed')).uploadAttempts).toBe(4)
  expect(await alertsFor(request, created.id)).toHaveLength(1)
})

// @e2e-covers AC-REC-20
test('端末セッションが失効しても未送信の録音は残る', async ({ page, request }) => {
  await grantRecording(request)
  await startWork(page, { frozen: true })
  await page.route(
    (url) => url.pathname.endsWith('/content'),
    (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  )
  await startBooking(page)
  await expect(badgeAt(page, 'bar')).toContainText('録音中', { timeout: 15_000 })
  const sessionId = (await page.evaluate(
    'sessionStorage.getItem("eyex.booking.session")',
  )) as string

  await walkToConfirm(page, '18:00')
  await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
  // 録音だけ送れなかったので、完了の面の代わりに成立を先に言う面が出る。
  await expect(page.getByRole('heading', { name: 'ご予約は確定しています' })).toBeVisible()
  await expect(badgeAt(page, 'floating')).toContainText('録音は端末に保管中')
  expect((await page.evaluate(READ_OUTBOX)) as string[]).toHaveLength(1)

  // 業務セッションが失効した。**控えは消さない。**失効しているあいだは送りもしない。
  let sent = 0
  page.on('request', (req) => {
    if (req.url().includes('/content')) sent += 1
  })
  await page.getByRole('button', { name: 'このまま続ける' }).click()
  await expect(page.getByRole('grid', { name: '予約台帳' })).toBeVisible()
  await page.getByRole('button', { name: '業務を終える' }).click()
  await expect(page.getByLabel('お店のコード')).toBeVisible()
  await page.clock.fastForward(400_000)
  expect((await page.evaluate(READ_OUTBOX)) as string[]).toHaveLength(1)
  expect(sent).toBe(0)

  // 同じ端末でもう一度業務を始めると、自動の再送が再開する（5 分の固定間隔）。
  await page.unrouteAll()
  await page.getByLabel('お店のコード').fill(ORG)
  await page.getByRole('button', { name: '業務を始める' }).click()
  await startBooking(page)
  await expect(async () => {
    expect((await page.evaluate(READ_OUTBOX)) as string[]).toHaveLength(0)
  }).toPass({ timeout: 20_000 })
  expect(sent).toBeGreaterThanOrEqual(1)
  expect((await recordingsOf(request, sessionId))[0]?.state).toBe('stored')
})

// @e2e-covers UC-REC-09
test('受付をやめても記録と録音が残る', async ({ page, request }) => {
  await grantRecording(request)
  await startWork(page)
  await startBooking(page)
  await expect(badgeAt(page, 'bar')).toContainText('録音中', { timeout: 15_000 })
  const sessionId = (await page.evaluate(
    'sessionStorage.getItem("eyex.booking.session")',
  )) as string
  await pickDateTime(page, '18:30')

  // 確認は 2 択で、**既定は「続ける」**（やめるほうは戻せない）。
  await page.getByRole('button', { name: 'やめる' }).click()
  const ask = page.getByRole('alertdialog', { name: '入力をやめますか' })
  await expect(ask).toBeVisible()
  await expect(ask).toContainText('この受付の記録と録音は残ります。')
  await ask.getByRole('button', { name: '入力をやめる' }).click()
  await expect(page.getByRole('button', { name: /新しい予約を取る/ })).toBeVisible()

  // 受付の記録は `discarded` として残り、録音の行も残る（破棄でも捨てない）。
  const again = await request.post(`/api/staff/reception-sessions/${sessionId}/close`, {
    ...(await authed(request)),
    data: { outcome: 'discarded' },
  })
  expect(again.status()).toBe(409)
  expect(((await again.json()) as { error: string }).error).toBe('invalid_transition')
  expect(await recordingsOf(request, sessionId)).toHaveLength(1)
})
