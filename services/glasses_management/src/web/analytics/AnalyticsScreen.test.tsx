import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { type AnalyticsPresentationReport, AnalyticsScreen } from './AnalyticsScreen'
import type { AnalyticsSelection } from './Toolbar'

const STORE_ID = 'd0000000-0000-4000-8000-000000000001'
type SimplePresentationReport = Extract<
  AnalyticsPresentationReport,
  { tab: 'source' | 'visits' | 'purpose' }
>

function report(
  tab: SimplePresentationReport['tab'],
  overrides: Partial<SimplePresentationReport> = {},
): SimplePresentationReport {
  return {
    tab,
    definition: '2026年8月／ご来店日を基準に、取消を除くご予約 320件を数えます',
    series: [
      {
        name: 'お電話',
        pattern: 'solid',
        tone: 'pine',
        points: [{ label: 'お電話', value: 136, secondaryValue: null }],
      },
      {
        name: '店頭',
        pattern: 'hatch',
        tone: 'pine',
        points: [{ label: '店頭', value: 70, secondaryValue: null }],
      },
      {
        name: 'Web予約',
        pattern: 'dot',
        tone: 'web',
        points: [{ label: 'Web予約', value: 84, secondaryValue: null }],
      },
      {
        name: 'ウォークイン',
        pattern: 'solid',
        tone: 'walkin',
        points: [{ label: 'ウォークイン', value: 30, secondaryValue: null }],
      },
    ],
    summary: [
      { label: '8月の合計', value: '320', unit: '件', isOverTarget: false },
      { label: '最も多い入口', value: 'お電話', unit: '136 件', isOverTarget: false },
      { label: 'その割合', value: '42.5', unit: '%', isOverTarget: false },
    ],
    ...overrides,
  }
}

