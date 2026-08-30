import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PurposePanel } from './PurposePanel'
import type { SettingsPanelProps } from './sections'

/*
 * 承認済みモック docs/frontend/mockups/eyex/images/SETTINGS-PURPOSE.png の面。
 * 「何が読めて、何が押せるか」と、所要時間を延ばしたときに落ちる Web 枠が
 * 保存の前に出ることを見る。いまの時刻は prop で注ぎ、実行日に依存させない。
 */

/** 器へ返す下書き。形の正本は `sections.ts`。 */
type PanelDraft = Parameters<SettingsPanelProps['onDraftChange']>[0]

const STORE_ID = '11111111-2222-4333-8444-555555555555'
/** JST 2026-08-28（金）11:00。 */
const NOW = '2026-08-28T02:00:00.000Z'

const id = (n: number) => `cccccccc-dddd-4eee-8fff-${String(n).padStart(12, '0')}`

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
  requirements: { kind: 'skill' | 'equipment_kind'; value: string }[]
  version: number
}

/** 銀座店の 6 件（`03-data-model.md` §6.1）。 */
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
  const first = row(1, 'メガネを新しく作る', '新しいメガネを作る', '新調相談', 60, true)
  first.requirements = [
    { kind: 'skill', value: 'measure' },
    { kind: 'equipment_kind', value: 'measure' },
    { kind: 'equipment_kind', value: 'counter' },
  ]
  return [
    first,
    row(2, '今のメガネを調整したい', 'かけ具合の調整', '調整', 20, true),
    row(3, 'できあがりを受け取る', 'できあがりの受け取り', '受け取り', 20, true),
    row(4, '修理・部品交換', '修理・部品の交換', '修理', 30, false),
    row(5, 'コンタクトの相談', 'コンタクトのご相談', 'コンタクト', 40, true),
    row(6, '視力測定だけ', '視力測定', '視力測定', 30, true),
  ]
}

const TWO_WEB_SLOTS = [
  {
    at: '2026-08-28T02:00:00.000Z',
    label: '視力測定機Aが空きません',
    targetType: 'web_slot',
    targetId: null,
  },
  {
    at: '2026-08-29T05:00:00.000Z',
    label: '相談カウンターが空きません',
    targetType: 'web_slot',
    targetId: null,
  },
]

let purposes: Purpose[]
let webSlots: typeof TWO_WEB_SLOTS
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
  if (path === '/api/staff/settings/impact') {
    return json({
      affectedReservations: [],
      affectedWebSlots: webSlots,
      lastAcceptableAt: null,
      severity: webSlots.length === 0 ? 'info' : 'action',
    })
  }
  if (path === '/api/staff/purposes/order' && method === 'PUT') {
    const order = (body as { purposeIds: string[] }).purposeIds
    purposes = order.map((purposeId, index) => {
      const found = purposes.find((row) => row.id === purposeId)
      if (!found) throw new Error(`unknown purpose ${purposeId}`)
      return { ...found, sortOrder: index }
    })
    return json(purposes)
  }
  const forRequirements = path.match(/\/api\/staff\/purposes\/([^/?]+)\/requirements$/)
  if (forRequirements && method === 'PUT') {
    const found = purposes.find((row) => row.id === forRequirements[1])
    if (found) {
      found.requirements = (body as { requirements: Purpose['requirements'] }).requirements
      found.version += 1
    }
    return json({ ...found })
  }
  const forPatch = path.match(/\/api\/staff\/purposes\/([^/?]+)$/)
  if (forPatch && method === 'PATCH') {
    if (patchStatus !== 200) {
      return json({ error: patchStatus === 403 ? 'forbidden' : 'version_conflict' }, patchStatus)
    }
    const found = purposes.find((row) => row.id === forPatch[1])
    if (found) {
      const { version: _version, ...fields } = body as Record<string, unknown>
      Object.assign(found, fields, { version: found.version + 1 })
    }
    return json({ ...found })
  }
  if (path.startsWith('/api/staff/purposes') && method === 'POST') {
    const input = body as Pick<
      Purpose,
      'nameInternal' | 'namePublic' | 'nameShort' | 'durationMinutes'
    >
    purposes.push({
      ...input,
      id: id(7),
      storeId: null,
      isWebPublished: true,
      isActive: true,
      sortOrder: purposes.length,
      requirements: [],
      version: 1,
    })
    return json(purposes[purposes.length - 1])
  }
  if (path.startsWith('/api/staff/purposes')) return json(purposes)
  return json({ error: 'not_found' }, 404)
}

