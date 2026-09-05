import type {
  CustomerDetail,
  ReservationDetail,
  StaffMember,
  VisitBoard as VisitBoardShape,
} from '@app/contracts'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceptionScreen } from './ReceptionScreen'

/*
 * 来店受付の器。**URL による画面の切り替えを持ち込まない**（この製品に router は無い）ので、
 * 盤面と来店受付の画面の行き来はこの器の `pane` だけで起きる（`customers/CustomerScreen.tsx`
 * と同じ決め）。ここでは繋ぎ（何を取りに行き、押すとどこへ移り、応答をどの部品へ渡すか）
 * だけを見る。盤面の中身は `VisitBoard.test.tsx`、受け付ける面は `CheckinPanel.test.tsx` が見る。
 */

/** 既定の normalizer は全角の空白（U+3000）を半角へ畳むので、文字どおり探すときに使う。 */
const asWritten = { normalizer: (text: string) => text.trim() }

const GINZA = 'd0000000-0000-4000-8000-000000000001'
const HANAKO_RESERVATION = 'b0000000-0000-4000-8000-000000000001'
const WALKIN_SUBJECT = 'b0000000-0000-4000-8000-000000000002'
const HANAKO_CUSTOMER = 'c0000000-0000-4000-8000-000000000008'
const MISAKI = 'a0000000-0000-4000-8000-000000000001'
const DATE = '2026-08-27'

function at(clock: string): string {
  const [hours = '0', minutes = '0'] = clock.split(':')
  const utc = Number(hours) * 60 + Number(minutes) - 9 * 60
  return new Date(Date.parse(`${DATE}T00:00:00.000Z`) + utc * 60_000).toISOString()
}

const FULL_BOARD: VisitBoardShape = {
  date: DATE,
  activeCount: 2,
  serverNow: at('10:55'),
  rows: [
    {
      subjectType: 'reservation',
      subjectId: HANAKO_RESERVATION,
      displayName: '田中 花子 様',
      visitCount: 4,
      purposeLabel: 'メガネを新しく作る',
      isWaitingTooLong: false,
      cells: [
        {
          stage: 'received',
          state: 'empty',
          at: null,
          label: '',
          note: null,
          needsAttention: false,
        },
        {
          stage: 'consulting',
          state: 'empty',
          at: null,
          label: '',
          note: null,
          needsAttention: false,
        },
        {
          stage: 'fitting',
          state: 'empty',
          at: null,
          label: '',
          note: null,
          needsAttention: false,
        },
        {
          stage: 'measuring',
          state: 'next',
          at: null,
          label: '視力測定機 A',
          note: null,
          needsAttention: false,
        },
        {
          stage: 'checkout',
          state: 'empty',
          at: null,
          label: '',
          note: null,
          needsAttention: false,
        },
        {
          stage: 'handover',
          state: 'empty',
          at: null,
          label: '',
          note: null,
          needsAttention: false,
        },
      ],
    },
    {
      subjectType: 'walkin',
      subjectId: WALKIN_SUBJECT,
      displayName: 'ウォークイン 003',
      visitCount: null,
      purposeLabel: 'フレームのご相談',
      isWaitingTooLong: false,
      cells: [
        {
          stage: 'received',
          state: 'done',
          at: at('10:50'),
          label: '',
          note: null,
          needsAttention: false,
        },
        {
          stage: 'consulting',
          state: 'empty',
          at: null,
          label: '',
          note: null,
          needsAttention: false,
        },
        {
          stage: 'fitting',
          state: 'empty',
          at: null,
          label: '',
          note: null,
          needsAttention: false,
        },
        {
          stage: 'measuring',
          state: 'empty',
          at: null,
          label: '',
          note: null,
          needsAttention: false,
        },
        {
          stage: 'checkout',
          state: 'empty',
          at: null,
          label: '',
          note: null,
          needsAttention: false,
        },
        {
          stage: 'handover',
          state: 'empty',
          at: null,
          label: '',
          note: null,
          needsAttention: false,
        },
      ],
    },
  ],
}

