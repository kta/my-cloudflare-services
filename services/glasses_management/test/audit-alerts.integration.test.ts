import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { purgeAuditAndSessions } from '../src/worker/index'
import { authed, BASE, FIXED_NOW, INTERNAL_HEADERS, insertStore, orgId, tokenFor } from './helpers'

async function scopedTenant(permissions: string[] = ['audit.read']) {
  const org = orgId()
  const token = await tokenFor(org)
  const storeId = await insertStore(org)
  await SELF.fetch(`${BASE}/api/internal/store-memberships/sync`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify({
      id: crypto.randomUUID(),
      organizationId: org,
      storeId,
      userId: `dev:${org}`,
      permissions,
      createdAt: FIXED_NOW,
    }),
  })
  return { org, token, storeId }
}

async function insertAudit(
  tenant: { org: string; storeId: string },
  input: { at?: string; action?: string; targetId?: string } = {},
) {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO audit_events (id, organization_id, store_id, actor_type, actor_id, terminal_id, action, target_type, target_id, before_json, after_json, correlation_id, occurred_at) VALUES (?,?,?,'staff','staff-1',NULL,?,'reservations',?,'{\"startsAt\":\"11:30\"}','{\"startsAt\":\"11:00\"}',?,?)",
  )
    .bind(
      id,
      tenant.org,
      tenant.storeId,
      input.action ?? 'reservation.rescheduled',
      input.targetId ?? crypto.randomUUID(),
      crypto.randomUUID(),
      input.at ?? FIXED_NOW,
    )
    .run()
  return id
}

async function insertAlert(
  tenant: { org: string; storeId: string },
  input: {
    severity: 'action' | 'info'
    audience?: 'store' | 'ops'
    resolvedAt?: string | null
    readAt?: string | null
  },
) {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO alerts (id, organization_id, store_id, code, severity, audience, title, body, target_type, target_id, occurred_at, read_at, resolved_at, resolved_by, created_at) VALUES (?,?,?,'recording.upload_failed',?,?,?,'詳しい内容','recording',?,?,?, ?,NULL,?)",
  )
    .bind(
      id,
      tenant.org,
      tenant.storeId,
      input.severity,
      input.audience ?? 'store',
      input.severity === 'action' ? '録音の保存に3回失敗しました' : 'お知らせ',
      crypto.randomUUID(),
      FIXED_NOW,
      input.readAt ?? null,
      input.resolvedAt ?? null,
      FIXED_NOW,
    )
    .run()
  return id
}

