import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CustomerMerge, canOpenMerge, type MergeSide } from './CustomerMerge'

/*
 * 同じお客様のおまとめ（承認済みモック docs/frontend/mockups/eye/images/CUSTOMER-MERGE.png）。
 *
 * この面の仕事は「取り消せない操作の前に、まとめたあとの姿と失うものを同じ画面で読ませる」こと。
 *
 * 実測値（screens/CUSTOMER-MERGE.html の <style> と assets/eye.css）:
 *   本文 padding 28px 32px・2 列 1fr / 300px・gap 28px
 *   見比べ表 3 列 108px / 1fr / 1fr、見出し行は下に padding 14px ＋ 1px の line-strong
 *   各行 min-height 96px・下に 1px の罫、項目名 15px ＋ 補足 13px
 *   値の枠 margin 10px 6px・padding 10px 12px・角 8px・2px の透明枠。値 16px/600・補足 13px
 *   右上の結果は緑の箱（dl は 76px / 1fr・row-gap 10px・dt 13px・dd 15px/600 の 5 行）
 *   右下の警告は赤の箱（li 13px・行間 1.7 の 2 項目）
 *
 * 「残す」「残さない」は**文字で**言う（緑の枠と取り消し線は補助であって、色だけに意味を持たせない）。
 */

/** 既定の normalizer は全角の空白（U+3000）を半角へ畳むので、文字どおり探すときに使う。 */
const asWritten = { normalizer: (text: string) => text.trim() }

const A: MergeSide = {
  id: '11111111-1111-4111-8111-111111111111',
  customerNumber: 'G-01842',
  name: '田中 花子',
  kana: 'たなか はなこ',
  phoneNormalized: '09012345678',
  phoneLast4: '5678',
  address: null,
  memo: '金属アレルギー',
  visitCount: 4,
  lastVisitAt: '2026-05-12',
  mergedIntoId: null,
  noteCount: 7,
  version: 3,
  registeredLabel: '2024年3月15日 ご登録／銀座店',
  addressNote: '',
  noteSummary: '注意ごと 1件（金属アレルギー）',
}

const B: MergeSide = {
  id: '22222222-2222-4222-8222-222222222222',
  customerNumber: 'G-02310',
  name: '田中 花子',
  kana: '',
  phoneNormalized: '09012345678',
  phoneLast4: '5678',
  address: '東京都中央区銀座 4-◯-◯',
  memo: '',
  visitCount: 1,
  lastVisitAt: '2026-08-13',
  mergedIntoId: null,
  noteCount: 1,
  version: 1,
  registeredLabel: '2026年8月13日 ご登録／受付iPad',
  addressNote: '2026年8月13日 受付でお伺いしました',
  noteSummary: 'フレームのご相談',
}

function Merge(props: Partial<Parameters<typeof CustomerMerge>[0]> = {}) {
  return (
    <CustomerMerge
      primary={A}
      secondary={B}
      canManage
      onMerge={() => {}}
      onPreviewAgain={() => {}}
      onCancel={() => {}}
      onSwap={() => {}}
      {...props}
    />
  )
}

function row(label: string): HTMLElement {
  return screen.getByRole('radiogroup', { name: label })
}

function result(): HTMLElement {
  return screen.getByRole('region', { name: 'まとめると、こうなります' })
}

describe('見比べ', () => {
  it('項目は お名前 / お電話番号 / ご住所 / 接客のメモ の 4 つ', () => {
    render(<Merge />)
    const names = screen.getAllByRole('radiogroup').map((group) => group.getAttribute('aria-label'))
    expect(names).toEqual(['お名前', 'お電話番号', 'ご住所', '接客のメモ'])
  })

  it('残す側は「✓ 残す」、残さない側は「残さない」と取り消し線で示す（色だけで示さない）', () => {
    render(<Merge />)
    const name = row('お名前')
    const keep = within(name).getByRole('radio', { checked: true })
    const drop = within(name).getByRole('radio', { checked: false })
    // 文字で言い切る。緑の枠と取り消し線はそれを助けるだけ。
    expect(within(keep).getByText('✓ 残す')).toBeVisible()
    expect(within(drop).getByText('残さない')).toBeVisible()
    expect(within(drop).getByTestId('merge-value').className).toContain('line-through')
    // 左の項目名の下に、いまどちらを残すのかを文で置く。
    expect(within(name).getByText('A を残します')).toBeVisible()
  })

  it('接客のメモだけ「両方を残します」を選べる', () => {
    render(<Merge />)
    expect(within(row('接客のメモ')).getByRole('radio', { name: '両方を残します' })).toBeVisible()
    for (const label of ['お名前', 'お電話番号', 'ご住所']) {
      expect(within(row(label)).queryByRole('radio', { name: '両方を残します' })).toBeNull()
    }
  })

  it('値の無い側は「ご登録がありません」と出す', () => {
    render(<Merge />)
    // A にご住所が無いので、A 側は「残さない」＋「ご登録がありません」になる。
    const address = row('ご住所')
    expect(within(address).getByText('ご登録がありません')).toBeVisible()
    expect(within(address).getByText('B を残します')).toBeVisible()
    // ふりがなの無い側も空欄にしない。
    expect(within(row('お名前')).getByText('ふりがな：ご登録がありません')).toBeVisible()
  })
})

