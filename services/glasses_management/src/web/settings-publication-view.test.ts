import type {
  SettingsDraft,
  SettingsImpactReport,
  SettingsPublication,
  SettingsVersionDetail,
} from '@app/contracts'
import { expect, test } from 'vitest'
import {
  diffRows,
  draftSaveState,
  IMPACT_KIND_LABEL,
  IMPACT_SEVERITY_LABEL,
  impactSummary,
  ORIGIN_LABEL,
  overrideReleaseNotice,
  publicationView,
  RESOLUTION_LABEL,
  scheduleError,
  settingsStateLabel,
  settingsWarnings,
  versionConflictNotice,
} from './settings-publication-view'

const STORE = '00000000-0000-4000-8000-000000000010'
const DRAFT = '00000000-0000-4000-8000-000000000020'
const RES_A = '00000000-0000-4000-8000-000000000031'
const RES_B = '00000000-0000-4000-8000-000000000032'

const settings: SettingsDraft['settings'] = {
  storeId: STORE,
  version: 3,
  receptionStatus: 'open',
  desiredTimeCandidateCount: 6,
  businessHours: [],
  exceptions: [],
  purposes: [],
  staff: [],
  shifts: [],
  equipment: [],
  maintenance: [],
}

function draft(overrides: Partial<SettingsDraft> = {}): SettingsDraft {
  return {
    id: DRAFT,
    storeId: STORE,
    draftVersion: 4,
    baseVersion: 3,
    status: 'draft',
    origin: 'store_override',
    restoredFromVersionId: null,
    savedAt: '2026-08-26T09:05:00.000Z',
    savedBy: '山田',
    settings,
    ...overrides,
  }
}

function report(overrides: Partial<SettingsImpactReport> = {}): SettingsImpactReport {
  return {
    draftId: DRAFT,
    storeId: STORE,
    evaluatedAt: '2026-08-26T09:06:00.000Z',
    blockingCount: 2,
    warningCount: 1,
    canPublish: false,
    ledgerEntriesAffected: 18,
    publicSlots: { date: '2026-08-27', publishedCount: 42, draftCount: 38 },
    items: [
      {
        kind: 'missing_staff_skill',
        severity: 'warning',
        reservationId: null,
        message: '眼鏡作製技能を持つスタッフがいません',
        resolution: null,
      },
      {
        kind: 'reservation_conflict',
        severity: 'blocking',
        reservationId: RES_A,
        message: '8/28 10:00 の予約が営業時間外になります',
        resolution: null,
      },
      {
        kind: 'reservation_conflict',
        severity: 'blocking',
        reservationId: RES_B,
        message: '8/29 15:00 の予約の設備が停止します',
        resolution: null,
      },
      {
        kind: 'web_slot_change',
        severity: 'info',
        reservationId: null,
        message: '公開枠が4件減ります',
        resolution: null,
      },
    ],
    ...overrides,
  }
}

function publication(overrides: Partial<SettingsPublication> = {}): SettingsPublication {
  return {
    id: '00000000-0000-4000-8000-000000000040',
    versionId: '00000000-0000-4000-8000-000000000041',
    draftId: DRAFT,
    status: 'partially_failed',
    scheduledForJst: null,
    scheduledAt: null,
    executedAt: '2026-08-26T09:00:00.000Z',
    appliedCount: 12,
    failedCount: 1,
    ledgerEntriesAffected: 13,
    webSlotEffect: { date: '2026-08-27', previousSlotCount: 428, publishedSlotCount: 402 },
    targets: [
      {
        storeId: STORE,
        status: 'applied',
        appliedVersion: 4,
        failureReason: null,
        appliedAt: '2026-08-26T09:00:00.000Z',
      },
      {
        storeId: '00000000-0000-4000-8000-000000000011',
        status: 'failed',
        appliedVersion: null,
        failureReason: '視力測定機が停止中',
        appliedAt: null,
      },
      {
        storeId: '00000000-0000-4000-8000-000000000012',
        status: 'pending',
        appliedVersion: null,
        failureReason: null,
        appliedAt: null,
      },
    ],
    ...overrides,
  }
}

/* ---------------- 状態と警告 (UC-EYEX-159) ---------------- */

