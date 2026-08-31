import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SimpleTab } from './SimpleTab'

const emptySeries = [
  {
    name: 'お電話',
    pattern: 'solid' as const,
    tone: 'pine' as const,
    points: [{ label: 'お電話', value: 0, secondaryValue: null }],
  },
]

describe('SimpleTab', () => {
  it('予約の入口と来店回数は正本と同じniceな縦軸目盛りを示す', () => {
    const { rerender } = render(
      <SimpleTab
        tab="source"
        definition="予約の入口"
        series={[
          {
            name: '予約の入口',
            tone: 'pine',
            pattern: 'solid',
            points: [{ label: 'お電話', value: 136, secondaryValue: null }],
          },
        ]}
        summary={[]}
      />,
    )

    for (const label of ['160', '120', '80', '40', '0']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }

    rerender(
      <SimpleTab
        tab="visits"
        definition="来店回数"
        series={[
          {
            name: '来店回数',
            tone: 'pine',
            pattern: 'solid',
            points: [{ label: '初めて', value: 99, secondaryValue: null }],
          },
        ]}
        summary={[]}
      />,
    )
    for (const label of ['120', '90', '60', '30', '0']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('予約の入口と来店回数は正本の基準を超えた値まで縦軸を伸ばす', () => {
    const { rerender } = render(
      <SimpleTab
        tab="source"
        definition="予約の入口"
        series={[
          {
            name: '予約の入口',
            tone: 'pine',
            pattern: 'solid',
            points: [{ label: 'お電話', value: 201, secondaryValue: null }],
          },
        ]}
        summary={[]}
      />,
    )
    expect(screen.getByText('400')).toBeInTheDocument()

    rerender(
      <SimpleTab
        tab="visits"
        definition="来店回数"
        series={[
          {
            name: '来店回数',
            tone: 'pine',
            pattern: 'solid',
            points: [{ label: '3〜5回', value: 151, secondaryValue: null }],
          },
        ]}
        summary={[]}
      />,
    )
    expect(screen.getByText('160')).toBeInTheDocument()
  })

  it.each([
    ['source', 'この期間に予約の入口の件数はありません。'],
    ['visits', 'この期間に来店回数ごとの受付はありません。'],
    ['purpose', 'この期間にご来店の目的ごとの件数はありません。'],
  ] as const)('%s は0件でもグラフと説明文を示す', (tab, emptyMessage) => {
    render(
      <SimpleTab
        tab={tab}
        definition="2026年8月／ご来店日を基準に、0件を数えます"
        series={emptySeries}
        summary={[
          { label: '8月の合計', value: '0', unit: '件', isOverTarget: false },
          { label: '最も多い項目', value: '—', unit: '', isOverTarget: false },
          { label: 'その割合', value: '—', unit: '', isOverTarget: false },
        ]}
      />,
    )

    expect(screen.getByRole('img')).toBeInTheDocument()
    if (tab !== 'purpose') expect(screen.getByTestId('chart-gridlines')).toBeInTheDocument()
    expect(screen.getByText(emptyMessage)).toBeInTheDocument()
    expect(screen.getByRole('heading')).toHaveTextContent(
      '2026年8月／ご来店日を基準に、0件を数えます',
    )
  })
})
