import type { ReservationDetail, ReservationSummary, SearchRelaxation } from '@app/contracts'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ReservationSearch, type SearchConditions } from './ReservationSearch'

/*
 * 予約を探す面（承認済みモック docs/frontend/mockups/eyex/images/CHANGE-SEARCH.png ／
 * EX-EMPTY-SEARCH.png）。
 *
 * 実測（screens/CHANGE-SEARCH.html ／ EX-EMPTY-SEARCH.html と assets/eyex.css）:
 *   2 段組みは 340px 1fr（0 件の面は 300px 1fr で、左が白地＋右に 1px の罫）。
 *   左ペイン padding 32px 24px・見出し 17px（0 件は 16px）・欄の間 16px（0 件は 14px）。
 *   絞り込みの札 min-height 44px・padding 0 14px・ピル・14px/600（選択中は緑地・白文字）。
 *   「結果 4件」13px・margin 26px 0 10px。結果の行 min-height 62px・padding 10px 12px・
 *   角 12px・行間 10px（選択中は 2px の緑罫 + --brand-tint で padding 9px 11px）。
 *   右ペイン padding 36px 40px。予約番号は等幅 15px、日時 26px/600、所要 15px、
 *   項目名の列 128px の 13px、値 17px/600。
 *   0 件の右は見出し 22px・小見出し 16px/700・案は 3 列 gap 14px・min-height 112px。
 *
 * ここで見るのは「何が読めて、何が押せるか」。寸法そのものは e2e の突き合わせが見る。
 */

const AT_1100 = '2026-08-27T02:00:00.000Z'
const AT_1200 = '2026-08-27T03:00:00.000Z'
const AT_1000 = '2026-08-27T01:00:00.000Z'
const AT_0903_1030 = '2026-09-03T01:30:00.000Z'

const ITEMS: ReservationSummary[] = [
  {
    id: 'r1',
    code: 'EY-2608-0142',
    startsAt: AT_1100,
    durationMinutes: 60,
    status: 'confirmed',
    source: 'phone',
    customerName: '田中 花子',
    visitCount: 4,
    purposeLabel: 'メガネを新しく作る',
    staffName: '佐藤 美咲',
  },
  {
    id: 'r2',
    code: 'EY-2608-0138',
    startsAt: AT_1000,
    durationMinutes: 30,
    status: 'confirmed',
    source: 'counter',
    customerName: '伊藤 健',
    visitCount: 2,
    purposeLabel: '調整',
    staffName: '高橋 健',
  },
  {
    id: 'r3',
    code: 'EY-2608-0139',
    startsAt: AT_1100,
    durationMinutes: 30,
    status: 'confirmed',
    source: 'web',
    customerName: '山口 真央',
    visitCount: 0,
    purposeLabel: '視力測定だけ',
    staffName: '中村 彩',
  },
  {
    id: 'r4',
    code: 'EY-2609-0021',
    startsAt: AT_0903_1030,
    durationMinutes: 30,
    status: 'confirmed',
    source: 'phone',
    customerName: '田中 花子',
    visitCount: 4,
    purposeLabel: '受け取り',
    staffName: null,
  },
]

const DETAIL: ReservationDetail = {
  id: 'r1',
  code: 'EY-2608-0142',
  storeId: '11111111-2222-4333-8444-555555555555',
  source: 'phone',
  status: 'confirmed',
  startsAt: AT_1100,
  endsAt: AT_1200,
  durationMinutes: 60,
  customerId: 'c1',
  customerName: '田中 花子',
  visitCount: 4,
  purposes: [
    { purposeId: 'p1', nameInternal: 'メガネを新しく作る', durationMinutes: 60, sortOrder: 0 },
  ],
  assignments: [],
  webBookingCode: null,
  purposeLabel: '新調',
  purposeLabelInternal: 'メガネを新しく作る',
  noteCustomer: '',
  noteInternal: '乱視が強めのため、視力測定にお時間がかかることがあります。',
  version: 1,
  createdAt: AT_1000,
  updatedAt: AT_1000,
  createdBy: null,
  cancelledAt: null,
  cancelReason: null,
}

const RELAXATIONS: SearchRelaxation[] = [
  { label: '期間を 8月1日 〜 9月30日 に広げる', count: 3, query: { from: '2026-08-01' } },
  { label: '「Web予約だけ」を外す', count: 5, query: { name: 'たなか はなこ' } },
  { label: '取り消されたご予約も含める', count: 1, query: { includeCancelled: true } },
]

const BLANK: SearchConditions = {
  name: '',
  phone: '',
  code: '',
  period: 'upcoming',
  source: null,
  includeCancelled: false,
}