describe('結果', () => {
  it('「まとめると、こうなります」にお客様番号 G-01842 と 接客のメモ 8件 が出る', () => {
    render(<Merge />)
    const panel = result()
    expect(within(panel).getByText('G-01842')).toBeVisible()
    expect(within(panel).getByText('8件')).toBeVisible()
    expect(within(panel).getByText('田中 花子 様', asWritten)).toBeVisible()
    expect(within(panel).getByText('090-1234-5678')).toBeVisible()
    expect(within(panel).getByText('東京都中央区銀座 4-◯-◯')).toBeVisible()
  })

  it('残す側を切り替えると、結果の値がその場で入れ替わる', async () => {
    render(<Merge />)
    await userEvent.click(within(row('接客のメモ')).getAllByRole('radio')[0] as HTMLElement)
    expect(within(result()).getByText('7件')).toBeVisible()

    await userEvent.click(within(row('ご住所')).getAllByRole('radio')[0] as HTMLElement)
    expect(within(result()).getByText('ご登録がありません')).toBeVisible()
    expect(within(result()).queryByText('東京都中央区銀座 4-◯-◯')).toBeNull()
  })
})

describe('警告', () => {
  it('「まとめると元に戻せません」「お客様番号 G-02310 は使えなくなります。」「操作した者と日時は記録に残ります。」が同じ画面に出る', () => {
    render(<Merge />)
    const warning = screen.getByRole('region', { name: 'ご注意' })
    expect(within(warning).getByText('まとめると元に戻せません')).toBeVisible()
    // お客様番号だけ等幅なので、行は 1 つの文字列としてまとめて読む。
    expect(warning).toHaveTextContent('お客様番号 G-02310 は使えなくなります。')
    expect(within(warning).getByText('操作した者と日時は記録に残ります。')).toBeVisible()
    // 実行と同じ視線の上にあること。
    expect(screen.getByRole('button', { name: 'この内容でまとめる' })).toBeVisible()
  })
})

describe('実行', () => {
  it('「この内容でまとめる」を押すと、押したボタンだけが「まとめています…」に変わる', async () => {
    const onMerge = vi.fn()
    render(<Merge onMerge={onMerge} />)
    await userEvent.click(screen.getByRole('button', { name: 'この内容でまとめる' }))

    const busy = screen.getByRole('button', { name: 'まとめています…' })
    // disabled にすると押した先からフォーカスが消えるので、aria で伝える。
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'やめる' })).toBeVisible()

    expect(onMerge).toHaveBeenCalledTimes(1)
    expect(onMerge.mock.calls[0]?.[0]).toEqual({
      primaryId: A.id,
      secondaryId: B.id,
      primaryVersion: 3,
      secondaryVersion: 1,
      fields: [
        { field: 'name', choice: 'primary' },
        { field: 'phone', choice: 'primary' },
        // 値の無い側を既定で残さない（A にご住所が無い）。
        { field: 'address', choice: 'secondary' },
        { field: 'notes', choice: 'both' },
      ],
    })

    // 二度押しても 2 度は走らない。
    await userEvent.click(busy)
    expect(onMerge).toHaveBeenCalledTimes(1)
  })

  it('拒まれたときは何が変わったかの差分と「もう一度下見する」を出し、下見からやり直させる', async () => {
    const onPreviewAgain = vi.fn()
    render(
      <Merge
        onPreviewAgain={onPreviewAgain}
        rejection={{ changes: ['B に 2026年8月28日 11:00 のご予約が入りました'] }}
      />,
    )
    const notice = screen.getByRole('alert')
    // ① 何も起きていないことを先に言う。
    expect(within(notice).getByText('まとめはまだ行っていません')).toBeVisible()
    // ② 何が変わったか。
    expect(within(notice).getByText('B に 2026年8月28日 11:00 のご予約が入りました')).toBeVisible()
    // ③ 次の一手。
    await userEvent.click(screen.getByRole('button', { name: 'もう一度下見する' }))
    expect(onPreviewAgain).toHaveBeenCalledTimes(1)
  })
})

describe('権限', () => {
  it('店長でないときは、一覧にも詳細にもおまとめの入口が出ない', () => {
    // 一覧と詳細が入口を出すかどうかは、この述語 1 つで決める。
    expect(canOpenMerge(['customer.read', 'customer.write'])).toBe(false)
    expect(canOpenMerge(['customer.read', 'settings.manage'])).toBe(true)
    // 直に開かれても、まとめる操作そのものが画面に無い。
    render(<Merge canManage={false} />)
    expect(screen.queryByRole('button', { name: 'この内容でまとめる' })).toBeNull()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.getByText('この操作は店長だけができます')).toBeVisible()
  })
})

describe('取り消し', () => {
  it('「やめる」では何も変えずに一覧へ戻る', async () => {
    const onCancel = vi.fn()
    const onMerge = vi.fn()
    render(<Merge onCancel={onCancel} onMerge={onMerge} />)
    await userEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onMerge).not.toHaveBeenCalled()
  })
})

describe('読み込み中と行き止まり', () => {
  it('下見を待つ間は見比べ表の形をした灰色の帯を置き、回るアイコンを置かない', () => {
    render(<Merge loading />)
    expect(screen.getAllByTestId('merge-skeleton-row')).toHaveLength(4)
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryByRole('button', { name: 'この内容でまとめる' })).toBeNull()
  })

  it('下見が取れなかったときは理由と「もう一度下見する」を出す', async () => {
    const onPreviewAgain = vi.fn()
    render(<Merge error="通信が届きませんでした。" onPreviewAgain={onPreviewAgain} />)
    expect(screen.getByRole('alert')).toHaveTextContent('通信が届きませんでした。')
    await userEvent.click(screen.getByRole('button', { name: 'もう一度下見する' }))
    expect(onPreviewAgain).toHaveBeenCalledTimes(1)
  })
})
