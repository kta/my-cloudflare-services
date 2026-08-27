# Reservation Concurrency Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同時リクエストでも予約・担当者・設備・顧客を矛盾なく確定し、競合と再送を安全に回復する。

**Architecture:** 候補計算は割当候補を返し、確定はslot interval単位のリソース占有行をD1一意制約で確保する。予約、顧客upsert、占有、availability投影、監査と冪等結果を一つのD1 batchに置く。

**Tech Stack:** Cloudflare D1、Drizzle、Hono、Zod、Vitest workers。

**Spec:** `docs/superpowers/specs/2026-08-26-glasses-management-design.md` の「2026-08-26 レビュー是正: 確定競合と回復境界」。

## Global Constraints

- 組織・店舗はJWTスコープだけを認可根拠にし、全業務行へ`organization_id`を保存する。
- FKは使わず、IDはアプリ生成UUID、複数書込みは`db.batch()`、API契約はZod単一ソースとする。
- 競合は409、認証不備は401、権限・他店は403、監査失敗は予約を成立させない。
- production behaviorは必ずRed→Greenで追加し、Worker coverage 80%以上を維持する。

---

### Task 1: 割当候補と占有スキーマ

**Files:**
- Modify: `packages/contracts/src/glasses_management.ts`
- Modify: `services/glasses_management/src/worker/domain/availability.ts`
- Modify: `services/glasses_management/src/worker/db/schema.ts`
- Create: `services/glasses_management/migrations/0006_*.sql`
- Test: `services/glasses_management/test/availability-engine.time.test.ts`

- [ ] **Step 1: 割当候補と不正intervalの失敗テストを書く**

```ts
expect(() => calculateAvailability(invalidIntervalInput, [purposeId])).toThrow(RangeError)
expect(calculateAvailability(allocatableInput, [purposeId]).slots[0]?.allocation)
  .toEqual({ staffId, equipmentIds: [equipmentId] })
```

- [ ] **Step 2: Redを確認する**

Run: `pnpm --filter @app/glasses_management exec vitest run test/availability-engine.time.test.ts`

Expected: `allocation`未定義または不正interval未拒否でFAIL。

- [ ] **Step 3: 候補の担当・設備割当とslot interval分割用スキーマを実装する**

```ts
export const ReservationResourceAllocation = sqliteTable('reservation_resource_allocations', {
  id: text('id').primaryKey(), organizationId: text('organization_id').notNull(),
  storeId: text('store_id').notNull(), reservationId: text('reservation_id').notNull(),
  resourceKind: text('resource_kind').notNull(), resourceId: text('resource_id').notNull(),
  slotStartAt: text('slot_start_at').notNull(),
})
```

- [ ] **Step 4: Greenとmigration生成を確認する**

Run: `pnpm --filter @app/glasses_management db:generate && pnpm --filter @app/glasses_management exec vitest run test/availability-engine.time.test.ts`

Expected: PASS。

### Task 2: 原子的な予約・顧客・資源確保

**Files:**
- Modify: `services/glasses_management/src/worker/index.ts`
- Modify: `services/glasses_management/src/worker/db/schema.ts`
- Create: `services/glasses_management/migrations/0007_*.sql`
- Test: `services/glasses_management/test/reservations.integration.test.ts`

- [ ] **Step 1: 同時確定・別店舗冪等・顧客upsertの失敗テストを書く**

```ts
const results = await Promise.all([create('first'), create('second')])
expect(results.filter((result) => result.status === 201)).toHaveLength(1)
expect(results.filter((result) => result.status === 409)).toHaveLength(1)
```

- [ ] **Step 2: Redを確認する**

Run: `pnpm --filter @app/glasses_management exec vitest run test/reservations.integration.test.ts`

Expected: 同一slotが2件201となりFAIL。

- [ ] **Step 3: batch内に予約、顧客upsert、資源占有、availability投影、監査を追加する**

```ts
await writeAuditBatch(db, { operations: [customerUpsert, reservationInsert, ...allocationInserts, bookingInsert], events })
```

- [ ] **Step 4: Greenを確認する**

Run: `pnpm --filter @app/glasses_management exec vitest run test/reservations.integration.test.ts`

Expected: 同時要求は1件だけ確定し、担当・設備の占有行と監査が残る。

### Task 3: 冪等失敗の再試行と境界テスト

**Files:**
- Modify: `services/glasses_management/src/worker/domain/idempotency.ts`
- Modify: `services/glasses_management/test/idempotency.test.ts`
- Modify: `services/glasses_management/test/reservations.integration.test.ts`

- [ ] **Step 1: 副作用前の409を同一キーで再試行できる失敗テストを書く**

```ts
await expect(createUnavailable('same-key')).resolves.toMatchObject({ status: 409 })
await expect(createAfterSlotReleased('same-key')).resolves.toMatchObject({ status: 201 })
```

- [ ] **Step 2: Redを確認する**

Run: `pnpm --filter @app/glasses_management exec vitest run test/idempotency.test.ts test/reservations.integration.test.ts`

Expected: `idempotency_in_progress`でFAIL。

- [ ] **Step 3: retryable business failureと結果不明claimを分離する**

```ts
export class RetryableIdempotencyError extends Error { readonly retryable = true }
```

- [ ] **Step 4: Greenを確認する**

Run: `pnpm --filter @app/glasses_management test`

Expected: PASS、coverage 80%以上。

### Task 4: 回帰レビューと権限／テナント境界

**Files:**
- Modify: `services/glasses_management/test/permissions.test.ts`
- Modify: `services/glasses_management/test/tenant-isolation.test.ts`
- Test: `services/glasses_management/test/{permissions,tenant-isolation,reservations.integration}.test.ts`

- [ ] **Step 1: 新routeの認可・他店舗・同一冪等キー別店舗テストを書く**

```ts
expect((await createAsOtherStore()).status).toBe(403)
expect((await createOnOtherStoreWithSameKey()).status).toBe(201)
```

- [ ] **Step 2: Redを確認する**

Run: `pnpm --filter @app/glasses_management exec vitest run test/permissions.test.ts test/tenant-isolation.test.ts`

Expected: 未追加のroute matrixでFAIL。

- [ ] **Step 3: store scopeを冪等scopeへ追加し、全routeの表に加える**

- [ ] **Step 4: 完全検証を実行する**

Run: `pnpm --filter @app/glasses_management test:all && pnpm --filter @app/glasses_management e2e`

Expected: API・web・E2EがPASS。traceability未完部分は本修正の完了条件に含めず、Phase 9で実施する。
