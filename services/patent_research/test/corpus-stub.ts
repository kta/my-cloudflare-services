/*
 * テスト用のコーパスサイドカーの代役。
 *
 * 本物のサイドカーは Node のプロセスで、workerd の中からは起動できない。そこで Worker 側は
 * コーパスへの口を Fetcher として受け取る形にしてあり（`env.CORPUS`）、テストでは
 * miniflare の serviceBindings にこの代役を挿す。リポジトリが NOTIFIER で使っている形と同じ。
 *
 * 代役の状態は Node 側（この module）に住み、テスト（workerd 側）からは `/__stub/*` の
 * 制御用の口を通して操作する。realm が違うので変数を直接共有できないための構造である。
 *
 * 代役は**本物と同じ判断をする**ように書く。特に「公報が無い / 全文が無い / その部分が
 * 取り込まれていない」の区別は、典拠の照合が却下と保留を取り違えないための要である。
 */

export interface StubParagraph {
  text: string
  section: 'claim' | 'desc' | 'abstract'
}

export interface StubPublication {
  title: string
  applicants: string[]
  pubDate: string | null
  hasFulltext: boolean
  sectionsIngested: ('claim' | 'desc' | 'abstract')[]
  paragraphs: Record<string, StubParagraph>
}

export interface StubState {
  publications: Record<string, StubPublication>
  /** true にすると、コーパスに届かない状況を再現する。 */
  down: boolean
  /** 受け取ったリクエストの記録（鍵が付いているかの検証に使う）。 */
  calls: { path: string; internalKey: string | null }[]
}

const state: StubState = { publications: {}, down: false, calls: [] }

export async function corpusStub(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  // --- 制御用の口（テストが状態を操作する） ---
  if (path === '/__stub/reset') {
    state.publications = {}
    state.down = false
    state.calls = []
    return Response.json({ ok: true })
  }
  if (path === '/__stub/seed') {
    const body = (await request.json()) as { publications: Record<string, StubPublication> }
    state.publications = body.publications
    return Response.json({ ok: true })
  }
  if (path === '/__stub/down') {
    const body = (await request.json()) as { down: boolean }
    state.down = body.down
    return Response.json({ ok: true })
  }
  if (path === '/__stub/calls') {
    return Response.json({ calls: state.calls })
  }

  state.calls.push({ path, internalKey: request.headers.get('x-internal-key') })
  if (state.down) return new Response('unreachable', { status: 502 })

  if (path === '/stats') {
    const publications = Object.keys(state.publications).length
    return Response.json({
      publications,
      withFulltext: Object.values(state.publications).filter((p) => p.hasFulltext).length,
      paragraphs: Object.values(state.publications).reduce(
        (n, p) => n + Object.keys(p.paragraphs).length,
        0,
      ),
      chunks: 0,
      batches: publications > 0 ? 1 : 0,
      extractFailures: 0,
      byIpcSubclass: { G06F: publications },
      tokenizerVersion: 2,
      indexStale: false,
    })
  }

  if (path === '/paragraphs') {
    const body = (await request.json()) as { keys: { pubNumber: string; paraNo: string }[] }
    return Response.json({
      paragraphs: body.keys.map((k) => {
        const pub = state.publications[k.pubNumber]
        const para = pub?.paragraphs[k.paraNo]
        return {
          pubNumber: k.pubNumber,
          paraNo: k.paraNo,
          publicationExists: pub !== undefined,
          fulltextAvailable: pub?.hasFulltext ?? false,
          sectionsIngested: pub?.sectionsIngested ?? [],
          text: para?.text ?? null,
          title: pub?.title ?? null,
          applicants: pub?.applicants ?? [],
          pubDate: pub?.pubDate ?? null,
        }
      }),
    })
  }

  if (path === '/search') {
    const body = (await request.json()) as { terms: string[]; limit?: number }
    const hits: unknown[] = []
    for (const [pubNumber, pub] of Object.entries(state.publications)) {
      for (const [paraNo, para] of Object.entries(pub.paragraphs)) {
        if (body.terms.every((t) => para.text.includes(t))) {
          hits.push({
            pubNumber,
            paraNo,
            section: para.section,
            text: para.text,
            snippet: para.text.slice(0, 80),
            score: -1 - hits.length,
            title: pub.title,
            applicants: pub.applicants,
            pubDate: pub.pubDate,
          })
        }
      }
    }
    return Response.json({
      hits: hits.slice(0, body.limit ?? 50),
      hitCount: hits.length,
      undatedCount: 0,
      matchExpression: body.terms.map((t) => `"${t}"`).join(' AND '),
      splitTerms: [],
      droppedTerms: [],
      compiledSql: 'SELECT ... FROM paragraphs_ngram ...',
      parameters: [],
      executedAt: '2026-03-01T00:00:00.000Z',
      corpusBatchCount: 1,
    })
  }

  if (path === '/vector-search') {
    return Response.json({
      hits: [],
      candidateChunks: 0,
      rescoredChunks: 0,
      model: 'deterministic:768',
      semantic: false,
      executedAt: '2026-03-01T00:00:00.000Z',
    })
  }

  return new Response('not found', { status: 404 })
}
