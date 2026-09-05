import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsScreen } from './SettingsScreen'

/*
 * 営業時間（承認済みモック docs/frontend/mockups/eyex/images/SETTINGS-HOURS.png）。
 * お昼の帯はモックの「13:00–14:00」ではなく 12:00–13:00 が正しい（P1 の決め #6）。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
/** 銀座店の通常の営業時間に合う曜日（月・水・木・土）。帯はこの 4 曜日が持つ。 */
const BASE_WEEKDAYS = [1, 3, 4, 6]

const hoursRows = [
  { weekday: 0, isClosed: false, opensAt: '10:00', closesAt: '18:00' },
  { weekday: 1, isClosed: false, opensAt: '10:00', closesAt: '19:00' },
  { weekday: 2, isClosed: true, opensAt: null, closesAt: null },
  { weekday: 3, isClosed: false, opensAt: '10:00', closesAt: '19:00' },
  { weekday: 4, isClosed: false, opensAt: '10:00', closesAt: '19:00' },
  { weekday: 5, isClosed: false, opensAt: '11:00', closesAt: '20:00' },
  { weekday: 6, isClosed: false, opensAt: '10:00', closesAt: '19:00' },
].map((row) => ({ ...row, breakStart: null, breakEnd: null }))

const bands = [
  { label: '朝の支度', startsAt: '10:00', endsAt: '10:15' },
  { label: 'お昼の休憩', startsAt: '12:00', endsAt: '13:00' },
  { label: '閉店前の片付け', startsAt: '18:40', endsAt: '19:00' },
]

const blackouts = BASE_WEEKDAYS.flatMap((weekday) =>
  bands.map((band, index) => ({
    id: `${weekday}0000000-0000-4000-8000-00000000000${index}`,
    weekday,
    startsAt: band.startsAt,
    endsAt: band.endsAt,
    label: band.label,
    sortOrder: index,
  })),
)

const hoursView = { rows: hoursRows, blackouts, version: 3, warnings: [] }

const slotRules = {
  slotMinutes: 30,
  cleanupMinutes: 10,
  maxParallel: 3,
  version: 3,
  updatedAt: '2026-08-20T01:00:00.000Z',
  lastAcceptableAt: {
    '0': '17:20',
    '1': '18:20',
    '2': null,
    '3': '18:20',
    '4': '18:20',
    '5': '19:20',
    '6': '18:20',
  },
  warnings: [],
}

let sent: { url: string; method: string; body: unknown }[] = []

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  sent = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      const method = (init.method ?? 'GET').toUpperCase()
      sent.push({
        url,
        method,
        body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
      })
      // 保存が通ると版が 1 だけ上がる。2 本目の PUT はその版を持ち越す。
      if (url.endsWith('/business-hours'))
        return json(method === 'PUT' ? { ...hoursView, version: 4 } : hoursView)
      if (url.endsWith('/slot-rules'))
        return json(method === 'PUT' ? { ...slotRules, version: 5 } : slotRules)
      if (url.endsWith('/staff')) return json([])
      // ご用件はいちばん短い所要（20分）を出す。「最後にお受けできる時刻」を下書きから引き直すのに要る。
      if (url.includes('/purposes'))
        return json([
          { id: 'p1', name: '今のメガネを調整したい', durationMinutes: 20, isActive: true },
          { id: 'p2', name: 'メガネを新しく作る', durationMinutes: 60, isActive: true },
        ])
      return json({ error: 'not_found' }, 404)
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

async function openHours() {
  // JST 2026-08-27（木）10:00。最後にお受けできる時刻を実行日に依存させない。
  render(
    <SettingsScreen storeId={STORE_ID} initialSection="hours" now="2026-08-27T01:00:00.000Z" />,
  )
  await screen.findByLabelText('開店')
}

/** 「受付を止める時間帯」の行（1 行 = 名前・開始・終了）。 */
function bandRows() {
  return screen.getAllByRole('group', { name: /受付を止める時間帯 \d+/ })
}

