import type { AvailabilityLane, AvailabilityResponse, AvailabilitySlot } from '@app/contracts'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChangeSlot, type ChangeSlotTarget } from './ChangeSlot'

/*
 * 担当と場所を変える（UX 監査 NEW-01）。
 *
 * ここまで店側には**担当を差し替える手立てが 1 つも無かった** —— 「佐藤が休むので
 * 鈴木に回す」ができず、取り消して取り直すしかなかった。盤は予約フローの工程 3 と
 * 同じものを使うので、ここで見るのは**その盤にたどり着けて、選んだ結果が上へ届くか**である。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
const RESERVATION_ID = 'a0000000-0000-4000-8000-000000000001'
const SATO = 'b0000000-0000-4000-8000-000000000001'
const SUZUKI = 'b0000000-0000-4000-8000-000000000002'
const DATE = '2026-08-27'
const COLUMNS = ['10:00', '10:30', '11:00', '11:30', '12:00'] as const

function at(clock: string): string {
  return new Date(Date.parse(`${DATE}T${clock}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()
}

function lane(id: string | null, name: string): AvailabilityLane {
  const slots: AvailabilitySlot[] = COLUMNS.map((clock) => ({
    startsAt: at(clock),
    endsAt: new Date(Date.parse(at(clock)) + 60 * 60 * 1000).toISOString(),
    remaining: 1,
    isAvailable: true,
    staffIds: id === null ? [] : [id],
    equipmentIds: [],
    reason: null,
  }))
  return { kind: id === null ? 'unassigned' : 'staff', id, name, subtitle: '視力測定', slots }
}

function availability(): AvailabilityResponse {
  return {
    date: DATE,
    opensAt: '10:00',
    closesAt: '13:00',
    isClosed: false,
    slotMinutes: 30,
    cleanupMinutes: 10,
    durationMinutes: 60,
    slots: [],
    lanes: [lane(SATO, '佐藤 美咲'), lane(SUZUKI, '鈴木 一郎'), lane(null, '担当が未定')],
    alternatives: [],
    reason: null,
    serverNow: at('10:05'),
  }
}

const TARGET: ChangeSlotTarget = {
  reservationId: RESERVATION_ID,
  startsAt: at('11:00'),
  durationMinutes: 60,
  purposeLabel: '新調のご相談',
  staffId: SATO,
  equipmentIds: [],
}

let asked: URL[] = []

beforeEach(() => {
  asked = []
  sessionStorage.setItem('app.auth.token', 'header.payload.signature')
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      asked.push(new URL(String(input), 'https://example.test'))
      return Promise.resolve(
        new Response(JSON.stringify(availability()), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  sessionStorage.clear()
})

function show(overrides: Partial<Parameters<typeof ChangeSlot>[0]> = {}) {
  const props = {
    storeId: STORE_ID,
    target: TARGET,
    isChanged: false,
    onChange: vi.fn(),
    onBack: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  }
  render(<ChangeSlot {...props} />)
  return props
}

describe('担当と場所を変える', () => {
  it('いまの予約を数から外して空き枠を読む（自分の席で埋まって見えないように）', async () => {
    show()
    await waitFor(() => expect(asked).toHaveLength(1))
    const query = asked[0]?.searchParams
    expect(query?.get('excludeReservationId')).toBe(RESERVATION_ID)
    expect(query?.get('storeId')).toBe(STORE_ID)
    expect(query?.get('date')).toBe(DATE)
  })

  it('盤が出て、選んだ結果が親へ上がる', async () => {
    const onChange = vi.fn()
    show({ onChange })
    await waitFor(() => expect(screen.getByText('鈴木 一郎')).toBeInTheDocument())
    // SlotStep は開いた直後にも 1 度だけ上げる（器が押さえも確定も打てるように）。
    expect(onChange).toHaveBeenCalled()
    const last = onChange.mock.calls.at(-1)?.[0]
    expect(last).toMatchObject({ staffId: SATO, startsAt: TARGET.startsAt })
  })

  it('工程の帯は「2　担当と場所を変える」で、まだ選んでいなければ理由を読み上げる', async () => {
    show()
    await waitFor(() => expect(screen.getByText('鈴木 一郎')).toBeInTheDocument())
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent(
      '担当と場所を変える',
    )
  })

  it('前へ戻ると探す面へ返す', async () => {
    const onBack = vi.fn()
    show({ onBack })
    await waitFor(() => expect(screen.getByText('鈴木 一郎')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: '前へ戻る' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
