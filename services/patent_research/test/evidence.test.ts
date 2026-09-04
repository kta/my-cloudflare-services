import type { Evidence, QuoteCheck } from '@app/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  api,
  corpusCalls,
  makeMatterWithElement,
  PARA_0032,
  resetCorpus,
  SAMPLE_CORPUS,
  seedCorpus,
  setCorpusDown,
  signIn,
} from './helpers'

/*
 * 製品の心臓のテスト。
 *
 * AI（スキル）が送ってきた典拠は、Worker がコーパスに問い合わせて照合してから保存される。
 * 送り手は照合状態を申告できず、照合を通らなかった主張は支持の根拠にならない。
 * ここが緩んだ瞬間に製品ではなくなるので、境界値まで書く。
 */

let token: string
let matterId: string
let elementId: string

beforeEach(async () => {
  const org = `org_${crypto.randomUUID()}`
  token = await signIn(org)
  await resetCorpus()
  await seedCorpus(SAMPLE_CORPUS)
  const made = await makeMatterWithElement(token)
  matterId = made.matterId
  elementId = made.elements[1]?.id as string
})

async function propose(body: Record<string, unknown>) {
  return api<Evidence>(token, `/api/matters/${matterId}/evidence`, {
    method: 'POST',
    body: JSON.stringify({
      elementId,
      pubNumber: '特開2018-134274',
      paraNo: '0032',
      relation: 'discloses',
      ...body,
    }),
  })
}

describe('典拠の機械照合', () => {
  it('段落の原文に実在する引用は verified になる', async () => {
    const r = await propose({ quotedText: '瞳孔の中心座標を算出する' })
    expect(r.status).toBe(201)
    expect(r.body.quoteCheck).toBe<QuoteCheck>('verified')
    expect(r.body.quoteCheckDetail).toBeNull()
  })

  it('原文全体を引いても verified', async () => {
    expect((await propose({ quotedText: PARA_0032 })).body.quoteCheck).toBe('verified')
  })

  it('前後に空白や改行が付いていても verified', async () => {
    const r = await propose({ quotedText: '\n 輝度勾配に基づく円形状検出を適用し \n' })
    expect(r.body.quoteCheck).toBe('verified')
  })

  it('全角半角の違いは吸収して verified', async () => {
    expect((await propose({ quotedText: '撮像部１２により取得された' })).body.quoteCheck).toBe(
      'verified',
    )
  })

  it('1 文字でも違えば quote_mismatch（AI の作話を通さない）', async () => {
    const r = await propose({ quotedText: '瞳孔の中心座標を算定する' })
    expect(r.body.quoteCheck).toBe('quote_mismatch')
    expect(r.body.quoteCheckDetail).toContain('撮像部12により')
  })

  it('AI が別の段落の内容を主張したら quote_mismatch', async () => {
    const r = await propose({ quotedText: '累進屈折力レンズを研磨する工程を含む' })
    expect(r.body.quoteCheck).toBe('quote_mismatch')
  })

  it('短すぎる引用は quote_too_short（助詞だけで照合を通せない）', async () => {
    for (const quotedText of ['る', 'を算出する', '中心座標']) {
      expect((await propose({ quotedText, paraNo: '0033' })).body.quoteCheck).toBe(
        'quote_too_short',
      )
      await api(token, `/api/matters/${matterId}/evidence/all`, { method: 'DELETE' })
    }
  })

  // 下限（10 文字）の境界。閾値を触ったときにここが落ちる。
  it('下限より 1 字短ければ quote_too_short', async () => {
    // 「瞳孔の中心座標を算」= 9 文字
    const r = await propose({ quotedText: '瞳孔の中心座標を算' })
    expect(Array.from('瞳孔の中心座標を算')).toHaveLength(9)
    expect(r.body.quoteCheck).toBe('quote_too_short')
  })

  it('ちょうど下限なら照合に進む', async () => {
    // 「瞳孔の中心座標を算出」= 10 文字
    expect(Array.from('瞳孔の中心座標を算出')).toHaveLength(10)
    const r = await propose({ quotedText: '瞳孔の中心座標を算出' })
    expect(r.body.quoteCheck).toBe('verified')
  })

  it('下限ちょうどでも、原文に無ければ quote_mismatch', async () => {
    const r = await propose({ quotedText: 'コンクリートの養生方法' })
    expect(r.body.quoteCheck).toBe('quote_mismatch')
  })

  it('段落が存在しなければ paragraph_missing', async () => {
    expect(
      (await propose({ paraNo: '9999', quotedText: '瞳孔の中心座標を算出する' })).body.quoteCheck,
    ).toBe('paragraph_missing')
  })

  it('公報が存在しなければ publication_missing', async () => {
    const r = await propose({
      pubNumber: '特開9999-999999',
      quotedText: '瞳孔の中心座標を算出する',
    })
    expect(r.body.quoteCheck).toBe('publication_missing')
  })

  it('全文が取り込まれていない公報は not_in_corpus_tier2（無いとは言わない）', async () => {
    const r = await propose({
      pubNumber: '特開2020-000002',
      quotedText: '瞳孔の中心座標を算出する',
    })
    expect(r.body.quoteCheck).toBe('not_in_corpus_tier2')
  })

  it('請求項しか取り込めていない公報への明細書引用も not_in_corpus_tier2（却下と取り違えない）', async () => {
    const r = await propose({
      pubNumber: '特開2019-000001',
      paraNo: '0010',
      quotedText: '累進屈折力レンズを研磨する工程',
    })
    expect(r.body.quoteCheck).toBe('not_in_corpus_tier2')
  })
})

