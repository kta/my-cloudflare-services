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

type Route = {
  name: string
  method: 'GET' | 'PUT' | 'POST' | 'PATCH'
  path: (ids: {
    storeId: string
    draftId: string
    publicationId: string
    versionId: string
  }) => string
  body?: (ids: { storeId: string; draftId: string }) => unknown
  required: 'settings.read' | 'settings.manage'
}

const routes: Route[] = [
  {
    name: 'read draft',
    method: 'GET',
    path: (ids) => `/api/staff/stores/${ids.storeId}/availability/draft`,
    required: 'settings.read',
  },
  {
    name: 'save draft',
    method: 'PUT',
    path: (ids) => `/api/staff/stores/${ids.storeId}/availability/draft`,
    body: () => ({ settings: settingsPayload() }),
    required: 'settings.manage',
  },
  {
    name: 'read impact',
    method: 'GET',
    path: (ids) => `/api/staff/stores/${ids.storeId}/availability/draft/impact`,
    required: 'settings.read',
  },
  {
    name: 'record conflict resolution',
    method: 'POST',
    path: (ids) => `/api/staff/stores/${ids.storeId}/availability/draft/conflicts/${uuid()}`,
    body: () => ({ resolution: 'customer_contacted' }),
    required: 'settings.manage',
  },
  {
    name: 'create publication',
    method: 'POST',
    path: (ids) => `/api/staff/stores/${ids.storeId}/availability/publications`,
    body: (ids) => ({
      draftId: ids.draftId,
      targetStoreIds: [ids.storeId],
      idempotencyKey: uuid(),
    }),
    required: 'settings.manage',
  },
  {
    name: 'read publication',
    method: 'GET',
    path: (ids) =>
      `/api/staff/stores/${ids.storeId}/availability/publications/${ids.publicationId}`,
    required: 'settings.read',
  },
  {
    name: 'reschedule publication',
    method: 'PATCH',
    path: (ids) =>
      `/api/staff/stores/${ids.storeId}/availability/publications/${ids.publicationId}`,
    body: () => ({ status: 'cancelled' }),
    required: 'settings.manage',
  },
  {
    name: 'run publication',
    method: 'POST',
    path: (ids) =>
      `/api/staff/stores/${ids.storeId}/availability/publications/${ids.publicationId}/run`,
    required: 'settings.manage',
  },
  {
    name: 'retry publication',
    method: 'POST',
    path: (ids) =>
      `/api/staff/stores/${ids.storeId}/availability/publications/${ids.publicationId}/retry`,
    required: 'settings.manage',
  },
  {
    name: 'list versions',
    method: 'GET',
    path: (ids) => `/api/staff/stores/${ids.storeId}/availability/versions`,
    required: 'settings.read',
  },
  {
    name: 'read version',
    method: 'GET',
    path: (ids) => `/api/staff/stores/${ids.storeId}/availability/versions/${ids.versionId}`,
    required: 'settings.read',
  },
  {
    name: 'restore version',
    method: 'POST',
    path: (ids) =>
      `/api/staff/stores/${ids.storeId}/availability/versions/${ids.versionId}/restore`,
    required: 'settings.manage',
  },
  {
    name: 'read chain default',
    method: 'GET',
    path: (ids) => `/api/staff/stores/${ids.storeId}/availability/chain-default`,
    required: 'settings.read',
  },
  {
    name: 'save chain default',
    method: 'PUT',
    path: (ids) => `/api/staff/stores/${ids.storeId}/availability/chain-default`,
    body: () => ({ settings: settingsPayload() }),
    required: 'settings.manage',
  },
  {
    name: 'read override',
    method: 'GET',
    path: (ids) => `/api/staff/stores/${ids.storeId}/availability/override`,
    required: 'settings.read',
  },
  {
    name: 'release override',
    method: 'POST',
    path: (ids) => `/api/staff/stores/${ids.storeId}/availability/override/release`,
    required: 'settings.manage',
  },
]

async function call(
  token: string,
  route: Route,
  ids: { storeId: string; draftId: string; publicationId: string; versionId: string },
) {
  const body = route.body?.(ids)
  return SELF.fetch(
    `${BASE}${route.path(ids)}`,
    auth(token, {
      method: route.method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}

const placeholders = { draftId: uuid(), publicationId: uuid(), versionId: uuid() }

describe('settings publication permissions (UC-EYEX-098)', () => {
  it.each(routes.map((route) => [route.name, route] as const))(
    'denies %s to a staff member with no settings permission',
    async (_name, route) => {
      const scope = await setupScope(['reservation.read'])
      const response = await call(scope.token, route, { storeId: scope.storeId, ...placeholders })
      expect(response.status).toBe(403)
      expect(await json<{ error: string }>(response)).toEqual({ error: 'forbidden' })
    },
  )

  it.each(
    routes.filter((route) => route.required === 'settings.manage').map((r) => [r.name, r] as const),
  )('denies %s to a reader who may not manage settings', async (_name, route) => {
    const scope = await setupScope(['settings.read'])
    const response = await call(scope.token, route, { storeId: scope.storeId, ...placeholders })
    expect(response.status).toBe(403)
  })

  it.each(
    routes.filter((route) => route.required === 'settings.read').map((r) => [r.name, r] as const),
  )('allows %s for a reader (never 403)', async (_name, route) => {
    const scope = await setupScope(['settings.read'])
    const response = await call(scope.token, route, { storeId: scope.storeId, ...placeholders })
    expect(response.status).not.toBe(403)
    expect([200, 404]).toContain(response.status)
  })

  it('denies every settings route to an unauthenticated caller', async () => {
    for (const route of routes) {
      const response = await SELF.fetch(
        `${BASE}${route.path({ storeId: uuid(), ...placeholders })}`,
        { method: route.method },
      )
      expect(response.status).toBe(401)
    }
  })

  it('lets a manager complete the draft and publish loop end to end', async () => {
    const scope = await setupScope(['settings.read', 'settings.manage'])
    const published = settingsPayload()
    await putSettings(scope, scope.storeId, published)
    const draft = await json<{ id: string }>(
      await saveDraft(scope, scope.storeId, {
        settings: { ...published, version: 1, receptionStatus: 'paused' },
      }),
    )
    const publication = await SELF.fetch(
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
    expect(publication.status).toBe(201)
  })
})
