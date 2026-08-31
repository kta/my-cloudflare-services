import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CheckinPanel, type CheckinPanelProps } from './CheckinPanel'

/*
 * ご来店の受け付け（承認済みモック docs/frontend/mockups/eyex/images/RECEPTION-CHECKIN.png
 * と screens/RECEPTION-CHECKIN.html）。
 *
 * 実測（RECEPTION-CHECKIN.html の <style> と assets/eyex.css）:
 *   .chk    = 1fr 320px／.main padding 28px 32px・段の間 24px／.side 左罫 1px・padding 28px 24px
 *   見出しの 1 行 = 13px --brand-dark・下に 10px
 *   .who    = padding 22px・丸 56×56・名前 26px/700・ふりがな 13px・dl は 3 等分
 *   .ck     = min-height 52px・箱 30×30（枠 2px・角 8px）・文字 15px・札は右端
 *   .go     = 主操作 min-width 280px / min-height 56px / 19px、副操作は既定のボタン
 *   .side   = dt 13px（上に 20px）・dd 16px/600・度数と PD は等幅
 *   右下の録音の帯（.rec-float）はこのフェーズでは出さない（P7）。
 */

/** 既定の normalizer は全角の空白（U+3000）を半角へ畳むので、文字どおり探すときに使う。 */
const asWritten = { normalizer: (text: string) => text.trim() }

const RESERVATION_ID = 'b0000000-0000-4000-8000-000000000001'

/** JST の壁時計から ISO8601 を作る（端末の時計を読まない）。 */
function at(date: string, clock: string): string {
  const [hours = '0', minutes = '0'] = clock.split(':')
  const utc = Number(hours) * 60 + Number(minutes) - 9 * 60
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + utc * 60_000).toISOString()
}

const SUBJECT: CheckinPanelProps['subject'] = {
  reservationId: RESERVATION_ID,
  displayName: '田中 花子 様',
  kana: 'たなか はなこ',
  phone: '09012345678',
  visitCount: 4,
  startsAt: at('2026-08-27', '11:00'),
  endsAt: at('2026-08-27', '12:00'),
  purposeLabel: 'メガネを新しく作る',
  staffName: '佐藤 美咲',
  isReceived: false,
}

const LAST_VISIT: CheckinPanelProps['lastVisit'] = {
  visitedOn: '2026-03-12',
  powerLabel: '-2.25 ／ -2.00',
  pdLabel: '62.0',
  staffName: '佐藤 美咲',
  wishNote: 'PC作業用。鼻パッドは低め',
}

function show(over: Partial<CheckinPanelProps> = {}) {
  const props: CheckinPanelProps = {
    subject: SUBJECT,
    serverNow: at('2026-08-27', '10:55'),
    attentions: ['金属アレルギー'],
    lastVisit: LAST_VISIT,
    onBack: vi.fn(),
    onReceive: vi.fn(),
    ...over,
  }
  render(<CheckinPanel {...props} />)
  return props
}

