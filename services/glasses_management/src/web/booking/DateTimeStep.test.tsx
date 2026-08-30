import type {
  AvailabilityResponse,
  AvailabilitySlot,
  BusinessHoursView,
  LocalDate,
  ReceptionSessionDraft,
} from '@app/contracts'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DateTimeStep } from './DateTimeStep'
import { emptyDraft, nextButtonLabel, type StepGuard } from './steps'

/*
 * 工程 1「お日にちとお時間」（承認済みモック
 * docs/frontend/mockups/eyex/images/BOOK-01-DATETIME.png）。
 *
 * 実測（screens/BOOK-01-DATETIME.html の <style> と assets/eyex.css）:
 *   本文 1fr ／ 右の要約 372px、本文の余白 36px 44px・要約 36px 28px、境目に 1px の罫
 *   暦は 7 列・間 8px、日の札は最小高 58px・角 8px・18px/600、曜日見出し 12px、「定休」10px
 *   時刻の札は 4 列・間 14px、最小高 72px・角 12px・19px/600、補足 11px
 *   質問と質問のあいだは 44px。要約は dt 12px（上に 22px）／ dd 17px/600
 *
 * ここで見るのは「何が読めて、何が押せるか」。寸法そのものは e2e の突き合わせが見る。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
const SESSION_ID = 'd0000000-0000-4000-8000-000000000001'
/** JST 2026年8月27日（木）11:08。端末の時計を読ませないため必ず注ぐ。 */
const NOW = '2026-08-27T02:08:00.000Z'
const DATE: LocalDate = '2026-08-27'

