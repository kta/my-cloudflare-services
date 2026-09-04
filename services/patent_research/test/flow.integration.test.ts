import type {
  Assessment,
  CorpusStatus,
  Draft,
  DraftCheck,
  Evidence,
  EvidenceGraph,
  Job,
  Matter,
  MatterSummary,
  SearchRecord,
  SearchResponse,
} from '@app/contracts'
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
 * 案件を立てて、発明を書き、構成要件に分解し、先行技術を探し、典拠を積み、
 * 特許性を論じ、明細書の下書きを置くまでの通し。
 */

let token: string
let matterId: string
let elementA: string
let elementB: string

/** 照合を通った典拠を 1 件積み、人が開示を認めるところまでやる。 */
async function attachConfirmed(elementId: string, paraNo = '0032') {
  const ev = await api<Evidence>(token, `/api/matters/${matterId}/evidence`, {
    method: 'POST',
    body: JSON.stringify({
      elementId,
      pubNumber: '特開2018-134274',
      paraNo,
      quotedText:
        paraNo === '0032' ? '瞳孔の中心座標を算出する' : '暗瞳孔法により瞳孔領域を抽出する',
      relation: 'discloses',
    }),
  })
  expect(ev.body.quoteCheck).toBe('verified')
  await api(token, `/api/evidence/${ev.body.id}/review`, {
    method: 'POST',
    body: JSON.stringify({ review: 'confirmed' }),
  })
  return ev.body
}

beforeEach(async () => {
  token = await signIn(`org_${crypto.randomUUID()}`)
  await resetCorpus()
  await seedCorpus(SAMPLE_CORPUS)
  const made = await makeMatterWithElement(token)
  matterId = made.matterId
  elementA = made.elements[0]?.id as string
  elementB = made.elements[1]?.id as string
})

describe('案件', () => {
  it('作ると intake から始まり、状態を進められる', async () => {
    const m = await api<Matter>(token, `/api/matters/${matterId}`)
    expect(m.body.status).toBe('intake')
    const updated = await api<Matter>(token, `/api/matters/${matterId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'searching' }),
    })
    expect(updated.body.status).toBe('searching')
    expect(updated.body.updatedAt >= m.body.updatedAt).toBe(true)
  })

  it('一覧に典拠の照合率が出る', async () => {
    await api(token, `/api/matters/${matterId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        elementId: elementB,
        pubNumber: '特開2018-134274',
        paraNo: '0032',
        quotedText: '瞳孔の中心座標を算出する',
        relation: 'discloses',
      }),
    })
    const list = await api<MatterSummary[]>(token, '/api/matters')
    const row = list.body.find((m) => m.id === matterId)
    expect(row?.elementCount).toBe(2)
    expect(row?.evidenceCount).toBe(1)
    expect(row?.verifiedCount).toBe(1)
    expect(row?.rejectedCount).toBe(0)
  })
})

