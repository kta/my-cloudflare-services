import type { StorePermission } from '@app/contracts'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { SettingsPublication } from './SettingsPublication'

const STORE_ID = '00000000-0000-4000-8000-000000000010'
const OTHER_STORE = '00000000-0000-4000-8000-000000000011'
const DRAFT_ID = '00000000-0000-4000-8000-000000000020'
const RES_A = '00000000-0000-4000-8000-000000000031'
const RES_B = '00000000-0000-4000-8000-000000000032'
const PUBLICATION_ID = '00000000-0000-4000-8000-000000000040'
const VERSION_ID = '00000000-0000-4000-8000-000000000041'
const PAST_VERSION_ID = '00000000-0000-4000-8000-000000000050'
const TODAY = '2026-08-27'

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

const settings = {
  storeId: STORE_ID,
  version: 3,
  receptionStatus: 'open' as const,
  businessHours: [{ dayOfWeek: 1, periods: [{ startTime: '10:00', endTime: '19:00' }] }],
  exceptions: [],
  purposes: [],
  staff: [],
  shifts: [],
  equipment: [],
  maintenance: [],
}

const draft = {
  id: DRAFT_ID,
  storeId: STORE_ID,
  draftVersion: 4,
  baseVersion: 3,
  status: 'draft' as const,
  origin: 'store_override' as const,
  restoredFromVersionId: null,
  savedAt: '2026-08-26T09:05:00.000Z',
  savedBy: '山田 太郎',
  settings,
}

const blockingItems = [
  {
    kind: 'reservation_conflict' as const,
    severity: 'blocking' as const,
    reservationId: RES_A,
    message: '8/28 10:00 の予約が営業時間外になります',
    resolution: null,
  },
  {
    kind: 'reservation_conflict' as const,
    severity: 'blocking' as const,
    reservationId: RES_B,
    message: '8/29 15:00 の予約の設備が停止します',
    resolution: null,
  },
]

const impact = {
  draftId: DRAFT_ID,
  storeId: STORE_ID,
  evaluatedAt: '2026-08-26T09:06:00.000Z',
  blockingCount: 2,
  warningCount: 2,
  canPublish: false,
  ledgerEntriesAffected: 18,
  publicSlots: { date: '2026-08-27', publishedCount: 42, draftCount: 38 },
  items: [
    ...blockingItems,
    {
      kind: 'missing_staff_skill' as const,
      severity: 'warning' as const,
      reservationId: null,
      message: '眼鏡作製技能を持つスタッフがいません',
      resolution: null,
    },
    {
      kind: 'missing_equipment' as const,
      severity: 'warning' as const,
      reservationId: null,
      message: '視力測定機が不足します',
      resolution: null,
    },
    {
      kind: 'out_of_hours' as const,
      severity: 'info' as const,
      reservationId: null,
      message: '9/23 は営業時間外の設定です',
      resolution: null,
    },
  ],
}

const clearedImpact = {
  ...impact,
  blockingCount: 0,
  canPublish: true,
  items: impact.items.map((item) =>
    item.severity === 'blocking' ? { ...item, resolution: 'customer_contacted' as const } : item,
  ),
}

const override = {
  storeId: STORE_ID,
  origin: 'store_override' as const,
  chainVersion: 7,
  overriddenFields: ['businessHours', 'purposes'],
}

const versions = [
  {
    versionId: PAST_VERSION_ID,
    storeId: STORE_ID,
    version: 3,
    origin: 'store_override' as const,
    publishedAt: '2026-08-20T09:00:00.000Z',
    publishedBy: '佐藤 美咲',
    changedFields: ['receptionStatus', 'purposes'],
  },
]

const versionDetail = {
  ...versions[0],
  settings,
  diff: [
    { field: 'receptionStatus', before: '"open"', after: '"paused"' },
    { field: 'purposes', before: '[{"id":"a"},{"id":"b"}]', after: '[{"id":"a"}]' },
  ],
}

