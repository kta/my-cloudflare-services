import type {
  AvailabilityLane,
  AvailabilityReason,
  AvailabilityResponse,
  AvailabilitySlot,
  LedgerAxis,
} from '@app/contracts'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { type SlotChoice, SlotStep, type SlotStepProps } from './SlotStep'
import { nextButtonLabel, type StepGuard } from './steps'

/*
 * 工程 3「担当と場所」（承認済みモック docs/frontend/mockups/eyex/images/BOOK-03-SLOT-STAFF.png /
 * BOOK-03b-SLOT-RESOURCE.png / BOOK-03c-DRAG.png）。
 *
 * 実測（screens/BOOK-03*.html の <style> と assets/eyex.css）:
 *   .split  = 1fr / 330px（相談欄）。.side = padding 28px 24px・左に 1px の罫
 *   .tt-grid = 名前列 170px ＋ 30分刻み 1fr。.tt-head 34px / .tt-name 64px / .tt-cell 64px
 *   .appt   = min-height 54px・角 8px。.clash は 3px の --alert 罫、.placing は 3px の --brand 罫
 *   .cand button = min-height 56px・角 12px・16px/600、補足 12〜13px、間 10px
 *   .nowat  = 角 999px・padding 6px 16px・時刻 22px/700 ＋ 所要 13px/600
 *   .appt.origin = opacity .35。.ghost = 2px 破線 ＋ 下端から 9px の「13:00–14:00 へ」
 *
 * ここで見るのは「何が読めて、何が押せるか」。寸法そのものは e2e の突き合わせが見る。
 */

const DATE = '2026-08-27'
const SATO = 'b0000000-0000-4000-8000-000000000001'
const KOBAYASHI = 'b0000000-0000-4000-8000-000000000002'
const NAKAMURA = 'b0000000-0000-4000-8000-000000000003'
const TAKAHASHI = 'b0000000-0000-4000-8000-000000000004'
const METER_A = 'c0000000-0000-4000-8000-000000000001'
const METER_B = 'c0000000-0000-4000-8000-000000000002'
const COUNTER_1 = 'c0000000-0000-4000-8000-000000000003'
const COUNTER_2 = 'c0000000-0000-4000-8000-000000000004'

