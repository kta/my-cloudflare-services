import { env, SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  auth,
  json,
  putSettings,
  saveDraft,
  settingsPayload,
  setupScope,
  syncStore,
} from './settings-publication.fixtures'

const BASE = 'https://glasses-management.test'

const uuid = () => crypto.randomUUID()

describe('settings draft (UC-EYEX-095, AC-EYEX-45)', () => {
  it('saves a draft separately from the published settings and reports its save state', async () => {
    const scope = await setupScope()
    const published = settingsPayload()
    const stored = await putSettings(scope, scope.storeId, published)

    const draftResponse = await saveDraft(scope, scope.storeId, {
      settings: { ...published, version: stored.version, receptionStatus: 'paused' },
    })
    expect(draftResponse.status).toBe(201)
    const draft = await json<{
      id: string
      draftVersion: number
      baseVersion: number
      status: string
      savedAt: string
      settings: { receptionStatus: string; storeId: string }
    }>(draftResponse)
    expect(draft.status).toBe('draft')
    expect(draft.draftVersion).toBe(1)
    expect(draft.baseVersion).toBe(stored.version)
    expect(draft.savedAt).toBe('2026-08-31T00:00:00.000Z')
    expect(draft.settings.receptionStatus).toBe('paused')
    expect(draft.settings.storeId).toBe(scope.storeId)

    // The published settings are untouched while the draft is parked.
    const settingsResponse = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/settings`,
      auth(scope.token),
    )
    expect((await json<{ receptionStatus: string }>(settingsResponse)).receptionStatus).toBe('open')

    const reread = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/draft`,
      auth(scope.token),
    )
    expect(reread.status).toBe(200)
    expect((await json<{ id: string }>(reread)).id).toBe(draft.id)
  })

  it('bumps the draft version on every save and can park a draft for review', async () => {
    const scope = await setupScope()
    const published = settingsPayload()
    await putSettings(scope, scope.storeId, published)
    await saveDraft(scope, scope.storeId, { settings: { ...published, version: 1 } })
    const second = await saveDraft(scope, scope.storeId, {
      status: 'review',
      settings: { ...published, version: 1 },
    })
    const draft = await json<{ draftVersion: number; status: string }>(second)
    expect(draft.draftVersion).toBe(2)
    expect(draft.status).toBe('review')
  })

  it('returns 404 when no draft has been saved yet', async () => {
    const scope = await setupScope()
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/draft`,
      auth(scope.token),
    )
    expect(response.status).toBe(404)
  })

  it('rejects a draft whose base version is stale', async () => {
    const scope = await setupScope()
    const published = settingsPayload()
    await putSettings(scope, scope.storeId, published)
    const response = await saveDraft(scope, scope.storeId, {
      settings: { ...published, version: 0 },
    })
    expect(response.status).toBe(409)
    expect((await json<{ error: string }>(response)).error).toBe('version_conflict')
  })
})

describe('settings impact check (UC-EYEX-093, 097, 115, AC-EYEX-46, 66)', () => {
  async function bookedScope() {
    const scope = await setupScope()
    const published = settingsPayload()
    await putSettings(scope, scope.storeId, published)
    const reservation = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/reservations`,
      auth(scope.token, {
        method: 'POST',
        headers: { 'idempotency-key': uuid() },
        body: JSON.stringify({
          date: '2026-08-31',
          startTime: '11:00',
          purposeIds: [published.purposes[0]?.id],
          customer: { name: '予約 太郎', kana: 'ヨヤク タロウ', phone: '09000000001' },
          recital: '8月31日11時から視力測定です。',
        }),
      }),
    )
    expect(reservation.status).toBe(201)
    const created = await json<{ id: string }>(reservation)
    return { scope, published, reservationId: created.id }
  }

  it('reports conflicts, missing skills, missing equipment and the public slot change', async () => {
    const { scope, published, reservationId } = await bookedScope()
    await saveDraft(scope, scope.storeId, {
      settings: { ...published, version: 1, staff: [], shifts: [], equipment: [] },
    })
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/draft/impact`,
      auth(scope.token),
    )
    expect(response.status).toBe(200)
    const report = await json<{
      blockingCount: number
      canPublish: boolean
      ledgerEntriesAffected: number
      publicSlots: { publishedCount: number; draftCount: number }
      items: { kind: string; severity: string; reservationId: string | null }[]
    }>(response)
    const kinds = new Set(report.items.map((item) => item.kind))
    expect(kinds.has('missing_staff_skill')).toBe(true)
    expect(kinds.has('missing_equipment')).toBe(true)
    expect(kinds.has('web_slot_change')).toBe(true)
    expect(report.publicSlots.publishedCount).toBeGreaterThan(0)
    expect(report.publicSlots.draftCount).toBe(0)
    expect(report.ledgerEntriesAffected).toBe(1)
    expect(report.blockingCount).toBeGreaterThan(0)
    expect(report.canPublish).toBe(false)
    expect(report.items.some((item) => item.reservationId === reservationId)).toBe(true)
  })

  it('blocks publication while a blocking item remains and allows it once resolved (AC-EYEX-109)', async () => {
    const { scope, published, reservationId } = await bookedScope()
    const draft = await json<{ id: string }>(
      await saveDraft(scope, scope.storeId, {
        settings: { ...published, version: 1, purposes: [] },
      }),
    )

    const blocked = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/publications`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          draftId: draft.id,
          targetStoreIds: [scope.storeId],
          idempotencyKey: uuid(),
        }),
      }),
    )
    expect(blocked.status).toBe(409)
    expect((await json<{ error: string }>(blocked)).error).toBe('publication_blocked')

    const resolution = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/draft/conflicts/${reservationId}`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({ resolution: 'customer_contacted', note: '電話済み' }),
      }),
    )
    expect(resolution.status).toBe(201)
    expect((await json<{ resolution: string }>(resolution)).resolution).toBe('customer_contacted')

    const impact = await json<{ canPublish: boolean; items: { resolution: string | null }[] }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/availability/draft/impact`,
        auth(scope.token),
      ),
    )
    expect(impact.canPublish).toBe(true)
    expect(impact.items.some((item) => item.resolution === 'customer_contacted')).toBe(true)
  })
})