const scheduledPublication = {
  id: PUBLICATION_ID,
  versionId: VERSION_ID,
  draftId: DRAFT_ID,
  status: 'scheduled' as const,
  scheduledForJst: '2026-08-30T18:00',
  scheduledAt: '2026-08-30T09:00:00.000Z',
  executedAt: null,
  appliedCount: 0,
  failedCount: 0,
  ledgerEntriesAffected: 0,
  webSlotEffect: { date: '2026-08-27', previousSlotCount: 428, publishedSlotCount: 402 },
  targets: [
    {
      storeId: STORE_ID,
      status: 'pending' as const,
      appliedVersion: null,
      failureReason: null,
      appliedAt: null,
    },
  ],
}

const partiallyFailedPublication = {
  ...scheduledPublication,
  status: 'partially_failed' as const,
  scheduledForJst: null,
  scheduledAt: null,
  executedAt: '2026-08-26T09:00:00.000Z',
  appliedCount: 12,
  failedCount: 1,
  ledgerEntriesAffected: 13,
  targets: [
    {
      storeId: STORE_ID,
      status: 'applied' as const,
      appliedVersion: 4,
      failureReason: null,
      appliedAt: '2026-08-26T09:00:00.000Z',
    },
    {
      storeId: OTHER_STORE,
      status: 'failed' as const,
      appliedVersion: null,
      failureReason: '視力測定機が停止中',
      appliedAt: null,
    },
  ],
}

/* 店舗の名前は `/api/staff/stores` からしか引けない。公開結果は複数店舗を並べる。 */
const storeList = [
  {
    id: STORE_ID,
    organizationId: 'org-eyex',
    name: '銀座店',
    slug: 'ginza',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: OTHER_STORE,
    organizationId: 'org-eyex',
    name: '丸の内店',
    slug: 'marunouchi',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]

type Call = { url: string; method: string; body: unknown }

function setup(
  options: {
    permissions?: StorePermission[]
    dirty?: boolean
    handlers?: (url: string, method: string, calls: Call[]) => Response | undefined
  } = {},
) {
  const calls: Call[] = []
  const api = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ url, method, body })
    const custom = options.handlers?.(url, method, calls)
    if (custom !== undefined) return custom
    if (url.endsWith('/api/staff/stores') && method === 'GET') return jsonResponse(storeList)
    if (url.endsWith('/availability/draft') && method === 'GET') return jsonResponse(draft)
    if (url.endsWith('/availability/draft') && method === 'PUT') return jsonResponse(draft, 201)
    if (url.endsWith('/availability/draft/impact')) return jsonResponse(impact)
    if (url.endsWith('/availability/override') && method === 'GET') return jsonResponse(override)
    if (url.endsWith('/availability/versions') && method === 'GET') return jsonResponse(versions)
    if (url.endsWith(`/availability/versions/${PAST_VERSION_ID}`) && method === 'GET') {
      return jsonResponse(versionDetail)
    }
    return jsonResponse({ error: 'unexpected' }, 500)
  })
  const navigate = vi.fn()
  /*
   * 公開結果は工程 6 の中ではなく独立した面に出る（承認済みモック
   * `#publish-result`）。実アプリでは設定ガイドが公開の成功を受けて面を
   * 移すので、テストの足場も同じ形で組む。
   */
  function Harness() {
    const [view, setView] = useState<'guide' | 'result'>('guide')
    return (
      <SettingsPublication
        storeId={STORE_ID}
        storeName="銀座店"
        api={api as unknown as (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>}
        navigate={navigate}
        permissions={options.permissions ?? ['settings.read', 'settings.manage']}
        today={TODAY}
        dirty={options.dirty ?? false}
        view={view}
        onPublished={() => setView('result')}
      />
    )
  }
  render(<Harness />)
  return { api, calls, navigate }
}

afterEach(() => {
  vi.restoreAllMocks()
})

