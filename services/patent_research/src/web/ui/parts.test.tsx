import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Empty, Notice, Panel, ParaNo, Seal, sealOf } from './parts'

/*
 * 検印は製品の判断の一点である。照合状態が「済」に化けないことを固定する。
 */

describe('sealOf', () => {
  it('照合済みだけが「済」', () => {
    expect(sealOf('verified')).toBe('verified')
  })

  it('未照合と照合不能は「未」（却と取り違えない）', () => {
    expect(sealOf('pending')).toBe('pending')
    expect(sealOf('not_in_corpus_tier2')).toBe('pending')
  })

  it('照合に失敗したものはすべて「却」', () => {
    for (const q of [
      'quote_mismatch',
      'quote_too_short',
      'paragraph_missing',
      'publication_missing',
      'quote_empty',
    ] as const) {
      expect(sealOf(q)).toBe('rejected')
    }
  })
})

describe('Seal', () => {
  it('一字と、読み上げ用の意味を両方持つ（色だけに意味を持たせない）', () => {
    render(<Seal kind="verified" />)
    const seal = screen.getByRole('img', { name: /照合済み/ })
    expect(seal).toHaveTextContent('済')
  })

  it('棄却は「支持の根拠にならない」ことを読み上げに含む', () => {
    render(<Seal kind="rejected" />)
    expect(screen.getByRole('img', { name: /支持の根拠にはならない/ })).toHaveTextContent('却')
  })

  it('典拠なしの空印は字を持たない', () => {
    render(<Seal kind="none" />)
    expect(screen.getByRole('img', { name: /典拠なし/ })).toBeInTheDocument()
  })
})

describe('ParaNo', () => {
  it('段落番号を公報の表記で見せる', () => {
    render(<ParaNo value="0032" />)
    expect(screen.getByText('【0032】')).toBeInTheDocument()
  })
})

describe('Panel', () => {
  it('見出しは h2 として読める', () => {
    render(<Panel title="典拠の余白">中身</Panel>)
    expect(screen.getByRole('heading', { level: 2, name: '典拠の余白' })).toBeInTheDocument()
    expect(screen.getByText('中身')).toBeInTheDocument()
  })

  it('見出しが無くても中身は出る', () => {
    render(<Panel>だけ</Panel>)
    expect(screen.getByText('だけ')).toBeInTheDocument()
  })
})

describe('Empty と Notice', () => {
  it('空を空のままにしない', () => {
    render(<Empty>まだ案件がありません。</Empty>)
    expect(screen.getByText('まだ案件がありません。')).toBeInTheDocument()
  })

  it('起きたことと直し方を書く', () => {
    render(<Notice tone="rejected">保存できませんでした。入力はそのまま残っています。</Notice>)
    expect(screen.getByText(/そのまま残っています/)).toBeInTheDocument()
  })
})
