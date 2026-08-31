import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsScreen } from './SettingsScreen'
import type { SettingsPanelProps } from './sections'
import { WebPublishPanel } from './WebPublishPanel'

/*
 * 承認済みモック docs/frontend/mockups/eyex/images/SETTINGS-WEB.png の面。
 * 店長が「出す・出さない／何を出すか／いつまで受けるか」を 1 画面で見直し、
 * 右のプレビューで社内の言葉が漏れていないかをその場で確かめられることを見る。
 *
 * モックと違うところ（`P8-web-booking.md` §0.2）:
 *   #5 「受け付ける内容」は 4 行ではなく 5 行（「何時間先から受ける」を足す）
 *   #6 プレビューは 4 件ではなく公開する目的の全件（銀座店は 5 件）
 */

/** 器へ返す下書き。形の正本は `sections.ts`。 */
type PanelDraft = Parameters<SettingsPanelProps['onDraftChange']>[0]

const STORE_ID = '11111111-2222-4333-8444-555555555555'
/** JST 2026-08-28（金）11:00。 */
const NOW = '2026-08-28T02:00:00.000Z'

const id = (n: number) => `cccccccc-dddd-4eee-8fff-${String(n).padStart(12, '0')}`

/**
 * モックのお知らせ文に読点を 1 つ足した 27 文字。モックが描く
 * 「27文字／120文字まで」は元の文（26 文字）とは 1 文字ずれているので、
 * 数え方ではなく文のほうを合わせる。
 */
const MESSAGE = '9月30日（水）は、棚卸しのためお休みをいただきます。'

type Purpose = {
  id: string
  storeId: string | null
  nameInternal: string
  namePublic: string
  nameShort: string
  durationMinutes: number
  isWebPublished: boolean
  isActive: boolean
  sortOrder: number
  requirements: never[]
  version: number
}

/** 銀座店の 6 件（`03-data-model.md` §6.1）。修理・部品交換だけ Web に出していない。 */
function seedPurposes(): Purpose[] {
  const row = (
    n: number,
    nameInternal: string,
    namePublic: string,
    nameShort: string,
    durationMinutes: number,
    isWebPublished: boolean,
  ): Purpose => ({
    id: id(n),
    storeId: null,
    nameInternal,
    namePublic,
    nameShort,
    durationMinutes,
    isWebPublished,
    isActive: true,
    sortOrder: n - 1,
    requirements: [],
    version: 1,
  })
  return [
    row(1, 'メガネを新しく作る', '新しいメガネを作る', '新調相談', 60, true),
    row(2, '今のメガネを調整したい', 'かけ具合の調整', '調整', 20, true),
    row(3, 'できあがりを受け取る', 'できあがりの受け取り', '受け取り', 20, true),
    row(4, '修理・部品交換', '修理・部品の交換', '修理', 30, false),
    row(5, 'コンタクトの相談', 'コンタクトのご相談', 'コンタクト', 40, true),
    row(6, '視力測定だけ', '視力測定', '視力測定', 30, true),
  ]
}

type Settings = {
  storeId: string
  isPublished: boolean
  landingPath: string
  opensAt: string
  closesAt: string
  acceptFromHours: number
  acceptUntilDays: number
  changeDeadlineDays: number
  requiresApproval: boolean
  message: string
  publishedPurposeIds: string[]
  version: number
  updatedAt: string
}

function seedSettings(purposes: Purpose[]): Settings {
  return {
    storeId: STORE_ID,
    isPublished: true,
    landingPath: 'eyex.jp/ginza',
    opensAt: '10:30',
    closesAt: '18:00',
    acceptFromHours: 2,
    acceptUntilDays: 30,
    changeDeadlineDays: 1,
    requiresApproval: true,
    message: MESSAGE,
    publishedPurposeIds: purposes.filter((row) => row.isWebPublished).map((row) => row.id),
    version: 4,
    updatedAt: NOW,
  }
}

let purposes: Purpose[]
let settings: Settings
let putStatus: number
let calls: { method: string; path: string; body: unknown }[]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function route(url: string, method: string, body: unknown): Response {
  const path = url.split('?')[0] ?? url
  calls.push({ method, path: url, body })
  if (path === `/api/staff/web-booking-settings/${STORE_ID}/preview`) {
    return json({
      storeName: 'EYEX 銀座店',
      purposes: purposes
        .filter((row) => settings.publishedPurposeIds.includes(row.id))
        .map((row) => ({
          id: row.id,
          name: row.namePublic,
          durationMinutes: row.durationMinutes,
        })),
      message: settings.message,
    })
  }
  if (path === `/api/staff/web-booking-settings/${STORE_ID}`) {
    if (method === 'PUT') {
      if (putStatus !== 200) {
        return json({ error: putStatus === 403 ? 'forbidden' : 'version_conflict' }, putStatus)
      }
      const input = body as Omit<Settings, 'storeId' | 'landingPath' | 'updatedAt'>
      settings = { ...settings, ...input, version: settings.version + 1 }
      return json(settings)
    }
    return json(settings)
  }
  if (path.startsWith('/api/staff/purposes')) return json(purposes)
  if (path.endsWith('/staff')) return json([])
  return json({ error: 'not_found' }, 404)
}

