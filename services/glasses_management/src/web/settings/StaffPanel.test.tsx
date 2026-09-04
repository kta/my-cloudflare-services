import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsScreen } from './SettingsScreen'
import { StaffPanel } from './StaffPanel'

/*
 * スタッフと技能（SETTINGS-STAFF）。承認済みモック
 * docs/frontend/mockups/eye/images/SETTINGS-STAFF.png と同じ盤面
 * —— スタッフ 6名・佐藤 美咲の技能 3 つ・勤務の 7 列（日曜 12:00–19:00）——
 * を出せることと、技能と勤務を直して保存できることを固定する。
 *
 * 保存バーと知らせは器（SettingsScreen）が持つので、面はその器に差し込んで見る。
 * 本日は実時刻に依存させない（now を引数で渡す）。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
/** JST 2026-08-27（木）11:00。 */
const NOW = '2026-08-27T02:00:00.000Z'
/** 本日から 7 日。曜日がちょうど 1 回ずつ出る（木金土日月火水）。 */
const WINDOW = [
  '2026-08-27',
  '2026-08-28',
  '2026-08-29',
  '2026-08-30',
  '2026-08-31',
  '2026-09-01',
  '2026-09-02',
]

function weekly(weekday: number, opensAt: string | null, closesAt: string | null) {
  return {
    weekday,
    isClosed: opensAt === null,
    opensAt,
    closesAt,
    breakStart: null,
    breakEnd: null,
  }
}

const businessHours = {
  rows: [
    weekly(0, '10:00', '18:00'),
    weekly(1, '10:00', '19:00'),
    weekly(2, null, null),
    weekly(3, '10:00', '19:00'),
    weekly(4, '10:00', '19:00'),
    weekly(5, '11:00', '20:00'),
    weekly(6, '10:00', '19:00'),
  ],
  blackouts: [],
  version: 3,
  warnings: [],
}

type StaffRow = {
  id: string
  displayName: string
  kana: string | null
  jobLabel: string | null
  role: 'staff' | 'manager'
  isActive: boolean
  sortOrder: number
  skills: string[]
  adminUserId: string | null
  hasPin: boolean
  maxParallelReservations: number
  pinUpdatedAt: string | null
}

