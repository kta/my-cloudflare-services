import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ChangeDone } from './ChangeDone'

/*
 * 変更・取消を承った（承認済みモック docs/frontend/mockups/eye/images/CHANGE-DONE.png）。
 *
 * この面の主役は「予約番号が変わらないこと」である。取消の完了も**この面を流用**し、
 * 新しい画面 ID を作らずに文言だけを差し替える（`spec.md`「決めたこと」）。
 *
 * 実測（screens/CHANGE-DONE.html の <style> と assets/eye.css）:
 *   .done = padding 40px 44px 0・中央寄せ。.mark = 76px の円（--brand 地）・38px の ✓
 *   h2 26px（上に 18px）。.no = ピル・padding 6px 16px・--brand-tint 地・等幅 16px/600
 *           ＋ 13px の「予約番号は変わりません」（上に 12px）
 *   .two = 最大 900px の 2 列・gap 56px・上に 44px。h3 14px/600（下に 14px）
 *   .sum = dt 12px（上に 20px）／ dd 17px/600、日時の dd だけ 22px の --brand-dark、補足 13px
 *   .tell = 16px/1.6・1 行 padding 14px 0・下に 1px の罫
 *   .next = 上に 44px・gap 14px。.audit = 左 44px / 下 20px の 13px
 *
 * **変更・取消のメールは送らない**（`NotificationJob` に型が無く、型を足すのは
 * 別サービスの契約変更で人間の承認事項）。モックの「お電話でのご予約のため、メールは
 * 送っていません。」の代わりに「お客様へのご連絡は、お電話でお願いします。」を置く。
 */

const STARTS_AT = '2026-08-27T05:00:00.000Z' // 14:00 JST
const ENDS_AT = '2026-08-27T06:00:00.000Z' // 15:00 JST

type Props = Parameters<typeof ChangeDone>[0]

function open(props: Partial<Props> = {}) {
  return render(
    <ChangeDone
      kind="changed"
      reservation={{
        code: 'EY-2608-0142',
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
        durationMinutes: 60,
        customerName: '田中 花子',
        staffName: '佐藤 美咲',
        equipmentNames: ['視力測定機 A', '相談カウンター 2'],
      }}
      previousRange="11:00–12:00"
      tell={[
        '本日 午後2時のご来店に変わりました。担当は佐藤、所要は約60分です。',
        'いまお使いのメガネをお持ちください。',
      ]}
      audit={{
        storeName: '銀座店',
        terminalName: 'レジ横iPad',
        at: '2026-08-27T02:12:00.000Z', // 11:12 JST
        actorName: '中村 彩',
      }}
      onOpenLedger={() => {}}
      onGoHome={() => {}}
      {...props}
    />,
  )
}