test('the five formal settings states are named, and cancellation is not one of them', () => {
  expect(settingsStateLabel(draft({ status: 'draft' }))).toBe('下書き')
  expect(settingsStateLabel(draft({ status: 'review' }))).toBe('確認待ち')
  expect(settingsStateLabel(draft({ status: 'scheduled' }))).toBe('公開予約')
  expect(settingsStateLabel(draft({ status: 'published' }))).toBe('公開中')
  expect(settingsStateLabel(draft({ status: 'cancelled' }))).toBe('取消')
})

test('受付停止 is the published operating state, never a draft state', () => {
  const paused = { ...settings, receptionStatus: 'paused' as const }
  expect(settingsStateLabel(draft({ status: 'published', settings: paused }))).toBe('受付停止')
  // 下書き中に受付停止を選んでも、まだ公開されていないので状態は下書きのまま。
  expect(settingsStateLabel(draft({ status: 'draft', settings: paused }))).toBe('下書き')
})

test('conflicts and failures are warnings kept apart from the state', () => {
  const warnings = settingsWarnings({ impact: report(), publication: publication() })
  expect(warnings.map((warning) => warning.label)).toEqual([
    '影響予約2件が未解消です',
    '警告1件',
    '1店舗で公開が失敗しました',
  ])
  // 警告は肯定的な色調を取らない（型の上でも success は選べない）。
  expect(warnings.map((warning) => warning.tone)).toEqual(['danger', 'warning', 'danger'])
})

test('no warnings when nothing conflicts and nothing failed', () => {
  const clean = report({ blockingCount: 0, warningCount: 0, canPublish: true, items: [] })
  expect(settingsWarnings({ impact: clean, publication: undefined })).toEqual([])
})

/* ---------------- 下書きの保存状態 (UC-EYEX-095, AC-EYEX-45) ---------------- */

test('a saved draft reports its save state, last-saved JST instant and author', () => {
  const state = draftSaveState({ draft: draft(), dirty: false })
  expect(state.label).toBe('保存済み')
  expect(state.savedAtLabel).toBe('最終保存 2026年8月26日 18:05')
  expect(state.savedByLabel).toBe('変更者 山田')
  expect(state.dirty).toBe(false)
})

test('an edited draft is 未保存 and still shows the last successful save', () => {
  const state = draftSaveState({ draft: draft(), dirty: true })
  expect(state.label).toBe('未保存')
  expect(state.savedAtLabel).toBe('最終保存 2026年8月26日 18:05')
})

test('with no draft yet there is nothing to claim about a save', () => {
  const state = draftSaveState({ draft: undefined, dirty: false })
  expect(state.label).toBe('下書きなし')
  expect(state.savedAtLabel).toBe('最終保存 なし')
  expect(state.savedByLabel).toBe('変更者 なし')
})

/* ---------------- 影響確認 (UC-EYEX-093, 097, 115, AC-EYEX-43, 44, 46, 66) ---------------- */

test('impact groups keep every checked kind, blocking first, named without colour', () => {
  const summary = impactSummary(report())
  expect(summary.groups.map((group) => group.kind)).toEqual([
    'reservation_conflict',
    'missing_staff_skill',
    'web_slot_change',
  ])
  expect(summary.groups[0]?.severityLabel).toBe('要対応')
  expect(IMPACT_SEVERITY_LABEL).toEqual({
    blocking: '要対応',
    warning: '警告',
    info: '情報',
  })
  expect(IMPACT_KIND_LABEL.missing_equipment).toBe('設備不足')
  expect(IMPACT_KIND_LABEL.out_of_hours).toBe('営業時間外設定')
})

test('the public slot and ledger effects are stated as a signed delta', () => {
  const summary = impactSummary(report())
  expect(summary.slotLabel).toBe('42件 → 38件（-4件）')
  expect(summary.ledgerLabel).toBe('18件')
})

test('a growing slot count reads as a positive delta and an unchanged one as ±0', () => {
  const grow = impactSummary(
    report({ publicSlots: { date: '2026-08-27', publishedCount: 38, draftCount: 42 } }),
  )
  expect(grow.slotLabel).toBe('38件 → 42件（+4件）')
  const same = impactSummary(
    report({ publicSlots: { date: '2026-08-27', publishedCount: 42, draftCount: 42 } }),
  )
  expect(same.slotLabel).toBe('42件 → 42件（±0件）')
})

