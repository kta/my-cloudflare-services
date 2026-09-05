import type { LocalDate, ReceptionHistoryDetail, ReceptionHistoryEntry } from '@app/contracts'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type HistoryFilters, ReceptionHistory } from './ReceptionHistory'

/*
 * 受付履歴の一覧・詳細・0 件（承認済みモック
 * docs/frontend/mockups/eye/images/HISTORY-LIST.png と HISTORY-EMPTY.png）。
 *
 * 一覧の仕事は「いつ誰が受け、そのあと何が変わったか」をその場で答えられること、
 * 0 件の仕事は「絞りすぎた店長を、条件を 1 つ緩めるだけで元の道へ戻す」こと。
 * 見た目の寸法は e2e の突き合わせで見るので、ここでは「何が読めて、何が押せるか」を見る。
 *
 * 実測（screens/HISTORY-LIST.html / HISTORY-EMPTY.html の <style> と assets/eye.css）:
 *   `.toolbar` 56px。`.fbtn` min-height 40px / padding 0 12px / 角 8px / 13px・600
 *   （値は 400 の --ink-2。選択中は枠 2px --brand ＋ 地 --brand-tint）。
 *   「お客様名で探す」 min-height 40px / padding 0 14px。
 *   本文 `.split` は `288px 1fr`。左ペイン padding 24px 16px。
 *   `.hrow` min-height 56px / gap 10px、時刻 14px/600 等幅 --ink-2、名前 15px/600、札は右端。
 *   選択中の行は margin 0 −8px / padding 16px 8px / 角 12px / 地 --brand-tint / 下罫なし。
 *   「ほか 42件　8月21日まで」は small・muted・上に 20px。
 *   右ペイン `.det` padding 28px 32px / 段の間 26px。見出し 20px、副文 13px（上に 4px）、
 *   「予約を開く」min-height 44px / padding 0 14px。`dl.kv` は `1.15fr 1.15fr 0.7fr`。
 *   「そのあとの変更」の行 padding 11px 0 / 下罫 1px、日時の欄 92px の等幅 13px/600、
 *   内容 15px、操作者は右端 13px --ink-2。
 *   0 件は中央寄せ（padding 36px）・幅 640px、見出し 24px 中央、副文 15px 中央（上に 12px）。
 *   候補の行 min-height 62px / gap 14px、文 16px、件数は右寄せ 21px/600 の等幅 --brand-dark、
 *   「この条件で見る」min-height 44px。「絞り込みをすべて外す（46件）」は min-height 56px / 18px。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
const TODAY: LocalDate = '2026-08-27'
const MISAKI = 'd0000000-0000-4000-8000-000000000001'

const STAFF = [
  { id: MISAKI, name: '佐藤 美咲' },
  { id: 'd0000000-0000-4000-8000-000000000002', name: '中村 彩' },
]

function at(date: string, clock: string): string {
  return new Date(`${date}T${clock}:00+09:00`).toISOString()
}

function uuid(index: number): string {
  return `f0000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function entry(
  index: number,
  date: string,
  clock: string,
  displayName: string,
  extra: Partial<ReceptionHistoryEntry> = {},
): ReceptionHistoryEntry {
  return {
    entryId: uuid(index),
    sessionId: null,
    startedAt: at(date, clock),
    displayName,
    visitCount: null,
    outcome: 'booked',
    reservationStatus: 'confirmed',
    ...extra,
  }
}

/** モックが描いている 4 行（田中 花子 様・ウォークイン 003・相川 みどり 様・山口 真央 様）。 */
const HANAKO = entry(1, '2026-08-27', '11:08', '田中 花子 様', {
  visitCount: 4,
  sessionId: uuid(901),
  reservationStatus: 'arrived',
})
const WALKIN = entry(2, '2026-08-27', '10:50', 'ウォークイン 003')
const MIDORI = entry(3, '2026-08-27', '10:12', '相川 みどり 様', {
  outcome: 'discarded',
  reservationStatus: 'cancelled',
})
const MAO = entry(4, '2026-08-27', '09:41', '山口 真央 様', {
  visitCount: 0,
  reservationStatus: 'no_show',
})