/** ウォークイン 003 が退店したあとの盤面。 */
const AFTER_LEFT: VisitBoardShape = {
  ...FULL_BOARD,
  activeCount: 1,
  rows: FULL_BOARD.rows.slice(0, 1),
}

/** 田中 花子 様の受付が済んだあとの盤面。 */
const AFTER_RECEIVED: VisitBoardShape = {
  ...FULL_BOARD,
  rows: [
    {
      ...(FULL_BOARD.rows[0] as VisitBoardShape['rows'][number]),
      cells: (FULL_BOARD.rows[0] as VisitBoardShape['rows'][number]).cells.map((cell) =>
        cell.stage === 'received' ? { ...cell, state: 'done' as const, at: at('10:55') } : cell,
      ),
    },
    FULL_BOARD.rows[1] as VisitBoardShape['rows'][number],
  ],
}

const RESERVATION: ReservationDetail = {
  id: HANAKO_RESERVATION,
  code: 'R-2608-0042',
  storeId: GINZA,
  source: 'phone',
  status: 'confirmed',
  startsAt: at('11:00'),
  endsAt: at('12:00'),
  durationMinutes: 60,
  customerId: HANAKO_CUSTOMER,
  customerName: '田中 花子',
  visitCount: 4,
  purposes: [],
  assignments: [{ kind: 'staff', targetId: MISAKI, startsAt: at('11:00'), endsAt: at('12:00') }],
  webBookingCode: null,
  purposeLabel: 'メガネを新しく作る',
  purposeLabelInternal: 'メガネを新しく作る',
  noteCustomer: '',
  noteInternal: '',
  version: 1,
  createdAt: at('09:00'),
  updatedAt: at('09:00'),
  createdBy: null,
  cancelledAt: null,
  cancelReason: null,
}

const CUSTOMER: CustomerDetail = {
  id: HANAKO_CUSTOMER,
  customerNumber: 'G-01842',
  name: '田中 花子',
  kana: 'たなか はなこ',
  phone: '09012345678',
  visitCount: 4,
  lastVisitAt: '2026-03-12',
  memoShort: 'PC作業用。鼻パッドは低め',
  email: null,
  birthDate: null,
  address: null,
  memo: 'PC作業用。鼻パッドは低め',
  firstVisitAt: '2024-03-15',
  frequentStaffName: '佐藤 美咲',
  prescriptions: [
    {
      id: 'c0000000-0000-4000-8000-000000000201',
      measuredAt: '2026-03-12',
      rSph: -2.25,
      lSph: -2,
      rCyl: null,
      lCyl: null,
      rAxis: null,
      lAxis: null,
      rAdd: null,
      lAdd: null,
      pd: 62,
      note: '',
      isCurrent: true,
    },
  ],
  glasses: [],
  notes: [
    {
      id: 'c0000000-0000-4000-8000-000000000401',
      kind: 'attention',
      body: '金属アレルギー',
      handwritingSvg: null,
      authorId: null,
      authorName: '中村 彩',
      revision: 1,
      status: 'published',
      storeId: GINZA,
      createdAt: at('09:00'),
    },
  ],
  nextReservation: null,
  mergedIntoId: null,
  version: 3,
}

const STAFF: StaffMember[] = [
  {
    id: MISAKI,
    displayName: '佐藤 美咲',
    kana: 'さとう みさき',
    jobLabel: null,
    role: 'staff',
    isActive: true,
    sortOrder: 0,
    skills: [],
    adminUserId: null,
    hasPin: false,
    maxParallelReservations: 1,
    pinUpdatedAt: null,
  },
]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Handler = (url: URL, init?: RequestInit) => Response | null

let boards: VisitBoardShape[] = []
let posted: Array<Record<string, unknown>> = []

