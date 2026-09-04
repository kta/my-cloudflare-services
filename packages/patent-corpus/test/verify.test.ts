import { describe, expect, it } from 'vitest'
import { checkQuote, MIN_QUOTE_CHARS, sectionOfParaNo } from '../src/verify'

const PARA =
  '撮像部12により取得された眼部画像に対して、輝度勾配に基づく円形状検出を適用し、瞳孔の中心座標を算出する。'

// これが製品の心臓。AI が言った引用が、その段落の原文に実在するかを機械が判定する。
// verified 以外は、支持の根拠として一切表示されない。
describe('checkQuote', () => {
  it('原文と完全に一致する引用は verified', () => {
    expect(checkQuote({ quoted: PARA, paragraphText: PARA }).result).toBe('verified')
  })

  it('原文の一部を切り出した引用は verified', () => {
    expect(checkQuote({ quoted: '瞳孔の中心座標を算出する', paragraphText: PARA }).result).toBe(
      'verified',
    )
  })

  it('前後に空白や改行が付いていても verified', () => {
    expect(
      checkQuote({ quoted: '\n 輝度勾配に基づく円形状検出 \n', paragraphText: PARA }).result,
    ).toBe('verified')
  })

  it('全角半角の違いは吸収して verified', () => {
    expect(checkQuote({ quoted: '撮像部１２により取得された', paragraphText: PARA }).result).toBe(
      'verified',
    )
  })

  it('1 文字でも違えば quote_mismatch（通してはいけない）', () => {
    expect(checkQuote({ quoted: '瞳孔の中心座標を算定する', paragraphText: PARA }).result).toBe(
      'quote_mismatch',
    )
  })

  it('語順が入れ替わっていれば quote_mismatch', () => {
    expect(checkQuote({ quoted: '中心座標の瞳孔を算出する', paragraphText: PARA }).result).toBe(
      'quote_mismatch',
    )
  })

  it('同義語に置き換えられていれば quote_mismatch', () => {
    expect(checkQuote({ quoted: 'ひとみの中心座標を算出する', paragraphText: PARA }).result).toBe(
      'quote_mismatch',
    )
  })

  it('段落が存在しない（null）なら paragraph_missing', () => {
    expect(checkQuote({ quoted: '瞳孔の中心座標を算出する', paragraphText: null }).result).toBe(
      'paragraph_missing',
    )
  })

  it('公報自体が無いなら publication_missing', () => {
    expect(
      checkQuote({
        quoted: '瞳孔の中心座標を算出する',
        paragraphText: null,
        publicationExists: false,
      }).result,
    ).toBe('publication_missing')
  })

  it('公報は層1にあるが全文が無いなら not_in_corpus_tier2（mismatch と取り違えない）', () => {
    expect(
      checkQuote({
        quoted: '瞳孔の中心座標を算出する',
        paragraphText: null,
        publicationExists: true,
        fulltextAvailable: false,
      }).result,
    ).toBe('not_in_corpus_tier2')
  })

  it('空の引用は quote_empty（空文字は任意の文の部分文字列なので必ず落とす）', () => {
    expect(checkQuote({ quoted: '   ', paragraphText: PARA }).result).toBe('quote_empty')
  })

  it('mismatch のときは原文の冒頭を detail に残す（AI の主張と実際の差分を人が見るため）', () => {
    const c = checkQuote({ quoted: 'レンズ研磨工程における加工', paragraphText: PARA })
    expect(c.result).toBe('quote_mismatch')
    expect(c.detail).toContain('撮像部12により')
  })

  it('照合に使った正規化後の長さを返す', () => {
    expect(checkQuote({ quoted: '瞳孔', paragraphText: PARA }).normalizedLength).toBe(2)
  })
})

// --- F-3 の回帰 -----------------------------------------------------------
// 下限が無いと、AI は引用文を「る」「を」「する」にするだけで照合を通せる。
describe('短すぎる引用', () => {
  it.each(['る', 'を', 'に', '1', 'する', '算出', '中心座標'])(
    '%s は quote_too_short（verified にしない）',
    (quoted) => {
      const c = checkQuote({ quoted, paragraphText: PARA })
      expect(c.result).toBe('quote_too_short')
    },
  )

  it('ちょうど下限の長さなら照合に進む', () => {
    const quoted = Array.from('瞳孔の中心座標を算出する').slice(0, MIN_QUOTE_CHARS).join('')
    expect(Array.from(quoted)).toHaveLength(MIN_QUOTE_CHARS)
    expect(checkQuote({ quoted, paragraphText: PARA }).result).toBe('verified')
  })

  it('下限より 1 字短ければ quote_too_short', () => {
    const quoted = Array.from('瞳孔の中心座標を算出する')
      .slice(0, MIN_QUOTE_CHARS - 1)
      .join('')
    expect(checkQuote({ quoted, paragraphText: PARA }).result).toBe('quote_too_short')
  })

  it('短すぎる引用は、原文に無い場合でも quote_too_short（直し方が違うので区別する）', () => {
    expect(checkQuote({ quoted: 'コンクリ', paragraphText: PARA }).result).toBe('quote_too_short')
  })

  it('数値の連結は verified にならない（空白を潰しても数値が繋がらない）', () => {
    const table = '【表1】実施例1  2.5  3.0 実施例2  4.5  5.0 とした結果を示す。'
    expect(checkQuote({ quoted: '12.5  3.0 実施例2', paragraphText: table }).result).toBe(
      'quote_mismatch',
    )
  })
})

// --- F-5 の回帰 -----------------------------------------------------------
// 請求項しか取り込めていない公報への明細書段落の引用は「原文に無い（却下）」ではなく
// 「照合不能（保留）」である。取り違えると、コーパス側の事故が AI の作話として記録される。
describe('取り込み済みの部分だけを照合の対象にする', () => {
  it('請求項しか取り込んでいない公報の明細書段落は not_in_corpus_tier2', () => {
    const c = checkQuote({
      quoted: '瞳孔の中心座標を算出する',
      paragraphText: null,
      sectionsIngested: ['claim'],
      paraNo: '0032',
    })
    expect(c.result).toBe('not_in_corpus_tier2')
  })

  it('取り込んでいる部分の段落が無ければ paragraph_missing のまま', () => {
    const c = checkQuote({
      quoted: '瞳孔の中心座標を算出する',
      paragraphText: null,
      sectionsIngested: ['claim', 'desc'],
      paraNo: '0032',
    })
    expect(c.result).toBe('paragraph_missing')
  })

  it('請求項の段落番号は C 始まりで判別する', () => {
    expect(sectionOfParaNo('C001')).toBe('claim')
    expect(sectionOfParaNo('0032')).toBe('desc')
  })

  it('取り込み情報を渡さなければ従来どおり全部取り込み済みとみなす', () => {
    expect(checkQuote({ quoted: '瞳孔の中心座標を算出する', paragraphText: null }).result).toBe(
      'paragraph_missing',
    )
  })
})
