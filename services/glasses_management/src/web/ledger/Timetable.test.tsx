import type { LedgerEntry, LedgerView } from '@app/contracts'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { at, closedView, resourceView, staffView } from './fixtures'
import { Timetable } from './Timetable'

/*
 * 予約台帳のタイムテーブル（承認済みモック docs/frontend/mockups/eye/images/LEDGER-STAFF.png
 * と LEDGER-RESOURCE.png）。
 *
 * 実測（LEDGER-STAFF.html の <style> と assets/eye.css）:
 *   .tt-grid   = 170px + 14 列 1fr。行は 34px / 1fr ×4 / 88px
 *   .tt-head   = min-height 34px / padding 0 8px / 地 --surface-2
 *   .tt-name   = min-height 64px / padding 6px 10px / 補足 11px
 *   .appt      = min-height 54px / 角 8px / padding 6px 8px / 左に 4px の色
 *   .nowline   = 幅 2px。左位置は 170px + (100% − 170px) × 0.1619
 *   最下段     = 88px。行見出しの地は --walkin-tint
 *
 * ここで見るのは「何が読めて、何が押せて、キーボードでどう動くか」。
 * 寸法そのものは e2e の突き合わせ（T-021）が見る。
 */

const SATO_BAND = '11:00から12:00　新調相談・視力測定　佐藤 美咲'
/* 帯の名前は「時刻　ご用件　行の名前」のうしろに、帯の中に見えている語が同じ順で続く
   （`aria-label` は中身の読み上げを覆い隠すので、ここに無い語は読み上げに出ない）。 */
const WATANABE_BAND = '11:00から11:30　視力測定　渡辺 由紀　ウォークイン'
const NAKAMURA_BAND = '10:30から11:30　視力測定　中村 彩　Web予約'
const UNASSIGNED_BAND = '11:02から12:02　新調相談　担当が未定　ウォークイン'

afterEach(() => vi.useRealTimers())

function bandOf(name: string): HTMLElement {
  return screen.getByRole('gridcell', { name })
}

describe('目盛り', () => {
  it('10:00 から 16:30 までの 30分刻みで 14 列ある', () => {
    render(<Timetable view={staffView()} />)
    const heads = screen.getAllByRole('columnheader').map((cell) => cell.textContent)
    expect(heads).toHaveLength(15)
    expect(heads[0]).toBe('担当者')
    expect(heads.slice(1)).toEqual([
      '10:00',
      '10:30',
      '11:00',
      '11:30',
      '12:00',
      '12:30',
      '13:00',
      '13:30',
      '14:00',
      '14:30',
      '15:00',
      '15:30',
      '16:00',
      '16:30',
    ])
  })

  it('営業時間が表示窓より長い日は、台帳の中だけが横スクロールになる', () => {
    const { rerender } = render(<Timetable view={staffView()} />)
    const scroller = screen.getByRole('grid').parentElement?.parentElement
    expect(scroller).toHaveClass('overflow-x-auto')
    // 表示窓と同じ 14 列の日は画面の幅ちょうど（1 列を 68px に丸めるとモックと 4px ずれる）。
    expect(screen.getByRole('grid').parentElement?.style.minWidth).toBe('100%')

    rerender(<Timetable view={staffView({ closesAt: '19:00' })} />)
    expect(screen.getAllByRole('columnheader')).toHaveLength(19)
    expect(screen.getByRole('grid').parentElement?.style.minWidth).toBe('calc(100% + 17rem)')
  })

  it('設備・場所別では左上の見出しが「設備・場所」になる', () => {
    render(<Timetable view={resourceView()} />)
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('設備・場所')
  })

  it('30分ごとは薄い線・1時間ごとは濃い線を交互に割り当てる', () => {
    // 出し分けが逆になっても本数は変わらないので、線の種類そのものを見る。
    const { container } = render(<Timetable view={staffView()} />)
    const lines = [...container.querySelectorAll('div[aria-hidden="true"] > div.border-l')]
    expect(lines).toHaveLength(14)
    expect(lines.map((line) => line.className.includes('border-grid-hour-line'))).toEqual(
      Array.from({ length: 14 }, (_, index) => index % 2 === 0),
    )
  })

  it('目盛りは格子の 1 枚うしろにある（帯の文字と焦点の輪を横切らない）', () => {
    // 位置指定した要素はあとに描かれる。格子の側も位置指定にしないと線が上に乗る。
    render(<Timetable view={staffView()} />)
    expect(screen.getByRole('grid').className).toContain('relative')
  })
})

