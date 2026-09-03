import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PermissionRefusal, SaveBar } from './SaveBar'

const manager = {
  id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  displayName: '山田 大輔',
  kana: 'やまだ だいすけ',
  jobLabel: '店長',
  role: 'manager' as const,
  isActive: true,
  sortOrder: 1,
  skills: [],
  adminUserId: 'dev:eyex-manager',
  hasPin: true,
  maxParallelReservations: 1,
  pinUpdatedAt: null,
}

describe('権限不足から店長PINで続ける', () => {
  it('共通の秘匿PIN欄とテンキーを使い、平文PINを表示DOMへ出さない', async () => {
    const onElevate = vi.fn(async () => true)
    render(
      <PermissionRefusal
        target="営業時間"
        actor={{ name: '中村 彩', role: 'staff', roleLabel: 'スタッフ' }}
        changes={['営業時間：10:00 → 10:30']}
        staff={[manager]}
        onElevate={onElevate}
      />,
    )

    for (const digit of '2580') await userEvent.click(screen.getByRole('button', { name: digit }))

    expect(document.body).not.toHaveTextContent('2580')
    expect(screen.getByLabelText(/暗証番号 6桁のうち4桁を入力済み/)).toHaveValue('●●●●')
    await userEvent.click(screen.getByRole('button', { name: '店長として続ける' }))
    expect(onElevate).toHaveBeenCalledWith(manager.id, '2580')
  })
})

/*
 * 主操作は押せないときも主操作の姿を保つ。
 *
 * 以前は「保存」が無効のとき `border + bg-surface-2 + text-ink-faint` になり、
 * この製品の押せる副ボタン（絞り込み・本日 など）とほぼ同じ姿だった。
 * 逆に押せる「変更を捨てる」は枠なしの灰色文字で、ただの説明文に見えていた。
 * **押せないものが押せそうに、押せるものが押せなさそうに見えていた**（UX 監査 UI-11）。
 * 承認済みモック SETTINGS-STORE.png の「保存」は緑の塗りの主ボタンである。
 */
describe('押せる・押せないの見せ方', () => {
  function bar(dirtyCount: number) {
    render(
      <SaveBar
        title="店舗の情報"
        dirtyCount={dirtyCount}
        danger={false}
        dangerNote={null}
        blocked={null}
        saving={false}
        onSave={() => {}}
        onDiscard={() => {}}
      />,
    )
    return {
      save: screen.getByRole('button', { name: /保存/ }),
      discard: screen.getByRole('button', { name: '変更を捨てる' }),
    }
  }

  it('「保存」は変更が無いときも緑の塗りのまま', () => {
    const { save } = bar(0)
    expect(save).toBeDisabled()
    expect(save.className).toContain('bg-pine')
    // 別の色へ塗り替えない（副ボタンに化けさせない）。
    expect(save.className).not.toContain('bg-surface-2')
  })

  it('押せないことは彩度で示す（色を変えない）', () => {
    const { save } = bar(0)
    expect(save.className).toContain('disabled:opacity-40')
    expect(save.className).toContain('disabled:cursor-not-allowed')
  })

  it('「変更を捨てる」は枠を持ち、ボタンに見える', () => {
    const { discard } = bar(2)
    expect(discard.className).toContain('border-line-strong')
    expect(discard.className).toContain('bg-surface')
  })

  it('変更があれば両方押せる', () => {
    const { save, discard } = bar(2)
    expect(save).toBeEnabled()
    expect(discard).toBeEnabled()
  })

  it('未保存の件数を札で出す', () => {
    bar(2)
    expect(screen.getByText('未保存の変更 2件')).toBeInTheDocument()
  })
})
