import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CalendarPanel } from './CalendarPanel'
import { SettingsScreen } from './SettingsScreen'

/*
 * 営業日（SETTINGS-CALENDAR）。承認済みモック
 * docs/frontend/mockups/eyex/images/SETTINGS-CALENDAR.png と同じ盤面
 * —— 2026年8月・9月の 2 か月、毎週火曜の定休、9月30日の臨時のお休み、
 * 8月27日の本日 —— を出せることを固定する。
 *
 * 保存バーと知らせは器（SettingsScreen）が持つので、面はその器に差し込んで見る。
 * 寸法の突き合わせは e2e でやるので、ここでは「何が読めて、何が押せるか」を見る。
 * 本日は実時刻に依存させない（now を引数で渡す）。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
/** JST 2026-08-27（木）11:00。器がここから今日の暦日を導く。 */
const NOW = '2026-08-27T02:00:00.000Z'

const store = {
  id: STORE_ID,
  organizationId: 'eyex',
  name: 'EYEX 銀座店',
  slug: 'ginza',
  phone: '03-1234-5678',
  address: '東京都中央区銀座1-1-1',
  accessNote: '',
  isActive: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  namePublic: 'EYEX 銀座店',
  nearestStation: '銀座駅',
  parkingNote: null,
  introText: null,
  sortOrder: 0,
  updatedAt: null,
  updatedBy: null,
  settingsVersion: 3,
}

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

/** 銀座店の営業時間（火曜が定休 / 金曜だけ 11:00–20:00 / 日曜は 10:00–18:00）。 */
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

type ExceptionRow = {
  id: string
  date: string
  kind: 'closed' | 'special'
  opensAt: string | null
  closesAt: string | null
  note: string | null
}

const stocktaking: ExceptionRow = {
  id: '99999999-8888-4777-8666-555555555555',
  date: '2026-09-30',
  kind: 'closed',
  opensAt: null,
  closesAt: null,
  note: '棚卸しのため',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** D1 の代わりに、この面が触る経路だけを持つ器。保存は状態を書き換える。 */
function mockApi(
  options: { exceptions?: ExceptionRow[]; saveStatus?: number; readStatus?: number } = {},
) {
  const state = { exceptions: [...(options.exceptions ?? [])] }
  const handler = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (options.readStatus && method === 'GET') return json({ error: 'boom' }, options.readStatus)
    if (url.includes('/business-hours')) return json(businessHours)
    if (url.includes('/calendar-exceptions')) {
      if (method === 'GET') return json(state.exceptions)
      if (options.saveStatus) return json({ error: 'no' }, options.saveStatus)
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body)) as { date: string; kind: 'closed' | 'special' }
        const row: ExceptionRow = {
          id: crypto.randomUUID(),
          date: body.date,
          kind: body.kind,
          opensAt: null,
          closesAt: null,
          note: null,
        }
        state.exceptions = [...state.exceptions.filter((kept) => kept.date !== row.date), row]
        return json(row)
      }
      if (method === 'DELETE') {
        const id = url.split('/').pop() ?? ''
        state.exceptions = state.exceptions.filter((row) => row.id !== id)
        return json({ id, deleted: true })
      }
    }
    if (/\/api\/staff\/stores\/[^/]+$/.test(url)) return json(store)
    // 器が「いまの操作者」を引く経路。名乗りが取れなくても画面は止まらない。
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
      initialSection="calendar"
      panels={{ calendar: CalendarPanel }}
    />,
  )
}

async function openPanel() {
  renderPanel()
  await waitFor(() => expect(screen.getByRole('region', { name: '2026年8月' })).toBeInTheDocument())
}