describe('格子', () => {
  it('台帳は role=grid で、行見出しに担当名・列見出しに時刻を持つ', () => {
    render(<Timetable view={staffView()} />)
    const grid = screen.getByRole('grid', { name: '予約台帳' })
    expect(within(grid).getByRole('rowheader', { name: /佐藤 美咲/ })).toBeInTheDocument()
    expect(within(grid).getByRole('columnheader', { name: '11:00' })).toBeInTheDocument()
  })

  it('2 列にまたがる帯は先頭のセルにだけ置き、aria-colspan で幅を伝える', () => {
    render(<Timetable view={staffView()} />)
    const band = bandOf(SATO_BAND)
    expect(band).toHaveAttribute('aria-colspan', '2')
    // 1 列目は行見出し。10:00 が 2 列目なので 11:00 は 4 列目になる。
    expect(band).toHaveAttribute('aria-colindex', '4')
  })

  it('同じ帯が 2 度読まれない', () => {
    render(<Timetable view={staffView()} />)
    expect(screen.getAllByRole('gridcell', { name: SATO_BAND })).toHaveLength(1)
  })

  it('空のセルは「10:30　佐藤 美咲　空いています」と読める', () => {
    render(<Timetable view={staffView()} />)
    expect(bandOf('10:30　佐藤 美咲　空いています')).toBeInTheDocument()
  })

  it('矢印キーで隣の枠へ移れる', async () => {
    render(<Timetable view={staffView()} />)
    const first = bandOf('10:00　佐藤 美咲　空いています')
    first.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(bandOf('10:30　佐藤 美咲　空いています')).toHaveFocus()
    await userEvent.keyboard('{ArrowDown}')
    expect(bandOf('10:30　高橋 健　空いています')).toHaveFocus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(bandOf('10:00から10:30　調整　高橋 健')).toHaveFocus()
  })

  it('Tab 1 回で台帳を通り抜ける（14 列ぶんの移動を要さない）', () => {
    render(<Timetable view={staffView()} />)
    const grid = screen.getByRole('grid')
    expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
  })

  it('行の多い並べ方から少ない並べ方へ戻しても、Tab で台帳へ入れる', async () => {
    // 設備・場所は 5 行、担当者は 6 行。最下行まで降りてから戻すと、丸めないかぎり
    // どの枠にも tabIndex=0 が当たらず、台帳の中へ二度と入れなくなる。
    const { rerender, container } = render(<Timetable view={staffView()} />)
    container.querySelector<HTMLElement>('[data-ledger-cell][tabindex="0"]')?.focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')

    rerender(<Timetable view={resourceView()} />)
    expect(screen.getByRole('grid').querySelectorAll('[tabindex="0"]')).toHaveLength(1)
  })
})

