import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConflictPanel } from './ConflictPanel'

/*
 * 同じご予約を 2 台が直した（承認済みモック docs/frontend/mockups/eyex/images/EX-CONFLICT.png）。
 *
 * この面の仕事は「選ぶまで、どちらの内容も書き換わりません」を**形で**示すこと。
 * だからこの面は書き込みを持たない。出口はどれも親へ選択を報せるだけである。
 *
 * 実測（screens/EX-CONFLICT.html の <style> と assets/eyex.css）:
 *   .wrap = padding 32px 36px 28px
 *   .lead = --alert-tint のカード・左に 6px の --alert。h2 22px（--alert）＋ 本文 16px/1.6（上に 10px）
 *   .two  = 2 列・gap 24px（上に 28px）。.side = 1px --line-strong・角 12px、自分の面だけ 2px --brand
 *   .sh   = padding 14px 18px（自分の面は --brand-tint 地）。h3 16px ＋ 13px の出どころ
 *   .cr   = 116px 1fr・gap 12px・padding 15px 0。k 13px / v 16px/600/1.45
 *           .was は 13px の取り消し線（上に 3px）、変わらない行は 400 の --ink-2
 *   .sf   = padding 16px 18px・上に 1px の罫。ボタンは幅いっぱい
 *   .foot = 上に 24px・右寄せ（「1項目ずつ選ぶ」「やめて台帳に戻る」）
 *
 * **旧値がある行＝変わった行**の 1 つの規則で描く（モックは相手側の「担当」を旧値なしで
 * 太字にしており規則が二重になっている。色だけで状態を伝えないという決めに寄せる）。
 */

const ROWS = [
  {
    key: 'datetime',
    term: 'お日にちとお時間',
    theirs: { value: '8月27日（木）14:00–15:00', previous: '8月27日（木）11:00–12:00' },
    mine: { value: '8月28日（金）10:30–11:30', previous: '8月27日（木）11:00–12:00' },
  },
  {
    key: 'staff',
    term: '担当',
    theirs: { value: '佐藤 美咲', previous: null },
    mine: { value: '小林 学', previous: '佐藤 美咲' },
  },
  {
    key: 'equipment',
    term: '場所',
    theirs: { value: '視力測定機 A・相談カウンター 2', previous: null },
    mine: { value: '視力測定機 B・相談カウンター 1', previous: '視力測定機 A・相談カウンター 2' },
  },
] as const

type Props = Parameters<typeof ConflictPanel>[0]