describe('発明開示', () => {
  it('保存すると改訂が積まれ、最新が返る', async () => {
    await api(token, `/api/matters/${matterId}/disclosure`, {
      method: 'PUT',
      body: JSON.stringify({ problem: '課題その1', solution: '手段' }),
    })
    const second = await api<{ revision: number }>(token, `/api/matters/${matterId}/disclosure`, {
      method: 'PUT',
      body: JSON.stringify({ problem: '課題その2', solution: '手段' }),
    })
    expect(second.body.revision).toBe(2)
    const latest = await api<{ problem: string; revision: number }>(
      token,
      `/api/matters/${matterId}/disclosure`,
    )
    expect(latest.body.problem).toBe('課題その2')
    expect(latest.body.revision).toBe(2)
  })

  it('外部 LLM への送信は既定で禁止されている', async () => {
    await api(token, `/api/matters/${matterId}/disclosure`, {
      method: 'PUT',
      body: JSON.stringify({ problem: '未出願の発明' }),
    })
    const r = await api<{ error: string }>(token, `/api/matters/${matterId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role: 'assistant', content: 'まとめました', provider: 'gemini' }),
    })
    expect(r.status).toBe(403)
    expect(r.body.error).toBe('external_llm_not_allowed')
  })

  it('明示的に許可すれば通る', async () => {
    await api(token, `/api/matters/${matterId}/disclosure`, {
      method: 'PUT',
      body: JSON.stringify({ problem: '公開済みの整理', externalLlmAllowed: true }),
    })
    const r = await api(token, `/api/matters/${matterId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role: 'assistant', content: 'まとめました', provider: 'gemini' }),
    })
    expect(r.status).toBe(201)
  })

  it('対話ログは時系列で読み出せる', async () => {
    await api(token, `/api/matters/${matterId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ role: 'user', content: 'こんな特許が欲しい', provider: 'human' }),
    })
    await api(token, `/api/matters/${matterId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        role: 'assistant',
        content: 'こういう形でしょうか？',
        provider: 'claude-code',
      }),
    })
    const r = await api<{ role: string; content: string; provider: string }[]>(
      token,
      `/api/matters/${matterId}/messages`,
    )
    expect(r.body).toHaveLength(2)
    expect(r.body[0]?.role).toBe('user')
    expect(r.body[1]?.provider).toBe('claude-code')
  })

  it('Claude Code 経由の対話は許可なしでも通る（ローカルで完結するため）', async () => {
    const r = await api(token, `/api/matters/${matterId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        role: 'assistant',
        content: 'こういう形でしょうか？',
        provider: 'claude-code',
      }),
    })
    expect(r.status).toBe(201)
  })
})

describe('構成要件', () => {
  it('入れ直しても既存の要件の id が保たれる（典拠が孤立しない）', async () => {
    await api(token, `/api/matters/${matterId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        elementId: elementB,
        pubNumber: '特開2018-134274',
        paraNo: '0032',
        quotedText: '瞳孔の中心座標を算出する',
        relation: 'discloses',
      }),
    })
    await api(token, `/api/matters/${matterId}/elements`, {
      method: 'PUT',
      body: JSON.stringify({
        elements: [
          { claimNo: 1, elementKey: 'A', text: '撮像部が利用者の眼部を撮像する', sortOrder: 0 },
          {
            claimNo: 1,
            elementKey: 'B',
            text: '前記画像から瞳孔中心を検出する（改）',
            sortOrder: 1,
          },
        ],
      }),
    })
    const evidence = await api<Evidence[]>(token, `/api/matters/${matterId}/evidence`)
    expect(evidence.body).toHaveLength(1)
    expect(evidence.body[0]?.elementId).toBe(elementB)
  })

  it('要件を消すと、その要件に付いた典拠も消える', async () => {
    await api(token, `/api/matters/${matterId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        elementId: elementB,
        pubNumber: '特開2018-134274',
        paraNo: '0032',
        quotedText: '瞳孔の中心座標を算出する',
        relation: 'discloses',
      }),
    })
    await api(token, `/api/matters/${matterId}/elements`, {
      method: 'PUT',
      body: JSON.stringify({
        elements: [
          { claimNo: 1, elementKey: 'A', text: '撮像部が利用者の眼部を撮像する', sortOrder: 0 },
        ],
      }),
    })
    expect((await api<Evidence[]>(token, `/api/matters/${matterId}/evidence`)).body).toEqual([])
  })
})

describe('請求項のマルチマルチ検査', () => {
  it('該当があれば fail として記録される', async () => {
    const r = await api<{ multiMultiClaims: number[] }>(token, `/api/matters/${matterId}/claims`, {
      method: 'PUT',
      body: JSON.stringify({
        claims: [
          { claimNo: 1, dependsOn: [], text: '独立項' },
          { claimNo: 2, dependsOn: [], text: '独立項2' },
          { claimNo: 3, dependsOn: [1, 2], text: '多数項引用' },
          { claimNo: 4, dependsOn: [1, 2], text: '多数項引用2' },
          { claimNo: 5, dependsOn: [3, 4], text: 'マルチマルチ' },
        ],
      }),
    })
    expect(r.body.multiMultiClaims).toEqual([5])
    const checks = await api<DraftCheck[]>(token, `/api/matters/${matterId}/checks`)
    const check = checks.body.find((x) => x.checkKey === 'multi_multi')
    expect(check?.result).toBe('fail')
    expect(check?.detail).toContain('請求項 5')
  })

  it('該当が無ければ pass に戻る（前回の fail が残らない）', async () => {
    await api(token, `/api/matters/${matterId}/claims`, {
      method: 'PUT',
      body: JSON.stringify({
        claims: [
          { claimNo: 1, dependsOn: [], text: 'a' },
          { claimNo: 2, dependsOn: [], text: 'b' },
          { claimNo: 3, dependsOn: [1, 2], text: 'c' },
          { claimNo: 4, dependsOn: [3, 1], text: 'd' },
        ],
      }),
    })
    await api(token, `/api/matters/${matterId}/claims`, {
      method: 'PUT',
      body: JSON.stringify({ claims: [{ claimNo: 1, dependsOn: [], text: 'a' }] }),
    })
    const checks = await api<DraftCheck[]>(token, `/api/matters/${matterId}/checks`)
    expect(checks.body.find((x) => x.checkKey === 'multi_multi')?.result).toBe('pass')
  })
})

describe('検索', () => {
  it('検索式とヒット件数が記録に残る', async () => {
    const r = await api<SearchResponse>(token, `/api/matters/${matterId}/searches`, {
      method: 'POST',
      body: JSON.stringify({ terms: ['瞳孔'], elementId: elementB }),
    })
    expect(r.status).toBe(201)
    expect(r.body.record.matchExpression).toBe('"瞳孔"')
    expect(r.body.record.hitCount).toBeGreaterThan(0)
    expect(r.body.record.compiledSql).toContain('paragraphs_ngram')
    expect(r.body.hits.length).toBeGreaterThan(0)

    const history = await api<SearchRecord[]>(token, `/api/matters/${matterId}/searches`)
    expect(history.body).toHaveLength(1)
    expect(history.body[0]?.query.terms).toEqual(['瞳孔'])
    expect(history.body[0]?.elementId).toBe(elementB)
  })

  it('コーパスに届かなければ 503 で、0 件と偽らない', async () => {
    await setCorpusDown(true)
    const r = await api<{ error: string; detail: string }>(
      token,
      `/api/matters/${matterId}/searches`,
      { method: 'POST', body: JSON.stringify({ terms: ['瞳孔'] }) },
    )
    expect(r.status).toBe(503)
    expect(r.body.error).toBe('corpus_unavailable')
    expect(r.body.detail).toContain('コーパス')
    // 記録も残さない（実行できなかった検索を調査報告書に載せない）
    expect((await api<SearchRecord[]>(token, `/api/matters/${matterId}/searches`)).body).toEqual([])
  })
})

describe('特許性の判断', () => {
  it('新規性は単一文献で記録できる', async () => {
    await attachConfirmed(elementB)
    const r = await api<Assessment>(token, `/api/matters/${matterId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'novelty',
        primaryRef: '特開2018-134274',
        conclusion: 'risky',
        reasoning: '構成要件Bが開示されている',
      }),
    })
    expect(r.status).toBe(201)
    expect(r.body.secondaryRefs).toEqual([])
  })

  it('進歩性は動機付けと阻害要因を持てる', async () => {
    await attachConfirmed(elementB)
    await api(token, `/api/matters/${matterId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        elementId: elementA,
        pubNumber: '特開2019-000001',
        paraNo: 'C001',
        quotedText: '累進屈折力レンズを研磨する工程を含む製造方法',
        relation: 'suggests',
      }),
    })
    const r = await api<Assessment>(token, `/api/matters/${matterId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({
        kind: 'inventive_step',
        primaryRef: '特開2018-134274',
        secondaryRefs: ['特開2019-000001'],
        motivationType: 'problem',
        hindrance: '副引用は研磨工程の話であり、視線検出へ適用する動機がない',
        conclusion: 'likely_patentable',
      }),
    })
    expect(r.status).toBe(201)
    expect(r.body.motivationType).toBe('problem')
    expect(r.body.hindrance).toContain('動機がない')
  })

  it('新規性に副引用を付けたら 400（単一文献主義）', async () => {
    const r = await api(token, `/api/matters/${matterId}/assessments`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'novelty', secondaryRefs: ['特開2019-000001'] }),
    })
    expect(r.status).toBe(400)
  })
})