/* ---------------- 権限 (UC-EYEX-098 と同じ規則) ---------------- */

test('settings.read が無ければ内容を一切出さない', () => {
  setup({ permissions: [] })
  expect(screen.getByText('設定を閲覧する権限がありません。')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '公開する' })).toBeNull()
})

test('settings.manage が無ければ閲覧はできても下書き・公開操作を出さない', async () => {
  setup({ permissions: ['settings.read'] })
  expect(await screen.findByText('42件 → 38件（-4件）')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '公開する' })).toBeNull()
  expect(screen.queryByRole('button', { name: '下書きを保存' })).toBeNull()
  expect(screen.queryByRole('button', { name: '店舗上書きを解除' })).toBeNull()
})

/* ---------------- 状態と保存状態 (UC-EYEX-095, 096, 159, AC-EYEX-45) ---------------- */

test('状態は語で示し、競合と失敗は状態とは別の警告として並べる', async () => {
  setup()
  const state = await screen.findByRole('region', { name: '設定の状態' })
  expect(within(state).getByText('下書き')).toBeTruthy()
  expect(within(state).getByText('保存済み')).toBeTruthy()
  expect(within(state).getByText('最終保存 2026年8月26日 18:05')).toBeTruthy()
  expect(within(state).getByText('変更者 山田 太郎')).toBeTruthy()

  const warnings = await screen.findByRole('region', { name: '警告' })
  expect(within(warnings).getByText('影響予約2件が未解消です')).toBeTruthy()
  expect(within(warnings).getByText('警告2件')).toBeTruthy()
  // 警告は状態ブロックの中には現れない。
  expect(within(state).queryByText('影響予約2件が未解消です')).toBeNull()
})

test('工程1〜5に未保存の編集があれば未保存と最終保存時刻の両方を出す', async () => {
  setup({ dirty: true })
  const state = await screen.findByRole('region', { name: '設定の状態' })
  expect(within(state).getByText('未保存')).toBeTruthy()
  expect(within(state).getByText('最終保存 2026年8月26日 18:05')).toBeTruthy()
})

/* ---------------- 影響確認 (UC-EYEX-093, 097, 115, AC-EYEX-43, 44, 46, 66) ---------------- */

test('影響確認は既存予約の競合・公開枠・技能不足・設備不足・営業時間外を出す', async () => {
  setup()
  const panel = await screen.findByRole('region', { name: '影響確認' })
  expect(within(panel).getByText('42件 → 38件（-4件）')).toBeTruthy()
  expect(within(panel).getByText('18件')).toBeTruthy()
  expect(within(panel).getByText('8/28 10:00 の予約が営業時間外になります')).toBeTruthy()
  expect(within(panel).getByText('眼鏡作製技能を持つスタッフがいません')).toBeTruthy()
  expect(within(panel).getByText('視力測定機が不足します')).toBeTruthy()
  expect(within(panel).getByText('9/23 は営業時間外の設定です')).toBeTruthy()
})

test('重大度は色ではなく語で読める', async () => {
  setup()
  const conflicts = await screen.findByRole('region', { name: '既存予約との競合' })
  expect(within(conflicts).getByText('要対応')).toBeTruthy()
  const skills = await screen.findByRole('region', { name: '技能不足' })
  expect(within(skills).getByText('警告')).toBeTruthy()
  const hours = await screen.findByRole('region', { name: '営業時間外設定' })
  expect(within(hours).getByText('情報')).toBeTruthy()
})

/* ---------------- ブロッキングの解消 (UC-EYEX-165, AC-EYEX-109) ---------------- */

test('未解消のブロッキング項目が残るあいだは公開できない', async () => {
  setup()
  const publish = await screen.findByRole('button', { name: '公開する' })
  // 押せないことは `aria-disabled` で示す。タブ順から外すと押せない理由の
  // 説明にも辿り着けなくなる（design/controls の Action）。
  expect(publish.getAttribute('aria-disabled')).toBe('true')
  expect(
    screen.getByText('影響予約ごとに代替設備、例外維持、顧客連絡を記録してください。'),
  ).toBeTruthy()
})