/** 1 ページ目 20 件。18 件が 8月27日、2 件が 8月26日（ご来店日で束ねるところを見る）。 */
const PAGE_1: ReceptionHistoryEntry[] = [
  HANAKO,
  WALKIN,
  MIDORI,
  MAO,
  ...Array.from({ length: 14 }, (_, index) =>
    entry(
      10 + index,
      '2026-08-27',
      `09:${String(39 - index).padStart(2, '0')}`,
      `松本 ${index + 1} 様`,
    ),
  ),
  entry(40, '2026-08-26', '18:20', '青木 律子 様'),
  entry(41, '2026-08-26', '17:05', '石井 孝 様'),
]

/** 2 ページ目 20 件。読み足しで足されて 40 行になる。 */
const PAGE_2: ReceptionHistoryEntry[] = Array.from({ length: 20 }, (_, index) =>
  entry(
    60 + index,
    '2026-08-26',
    `16:${String(59 - index).padStart(2, '0')}`,
    `川上 ${index + 1} 様`,
  ),
)

const DETAIL: ReceptionHistoryDetail = {
  entryId: HANAKO.entryId,
  sessionId: HANAKO.sessionId,
  reservation: {
    id: 'b0000000-0000-4000-8000-000000000001',
    code: 'R-260827-0001',
    storeId: STORE_ID,
    source: 'phone',
    status: 'arrived',
    startsAt: at('2026-08-27', '11:00'),
    endsAt: at('2026-08-27', '12:00'),
    durationMinutes: 60,
    customerId: 'c0000000-0000-4000-8000-000000000001',
    customerName: '田中 花子',
    visitCount: 4,
    purposes: [
      {
        purposeId: 'e0000000-0000-4000-8000-000000000001',
        nameInternal: 'メガネを新しく作る',
        durationMinutes: 60,
        sortOrder: 0,
      },
    ],
    assignments: [
      {
        kind: 'staff',
        targetId: MISAKI,
        startsAt: at('2026-08-27', '11:00'),
        endsAt: at('2026-08-27', '12:00'),
      },
    ],
    webBookingCode: null,
    purposeLabel: '新調相談',
    purposeLabelInternal: 'メガネを新しく作る',
    noteCustomer: '',
    noteInternal: '',
    version: 3,
    createdAt: at('2026-08-20', '14:32'),
    updatedAt: at('2026-08-27', '10:55'),
    createdBy: null,
    cancelledAt: null,
    cancelReason: null,
  },
  receivedBy: '中村 彩',
  receivedAt: at('2026-08-20', '14:32'),
  changes: [
    { occurredAt: at('2026-08-20', '14:32'), what: '新しく受け付けました', actorName: '中村 彩' },
    {
      occurredAt: at('2026-08-27', '10:55'),
      what: 'ご来店を受け付けました',
      actorName: '中村 彩',
    },
  ],
  recording: null,
}

/** `DETAIL.reservation` は必ず載っている（お名前だけを外した形を作るための土台）。 */
const NON_NULL_RESERVATION = DETAIL.reservation as NonNullable<
  ReceptionHistoryDetail['reservation']
>

type ListReply = {
  items: ReceptionHistoryEntry[]
  nextCursor: string | null
  total: number
  relaxations?: { label: string; count: number; query: Record<string, unknown> }[]
}

let asked: URL[] = []
let listReply: (url: URL) => Promise<ListReply>
let detailReply: () => Promise<ReceptionHistoryDetail>
let hold: Promise<void> | null

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const openReservation = vi.fn()
const startBooking = vi.fn()
const queryChanged = vi.fn<(filters: HistoryFilters) => void>()