function member(index: number, over: Partial<StaffRow>): StaffRow {
  return {
    id: `2222${index}222-3333-4444-8555-666666666666`,
    displayName: '',
    kana: null,
    jobLabel: null,
    role: 'staff',
    isActive: true,
    sortOrder: index,
    skills: [],
    adminUserId: null,
    hasPin: true,
    maxParallelReservations: 1,
    pinUpdatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

/** SETTINGS-STAFF の一覧そのもの（6 人目が 山田 大輔（店長））。 */
const STAFF: StaffRow[] = [
  member(0, { displayName: '佐藤 美咲', skills: ['measure', 'processing', 'sales_reception'] }),
  member(1, { displayName: '高橋 健', skills: ['fitting', 'sales_reception'] }),
  member(2, { displayName: '中村 彩', skills: ['sales_reception'] }),
  member(3, { displayName: '小林 学', skills: ['measure'] }),
  member(4, { displayName: '渡辺 由紀', skills: ['sales_reception'] }),
  member(5, {
    displayName: '山田 大輔',
    jobLabel: '店長',
    role: 'manager',
    skills: ['sales_reception'],
  }),
]

/** 佐藤 美咲（一覧の 1 行目・既定で選ばれる担当）。 */
const SAKI = STAFF[0] as StaffRow

/** 佐藤 美咲の曜日テンプレート（月・水・木・土 10:00–19:00 / 日 12:00–19:00）。 */
const SAKI_WEEKLY: Record<number, { startsAt: string; endsAt: string } | null> = {
  0: { startsAt: '12:00', endsAt: '19:00' },
  1: { startsAt: '10:00', endsAt: '19:00' },
  2: null,
  3: { startsAt: '10:00', endsAt: '19:00' },
  4: { startsAt: '10:00', endsAt: '19:00' },
  5: null,
  6: { startsAt: '10:00', endsAt: '19:00' },
}

type ShiftRow = {
  id: string
  staffId: string
  date: string
  startsAt: string
  endsAt: string
  kind: 'work' | 'break'
}

function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay()
}

function initialShifts(): ShiftRow[] {
  const rows: ShiftRow[] = []
  for (const date of WINDOW) {
    const saki = SAKI_WEEKLY[weekdayOf(date)]
    if (saki) {
      rows.push({ id: crypto.randomUUID(), staffId: SAKI.id, date, ...saki, kind: 'work' })
    }
    // 山田 大輔だけ本日の勤務が無い（一覧に「本日はお休み」が出る）。
    for (const other of STAFF.slice(1, 5)) {
      rows.push({
        id: crypto.randomUUID(),
        staffId: other.id,
        date,
        startsAt: '10:00',
        endsAt: '19:00',
        kind: 'work',
      })
    }
  }
  return rows
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** この面が触る経路だけを持つ器。保存は状態を書き換え、勤務は曜日から展開し直す。 */
function mockApi(options: { saveStatus?: number; readStatus?: number } = {}) {
  const state = { staff: STAFF.map((row) => ({ ...row })), shifts: initialShifts() }
  const handler = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    if (options.readStatus && method === 'GET') return json({ error: 'boom' }, options.readStatus)
    if (url.includes('/business-hours')) return json(businessHours)

    if (url.includes('/staff-shifts')) {
      if (method === 'GET') return json(state.shifts)
      if (options.saveStatus) return json({ error: 'no' }, options.saveStatus)
      const rows = body.weekly as {
        weekday: number
        isOff: boolean
        startsAt: string | null
        endsAt: string | null
      }[]
      const kept = state.shifts.filter((row) => row.staffId !== body.staffId)
      const made: ShiftRow[] = []
      for (const date of WINDOW) {
        const row = rows.find((candidate) => candidate.weekday === weekdayOf(date))
        if (!row || row.isOff || row.startsAt === null || row.endsAt === null) continue
        made.push({
          id: crypto.randomUUID(),
          staffId: body.staffId,
          date,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          kind: 'work',
        })
      }
      state.shifts = [...kept, ...made]
      return json(made)
    }

    if (url.includes('/skills')) {
      if (options.saveStatus) return json({ error: 'no' }, options.saveStatus)
      const id = url.split('/').slice(-2)[0]
      state.staff = state.staff.map((row) =>
        row.id === id ? { ...row, skills: body.skills } : row,
      )
      return json(state.staff.find((row) => row.id === id))
    }

    if (url.includes('/staff')) {
      if (method === 'GET') {
        const list = url.includes('includeInactive=true')
          ? state.staff
          : state.staff.filter((row) => row.isActive)
        return json(list)
      }
      if (options.saveStatus) return json({ error: 'no' }, options.saveStatus)
      if (method === 'POST') {
        const row = member(state.staff.length, {
          id: crypto.randomUUID(),
          displayName: body.displayName,
          kana: body.kana,
          jobLabel: body.jobLabel,
          role: body.role,
          isActive: body.isActive,
          sortOrder: body.sortOrder,
          hasPin: false,
          pinUpdatedAt: null,
        })
        state.staff = [...state.staff, row]
        return json(row)
      }
      if (method === 'PATCH') {
        const id = url.split('/').pop() ?? ''
        state.staff = state.staff.map((row) =>
          row.id === id
            ? {
                ...row,
                isActive: body.isActive ?? row.isActive,
                role: body.role ?? row.role,
                maxParallelReservations:
                  body.maxParallelReservations ?? row.maxParallelReservations,
              }
            : row,
        )
        return json(state.staff.find((row) => row.id === id))
      }
    }
    return json({ error: 'not_found' }, 404)
  })
  vi.stubGlobal('fetch', handler)
  return { handler, state }
}