test('影響予約を解消すると記録され、すべて解消すれば公開できるようになる', async () => {
  let resolvedOnce = false
  const { calls } = setup({
    handlers: (url, method) => {
      if (url.includes('/draft/conflicts/') && method === 'POST') {
        resolvedOnce = true
        return jsonResponse(
          {
            draftId: DRAFT_ID,
            reservationId: RES_A,
            resolution: 'alternative_resource',
            note: '別の測定機へ振替',
            resolvedBy: '山田 太郎',
            resolvedAt: '2026-08-26T09:10:00.000Z',
          },
          201,
        )
      }
      if (url.endsWith('/availability/draft/impact')) {
        return jsonResponse(resolvedOnce ? clearedImpact : impact)
      }
      return undefined
    },
  })

  const conflicts = await screen.findByRole('region', { name: '既存予約との競合' })
  fireEvent.click(within(conflicts).getAllByRole('button', { name: '解消を記録' })[0] as Element)

  const dialog = await screen.findByRole('dialog', { name: '影響予約の解消を記録' })
  fireEvent.change(within(dialog).getByLabelText('対応'), {
    target: { value: 'alternative_resource' },
  })
  fireEvent.change(within(dialog).getByLabelText('メモ'), { target: { value: '別の測定機へ振替' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '記録する' }))

  await waitFor(() => {
    expect(
      calls.some(
        (call) =>
          call.method === 'POST' &&
          call.url === `/api/staff/stores/${STORE_ID}/availability/draft/conflicts/${RES_A}` &&
          JSON.stringify(call.body) ===
            JSON.stringify({ resolution: 'alternative_resource', note: '別の測定機へ振替' }),
      ),
    ).toBe(true)
  })

  await waitFor(() => {
    expect(screen.getByRole('button', { name: '公開する' }).hasAttribute('aria-disabled')).toBe(
      false,
    )
  })
  expect(screen.getAllByText('顧客連絡').length).toBe(2)
})

/* ---------------- 公開予約 (UC-EYEX-094, 161, 166, AC-EYEX-105) ---------------- */

test('過去の日時は公開予約にできない', async () => {
  const { calls } = setup({
    handlers: (url) =>
      url.endsWith('/availability/draft/impact') ? jsonResponse(clearedImpact) : undefined,
  })
  const input = await screen.findByLabelText('公開日時（JST）')
  fireEvent.change(input, { target: { value: '2026-08-26T18:00' } })
  fireEvent.click(screen.getByRole('button', { name: '公開を予約する' }))
  expect(await screen.findByText('過去の日時は指定できません。')).toBeTruthy()
  expect(calls.some((call) => call.url.endsWith('/availability/publications'))).toBe(false)
})

test('公開予約はJSTの壁時計で送られ、予定と取消・日時変更が出る', async () => {
  const { calls } = setup({
    handlers: (url, method) => {
      if (url.endsWith('/availability/draft/impact')) return jsonResponse(clearedImpact)
      if (url.endsWith('/availability/publications') && method === 'POST') {
        return jsonResponse(scheduledPublication, 201)
      }
      return undefined
    },
  })
  fireEvent.change(await screen.findByLabelText('公開日時（JST）'), {
    target: { value: '2026-08-30T18:00' },
  })
  fireEvent.click(screen.getByRole('button', { name: '公開を予約する' }))

  await waitFor(() => {
    const call = calls.find((entry) => entry.url.endsWith('/availability/publications'))
    expect(call?.body).toMatchObject({
      draftId: DRAFT_ID,
      targetStoreIds: [STORE_ID],
      scheduledForJst: '2026-08-30T18:00',
    })
    const body = call?.body as { idempotencyKey?: unknown } | undefined
    expect(typeof body?.idempotencyKey).toBe('string')
  })

  const result = await screen.findByRole('region', { name: '公開結果' })
  expect(within(result).getByText('公開予約')).toBeTruthy()
  expect(within(result).getByText(/公開予定 2026年8月30日 18:00/)).toBeTruthy()
  expect(within(result).getByRole('button', { name: '公開予定を取消' })).toBeTruthy()
  expect(within(result).getByRole('button', { name: '公開予定を変更' })).toBeTruthy()
})

