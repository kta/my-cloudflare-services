import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DoneStep, type PublicBookingReceipt } from './DoneStep'

/*
 * 工程 6 完了（承認済みモック docs/frontend/mockups/eye/images/WEB-06-DONE.png）。
 *
 * この面の仕事は「番号を主役にし、戻り道を消し、メールが出なかった日でも戻れるようにする」こと。
 *
 * 実測値（screens/WEB-06-DONE.html と assets/eye.css）:
 *   上のバーは `‹` を持たない。本文の余白 32px 28px 140px。
 *   ✓ の丸 56px（地 `--color-pine`・文字 28px）、見出し 20px、副文 13px `--color-ink-muted`。
 *   番号の箱は上に 28px・内側 16px 12px・中央寄せ・地 `--color-pine-soft`、
 *   見出し 13px `--color-ink-muted`・値 24px 等幅 `--color-pine-deep`。
 *   明細は上に 24px、行は上下 16px + 上 1px の罫（最初の行は罫無し）。見出し列 66px。
 *   下の固定は「地図・道順を見る」（56px の緑）と「予約を変更・取り消す」（44px の quiet・上に 8px）。
 */

const RECEIPT: PublicBookingReceipt = {
  code: 'EY-W-2608-0031',
  managementCode: '4821-9930',
  status: 'confirmed',
  startsAt: '2026-08-29T02:00:00.000Z', // JST 8月29日（土）11:00
  endsAt: '2026-08-29T03:00:00.000Z',
  storeName: 'EYE 銀座店',
  purposeName: '新しいメガネを作る',
  contactName: '山口 真央',
  emailed: true,
}

function open(props: Partial<Parameters<typeof DoneStep>[0]> = {}) {
  return render(
    <DoneStep
      receipt={RECEIPT}
      storeAddress="東京都中央区銀座4-1-2"
      onManage={() => {}}
      {...props}
    />,
  )
}

function line(term: string): HTMLElement {
  return screen.getByRole('group', { name: term })
}

describe('完了', () => {
  it('前の画面へ戻る「‹」が無い', () => {
    open()
    expect(screen.queryByRole('button', { name: '前の画面へ戻る' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '前の画面へ戻る' })).not.toBeInTheDocument()
  })

  it('「ご予約番号」とその番号が読める', () => {
    open()
    const box = screen.getByRole('group', { name: 'ご予約番号' })
    expect(within(box).getByText('EY-W-2608-0031')).toBeVisible()
  })

  it('「確認番号」とその番号と「ご変更・お取り消しのときにお使いください。」が読める', () => {
    open()
    const box = screen.getByRole('group', { name: '確認番号' })
    expect(within(box).getByText('4821-9930')).toBeVisible()
    expect(screen.getByText('ご変更・お取り消しのときにお使いください。')).toBeVisible()
    // 画面に出す語は「確認番号」で固定する（`管理コード` はお客様に見せない）。
    expect(screen.queryByText(/管理コード/)).not.toBeInTheDocument()
  })

  it('明細 4 行（ご来店・店舗・ご用件・お名前）が予約の内容と一致する', () => {
    open()
    expect(within(line('ご来店')).getByText('2026年8月29日（土）11:00')).toBeVisible()
    expect(within(line('店舗')).getByText('EYE 銀座店')).toBeVisible()
    expect(within(line('ご用件')).getByText('新しいメガネを作る（約60分）')).toBeVisible()
    expect(within(line('お名前')).getByText('山口 真央 様')).toBeVisible()
  })

  it('メールを送れたときは「確認のメールをお送りしました。」を出す', () => {
    open()
    expect(screen.getByRole('heading', { name: 'ご予約が完了しました' })).toBeVisible()
    expect(screen.getByText('確認のメールをお送りしました。')).toBeVisible()
  })

  it('メールを送れなかったときは「確認のメールをお送りしました。」を出さず、「この画面のご予約番号と確認番号をお控えください。メールはお送りできませんでした。」を出す', () => {
    open({ receipt: { ...RECEIPT, emailed: false } })
    expect(screen.queryByText('確認のメールをお送りしました。')).not.toBeInTheDocument()
    expect(
      screen.getByText(
        'この画面のご予約番号と確認番号をお控えください。メールはお送りできませんでした。',
      ),
    ).toBeVisible()
    // 送れなかった日でも確認番号は必ず出す（これが無いと WEB-CANCEL を通れない）。
    expect(screen.getByText('4821-9930')).toBeVisible()
  })

  it('承認制のときは見出しを「ご予約を承りました」にし、「お店で確認のうえ、本日中にご連絡いたします。確定までお席の確保はできておりません。」を出す', () => {
    open({ receipt: { ...RECEIPT, status: 'pending' } })
    expect(screen.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()
    expect(
      screen.getByText(
        'お店で確認のうえ、本日中にご連絡いたします。確定までお席の確保はできておりません。',
      ),
    ).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'ご予約が完了しました' })).not.toBeInTheDocument()
  })

  it('「地図・道順を見る」は店舗の住所を持った外部の地図を新しいタブで開く', () => {
    open()
    const map = screen.getByRole('link', { name: '地図・道順を見る' })
    expect(map).toHaveAttribute('target', '_blank')
    expect(map).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(map.getAttribute('href')).toContain(encodeURIComponent('東京都中央区銀座4-1-2'))
  })

  it('「予約を変更・取り消す」は本人確認の画面へ進む', async () => {
    const onManage = vi.fn()
    open({ onManage })
    await userEvent.click(screen.getByRole('button', { name: '予約を変更・取り消す' }))
    expect(onManage).toHaveBeenCalledTimes(1)
  })
})