beforeEach(() => {
  purposes = seedPurposes()
  webSlots = TWO_WEB_SLOTS
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
    <PurposePanel
      storeId={STORE_ID}
      now={NOW}
      onDraftChange={(draft) => {
        drafts.push(draft)
      }}
    />,
  )
  await screen.findByRole('table', { name: 'ご来店の目的' })
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

function editor() {
  return screen.getByRole('group', { name: /編集中：/ })
}

function list() {
  return screen.getByRole('table', { name: 'ご来店の目的' })
}

function nameColumn() {
  return within(list())
    .getAllByRole('rowheader')
    .map((cell) => cell.textContent)
}

function minutesField() {
  return within(editor()).getByLabelText('所要時間（分）')
}

async function retype(field: HTMLElement, value: string) {
  await userEvent.clear(field)
  await userEvent.type(field, value)
}

describe('ご来店の目的の一覧', () => {
  it('一覧は「ご来店の目的　6件」で、列は 目的の名前（店内） / お客様に見せる名前 / 所要時間 / Web予約 である', async () => {
    await open()
    expect(screen.getByText(/ご来店の目的\s+6件/)).toBeInTheDocument()
    expect(
      within(list())
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent)
        .slice(0, 4),
    ).toEqual(['目的の名前（店内）', 'お客様に見せる名前', '所要時間', 'Web予約'])
  })

  it('1 行目は メガネを新しく作る / 新しいメガネを作る / 60分 / 公開しています である', async () => {
    await open()
    const row = screen.getByRole('button', { name: 'メガネを新しく作る' }).closest('tr')
    expect(row).toHaveTextContent('新しいメガネを作る')
    expect(row).toHaveTextContent('60分')
    expect(row).toHaveTextContent('公開しています')
  })

  it('修理・部品交換 だけが「お店で受けるだけ」で、残り 5 件が「公開しています」である', async () => {
    await open()
    expect(within(list()).getAllByText('公開しています')).toHaveLength(5)
    expect(within(list()).getByText('お店で受けるだけ').closest('tr')).toHaveTextContent(
      '修理・部品交換',
    )
  })

  it('「メガネを新しく作る」を選ぶと「編集中：メガネを新しく作る」が出る', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'メガネを新しく作る' }))
    expect(screen.getByText('編集中：メガネを新しく作る')).toBeInTheDocument()
    expect(minutesField()).toHaveValue(60)
  })
})

describe('所要時間を延ばしたときに落ちる Web 枠', () => {
  it('所要時間を 50分から 60分へ変えると「50分から変更」の札が付く', async () => {
    const first = purposes[0]
    if (first) first.durationMinutes = 50
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'メガネを新しく作る' }))
    await retype(minutesField(), '60')
    expect(await within(editor()).findByText('50分から変更')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'メガネを新しく作る' }).closest('tr'),
    ).toHaveTextContent('60分')
  })

  it('そのとき「60分に延ばすと受けられなくなるWeb枠　2件」が出て、2 行が並ぶ', async () => {
    const first = purposes[0]
    if (first) first.durationMinutes = 50
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: 'メガネを新しく作る' }))
    await retype(minutesField(), '60')
    const heading = await screen.findByRole('heading', { name: /受けられなくなるWeb枠/ })
    expect(heading.textContent).toBe('60分に延ばすと受けられなくなるWeb枠　2件')
    const lines = within(
      screen.getByRole('list', { name: '60分に延ばすと受けられなくなるWeb枠' }),
    ).getAllByRole('listitem')
    expect(lines.map((line) => line.textContent)).toEqual([
      '8月28日（金）11:00視力測定機Aが空きません',
      '8月29日（土）14:00相談カウンターが空きません',
    ])
    await waitFor(() => expect(drafts.at(-1)?.danger).toBe(true))
    expect(drafts.at(-1)?.dangerNote).toBe('受けられなくなるWeb枠が 2件 あります')
  })

  it('所要時間を短くする変更では影響のカードを出さない', async () => {
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: 'メガネを新しく作る' }))
    await retype(minutesField(), '20')
    await waitFor(() => expect(changes(drafts)).toHaveLength(1))
    expect(within(editor()).getByText('60分から変更')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /受けられなくなるWeb枠/ })).not.toBeInTheDocument()
    expect(calls.some((call) => call.path === '/api/staff/settings/impact')).toBe(false)
    expect(drafts.at(-1)?.danger).toBe(false)
  })
})

