import type { AvailabilityResponse, AvailabilitySlot, BusinessHoursView } from '@app/contracts'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangeDateTime, type ChangeTarget } from './ChangeDateTime'

/*
 * 日時を変える（承認済みモック docs/frontend/mockups/eyex/images/CHANGE-DATETIME.png）。
 *
 * 実測（screens/CHANGE-DATETIME.html と assets/eyex.css）:
 *   2 段組みは 300px 1fr。左ペイン padding 36px 26px・見出し 15px・日時 20px/1.4 の
 *   --brand-dark・項目名 12px（上 24px）・値 17px/600・補足 13px。
 *   日付は 7 列 gap 10px・min-height 76px・21px/600（選択中は 3px の緑罫 + --brand-tint、
 *   定休は --surface-2 に --ink-3 で「定休」）。
 *   時刻は 5 列 gap 12px・min-height 96px・padding 14px・24px/600・札の文 13px（上 6px）。
 *   選んだ結果は 20px/1.5 の緑の 1 文。下辺は工程バー 76px（‹ 48px の丸 + 4 段 + 主操作）。
 *
 * ここで見るのは「何が読めて、何が押せるか」。寸法そのものは e2e の突き合わせが見る。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
const RESERVATION_ID = 'a0000000-0000-4000-8000-000000000001'
/** JST 2026年8月27日（木）11:09。端末の時計を読ませないため必ず注ぐ。 */
const NOW = '2026-08-27T02:09:00.000Z'
const DATE = '2026-08-27'