describe('帯', () => {
  it('帯は「11:00から12:00　新調相談・視力測定　佐藤 美咲」のひと続きの名前で読める', () => {
    render(<Timetable view={staffView()} />)
    expect(bandOf(SATO_BAND)).toBeInTheDocument()
  })

  it('60分の帯にはご用件の短い名前が出る', () => {
    render(<Timetable view={staffView()} />)
    expect(within(bandOf(SATO_BAND)).getByText('新調相談・視力測定')).toBeInTheDocument()
  })

  it('30分の帯にはご用件を入れない', () => {
    render(<Timetable view={staffView()} />)
    expect(within(bandOf(WATANABE_BAND)).queryByText('視力測定')).not.toBeInTheDocument()
  })

  it('Web予約の帯には「Web予約」の文字が出る', () => {
    render(<Timetable view={staffView()} />)
    const band = bandOf(NAKAMURA_BAND)
    expect(within(band).getByText('Web予約')).toBeInTheDocument()
  })

  it('ウォークインの帯には「ウォークイン」の文字が出る', () => {
    render(<Timetable view={staffView()} />)
    expect(within(bandOf(WATANABE_BAND)).getByText('ウォークイン')).toBeInTheDocument()
  })

  it('お電話と店頭の帯には出どころの語を出さない', () => {
    render(<Timetable view={staffView()} />)
    expect(within(bandOf(SATO_BAND)).queryByText('お電話')).not.toBeInTheDocument()
    const counter = bandOf('15:00から16:00　新調相談　中村 彩')
    expect(within(counter).queryByText('店頭')).not.toBeInTheDocument()
  })

  it('担当が未定の帯には「担当が未定」と文字で書く', () => {
    render(<Timetable view={staffView()} />)
    const band = bandOf(UNASSIGNED_BAND)
    expect(within(band).getByText('担当が未定')).toBeInTheDocument()
  })

  it('担当が未定は amber で、取り消しの赤を使わない', () => {
    /*
     * `packages/ui/src/theme.css:83` は danger を「取消・警告・現在時刻の線・
     * 破壊的操作」と定めている。担当未定は失敗ではなく「これから決めること」なので
     * そこへは入らない。赤い帯を見た店員は取り消されたご予約と読む
     * （UX 監査 UI-12 / J-03。承認済みモック LEDGER-STAFF.png のほうが定義に反している）。
     */
    render(<Timetable view={staffView()} />)
    const painted = bandOf(UNASSIGNED_BAND).querySelector('[class*="border-l-4"]')
    expect(painted?.className).toContain('bg-amber-soft')
    expect(painted?.className).toContain('border-amber')
    expect(painted?.className).not.toContain('danger')
    expect(within(bandOf(UNASSIGNED_BAND)).getByText('担当が未定').className).toContain(
      'text-amber',
    )
  })

  it('読み上げの名前にも出どころと「担当が未定」が入る（色に意味を持たせないため）', () => {
    // `aria-label` は帯の中の要素をまるごと覆い隠すので、名前に入れないかぎり
    // 「Web予約」「ウォークイン」「担当が未定」は目で見る人にしか届かない。
    render(<Timetable view={staffView()} />)
    expect(bandOf(NAKAMURA_BAND)).toBeInTheDocument()
    expect(bandOf(WATANABE_BAND)).toBeInTheDocument()
    // 「担当が未定」の行では行の名前がすでにその語なので重ねない。
    expect(bandOf(UNASSIGNED_BAND)).toBeInTheDocument()
  })

  it('狭い帯でも語を切らない（和文をどこでも折り返せるままにする）', () => {
    // `break-keep` を掛けると 30分 1 列の 48px で「ウォークイ」「担当が未」と切れる。
    render(<Timetable view={staffView()} />)
    expect(within(bandOf(WATANABE_BAND)).getByText('ウォークイン').className).not.toContain(
      'break-keep',
    )
    expect(bandOf(WATANABE_BAND).querySelector('span')?.className).not.toContain('break-keep')
  })
})

describe('行', () => {
  it('「担当が未定」の行は担当の行の下にある', () => {
    render(<Timetable view={staffView()} />)
    const names = screen.getAllByRole('rowheader').map((cell) => cell.textContent)
    expect(names.slice(0, 4)).toEqual([
      '佐藤 美咲視力測定・加工',
      '高橋 健フィッティング',
      '中村 彩販売・受付',
      '渡辺 由紀販売・受付',
    ])
    expect(names[4]).toContain('担当が未定')
  })

  it('「ご来店お待ち」の行は最下段にあり、行見出しに待ち人数が出る', () => {
    render(<Timetable view={staffView()} />)
    const names = screen.getAllByRole('rowheader')
    expect(names[names.length - 1]).toHaveTextContent('ご来店お待ち')
  })

  it('「ご来店お待ち」の行は 1 つのセルで、aria-colspan が列数と同じ', () => {
    render(<Timetable view={staffView()} />)
    const cell = screen.getByRole('gridcell', { name: /お待ちのお客様/ })
    expect(cell).toHaveAttribute('aria-colspan', '14')
  })

  it('walk_ins がまだ無いので待ち人数は 0名 と出る', () => {
    render(<Timetable view={staffView()} />)
    const names = screen.getAllByRole('rowheader')
    expect(names[names.length - 1]).toHaveTextContent('0名')
  })
})

