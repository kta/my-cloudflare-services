import type {
  LedgerEntry,
  LedgerFilter,
  LedgerLane,
  LedgerView,
  ReservationSource,
  ReservationStatus,
} from '@app/contracts'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ReservationList } from './ReservationList'

/*
 * 予約リスト（承認済みモック docs/frontend/mockups/eyex/images/LEDGER-LIST.png）。
 *
 * この面の仕事は「同じ日を時間順に読み、次に何をすべきかを左端の 1 列だけで進める」こと。
 * 押せるのは左端の 1 列と絞り込みの札だけで、ほかは読むだけである。
 *
 * 実測値（screens/LEDGER-LIST.html と assets/eyex.css）:
 *   絞り込みの帯 = 高さ 60px・padding 0 32px・地 --surface-2、札 = min-height 44px・padding 0 16px・ピル。
 *   列幅 = 120px / 96px / 224px / 1fr / 140px・gap 16px。行 = min-height 62px・下罫 1px。
 *   時刻 18px 等幅 700、お名前 17px 700、ほか 15px。左端のボタン = min-height 46px・角 8px。
 *
 * この段階（P2）が描かないもの: お客様のお名前と来店回数（`customers` は 007）。
 * 件数は応答の `counts` をそのまま出し、画面で数え直さない。
 */

