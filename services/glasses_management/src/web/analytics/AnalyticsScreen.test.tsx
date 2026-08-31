import type { AnalyticsMetric, AnalyticsReport } from '@app/contracts'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnalyticsScreen } from './AnalyticsScreen'

/*
 * 分析の器（P9 T-012）。承認済みモック ANALYTICS-TOP.png の
 * タブ帯（8 つ）＋ツールバー（対象の期間・適用・店舗）を立て、
 * **「適用」を押したときだけ集計する**ことをここで固定する。
 */

const GINZA = '11111111-2222-4333-8444-555555555555'
const MARUNOUCHI = '11111111-2222-4333-8444-666666666666'
const STORES = [
  { id: GINZA, name: '銀座店' },
  { id: MARUNOUCHI, name: '丸の内店' },
]
/** JST 2026-08-27（木）11:08。モックの時刻。 */
const NOW = '2026-08-27T02:08:00.000Z'

const TABS = [
  'トップ',
  '予約数',
  '予約の入口',
  '取り消し',
  '来店回数',
  '担当者',
  'ご来店の目的',
  'お待ち時間',
]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 店舗と期間で数字が変わる、形だけの応答。 */
function report(params: URLSearchParams, empty: boolean, rich = false): AnalyticsReport {
  const metric = params.get('metric') as AnalyticsMetric
  const from = params.get('from') ?? '2026-08-01'
  const to = params.get('to') ?? '2026-08-31'
  const base = params.get('storeId') === MARUNOUCHI ? 5 : 12
  const month = Number(from.slice(5, 7))
  return {
    metric,
    from,
    to,
    granularity: params.get('granularity') === 'month' ? 'month' : 'day',
    countBy: 'visit_date',
    series: empty
      ? [{ name: '件数', pattern: 'solid', points: [] }]
      : [
          {
            name: '件数',
            pattern: 'solid',
            points: [
              {
                key: `${from.slice(0, 7)}-20`,
                label: '8/20',
                value: base + month,
                secondaryValue: null,
                isClosed: false,
                isOverTarget: false,
              },
              ...(rich
                ? [
                    {
                      key: `${from.slice(0, 7)}-25`,
                      label: '8/25',
                      value: 0,
                      secondaryValue: null,
                      isClosed: true,
                      isOverTarget: false,
                    },
                  ]
                : []),
            ],
          },
        ],
    summary: empty
      ? []
      : [{ label: '合計', value: String(base + month), unit: '件', isOverTarget: false }],
    target: null,
    suppressed: false,
    businessDays: 27,
    pendingDays: rich ? 2 : 0,
  }
}

type Options = { empty?: boolean; status?: number; hold?: boolean; rich?: boolean }

function mockApi(options: Options = {}) {
  const calls: URLSearchParams[] = []
  let release: (() => void) | null = null
  const handler = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname === '/api/staff/analytics/targets') {
      return json({ waitMinutes: 8, cancellationRatePercent: 10, revisitWindowDays: 90 })
    }
    if (url.pathname === '/api/staff/analytics') {
      calls.push(url.searchParams)
      if (options.status) return json({ error: 'boom' }, options.status)
      if (options.hold) {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return json(report(url.searchParams, options.empty === true, options.rich === true))
    }
    return json({ error: 'not_found' }, 404)
  })
  vi.stubGlobal('fetch', handler)
  return { calls, release: () => release?.() }
}

function renderScreen() {
  render(<AnalyticsScreen storeId={GINZA} stores={STORES} now={NOW} />)
}

async function openScreen() {
  renderScreen()
  await waitFor(() => expect(screen.getByTestId('definition')).toBeInTheDocument())
}

beforeEach(() => {
  // `?tab=` は replaceState で残るので、テストの間で持ち越さない。
  window.history.replaceState(null, '', '/')
  mockApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('タブ', () => {
  it('8 つのタブが決まった並びで出る', async () => {
    await openScreen()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(TABS)
  })

  it('いま開いているタブが読み上げで分かる（aria-selected）', async () => {
    await openScreen()
    expect(screen.getByRole('tab', { name: 'トップ' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: '担当者' }))
    expect(screen.getByRole('tab', { name: '担当者' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'トップ' })).toHaveAttribute('aria-selected', 'false')
  })

  it('押しても何も出ないタブが 1 つも無い（8 つすべてでグラフ 1 つと定義の 1 行が出る）', async () => {
    await openScreen()
    for (const name of TABS) {
      await userEvent.click(screen.getByRole('tab', { name }))
      await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1))
      expect(screen.getByTestId('definition').textContent).toBeTruthy()
    }
  })
})

