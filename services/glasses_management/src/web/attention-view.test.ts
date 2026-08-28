import { ATTENTION_CAPABILITIES, ATTENTION_INPUT_GUIDANCE } from '@app/contracts'
import { expect, test } from 'vitest'
import {
  attentionActionLabel,
  attentionCapabilityRows,
  attentionMatrixRows,
  attentionPermissionFor,
  auditDiffRows,
  auditValueText,
  capabilityColumnLabel,
  capabilityLabel,
  formatJstInstant,
  instantToJstWallClock,
  jstWallClockToInstant,
  mergeImpactRows,
  mergeImpactTotal,
  noteStatusLabel,
  noteStatusTone,
  originLabel,
  relativeJstDay,
  reviewDecisionLabel,
  roleLabel,
  sharingScopeImpactSummary,
  sharingScopeLabel,
  versionConflictRows,
} from './attention-view'

const SETTINGS = {
  storeId: '00000000-0000-4000-8000-000000000010',
  reviewMode: 'review_required' as const,
  sharingScope: 'permitted_stores' as const,
  storeOverrideAllowed: true,
  origin: 'store' as const,
  capabilities: [
    {
      capability: 'publish' as const,
      minimumRole: 'store_manager' as const,
      origin: 'store' as const,
    },
    { capability: 'read' as const, minimumRole: 'staff' as const, origin: 'organization' as const },
    {
      capability: 'write' as const,
      minimumRole: 'staff' as const,
      origin: 'organization' as const,
    },
    {
      capability: 'revise' as const,
      minimumRole: 'store_manager' as const,
      origin: 'store' as const,
    },
    {
      capability: 'hide' as const,
      minimumRole: 'organization_admin' as const,
      origin: 'organization' as const,
    },
  ],
  guidance: ATTENTION_INPUT_GUIDANCE,
}

/* 権限表 (UC-EYEX-140, AC-EYEX-84) */

test('権限表は契約の順序どおりに5能力を並べ、適用元を添える (UC-EYEX-140, AC-EYEX-84)', () => {
  const rows = attentionCapabilityRows(SETTINGS)

  expect(rows.map((row) => row.capability)).toEqual([...ATTENTION_CAPABILITIES])
  expect(rows.map((row) => row.label)).toEqual(['閲覧', '登録', '公開', '改訂', '非表示化'])
  expect(rows[0]).toMatchObject({ minimumRole: 'staff', originLabel: '組織共通' })
  expect(rows[2]).toMatchObject({ minimumRole: 'store_manager', originLabel: '店舗上書き' })
  expect(rows[4]).toMatchObject({ minimumRole: 'organization_admin', originLabel: '組織共通' })
})

test('ロール・方式・共有範囲・適用元は日本語ラベルを持つ (UC-EYEX-139, 141, 142)', () => {
  expect(roleLabel('staff')).toBe('スタッフ')
  expect(roleLabel('store_manager')).toBe('店舗管理者')
  expect(roleLabel('organization_admin')).toBe('本部管理者')
  expect(sharingScopeLabel('permitted_stores')).toBe('権限のある店舗')
  expect(sharingScopeLabel('chain')).toBe('チェーン全体')
  expect(originLabel('organization')).toBe('組織共通')
  expect(originLabel('store')).toBe('店舗上書き')
  expect(capabilityLabel('hide')).toBe('非表示化')
})

test('各能力はちょうど1つの店舗権限に対応する (contract note)', () => {
  expect(ATTENTION_CAPABILITIES.map(attentionPermissionFor)).toEqual([
    'attention.read',
    'attention.write',
    'attention.publish',
    'attention.revise',
    'attention.hide',
  ])
})

/* 共有範囲の影響 (UC-EYEX-142, AC-EYEX-118) */

test('共有範囲変更は件数と変更後の範囲を文章で示す (AC-EYEX-118)', () => {
  expect(
    sharingScopeImpactSummary({
      currentScope: 'permitted_stores',
      requestedScope: 'chain',
      affectedNoteCount: 12,
      affectedCustomerCount: 5,
      affectedStoreCount: 3,
    }),
  ).toBe(
    '既存の注意事項 12件（顧客 5人・店舗 3店舗）が「権限のある店舗」から「チェーン全体」へ変わります。',
  )
})

test('影響0件でも変更内容を言い切る (AC-EYEX-118)', () => {
  expect(
    sharingScopeImpactSummary({
      currentScope: 'chain',
      requestedScope: 'permitted_stores',
      affectedNoteCount: 0,
      affectedCustomerCount: 0,
      affectedStoreCount: 0,
    }),
  ).toBe('過去の注意事項に影響はありません。今後の登録から「権限のある店舗」で共有されます。')
})

