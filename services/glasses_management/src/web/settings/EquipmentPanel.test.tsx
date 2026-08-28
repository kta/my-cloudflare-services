import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EquipmentPanel } from './EquipmentPanel'
import type { SettingsPanelProps } from './sections'

/*
 * 承認済みモック docs/frontend/mockups/eyex/images/SETTINGS-EQUIPMENT.png の面。
 * 見た目の寸法は e2e の突き合わせで見るので、ここでは「何が読めて、何が押せるか」を見る。
 * いまの時刻は prop で注ぎ、実行日に依存させない。
 *
 * 保存バー（未保存の札・保存・変更を捨てる・断りの文）は器が持つので、この面は
 * 下書きの中身と `save()` の顛末だけを返す。
 */

/** 器へ返す下書き。形の正本は `sections.ts`。 */
type PanelDraft = Parameters<SettingsPanelProps['onDraftChange']>[0]

const STORE_ID = '11111111-2222-4333-8444-555555555555'
/** JST 2026-08-28（金）11:00。視力測定機 B の点検（10:00–12:00）の最中。 */
const NOW = '2026-08-28T02:00:00.000Z'

const id = (n: number) => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, '0')}`

type Unit = {
  id: string
  name: string
  kind: 'measure' | 'counter' | 'workbench'
  capacity: number
  isActive: boolean
  sortOrder: number
  inactiveReason: string | null
  roleLabel: string
  ledgerDisplay: 'grey' | 'hide'
}

const unit = (
  n: number,
  name: string,
  kind: Unit['kind'],
  roleLabel: string,
  rest: Partial<Unit> = {},
): Unit => ({
  id: id(n),
  name,
  kind,
  capacity: 1,
  isActive: true,
  sortOrder: n - 1,
  inactiveReason: null,
  roleLabel,
  ledgerDisplay: 'grey',
  ...rest,
})

/** 銀座店の 7 台（`03-data-model.md` §5.4）。表示は 6 行にまとまる。 */
function seedUnits(): Unit[] {
  return [
    unit(1, '視力測定機 A', 'measure', '視力測定'),
    unit(2, '視力測定機 B', 'measure', '視力測定'),
    unit(3, '検査室 1', 'measure', '精密検査'),
    unit(4, '相談カウンター 1', 'counter', '接客・ご相談'),
    unit(5, '相談カウンター 2', 'counter', '接客・ご相談'),
    unit(6, 'フィッティング台', 'counter', 'フィッティング'),
    unit(7, '加工室', 'workbench', '加工', { isActive: false, inactiveReason: '部品待ち' }),
  ]
}

const THREE_RESERVATIONS = [
  {
    at: '2026-08-28T01:00:00.000Z',
    label: '山口 真央 様　視力測定',
    targetType: 'reservation',
    targetId: null,
  },
  {
    at: '2026-08-28T01:30:00.000Z',
    label: '川上 恵 様　新しく作る',
    targetType: 'reservation',
    targetId: null,
  },
  {
    at: '2026-08-28T02:30:00.000Z',
    label: '佐々木 亮 様　視力測定',
    targetType: 'reservation',
    targetId: null,
  },
]

let units: Unit[]
let maintenance: {
  id: string
  equipmentId: string
  startsAt: string
  endsAt: string
  note: string | null
}[]
let impactItems: typeof THREE_RESERVATIONS
let patchStatus: number
let calls: { method: string; path: string; body: unknown }[]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function route(path: string, method: string, body: unknown): Response {
  calls.push({ method, path, body })
  if (path === `/api/staff/stores/${STORE_ID}`) {
    return json({
      id: STORE_ID,
      organizationId: 'eyex',
      name: 'EYEX 銀座店',
      slug: 'ginza',
      phone: '',
      address: '',
      accessNote: '',
      isActive: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      namePublic: null,
      nearestStation: null,
      parkingNote: null,
      introText: null,
      sortOrder: 0,
      updatedAt: null,
      updatedBy: null,
      settingsVersion: 1,
    })
  }
  const forMaintenance = path.match(/\/equipment\/([^/?]+)\/maintenance/)
  if (forMaintenance) {
    if (method === 'POST') {
      return json({ id: id(90), equipmentId: forMaintenance[1], ...(body as object) })
    }
    return json(maintenance.filter((row) => row.equipmentId === forMaintenance[1]))
  }
  const forPatch = path.match(/\/equipment\/([^/?]+)$/)
  if (forPatch && method === 'PATCH') {
    if (patchStatus !== 200) {
      return json({ error: patchStatus === 403 ? 'forbidden' : 'version_conflict' }, patchStatus)
    }
    const target = units.find((row) => row.id === forPatch[1])
    if (target) {
      const { version: _version, ...fields } = body as Record<string, unknown>
      Object.assign(target, fields)
    }
    return json({ ...target })
  }
  if (path.startsWith(`/api/staff/stores/${STORE_ID}/equipment`) && method === 'POST') {
    const input = body as { name: string; kind: Unit['kind']; roleLabel: string }
    units.push(unit(8, input.name, input.kind, input.roleLabel))
    return json(units[units.length - 1])
  }
  if (path.startsWith(`/api/staff/stores/${STORE_ID}/equipment`)) return json(units)
  if (path === '/api/staff/settings/impact') {
    return json({
      affectedReservations: impactItems,
      affectedWebSlots: [],
      lastAcceptableAt: null,
      severity: impactItems.length === 0 ? 'info' : 'action',
    })
  }
  return json({ error: 'not_found' }, 404)
}

beforeEach(() => {
  units = seedUnits()
  maintenance = [
    {
      id: id(50),
      equipmentId: id(2),
      startsAt: '2026-08-28T01:00:00.000Z',
      endsAt: '2026-08-28T03:00:00.000Z',
      note: '定期点検（メーカー来店）',
    },
  ]
  impactItems = THREE_RESERVATIONS
  patchStatus = 200
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

async function open() {
  const drafts: PanelDraft[] = []
  render(
    <EquipmentPanel
      storeId={STORE_ID}
      now={NOW}
      onDraftChange={(draft) => {
        drafts.push(draft)
      }}
    />,
  )
  await screen.findByRole('table', { name: '設備と場所' })
  return drafts
}

async function save(drafts: PanelDraft[]) {
  let outcome: Awaited<ReturnType<PanelDraft['save']>> | undefined
  await act(async () => {
    outcome = await drafts.at(-1)?.save()
  })
  return outcome
}

function changes(drafts: PanelDraft[]) {
  return drafts.at(-1)?.changes ?? []
}

/** 「編集中：…」の下の白い箱。 */
function editor() {
  return screen.getByRole('group', { name: /編集中：/ })
}

function toggle() {
  return within(editor()).getByRole('switch', { name: /いま使える/ })
}

function list() {
  return screen.getByRole('table', { name: '設備と場所' })
}

describe('設備と点検の一覧', () => {
  it('一覧は「設備と場所　6件」で、相談カウンター 1・2 を 1 行にまとめて出す', async () => {
    await open()
    expect(screen.getByText(/設備と場所\s+6件/)).toBeInTheDocument()
    // 見出しの 1 行 + まとめたあとの 6 行
    expect(within(list()).getAllByRole('row')).toHaveLength(7)
    expect(screen.getByRole('button', { name: '相談カウンター 1・2' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '相談カウンター 2' })).not.toBeInTheDocument()
    // 1 台しか無い行はまとめない
    expect(screen.getByRole('button', { name: '検査室 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'フィッティング台' })).toBeInTheDocument()
    // 末尾が英字の 2 台は連番ではないのでまとめない
    expect(screen.getByRole('button', { name: '視力測定機 A' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '視力測定機 B' })).toBeInTheDocument()
  })

  it('列は 設備・場所 / いまの状態 / 次の点検 の 3 つである', async () => {
    await open()
    expect(
      within(list())
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['設備・場所', 'いまの状態', '次の点検'])
  })

  it('視力測定機 B の状態は「点検のため止めます」で、次の点検が 2026年8月28日（金）10:00–12:00 である', async () => {
    await open()
    const row = screen.getByRole('button', { name: '視力測定機 B' }).closest('tr')
    expect(row).toHaveTextContent('点検のため止めます')
    expect(row).toHaveTextContent('2026年8月28日（金）10:00–12:00')
    const noMaintenance = screen.getByRole('button', { name: '視力測定機 A' }).closest('tr')
    expect(noMaintenance).toHaveTextContent('使えます')
    expect(noMaintenance).toHaveTextContent('予定はありません')
    const stopped = screen.getByRole('button', { name: '加工室' }).closest('tr')
    expect(stopped).toHaveTextContent('部品待ちで止めています')
  })

  it('視力測定機 B を選ぶと「編集中：視力測定機 B」が出る', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: '視力測定機 B' }))
    expect(screen.getByText('編集中：視力測定機 B')).toBeInTheDocument()
    expect(toggle()).toBeInTheDocument()
  })

  it('まとめた行を選ぶと、まとめの 1 台目を編集する（保存が効くのは 1 台なので嘘をつかない）', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: '相談カウンター 1・2' }))
    expect(screen.getByText('編集中：相談カウンター 1')).toBeInTheDocument()
    expect(screen.getByText('この行は 2 台をまとめて出しています。')).toBeInTheDocument()
  })
})

describe('止めると影響するご予約', () => {
  it('「いま使える」を切ると「止めると影響するご予約　3件」が出て、山口 真央 様・川上 恵 様・佐々木 亮 様 の 3 行が並ぶ', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: '視力測定機 B' }))
    await userEvent.click(toggle())
    const heading = await screen.findByRole('heading', { name: /止めると影響するご予約/ })
    expect(heading.textContent).toBe('止めると影響するご予約　3件')
    const lines = within(screen.getByRole('list', { name: '止めると影響するご予約' })).getAllByRole(
      'listitem',
    )
    expect(lines.map((line) => line.textContent)).toEqual([
      '8月28日（金）10:00山口 真央 様　視力測定',
      '8月28日（金）10:30川上 恵 様　新しく作る',
      '8月28日（金）11:30佐々木 亮 様　視力測定',
    ])
    // 試算は何も保存しない — 投げたのは POST /api/staff/settings/impact だけ
    expect(calls.filter((call) => call.method !== 'GET').map((call) => call.path)).toEqual([
      '/api/staff/settings/impact',
    ])
  })

  it('そのとき上の札が赤くなる', async () => {
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: '視力測定機 B' }))
    await userEvent.click(toggle())
    await screen.findByRole('heading', { name: /止めると影響するご予約/ })
    expect(drafts.at(-1)?.danger).toBe(true)
    expect(drafts.at(-1)?.dangerNote).toBe('止めると影響するご予約が 3件 あります')
    expect(changes(drafts)).toEqual([
      '視力測定機 B の「いま使える」を 使えます から 止めています に変える',
    ])
  })

  it('影響するご予約が 0 件の設備を止めると、影響の一覧は出ず札も赤くならない', async () => {
    impactItems = []
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: '視力測定機 A' }))
    await userEvent.click(toggle())
    await waitFor(() => expect(changes(drafts)).toHaveLength(1))
    expect(drafts.at(-1)?.danger).toBe(false)
    expect(drafts.at(-1)?.dangerNote).toBeNull()
    expect(
      screen.queryByRole('heading', { name: /止めると影響するご予約/ }),
    ).not.toBeInTheDocument()
  })
})

describe('いま使えるの切り替え', () => {
  it('「いま使える」は行全体が押せる切り替えで、入と切の状態が読み上げられる', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: '視力測定機 B' }))
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
    // 行の高さぶん（52px = 44pt 以上）押せる
    expect(toggle().className).toContain('min-h-12')
    expect(toggle().className).toContain('w-full')
    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
  })

  it('画面に「使えます」「止めています」の文字が出る', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: '視力測定機 B' }))
    expect(within(editor()).getByText('使えます')).toBeInTheDocument()
    await userEvent.click(toggle())
    expect(within(editor()).getByText('止めています')).toBeInTheDocument()
  })

  it('「いま使える」を切った設備の行は一覧から消えない', async () => {
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: '視力測定機 B' }))
    await userEvent.click(toggle())
    expect(await save(drafts)).toBe('saved')
    await waitFor(() => expect(changes(drafts)).toHaveLength(0))
    expect(screen.getByRole('button', { name: '視力測定機 B' }).closest('tr')).toHaveTextContent(
      '止めています',
    )
    expect(screen.getByText(/設備と場所\s+6件/)).toBeInTheDocument()
  })
})

describe('設備を足す', () => {
  it('「＋ 設備を足す」から 名前と種別（視力測定機／相談カウンター／加工台）を入れて保存すると 1 行増える', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: '＋ 設備を足す' }))
    await userEvent.type(screen.getByLabelText('設備・場所の名前'), '検査室 2')
    await userEvent.selectOptions(screen.getByLabelText('種別'), '視力測定機')
    await userEvent.click(screen.getByRole('button', { name: 'この設備を足す' }))
    await waitFor(() => expect(screen.getByText(/設備と場所\s+7件/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '検査室 2' })).toBeInTheDocument()
  })

  it('種別は 視力測定機・相談カウンター・加工台 の 3 つだけを選べる', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: '＋ 設備を足す' }))
    expect(
      within(screen.getByLabelText('種別'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['視力測定機', '相談カウンター', '加工台'])
  })
})

describe('保存', () => {
  it('「変更を捨てる」で編集前へ戻す', async () => {
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: '視力測定機 B' }))
    await userEvent.click(toggle())
    await waitFor(() => expect(changes(drafts)).toHaveLength(1))
    act(() => drafts.at(-1)?.discard())
    await waitFor(() => expect(changes(drafts)).toHaveLength(0))
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
  })

  it('保存が 403 で跳ねられたら forbidden を返し、打ち込んだ値を残す', async () => {
    patchStatus = 403
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: '視力測定機 B' }))
    await userEvent.click(toggle())
    expect(await save(drafts)).toBe('forbidden')
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    expect(changes(drafts)).toHaveLength(1)
  })

  it('版が合わなければ conflict を返し、打ち込んだ値を残す', async () => {
    patchStatus = 409
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: '視力測定機 B' }))
    await userEvent.click(toggle())
    expect(await save(drafts)).toBe('conflict')
    expect(changes(drafts)).toHaveLength(1)
  })

  it('止める理由・止める期間・台帳の見せ方を直すと、直した数だけ下書きに並ぶ', async () => {
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: '視力測定機 B' }))
    await userEvent.type(within(editor()).getByLabelText('止める理由'), '部品待ち')
    await userEvent.selectOptions(within(editor()).getByLabelText('台帳に出す'), '出さない')
    await waitFor(() => expect(changes(drafts)).toHaveLength(2))
    expect(changes(drafts)).toEqual([
      '視力測定機 B の「止める理由」を 未入力 から 部品待ち に変える',
      '視力測定機 B の「台帳に出す」を 灰色にして残す から 出さない に変える',
    ])
    expect(await save(drafts)).toBe('saved')
    await waitFor(() => expect(changes(drafts)).toHaveLength(0))
  })

  it('止める期間を直すと点検の予定として保存する', async () => {
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: '視力測定機 A' }))
    await userEvent.type(within(editor()).getByLabelText('止める日'), '2026-09-14')
    await userEvent.type(within(editor()).getByLabelText('止め始める時刻'), '10:00')
    await userEvent.type(within(editor()).getByLabelText('止め終える時刻'), '12:00')
    await waitFor(() => expect(changes(drafts)).toHaveLength(1))
    expect(await save(drafts)).toBe('saved')
    const posted = calls.find((call) => call.method === 'POST' && call.path.includes('maintenance'))
    expect(posted?.body).toEqual({
      startsAt: '2026-09-14T01:00:00.000Z',
      endsAt: '2026-09-14T03:00:00.000Z',
      note: null,
    })
  })
})

describe('読み込みと失敗', () => {
  it('読み込んでいる間はその事実を出す', () => {
    render(<EquipmentPanel storeId={STORE_ID} now={NOW} onDraftChange={() => {}} />)
    expect(screen.getByText('設備と点検を読み込んでいます…')).toBeInTheDocument()
  })

  it('読み込めなかったら理由と次の行動を出す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    )
    render(<EquipmentPanel storeId={STORE_ID} now={NOW} onDraftChange={() => {}} />)
    expect(
      await screen.findByText('設備と点検を読み込めませんでした。画面を開き直してください。'),
    ).toBeInTheDocument()
  })

  it('1 台も無ければ、その事実だけを出す', async () => {
    units = []
    render(<EquipmentPanel storeId={STORE_ID} now={NOW} onDraftChange={() => {}} />)
    expect(
      await screen.findByText(
        '設備・場所がまだ登録されていません。「＋ 設備を足す」から登録します。',
      ),
    ).toBeInTheDocument()
  })
})