describe('ツールバー', () => {
  it('対象の期間を変えるだけでは数字が変わらない', async () => {
    const api = mockApi()
    await openScreen()
    expect(api.calls).toHaveLength(1)
    const shown = screen.getByTestId('summary-value').textContent
    await userEvent.selectOptions(screen.getByLabelText('対象の期間'), '2026-07')
    expect(api.calls).toHaveLength(1)
    expect(screen.getByTestId('summary-value').textContent).toBe(shown)
  })

  it('適用を押したときにだけ集計し直す', async () => {
    const api = mockApi()
    await openScreen()
    await userEvent.click(screen.getByRole('tab', { name: '予約数' }))
    await waitFor(() => expect(api.calls).toHaveLength(2))
    await userEvent.selectOptions(screen.getByLabelText('対象の期間'), '2026-07')
    expect(api.calls).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: '適用' }))
    await waitFor(() => expect(api.calls).toHaveLength(3))
    expect(api.calls[2]?.get('from')).toBe('2026-07-01')
    expect(api.calls[2]?.get('to')).toBe('2026-07-31')
  })

  it('トップは当月のあいだ本日を中心に前後7日を要求する（月の初日から末日ではない）', async () => {
    const api = mockApi()
    await openScreen()
    // 見出しが「本日を中心に前後7日」と言う以上、要求する期間もそれでなければならない。
    expect(api.calls[0]?.get('from')).toBe('2026-08-20')
    expect(api.calls[0]?.get('to')).toBe('2026-09-03')
  })

  it('トップでも別の月を適用すれば、その月の初日から末日を要求する', async () => {
    // 「対象の期間」の札はトップにも出ている。押しても何も起きない札は置かない
    //（AC-ANA-03・AC-ANA-15・AC-ANA-19 はトップで別の月を適用したときの面を言う）。
    const api = mockApi()
    await openScreen()
    await userEvent.selectOptions(screen.getByLabelText('対象の期間'), '2026-07')
    await userEvent.click(screen.getByRole('button', { name: '適用' }))
    await waitFor(() => expect(api.calls).toHaveLength(2))
    expect(api.calls[1]?.get('from')).toBe('2026-07-01')
    expect(api.calls[1]?.get('to')).toBe('2026-07-31')
    // 当月へ戻せば、また本日を中心に前後 7 日へ戻る。
    await userEvent.selectOptions(screen.getByLabelText('対象の期間'), '2026-08')
    await userEvent.click(screen.getByRole('button', { name: '適用' }))
    await waitFor(() => expect(api.calls).toHaveLength(3))
    expect(api.calls[2]?.get('from')).toBe('2026-08-20')
    expect(api.calls[2]?.get('to')).toBe('2026-09-03')
  })

  it('取り消しのタブだけ期間の札が 2 つ並ぶ', async () => {
    await openScreen()
    expect(screen.getByLabelText('対象の期間')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: '取り消し' }))
    await waitFor(() => expect(screen.getByLabelText('対象の期間（開始）')).toBeInTheDocument())
    expect(screen.getByLabelText('対象の期間（終了）')).toBeInTheDocument()
    expect(screen.queryByLabelText('対象の期間')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: '担当者' }))
    await waitFor(() => expect(screen.getByLabelText('対象の期間')).toBeInTheDocument())
  })

  it('店舗を変えて適用すると、その店舗の数字に入れ替わる', async () => {
    const api = mockApi()
    await openScreen()
    expect(screen.getByTestId('summary-value')).toHaveTextContent('20')
    await userEvent.selectOptions(screen.getByLabelText('店舗'), MARUNOUCHI)
    await userEvent.click(screen.getByRole('button', { name: '適用' }))
    await waitFor(() => expect(screen.getByTestId('summary-value')).toHaveTextContent('13'))
    expect(api.calls[1]?.get('storeId')).toBe(MARUNOUCHI)
  })
})

describe('定義の 1 行', () => {
  it('何を・いつを基準に・どれだけの母数で数えたかが 1 行で読める', async () => {
    await openScreen()
    const text = screen.getByTestId('definition').textContent ?? ''
    expect(text).toContain('2026年8月')
    expect(text).toContain('ご来店日')
    expect(text).toContain('営業日数27日')
    expect(text).toContain('20件')
    expect(text).not.toContain('名')
  })
})

