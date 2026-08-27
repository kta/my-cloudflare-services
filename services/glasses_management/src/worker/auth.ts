import {
  Actor,
  Store,
  StorePermission,
  type StorePermission as StorePermissionValue,
} from '@app/contracts'
import type { AuthVariables } from '@app/shared'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import type { Context } from 'hono'
import { storeMemberships, stores } from './db/schema'
import type { Bindings } from './index'

/** The minimum Hono context needed by store authorization helpers. */
export type StoreContext = Context<{
  Bindings: Bindings
  Variables: AuthVariables & {
    /** Set only after a shared-terminal bearer has been revalidated. */
    sharedTerminal?: { id: string; organizationId: string; storeId: string }
  }
}>

export type AuthorizedStore = {
  store: Store
  actor: Actor
}

const allPermissions = [...StorePermission.options]

function parsePermissions(serialized: string): StorePermissionValue[] {
  try {
    const parsed = StorePermission.array().safeParse(JSON.parse(serialized))
    return parsed.success ? parsed.data : []
  } catch {
    // A corrupt or hand-edited membership must fail closed, not grant access.
    return []
  }
}

function toStore(row: typeof stores.$inferSelect): Store {
  return Store.parse({
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    isActive: row.isActive === '1',
    createdAt: row.createdAt,
  })
}

function hasPermission(
  permissions: readonly StorePermissionValue[],
  required: StorePermissionValue,
): boolean {
  if (permissions.includes(required)) return true
  // A manage permission is also an explicit read grant for the same resource.
  const [resource, action] = required.split('.')
  return action === 'read' && permissions.includes(`${resource}.manage` as StorePermissionValue)
}

async function findStore(c: StoreContext, storeId: string): Promise<Store | null> {
  const organizationId = c.get('auth')?.org
  if (!organizationId) return null
  const db = drizzle(c.env.DB)
  const rows = await db
    .select()
    .from(stores)
    .where(and(eq(stores.id, storeId), eq(stores.organizationId, organizationId)))
  const row = rows[0]
  if (row === undefined) return null
  if (row.isActive !== '1') return null
  return toStore(row)
}

async function resolveStoreAccess(
  c: StoreContext,
  storeId: string,
  required: StorePermissionValue,
): Promise<AuthorizedStore | null> {
  const auth = c.get('auth')
  if (!auth) return null
  const store = await findStore(c, storeId)
  if (!store) return null

  const sharedTerminal = c.get('sharedTerminal')
  if (sharedTerminal) {
    // Shared iPads can perform only the reception-day operations. Their
    // selected store is a hard server-side boundary, never client state.
    const allowed: StorePermissionValue[] = [
      'reservation.read',
      'reservation.write',
      'customer.read',
      'customer.write',
    ]
    if (
      sharedTerminal.organizationId !== auth.org ||
      sharedTerminal.storeId !== storeId ||
      !allowed.includes(required)
    )
      return null
    return {
      store,
      actor: Actor.parse({
        subjectId: sharedTerminal.id,
        organizationId: sharedTerminal.organizationId,
        role: 'staff',
        permissions: allowed,
      }),
    }
  }

  // Tenant admins are still tenant-scoped by the JWT organization. They can
  // manage every active store in that organization, but never another org.
  if (auth.role === 'admin') {
    return {
      store,
      actor: Actor.parse({
        subjectId: auth.sub,
        organizationId: auth.org,
        role: auth.role,
        permissions: allPermissions,
      }),
    }
  }

  const db = drizzle(c.env.DB)
  const memberships = await db
    .select()
    .from(storeMemberships)
    .where(
      and(
        eq(storeMemberships.organizationId, auth.org),
        eq(storeMemberships.storeId, storeId),
        eq(storeMemberships.userId, auth.sub),
      ),
    )
  const permissions = memberships.flatMap((membership) => parsePermissions(membership.permissions))
  if (!hasPermission(permissions, required)) return null

  return {
    store,
    actor: Actor.parse({
      subjectId: auth.sub,
      organizationId: auth.org,
      role: auth.role,
      permissions: [...new Set(permissions)],
    }),
  }
}

/**
 * Require one permission for one store. The store id is always constrained by
 * the JWT organization; request bodies never participate in this decision.
 * A missing store and a forbidden store intentionally share 403 so the caller
 * cannot probe another tenant's store ids.
 */
export async function requireStorePermission(
  c: StoreContext,
  storeId: string,
  permission: StorePermissionValue = 'store.read',
): Promise<Response | null> {
  if (!c.get('auth')) return c.json({ error: 'unauthorized' }, 401)
  const access = await resolveStoreAccess(c, storeId, permission)
  if (!access) return c.json({ error: 'forbidden' }, 403)
  return null
}

/** Resolve the stores visible to the current actor, always within JWT org. */
export async function listAccessibleStores(c: StoreContext): Promise<Store[]> {
  const auth = c.get('auth')
  if (!auth) return []
  const db = drizzle(c.env.DB)
  const rows = await db
    .select()
    .from(stores)
    .where(and(eq(stores.organizationId, auth.org), eq(stores.isActive, '1')))
  if (auth.role === 'admin') return rows.map(toStore)

  const memberships = await db
    .select()
    .from(storeMemberships)
    .where(
      and(eq(storeMemberships.organizationId, auth.org), eq(storeMemberships.userId, auth.sub)),
    )
  const readableStoreIds = new Set(
    memberships
      .filter((membership) => hasPermission(parsePermissions(membership.permissions), 'store.read'))
      .map((membership) => membership.storeId),
  )
  return rows.filter((row) => readableStoreIds.has(row.id)).map(toStore)
}

/** Resolve a store after authorization for handlers that need its data. */
export async function authorizedStore(
  c: StoreContext,
  storeId: string,
  permission: StorePermissionValue = 'store.read',
): Promise<AuthorizedStore | null> {
  return resolveStoreAccess(c, storeId, permission)
}