/** その日の JST の壁時計を UTC の ISO8601 に直す。11:00 は 02:00Z。 */
function at(clock: string, date = DATE): string {
  return new Date(Date.parse(`${date}T${clock}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()
}

const TARGET: ChangeTarget = {
  code: 'EY-2608-0142',
  startsAt: at('11:00'),
  endsAt: at('12:00'),
  durationMinutes: 60,
  customerName: '田中 花子',
  visitCount: 4,
  purposeLabel: '新調のご相談・視力測定',
  staffName: '佐藤 美咲',
  equipmentNames: ['視力測定機 A', '相談カウンター 1'],
}

function slot(clock: string, remaining: number, date = DATE): AvailabilitySlot {
  return {
    startsAt: at(clock, date),
    endsAt: at(clock, date),
    remaining,
    isAvailable: remaining > 0,
    staffIds: [],
    equipmentIds: [],
    reason: remaining > 0 ? null : 'staff_busy',
  }
}

/** モック CHANGE-DATETIME の 5 枠（15:30 だけが満席）。 */
function slots(date = DATE): AvailabilitySlot[] {
  return [
    slot('10:00', 2, date),
    slot('13:00', 1, date),
    slot('14:00', 1, date),
    slot('15:30', 0, date),
    slot('16:00', 3, date),
  ]
}

function availability(date: string): AvailabilityResponse {
  return {
    date,
    opensAt: '10:00',
    closesAt: '19:00',
    isClosed: false,
    slotMinutes: 30,
    cleanupMinutes: 10,
    durationMinutes: 60,
    slots: slots(date).map((row) => ({ ...row, endsAt: at('19:00', date) })),
    lanes: [],
    alternatives: [],
    reason: null,
    serverNow: NOW,
  }
}

/** 火曜（weekday=2）だけが定休の 1 週間。2026年9月1日は火曜。 */
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

let asked: URL[] = []

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  asked = []
  sessionStorage.setItem('app.auth.token', 'header.payload.signature')
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://example.test')
      asked.push(url)
      if (url.pathname.endsWith('/business-hours')) return Promise.resolve(json(HOURS))
      return Promise.resolve(json(availability(url.searchParams.get('date') ?? DATE)))
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

type Overrides = Partial<Parameters<typeof ChangeDateTime>[0]>

function show(overrides: Overrides = {}) {
  const props = {
    storeId: STORE_ID,
    reservationId: RESERVATION_ID,
    target: TARGET,
    now: NOW,
    chosenStartsAt: null,
    onChoose: vi.fn(),
    holdExpiresAt: null,
    renewalsUsed: 0,
    onKeepEditing: vi.fn(),
    onBack: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  }
  render(<ChangeDateTime {...props} />)
  return props
}

/** 候補が出そろうまで待つ。 */
async function waitForSlots() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '16:00　受付できます' })).toBeInTheDocument(),
  )
}

describe('いまのご予約', () => {
  it('左に「いまのご予約」が固定で置かれ、日時・お客様・ご用件と所要・担当と場所を読める', async () => {
    show()
    const pane = within(screen.getByRole('region', { name: 'いまのご予約' }))
    expect(pane.getByText('8月27日（木）')).toBeInTheDocument()
    expect(pane.getByText('11:00–12:00')).toBeInTheDocument()
    expect(pane.getByText(/田中 花子 様/)).toBeInTheDocument()
    expect(pane.getByText('新調のご相談・視力測定')).toBeInTheDocument()
    expect(pane.getByText('所要 60分')).toBeInTheDocument()
    expect(pane.getByText('佐藤 美咲')).toBeInTheDocument()
    expect(pane.getByText('視力測定機 A／相談カウンター 1')).toBeInTheDocument()
    await waitForSlots()
  })
})

describe('日時を選ぶ', () => {
  it('「60分の枠が取れる時刻だけを出しています。」が出る', async () => {
    show()
    await waitForSlots()
    expect(screen.getByText('60分の枠が取れる時刻だけを出しています。')).toBeInTheDocument()
  })

  it('候補の先頭が「11:00　いまのまま」になる', async () => {
    show()
    await waitForSlots()
    const list = within(screen.getByRole('group', { name: 'お時間' })).getAllByRole('button')
    expect(list[0]).toHaveAccessibleName('11:00　いまのまま')
  })

  it('候補に「受付できます」「満席」の文字が添う（色だけで伝えない）', async () => {
    show()
    await waitForSlots()
    expect(screen.getByRole('button', { name: '10:00　受付できます' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '15:30　満席' })).toBeInTheDocument()
  })

  it('「15:30　満席」は押せない', async () => {
    const props = show()
    await waitForSlots()
    const full = screen.getByRole('button', { name: '15:30　満席' })
    expect(full).toBeDisabled()
    await userEvent.click(full)
    expect(props.onChoose).not.toHaveBeenCalled()
  })

  it('定休日の 1日 は「定休」と出て押せない', async () => {
    show()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '9月1日（火）　定休' })).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: '9月1日（火）　定休' })).toBeDisabled()
  })

  it('時刻を選ぶと「14:00 から60分、佐藤 美咲／視力測定機 A を確保します。」が出る', async () => {
    const props = show()
    await waitForSlots()
    await userEvent.click(screen.getByRole('button', { name: '14:00　受付できます' }))
    expect(props.onChoose).toHaveBeenCalledWith(at('14:00'))
    show({ chosenStartsAt: at('14:00') })
    await waitFor(() =>
      expect(
        screen.getByText('14:00 から60分、佐藤 美咲／視力測定機 A を確保します。'),
      ).toBeInTheDocument(),
    )
  })
})

describe('候補が多い日', () => {
  /*
   * 営業時間ぶんの格子（12 枠）を返す日。札を全部並べると 5 列 × 3 段になり、
   * 選んだ結果の 1 文と仮の押さえの残り時間が画面の下へ押し出される。
   * 札は 8 枚までで止め、残りは 1 つの操作の中に畳む（引き算の規準）。
   */
  const MANY = [
    '10:00',
    '10:30',
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
  ]

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), 'https://example.test')
        if (url.pathname.endsWith('/business-hours')) return Promise.resolve(json(HOURS))
        const date = url.searchParams.get('date') ?? DATE
        return Promise.resolve(
          json({
            ...availability(date),
            slots: MANY.map((clock) => ({ ...slot(clock, 1, date), endsAt: at('19:00', date) })),
          }),
        )
      }),
    )
  })

  it('時刻の札は 8 枚までで、残りは「ほかの時刻も見る」の中にある', async () => {
    show()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '10:00　受付できます' })).toBeInTheDocument(),
    )
    const group = within(screen.getByRole('group', { name: 'お時間' }))
    const times = group
      .getAllByRole('button')
      .filter((button) => !/ほかの時刻も見る/.test(button.textContent ?? ''))
    expect(times).toHaveLength(8)
    // いまのご予約自身の 11:00 と、格子の頭から 7 枠。残りの 5 枠は畳まれている。
    expect(times[0]).toHaveAccessibleName('11:00　いまのまま')
    expect(group.getByRole('button', { name: 'ほかの時刻も見る（あと5件）' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '16:00　受付できます' })).not.toBeInTheDocument()
  })

  it('「ほかの時刻も見る」を押すと残りの時刻も並ぶ', async () => {
    show()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '10:00　受付できます' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'ほかの時刻も見る（あと5件）' }))
    expect(screen.getByRole('button', { name: '16:00　受付できます' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^ほかの時刻も見る/ })).not.toBeInTheDocument()
  })

  it('選んでいる時刻が窓の外なら、初めから全部の時刻を出す（選んだ札を隠さない）', async () => {
    show({ chosenStartsAt: at('16:00') })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '16:00　選択中' })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: /^ほかの時刻も見る/ })).not.toBeInTheDocument()
  })
})

describe('工程バー', () => {
  it('1 予約を探す／2 日時を変える／3 ご確認／4 完了 の 4 段で、2 に aria-current="step" が付く', async () => {
    show()
    const steps = within(
      screen.getByRole('list', { name: '予約の変更の工程　全4工程' }),
    ).getAllByRole('listitem')
    expect(steps).toHaveLength(4)
    expect(steps.map((step) => step.textContent?.replace(/\s/g, ''))).toEqual([
      '1予約を探す✓',
      '›2日時を変える全4工程のうち2つ目',
      '›3ご確認',
      '›4完了',
    ])
    expect(steps[1]).toHaveAttribute('aria-current', 'step')
    await waitForSlots()
  })

  it('時刻を選ぶまで「変更内容を確認する」は押せず、押せない理由が名前に入る', async () => {
    show()
    await waitForSlots()
    const next = screen.getByRole('button', {
      name: '変更内容を確認する　お時間をお選びになると進めます',
    })
    expect(next).toBeDisabled()
  })
})

describe('仮の押さえ', () => {
  it('残り時間を出す', async () => {
    show({ holdExpiresAt: '2026-08-27T02:16:00.000Z' })
    await waitForSlots()
    expect(screen.getByText('11:16 まで')).toBeInTheDocument()
    expect(screen.getByText('あと7分')).toBeInTheDocument()
  })

  it('残り 60 秒で role="status" の警告と「まだ入力中です」が出る', async () => {
    const props = show({ holdExpiresAt: '2026-08-27T02:10:00.000Z' })
    await waitForSlots()
    expect(screen.getByRole('status')).toHaveTextContent('この枠をあと1分お預かりしています')
    await userEvent.click(screen.getByRole('button', { name: 'まだ入力中です' }))
    expect(props.onKeepEditing).toHaveBeenCalledTimes(1)
  })

  it('延ばせるのは 10 回まで。上限では取り直す手を出さない', async () => {
    show({ holdExpiresAt: '2026-08-27T02:10:00.000Z', renewalsUsed: 10 })
    await waitForSlots()
    expect(screen.getByRole('status')).toHaveTextContent(
      'お預かりの上限です。枠を選び直してください。',
    )
    expect(screen.queryByRole('button', { name: 'まだ入力中です' })).not.toBeInTheDocument()
  })
})

describe('読み込み中・読めないとき', () => {
  it('読み込み中は札の枠だけを出す（回るアイコンを置かない）', () => {
    show()
    expect(screen.getByText('受け付けられる時刻を読み込んでいます…')).toBeInTheDocument()
  })

  it('読み込めなかったときは、その事実ともう一度読み込む手を出す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), 'https://example.test')
        if (url.pathname.endsWith('/business-hours')) return Promise.resolve(json(HOURS))
        return Promise.resolve(new Response('nope', { status: 500 }))
      }),
    )
    show()
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        '受け付けられる時刻を読み込めませんでした。',
      ),
    )
    await userEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
  })
})

describe('問い合わせ', () => {
  it('いまのご予約を除いて空き枠を数え直す（自分の予約が自分の変更を邪魔しない）', async () => {
    show()
    await waitForSlots()
    const availabilityCall = asked.find((url) => url.pathname === '/api/staff/availability')
    expect(availabilityCall?.searchParams.get('excludeReservationId')).toBe(RESERVATION_ID)
  })
})