describe('settings publication (UC-EYEX-094, 161-164, AC-EYEX-105-108)', () => {
  async function draftedScope(options: { otherStoreActive?: boolean } = {}) {
    const scope = await setupScope(undefined, options)
    const published = settingsPayload()
    await putSettings(scope, scope.storeId, published)
    // Resource ids are keyed globally, so the second store starts from its own
    // configuration; the publication is what makes them share a value.
    if (options.otherStoreActive !== false) {
      await putSettings(scope, scope.otherStoreId, settingsPayload())
    }
    const draft = await json<{ id: string }>(
      await saveDraft(scope, scope.storeId, {
        settings: { ...published, version: 1, receptionStatus: 'paused' },
      }),
    )
    return { scope, published, draftId: draft.id }
  }

  it('publishes immediately and reports the version, targets, counts and effects', async () => {
    const { scope, draftId } = await draftedScope()
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/publications`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          draftId,
          targetStoreIds: [scope.storeId, scope.otherStoreId],
          idempotencyKey: uuid(),
        }),
      }),
    )
    expect(response.status).toBe(201)
    const publication = await json<{
      id: string
      versionId: string
      status: string
      appliedCount: number
      failedCount: number
      executedAt: string
      ledgerEntriesAffected: number
      webSlotEffect: { previousSlotCount: number; publishedSlotCount: number }
      targets: { storeId: string; status: string; appliedVersion: number | null }[]
    }>(response)
    expect(publication.status).toBe('completed')
    expect(publication.appliedCount).toBe(2)
    expect(publication.failedCount).toBe(0)
    expect(publication.executedAt).toBe('2026-08-31T00:00:00.000Z')
    expect(publication.targets.map((target) => target.storeId).sort()).toEqual(
      [scope.storeId, scope.otherStoreId].sort(),
    )
    expect(publication.targets.every((target) => target.appliedVersion === 2)).toBe(true)
    expect(publication.webSlotEffect.publishedSlotCount).toBe(0)

    const settings = await json<{ receptionStatus: string; version: number }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.otherStoreId}/availability/settings`,
        auth(scope.token),
      ),
    )
    expect(settings.receptionStatus).toBe('paused')
    expect(settings.version).toBe(2)

    const reread = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/publications/${publication.id}`,
      auth(scope.token),
    )
    expect((await json<{ versionId: string }>(reread)).versionId).toBe(publication.versionId)
  })

  it('replays the same publication for a repeated idempotency key', async () => {
    const { scope, draftId } = await draftedScope()
    const key = uuid()
    const body = JSON.stringify({ draftId, targetStoreIds: [scope.storeId], idempotencyKey: key })
    const first = await json<{ id: string; versionId: string }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/availability/publications`,
        auth(scope.token, { method: 'POST', body }),
      ),
    )
    const second = await json<{ id: string; versionId: string }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/availability/publications`,
        auth(scope.token, { method: 'POST', body }),
      ),
    )
    expect(second.id).toBe(first.id)
    expect(second.versionId).toBe(first.versionId)
    // The replay never applied a second version to the store.
    const settings = await json<{ version: number }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/availability/settings`,
        auth(scope.token),
      ),
    )
    expect(settings.version).toBe(2)
  })

  it('schedules a publication for a JST instant, revalidates it, reschedules and cancels it', async () => {
    const { scope, draftId } = await draftedScope()
    const created = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/publications`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          draftId,
          targetStoreIds: [scope.storeId],
          scheduledForJst: '2026-09-01T10:00',
          idempotencyKey: uuid(),
        }),
      }),
    )
    expect(created.status).toBe(201)
    const publication = await json<{
      id: string
      status: string
      scheduledForJst: string
      scheduledAt: string
      appliedCount: number
    }>(created)
    expect(publication.status).toBe('scheduled')
    expect(publication.scheduledForJst).toBe('2026-09-01T10:00')
    expect(publication.scheduledAt).toBe('2026-09-01T01:00:00.000Z')
    expect(publication.appliedCount).toBe(0)

    // Nothing is applied before the scheduled instant.
    const early = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/publications/${publication.id}/run`,
      auth(scope.token, { method: 'POST' }),
    )
    expect(early.status).toBe(409)
    expect((await json<{ error: string }>(early)).error).toBe('publication_not_due')

    const rescheduled = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/publications/${publication.id}`,
      auth(scope.token, {
        method: 'PATCH',
        body: JSON.stringify({ scheduledForJst: '2026-09-02T10:00' }),
      }),
    )
    expect((await json<{ scheduledForJst: string }>(rescheduled)).scheduledForJst).toBe(
      '2026-09-02T10:00',
    )

    const cancelled = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/publications/${publication.id}`,
      auth(scope.token, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }),
    )
    expect((await json<{ status: string }>(cancelled)).status).toBe('cancelled')

    const afterCancel = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/publications/${publication.id}/run`,
      auth(scope.token, { method: 'POST' }),
    )
    expect(afterCancel.status).toBe(409)
  })

  it('runs a publication scheduled for exactly the current JST instant', async () => {
    const { scope, draftId } = await draftedScope()
    // The pool pins the clock to 2026-08-31T00:00:00Z == 09:00 JST.
    const created = await json<{ id: string; status: string }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/availability/publications`,
        auth(scope.token, {
          method: 'POST',
          body: JSON.stringify({
            draftId,
            targetStoreIds: [scope.storeId],
            scheduledForJst: '2026-08-31T09:00',
            idempotencyKey: uuid(),
          }),
        }),
      ),
    )
    expect(created.status).toBe('scheduled')
    const run = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/publications/${created.id}/run`,
      auth(scope.token, { method: 'POST' }),
    )
    expect(run.status).toBe(200)
    const executed = await json<{ status: string; appliedCount: number; executedAt: string }>(run)
    expect(executed.status).toBe('completed')
    expect(executed.appliedCount).toBe(1)
    expect(executed.executedAt).toBe('2026-08-31T00:00:00.000Z')
  })

  it('retries only the failed stores and never applies the same version twice (AC-EYEX-107)', async () => {
    const { scope, draftId } = await draftedScope({ otherStoreActive: false })
    const publication = await json<{
      id: string
      status: string
      appliedCount: number
      failedCount: number
      targets: { storeId: string; status: string; appliedVersion: number | null }[]
    }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/availability/publications`,
        auth(scope.token, {
          method: 'POST',
          body: JSON.stringify({
            draftId,
            targetStoreIds: [scope.storeId, scope.otherStoreId],
            idempotencyKey: uuid(),
          }),
        }),
      ),
    )
    expect(publication.status).toBe('partially_failed')
    expect(publication.appliedCount).toBe(1)
    expect(publication.failedCount).toBe(1)
    const failed = publication.targets.find((target) => target.status === 'failed')
    expect(failed?.storeId).toBe(scope.otherStoreId)

    const retry = await json<{
      status: string
      appliedCount: number
      failedCount: number
      targets: { storeId: string; status: string; appliedVersion: number | null }[]
    }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/availability/publications/${publication.id}/retry`,
        auth(scope.token, { method: 'POST' }),
      ),
    )
    // The already-applied store is untouched: still version 2, not 3.
    expect(retry.targets.find((target) => target.storeId === scope.storeId)?.appliedVersion).toBe(2)
    expect(retry.appliedCount).toBe(1)
    expect(retry.failedCount).toBe(1)
    const settled = await json<{ version: number }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/availability/settings`,
        auth(scope.token),
      ),
    )
    expect(settled.version).toBe(2)

    // Once the store is usable again the retry applies only that store.
    await syncStore(scope.organizationId, scope.otherStoreId, true)
    const succeeded = await json<{ status: string; appliedCount: number; failedCount: number }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/availability/publications/${publication.id}/retry`,
        auth(scope.token, { method: 'POST' }),
      ),
    )
    expect(succeeded.status).toBe('completed')
    expect(succeeded.appliedCount).toBe(2)
    expect(succeeded.failedCount).toBe(0)
    const other = await json<{ version: number }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.otherStoreId}/availability/settings`,
        auth(scope.token),
      ),
    )
    // The recovered store had no configuration of its own, so the publication
    // is its first version — the already-applied store stays at 2.
    expect(other.version).toBe(1)
  })

  it('lists past versions with their diff and restores one as a new draft (AC-EYEX-108)', async () => {
    const { scope, draftId } = await draftedScope()
    await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/publications`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          draftId,
          targetStoreIds: [scope.storeId],
          idempotencyKey: uuid(),
        }),
      }),
    )
    const versions = await json<{ versionId: string; version: number; changedFields: string[] }[]>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/availability/versions`,
        auth(scope.token),
      ),
    )
    expect(versions.length).toBeGreaterThan(0)
    const latest = versions[0]!
    expect(latest.changedFields).toContain('receptionStatus')

    const detail = await json<{ diff: { field: string }[]; settings: { receptionStatus: string } }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/availability/versions/${latest.versionId}`,
        auth(scope.token),
      ),
    )
    expect(detail.diff.some((entry) => entry.field === 'receptionStatus')).toBe(true)
    expect(detail.settings.receptionStatus).toBe('paused')

    const restore = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/versions/${latest.versionId}/restore`,
      auth(scope.token, { method: 'POST' }),
    )
    expect(restore.status).toBe(201)
    const restored = await json<{ status: string; restoredFromVersionId: string }>(restore)
    // Restoring never republishes; it only produces a new draft.
    expect(restored.status).toBe('draft')
    expect(restored.restoredFromVersionId).toBe(latest.versionId)
  })
})