function renderPanel() {
  render(
    <SettingsScreen
      storeId={STORE_ID}
      now={NOW}
      initialSection="staff"
      panels={{ staff: StaffPanel }}
    />,
  )
}

async function openPanel() {
  renderPanel()
  await waitFor(() => expect(screen.getByText('スタッフ 6名')).toBeInTheDocument())
}

function skillChips() {
  return within(screen.getByRole('group', { name: 'できること（技能）' }))
}

function staffList() {
  return within(screen.getByRole('list', { name: 'スタッフ' })).getAllByRole('listitem')
}

beforeEach(() => {
  mockApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('スタッフの一覧', () => {
  it('左に「スタッフ　6名」が並び、6 人目は 山田 大輔（店長）である', async () => {
    await openPanel()
    const list = staffList()
    expect(list).toHaveLength(6)
    expect(list[5]).toHaveTextContent('山田 大輔')
    expect(list[5]).toHaveTextContent('店長・販売・受付')
  })

  it('本日の勤務が無い担当は「本日はお休み」と分かる', async () => {
    await openPanel()
    const list = staffList()
    expect(list[5]).toHaveTextContent('本日はお休み')
    expect(list[0]).not.toHaveTextContent('本日はお休み')
  })

  it('佐藤 美咲 を選ぶと右が「佐藤 美咲 の設定」になる', async () => {
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: /高橋 健/ }))
    expect(screen.getByRole('heading', { name: '高橋 健 の設定' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /佐藤 美咲/ }))
    expect(screen.getByRole('heading', { name: '佐藤 美咲 の設定' })).toBeInTheDocument()
  })

  it('PIN の行は「設定してあります」と出すが、この面では作り直せない', async () => {
    await openPanel()
    expect(screen.getByText('設定してあります')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '作り直す' })).not.toBeInTheDocument()
  })
})