describe('監査の閲覧', () => {
  it('許可された店舗だけを新しい順に返し、変更前後を構造化して読む', async () => {
    const tenant = await scopedTenant()
    await insertAudit(tenant, { at: '2026-08-27T01:00:00.000Z' })
    const newest = await insertAudit(tenant, { at: FIXED_NOW })
    const hiddenStoreId = await insertStore(tenant.org, '担当外店')
    await insertAudit({ org: tenant.org, storeId: hiddenStoreId })

    const response = await SELF.fetch(`${BASE}/api/staff/audit?from=2026-08-27&to=2026-08-27`, {
      headers: authed(tenant.token),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      items: { id: string; targetType: string; beforeJson: unknown; afterJson: unknown }[]
      total: number
    }
    expect(body.total).toBe(2)
    expect(body.items[0]).toMatchObject({
      id: newest,
      targetType: 'reservations',
      beforeJson: { startsAt: '11:30' },
      afterJson: { startsAt: '11:00' },
    })
  })

  it('別テナントの店舗を指定しても存在を漏らさない', async () => {
    const viewer = await scopedTenant()
    const owner = await scopedTenant()
    const response = await SELF.fetch(`${BASE}/api/staff/audit?storeId=${owner.storeId}`, {
      headers: authed(viewer.token),
    })
    expect(response.status).toBe(404)
  })

  it('400日ちょうどは残し、400日を1ms過ぎた監査だけ日次保守で消す', async () => {
    const tenant = await scopedTenant()
    const now = new Date(FIXED_NOW)
    const boundary = new Date(now.getTime() - 400 * 24 * 60 * 60 * 1000)
    const keepId = await insertAudit(tenant, { at: boundary.toISOString() })
    const removeId = await insertAudit(tenant, {
      at: new Date(boundary.getTime() - 1).toISOString(),
    })
    await purgeAuditAndSessions(env.DB, now)
    const rows = await env.DB.prepare(
      'SELECT id FROM audit_events WHERE organization_id = ? AND id IN (?, ?) ORDER BY id',
    )
      .bind(tenant.org, keepId, removeId)
      .all<{ id: string }>()
    expect(rows.results.map((row) => row.id)).toEqual([keepId])
  })
})

describe('お知らせ', () => {
  it('対応が必要・お知らせ・本日対応済みの件数を分け、まとめて既読にする', async () => {
    const tenant = await scopedTenant([])
    await insertAlert(tenant, { severity: 'action' })
    await insertAlert(tenant, { severity: 'info' })
    await insertAlert(tenant, { severity: 'info', resolvedAt: FIXED_NOW, readAt: FIXED_NOW })
    const opsId = await insertAlert(tenant, { severity: 'action', audience: 'ops' })

    const listed = await SELF.fetch(`${BASE}/api/staff/alerts?storeId=${tenant.storeId}&kind=all`, {
      headers: authed(tenant.token),
    })
    expect(listed.status).toBe(200)
    const body = (await listed.json()) as { items: unknown[]; counts: Record<string, number> }
    expect(body.items).toHaveLength(2)
    expect(body.counts).toEqual({ all: 2, action: 1, info: 1, resolved: 1 })

    const readAll = await SELF.fetch(`${BASE}/api/staff/alerts/read-all`, {
      method: 'POST',
      headers: authed(tenant.token),
      body: JSON.stringify({ storeId: tenant.storeId }),
    })
    expect(readAll.status).toBe(200)
    expect(await readAll.json()).toEqual({ updated: 2 })
    const ops = await env.DB.prepare(
      'SELECT read_at AS readAt FROM alerts WHERE organization_id = ? AND id = ?',
    )
      .bind(tenant.org, opsId)
      .first<{ readAt: string | null }>()
    expect(ops?.readAt).toBeNull()
  })

  it('public PATCHは既読だけを更新し、任意の対応済み化を拒む', async () => {
    const tenant = await scopedTenant([])
    const alertId = await insertAlert(tenant, { severity: 'action' })
    const response = await SELF.fetch(`${BASE}/api/staff/alerts/${alertId}`, {
      method: 'PATCH',
      headers: authed(tenant.token),
      body: JSON.stringify({ readAt: FIXED_NOW, resolved: true }),
    })
    expect(response.status).toBe(400)
    const row = await env.DB.prepare(
      'SELECT read_at AS readAt, resolved_at AS resolvedAt FROM alerts WHERE organization_id = ? AND id = ?',
    )
      .bind(tenant.org, alertId)
      .first<{ readAt: string | null; resolvedAt: string | null }>()
    expect(row).toEqual({ readAt: null, resolvedAt: null })

    const read = await SELF.fetch(`${BASE}/api/staff/alerts/${alertId}`, {
      method: 'PATCH',
      headers: authed(tenant.token),
      body: JSON.stringify({ readAt: FIXED_NOW }),
    })
    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({ id: alertId, readAt: FIXED_NOW, resolvedAt: null })

    const listed = await SELF.fetch(
      `${BASE}/api/staff/alerts?storeId=${tenant.storeId}&kind=action`,
      { headers: authed(tenant.token) },
    )
    expect((await listed.json()) as { total: number }).toMatchObject({ total: 1 })
  })

  it('ops alertはstore JWTの一覧・PATCHのどちらからも見えず変更できない', async () => {
    const tenant = await scopedTenant([])
    const opsId = await insertAlert(tenant, { severity: 'action', audience: 'ops' })
    const list = await SELF.fetch(`${BASE}/api/staff/alerts?storeId=${tenant.storeId}`, {
      headers: authed(tenant.token),
    })
    expect(list.status).toBe(200)
    expect((await list.json()) as { total: number }).toMatchObject({ total: 0 })

    const patch = await SELF.fetch(`${BASE}/api/staff/alerts/${opsId}`, {
      method: 'PATCH',
      headers: authed(tenant.token),
      body: JSON.stringify({ readAt: FIXED_NOW }),
    })
    expect(patch.status).toBe(404)
    const row = await env.DB.prepare(
      'SELECT read_at AS readAt FROM alerts WHERE organization_id = ? AND id = ?',
    )
      .bind(tenant.org, opsId)
      .first<{ readAt: string | null }>()
    expect(row?.readAt).toBeNull()
  })
})