beforeEach(() => {
  asked = []
  hold = null
  openReservation.mockClear()
  startBooking.mockClear()
  queryChanged.mockClear()
  listReply = async (url) =>
    url.searchParams.get('cursor') === null
      ? { items: PAGE_1, nextCursor: 'page-2', total: 46 }
      : { items: PAGE_2, nextCursor: null, total: 46 }
  detailReply = async () => DETAIL
  sessionStorage.setItem('app.auth.token', 'header.payload.signature')
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://example.test')
      asked.push(url)
      if (url.pathname === '/api/staff/reception-sessions') {
        if (hold !== null) await hold
        return json(await listReply(url))
      }
      if (url.pathname.startsWith('/api/staff/reception-sessions/'))
        return json(await detailReply())
      return json({ error: 'not_found' }, 404)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

function open(initialQuery?: Partial<HistoryFilters>) {
  render(
    <ReceptionHistory
      storeId={STORE_ID}
      today={TODAY}
      staff={STAFF}
      initialQuery={initialQuery}
      onQueryChange={queryChanged}
      onOpenReservation={openReservation}
      onStartBooking={startBooking}
    />,
  )
}

const rows = () => within(screen.getByRole('group', { name: '受付の一覧' })).getAllByRole('button')

async function opened(initialQuery?: Partial<HistoryFilters>) {
  open(initialQuery)
  await screen.findByRole('group', { name: '受付の一覧' })
}

describe('受付履歴', () => {
  it('絞り込みが 期間・担当・結果 の 3 つ並ぶ', async () => {
    await opened()
    const filters = screen.getByRole('group', { name: '受付履歴の絞り込み' })
    const buttons = within(filters).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual([
      '期間8月21日 〜 8月27日',
      '担当すべて',
      '結果すべて',
    ])
  })

  it('左の一覧はご来店日で束ね、見出しに「2026年8月27日（木）　46件」を出す', async () => {
    await opened()
    expect(screen.getByRole('heading', { name: '2026年8月27日（木）　46件' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '2026年8月26日（水）' })).toBeInTheDocument()
  })

  it('一覧は新しい順に 20 件まで出る', async () => {
    await opened()
    const listed = rows()
    expect(listed).toHaveLength(20)
    expect(listed[0]).toHaveTextContent('11:08')
    expect(listed[0]).toHaveTextContent('田中 花子 様')
    expect(listed[1]).toHaveTextContent('10:50')
    expect(listed[19]).toHaveTextContent('石井 孝 様')
  })

  it('残りは「ほか 26件　8月21日まで」の 1 行にまとまる', async () => {
    await opened()
    expect(screen.getByRole('button', { name: 'ほか 26件　8月21日まで' })).toBeInTheDocument()
  })

  it('その 1 行を押すと次の 20 件が読み足される', async () => {
    await opened()
    await userEvent.click(screen.getByRole('button', { name: 'ほか 26件　8月21日まで' }))
    await waitFor(() => expect(rows()).toHaveLength(40))
    expect(asked.at(-1)?.searchParams.get('cursor')).toBe('page-2')
  })

  it('取消の行は「取消」の札を持つ', async () => {
    await opened()
    const row = rows().find((node) => node.textContent?.includes('相川 みどり 様') === true)
    expect(row).toHaveTextContent('取消')
  })

  it('ご来店なしの行は「ご来店なし」の札を持つ', async () => {
    await opened()
    const row = rows().find((node) => node.textContent?.includes('山口 真央 様') === true)
    expect(row).toHaveTextContent('ご来店なし')
  })

  it('1 件を選ぶと右に「中村 彩 が 8月20日（木）14:32 に電話で受け付け」が出る', async () => {
    await opened()
    await userEvent.click(rows()[0] as HTMLElement)
    expect(
      await screen.findByText(/中村 彩 が 8月20日（木）14:32 に.*電話で受け付け/),
    ).toBeInTheDocument()
    const detail = screen.getByRole('region', { name: '選んだ受付の中身' })
    expect(within(detail).getByText('2026年8月27日（木）11:00')).toBeInTheDocument()
    expect(within(detail).getByText('メガネを新しく作る（60分）')).toBeInTheDocument()
    expect(within(detail).getByText('佐藤 美咲')).toBeInTheDocument()
  })

  it('そのあとの変更が古い順に並ぶ', async () => {
    await opened()
    await userEvent.click(rows()[0] as HTMLElement)
    const changes = within(
      await screen.findByRole('list', { name: 'そのあとの変更' }),
    ).getAllByRole('listitem')
    expect(changes.map((node) => node.textContent)).toEqual([
      '8/20 14:32新しく受け付けました中村 彩',
      '8/27 10:55ご来店を受け付けました中村 彩',
    ])
  })

  it('右の見出しは来店回数の札を持つ', async () => {
    await opened()
    await userEvent.click(rows()[0] as HTMLElement)
    const detail = await screen.findByRole('region', { name: '選んだ受付の中身' })
    expect(within(detail).getByText('4回目')).toBeInTheDocument()
  })

  it('お名前が分からない受付でも「様」を重ねない', async () => {
    listReply = async () => ({
      items: [entry(90, '2026-08-27', '17:30', 'お客様')],
      nextCursor: null,
      total: 1,
    })
    const noName: ReceptionHistoryDetail = {
      ...DETAIL,
      reservation: {
        ...NON_NULL_RESERVATION,
        customerId: null,
        customerName: null,
        visitCount: null,
      },
    }
    detailReply = async () => noName
    await opened()
    await userEvent.click(rows()[0] as HTMLElement)
    const detail = await screen.findByRole('region', { name: '選んだ受付の中身' })
    expect(within(detail).queryByText(/お客様 様/)).toBeNull()
    expect(
      within(detail).getByText(
        (_, node) => node?.tagName === 'B' && node.textContent?.startsWith('お客様　') === true,
      ),
    ).toBeInTheDocument()
  })

  it('そのあとの変更がまだ 1 行も無いときは、見出しの下にその事実を出す', async () => {
    detailReply = async () => ({ ...DETAIL, changes: [] })
    await opened()
    await userEvent.click(rows()[0] as HTMLElement)
    const detail = await screen.findByRole('region', { name: '選んだ受付の中身' })
    expect(await within(detail).findByText('まだ何もありません。')).toBeInTheDocument()
    expect(within(detail).queryByRole('list', { name: 'そのあとの変更' })).toBeNull()
  })

  it('「お客様名で探す」に「田中」と入れると、期間・担当・結果を保ったまま絞れる', async () => {
    await opened()
    await userEvent.click(screen.getByRole('button', { name: /結果/ }))
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'お客様名で探す' }), '田中')
    // 先頭の 1 件を自動で選ぶので、`asked` の末尾は詳細の要求になる。一覧の要求だけを見る。
    const listCalls = () => asked.filter((url) => url.pathname === '/api/staff/reception-sessions')
    await waitFor(() => expect(listCalls().at(-1)?.searchParams.get('name')).toBe('田中'))
    const last = listCalls().at(-1)
    expect(last?.searchParams.get('status')).toBe('cancelled')
    expect(last?.searchParams.get('from')).toBe('2026-08-21')
    expect(last?.searchParams.get('to')).toBe('2026-08-27')
  })

  it('「予約を開く」でその予約へ移り、戻ると同じ絞り込みの受付履歴に戻る', async () => {
    await opened()
    await userEvent.type(screen.getByRole('searchbox', { name: 'お客様名で探す' }), '田中')
    await waitFor(() => expect(queryChanged).toHaveBeenCalled())
    await userEvent.click(rows()[0] as HTMLElement)
    await userEvent.click(await screen.findByRole('button', { name: '予約を開く' }))
    expect(openReservation).toHaveBeenCalledWith('b0000000-0000-4000-8000-000000000001')

    const kept = queryChanged.mock.calls.at(-1)?.[0]
    cleanup()
    await opened(kept)
    expect(screen.getByRole('searchbox', { name: 'お客様名で探す' })).toHaveValue('田中')
  })

  it('選択中の行は aria-current="true" を持ち、選び直すと移る', async () => {
    await opened()
    // 開いた瞬間に先頭が選ばれている（UX 監査 UI-09）。
    await waitFor(() => expect(rows()[0]).toHaveAttribute('aria-current', 'true'))
    const second = rows()[1] as HTMLElement
    await userEvent.click(second)
    await waitFor(() => expect(rows()[1]).toHaveAttribute('aria-current', 'true'))
    expect(rows()[0]).not.toHaveAttribute('aria-current')
  })

  it('録音の欄はこのフェーズでは出さない', async () => {
    await opened()
    await userEvent.click(rows()[0] as HTMLElement)
    await screen.findByRole('region', { name: '選んだ受付の中身' })
    expect(screen.queryByText(/録音/)).toBeNull()
  })

  it('読み込み中は骨組みだけを出し、行数を変えない', async () => {
    hold = new Promise(() => undefined)
    open()
    const skeleton = await screen.findByRole('status')
    expect(skeleton).toHaveTextContent('受付履歴を読み込んでいます…')
    expect(skeleton.querySelectorAll('li')).toHaveLength(20)
    expect(screen.queryByRole('group', { name: '受付の一覧' })).toBeNull()
  })
})

