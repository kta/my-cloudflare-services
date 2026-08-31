import type { Terminal } from '@app/contracts'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsScreen } from './SettingsScreen'
import { TerminalSettings } from './TerminalSettings'

/*
 * 「設定 › 端末の設定」。モックは無いので、ほかの設定の面と同じ型で作る
 * （第2サイドバー → 保存バー → 本体。保存は器の「保存」だけが起こす）。
 *
 * 見るのは 4 つ —— 一覧が名前・置き場所・使い方・自動で伏せるまでの時間を持つこと、
 * 使い方の決め直しが次の業務開始の画面を変えること、簡単すぎる暗証番号を拒むこと、
 * スタッフの権限では保存できないこと。**平文の暗証番号は画面にも応答にも出さない。**
 */

const STORE_ID = '11111111-2222-4333-8444-555555555555'
const NOW = '2026-08-27T02:08:00.000Z'
const id = (n: number) => `cccccccc-dddd-4eee-8fff-${String(n).padStart(12, '0')}`

function seed(): Terminal[] {
  return [
    {
      id: id(1),
      storeId: STORE_ID,
      name: '銀座店 レジ横iPad',
      kind: 'shared',
      placeNote: 'レジの右側　固定スタンド',
      deviceLabel: 'EYEX-iPad-07',
      autoLockSeconds: 120,
      isActive: true,
      hasPin: true,
      lastSeenAt: NOW,
      isOnline: true,
      version: 3,
      createdAt: NOW,
    },
    {
      id: id(2),
      storeId: STORE_ID,
      name: '銀座店 受付iPad',
      kind: 'shared',
      placeNote: '入口の受付台',
      deviceLabel: 'EYEX-iPad-08',
      autoLockSeconds: 180,
      isActive: true,
      hasPin: true,
      lastSeenAt: NOW,
      isOnline: true,
      version: 1,
      createdAt: NOW,
    },
  ]
}

let rows: Terminal[]
let patchStatus: number
let sent: { path: string; body: Record<string, unknown> }[]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function route(url: string, method: string, body: Record<string, unknown> | undefined): Response {
  const path = url.split('?')[0] ?? url
  if (path === '/api/staff/terminals' && method === 'GET') return json({ items: rows })
  if (path.startsWith('/api/staff/terminals/') && method === 'PATCH') {
    sent.push({ path, body: body ?? {} })
    if (patchStatus === 403) return json({ error: 'forbidden' }, 403)
    if (typeof body?.pin === 'string' && ['0000', '1234'].includes(body.pin)) {
      return json({ error: 'weak_pin' }, 400)
    }
    const terminalId = path.slice('/api/staff/terminals/'.length)
    rows = rows.map((row) =>
      row.id === terminalId
        ? {
            ...row,
            ...(typeof body?.kind === 'string' ? { kind: body.kind as Terminal['kind'] } : {}),
            ...(typeof body?.autoLockSeconds === 'number'
              ? { autoLockSeconds: body.autoLockSeconds }
              : {}),
            version: row.version + 1,
          }
        : row,
    )
    return json(rows.find((row) => row.id === terminalId))
  }
  if (path.endsWith('/staff') && method === 'GET') return json([])
  return json({ error: 'not_found' }, 404)
}

beforeEach(() => {
  rows = seed()
  patchStatus = 200
  sent = []
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

/** 器ごと開く。保存は器の「保存」だけが起こす。 */
async function open() {
  render(
    <SettingsScreen
      storeId={STORE_ID}
      now={NOW}
      initialSection="terminals"
      panels={{ terminals: TerminalSettings }}
    />,
  )
  await screen.findByText('銀座店 レジ横iPad')
}

async function edit(name: string) {
  const list = screen.getByRole('list', { name: '端末' })
  const row = within(list)
    .getAllByRole('listitem')
    .find((item) => item.textContent?.includes(name)) as HTMLElement
  await userEvent.click(within(row).getByRole('button', { name: `${name} を直す` }))
}

describe('設定 › 端末', () => {
  it('端末の一覧に名前・置き場所・使い方・自動で伏せるまでの時間が出る', async () => {
    await open()
    const list = screen.getByRole('list', { name: '端末' })
    const first = within(list).getAllByRole('listitem')[0] as HTMLElement
    const text = first.textContent ?? ''
    expect(text).toContain('銀座店 レジ横iPad')
    expect(text).toContain('レジの右側　固定スタンド')
    expect(text).toContain('みんなで使う端末')
    expect(text).toContain('120秒でふせる')
  })

  it('使い方を決め直すと、次に業務を始める画面が変わる', async () => {
    await open()
    await edit('銀座店 レジ横iPad')
    await userEvent.click(screen.getByRole('radio', { name: '個人の端末' }))
    expect(screen.getByText('次に業務を始めると、担当を選ぶ画面になります。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('保存しました')
    expect(sent[0]?.body).toMatchObject({ kind: 'personal', version: 3 })
    const list = screen.getByRole('list', { name: '端末' })
    const first = within(list).getAllByRole('listitem')[0] as HTMLElement
    expect(within(first).getByText('個人の端末')).toBeInTheDocument()
  })

  it('暗証番号を作り直せる（0000 と 1234 は「簡単すぎます」で拒む）', async () => {
    await open()
    await edit('銀座店 レジ横iPad')
    const field = screen.getByLabelText('新しい暗証番号（4〜6桁）')
    expect(field).toHaveAttribute('autocomplete', 'off')
    for (const weak of ['0000', '1234']) {
      await userEvent.clear(field)
      await userEvent.type(field, weak)
      await userEvent.click(screen.getByRole('button', { name: '保存' }))
      await screen.findByText('この暗証番号は簡単すぎます。同じ数字の並びと連番は使えません。')
    }
    await userEvent.clear(field)
    await userEvent.type(field, '2580')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('保存しました')
    expect(sent.at(-1)?.body).toMatchObject({ pin: '2580' })
  })

  it('自動で伏せるまでの時間は 30〜1800 秒の外を受け付けない', async () => {
    await open()
    await edit('銀座店 レジ横iPad')
    const field = screen.getByLabelText('自動で伏せるまで（秒）')
    await userEvent.clear(field)
    await userEvent.type(field, '10')
    expect(screen.getByText('30秒から1800秒までで決めてください。')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeDisabled())
    await userEvent.clear(field)
    await userEvent.type(field, '300')
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled())
  })

  it('スタッフの権限では保存できず、権限不足の面が出る', async () => {
    patchStatus = 403
    await open()
    await edit('銀座店 レジ横iPad')
    await userEvent.click(screen.getByRole('radio', { name: '個人の端末' }))
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('この操作は店長だけができます')
    expect(screen.getByText('使い方を「個人の端末」にする')).toBeInTheDocument()
  })
})
