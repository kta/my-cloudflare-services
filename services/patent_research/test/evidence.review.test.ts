import type { Assessment, ClaimElementSummary, Evidence, EvidenceGraph } from '@app/contracts'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  api,
  makeMatterWithElement,
  resetCorpus,
  SAMPLE_CORPUS,
  seedCorpus,
  setCorpusDown,
  signIn,
} from './helpers'

/*
 * レビューで見つかった欠陥の回帰。
 *
 * 中心にあるのは 1 つの誤解である。**機械が確かめるのは「引用が原文に実在するか」だけで、
 * 「その引用が構成要件を開示しているか」は誰も検証していない。** `relation` は送り手
 * （スキル）の自己申告である。だから機械照合だけで「支持」と数えると、AI が無関係な公報の
 * 実在する一文を `discloses` と称して積むだけで、構成要件が「塞がれた」ことになり、
 * 出願を諦めさせる方向に誤らせる。
 */

let token: string
let matterId: string
let elementA: string
let elementB: string

beforeEach(async () => {
  token = await signIn(`org_${crypto.randomUUID()}`)
  await resetCorpus()
  await seedCorpus(SAMPLE_CORPUS)
  const made = await makeMatterWithElement(token)
  matterId = made.matterId
  elementA = made.elements[0]?.id as string
  elementB = made.elements[1]?.id as string
})

async function propose(over: Record<string, unknown> = {}) {
  return api<Evidence>(token, `/api/matters/${matterId}/evidence`, {
    method: 'POST',
    body: JSON.stringify({
      elementId: elementB,
      pubNumber: '特開2018-134274',
      paraNo: '0032',
      quotedText: '瞳孔の中心座標を算出する',
      relation: 'discloses',
      ...over,
    }),
  })
}

const elementsOf = () =>
  api<ClaimElementSummary[]>(token, `/api/matters/${matterId}/elements`).then((r) => r.body)

