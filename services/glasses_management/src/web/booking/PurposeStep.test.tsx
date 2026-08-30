import type {
  AvailabilityResponse,
  AvailabilitySlot,
  LocalDate,
  ReceptionSessionDraft,
  VisitPurpose,
} from '@app/contracts'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PurposeStep } from './PurposeStep'
import { emptyDraft, nextButtonLabel, type StepGuard } from './steps'

/*
 * 工程 2「ご来店の目的」（承認済みモック
 * docs/frontend/mockups/eyex/images/BOOK-02-PURPOSE.png と BOOK-02b-PURPOSE-CONFLICT.png）。
 *
 * 実測（screens/BOOK-02*.html の <style> と assets/eyex.css）:
 *   目的の札は 3 列・間 12px・最小高 96px・角 12px、題 17px/600、所要 13px、
 *   「✓ 選んでいます」12px/600。「お取りする時間」は 4 列・間 14px・最小高 64px。
 *   警告の箱は内側 24px 26px、見出し 21px、理由 15px（下 20px）、代替の札は最小高 56px・18px。
 *
 * 収まらないときも工程は戻さない。同じ面で時刻だけを選び直せる。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
const SESSION_ID = 'd0000000-0000-4000-8000-000000000001'
const NOW = '2026-08-27T02:08:00.000Z'
const DATE: LocalDate = '2026-08-27'

function at(clock: string): string {
  return new Date(Date.parse(`${DATE}T${clock}:00.000Z`) - 9 * 60 * 60 * 1000).toISOString()
}

function purpose(
  index: number,
  nameInternal: string,
  nameShort: string,
  durationMinutes: number,
  isWebPublished = true,
): VisitPurpose {
  return {
    id: `e0000000-0000-4000-8000-00000000000${index}`,
    storeId: null,
    nameInternal,
    namePublic: nameInternal,
    nameShort,
    durationMinutes,
    isWebPublished,
    isActive: true,
    sortOrder: index,
    requirements: [],
    version: 1,
  }
}

/** P1 の seed が入れる 6 件（`design/03-data-model.md` §6.1）。並び順もそのまま。 */
const PURPOSES: VisitPurpose[] = [
  purpose(1, 'メガネを新しく作る', '新調', 60),
  purpose(2, '今のメガネを調整したい', '調整', 20),
  purpose(3, 'できあがりを受け取る', '受取', 20),
  purpose(4, '修理・部品交換', '修理', 30, false),
  purpose(5, 'コンタクトの相談', 'CL', 40),
  purpose(6, '視力測定だけ', '測定', 30),
]

function slot(clock: string, endClock: string, isAvailable: boolean): AvailabilitySlot {
  return {
    startsAt: at(clock),
    endsAt: at(endClock),
    remaining: isAvailable ? 2 : 0,
    isAvailable,
    staffIds: [],
    equipmentIds: [],
    reason: isAvailable ? null : 'maintenance',
  }
}

function availability(
  durationMinutes: number,
  fits: boolean,
  alternatives: AvailabilitySlot[] = [],
  clock = '11:00',
  endClock = '12:00',
): AvailabilityResponse {
  return {
    date: DATE,
    opensAt: '10:00',
    closesAt: '19:00',
    isClosed: false,
    slotMinutes: 30,
    cleanupMinutes: 10,
    durationMinutes,
    slots: [slot(clock, endClock, fits)],
    lanes: [],
    alternatives,
    reason: null,
    serverNow: NOW,
  }
}

const THREE_ALTERNATIVES = [
  slot('10:00', '11:00', true),
  slot('13:00', '14:00', true),
  slot('15:30', '16:30', true),
]

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
    if (url.pathname === '/api/staff/purposes') return json(PURPOSES)
    return json(availability(Number(url.searchParams.get('durationMinutes') ?? 60), true))
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

const pickAnotherDay = vi.fn()

function Harness() {
  const [draft, setDraft] = useState<ReceptionSessionDraft>({
    ...emptyDraft(),
    startsAt: at('11:00'),
  })
  const [guard, setGuard] = useState<StepGuard>({
    canProceed: false,
    blockedReason: 'まだ伺っていません',
  })
  const onGuardChange = useCallback((next: StepGuard) => setGuard(next), [])
  return (
    <div className="flex">
      <PurposeStep
        storeId={STORE_ID}
        receptionSessionId={SESSION_ID}
        draft={draft}
        onDraftChange={setDraft}
        onGuardChange={onGuardChange}
        onPickAnotherDay={pickAnotherDay}
      />
      <button type="button" aria-label={nextButtonLabel(guard)} disabled={!guard.canProceed} />
    </div>
  )
}

async function openStep() {
  render(<Harness />)
  await screen.findByRole('button', { name: /メガネを新しく作る/ })
}

async function pickGlasses() {
  await openStep()
  await userEvent.click(screen.getByRole('button', { name: /メガネを新しく作る/ }))
}