/* 状態 (AC-EYEX-85, UC-EYEX-145, 146) */

test('状態は色に頼らず語で読める (AC-EYEX-85, UC-EYEX-146)', () => {
  expect(noteStatusLabel('pending_review')).toBe('確認待ち')
  expect(noteStatusLabel('published')).toBe('公開済み')
  expect(noteStatusLabel('returned')).toBe('差戻し')
  expect(noteStatusLabel('rejected')).toBe('却下')
  expect(noteStatusLabel('superseded')).toBe('旧版')
  expect(noteStatusLabel('hidden')).toBe('非表示')
  expect(noteStatusTone('pending_review')).toBe('warning')
  expect(noteStatusTone('published')).toBe('success')
  expect(noteStatusTone('rejected')).toBe('danger')
  expect(noteStatusTone('superseded')).toBe('neutral')
})

test('レビュー判断と再認証の対象操作にラベルがある (AC-EYEX-116, AC-EYEX-87)', () => {
  expect(reviewDecisionLabel('publish')).toBe('公開')
  expect(reviewDecisionLabel('return')).toBe('差戻し')
  expect(reviewDecisionLabel('reject')).toBe('却下')
  expect(attentionActionLabel('publish')).toBe('注意事項の公開')
  expect(attentionActionLabel('revise')).toBe('注意事項の改訂')
  expect(attentionActionLabel('hide')).toBe('注意事項の非表示化')
})

/* 版の競合 (AC-EYEX-117) */

test('版の競合は新旧差分を項目名つきで並べる (AC-EYEX-117)', () => {
  const rows = versionConflictRows({
    error: 'attention_version_conflict',
    currentVersion: 3,
    expectedVersion: 2,
    differences: [
      { field: 'body', before: '説明を段階化', after: '説明を三段階に分ける' },
      { field: 'recommendedAction', before: '', after: '一段階ずつ説明する' },
      { field: 'unknownField', before: 'a', after: 'b' },
    ],
  })

  expect(rows).toEqual([
    { field: 'body', label: '発生した事実', before: '説明を段階化', after: '説明を三段階に分ける' },
    {
      field: 'recommendedAction',
      label: '推奨対応',
      before: '（未記録）',
      after: '一段階ずつ説明する',
    },
    { field: 'unknownField', label: 'unknownField', before: 'a', after: 'b' },
  ])
})

/* JST の日時 (時刻は注入する) */

test('JST壁時計と保存用インスタントを往復できる (時刻は注入する)', () => {
  expect(jstWallClockToInstant('2026-08-25T15:10')).toBe('2026-08-25T06:10:00.000Z')
  expect(instantToJstWallClock('2026-08-25T06:10:00.000Z')).toBe('2026-08-25T15:10')
  expect(formatJstInstant('2026-08-25T06:10:00.000Z')).toBe('2026年8月25日 15:10')
})

test('日跨ぎの境界でもJSTの日付が崩れない (時刻の境界値)', () => {
  expect(jstWallClockToInstant('2026-01-01T00:00')).toBe('2025-12-31T15:00:00.000Z')
  expect(instantToJstWallClock('2025-12-31T15:00:00.000Z')).toBe('2026-01-01T00:00')
  expect(formatJstInstant('2025-12-31T15:00:00.000Z')).toBe('2026年1月1日 00:00')
  // うるう日
  expect(instantToJstWallClock('2028-02-28T15:00:00.000Z')).toBe('2028-02-29T00:00')
})

test('壊れた値は捨てずにそのまま見せる (静かな欠落を作らない)', () => {
  expect(jstWallClockToInstant('')).toBeUndefined()
  expect(jstWallClockToInstant('2026-08-25')).toBeUndefined()
  expect(instantToJstWallClock('not-a-date')).toBe('')
  expect(formatJstInstant('not-a-date')).toBe('not-a-date')
})

/* 監査 (UC-EYEX-155, AC-EYEX-102) */

test('監査の変更前後は同じ鍵で突き合わせて並ぶ (AC-EYEX-102)', () => {
  const rows = auditDiffRows({
    id: '00000000-0000-4000-8000-000000000301',
    occurredAt: '2026-08-26T08:42:13.000Z',
    storeId: '00000000-0000-4000-8000-000000000010',
    actorType: 'shared_terminal',
    actorId: 'terminal-1',
    action: 'attention_note.published',
    entityType: 'attention_note',
    entityId: 'note-1',
    correlationId: 'corr-6f82',
    before: { status: 'pending_review', version: 2 },
    after: { status: 'published', version: 3, publishedAt: null },
  })

  expect(rows).toEqual([
    { key: 'status', before: 'pending_review', after: 'published' },
    { key: 'version', before: '2', after: '3' },
    { key: 'publishedAt', before: '（なし）', after: '（空）' },
  ])
})

