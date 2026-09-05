/**
 * 設定の面の骨格。AdminLTE の `content-header` / `box` / `small-box` を、
 * この製品のトークンへ翻訳したもの。**色は theme.css のトークンだけを使う**
 * （AdminLTE の aqua/green/yellow/red は pine/web/walkin/danger へ写す）。
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Box, ContentHeader, SmallBox } from './parts'

describe('ContentHeader', () => {
  it('見出しと、いまいる場所への道筋を出す', () => {
    render(<ContentHeader title="はじめの設定" crumbs={['eyex', 'はじめの設定']} />)

    expect(screen.getByRole('heading', { name: 'はじめの設定', level: 1 })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'いまいる場所' })
    expect(nav).toHaveTextContent('eyex')
    expect(nav).toHaveTextContent('はじめの設定')
  })

  it('補足があれば見出しの下に置く', () => {
    render(<ContentHeader title="はじめの設定" crumbs={['eyex']} note="あと 2 つです。" />)
    expect(screen.getByText('あと 2 つです。')).toBeInTheDocument()
  })
})

describe('Box', () => {
  it('見出し・中身・締めの 3 段で出す', () => {
    render(
      <Box title="お店を登録する" footer={<span>あとから変えられます。</span>}>
        <p>中身</p>
      </Box>,
    )

    expect(screen.getByRole('heading', { name: 'お店を登録する', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('中身')).toBeInTheDocument()
    expect(screen.getByText('あとから変えられます。')).toBeInTheDocument()
  })

  it('締めが無ければ締めの段を作らない（空の帯を置かない）', () => {
    const { container } = render(
      <Box title="お店を登録する">
        <p>中身</p>
      </Box>,
    )
    expect(container.querySelectorAll('footer')).toHaveLength(0)
  })
})

describe('SmallBox', () => {
  it('数と名前と、次の一手を 1 枚に載せる', () => {
    const onPress = vi.fn()
    render(
      <SmallBox
        value={0}
        label="店員"
        tone="walkin"
        action={{ label: '店員を登録する', onPress }}
      />,
    )

    const button = screen.getByRole('button', { name: '店員 0　店員を登録する' })
    fireEvent.click(button)
    expect(onPress).toHaveBeenCalled()
  })

  it('数だけを読み上げさせない（何の数かを名前で言う）', () => {
    render(<SmallBox value={3} label="ご来店の目的" tone="pine" />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('ご来店の目的')).toBeInTheDocument()
  })

  it('次の一手が無いときは押せる見た目にしない', () => {
    render(<SmallBox value={1} label="お店" tone="pine" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('済んだものと、まだのものを色で分ける', () => {
    const { rerender, container } = render(<SmallBox value={1} label="お店" tone="pine" />)
    const done = container.firstElementChild?.className ?? ''
    rerender(<SmallBox value={0} label="店員" tone="walkin" />)
    const todo = container.firstElementChild?.className ?? ''

    expect(done).not.toBe(todo)
    // 生の色は書かない。トークンだけを使う。
    expect(`${done}${todo}`).not.toMatch(/#[0-9a-f]{3,6}|\[[^\]]*px\]|bg-(blue|green|red|yellow)-/)
  })
})
