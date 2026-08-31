import type { Alert } from '@app/contracts'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../shell/AppShell'
import { AlertList } from './AlertList'

/*
 * 承認済みモック docs/frontend/mockups/eyex/images/ALERTS.png の面。
 *
 * 見るのは 3 つ ——
 *   「アラート（対応が必要）」と「お知らせ」を分けて数えること、
 *   未読を**色だけで伝えない**こと（赤い縦罫のほかに「未読」の札を持つ）、
 *   添えた操作が成功したその時点で対応済みになり、**手で対応済みにする操作が無い**こと。
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
/** JST 2026-08-27（木）11:08。 */
const NOW = '2026-08-27T02:08:00.000Z'
const TODAY = '2026-08-27'
const RECORDING_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001'

const id = (n: number) => `cccccccc-dddd-4eee-8fff-${String(n).padStart(12, '0')}`

function seedAlerts(): Alert[] {
  return [
    // わざと「対応が必要」を真ん中に置く。先頭へ持ち上げるのは画面の仕事である。
    {
      id: id(2),
      code: 'web_booking.pending',
      severity: 'info',
      audience: 'store',
      title: 'Web予約が2件、確認待ちです',
      body: '本日中に確認しないと自動で取り消されます。',
      targetType: null,
      targetId: null,
      occurredAt: '2026-08-27T01:41:00.000Z',
      readAt: null,
      resolvedAt: null,
      resolvedBy: null,
    },
    {
      id: id(1),
      code: 'recording.upload_failed',
      severity: 'action',
      audience: 'store',
      title: '録音の保存に3回失敗しました',
      body: 'EY-R-1482　田中 花子 様。ご予約は成立しています。',
      targetType: 'recording',
      targetId: RECORDING_ID,
      occurredAt: '2026-08-27T02:04:00.000Z',
      readAt: null,
      resolvedAt: null,
      resolvedBy: null,
    },
    {
      id: id(3),
      code: 'equipment.maintenance_scheduled',
      severity: 'info',
      audience: 'store',
      title: '視力測定機 B の点検　8月30日 10:00–12:00',
      body: null,
      targetType: 'equipment',
      targetId: id(9),
      occurredAt: '2026-08-27T00:12:00.000Z',
      readAt: null,
      resolvedAt: null,
      resolvedBy: null,
    },
  ]
}

let alerts: Alert[]
let retryStatus: number
let calls: { method: string; path: string }[]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function counts() {
  const live = alerts.filter((row) => row.resolvedAt === null)
  return {
    all: live.length,
    action: live.filter((row) => row.severity === 'action').length,
    info: live.filter((row) => row.severity === 'info').length,
    // 「対応済み」だけ本日（JST）で区切る。種は 12 件あったことにする。
    resolved: 12 + alerts.filter((row) => row.resolvedAt !== null).length,
  }
}

function route(url: string, method: string): Response {
  const [path = url, query = ''] = url.split('?')
  calls.push({ method, path })
  if (path === '/api/staff/alerts' && method === 'GET') {
    const kind = new URLSearchParams(query).get('kind') ?? 'all'
    const live = alerts.filter((row) => row.resolvedAt === null)
    const items =
      kind === 'resolved'
        ? alerts.filter((row) => row.resolvedAt !== null)
        : kind === 'all'
          ? live
          : live.filter((row) => row.severity === kind)
    return json({ items, nextCursor: null, total: items.length, counts: counts() })
  }
  if (path === '/api/staff/alerts/read-all' && method === 'POST') {
    let updated = 0
    alerts = alerts.map((row) => {
      if (row.readAt !== null) return row
      updated += 1
      return { ...row, readAt: NOW }
    })
    return json({ updated })
  }
  if (path.startsWith('/api/staff/alerts/') && method === 'PATCH') {
    const alertId = path.slice('/api/staff/alerts/'.length)
    alerts = alerts.map((row) => (row.id === alertId ? { ...row, resolvedAt: NOW } : row))
    return json(alerts.find((row) => row.id === alertId))
  }
  if (path === `/api/staff/recordings/${RECORDING_ID}/retry` && method === 'POST') {
    return retryStatus === 200
      ? json({ id: RECORDING_ID, state: 'uploading' })
      : json({ error: 'invalid_transition' }, retryStatus)
  }
  return json({ error: 'not_found' }, 404)
}

beforeEach(() => {
  alerts = seedAlerts()
  retryStatus = 200
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      route(String(input), (init?.method ?? 'GET').toUpperCase()),
    ),
  )
})