describe('営業時間', () => {
  it('左に「通常の営業時間」、右に「受付を止める時間帯」が並ぶ', async () => {
    await openHours()
    expect(screen.getByRole('group', { name: '通常の営業時間' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: '受付を止める時間帯' })).toBeInTheDocument()
  })

  it('通常の営業時間は 開店 10:00・閉店 19:00 を出す', async () => {
    await openHours()
    expect(screen.getByLabelText('開店')).toHaveValue('10:00')
    expect(screen.getByLabelText('閉店')).toHaveValue('19:00')
  })

  it('受付を止める時間帯は 朝の支度 10:00–10:15・お昼の休憩 12:00–13:00・閉店前の片付け 18:40–19:00 の 3 行を出す', async () => {
    await openHours()
    const rows = bandRows()
    expect(rows).toHaveLength(3)
    const seen = rows.map((row) => [
      (within(row).getByLabelText('名前') as HTMLInputElement).value,
      (within(row).getByLabelText('開始') as HTMLInputElement).value,
      (within(row).getByLabelText('終了') as HTMLInputElement).value,
    ])
    expect(seen).toEqual([
      ['朝の支度', '10:00', '10:15'],
      ['お昼の休憩', '12:00', '13:00'],
      ['閉店前の片付け', '18:40', '19:00'],
    ])
  })

  it('「＋ 止める時間帯を足す」を押して名前と時間帯を入れると、行が 1 つ増える', async () => {
    await openHours()
    await userEvent.click(screen.getByRole('button', { name: '＋ 止める時間帯を足す' }))
    await userEvent.type(screen.getByLabelText('足す時間帯の名前'), '棚卸し')
    fireEvent.change(screen.getByLabelText('足す時間帯の開始'), { target: { value: '15:00' } })
    fireEvent.change(screen.getByLabelText('足す時間帯の終了'), { target: { value: '15:30' } })
    await userEvent.click(screen.getByRole('button', { name: '足す' }))
    expect(bandRows()).toHaveLength(4)
    expect(screen.getByText('未保存の変更 1件')).toBeInTheDocument()
  })

  it('閉店を開店と同じ時刻にして保存すると「閉店が開店より前のため保存できません。閉店の時刻を直してください。」と出て保存されない', async () => {
    await openHours()
    fireEvent.change(screen.getByLabelText('閉店'), { target: { value: '10:00' } })
    expect(
      screen.getByText('閉店が開店より前のため保存できません。閉店の時刻を直してください。'),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(sent.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('止める時間帯を営業時間の外にすると同じ 2 文の型で拒む', async () => {
    await openHours()
    const last = bandRows()[2] as HTMLElement
    fireEvent.change(within(last).getByLabelText('終了'), { target: { value: '20:00' } })
    expect(
      screen.getByText(
        '受付を止める時間帯が営業時間の外にあるため保存できません。時間を直してください。',
      ),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(sent.some((call) => call.method === 'PUT')).toBe(false)
  })

  it('曜日ごとの上書きは 火曜日 お休み（定休日）・金曜日 11:00–20:00・日曜日 10:00–18:00・月・水・木・土曜日 通常どおり を出す', async () => {
    await openHours()
    const group = screen.getByRole('group', { name: '曜日ごとの上書き' })
    const lines = within(group)
      .getAllByRole('listitem')
      .map((li) => li.textContent?.replace(/\s+/g, ''))
    // 基準と違う曜日は**その場で直せる**（読むだけだったころ、金曜だけ 11:00 開店に
    // したい店は設定の画面では変えられなかった。実装不足の洗い出し settings-03）。
    expect(lines[0]).toContain('火曜日')
    expect(lines[0]).toContain('お休み（定休日）')
    expect(lines[3]).toBe('月・水・木・土曜日通常どおり')
    expect(within(group).getByLabelText('金曜日の開店')).toHaveValue('11:00')
    expect(within(group).getByLabelText('金曜日の閉店')).toHaveValue('20:00')
    expect(within(group).getByLabelText('日曜日の開店')).toHaveValue('10:00')
  })

  it('曜日ごとの上書きを直して保存すると、その曜日だけが変わる', async () => {
    await openHours()
    const group = screen.getByRole('group', { name: '曜日ごとの上書き' })
    fireEvent.change(within(group).getByLabelText('金曜日の開店'), {
      target: { value: '12:00' },
    })
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.getByText('保存しました')).toBeInTheDocument())

    const put = sent.find((call) => call.url.endsWith('/business-hours') && call.method === 'PUT')
    const rows = (put?.body as { rows: { weekday: number; opensAt: string | null }[] }).rows
    expect(rows.find((row) => row.weekday === 5)?.opensAt).toBe('12:00')
    // ほかの曜日は動かさない。
    expect(rows.find((row) => row.weekday === 0)?.opensAt).toBe('10:00')
  })

  it('お休みと営業日を行き来できる（片道にしない）', async () => {
    await openHours()
    const group = screen.getByRole('group', { name: '曜日ごとの上書き' })
    const tuesday = within(group).getAllByRole('listitem')[0]
    expect(tuesday).toBeDefined()
    await userEvent.click(
      within(tuesday as HTMLElement).getByRole('button', { name: '営業日にする' }),
    )
    expect(within(group).getByLabelText('火曜日の開店')).toBeInTheDocument()
    await userEvent.click(
      within(tuesday as HTMLElement).getByRole('button', { name: 'お休みにする' }),
    )
    expect(within(group).queryByLabelText('火曜日の開店')).toBeNull()
  })

  it('予約の間隔は 片付け 10分・刻み 30分ごと・同じ時刻に受けられる件数 3件まで を出す', async () => {
    await openHours()
    const group = screen.getByRole('group', { name: '予約の間隔' })
    expect(within(group).getByLabelText('1件あたりの片付け時間')).toHaveValue(10)
    expect(within(group).getByLabelText('予約をお受けする刻み')).toHaveValue(30)
    expect(within(group).getByLabelText('同じ時刻に受けられる件数')).toHaveValue(3)
    expect(group.textContent?.replace(/\s+/g, '')).toContain('分ごと')
    expect(group.textContent?.replace(/\s+/g, '')).toContain('件まで')
  })

  it('「木曜日に最後にお受けできるのは 18:20 です。」を出す', async () => {
    await openHours()
    expect(
      await screen.findByText('木曜日に最後にお受けできるのは 18:20 です。'),
    ).toBeInTheDocument()
  })

  it('刻みを片付けより短くすると警告を 1 行出し、保存は押せたままである', async () => {
    await openHours()
    fireEvent.change(screen.getByLabelText('予約をお受けする刻み'), { target: { value: '5' } })
    expect(
      screen.getByText(
        '予約の刻み（5分）が 1件あたりの片付け（10分）より短いため、続けてお受けできない時刻ができます。',
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('時刻の欄は数字の入力になっている', async () => {
    await openHours()
    expect(screen.getByLabelText('開店')).toHaveAttribute('type', 'time')
    expect(screen.getByLabelText('閉店')).toHaveAttribute('type', 'time')
    expect(within(bandRows()[0] as HTMLElement).getByLabelText('開始')).toHaveAttribute(
      'type',
      'time',
    )
    expect(screen.getByLabelText('予約をお受けする刻み')).toHaveAttribute('inputmode', 'numeric')
  })

  it('保存すると営業時間と予約の間隔をこの順で送り、版を持ち越す', async () => {
    await openHours()
    fireEvent.change(screen.getByLabelText('閉店'), { target: { value: '19:30' } })
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('保存しました')
    const puts = sent.filter((call) => call.method === 'PUT')
    expect(puts.map((call) => call.url.split('/').at(-1))).toEqual(['business-hours', 'slot-rules'])
    expect(puts.map((call) => (call.body as { version: number }).version)).toEqual([3, 4])
  })
})

describe('最後にお受けできる時刻', () => {
  /*
   * 保存済みの値をそのまま出していたころ、閉店を直してもこの 1 行は動かず、
   * 保存する前に何が起きるかを確かめる役に立たなかった
   * （実装不足の洗い出し settings-02）。
   */
  it('閉店を早めると、その場で早まる（保存の前に確かめられる）', async () => {
    await openHours()
    expect(await screen.findByText('木曜日に最後にお受けできるのは 18:20 です。')).toBeVisible()

    fireEvent.change(screen.getByLabelText('閉店'), { target: { value: '18:00' } })
    // 18:00 − 片付け 10分 − いちばん短いご用件 20分 = 17:30。
    expect(await screen.findByText('木曜日に最後にお受けできるのは 17:30 です。')).toBeVisible()
  })

  it('受付を止める帯を伸ばしても引き直す', async () => {
    await openHours()
    const ends = screen.getAllByLabelText('終了')
    const last = ends[ends.length - 1]
    expect(last).toBeDefined()
    fireEvent.change(last as HTMLElement, { target: { value: '19:00' } })
    // 閉店まで止めたので、その帯の前の窓から引き直す。
    expect(
      await screen.findByText(/木曜日に最後にお受けできるのは \d{1,2}:\d{2} です。/),
    ).toBeVisible()
  })
})