/** EX-EMPTY-SEARCH の条件（お名前はかな・期間 8/27〜8/31・Web予約だけ）。 */
const EMPTY_CONDITIONS: SearchConditions = {
  name: 'たなか はなこ',
  phone: '',
  code: '',
  period: { from: '2026-08-27', to: '2026-08-31' },
  source: 'web',
  includeCancelled: false,
}

type Overrides = Partial<Parameters<typeof ReservationSearch>[0]>

function show(overrides: Overrides = {}) {
  const props = {
    conditions: BLANK,
    onConditions: vi.fn(),
    items: ITEMS,
    total: ITEMS.length,
    relaxations: [] as readonly SearchRelaxation[],
    phase: 'ready' as const,
    selectedId: null,
    onSelect: vi.fn(),
    detail: null,
    detailPhase: 'ready' as const,
    staffName: null,
    equipmentNames: [] as readonly string[],
    customerPhone: null,
    onRelax: vi.fn(),
    onChangeDateTime: vi.fn(),
    onChangeSlot: vi.fn(),
    onCancelReservation: vi.fn(),
    onOpenCustomers: vi.fn(),
    onStartBooking: vi.fn(),
    ...overrides,
  }
  render(<ReservationSearch {...props} />)
  return props
}

/** 選んだ 1 件が右に出ている面。 */
function showChosen(overrides: Overrides = {}) {
  return show({
    selectedId: 'r1',
    detail: DETAIL,
    staffName: '佐藤 美咲',
    equipmentNames: ['視力測定機 A', '相談カウンター 1'],
    customerPhone: '09012345678',
    ...overrides,
  })
}

/** 0 件の面（EX-EMPTY-SEARCH）。 */
function showEmpty(overrides: Overrides = {}) {
  return show({
    conditions: EMPTY_CONDITIONS,
    items: [],
    total: 0,
    relaxations: RELAXATIONS,
    ...overrides,
  })
}

describe('探す', () => {
  it('お名前・お電話番号・予約番号の 3 つの欄がある', () => {
    show()
    expect(screen.getByLabelText('お名前')).toBeInTheDocument()
    expect(screen.getByLabelText('お電話番号')).toBeInTheDocument()
    expect(screen.getByLabelText('予約番号')).toBeInTheDocument()
  })

  it('絞り込みは これから／今日／取消済み の 3 つで、押すと選択が入れ替わる', async () => {
    const props = show()
    const group = screen.getByRole('group', { name: '絞り込み' })
    for (const label of ['これから', '今日', '取消済み']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'これから' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '今日' })).toHaveAttribute('aria-pressed', 'false')
    expect(group).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '今日' }))
    expect(props.onConditions).toHaveBeenCalledWith({ ...BLANK, period: 'today' })
  })
})

describe('結果', () => {
  it('件数を「結果 4件」と出す', () => {
    show()
    expect(screen.getByText('結果 4件')).toBeInTheDocument()
  })

  it('1 行目に 8/27（木）11:00・田中 花子 様・4回目・メガネを新しく作る／佐藤 美咲 が並ぶ', () => {
    show()
    const rows = screen.getAllByRole('button', { name: /様/ })
    expect(rows[0]).toHaveAccessibleName(
      '8/27（木）11:00　田中 花子 様　4回目　メガネを新しく作る／佐藤 美咲',
    )
  })

  it('担当が決まっていない行は「担当が未定」と描く', () => {
    show()
    expect(
      screen.getByRole('button', {
        name: '9/3（木）10:30　田中 花子 様　4回目　受け取り／担当が未定',
      }),
    ).toBeInTheDocument()
  })
})

describe('詳細', () => {
  it('1 件を押しても一覧は左に残る', async () => {
    const props = showChosen()
    expect(screen.getAllByRole('button', { name: /様/ })).toHaveLength(4)
    await userEvent.click(screen.getAllByRole('button', { name: /様/ })[1] as HTMLElement)
    expect(props.onSelect).toHaveBeenCalledWith('r2')
    expect(screen.getAllByRole('button', { name: /様/ })).toHaveLength(4)
  })

  it('予約番号・出どころの札・日時・所要・ご用件・お客様・担当と場所を読める', () => {
    showChosen()
    const pane = within(screen.getByRole('region', { name: 'ご予約の中身' }))
    expect(pane.getByText('EY-2608-0142')).toBeInTheDocument()
    expect(pane.getByText('お電話でのご予約')).toBeInTheDocument()
    expect(pane.getByText('8月27日（木）11:00–12:00')).toBeInTheDocument()
    expect(pane.getByText('所要 60分')).toBeInTheDocument()
    expect(pane.getByText('メガネを新しく作る')).toBeInTheDocument()
    expect(pane.getByText(/田中 花子 様/)).toBeInTheDocument()
    expect(pane.getByText('／090-1234-5678')).toBeInTheDocument()
    expect(pane.getByText('佐藤 美咲')).toBeInTheDocument()
    expect(pane.getByText('／視力測定機 A・相談カウンター 1')).toBeInTheDocument()
  })

  it('「変更の内容は、お客様にお伝えしてから確定します。」が出る', () => {
    showChosen()
    expect(screen.getByText('変更の内容は、お客様にお伝えしてから確定します。')).toBeInTheDocument()
  })

  it('出口は 日時を変える／担当・場所を変える／取り消す の 3 つ', async () => {
    const props = showChosen()
    await userEvent.click(screen.getByRole('button', { name: '日時を変える' }))
    await userEvent.click(screen.getByRole('button', { name: '担当・場所を変える' }))
    await userEvent.click(screen.getByRole('button', { name: '取り消す' }))
    expect(props.onChangeDateTime).toHaveBeenCalledTimes(1)
    expect(props.onChangeSlot).toHaveBeenCalledTimes(1)
    expect(props.onCancelReservation).toHaveBeenCalledTimes(1)
  })
})