afterEach(() => vi.unstubAllGlobals())

async function open(onOpenLedger = vi.fn()) {
  render(<AlertList storeId={STORE_ID} today={TODAY} onOpenLedger={onOpenLedger} />)
  await screen.findByText('録音の保存に3回失敗しました')
  return onOpenLedger
}

function rows() {
  return within(screen.getByRole('list', { name: 'お知らせ' })).getAllByRole('listitem')
}

describe('お知らせ', () => {
  it('左に「すべて 3件」「アラート（対応が必要） 1件」「お知らせ 2件」「対応済み 12件」の 4 分類が出る', async () => {
    await open()
    const kinds = screen.getByRole('navigation', { name: 'お知らせの分類' })
    const names = Array.from(kinds.querySelectorAll('button')).map((b) =>
      b.getAttribute('aria-label'),
    )
    expect(names).toEqual([
      'すべて 3件',
      'アラート（対応が必要） 1件',
      'お知らせ 2件',
      '対応済み 12件',
    ])
  })

  it('対応が必要な 1 件が先頭に出る', async () => {
    await open()
    const first = rows()[0]
    expect(first).toBeDefined()
    expect(
      within(first as HTMLElement).getByText('録音の保存に3回失敗しました'),
    ).toBeInTheDocument()
    expect(within(first as HTMLElement).getByText('対応が必要')).toBeInTheDocument()
  })

  it('未読の 3 件には左の赤い縦罫のほかに「未読」の札が付く', async () => {
    await open()
    expect(screen.getAllByText('未読')).toHaveLength(3)
    for (const row of rows()) {
      expect(row.className).toContain('border-l-4')
      expect(row.className).toContain('border-l-danger')
    }
  })

  it('「すべて既読にする」で未読の印と札が消える', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'すべて既読にする' }))
    await waitFor(() => expect(screen.queryByText('未読')).not.toBeInTheDocument())
    for (const row of rows()) expect(row.className).not.toContain('border-l-danger')
  })

  it('行に添えられた操作（もう一度送る／台帳で確認する／影響する予約を見る）が押せる', async () => {
    const onOpenLedger = await open()
    expect(screen.getByRole('button', { name: 'もう一度送る' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '影響する予約を見る' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: '台帳で確認する' }))
    expect(onOpenLedger).toHaveBeenCalled()
  })

  it('「もう一度送る」が成功すると、その 1 件が一覧から外れて「対応済み」が 1 増える', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'もう一度送る' }))
    await waitFor(() =>
      expect(screen.queryByText('録音の保存に3回失敗しました')).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: '対応済み 13件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'アラート（対応が必要） 0件' })).toBeInTheDocument()
    expect(calls).toContainEqual({ method: 'PATCH', path: `/api/staff/alerts/${id(1)}` })
  })

  it('「もう一度送る」が失敗したら未対応のまま残る', async () => {
    retryStatus = 409
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'もう一度送る' }))
    await screen.findByText('もう一度送れませんでした。時間をおいてお試しください。')
    expect(screen.getByText('録音の保存に3回失敗しました')).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
  })

  it('手で対応済みにする操作を持たない', async () => {
    await open()
    expect(screen.queryByRole('button', { name: /対応済みにする/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })
})

describe('お知らせの入口', () => {
  function shell(rail: boolean, current = 'alerts') {
    render(
      <AppShell
        storeName="EYEX 銀座店"
        storeSubline="お知らせとアラート"
        current={current}
        onNavigate={vi.fn()}
        rail={rail}
        onToggleRail={vi.fn()}
        alertCount={3}
        {...(current === 'alerts' ? {} : { onOpenAlerts: vi.fn() })}
      >
        <p>本文</p>
      </AppShell>,
    )
  }

  it('左の柱の入口が「お知らせ 3件」と読まれ、数字だけが単独で読まれない', () => {
    shell(false)
    const entry = screen.getByRole('button', { name: 'お知らせ 3件' })
    expect(entry).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '3' })).not.toBeInTheDocument()
  })

  it('柱がアイコンだけにたたまれていても同じように読まれる', () => {
    shell(true)
    expect(screen.getByRole('button', { name: 'お知らせ 3件' })).toBeInTheDocument()
  })

  it('上のバーのボタンも「お知らせ 3件」と読まれる', () => {
    shell(false, 'ledger')
    const buttons = screen.getAllByRole('button', { name: 'お知らせ 3件' })
    expect(buttons).toHaveLength(1)
  })
})
