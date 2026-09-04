import { describe, expect, it } from 'vitest'
import { CorpusUnavailable, createCorpusClient } from '../src/worker/corpus-client'

/*
 * コーパスへの口。**届かなかったことを、黙って空の結果にしない**のがこの層の責務である。
 * 0 件と「見ていない」の区別が消えると、先行技術調査の結論がひっくり返る。
 */

function stub(handler: (url: string, init: RequestInit) => Response): Fetcher {
  return {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(handler(String(input), init ?? {})),
  } as unknown as Fetcher
}

const OK = stub(() => Response.json({ paragraphs: [] }))

describe('内部鍵', () => {
  it('鍵が未設定なら問い合わせず、理由を添えて失敗する（fail close）', async () => {
    const client = createCorpusClient({ INTERNAL_KEY: '', CORPUS: OK })
    await expect(client.paragraphs([])).rejects.toBeInstanceOf(CorpusUnavailable)
    await expect(client.paragraphs([])).rejects.toMatchObject({
      detail: expect.stringContaining('INTERNAL_KEY'),
    })
  })

  it('問い合わせには鍵が付く', async () => {
    let seen: string | null = null
    const client = createCorpusClient({
      INTERNAL_KEY: 'k',
      CORPUS: stub((_url, init) => {
        seen = (init.headers as Record<string, string>)['x-internal-key'] ?? null
        return Response.json({ paragraphs: [] })
      }),
    })
    await client.paragraphs([{ pubNumber: 'a', paraNo: '0001' }])
    expect(seen).toBe('k')
  })
})

describe('届かないとき', () => {
  it('通信が失敗したら CorpusUnavailable（空の結果にしない）', async () => {
    const client = createCorpusClient({
      INTERNAL_KEY: 'k',
      CORPUS: {
        fetch: () => Promise.reject(new Error('ECONNREFUSED')),
      } as unknown as Fetcher,
    })
    await expect(client.search({ terms: ['x'] })).rejects.toMatchObject({
      detail: expect.stringContaining('corpus serve'),
    })
  })

  it('サイドカーがエラーを返したら状態を添えて失敗する', async () => {
    const client = createCorpusClient({
      INTERNAL_KEY: 'k',
      CORPUS: stub(() => new Response('boom', { status: 503 })),
    })
    await expect(client.paragraphs([])).rejects.toMatchObject({
      detail: expect.stringContaining('503'),
    })
  })

  // --- 版ずれの回帰 -------------------------------------------------------
  // 応答から欄が欠けると、checkQuote の既定値（publicationExists/fulltextAvailable = true）
  // へ倒れて「保留」が「却下」に化ける。コーパス側の事故を AI の作話として記録する
  // 壊れ方なので、契約に合わない応答は不達として扱う（安全側）。
  it('応答が契約と合わなければ、通ったことにせず不達として扱う', async () => {
    const client = createCorpusClient({
      INTERNAL_KEY: 'k',
      CORPUS: stub(() =>
        Response.json({
          paragraphs: [{ pubNumber: '特開2018-1', paraNo: '0032', text: 'あ' }],
        }),
      ),
    })
    await expect(
      client.paragraphs([{ pubNumber: '特開2018-1', paraNo: '0032' }]),
    ).rejects.toMatchObject({ detail: expect.stringContaining('契約と合わない') })
  })

  it('検索の応答が契約と合わなければ同じく不達にする', async () => {
    const client = createCorpusClient({
      INTERNAL_KEY: 'k',
      CORPUS: stub(() => Response.json({ hits: [], hitCount: 3 })),
    })
    await expect(client.search({ terms: ['x'] })).rejects.toBeInstanceOf(CorpusUnavailable)
  })

  it('契約どおりの応答は通る', async () => {
    const client = createCorpusClient({
      INTERNAL_KEY: 'k',
      CORPUS: stub(() =>
        Response.json({
          paragraphs: [
            {
              pubNumber: '特開2018-1',
              paraNo: '0032',
              publicationExists: true,
              fulltextAvailable: true,
              sectionsIngested: ['desc'],
              text: '瞳孔の中心座標を算出する。',
              title: '視線検出装置',
              applicants: ['株式会社テスト'],
              pubDate: '2018-08-30',
            },
          ],
        }),
      ),
    })
    const [row] = await client.paragraphs([{ pubNumber: '特開2018-1', paraNo: '0032' }])
    expect(row?.fulltextAvailable).toBe(true)
    expect(row?.sectionsIngested).toEqual(['desc'])
  })

  it('status() は例外にせず reachable:false と理由を返す（画面に出すため）', async () => {
    const client = createCorpusClient({
      INTERNAL_KEY: 'k',
      CORPUS: stub(() => new Response('down', { status: 502 })),
    })
    const s = await client.status()
    expect(s.reachable).toBe(false)
    expect(s.detail).toContain('502')
    expect(s.publications).toBe(0)
  })

  it('status() は鍵が無いときも理由を返す', async () => {
    const client = createCorpusClient({ INTERNAL_KEY: '', CORPUS: OK })
    const s = await client.status()
    expect(s.reachable).toBe(false)
    expect(s.detail).toContain('INTERNAL_KEY')
  })
})

describe('宛先', () => {
  it('CORPUS_URL を base に使う', async () => {
    let seen = ''
    const client = createCorpusClient({
      INTERNAL_KEY: 'k',
      CORPUS_URL: 'http://corpus.example',
      CORPUS: stub((url) => {
        seen = url
        return Response.json({ paragraphs: [] })
      }),
    })
    await client.paragraphs([])
    expect(seen).toBe('http://corpus.example/paragraphs')
  })

  it('CORPUS_URL が無ければローカルの既定値を使う', async () => {
    let seen = ''
    const client = createCorpusClient({
      INTERNAL_KEY: 'k',
      CORPUS: stub((url) => {
        seen = url
        return Response.json({ paragraphs: [] })
      }),
    })
    await client.paragraphs([])
    expect(seen).toBe('http://127.0.0.1:8899/paragraphs')
  })

  it('binding が無ければグローバルの fetch を使う（実運用の経路）', async () => {
    // サイドカーは動いていないので、接続に失敗して CorpusUnavailable になるのが正しい。
    const client = createCorpusClient({
      INTERNAL_KEY: 'k',
      CORPUS_URL: 'http://127.0.0.1:1',
    })
    await expect(client.status()).resolves.toMatchObject({ reachable: false })
  })

  it('status() が届けば件数を返す', async () => {
    const client = createCorpusClient({
      INTERNAL_KEY: 'k',
      CORPUS: stub(() =>
        Response.json({
          publications: 7,
          withFulltext: 5,
          paragraphs: 100,
          chunks: 0,
          batches: 1,
          extractFailures: 0,
          byIpcSubclass: { G06F: 7 },
        }),
      ),
    })
    const s = await client.status()
    expect(s.reachable).toBe(true)
    expect(s.detail).toBeNull()
    expect(s.publications).toBe(7)
  })
})
