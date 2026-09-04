import type {
  AvailabilityLane,
  AvailabilityResponse,
  AvailabilitySlot,
  BusinessHoursView,
  LocalDate,
  ReceptionSession,
  VisitPurpose,
} from '@app/contracts'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BookingScreen } from './BookingScreen'

/*
 * 受付の器（承認済みモック docs/frontend/mockups/eye/images/BOOK-01-DATETIME.png ほか 12 面）。
 *
 * 5 工程が同じ器の上で動き、いまどの工程にいるか・録音がどこにあるかが工程を移っても
 * 変わらないことを固定する。上のバー 64px は P0 と同じ形で、**予約フローはサイドバーを出さない**。
 *
 * 下書きは端末のメモリに持たず、サーバの `reception_sessions` に置く。端末に残すのは
 * 受付セッション id だけで、お名前・お電話番号は置かない（`design/07-nfr.md` §5.3 / §6.6）。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
const SESSION_ID = 'd0000000-0000-4000-8000-000000000001'
const PURPOSE_ID = 'e0000000-0000-4000-8000-000000000001'
const NOW = '2026-08-27T02:08:00.000Z'
const DATE: LocalDate = '2026-08-27'
const SESSION_KEY = 'eye.booking.session'
const RESERVATION_ID = 'b0000000-0000-4000-8000-000000000001'
const RECORDING_ID = 'a0000000-0000-4000-8000-000000000009'

/** 承ったご予約 1 件。完了の面と、録音だけ失敗した面の右の 4 項目が読む。 */
function booked() {
  return {
    id: RESERVATION_ID,
    code: 'EY-2608-0142',
    storeId: STORE_ID,
    source: 'phone',
    status: 'booked',
    startsAt: at('11:00'),
    endsAt: at('12:00'),
    durationMinutes: 60,
    customerId: null,
    customerName: null,
    visitCount: null,
    purposes: [{ purposeId: PURPOSE_ID, nameInternal: 'メガネを新しく作る', sortOrder: 1 }],
    assignments: [{ kind: 'staff', resourceId: null }],
    webBookingCode: null,
    purposeLabel: '新調',
    purposeLabelInternal: 'メガネを新しく作る',
    noteCustomer: '',
    noteInternal: '',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: null,
    cancelledAt: null,
    cancelReason: null,
  }
}