/* ---------------- ブロッキング解消 (UC-EYEX-165, AC-EYEX-109) ---------------- */

test('unresolved blocking reservations hold publication', () => {
  const summary = impactSummary(report())
  expect(summary.unresolved.map((item) => item.reservationId)).toEqual([RES_A, RES_B])
  expect(summary.canPublish).toBe(false)
  expect(summary.blockedHeadline).toBe('公開できません')
  expect(summary.blockedReason).toBe(
    '影響予約ごとに代替設備、例外維持、顧客連絡を記録してください。',
  )
  // モックのカード「ブロッキング」「警告」の値。
  expect(summary.blockingLabel).toBe('影響予約2件')
  expect(summary.warningLabel).toBe('1件')
})

test('resolving every blocking reservation unblocks publication', () => {
  const resolved = report({
    canPublish: true,
    items: report().items.map((item) =>
      item.severity === 'blocking' ? { ...item, resolution: 'customer_contacted' as const } : item,
    ),
  })
  const summary = impactSummary(resolved)
  expect(summary.unresolved).toEqual([])
  expect(summary.canPublish).toBe(true)
  expect(summary.blockedHeadline).toBeUndefined()
  expect(summary.blockedReason).toBeUndefined()
})

test('a server that still refuses to publish wins over a locally resolved list', () => {
  const resolved = report({
    canPublish: false,
    items: report().items.map((item) =>
      item.severity === 'blocking' ? { ...item, resolution: 'keep_exception' as const } : item,
    ),
  })
  expect(impactSummary(resolved).canPublish).toBe(false)
})

test('the three resolutions are the ones the spec names', () => {
  expect(RESOLUTION_LABEL).toEqual({
    alternative_resource: '代替資源割当',
    keep_exception: '例外維持',
    customer_contacted: '顧客連絡',
  })
})

/* ---------------- 公開予約 (UC-EYEX-094, 161, 166, AC-EYEX-105) ---------------- */

test('a schedule must be a JST wall clock at or after today', () => {
  expect(scheduleError('2026-08-27T18:00', '2026-08-27')).toBeUndefined()
  expect(scheduleError('2026-08-28T00:00', '2026-08-27')).toBeUndefined()
  expect(scheduleError('2026-08-26T23:59', '2026-08-27')).toBe('過去の日時は指定できません。')
  expect(scheduleError('', '2026-08-27')).toBe('公開日時を入力してください。')
  expect(scheduleError('2026-08-27 18:00', '2026-08-27')).toBe(
    '公開日時は YYYY-MM-DDTHH:mm 形式で入力してください。',
  )
})

test('a scheduled publication can be rescheduled or cancelled, and shows its plan', () => {
  const view = publicationView(
    publication({
      status: 'scheduled',
      scheduledForJst: '2026-08-30T18:00',
      scheduledAt: '2026-08-30T09:00:00.000Z',
      executedAt: null,
      appliedCount: 0,
      failedCount: 0,
      targets: publication().targets.map((target) => ({ ...target, status: 'pending' as const })),
    }),
  )
  expect(view.statusLabel).toBe('公開予約')
  expect(view.scheduledLabel).toBe('公開予定 2026年8月30日 18:00')
  expect(view.executedLabel).toBe('実行日時 未実行')
  expect(view.canReschedule).toBe(true)
  expect(view.canCancel).toBe(true)
  expect(view.canRetry).toBe(false)
})

/* ---------------- 公開結果 (UC-EYEX-162, AC-EYEX-106) ---------------- */

test('the result states version, targets, applied and failed counts and both effects', () => {
  const view = publicationView(publication())
  expect(view.statusLabel).toBe('一部失敗')
  expect(view.versionId).toBe('00000000-0000-4000-8000-000000000041')
  expect(view.appliedCount).toBe(12)
  expect(view.failedCount).toBe(1)
  expect(view.slotCountLabel).toBe('公開枠 402件')
  expect(view.webConfirmLabel).toBe('Web予約 12/13')
  expect(view.ledgerConfirmLabel).toBe('予約台帳 12/13')
  expect(view.executedLabel).toBe('実行日時 2026年8月26日 18:00')
  expect(view.scheduledLabel).toBe('公開予定 即時')
})

/* ---------------- 部分失敗の再試行 (UC-EYEX-163, AC-EYEX-107) ---------------- */

