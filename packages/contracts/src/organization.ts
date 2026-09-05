import { z } from 'zod'
import { Plan } from './auth'

/**
 * `organization` は admin ドメインが源泉(source of truth)で、他ドメインの
 * D1 へ同期コピーされる(cross-D1 JOIN 禁止 — アプリ層で突合)。
 *
 * クライアント向け作成リクエストは他の request schema と同じく `.strict()`。
 * passthrough だと未知キー(`isOperator` 等)が typed で素通りし、ハンドラが
 * `...input` を書いた瞬間に mass assignment になる。
 */
export const CreateOrganization = z.strictObject({
  name: z.string().trim().min(1).max(200),
})
export type CreateOrganization = z.infer<typeof CreateOrganization>

// 同期 upsert 契約(admin → 各ドメイン)。こちらは意図して `.passthrough()`:
// 後からフィールドを足しても受け側が未知フィールドを落とさず自動追随する。
// 呼び出し側は service binding + x-internal-key の内部限定なので strict 不要。
export const Organization = z.looseObject({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  plan: Plan.default('free'),
  isDisabled: z.boolean().default(false),
  createdAt: z.string().datetime(),
})
export type Organization = z.infer<typeof Organization>

/** Canonical write succeeded but its domain snapshot needs an explicit retry. */
export const OrganizationSyncFailed = z.strictObject({
  error: z.literal('organization_sync_failed'),
  organizationId: z.string().min(1),
  retryable: z.boolean(),
})
export type OrganizationSyncFailed = z.infer<typeof OrganizationSyncFailed>