function at(clock: string): string {
  return new Date(Date.parse(`${DATE}T${clock}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()
}

function session(draft: ReceptionSession['draft'] = null): ReceptionSession {
  return {
    id: SESSION_ID,
    storeId: STORE_ID,
    reservationId: null,
    terminalId: null,
    actorId: null,
    startedAt: NOW,
    endedAt: null,
    outcome: null,
    draft,
    createdAt: NOW,
  }
}

const HOURS: BusinessHoursView = {
  rows: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    weekday,
    isClosed: weekday === 2,
    opensAt: weekday === 2 ? null : '10:00',
    closesAt: weekday === 2 ? null : '19:00',
    breakStart: null,
    breakEnd: null,
  })),
  blackouts: [],
  version: 1,
  warnings: [],
}

function slot(clock: string, endClock: string, remaining: number): AvailabilitySlot {
  return {
    startsAt: at(clock),
    endsAt: at(endClock),
    remaining,
    isAvailable: remaining > 0,
    staffIds: [],
    equipmentIds: [],
    reason: remaining > 0 ? null : 'staff_busy',
  }
}

const AVAILABILITY: AvailabilityResponse = {
  date: DATE,
  opensAt: '10:00',
  closesAt: '19:00',
  isClosed: false,
  slotMinutes: 30,
  cleanupMinutes: 10,
  durationMinutes: 30,
  slots: [slot('10:00', '10:30', 2), slot('11:00', '11:30', 2), slot('11:30', '12:00', 0)],
  lanes: [],
  alternatives: [],
  reason: null,
  serverNow: NOW,
}

/** 担当の行 1 本。11:00 が塞がっているかどうかだけを変えて使う。 */
function lane(id: string, name: string, subtitle: string, busyAt11: boolean): AvailabilityLane {
  return {
    kind: 'staff',
    id,
    name,
    subtitle,
    slots: [
      slot('10:00', '10:30', 2),
      slot('10:30', '11:00', 2),
      busyAt11 ? slot('11:00', '11:30', 0) : slot('11:00', '11:30', 2),
      slot('11:30', '12:00', 2),
      slot('12:00', '12:30', 2),
      slot('12:30', '13:00', 2),
    ],
  }
}

const SATO = 'c0000000-0000-4000-8000-000000000001'
const KOBAYASHI = 'c0000000-0000-4000-8000-000000000002'
const TAKAHASHI = 'c0000000-0000-4000-8000-000000000003'

/** 工程 3 の盤。1 行目（佐藤 美咲）の 11:00 だけが先約で埋まっている。 */
const BOARD: AvailabilityResponse = {
  ...AVAILABILITY,
  durationMinutes: 60,
  lanes: [
    lane(SATO, '佐藤 美咲', '視力測定', true),
    lane(KOBAYASHI, '小林 学', '視力測定', false),
    lane(TAKAHASHI, '高橋 悠', '加工', false),
  ],
}

const PURPOSES: VisitPurpose[] = [
  {
    id: PURPOSE_ID,
    storeId: null,
    nameInternal: 'メガネを新しく作る',
    namePublic: 'メガネの新調',
    nameShort: '新調',
    durationMinutes: 60,
    isWebPublished: true,
    isActive: true,
    sortOrder: 1,
    requirements: [],
    version: 1,
  },
]

/** 伺い終えた下書き（工程 3 から始められる分だけ）。 */
function walkedDraft(): NonNullable<ReceptionSession['draft']> {
  return {
    purposeIds: [PURPOSE_ID],
    staffId: null,
    equipmentIds: [],
    startsAt: at('11:00'),
    durationMinutes: 60,
    customerId: null,
    phoneTyped: '',
    nameTyped: '',
    kanaTyped: '',
    noteTyped: '',
    handwritingKeys: [],
    holdRenewals: 0,
  }
}

type Call = { method: string; url: URL; body: unknown }

let calls: Call[] = []
let resume: ReceptionSession | null = null
let board: AvailabilityResponse = AVAILABILITY
let purposes: VisitPurpose[] = []
/** 確定の応答。既定は「取れた」。枠を取られた面はここを 409 に替える。 */
let confirmReply: () => Response = () => json({ error: 'not_found' }, 404)
/** 録音の本体を送る先。既定は「店内の通信が弱い」（503）。 */
let contentReply: () => Response = () => json({ error: 'upload_failed' }, 503)

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  calls = []
  resume = null
  board = AVAILABILITY
  purposes = []
  confirmReply = () => json({ error: 'not_found' }, 404)
  contentReply = () => json({ error: 'upload_failed' }, 503)
  sessionStorage.setItem('app.auth.token', 'header.payload.signature')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://example.test')
      const method = (init?.method ?? 'GET').toUpperCase()
      // 録音の本体だけは JSON ではない（生の Blob を PUT する唯一のルート）。
      const body =
        init?.body === undefined || init.body instanceof Blob
          ? undefined
          : JSON.parse(String(init.body))
      calls.push({ method, url, body })
      if (url.pathname.endsWith('/business-hours')) return json(HOURS)
      if (url.pathname === '/api/staff/availability') return json(board)
      if (url.pathname === '/api/staff/purposes') return json(purposes)
      if (url.pathname === '/api/staff/reservations' && method === 'POST') return confirmReply()
      if (url.pathname === '/api/staff/recordings' && method === 'POST') {
        return json({ id: RECORDING_ID, code: 'EY-R-0001', state: 'recording' })
      }
      if (url.pathname.endsWith('/content') && method === 'PUT') return contentReply()
      if (url.pathname === '/api/staff/holds' && method === 'POST') {
        return json({
          id: 'h0000000-0000-4000-8000-000000000001',
          startsAt: at('11:00'),
          endsAt: at('12:00'),
          expiresAt: new Date(Date.parse(NOW) + 420_000).toISOString(),
          staffId: null,
          equipmentIds: [],
          receptionSessionId: SESSION_ID,
        })
      }
      // 実サーバと同じ口を叩く。`/draft` を落とすと受付履歴の詳細が返ってきて下書きが読めない。
      if (url.pathname === `/api/staff/reception-sessions/${SESSION_ID}/draft`) {
        return resume === null ? json({ error: 'not_found' }, 404) : json(resume)
      }
      if (url.pathname === '/api/staff/reception-sessions') return json(session())
      if (url.pathname.endsWith('/close')) return json({ ...session(), outcome: 'discarded' })
      if (url.pathname.startsWith('/api/staff/holds/')) return json({ id: 'x', deleted: true })
      return json({ error: 'not_found' }, 404)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

const exit = vi.fn()

function open(initialStep?: 'datetime' | 'purpose' | 'slot' | 'customer' | 'confirm') {
  return render(
    <BookingScreen
      storeId={STORE_ID}
      storeName="EYE 銀座店"
      now={NOW}
      initialStep={initialStep}
      onExit={exit}
    />,
  )
}

/** 器が受付を始め終える（下端の帯が出る）まで待つ。 */
async function started() {
  await screen.findByRole('list', { name: '予約の工程　全5工程' })
}

const patches = () =>
  calls.filter(
    (call) => call.method === 'PATCH' && call.url.pathname.includes('reception-sessions'),
  )

describe('録音の置き場所', () => {
  it('工程 1 から工程 4 まで、録音の表示が帯の中の同じ位置にある', async () => {
    for (const step of ['datetime', 'purpose', 'slot', 'customer'] as const) {
      const view = open(step)
      await started()
      const bar = screen.getByRole('contentinfo')
      const place = bar.querySelector('[data-booking-recording-slot]')
      expect(place).not.toBeNull()
      // 帯の中の並びは「‹ ／ 工程 ／ 録音 ／ 次へ」で固定。工程を移っても動かない。
      expect(Array.from(bar.children).indexOf(place as Element)).toBe(2)
      expect(within(place as HTMLElement).getByRole('status')).toHaveTextContent('録音していません')
      view.unmount()
    }
  })

  it('工程 5 では右下 20/20 の常駐表示に移る', async () => {
    const { container } = open('confirm')
    await started()
    const bar = screen.getByRole('contentinfo')
    expect(bar.querySelector('[data-booking-recording-slot]')).toBeNull()
    const floating = container.querySelector('[data-booking-recording="floating"]')
    expect(floating).not.toBeNull()
    expect(floating?.className).toContain('right-5')
    expect(floating?.className).toContain('bottom-5')
  })
})

/*
 * 例外の 2 面（承認済みモック EX-MIC-DENIED / EX-UPLOAD-FAILED）。**器が工程の面ごと
 * 差し替えているか**を見る。面そのものの文言と並びは `recording/*.test.tsx` が持っている。
 *
 * jsdom には `navigator.mediaDevices` も `MediaRecorder` も無いので、この describe の
 * 中だけ端末の口を据える（`useRecorder` 自身のテストは依存を引数で受け取る形で書いてある）。
 */
describe('録音の例外の面', () => {
  /** 断られる端末。`NotAllowedError` は「設定でマイクをオンに」で直る側の断りである。 */
  function denyMicrophone() {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() => {
          const denied = new Error('Permission denied')
          denied.name = 'NotAllowedError'
          return Promise.reject(denied)
        }),
      },
    })
  }

  /** 録れる端末。`stop()` を呼ばれたら音声を 1 つ返すだけの録音機を据える。 */
  function allowMicrophone() {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: vi.fn() }] })),
      },
    })
    class FakeRecorder {
      static isTypeSupported = () => true
      ondataavailable: ((event: { data: Blob }) => void) | null = null
      onstop: (() => void) | null = null
      onerror: (() => void) | null = null
      start() {}
      stop() {
        this.ondataavailable?.({ data: new Blob(['..']) })
        this.onstop?.()
      }
    }
    vi.stubGlobal('MediaRecorder', FakeRecorder)
  }

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'mediaDevices')
  })

  it('マイクを断られたら、工程の面ごと「マイクが使えないため、録音できません」に差し替わる', async () => {
    denyMicrophone()
    open()

    expect(
      await screen.findByRole('heading', { name: 'マイクが使えないため、録音できません' }),
    ).toBeInTheDocument()
    // 直し方は 3 手順。**受付をやめる導線も同じ面から出る。**
    const how = screen.getByRole('list', { name: '直し方　この iPad の「設定」で' })
    expect(within(how).getAllByRole('listitem')).toHaveLength(3)
    // 工程の帯は出さない（承認済みモックのとおり全面差し替え）。
    expect(screen.queryByRole('list', { name: '予約の工程　全5工程' })).toBeNull()
    // 録音の印は 1 か所きり。灰色の「録音していません」が右下に残る（時計は出さない）。
    const printed = screen.getAllByRole('status').filter((node) => node.dataset.bookingRecording)
    expect(printed).toHaveLength(1)
    expect(printed[0]).toHaveTextContent('録音していません')
    expect(printed[0]).not.toHaveTextContent('--:--')
  })

  it('「録音せずに続ける」で、同じ受付の工程へそのまま戻る', async () => {
    denyMicrophone()
    open()
    await screen.findByRole('heading', { name: 'マイクが使えないため、録音できません' })

    await userEvent.click(screen.getByRole('button', { name: '録音せずに続ける' }))

    // 許可を説明するだけの別画面を挟まず、工程 1 の帯が戻る。
    await started()
    expect(
      screen.queryByRole('heading', { name: 'マイクが使えないため、録音できません' }),
    ).toBeNull()
    expect(exit).not.toHaveBeenCalled()
  })

  it('承ったのに録音だけ送れなかったら、完了の面の代わりに成立を先に言う面が出る', async () => {
    allowMicrophone()
    resume = session(walkedDraft())
    sessionStorage.setItem(SESSION_KEY, SESSION_ID)
    confirmReply = () => json(booked(), 200)
    open('confirm')
    await started()

    await userEvent.click(screen.getByRole('button', { name: '復唱を終えて予約を確定する' }))

    // 成立が先。予約番号も読める（AC-REC-06）。
    expect(
      await screen.findByRole('heading', { name: 'ご予約は確定しています' }),
    ).toBeInTheDocument()
    expect(screen.getByText('EY-2608-0142')).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: '保存できなかったのは、この受付の録音だけです' }),
    ).toBeInTheDocument()
    // 完了の面は出さない（同じ面に 2 つの結末を並べない）。
    expect(screen.queryByRole('heading', { name: 'ご予約を承りました' })).toBeNull()
    // 右下は「録音は端末に保管中」1 か所きり。
    const printed = screen.getAllByRole('status').filter((node) => node.dataset.bookingRecording)
    expect(printed).toHaveLength(1)
    expect(printed[0]).toHaveTextContent('録音は端末に保管中')
  })

  it('録音も送れていれば、完了の面のままで例外の面を出さない', async () => {
    allowMicrophone()
    resume = session(walkedDraft())
    sessionStorage.setItem(SESSION_KEY, SESSION_ID)
    confirmReply = () => json(booked(), 200)
    contentReply = () => json({ id: RECORDING_ID, state: 'stored' })
    open('confirm')
    await started()

    await userEvent.click(screen.getByRole('button', { name: '復唱を終えて予約を確定する' }))

    expect(await screen.findByRole('heading', { name: 'ご予約を承りました' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'ご予約は確定しています' })).toBeNull()
  })
})

