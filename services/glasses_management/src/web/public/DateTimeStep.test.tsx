import type { LocalDate, PublicAvailabilityResponse, PublicStorePurpose } from '@app/contracts'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { DateTimeStep } from './DateTimeStep'

/*
 * 工程 3「日にちと時間」（承認済みモック docs/frontend/mockups/eyex/images/WEB-03-DATETIME.png）。
 *
 * 実測（screens/WEB-03-DATETIME.html の <style>）:
 *   週の送り margin 28px 0 10px・gap 8px、‹ › は 44×44px・角 12px、中央の週は 16px
 *   日の並び 7 列・gap 4px、1 件は最小高 64px・padding 6px 0・角 8px・数字 20px/700、
 *   曜日 13px/400・状態 13px/600（--ink-3）
 *   時刻の並び 4 列・gap 10px、1 件は最小高 60px・角 12px・16px/700
 *   選択中は縁 3px + 「選択中」（13px --brand-dark）、満は地 --surface-2 + 「満」
 *
 * 押せない枠は `disabled` にせず `aria-disabled` と文字で示す（07-nfr.md §2.3）。
 */

const PURPOSE: PublicStorePurpose = {
  id: '11111111-1111-4111-8111-111111111111',
  name: '新しいメガネを作る',
  durationMinutes: 60,
}

/** JST 2026年8月27日（木）11:08 に立っているお客様。端末の時計を読ませない。 */
const TODAY: LocalDate = '2026-08-27'
/** 何日先まで受けるか = 30 日。ちょうど 30 日先は 9月26日（土）。 */
const LAST_ACCEPTED: LocalDate = '2026-09-26'