beforeEach(() => {
  mockApi({ exceptions: [stocktaking] })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('2 か月のカレンダー', () => {
  it('2026年8月と2026年9月の 2 か月が並び、週は月曜から始まる', async () => {
    await openPanel()
    expect(screen.getByRole('region', { name: '2026年8月' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '2026年9月' })).toBeInTheDocument()
    const heads = within(screen.getByRole('region', { name: '2026年8月' })).getAllByTestId(
      'weekday-head',
    )
    expect(heads.map((head) => head.textContent)).toEqual([
      '月',
      '火',
      '水',
      '木',
      '金',
      '土',
      '日',
    ])
  })

  it('8月の定休は 4・11・18・25 で、丸の中に「休」が出る', async () => {
    await openPanel()
    const august = screen.getByRole('region', { name: '2026年8月' })
    const closed = august.querySelectorAll('[data-state="weekly-closed"]')
    expect([...closed].map((cell) => cell.getAttribute('data-date'))).toEqual([
      '2026-08-04',
      '2026-08-11',
      '2026-08-18',
      '2026-08-25',
    ])
    for (const cell of closed) expect(cell).toHaveTextContent('休')
  })

  it('9月の定休は 1・8・15・22・29 である', async () => {
    await openPanel()
    const september = screen.getByRole('region', { name: '2026年9月' })
    const closed = september.querySelectorAll('[data-state="weekly-closed"]')
    expect([...closed].map((cell) => cell.getAttribute('data-date'))).toEqual([
      '2026-09-01',
      '2026-09-08',
      '2026-09-15',
      '2026-09-22',
      '2026-09-29',
    ])
  })

  it('2026年8月27日に本日の輪が付く', async () => {
    await openPanel()
    const today = screen.getByRole('button', { name: '8月27日（木） 営業 本日' })
    expect(today).toHaveClass('border-3', 'border-pine')
  })

  it('丸の読み上げ名は日付と状態の両方を持つ', async () => {
    await openPanel()
    expect(screen.getByRole('button', { name: '9月30日（水） 臨時のお休み' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '8月28日（金） 営業' })).toBeInTheDocument()
  })

  it('丸は押せる大きさが 44pt 以上ある', async () => {
    await openPanel()
    // モックの丸は 40px。見た目を変えず、当たり判定だけ上下左右へ 2px 広げて 44pt にする。
    const day = screen.getByRole('button', { name: '8月28日（金） 営業' })
    expect(day).toHaveClass('size-10', 'relative', 'before:absolute', 'before:-inset-0.5')
  })

  it('「この店舗で予約を受け付ける」は入切を持つ切り替えとして読まれる', async () => {
    await openPanel()
    const toggle = screen.getByRole('switch', { name: 'この店舗で予約を受け付ける' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    // 色だけで伝えない。
    expect(screen.getByText('受け付けています')).toBeInTheDocument()
  })
})

describe('臨時のお休みを入れ替える', () => {
  it('9月30日の丸を押して保存すると、その日が休みの見た目になり「臨時のお休み」に「9月30日（水）」が入る', async () => {
    mockApi({ exceptions: [] })
    await openPanel()
    expect(screen.getByText('臨時のお休みはありません')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '9月30日（水） 営業' }))
    expect(screen.getByText('未保存の変更 1件')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(screen.getByText('保存しました')).toBeInTheDocument())
    const stopped = screen.getByRole('button', { name: '9月30日（水） 臨時のお休み' })
    expect(stopped).toHaveTextContent('休')
    expect(screen.getByTestId('closed-days')).toHaveTextContent('9月30日（水）')
    expect(screen.queryByText('未保存の変更 1件')).not.toBeInTheDocument()
  })

  it('休みの日をもう一度押して保存すると営業日へ戻り、「臨時のお休み」から消える', async () => {
    await openPanel()
    expect(screen.getByTestId('closed-days')).toHaveTextContent('9月30日（水）')
    expect(screen.getByTestId('closed-days')).toHaveTextContent('棚卸しのため')

    await userEvent.click(screen.getByRole('button', { name: '9月30日（水） 臨時のお休み' }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(screen.getByText('保存しました')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '9月30日（水） 営業' })).toBeInTheDocument()
    expect(screen.getByText('臨時のお休みはありません')).toBeInTheDocument()
  })

  it('「変更を捨てる」を押すと丸が元へ戻り、札が消える', async () => {
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: '8月28日（金） 営業' }))
    expect(screen.getByText('未保存の変更 1件')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '変更を捨てる' }))
    expect(screen.getByRole('button', { name: '8月28日（金） 営業' })).toBeInTheDocument()
    expect(screen.queryByText('未保存の変更 1件')).not.toBeInTheDocument()
  })

  it('同じ丸を 2 度押して元へ戻したら、未保存の札は消える', async () => {
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: '8月28日（金） 営業' }))
    expect(screen.getByText('未保存の変更 1件')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '8月28日（金） 臨時のお休み' }))
    expect(screen.queryByText('未保存の変更 1件')).not.toBeInTheDocument()
  })

  it('定休の日は押せない（曜日の休みは営業時間の面で決める）', async () => {
    await openPanel()
    expect(screen.queryByRole('button', { name: /8月4日（火）/ })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '2026年8月' })).toHaveTextContent('定休日')
  })
})

describe('読み込みと失敗', () => {
  it('読み込んでいる間はその旨を伝える', async () => {
    mockApi({ exceptions: [] })
    renderPanel()
    expect(screen.getByText('営業日を読み込んでいます…')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('region', { name: '2026年8月' })).toBeInTheDocument(),
    )
  })

  it('読み込めなかったら理由と、その場でやり直す手立てを出す', async () => {
    mockApi({ readStatus: 500 })
    renderPanel()
    await waitFor(() =>
      expect(screen.getByText('営業日を読み込めませんでした。')).toBeInTheDocument(),
    )
    // 読み直す手立てをその場に置く（画面ごとの URL が無いので「開き直す」は実行できない）。
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeInTheDocument()
  })

  it('保存が落ちたら「保存できませんでした。入力はそのまま残っています。」を出し、押した丸は残る', async () => {
    mockApi({ exceptions: [], saveStatus: 500 })
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: '9月30日（水） 営業' }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(
        screen.getByText('保存できませんでした。入力はそのまま残っています。'),
      ).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: '9月30日（水） 臨時のお休み' })).toBeInTheDocument()
    expect(screen.getByText('未保存の変更 1件')).toBeInTheDocument()
  })

  it('保存が 403 で跳ねられたら店長だけができると伝え、打ち込んだ変更が残る', async () => {
    mockApi({ exceptions: [], saveStatus: 403 })
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: '9月30日（水） 営業' }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(screen.getByText('この操作は店長だけができます')).toBeInTheDocument(),
    )
    // 何を直したかは「下書きは残っています」の下にそのまま並ぶ（AC-SET-17）。
    expect(screen.getByText('9月30日（水）を臨時のお休みにする')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '9月30日（水） 臨時のお休み' })).toBeInTheDocument()
  })

  it('保存が 409 なら、ほかの端末が先に保存したことを伝える', async () => {
    mockApi({ exceptions: [], saveStatus: 409 })
    await openPanel()
    await userEvent.click(screen.getByRole('button', { name: '9月30日（水） 営業' }))
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