describe('出口', () => {
  it('「やめる」を押すと 2 択（入力をやめる／続ける）の確認が出る', async () => {
    open()
    await started()
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(await screen.findByText('入力をやめますか')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '入力をやめる' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '続ける' })).toBeInTheDocument()
  })

  it('「続ける」を選ぶとその工程に留まり、入力が残っている', async () => {
    open()
    await started()
    await userEvent.click(await screen.findByRole('button', { name: '8月27日（木）　本日' }))
    await userEvent.click(await screen.findByRole('button', { name: '11:00　あと2枠' }))
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))
    await userEvent.click(await screen.findByRole('button', { name: '続ける' }))
    expect(screen.queryByText('入力をやめますか')).toBeNull()
    expect(screen.getByRole('button', { name: '11:00　あと2枠' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(exit).not.toHaveBeenCalled()
    expect(calls.some((call) => call.url.pathname.endsWith('/close'))).toBe(false)
  })

  it('「入力をやめる」を選ぶとトップへ戻り、受付は discarded として閉じる', async () => {
    open()
    await started()
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))
    await userEvent.click(await screen.findByRole('button', { name: '入力をやめる' }))
    await waitFor(() => expect(exit).toHaveBeenCalled())
    const close = calls.find((call) => call.url.pathname.endsWith('/close'))
    expect(close?.method).toBe('POST')
    expect(close?.body).toEqual({ outcome: 'discarded' })
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('「あとで続ける」は受付を進行中のまま残し、押さえを解放してトップへ戻る', async () => {
    open()
    await started()
    await userEvent.click(screen.getByRole('button', { name: 'あとで続ける' }))
    await waitFor(() => expect(exit).toHaveBeenCalled())
    // 進行中のまま残すので閉じない。受付セッション id は端末に残し、続きから戻れる。
    expect(calls.some((call) => call.url.pathname.endsWith('/close'))).toBe(false)
    expect(sessionStorage.getItem(SESSION_KEY)).toBe(SESSION_ID)
    // 押さえは器が覚えているぶんだけ返す（工程 3 が打つまでは 0 本）。
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(0)
  })
})

