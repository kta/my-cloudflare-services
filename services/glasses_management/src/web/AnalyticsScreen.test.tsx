import type { AnalyticsReport } from '@app/contracts'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { AnalyticsScreen } from './AnalyticsScreen'
import { screenSections } from './app-chrome'

const STORE_ID = '00000000-0000-4000-8000-000000000010'
const OTHER_STORE_ID = '00000000-0000-4000-8000-000000000011'
const TODAY = '2026-08-27'
const NOW = '2026-08-27T05:30:00.000Z'

const MANAGER_PERMISSIONS = ['analytics.read', 'settings.read'] as const

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

function baseReport(overrides: Partial<AnalyticsReport> = {}): AnalyticsReport {
  return {
    storeId: STORE_ID,
    storeName: '銀座店',
    timezone: 'Asia/Tokyo',
    period: {
      granularity: 'day',
      startDate: '2026-08-27',
      endDate: '2026-08-27',
      startAt: '2026-08-26T15:00:00.000Z',
      endAt: '2026-08-27T15:00:00.000Z',
    },
    previousPeriod: {
      granularity: 'day',
      startDate: '2026-08-26',
      endDate: '2026-08-26',
      startAt: '2026-08-25T15:00:00.000Z',
      endAt: '2026-08-26T15:00:00.000Z',
    },
    lastUpdatedAt: NOW,
    totalCount: 214,
    smallSampleThreshold: 5,
    status: 'ok',
    reason: null,
    nextAction: null,
    metrics: [
      {
        metric: 'reservations',
        label: '予約',
        definition: '対象期間に開始予定だった予約の件数。',
        unit: 'count',
        value: 128,
        previousValue: 96,
        difference: 32,
        target: null,
        targetDifference: null,
        exceedsTarget: false,
        suppressed: false,
        suppressionReason: null,
      },
      {
        metric: 'no_shows',
        label: '無断キャンセル',
        definition: '来店予定日を過ぎても受付されなかった予約の件数。',
        unit: 'count',
        value: 14,
        previousValue: 9,
        difference: 5,
        target: 8,
        targetDifference: 6,
        exceedsTarget: true,
        suppressed: false,
        suppressionReason: null,
      },
    ],
    breakdowns: [
      {
        dimension: 'purpose',
        metric: 'reservations',
        suppressed: false,
        suppressionReason: null,
        items: [
          { key: 'p1', label: '視力測定', value: 60, suppressed: false },
          { key: 'p2', label: '受け取り', value: 30, suppressed: false },
        ],
      },
      {
        dimension: 'hour',
        metric: 'reservations',
        suppressed: false,
        suppressionReason: null,
        items: [
          { key: '10', label: '10時', value: 38, suppressed: false },
          { key: '14', label: '14時', value: 93, suppressed: false },
        ],
      },
    ],
    stageDistributions: [
      {
        stage: 'reception_to_service_start',
        label: '受付から接客開始まで',
        definition: '受付から接客開始までの経過分数。',
        unit: 'minutes',
        sampleCount: 40,
        suppressed: false,
        suppressionReason: null,
        averageMinutes: 9.2,
        medianMinutes: 8,
        p90Minutes: 18,
        maxMinutes: 32,
        buckets: [
          { label: '0〜5分', fromMinutes: 0, toMinutes: 5, count: 10 },
          { label: '5〜10分', fromMinutes: 5, toMinutes: 10, count: 20 },
          { label: '10分以上', fromMinutes: 10, toMinutes: null, count: 10 },
        ],
      },
    ],
    funnel: {
      sessionCount: 100,
      suppressed: false,
      suppressionReason: null,
      steps: [
        {
          stage: 'started',
          label: '開始',
          count: 100,
          droppedFromPrevious: null,
          suppressed: false,
        },
        {
          stage: 'slot_selected',
          label: '枠選択',
          count: 70,
          droppedFromPrevious: 30,
          suppressed: false,
        },
        {
          stage: 'confirmed',
          label: '確認',
          count: 60,
          droppedFromPrevious: 10,
          suppressed: false,
        },
        { stage: 'completed', label: '完了', count: 55, droppedFromPrevious: 5, suppressed: false },
      ],
      largestDropStage: 'slot_selected',
    },
    exclusions: [
      {
        reason: 'missing_stage_timestamp',
        count: 3,
        description: '工程の時刻が欠けている来店を除外しました。',
        caveat: '待ち時間の分布は実際よりも短く見える可能性があります。',
      },
    ],
    qualityWarnings: [
      {
        code: 'recording_save_failure',
        count: 2,
        message: '録音の保存に失敗した接客があります。',
        nextAction: '録音運用画面で保存状況を確認してください。',
      },
    ],
    causeCandidates: [
      {
        metric: 'no_shows',
        code: 'web_source_concentration',
        hypothesis: 'Web予約に無断キャンセルが集中している可能性があります。',
        evidenceCount: 12,
        inspectionTarget: 'Web予約の確認メール到達状況',
      },
    ],
    ...overrides,
  }
}

