import type { VisitBoardCell, VisitBoardRow, VisitBoard as VisitBoardShape } from '@app/contracts'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { VisitBoard } from './VisitBoard'

/*
 * 来店受付ボード（承認済みモック docs/frontend/mockups/eye/images/RECEPTION-JOURNEY.png
 * と screens/RECEPTION-JOURNEY.html）。
 *
 * 実測（RECEPTION-JOURNEY.html の <style> と assets/eye.css）:
 *   .board  = padding 28px 36px
 *   .jgrid  = 220px + 6 列 1fr / 行 40px + 4 × 1fr / 枠 1px --line / 角 16px
 *   .jhead  = padding 0 14px・13px/600・下罫 1px --line-strong
 *   .jname  = padding 0 16px・名前 16px・ご用件 13px・右罫 1px --line-strong
 *   .jc     = padding 0 14px・状態 13px・値 15px/600
 *   .jc.doing = 左に 4px の緑／.jc.next = 地 --brand-tint／.jc.warn = 地 --alert-tint
 *   .toolbar = 56px（segmented ＋ 主操作 ＋ 右に日付と人数）
 *
 * ここで見るのは「何が読めて、何が押せて、キーボードでどう動くか」。
 * 寸法そのものは e2e の突き合わせ（T-021）が見る。
 */

/** 既定の normalizer は全角の空白（U+3000）を半角へ畳むので、文字どおり探すときに使う。 */
const asWritten = { normalizer: (text: string) => text.trim() }

const DATE = '2026-08-27'
/** 11:08 JST。モックの右上の時刻。 */
const SERVER_NOW = '2026-08-27T02:08:00.000Z'

/** JST の壁時計から ISO8601 を作る（テストの中で端末の時計を読まない）。 */
function at(clock: string): string {
  const [hours = '0', minutes = '0'] = clock.split(':')
  const utc = Number(hours) * 60 + Number(minutes) - 9 * 60
  const stamp = new Date(Date.parse(`${DATE}T00:00:00.000Z`) + utc * 60_000)
  return stamp.toISOString()
}

function cell(stage: VisitBoardCell['stage'], over: Partial<VisitBoardCell> = {}): VisitBoardCell {
  return {
    stage,
    state: 'empty',
    at: null,
    label: '',
    note: null,
    needsAttention: false,
    ...over,
  }
}

const HANAKO: VisitBoardRow = {
  subjectType: 'reservation',
  subjectId: 'b0000000-0000-4000-8000-000000000001',
  displayName: '田中 花子 様',
  visitCount: 4,
  purposeLabel: 'メガネを新しく作る',
  isWaitingTooLong: false,
  cells: [
    cell('received', { state: 'done', at: at('10:55') }),
    cell('consulting', { state: 'done', at: at('11:02') }),
    cell('fitting', { state: 'doing', at: at('11:02') }),
    cell('measuring', { state: 'next', label: '視力測定機 A' }),
    cell('checkout'),
    cell('handover'),
  ],
}

const WALKIN: VisitBoardRow = {
  subjectType: 'walkin',
  subjectId: 'b0000000-0000-4000-8000-000000000002',
  displayName: 'ウォークイン 003',
  visitCount: null,
  purposeLabel: 'フレームのご相談',
  isWaitingTooLong: true,
  cells: [
    cell('received', { state: 'done', at: at('10:50') }),
    cell('consulting', { state: 'waiting', label: '18分' }),
    cell('fitting'),
    cell('measuring'),
    cell('checkout'),
    cell('handover'),
  ],
}

const MAO: VisitBoardRow = {
  subjectType: 'reservation',
  subjectId: 'b0000000-0000-4000-8000-000000000003',
  displayName: '山口 真央 様',
  visitCount: 0,
  purposeLabel: '視力測定だけ',
  isWaitingTooLong: false,
  cells: [
    cell('received', { state: 'done', at: at('10:58') }),
    cell('consulting', { state: 'doing', at: at('11:02') }),
    cell('fitting'),
    cell('measuring', { state: 'next', label: '視力測定機 B' }),
    cell('checkout'),
    cell('handover'),
  ],
}

const KEN: VisitBoardRow = {
  subjectType: 'reservation',
  subjectId: 'b0000000-0000-4000-8000-000000000004',
  displayName: '伊藤 健 様',
  visitCount: 2,
  purposeLabel: '今のメガネを調整',
  isWaitingTooLong: false,
  cells: [
    cell('received', { state: 'done', at: at('10:42') }),
    cell('consulting', { state: 'done', at: at('10:52') }),
    cell('fitting'),
    cell('measuring'),
    cell('checkout', { state: 'done', at: at('11:01') }),
    cell('handover', { state: 'doing', at: at('11:04') }),
  ],
}