function stub(extra: Handler = () => null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'https://example.test')
      const custom = extra(url, init)
      if (custom !== null) return custom
      const method = init?.method ?? 'GET'
      if (url.pathname === '/api/staff/visits/board') {
        return json(boards.length > 1 ? (boards.shift() as VisitBoardShape) : boards[0])
      }
      if (url.pathname === '/api/staff/visits' && method === 'POST') {
        posted.push(JSON.parse(String(init?.body ?? '{}')))
        return json({
          id: 'e0000000-0000-4000-8000-000000000001',
          subjectType: 'reservation',
          subjectId: HANAKO_RESERVATION,
          stage: 'received',
          occurredAt: at('10:55'),
          staffId: null,
          note: null,
        })
      }
      if (url.pathname === `/api/staff/reservations/${HANAKO_RESERVATION}`) return json(RESERVATION)
      if (url.pathname === `/api/staff/customers/${HANAKO_CUSTOMER}`) return json(CUSTOMER)
      if (url.pathname === `/api/staff/stores/${GINZA}/staff`) return json(STAFF)
      return json({ error: 'not_found' }, 404)
    }),
  )
}

beforeEach(() => {
  boards = [FULL_BOARD]
  posted = []
})

afterEach(() => vi.unstubAllGlobals())

function show(props: Partial<Parameters<typeof ReceptionScreen>[0]> = {}) {
  render(<ReceptionScreen storeId={GINZA} initialDate={DATE} {...props} />)
}