/* --- 0 件（HISTORY-EMPTY） ------------------------------------------------ */

const WIDEN = {
  label: '期間を「今月（8月1日 〜 8月27日）」まで広げる',
  count: 12,
  query: { from: '2026-08-01', to: '2026-08-27', staffId: MISAKI, status: ['cancelled'] },
}
const DROP_STAFF = {
  label: '担当の絞り込みを外す',
  count: 7,
  query: { from: '2026-08-25', to: '2026-08-26', status: ['cancelled'] },
}
const CLEAR_ALL = {
  label: '絞り込みをすべて外す',
  count: 46,
  query: { from: '2026-08-01', to: '2026-08-27' },
}

/** モックの絞り込み（8月25日 〜 8月26日／担当 佐藤 美咲／結果 取消）。 */
const NARROWED: Partial<HistoryFilters> = {
  from: '2026-08-25',
  to: '2026-08-26',
  staffId: MISAKI,
  result: 'cancelled',
}

function emptyWith(relaxations: ListReply['relaxations']) {
  listReply = async () => ({ items: [], nextCursor: null, total: 0, relaxations })
}

async function openEmpty(relaxations: ListReply['relaxations'] = [WIDEN, DROP_STAFF, CLEAR_ALL]) {
  emptyWith(relaxations)
  open(NARROWED)
  await screen.findByRole('heading', { name: '条件に合う受付履歴はありませんでした' })
}