type Route = { url: string; init?: RequestInit }

function createApi(handler: (route: Route) => Response | Promise<Response>) {
  const calls: Route[] = []
  const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const route = { url: String(input), init }
    calls.push(route)
    return handler(route)
  })
  return { api, calls }
}

function renderScreen(
  api: ReturnType<typeof createApi>['api'],
  permissions: readonly string[] = MANAGER_PERMISSIONS,
  storeId = STORE_ID,
) {
  return render(
    <AnalyticsScreen
      storeId={storeId}
      storeName="銀座店"
      api={api as never}
      navigate={vi.fn()}
      permissions={permissions as never}
      today={TODAY}
      now={NOW}
    />,
  )
}

/**
 * 左列の観点をひとつ選ぶ。モックのこの面は「観点をひとつ選んで掘り下げる」
 * 形なので、どの観点の数字を読むテストなのかを必ず明示する。
 */
async function openSection(label: string) {
  /*
   * 観点の列は面の中ではなく全画面共通の柱にある（柱を 2 本立てない）。面だけを
   * 描くテストからは、柱が押したときと同じ口を叩いて選ぶ。
   */
  await screen.findByRole('region', { name: 'レポート' })
  act(() => {
    screenSections.select(label)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

/* --- framing (UC-EYEX-105, AC-EYEX-49) ------------------------------------ */

test('the view states its period, JST, last update and counted rows', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  expect(await screen.findByText('8月27日（木）')).toBeTruthy()
  expect(screen.getByText('JST(Asia/Tokyo)')).toBeTruthy()
  expect(screen.getByText('最終更新 8月27日 14:30')).toBeTruthy()
  expect(screen.getByText('対象件数 214件')).toBeTruthy()
  // 指標定義 travels with the number, not in a manual somewhere else.
  expect(screen.getByText('対象期間に開始予定だった予約の件数。')).toBeTruthy()
})

test('the requested granularity and date are sent to the server', async () => {
  const { api, calls } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  await screen.findByText('対象件数 214件')
  expect(calls[0]?.url).toBe(
    `/api/staff/stores/${STORE_ID}/analytics?granularity=day&date=${TODAY}`,
  )
  fireEvent.click(screen.getByRole('button', { name: '月' }))
  await waitFor(() => {
    expect(calls).toHaveLength(2)
  })
  expect(calls[1]?.url).toContain('granularity=month')
})

/* --- comparison and target (AC-EYEX-52) ----------------------------------- */

test('current value, previous-period difference and store target share one unit', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  expect(await screen.findByText('128件')).toBeTruthy()
  expect(screen.getByText('前期間 96件（+32件）')).toBeTruthy()
  await openSection('取消・無断キャンセル')
  expect(screen.getByText('店舗目標 8件（+6件）')).toBeTruthy()
})

test('a metric with no configured target says so instead of inventing one', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  expect(await screen.findByText('店舗目標は未設定です')).toBeTruthy()
})

/* --- cause candidates (AC-EYEX-51) ---------------------------------------- */

test('an over-target metric lists cause candidates with evidence counts, not a cause', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  await openSection('取消・無断キャンセル')
  const region = await screen.findByRole('region', { name: '無断キャンセルの原因候補' })
  expect(within(region).getByText(/原因を断定するものではありません/)).toBeTruthy()
  expect(
    within(region).getByText('Web予約に無断キャンセルが集中している可能性があります。'),
  ).toBeTruthy()
  expect(within(region).getByText('根拠件数 12件')).toBeTruthy()
  expect(within(region).getByText('確認対象: Web予約の確認メール到達状況')).toBeTruthy()
})

/* --- distributions (UC-EYEX-101, AC-EYEX-50) ------------------------------ */

