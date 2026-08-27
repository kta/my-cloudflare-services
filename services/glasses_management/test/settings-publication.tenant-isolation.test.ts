import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  auth,
  json,
  putSettings,
  saveDraft,
  settingsPayload,
  setupScope,
} from './settings-publication.fixtures'

const BASE = 'https://glasses-management.test'
const uuid = () => crypto.randomUUID()

async function publishedScope() {
  const scope = await setupScope()
  const published = settingsPayload()
  await putSettings(scope, scope.storeId, published)
  const draft = await json<{ id: string }>(
    await saveDraft(scope, scope.storeId, {
      settings: { ...published, version: 1, receptionStatus: 'paused' },
    }),
  )
  const publication = await json<{ id: string }>(
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
    ),
  )
  const versions = await json<{ versionId: string }[]>(
    await SELF.fetch(
      `${BASE}/api/staff/stores/${scope.storeId}/availability/versions`,
      auth(scope.token),
    ),
  )
  return {
    scope,
    draftId: draft.id,
    publicationId: publication.id,
    versionId: versions[0]?.versionId,
  }
}

describe('settings publication tenant isolation', () => {
  it('never exposes or mutates another organization settings state', async () => {
    const owner = await publishedScope()
    const intruder = await setupScope()

    const paths = [
      `/api/staff/stores/${owner.scope.storeId}/availability/draft`,
      `/api/staff/stores/${owner.scope.storeId}/availability/draft/impact`,
      `/api/staff/stores/${owner.scope.storeId}/availability/publications/${owner.publicationId}`,
      `/api/staff/stores/${owner.scope.storeId}/availability/versions`,
      `/api/staff/stores/${owner.scope.storeId}/availability/versions/${owner.versionId}`,
      `/api/staff/stores/${owner.scope.storeId}/availability/override`,
    ]
    for (const path of paths) {
      const response = await SELF.fetch(`${BASE}${path}`, auth(intruder.token))
      // A foreign store is indistinguishable from a missing one.
      expect(response.status).toBe(403)
    }

    const write = await SELF.fetch(
      `${BASE}/api/staff/stores/${owner.scope.storeId}/availability/draft`,
      auth(intruder.token, {
        method: 'PUT',
        body: JSON.stringify({ settings: settingsPayload() }),
      }),
    )
    expect(write.status).toBe(403)

    // The owner's draft and published settings are unchanged.
    const draft = await json<{ id: string; settings: { receptionStatus: string } }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${owner.scope.storeId}/availability/draft`,
        auth(owner.scope.token),
      ),
    )
    expect(draft.id).toBe(owner.draftId)
    expect(draft.settings.receptionStatus).toBe('paused')
  })

  it('refuses to publish into another organization store', async () => {
    const owner = await publishedScope()
    const intruder = await setupScope()
    const payload = settingsPayload()
    await putSettings(intruder, intruder.storeId, payload)
    const intruderDraft = await json<{ id: string }>(
      await saveDraft(intruder, intruder.storeId, {
        settings: { ...payload, version: 1, receptionStatus: 'paused' },
      }),
    )
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${intruder.storeId}/availability/publications`,
      auth(intruder.token, {
        method: 'POST',
        body: JSON.stringify({
          draftId: intruderDraft.id,
          // A foreign store id supplied as input never widens the tenant scope.
          targetStoreIds: [intruder.storeId, owner.scope.storeId],
          idempotencyKey: uuid(),
        }),
      }),
    )
    expect(response.status).toBe(201)
    const publication = await json<{
      status: string
      failedCount: number
      targets: { storeId: string; status: string }[]
    }>(response)
    expect(publication.status).toBe('partially_failed')
    expect(publication.failedCount).toBe(1)
    expect(
      publication.targets.find((target) => target.storeId === owner.scope.storeId)?.status,
    ).toBe('failed')

    const untouched = await json<{ receptionStatus: string; version: number }>(
      await SELF.fetch(
        `${BASE}/api/staff/stores/${owner.scope.storeId}/availability/settings`,
        auth(owner.scope.token),
      ),
    )
    expect(untouched.version).toBe(2)
    expect(untouched.receptionStatus).toBe('paused')
  })

  it('keeps the chain default scoped to its own organization', async () => {
    const first = await setupScope()
    const second = await setupScope()
    const response = await SELF.fetch(
      `${BASE}/api/staff/stores/${first.storeId}/availability/chain-default`,
      auth(first.token, { method: 'PUT', body: JSON.stringify({ settings: settingsPayload() }) }),
    )
    expect(response.status).toBe(201)
    const foreign = await SELF.fetch(
      `${BASE}/api/staff/stores/${second.storeId}/availability/chain-default`,
      auth(second.token),
    )
    expect(foreign.status).toBe(404)
  })
})
