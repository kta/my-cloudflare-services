import { env, SELF } from 'cloudflare:test'
import type { StubPublication } from './corpus-stub'

/** dev トークン付与で作業空間を開く（example_service と同じ形）。 */
export async function signIn(organizationId: string, role: 'admin' | 'staff' = 'admin') {
  const res = await SELF.fetch('https://x/api/auth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationId, role, email: `${organizationId}@example.test` }),
  })
  if (!res.ok) throw new Error(`dev token grant failed: ${res.status}`)
  const { token } = (await res.json()) as { token: string }
  return token
}

export function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
}

export async function api<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; body: T }> {
  const res = await SELF.fetch(`https://x${path}`, {
    ...init,
    headers: { ...auth(token), ...(init.headers as Record<string, string> | undefined) },
  })
  const text = await res.text()
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T }
}

/** コーパスの代役を初期化する。 */
export async function resetCorpus(): Promise<void> {
  await env.CORPUS.fetch('http://corpus.test/__stub/reset', { method: 'POST' })
}

export async function seedCorpus(publications: Record<string, StubPublication>): Promise<void> {
  await env.CORPUS.fetch('http://corpus.test/__stub/seed', {
    method: 'POST',
    body: JSON.stringify({ publications }),
  })
}

export async function setCorpusDown(down: boolean): Promise<void> {
  await env.CORPUS.fetch('http://corpus.test/__stub/down', {
    method: 'POST',
    body: JSON.stringify({ down }),
  })
}

export async function corpusCalls(): Promise<{ path: string; internalKey: string | null }[]> {
  const res = await env.CORPUS.fetch('http://corpus.test/__stub/calls')
  const { calls } = (await res.json()) as { calls: { path: string; internalKey: string | null }[] }
  return calls
}

/** 案件 → 構成要件までを一気に作る（多くのテストの前提）。 */
export async function makeMatterWithElement(token: string) {
  const matter = await api<{ id: string }>(token, '/api/matters', {
    method: 'POST',
    body: JSON.stringify({ title: '視線追跡による眼鏡フィッティング支援' }),
  })
  const elements = await api<{ id: string; elementKey: string }[]>(
    token,
    `/api/matters/${matter.body.id}/elements`,
    {
      method: 'PUT',
      body: JSON.stringify({
        elements: [
          { claimNo: 1, elementKey: 'A', text: '撮像部が利用者の眼部を撮像する', sortOrder: 0 },
          { claimNo: 1, elementKey: 'B', text: '前記画像から瞳孔中心を検出する', sortOrder: 1 },
        ],
      }),
    },
  )
  return { matterId: matter.body.id, elements: elements.body }
}

export const PARA_0032 =
  '撮像部12により取得された眼部画像に対して、輝度勾配に基づく円形状検出を適用し、瞳孔の中心座標を算出する。'

export const SAMPLE_CORPUS: Record<string, StubPublication> = {
  '特開2018-134274': {
    title: '視線検出装置および眼鏡レンズ設計方法',
    applicants: ['株式会社ニコン・エシロール'],
    pubDate: '2018-08-30',
    hasFulltext: true,
    sectionsIngested: ['claim', 'desc'],
    paragraphs: {
      C001: { section: 'claim', text: '撮像部が利用者の眼部を撮像する視線検出装置。' },
      '0032': { section: 'desc', text: PARA_0032 },
      '0033': {
        section: 'desc',
        text: '前記瞳孔検出部は、赤外光照射下で撮像された画像から、暗瞳孔法により瞳孔領域を抽出する。',
      },
    },
  },
  // 請求項しか取り込めていない公報。明細書段落への引用は「却下」ではなく「保留」になる。
  '特開2019-000001': {
    title: '眼鏡レンズの製造方法',
    applicants: ['株式会社トプコン'],
    pubDate: '2019-01-10',
    hasFulltext: true,
    sectionsIngested: ['claim'],
    paragraphs: {
      C001: { section: 'claim', text: '累進屈折力レンズを研磨する工程を含む製造方法。' },
    },
  },
  // 書誌だけがあり全文が無い公報。
  '特開2020-000002': {
    title: '瞳孔検出装置',
    applicants: ['キヤノン株式会社'],
    pubDate: '2020-02-20',
    hasFulltext: false,
    sectionsIngested: [],
    paragraphs: {},
  },
}