/** その日の JST の壁時計を UTC の ISO8601 に直す。11:00 は 02:00Z。 */
function at(clock: string): string {
  return new Date(Date.parse(`${DATE}T${clock}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()
}

/** 10:00 から 30分刻みで 10 列（10:00–15:00）。モックの 8 列は営業時間の切り出し。 */
const COLUMNS = [
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
] as const

/** 塞がっている枠を「時刻 → 理由」で書き、それ以外は置ける枠にする。 */
function lane(
  kind: AvailabilityLane['kind'],
  id: string | null,
  name: string,
  subtitle: string,
  blocked: Partial<Record<(typeof COLUMNS)[number], AvailabilityReason>>,
  equipmentIds: string[] = [],
): AvailabilityLane {
  const slots: AvailabilitySlot[] = COLUMNS.map((clock) => {
    const reason = blocked[clock] ?? null
    return {
      startsAt: at(clock),
      endsAt: new Date(Date.parse(at(clock)) + 60 * 60 * 1000).toISOString(),
      remaining: reason === null ? 1 : 0,
      isAvailable: reason === null,
      staffIds: reason === null && id !== null && kind === 'staff' ? [id] : [],
      equipmentIds: reason === null ? equipmentIds : [],
      reason,
    }
  })
  return { kind, id, name, subtitle, slots }
}

const OUT = { '14:00': 'outside_hours', '14:30': 'outside_hours' } as const

function staffAvailability(): AvailabilityResponse {
  return {
    date: DATE,
    opensAt: '10:00',
    closesAt: '15:00',
    isClosed: false,
    slotMinutes: 30,
    cleanupMinutes: 10,
    durationMinutes: 60,
    slots: [],
    lanes: [
      lane('staff', SATO, '佐藤 美咲', '視力測定・加工', {
        '11:00': 'staff_busy',
        '11:30': 'staff_busy',
        ...OUT,
      }),
      lane('staff', KOBAYASHI, '小林 学', '視力測定', {
        '10:00': 'staff_off',
        '12:00': 'break',
        '12:30': 'break',
        ...OUT,
      }),
      lane('staff', NAKAMURA, '中村 彩', '販売・受付', {
        '10:30': 'staff_busy',
        '11:00': 'staff_busy',
        '11:30': 'staff_busy',
        ...OUT,
      }),
      lane('staff', TAKAHASHI, '高橋 健', 'フィッティング', {
        '10:00': 'no_skill',
        '10:30': 'no_skill',
        '11:00': 'no_skill',
        '11:30': 'no_skill',
        '12:00': 'no_skill',
        '12:30': 'no_skill',
        '13:00': 'no_skill',
        '13:30': 'no_skill',
        '14:00': 'no_skill',
        '14:30': 'no_skill',
      }),
      lane('unassigned', null, '担当が未定', '', OUT),
    ],
    alternatives: [],
    reason: null,
    serverNow: at('11:08'),
  }
}

function resourceAvailability(): AvailabilityResponse {
  return {
    ...staffAvailability(),
    lanes: [
      lane('equipment', METER_A, '視力測定機 A', '視力測定', {
        '11:00': 'equipment_busy',
        '11:30': 'equipment_busy',
        ...OUT,
      }),
      lane('equipment', METER_B, '視力測定機 B', '視力測定', {
        '13:00': 'maintenance',
        '13:30': 'maintenance',
        ...OUT,
      }),
      lane('equipment', COUNTER_1, '相談カウンター 1', 'ご相談・お受け取り', {
        '10:00': 'equipment_busy',
        '11:00': 'equipment_busy',
        ...OUT,
      }),
      lane('equipment', COUNTER_2, '相談カウンター 2', 'ご相談・お受け取り', {
        '12:00': 'break',
        '12:30': 'break',
        ...OUT,
      }),
    ],
  }
}

/**
 * 受付の器。**この工程は自分の帯を持たない** —— 工程の札・録音・「次へ」の丸は
 * 5 工程を通して 1 本きり（承認済みモック BOOK-03/03b/03c の `.stepbar`）で、器が描く。
 * 器がどう配線すればよいかをここで固定する。
 */
function renderStep(overrides: Partial<SlotStepProps> = {}) {
  const onChange = vi.fn()
  const onNext = vi.fn()
  function Harness() {
    const [axis, setAxis] = useState<LedgerAxis>('staff')
    const [guard, setGuard] = useState<StepGuard>({
      canProceed: false,
      blockedReason: '読み込みが終わると進めます',
    })
    const [choice, setChoice] = useState<SlotChoice | null>(null)
    return (
      <>
        <SlotStep
          availability={axis === 'staff' ? staffAvailability() : resourceAvailability()}
          axis={axis}
          onAxisChange={setAxis}
          purposeLabel="メガネを新しく作る"
          startsAt={at('11:00')}
          durationMinutes={60}
          onChange={(next) => {
            setChoice(next)
            onChange(next)
          }}
          onGuardChange={setGuard}
          {...overrides}
        />
        <footer>
          <button
            type="button"
            disabled={!guard.canProceed}
            aria-label={nextButtonLabel(guard)}
            onClick={() => onNext(choice)}
          >
            ›
          </button>
        </footer>
      </>
    )
  }
  render(<Harness />)
  return { onChange, onNext }
}

function rowOf(name: string): HTMLElement {
  const header = screen.getByRole('rowheader', { name: new RegExp(name) })
  const row = header.closest('[role="row"]')
  if (row === null) throw new Error(`${name} の行が無い`)
  return row as HTMLElement
}

function nextButton(): HTMLElement {
  return screen.getByRole('button', { name: /次へ進む/ })
}

/** 名前列 170px・見出し 34px・10 列 83px・5 行 93.2px の盤として測れるようにする。 */
function measureBoard(rows = 5): HTMLElement {
  const board = screen.getByRole('table', { name: 'ご予約を置く盤' })
  const height = 34 + rows * 93.2
  board.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 1000,
      height,
      right: 1000,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
  return board
}

/** 列 index の真ん中の x 座標。名前列 170px ＋ 1 列 83px。 */
function xOf(column: number): number {
  return 170 + column * 83 + 40
}

/** 行 index の真ん中の y 座標。見出し 34px ＋ 1 行 93.2px。 */
function yOf(row: number): number {
  return 34 + row * 93.2 + 40
}

/* 全角空白（U+3000）は testing-library の既定の正規化で半角 1 つに潰れるが、
   照合する文字列のほうは潰れない。UI が全角空白で区切っている箇所は `\s` で照らす。 */
function grab(_board: HTMLElement, column: number, row: number) {
  fireEvent.pointerDown(screen.getByRole('button', { name: /ご予約をつかんで動かす/ }), {
    pointerId: 1,
    pointerType: 'touch',
    isPrimary: true,
    clientX: xOf(column),
    clientY: yOf(row),
  })
}

function moveTo(board: HTMLElement, column: number, row: number, dx = 0, dy = 0) {
  fireEvent.pointerMove(board, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: xOf(column) + dx,
    clientY: yOf(row) + dy,
  })
}

function release(board: HTMLElement, column: number, row: number) {
  fireEvent.pointerUp(board, {
    pointerId: 1,
    pointerType: 'touch',
    clientX: xOf(column),
    clientY: yOf(row),
  })
}

describe('工程 3', () => {
  it('ご希望の時刻の位置に「このご予約」の帯が置かれる', () => {
    renderStep()
    const band = within(rowOf('佐藤 美咲')).getByText('このご予約')
    expect(band).toBeInTheDocument()
    expect(screen.getByText('8月27日（木）')).toBeInTheDocument()
    expect(screen.getByText('11:00–12:00（60分）')).toBeInTheDocument()
    expect(screen.getByText('メガネを新しく作る')).toBeInTheDocument()
  })

  it('空いている枠に大きな札を置かず、薄い線だけで見せる', () => {
    renderStep()
    expect(screen.queryByText('ここに置けます')).not.toBeInTheDocument()
  })
})

describe('重なり', () => {
  it('先約の上に帯が重なって「重なっています」と書かれる', () => {
    renderStep()
    const row = rowOf('佐藤 美咲')
    expect(within(row).getByText('重なっています')).toBeInTheDocument()
    expect(within(row).getByText('先約')).toBeInTheDocument()
  })

  it('右に「佐藤 美咲 に 11:00 の先約があります」と出て「次へ進む」が押せない', () => {
    renderStep()
    expect(screen.getByText('佐藤 美咲 に 11:00 の先約があります')).toBeInTheDocument()
    expect(
      screen.getByText(
        'このままでは二重のご予約になります。担当を変えるか、時間をずらしてください。',
      ),
    ).toBeInTheDocument()
    expect(nextButton()).toBeDisabled()
  })

  it('「同じ 11:00 で受けられる担当」の候補を押すと帯がその行へ移り、重なりが消える', async () => {
    const user = userEvent.setup()
    const { onChange } = renderStep()
    expect(screen.getByText('同じ 11:00 で受けられる担当')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /小林 学/ }))
    expect(within(rowOf('小林 学')).getByText('このご予約')).toBeInTheDocument()
    expect(screen.queryByText('重なっています')).not.toBeInTheDocument()
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: KOBAYASHI, startsAt: at('11:00') }),
    )
  })

  it('重なりが消えると「次へ進む」が押せるようになる', async () => {
    const user = userEvent.setup()
    const { onNext } = renderStep()
    await user.click(screen.getByRole('button', { name: /小林 学/ }))
    expect(nextButton()).toBeEnabled()
    await user.click(nextButton())
    expect(onNext).toHaveBeenCalledWith(
      expect.objectContaining({ staffId: KOBAYASHI, startsAt: at('11:00') }),
    )
  })

  it('その時刻に空いていない担当は、あとから空く時刻を添えて候補に並べる', () => {
    renderStep()
    expect(screen.getByRole('button', { name: /中村 彩/ })).toHaveTextContent(
      '12:00 からなら空いています',
    )
  })
})

describe('軸の切り替え', () => {
  it('「設備・場所」に切り替えると縦軸が設備になり「同じ 11:00 で使える設備」が出る', async () => {
    const user = userEvent.setup()
    renderStep()
    await user.click(screen.getByRole('button', { name: '設備・場所' }))
    expect(screen.getByRole('columnheader', { name: '設備・場所' })).toBeInTheDocument()
    expect(screen.getByText('同じ 11:00 で使える設備')).toBeInTheDocument()
    expect(screen.getByText('視力測定機 A に 11:00 の先約があります')).toBeInTheDocument()
  })

  it('担当の行を押していない受付でも、設備の軸へ移ると担当が消えない', async () => {
    const user = userEvent.setup()
    const { onChange } = renderStep()
    /*
     * 盤が既定で帯を乗せた行（1 行目・佐藤 美咲）が、この受付の担当である。
     * ここが `null` へ落ちると、担当を選んだつもりの受付が黙って「担当未定」で確定する。
     */
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ staffId: SATO }))
    await user.click(screen.getByRole('button', { name: '設備・場所' }))
    expect(screen.getByRole('columnheader', { name: '設備・場所' })).toBeInTheDocument()
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ staffId: SATO }))
    // 設備の重なりを解いても担当はそのまま（軸をまたいでも名前を言える）。
    await user.click(screen.getByRole('button', { name: /視力測定機 B/ }))
    expect(screen.getByText('佐藤 美咲', { selector: 'dd' })).toBeInTheDocument()
  })

  it('「担当者」に戻すと、選んでいた担当が保たれている', async () => {
    const user = userEvent.setup()
    renderStep()
    await user.click(screen.getByRole('button', { name: /小林 学/ }))
    await user.click(screen.getByRole('button', { name: '設備・場所' }))
    await user.click(screen.getByRole('button', { name: '担当者' }))
    expect(within(rowOf('小林 学')).getByText('このご予約')).toBeInTheDocument()
  })
})

describe('候補が 1 件も無いとき', () => {
  /** 担当が 1 人と「担当が未定」だけ。その 1 人の 11:00 が先約で、あとの時刻も空かない。 */
  function nowhereToGo(): AvailabilityResponse {
    const base = staffAvailability()
    return {
      ...base,
      lanes: [
        lane('staff', SATO, '佐藤 美咲', '視力測定・加工', {
          '11:00': 'staff_busy',
          '11:30': 'staff_busy',
          '12:00': 'staff_busy',
          '12:30': 'staff_busy',
          '13:00': 'staff_busy',
          '13:30': 'staff_busy',
          ...OUT,
        }),
        lane('unassigned', null, '担当が未定', '', OUT),
      ],
    }
  }

  it('1 文で終わらせず、時刻を選び直す道を出す', async () => {
    const user = userEvent.setup()
    const onBackToDate = vi.fn()
    renderStep({ availability: nowhereToGo(), onBackToDate })
    expect(
      screen.getByText('この時刻に空いている先がありません。時間をずらしてください。'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '時刻を選び直す' }))
    expect(onBackToDate).toHaveBeenCalled()
  })
})

describe('凡例と帯の言い方', () => {
  /** 凡例の色見本（文字の左の四角）。 */
  function swatch(label: string): HTMLElement {
    const item = screen.getByText(label)
    const box = item.querySelector('span')
    if (box === null) throw new Error(`${label} の色見本が無い`)
    return box
  }

  it('凡例の色見本は、いま盤に出ている帯と同じ色を指す', async () => {
    const user = userEvent.setup()
    renderStep()
    // 重なっているあいだの帯は赤。
    expect(swatch('いま置いているご予約').className).toContain('border-danger')
    await user.click(screen.getByRole('button', { name: /小林 学/ }))
    // 重なりが消えた帯は緑。凡例だけ赤のままにしない。
    expect(swatch('いま置いているご予約').className).toContain('border-pine')
  })

  it('運んでいる間の凡例は「動かしているご予約／置く先」に差し替わる', () => {
    renderStep()
    const board = measureBoard()
    grab(board, 2, 0)
    moveTo(board, 6, 0)
    expect(screen.getByText('動かしているご予約')).toBeInTheDocument()
    expect(swatch('置く先').className).toContain('border-dashed')
  })

  it('設備の行に「休憩」と書かない（機械は休憩しない）', async () => {
    const user = userEvent.setup()
    renderStep()
    expect(within(rowOf('小林 学')).getByText('休憩')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '設備・場所' }))
    const counter = rowOf('相談カウンター 2')
    expect(within(counter).queryByText('休憩')).not.toBeInTheDocument()
    expect(within(counter).getByText('受付停止')).toBeInTheDocument()
  })
})

describe('技能', () => {
  it('その目的を受けられない担当の行に「この用件は承れません」と書かれる', () => {
    renderStep()
    expect(within(rowOf('高橋 健')).getByText('この用件は承れません')).toBeInTheDocument()
  })
})

describe('未定', () => {
  it('「担当はあとで決める」を押すと未定のまま工程 4 へ進める', async () => {
    const user = userEvent.setup()
    const { onNext } = renderStep()
    await user.click(screen.getByRole('button', { name: '担当はあとで決める' }))
    expect(within(rowOf('担当が未定')).getByText('このご予約')).toBeInTheDocument()
    expect(nextButton()).toBeEnabled()
    await user.click(nextButton())
    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ staffId: null }))
  })

  it('「設備はあとで決める」を押しても、選んでいた担当は残る', async () => {
    const user = userEvent.setup()
    const { onChange } = renderStep()
    await user.click(screen.getByRole('button', { name: /小林 学/ }))
    await user.click(screen.getByRole('button', { name: '設備・場所' }))
    await user.click(screen.getByRole('button', { name: '設備はあとで決める' }))
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ staffId: KOBAYASHI, equipmentIds: [] }),
    )
    await user.click(screen.getByRole('button', { name: '担当者' }))
    expect(within(rowOf('小林 学')).getByText('このご予約')).toBeInTheDocument()
  })
})

describe('押せない理由', () => {
  it('重なっている間の「次へ進む」に「重なりを解くと進めます」が読み上げられる', () => {
    renderStep()
    expect(nextButton()).toHaveAccessibleName('次へ進む　重なりを解くと進めます')
  })
})

describe('ドラッグ', () => {
  it('つまみをつかむと、もとの場所が薄く残る', () => {
    renderStep()
    const board = measureBoard()
    grab(board, 2, 0)
    const origin = within(rowOf('佐藤 美咲')).getByText('もとの場所')
    expect(origin).toBeInTheDocument()
    expect(origin.closest('span')).toHaveClass('opacity-35')
  })

  it('運んでいる先に点線の枠と「13:00–14:00 へ」が出る', () => {
    renderStep()
    const board = measureBoard()
    grab(board, 2, 0)
    moveTo(board, 6, 0)
    const ghost = screen.getByText('13:00–14:00 へ')
    expect(ghost).toBeInTheDocument()
    expect(ghost.closest('span')).toHaveClass('border-dashed')
  })

  it('右に「指を離すと、この時刻で確保します」と重なりの有無が出る', () => {
    renderStep()
    const board = measureBoard()
    grab(board, 2, 0)
    moveTo(board, 6, 0)
    expect(screen.getByText('指を離すと、この時刻で確保します')).toBeInTheDocument()
    expect(screen.getByText(/13:00–14:00\s先約との重なりはありません。/)).toBeInTheDocument()
  })

  it('運んでいる間は「次へ進む」が押せず「指を離すと進めます」が読み上げられる', () => {
    renderStep()
    const board = measureBoard()
    grab(board, 2, 0)
    moveTo(board, 6, 0)
    expect(nextButton()).toBeDisabled()
    expect(nextButton()).toHaveAccessibleName('次へ進む　指を離すと進めます')
  })

  it('指を離すとその担当・時刻で確保され、押さえを取り直す', () => {
    const { onChange } = renderStep()
    const board = measureBoard()
    grab(board, 2, 0)
    moveTo(board, 6, 0)
    release(board, 6, 0)
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ staffId: SATO, startsAt: at('13:00'), endsAt: at('14:00') }),
    )
    expect(within(rowOf('佐藤 美咲')).getByText('このご予約')).toBeInTheDocument()
    expect(screen.getByText('確保するもの')).toBeInTheDocument()
  })

  it('別の担当の行まで運ぶと担当ごと変わる', () => {
    const { onChange } = renderStep()
    const board = measureBoard()
    grab(board, 2, 0)
    moveTo(board, 6, 1)
    release(board, 6, 1)
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ staffId: KOBAYASHI, startsAt: at('13:00') }),
    )
    expect(within(rowOf('小林 学')).getByText('このご予約')).toBeInTheDocument()
  })

  it('「もとの 11:00 に戻す」を押すと元の位置と元の担当へ戻る', async () => {
    const user = userEvent.setup()
    const { onChange } = renderStep()
    const board = measureBoard()
    grab(board, 2, 0)
    moveTo(board, 6, 1)
    release(board, 6, 1)
    await user.click(screen.getByRole('button', { name: 'もとの 11:00 に戻す' }))
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ staffId: SATO, startsAt: at('11:00') }),
    )
    expect(within(rowOf('佐藤 美咲')).getByText('このご予約')).toBeInTheDocument()
  })
})

describe('置けない場所', () => {
  it('点検中の設備へ運ぶと点線の枠を出さず「ここには置けません（視力測定機 B は点検中です）」と理由を添える', async () => {
    const user = userEvent.setup()
    renderStep()
    await user.click(screen.getByRole('button', { name: '設備・場所' }))
    const board = measureBoard(4)
    grab(board, 2, 0)
    moveTo(board, 6, 1)
    expect(screen.getByText('ここには置けません（視力測定機 B は点検中です）')).toBeInTheDocument()
    expect(screen.queryByText('13:00–14:00 へ')).not.toBeInTheDocument()
  })

  /*
   * `06-use-cases.md` IDX-BOOK-06 の例外 E2 は「置いた先が先約と重なったら
   * IDX-BOOK-04 の警告状態に戻る」と書いているが、この面は**置かせない**ほうを採った ——
   * 重なった状態をわざわざ作ってから解かせるより、置く前に断るほうが指の数が少ない。
   * 重なりの警告そのものは、工程 3 を開いた時点の置き場所（希望の時刻）が受け持つ。
   */
  it('先約のある枠へ運ぶと点線を出さず理由を言い、指を離すと元の位置へ戻る', () => {
    const { onChange } = renderStep()
    const board = measureBoard()
    // 佐藤 美咲 の 11:00 は先約。中村 彩 の 11:00 も先約なので、そこへ運んでみる。
    grab(board, 2, 0)
    moveTo(board, 2, 2)
    expect(screen.getByText('ここには置けません（中村 彩 に先約があります）')).toBeInTheDocument()
    expect(screen.getByText('指を離すと、もとの場所に戻ります')).toBeInTheDocument()
    expect(screen.queryByText('11:00–12:00 へ')).not.toBeInTheDocument()
    release(board, 2, 2)
    // 置き場所は動いていない（器へ上がっているのはマウント時の 1 回だけ）。
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(within(rowOf('佐藤 美咲')).getByText('このご予約')).toBeInTheDocument()
    expect(screen.getByText('佐藤 美咲 に 11:00 の先約があります')).toBeInTheDocument()
  })

  it('営業時間の外・勤務の外でも同じく置けず、指を離すと元の位置へ戻る', () => {
    const { onChange } = renderStep()
    const board = measureBoard()
    grab(board, 2, 0)
    moveTo(board, 9, 0)
    expect(screen.getByText('ここには置けません（営業時間の外です）')).toBeInTheDocument()
    moveTo(board, 0, 1)
    expect(screen.getByText('ここには置けません（小林 学 の勤務の外です）')).toBeInTheDocument()
    release(board, 0, 1)
    /* 器へ上がっているのはマウント時の 1 回だけ（置き場所は動いていないので打ち直さない）。 */
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ staffId: SATO, startsAt: at('11:00') }),
    )
    expect(within(rowOf('佐藤 美咲')).getByText('このご予約')).toBeInTheDocument()
  })
})

describe('刻み', () => {
  it('座標がずれても 30 分の刻みと担当の行へ吸着する', () => {
    renderStep()
    const board = measureBoard()
    grab(board, 2, 0)
    // 13:00 の列のいちばん右・佐藤の行のいちばん下を指しても、13:00 と佐藤のまま。
    moveTo(board, 6, 0, 40, 50)
    expect(screen.getByText('13:00–14:00 へ')).toBeInTheDocument()
    expect(within(rowOf('佐藤 美咲')).getByText('いま置いているご予約')).toBeInTheDocument()
  })

  it('ペンが触れている間は指のポインタを捨てる', () => {
    renderStep()
    const board = measureBoard()
    fireEvent.pointerDown(screen.getByRole('button', { name: /ご予約をつかんで動かす/ }), {
      pointerId: 2,
      pointerType: 'pen',
      isPrimary: true,
      clientX: xOf(2),
      clientY: yOf(0),
    })
    fireEvent.pointerMove(board, {
      pointerId: 3,
      pointerType: 'touch',
      clientX: xOf(6),
      clientY: yOf(0),
    })
    expect(screen.queryByText('13:00–14:00 へ')).not.toBeInTheDocument()
    fireEvent.pointerMove(board, {
      pointerId: 2,
      pointerType: 'pen',
      clientX: xOf(6),
      clientY: yOf(0),
    })
    expect(screen.getByText('13:00–14:00 へ')).toBeInTheDocument()
  })
})

describe('読めないとき', () => {
  it('読み込み中は盤の枠だけを出し、回るアイコンを置かない', () => {
    renderStep({ availability: null, phase: 'loading' })
    expect(screen.getByText('読み込んでいます…')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('通信が切れていたら、書けないことを言って読み直す道を出す', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    renderStep({ availability: null, phase: 'error', onRetry })
    expect(screen.getByRole('alert')).toHaveTextContent('空き枠を読み込めませんでした')
    await user.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('権限が無いときは、やり直す道を出さない', () => {
    renderStep({ availability: null, phase: 'forbidden' })
    expect(screen.getByRole('alert')).toHaveTextContent('このお店の空き枠を見る権限がありません。')
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).not.toBeInTheDocument()
  })

  it('通信が切れている間は、確定できないことを先に言う', () => {
    renderStep({ phase: 'offline' })
    expect(screen.getByRole('status')).toHaveTextContent(
      '通信が切れています。ご予約の確定は、つながってからになります。',
    )
    expect(nextButton()).toBeDisabled()
  })

  it('その日が定休なら盤を出さず、日にちを選び直す道を出す', async () => {
    const user = userEvent.setup()
    const onBackToDate = vi.fn()
    renderStep({
      availability: {
        ...staffAvailability(),
        isClosed: true,
        opensAt: null,
        closesAt: null,
        lanes: [],
        reason: 'closed',
      },
      onBackToDate,
    })
    expect(screen.getByRole('status')).toHaveTextContent('この日はお店を開けていません。')
    await user.click(screen.getByRole('button', { name: '別の日を選ぶ' }))
    expect(onBackToDate).toHaveBeenCalled()
  })
})