describe('来店受付の器', () => {
  it('読み込んでいる間は読み込み中だけを出す', () => {
    // 応答を返さない（読み込みの途中で止めたまま見る）。
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    )
    show()
    expect(screen.getByRole('status')).toHaveTextContent('読み込んでいます…')
  })

  it('読み込めなかったときはもう一度読み込める', async () => {
    const user = userEvent.setup()
    let failed = true
    stub((url) => {
      if (url.pathname !== '/api/staff/visits/board') return null
      if (!failed) return null
      failed = false
      return json({ error: 'boom' }, 500)
    })
    show()
    const retry = await screen.findByRole('button', { name: 'もう一度読み込む' })
    await user.click(retry)
    expect(await screen.findByRole('grid')).toBeInTheDocument()
  })

  it('権限が無いお店ではやり直す道を出さない', async () => {
    stub((url) =>
      url.pathname === '/api/staff/visits/board' ? json({ error: 'forbidden' }, 403) : null,
    )
    show()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'このお店の来店受付を見る権限がありません。',
    )
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).toBeNull()
  })

  it('業務の時間が切れたら器の外へ知らせる', async () => {
    const onSessionExpired = vi.fn()
    stub((url) =>
      url.pathname === '/api/staff/visits/board' ? json({ error: 'unauthorized' }, 401) : null,
    )
    show({ onSessionExpired })
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalled())
  })

  it('一度読めたあとに取り直せなくなったら、盤面を残したまま通信断の帯を出す', async () => {
    const user = userEvent.setup()
    let cut = false
    stub((url) => {
      if (url.pathname !== '/api/staff/visits/board') return null
      return cut ? json({ error: 'boom' }, 500) : null
    })
    show()
    await screen.findByRole('grid')
    cut = true
    await user.click(screen.getByRole('button', { name: '本日すべて' }))
    expect(await screen.findByText('通信が切れています')).toBeInTheDocument()
    // 読むことだけは続けられる。**盤面を消して読み込み直しの面に落とさない。**
    expect(screen.getByRole('grid')).toBeInTheDocument()
    expect(screen.getByText('10:55 現在')).toBeInTheDocument()
  })

  it('「本日すべて」に切り替えると scope=all で取り直す', async () => {
    const user = userEvent.setup()
    const seen: string[] = []
    stub((url) => {
      if (url.pathname === '/api/staff/visits/board') seen.push(url.searchParams.get('scope') ?? '')
      return null
    })
    show()
    await screen.findByRole('grid')
    await user.click(screen.getByRole('button', { name: '本日すべて' }))
    await waitFor(() => expect(seen).toContain('all'))
  })

  it('退店を記録すると、その行がご来店中から外れて人数が 1 減る', async () => {
    const user = userEvent.setup()
    boards = [FULL_BOARD, AFTER_LEFT]
    stub()
    show()
    await screen.findByRole('grid')
    expect(screen.getByText('2026年8月27日（木）　ご来店中 2名', asWritten)).toBeInTheDocument()

    await user.click(screen.getByRole('rowheader', { name: 'ウォークイン 003　フレームのご相談' }))
    const actions = screen.getByRole('group', { name: 'ウォークイン 003 にできること' })
    await user.click(within(actions).getByRole('button', { name: '退店を記録する' }))

    await waitFor(() =>
      expect(screen.getByText('2026年8月27日（木）　ご来店中 1名', asWritten)).toBeInTheDocument(),
    )
    expect(
      screen.queryByRole('rowheader', { name: 'ウォークイン 003　フレームのご相談' }),
    ).toBeNull()
    expect(posted[0]).toMatchObject({
      stage: 'left',
      subjectType: 'walkin',
      subjectId: WALKIN_SUBJECT,
    })
  })

  it('「次にやること」を押すと、誰が始めるのかを聞いてから工程が始まる', async () => {
    /*
     * 聞かずに積んでいたころ、`visit_events.staff_id` は常に NULL で、受付履歴にも
     * 分析にも「誰が対応したか」が 1 件も残らなかった
     * （実装不足の洗い出し reception-04。AC-RECEP-12）。
     */
    const user = userEvent.setup()
    stub()
    show()
    await screen.findByRole('grid')
    await user.click(
      screen.getByRole('gridcell', { name: '田中 花子 様　視力測定　次にやること　視力測定機 A' }),
    )
    // まだ積まない。先に担当を聞く。
    expect(posted).toHaveLength(0)
    const sheet = await screen.findByRole('dialog', { name: 'この工程を始める担当' })
    await user.click(within(sheet).getByRole('button', { name: '佐藤 美咲' }))
    await waitFor(() =>
      expect(posted[0]).toMatchObject({
        stage: 'measuring',
        subjectType: 'reservation',
        subjectId: HANAKO_RESERVATION,
        staffId: MISAKI,
      }),
    )
  })

  it('担当を決めずに始める道も残す（接客はもう始まっている）', async () => {
    const user = userEvent.setup()
    stub()
    show()
    await screen.findByRole('grid')
    await user.click(
      screen.getByRole('gridcell', { name: '田中 花子 様　視力測定　次にやること　視力測定機 A' }),
    )
    const sheet = await screen.findByRole('dialog', { name: 'この工程を始める担当' })
    await user.click(within(sheet).getByRole('button', { name: '担当はあとで決める' }))
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).not.toHaveProperty('staffId')
  })

  it('進めた直後に「元に戻す」が出て、押すと 1 つ前の工程を積み直す', async () => {
    /*
     * 押す前に確認を挟むと、1 日に何十回も押す操作が毎回止まる。だから押させてから
     * 数秒だけ戻せる形にした（UX 監査 NEW-04。それまで製品には元に戻す手立てが
     * 1 つも無かった）。
     */
    const user = userEvent.setup()
    stub()
    show()
    await screen.findByRole('grid')
    await user.click(
      screen.getByRole('gridcell', { name: '田中 花子 様　視力測定　次にやること　視力測定機 A' }),
    )
    // 誰が始めるのかを聞かれる（AC-RECEP-12）。選ぶと積まれる。
    const sheet = await screen.findByRole('dialog', { name: 'この工程を始める担当' })
    await user.click(within(sheet).getByRole('button', { name: '佐藤 美咲' }))
    const undo = await screen.findByRole('button', { name: '元に戻す' })
    expect(screen.getByText('田中 花子 様を「視力測定」へ進めました。')).toBeInTheDocument()

    await user.click(undo)
    await waitFor(() => expect(posted).toHaveLength(2))
    // 戻り先は、押した列より左で最後に済んでいる列（この行では「受付」まで）。
    expect(posted[1]).toMatchObject({
      stage: 'received',
      subjectType: 'reservation',
      subjectId: HANAKO_RESERVATION,
    })
    expect(screen.queryByRole('button', { name: '元に戻す' })).toBeNull()
  })

  it('まだ受け付けていない行から来店受付の画面を開ける', async () => {
    const user = userEvent.setup()
    stub()
    show()
    await screen.findByRole('grid')
    await user.click(
      screen.getByRole('rowheader', { name: '田中 花子 様　4回目　メガネを新しく作る' }),
    )
    const actions = screen.getByRole('group', { name: '田中 花子 様 にできること' })
    await user.click(within(actions).getByRole('button', { name: 'ご来店を受け付ける' }))

    expect(
      await screen.findByText('11:00 のご予約　5分早くお着きです', asWritten),
    ).toBeInTheDocument()
    // 注意ごとは 3 行目として並び、受付の面は自分で API を増やさない。
    expect(screen.getByRole('checkbox', { name: '金属アレルギー' })).toBeInTheDocument()
    expect(screen.queryByRole('grid')).toBeNull()
  })

  it('受け付けると来店受付ボードへ戻り、その行の受付が済みになる', async () => {
    const user = userEvent.setup()
    boards = [FULL_BOARD, AFTER_RECEIVED]
    stub()
    show()
    await screen.findByRole('grid')
    await user.click(
      screen.getByRole('rowheader', { name: '田中 花子 様　4回目　メガネを新しく作る' }),
    )
    await user.click(screen.getByRole('button', { name: 'ご来店を受け付ける' }))
    await screen.findByText('11:00 のご予約　5分早くお着きです', asWritten)
    await user.click(screen.getByRole('button', { name: 'ご来店を受け付ける' }))

    expect(await screen.findByRole('grid')).toBeInTheDocument()
    expect(posted[0]).toMatchObject({ stage: 'received', subjectId: HANAKO_RESERVATION })
    expect(
      screen.getByRole('gridcell', { name: '田中 花子 様　受付　済みました　10:55' }),
    ).toBeInTheDocument()
  })

  it('「お待ちいただく」は待ちとして送り、盤面へ戻る', async () => {
    const user = userEvent.setup()
    stub()
    show()
    await screen.findByRole('grid')
    await user.click(
      screen.getByRole('rowheader', { name: '田中 花子 様　4回目　メガネを新しく作る' }),
    )
    await user.click(screen.getByRole('button', { name: 'ご来店を受け付ける' }))
    await screen.findByText('11:00 のご予約　5分早くお着きです', asWritten)
    await user.click(screen.getByRole('button', { name: 'お待ちいただく' }))

    expect(await screen.findByRole('grid')).toBeInTheDocument()
    expect(posted[0]).toMatchObject({ stage: 'waiting', subjectId: HANAKO_RESERVATION })
  })

  it('「＋ ご来店を受け付ける」は台帳の受付パネルへ渡す', async () => {
    const user = userEvent.setup()
    const onOpenLedger = vi.fn()
    stub()
    show({ onOpenLedger })
    await screen.findByRole('grid')
    await user.click(screen.getByRole('button', { name: '＋ ご来店を受け付ける' }))
    expect(onOpenLedger).toHaveBeenCalledTimes(1)
  })

  it('「ご来店がなかった」を盤面から残せる（気づくのは受付の現場である）', async () => {
    /*
     * `008` の決め:「『ご来店がなかった』は来店受付ボードからも残せる（気づくのは
     * 受付の現場であるため）。予約の取り消しの画面にも同じ操作を置く」。
     * 渡していなかったころ、この操作は台帳へ回らないと届かなかった
     * （実装不足の洗い出し reception-01。UC-RECEP-11 / AC-RECEP-16）。
     */
    const user = userEvent.setup()
    const sent: { url: string; body: unknown }[] = []
    stub((url, init) => {
      if (!url.pathname.endsWith('/cancel')) return null
      sent.push({ url: url.pathname, body: JSON.parse(String(init?.body ?? '{}')) })
      return json({ ...RESERVATION, status: 'no_show', version: RESERVATION.version + 1 })
    })
    show()
    await screen.findByRole('grid')
    await user.click(
      screen.getByRole('rowheader', { name: '田中 花子 様　4回目　メガネを新しく作る' }),
    )
    await user.click(screen.getByRole('button', { name: 'ご来店がなかった' }))
    await waitFor(() => expect(sent).toHaveLength(1))
    // 理由は `no_show`。取り消しと分けて数えるための語である。
    expect(sent[0]?.body).toMatchObject({ reason: 'no_show', version: RESERVATION.version })
  })
})