describe('受付履歴が 0 件', () => {
  it('右上が「該当 0件」になる', async () => {
    await openEmpty()
    expect(screen.getByText('該当 0件')).toBeInTheDocument()
  })

  it('「条件に合う受付履歴はありませんでした」と絞った条件の言い直しが出る', async () => {
    await openEmpty()
    expect(
      // getByText は DOM 側だけを正規化するので、期待値は全角空白を半角に畳んだ形で書く。
      screen.getByText('8月25日 〜 8月26日／担当 佐藤 美咲／結果 取消 で 0件でした。'),
    ).toBeInTheDocument()
  })

  it('緩和候補が件数つきで並ぶ', async () => {
    await openEmpty()
    const list = screen.getByRole('group', { name: '条件を変えると見つかります' })
    const options = within(list).getAllByRole('button')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('12件')
    expect(options[1]).toHaveTextContent('7件')
  })

  it('候補は「期間を「今月（8月1日 〜 8月27日）」まで広げる　12件」の名前で引ける', async () => {
    await openEmpty()
    expect(
      screen.getByRole('button', {
        name: /期間を「今月（8月1日 〜 8月27日）」まで広げる　12件/,
      }),
    ).toBeInTheDocument()
  })

  it('「この条件で見る」を押すとその条件で開き直す', async () => {
    await openEmpty([WIDEN])
    await userEvent.click(screen.getByRole('button', { name: /この条件で見る/ }))
    await waitFor(() => expect(asked.at(-1)?.searchParams.get('from')).toBe('2026-08-01'))
    expect(asked.at(-1)?.searchParams.get('to')).toBe('2026-08-27')
    expect(asked.at(-1)?.searchParams.get('staffId')).toBe(MISAKI)
    expect(asked.at(-1)?.searchParams.get('status')).toBe('cancelled')
  })

  it('「絞り込みをすべて外す（46件）」が件数つきで出て、押すと全件に戻る', async () => {
    await openEmpty()
    await userEvent.click(screen.getByRole('button', { name: '絞り込みをすべて外す（46件）' }))
    await waitFor(() => expect(asked.at(-1)?.searchParams.get('staffId')).toBeNull())
    expect(asked.at(-1)?.searchParams.get('status')).toBeNull()
    expect(asked.at(-1)?.searchParams.get('from')).toBe('2026-08-01')
  })

  it('0 件になったことが role="status" で読み上げられ、入力の手が止まらない', async () => {
    await openEmpty()
    const said = screen.getByRole('status')
    expect(said).toHaveTextContent('条件に合う受付履歴はありませんでした')
    expect(screen.queryByRole('alert')).toBeNull()
    const box = screen.getByRole('searchbox', { name: 'お客様名で探す' })
    box.focus()
    await userEvent.type(box, '田')
    expect(document.activeElement).toBe(box)
  })

  it('候補が 1 つも無いときは全解除だけが出る', async () => {
    await openEmpty([CLEAR_ALL])
    expect(screen.queryByRole('group', { name: '条件を変えると見つかります' })).toBeNull()
    expect(screen.getByRole('button', { name: '絞り込みをすべて外す（46件）' })).toBeInTheDocument()
  })

  it('この店舗にまだ受付が無いときは理由だけを出し「＋ 予約を取る」を置く', async () => {
    await openEmpty([])
    expect(screen.queryByRole('group', { name: '条件を変えると見つかります' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '＋ 予約を取る' }))
    expect(startBooking).toHaveBeenCalledTimes(1)
  })

  it('絞り込みの値は消さない（0 件になっても条件が画面に残る）', async () => {
    await openEmpty()
    const filters = screen.getByRole('group', { name: '受付履歴の絞り込み' })
    expect(
      within(filters)
        .getAllByRole('button')
        .map((node) => node.textContent),
    ).toEqual(['期間8月25日 〜 8月26日', '担当佐藤 美咲', '結果取消'])
  })
})