beforeEach(() => {
  purposes = seedPurposes()
  settings = seedSettings(purposes)
  putStatus = 200
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      route(
        String(input),
        (init?.method ?? 'GET').toUpperCase(),
        init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      ),
    ),
  )
})

afterEach(() => vi.unstubAllGlobals())

/** 面だけを開く。器（保存バー）は要らない検証のとき。 */
async function open() {
  const drafts: PanelDraft[] = []
  render(
    <WebPublishPanel
      storeId={STORE_ID}
      now={NOW}
      onDraftChange={(draft) => {
        drafts.push(draft)
      }}
    />,
  )
  await screen.findByRole('switch', { name: 'Web予約を公開する' })
  return drafts
}

/** 器ごと開く。保存・札・断りは器が出すので、そのときだけこちらを使う。 */
async function openInShell() {
  render(
    <SettingsScreen
      storeId={STORE_ID}
      now={NOW}
      initialSection="web"
      panels={{ web: WebPublishPanel }}
    />,
  )
  await screen.findByRole('switch', { name: 'Web予約を公開する' })
}

function publishSwitch() {
  return screen.getByRole('switch', { name: 'Web予約を公開する' })
}

function preview() {
  return screen.getByRole('region', { name: 'お客様の画面の見え方' })
}

function previewRows() {
  return within(preview()).getAllByRole('listitem')
}

function contentRows() {
  return within(screen.getByRole('list', { name: '受け付ける内容' })).getAllByRole('listitem')
}

async function rewriteMessage(text: string) {
  await userEvent.click(screen.getByRole('button', { name: '書き直す' }))
  const box = screen.getByRole('textbox', { name: 'お客様へのお知らせ文' })
  await userEvent.clear(box)
  if (text !== '') await userEvent.type(box, text)
  return box
}

describe('Web予約の公開', () => {
  it('「Web予約を公開する」は role="switch" で、行全体（52px）が押せる', async () => {
    await open()
    const toggle = publishSwitch()
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle.className).toContain('min-h-13')
    expect(toggle.className).toContain('w-full')
  })

  it('切ると値が「公開していません」に変わる', async () => {
    await open()
    expect(screen.getByText('公開しています')).toBeInTheDocument()
    await userEvent.click(publishSwitch())
    expect(publishSwitch()).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText('公開していません')).toBeInTheDocument()
    expect(screen.queryByText('公開しています')).not.toBeInTheDocument()
  })

  it('ご案内のページは stores.slug から組み立てた文字を出す', async () => {
    await open()
    expect(screen.getByText('eyex.jp/ginza')).toBeInTheDocument()
  })
})

