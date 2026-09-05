import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChangeCancel } from './ChangeCancel'

/*
 * 予約の取り消し（承認済みモック docs/frontend/mockups/eye/images/CHANGE-CANCEL.png）。
 *
 * この面の仕事は「取り消しは戻せない」ことを先に読ませ、理由を 1 つ選ぶまで実行させないこと。
 * 既定の操作は「取り消さずに戻る」で、面に入った直後の焦点もそこに置く（AC-CHANGE-21）。
 *
 * 実測（screens/CHANGE-CANCEL.html の <style> と assets/eye.css）:
 *   .cancel  = padding 36px 44px。h2 18px ＋ 補足 13px（左に 10px）
 *   .target  = --alert-tint の 4 列（250px 1fr 1fr 1fr）・gap 20px・padding 22px 24px
 *              左は 24px/1.3 の日時 ＋ 13px の「所要 60分」、右 3 つは dt 12px / dd 17px/600 ＋ 補足 13px
 *   予告の 1 行 = 上に 14px の 13px
 *   .reasons = 4 列・gap 12px・min-height 96px・padding 16px 18px・18px/600 ＋ 補足 13px/1.4
 *              選択中は 3px の --brand の縁 ＋ --brand-tint（padding 14px 16px）
 *   .foot    = 上に 24px、gap 16px。左が .btn.primary.big（56px）、右が .btn.danger.big
 *
 * **モックの「お客様のご都合＝選択中」を採らない。**既定で 1 つ選んでおくと、店舗都合や
 * 重複の取り消しが押し間違いでお客様都合として残る（`spec.md`「決めたこと」）。
 */

const STARTS_AT = '2026-08-27T02:00:00.000Z' // 11:00 JST
const ENDS_AT = '2026-08-27T03:00:00.000Z' // 12:00 JST

type Props = Parameters<typeof ChangeCancel>[0]

function open(props: Partial<Props> = {}) {
  return render(
    <ChangeCancel
      target={{
        code: 'EY-2608-0142',
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
        durationMinutes: 60,
        customerName: '田中 花子',
        visitCount: 4,
        phoneDigits: '09012345678',
        purposeLabel: 'メガネを新しく作る',
        purposeNote: '視力測定を含みます',
        staffName: '佐藤 美咲',
        equipmentNames: ['視力測定機 A', 'カウンター 1'],
      }}
      onBack={() => {}}
      onCancel={() => {}}
      {...props}
    />,
  )
}