describe('できること（技能）', () => {
  it('佐藤 美咲 の技能は 視力測定・加工・販売・受付 に ✓ が付いている', async () => {
    await openPanel()
    for (const label of ['視力測定', '加工', '販売・受付']) {
      expect(skillChips().getByRole('button', { name: label })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    }
    for (const label of ['フィッティング', 'コンタクトの相談', '修理・部品交換']) {
      expect(skillChips().getByRole('button', { name: label })).toHaveAttribute(
        'aria-pressed',
        'false',
      )
    }
  })

  it('技能の札は 6 枚である', async () => {
    await openPanel()
    expect(
      skillChips()
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual([
      '✓視力測定',
      '✓加工',
      '✓販売・受付',
      'フィッティング',
      'コンタクトの相談',
      '修理・部品交換',
    ])
  })

  it('技能の札は押せる大きさが 44pt 以上あり、✓ の有無が読み上げでも分かる', async () => {
    await openPanel()
    const chip = skillChips().getByRole('button', { name: 'フィッティング' })
    expect(chip).toHaveClass('min-h-11')
    expect(chip).toHaveAttribute('aria-pressed', 'false')
  })

  it('「フィッティング」を押して保存すると、左の一覧の佐藤 美咲の技能にフィッティングが加わる', async () => {
    await openPanel()
    await userEvent.click(skillChips().getByRole('button', { name: 'フィッティング' }))
    expect(screen.getByText('未保存の変更 1件')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.getByText('保存しました')).toBeInTheDocument())
    expect(staffList()[0]).toHaveTextContent('視力測定・加工・販売・受付・フィッティング')
  })
})

describe('勤務時間', () => {
  it('勤務時間は 月から日の 7 列で、日曜が 12:00–19:00 である', async () => {
    await openPanel()
    const days = screen.getAllByTestId('shift-day')
    expect(days.map((day) => day.getAttribute('data-weekday'))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '0',
    ])
    expect(screen.getByLabelText('日曜日の勤務の開始')).toHaveValue('12:00')
    expect(screen.getByLabelText('日曜日の勤務の終了')).toHaveValue('19:00')
    // 火曜は店の定休。人の「お休み」と書き分ける。
    expect(days[1]).toHaveTextContent('定休日')
  })

  it('日曜を 10:00–19:00 に直して保存し、開き直すと 10:00–19:00 になっている', async () => {
    await openPanel()
    fireEvent.change(screen.getByLabelText('日曜日の勤務の開始'), { target: { value: '10:00' } })
    expect(screen.getByText('未保存の変更 1件')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.getByText('保存しました')).toBeInTheDocument())
    expect(screen.getByLabelText('日曜日の勤務の開始')).toHaveValue('10:00')
    expect(screen.getByLabelText('日曜日の勤務の終了')).toHaveValue('19:00')
  })

  it('日曜の勤務が営業時間の外へ出ても保存でき、警告だけ出る', async () => {
    await openPanel()
    expect(
      screen.getByText('日曜日の勤務が営業時間（10:00–18:00）の外にはみ出しています。'),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('日曜日の勤務の終了'), { target: { value: '18:00' } })
    expect(
      screen.queryByText('日曜日の勤務が営業時間（10:00–18:00）の外にはみ出しています。'),
    ).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('日曜日の勤務の終了'), { target: { value: '20:00' } })
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.getByText('保存しました')).toBeInTheDocument())
    expect(
      screen.getByText('日曜日の勤務が営業時間（10:00–18:00）の外にはみ出しています。'),
    ).toBeInTheDocument()
  })

  it('曜日を「お休み」にすると時刻の欄が消える', async () => {
    await openPanel()
    await userEvent.click(screen.getByRole('checkbox', { name: '日曜日はお休み' }))
    expect(screen.queryByLabelText('日曜日の勤務の開始')).not.toBeInTheDocument()
    expect(screen.getByText('未保存の変更 1件')).toBeInTheDocument()
  })

  it('「お休み」は印だけでなく字も押せて、押せる大きさが 44pt 以上ある', async () => {
    await openPanel()
    const box = screen.getByRole('checkbox', { name: '日曜日はお休み' })
    const target = box.closest('label')
    expect(target).not.toBeNull()
    expect(target).toHaveTextContent('お休み')
    expect(target).toHaveClass('min-h-11')

    // 字を押しても入切が変わる（印の 20px だけが当たり判定ではない）。
    if (target) await userEvent.click(within(target).getByText('お休み'))
    expect(box).toBeChecked()
  })
})

describe('スタッフを足す・止める', () => {
  it('「＋ スタッフを足す」から お名前・ふりがな・できる役割・技能 を入れて保存すると「スタッフ 7名」になる', async () => {
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: '＋ スタッフを足す' }))
    const form = within(screen.getByRole('form', { name: 'スタッフを足す' }))
    await userEvent.type(form.getByLabelText('お名前'), '新井 花')
    await userEvent.type(form.getByLabelText('ふりがな'), 'あらい はな')
    await userEvent.selectOptions(form.getByLabelText('できる役割'), 'manager')
    await userEvent.click(form.getByRole('button', { name: '視力測定' }))
    await userEvent.click(form.getByRole('button', { name: 'このスタッフを足す' }))

    await waitFor(() => expect(screen.getByText('スタッフ 7名')).toBeInTheDocument())
    expect(staffList()[6]).toHaveTextContent('新井 花')
  })

  it('お名前が空のままでは足せない', async () => {
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: '＋ スタッフを足す' }))
    const form = within(screen.getByRole('form', { name: 'スタッフを足す' }))
    await userEvent.click(form.getByRole('button', { name: 'このスタッフを足す' }))
    expect(screen.getByText('お名前を入れてください。')).toBeInTheDocument()
    expect(screen.getByText('スタッフ 6名')).toBeInTheDocument()
  })

  it('「いま使える」を切ったスタッフの行は一覧から消えない', async () => {
    await openPanel()
    await userEvent.click(screen.getByRole('switch', { name: 'いま使える' }))
    expect(screen.getByText('止めています')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.getByText('保存しました')).toBeInTheDocument())
    expect(screen.getByText('スタッフ 6名')).toBeInTheDocument()
    expect(staffList()[0]).toHaveTextContent('佐藤 美咲')
  })

  it('「同時に受け持てるご予約」を変えると保存の対象になる', async () => {
    await openPanel()
    await userEvent.selectOptions(screen.getByLabelText('同時に受け持てるご予約'), '2')
    expect(screen.getByText('未保存の変更 1件')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.getByText('保存しました')).toBeInTheDocument())
    expect(screen.getByLabelText('同時に受け持てるご予約')).toHaveValue('2')
  })

  it('「変更を捨てる」を押すと打ち込んだ値が編集前へ戻る', async () => {
    await openPanel()
    await userEvent.click(skillChips().getByRole('button', { name: 'フィッティング' }))
    await userEvent.click(screen.getByRole('button', { name: '変更を捨てる' }))
    expect(skillChips().getByRole('button', { name: 'フィッティング' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.queryByText('未保存の変更 1件')).not.toBeInTheDocument()
  })
})