describe('受け付ける内容', () => {
  it('5 行（公開する目的・受け付ける時間・何時間先から受ける・何日先まで受ける・ご予約の確定）が並ぶ', async () => {
    await open()
    const rows = contentRows()
    expect(rows).toHaveLength(5)
    expect(rows[0]).toHaveTextContent('公開する目的')
    expect(rows[0]).toHaveTextContent('5件')
    expect(rows[1]).toHaveTextContent('受け付ける時間')
    expect(rows[2]).toHaveTextContent('何時間先から受ける')
    expect(rows[3]).toHaveTextContent('何日先まで受ける')
    expect(rows[4]).toHaveTextContent('ご予約の確定')
  })

  it('「ご予約の確定」は「お店が確かめてから確定する」の 1 値だけで、押しても選択肢が出ない', async () => {
    await open()
    const row = contentRows()[4] as HTMLElement
    expect(row).toHaveTextContent('お店が確かめてから確定する')
    expect(within(row).queryByRole('button')).not.toBeInTheDocument()
    expect(within(row).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument()
    await userEvent.click(within(row).getByText('お店が確かめてから確定する'))
    expect(within(row).queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('お知らせ文', () => {
  it('文字数が「27文字／120文字まで」の形で出る', async () => {
    await open()
    expect(screen.getByText('27文字／120文字まで')).toBeInTheDocument()
  })

  it('121 文字目は入らない', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: '書き直す' }))
    const box = screen.getByRole('textbox', { name: 'お客様へのお知らせ文' })
    await userEvent.clear(box)
    await userEvent.click(box)
    await userEvent.paste('あ'.repeat(121))
    expect([...(box as HTMLTextAreaElement).value].length).toBe(120)
    expect(screen.getByText('120文字／120文字まで')).toBeInTheDocument()
  })
})

describe('お客様の画面の見え方', () => {
  it('公開する目的をすべて出す（5 件のときは 5 件）', async () => {
    await open()
    await waitFor(() => expect(previewRows()).toHaveLength(5))
    expect(preview()).toHaveTextContent('EYEX 銀座店')
    expect(preview()).toHaveTextContent('ご来店の目的をお選びください')
    expect(previewRows()[0]).toHaveTextContent('新しいメガネを作る')
    expect(previewRows()[0]).toHaveTextContent('約60分')
  })

  it('出る名前は対客名で、店内名は 1 つも出ない', async () => {
    await open()
    await waitFor(() => expect(previewRows()).toHaveLength(5))
    for (const name of [
      '新しいメガネを作る',
      'かけ具合の調整',
      'できあがりの受け取り',
      'コンタクトのご相談',
      '視力測定',
    ]) {
      expect(within(preview()).getByText(name)).toBeInTheDocument()
    }
    for (const internal of [
      'メガネを新しく作る',
      '今のメガネを調整したい',
      'できあがりを受け取る',
      'コンタクトの相談',
      '視力測定だけ',
    ]) {
      expect(within(preview()).queryByText(internal)).not.toBeInTheDocument()
    }
  })

  it('公開する目的から 1 件外すと、その場でプレビューからも消えて 4 件になる', async () => {
    await open()
    await waitFor(() => expect(previewRows()).toHaveLength(5))
    await userEvent.click(screen.getByRole('checkbox', { name: /視力測定/ }))
    expect(previewRows()).toHaveLength(4)
    expect(within(preview()).queryByText('視力測定')).not.toBeInTheDocument()
    expect(contentRows()[0]).toHaveTextContent('4件')
  })

  it('お知らせ文を書き換えると、保存しなくてもプレビューの注記が変わる', async () => {
    await open()
    await waitFor(() => expect(previewRows()).toHaveLength(5))
    expect(within(preview()).getByText(MESSAGE)).toBeInTheDocument()
    await rewriteMessage('9月30日は臨時でお休みします。')
    expect(within(preview()).getByText('9月30日は臨時でお休みします。')).toBeInTheDocument()
    expect(within(preview()).queryByText(MESSAGE)).not.toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(0)
  })
})

describe('保存', () => {
  it('未保存の変更があると「未保存の変更 1件」の札が出る', async () => {
    await openInShell()
    expect(screen.queryByText(/未保存の変更/)).not.toBeInTheDocument()
    await userEvent.click(publishSwitch())
    await waitFor(() => expect(screen.getByText('未保存の変更 1件')).toBeInTheDocument())
  })

  it('公開する目的が 0 件のまま公開しようとすると「公開する目的が 0 件のため公開できません。ご来店の目的を 1 つ以上 Web に出してください。」を出し、値を変えない', async () => {
    await open()
    for (const name of [
      /新しいメガネを作る/,
      /かけ具合の調整/,
      /できあがりの受け取り/,
      /コンタクトのご相談/,
      /視力測定/,
    ]) {
      await userEvent.click(screen.getByRole('checkbox', { name }))
    }
    expect(
      screen.getByText(
        '公開する目的が 0 件のため公開できません。ご来店の目的を 1 つ以上 Web に出してください。',
      ),
    ).toBeInTheDocument()
    // 画面が勝手に「公開していません」へ倒さない。倒すかどうかは店長が決める。
    expect(publishSwitch()).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('公開しています')).toBeInTheDocument()
  })

  it('他の端末が先に保存していたら、どちらも書き換えずに衝突を伝える', async () => {
    await openInShell()
    putStatus = 409
    await userEvent.click(publishSwitch())
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(
        screen.getByText(
          'ほかの端末が先に保存しました。画面を開き直して、もう一度お試しください。',
        ),
      ).toBeInTheDocument(),
    )
    expect(settings.isPublished).toBe(true)
    expect(publishSwitch()).toHaveAttribute('aria-checked', 'false')
  })

  it('スタッフの権限で保存すると、店長だけができることを伝え、下書きを残す', async () => {
    await openInShell()
    putStatus = 403
    await userEvent.click(publishSwitch())
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() =>
      expect(screen.getByText('この操作は店長だけができます')).toBeInTheDocument(),
    )
    expect(screen.getByText('下書きは残っています')).toBeInTheDocument()
    expect(
      screen.getByText('「Web予約を公開する」を 公開しています から 公開していません に変える'),
    ).toBeInTheDocument()
    expect(publishSwitch()).toHaveAttribute('aria-checked', 'false')
  })
})