describe('取消', () => {
  it('「この予約を取り消します」「まだ取り消していません」が出る', () => {
    open()
    expect(screen.getByRole('heading', { name: 'この予約を取り消します' })).toBeVisible()
    expect(screen.getByText('まだ取り消していません')).toBeVisible()
  })

  it('対象のご予約が 1 枚のカードで出る（日時と所要／お客様／ご用件／担当と場所）', () => {
    open()
    const card = screen.getByRole('group', { name: '取り消すご予約' })
    expect(within(card).getByText('8月27日（木）11:00–12:00')).toBeVisible()
    expect(within(card).getByText('所要 60分')).toBeVisible()
    expect(within(card).getByText('田中 花子 様')).toBeVisible()
    expect(within(card).getByText('4回目')).toBeVisible()
    expect(within(card).getByText('090-1234-5678')).toBeVisible()
    expect(within(card).getByText('メガネを新しく作る')).toBeVisible()
    expect(within(card).getByText('視力測定を含みます')).toBeVisible()
    expect(within(card).getByText('佐藤 美咲')).toBeVisible()
    expect(within(card).getByText('視力測定機 A／カウンター 1')).toBeVisible()
  })

  it('「取り消すと、この枠はすぐほかのお客様にご案内できる状態になります。」が出る', () => {
    open()
    expect(
      screen.getByText('取り消すと、この枠はすぐほかのお客様にご案内できる状態になります。'),
    ).toBeVisible()
  })

  it('理由の 4 択はどれも選ばれていない状態で始まる', () => {
    open()
    const reasons = screen.getByRole('group', { name: '取り消しの理由' })
    const choices = within(reasons).getAllByRole('radio')
    expect(choices.map((choice) => choice.getAttribute('aria-label') ?? '')).toEqual([
      'お客様のご都合',
      '店舗の都合',
      '予約の重複',
      'ご来店がなかった',
    ])
    for (const choice of choices) expect(choice).not.toBeChecked()
    expect(screen.queryByText('選択中')).not.toBeInTheDocument()
  })

  it('理由を選ぶまで「この予約を取り消す」は押せず、押せない理由が aria-label に入る', async () => {
    const onCancel = vi.fn()
    open({ onCancel })
    const run = screen.getByRole('button', { name: /この予約を取り消す/ })
    expect(run).toBeDisabled()
    expect(run).toHaveAttribute(
      'aria-label',
      'この予約を取り消す（取り消しの理由を選ぶと押せます）',
    )
    await userEvent.click(run)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('理由を選ぶと札に「選択中」が出て、取り消しは理由つきで親へ渡る', async () => {
    const onCancel = vi.fn()
    open({ onCancel })
    await userEvent.click(screen.getByRole('radio', { name: '店舗の都合' }))
    expect(screen.getByRole('radio', { name: '店舗の都合' })).toBeChecked()
    expect(screen.getByText('選択中')).toBeVisible()
    const run = screen.getByRole('button', { name: 'この予約を取り消す' })
    expect(run).toBeEnabled()
    await userEvent.click(run)
    expect(onCancel).toHaveBeenCalledWith('store')
  })

  it('画面に入った直後の焦点は「取り消さずに戻る」に当たる', () => {
    open()
    expect(screen.getByRole('button', { name: '取り消さずに戻る' })).toHaveFocus()
  })

  it('焦点の当たったボタンから「この予約を取り消します」「まだ取り消していません」が読める', () => {
    open()
    const back = screen.getByRole('button', { name: '取り消さずに戻る' })
    const described = (back.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter((id) => id !== '')
      .map((id) => document.getElementById(id)?.textContent)
    expect(described).toEqual(['この予約を取り消します', 'まだ取り消していません'])
  })

  it('左が「取り消さずに戻る」、右が「この予約を取り消す」の逆転レイアウトになっている', () => {
    open()
    const foot = screen.getByRole('group', { name: '取り消しの出口' })
    expect(
      within(foot)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['取り消さずに戻る', 'この予約を取り消す'])
    expect(
      within(foot).getByText(
        'お客様にお伝えしてから取り消してください。取り消した予約は元に戻せません。',
      ),
    ).toBeVisible()
  })

  it('「取り消さずに戻る」で親へ戻り、何も取り消さない', async () => {
    const onBack = vi.fn()
    const onCancel = vi.fn()
    open({ onBack, onCancel })
    await userEvent.click(screen.getByRole('button', { name: '取り消さずに戻る' }))
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('触れるものは 44pt 以上（理由の札 96px・出口 56px）', () => {
    open()
    for (const choice of within(screen.getByRole('group', { name: '取り消しの理由' })).getAllByRole(
      'radio',
    )) {
      // 札そのもの（<label>）が触れる面。ラジオは飾りとして隠してある。
      expect(choice.closest('label')?.className).toContain('min-h-24')
    }
    expect(screen.getByRole('button', { name: '取り消さずに戻る' }).className).toContain('min-h-14')
    expect(screen.getByRole('button', { name: /この予約を取り消す/ }).className).toContain(
      'min-h-14',
    )
  })

  it.each([
    ['loading', 'ご予約を読み込んでいます…'],
    ['notFound', 'このご予約は見つかりませんでした。もう一度お探しください。'],
    ['error', 'ご予約を読み込めませんでした。画面を開き直してください。'],
    ['forbidden', 'ご予約を取り消す権限がありません。お店の管理者にご確認ください。'],
  ] as const)('%s のときは取り消しの操作を出さず、%s と伝える', (phase, message) => {
    open({ phase })
    expect(screen.getByText(message)).toBeVisible()
    expect(screen.queryByRole('button', { name: /この予約を取り消す/ })).not.toBeInTheDocument()
  })
})