describe('chain default and store override (UC-EYEX-092, 160, AC-EYEX-48, 104)', () => {
  it('records a store override and releases it back to the chain-wide value', async () => {
    const scope = await setupScope()
    const chain = settingsPayload()
    const chainResponse = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/chain-default`,
      auth(scope.token, { method: 'PUT', body: JSON.stringify({ settings: chain }) }),
    )
    expect(chainResponse.status).toBe(201)
    expect((await json<{ version: number }>(chainResponse)).version).toBe(1)

    await putSettings(scope, scope.storeId, { ...chain, receptionStatus: 'paused' })
    const override = await json<{
      origin: string
      chainVersion: number
      overriddenFields: string[]
    }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/availability/override`,
        auth(scope.token),
      ),
    )
    expect(override.origin).toBe('store_override')
    expect(override.chainVersion).toBe(1)
    expect(override.overriddenFields).toContain('receptionStatus')

    const release = await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/override/release`,
      auth(scope.token, { method: 'POST' }),
    )
    expect(release.status).toBe(201)
    const released = await json<{
      chainVersion: number
      draft: { id: string; origin: string; settings: { receptionStatus: string } }
      impact: { canPublish: boolean }
    }>(release)
    expect(released.draft.origin).toBe('chain')
    expect(released.draft.settings.receptionStatus).toBe('open')
    expect(released.impact.canPublish).toBe(true)

    // The store still runs its override until the released draft is published.
    const before = await json<{ receptionStatus: string }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/availability/settings`,
        auth(scope.token),
      ),
    )
    expect(before.receptionStatus).toBe('paused')

    await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/publications`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          draftId: released.draft.id,
          targetStoreIds: [scope.storeId],
          idempotencyKey: uuid(),
        }),
      }),
    )
    const after = await json<{ origin: string; overriddenFields: string[] }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${scope.storeId}/availability/override`,
        auth(scope.token),
      ),
    )
    expect(after.origin).toBe('chain')
    expect(after.overriddenFields).toEqual([])
  })
})