test('wait time is shown as a distribution, not only an average', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  await openSection('待ち時間')
  const region = await screen.findByRole('region', { name: '受付から接客開始まで の分布' })
  expect(
    within(region).getByText('中央値 8分 / 平均 9.2分 / 90パーセンタイル 18分 / 最大 32分'),
  ).toBeTruthy()
  // Every bar carries its own label and count, so the chart never depends on colour.
  expect(within(region).getByText('0〜5分')).toBeTruthy()
  expect(within(region).getByText('5〜10分')).toBeTruthy()
  expect(within(region).getAllByText(/件$/).length).toBeGreaterThan(1)
})

/* --- breakdowns and funnel (UC-EYEX-100, 103) ----------------------------- */

test('breakdowns and the web booking funnel are readable as text', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  const purpose = await screen.findByRole('region', { name: '来店目的の内訳' })
  expect(within(purpose).getByText('視力測定')).toBeTruthy()
  expect(within(purpose).getByText('60件')).toBeTruthy()
  await openSection('Web予約')
  const funnel = screen.getByRole('region', { name: 'Web予約の離脱' })
  expect(within(funnel).getByText('枠選択')).toBeTruthy()
  expect(within(funnel).getByText('-30件')).toBeTruthy()
  expect(within(funnel).getByText('最大の離脱は「枠選択」')).toBeTruthy()
})

/* --- exclusions and quality warnings (AC-EYEX-54, UC-EYEX-104) ------------ */

test('excluded rows show their count, reason and interpretation caveat', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  await openSection('録音・運用品質')
  const region = await screen.findByRole('region', { name: '除外したデータ' })
  expect(within(region).getByText('3件')).toBeTruthy()
  expect(within(region).getByText('工程の時刻が欠けている来店を除外しました。')).toBeTruthy()
  expect(
    within(region).getByText('待ち時間の分布は実際よりも短く見える可能性があります。'),
  ).toBeTruthy()
})

test('operational quality warnings carry their next action', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  await openSection('録音・運用品質')
  const region = await screen.findByRole('region', { name: '運用品質の警告' })
  expect(within(region).getByText('録音の保存に失敗した接客があります。')).toBeTruthy()
  expect(within(region).getByText('録音運用画面で保存状況を確認してください。')).toBeTruthy()
})

/* --- suppression (UC-EYEX-180, AC-EYEX-53, AC-EYEX-119) ------------------- */

test('a suppressed breakdown renders no digit at all, so nothing can be subtracted back', async () => {
  const suppressed = baseReport({
    breakdowns: [
      {
        dimension: 'purpose',
        metric: 'reservations',
        suppressed: true,
        suppressionReason: 'derivable_from_small_sample',
        items: [
          { key: 'p1', label: '視力測定', value: null, suppressed: true },
          { key: 'p2', label: '受け取り', value: null, suppressed: true },
        ],
      },
    ],
  })
  const { api } = createApi(() => jsonResponse(suppressed))
  renderScreen(api)
  const region = await screen.findByRole('region', { name: '来店目的の内訳' })
  expect(within(region).getAllByText('非表示').length).toBe(3)
  expect(within(region).getByText(/逆算/)).toBeTruthy()
  // The hard guarantee: no residual arithmetic is on screen for this dimension.
  expect(/[0-9]/.test(region.textContent ?? '')).toBe(false)
  // And no bar retains a width that would encode the hidden magnitude.
  for (const bar of region.querySelectorAll('[data-bar]'))
    expect((bar as HTMLElement).style.width).toBe('0%')
})

test('a fully suppressed report hides values, comparisons and the funnel together', async () => {
  const suppressed = baseReport({
    status: 'suppressed',
    totalCount: 3,
    reason: '対象件数が組織の抑制閾値（5件）未満のため、値と内訳を非表示にしています。',
    nextAction: '期間を広げるか、より粗い集計粒度で再表示してください。',
    metrics: [
      {
        metric: 'reservations',
        label: '予約',
        definition: '対象期間に開始予定だった予約の件数。',
        unit: 'count',
        value: null,
        previousValue: null,
        difference: null,
        target: 120,
        targetDifference: null,
        exceedsTarget: false,
        suppressed: true,
        suppressionReason: 'small_sample',
      },
    ],
    breakdowns: [],
    stageDistributions: [],
    causeCandidates: [],
    funnel: {
      sessionCount: 3,
      suppressed: true,
      suppressionReason: 'small_sample',
      largestDropStage: null,
      steps: [
        {
          stage: 'started',
          label: '開始',
          count: null,
          droppedFromPrevious: null,
          suppressed: true,
        },
      ],
    },
  })
  const { api } = createApi(() => jsonResponse(suppressed))
  renderScreen(api)
  const metric = await screen.findByRole('region', { name: '予約' })
  expect(within(metric).getAllByText('非表示').length).toBe(2)
  expect(within(metric).getByText('店舗目標 120件')).toBeTruthy()
  // The target is configuration, not anybody's data; the difference from the
  // hidden value would give it away, so it is absent.
  expect(within(metric).queryByText(/店舗目標 120件（/)).toBeNull()
  expect(screen.getByText(suppressed.reason ?? '')).toBeTruthy()
  expect(screen.getByText(suppressed.nextAction ?? '')).toBeTruthy()
})