test('公開予定の取消はPATCHで送られる', async () => {
  const { calls } = setup({
    handlers: (url, method) => {
      if (url.endsWith('/availability/draft/impact')) return jsonResponse(clearedImpact)
      if (url.endsWith('/availability/publications') && method === 'POST') {
        return jsonResponse(scheduledPublication, 201)
      }
      if (url.endsWith(`/availability/publications/${PUBLICATION_ID}`) && method === 'PATCH') {
        return jsonResponse({ ...scheduledPublication, status: 'cancelled' })
      }
      return undefined
    },
  })
  fireEvent.change(await screen.findByLabelText('公開日時（JST）'), {
    target: { value: '2026-08-30T18:00' },
  })
  fireEvent.click(screen.getByRole('button', { name: '公開を予約する' }))
  fireEvent.click(await screen.findByRole('button', { name: '公開予定を取消' }))

  await waitFor(() => {
    const call = calls.find(
      (entry) =>
        entry.method === 'PATCH' &&
        entry.url.endsWith(`/availability/publications/${PUBLICATION_ID}`),
    )
    expect(call?.body).toEqual({ status: 'cancelled' })
  })
  expect(await screen.findByText('取消')).toBeTruthy()
})

/* ---------------- 公開結果と部分失敗 (UC-EYEX-162, 163, AC-EYEX-106, 107) ---------------- */

test('公開結果は人が読む版の採番・対象店舗・反映件数・失敗件数・Web枠と台帳の反映を出す', async () => {
  setup({
    handlers: (url, method) => {
      if (url.endsWith('/availability/draft/impact')) return jsonResponse(clearedImpact)
      if (url.endsWith('/availability/publications') && method === 'POST') {
        return jsonResponse(partiallyFailedPublication, 201)
      }
      return undefined
    },
  })
  fireEvent.click(await screen.findByRole('button', { name: '公開する' }))
  const result = await screen.findByRole('region', { name: '公開結果' })
  // 版は人が読む採番で名乗る。保存用の UUID は画面に出さない。
  expect(within(result).getByText('第4版の公開結果')).toBeTruthy()
  expect(result.textContent).not.toContain(VERSION_ID)
  // 承認済みモック `#publish-result` の 3 枚。数は 28px で立て、内訳は下に添える。
  expect(within(result).getByText('12店舗')).toBeTruthy()
  expect(within(result).getByText('公開枠 402件')).toBeTruthy()
  expect(within(result).getByText('1店舗')).toBeTruthy()
  expect(within(result).getByText('丸の内店 · 視力測定機が停止中')).toBeTruthy()
  expect(within(result).getByText('Web予約 12/13')).toBeTruthy()
  expect(within(result).getByText('予約台帳 12/13')).toBeTruthy()
  expect(within(result).getByText(/実行日時 2026年8月26日 18:00/)).toBeTruthy()
  expect(within(result).getByText('一部失敗')).toBeTruthy()
})