/** その日の JST の壁時計を UTC の ISO8601 に直す。10:30 は 01:30Z。 */
function at(date: LocalDate, clock: string): string {
  return new Date(Date.parse(`${date}T${clock}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()
}

/** 受け付ける時間 10:30–18:00 から、お昼（12:00–13:00）を抜いた 13 枠。 */
const CLOCKS = [
  '10:30',
  '11:00',
  '11:30',
  '13:00',
  '13:30',
  '14:00',
  '14:30',
  '15:00',
  '15:30',
  '16:00',
  '16:30',
  '17:00',
  '17:30',
] as const

function shift(date: LocalDate, days: number): LocalDate {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

type DayShape = { closed?: boolean; full?: readonly string[]; empty?: boolean }

function day(date: LocalDate, shape: DayShape = {}) {
  if (shape.closed === true) return { date, isClosed: true, isFull: false, slots: [] }
  const slots = CLOCKS.map((clock) => ({
    startsAt: at(date, clock),
    isAvailable: shape.empty !== true && !(shape.full ?? []).includes(clock),
  }))
  return { date, isClosed: false, isFull: slots.every((slot) => !slot.isAvailable), slots }
}

/** その週の 7 日ぶん。8月29日（土）だけ 13:00 と 14:30 が満、9月1日（火）は定休。 */
function week(from: LocalDate, shape: (date: LocalDate) => DayShape = () => ({})) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = shift(from, index)
    return day(date, shape(date))
  })
  return { days } satisfies PublicAvailabilityResponse
}

const MOCK_WEEK = (from: LocalDate): PublicAvailabilityResponse =>
  week(from, (date) =>
    date === '2026-09-01'
      ? { closed: true }
      : date === '2026-08-29'
        ? { full: ['13:00', '14:30'] }
        : {},
  )

function Harness({
  loadWeek,
  lastAcceptedDate = LAST_ACCEPTED,
  onNext = vi.fn(),
}: {
  loadWeek: (from: LocalDate, to: LocalDate) => Promise<PublicAvailabilityResponse>
  lastAcceptedDate?: LocalDate
  onNext?: () => void
}) {
  const [startsAt, setStartsAt] = useState<string | null>(null)
  return (
    <DateTimeStep
      purpose={PURPOSE}
      today={TODAY}
      lastAcceptedDate={lastAcceptedDate}
      loadWeek={loadWeek}
      startsAt={startsAt}
      onSelect={setStartsAt}
      onNext={onNext}
    />
  )
}

const loadMockWeek = (from: LocalDate) => Promise.resolve(MOCK_WEEK(from))

describe('日時を選ぶ', () => {
  it('見出しは「ご希望の日時をお選びください」で、補足に選んだ目的の所要が入る', async () => {
    render(<Harness loadWeek={loadMockWeek} />)

    expect(
      await screen.findByRole('heading', { name: 'ご希望の日時をお選びください' }),
    ).toBeInTheDocument()
    expect(screen.getByText('約60分でご案内できる日時です。')).toBeInTheDocument()
    expect(screen.getByText('8月27日 〜 9月2日')).toBeInTheDocument()
  })

  it('定休日は押せず「定休」と読める', async () => {
    render(<Harness loadWeek={loadMockWeek} />)

    const closed = await screen.findByRole('button', { name: '9月1日（火）　定休' })
    expect(closed).toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(closed)
    expect(screen.queryByText('9月1日（火）のお時間')).toBeNull()
  })

  it('埋まっている時刻は押せず「満」と読める', async () => {
    render(<Harness loadWeek={loadMockWeek} />)
    await userEvent.click(await screen.findByRole('button', { name: '8月29日（土）' }))

    const taken = await screen.findByRole('button', { name: '13:00　満' })
    expect(taken).toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(taken)
    expect(screen.queryByText('選択中')).toBeNull()
  })

  it('押せない理由は色だけでなく文字でも分かる', async () => {
    render(<Harness loadWeek={loadMockWeek} />)
    await userEvent.click(await screen.findByRole('button', { name: '8月29日（土）' }))

    expect(await screen.findByRole('button', { name: '9月1日（火）　定休' })).toHaveTextContent(
      '定休',
    )
    expect(screen.getByRole('button', { name: '13:00　満' })).toHaveTextContent('満')
    expect(screen.getByRole('button', { name: '14:30　満' })).toHaveTextContent('満')
  })

  it('受け付ける時間（10:30–18:00）の外の時刻は候補に出ない', async () => {
    render(<Harness loadWeek={loadMockWeek} />)
    await userEvent.click(await screen.findByRole('button', { name: '8月27日（木）' }))

    expect(await screen.findByRole('button', { name: '10:30' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '10:00' })).toBeNull()
    expect(screen.queryByRole('button', { name: '18:00' })).toBeNull()
    expect(screen.getByRole('button', { name: '17:30' })).toBeInTheDocument()
  })

  it('お昼（12:00–13:00）の時刻は候補に出ない', async () => {
    render(<Harness loadWeek={loadMockWeek} />)
    await userEvent.click(await screen.findByRole('button', { name: '8月27日（木）' }))

    await screen.findByRole('button', { name: '11:30' })
    expect(screen.queryByRole('button', { name: '12:00' })).toBeNull()
    expect(screen.queryByRole('button', { name: '12:30' })).toBeNull()
  })

  it('30 日先ちょうどの日は選べ、31 日先を含む週へは「›」が進めない', async () => {
    render(<Harness loadWeek={loadMockWeek} />)
    await screen.findByRole('button', { name: '8月27日（木）' })

    for (let hop = 0; hop < 4; hop += 1) {
      await userEvent.click(screen.getByRole('button', { name: '次の週' }))
      await screen.findAllByRole('button', { name: /9月/ })
    }
    expect(screen.getByText('9月24日 〜 9月30日')).toBeInTheDocument()

    const last = screen.getByRole('button', { name: '9月26日（土）' })
    expect(last).not.toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(last)
    expect(await screen.findByText('9月26日（土）のお時間')).toBeInTheDocument()

    const forward = screen.getByRole('button', { name: '次の週' })
    expect(forward).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(forward)
    expect(screen.getByText('9月24日 〜 9月30日')).toBeInTheDocument()
  })

  it('日と時刻の両方が選ばれるまで「お客様の情報を入力する」は押せない', async () => {
    const onNext = vi.fn()
    render(<Harness loadWeek={loadMockWeek} onNext={onNext} />)

    const action = await screen.findByRole('button', { name: /お客様の情報を入力する/ })
    expect(action).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('日にちとお時間をお選びになると進めます。')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '8月29日（土）' }))
    expect(screen.getByRole('button', { name: /お客様の情報を入力する/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )

    await userEvent.click(await screen.findByRole('button', { name: '11:00' }))
    await userEvent.click(screen.getByRole('button', { name: 'お客様の情報を入力する' }))
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('その週に空きが 1 つも無ければ、週の表は残したまま「この週に空きがありません。」と次に空きのある週へ跳ぶボタンを 1 つだけ出す', async () => {
    const loadWeek = vi.fn((from: LocalDate) =>
      Promise.resolve(from === TODAY ? week(from, () => ({ empty: true })) : MOCK_WEEK(from)),
    )
    render(<Harness loadWeek={loadWeek} />)

    expect(await screen.findByText('この週に空きがありません。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '8月27日（木）' })).toBeInTheDocument()
    const jumps = screen.getAllByRole('button', { name: '次に空きのある週を探す' })
    expect(jumps).toHaveLength(1)

    await userEvent.click(jumps[0] as HTMLElement)

    expect(await screen.findByText('9月3日 〜 9月9日')).toBeInTheDocument()
    expect(screen.queryByText('この週に空きがありません。')).toBeNull()
  })

  it('空き枠の再計算が終わったことを role="status" で読み上げる', async () => {
    render(<Harness loadWeek={loadMockWeek} />)

    expect(await screen.findByRole('status')).toHaveTextContent(
      '8月27日 〜 9月2日 の空き状況を表示しました。',
    )

    await userEvent.click(screen.getByRole('button', { name: '次の週' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      '9月3日 〜 9月9日 の空き状況を表示しました。',
    )
  })
})