describe('ドラフト', () => {
  it('節ごとに保存され、最新だけが返る', async () => {
    await api(token, `/api/matters/${matterId}/drafts`, {
      method: 'PUT',
      body: JSON.stringify({ section: 'technical_field', markdown: '本発明は…' }),
    })
    await api(token, `/api/matters/${matterId}/drafts`, {
      method: 'PUT',
      body: JSON.stringify({ section: 'technical_field', markdown: '本発明は…（改）' }),
    })
    await api(token, `/api/matters/${matterId}/drafts`, {
      method: 'PUT',
      body: JSON.stringify({ section: 'problem', markdown: '課題は…' }),
    })
    const r = await api<Draft[]>(token, `/api/matters/${matterId}/drafts`)
    expect(r.body).toHaveLength(2)
    expect(r.body.find((d) => d.section === 'technical_field')?.markdown).toBe('本発明は…（改）')
    expect(r.body.find((d) => d.section === 'technical_field')?.revision).toBe(2)
  })

  it('要約が 400 字を超えたら 400（電子出願でエラーになる字数）', async () => {
    const r = await api(token, `/api/matters/${matterId}/drafts`, {
      method: 'PUT',
      body: JSON.stringify({ section: 'abstract', markdown: 'あ'.repeat(401) }),
    })
    expect(r.status).toBe(400)
  })

  it('要約がちょうど 400 字なら通る', async () => {
    const r = await api(token, `/api/matters/${matterId}/drafts`, {
      method: 'PUT',
      body: JSON.stringify({ section: 'abstract', markdown: 'あ'.repeat(400) }),
    })
    expect(r.status).toBe(201)
  })
})