describe('送り手は照合状態を申告できない', () => {
  it('quoteCheck を送りつけても無視され、機械の判定が入る', async () => {
    const r = await propose({ quotedText: '瞳孔の中心座標を算定する', quoteCheck: 'verified' })
    expect(r.body.quoteCheck).toBe('quote_mismatch')
  })

  it('review を送りつけても unreviewed のまま入る', async () => {
    const r = await propose({ quotedText: '瞳孔の中心座標を算出する', review: 'confirmed' })
    expect(r.body.review).toBe('unreviewed')
  })

  it('照合の問い合わせには内部鍵が付いている', async () => {
    await propose({ quotedText: '瞳孔の中心座標を算出する' })
    const calls = await corpusCalls()
    const lookup = calls.filter((c) => c.path === '/paragraphs')
    expect(lookup.length).toBeGreaterThan(0)
    // 鍵なしで通る経路があってはならない
    expect(lookup.every((c) => c.internalKey === 'dev-internal-key')).toBe(true)
  })
})

describe('コーパスに届かないとき', () => {
  it('典拠は pending のまま残り、verified にならない', async () => {
    await setCorpusDown(true)
    const r = await propose({ quotedText: '瞳孔の中心座標を算出する' })
    expect(r.status).toBe(201)
    expect(r.body.quoteCheck).toBe('pending')
    expect(r.body.quoteCheckDetail).toContain('コーパス')
  })

  it('復旧後に再照合すると verified になる', async () => {
    await setCorpusDown(true)
    await propose({ quotedText: '瞳孔の中心座標を算出する' })
    await setCorpusDown(false)
    const r = await api<{ rechecked: number }>(token, `/api/matters/${matterId}/evidence/recheck`, {
      method: 'POST',
    })
    expect(r.body.rechecked).toBe(1)
    const list = await api<Evidence[]>(token, `/api/matters/${matterId}/evidence`)
    expect(list.body[0]?.quoteCheck).toBe('verified')
  })
})

describe('人間のレビューは機械照合と別の軸', () => {
  it('照合済みの典拠を confirmed にできる', async () => {
    const made = await propose({ quotedText: '瞳孔の中心座標を算出する' })
    const r = await api<Evidence>(token, `/api/evidence/${made.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ review: 'confirmed', reviewerNote: '構成要件Bを開示している' }),
    })
    expect(r.body.review).toBe('confirmed')
    expect(r.body.quoteCheck).toBe('verified')
    expect(r.body.reviewedAt).not.toBeNull()
  })

  it('引用は実在するが構成要件の開示ではない、と人間が否定できる', async () => {
    const made = await propose({ quotedText: '瞳孔の中心座標を算出する' })
    const r = await api<Evidence>(token, `/api/evidence/${made.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ review: 'disputed', relation: 'background' }),
    })
    expect(r.body.review).toBe('disputed')
    expect(r.body.relation).toBe('background')
  })

  it('照合を通っていない典拠はレビューできない（棄却された主張を人間が承認できてはいけない）', async () => {
    const made = await propose({ quotedText: '瞳孔の中心座標を算定する' })
    const r = await api<{ error: string }>(token, `/api/evidence/${made.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ review: 'confirmed' }),
    })
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('quote_not_verified')
  })
})

describe('クレームチャート', () => {
  it('要件ごとに典拠の件数と照合の内訳を返す', async () => {
    await propose({ quotedText: '瞳孔の中心座標を算出する' })
    await propose({ paraNo: '0033', quotedText: '暗瞳孔法により瞳孔領域を抽出する' })
    await propose({ paraNo: '9999', quotedText: '瞳孔の中心座標を算出する' })
    const r = await api<
      { elementKey: string; evidenceCount: number; verifiedCount: number; rejectedCount: number }[]
    >(token, `/api/matters/${matterId}/elements`)
    const b = r.body.find((e) => e.elementKey === 'B')
    expect(b?.evidenceCount).toBe(3)
    expect(b?.verifiedCount).toBe(2)
    expect(b?.rejectedCount).toBe(1)
  })

  it('典拠が 1 件も無い要件は 0 件として返る（新規性の勝ち筋が見えるように）', async () => {
    const r = await api<{ elementKey: string; evidenceCount: number }[]>(
      token,
      `/api/matters/${matterId}/elements`,
    )
    expect(r.body.find((e) => e.elementKey === 'A')?.evidenceCount).toBe(0)
  })

  it('同じ (要件, 公報, 段落) の典拠は二重に積まれない', async () => {
    await propose({ quotedText: '瞳孔の中心座標を算出する' })
    const second = await propose({ quotedText: '輝度勾配に基づく円形状検出を適用し' })
    expect(second.status).toBe(200)
    const list = await api<Evidence[]>(token, `/api/matters/${matterId}/evidence`)
    expect(list.body).toHaveLength(1)
    expect(list.body[0]?.quotedText).toBe('輝度勾配に基づく円形状検出を適用し')
  })
})