/** JST の壁時計 → UTC の ISO8601。台帳の応答は UTC で来る。 */
function jst(hhmm: string): string {
  return new Date(Date.parse(`2026-08-27T${hhmm}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()
}

/** JST 2026-08-27（木）11:08。現在時刻の出どころは必ず応答の `serverNow`。 */
const SERVER_NOW = jst('11:08')

function entryOf(
  id: string,
  from: string,
  to: string,
  purposeLabel: string,
  source: ReservationSource,
  status: ReservationStatus,
  isUnassigned = false,
): LedgerEntry {
  return {
    reservationId: id,
    startsAt: jst(from),
    endsAt: jst(to),
    // お名前と来店回数は 007-customer-records まで null のまま。
    customerName: null,
    visitCount: null,
    purposeLabel,
    source,
    status,
    isUnassigned,
  }
}

function laneOf(
  kind: LedgerLane['kind'],
  id: string | null,
  name: string,
  entries: LedgerEntry[],
): LedgerLane {
  return { kind, id, name, subtitle: '', entries, blocks: [] }
}

function viewOf(
  lanes: LedgerLane[],
  counts: LedgerView['counts'] = { all: 0, upcoming: 0, pendingReview: 0 },
): LedgerView {
  return {
    date: '2026-08-27',
    axis: 'staff',
    view: 'list',
    opensAt: '10:00',
    closesAt: '19:00',
    slotMinutes: 30,
    lanes,
    counts,
    serverNow: SERVER_NOW,
  }
}

/** 2026年8月27日（木）銀座店の 12 件（seed と同じ盤面）。 */
const DAY = viewOf(
  [
    laneOf('staff', 'st-sato', '佐藤 美咲', [
      entryOf('r03', '11:00', '12:00', '新調相談・視力測定', 'phone', 'confirmed'),
      entryOf('r08', '14:00', '14:20', '受け取り', 'phone', 'confirmed'),
      entryOf('r11', '17:00', '17:30', '調整', 'phone', 'confirmed'),
      entryOf('r12', '17:30', '18:00', '受け取り', 'phone', 'confirmed'),
    ]),
    laneOf('staff', 'st-takahashi', '高橋 健', [
      entryOf('r01', '10:00', '10:30', '調整', 'phone', 'arrived'),
      entryOf('r07', '13:00', '14:00', '調整', 'phone', 'confirmed'),
    ]),
    laneOf('staff', 'st-nakamura', '中村 彩', [
      entryOf('r02', '10:30', '11:30', '視力測定', 'web', 'arrived'),
      entryOf('r09', '15:00', '16:00', '新調相談', 'counter', 'confirmed'),
    ]),
    laneOf('staff', 'st-watanabe', '渡辺 由紀', [
      entryOf('r04', '11:00', '11:30', '視力測定', 'walkin', 'arrived'),
    ]),
    laneOf('unassigned', null, '担当が未定', [
      entryOf('r05', '11:02', '12:02', '新調相談', 'walkin', 'confirmed', true),
      entryOf('r06', '13:00', '13:20', '調整', 'web', 'confirmed', true),
      entryOf('r10', '15:30', '16:30', '視力測定', 'phone', 'confirmed', true),
    ]),
    laneOf('walkin', null, 'ご来店お待ち', []),
  ],
  { all: 12, upcoming: 7, pendingReview: 1 },
)

/** 絞り込みを持つ器。画面は絞り込みの状態を持たず、押されたことだけを外へ伝える。 */
function WithFilter({ view = DAY, isOffline = false }: { view?: LedgerView; isOffline?: boolean }) {
  const [filter, setFilter] = useState<LedgerFilter>('all')
  return (
    <ReservationList view={view} filter={filter} onFilterChange={setFilter} isOffline={isOffline} />
  )
}

function bodyRows(): HTMLElement[] {
  return within(screen.getByRole('table', { name: '本日のご予約' }))
    .getAllByRole('row')
    .slice(1)
}

describe('予約リスト', () => {
  it('列見出しは「受け付け」「時間」「お客様」「ご用件」「担当」の 5 つ', () => {
    render(<WithFilter />)
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      '受け付け',
      '時間',
      'お客様',
      'ご用件',
      '担当',
    ])
  })

  it('絞り込みの札は「すべて」「これから」「確認待ち」で、件数が添えられている', () => {
    render(<WithFilter />)
    const chips = within(
      screen.getByRole('group', { name: '表示する予約の絞り込み' }),
    ).getAllByRole('button')
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'すべて 12件',
      'これから 7件',
      '確認待ち 1件',
    ])
    // 選ばれていることを色だけで伝えない。
    expect(chips[0]).toHaveAttribute('aria-pressed', 'true')
    expect(chips[1]).toHaveAttribute('aria-pressed', 'false')
  })

  it('「これから」を押すと、現在時刻までに始まった行が消えて件数と一致する', async () => {
    render(<WithFilter />)
    // 11:08 までに始まった 5 件（10:00 / 10:30 / 11:00 の 2 件 / 11:02）が消える。
    await userEvent.click(screen.getByRole('button', { name: 'これから 7件' }))
    const rows = bodyRows()
    expect(rows).toHaveLength(7)
    expect(rows.map((row) => within(row).getAllByRole('cell')[1]?.textContent)).toEqual([
      '13:0060分',
      '13:0020分',
      '14:0020分',
      '15:0060分',
      '15:3060分',
      '17:0030分',
      '17:3030分',
    ])
    expect(screen.queryByText('このあと', { exact: false })).not.toBeInTheDocument()
  })

  it('「受け付け」の欄には お電話 / 店頭 / Web予約 / ウォークイン の 4 語がそのまま出る', () => {
    render(
      <WithFilter
        view={viewOf(
          [
            laneOf('staff', 'st-sato', '佐藤 美咲', [
              entryOf('r01', '13:00', '13:30', '調整', 'phone', 'confirmed'),
              entryOf('r02', '13:30', '14:00', '受け取り', 'counter', 'confirmed'),
              entryOf('r03', '14:00', '14:30', '視力測定', 'web', 'confirmed', true),
              entryOf('r04', '14:30', '15:00', '新調相談', 'walkin', 'confirmed'),
            ]),
          ],
          { all: 4, upcoming: 4, pendingReview: 1 },
        )}
      />,
    )
    expect(bodyRows().map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
      'ご来店お電話',
      'ご来店店頭',
      '内容を確認Web予約',
      'ご案内ウォークイン',
    ])
  })

  it('担当が未定の行は担当の欄が「決めてください」になる', () => {
    render(<WithFilter />)
    const rows = bodyRows()
    const staffCells = rows.map((row) => within(row).getAllByRole('cell')[4]?.textContent)
    // 11:02 のウォークインと 13:00 の Web予約が担当未定。
    expect(staffCells).toEqual([
      '高橋 健',
      '中村 彩',
      '佐藤 美咲',
      '渡辺 由紀',
      '決めてください',
      '高橋 健',
      '決めてください',
      '佐藤 美咲',
    ])
  })

  it('当てはまる行が 0 件の絞り込みは、見出し 1 行と理由 1 行と「すべてを見る」を出す', async () => {
    const emptyPending = viewOf(
      [
        laneOf('staff', 'st-sato', '佐藤 美咲', [
          entryOf('r01', '13:00', '13:30', '調整', 'phone', 'confirmed'),
        ]),
      ],
      { all: 1, upcoming: 1, pendingReview: 0 },
    )
    render(<WithFilter view={emptyPending} />)
    await userEvent.click(screen.getByRole('button', { name: '確認待ち 0件' }))

    expect(
      screen.getByRole('heading', { name: '「確認待ち」のご予約はありません。' }),
    ).toBeVisible()
    expect(
      screen.getByText('Webから入って、担当がまだ決まっていないご予約だけを出しています。'),
    ).toBeVisible()
    // 表を空のまま残さない。行き止まりにしない。
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'すべてを見る' }))
    expect(bodyRows()).toHaveLength(1)
  })

  it('絞り込みを押しても日付と並べ方は保たれる（絞り込みだけを外へ伝える）', async () => {
    const onFilterChange = vi.fn()
    render(<ReservationList view={DAY} filter="all" onFilterChange={onFilterChange} />)
    await userEvent.click(screen.getByRole('button', { name: '確認待ち 1件' }))
    expect(onFilterChange).toHaveBeenCalledTimes(1)
    expect(onFilterChange).toHaveBeenCalledWith('pending')
    // 画面は日付も並べ方も持たない（器が持つ）ので、押しても失われない。
    expect(bodyRows()).toHaveLength(8)
  })

  it('一覧の行は 8 つまでで、9 行目からは末尾の 1 行にまとめる', () => {
    render(<WithFilter />)
    const rows = bodyRows()
    expect(rows).toHaveLength(8)
    expect(rows.at(-1)?.textContent).toContain('14:00')
    expect(screen.getByText('このあと 15:00 ほか 4件。')).toBeVisible()
  })

  it('お客様のお名前と来店回数は描かない（顧客台帳は 007-customer-records）', () => {
    render(<WithFilter />)
    for (const row of bodyRows()) {
      const customer = within(row).getAllByRole('cell')[2]
      expect(customer?.textContent).toBe('—お名前はまだ出せません')
      expect(customer?.querySelector('.sr-only')?.textContent).toBe('お名前はまだ出せません')
    }
    expect(screen.queryByText('回目', { exact: false })).not.toBeInTheDocument()
  })

  it('左端の操作は状態で語が変わり、押せる高さが 44pt 以上ある', () => {
    render(<WithFilter />)
    const rows = bodyRows()
    // 受け付けが済んだ行は押せる操作を持たない（押し直す導線はモックに無い）。
    expect(within(rows[0] as HTMLElement).queryByRole('button')).not.toBeInTheDocument()
    expect(within(rows[0] as HTMLElement).getByText('受付済み')).toBeVisible()

    const action = within(rows[2] as HTMLElement).getByRole('button', { name: 'ご来店' })
    expect(action.className).toContain('min-h-11.5')
  })

  it('ご来店の無かった行は押せる操作を持たず「ご来店なし」と書く', () => {
    render(
      <WithFilter
        view={viewOf(
          [
            laneOf('staff', 'st-sato', '佐藤 美咲', [
              entryOf('r01', '10:00', '10:30', '調整', 'phone', 'no_show'),
            ]),
          ],
          { all: 1, upcoming: 0, pendingReview: 0 },
        )}
      />,
    )
    const row = bodyRows()[0] as HTMLElement
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
    expect(within(row).getByText('ご来店なし')).toBeVisible()
  })

  it('読み込み中・読み込めなかったとき・権限が無いときを持つ', () => {
    const { rerender } = render(
      <ReservationList view={null} filter="all" onFilterChange={() => {}} />,
    )
    expect(screen.getByRole('status').textContent).toBe('予約リストを読み込んでいます…')

    rerender(<ReservationList view={null} filter="all" onFilterChange={() => {}} phase="error" />)
    expect(screen.getByRole('alert').textContent).toBe(
      '予約リストを読み込めませんでした。画面を開き直してください。',
    )

    rerender(
      <ReservationList view={null} filter="all" onFilterChange={() => {}} phase="forbidden" />,
    )
    expect(screen.getByRole('alert').textContent).toBe(
      'このお店の予約台帳を見る権限がありません。お店の管理者にご確認ください。',
    )
  })

  it('ご予約が 1 件も無い日は、表を空のまま残さず事実を 1 行で出す', () => {
    render(<WithFilter view={viewOf([laneOf('staff', 'st-sato', '佐藤 美咲', [])])} />)
    expect(screen.getByRole('heading', { name: '本日のご予約はまだありません。' })).toBeVisible()
    // 「すべて」を出しているので「すべてを見る」は置かない（行き止まりの操作を作らない）。
    expect(screen.queryByRole('button', { name: 'すべてを見る' })).not.toBeInTheDocument()
  })
})
