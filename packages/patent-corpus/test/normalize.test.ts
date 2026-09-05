import { describe, expect, it } from 'vitest'
import { normalizeForQuote } from '../src/normalize'

// 典拠の照合（製品テーゼ）の土台。ここで吸収してよいのは「表記の揺れ」だけで、
// 意味の揺れ（同義語・語形）を吸収してはならない。吸収した瞬間に
// 「書いていないことが書いてある」と言えてしまう。
describe('normalizeForQuote', () => {
  it('和文のあいだの空白・改行は落とす（組版由来の折り返しを吸収する）', () => {
    expect(normalizeForQuote(' 瞳孔の\n中心\t座標 ')).toBe('瞳孔の中心座標')
  })

  // --- F-3 の回帰 ---------------------------------------------------------
  // 空白を全部落とすと、表組みの「実施例1  2.5」から `12.5` が「原文に実在する」と
  // 判定されてしまう。特許では数値が新規性の分かれ目なので、これは致命的である。
  it('英数字どうしのあいだの空白は 1 個残す（数値を連結させない）', () => {
    expect(normalizeForQuote('実施例1  2.5')).toBe('実施例1 2.5')
    expect(normalizeForQuote('実施例1  2.5')).not.toContain('12.5')
  })

  it('英数字と和文のあいだの空白は落とす', () => {
    expect(normalizeForQuote('温度 20 度')).toBe('温度20 度'.replace('20 度', '20度'))
  })

  it('連続した空白は 1 個に畳む', () => {
    expect(normalizeForQuote('a    b')).toBe('a b')
  })

  it('全角英数を半角に、半角カナを全角に揃える', () => {
    expect(normalizeForQuote('ＡＢＣ１２３')).toBe('abc123')
    expect(normalizeForQuote('ｾﾝｻ')).toBe('センサ')
  })

  it('隅付き括弧と段落番号の装飾を落とす', () => {
    expect(normalizeForQuote('【0032】瞳孔')).toBe('0032瞳孔')
  })

  it('ASCII の大文字小文字を揃える', () => {
    expect(normalizeForQuote('CMOS')).toBe('cmos')
  })

  it('同義語は吸収しない（吸収したら照合の意味が消える）', () => {
    expect(normalizeForQuote('瞳孔')).not.toBe(normalizeForQuote('ひとみ'))
  })

  it('句読点は残す（原文の同一性の一部である）', () => {
    expect(normalizeForQuote('瞳孔、中心。')).toBe('瞳孔、中心。')
  })

  // --- F-15 の回帰 --------------------------------------------------------
  // 公報テキストは経路（XML / PDF / TSV）ごとにダッシュ類の使い分けが違う。畳まないと
  // 正当な引用が大量に却下される。
  it('ダッシュ類を 1 つに畳む', () => {
    const forms = ['-', '‐', '‑', '‒', '–', '—', '―', '−', '－']
    for (const d of forms) {
      expect(normalizeForQuote(`特開2010${d}123456`)).toBe('特開2010-123456')
    }
  })

  it('長音符は畳まない（語の一部であり、畳むと語が変わる）', () => {
    expect(normalizeForQuote('センサー')).toBe('センサー')
    expect(normalizeForQuote('センサー')).not.toBe(normalizeForQuote('センサ-'))
  })

  it('波ダッシュとチルダを 1 つに畳む', () => {
    expect(normalizeForQuote('10〜20度')).toBe(normalizeForQuote('10～20度'))
  })

  it('異体字セレクタを落とす', () => {
    expect(normalizeForQuote('葛\u{E0100}城')).toBe('葛城')
  })

  it('踊り字は畳まない（「人々」と「人人」を同一にしたら照合の意味が消える）', () => {
    expect(normalizeForQuote('人々')).not.toBe(normalizeForQuote('人人'))
  })
})
