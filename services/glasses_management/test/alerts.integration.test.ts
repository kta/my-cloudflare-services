import { SELF } from 'cloudflare:test'
import type { AlertEvaluationResult, AlertRecord, AlertSettings } from '@app/contracts'
import { describe, expect, it } from 'vitest'
import {
  auth,
  BASE,
  insertFailedRecording,
  insertPurpose,
  insertReservation,
  insertWalkin,
  required,
  seedStore,
  syncMembership,
  tokenFor,
  uuid,
} from './analytics.fixtures'

const OPERATOR_PERMISSIONS = ['store.read', 'reservation.read', 'reservation.write'] as const

/** A staff member who may read and act on the store's alert inbox. */
async function seedOperator() {
  const store = await seedStore()
  const userId = uuid()
  await syncMembership({
    organizationId: store.organizationId,
    storeId: store.storeId,
    userId,
    permissions: OPERATOR_PERMISSIONS,
  })
  return { ...store, token: await tokenFor(store.organizationId, 'staff', userId) }
}

async function evaluate(storeId: string, token: string): Promise<AlertEvaluationResult> {
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/alerts/evaluate`,
    auth(token, { method: 'POST' }),
  )
  expect(response.status).toBe(200)
  return (await response.json()) as AlertEvaluationResult
}

async function list(storeId: string, token: string, query = ''): Promise<AlertRecord[]> {
  const response = await SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/alerts${query}`,
    auth(token),
  )
  expect(response.status).toBe(200)
  return (await response.json()) as AlertRecord[]
}

async function saveSettings(
  organizationId: string,
  storeId: string,
  body: unknown,
): Promise<Response> {
  const adminToken = await tokenFor(organizationId, 'admin')
  return SELF.fetch(
    `${BASE}/api/staff/stores/${storeId}/alert-settings`,
    auth(adminToken, { method: 'PUT', body: JSON.stringify(body) }),
  )
}

