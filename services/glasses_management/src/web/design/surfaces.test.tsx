import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { CardColumns, CardGrid, FieldCard, Matrix } from './surfaces'

/*
 * カードの格子は SP 幅で 1 列に落とす。
 *
 * モックの 2 列・3 列は iPad の実測値である。357px の端末で 2 列を保つと 1 列
 * あたり 170px しか無く、`公開状態` のような和文の見出しが 1 行 1 文字に折れて
 * 読めなくなる（SETTINGS-SP の撮影で実際に起きた）。列数は幅から決めさせない
 * という規約は iPad 以上の話で、SP では読めることを採る。
 */
test('カードの格子は SP 幅で 1 列に落ちる', () => {
  render(
    <CardGrid columns={2}>
      <FieldCard title="公開状態">9月15日 10:00に公開</FieldCard>
    </CardGrid>,
  )

  const grid = screen.getByText('公開状態').closest('div.grid')
  expect(grid?.className).toContain('max-sm:grid-cols-1')
})

/*
 * 3 枚組のカードは、枚数より 1 枚の幅を守る。
 *
 * モックのこのカードは 236〜247px あり、そこに「視力測定・新調相談」のような
 * 和文が 1 行で載っていた。実アプリは同じ本文から 250px の柱をさらに引くので、
 * 3 列を固定すると 1 枚 152px になり `測定日 2026-06-` / `01・店舗` と語中で
 * 折れる。列の数はモックに合わせられても、読めない字ではモックに似ていない。
 * 幅の下限を敷いて、入らないときは段を下げる。
 */
test('3 枚組は 1 枚の幅を下限で守り、入らなければ段を下げる', () => {
  render(
    <CardColumns>
      <div>視力測定・新調相談</div>
    </CardColumns>,
  )

  const grid = screen.getByText('視力測定・新調相談').parentElement
  expect(grid?.style.gridTemplateColumns).toBe('repeat(auto-fit, minmax(200px, 1fr))')
})

/*
 * 権限表のセルは同じ字（`許可` / `不可`）が 1 行に何度も並ぶ。
 *
 * 字を並びの目印に使うと同じ目印が重なり、React が「どのセルがどれか」を
 * 見失う（開発中に `Encountered two children with the same key, 許可` が出て
 * いた）。並びが変わったときに、更新すべきセルを取り違える。目印は位置で持つ。
 */
test('権限表は同じ字のセルが並んでも取り違えない', () => {
  const errors: unknown[] = []
  const original = console.error
  console.error = (...args: unknown[]) => errors.push(args[0])
  try {
    render(
      <Matrix
        label="注意事項の権限"
        columns={['ロール', '閲覧', '登録']}
        rows={[{ label: '店舗スタッフ', cells: [{ text: '許可' }, { text: '許可' }] }]}
      />,
    )
  } finally {
    console.error = original
  }

  expect(errors).toEqual([])
  expect(screen.getAllByText('許可')).toHaveLength(2)
})