describe('グラフ', () => {
  it('要件と公報のノード、典拠の辺を返す', async () => {
    await attachConfirmed(elementB)
    const r = await api<EvidenceGraph>(token, `/api/matters/${matterId}/graph`)
    expect(r.body.nodes.filter((n) => n.kind === 'element')).toHaveLength(2)
    expect(r.body.nodes.filter((n) => n.kind === 'publication')).toHaveLength(1)
    expect(r.body.edges).toHaveLength(1)
    expect(r.body.edges[0]?.quoteCheck).toBe('verified')
    // 公報の重みは「人が開示を認めた要件の数」。太い公報ほど手強い先行技術である。
    expect(r.body.nodes.find((n) => n.kind === 'publication')?.weight).toBe(1)
  })

  it('人が認めていない典拠は、公報の重みに数えない（relation は自己申告だから）', async () => {
    await api(token, `/api/matters/${matterId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        elementId: elementB,
        pubNumber: '特開2018-134274',
        paraNo: '0032',
        quotedText: '瞳孔の中心座標を算出する',
        relation: 'discloses',
      }),
    })
    const r = await api<EvidenceGraph>(token, `/api/matters/${matterId}/graph`)
    expect(r.body.nodes.find((n) => n.kind === 'publication')?.weight).toBe(0)
    expect(r.body.edges).toHaveLength(1)
  })

  it('照合を通っていない典拠は公報の重みに数えない', async () => {
    await api(token, `/api/matters/${matterId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        elementId: elementA,
        pubNumber: '特開2018-134274',
        paraNo: '0032',
        quotedText: '存在しない引用文であるからして照合は通らない',
        relation: 'discloses',
      }),
    })
    const r = await api<EvidenceGraph>(token, `/api/matters/${matterId}/graph`)
    expect(r.body.nodes.find((n) => n.kind === 'publication')?.weight).toBe(0)
    // 辺は残る（棄却された主張も記録として見える）
    expect(r.body.edges).toHaveLength(1)
  })
})