function board(over: Partial<VisitBoardShape> = {}): VisitBoardShape {
  return {
    date: DATE,
    activeCount: 4,
    rows: [HANAKO, WALKIN, MAO, KEN],
    serverNow: SERVER_NOW,
    ...over,
  }
}

function show(over: Partial<Parameters<typeof VisitBoard>[0]> = {}) {
  const props = {
    board: board(),
    scope: 'active' as const,
    onScopeChange: vi.fn(),
    onAdvance: vi.fn(),
    ...over,
  }
  render(<VisitBoard {...props} />)
  return props
}

describe('来店受付ボード', () => {
  it('列が お客様／受付／ご相談／フレーム選び／視力測定／レンズ・お会計／お渡し の順に並ぶ', () => {
    show()
    expect(screen.getAllByRole('columnheader').map((head) => head.textContent)).toEqual([
      'お客様',
      '受付',
      'ご相談',
      'フレーム選び',
      '視力測定',
      'レンズ・お会計',
      'お渡し',
    ])
  })

  it('右上に「2026年8月27日（木）　ご来店中 4名」が出る', () => {
    show()
    expect(screen.getByText('2026年8月27日（木）　ご来店中 4名', asWritten)).toBeInTheDocument()
  })

  it('何も起きていない欄は空のまま（文字を足さない）', () => {
    show()
    const empty = screen.getByRole('gridcell', { name: '田中 花子 様　お渡し' })
    expect(empty.textContent).toBe('')
  })

  it('お待たせ中の行は赤地と「お待たせ中　18分」の両方で分かる', () => {
    show()
    const waiting = screen.getByRole('gridcell', {
      name: 'ウォークイン 003　ご相談　お待たせ中　18分',
    })
    expect(waiting).toHaveTextContent('お待たせ中')
    expect(waiting).toHaveTextContent('18分')
    expect(waiting.className).toContain('bg-danger-soft')
    // 行そのもの（お客様欄）も赤地にする。列を 1 つだけ見て見落とさないため。
    expect(
      screen.getByRole('rowheader', { name: 'ウォークイン 003　フレームのご相談' }).className,
    ).toContain('bg-danger-soft')
  })

  it('ウォークインの行は来店回数の札を持たない', () => {
    show()
    const walkin = screen.getByRole('rowheader', { name: 'ウォークイン 003　フレームのご相談' })
    expect(within(walkin).queryByText(/回目|初めて/)).toBeNull()
    const hanako = screen.getByRole('rowheader', {
      name: '田中 花子 様　4回目　メガネを新しく作る',
    })
    expect(within(hanako).getByText('4回目')).toBeInTheDocument()
  })

  it('表として「来店受付ボード　お客様ごとの工程」の名前を持つ', () => {
    show()
    expect(
      screen.getByRole('grid', { name: '来店受付ボード　お客様ごとの工程' }),
    ).toBeInTheDocument()
  })

  it('どの欄も お客様の名前と工程の名前の両方と一緒に読まれる', () => {
    show()
    for (const name of screen.getAllByRole('gridcell').map((c) => c.getAttribute('aria-label'))) {
      expect(name).toBeTruthy()
      const [subject, stage] = String(name).split('　')
      expect(['田中 花子 様', 'ウォークイン 003', '山口 真央 様', '伊藤 健 様']).toContain(subject)
      expect(['受付', 'ご相談', 'フレーム選び', '視力測定', 'レンズ・お会計', 'お渡し']).toContain(
        stage,
      )
    }
  })

  it('Tab 1 回で盤面を通り抜け、中は矢印キーで移る', async () => {
    const user = userEvent.setup()
    show()
    const grid = screen.getByRole('grid')
    // 格子の中で Tab を受けるのはちょうど 1 つ（roving tabindex）。
    expect(grid.querySelectorAll('[data-board-cell][tabindex="0"]')).toHaveLength(1)

    const first = grid.querySelector<HTMLElement>('[data-board-cell][tabindex="0"]')
    first?.focus()
    expect(document.activeElement).toHaveAttribute(
      'aria-label',
      '田中 花子 様　4回目　メガネを新しく作る',
    )
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toHaveAttribute(
      'aria-label',
      '田中 花子 様　受付　済みました　10:55',
    )
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toHaveAttribute(
      'aria-label',
      'ウォークイン 003　受付　済みました　10:50',
    )
    expect(grid.querySelectorAll('[data-board-cell][tabindex="0"]')).toHaveLength(1)
  })

  it('キーボードだけで「次にやること」から工程を進められる', async () => {
    const user = userEvent.setup()
    const props = show()
    screen
      .getByRole('gridcell', { name: '田中 花子 様　視力測定　次にやること　視力測定機 A' })
      .focus()
    await user.keyboard('{Enter}')
    expect(props.onAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: HANAKO.subjectId }),
      expect.objectContaining({ stage: 'measuring' }),
    )
  })

  it('担当が勤務外の欄に「本日はお休みです。担当を決め直してください。」が出る', () => {
    const off = '本日はお休みです。担当を決め直してください。'
    const rows = [
      {
        ...HANAKO,
        cells: HANAKO.cells.map((c) =>
          c.stage === 'measuring' ? { ...c, note: off, needsAttention: true } : c,
        ),
      },
    ]
    show({ board: board({ rows, activeCount: 1 }) })
    expect(screen.getByText(off)).toBeInTheDocument()
  })

  it('設備が点検中の欄に「視力測定機 A は点検で止まっています。」が出る', () => {
    const down = '視力測定機 A は点検で止まっています。'
    const rows = [
      {
        ...HANAKO,
        cells: HANAKO.cells.map((c) =>
          c.stage === 'measuring' ? { ...c, note: down, needsAttention: true } : c,
        ),
      },
    ]
    show({ board: board({ rows, activeCount: 1 }) })
    // 設備名は label に残ったまま、注意は別の行として読める。
    expect(screen.getByText('視力測定機 A')).toBeInTheDocument()
    expect(screen.getByText(down)).toBeInTheDocument()
  })

  it('注意のある欄は色だけでなく文字でも見分けられる', () => {
    const down = '視力測定機 A は点検で止まっています。'
    const rows = [
      {
        ...HANAKO,
        cells: HANAKO.cells.map((c) =>
          c.stage === 'measuring' ? { ...c, note: down, needsAttention: true } : c,
        ),
      },
    ]
    show({ board: board({ rows, activeCount: 1 }) })
    const cellEl = screen.getByRole('gridcell', {
      name: `田中 花子 様　視力測定　次にやること　視力測定機 A　${down}`,
    })
    // 地の色（--color-amber-soft）だけでは伝わらないので、注意の文そのものを欄に出す。
    // 赤は「お待たせ中」だけ・緑は「次にやること」だけに取ってあるので、注意は琥珀を使う。
    expect(within(cellEl).getByText(down)).toBeInTheDocument()
    expect(cellEl.className).toContain('bg-amber-soft')
    expect(cellEl.className).not.toContain('bg-danger-soft')
  })

  it('「ご来店中」と「本日すべて」を切り替えられる', async () => {
    const user = userEvent.setup()
    const props = show()
    expect(screen.getByRole('button', { name: 'ご来店中' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: '本日すべて' }))
    expect(props.onScopeChange).toHaveBeenCalledWith('all')
  })

  it('ご来店中が 0 名のときは 見出し 1 行・理由 1 行・「＋ ご来店を受け付ける」だけが残る', () => {
    const onReceiveVisit = vi.fn()
    show({ board: board({ rows: [], activeCount: 0 }), onReceiveVisit })
    expect(screen.queryByRole('grid')).toBeNull()
    const empty = screen.getByRole('status')
    expect(within(empty).getByRole('heading').textContent).toBe('ご来店中のお客様はいません')
    expect(within(empty).getByText('まだどなたもお着きになっていません。')).toBeInTheDocument()
    expect(
      within(empty)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['＋ ご来店を受け付ける'])
    expect(onReceiveVisit).not.toHaveBeenCalled()
  })

  it('「ご来店がなかった」として残せる', async () => {
    const user = userEvent.setup()
    const onMarkNoShow = vi.fn()
    show({ onMarkNoShow })
    // 行を選ぶと、その行にできることが出る（盤面には常設しない）。
    await user.click(
      screen.getByRole('rowheader', { name: '田中 花子 様　4回目　メガネを新しく作る' }),
    )
    const actions = screen.getByRole('group', { name: '田中 花子 様 にできること' })
    await user.click(within(actions).getByRole('button', { name: 'ご来店がなかった' }))
    expect(onMarkNoShow).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: HANAKO.subjectId }),
    )
  })

  it('お客様を特定しないまま受け付けた行からだけ、あとで結びつけられる', async () => {
    const user = userEvent.setup()
    const onLinkCustomer = vi.fn()
    show({ onLinkCustomer })

    // お名前の分かっているご予約の行には結びつけの口を出さない（できることが 1 つも無い）。
    await user.click(
      screen.getByRole('rowheader', { name: '田中 花子 様　4回目　メガネを新しく作る' }),
    )
    expect(screen.queryByRole('group', { name: '田中 花子 様 にできること' })).toBeNull()

    await user.click(screen.getByRole('rowheader', { name: /^ウォークイン 003/ }))
    const actions = screen.getByRole('group', { name: 'ウォークイン 003 にできること' })
    await user.click(within(actions).getByRole('button', { name: 'お客様を結びつける' }))
    expect(onLinkCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ subjectId: WALKIN.subjectId }),
    )
  })
})
