import { env, SELF } from 'cloudflare:test'
import { signAccessToken } from '@app/shared'
import { describe, expect, it } from 'vitest'

const BASE = 'https://glasses-management.test'
const JSON_HEADERS = { 'content-type': 'application/json' }
const INTERNAL_HEADERS = { ...JSON_HEADERS, 'x-internal-key': 'dev-internal-key' }

function organizationPayload(
  id: string,
  revision: number,
  isDisabled: boolean,
  name = 'Revision test organization',
) {
  return {
    id,
    name,
    plan: 'free',
    isDisabled,
    createdAt: '2026-08-26T00:00:00.000Z',
    revision,
  }
}

async function syncOrganization(payload: ReturnType<typeof organizationPayload>) {
  return SELF.fetch(`${BASE}/api/internal/organizations/sync`, {
    method: 'POST',
    headers: INTERNAL_HEADERS,
    body: JSON.stringify(payload),
  })
}

describe('organization synchronization revisions', () => {
  it('ignores a stale disabled-to-enabled snapshot delivered after the newer revision', async () => {
    const organizationId = `org-sample-${crypto.randomUUID()}`
    const newerDelete = organizationPayload(organizationId, 2, true, 'Deleted snapshot')
    const olderPatch = organizationPayload(organizationId, 1, false, 'Stale patch')

    expect((await syncOrganization(newerDelete)).status).toBe(200)
    expect((await syncOrganization(olderPatch)).status).toBe(200)

    const row = await env.DB.prepare(
      'SELECT name, is_disabled, sync_revision FROM organizations WHERE id = ?',
    )
      .bind(organizationId)
      .first<{ name: string; is_disabled: string; sync_revision: number }>()
    expect(row).toEqual({ name: 'Deleted snapshot', is_disabled: '1', sync_revision: 2 })
  })

  it('keeps the highest revision when patch and delete snapshots race', async () => {
    const organizationId = `org-race-${crypto.randomUUID()}`
    const patch = organizationPayload(organizationId, 3, false, 'Concurrent patch')
    const deleted = organizationPayload(organizationId, 4, true, 'Concurrent delete')

    const responses = await Promise.all([syncOrganization(patch), syncOrganization(deleted)])
    expect(responses.map((response) => response.status)).toEqual([200, 200])

    // Deliver the lower revision again after the higher revision. This models
    // the service-binding order inversion between PATCH and DELETE.
    expect((await syncOrganization(patch)).status).toBe(200)
    const row = await env.DB.prepare(
      'SELECT name, is_disabled, sync_revision FROM organizations WHERE id = ?',
    )
      .bind(organizationId)
      .first<{ name: string; is_disabled: string; sync_revision: number }>()
    expect(row).toEqual({ name: 'Concurrent delete', is_disabled: '1', sync_revision: 4 })
  })

  it('rejects a different snapshot at the same revision without changing the canonical copy', async () => {
    const organizationId = `org-same-revision-${crypto.randomUUID()}`
    const canonical = organizationPayload(organizationId, 1, false, 'Canonical organization')
    const conflicting = {
      ...organizationPayload(organizationId, 1, true, 'Conflicting organization'),
      createdAt: '2026-08-27T00:00:00.000Z',
    }

    expect((await syncOrganization(canonical)).status).toBe(200)
    const response = await syncOrganization(conflicting)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'sync_revision_conflict' })
    const row = await env.DB.prepare(
      'SELECT name, is_disabled, created_at, sync_revision FROM organizations WHERE id = ?',
    )
      .bind(organizationId)
      .first<{ name: string; is_disabled: string; created_at: string; sync_revision: number }>()
    expect(row).toEqual({
      name: canonical.name,
      is_disabled: '0',
      created_at: canonical.createdAt,
      sync_revision: canonical.revision,
    })
  })

  it('persists and returns every canonical field from a newer snapshot', async () => {
    const organizationId = `org-newer-revision-${crypto.randomUUID()}`
    const first = organizationPayload(organizationId, 1, false, 'Original organization')
    const updated = {
      ...organizationPayload(organizationId, 2, true, 'Updated organization'),
      plan: 'contracted' as const,
      createdAt: '2026-08-27T00:00:00.000Z',
    }

    expect((await syncOrganization(first)).status).toBe(200)
    const response = await syncOrganization(updated)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(updated)
    const row = await env.DB.prepare(
      'SELECT name, plan, is_disabled, created_at, sync_revision FROM organizations WHERE id = ?',
    )
      .bind(organizationId)
      .first<{
        name: string
        plan: string
        is_disabled: string
        created_at: string
        sync_revision: number
      }>()
    expect(row).toEqual({
      name: updated.name,
      plan: updated.plan,
      is_disabled: '1',
      created_at: updated.createdAt,
      sync_revision: updated.revision,
    })
  })

  it('accepts seeded canonical organization ids that are not UUIDs', async () => {
    const response = await syncOrganization(organizationPayload('org-admin-seed', 1, false))
    expect(response.status).toBe(200)
    const row = await env.DB.prepare('SELECT id, sync_revision FROM organizations WHERE id = ?')
      .bind('org-admin-seed')
      .first<{ id: string; sync_revision: number }>()
    expect(row).toEqual({ id: 'org-admin-seed', sync_revision: 1 })

    const token = await signAccessToken(
      {
        sub: `seed-user-${crypto.randomUUID()}`,
        org: 'org-admin-seed',
        email: `${crypto.randomUUID()}@example.test`,
        role: 'staff',
      },
      'dev-jwt-secret-change-me',
    )
    const staff = await SELF.fetch(`${BASE}/api/staff/stores`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(staff.status).toBe(200)
    await expect(staff.json()).resolves.toEqual([])
  })
})