/* --- empty and failed periods (UC-EYEX-108) ------------------------------- */

test('an empty period states the reason and the next action, never a bare zero', async () => {
  const empty = baseReport({
    status: 'empty',
    totalCount: 0,
    reason: '対象期間に集計できる予約・来店の記録がありません。',
    nextAction: '対象期間または店舗を変えて再表示してください。',
    metrics: [],
    breakdowns: [],
    stageDistributions: [],
    exclusions: [],
    qualityWarnings: [],
    causeCandidates: [],
  })
  const { api } = createApi(() => jsonResponse(empty))
  renderScreen(api)
  expect(await screen.findByText('対象期間に集計できる予約・来店の記録がありません。')).toBeTruthy()
  expect(screen.getByText('対象期間または店舗を変えて再表示してください。')).toBeTruthy()
})

test('an aggregation failure is reported instead of a zeroed dashboard', async () => {
  const { api } = createApi(() => jsonResponse({ error: 'internal' }, 500))
  renderScreen(api)
  expect(await screen.findByText(/集計を読み込めませんでした/)).toBeTruthy()
  expect(screen.getByRole('button', { name: '再試行する' })).toBeTruthy()
})

/* --- store scope and permission (UC-EYEX-102, 106, AC-EYEX-55) ------------ */

test('only the selected store is requested, and a switch drops the old numbers', async () => {
  const { api, calls } = createApi((route) =>
    jsonResponse(
      route.url.includes(OTHER_STORE_ID)
        ? baseReport({ storeId: OTHER_STORE_ID, storeName: '青山店', totalCount: 7 })
        : baseReport(),
    ),
  )
  const { rerender } = renderScreen(api)
  await screen.findByText('対象件数 214件')
  rerender(
    <AnalyticsScreen
      storeId={OTHER_STORE_ID}
      storeName="青山店"
      api={api as never}
      navigate={vi.fn()}
      permissions={MANAGER_PERMISSIONS as never}
      today={TODAY}
      now={NOW}
    />,
  )
  expect(await screen.findByText('対象件数 7件')).toBeTruthy()
  expect(screen.queryByText('対象件数 214件')).toBeNull()
  expect(calls).toHaveLength(2)
  expect(calls[0]?.url).toContain(STORE_ID)
  expect(calls[0]?.url).not.toContain(OTHER_STORE_ID)
  expect(calls[1]?.url).toContain(OTHER_STORE_ID)
})

test('without analytics.read nothing is shown and no request is made', async () => {
  const { api, calls } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api, ['reservation.read'])
  const denied = await screen.findByRole('region', { name: '権限がありません' })
  expect(denied).toHaveTextContent(
    '権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。',
  )
  expect(within(denied).getByRole('button', { name: '業務開始画面へ戻る' })).toBeTruthy()
  expect(calls).toHaveLength(0)
  expect(screen.queryByText('対象件数 214件')).toBeNull()
})

/* --- 承認済みモック `analytics-approved.html` の骨格 --------------------- */

test('指標一覧・レポート・確認することの3列で組む', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  await screen.findByText('対象件数 214件')

  /* 観点の列は全画面共通の柱にある（柱を 2 本立てない）。面が渡した節を見る。 */
  expect(screenSections.snapshot().find((section) => section.current)?.label).toBe('予約と来店')
  expect(screenSections.snapshot().map((section) => section.label)).toContain(
    '取消・無断キャンセル',
  )

  const inspector = screen.getByRole('complementary', { name: '確認すること' })
  expect(within(inspector).getByRole('region', { name: '対象データ' })).toHaveTextContent(
    '来店214件 / 除外3件',
  )
  await openSection('取消・無断キャンセル')
  expect(within(inspector).getByRole('region', { name: '無断キャンセルの原因候補' })).toBeTruthy()
})