describe('settings audit trail (UC-EYEX-096, AC-EYEX-103)', () => {
  it('appends who changed what, when, and the before/after for each settings action', async () => {
    const scope = await setupScope()
    const published = settingsPayload()
    await putSettings(scope, scope.storeId, published)
    const draft = await json<{ id: string }>(
      await saveDraft(scope, scope.storeId, {
        settings: { ...published, version: 1, receptionStatus: 'paused' },
      }),
    )
    await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/publications`,
      auth(scope.token, {
        method: 'POST',
        body: JSON.stringify({
          draftId: draft.id,
          targetStoreIds: [scope.storeId],
          idempotencyKey: uuid(),
        }),
      }),
    )
    const events = await env.DB.prepare(
      'select action, actor_id, occurred_at, metadata from audit_events where organization_id = ? and store_id = ? order by occurred_at',
    )
      .bind(scope.organizationId, scope.storeId)
      .all<{ action: string; actor_id: string; occurred_at: string; metadata: string }>()
    const actions = events.results.map((row) => row.action)
    expect(actions).toContain('settings.draft.saved')
    expect(actions).toContain('settings.published')
    const publish = events.results.find((row) => row.action === 'settings.published')!
    expect(publish.actor_id).toBe(scope.subjectId)
    expect(publish.occurred_at).toBe('2026-08-31T00:00:00.000Z')
    const metadata = JSON.parse(publish.metadata) as {
      fromVersion: number
      toVersion: number
      changedFields: string[]
    }
    expect(metadata.fromVersion).toBe(1)
    expect(metadata.toVersion).toBe(2)
    expect(metadata.changedFields).toContain('receptionStatus')
  })
})