test('再試行は失敗店舗だけを対象にし、成功済み店舗へ再適用しない', async () => {
  const { calls } = setup({
    handlers: (url, method) => {
      if (url.endsWith('/availability/draft/impact')) return jsonResponse(clearedImpact)
      if (url.endsWith('/availability/publications') && method === 'POST') {
        return jsonResponse(partiallyFailedPublication, 201)
      }
      if (url.endsWith(`/availability/publications/${PUBLICATION_ID}/retry`)) {
        return jsonResponse({
          ...partiallyFailedPublication,
          status: 'completed',
          appliedCount: 13,
          failedCount: 0,
          targets: partiallyFailedPublication.targets.map((target) => ({
            ...target,
            status: 'applied' as const,
            appliedVersion: 4,
            failureReason: null,
            appliedAt: '2026-08-26T09:20:00.000Z',
          })),
        })
      }
      return undefined
    },
  })
  fireEvent.click(await screen.findByRole('button', { name: '公開する' }))

  const failed = await screen.findByRole('region', { name: '失敗した店舗' })
  // 生の UUID は画面に出さない。誰も読めず、店舗の取り違えを招く。
  expect(within(failed).getByText('丸の内店')).toBeTruthy()
  expect(within(failed).queryByText(OTHER_STORE)).toBeNull()
  expect(within(failed).getByText('視力測定機が停止中')).toBeTruthy()
  expect(within(failed).queryByText(STORE_ID)).toBeNull()
  expect(screen.getByText('再試行対象 1店舗')).toBeTruthy()

  fireEvent.click(within(failed).getByRole('button', { name: 'この店舗だけ再試行' }))
  await waitFor(() => {
    expect(
      calls.some((call) => call.url.endsWith(`/availability/publications/${PUBLICATION_ID}/retry`)),
    ).toBe(true)
  })
  expect(await screen.findByText('完了')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'この店舗だけ再試行' })).toBeNull()
})

/* ---------------- 版履歴と復元 (UC-EYEX-096, 164, AC-EYEX-108) ---------------- */

test('過去版の差分を変更前後で読める', async () => {
  setup()
  const history = await screen.findByRole('region', { name: '版履歴' })
  expect(within(history).getByText('第3版')).toBeTruthy()
  expect(within(history).getByText('佐藤 美咲')).toBeTruthy()
  fireEvent.click(within(history).getByRole('button', { name: '版の差分を見る' }))

  const diff = await screen.findByRole('region', { name: '第3版の差分' })
  const row = within(diff).getByRole('row', { name: /受付状態/ })
  expect(within(row).getByText('open')).toBeTruthy()
  expect(within(row).getByText('paused')).toBeTruthy()
  expect(within(diff).getByRole('row', { name: /来店目的/ })).toBeTruthy()
})

test('復元は再公開ではなく新しい下書きを作り、影響確認を求める', async () => {
  const { calls } = setup({
    handlers: (url, method) => {
      if (url.endsWith(`/availability/versions/${PAST_VERSION_ID}/restore`) && method === 'POST') {
        return jsonResponse({ ...draft, restoredFromVersionId: PAST_VERSION_ID }, 201)
      }
      return undefined
    },
  })
  const history = await screen.findByRole('region', { name: '版履歴' })
  fireEvent.click(within(history).getByRole('button', { name: '過去版から新しい下書きを作る' }))

  await waitFor(() => {
    expect(
      calls.some((call) => call.url.endsWith(`/availability/versions/${PAST_VERSION_ID}/restore`)),
    ).toBe(true)
  })
  expect(
    await screen.findByText(
      '過去版を新しい下書きにしました。公開する前に影響確認を行ってください。',
    ),
  ).toBeTruthy()
  // 復元は直接の再公開ではない。公開ボタンは影響確認の結果に従う。
  expect(screen.getByRole('button', { name: '公開する' }).getAttribute('aria-disabled')).toBe(
    'true',
  )
  expect(calls.some((call) => call.url.endsWith('/availability/publications'))).toBe(false)
})

/* ---------------- 適用元と上書き解除 (UC-EYEX-092, 120, 121, 160, AC-EYEX-48, 69, 104) ---------------- */