describe('読み込み中', () => {
  it('読み込んでいる間は前の数字を残さず、読み込み中であることを出す', async () => {
    const api = mockApi({ hold: true })
    renderScreen()
    expect(await screen.findByRole('status')).toHaveTextContent('読み込んでいます')
    expect(screen.queryByTestId('summary-value')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    api.release()
  })
})

describe('空', () => {
  it('期間に 1 件も無ければ、その事実だけを 1 行で出す', async () => {
    mockApi({ empty: true })
    renderScreen()
    expect(await screen.findByText('この期間に数えられるご予約はありません。')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('エラー', () => {
  it('読めなかったときは理由と次の行動を出し、グラフの枠を残さない', async () => {
    mockApi({ status: 500 })
    renderScreen()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('数字を読み込めませんでした')
    expect(alert).toHaveTextContent('もう一度')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(within(alert).getByRole('button', { name: 'もう一度読み込む' })).toBeInTheDocument()
  })
})

describe('品質フロア', () => {
  it('どのタブでも、グラフが読み上げの文（最も多い日と件数・定休日の 0 件・未集計）を持つ', async () => {
    mockApi({ rich: true })
    renderScreen()
    await waitFor(() => expect(screen.getByTestId('definition')).toBeInTheDocument())
    for (const name of TABS) {
      await userEvent.click(screen.getByRole('tab', { name }))
      await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(1))
      const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
      // どのタブでも文として終わり、定休日の 0 件と未集計の日が読まれる。
      expect(label).toMatch(/。$/)
      expect(label.length).toBeGreaterThan(0)
      if (name === 'お待ち時間') {
        // 時間帯の面だけは日の概念を持たないので、最も長い時間帯と目安を読む。
        expect(label).toContain('目安 8分')
        continue
      }
      expect(label).toContain('最も多いのは')
      expect(label).toContain('8/25は定休日で0件')
      expect(label).toContain('2日ぶんはまだ集計中')
    }
  })

  it('未集計の日があることは、読み上げの文だけでなく画面の 1 行にも出る', async () => {
    mockApi({ rich: true })
    renderScreen()
    expect(await screen.findByText('2日ぶんはまだ集計中です')).toBeInTheDocument()
  })

  it('タブ・期間・店舗・適用が、キーボードだけで順にたどれる', async () => {
    await openScreen()
    screen.getByRole('tab', { name: 'トップ' }).focus()
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '予約数' }))
    for (let step = 0; step < 7; step += 1) await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByLabelText('対象の期間'))
    await userEvent.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '適用' }))
  })

  it('触れるものはどれも 44pt 以上の高さを持つ（min-h の指定を必ず持つ）', async () => {
    await openScreen()
    const touchables = [
      ...screen.getAllByRole('tab'),
      screen.getByLabelText('対象の期間'),
      screen.getByLabelText('店舗'),
      screen.getByRole('button', { name: '適用' }),
    ]
    for (const node of touchables) {
      expect(node.className).toMatch(/min-h-11/)
    }
  })
})

describe('権限', () => {
  it('analytics.read を持たないと「この画面は店長だけがご覧になれます」が出て、通信の失敗と取り違えない', async () => {
    vi.unstubAllGlobals()
    mockApi({ status: 403 })
    const onBack = vi.fn()
    render(<AnalyticsScreen storeId={GINZA} stores={STORES} now={NOW} onBack={onBack} />)
    await screen.findByText('この画面は店長だけがご覧になれます')
    // 通信の失敗の言い方（もう一度読み込む）は出さない。直し方が違う。
    expect(screen.queryByRole('button', { name: 'もう一度読み込む' })).not.toBeInTheDocument()
    // タブや期間を操作させても意味が無いので、本文だけを差し替える。
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: '前の画面に戻る' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

describe('狭い画面', () => {
  it('グラフは自分の横スクロールの中に収まり、本文を横に動かさない', async () => {
    await openScreen()
    const scroll = screen.getByTestId('chart-scroll')
    expect(scroll.className).toContain('overflow-x-auto')
    // 図そのものは縮めず（min-w-fit）、はみ出したぶんだけ枠の中で送る。
    expect(within(scroll).getByRole('img').className).toContain('min-w-fit')
  })

  it('列は横軸のラベルより狭くつぶれない（min-w-0 を持たない）', async () => {
    await openScreen()
    for (const column of screen.getAllByTestId('column')) {
      expect(column.className).not.toContain('min-w-0')
    }
    for (const label of screen.getAllByTestId('column-label')) {
      expect(label.className).toContain('whitespace-nowrap')
    }
  })
})