describe('0 件', () => {
  it('「結果 0件」が role="status" で読み上げに届く', () => {
    showEmpty()
    const zero = screen.getByText('結果 0件')
    expect(zero).toHaveAttribute('role', 'status')
  })

  it('「入力した条件はそのまま残しています。」が出て、入れた条件が欄に残る', () => {
    showEmpty()
    expect(screen.getByText('入力した条件はそのまま残しています。')).toBeInTheDocument()
    expect(screen.getByLabelText('お名前')).toHaveValue('たなか はなこ')
    expect(screen.getByRole('button', { name: '8/27〜8/31' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Web予約だけ' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('右に「この条件では、ご予約が見つかりませんでした」が出る', () => {
    showEmpty()
    expect(
      screen.getByRole('heading', { name: 'この条件では、ご予約が見つかりませんでした' }),
    ).toBeInTheDocument()
    expect(screen.getByText('条件をひとつ外すと見つかります')).toBeInTheDocument()
  })

  it('緩和の案は「5件　「Web予約だけ」を外す」のように件数を含む名前の押せる操作になる', async () => {
    const props = showEmpty()
    const button = screen.getByRole('button', { name: '5件　「Web予約だけ」を外す' })
    await userEvent.click(button)
    expect(props.onRelax).toHaveBeenCalledWith(RELAXATIONS[1])
  })

  it('「ほかの探し方」は お電話番号で探す／予約番号で探す の 2 行', () => {
    showEmpty()
    expect(screen.getByText('ほかの探し方')).toBeInTheDocument()
    const others = screen.getAllByRole('button', { name: /で探す/ })
    expect(others.map((row) => row.textContent)).toEqual([
      'お電話番号で探す下4桁だけでも探せます›',
      '予約番号で探す控えの EY- から始まる番号›',
    ])
    expect(
      screen.queryByRole('button', { name: /丸の内店・新宿店のご予約も含める/ }),
    ).not.toBeInTheDocument()
  })

  it('「顧客台帳で調べる」を押すと入れたお名前を引き継ぐ', async () => {
    const props = showEmpty()
    await userEvent.click(screen.getByRole('button', { name: '顧客台帳で調べる' }))
    expect(props.onOpenCustomers).toHaveBeenCalledWith('たなか はなこ')
  })
})

describe('読み込み中・読めないとき', () => {
  it('行の高さ 62px を保った灰色の帯をモックと同じ 4 本置く', () => {
    show({ items: [], total: 0, phase: 'loading' })
    const status = screen.getByRole('status', { name: 'ご予約を探しています…' })
    expect(status.querySelectorAll('li')).toHaveLength(4)
    for (const bar of status.querySelectorAll('li')) {
      expect(bar).toHaveClass('min-h-15.5')
    }
  })

  it('読み込めなかったときは、その事実とやり直す手を出す', async () => {
    const onRetry = vi.fn()
    show({ items: [], total: 0, phase: 'error', onRetry })
    expect(screen.getByRole('alert')).toHaveTextContent('ご予約を読み込めませんでした。')
    await userEvent.click(screen.getByRole('button', { name: 'もう一度探す' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('この画面を見られないときは、その事実だけを出す', () => {
    show({ items: [], total: 0, phase: 'forbidden' })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'この画面はご覧になれません。店長にお尋ねください。',
    )
  })
})

describe('触れる大きさ', () => {
  it('絞り込みの札と結果の行が 44px 以上ある', () => {
    show()
    expect(screen.getByRole('button', { name: '今日' })).toHaveClass('min-h-11')
    for (const row of screen.getAllByRole('button', { name: /様/ })) {
      expect(row).toHaveClass('min-h-15.5')
    }
  })
})