describe('下書き', () => {
  it('受付セッション id だけを sessionStorage に置き、氏名・電話番号は置かない', async () => {
    open()
    await started()
    await waitFor(() => expect(sessionStorage.getItem(SESSION_KEY)).toBe(SESSION_ID))
    expect(Object.keys(sessionStorage).sort()).toEqual(['app.auth.token', SESSION_KEY].sort())
  })

  it('読み込み直しても、受付セッション id からサーバの下書きで工程が復る', async () => {
    sessionStorage.setItem(SESSION_KEY, SESSION_ID)
    resume = session({
      purposeIds: [PURPOSE_ID],
      staffId: null,
      equipmentIds: [],
      startsAt: at('11:00'),
      durationMinutes: 60,
      customerId: null,
      phoneTyped: '',
      nameTyped: '',
      kanaTyped: '',
      noteTyped: '',
      handwritingKeys: [],
      holdRenewals: 0,
    })
    open()
    await started()
    const items = within(screen.getByRole('list')).getAllByRole('listitem')
    await waitFor(() => expect(items[2]).toHaveAttribute('aria-current', 'step'))
    // 受付を作り直さない（同じ受付の続きである）。
    expect(
      calls.filter(
        (call) => call.method === 'POST' && call.url.pathname === '/api/staff/reception-sessions',
      ),
    ).toHaveLength(0)
  })

  it('工程を移るたびに下書きを丸ごと 1 つ送る', async () => {
    open()
    await started()
    await userEvent.click(await screen.findByRole('button', { name: '8月27日（木）　本日' }))
    await userEvent.click(await screen.findByRole('button', { name: '11:00　あと2枠' }))
    expect(patches()).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: '次へ進む' }))
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0]?.body).toMatchObject({ draft: { startsAt: at('11:00') } })
  })

  it('受付を始められなかったら、その事実ともう一度始める道を出す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: 'not_found' }, 404)),
    )
    open()
    expect(await screen.findByText('受付を始められませんでした。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'もう一度始める' })).toBeInTheDocument()
  })
})