test('a retry targets only the failed stores and never a store already applied', () => {
  const view = publicationView(publication())
  expect(view.canRetry).toBe(true)
  expect(view.retryStoreIds).toEqual(['00000000-0000-4000-8000-000000000011'])
  expect(view.failed.map((target) => target.storeId)).toEqual([
    '00000000-0000-4000-8000-000000000011',
  ])
  expect(view.applied.map((target) => target.storeId)).toEqual([STORE])
})

test('a completed publication offers no retry', () => {
  const view = publicationView(
    publication({
      status: 'completed',
      failedCount: 0,
      targets: publication().targets.map((target) => ({ ...target, status: 'applied' as const })),
    }),
  )
  expect(view.canRetry).toBe(false)
  expect(view.retryStoreIds).toEqual([])
  expect(view.statusLabel).toBe('完了')
})

/* ---------------- 版履歴と差分 (UC-EYEX-096, 164, AC-EYEX-108) ---------------- */

test('a version diff is readable per field with 変更前 and 変更後 summaries', () => {
  const detail: SettingsVersionDetail = {
    versionId: '00000000-0000-4000-8000-000000000050',
    storeId: STORE,
    version: 4,
    origin: 'store_override',
    publishedAt: '2026-08-26T09:00:00.000Z',
    publishedBy: '山田',
    changedFields: ['receptionStatus', 'purposes'],
    settings,
    diff: [
      { field: 'receptionStatus', before: '"open"', after: '"paused"' },
      { field: 'purposes', before: '[{"id":"a"},{"id":"b"}]', after: '[{"id":"a"}]' },
      { field: 'shifts', before: 'not json', after: '[]' },
    ],
  }
  expect(diffRows(detail)).toEqual([
    { field: 'receptionStatus', label: '受付状態', before: 'open', after: 'paused' },
    { field: 'purposes', label: '来店目的', before: '2件', after: '1件' },
    { field: 'shifts', label: '勤務', before: 'not json', after: '0件' },
  ])
})

/* ---------------- 適用元と上書き解除 (UC-EYEX-092, 160, AC-EYEX-48, 69, 104) ---------------- */

test('the applied origin is named in words', () => {
  expect(ORIGIN_LABEL).toEqual({ chain: '全店共通', store_override: '店舗上書き' })
})

test('releasing an override announces the new common value and its impact first', () => {
  const notice = overrideReleaseNotice({
    chainVersion: 7,
    draft: draft({ origin: 'chain' }),
    impact: report({ blockingCount: 0, warningCount: 0, canPublish: true, items: [] }),
  })
  expect(notice.headline).toBe('全店共通値 第7版を新しい下書きにしました')
  expect(notice.detail).toBe('公開する前に影響確認を行ってください。')
  expect(notice.canPublish).toBe(true)
})

/* ---------------- 版競合 (UC-EYEX-172 相当) ---------------- */

test('a stale base version is refused with the latest version shown', () => {
  expect(
    versionConflictNotice({ error: 'version_conflict', currentVersion: 5, expectedVersion: 3 }),
  ).toBe(
    '他の担当者が先に保存しました。最新は第5版です（この画面は第3版）。最新を読み込み直してください。',
  )
  expect(versionConflictNotice({ error: 'draft_not_found' })).toBeUndefined()
  expect(versionConflictNotice(undefined)).toBeUndefined()
})

/*
 * 版の名乗りは人が読む採番で出す。`versionId` は保存用の UUID であって、
 * 画面に出しても「どの版か」を誰も読み取れない（承認済みモックは
 * `settings-complete-approved.html#publish-result` で人が読む採番を出す）。
 * 番号は反映済み店舗の `appliedVersion` が持っている。
 */
test('the result names the version with the human numbering, never the uuid', () => {
  const view = publicationView(publication())
  expect(view.versionLabel).toBe('第4版の公開結果')
  expect(view.versionLabel).not.toContain(publication().versionId)
})

test('a publication that has not applied anywhere yet names no version number', () => {
  const view = publicationView(
    publication({
      status: 'scheduled',
      targets: publication().targets.map((target) => ({
        ...target,
        status: 'pending' as const,
        appliedVersion: null,
      })),
    }),
  )
  // 採番はまだ決まっていない。分かっていない番号を作り出さず、名乗りだけ出す。
  expect(view.versionLabel).toBe('公開結果')
})