describe('AI の自己申告だけでは構成要件は塞がれない', () => {
  it('照合を通っただけの典拠は confirmedCount に数えない', async () => {
    await propose()
    const [, b] = await elementsOf()
    expect(b?.verifiedCount).toBe(1)
    expect(b?.confirmedCount).toBe(0)
  })

  it('人が開示を認めて初めて confirmedCount に入る', async () => {
    const ev = await propose()
    await api(token, `/api/evidence/${ev.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ review: 'confirmed' }),
    })
    const [, b] = await elementsOf()
    expect(b?.confirmedCount).toBe(1)
  })

  it('人が否定したら、confirmedCount に入らず disputedCount に入る', async () => {
    const ev = await propose()
    await api(token, `/api/evidence/${ev.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ review: 'disputed' }),
    })
    const [, b] = await elementsOf()
    expect(b?.confirmedCount).toBe(0)
    expect(b?.disputedCount).toBe(1)
  })

  it('否定した典拠は、公報の重み（支持している要件の数）にも数えない', async () => {
    const ev = await propose()
    await api(token, `/api/evidence/${ev.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ review: 'disputed' }),
    })
    const g = await api<EvidenceGraph>(token, `/api/matters/${matterId}/graph`)
    expect(g.body.nodes.find((n) => n.kind === 'publication')?.weight).toBe(0)
  })

  it('案件一覧の confirmedCount も、人が認めた件数だけを数える', async () => {
    await propose()
    const before = await api<{ id: string; confirmedCount: number }[]>(token, '/api/matters')
    expect(before.body.find((m) => m.id === matterId)?.confirmedCount).toBe(0)
  })
})

describe('再照合（recheck）', () => {
  it('判定が変わったら、人の確認はやり直しになる', async () => {
    const ev = await propose()
    await api(token, `/api/evidence/${ev.body.id}/review`, {
      method: 'POST',
      body: JSON.stringify({ review: 'confirmed', reviewerNote: '要件Bを開示' }),
    })
    // コーパスの原文が訂正されて、引用が合わなくなった状況を作る
    await seedCorpus({
      '特開2018-134274': {
        title: '視線検出装置および眼鏡レンズ設計方法',
        applicants: ['株式会社ニコン・エシロール'],
        pubDate: '2018-08-30',
        hasFulltext: true,
        sectionsIngested: ['claim', 'desc'],
        paragraphs: {
          '0032': { section: 'desc', text: 'この段落は訂正され、別の内容になった。' },
        },
      },
    })
    const r = await api<{ rechecked: number }>(token, `/api/matters/${matterId}/evidence/recheck`, {
      method: 'POST',
    })
    expect(r.body.rechecked).toBe(1)
    const after = await api<Evidence[]>(token, `/api/matters/${matterId}/evidence`)
    expect(after.body[0]?.quoteCheck).toBe('quote_mismatch')
    // 棄却された引用に人の承認印が残ってはならない
    expect(after.body[0]?.review).toBe('unreviewed')
    expect(after.body[0]?.reviewedAt).toBeNull()
    expect(after.body[0]?.reviewerNote).toBe('')
  })

  it('コーパスに届かなければ 503 で、1 行も書き換えない', async () => {
    const ev = await propose()
    await setCorpusDown(true)
    const r = await api<{ error: string }>(token, `/api/matters/${matterId}/evidence/recheck`, {
      method: 'POST',
    })
    expect(r.status).toBe(503)
    expect(r.body.error).toBe('corpus_unavailable')

    await setCorpusDown(false)
    const after = await api<Evidence[]>(token, `/api/matters/${matterId}/evidence`)
    // 書誌が消えていない。公開日は「先行技術かどうか」の判断そのものである。
    expect(after.body[0]?.quoteCheck).toBe('verified')
    expect(after.body[0]?.pubDate).toBe('2018-08-30')
    expect(after.body[0]?.applicants).toEqual(['株式会社ニコン・エシロール'])
    expect(after.body[0]?.id).toBe(ev.body.id)
  })

  it('「全部確認済み」と「1 件も確認できなかった」を同じ応答にしない', async () => {
    await propose()
    const ok = await api<{ rechecked: number; unchanged: number }>(
      token,
      `/api/matters/${matterId}/evidence/recheck`,
      { method: 'POST' },
    )
    expect(ok.status).toBe(200)
    expect(ok.body.unchanged).toBe(1)

    await setCorpusDown(true)
    const down = await api(token, `/api/matters/${matterId}/evidence/recheck`, { method: 'POST' })
    expect(down.status).toBe(503)
    await setCorpusDown(false)
  })
})

describe('特許性の判断は典拠に縛られる', () => {
  it('照合を通った典拠が無い公報を主引用にできない', async () => {
    const r = await api<{ error: string; detail: string }>(
      token,
      `/api/matters/${matterId}/assessments`,
      {
        method: 'POST',
        body: JSON.stringify({
          kind: 'novelty',
          primaryRef: '特開9999-999999',
          conclusion: 'blocked',
          reasoning: '存在しない公報が要件Bを開示している',
        }),
      },
    )
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('ref_not_supported')
    expect(r.body.detail).toContain('特開9999-999999')
  })

  it('作話（棄却）しか無い公報も主引用にできない', async () => {
    await propose({ quotedText: 'この文は原文に存在しない' })
    const r = await api<{ error: string }>(token, `/api/matters/${matterId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'novelty',
        primaryRef: '特開2018-134274',
        conclusion: 'blocked',
      }),
    })
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('ref_not_supported')
  })

  it('照合を通った典拠があれば通る', async () => {
    await propose()
    const r = await api<Assessment>(token, `/api/matters/${matterId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'novelty', primaryRef: '特開2018-134274', conclusion: 'risky' }),
    })
    expect(r.status).toBe(201)
  })

  it('副引用も同じく縛られる', async () => {
    await propose()
    const r = await api<{ error: string }>(token, `/api/matters/${matterId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'inventive_step',
        primaryRef: '特開2018-134274',
        secondaryRefs: ['特開9999-999999'],
        conclusion: 'likely_patentable',
      }),
    })
    expect(r.status).toBe(409)
  })

  it('公報を挙げない探索中の判断は通る', async () => {
    const r = await api<Assessment>(token, `/api/matters/${matterId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'inventive_step', reasoning: 'まだ探している' }),
    })
    expect(r.status).toBe(201)
  })
})

describe('検索の記録の正しさ', () => {
  it('他テナントや存在しない構成要件を記録に書けない', async () => {
    const other = await signIn(`org_${crypto.randomUUID()}`)
    const otherMatter = await api<{ id: string }>(other, '/api/matters', {
      method: 'POST',
      body: JSON.stringify({ title: '別テナントの案件' }),
    })
    const otherElements = await api<{ id: string }[]>(
      other,
      `/api/matters/${otherMatter.body.id}/elements`,
      {
        method: 'PUT',
        body: JSON.stringify({
          elements: [{ claimNo: 1, elementKey: 'A', text: '別テナントの要件', sortOrder: 0 }],
        }),
      },
    )
    const r = await api<{ error: string }>(token, `/api/matters/${matterId}/searches`, {
      method: 'POST',
      body: JSON.stringify({ terms: ['瞳孔'], elementId: otherElements.body[0]?.id }),
    })
    expect(r.status).toBe(404)
    expect(r.body.error).toBe('element_not_found')

    const bogus = await api<{ error: string }>(token, `/api/matters/${matterId}/searches`, {
      method: 'POST',
      body: JSON.stringify({ terms: ['瞳孔'], elementId: 'not-a-real-id' }),
    })
    expect(bogus.status).toBe(404)
  })

  it('自分の構成要件なら通る', async () => {
    const r = await api(token, `/api/matters/${matterId}/searches`, {
      method: 'POST',
      body: JSON.stringify({ terms: ['瞳孔'], elementId: elementA }),
    })
    expect(r.status).toBe(201)
  })
})

describe('構成要件の入力', () => {
  it('記号が重複したら 400（500 にしない）', async () => {
    const r = await api<{ error: string }>(token, `/api/matters/${matterId}/elements`, {
      method: 'PUT',
      body: JSON.stringify({
        elements: [
          { claimNo: 1, elementKey: 'A', text: 'あ', sortOrder: 0 },
          { claimNo: 1, elementKey: 'A', text: 'い', sortOrder: 1 },
        ],
      }),
    })
    expect(r.status).toBe(400)
  })
})
