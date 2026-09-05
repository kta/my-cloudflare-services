import { describe, expect, it } from 'vitest'
import { buildQuery, indexTokens, queryExpression, tokenRuns } from '../src/tokenize'

// 日本語の特許全文検索は「2文字の技術用語が引けること」が最低要件である。
// FTS5 の trigram トークナイザは 3 文字未満を引けないため使えない（実測 0 件）。
// ここでは空白区切り bigram + unicode61 + フレーズ検索という代替方式を固定する。
describe('tokenRuns', () => {
  it('句読点で区切って、区切りを跨ぐ bigram を作らない', () => {
    // 「瞳孔。中心」から「孔中」が作られると、原文に無い連続を検索でヒットさせてしまう
    expect(tokenRuns('瞳孔。中心')).toEqual([
      { kind: 'cjk', text: '瞳孔' },
      { kind: 'cjk', text: '中心' },
    ])
  })

  it('ASCII の語は分割せず 1 トークンとして扱い、小文字に揃える', () => {
    expect(tokenRuns('G06F')).toEqual([{ kind: 'ascii', text: 'g06f' }])
  })

  it('和文と ASCII が混ざった並びを種類ごとに切る', () => {
    expect(tokenRuns('撮像部12により')).toEqual([
      { kind: 'cjk', text: '撮像部' },
      { kind: 'ascii', text: '12' },
      { kind: 'cjk', text: 'により' },
    ])
  })

  it('全角英数を半角に正規化する', () => {
    expect(tokenRuns('ＧＯ６')).toEqual([{ kind: 'ascii', text: 'go6' }])
  })

  it('空文字と記号だけの入力は空の並びになる', () => {
    expect(tokenRuns('')).toEqual([])
    expect(tokenRuns('、。（）')).toEqual([])
  })
})

describe('indexTokens', () => {
  it('連続する和文を bigram に開く', () => {
    expect(indexTokens('瞳孔の中心')).toBe('瞳孔 孔の の中 中心')
  })

  it('1 文字の和文は、その 1 文字をトークンとして残す', () => {
    // ここを落とすと「【0001】光を…」のような 1 文字語が索引から消える
    expect(indexTokens('光。')).toBe('光')
  })

  it('ASCII 語はそのまま 1 トークンにする', () => {
    expect(indexTokens('G06F 3/01')).toBe('g06f 3 01')
  })

  it('区切りを跨ぐ bigram を作らない', () => {
    expect(indexTokens('瞳孔。中心')).toBe('瞳孔 中心')
  })
})

describe('queryExpression', () => {
  it('2 文字の和文語をフレーズにする', () => {
    expect(queryExpression(['瞳孔'])).toBe('"瞳孔"')
  })

  it('長い和文語は bigram の連続フレーズになり、部分文字列の連続性が保証される', () => {
    expect(queryExpression(['中心座標'])).toBe('"中心 心座 座標"')
  })

  it('複数語は既定で AND で結ぶ', () => {
    expect(queryExpression(['瞳孔', '検出'])).toBe('"瞳孔" AND "検出"')
  })

  it('OR も選べる', () => {
    expect(queryExpression(['瞳孔', '虹彩'], 'OR')).toBe('"瞳孔" OR "虹彩"')
  })

  it('句読点を含む語は区切りごとのフレーズの AND になる', () => {
    expect(queryExpression(['瞳孔、中心'])).toBe('("瞳孔" AND "中心")')
  })

  it('検索語が実質空なら null を返す（呼び出し側が全件走査に落とさないため）', () => {
    expect(queryExpression([])).toBeNull()
    expect(queryExpression(['', '　', '、'])).toBeNull()
  })

  it('FTS5 の構文文字を含む語でも式が壊れない', () => {
    // 二重引用符を含む語をそのまま埋めると MATCH 式が壊れる
    expect(queryExpression(['あ"い'])).toBe('("あ" AND "い")')
  })
})

// --- レビューで見つかった欠陥 F-1 の回帰 ---------------------------------
// 以前は区切り文字を U+3000–U+303F の範囲指定で書いており、その範囲に含まれる
// 漢数字のゼロ「〇」や踊り字「〻〳〴〵」まで区切りにしていた。結果、利用者が入力した
// 文字が黙って消え、フレーズ検索が文書 AND に劣化して、原文に無い連続がヒットしていた。
describe('語の一部である記号を区切りにしない（F-1 の回帰）', () => {
  // NFKC が字形を畳むもの（蘇州号碼 〸〹〺 → 十卄卅）があるので、字が保たれることではなく
  // 「区切りにならず ひと続きの連なりになる」ことを固定する。
  const partsOfWords = [
    '〇',
    '〆',
    '々',
    '〻',
    '〳',
    '〴',
    '〵',
    '〡',
    '〩',
    '〸',
    '〹',
    '〺',
    'ー',
    'ゝ',
    'ゞ',
    'ヽ',
    'ヾ',
  ]

  it.each(partsOfWords)('%s は区切りにならない（語がひと続きのまま）', (ch) => {
    const runs = tokenRuns(`あ${ch}い`)
    expect(runs).toHaveLength(1)
    expect(runs[0]?.kind).toBe('cjk')
    expect(Array.from(runs[0]?.text ?? '')).toHaveLength(3)
  })

  it('漢数字のゼロを含む語がひと続きの連なりになる', () => {
    expect(tokenRuns('令和〇三年')).toEqual([{ kind: 'cjk', text: '令和〇三年' }])
  })

  it('漢数字のゼロを含む検索語はフレーズのままで、AND に落ちない', () => {
    const q = buildQuery(['令和〇三年'])
    expect(q.match).toBe('"令和 和〇 〇三 三年"')
    expect(q.splitTerms).toEqual([])
    expect(q.droppedTerms).toEqual([])
  })

  it('原文に無い連続を作らない（〇 を跨いだ偽陽性が出ない）', () => {
    // 「令和元年」と「平成三年」しか無い文に対して「令和〇三年」はヒットしてはならない。
    const indexed = indexTokens('令和元年に出願し、平成三年の先行技術を引用した。')
    const query = buildQuery(['令和〇三年']).match as string
    const tokens = new Set(indexed.split(' '))
    const phrase = query.replaceAll('"', '').split(' ')
    expect(phrase.every((t) => tokens.has(t))).toBe(false)
  })

  const realSeparators = [
    '、',
    '。',
    '「',
    '」',
    '【',
    '】',
    '・',
    '（',
    '）',
    '，',
    '．',
    '：',
    '；',
    '？',
    '！',
  ]
  it.each(realSeparators)('%s は区切りとして扱う', (ch) => {
    expect(tokenRuns(`あ${ch}い`)).toEqual([
      { kind: 'cjk', text: 'あ' },
      { kind: 'cjk', text: 'い' },
    ])
  })
})

describe('buildQuery は落とした語を報告する（黙って消さない）', () => {
  it('区切りで分割した語を splitTerms で返す', () => {
    const q = buildQuery(['瞳孔、中心', '検出'])
    expect(q.splitTerms).toEqual(['瞳孔、中心'])
    expect(q.match).toBe('("瞳孔" AND "中心") AND "検出"')
  })

  it('トークンが作れない語を droppedTerms で返す', () => {
    const q = buildQuery(['、', '瞳孔'])
    expect(q.droppedTerms).toEqual(['、'])
    expect(q.match).toBe('"瞳孔"')
  })

  it('全部が空なら match は null', () => {
    const q = buildQuery(['、', '。'])
    expect(q.match).toBeNull()
    expect(q.droppedTerms).toHaveLength(2)
  })
})