/*
 * 一覧が届いたら、先頭の 1 件を選んで右を埋める。
 * 以前は何も選ばれずに開き、画面の 58% を占める右ペインが
 * 「左の 1 件をお選びください。」という灰色の 1 行だけだった（UX 監査 UI-09）。
 * 左の 12 件のうち先頭を選ぶだけで埋まるものを、利用者にその 1 タップを押させない。
 */
describe('開いた瞬間の選択', () => {
  it('一覧が届いたら先頭の 1 件を選び、右を埋める', async () => {
    await opened()
    await waitFor(() => expect(screen.queryByText(/左の 1 件をお選びください/)).toBeNull())
  })

  it('選ばれた行に印が付く', async () => {
    await opened()
    await waitFor(() => expect(rows()[0]).toHaveAttribute('aria-current', 'true'))
  })

  it('利用者が別の行を選んだら、その選択を勝手に戻さない', async () => {
    await opened()
    await waitFor(() => expect(rows()[0]).toHaveAttribute('aria-current', 'true'))
    const second = rows()[1]
    if (second === undefined) throw new Error('2 件目が無い')
    await userEvent.click(second)
    expect(second).toHaveAttribute('aria-current', 'true')
    expect(rows()[0]).not.toHaveAttribute('aria-current')
  })
})
