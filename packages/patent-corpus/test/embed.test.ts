import { describe, expect, it } from 'vitest'
import { createEmbedder } from '../src/embed'

// 埋め込みプロバイダは差し替え可能で、既定は追加インストール不要の deterministic。
// これにより「ollama を入れていない状態でも全機能が動き、全テストが通る」を成立させる。
describe('deterministic embedder', () => {
  const e = createEmbedder({ provider: 'deterministic', dim: 64 })

  it('名前と次元を公開する（UI に「意味ベクトルではない」と出すため）', () => {
    expect(e.name).toBe('deterministic:64')
    expect(e.dim).toBe(64)
    expect(e.semantic).toBe(false)
  })

  it('同じ入力から必ず同じベクトルが出る', async () => {
    const [a] = await e.embed(['瞳孔の中心座標を算出する'])
    const [b] = await e.embed(['瞳孔の中心座標を算出する'])
    expect(Array.from(a as Float32Array)).toEqual(Array.from(b as Float32Array))
  })

  it('L2 正規化されている', async () => {
    const [v] = await e.embed(['撮像部により眼部を撮像する'])
    let n = 0
    for (const x of v as Float32Array) n += x * x
    expect(Math.sqrt(n)).toBeCloseTo(1, 5)
  })

  it('語が重なる文どうしは、重ならない文どうしより似る', async () => {
    const [a, b, c] = await e.embed([
      '瞳孔の中心座標を算出する',
      '瞳孔の中心位置を算出する',
      '半導体基板上に電極を形成する',
    ])
    const dot = (x: Float32Array, y: Float32Array) => {
      let s = 0
      for (let i = 0; i < x.length; i++) s += (x[i] as number) * (y[i] as number)
      return s
    }
    expect(dot(a as Float32Array, b as Float32Array)).toBeGreaterThan(
      dot(a as Float32Array, c as Float32Array),
    )
  })

  it('空文字でも次元どおりのベクトルを返す（NaN を作らない）', async () => {
    const [v] = await e.embed([''])
    expect((v as Float32Array).length).toBe(64)
    for (const x of v as Float32Array) expect(Number.isFinite(x)).toBe(true)
  })

  it('複数件をまとめて渡した順に返す', async () => {
    const out = await e.embed(['あいうえお', 'かきくけこ', 'さしすせそ'])
    expect(out).toHaveLength(3)
  })
})

describe('createEmbedder', () => {
  it('未知のプロバイダは拒否する', () => {
    // @ts-expect-error 意図的に契約外の値を渡す
    expect(() => createEmbedder({ provider: 'gpt-magic', dim: 8 })).toThrow(/unknown/)
  })

  it('次元が 8 未満は拒否する（1bit 量子化が 1 バイトに収まらない構成を作らせない）', () => {
    expect(() => createEmbedder({ provider: 'deterministic', dim: 4 })).toThrow(/dim/)
  })

  it('名前に次元を含める（次元違いを別のモデルとして扱う）', () => {
    expect(createEmbedder({ provider: 'deterministic', dim: 64 }).name).not.toBe(
      createEmbedder({ provider: 'deterministic', dim: 256 }).name,
    )
  })

  it('http プロバイダは semantic を true として申告する', () => {
    const e = createEmbedder({
      provider: 'ollama',
      dim: 1024,
      model: 'bge-m3',
      endpoint: 'http://127.0.0.1:11434',
    })
    expect(e.semantic).toBe(true)
    expect(e.name).toBe('ollama:bge-m3:1024')
  })

  it('ollama プロバイダはモデル名が無ければ拒否する', () => {
    expect(() => createEmbedder({ provider: 'ollama', dim: 1024 })).toThrow(/model/)
  })
})

describe('http embedder', () => {
  function stubFetch(body: unknown, status = 200): typeof fetch {
    return (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch
  }

  it('ollama の embeddings 配列を読む', async () => {
    const e = createEmbedder({
      provider: 'ollama',
      dim: 8,
      model: 'bge-m3',
      fetchImpl: stubFetch({ embeddings: [[1, 0, 0, 0, 0, 0, 0, 0]] }),
    })
    const [v] = await e.embed(['瞳孔'])
    expect(Array.from(v as Float32Array)).toEqual([1, 0, 0, 0, 0, 0, 0, 0])
  })

  it('ollama の単数形 embedding も読む（旧エンドポイント互換）', async () => {
    const e = createEmbedder({
      provider: 'ollama',
      dim: 8,
      model: 'bge-m3',
      fetchImpl: stubFetch({ embedding: [0, 1, 0, 0, 0, 0, 0, 0] }),
    })
    expect(await e.embed(['瞳孔'])).toHaveLength(1)
  })

  it('OpenAI 互換の data 配列を読む', async () => {
    const e = createEmbedder({
      provider: 'openai-compatible',
      dim: 8,
      model: 'nomic',
      fetchImpl: stubFetch({ data: [{ embedding: [1, 1, 1, 1, 1, 1, 1, 1] }] }),
    })
    expect(await e.embed(['瞳孔'])).toHaveLength(1)
  })

  it('空の入力では通信しない', async () => {
    let called = 0
    const e = createEmbedder({
      provider: 'ollama',
      dim: 8,
      model: 'bge-m3',
      fetchImpl: (async () => {
        called++
        return new Response('{}')
      }) as unknown as typeof fetch,
    })
    expect(await e.embed([])).toEqual([])
    expect(called).toBe(0)
  })

  it('HTTP エラーは握りつぶさず投げる（黙って空ベクトルを返さない）', async () => {
    const e = createEmbedder({
      provider: 'ollama',
      dim: 8,
      model: 'bge-m3',
      fetchImpl: stubFetch({}, 500),
    })
    await expect(e.embed(['瞳孔'])).rejects.toThrow(/failed: 500/)
  })

  it('応答の形が想定と違えば投げる', async () => {
    const e = createEmbedder({
      provider: 'ollama',
      dim: 8,
      model: 'bge-m3',
      fetchImpl: stubFetch({ nope: true }),
    })
    await expect(e.embed(['瞳孔'])).rejects.toThrow(/neither/)
  })

  it('件数が合わなければ投げる（対応がずれたベクトルを保存させない）', async () => {
    const e = createEmbedder({
      provider: 'ollama',
      dim: 8,
      model: 'bge-m3',
      fetchImpl: stubFetch({ embeddings: [[1, 0, 0, 0, 0, 0, 0, 0]] }),
    })
    await expect(e.embed(['a', 'b'])).rejects.toThrow(/count mismatch/)
  })

  it('次元が違えば投げる（モデルを取り違えたまま索引を作らせない）', async () => {
    const e = createEmbedder({
      provider: 'ollama',
      dim: 8,
      model: 'bge-m3',
      fetchImpl: stubFetch({ embeddings: [[1, 0]] }),
    })
    await expect(e.embed(['a'])).rejects.toThrow(/dimension mismatch/)
  })

  it('OpenAI 互換で data が無ければ投げる', async () => {
    const e = createEmbedder({
      provider: 'openai-compatible',
      dim: 8,
      model: 'nomic',
      fetchImpl: stubFetch({ oops: 1 }),
    })
    await expect(e.embed(['a'])).rejects.toThrow(/no `data`/)
  })

  it('openai-compatible もモデル名を要求する', () => {
    expect(() => createEmbedder({ provider: 'openai-compatible', dim: 8 })).toThrow(/model/)
  })
})