describe('AnalyticsScreen', () => {
  it('8タブを固定順で出し、予約の入口はグラフ1つ・定義1行・まとめ3項目で読む', () => {
    render(
      <AnalyticsScreen
        storeId={STORE_ID}
        initialTab="source"
        reports={{ source: report('source') }}
      />,
    )

    const tabs = Array.from(
      screen.getByRole('tablist', { name: '分析の内訳を選ぶ' }).querySelectorAll('[role="tab"]'),
    )
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'トップ',
      '予約数',
      '予約の入口',
      '取り消し',
      '来店回数',
      '担当者',
      'ご来店の目的',
      'お待ち時間',
    ])
    expect(screen.getByRole('tab', { name: '予約の入口' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByText(/ご来店日を基準に/)).toBeInTheDocument()
    expect(screen.getByText('8月の合計')).toBeInTheDocument()
    expect(screen.getByText('最も多い入口')).toBeInTheDocument()
    expect(screen.getByText('その割合')).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: '予約の入口のまとめ' })).getAllByRole('listitem'),
    ).toHaveLength(3)
    expect(screen.getAllByText('Web予約').length).toBeGreaterThan(0)
    expect(screen.getAllByText('ウォークイン').length).toBeGreaterThan(0)
  })

  it('矢印でタブへ移動し、Enterで来店回数を選択する', async () => {
    const user = userEvent.setup()
    render(
      <AnalyticsScreen
        storeId={STORE_ID}
        initialTab="source"
        reports={{
          source: report('source'),
          visits: report('visits', {
            summary: [
              { label: '8月の合計', value: '328', unit: '件', isOverTarget: false },
              { label: '最も多い回数帯', value: '3〜5回', unit: '99 件', isOverTarget: false },
              { label: 'その割合', value: '30.2', unit: '%', isOverTarget: false },
            ],
          }),
        }}
      />,
    )

    const source = screen.getByRole('tab', { name: '予約の入口' })
    source.focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('tab', { name: '来店回数' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('tab', { name: '来店回数' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('最も多い回数帯')).toBeInTheDocument()
  })

  it('Home・End・Spaceでタブを移動して、ご来店の目的の横棒を選択する', async () => {
    const user = userEvent.setup()
    render(
      <AnalyticsScreen
        storeId={STORE_ID}
        initialTab="source"
        reports={{
          source: report('source'),
          purpose: report('purpose', {
            series: [
              {
                name: 'メガネを新しく作る',
                pattern: 'solid',
                tone: 'pine',
                points: [{ label: 'メガネを新しく作る', value: 126, secondaryValue: null }],
              },
              {
                name: '今のメガネを調整したい',
                pattern: 'hatch',
                tone: 'pine',
                points: [{ label: '今のメガネを調整したい', value: 28, secondaryValue: null }],
              },
            ],
            summary: [
              { label: '8月の合計', value: '320', unit: '件', isOverTarget: false },
              {
                label: '最も多い目的',
                value: 'メガネを新しく作る',
                unit: '126 件',
                isOverTarget: false,
              },
              { label: 'その割合', value: '39.4', unit: '%', isOverTarget: false },
            ],
          }),
        }}
      />,
    )

    screen.getByRole('tab', { name: '予約の入口' }).focus()
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'お待ち時間' })).toHaveFocus()
    await user.keyboard(
      '{Home}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{Space}',
    )
    expect(screen.getByRole('tab', { name: 'ご来店の目的' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('img')).toHaveAccessibleName(/目的ごとの予約数/)
    expect(screen.getByText('今のメガネを調整したい')).toBeInTheDocument()
  })

  it('下書きの期間は適用まで表示を変えず、読み込み中と失敗時は前のグラフを残さない', async () => {
    const user = userEvent.setup()
    let reject: ((reason?: unknown) => void) | undefined
    const loadReport = vi.fn(
      () =>
        new Promise<AnalyticsPresentationReport>((_, onReject) => {
          reject = onReject
        }),
    )
    render(
      <AnalyticsScreen
        storeId={STORE_ID}
        initialTab="source"
        reports={{ source: report('source') }}
        loadReport={loadReport}
      />,
    )

    await user.selectOptions(screen.getByLabelText('対象の期間'), '2026-07')
    expect(screen.getByText('320')).toBeInTheDocument()
    expect(loadReport).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '適用' }))
    expect(loadReport).toHaveBeenCalledWith({ storeId: STORE_ID, tab: 'source', month: '2026-07' })
    expect(screen.getByRole('status')).toHaveTextContent('読み込んでいます…')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    reject?.(new Error('offline'))
    expect(await screen.findByText('分析を読み込めませんでした。')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('後から適用した結果を、先に始めた読み込みが上書きしない', async () => {
    const user = userEvent.setup()
    const pending: Array<{ resolve: (value: AnalyticsPresentationReport) => void }> = []
    const loadReport = vi.fn(
      () =>
        new Promise<AnalyticsPresentationReport>((resolve) => {
          pending.push({ resolve })
        }),
    )
    render(
      <AnalyticsScreen
        storeId={STORE_ID}
        initialTab="source"
        reports={{ source: report('source') }}
        loadReport={loadReport}
      />,
    )

    await user.selectOptions(screen.getByLabelText('対象の期間'), '2026-07')
    await user.click(screen.getByRole('button', { name: '適用' }))
    await user.selectOptions(screen.getByLabelText('対象の期間'), '2026-06')
    await user.click(screen.getByRole('button', { name: '適用' }))

    pending[1]?.resolve(
      report('source', {
        summary: [
          { label: '8月の合計', value: '222', unit: '件', isOverTarget: false },
          { label: '最も多い入口', value: '店頭', unit: '100 件', isOverTarget: false },
          { label: 'その割合', value: '45.0', unit: '%', isOverTarget: false },
        ],
      }),
    )
    expect(await screen.findByText('222')).toBeInTheDocument()

    pending[0]?.resolve(
      report('source', {
        summary: [
          { label: '8月の合計', value: '111', unit: '件', isOverTarget: false },
          { label: '最も多い入口', value: 'お電話', unit: '90 件', isOverTarget: false },
          { label: 'その割合', value: '40.0', unit: '%', isOverTarget: false },
        ],
      }),
    )
    await waitFor(() => expect(screen.getByText('222')).toBeInTheDocument())
    expect(screen.queryByText('111')).not.toBeInTheDocument()
  })

  it('店舗の下書きは適用まで表示を変えず、適用時に選択した店舗を読み込む', async () => {
    const user = userEvent.setup()
    const loadReport = vi.fn(async () => report('source'))
    render(
      <AnalyticsScreen
        storeId={STORE_ID}
        storeOptions={[
          { id: STORE_ID, label: '銀座店' },
          { id: 'd0000000-0000-4000-8000-000000000002', label: '新宿店' },
        ]}
        initialTab="source"
        reports={{ source: report('source') }}
        loadReport={loadReport}
      />,
    )

    expect(screen.getByRole('option', { name: '新宿店' })).toBeEnabled()
    await user.selectOptions(screen.getByLabelText('店舗'), 'd0000000-0000-4000-8000-000000000002')
    expect(screen.getByText('320')).toBeInTheDocument()
    expect(loadReport).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '適用' }))
    expect(loadReport).toHaveBeenCalledWith({
      storeId: 'd0000000-0000-4000-8000-000000000002',
      tab: 'source',
      month: '2026-08',
    })
  })

  it('未適用の期間と店舗はタブを切り替えても取得条件へ混ぜず、適用後にだけ使う', async () => {
    const user = userEvent.setup()
    const otherStore = 'd0000000-0000-4000-8000-000000000002'
    const loadReport = vi.fn(async (selection: AnalyticsSelection) => {
      if (selection.tab !== 'source' && selection.tab !== 'visits' && selection.tab !== 'purpose')
        throw new Error('unexpected tab')
      return report(selection.tab)
    })
    render(
      <AnalyticsScreen
        storeId={STORE_ID}
        storeOptions={[
          { id: STORE_ID, label: '銀座店' },
          { id: otherStore, label: '新宿店' },
        ]}
        initialTab="source"
        reports={{ source: report('source') }}
        loadReport={loadReport}
      />,
    )

    await user.selectOptions(screen.getByLabelText('対象の期間'), '2026-07')
    await user.selectOptions(screen.getByLabelText('店舗'), otherStore)
    await user.click(screen.getByRole('tab', { name: '来店回数' }))

    expect(loadReport).toHaveBeenLastCalledWith({
      storeId: STORE_ID,
      tab: 'visits',
      month: '2026-08',
    })
    await screen.findByRole('img')

    await user.click(screen.getByRole('button', { name: '適用' }))
    expect(loadReport).toHaveBeenLastCalledWith({
      storeId: otherStore,
      tab: 'visits',
      month: '2026-07',
    })
  })

  it('403では理由と戻る操作を示す', async () => {
    const user = userEvent.setup()
    const onBack = vi.fn()
    render(
      <AnalyticsScreen
        storeId={STORE_ID}
        initialTab="source"
        reports={{ source: report('source') }}
        loadReport={async () => {
          throw new Error('forbidden')
        }}
        onBack={onBack}
      />,
    )

    await user.click(screen.getByRole('button', { name: '適用' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'この店舗の分析を見る権限がありません。',
    )
    await user.click(screen.getByRole('button', { name: '戻る' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it('取り消しは終了月の5か月前から始め、開始月→終了月の順で選べる', () => {
    render(
      <AnalyticsScreen
        storeId={STORE_ID}
        initialTab="cancel"
        initialMonth="2026-08"
        reports={{}}
      />,
    )

    const selects = screen.getAllByRole('combobox')
    const start = screen.getByLabelText('開始月')
    const end = screen.getByLabelText('終了月')
    expect(start).toHaveValue('2026-03')
    expect(end).toHaveValue('2026-08')
    expect(within(start).getByRole('option', { name: '2026年3月' })).toBeInTheDocument()
    expect(selects.indexOf(start)).toBeLessThan(selects.indexOf(end))
  })

  it('取り消しの開始月を終了月より後には選べない', async () => {
    const user = userEvent.setup()
    render(
      <AnalyticsScreen
        storeId={STORE_ID}
        initialTab="cancel"
        initialMonth="2026-08"
        reports={{}}
      />,
    )

    await user.selectOptions(screen.getByLabelText('開始月'), '2026-08')
    const end = screen.getByLabelText('終了月')
    expect(end).toHaveValue('2026-08')
    expect(within(end).queryByRole('option', { name: '2026年3月' })).not.toBeInTheDocument()
  })

  it('取り消しタブへ移ると終了月の5か月前を開始月にして読み込む', async () => {
    const user = userEvent.setup()
    const loadReport = vi.fn(async () => report('source'))
    render(
      <AnalyticsScreen
        storeId={STORE_ID}
        initialTab="source"
        initialMonth="2026-08"
        reports={{ source: report('source') }}
        loadReport={loadReport}
      />,
    )

    await user.click(screen.getByRole('tab', { name: '取り消し' }))
    expect(loadReport).toHaveBeenCalledWith({
      storeId: STORE_ID,
      tab: 'cancel',
      month: '2026-08',
      startMonth: '2026-03',
      granularity: undefined,
      countBy: undefined,
    })
  })
})