describe('設備別', () => {
  it('並べ方が「設備・場所」のとき縦軸が設備の行に入れ替わる', () => {
    render(<Timetable view={resourceView()} />)
    const names = screen.getAllByRole('rowheader').map((cell) => cell.textContent)
    expect(names).toEqual([
      '視力測定機 A視力測定',
      '視力測定機 B視力測定',
      '検査室 1精密検査',
      '相談カウンター 1接客・ご相談',
      '相談カウンター 2接客・ご相談',
    ])
  })

  it('同じ予約の帯が 2 行に出て、片方を押すともう片方にも同じ印が付く', async () => {
    render(<Timetable view={resourceView()} />)
    const bands = screen.getAllByRole('gridcell', {
      name: /11:00から12:00　新調相談・視力測定/,
    })
    expect(bands).toHaveLength(2)
    const [first] = bands
    if (first === undefined) throw new Error('設備別の帯が見つからない')
    expect(first).toHaveAttribute('aria-selected', 'false')

    await userEvent.click(first)
    for (const band of screen.getAllByRole('gridcell', {
      name: /11:00から12:00　新調相談・視力測定/,
    })) {
      expect(band).toHaveAttribute('aria-selected', 'true')
    }
  })

  it('点検の時間帯は「点検」の帯で埋まる', () => {
    render(<Timetable view={resourceView()} />)
    expect(bandOf('11:30から12:00　点検　視力測定機 B')).toBeInTheDocument()
  })

  it('予約の無い設備の行には「いま空いています」と出る', () => {
    render(<Timetable view={resourceView()} />)
    expect(screen.getByText('いま空いています')).toBeInTheDocument()
  })

  it('埋まった枠の地は `--color-busy-soft`（見出し行の地と別の値）にする', () => {
    render(<Timetable view={resourceView()} />)
    const block = bandOf('11:30から12:00　点検　視力測定機 B').querySelector('span')
    expect(block?.className).toContain('bg-busy-soft')
  })

  it('設備が 1 台も無い店舗は目盛りだけの格子を出さず、足す道を 1 つ出す', async () => {
    // IDX-LEDGER-02 の E1。担当者別は「担当が未定」と「ご来店お待ち」を必ず持つので、
    // 行が 0 本になるのは設備・場所だけである。
    const onOpenSettings = vi.fn()
    render(<Timetable view={resourceView({ lanes: [] })} onOpenSettings={onOpenSettings} />)
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(screen.getByText('設備・場所がまだありません')).toBeInTheDocument()
    expect(
      screen.getByText('設定の「設備と点検」で足すと、この盤面に行として並びます。'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '設定を開く' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('行き先を渡されない器では「設定を開く」を置かない（押せて何も起きない道を作らない）', () => {
    render(<Timetable view={resourceView({ lanes: [] })} />)
    expect(screen.getByText('設備・場所がまだありません')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '設定を開く' })).not.toBeInTheDocument()
  })

  it('予約の無い設備の行へ矢印で降りても、焦点を持てる枠が 1 つ残る', async () => {
    // 検査室 1（3 行目）は 1 枠しか描かない。列を 14 に割ったままだと
    // 2 列目より右から降りたとき、焦点を持てる枠が台帳から 1 つも無くなり、
    // Tab で台帳へ入り直せなくなる。
    const { container } = render(<Timetable view={resourceView()} />)
    const grid = screen.getByRole('grid')
    container.querySelector<HTMLElement>('[data-ledger-cell][tabindex="0"]')?.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowDown}{ArrowDown}')

    expect(grid.querySelectorAll('[tabindex="0"]')).toHaveLength(1)
    expect(screen.getByRole('gridcell', { name: '検査室 1　いま空いています' })).toHaveFocus()
  })
})

describe('現在時刻', () => {
  it('serverNow が 11:08 のとき、線は時間軸の左から 16.19% の位置に引かれる', () => {
    const { container } = render(<Timetable view={staffView()} />)
    const line = container.querySelector('[data-ledger-nowline]')
    expect(line).toHaveStyle({ left: '16.19%' })
  })

  it('表示中の日付が本日でないときは線を出さない', () => {
    const { container } = render(<Timetable view={staffView({ date: '2026-08-28' })} />)
    expect(container.querySelector('[data-ledger-nowline]')).toBeNull()
  })

  it('端末の時計を 1 時間進めても線の位置は動かない', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-27T03:08:00.000Z'))
    const { container } = render(<Timetable view={staffView()} />)
    expect(container.querySelector('[data-ledger-nowline]')).toHaveStyle({ left: '16.19%' })
  })

  it('線は aria-hidden で、読み上げに現れない', () => {
    const { container } = render(<Timetable view={staffView()} />)
    expect(container.querySelector('[data-ledger-nowline]')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('定休日', () => {
  it('目盛りだけの空の格子を出さず「9月1日（火）は定休日です。」を出す', () => {
    render(<Timetable view={closedView()} />)
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
    expect(screen.getByText('9月1日（火）は定休日です。')).toBeInTheDocument()
  })
})

describe('お名前と来店回数（AC-CUST-24）', () => {
  function customerLane(entries: LedgerEntry[]): LedgerView {
    return staffView({
      lanes: [
        {
          kind: 'staff',
          id: 'b0000000-0000-4000-8000-000000000099',
          name: '佐藤 美咲',
          subtitle: '視力測定・加工',
          entries,
          blocks: [],
        },
      ],
    })
  }

  it('60分（2 列）の帯はお名前フルネームと来店回数の印を出す', () => {
    render(
      <Timetable
        view={customerLane([
          {
            reservationId: 'a0000000-0000-4000-8000-000000000101',
            startsAt: at('11:00'),
            endsAt: at('12:00'),
            customerName: '田中 花子',
            visitCount: 4,
            purposeLabel: '新調相談・視力測定',
            source: 'phone',
            status: 'confirmed',
            isUnassigned: false,
          },
        ])}
      />,
    )
    const band = bandOf('11:00から12:00　田中 花子 様　4回目　新調相談・視力測定　佐藤 美咲')
    expect(within(band).getByText('田中 花子 様')).toBeVisible()
    expect(within(band).getByText('4回目')).toBeVisible()
  })

  it('30分（1 列）の帯は印を出さず、姓だけに落として「松本 様」と出す', () => {
    render(
      <Timetable
        view={customerLane([
          {
            reservationId: 'a0000000-0000-4000-8000-000000000102',
            startsAt: at('14:00'),
            endsAt: at('14:30'),
            customerName: '松本 一郎',
            visitCount: 3,
            purposeLabel: '受け取り',
            source: 'phone',
            status: 'confirmed',
            isUnassigned: false,
          },
        ])}
      />,
    )
    // 読み上げ名はフルネームのまま省略しない（画面表示の文字数で読み上げを削らない）。
    const band = bandOf('14:00から14:30　松本 一郎 様　3回目　受け取り　佐藤 美咲')
    expect(within(band).getByText('松本 様')).toBeVisible()
    expect(within(band).queryByText('松本 一郎 様')).not.toBeInTheDocument()
    expect(within(band).queryByText('3回目')).not.toBeInTheDocument()
  })

  it('来店が 0 件のお客様の印は「初めて」', () => {
    render(
      <Timetable
        view={customerLane([
          {
            reservationId: 'a0000000-0000-4000-8000-000000000103',
            startsAt: at('11:00'),
            endsAt: at('12:00'),
            customerName: '山口 真央',
            visitCount: 0,
            purposeLabel: '視力測定',
            source: 'web',
            status: 'confirmed',
            isUnassigned: false,
          },
        ])}
      />,
    )
    const band = bandOf('11:00から12:00　山口 真央 様　初めて　視力測定　佐藤 美咲　Web予約')
    expect(within(band).getByText('初めて')).toBeVisible()
  })

  it('お客様の付いていない帯（ウォークインの受付前など）はお名前も印も出さない', () => {
    render(<Timetable view={staffView()} />)
    // 既定の作り置きは P2 のまま customerName が null（このテストで壊れていないことの確認）。
    const band = bandOf('11:00から12:00　新調相談・視力測定　佐藤 美咲')
    expect(within(band).queryByText('様')).not.toBeInTheDocument()
  })
})

/*
 * 帯の中の序列は「お名前 → 回数 → ご用件」。
 *
 * 以前は等幅太字の時刻がいちばん強く、お名前はその下に沈んでいた（5 行とも 13px で、
 * 差は太さ 3 段だけ）。盤は x 位置が既に時刻を表しているので、帯の中の時刻は
 * 同じ情報を 2 度描いたうえに、いちばん知りたいお名前より強く刷っていたことになる。
 * 承認済みモック `LEDGER-STAFF.png` は帯に時刻を書かず、お名前を最大要素に置いている。
 * UX 監査 UI-01 / LEDGER-05。
 */
describe('帯の中の序列', () => {
  function customerLane(entries: LedgerEntry[]): LedgerView {
    return staffView({
      lanes: [
        {
          kind: 'staff',
          id: 'b0000000-0000-4000-8000-000000000099',
          name: '佐藤 美咲',
          subtitle: '視力測定・加工',
          entries,
          blocks: [],
        },
      ],
    })
  }

  const NAMED = {
    reservationId: 'a0000000-0000-4000-8000-000000000201',
    startsAt: at('11:00'),
    endsAt: at('12:00'),
    customerName: '田中 花子',
    visitCount: 4,
    purposeLabel: '新調相談・視力測定',
    source: 'phone' as const,
    status: 'confirmed' as const,
    isUnassigned: false,
  }
  const SHORT = {
    ...NAMED,
    reservationId: 'a0000000-0000-4000-8000-000000000202',
    startsAt: at('14:00'),
    endsAt: at('14:30'),
    customerName: '松本 一郎',
    visitCount: 3,
    purposeLabel: '受け取り',
  }

  it('60分の帯は、お名前がいちばん大きく最初に来る', () => {
    render(<Timetable view={customerLane([NAMED])} />)
    const band = bandOf('11:00から12:00　田中 花子 様　4回目　新調相談・視力測定　佐藤 美咲')
    const name = within(band).getByText('田中 花子 様')
    // お名前だけが 1 段大きい（他は 13px の text-grid）。
    expect(name.className).toContain('text-lead')
    // 帯の中でいちばん先に現れる文字がお名前である（葉のノードだけを見る）。
    const texts = Array.from(band.querySelectorAll('span'))
      .filter((node) => node.children.length === 0)
      .map((node) => node.textContent?.trim() ?? '')
      .filter((t) => t !== '')
    expect(texts[0]).toBe('田中 花子 様')
  })

  it('帯の中に時刻を書かない（x の位置が既に時刻を表している）', () => {
    render(<Timetable view={customerLane([NAMED])} />)
    const band = bandOf('11:00から12:00　田中 花子 様　4回目　新調相談・視力測定　佐藤 美咲')
    // 読み上げの名前（aria-label）は覆い隠すので、見えている文字だけを調べる。
    expect(band.querySelector('span')?.parentElement?.textContent).not.toMatch(/\d{1,2}:\d{2}/)
  })

  it('30分の帯にも、時刻ではなくお名前を出す', () => {
    render(<Timetable view={customerLane([SHORT])} />)
    expect(screen.getByText('松本 様').className).toContain('text-lead')
    // 帯の中に時刻の文字は出さない。
    expect(screen.queryByText('14:00', { selector: 'span' })).toBeNull()
  })

  it('30分の帯のお名前は切り落とさず折り返す（「松…」で誰か分からなくしない）', () => {
    render(<Timetable view={customerLane([SHORT])} />)
    expect(screen.getByText('松本 様').className).not.toContain('truncate')
  })

  it('読み上げの名前には時刻が残る（画面から消しても、耳では時刻が要る）', () => {
    render(<Timetable view={customerLane([NAMED])} />)
    expect(
      bandOf('11:00から12:00　田中 花子 様　4回目　新調相談・視力測定　佐藤 美咲'),
    ).toBeInTheDocument()
  })
})
