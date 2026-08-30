import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DoneStep } from './DoneStep'

/*
 * 予約が取れた（承認済みモック docs/frontend/mockups/eyex/images/BOOK-06-DONE.png）。
 *
 * この面の仕事は「取れたことを一目で伝え、番号・内容・お伝えごとを同じ面に置く」こと。
 *
 * 実測値（screens/BOOK-06-DONE.html と assets/eyex.css）:
 *   **stepbar を持たない**。左 1fr ／ 右 372px、余白 40px 44px ／ 40px 28px。
 *   ✓ の丸は 78px、見出し 30px、予約番号 22px のモノスペース。要約は 2 列（`dd` 19px/600）。
 *   「続けて予約を取る」「台帳で見る」は上に 40px。右は 3 点のお伝えごと（1 行 18px 上下）。
 *
 * **控えを送らない。**notifier はメールだけを送り、`to` はメールアドレス型なので、
 * お電話番号へ控えを送る手立てが無い（`04-api.md` §7）。モックの 1 行は採らない（AC-BOOK-13）。
 */

const STARTS_AT = '2026-08-27T02:00:00.000Z' // 11:00 JST
const ENDS_AT = '2026-08-27T03:00:00.000Z' // 12:00 JST

function open(props: Partial<Parameters<typeof DoneStep>[0]> = {}) {
  return render(
    <DoneStep
      reservation={{
        code: 'EY-2608-0142',
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
        durationMinutes: 60,
        purposeLabel: 'メガネを新しく作る',
        customerName: '田中 花子',
        phoneDigits: '09012345678',
        staffName: '佐藤 美咲',
        equipmentNames: ['相談カウンター 2'],
      }}
      onBookAgain={() => {}}
      onOpenLedger={() => {}}
      {...props}
    />,
  )
}

describe('完了', () => {
  it('「ご予約を承りました」と EY-2608-0142 の形の予約番号が出る', () => {
    open()
    expect(screen.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()
    const code = screen.getByText('EY-2608-0142')
    expect(code).toBeVisible()
    expect(code.textContent).toMatch(/^EY-\d{4}-\d{4,5}$/)
    const summary = screen.getByRole('region', { name: 'ご予約の内容' })
    expect(within(summary).getByText('8月27日（木）11:00 〜 12:00')).toBeVisible()
    expect(within(summary).getByText('メガネを新しく作る')).toBeVisible()
    expect(within(summary).getByText('田中 花子 様')).toBeVisible()
    expect(within(summary).getByText('佐藤 美咲')).toBeVisible()
  })

  it('「控えは 090-1234-5678 へお送りしました。」を出さない', () => {
    open()
    expect(screen.queryByText(/へお送りしました/)).not.toBeInTheDocument()
  })

  it('代わりに「予約番号 EY-2608-0142 をお控えいただくようお伝えください」を出す', () => {
    open()
    expect(
      screen.getByText('予約番号 EY-2608-0142 をお控えいただくようお伝えください'),
    ).toBeVisible()
  })

  it('お伝えすること 3 点（10分前 10:50 ごろ／今のメガネ／変更はお電話）が並ぶ', () => {
    open()
    const talks = screen.getByRole('list', { name: 'お客様にお伝えすること' })
    expect(
      within(talks)
        .getAllByRole('listitem')
        // 先頭の ✓ は aria-hidden の飾りなので落として比べる。
        .map((node) => node.textContent?.replace(/^✓/, '')),
    ).toEqual([
      '10分前、10:50 ごろのお越しでお願いします',
      '今お使いのメガネをお持ちください',
      'ご変更・お取り消しはお電話で承ります',
    ])
  })

  it('工程の帯を出さない', () => {
    open()
    expect(screen.queryByRole('list', { name: '予約の工程　全5工程' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /次へ進む/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /前へ戻る/ })).not.toBeInTheDocument()
  })
})

describe('完了の次の一手', () => {
  it('「続けて予約を取る」と「台帳で見る」の 2 つだけを置く', async () => {
    const onBookAgain = vi.fn()
    const onOpenLedger = vi.fn()
    open({ onBookAgain, onOpenLedger })
    const next = screen.getByRole('group', { name: '次の一手' })
    expect(
      within(next)
        .getAllByRole('button')
        .map((node) => node.textContent),
    ).toEqual(['続けて予約を取る', '台帳で見る'])
    await userEvent.click(within(next).getByRole('button', { name: '続けて予約を取る' }))
    await userEvent.click(within(next).getByRole('button', { name: '台帳で見る' }))
    expect(onBookAgain).toHaveBeenCalledTimes(1)
    expect(onOpenLedger).toHaveBeenCalledTimes(1)
  })

  it('担当が未定・設備を決めていないご予約も、言葉で埋めて出す', () => {
    open({
      reservation: {
        code: 'EY-2608-0143',
        startsAt: STARTS_AT,
        endsAt: ENDS_AT,
        durationMinutes: 60,
        purposeLabel: 'メガネを新しく作る',
        customerName: '田中 花子',
        phoneDigits: '',
        staffName: null,
        equipmentNames: [],
      },
    })
    const summary = screen.getByRole('region', { name: 'ご予約の内容' })
    expect(within(summary).getByText('決めてください')).toBeVisible()
    expect(within(summary).getByText('あとで決める')).toBeVisible()
  })
})
