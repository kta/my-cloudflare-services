import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { OfficialTab } from './OfficialTab'

const dailyPoints = Array.from({ length: 15 }, (_, index) => ({
  label: index === 5 || index === 12 ? `${index + 20}/定休` : `${index + 20}`,
  value: index === 5 || index === 12 ? 0 : index + 3,
  secondaryValue: null,
  isClosed: index === 5 || index === 12,
}))

describe('OfficialTab', () => {
  it('トップは前後7日15点と本日、先週・今週・来週をひとつのグラフと週の数字で示す', () => {
    render(
      <OfficialTab
        report={{
          tab: 'top',
          title: '予約の入り具合',
          definition: '本日を中心に前後7日／件数・火曜は定休日です',
          points: dailyPoints,
          todayLabel: '27 本日',
          weeks: [
            { label: '先週', period: '8月17日〜8月23日', reservations: '68件' },
            { label: '今週', period: '8月24日〜8月30日', reservations: '72件' },
            { label: '来週', period: '8月31日〜9月6日', reservations: '42件' },
          ],
        }}
      />,
    )

    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByTestId('chart-gridlines')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAccessibleName(/15日分/)
    expect(screen.getByText('27 本日')).toBeInTheDocument()
    expect(screen.getAllByText('定休')).toHaveLength(2)
    expect(screen.getByText('先週')).toBeInTheDocument()
    expect(screen.getByText('今週')).toBeInTheDocument()
    expect(screen.getByText('来週')).toBeInTheDocument()
    const weekly = screen.getByRole('group', { name: '週の予約' })
    expect(within(weekly).getByText('先週')).toBeInTheDocument()
    expect(within(weekly).getByText('今週')).toBeInTheDocument()
    expect(within(weekly).getByText('来週')).toBeInTheDocument()
  })

  it('予約数は日月時曜日と来店日・受付日の切り口を持ち、グラフは一つに保つ', async () => {
    const user = userEvent.setup()
    render(
      <OfficialTab
        report={{
          tab: 'count',
          title: '日別の予約数',
          definition: '2026年8月／火曜は定休日です',
          selectedGranularity: 'day',
          selectedCountBy: 'visit',
          points: dailyPoints,
          summary: [
            { label: '8月の合計', value: '320', unit: '件' },
            { label: '1日あたり', value: '11.9', unit: '件' },
            { label: '最も多い日', value: '8月15日', unit: '（土）18 件' },
          ],
        }}
      />,
    )

    expect(screen.getAllByRole('radio')).toHaveLength(6)
    expect(screen.getByRole('radiogroup', { name: '集計の種類' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'かぞえる日' })).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByRole('img')).toHaveAccessibleName(/34の17件.*定休2日は0件/)
    expect(screen.getByText('11.9')).toBeInTheDocument()
    expect(
      within(screen.getByRole('list', { name: '予約数のまとめ' })).getAllByRole('listitem'),
    ).toHaveLength(3)
    await user.click(screen.getByRole('radio', { name: '月別' }))
    expect(screen.getByRole('radio', { name: '月別' })).toBeChecked()
    await user.click(screen.getByRole('radio', { name: '受付日' }))
    expect(screen.getByRole('radio', { name: '受付日' })).toBeChecked()
  })

  it('予約数の下書きラジオは適用前の見出しとグラフ説明を変えない', async () => {
    const user = userEvent.setup()
    render(
      <OfficialTab
        report={{
          tab: 'count',
          title: '日別の予約数',
          definition: '2026年8月／火曜は定休日です',
          selectedGranularity: 'day',
          selectedCountBy: 'visit',
          points: dailyPoints,
          summary: [],
        }}
      />,
    )

    await user.click(screen.getByRole('radio', { name: '時間帯別' }))
    await user.click(screen.getByRole('radio', { name: '受付日' }))

    expect(screen.getByRole('radio', { name: '時間帯別' })).toBeChecked()
    expect(screen.getByRole('radio', { name: '受付日' })).toBeChecked()
    expect(screen.getByRole('heading', { name: '日別の予約数' })).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAccessibleName(/^日別の予約数。ご来店日で数えます。/)
  })

  it('担当者は横棒で0件も示し、未定を末尾に置き、再来率がないときは—を示す', () => {
    render(
      <OfficialTab
        report={{
          tab: 'staff',
          title: '担当者ごとの件数',
          definition: '2026年8月／ご来店日でかぞえます　合計 328件',
          staff: [
            { name: '佐藤 美咲', role: '視力測定・加工', value: 78, returnRate: '68%' },
            { name: '休職中', role: '販売', value: 0, returnRate: '—' },
            {
              name: '担当が未定',
              role: '受付では未定',
              value: 9,
              returnRate: '—',
              unassigned: true,
            },
          ],
        }}
      />,
    )

    const rows = screen.getAllByTestId('staff-row')
    expect(screen.getByRole('table', { name: '担当者の集計' })).toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(4)
    expect(rows).toHaveLength(3)
    expect(rows.at(-1)).toHaveTextContent('担当が未定')
    expect(rows.at(-1)).toHaveTextContent('—')
    expect(screen.getByText('0 件')).toBeInTheDocument()
  })

  it('お待ち時間は厳密な中央値・前月・母数・8分目安と、時間帯の空軸を示す', () => {
    render(
      <OfficialTab
        report={{
          tab: 'wait',
          median: '8分40秒',
          previousMedian: '7分20秒',
          sample: '2026年8月・受付 328件',
          target: '8分',
          targetSeconds: 480,
          isOverTarget: true,
          hourly: [],
        }}
      />,
    )

    expect(screen.getByText('8分40秒')).toBeInTheDocument()
    expect(screen.getByText(/前の月は 7分20秒／2026年8月・受付 328件/)).toBeInTheDocument()
    expect(screen.getByText('目安 8分を超えています')).toBeInTheDocument()
    expect(screen.getByTestId('wait-target-line')).toBeInTheDocument()
    expect(screen.getByText('目安 8分')).toBeInTheDocument()
    const legend = screen.getByRole('list', { name: 'お待ち時間の凡例' })
    expect(within(legend).getAllByRole('listitem')).toHaveLength(2)
    expect(legend.querySelectorAll('[data-pattern]')).toHaveLength(2)
    expect(screen.getByTestId('wait-chart-scroll')).toHaveClass('overflow-x-auto')
    expect(screen.getByRole('img')).toHaveAccessibleName(/時間帯ごとのお待ち時間/)
    expect(screen.getByText('この期間に時間帯別のお待ち時間はありません。')).toBeInTheDocument()
    expect(screen.getByText('10時台')).toBeInTheDocument()
    expect(screen.getByText('18時台')).toBeInTheDocument()
    for (const label of ['15分', '10分', '5分', '0分']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('お待ち時間のグラフ代替文は最大の時間帯・表示時間・目安超過を読む', () => {
    render(
      <OfficialTab
        report={{
          tab: 'wait',
          median: '8分40秒',
          previousMedian: '7分20秒',
          sample: '2026年8月・受付 328件',
          target: '8分',
          targetSeconds: 480,
          isOverTarget: true,
          hourly: [
            { label: '10時台', value: 420, display: '7分', isOverTarget: false },
            { label: '14時台', value: 800, display: '13分20秒', isOverTarget: true },
          ],
        }}
      />,
    )

    expect(screen.getByRole('img')).toHaveAccessibleName(
      /14時台が13分20秒でもっとも長く.*目安8分を超えています/,
    )
  })

  it('取り消しは5分類の積層、来店予定を分母とする率、10%目安を色以外にも文字で示す', () => {
    render(
      <OfficialTab
        report={{
          tab: 'cancel',
          title: '月ごとの取り消し',
          definition: 'ご来店予定だった予約（取り消し・ご来店なしを含む）を分母に数えます',
          series: [
            {
              name: 'お客様のご都合',
              tone: 'pine',
              pattern: 'solid',
              points: [{ label: '3月', value: 12, secondaryValue: null }],
            },
            {
              name: '店舗の都合',
              tone: 'danger',
              pattern: 'hatch',
              points: [{ label: '3月', value: 4, secondaryValue: null }],
            },
            {
              name: 'Webからの取消',
              tone: 'web',
              pattern: 'dot',
              points: [{ label: '3月', value: 5, secondaryValue: null }],
            },
            {
              name: '予約の重複',
              tone: 'walkin',
              pattern: 'solid',
              points: [{ label: '3月', value: 3, secondaryValue: null }],
            },
            {
              name: 'ご来店がなかった',
              tone: 'pine',
              pattern: 'dot',
              points: [{ label: '3月', value: 3, secondaryValue: null }],
            },
          ],
          target: '目安 10%以内',
          summary: [
            { label: '取消率', value: '9.8', unit: '%　目安 10%以内' },
            { label: '最も高い月', value: '11.9', unit: '%　2026年7月・目安を超過' },
            { label: 'ご来店がなかった', value: '29', unit: '件　取り消し 186件のうち' },
          ],
        }}
      />,
    )

    const legend = screen.getByRole('list', { name: 'グラフの系列' })
    expect(within(legend).getAllByRole('listitem')).toHaveLength(5)
    for (const label of [
      'お客様のご都合',
      '店舗の都合',
      '予約の重複',
      'ご来店がなかった',
      'Webからの取消',
    ])
      expect(legend).toHaveTextContent(label)
    expect(screen.getByRole('img')).toHaveAccessibleName(/ご来店予定だった予約.*を分母/)
    expect(screen.getByRole('img')).toHaveAccessibleName(/3月が27件.*最も高い/)
    expect(screen.getByText('目安 10%以内')).toBeInTheDocument()
    expect(screen.getByText(/目安を超過/)).toBeInTheDocument()
    expect(
      screen.getByText((_, element) => element?.textContent === '3月　27件・—'),
    ).toBeInTheDocument()
    expect(screen.getByTestId('cancel-chart-scroll')).toHaveClass('overflow-x-auto')
    const alternative = screen.getByRole('table', { name: '月別の取り消し内訳' })
    expect(within(alternative).getByRole('row', { name: /3月.*27件.*—/ })).toBeInTheDocument()
    expect(alternative).toHaveTextContent('お客様のご都合 12件')
    expect(alternative).toHaveTextContent('Webからの取消 5件')
  })
})