describe('ジョブ', () => {
  it('積むと queued で並ぶ', async () => {
    const r = await api<Job>(token, `/api/matters/${matterId}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'search', instruction: '構成要件Bの先行技術を探す' }),
    })
    expect(r.body.status).toBe('queued')
    const list = await api<Job[]>(token, '/api/jobs')
    expect(list.body).toHaveLength(1)
    expect(list.body[0]?.instruction).toContain('構成要件B')
  })
})

describe('コーパスの状態', () => {
  it('届いていれば件数が返る', async () => {
    const r = await api<CorpusStatus>(token, '/api/corpus/status')
    expect(r.body.reachable).toBe(true)
    expect(r.body.publications).toBe(3)
  })

  it('届かなければ reachable が false になり、理由が付く（0 件と偽らない）', async () => {
    await setCorpusDown(true)
    const r = await api<CorpusStatus>(token, '/api/corpus/status')
    expect(r.status).toBe(200)
    expect(r.body.reachable).toBe(false)
    expect(r.body.detail).toBeTruthy()
  })
})

describe('請求項', () => {
  it('保存すると実際に残り、読み戻せる', async () => {
    const r = await api<{ saved: number; multiMultiClaims: number[] }>(
      token,
      `/api/matters/${matterId}/claims`,
      {
        method: 'PUT',
        body: JSON.stringify({
          claims: [
            { claimNo: 1, dependsOn: [], text: '撮像部を備える視線検出装置。' },
            {
              claimNo: 2,
              dependsOn: [1],
              text: '請求項1に記載の装置であって、瞳孔検出部を備える。',
            },
          ],
        }),
      },
    )
    expect(r.body.saved).toBe(2)
    const list = await api<{ claimNo: number; text: string; dependsOn: number[] }[]>(
      token,
      `/api/matters/${matterId}/claims`,
    )
    expect(list.body).toHaveLength(2)
    expect(list.body[1]?.dependsOn).toEqual([1])
    expect(list.body[0]?.text).toContain('撮像部')
  })

  it('入れ直すと、消えた請求項は残らない', async () => {
    await api(token, `/api/matters/${matterId}/claims`, {
      method: 'PUT',
      body: JSON.stringify({
        claims: [
          { claimNo: 1, dependsOn: [], text: 'あ' },
          { claimNo: 2, dependsOn: [1], text: 'い' },
        ],
      }),
    })
    await api(token, `/api/matters/${matterId}/claims`, {
      method: 'PUT',
      body: JSON.stringify({ claims: [{ claimNo: 1, dependsOn: [], text: 'あ（改）' }] }),
    })
    const list = await api<{ claimNo: number; text: string }[]>(
      token,
      `/api/matters/${matterId}/claims`,
    )
    expect(list.body).toHaveLength(1)
    expect(list.body[0]?.text).toBe('あ（改）')
  })

  it('50 件の請求項でも落ちない（D1 のバインド上限）', async () => {
    const claims = Array.from({ length: 50 }, (_, i) => ({
      claimNo: i + 1,
      dependsOn: i === 0 ? [] : [1],
      text: `請求項${i + 1}の本文。`,
    }))
    const r = await api<{ saved: number }>(token, `/api/matters/${matterId}/claims`, {
      method: 'PUT',
      body: JSON.stringify({ claims }),
    })
    expect(r.status).toBe(200)
    expect(r.body.saved).toBe(50)
    expect((await api<unknown[]>(token, `/api/matters/${matterId}/claims`)).body).toHaveLength(50)
  })
})

describe('ジョブの取り合い', () => {
  it('取ると running になり、二人目は 409 になる', async () => {
    const job = await api<Job>(token, `/api/matters/${matterId}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'search', instruction: '構成要件Bを探す' }),
    })
    const first = await api<Job>(token, `/api/jobs/${job.body.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ runner: 'claude-1' }),
    })
    expect(first.body.status).toBe('running')
    expect(first.body.runner).toBe('claude-1')
    expect(first.body.startedAt).not.toBeNull()

    const second = await api<{ error: string }>(token, `/api/jobs/${job.body.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ runner: 'claude-2' }),
    })
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('job_already_claimed')
  })

  it('閉じると done になり、結果の場所が残る', async () => {
    const job = await api<Job>(token, `/api/matters/${matterId}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'draft' }),
    })
    await api(token, `/api/jobs/${job.body.id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ runner: 'claude-1' }),
    })
    const done = await api<Job>(token, `/api/jobs/${job.body.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ status: 'done', resultRef: 'drafts/technical_field' }),
    })
    expect(done.body.status).toBe('done')
    expect(done.body.resultRef).toBe('drafts/technical_field')
    expect(done.body.finishedAt).not.toBeNull()
  })

  it('失敗も理由つきで残る（握りつぶさない）', async () => {
    const job = await api<Job>(token, `/api/matters/${matterId}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'assess' }),
    })
    const failed = await api<Job>(token, `/api/jobs/${job.body.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ status: 'failed', error: 'コーパスに届かなかった' }),
    })
    expect(failed.body.status).toBe('failed')
    expect(failed.body.error).toBe('コーパスに届かなかった')
  })

  it('無い仕事は 404', async () => {
    const r = await api(token, '/api/jobs/no-such-job/claim', {
      method: 'POST',
      body: JSON.stringify({ runner: 'x' }),
    })
    expect(r.status).toBe(404)
  })
})

describe('検索のヒットは履歴から辿れる', () => {
  it('あとから「そのとき何が当たったか」を読める', async () => {
    const run = await api<SearchResponse>(token, `/api/matters/${matterId}/searches`, {
      method: 'POST',
      body: JSON.stringify({ terms: ['瞳孔'] }),
    })
    const hits = await api<{ pubNumber: string; paraNo: string }[]>(
      token,
      `/api/matters/${matterId}/searches/${run.body.record.id}/hits`,
    )
    expect(hits.body.length).toBe(run.body.hits.length)
    expect(hits.body[0]?.pubNumber).toBe(run.body.hits[0]?.pubNumber)
  })

  it('他人の検索の id では読めない', async () => {
    const r = await api(token, `/api/matters/${matterId}/searches/no-such-search/hits`)
    expect(r.status).toBe(404)
  })
})