test('適用元と上書きした項目を区別して読める', async () => {
  setup()
  const panel = await screen.findByRole('region', { name: '適用元' })
  expect(within(panel).getByText('店舗上書き')).toBeTruthy()
  expect(within(panel).getByText('全店共通 第7版')).toBeTruthy()
  expect(within(panel).getByText('営業時間')).toBeTruthy()
  expect(within(panel).getByText('来店目的')).toBeTruthy()
})

test('上書き解除は共通値と影響を先に見せる', async () => {
  setup({
    handlers: (url, method) => {
      if (url.endsWith('/availability/override/release') && method === 'POST') {
        return jsonResponse(
          {
            chainVersion: 7,
            draft: { ...draft, origin: 'chain' as const },
            impact: clearedImpact,
          },
          201,
        )
      }
      return undefined
    },
  })
  fireEvent.click(await screen.findByRole('button', { name: '店舗上書きを解除' }))
  expect(await screen.findByText('全店共通値 第7版を新しい下書きにしました')).toBeTruthy()
  expect(screen.getByText('公開する前に影響確認を行ってください。')).toBeTruthy()
  const panel = await screen.findByRole('region', { name: '適用元' })
  expect(within(panel).getByText('全店共通')).toBeTruthy()
})

/* ---------------- 版競合 ---------------- */

test('古い版を土台にした保存は拒否され、最新版が示される', async () => {
  setup({
    handlers: (url, method) => {
      if (url.endsWith('/availability/draft') && method === 'PUT') {
        return jsonResponse(
          { error: 'version_conflict', currentVersion: 5, expectedVersion: 3 },
          409,
        )
      }
      return undefined
    },
  })
  fireEvent.click(await screen.findByRole('button', { name: '下書きを保存' }))
  expect(
    await screen.findByText(
      '他の担当者が先に保存しました。最新は第5版です（この画面は第3版）。最新を読み込み直してください。',
    ),
  ).toBeTruthy()
})

test('確認へ回すと下書きの状態が確認待ちになる', async () => {
  const { calls } = setup({
    handlers: (url, method) => {
      if (url.endsWith('/availability/draft') && method === 'PUT') {
        return jsonResponse({ ...draft, status: 'review' as const }, 201)
      }
      return undefined
    },
  })
  fireEvent.click(await screen.findByRole('button', { name: '確認へ回す' }))
  await waitFor(() => {
    const call = calls.find((entry) => entry.method === 'PUT')
    const body = call?.body as { status?: unknown; settings?: { storeId?: unknown } } | undefined
    expect(body?.status).toBe('review')
    expect(body?.settings?.storeId).toBeUndefined()
  })
  const state = await screen.findByRole('region', { name: '設定の状態' })
  expect(within(state).getByText('確認待ち')).toBeTruthy()
})

test('公開結果は実行者と、版へ戻る 2 つの操作を持つ (承認済みモック #publish-result)', async () => {
  const { calls } = setup({
    handlers: (url, method) => {
      if (url.endsWith('/availability/draft/impact')) return jsonResponse(clearedImpact)
      if (url.endsWith('/availability/publications') && method === 'POST') {
        return jsonResponse(partiallyFailedPublication, 201)
      }
      return undefined
    },
  })
  fireEvent.click(await screen.findByRole('button', { name: '公開する' }))
  const result = await screen.findByRole('region', { name: '公開結果' })

  // 誰が公開したかは版が持っている。契約に無い「承認者」は名乗らない。
  expect(within(result).getByText(/実行者 佐藤 美咲/)).toBeTruthy()

  fireEvent.click(within(result).getByRole('button', { name: '版の差分を見る' }))
  await waitFor(() => {
    expect(
      calls.some((call) => call.url.endsWith(`/availability/versions/${PAST_VERSION_ID}`)),
    ).toBe(true)
  })
  fireEvent.click(within(result).getByRole('button', { name: '過去版から新しい下書きを作る' }))
  await waitFor(() => {
    expect(
      calls.some((call) => call.url.endsWith(`/availability/versions/${PAST_VERSION_ID}/restore`)),
    ).toBe(true)
  })
})