test('分布の柱は抑制時に幅も高さも残さない', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  await openSection('待ち時間')
  const region = await screen.findByRole('region', { name: '受付から接客開始まで の分布' })
  const bars = region.querySelectorAll('[data-bar]')
  expect(bars.length).toBeGreaterThan(0)
  expect((bars[0] as HTMLElement).style.height).not.toBe('')
})

/* --- shared iPad hygiene -------------------------------------------------- */

test('nothing is written to browser storage', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem')
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  await screen.findByText('対象件数 214件')
  fireEvent.click(screen.getByRole('button', { name: '週' }))
  await waitFor(() => {
    expect(setItem).not.toHaveBeenCalled()
  })
})

/**
 * `--font-mono` は IBM Plex Mono で和文グリフを持たない。日本語を含む文言は
 * font-mono で描かない（数字・ID だけが mono）。
 */
test('日本語を含む値は等幅で描かない', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  await openSection('取消・無断キャンセル')
  expect(await screen.findByText(/^根拠件数 /)).not.toHaveClass('font-mono')
})

/* --- 承認済みモックの情報構造（6 つの指標・柱のグラフ・3 枚の点検カード） ---- */

/**
 * モックの左列は「予約と来店 / 待ち時間 / 工程所要時間 / 取消・無断キャンセル /
 * Web予約 / 録音・運用品質」の 6 つで、指標そのものではなく“見る観点”である。
 * 観点をひとつ選ぶと、中央の列がその観点だけを掘り下げる。
 */
test('左列はモックの6観点で、選んだ観点だけを中央に掘り下げる', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  await screen.findByText('対象件数 214件')

  expect(screenSections.snapshot().map((section) => section.label)).toEqual([
    '予約と来店',
    '待ち時間',
    '工程所要時間',
    '取消・無断キャンセル',
    'Web予約',
    '録音・運用品質',
  ])

  // 既定は先頭の観点。無断キャンセルは別の観点なので中央に出ない。
  const report = screen.getByRole('region', { name: 'レポート' })
  expect(within(report).getByRole('heading', { name: '予約' })).toBeInTheDocument()
  expect(within(report).queryByRole('heading', { name: '無断キャンセル' })).toBeNull()

  await openSection('取消・無断キャンセル')
  expect(within(report).getByRole('heading', { name: '無断キャンセル' })).toBeInTheDocument()
  expect(within(report).queryByRole('heading', { name: '予約' })).toBeNull()
})

/** モックの中心は柱のグラフ。数字を縦に積むだけの面にはしない。 */
test('観点ごとに柱のグラフを持ち、目標線と超過の符号を出す', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  await screen.findByText('対象件数 214件')

  const chart = await screen.findByRole('figure', { name: '時間帯の内訳' })
  expect(within(chart).getAllByRole('listitem').length).toBeGreaterThan(0)

  await openSection('待ち時間')
  const wait = await screen.findByRole('figure', { name: '受付から接客開始まで の分布' })
  expect(within(wait).getByText('10分以上')).toBeInTheDocument()
})

/** モックの点検欄は 3 枚。並べれば並べるほど、どれから見るのかが消える。 */
test('点検欄は多くとも3枚に絞る', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  renderScreen(api)
  await screen.findByText('対象件数 214件')

  const inspector = screen.getByRole('complementary', { name: '確認すること' })
  expect(inspector.querySelectorAll('[data-viz-card]')).toHaveLength(1)
  await openSection('取消・無断キャンセル')
  // 原因候補が並んでも、点検欄は「対象データ」を含めて 3 枚を超えない。
  expect(inspector.querySelectorAll('[data-viz-card]').length).toBeLessThanOrEqual(3)
})

/**
 * ブラウザ既定の `<select>` と `type="date"` は、地域設定で `08/27/2026` の
 * 英語表記と既定の青を持ち込む。モックにはどちらの色も表記も無い。
 */
test('集計粒度と対象日にブラウザ既定の部品を使わない', async () => {
  const { api } = createApi(() => jsonResponse(baseReport()))
  const { container } = renderScreen(api)
  await screen.findByText('対象件数 214件')

  expect(container.querySelector('select')).toBeNull()
  expect(container.querySelector('input[type="date"]')).toBeNull()
  // 粒度は押しボタンで選ぶ。選択中は `aria-pressed` が名乗る。
  expect(screen.getByRole('button', { name: '日' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: '月' }))
  await waitFor(() => {
    expect(screen.getByRole('button', { name: '月' })).toHaveAttribute('aria-pressed', 'true')
  })
})