describe('Web予約に出す', () => {
  it('「修理・部品交換」の「Web予約に出す」を切って保存すると、公開している行が 5 件になる', async () => {
    for (const purpose of purposes) purpose.isWebPublished = true
    const drafts = await open()
    expect(within(list()).getAllByText('公開しています')).toHaveLength(6)
    await userEvent.click(screen.getByRole('button', { name: '修理・部品交換' }))
    await userEvent.click(within(editor()).getByRole('switch', { name: /Web予約に出す/ }))
    expect(await save(drafts)).toBe('saved')
    await waitFor(() => expect(within(list()).getAllByText('公開しています')).toHaveLength(5))
    expect(within(list()).getByText('お店で受けるだけ').closest('tr')).toHaveTextContent(
      '修理・部品交換',
    )
  })

  it('「Web予約に出す」は行全体が押せる切り替えで、入と切の状態が読み上げられる', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'メガネを新しく作る' }))
    const toggle = within(editor()).getByRole('switch', { name: /Web予約に出す/ })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle.className).toContain('min-h-12')
    expect(toggle.className).toContain('w-full')
    expect(within(editor()).getByText('出します')).toBeInTheDocument()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(within(editor()).getByText('お店で受けるだけ')).toBeInTheDocument()
  })
})

describe('必要な技能と設備', () => {
  it('必要な技能は 1 つまで、必要な設備・場所は 2 つまでしか選べない', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'メガネを新しく作る' }))
    const skills = within(editor()).getByRole('radiogroup', { name: '必要な技能' })
    expect(within(skills).getByRole('radio', { name: '視力測定' })).toBeChecked()
    await userEvent.click(within(skills).getByRole('radio', { name: '加工' }))
    expect(within(skills).getByRole('radio', { name: '視力測定' })).not.toBeChecked()

    const kinds = within(editor()).getByRole('group', { name: '必要な設備・場所' })
    expect(within(kinds).getByRole('checkbox', { name: '視力測定機' })).toBeChecked()
    expect(within(kinds).getByRole('checkbox', { name: '相談カウンター' })).toBeChecked()
    expect(within(kinds).getByRole('checkbox', { name: '加工台' })).toBeDisabled()
    expect(within(kinds).getByText('必要な設備・場所は 2 つまでです。')).toBeInTheDocument()
    await userEvent.click(within(kinds).getByRole('checkbox', { name: '相談カウンター' }))
    expect(within(kinds).getByRole('checkbox', { name: '加工台' })).toBeEnabled()
  })
})

describe('目的を足す・並べ替える', () => {
  it('「＋ 目的を足す」から 目的の名前（店内）・お客様に見せる名前・台帳に出す短い名前・所要時間・必要な技能・必要な設備 を入れて保存すると「ご来店の目的　7件」になる', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: '＋ 目的を足す' }))
    const form = screen.getByRole('group', { name: '目的を足す' })
    await userEvent.type(within(form).getByLabelText('目的の名前（店内）'), 'サングラスの相談')
    await userEvent.type(within(form).getByLabelText('お客様に見せる名前'), 'サングラスのご相談')
    await userEvent.type(within(form).getByLabelText('台帳に出す短い名前'), 'サングラス')
    await retype(within(form).getByLabelText('所要時間（分）'), '30')
    await userEvent.click(within(form).getByRole('radio', { name: '販売・受付' }))
    await userEvent.click(within(form).getByRole('checkbox', { name: '相談カウンター' }))
    await userEvent.click(within(form).getByRole('button', { name: 'この目的を足す' }))
    await waitFor(() => expect(screen.getByText(/ご来店の目的\s+7件/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'サングラスの相談' })).toBeInTheDocument()
    expect(
      calls.find((call) => call.path.endsWith('/requirements') && call.method === 'PUT')?.body,
    ).toEqual({
      requirements: [
        { kind: 'skill', value: 'sales_reception' },
        { kind: 'equipment_kind', value: 'counter' },
      ],
    })
  })

  it('一覧の並び順を変えると、その順のままお客様への提示順になる', async () => {
    await open()
    expect(nameColumn().slice(0, 2)).toEqual(['メガネを新しく作る', '今のメガネを調整したい'])
    await userEvent.click(screen.getByRole('button', { name: '「今のメガネを調整したい」を上へ' }))
    await waitFor(() =>
      expect(nameColumn().slice(0, 2)).toEqual(['今のメガネを調整したい', 'メガネを新しく作る']),
    )
    const ordered = calls.find((call) => call.path === '/api/staff/purposes/order')
    const purposeIds = (ordered?.body as { purposeIds: string[] } | undefined)?.purposeIds ?? []
    expect(purposeIds.slice(0, 2)).toEqual([id(2), id(1)])
  })
})