describe('ソフトキーボード', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'visualViewport')
  })

  /** iPadOS の Safari の `visualViewport` を模す（jsdom は持たない）。 */
  function fakeViewport(height: number) {
    const listeners = new Set<() => void>()
    const viewport = {
      height,
      addEventListener: (_type: string, handler: () => void) => listeners.add(handler),
      removeEventListener: (_type: string, handler: () => void) => listeners.delete(handler),
    }
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
    return {
      shrinkTo(next: number) {
        viewport.height = next
        for (const handler of listeners) handler()
      },
    }
  }

  it('お名前の欄でキーボードが出ても、帯と録音は見えている高さの底に貼り直る', async () => {
    const viewport = fakeViewport(834)
    sessionStorage.setItem(SESSION_KEY, SESSION_ID)
    resume = session(walkedDraft())
    board = BOARD
    purposes = PURPOSES
    open('customer')
    await started()
    const frame = document.querySelector('[data-booking-frame]') as HTMLElement
    expect(frame.style.height).toBe('834px')

    // キーボードが 320px ぶん被さる。layout viewport は縮まないので、器が自分で畳む。
    await userEvent.click(screen.getByLabelText('お名前'))
    await waitFor(() => {
      viewport.shrinkTo(514)
      expect(frame.style.height).toBe('514px')
    })
    // 帯（工程・録音・「次へ」）はその高さの中に残る。
    const bar = screen.getByRole('contentinfo')
    expect(frame.contains(bar)).toBe(true)
    expect(bar.querySelector('[data-booking-recording-slot]')).not.toBeNull()
  })
})