describe('来店受付の画面', () => {
  it('見出しに「11:00 のご予約　5分早くお着きです」が出る', () => {
    show()
    expect(screen.getByText('11:00 のご予約　5分早くお着きです', asWritten)).toBeInTheDocument()
  })

  it('遅れてお着きのときは「10分遅れてお着きです」になる', () => {
    show({ serverNow: at('2026-08-27', '11:10') })
    expect(screen.getByText('11:00 のご予約　10分遅れてお着きです', asWritten)).toBeInTheDocument()
  })

  it('予定時刻ちょうどのときは差を出さない', () => {
    show({ serverNow: at('2026-08-27', '11:00') })
    expect(screen.getByText('11:00 のご予約')).toBeInTheDocument()
  })

  it('お名前・来店回数・ご予約・ご来店の目的・担当が 1 枚のカードで読める', () => {
    show()
    const card = screen.getByRole('region', { name: 'お客様' })
    expect(within(card).getByText('田中 花子 様')).toBeInTheDocument()
    expect(within(card).getByText('4回目')).toBeInTheDocument()
    expect(within(card).getByText('たなか はなこ　090-1234-5678', asWritten)).toBeInTheDocument()
    expect(within(card).getByText('11:00 〜 12:00')).toBeInTheDocument()
    expect(within(card).getByText('メガネを新しく作る')).toBeInTheDocument()
    expect(within(card).getByText('佐藤 美咲')).toBeInTheDocument()
  })

  it('確かめることの行を押すと済みになり、もう一度押すと未済に戻る', async () => {
    const user = userEvent.setup()
    show()
    const line = screen.getByRole('checkbox', { name: 'お名前を確かめました' })
    expect(line).not.toBeChecked()
    await user.click(line)
    expect(line).toBeChecked()
    await user.click(line)
    expect(line).not.toBeChecked()
  })

  it('注意ごとの行だけが「要確認」の札を持つ', () => {
    show()
    const tags = screen.getAllByText('要確認')
    expect(tags).toHaveLength(1)
    expect(tags[0]?.closest('label')).toHaveTextContent('金属アレルギー')
  })

  it('確かめ済みの行と未確認の行が札と枠で見分けられる', async () => {
    const user = userEvent.setup()
    show()
    const line = screen.getByRole('checkbox', { name: 'お名前を確かめました' })
    const box = () => line.closest('label')?.querySelector('[data-check-box]')
    expect(box()?.className).toContain('bg-surface')
    await user.click(line)
    expect(box()?.className).toContain('bg-pine')
    // 済みの行には「確かめました」の語も添える（色と枠だけに頼らない）。
    expect(
      within(line.closest('label') as HTMLElement).getByText('確かめました'),
    ).toBeInTheDocument()
  })

  it('確かめることが 1 つも済んでいなくても受け付けられる', async () => {
    const user = userEvent.setup()
    const props = show()
    const primary = screen.getByRole('button', { name: 'ご来店を受け付ける' })
    expect(primary).toBeEnabled()
    await user.click(primary)
    expect(props.onReceive).toHaveBeenCalledTimes(1)
  })

  it('注意ごとが 0 件のときは 2 行になる', () => {
    show({ attentions: [] })
    expect(screen.getAllByRole('checkbox').map((line) => line.getAttribute('aria-label'))).toEqual([
      'お名前を確かめました',
      '前回からの変化をお伺いする',
    ])
  })

  it('右に前回のご来店（日付・度数・PD・担当・ご希望メモ）が出る', () => {
    show()
    const side = screen.getByRole('complementary', { name: '前回のご来店' })
    expect(within(side).getByRole('heading').textContent).toBe('前回のご来店（2026年3月12日）')
    expect(within(side).getByText('-2.25 ／ -2.00')).toBeInTheDocument()
    expect(within(side).getByText('62.0')).toBeInTheDocument()
    expect(within(side).getByText('佐藤 美咲')).toBeInTheDocument()
    expect(within(side).getByText('PC作業用。鼻パッドは低め')).toBeInTheDocument()
  })

  it('前回のご来店が無いお客様では右の欄がその事実だけを出す', () => {
    show({ lastVisit: null })
    const side = screen.getByRole('complementary', { name: '前回のご来店' })
    expect(within(side).getByRole('heading').textContent).toBe('前回のご来店')
    expect(within(side).getByText('まだご来店の記録がありません。')).toBeInTheDocument()
    expect(within(side).queryByRole('definition')).toBeNull()
  })

  it('「ご来店を受け付ける」を押すと received として送られる', async () => {
    const user = userEvent.setup()
    const props = show()
    await user.click(screen.getByRole('button', { name: 'ご来店を受け付ける' }))
    expect(props.onReceive).toHaveBeenCalledWith('received', expect.any(String))
  })

  it('「お待ちいただく」を押すと待ちとして送られる', async () => {
    const user = userEvent.setup()
    const props = show()
    await user.click(screen.getByRole('button', { name: 'お待ちいただく' }))
    expect(props.onReceive).toHaveBeenCalledWith('waiting', expect.any(String))
  })

  it('「‹ 来店受付ボードへ戻る」で何も記録せずに戻る', async () => {
    const user = userEvent.setup()
    const props = show()
    await user.click(screen.getByRole('button', { name: '‹ 来店受付ボードへ戻る' }))
    expect(props.onBack).toHaveBeenCalledTimes(1)
    expect(props.onReceive).not.toHaveBeenCalled()
  })

  it('Esc でも何も記録せずに戻る', async () => {
    const user = userEvent.setup()
    const props = show()
    await user.keyboard('{Escape}')
    expect(props.onBack).toHaveBeenCalledTimes(1)
    expect(props.onReceive).not.toHaveBeenCalled()
  })

  it('既に受け付けた予約では主操作が押せない', () => {
    show({ subject: { ...SUBJECT, isReceived: true } })
    expect(screen.getByRole('button', { name: 'ご来店を受け付ける' })).toBeDisabled()
    expect(screen.getByText('このご予約はもう受け付けています。')).toBeInTheDocument()
  })

  it('消し込みの結果（確かめた行と確かめなかった行）が受付と一緒に送られる', async () => {
    const user = userEvent.setup()
    const props = show()
    await user.click(screen.getByRole('checkbox', { name: 'お名前を確かめました' }))
    await user.click(screen.getByRole('button', { name: 'ご来店を受け付ける' }))
    const note = vi.mocked(props.onReceive).mock.calls[0]?.[1] ?? ''
    expect(note).toContain('確かめた: お名前を確かめました')
    expect(note).toContain('確かめていない: 前回からの変化をお伺いする・金属アレルギー')
    // note は VisitEventInput の 120 文字に収める（溢れたら切る）。
    expect([...note].length).toBeLessThanOrEqual(120)
  })
})