describe('保存', () => {
  it('保存が 403 で跳ねられたら forbidden を返し、打ち込んだ値を残す', async () => {
    patchStatus = 403
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: 'メガネを新しく作る' }))
    await userEvent.click(within(editor()).getByRole('switch', { name: /Web予約に出す/ }))
    expect(await save(drafts)).toBe('forbidden')
    expect(within(editor()).getByRole('switch', { name: /Web予約に出す/ })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    expect(changes(drafts)).toHaveLength(1)
  })

  it('「変更を捨てる」で編集前へ戻る', async () => {
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: 'メガネを新しく作る' }))
    await userEvent.click(within(editor()).getByRole('switch', { name: /Web予約に出す/ }))
    await waitFor(() => expect(changes(drafts)).toHaveLength(1))
    act(() => drafts.at(-1)?.discard())
    await waitFor(() => expect(changes(drafts)).toHaveLength(0))
    expect(within(editor()).getByRole('switch', { name: /Web予約に出す/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('必要な技能を直すと、その 1 件も未保存の数に入る', async () => {
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: 'メガネを新しく作る' }))
    await userEvent.click(within(editor()).getByRole('radio', { name: '加工' }))
    await waitFor(() => expect(changes(drafts)).toHaveLength(1))
    expect(changes(drafts)).toEqual([
      'メガネを新しく作る の「必要な技能」を 視力測定 から 加工 に変える',
    ])
    expect(await save(drafts)).toBe('saved')
    expect(calls.find((call) => call.path.endsWith('/requirements'))?.body).toEqual({
      requirements: [
        { kind: 'skill', value: 'processing' },
        { kind: 'equipment_kind', value: 'measure' },
        { kind: 'equipment_kind', value: 'counter' },
      ],
    })
  })

  it('台帳に出す短い名前も直せる', async () => {
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: 'メガネを新しく作る' }))
    await retype(within(editor()).getByLabelText('台帳に出す短い名前'), '新調')
    await waitFor(() => expect(changes(drafts)).toHaveLength(1))
    expect(await save(drafts)).toBe('saved')
    expect(purposes[0]?.nameShort).toBe('新調')
  })
})

describe('保存を拒む', () => {
  const REFUSAL =
    '所要時間が 5 分の倍数ではないため保存できません。5 分から 480 分の間で、5 分きざみに直してください。'

  it('5 分の刻みから外れた所要時間は 2 文で拒み、その文を画面にも出す', async () => {
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: 'メガネを新しく作る' }))
    await retype(minutesField(), '61')
    expect(await screen.findByText(REFUSAL)).toBeInTheDocument()
    await waitFor(() => expect(drafts.at(-1)?.blocked).toBe(REFUSAL))
  })

  it('5 分の刻みに戻すと拒みが消える', async () => {
    const drafts = await open()
    await userEvent.click(screen.getByRole('button', { name: 'メガネを新しく作る' }))
    await retype(minutesField(), '61')
    await screen.findByText(REFUSAL)
    await retype(minutesField(), '65')
    await waitFor(() => expect(screen.queryByText(REFUSAL)).not.toBeInTheDocument())
    expect(drafts.at(-1)?.blocked).toBeNull()
  })
})

describe('読み込みと失敗', () => {
  it('読み込んでいる間はその事実を割り込まない知らせで出す', () => {
    render(<PurposePanel storeId={STORE_ID} now={NOW} onDraftChange={() => {}} />)
    expect(screen.getByText('ご来店の目的を読み込んでいます…')).toHaveAttribute('role', 'status')
  })

  it('読み込めなかったら理由と次の行動を出す', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    )
    render(<PurposePanel storeId={STORE_ID} now={NOW} onDraftChange={() => {}} />)
    expect(
      await screen.findByText('ご来店の目的を読み込めませんでした。画面を開き直してください。'),
    ).toBeInTheDocument()
  })

  it('1 件も無ければ、その事実だけを出す', async () => {
    purposes = []
    render(<PurposePanel storeId={STORE_ID} now={NOW} onDraftChange={() => {}} />)
    expect(
      await screen.findByText(
        'ご来店の目的がまだ登録されていません。「＋ 目的を足す」から登録します。',
      ),
    ).toBeInTheDocument()
  })
})