describe('工程 2', () => {
  it('目的を押すと「✓ 選んでいます」が付き、お取りする時間の「60分 標準」が選ばれる', async () => {
    await pickGlasses()
    const picked = screen.getByRole('button', { name: /メガネを新しく作る/ })
    expect(picked).toHaveAttribute('aria-pressed', 'true')
    expect(picked).toHaveTextContent('✓ 選んでいます')
    expect(screen.getByRole('button', { name: '60分　標準' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('右の要約に「11:00–12:00 で受け付けられます。」が出て「次へ進む」が押せる', async () => {
    await pickGlasses()
    const summary = await screen.findByRole('complementary', { name: 'ここまでのご予約' })
    await waitFor(() => expect(summary).toHaveTextContent('11:00–12:00 で受け付けられます。'))
    expect(summary).toHaveTextContent('ご来店の目的メガネを新しく作る')
    expect(await screen.findByRole('button', { name: '次へ進む' })).toBeEnabled()
  })

  it('お取りする時間を 90分 に変えると、その所要で空き枠を取り直す', async () => {
    await pickGlasses()
    await waitFor(() => expect(availabilityCalls()).toHaveLength(1))
    await userEvent.click(screen.getByRole('button', { name: '90分　じっくり' }))
    await waitFor(() => expect(availabilityCalls()).toHaveLength(2))
    expect(availabilityCalls().at(-1)?.searchParams.get('durationMinutes')).toBe('90')
    expect(availabilityCalls().at(-1)?.searchParams.get('purposeIds')).toBe(PURPOSES[0]?.id)
  })

  it('目的の並びが設定（P1）の並び順と一致する', async () => {
    await openStep()
    const group = screen.getByRole('group', { name: 'ご来店の目的' })
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual([
      expect.stringContaining('メガネを新しく作る'),
      expect.stringContaining('今のメガネを調整したい'),
      expect.stringContaining('できあがりを受け取る'),
      expect.stringContaining('修理・部品交換'),
      expect.stringContaining('コンタクトの相談'),
      expect.stringContaining('視力測定だけ'),
    ])
  })

  it('目的を伺うまでは「次へ進む」が押せず、理由が読み上げで分かる', async () => {
    await openStep()
    expect(
      screen.getByRole('button', { name: '次へ進む　ご用件をお選びになると進めます' }),
    ).toBeDisabled()
  })
})

describe('収まらないとき', () => {
  async function openConflict(alternatives = THREE_ALTERNATIVES) {
    serve = async (url) => {
      if (url.pathname === '/api/staff/purposes') return json(PURPOSES)
      return json(
        availability(Number(url.searchParams.get('durationMinutes') ?? 60), false, alternatives),
      )
    }
    await pickGlasses()
    await screen.findByText('11:00 から60分の受付ができません')
  }

  it('「11:00 から60分の受付ができません」と理由が 1 文で出る', async () => {
    await openConflict()
    const card = screen.getByRole('group', { name: '受付できない時刻のご案内' })
    expect(within(card).getByRole('heading')).toHaveTextContent('11:00 から60分の受付ができません')
    expect(card).toHaveTextContent(
      '設備・場所の点検が入っています。近いお時間ですと、次のとおりお取りできます。',
    )
  })

  it('代わりに取れる時刻が 3 つまで並ぶ', async () => {
    await openConflict()
    const card = screen.getByRole('group', { name: '受付できない時刻のご案内' })
    expect(
      within(card)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['10:00–11:00', '13:00–14:00', '15:30–16:30'])
  })

  it('4 件返っても 3 件までしか並べず、1 件しか無ければ 1 件だけ並べる', async () => {
    const four = [...THREE_ALTERNATIVES, slot('17:00', '18:00', true)]
    await openConflict(four)
    const card = screen.getByRole('group', { name: '受付できない時刻のご案内' })
    expect(
      within(card)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['10:00–11:00', '13:00–14:00', '15:30–16:30'])
    cleanup()

    await openConflict([slot('13:00', '14:00', true)])
    expect(
      within(screen.getByRole('group', { name: '受付できない時刻のご案内' }))
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['13:00–14:00'])
  })

  it('収まらないあいだは「お取りする時間」の 4 列を出さない（警告の箱に場所を渡す）', async () => {
    await openConflict()
    expect(screen.queryByRole('group', { name: 'お取りする時間' })).not.toBeInTheDocument()
  })

  it('要約のご来店時刻に「受付できません」の札が付き、「次へ進む」が押せない', async () => {
    await openConflict()
    const summary = screen.getByRole('complementary', { name: 'ここまでのご予約' })
    expect(summary).toHaveTextContent('11:00受付できません')
    expect(summary).toHaveTextContent('所要時間約60分')
    expect(summary).toHaveTextContent('お時間だけ選び直せます。入力はそのまま残ります。')
    expect(
      screen.getByRole('button', { name: '次へ進む　お時間を選び直すと進めます' }),
    ).toBeDisabled()
  })

  it('代わりの時刻を押すと、目的と所要は残ったまま時刻だけ差し替わる', async () => {
    await openConflict()
    serve = async (url) => {
      if (url.pathname === '/api/staff/purposes') return json(PURPOSES)
      return json(
        availability(
          Number(url.searchParams.get('durationMinutes') ?? 60),
          true,
          [],
          '13:00',
          '14:00',
        ),
      )
    }
    await userEvent.click(screen.getByRole('button', { name: '13:00–14:00' }))
    const summary = screen.getByRole('complementary', { name: 'ここまでのご予約' })
    await waitFor(() => expect(summary).toHaveTextContent('ご来店時刻13:00'))
    expect(summary).toHaveTextContent('ご来店の目的メガネを新しく作る')
    expect(screen.getByRole('button', { name: '60分　標準' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(await screen.findByRole('button', { name: '次へ進む' })).toBeEnabled()
  })

  it('代わりの時刻が 0 件なら「この日は 60分 の枠が空いていません。」と「別の日を選ぶ」を出す', async () => {
    await openConflict([])
    expect(screen.getByText('この日は 60分 の枠が空いていません。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '別の日を選ぶ' }))
    expect(pickAnotherDay).toHaveBeenCalled()
  })
})