function open(props: Partial<Props> = {}) {
  return render(
    <ConflictPanel
      theirs={{
        actorName: '中村 彩',
        terminalName: '受付iPad',
        savedAt: '2026-08-27T02:06:00.000Z',
      }}
      mine={{ terminalName: 'レジ横iPad' }}
      rows={ROWS}
      onResolve={() => {}}
      onAbort={() => {}}
      {...props}
    />,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('競合', () => {
  it('端末の名前が分からないときは「中村 彩 が 11:06 に保存しました。」と読ませる', () => {
    // 409 の応答は保存した人の名前しか載せない。無い端末の名前をでっち上げない。
    open({
      theirs: { actorName: '中村 彩', terminalName: '', savedAt: '2026-08-27T02:06:00.000Z' },
    })
    expect(screen.getByRole('alert').textContent).toContain(
      '中村 彩 が 11:06 に保存しました。選ぶまで、どちらの内容も書き換わりません。',
    )
    expect(screen.getByRole('alert').textContent).not.toContain(' の 中村 彩 が')
    expect(
      within(screen.getByRole('region', { name: '中村 彩 が保存した内容' })).getByText(
        '11:06 保存済み',
      ),
    ).toBeVisible()
  })

  it('「同じご予約を、ほかの端末でも直していました」と「選ぶまで、どちらの内容も書き換わりません。」が出る', () => {
    open()
    const lead = screen.getByRole('alert')
    expect(
      within(lead).getByRole('heading', { name: '同じご予約を、ほかの端末でも直していました' }),
    ).toBeVisible()
    expect(lead.textContent).toContain(
      '受付iPad の 中村 彩 が 11:06 に保存しました。選ぶまで、どちらの内容も書き換わりません。',
    )
  })

  it('左に相手の内容（保存済み）、右に自分の内容（まだ保存していません）が並ぶ', () => {
    open()
    const sides = screen.getAllByRole('region')
    expect(sides.map((side) => within(side).getByRole('heading').textContent)).toEqual([
      '中村 彩 が保存した内容',
      'あなたが直した内容',
    ])
    expect(within(sides[0] as HTMLElement).getByText('受付iPad／11:06 保存済み')).toBeVisible()
    expect(
      within(sides[1] as HTMLElement).getByText('レジ横iPad／まだ保存していません'),
    ).toBeVisible()
  })

  it('変わった項目だけ旧値に取り消し線が付き、変わらない項目は薄字になる', () => {
    open()
    const theirs = screen.getByRole('region', { name: '中村 彩 が保存した内容' })
    const changed = within(theirs).getByText('8月27日（木）14:00–15:00')
    const was = within(theirs).getByText('8月27日（木）11:00–12:00')
    expect(changed.className).toContain('font-semibold')
    expect(was.className).toContain('line-through')
    // 変わっていない項目は旧値を持たず、薄字のまま並ぶ（色だけで伝えないので太さも落とす）。
    const same = within(theirs).getByText('視力測定機 A・相談カウンター 2')
    expect(same.className).toContain('text-ink-muted')
    expect(same.className).not.toContain('font-semibold')
    expect(
      within(theirs).queryByText('視力測定機 A・相談カウンター 2', { selector: '.line-through' }),
    ).not.toBeInTheDocument()
  })

  it('出口は 相手の内容を残す／あなたの内容で上書きする／1項目ずつ選ぶ／やめて台帳に戻る の 4 つ', () => {
    open()
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      '中村 彩 の内容を残す',
      'あなたの内容で上書きする',
      '1項目ずつ選ぶ',
      'やめて台帳に戻る',
    ])
  })

  it('「1項目ずつ選ぶ」を押すと各行にラジオが出て、全行を選ぶまで保存を押せない', async () => {
    open()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    await userEvent.click(screen.getByRole('button', { name: '1項目ずつ選ぶ' }))
    // 3 行 × 相手／自分 の 6 つ。どれも選ばれていない状態から始める。
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(6)
    for (const radio of radios) expect(radio).not.toBeChecked()

    const save = screen.getByRole('button', { name: /選んだ内容で保存する/ })
    expect(save).toBeDisabled()
    expect(save).toHaveAttribute(
      'aria-label',
      '選んだ内容で保存する（残り 3 項目を選ぶと押せます）',
    )

    await userEvent.click(screen.getByRole('radio', { name: 'お日にちとお時間は 中村 彩 の内容' }))
    await userEvent.click(screen.getByRole('radio', { name: '担当は あなたの内容' }))
    expect(screen.getByRole('button', { name: /選んだ内容で保存する/ })).toBeDisabled()

    await userEvent.click(screen.getByRole('radio', { name: '場所は あなたの内容' }))
    expect(screen.getByRole('button', { name: '選んだ内容で保存する' })).toBeEnabled()
  })

  it('1項目ずつ選んだ結果は行ごとの選択として親へ渡る', async () => {
    const onResolve = vi.fn()
    open({ onResolve })
    await userEvent.click(screen.getByRole('button', { name: '1項目ずつ選ぶ' }))
    await userEvent.click(screen.getByRole('radio', { name: 'お日にちとお時間は 中村 彩 の内容' }))
    await userEvent.click(screen.getByRole('radio', { name: '担当は あなたの内容' }))
    await userEvent.click(screen.getByRole('radio', { name: '場所は あなたの内容' }))
    await userEvent.click(screen.getByRole('button', { name: '選んだ内容で保存する' }))
    expect(onResolve).toHaveBeenCalledWith({
      kind: 'perField',
      picks: { datetime: 'theirs', staff: 'mine', equipment: 'mine' },
    })
  })

  it('どの出口も、押した時点ではまだ何も保存されていない', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const onResolve = vi.fn()
    const onAbort = vi.fn()

    const { unmount } = open({ onResolve, onAbort })
    await userEvent.click(screen.getByRole('button', { name: '中村 彩 の内容を残す' }))
    expect(onResolve).toHaveBeenLastCalledWith({ kind: 'theirs' })
    unmount()

    open({ onResolve, onAbort })
    await userEvent.click(screen.getByRole('button', { name: 'あなたの内容で上書きする' }))
    expect(onResolve).toHaveBeenLastCalledWith({ kind: 'mine' })

    await userEvent.click(screen.getByRole('button', { name: 'やめて台帳に戻る' }))
    expect(onAbort).toHaveBeenCalledTimes(1)

    // この面は書き込みを持たない。選んだ結果を送るのは親の仕事である。
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('触れるものは 44pt 以上（出口 48px・1項目ずつの札 44px）', async () => {
    open()
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).toContain('min-h-12')
    }
    await userEvent.click(screen.getByRole('button', { name: '1項目ずつ選ぶ' }))
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.closest('label')?.className).toContain('min-h-11')
    }
  })

  it.each([
    ['loading', 'ご予約を読み込んでいます…'],
    ['notFound', 'このご予約は見つかりませんでした。もう一度お探しください。'],
    ['error', 'ほかの端末の内容を読み込めませんでした。画面を開き直してください。'],
    ['forbidden', 'ご予約を変更する権限がありません。お店の管理者にご確認ください。'],
  ] as const)('%s のときは選ばせず、%s と伝える', (phase, message) => {
    open({ phase })
    expect(screen.getByText(message)).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'あなたの内容で上書きする' }),
    ).not.toBeInTheDocument()
  })
})