describe('読み込みと失敗', () => {
  it('読み込んでいる間はその旨を伝える', async () => {
    renderPanel()
    expect(screen.getByText('スタッフと技能を読み込んでいます…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('スタッフ 6名')).toBeInTheDocument())
  })

  it('読み込めなかったら理由と、その場でやり直す手立てを出す', async () => {
    mockApi({ readStatus: 500 })
    renderPanel()
    await waitFor(() =>
      expect(screen.getByText('スタッフと技能を読み込めませんでした。')).toBeInTheDocument(),
    )
    // 読み直す手立てをその場に置く（画面ごとの URL が無いので「開き直す」は実行できない）。
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeInTheDocument()
  })

  it('スタッフが 1 人もいなければ、その事実だけを出す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('/business-hours')) return json(businessHours)
        return json([])
      }),
    )
    renderPanel()
    await waitFor(() =>
      expect(screen.getByText('スタッフがまだ登録されていません。')).toBeInTheDocument(),
    )
  })

  it('保存が落ちたら「保存できませんでした。入力はそのまま残っています。」を出し、打ち込んだ値は残る', async () => {
    mockApi({ saveStatus: 500 })
    await openPanel()
    await userEvent.click(skillChips().getByRole('button', { name: 'フィッティング' }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(
        screen.getByText('保存できませんでした。入力はそのまま残っています。'),
      ).toBeInTheDocument(),
    )
    expect(skillChips().getByRole('button', { name: 'フィッティング' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText('未保存の変更 1件')).toBeInTheDocument()
  })

  it('保存が 403 で跳ねられたら店長だけができると伝え、打ち込んだ値は残る', async () => {
    mockApi({ saveStatus: 403 })
    await openPanel()
    await userEvent.click(skillChips().getByRole('button', { name: 'フィッティング' }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(screen.getByText('この操作は店長だけができます')).toBeInTheDocument(),
    )
    // 何を直したかは「下書きは残っています」の下にそのまま並ぶ（AC-SET-17）。
    expect(screen.getByText('佐藤 美咲 のできること（技能）')).toBeInTheDocument()
    expect(skillChips().getByRole('button', { name: 'フィッティング' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('保存が 409 なら、ほかの端末が先に保存したことを伝える', async () => {
    mockApi({ saveStatus: 409 })
    await openPanel()
    await userEvent.click(screen.getByRole('switch', { name: 'いま使える' }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(
        screen.getByText(
          'ほかの端末が先に保存しました。画面を開き直して、もう一度お試しください。',
        ),
      ).toBeInTheDocument(),
    )
  })
})