test('変更前後が無い監査イベントは差分行を作らない (AC-EYEX-102)', () => {
  expect(
    auditDiffRows({
      id: '00000000-0000-4000-8000-000000000302',
      occurredAt: '2026-08-26T08:42:13.000Z',
      storeId: null,
      actorType: 'user',
      actorId: 'user-1',
      action: 'attention_note.read',
      entityType: 'customer',
      entityId: 'customer-1',
      correlationId: null,
      before: null,
      after: null,
    }),
  ).toEqual([])
})

test('監査値は型を落とさず文字にする (AC-EYEX-102)', () => {
  expect(auditValueText('published')).toBe('published')
  expect(auditValueText(3)).toBe('3')
  expect(auditValueText(true)).toBe('true')
  expect(auditValueText(null)).toBe('（空）')
  expect(auditValueText(undefined)).toBe('（なし）')
  expect(auditValueText({ a: 1 })).toBe('{"a":1}')
})

/* 統合の影響 (UC-EYEX-181, AC-EYEX-121) */

test('統合の影響は項目ごとに読め、合計が承認値になる (AC-EYEX-121)', () => {
  const impact = {
    reservations: 4,
    walkins: 1,
    prescriptions: 2,
    notes: 3,
    attentionNotes: 1,
    ownedGlasses: 2,
  }

  expect(mergeImpactRows(impact)).toEqual([
    { key: 'reservations', label: '予約', count: 4 },
    { key: 'walkins', label: 'ウォークイン', count: 1 },
    { key: 'prescriptions', label: '度数記録', count: 2 },
    { key: 'notes', label: '接客メモ', count: 3 },
    { key: 'attentionNotes', label: '注意事項', count: 1 },
    { key: 'ownedGlasses', label: '所有メガネ', count: 2 },
  ])
  expect(mergeImpactTotal(impact)).toBe(13)
})

test('ロール×操作の許可表は確認待ちを許可と混ぜない (UC-EYEX-140, AC-EYEX-84)', () => {
  const rows = attentionMatrixRows(SETTINGS)
  expect(rows.map((row) => row.label)).toEqual(['スタッフ', '店舗管理者', '本部管理者'])
  expect(rows[0]?.cells.map((cell) => cell.label)).toEqual([
    '許可',
    '確認待ち',
    '不可',
    '不可',
    '不可',
  ])
  // hide だけ本部管理者以上なので、店舗管理者の非表示は不可のまま。
  expect(rows[1]?.cells.map((cell) => cell.label)).toEqual(['許可', '許可', '許可', '許可', '不可'])
  expect(rows[2]?.cells.every((cell) => cell.label === '許可')).toBe(true)
})

test('即時公開なら登録は確認待ちにならない (UC-EYEX-140)', () => {
  const rows = attentionMatrixRows({ ...SETTINGS, reviewMode: 'immediate' })
  expect(rows[0]?.cells[1]?.label).toBe('許可')
})

test('列見出しは承認済みモックの文言を使う', () => {
  expect(ATTENTION_CAPABILITIES.map(capabilityColumnLabel)).toEqual([
    '閲覧',
    '登録',
    '公開',
    '改訂',
    '非表示',
  ])
})

test('待ち行列の見出しは今日と昨日だけ言葉にする (ATTENTION-REVIEW)', () => {
  // 2026-08-27 05:30Z = JST 14:30
  expect(relativeJstDay('2026-08-27T05:30:00.000Z', '2026-08-27')).toBe('本日')
  expect(relativeJstDay('2026-08-26T05:30:00.000Z', '2026-08-27')).toBe('昨日')
  // 本日・昨日から外れた日も、柱に生の ISO を出さない（承認済みモックの語彙）。
  expect(relativeJstDay('2026-08-20T05:30:00.000Z', '2026-08-27')).toBe('8月20日')
  // 年を跨いでも月日で名乗る。柱は名前で押されるので、字の形を変えない。
  expect(relativeJstDay('2025-12-31T05:30:00.000Z', '2026-08-27')).toBe('12月31日')
  // JST 日跨ぎ: 2026-08-26T15:00Z は JST では 8/27 0:00。
  expect(relativeJstDay('2026-08-26T15:00:00.000Z', '2026-08-27')).toBe('本日')
  // 月跨ぎ
  expect(relativeJstDay('2026-07-31T05:00:00.000Z', '2026-08-01')).toBe('昨日')
})