describe('上のバー', () => {
  it('店名と「新しい予約を取る」を出し、サイドバーは出さない', async () => {
    open()
    await started()
    expect(screen.getByText('EYE 銀座店')).toBeInTheDocument()
    expect(screen.getByText('新しい予約を取る')).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).toBeNull()
  })
})

/*
 * 工程 3 から工程 5 までを歩いて、器が持ち回るものだけを見る。盤の中の見え方は
 * `SlotStep.test.tsx`、枠が埋まっていた面の見え方は `ConflictNotice.test.tsx` が持つ。
 */
describe('工程をまたいで持ち回るもの', () => {
  /** 伺い終えた下書きから工程 3 で開く（盤には 3 名が並び、佐藤 美咲 の 11:00 は先約）。 */
  async function openBoard() {
    sessionStorage.setItem(SESSION_KEY, SESSION_ID)
    resume = session(walkedDraft())
    board = BOARD
    purposes = PURPOSES
    open()
    await started()
    await screen.findByRole('table', { name: 'ご予約を置く盤' })
  }

  /** 重なりを解いて 小林 学 に置く（候補の札を押す。指で運ぶ道は SlotStep が持つ）。 */
  async function placeOnKobayashi() {
    await userEvent.click(await screen.findByRole('button', { name: /^小林 学/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: '次へ進む' })).toBeEnabled())
  }

  async function proceed() {
    await userEvent.click(await screen.findByRole('button', { name: '次へ進む' }))
  }

  it('工程 4 から「前へ戻る」と、工程 3 で選んでいた担当が選ばれたまま残る', async () => {
    await openBoard()
    await placeOnKobayashi()
    expect(
      screen.getByRole('cell', { name: /^いま置いているご予約/ }).getAttribute('aria-label'),
    ).toContain('小林 学')

    await proceed()
    await screen.findByRole('heading', { name: 'お電話番号を伺えますか？' })
    await userEvent.type(screen.getByLabelText('お名前'), '田中 花子')

    await userEvent.click(screen.getByRole('button', { name: '前へ戻る' }))
    await screen.findByRole('table', { name: 'ご予約を置く盤' })
    expect(
      screen.getByRole('cell', { name: /^いま置いているご予約/ }).getAttribute('aria-label'),
    ).toContain('小林 学')
    // 右の「確保するもの」も同じ担当を言う（「あとで決める」へ落ちない）。
    expect(screen.getByText('小林 学', { selector: 'dd' })).toBeInTheDocument()

    // もう一度進むと、打ち込んだお名前が残っている。
    await proceed()
    expect(await screen.findByLabelText('お名前')).toHaveValue('田中 花子')
  })

  it('確定で枠を取られたら、時刻を変えずに担当を入れ替える案が 1 つ並ぶ', async () => {
    await openBoard()
    await placeOnKobayashi()
    await proceed()
    await screen.findByRole('heading', { name: 'お電話番号を伺えますか？' })
    await userEvent.type(screen.getByLabelText('お名前'), '田中 花子')
    await proceed()
    await screen.findByRole('heading', { name: 'この文をそのまま読み上げます' })

    // ほかの端末が同じ枠を先に取った。代わりの時刻はサーバが返した 1 件だけ。
    confirmReply = () =>
      json(
        {
          error: 'slot_taken',
          alternatives: [{ ...slot('11:30', '12:30', 1), endsAt: at('12:30') }],
        },
        409,
      )
    await userEvent.click(screen.getByRole('button', { name: '復唱を終えて予約を確定する' }))
    await screen.findByRole('heading', { name: 'この枠は、ほかの端末で先に確定されました' })

    /*
     * 案を組み立てるのは器である（サーバの 409 は時刻しか返さない）。
     * 同じ 11:00 が空いている担当だけが出る —— 佐藤 美咲 はその時刻が先約なので出ない。
     */
    expect(
      screen.getByRole('button', { name: /^11:00\s*担当を 高橋 悠（加工）に変える/ }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /担当を 佐藤 美咲/ })).toBeNull()
    // 帯の工程 4 は ✓ のまま（お名前をもう一度伺うのではない）。
    const steps = within(screen.getByRole('list', { name: '予約の工程　全5工程' })).getAllByRole(
      'listitem',
    )
    expect(steps[2]).toHaveAttribute('aria-current', 'step')
    expect(steps[3]?.textContent).toContain('✓')
    expect(steps[4]?.textContent).not.toContain('✓')
  })
})