describe('完了', () => {
  it('「ご予約の変更を承りました」と「予約番号は変わりません」が出る', () => {
    open()
    expect(screen.getByRole('heading', { name: 'ご予約の変更を承りました' })).toBeVisible()
    expect(screen.getByText('予約番号は変わりません')).toBeVisible()
  })

  it('予約番号が変わっていない（面に出る番号は変更前と同じ 1 つだけ）', () => {
    open()
    expect(screen.getAllByText(/^EY-\d{4}-\d{4,5}$/).map((node) => node.textContent)).toEqual([
      'EY-2608-0142',
    ])
  })

  it('変更後の日時に「変更前は 11:00–12:00」が添う', () => {
    open()
    const summary = screen.getByRole('group', { name: '変更後のご予約' })
    expect(within(summary).getByText('8月27日（木）14:00–15:00')).toBeVisible()
    // 全角の空白は読み上げの正規化で潰れるので、要素を見つけてから原文で照合する。
    expect(within(summary).getByText(/変更前は/).textContent).toBe(
      '所要 60分　変更前は 11:00–12:00',
    )
    expect(within(summary).getByText('田中 花子 様')).toBeVisible()
    expect(within(summary).getByText('佐藤 美咲')).toBeVisible()
    expect(within(summary).getByText('視力測定機 A／相談カウンター 2')).toBeVisible()
  })

  it('「この操作は受付履歴に残ります（銀座店 レジ横iPad・11:12　操作者 中村 彩）。」が出る', () => {
    open()
    expect(screen.getByText(/この操作は受付履歴に残ります/).textContent).toBe(
      'この操作は受付履歴に残ります（銀座店 レジ横iPad・11:12　操作者 中村 彩）。',
    )
  })

  it('お客様にお伝えすることが並び、ご連絡はお電話でお願いする 1 行が付く', () => {
    open()
    const tell = screen.getByRole('list', { name: 'お客様にお伝えすること' })
    expect(
      within(tell)
        .getAllByRole('listitem')
        .map((node) => node.textContent),
    ).toEqual([
      '本日 午後2時のご来店に変わりました。担当は佐藤、所要は約60分です。',
      'いまお使いのメガネをお持ちください。',
    ])
    // 変更・取消のメールは送らないので、モックの「メールは送っていません。」は採らない。
    expect(screen.getByText('お客様へのご連絡は、お電話でお願いします。')).toBeVisible()
    expect(screen.queryByText(/メールは送っていません/)).not.toBeInTheDocument()
  })

  it('出口は「台帳で見る」（主操作）と「トップへ戻る」の 2 つで、どちらも 44pt 以上ある', async () => {
    const onOpenLedger = vi.fn()
    const onGoHome = vi.fn()
    open({ onOpenLedger, onGoHome })
    const next = screen.getByRole('group', { name: '次の一手' })
    expect(
      within(next)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['台帳で見る', 'トップへ戻る'])
    for (const button of within(next).getAllByRole('button')) {
      expect(button.className).toContain('min-h-14')
    }
    await userEvent.click(within(next).getByRole('button', { name: '台帳で見る' }))
    await userEvent.click(within(next).getByRole('button', { name: 'トップへ戻る' }))
    expect(onOpenLedger).toHaveBeenCalledTimes(1)
    expect(onGoHome).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['loading', 'ご予約を読み込んでいます…'],
    ['notFound', 'このご予約は見つかりませんでした。もう一度お探しください。'],
    ['error', 'お手続きは終わっています。この面を読み込めませんでした。台帳でお確かめください。'],
    ['forbidden', 'この画面をご覧になる権限がありません。お店の管理者にご確認ください。'],
  ] as const)('%s のときは要約を出さず、%s と伝える', (phase, message) => {
    open({ phase })
    expect(screen.getByText(message)).toBeVisible()
    expect(screen.queryByRole('group', { name: '変更後のご予約' })).not.toBeInTheDocument()
  })
})

describe('完了（取消）', () => {
  it('「ご予約を取り消しました」「この枠は、ほかのお客様にご案内できる状態に戻りました。」が出る', () => {
    open({ kind: 'cancelled', previousRange: null })
    expect(screen.getByRole('heading', { name: 'ご予約を取り消しました' })).toBeVisible()
    expect(screen.getByText('この枠は、ほかのお客様にご案内できる状態に戻りました。')).toBeVisible()
    // 脚注は変更のときと同じ 1 行。
    expect(screen.getByText(/この操作は受付履歴に残ります/).textContent).toBe(
      'この操作は受付履歴に残ります（銀座店 レジ横iPad・11:12　操作者 中村 彩）。',
    )
  })

  it('取消の完了では「予約番号は変わりません」を出さず、要約の見出しが「取り消したご予約」になる', () => {
    open({ kind: 'cancelled', previousRange: null })
    expect(screen.queryByText('予約番号は変わりません')).not.toBeInTheDocument()
    expect(screen.getByText('EY-2608-0142')).toBeVisible()
    expect(screen.getByRole('group', { name: '取り消したご予約' })).toBeVisible()
    expect(screen.queryByText(/変更前は/)).not.toBeInTheDocument()
  })
})