/** その日の JST の壁時計を UTC の ISO8601 に直す。10:00 は 01:00Z。 */
function at(clock: string, date: LocalDate = DATE): string {
  return new Date(Date.parse(`${date}T${clock}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()
}

function slot(clock: string, remaining: number, date: LocalDate = DATE): AvailabilitySlot {
  const hours = Number(clock.slice(0, 2))
  const minutes = Number(clock.slice(3, 5))
  const end = `${String(hours + (minutes === 30 ? 1 : 0)).padStart(2, '0')}:${minutes === 30 ? '00' : '30'}`
  return {
    startsAt: at(clock, date),
    endsAt: at(end, date),
    remaining,
    isAvailable: remaining > 0,
    staffIds: [],
    equipmentIds: [],
    reason: remaining > 0 ? null : 'staff_busy',
  }
}

/** モック BOOK-01 の 8 枠（12:00 台が無いのは受付を止める帯があるため）。 */
const MOCK_SLOTS = (date: LocalDate = DATE): AvailabilitySlot[] => [
  slot('10:00', 2, date),
  slot('10:30', 1, date),
  slot('11:00', 2, date),
  slot('11:30', 0, date),
  slot('13:00', 3, date),
  slot('13:30', 3, date),
  slot('14:00', 1, date),
  slot('14:30', 0, date),
]

function availability(date: LocalDate, slots: AvailabilitySlot[]): AvailabilityResponse {
  return {
    date,
    opensAt: '10:00',
    closesAt: '19:00',
    isClosed: false,
    slotMinutes: 30,
    cleanupMinutes: 10,
    durationMinutes: 30,
    slots,
    lanes: [],
    alternatives: [],
    reason: null,
    serverNow: NOW,
  }
}

/** 火曜（weekday=2）だけが定休の 1 週間。 */
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
let serve: (url: URL) => Promise<Response>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  asked = []
  sessionStorage.setItem('app.auth.token', 'header.payload.signature')
  serve = async (url) => {
    if (url.pathname.endsWith('/business-hours')) return json(HOURS)
    const date = (url.searchParams.get('date') ?? DATE) as LocalDate
    return json(availability(date, MOCK_SLOTS(date)))
  }
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://example.test')
      asked.push(url)
      return serve(url)
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

const availabilityCalls = () => asked.filter((url) => url.pathname === '/api/staff/availability')

function Harness() {
  const [draft, setDraft] = useState<ReceptionSessionDraft>(emptyDraft())
  const [guard, setGuard] = useState<StepGuard>({
    canProceed: false,
    blockedReason: 'まだ伺っていません',
  })
  const onGuardChange = useCallback((next: StepGuard) => setGuard(next), [])
  return (
    <div className="flex">
      <DateTimeStep
        storeId={STORE_ID}
        now={NOW}
        receptionSessionId={SESSION_ID}
        draft={draft}
        onDraftChange={setDraft}
        onGuardChange={onGuardChange}
      />
      <button type="button" aria-label={nextButtonLabel(guard)} disabled={!guard.canProceed} />
    </div>
  )
}

async function openStep() {
  render(<Harness />)
  await screen.findByRole('button', { name: '8月27日（木）　本日' })
}

describe('工程 1', () => {
  it('日付も時刻も選んでいないと「次へ進む」が押せず、理由が読み上げで分かる', async () => {
    await openStep()
    expect(
      screen.getByRole('button', { name: '次へ進む　お日にちとお時間をお選びになると進めます' }),
    ).toBeDisabled()
  })

  it('定休日の札に「定休」と書いてあり、押せない', async () => {
    await openStep()
    const closed = screen.getByRole('button', { name: '8月25日（火）　定休' })
    expect(closed).toBeDisabled()
    expect(closed).toHaveTextContent('定休')
  })

  it('埋まっている時刻の札に「満席」と書いてあり、押せない', async () => {
    await openStep()
    await userEvent.click(screen.getByRole('button', { name: '8月27日（木）　本日' }))
    const full = await screen.findByRole('button', { name: '11:30　満席' })
    expect(full).toBeDisabled()
    expect(full).toHaveTextContent('満席')
  })

  it('空いている時刻の札に残り枠数（あと2枠）が出る', async () => {
    await openStep()
    await userEvent.click(screen.getByRole('button', { name: '8月27日（木）　本日' }))
    const free = await screen.findByRole('button', { name: '11:00　あと2枠' })
    expect(free).toBeEnabled()
    expect(free).toHaveTextContent('あと2枠')
  })

  it('日付と時刻を 1 つずつ選ぶと「次へ進む」が押せるようになる', async () => {
    await openStep()
    await userEvent.click(screen.getByRole('button', { name: '8月27日（木）　本日' }))
    // 日だけでは進めない。何が足りないかを名前で言う。
    expect(
      await screen.findByRole('button', { name: '次へ進む　お時間をお選びになると進めます' }),
    ).toBeDisabled()
    await userEvent.click(await screen.findByRole('button', { name: '11:00　あと2枠' }))
    expect(await screen.findByRole('button', { name: '次へ進む' })).toBeEnabled()
  })

  it('右の要約に選んだ日と時刻が入り、目的とお客様は「このあと伺います」のまま', async () => {
    await openStep()
    await userEvent.click(screen.getByRole('button', { name: '8月27日（木）　本日' }))
    await userEvent.click(await screen.findByRole('button', { name: '11:00　あと2枠' }))
    const summary = screen.getByRole('complementary', { name: 'ここまでのご予約' })
    expect(summary).toHaveTextContent('2026年8月27日（木）')
    expect(summary).toHaveTextContent('11:00')
    expect(summary).toHaveTextContent('ご来店の目的このあと伺います')
    expect(summary).toHaveTextContent('お客様このあと伺います')
  })

  it('選んだ日の空き枠が 0 件なら、時刻の札がすべて「満席」になる', async () => {
    serve = async (url) => {
      if (url.pathname.endsWith('/business-hours')) return json(HOURS)
      const date = (url.searchParams.get('date') ?? DATE) as LocalDate
      return json(
        availability(
          date,
          MOCK_SLOTS(date).map((row) => ({ ...row, remaining: 0, isAvailable: false })),
        ),
      )
    }
    await openStep()
    await userEvent.click(screen.getByRole('button', { name: '8月27日（木）　本日' }))
    await waitFor(() => expect(screen.getAllByText('満席')).toHaveLength(8))
    expect(screen.queryByText(/あと\d+枠/)).toBeNull()
  })

  it('時刻の札は 1 画面 8 枚まで。残りは「ほかの時刻も見る」で開く', async () => {
    // サーバは営業時間ぶんの格子を全部返す（10:00–14:30 の 10 枠）。
    serve = async (url) => {
      if (url.pathname.endsWith('/business-hours')) return json(HOURS)
      return json(availability(DATE, [...MOCK_SLOTS(DATE), slot('15:00', 2), slot('15:30', 1)]))
    }
    await openStep()
    await userEvent.click(screen.getByRole('button', { name: '8月27日（木）　本日' }))
    await screen.findByRole('button', { name: '10:00　あと2枠' })
    expect(screen.queryByRole('button', { name: '15:00　あと2枠' })).not.toBeInTheDocument()

    const more = screen.getByRole('button', { name: 'ほかの時刻も見る（あと2件）' })
    expect(more.className).toContain('min-h-12')
    await userEvent.click(more)
    expect(screen.getByRole('button', { name: '15:00　あと2枠' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^ほかの時刻も見る/ })).not.toBeInTheDocument()
  })

  it('読み込み中は札の枠だけを出し、回るアイコンを置かない', async () => {
    const gate: { release: (() => void) | null } = { release: null }
    serve = async (url) => {
      if (url.pathname.endsWith('/business-hours')) return json(HOURS)
      await new Promise<void>((resolve) => {
        gate.release = resolve
      })
      return json(availability(DATE, MOCK_SLOTS()))
    }
    const { container } = render(<Harness />)
    await screen.findByRole('button', { name: '8月27日（木）　本日' })
    await userEvent.click(screen.getByRole('button', { name: '8月27日（木）　本日' }))
    await waitFor(() =>
      expect(container.querySelectorAll('[data-booking-slot-frame]')).toHaveLength(8),
    )
    expect(container.querySelector('[class*="animate"]')).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
    gate.release?.()
  })

  it('日を選び直すたびに空き枠を取り直す', async () => {
    await openStep()
    await userEvent.click(screen.getByRole('button', { name: '8月27日（木）　本日' }))
    await screen.findByRole('button', { name: '11:00　あと2枠' })
    await userEvent.click(screen.getByRole('button', { name: '8月28日（金）' }))
    await waitFor(() => expect(availabilityCalls()).toHaveLength(2))
    expect(availabilityCalls().at(-1)?.searchParams.get('date')).toBe('2026-08-28')
    // 自分の受付が置いた仮の押さえを塞がりに数えない。
    expect(availabilityCalls().at(-1)?.searchParams.get('excludeReceptionSessionId')).toBe(
      SESSION_ID,
    )
  })

  it('空き枠を読めなかったら、その事実ともう一度読む道を出す', async () => {
    serve = async (url) => {
      if (url.pathname.endsWith('/business-hours')) return json(HOURS)
      return json({ error: 'boom' }, 500)
    }
    await openStep()
    await userEvent.click(screen.getByRole('button', { name: '8月27日（木）　本日' }))
    expect(
      await screen.findByText('受け付けられる時刻を読み込めませんでした。'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeInTheDocument()
  })
})