describe('warning condition settings (UC-EYEX-179)', () => {
  it('offers every condition with a default before anything is configured', async () => {
    const store = await seedOperator()
    const adminToken = await tokenFor(store.organizationId, 'admin')
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${store.storeId}/alert-settings`,
      auth(adminToken),
    )
    expect(response.status).toBe(200)
    const settings = (await response.json()) as AlertSettings
    expect(settings.conditions.map((condition) => condition.code)).toEqual([
      'long_wait',
      'recording_save_failure',
      'settings_contradiction',
    ])
    expect(settings.notificationTargets).toEqual([])
  })

  it('stores the conditions and their notification targets', async () => {
    const store = await seedOperator()
    const response = await saveSettings(store.organizationId, store.storeId, {
      conditions: [
        { code: 'long_wait', enabled: true, thresholdMinutes: 20 },
        { code: 'recording_save_failure', enabled: false, thresholdMinutes: null },
        { code: 'settings_contradiction', enabled: true, thresholdMinutes: null },
      ],
      notificationTargets: ['manager@example.test'],
    })
    expect(response.status).toBe(200)
    const settings = (await response.json()) as AlertSettings
    expect(settings.notificationTargets).toEqual(['manager@example.test'])
    expect(settings.conditions.find((c) => c.code === 'long_wait')?.thresholdMinutes).toBe(20)
    expect(settings.updatedAt).toBe('2026-08-31T00:00:00.000Z')
  })

  it('rejects a threshold on a condition that has none', async () => {
    const store = await seedOperator()
    const response = await saveSettings(store.organizationId, store.storeId, {
      conditions: [{ code: 'settings_contradiction', enabled: true, thresholdMinutes: 30 }],
      notificationTargets: [],
    })
    expect(response.status).toBe(400)
  })
})

describe('raising alerts', () => {
  it('raises a wait alert past the configured threshold and none on it', async () => {
    const store = await seedOperator()
    await saveSettings(store.organizationId, store.storeId, {
      conditions: [
        { code: 'long_wait', enabled: true, thresholdMinutes: 15 },
        { code: 'recording_save_failure', enabled: false, thresholdMinutes: null },
        { code: 'settings_contradiction', enabled: false, thresholdMinutes: null },
      ],
      notificationTargets: [],
    })
    // Exactly 15 minutes of waiting is still within the promise.
    await insertReservation({
      organizationId: store.organizationId,
      storeId: store.storeId,
      startAt: '2026-08-31T00:00:00.000Z',
      progress: 'waiting',
      waitStartedAt: '2026-08-30T23:45:00.000Z',
    })
    const evaluated = await evaluate(store.storeId, store.token)
    expect(evaluated.raised).toBe(0)
    expect(evaluated.disabledCodes).toEqual(
      expect.arrayContaining(['recording_save_failure', 'settings_contradiction']),
    )

    await insertWalkin({
      organizationId: store.organizationId,
      storeId: store.storeId,
      arrivedAt: '2026-08-30T23:44:59.000Z',
      progress: 'waiting',
      status: 'waiting',
    })
    const second = await evaluate(store.storeId, store.token)
    expect(second.raised).toBe(1)
    expect(second.alerts[0]).toMatchObject({ code: 'long_wait', kind: 'alert' })
  })

  it('is idempotent — re-evaluating the same condition raises nothing new', async () => {
    const store = await seedOperator()
    await insertFailedRecording({
      organizationId: store.organizationId,
      storeId: store.storeId,
      updatedAt: '2026-08-30T23:00:00.000Z',
    })
    const first = await evaluate(store.storeId, store.token)
    expect(first.raised).toBe(1)
    const second = await evaluate(store.storeId, store.token)
    expect(second.raised).toBe(0)
    expect(await list(store.storeId, store.token)).toHaveLength(1)
  })

  it('raises nothing for a condition an administrator switched off', async () => {
    const store = await seedOperator()
    await saveSettings(store.organizationId, store.storeId, {
      conditions: [
        { code: 'long_wait', enabled: false, thresholdMinutes: 15 },
        { code: 'recording_save_failure', enabled: false, thresholdMinutes: null },
        { code: 'settings_contradiction', enabled: false, thresholdMinutes: null },
      ],
      notificationTargets: [],
    })
    await insertFailedRecording({
      organizationId: store.organizationId,
      storeId: store.storeId,
      updatedAt: '2026-08-30T23:00:00.000Z',
    })
    await insertPurpose({
      organizationId: store.organizationId,
      storeId: store.storeId,
      durationMinutes: 20,
      slotIntervalMinutes: 15,
    })
    const evaluated = await evaluate(store.storeId, store.token)
    expect(evaluated.raised).toBe(0)
    expect(evaluated.disabledCodes).toHaveLength(3)
  })

  it('raises a settings contradiction with its 対象 and 次の操作', async () => {
    const store = await seedOperator()
    await insertPurpose({
      organizationId: store.organizationId,
      storeId: store.storeId,
      staffName: 'レンズ相談',
      durationMinutes: 20,
      slotIntervalMinutes: 15,
    })
    const evaluated = await evaluate(store.storeId, store.token)
    expect(evaluated.raised).toBe(1)
    expect(evaluated.alerts[0]).toMatchObject({
      code: 'settings_contradiction',
      subjectType: 'visit_purpose',
    })
    expect(evaluated.alerts[0]?.subject).toContain('レンズ相談')
    expect(evaluated.alerts[0]?.nextAction.length).toBeGreaterThan(0)
  })
})

describe('the alert inbox (UC-EYEX-178, AC-EYEX-120)', () => {
  async function seedOneAlert() {
    const store = await seedOperator()
    await insertFailedRecording({
      organizationId: store.organizationId,
      storeId: store.storeId,
      updatedAt: '2026-08-30T23:00:00.000Z',
    })
    const evaluated = await evaluate(store.storeId, store.token)
    return { store, alert: required(evaluated.alerts[0], 'raised alert') }
  }

  it('shows 発生理由・対象・発生時刻・次の操作 in the detail', async () => {
    const { store, alert } = await seedOneAlert()
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${store.storeId}/alerts/${alert.id}`,
      auth(store.token),
    )
    expect(response.status).toBe(200)
    const detail = (await response.json()) as AlertRecord
    expect(detail.reason).toContain('upload_aborted')
    expect(detail.subject.length).toBeGreaterThan(0)
    expect(detail.occurredAt).toBe('2026-08-30T23:00:00.000Z')
    expect(detail.nextAction.length).toBeGreaterThan(0)
  })

  it('records 既読 and 対応済み separately', async () => {
    const { store, alert } = await seedOneAlert()
    const read = await SELF.fetch(
      `${BASE}/api/staff/stores/${store.storeId}/alerts/${alert.id}/read`,
      auth(store.token, { method: 'POST' }),
    )
    expect(read.status).toBe(200)
    const afterRead = (await read.json()) as AlertRecord
    expect(afterRead.readAt).toBe('2026-08-31T00:00:00.000Z')
    expect(afterRead.readBy).not.toBeNull()
    // Reading is not handling.
    expect(afterRead.resolvedAt).toBeNull()

    const resolved = await SELF.fetch(
      `${BASE}/api/staff/stores/${store.storeId}/alerts/${alert.id}/resolve`,
      auth(store.token, { method: 'POST', body: JSON.stringify({ note: '再取得を依頼した' }) }),
    )
    expect(resolved.status).toBe(200)
    const afterResolve = (await resolved.json()) as AlertRecord
    expect(afterResolve.resolvedAt).toBe('2026-08-31T00:00:00.000Z')
    expect(afterResolve.resolutionNote).toBe('再取得を依頼した')
    expect(afterResolve.readAt).toBe('2026-08-31T00:00:00.000Z')
  })

  it('can be resolved by someone who never marked it read', async () => {
    const { store, alert } = await seedOneAlert()
    const resolved = await SELF.fetch(
      `${BASE}/api/staff/stores/${store.storeId}/alerts/${alert.id}/resolve`,
      auth(store.token, { method: 'POST', body: JSON.stringify({ note: '対応済み' }) }),
    )
    expect(resolved.status).toBe(200)
    const record = (await resolved.json()) as AlertRecord
    expect(record.resolvedAt).not.toBeNull()
    expect(record.readAt).toBeNull()
  })

  it('keeps the first 既読 rather than overwriting it', async () => {
    const { store, alert } = await seedOneAlert()
    const url = `${BASE}/api/staff/stores/${store.storeId}/alerts/${alert.id}/read`
    const first = (await (
      await SELF.fetch(url, auth(store.token, { method: 'POST' }))
    ).json()) as AlertRecord
    const second = (await (
      await SELF.fetch(url, auth(store.token, { method: 'POST' }))
    ).json()) as AlertRecord
    expect(second.readAt).toBe(first.readAt)
    expect(second.readBy).toBe(first.readBy)
  })

  it('filters by unread and unresolved independently', async () => {
    const { store, alert } = await seedOneAlert()
    expect(await list(store.storeId, store.token, '?status=unread')).toHaveLength(1)
    await SELF.fetch(
      `${BASE}/api/staff/stores/${store.storeId}/alerts/${alert.id}/read`,
      auth(store.token, { method: 'POST' }),
    )
    expect(await list(store.storeId, store.token, '?status=unread')).toHaveLength(0)
    // Read but not handled: still in the unresolved queue.
    expect(await list(store.storeId, store.token, '?status=unresolved')).toHaveLength(1)
    await SELF.fetch(
      `${BASE}/api/staff/stores/${store.storeId}/alerts/${alert.id}/resolve`,
      auth(store.token, { method: 'POST', body: JSON.stringify({ note: '完了' }) }),
    )
    expect(await list(store.storeId, store.token, '?status=unresolved')).toHaveLength(0)
    expect(await list(store.storeId, store.token, '?status=all')).toHaveLength(1)
    expect(await list(store.storeId, store.token, '?kind=notice')).toHaveLength(0)
    expect(await list(store.storeId, store.token, '?kind=alert')).toHaveLength(1)
  })

  it('returns 404 for an alert id that belongs to nothing in this store', async () => {
    const store = await seedOperator()
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${store.storeId}/alerts/${uuid()}`,
      auth(store.token),
    )
    expect(response.status).toBe(404)
  })
})
