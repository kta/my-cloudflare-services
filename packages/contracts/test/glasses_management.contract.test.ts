import {
  Actor,
  Alert,
  AlertCode,
  AlertList,
  AlertListQuery,
  AlertPatch,
  AlertReadAllResult,
  AnalyticsDailyDimension,
  AnalyticsDailyMetric,
  AnalyticsDailyRow,
  AnalyticsPoint,
  AnalyticsQuery,
  AnalyticsReport,
  AnalyticsRollupRequest,
  AnalyticsRollupResult,
  AnalyticsSeries,
  AnalyticsTargets,
  AuditActorType,
  AuditEvent,
  AuditEventList,
  AuditSearchQuery,
  AuditTargetType,
  AvailabilityLane,
  AvailabilityQuery,
  AvailabilityReason,
  AvailabilityResponse,
  AvailabilitySlot,
  BlackoutWindow,
  BlackoutWindowInput,
  BusinessHoursInput,
  BusinessHoursRow,
  BusinessHoursView,
  CalendarException,
  CalendarExceptionInput,
  CalendarExceptionQuery,
  CustomerCandidate,
  CustomerCreate,
  CustomerDetail,
  CustomerList,
  CustomerLookupQuery,
  CustomerMergeField,
  CustomerMergeInput,
  CustomerMergePreview,
  CustomerMergePreviewRequest,
  CustomerMergeResult,
  CustomerNote,
  CustomerNoteInput,
  CustomerNotePatch,
  CustomerNotePublishInput,
  CustomerNoteQuery,
  CustomerNumber,
  CustomerPatch,
  CustomerSearchQuery,
  CustomerSummary,
  DeletedResult,
  Equipment,
  EquipmentInput,
  EquipmentKind,
  EquipmentListQuery,
  EquipmentMaintenance,
  EquipmentMaintenanceInput,
  EquipmentPatch,
  Hold,
  HoldInput,
  LedgerAxis,
  LedgerBlock,
  LedgerEntry,
  LedgerFilter,
  LedgerLane,
  LedgerQuery,
  LedgerView,
  LedgerViewMode,
  LocalDate,
  LocalTime,
  MaintenanceQuery,
  OrganizationSync,
  OwnedGlasses,
  PhoneInput,
  PhoneNormalized,
  PhoneSuffix,
  Pin,
  PinInvalidError,
  PinLockedError,
  PinSetResult,
  Prescription,
  PublicAvailabilityQuery,
  PublicAvailabilityResponse,
  PublicBookingCreate,
  PublicBookingResult,
  PublicReservationStatus,
  PublicReservationVerification,
  PublicStorePurpose,
  PurposeListQuery,
  PurposeOrderInput,
  PurposeRequirement,
  PurposeRequirementsInput,
  ReauthInput,
  ReceptionHistoryDetail,
  ReceptionHistoryEntry,
  ReceptionHistoryList,
  ReceptionHistoryQuery,
  ReceptionSession,
  ReceptionSessionClose,
  ReceptionSessionDraft,
  ReceptionSessionDraftPatch,
  ReceptionSessionStart,
  Recording,
  RecordingCode,
  RecordingContentType,
  RecordingCreate,
  RecordingHoldInput,
  RecordingList,
  RecordingListQuery,
  RecordingPlaybackTicket,
  RecordingPurgeRequest,
  RecordingPurgeResult,
  RecordingRetainedError,
  RecordingState,
  RecordingStatePatch,
  RecordingSummary,
  ReservationAssignment,
  ReservationCancelInput,
  ReservationChangeHistory,
  ReservationChangeInput,
  ReservationCode,
  ReservationDetail,
  ReservationList,
  ReservationPurposeLine,
  ReservationSearchQuery,
  ReservationSource,
  ReservationStatus,
  ReservationSummary,
  SearchRelaxation,
  SettingsImpactItem,
  SettingsImpactReport,
  SettingsImpactRequest,
  SkillCode,
  SlotRules,
  SlotRulesInput,
  SlotRulesView,
  StaffListQuery,
  StaffMember,
  StaffMemberInput,
  StaffMemberPatch,
  StaffPinInput,
  StaffReservationCreate,
  StaffShift,
  StaffShiftQuery,
  StaffShiftsInput,
  StaffSkillsInput,
  Store,
  StoreDetail,
  StoreMembership,
  StorePatch,
  StorePermission,
  Terminal,
  TerminalInput,
  TerminalKind,
  TerminalListQuery,
  TerminalPatch,
  TerminalSession,
  TerminalSessionStart,
  Version,
  VisitBoard,
  VisitBoardCell,
  VisitBoardQuery,
  VisitBoardRow,
  VisitEvent,
  VisitEventInput,
  VisitPurpose,
  VisitPurposeInput,
  VisitPurposePatch,
  VisitStage,
  Walkin,
  WalkinCreate,
  WalkinListQuery,
  WalkinPatch,
  WalkinSummary,
  WebBookingCode,
  WebBookingReviewInput,
  WebBookingSettings,
  WebBookingSettingsInput,
  Weekday,
} from '@app/contracts'
import { describe, expect, it } from 'vitest'

const ORG = 'org-eyex'
const UUID = '11111111-2222-4333-8444-555555555555'
const UUID2 = '99999999-8888-4777-8666-555555555555'
const NOW = '2026-08-27T02:08:00.000Z'

describe('OrganizationSync', () => {
  it('accepts a canonical snapshot from admin', () => {
    const parsed = OrganizationSync.parse({
      id: ORG,
      name: 'EYEX',
      plan: 'contracted',
      isDisabled: false,
      createdAt: NOW,
      revision: 7,
    })
    expect(parsed.revision).toBe(7)
  })

  it('defaults revision to 0 so a pre-revision snapshot still applies', () => {
    expect(
      OrganizationSync.parse({
        id: ORG,
        name: 'EYEX',
        plan: 'free',
        isDisabled: false,
        createdAt: NOW,
      }).revision,
    ).toBe(0)
  })

  it('rejects a negative or fractional revision', () => {
    for (const revision of [-1, 1.5]) {
      expect(() =>
        OrganizationSync.parse({
          id: ORG,
          name: 'EYEX',
          plan: 'free',
          isDisabled: false,
          createdAt: NOW,
          revision,
        }),
      ).toThrow()
    }
  })

  it('rejects an unknown key so a stale admin field never lands silently', () => {
    expect(() =>
      OrganizationSync.parse({
        id: ORG,
        name: 'EYEX',
        plan: 'free',
        isDisabled: false,
        createdAt: NOW,
        revision: 0,
        legacyFlag: true,
      }),
    ).toThrow()
  })

  it('rejects an empty id and a non-datetime createdAt', () => {
    expect(() =>
      OrganizationSync.parse({
        id: '  ',
        name: 'EYEX',
        plan: 'free',
        isDisabled: false,
        createdAt: NOW,
      }),
    ).toThrow()
    expect(() =>
      OrganizationSync.parse({
        id: ORG,
        name: 'EYEX',
        plan: 'free',
        isDisabled: false,
        createdAt: '2026-08-27',
      }),
    ).toThrow()
  })
})

describe('StorePermission', () => {
  it('is an allow-list: an unknown permission fails closed', () => {
    expect(() => StorePermission.parse('reservation.delete')).toThrow()
  })

  it('keeps the separation that lets a viewer stay a viewer', () => {
    for (const permission of ['attention.read', 'attention.publish', 'analytics.read']) {
      expect(StorePermission.parse(permission)).toBe(permission)
    }
  })
})

describe('StoreMembership', () => {
  const base = {
    id: UUID,
    organizationId: ORG,
    storeId: UUID2,
    userId: 'user-1',
    permissions: ['store.read', 'reservation.read'],
    createdAt: NOW,
  }

  it('accepts a membership carrying allow-listed permissions', () => {
    expect(StoreMembership.parse(base).permissions).toEqual(['store.read', 'reservation.read'])
  })

  it('accepts an empty permission list — that is how admin revokes an assignment', () => {
    expect(StoreMembership.parse({ ...base, permissions: [] }).permissions).toEqual([])
  })

  it('rejects an unknown permission inside the list', () => {
    expect(() =>
      StoreMembership.parse({ ...base, permissions: ['store.read', 'store.destroy'] }),
    ).toThrow()
  })

  it('requires UUIDs for domain-owned ids but not for the admin organization id', () => {
    expect(() => StoreMembership.parse({ ...base, storeId: 'store-1' })).toThrow()
    expect(
      StoreMembership.parse({ ...base, organizationId: 'org-admin-seed' }).organizationId,
    ).toBe('org-admin-seed')
  })
})

describe('Store', () => {
  const base = {
    id: UUID,
    organizationId: ORG,
    name: 'EYEX 銀座店',
    slug: 'ginza',
    isActive: true,
    createdAt: NOW,
  }

  it('fills the optional contact fields with empty strings', () => {
    const parsed = Store.parse(base)
    expect([parsed.phone, parsed.address, parsed.accessNote]).toEqual(['', '', ''])
  })

  it('accepts a hyphenated lowercase slug and rejects anything else', () => {
    expect(Store.parse({ ...base, slug: 'ginza-main' }).slug).toBe('ginza-main')
    for (const slug of ['Ginza', 'ginza_main', '-ginza', 'ginza-', 'ぎんざ', '']) {
      expect(() => Store.parse({ ...base, slug })).toThrow()
    }
  })

  it('trims and bounds the display name', () => {
    expect(Store.parse({ ...base, name: '  EYEX 銀座店  ' }).name).toBe('EYEX 銀座店')
    expect(() => Store.parse({ ...base, name: 'あ'.repeat(201) })).toThrow()
  })
})

describe('Actor', () => {
  it('defaults terminalId to null so a personal device carries no terminal', () => {
    expect(
      Actor.parse({ subjectId: 'user-1', organizationId: ORG, kind: 'staff' }).terminalId,
    ).toBeNull()
  })

  it('carries the terminal when the shared iPad is the audited subject', () => {
    const parsed = Actor.parse({
      subjectId: UUID,
      organizationId: ORG,
      kind: 'terminal',
      terminalId: UUID,
    })
    expect(parsed.kind).toBe('terminal')
  })

  it('rejects an actor kind outside the closed set', () => {
    expect(() => Actor.parse({ subjectId: 'x', organizationId: ORG, kind: 'robot' })).toThrow()
  })
})

/* ------------------------------------------------------------------------- *
 * P1 店舗の受付条件（004-store-settings）
 *
 * 6 面が読み書きする形と、その境界値をここで固定する。
 * ------------------------------------------------------------------------- */

/** 曜日 7 行を作る。既定は銀座店の平日（10:00–19:00）。 */
const hoursRow = (weekday: number, over: Record<string, unknown> = {}) => ({
  weekday,
  isClosed: false,
  opensAt: '10:00',
  closesAt: '19:00',
  ...over,
})
const sevenHoursRows = [0, 1, 2, 3, 4, 5, 6].map((weekday) => hoursRow(weekday))

/** 勤務の曜日テンプレート 7 行。 */
const weeklyRow = (weekday: number, over: Record<string, unknown> = {}) => ({
  weekday,
  isOff: false,
  startsAt: '10:00',
  endsAt: '19:00',
  ...over,
})
const sevenWeeklyRows = [0, 1, 2, 3, 4, 5, 6].map((weekday) => weeklyRow(weekday))

const storeDetail = {
  id: UUID,
  organizationId: ORG,
  name: 'EYEX 銀座店',
  slug: 'ginza',
  isActive: true,
  createdAt: NOW,
  settingsVersion: 3,
}

const staffMember = {
  id: UUID,
  displayName: '佐藤 美咲',
  isActive: true,
  sortOrder: 0,
  hasPin: true,
}

const equipment = {
  id: UUID,
  name: '視力測定機 A',
  kind: 'measure',
  isActive: true,
  sortOrder: 0,
  roleLabel: '視力測定',
  ledgerDisplay: 'grey',
}

const visitPurpose = {
  id: UUID,
  nameInternal: 'メガネを新しく作る',
  namePublic: '新しいメガネを作る',
  nameShort: '新調相談',
  durationMinutes: 60,
  isWebPublished: true,
  isActive: true,
  sortOrder: 0,
  version: 1,
}

describe('LocalTime', () => {
  it('10:00 と 23:59 を通し、24:00 と 9:00 を落とす', () => {
    expect(LocalTime.parse('10:00')).toBe('10:00')
    expect(LocalTime.parse('23:59')).toBe('23:59')
    // 時は必ず 2 桁。`9:00` を通すと文字列比較（`'9:00' > '18:40'`）が壊れる。
    for (const time of ['24:00', '9:00', '10:60', '1000']) {
      expect(() => LocalTime.parse(time)).toThrow()
    }
  })
})

describe('LocalDate', () => {
  it('2026-08-27 を通し、2026-8-7 を落とす', () => {
    expect(LocalDate.parse('2026-08-27')).toBe('2026-08-27')
    for (const date of ['2026-8-7', '2026/08/27', '20260827']) {
      expect(() => LocalDate.parse(date)).toThrow()
    }
  })
})

describe('Weekday', () => {
  it('0 と 6 を通し、-1 と 7 と 3.5 を落とす', () => {
    expect(Weekday.parse(0)).toBe(0)
    expect(Weekday.parse(6)).toBe(6)
    for (const weekday of [-1, 7, 3.5]) {
      expect(() => Weekday.parse(weekday)).toThrow()
    }
  })
})

describe('StoreDetail', () => {
  it('slug は 2 文字ちょうどと 40 文字ちょうどを通し、1 文字と 41 文字を落とす', () => {
    expect(StoreDetail.parse({ ...storeDetail, slug: 'gz' }).slug).toBe('gz')
    expect(StoreDetail.parse({ ...storeDetail, slug: 'a'.repeat(40) }).slug).toHaveLength(40)
    for (const slug of ['g', 'a'.repeat(41)]) {
      expect(() => StoreDetail.parse({ ...storeDetail, slug })).toThrow()
    }
  })

  it('namePublic / nearestStation / parkingNote / introText は null を取る（未入力）', () => {
    const omitted = StoreDetail.parse(storeDetail)
    expect([
      omitted.namePublic,
      omitted.nearestStation,
      omitted.parkingNote,
      omitted.introText,
    ]).toEqual([null, null, null, null])
    const explicit = StoreDetail.parse({
      ...storeDetail,
      namePublic: null,
      nearestStation: null,
      parkingNote: null,
      introText: null,
      sortOrder: null,
      updatedAt: null,
      updatedBy: null,
    })
    expect(explicit.settingsVersion).toBe(3)
  })
})

describe('StorePatch', () => {
  it('introText は 200 文字ちょうどを通し、201 文字を落とす', () => {
    expect(StorePatch.parse({ introText: 'あ'.repeat(200), version: 3 }).introText).toHaveLength(
      200,
    )
    expect(() => StorePatch.parse({ introText: 'あ'.repeat(201), version: 3 })).toThrow()
  })

  it('introText は画面と同じ符号位置で数える（絵文字を 2 文字と数えない）', () => {
    // 画面の「200文字／200文字まで」は `[...text].length` で数えている。
    // UTF-16 の長さで見ると 👓 が 2 文字になり、画面が「200文字」と出しているのに
    // 保存だけが黙って落ちる。
    expect(StorePatch.parse({ introText: '👓'.repeat(200), version: 3 }).introText).toHaveLength(
      400,
    )
    expect(() => StorePatch.parse({ introText: '👓'.repeat(201), version: 3 })).toThrow()
  })

  it('version を欠いた本文を落とす（楽観ロックを外させない）', () => {
    expect(StorePatch.parse({ name: 'EYEX 銀座店', version: Version.parse(0) }).version).toBe(0)
    expect(() => StorePatch.parse({ name: 'EYEX 銀座店' })).toThrow()
  })

  it('知らないキーが混ざった本文を落とす', () => {
    // `publicName` / `intro` のような短縮した別名を作らせない。
    expect(() => StorePatch.parse({ publicName: 'EYEX 銀座', version: 3 })).toThrow()
    expect(() => StorePatch.parse({ intro: 'ようこそ', version: 3 })).toThrow()
  })
})

describe('BusinessHoursInput', () => {
  it('7 行ちょうどを通し、6 行と 8 行を落とす', () => {
    expect(BusinessHoursInput.parse({ rows: sevenHoursRows, version: 1 }).rows).toHaveLength(7)
    expect(() => BusinessHoursInput.parse({ rows: sevenHoursRows.slice(1), version: 1 })).toThrow()
    expect(() =>
      BusinessHoursInput.parse({ rows: [...sevenHoursRows, hoursRow(0)], version: 1 }),
    ).toThrow()
    // 応答も同じ 7 行を返し、拒まなかったぶんの警告を添える。
    const view = BusinessHoursView.parse({
      rows: sevenHoursRows,
      blackouts: [
        BlackoutWindow.parse({
          id: UUID,
          weekday: 4,
          startsAt: '12:00',
          endsAt: '13:00',
          label: 'お昼',
          sortOrder: 1,
        }),
      ],
      version: 2,
      warnings: ['刻み（5分）が片付け（10分）より短くなっています。'],
    })
    expect([view.rows.length, view.warnings.length]).toEqual([7, 1])
  })

  it('同じ weekday を 2 行入れた本文を落とす', () => {
    const rows = [...sevenHoursRows.slice(0, 6), hoursRow(1)]
    expect(rows).toHaveLength(7)
    expect(() => BusinessHoursInput.parse({ rows, version: 1 })).toThrow()
  })
})

describe('BusinessHoursRow', () => {
  it('isClosed=false で closesAt <= opensAt の行を落とす', () => {
    expect(
      BusinessHoursRow.parse(hoursRow(5, { opensAt: '11:00', closesAt: '20:00' })).closesAt,
    ).toBe('20:00')
    for (const closesAt of ['10:00', '09:00']) {
      expect(() => BusinessHoursRow.parse(hoursRow(4, { closesAt }))).toThrow()
    }
  })

  it('isClosed=true なら opensAt と closesAt は null でなければならない', () => {
    const closed = BusinessHoursRow.parse({ weekday: 2, isClosed: true })
    expect([closed.opensAt, closed.closesAt]).toEqual([null, null])
    expect(() =>
      BusinessHoursRow.parse({ weekday: 2, isClosed: true, opensAt: '10:00', closesAt: null }),
    ).toThrow()
    expect(() =>
      BusinessHoursRow.parse({ weekday: 2, isClosed: true, opensAt: null, closesAt: '19:00' }),
    ).toThrow()
  })
})

describe('BlackoutWindowInput', () => {
  it('startsAt < endsAt を要求し、同時刻を落とす', () => {
    const noon = { weekday: 4, startsAt: '12:00', endsAt: '13:00', label: 'お昼' }
    expect(BlackoutWindowInput.parse(noon).sortOrder).toBe(0)
    expect(() => BlackoutWindowInput.parse({ ...noon, endsAt: '12:00' })).toThrow()
    expect(() => BlackoutWindowInput.parse({ ...noon, endsAt: '11:00' })).toThrow()
  })

  it('label は 1 文字ちょうどと 20 文字ちょうどを通し、0 文字と 21 文字を落とす', () => {
    const noon = { weekday: 4, startsAt: '12:00', endsAt: '13:00' }
    expect(BlackoutWindowInput.parse({ ...noon, label: '昼' }).label).toBe('昼')
    expect(BlackoutWindowInput.parse({ ...noon, label: 'あ'.repeat(20) }).label).toHaveLength(20)
    for (const label of ['', 'あ'.repeat(21)]) {
      expect(() => BlackoutWindowInput.parse({ ...noon, label })).toThrow()
    }
  })
})

describe('SlotRulesInput', () => {
  const base = { slotMinutes: 30, cleanupMinutes: 10, maxParallel: 3, version: 1 }

  it('slotMinutes は 5 と 120 を通し、4 と 121 を落とす', () => {
    expect(SlotRulesInput.parse({ ...base, slotMinutes: 5 }).slotMinutes).toBe(5)
    expect(SlotRulesInput.parse({ ...base, slotMinutes: 120 }).slotMinutes).toBe(120)
    for (const slotMinutes of [4, 121]) {
      expect(() => SlotRulesInput.parse({ ...base, slotMinutes })).toThrow()
    }
  })

  it('cleanupMinutes は 0 と 60 を通し、-1 と 61 を落とす', () => {
    expect(SlotRulesInput.parse({ ...base, cleanupMinutes: 0 }).cleanupMinutes).toBe(0)
    expect(SlotRulesInput.parse({ ...base, cleanupMinutes: 60 }).cleanupMinutes).toBe(60)
    for (const cleanupMinutes of [-1, 61]) {
      expect(() => SlotRulesInput.parse({ ...base, cleanupMinutes })).toThrow()
    }
  })

  it('maxParallel は 1 と 20 を通し、0 と 21 を落とす', () => {
    expect(SlotRulesInput.parse({ ...base, maxParallel: 1 }).maxParallel).toBe(1)
    expect(SlotRulesInput.parse({ ...base, maxParallel: 20 }).maxParallel).toBe(20)
    for (const maxParallel of [0, 21]) {
      expect(() => SlotRulesInput.parse({ ...base, maxParallel })).toThrow()
    }
  })
})

describe('SlotRulesView', () => {
  it('lastAcceptableAt は曜日 0..6 の 7 件で、休みの曜日は null を取る', () => {
    const rules = SlotRules.parse({
      slotMinutes: 30,
      cleanupMinutes: 10,
      maxParallel: 3,
      version: 1,
      updatedAt: NOW,
    })
    // 火曜（weekday=2）は定休なので枠が 1 つも無く、案内する時刻を持たない。
    const lastAcceptableAt = {
      '0': '17:20',
      '1': '18:20',
      '2': null,
      '3': '18:20',
      '4': '18:20',
      '5': '19:20',
      '6': '18:20',
    }
    const view = SlotRulesView.parse({ ...rules, lastAcceptableAt })
    expect(Object.keys(view.lastAcceptableAt)).toHaveLength(7)
    expect(view.lastAcceptableAt['2']).toBeNull()
    expect(view.warnings).toEqual([])
    const { '6': _saturday, ...six } = lastAcceptableAt
    expect(() => SlotRulesView.parse({ ...rules, lastAcceptableAt: six })).toThrow()
    expect(() =>
      SlotRulesView.parse({ ...rules, lastAcceptableAt: { ...lastAcceptableAt, '7': '18:20' } }),
    ).toThrow()
  })
})

describe('CalendarExceptionInput', () => {
  it("kind='special' は opensAt と closesAt の両方を要求する", () => {
    const special = { date: '2026-09-30', kind: 'special', opensAt: '12:00', closesAt: '17:00' }
    expect(CalendarExceptionInput.parse(special).note).toBeNull()
    expect(() => CalendarExceptionInput.parse({ ...special, closesAt: null })).toThrow()
    expect(() => CalendarExceptionInput.parse({ ...special, opensAt: null })).toThrow()
  })

  it("kind='closed' は opensAt と closesAt を持てない", () => {
    const closed = { date: '2026-09-30', kind: 'closed', note: '棚卸しのため' }
    expect(CalendarExceptionInput.parse(closed).note).toBe('棚卸しのため')
    expect(() => CalendarExceptionInput.parse({ ...closed, opensAt: '10:00' })).toThrow()
    expect(() => CalendarExceptionInput.parse({ ...closed, closesAt: '19:00' })).toThrow()
    // 同じ日をもう一度押すと行が消える。保存された行と削除の応答も同じ形に閉じる。
    expect(CalendarException.parse({ id: UUID, ...closed }).opensAt).toBeNull()
    expect(DeletedResult.parse({ id: UUID, deleted: true }).deleted).toBe(true)
  })
})

describe('CalendarExceptionQuery', () => {
  it('from から to までが 92 日ちょうどを通し、93 日を落とす', () => {
    expect(CalendarExceptionQuery.parse({ from: '2026-08-01', to: '2026-11-01' }).to).toBe(
      '2026-11-01',
    )
    expect(() => CalendarExceptionQuery.parse({ from: '2026-08-01', to: '2026-11-02' })).toThrow()
    // 逆向きの範囲も落とす（0 件を返すのではなく入力を直させる）。
    expect(() => CalendarExceptionQuery.parse({ from: '2026-11-01', to: '2026-08-01' })).toThrow()
  })
})

describe('SkillCode', () => {
  it('6 値ちょうどで、eye_exam のような別名を落とす', () => {
    expect(SkillCode.options).toEqual([
      'measure',
      'processing',
      'sales_reception',
      'fitting',
      'contact_lens',
      'repair',
    ])
    for (const alias of ['eye_exam', 'lens_work', 'reception']) {
      expect(() => SkillCode.parse(alias)).toThrow()
    }
  })
})

describe('StaffMember', () => {
  it('role は staff と manager の 2 値で、既定は staff', () => {
    expect(StaffMember.parse(staffMember).role).toBe('staff')
    expect(StaffMember.parse({ ...staffMember, role: 'manager' }).role).toBe('manager')
    expect(() => StaffMember.parse({ ...staffMember, role: 'owner' })).toThrow()
    // 追加・更新の入力も同じ 2 値に閉じる。
    expect(StaffMemberInput.parse({ displayName: '山田 大輔', role: 'manager' }).sortOrder).toBe(0)
    expect(StaffMemberPatch.parse({ role: 'manager', version: 1 }).role).toBe('manager')
  })

  it('maxParallelReservations は 1 と 5 を通し、0 と 6 を落とす。既定は 1', () => {
    expect(StaffMember.parse(staffMember).maxParallelReservations).toBe(1)
    expect(
      StaffMember.parse({ ...staffMember, maxParallelReservations: 5 }).maxParallelReservations,
    ).toBe(5)
    for (const maxParallelReservations of [0, 6]) {
      expect(() => StaffMember.parse({ ...staffMember, maxParallelReservations })).toThrow()
    }
  })

  it('pinHash を持たない（PIN のハッシュを外へ出さない）', () => {
    expect(() => StaffMember.parse({ ...staffMember, pinHash: 'argon2id$...' })).toThrow()
    expect(StaffMember.parse({ ...staffMember, pinUpdatedAt: NOW }).hasPin).toBe(true)
  })
})

describe('StaffSkillsInput', () => {
  it('0 件を通し、同じ技能を 2 回入れた本文を落とす', () => {
    expect(StaffSkillsInput.parse({ skills: [] }).skills).toEqual([])
    expect(StaffSkillsInput.parse({ skills: ['measure', 'processing'] }).skills).toHaveLength(2)
    expect(() => StaffSkillsInput.parse({ skills: ['measure', 'measure'] })).toThrow()
  })
})

describe('StaffShiftsInput', () => {
  const base = { staffId: UUID2, effectiveFrom: '2026-08-27', version: 1 }

  it('weekly は 7 行ちょうどで、6 行と 8 行を落とす', () => {
    expect(StaffShiftsInput.parse({ ...base, weekly: sevenWeeklyRows }).weekly).toHaveLength(7)
    expect(() => StaffShiftsInput.parse({ ...base, weekly: sevenWeeklyRows.slice(1) })).toThrow()
    expect(() =>
      StaffShiftsInput.parse({ ...base, weekly: [...sevenWeeklyRows, weeklyRow(0)] }),
    ).toThrow()
  })

  it('isOff=false の行は startsAt < endsAt を要求する', () => {
    const off = [
      ...sevenWeeklyRows.slice(0, 6),
      weeklyRow(6, { isOff: true, startsAt: null, endsAt: null }),
    ]
    expect(StaffShiftsInput.parse({ ...base, weekly: off }).weekly[6]?.isOff).toBe(true)
    for (const broken of [{ endsAt: '10:00' }, { endsAt: null }]) {
      const weekly = [...sevenWeeklyRows.slice(0, 6), weeklyRow(6, broken)]
      expect(() => StaffShiftsInput.parse({ ...base, weekly })).toThrow()
    }
  })

  it('休憩は startsAt と endsAt の両方があるか、両方無いかのどちらかである', () => {
    const withBreak = [
      ...sevenWeeklyRows.slice(0, 6),
      weeklyRow(6, { breaks: [{ startsAt: '13:00', endsAt: '14:00' }] }),
    ]
    expect(StaffShiftsInput.parse({ ...base, weekly: withBreak }).weekly[6]?.breaks).toHaveLength(1)
    expect(StaffShiftsInput.parse({ ...base, weekly: sevenWeeklyRows }).weekly[0]?.breaks).toEqual(
      [],
    )
    for (const breaks of [[{ startsAt: '13:00' }], [{ endsAt: '14:00' }]]) {
      const weekly = [...sevenWeeklyRows.slice(0, 6), weeklyRow(6, { breaks })]
      expect(() => StaffShiftsInput.parse({ ...base, weekly })).toThrow()
    }
  })
})

describe('StaffShiftQuery', () => {
  it('from から to までが 62 日ちょうどを通し、63 日を落とす', () => {
    expect(StaffShiftQuery.parse({ from: '2026-08-01', to: '2026-10-02' }).staffId).toBeUndefined()
    expect(() => StaffShiftQuery.parse({ from: '2026-08-01', to: '2026-10-03' })).toThrow()
    // 展開結果は読み取り専用。1 日ぶんの行はこの形で返る。
    expect(
      StaffShift.parse({
        id: UUID,
        staffId: UUID2,
        date: '2026-08-27',
        startsAt: '10:00',
        endsAt: '19:00',
        kind: 'work',
      }).kind,
    ).toBe('work')
    expect(StaffListQuery.parse({}).includeInactive).toBe(false)
  })
})

/**
 * 一覧の絞り込みは `zValidator('query', ...)` がクエリ文字列のまま渡す。
 * 文字列を受けないと Worker 側で手書きの `parse` が要り、その ZodError が
 * 500 `internal_error` に化ける（打ち間違えたクエリを故障として見せることになる）。
 */
describe('一覧のクエリ', () => {
  it('真偽値は true / 1 / false / 0 の文字列で届き、知らない語を落とす', () => {
    expect(StaffListQuery.parse({ includeInactive: 'true' }).includeInactive).toBe(true)
    expect(StaffListQuery.parse({ includeInactive: '1' }).includeInactive).toBe(true)
    expect(EquipmentListQuery.parse({ includeInactive: 'false' }).includeInactive).toBe(false)
    expect(PurposeListQuery.parse({ webPublishedOnly: '0' }).webPublishedOnly).toBe(false)
    expect(() => StaffListQuery.parse({ includeInactive: 'yes' })).toThrow()
    expect(() => PurposeListQuery.parse({ includeInactive: '' })).toThrow()
  })

  it('真偽値そのものも受ける（サーバ内で値から組み立てる呼び出しを壊さない）', () => {
    expect(StaffListQuery.parse({ includeInactive: true }).includeInactive).toBe(true)
    expect(EquipmentListQuery.parse({ includeInactive: false }).includeInactive).toBe(false)
  })

  it('日付・種別・id の形が違うクエリを落とす', () => {
    expect(() => StaffListQuery.parse({ date: '2026-8-7' })).toThrow()
    expect(() => EquipmentListQuery.parse({ kind: 'fitting' })).toThrow()
    expect(() => PurposeListQuery.parse({ storeId: 'not-a-uuid' })).toThrow()
  })
})

describe('EquipmentKind', () => {
  it('measure / counter / workbench の 3 値だけを取る', () => {
    expect(EquipmentKind.options).toEqual(['measure', 'counter', 'workbench'])
    for (const kind of ['fitting', 'room', 'desk']) {
      expect(() => EquipmentKind.parse(kind)).toThrow()
    }
    expect(EquipmentListQuery.parse({ kind: 'counter' }).includeInactive).toBe(false)
  })
})

describe('Equipment', () => {
  it('capacity は 1 と 10 を通し、0 と 11 を落とす', () => {
    expect(Equipment.parse(equipment).capacity).toBe(1)
    expect(Equipment.parse({ ...equipment, capacity: 10 }).capacity).toBe(10)
    for (const capacity of [0, 11]) {
      expect(() => Equipment.parse({ ...equipment, capacity })).toThrow()
    }
  })

  it('roleLabel は 1 文字ちょうどと 20 文字ちょうどを通す', () => {
    expect(Equipment.parse({ ...equipment, roleLabel: '加' }).roleLabel).toBe('加')
    expect(Equipment.parse({ ...equipment, roleLabel: 'あ'.repeat(20) }).roleLabel).toHaveLength(20)
    for (const roleLabel of ['', 'あ'.repeat(21)]) {
      expect(() => Equipment.parse({ ...equipment, roleLabel })).toThrow()
    }
  })

  it('ledgerDisplay は grey と hide の 2 値', () => {
    expect(Equipment.parse({ ...equipment, ledgerDisplay: 'hide' }).ledgerDisplay).toBe('hide')
    expect(() => Equipment.parse({ ...equipment, ledgerDisplay: 'show' })).toThrow()
    // 追加のときだけ「灰色にして残す」を既定にする。
    expect(
      EquipmentInput.parse({ name: '加工室', kind: 'workbench', roleLabel: '加工' }).ledgerDisplay,
    ).toBe('grey')
    expect(EquipmentPatch.parse({ ledgerDisplay: 'hide', version: 1 }).ledgerDisplay).toBe('hide')
  })
})

describe('EquipmentMaintenanceInput', () => {
  it('startsAt < endsAt を要求し、同時刻を落とす', () => {
    const window = {
      startsAt: '2026-08-28T01:00:00.000Z',
      endsAt: '2026-08-28T03:00:00.000Z',
      note: '定期点検（メーカー来店）',
    }
    expect(EquipmentMaintenanceInput.parse(window).note).toBe('定期点検（メーカー来店）')
    expect(() => EquipmentMaintenanceInput.parse({ ...window, endsAt: window.startsAt })).toThrow()
    expect(
      EquipmentMaintenance.parse({ id: UUID, equipmentId: UUID2, ...window }).equipmentId,
    ).toBe(UUID2)
    expect(MaintenanceQuery.parse({ from: '2026-08-01', to: '2026-11-01' }).from).toBe('2026-08-01')
  })
})

describe('VisitPurpose', () => {
  it('nameShort は 1 文字ちょうどと 5 文字ちょうどを通し、6 文字を落とす', () => {
    expect(VisitPurpose.parse({ ...visitPurpose, nameShort: '修' }).nameShort).toBe('修')
    expect(VisitPurpose.parse({ ...visitPurpose, nameShort: 'コンタクト' }).nameShort).toHaveLength(
      5,
    )
    for (const nameShort of ['', 'あ'.repeat(6)]) {
      expect(() => VisitPurpose.parse({ ...visitPurpose, nameShort })).toThrow()
    }
  })

  it('durationMinutes は 5 の倍数だけを取り、25 を通し 26 を落とす', () => {
    expect(VisitPurpose.parse({ ...visitPurpose, durationMinutes: 25 }).durationMinutes).toBe(25)
    expect(() => VisitPurpose.parse({ ...visitPurpose, durationMinutes: 26 })).toThrow()
    expect(
      VisitPurposeInput.parse({
        nameInternal: '視力測定だけ',
        namePublic: '視力測定',
        nameShort: '視力測定',
        durationMinutes: 30,
      }).isWebPublished,
    ).toBe(true)
    expect(VisitPurposePatch.parse({ durationMinutes: 60, version: 1 }).durationMinutes).toBe(60)
    expect(PurposeListQuery.parse({}).webPublishedOnly).toBe(false)
  })
})

describe('PurposeRequirementsInput', () => {
  it("kind='skill' は 1 行まで、kind='equipment_kind' は 2 行までを通す", () => {
    const requirements = [
      PurposeRequirement.parse({ kind: 'skill', value: 'measure' }),
      { kind: 'equipment_kind', value: 'measure' },
      { kind: 'equipment_kind', value: 'counter' },
    ]
    expect(PurposeRequirementsInput.parse({ requirements }).requirements).toHaveLength(3)
    expect(PurposeRequirementsInput.parse({ requirements: [] }).requirements).toEqual([])
  })

  it('skill が 2 行、equipment_kind が 3 行の本文を落とす', () => {
    expect(() =>
      PurposeRequirementsInput.parse({
        requirements: [
          { kind: 'skill', value: 'measure' },
          { kind: 'skill', value: 'fitting' },
        ],
      }),
    ).toThrow()
    expect(() =>
      PurposeRequirementsInput.parse({
        requirements: [
          { kind: 'equipment_kind', value: 'measure' },
          { kind: 'equipment_kind', value: 'counter' },
          { kind: 'equipment_kind', value: 'workbench' },
        ],
      }),
    ).toThrow()
    // 同じ要求を 2 回書くのも落とす。
    expect(() =>
      PurposeRequirementsInput.parse({
        requirements: [
          { kind: 'equipment_kind', value: 'counter' },
          { kind: 'equipment_kind', value: 'counter' },
        ],
      }),
    ).toThrow()
  })

  it("kind='skill' の value に equipment_kind の値を入れた本文を落とす", () => {
    expect(() =>
      PurposeRequirementsInput.parse({ requirements: [{ kind: 'skill', value: 'workbench' }] }),
    ).toThrow()
    expect(() =>
      PurposeRequirementsInput.parse({
        requirements: [{ kind: 'equipment_kind', value: 'sales_reception' }],
      }),
    ).toThrow()
  })
})

describe('PurposeOrderInput', () => {
  it('重複した purposeId を落とす', () => {
    expect(PurposeOrderInput.parse({ purposeIds: [UUID, UUID2] }).purposeIds).toHaveLength(2)
    expect(() => PurposeOrderInput.parse({ purposeIds: [UUID, UUID] })).toThrow()
    expect(() => PurposeOrderInput.parse({ purposeIds: [] })).toThrow()
  })
})

describe('SettingsImpactRequest', () => {
  it('kind ごとに draft の形が変わる（equipment_stop / purpose_duration / business_hours）', () => {
    const stop = SettingsImpactRequest.parse({
      storeId: UUID,
      kind: 'equipment_stop',
      draft: {
        equipmentId: UUID2,
        startsAt: '2026-08-28T01:00:00.000Z',
        endsAt: '2026-08-28T03:00:00.000Z',
      },
    })
    expect(stop.kind).toBe('equipment_stop')
    const duration = SettingsImpactRequest.parse({
      storeId: UUID,
      kind: 'purpose_duration',
      draft: { purposeId: UUID2, durationMinutes: 60, from: '2026-08-28', to: '2026-09-27' },
    })
    expect(duration.kind).toBe('purpose_duration')
    const hours = SettingsImpactRequest.parse({
      storeId: UUID,
      kind: 'business_hours',
      draft: { rows: sevenHoursRows },
    })
    expect(hours.kind).toBe('business_hours')
    // 別の kind の draft を差し込んだ本文は落ちる。
    expect(() =>
      SettingsImpactRequest.parse({
        storeId: UUID,
        kind: 'equipment_stop',
        draft: { purposeId: UUID2, durationMinutes: 60, from: '2026-08-28', to: '2026-09-27' },
      }),
    ).toThrow()
    expect(() =>
      SettingsImpactRequest.parse({ storeId: UUID, kind: 'purpose_duration', draft: {} }),
    ).toThrow()
  })
})

describe('SettingsImpactReport', () => {
  it('severity は影響 0 件のとき info、1 件以上のとき action', () => {
    const item = {
      at: '2026-08-28T01:30:00.000Z',
      label: '山口 真央 様　視力測定',
      targetType: 'reservation',
      targetId: UUID2,
    }
    const quiet = SettingsImpactReport.parse({ lastAcceptableAt: '18:20', severity: 'info' })
    expect(quiet.affectedReservations).toEqual([])
    expect(
      SettingsImpactReport.parse({
        affectedReservations: [item],
        lastAcceptableAt: null,
        severity: 'action',
      }).severity,
    ).toBe('action')
    // 数えた件数と札の色が食い違う応答は作らせない（AC-SET-14）。
    expect(() =>
      SettingsImpactReport.parse({ affectedReservations: [item], severity: 'info' }),
    ).toThrow()
    expect(() => SettingsImpactReport.parse({ affectedWebSlots: [], severity: 'action' })).toThrow()
  })
})

describe('SettingsImpactItem', () => {
  it('label は 1 文字ちょうどと 80 文字ちょうどを通す', () => {
    const base = { at: '2026-08-28T01:30:00.000Z', targetType: 'web_slot' }
    expect(SettingsImpactItem.parse({ ...base, label: '空' }).targetId).toBeNull()
    expect(SettingsImpactItem.parse({ ...base, label: 'あ'.repeat(80) }).label).toHaveLength(80)
    for (const label of ['', 'あ'.repeat(81)]) {
      expect(() => SettingsImpactItem.parse({ ...base, label })).toThrow()
    }
  })
})

/* --------------------------------------------------------------------------- *
 * P2 空き枠と予約台帳（`005-availability-and-ledger`）
 * --------------------------------------------------------------------------- */

/** 1 本のテストで 6 件の id を並べるための連番。UUID v4 の形は保つ。 */
const uuidOf = (n: number): string => `${n}1111111-2222-4333-8444-555555555555`

const START = '2026-08-27T02:00:00.000Z'
const END = '2026-08-27T03:00:00.000Z'

const ledgerEntry = {
  reservationId: UUID,
  startsAt: START,
  endsAt: END,
  purposeLabel: '新調相談・視力測定',
  source: 'phone',
  status: 'confirmed',
  isUnassigned: false,
}

const ledgerLane = {
  kind: 'staff',
  id: UUID2,
  name: '佐藤 美咲',
  subtitle: '視力測定・加工',
  entries: [ledgerEntry],
}

const ledgerView = {
  date: '2026-08-27',
  axis: 'staff',
  view: 'timetable',
  opensAt: '10:00',
  closesAt: '19:00',
  slotMinutes: 30,
  lanes: [ledgerLane],
  counts: { all: 12, upcoming: 7, pendingReview: 1 },
  walkinWaitingCount: 2,
  estimatedWaitMinutes: 15,
  nextTicketNo: 5,
  serverNow: NOW,
}

const purposeLine = {
  purposeId: UUID2,
  nameInternal: 'メガネを新しく作る',
  durationMinutes: 60,
  sortOrder: 0,
}

const reservationDetail = {
  id: UUID,
  code: 'EY-2608-0142',
  storeId: UUID2,
  source: 'phone',
  status: 'confirmed',
  startsAt: START,
  endsAt: END,
  durationMinutes: 60,
  purposes: [purposeLine],
  assignments: [{ kind: 'staff', targetId: UUID2, startsAt: START, endsAt: END }],
  purposeLabel: '新調相談',
  purposeLabelInternal: 'メガネを新しく作る',
  version: 1,
  createdAt: NOW,
  updatedAt: NOW,
}

const availabilitySlot = { startsAt: START, endsAt: END, remaining: 2, isAvailable: true }

const availabilityResponse = {
  date: '2026-08-27',
  opensAt: '10:00',
  closesAt: '19:00',
  isClosed: false,
  slotMinutes: 30,
  cleanupMinutes: 10,
  durationMinutes: 60,
  slots: [availabilitySlot],
  lanes: [
    {
      kind: 'staff',
      id: UUID2,
      name: '佐藤 美咲',
      subtitle: '視力測定・加工',
      slots: [availabilitySlot],
    },
  ],
  serverNow: NOW,
}

describe('LedgerQuery', () => {
  it('axis の既定は staff、view の既定は timetable、filter の既定は all', () => {
    const query = LedgerQuery.parse({ storeId: UUID, date: '2026-08-27' })
    expect([query.axis, query.view, query.filter]).toEqual(['staff', 'timetable', 'all'])
    // 並べ方（axis）と表示のかたち（view）は別のセグメントで、4 通りすべてが有効である。
    // 1 つの enum にまとめると `axis=resource` のまま予約リストへ切り替えられなくなる。
    expect(LedgerAxis.options).toEqual(['staff', 'resource'])
    expect(LedgerViewMode.options).toEqual(['timetable', 'list'])
    expect(LedgerFilter.options).toEqual(['all', 'upcoming', 'pending'])
    const swapped = LedgerQuery.parse({
      storeId: UUID,
      date: '2026-08-27',
      axis: 'resource',
      view: 'list',
      filter: 'upcoming',
    })
    expect([swapped.axis, swapped.view, swapped.filter]).toEqual(['resource', 'list', 'upcoming'])
  })

  it('axis に equipment を渡すと落ちる（URL に乗る語は resource）', () => {
    expect(LedgerQuery.parse({ storeId: UUID, date: '2026-08-27', axis: 'resource' }).axis).toBe(
      'resource',
    )
    // 応答の中の `LedgerLane.kind` は `equipment` だが、URL のクエリに乗る語は `resource`。
    expect(() =>
      LedgerQuery.parse({ storeId: UUID, date: '2026-08-27', axis: 'equipment' }),
    ).toThrow()
  })

  it('filter に pending_review を渡すと落ちる（語は pending）', () => {
    expect(LedgerQuery.parse({ storeId: UUID, date: '2026-08-27', filter: 'pending' }).filter).toBe(
      'pending',
    )
    expect(() =>
      LedgerQuery.parse({ storeId: UUID, date: '2026-08-27', filter: 'pending_review' }),
    ).toThrow()
  })

  it('date は YYYY-MM-DD だけを受ける（2026-8-7 は落ちる）', () => {
    expect(LedgerQuery.parse({ storeId: UUID, date: '2026-08-27' }).date).toBe('2026-08-27')
    for (const date of ['2026-8-7', '2026/08/27', '']) {
      expect(() => LedgerQuery.parse({ storeId: UUID, date })).toThrow()
    }
    expect(() => LedgerQuery.parse({ storeId: 'ginza', date: '2026-08-27' })).toThrow()
  })
})

describe('LedgerView', () => {
  it('serverNow が無い応答は落ちる（現在時刻の線の出どころだから）', () => {
    expect(LedgerView.parse(ledgerView).serverNow).toBe(NOW)
    const { serverNow: _dropped, ...withoutNow } = ledgerView
    // 端末の時計を読ませないために、現在時刻は必ず応答に載せる（AC-LEDGER-03）。
    expect(() => LedgerView.parse(withoutNow)).toThrow()
    expect(() => LedgerView.parse({ ...ledgerView, serverNow: '2026-08-27 11:08' })).toThrow()
  })

  it('定休日は opensAt と closesAt が null でも通る', () => {
    const closed = LedgerView.parse({
      ...ledgerView,
      opensAt: null,
      closesAt: null,
      lanes: [],
      counts: { all: 0, upcoming: 0, pendingReview: 0 },
    })
    expect([closed.opensAt, closed.closesAt]).toEqual([null, null])
    expect(closed.lanes).toEqual([])
  })

  it('counts は all / upcoming / pendingReview の 3 つを必ず持つ', () => {
    expect(LedgerView.parse(ledgerView).counts).toEqual({ all: 12, upcoming: 7, pendingReview: 1 })
    for (const counts of [
      { all: 12, upcoming: 7 },
      { all: 12, pendingReview: 1 },
      { all: 12, upcoming: 7, pendingReview: 1, cancelled: 2 },
      { all: 12, upcoming: 7, pendingReview: -1 },
    ]) {
      expect(() => LedgerView.parse({ ...ledgerView, counts })).toThrow()
    }
  })
})

describe('LedgerLane', () => {
  it('kind は staff / equipment / unassigned / walkin の 4 値', () => {
    expect(LedgerLane.parse(ledgerLane).kind).toBe('staff')
    expect(LedgerLane.parse({ ...ledgerLane, kind: 'equipment', name: '視力測定機 A' }).kind).toBe(
      'equipment',
    )
    for (const kind of ['resource', 'room', 'break']) {
      expect(() => LedgerLane.parse({ ...ledgerLane, kind })).toThrow()
    }
  })

  it('unassigned と walkin の行は id が null でよい', () => {
    // 「担当が未定」と「ご来店お待ち」は担当者でも設備でもない擬似行なので id を持たない。
    const unassigned = LedgerLane.parse({ kind: 'unassigned', id: null, name: '担当が未定' })
    expect([unassigned.entries, unassigned.blocks]).toEqual([[], []])
    // 待っている人数は行見出しの副文に出す。`walk_ins` は 008 なので P2 は 0名 のまま。
    const walkin = LedgerLane.parse({
      kind: 'walkin',
      id: null,
      name: 'ご来店お待ち',
      subtitle: '0名',
    })
    expect(walkin.subtitle).toBe('0名')
  })
})

describe('LedgerEntry', () => {
  it('customerName と visitCount は null を許す（顧客は 007 で足す）', () => {
    const entry = LedgerEntry.parse(ledgerEntry)
    expect([entry.customerName, entry.visitCount]).toEqual([null, null])
    expect(entry.isUnassigned).toBe(false)
    expect(ReservationStatus.options).toHaveLength(6)
    const named = LedgerEntry.parse({ ...ledgerEntry, customerName: '山口 真央', visitCount: 3 })
    expect([named.customerName, named.visitCount]).toEqual(['山口 真央', 3])
    expect(() => LedgerEntry.parse({ ...ledgerEntry, visitCount: -1 })).toThrow()
    // 帯は半開区間。左右が逆の帯は台帳に置けない。
    expect(() => LedgerEntry.parse({ ...ledgerEntry, startsAt: END, endsAt: START })).toThrow()
  })
})

describe('LedgerBlock', () => {
  it('kind は break / maintenance / closed の 3 値で、label は 30 文字まで', () => {
    const block = { startsAt: START, endsAt: END, label: '休憩' }
    for (const kind of ['break', 'maintenance', 'closed']) {
      expect(LedgerBlock.parse({ ...block, kind }).kind).toBe(kind)
    }
    for (const kind of ['lunch', 'blackout', 'staff']) {
      expect(() => LedgerBlock.parse({ ...block, kind })).toThrow()
    }
    expect(
      LedgerBlock.parse({ ...block, kind: 'break', label: 'あ'.repeat(30) }).label,
    ).toHaveLength(30)
    expect(() => LedgerBlock.parse({ ...block, kind: 'break', label: 'あ'.repeat(31) })).toThrow()
  })
})

describe('ReservationSource', () => {
  it('phone / counter / web / walkin の 4 値だけを受ける', () => {
    for (const source of ['phone', 'counter', 'web', 'walkin']) {
      expect(ReservationSource.parse(source)).toBe(source)
    }
    expect(ReservationSource.options).toHaveLength(4)
    // 店頭（`counter`）と予約なしのご来店（`walkin`）は業務上まったく別で、まとめない。
    for (const source of ['front', 'shop', 'telephone', 'web_booking']) {
      expect(() => ReservationSource.parse(source)).toThrow()
    }
  })
})

describe('ReservationAssignment', () => {
  it('targetId は null を許す（あとで決める）', () => {
    const undecided = ReservationAssignment.parse({ kind: 'staff', startsAt: START, endsAt: END })
    expect(undecided.targetId).toBeNull()
    expect(
      ReservationAssignment.parse({
        kind: 'equipment',
        targetId: UUID,
        startsAt: START,
        endsAt: END,
      }).targetId,
    ).toBe(UUID)
    for (const kind of ['unassigned', 'walkin', 'resource']) {
      expect(() => ReservationAssignment.parse({ kind, startsAt: START, endsAt: END })).toThrow()
    }
  })
})

describe('ReservationDetail', () => {
  it('purposes は 5 件まで。0 件でも読める（1 件以上は書く側の不変条件）', () => {
    expect(ReservationDetail.parse(reservationDetail).purposes).toHaveLength(1)
    expect(ReservationPurposeLine.parse(purposeLine).sortOrder).toBe(0)
    const five = [0, 1, 2, 3, 4].map((n) => ({ ...purposeLine, purposeId: uuidOf(n + 1) }))
    expect(ReservationDetail.parse({ ...reservationDetail, purposes: five }).purposes).toHaveLength(
      5,
    )
    // 0 件を落とすと、`reservation_purposes` が 1 行欠けただけでご予約 1 件の詳細が
    // まるごと 500 になる。D1 に CHECK は無いので、読む側は 0 件でも本文を返す。
    expect(
      ReservationDetail.parse({ ...reservationDetail, purposes: [], purposeLabel: '' }).purposes,
    ).toEqual([])
    expect(ReservationDetail.parse({ ...reservationDetail, assignments: [] }).assignments).toEqual(
      [],
    )
    expect(() =>
      ReservationDetail.parse({
        ...reservationDetail,
        purposes: [...five, { ...purposeLine, purposeId: uuidOf(6) }],
      }),
    ).toThrow()
  })

  it('code は EY-2608-0142 の形。EY-W- で始まる番号は落ちる', () => {
    expect(ReservationCode.parse('EY-2608-0142')).toBe('EY-2608-0142')
    // 9999 を越えた月は 5 桁へ桁上げする。
    expect(ReservationDetail.parse({ ...reservationDetail, code: 'EY-2608-10000' }).code).toBe(
      'EY-2608-10000',
    )
    // お客様に見せる Web のご予約番号は別の採番系統で、`reservations.code` には入らない。
    for (const code of ['EY-W-2608-0031', 'EY-2608-142', 'ey-2608-0142', '2608-0142']) {
      expect(() => ReservationDetail.parse({ ...reservationDetail, code })).toThrow()
    }
    expect(WebBookingCode.parse('EY-W-2608-0031')).toBe('EY-W-2608-0031')
    expect(() => WebBookingCode.parse('EY-2608-0142')).toThrow()
  })

  it('carries the customer shown in the ledger detail heading — three fields or none', () => {
    // AC-CUST-25. The heading needs a person, and a walk-in-shaped reservation has none.
    const named = ReservationDetail.parse({
      ...reservationDetail,
      customerId: UUID2,
      customerName: '田中 花子',
      visitCount: 4,
    })
    expect(named.customerName).toBe('田中 花子')
    expect(named.visitCount).toBe(4)
    const anonymous = ReservationDetail.parse({
      ...reservationDetail,
      customerId: null,
      customerName: null,
      visitCount: null,
    })
    expect(anonymous).toMatchObject({ customerId: null, customerName: null, visitCount: null })
    // A visit count is never negative, and the id is a uuid or nothing.
    expect(() => ReservationDetail.parse({ ...reservationDetail, visitCount: -1 })).toThrow()
    expect(() => ReservationDetail.parse({ ...reservationDetail, customerId: 'G-01842' })).toThrow()
  })

  it('webBookingCode は source が web のときだけ非 null になる', () => {
    expect(ReservationDetail.parse(reservationDetail).webBookingCode).toBeNull()
    expect(
      ReservationDetail.parse({
        ...reservationDetail,
        source: 'web',
        webBookingCode: 'EY-W-2608-0031',
      }).webBookingCode,
    ).toBe('EY-W-2608-0031')
    // お電話のご予約に Web のご予約番号は生えない。
    expect(() =>
      ReservationDetail.parse({ ...reservationDetail, webBookingCode: 'EY-W-2608-0031' }),
    ).toThrow()
    // Web から入ったご予約は必ずお客様に読み上げる番号を持つ。
    expect(() => ReservationDetail.parse({ ...reservationDetail, source: 'web' })).toThrow()
  })
})

describe('AvailabilityQuery', () => {
  it('purposeIds はカンマ区切りで最大 5 件、6 件目で落ちる', () => {
    const base = { storeId: UUID, date: '2026-08-27' }
    expect(AvailabilityQuery.parse(base).purposeIds).toEqual([])
    const five = [1, 2, 3, 4, 5].map(uuidOf)
    expect(AvailabilityQuery.parse({ ...base, purposeIds: five.join(',') }).purposeIds).toEqual(
      five,
    )
    expect(() =>
      AvailabilityQuery.parse({ ...base, purposeIds: [...five, uuidOf(6)].join(',') }),
    ).toThrow()
    expect(() => AvailabilityQuery.parse({ ...base, purposeIds: 'ginza,shinjuku' })).toThrow()
    // 設備の絞り込みも同じ形で受ける。
    expect(AvailabilityQuery.parse({ ...base, equipmentIds: uuidOf(1) }).equipmentIds).toEqual([
      uuidOf(1),
    ])
    expect(AvailabilityQuery.parse({ ...base, axis: 'resource' }).axis).toBe('resource')
  })

  it('durationMinutes は 5 の倍数で 5〜480', () => {
    const base = { storeId: UUID, date: '2026-08-27' }
    expect(AvailabilityQuery.parse(base).durationMinutes).toBeUndefined()
    // クエリ文字列は必ず文字列で届く（`?durationMinutes=60`）。
    expect(AvailabilityQuery.parse({ ...base, durationMinutes: '60' }).durationMinutes).toBe(60)
    expect(AvailabilityQuery.parse({ ...base, durationMinutes: 5 }).durationMinutes).toBe(5)
    expect(AvailabilityQuery.parse({ ...base, durationMinutes: 480 }).durationMinutes).toBe(480)
    for (const durationMinutes of [0, 3, 45.5, 485, '61', 'いっぱい']) {
      expect(() => AvailabilityQuery.parse({ ...base, durationMinutes })).toThrow()
    }
  })
})

describe('AvailabilityReason', () => {
  it('12 値をすべて受け、知らない語は落ちる', () => {
    expect(AvailabilityReason.options).toEqual([
      'closed',
      'outside_hours',
      'break',
      'maintenance',
      'staff_busy',
      'staff_off',
      // 「すべて埋まっている」と「1 台も無い」は別の理由。前者は時間をずらせば取れ、
      // 後者は設定を直すまで何時でも取れない（BOOK-02b が理由をそのまま文にする）。
      'equipment_busy',
      'no_equipment',
      'no_skill',
      'max_parallel',
      'web_window',
      'lead_time',
    ])
    for (const reason of ['full', 'holiday', 'busy', 'unknown']) {
      expect(() => AvailabilityReason.parse(reason)).toThrow()
    }
  })
})

describe('AvailabilitySlot', () => {
  it('remaining は 0 以上。−1 は落ちる', () => {
    expect(AvailabilitySlot.parse(availabilitySlot).remaining).toBe(2)
    const full = AvailabilitySlot.parse({
      ...availabilitySlot,
      remaining: 0,
      isAvailable: false,
      reason: 'max_parallel',
    })
    expect([full.remaining, full.reason]).toEqual([0, 'max_parallel'])
    expect(AvailabilitySlot.parse(availabilitySlot).staffIds).toEqual([])
    for (const remaining of [-1, 1.5]) {
      expect(() => AvailabilitySlot.parse({ ...availabilitySlot, remaining })).toThrow()
    }
  })
})

describe('AvailabilityResponse', () => {
  it('定休日は isClosed が true で slots が空でも通る', () => {
    expect(AvailabilityResponse.parse(availabilityResponse).slots).toHaveLength(1)
    const closed = AvailabilityResponse.parse({
      ...availabilityResponse,
      opensAt: null,
      closesAt: null,
      isClosed: true,
      slots: [],
      lanes: [],
    })
    expect([closed.isClosed, closed.slots, closed.alternatives]).toEqual([true, [], []])
  })

  it('枠が 0 件の理由を本文で持つ（定休日は closed、お受けできないご用件は purpose_unavailable）', () => {
    // 既定は null。置ける枠が 1 つでもある日は理由を持たない。
    expect(AvailabilityResponse.parse(availabilityResponse).reason).toBeNull()
    for (const reason of ['closed', 'purpose_unavailable']) {
      expect(
        AvailabilityResponse.parse({ ...availabilityResponse, slots: [], lanes: [], reason })
          .reason,
      ).toBe(reason)
    }
    // 枠ごとの語彙（12 値）に `purpose_unavailable` は入れない。応答だけの語である。
    expect(() => AvailabilityReason.parse('purpose_unavailable')).toThrow()
    expect(() =>
      AvailabilityResponse.parse({ ...availabilityResponse, reason: 'store_closed' }),
    ).toThrow()
  })

  it('alternatives は 3 件まで', () => {
    const three = [1, 2, 3].map(() => availabilitySlot)
    expect(
      AvailabilityResponse.parse({ ...availabilityResponse, alternatives: three }).alternatives,
    ).toHaveLength(3)
    expect(() =>
      AvailabilityResponse.parse({
        ...availabilityResponse,
        alternatives: [...three, availabilitySlot],
      }),
    ).toThrow()
  })
})

describe('台帳と空き枠の応答', () => {
  it('いずれの応答スキーマも知らないキーを 1 つ混ぜると落ちる', () => {
    const reservationSummary = {
      id: UUID,
      code: 'EY-2608-0142',
      startsAt: START,
      durationMinutes: 60,
      status: 'confirmed',
      source: 'phone',
      purposeLabel: '新調相談',
    }
    expect(ReservationSummary.parse(reservationSummary).staffName).toBeNull()
    const cases: [{ parse: (input: unknown) => unknown }, Record<string, unknown>][] = [
      [LedgerView, ledgerView],
      [LedgerLane, ledgerLane],
      [LedgerEntry, ledgerEntry],
      [LedgerBlock, { kind: 'break', startsAt: START, endsAt: END, label: '休憩' }],
      [ReservationDetail, reservationDetail],
      [ReservationSummary, reservationSummary],
      [ReservationAssignment, { kind: 'staff', startsAt: START, endsAt: END }],
      [AvailabilitySlot, availabilitySlot],
      [AvailabilityLane, { kind: 'unassigned', id: null, name: '担当が未定' }],
      [AvailabilityResponse, availabilityResponse],
    ]
    for (const [schema, valid] of cases) {
      expect(() => schema.parse(valid)).not.toThrow()
      expect(() => schema.parse({ ...valid, customerPhone: '090-1234-5678' })).toThrow()
    }
  })
})

/* --------------------------------------------------------------------------- *
 * P3 電話・店頭からの予約受付（`006-booking-flow`）
 * --------------------------------------------------------------------------- */

const staffReservationCreate = {
  storeId: UUID,
  startsAt: START,
  purposeIds: [UUID2],
  source: 'phone',
}

const holdInput = { storeId: UUID, startsAt: START, durationMinutes: 60 }

/** 仮の押さえは 420 秒（7 分）。BOOK-05-CONFIRM の `11:11` と「11:18 まで」の差である。 */
const HOLD_EXPIRES_AT = '2026-08-27T02:15:00.000Z'

const hold = {
  id: UUID,
  startsAt: START,
  endsAt: END,
  expiresAt: HOLD_EXPIRES_AT,
}

const receptionDraft = {
  purposeIds: [UUID2],
  staffId: UUID2,
  equipmentIds: [uuidOf(3)],
  startsAt: START,
  durationMinutes: 60,
  phoneTyped: '090-1234-5',
  nameTyped: '田中 花',
  kanaTyped: 'たなか はな',
  noteTyped: '遠近両用のご相談',
  handwritingKeys: [`notes/${ORG}/sessions/${UUID}/${UUID2}.svg`],
}

const receptionSession = {
  id: UUID,
  storeId: UUID2,
  startedAt: NOW,
  createdAt: NOW,
  draft: receptionDraft,
}

describe('ReservationCode', () => {
  it('accepts EY-2608-0142 and the five-digit carry EY-2608-10000', () => {
    expect(ReservationCode.parse('EY-2608-0142')).toBe('EY-2608-0142')
    // 組織 × YYMM の連番が 9999 を越えた月だけ 5 桁になる（書式は 1 種類のまま）。
    expect(ReservationCode.parse('EY-2608-10000')).toBe('EY-2608-10000')
    // 年をまたぐと YYMM が 2612 から 2701 になり、連番は 1 に戻る。
    expect(ReservationCode.parse('EY-2701-0001')).toBe('EY-2701-0001')
  })

  it('rejects a store prefix, a three-digit serial and a lowercase ey', () => {
    // 採番は組織ごと・YYMM ごとの 1 列で、店舗を頭に付けない（店舗が違っても同じ列を使う）。
    for (const code of [
      'GINZA-EY-2608-0142',
      'EY-GZ-2608-0142',
      'EY-2608-142',
      'ey-2608-0142',
      'EY-2608-100000',
    ]) {
      expect(() => ReservationCode.parse(code)).toThrow()
    }
  })
})

describe('StaffReservationCreate', () => {
  it('accepts a phone booking with one purpose and no staff', () => {
    const created = StaffReservationCreate.parse(staffReservationCreate)
    expect(created.source).toBe('phone')
    expect(created.equipmentIds).toEqual([])
    // 省略した所要は目的の合計から決める（サーバが決めるので既定値を作らない）。
    expect(created.durationMinutes).toBeUndefined()
    expect([created.noteCustomer, created.noteInternal]).toEqual(['', ''])
    // 押さえも受付セッションも任意。期限切れの `holdId` で確定を止めない。
    expect([created.holdId, created.receptionSessionId]).toEqual([undefined, undefined])
    // お客様は P4 まで結びつかない（`reservations.customer_id` は常に NULL）。
    expect(created.customerId).toBeUndefined()
  })

  it('treats a null staffId as decide-later and keeps it distinct from omitted', () => {
    // null =「担当はあとで決める」を押した。未定でも枠は消費するので行を作る。
    expect(
      StaffReservationCreate.parse({ ...staffReservationCreate, staffId: null }).staffId,
    ).toBeNull()
    // 欄そのものが無い =「まだ伺っていない」。既定値で null に潰すと、押していない
    // 端末の本文が「あとで決める」に化けて、受付の意図が消える。
    expect(StaffReservationCreate.parse(staffReservationCreate).staffId).toBeUndefined()
    expect(
      StaffReservationCreate.parse({ ...staffReservationCreate, staffId: UUID2 }).staffId,
    ).toBe(UUID2)
    expect(() =>
      StaffReservationCreate.parse({ ...staffReservationCreate, staffId: 'あとで' }),
    ).toThrow()
  })

  it('bounds purposeIds to 1..5 and equipmentIds to 0..5', () => {
    const five = [1, 2, 3, 4, 5].map(uuidOf)
    expect(
      StaffReservationCreate.parse({ ...staffReservationCreate, purposeIds: five }).purposeIds,
    ).toHaveLength(5)
    // 目的の無い予約は受け付けない（所要も復唱の文も作れない）。
    expect(() =>
      StaffReservationCreate.parse({ ...staffReservationCreate, purposeIds: [] }),
    ).toThrow()
    expect(() =>
      StaffReservationCreate.parse({
        ...staffReservationCreate,
        purposeIds: [...five, uuidOf(6)],
      }),
    ).toThrow()
    // 設備は 0 件でよい（設備を要らない目的がある）。
    expect(
      StaffReservationCreate.parse({ ...staffReservationCreate, equipmentIds: five }).equipmentIds,
    ).toHaveLength(5)
    expect(() =>
      StaffReservationCreate.parse({
        ...staffReservationCreate,
        equipmentIds: [...five, uuidOf(6)],
      }),
    ).toThrow()
  })

  it('rejects customerId and customerDraft given together', () => {
    expect(
      StaffReservationCreate.parse({ ...staffReservationCreate, customerId: UUID2 }).customerId,
    ).toBe(UUID2)
    // `customerDraft`（新規登録と同時）は `CustomerCreate` を作る P4 が足す欄で、
    // この面にはまだ無い。両方を送る本文は知らないキーとして落ちるので、排他はいまも成り立つ。
    expect(() =>
      StaffReservationCreate.parse({
        ...staffReservationCreate,
        customerId: UUID2,
        customerDraft: { name: '田中 花子' },
      }),
    ).toThrow()
    expect(() =>
      StaffReservationCreate.parse({
        ...staffReservationCreate,
        customerDraft: { name: '田中 花子' },
      }),
    ).toThrow()
  })

  it('rejects an unknown key so a stale client field never lands silently', () => {
    for (const stale of [
      { customerPhone: '090-1234-5678' },
      { customerName: '田中 花子' },
      { staff_id: UUID2 },
      { durationMinute: 60 },
      { endsAt: END },
    ]) {
      expect(() => StaffReservationCreate.parse({ ...staffReservationCreate, ...stale })).toThrow()
    }
  })

  // 確定は受け取った並びのぶんだけ占有行を積むので、同じ id が 2 回入ると
  // その設備の空きが 1 予約で 2 つ減り、所要も倍になる（`reservation_slot_locks` に
  // 一意 index は無く、D1 は止めない）。落とすのはここである。
  it('rejects a repeated purposeId or equipmentId so one booking never eats two slots', () => {
    expect(() =>
      StaffReservationCreate.parse({ ...staffReservationCreate, purposeIds: [UUID2, UUID2] }),
    ).toThrow()
    expect(() =>
      StaffReservationCreate.parse({ ...staffReservationCreate, equipmentIds: [UUID2, UUID2] }),
    ).toThrow()
    expect(
      StaffReservationCreate.parse({
        ...staffReservationCreate,
        equipmentIds: [UUID2, uuidOf(3)],
      }).equipmentIds,
    ).toHaveLength(2)
  })
})

describe('HoldInput', () => {
  it('accepts a hold with no staff and no equipment', () => {
    const input = HoldInput.parse(holdInput)
    // 担当も設備も決まっていない工程 3 の途中でも押さえられる（未定の枠を押さえる）。
    expect(input.staffId).toBeNull()
    expect([input.equipmentIds, input.receptionSessionId]).toEqual([[], null])
    expect(HoldInput.parse({ ...holdInput, staffId: UUID2 }).staffId).toBe(UUID2)
    // 空き枠エンジンは自分の受付が置いた押さえを塞がりに数えないので、受付の id を運ぶ。
    expect(HoldInput.parse({ ...holdInput, receptionSessionId: UUID }).receptionSessionId).toBe(
      UUID,
    )
    expect(() => HoldInput.parse({ ...holdInput, durationMinutes: 61 })).toThrow()
    expect(() => HoldInput.parse({ ...holdInput, holdId: UUID })).toThrow()
  })
})

describe('Hold', () => {
  it('carries expiresAt so the screen can count down without asking again', () => {
    const parsed = Hold.parse(hold)
    expect(parsed.expiresAt).toBe(HOLD_EXPIRES_AT)
    // 420 秒（7 分）。画面は端末の時計ではなく、この値と応答の現在時刻の差で残りを数える。
    expect(Date.parse(parsed.expiresAt) - Date.parse(NOW)).toBe(420_000)
    expect([parsed.staffId, parsed.equipmentIds, parsed.receptionSessionId]).toEqual([
      null,
      [],
      null,
    ])
    // 期限が無い応答は数えられない。残り時間を別の呼び出しで聞き直さない。
    expect(() => Hold.parse({ id: UUID, startsAt: START, endsAt: END })).toThrow()
    expect(() => Hold.parse({ ...hold, startsAt: END, endsAt: START })).toThrow()
  })
})

describe('ReservationAssignment', () => {
  it('allows a null targetId — decide-later still consumes the slot', () => {
    // 担当も設備も未定のまま行を作る。作らないと同時受付上限の数え方が台帳とずれる。
    for (const kind of ['staff', 'equipment']) {
      expect(
        ReservationAssignment.parse({ kind, targetId: null, startsAt: START, endsAt: END })
          .targetId,
      ).toBeNull()
    }
    // 未定は `targetId` の null で表す。占有行の `target_key='unassigned'` は D1 側の語で、
    // 契約の `targetId` には入らない。
    expect(() =>
      ReservationAssignment.parse({
        kind: 'staff',
        targetId: 'unassigned',
        startsAt: START,
        endsAt: END,
      }),
    ).toThrow()
  })
})

describe('ReservationDetail', () => {
  it('keeps purposeLabel and purposeLabelInternal as separate fields', () => {
    // 台帳の帯だけが短い名前（`name_short`）を使い、復唱・詳細・受付は `name_internal`。
    const detail = ReservationDetail.parse({
      ...reservationDetail,
      purposeLabel: '新調・測定',
      purposeLabelInternal: 'メガネを新しく作る・視力測定だけ',
    })
    expect([detail.purposeLabel, detail.purposeLabelInternal]).toEqual([
      '新調・測定',
      'メガネを新しく作る・視力測定だけ',
    ])
    // 連結の上限も別（5 文字 × 5 件 + 区切り / 40 文字 × 5 件 + 区切り）。
    expect(
      ReservationDetail.parse({
        ...reservationDetail,
        purposeLabel: 'あ'.repeat(30),
        purposeLabelInternal: 'あ'.repeat(220),
      }).purposeLabelInternal,
    ).toHaveLength(220)
    expect(() =>
      ReservationDetail.parse({ ...reservationDetail, purposeLabel: 'あ'.repeat(31) }),
    ).toThrow()
    expect(() =>
      ReservationDetail.parse({ ...reservationDetail, purposeLabelInternal: 'あ'.repeat(221) }),
    ).toThrow()
  })

  it('requires webBookingCode to be null unless source is web', () => {
    // お電話・店頭・ウォークインのご予約に、お客様が読み上げる Web の番号は生えない。
    for (const source of ['phone', 'counter', 'walkin']) {
      expect(ReservationDetail.parse({ ...reservationDetail, source }).webBookingCode).toBeNull()
      expect(() =>
        ReservationDetail.parse({
          ...reservationDetail,
          source,
          webBookingCode: 'EY-W-2608-0031',
        }),
      ).toThrow()
    }
    expect(
      ReservationDetail.parse({
        ...reservationDetail,
        source: 'web',
        webBookingCode: 'EY-W-2608-0031',
      }).webBookingCode,
    ).toBe('EY-W-2608-0031')
    expect(() => ReservationDetail.parse({ ...reservationDetail, source: 'web' })).toThrow()
  })
})

describe('ReceptionSessionDraft', () => {
  it('holds only chosen ids and typed characters, never a customer name or phone', () => {
    const draft = ReceptionSessionDraft.parse(receptionDraft)
    expect(draft.purposeIds).toEqual([UUID2])
    expect([draft.staffId, draft.customerId]).toEqual([UUID2, null])
    expect([draft.nameTyped, draft.kanaTyped, draft.phoneTyped]).toEqual([
      '田中 花',
      'たなか はな',
      '090-1234-5',
    ])
    // 受付を始めた直後は空。工程を進めるたびに同じ形で上書きする。
    const empty = ReceptionSessionDraft.parse({})
    expect([empty.purposeIds, empty.equipmentIds, empty.handwritingKeys]).toEqual([[], [], []])
    expect([empty.startsAt, empty.durationMinutes, empty.nameTyped]).toEqual([null, null, ''])
    // 確定したお客様の氏名・電話番号そのものを持つ列を作らない（`07-nfr.md` §6.6）。
    // 打ちかけの文字（`nameTyped` / `phoneTyped`）とは別のものである。
    for (const leak of [
      { customerName: '田中 花子' },
      { customerPhone: '090-1234-5678' },
      { customerKana: 'たなか はなこ' },
      { email: 'hanako@example.com' },
    ]) {
      expect(() => ReceptionSessionDraft.parse({ ...receptionDraft, ...leak })).toThrow()
      expect(() =>
        ReceptionSessionDraftPatch.parse({ draft: { ...receptionDraft, ...leak } }),
      ).toThrow()
      expect(() => ReceptionSessionStart.parse({ storeId: UUID, ...leak })).toThrow()
    }
    // 保存は下書きまるごと 1 つ。欄ごとの差分にしないので「消す」と「触っていない」が割れる。
    expect(ReceptionSessionDraftPatch.parse({ draft: receptionDraft }).draft.nameTyped).toBe(
      '田中 花',
    )
    expect(ReceptionSessionStart.parse({ storeId: UUID }).storeId).toBe(UUID)
    // 取り直した回数は下書きに載る。端末の state だけに持つと、タブを読み込み直しただけで
    // 0 に戻り「10 回まで」が消える（上限そのものは Worker が数える）。
    expect(empty.holdRenewals).toBe(0)
    expect(ReceptionSessionDraft.parse({ holdRenewals: 10 }).holdRenewals).toBe(10)
    expect(() => ReceptionSessionDraft.parse({ holdRenewals: -1 })).toThrow()
    expect(() => ReceptionSessionDraft.parse({ holdRenewals: 1.5 })).toThrow()
    // 手書きは R2 の鍵だけを持ち、筆跡そのものを下書きに入れない。1 受付 5 枚まで。
    const keys = [1, 2, 3, 4, 5].map((n) => `notes/${ORG}/sessions/${UUID}/${uuidOf(n)}.svg`)
    expect(ReceptionSessionDraft.parse({ handwritingKeys: keys }).handwritingKeys).toHaveLength(5)
    expect(() =>
      ReceptionSessionDraft.parse({
        handwritingKeys: [...keys, `notes/${ORG}/sessions/${UUID}/${uuidOf(6)}.svg`],
      }),
    ).toThrow()
  })
})

describe('ReceptionSessionClose', () => {
  it('only accepts discarded — booked is written by the server on confirm', () => {
    // 「入力をやめる」だけがこのルートを通る。成立（booked）は確定の 1 バッチが書くので、
    // 端末から送れると、予約の無い受付が成立として残せてしまう。
    expect(ReceptionSessionClose.parse({ outcome: 'discarded' }).outcome).toBe('discarded')
    for (const outcome of ['booked', 'cancelled', 'in_progress', null]) {
      expect(() => ReceptionSessionClose.parse({ outcome })).toThrow()
    }
    // 応答は両方の結果を運ぶ。受けかけの受付は `outcome` も `endedAt` も null のまま。
    const session = ReceptionSession.parse(receptionSession)
    expect([session.outcome, session.endedAt, session.reservationId]).toEqual([null, null, null])
    expect([session.terminalId, session.actorId]).toEqual([null, null])
    expect(session.draft?.nameTyped).toBe('田中 花')
    const booked = ReceptionSession.parse({
      ...receptionSession,
      endedAt: NOW,
      outcome: 'booked',
      reservationId: UUID2,
      draft: null,
    })
    expect([booked.outcome, booked.reservationId, booked.draft]).toEqual(['booked', UUID2, null])
  })
})

/* --------------------------------------------------------------------------- *
 * P4 顧客台帳（`007-customer-records`）
 * --------------------------------------------------------------------------- */

/** CUSTOMER-DETAIL「お客様番号 G-01842」。統合で失った番号は再利用しない。 */
const CUSTOMER_NUMBER = 'G-01842'
/** 090-1234-5678 を数字だけにしたもの。台帳は下 4 桁、工程は先頭から引く。 */
const PHONE_NORMALIZED = '09012345678'
/** 筆跡そのもの。許可リストでの再直列化は Worker 側の仕事で、契約は長さだけを見る。 */
const HANDWRITING = '<svg viewBox="0 0 320 180"><path d="M12 24 L120 96" stroke-width="2"/></svg>'

const customerSummary = {
  id: UUID,
  customerNumber: CUSTOMER_NUMBER,
  name: '田中 花子',
  kana: 'たなか はなこ',
  phone: PHONE_NORMALIZED,
  visitCount: 4,
  lastVisitAt: '2026-05-12',
  memoShort: 'PC作業用・鼻パッド低め',
}

const prescription = {
  id: UUID,
  measuredAt: '2026-05-12',
  rSph: -2.25,
  lSph: -2,
  rCyl: -0.5,
  lCyl: -0.75,
  rAxis: 180,
  lAxis: 175,
  pd: 62,
  isCurrent: true,
}

const ownedGlasses = {
  id: UUID,
  purchasedAt: '2025-04-20',
  frameName: 'クラシック TR-88 マットブラウン 52□17',
  lensName: '遠近両用',
  usageLabel: 'お出かけ用',
  isCurrent: true,
}

const customerNote = {
  id: UUID,
  kind: 'memo',
  body: '鼻パッドを低めに',
  authorId: UUID2,
  authorName: '佐藤 美咲',
  revision: 1,
  status: 'draft',
  storeId: UUID2,
  createdAt: NOW,
}

const customerDetail = {
  ...customerSummary,
  email: 'hanako@example.com',
  birthDate: '1979-04-02',
  address: '東京都中央区銀座 4-1-1',
  memo: 'PC作業用・鼻パッド低め',
  firstVisitAt: '2024-03-15',
  frequentStaffName: '佐藤 美咲',
  prescriptions: [prescription],
  glasses: [ownedGlasses],
  notes: [customerNote],
  version: 3,
}

/** CUSTOMER-MERGE の見比べ表の 4 項目（お名前・お電話番号・ご住所・接客のメモ）。 */
const mergeFields = [
  { field: 'name', primaryValue: '田中 花子', secondaryValue: '田中 花子', choice: 'primary' },
  { field: 'phone', primaryValue: PHONE_NORMALIZED, secondaryValue: null, choice: 'primary' },
  {
    field: 'address',
    primaryValue: null,
    secondaryValue: '東京都中央区銀座 4-1-1',
    choice: 'secondary',
  },
  { field: 'notes', primaryValue: '7', secondaryValue: '1', choice: 'both' },
]

const customerMergeInput = {
  primaryId: UUID,
  secondaryId: UUID2,
  primaryVersion: 3,
  secondaryVersion: 1,
  fields: mergeFields,
}

describe('PhoneInput', () => {
  it('accepts hyphens and full-width digits, rejects fewer than 10 characters', () => {
    // 打たれたままの文字を受ける。数字だけへ落とすのはドメイン層（`normalizePhone`）の仕事で、
    // 契約でハイフンを禁じると受付が打ち終わる前に欄が赤くなる。
    expect(PhoneInput.parse('090-1234-5678')).toBe('090-1234-5678')
    expect(PhoneInput.parse('０９０１２３４５６７８')).toBe('０９０１２３４５６７８')
    expect(PhoneInput.parse('03-1234-5678')).toBe('03-1234-5678')
    expect(PhoneInput.parse(' 090 1234 5678 ')).toBe('090 1234 5678')
    // 10 文字に満たない打鍵はまだ番号として扱わない（照会も走らせない）。
    for (const typed of ['090-1234', '0901234', '090']) {
      expect(() => PhoneInput.parse(typed)).toThrow()
    }
    // 20 文字を超える貼り付けも受けない。
    expect(() => PhoneInput.parse('0'.repeat(21))).toThrow()
  })
})

describe('PhoneNormalized', () => {
  it('accepts 10 and 11 digits starting with 0, rejects 9 and 12', () => {
    expect(PhoneNormalized.parse('0312345678')).toBe('0312345678')
    expect(PhoneNormalized.parse(PHONE_NORMALIZED)).toBe(PHONE_NORMALIZED)
    for (const value of ['090123456', '090123456789', '9012345678', '090-1234-5678', '']) {
      expect(() => PhoneNormalized.parse(value)).toThrow()
    }
  })
})

describe('PhoneSuffix', () => {
  it('is exactly four digits — three digits fail', () => {
    expect(PhoneSuffix.parse('5678')).toBe('5678')
    expect(PhoneSuffix.parse('0012')).toBe('0012')
    // 3 桁は番号ではなくお名前として扱う（`searchMode` の分かれ目と同じ境界）。
    for (const value of ['678', '56789', '56a8', '５６７８']) {
      expect(() => PhoneSuffix.parse(value)).toThrow()
    }
  })
})

describe('CustomerNumber', () => {
  it('is G- followed by exactly five digits', () => {
    expect(CustomerNumber.parse(CUSTOMER_NUMBER)).toBe(CUSTOMER_NUMBER)
    expect(CustomerNumber.parse('G-02310')).toBe('G-02310')
    for (const value of ['G-0184', 'G-018420', 'g-01842', 'G01842', 'EY-2608-0142']) {
      expect(() => CustomerNumber.parse(value)).toThrow()
    }
  })
})

describe('CustomerSummary', () => {
  it('keeps memoShort at 40 characters and leaves phone nullable', () => {
    const parsed = CustomerSummary.parse(customerSummary)
    expect([parsed.customerNumber, parsed.visitCount]).toEqual([CUSTOMER_NUMBER, 4])
    expect(parsed.lastVisitAt).toBe('2026-05-12')
    // 一覧の「覚えておくこと」は 1 行に収める列で、「…」で切ってよい唯一の欄である。
    expect(
      CustomerSummary.parse({ ...customerSummary, memoShort: 'あ'.repeat(40) }).memoShort,
    ).toHaveLength(40)
    expect(() =>
      CustomerSummary.parse({ ...customerSummary, memoShort: 'あ'.repeat(41) }),
    ).toThrow()
    // お名前だけで登録できるので、お電話番号を持たないお客様も一覧に並ぶ。
    expect(CustomerSummary.parse({ ...customerSummary, phone: null }).phone).toBeNull()
    const bare = CustomerSummary.parse({
      id: UUID,
      customerNumber: 'G-02310',
      name: '松本 一郎',
      visitCount: 0,
    })
    // 来店が 0 件の行は「最後のご来店」を `—` と描くので、値そのものは null で持つ。
    expect([bare.kana, bare.memoShort, bare.phone, bare.lastVisitAt]).toEqual(['', '', null, null])
  })
})

describe('CustomerCreate', () => {
  it('accepts a name alone — the phone is optional', () => {
    const created = CustomerCreate.parse({ name: '田中 花子' })
    expect(created.name).toBe('田中 花子')
    expect([created.phone, created.kana, created.email, created.birthDate]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    expect(CustomerCreate.parse({ name: '田中 花子', phone: '090-1234-5678' }).phone).toBe(
      '090-1234-5678',
    )
    expect(CustomerCreate.parse({ name: '田中 花子', kana: 'たなか はなこ' }).kana).toBe(
      'たなか はなこ',
    )
  })

  it('rejects an empty name', () => {
    for (const name of ['', '   ', undefined]) {
      expect(() => CustomerCreate.parse({ name })).toThrow()
    }
    expect(() => CustomerCreate.parse({ name: 'あ'.repeat(41) })).toThrow()
    // お客様番号はサーバが採番する。端末から送らせない。
    expect(() =>
      CustomerCreate.parse({ name: '田中 花子', customerNumber: CUSTOMER_NUMBER }),
    ).toThrow()
  })
})

describe('CustomerPatch', () => {
  it('requires version', () => {
    expect(CustomerPatch.parse({ version: 3, name: '田中 花子' }).version).toBe(3)
    expect(() => CustomerPatch.parse({ name: '田中 花子' })).toThrow()
    expect(() => CustomerPatch.parse({ version: -1 })).toThrow()
    expect(() => CustomerPatch.parse({ version: 1.5 })).toThrow()
    // 版だけの保存は「何も変えない保存」で、拒まない（画面の「保存」は 1 つしかない）。
    expect(CustomerPatch.parse({ version: 3 }).name).toBeUndefined()
  })
})

describe('CustomerSearchQuery', () => {
  it('defaults sort to kana and limit to 50', () => {
    const query = CustomerSearchQuery.parse({})
    expect([query.sort, query.limit]).toEqual(['kana', 50])
    expect([query.query, query.cursor, query.staffId]).toEqual([undefined, undefined, undefined])
    expect(CustomerSearchQuery.parse({ sort: 'visits' }).sort).toBe('visits')
    // クエリ文字列は数値も**文字列**で届く（`?limit=8&visitCountMin=2`）。
    expect(CustomerSearchQuery.parse({ limit: '8' }).limit).toBe(8)
    const filtered = CustomerSearchQuery.parse({ visitCountMin: '2', visitCountMax: '4' })
    expect([filtered.visitCountMin, filtered.visitCountMax]).toEqual([2, 4])
  })

  it('rejects a limit above 200', () => {
    expect(CustomerSearchQuery.parse({ limit: 200 }).limit).toBe(200)
    for (const limit of [201, 0, -1, 1.5]) {
      expect(() => CustomerSearchQuery.parse({ limit })).toThrow()
    }
    // 並べ方は「お名前順」と「ご来店の回数順」の 2 つだけ（CUSTOMER-LIST の segmented）。
    expect(() => CustomerSearchQuery.parse({ sort: 'lastVisit' })).toThrow()
  })
})

describe('CustomerLookupQuery', () => {
  it('rejects a query whose four fields are all empty', () => {
    // 4 つとも空の照会は台帳の全走査になる。400 で止める（`04-api.md` §4.7）。
    expect(() => CustomerLookupQuery.parse({})).toThrow()
    expect(() => CustomerLookupQuery.parse({ name: '', kana: '' })).toThrow()
    expect(() => CustomerLookupQuery.parse({ name: '   ' })).toThrow()
    expect(CustomerLookupQuery.parse({ phone: '090-1234-5678' }).phone).toBe('090-1234-5678')
    // 台帳と受付は下 4 桁の**完全一致**、工程は正規化した番号の**前方一致**で、欄そのものが別である。
    expect(CustomerLookupQuery.parse({ phoneLast4: '5678' }).phoneLast4).toBe('5678')
    expect(CustomerLookupQuery.parse({ kana: 'たなか' }).kana).toBe('たなか')
    expect(CustomerLookupQuery.parse({ name: '花子' }).name).toBe('花子')
  })
})

describe('CustomerCandidate', () => {
  it('is a two-step confidence: strong or weak, nothing else', () => {
    const strong = CustomerCandidate.parse({ customer: customerSummary, match: 'strong' })
    expect(strong.match).toBe('strong')
    expect([strong.currentPrescription, strong.lastStaffName, strong.lastVisitAt]).toEqual([
      null,
      null,
      null,
    ])
    expect(strong.attentionSummary).toBe('')
    expect(CustomerCandidate.parse({ customer: customerSummary, match: 'weak' }).match).toBe('weak')
    // 「よく一致しています」と「確かめが必要です」の 2 語しか画面に無い。
    // 3 段目を作ると札の文言が無く、自動確定への逃げ道にもなる。
    for (const match of ['exact', 'partial', 'none', 'maybe', null]) {
      expect(() => CustomerCandidate.parse({ customer: customerSummary, match })).toThrow()
    }
    const full = CustomerCandidate.parse({
      customer: customerSummary,
      match: 'strong',
      lastVisitAt: '2026-05-12',
      currentPrescription: prescription,
      lastStaffName: '佐藤 美咲',
      attentionSummary: '強い光がまぶしいとのこと',
    })
    expect(full.currentPrescription?.pd).toBe(62)
  })
})

describe('Prescription', () => {
  it('takes sph in 0.25 steps and axis as an integer 0..180', () => {
    const parsed = Prescription.parse(prescription)
    expect([parsed.rSph, parsed.lSph]).toEqual([-2.25, -2])
    expect([parsed.rAxis, parsed.lAxis]).toEqual([180, 175])
    expect(Prescription.parse({ ...prescription, rSph: -2.5, rAxis: 0 }).rAxis).toBe(0)
    // 0.25 の格子に載らない度数は測定機が出さない。text で持たないので、ここで落とす。
    expect(() => Prescription.parse({ ...prescription, rSph: -2.3 })).toThrow()
    expect(() => Prescription.parse({ ...prescription, rAxis: 90.5 })).toThrow()
    // 測っていない目・PD は null のまま置ける（片目だけの測定がある）。
    const bare = Prescription.parse({ id: UUID, measuredAt: '2026-05-12', isCurrent: false })
    expect([bare.rSph, bare.rCyl, bare.rAxis, bare.rAdd, bare.pd]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ])
    expect(bare.note).toBe('')
    // 測定日は暦日だけを持つ（時刻を持たない）。
    expect(() => Prescription.parse({ ...prescription, measuredAt: '2026-5-12' })).toThrow()
  })

  it('rejects an axis of 181 and a pd of 39.5', () => {
    expect(() => Prescription.parse({ ...prescription, rAxis: 181 })).toThrow()
    expect(() => Prescription.parse({ ...prescription, lAxis: -1 })).toThrow()
    expect(() => Prescription.parse({ ...prescription, pd: 39.5 })).toThrow()
    expect(Prescription.parse({ ...prescription, pd: 40 }).pd).toBe(40)
    expect(Prescription.parse({ ...prescription, pd: 62.5 }).pd).toBe(62.5)
    // PD は 0.5 刻み。0.25 刻みは度数の側だけである。
    expect(() => Prescription.parse({ ...prescription, pd: 62.25 })).toThrow()
    expect(() => Prescription.parse({ ...prescription, pd: 85.5 })).toThrow()
  })
})

describe('CustomerNote', () => {
  it('is memo or attention, and draft, published or hidden', () => {
    const parsed = CustomerNote.parse(customerNote)
    expect([parsed.kind, parsed.status]).toEqual(['memo', 'draft'])
    // 「注意ごと N件」に数えるのは attention かつ published の行だけ。
    expect(
      CustomerNote.parse({ ...customerNote, kind: 'attention', status: 'published' }).kind,
    ).toBe('attention')
    expect(CustomerNote.parse({ ...customerNote, status: 'hidden' }).status).toBe('hidden')
    for (const kind of ['note', 'warning', 'handwriting', null]) {
      expect(() => CustomerNote.parse({ ...customerNote, kind })).toThrow()
    }
    for (const status of ['archived', 'deleted', 'pending', null]) {
      expect(() => CustomerNote.parse({ ...customerNote, status })).toThrow()
    }
    // 取得の絞り込みも同じ語彙で書く。クエリ文字列はカンマ区切りで届く。
    const query = CustomerNoteQuery.parse({ status: 'draft,published' })
    expect(query.status).toEqual(['draft', 'published'])
    expect(CustomerNoteQuery.parse({ status: ['hidden'] }).status).toEqual(['hidden'])
    expect(() => CustomerNoteQuery.parse({ status: 'draft,archived' })).toThrow()
    // 他店で書かれた 1 枚も既定で見せる（丸の内店の 1 枚を銀座店の端末が読む）。
    expect(CustomerNoteQuery.parse({}).includeOtherStores).toBe(true)
    expect(CustomerNoteQuery.parse({ includeOtherStores: 'false' }).includeOtherStores).toBe(false)
    // 筆跡は本体を載せる。R2 のキーも署名付き URL も契約に出さない。
    const drawn = CustomerNote.parse({ ...customerNote, handwritingSvg: HANDWRITING })
    expect(drawn.handwritingSvg).toBe(HANDWRITING)
    expect(parsed.handwritingSvg).toBeNull()
    expect(() =>
      CustomerNote.parse({ ...customerNote, handwritingKey: `notes/${ORG}/${UUID}/${UUID2}.svg` }),
    ).toThrow()
  })
})

describe('CustomerNoteInput', () => {
  it('rejects a note that has neither body nor handwriting', () => {
    // 空のメモを残せると、手書きの面が「1枚」と数えたまま中身が無い行ができる。
    expect(() => CustomerNoteInput.parse({ kind: 'memo', storeId: UUID2 })).toThrow()
    expect(() => CustomerNoteInput.parse({ kind: 'memo', storeId: UUID2, body: '   ' })).toThrow()
    expect(() =>
      CustomerNoteInput.parse({ kind: 'memo', storeId: UUID2, body: '', handwritingSvg: null }),
    ).toThrow()
    // 書いた店舗は必ず持つ（「丸の内店 記入 中村 彩」を出すため）。
    expect(() => CustomerNoteInput.parse({ kind: 'memo', body: '鼻パッドを低めに' })).toThrow()
  })

  it('accepts handwriting alone — a drawing with no transcription is still a note', () => {
    const drawn = CustomerNoteInput.parse({
      kind: 'memo',
      storeId: UUID2,
      handwritingSvg: HANDWRITING,
    })
    expect([drawn.body, drawn.handwritingSvg]).toEqual(['', HANDWRITING])
    // 手書きが使えない人は同じ画面の「読み取った文字」から文字だけで残せる（AC-CUST-23）。
    expect(
      CustomerNoteInput.parse({ kind: 'attention', storeId: UUID2, body: '強い光がまぶしい' })
        .handwritingSvg,
    ).toBeNull()
    const limit = 512 * 1024
    expect(
      CustomerNoteInput.parse({ kind: 'memo', storeId: UUID2, handwritingSvg: 'x'.repeat(limit) })
        .handwritingSvg,
    ).toHaveLength(limit)
    // 1 枚 3〜12KB の想定なので、512KB を超える筆跡は受け取らない。
    expect(() =>
      CustomerNoteInput.parse({
        kind: 'memo',
        storeId: UUID2,
        handwritingSvg: 'x'.repeat(limit + 1),
      }),
    ).toThrow()
  })
})

describe('CustomerNotePatch', () => {
  it('requires revision and allows only draft or hidden as a status', () => {
    expect(CustomerNotePatch.parse({ revision: 2, body: '直した文字' }).revision).toBe(2)
    expect(() => CustomerNotePatch.parse({ body: '直した文字' })).toThrow()
    expect(CustomerNotePatch.parse({ revision: 2, status: 'draft' }).status).toBe('draft')
    expect(CustomerNotePatch.parse({ revision: 2, status: 'hidden' }).status).toBe('hidden')
    // `published` へ上げるのは承認の面（P10）の仕事で、読み取った文字を直す経路からは上げない。
    expect(() => CustomerNotePatch.parse({ revision: 2, status: 'published' })).toThrow()
    // 筆跡は書いたときのまま残す。直せるのは読み取った文字だけである（AC-CUST-19）。
    expect(() => CustomerNotePatch.parse({ revision: 2, handwritingSvg: HANDWRITING })).toThrow()
    // 申し込みは本文を伴う（空の申し込みを承認の面へ流さない）。
    expect(CustomerNotePublishInput.parse({ revision: 2, body: '強い光がまぶしい' }).body).toBe(
      '強い光がまぶしい',
    )
    expect(() => CustomerNotePublishInput.parse({ revision: 2, body: '' })).toThrow()
    expect(() => CustomerNotePublishInput.parse({ body: '強い光がまぶしい' })).toThrow()
  })
})

describe('CustomerMergePreviewRequest', () => {
  it('rejects the same id on both sides', () => {
    expect(
      CustomerMergePreviewRequest.parse({ primaryId: UUID, secondaryId: UUID2 }).primaryId,
    ).toBe(UUID)
    // 同じ行を両側に置くと、残さない側に自分自身を統合先として書ける。
    expect(() =>
      CustomerMergePreviewRequest.parse({ primaryId: UUID, secondaryId: UUID }),
    ).toThrow()
  })
})

describe('CustomerMergeField', () => {
  it("allows 'both' only for notes", () => {
    // 接客のメモだけは寄せ合わせる（7 + 1 = 8 件）。
    expect(
      CustomerMergeField.parse({
        field: 'notes',
        primaryValue: '7',
        secondaryValue: '1',
        choice: 'both',
      }).choice,
    ).toBe('both')
    for (const field of ['name', 'kana', 'phone', 'email', 'address', 'birthDate', 'memo']) {
      expect(
        CustomerMergeField.parse({
          field,
          primaryValue: 'A',
          secondaryValue: 'B',
          choice: 'secondary',
        }).field,
      ).toBe(field)
      // お名前を 2 つ持つ行は作れない。'both' はこの 7 項目では意味を持たない。
      expect(() =>
        CustomerMergeField.parse({
          field,
          primaryValue: 'A',
          secondaryValue: 'B',
          choice: 'both',
        }),
      ).toThrow()
    }
    // 値の無い側を残す選択もある（結果は「ご登録がありません」と描く）。
    expect(
      CustomerMergeField.parse({
        field: 'address',
        primaryValue: null,
        secondaryValue: '東京都中央区銀座 4-1-1',
        choice: 'primary',
      }).primaryValue,
    ).toBeNull()
    expect(() =>
      CustomerMergeField.parse({
        field: 'visitCount',
        primaryValue: '4',
        secondaryValue: '1',
        choice: 'primary',
      }),
    ).toThrow()
  })
})

describe('CustomerMergeInput', () => {
  it('requires both versions', () => {
    const parsed = CustomerMergeInput.parse(customerMergeInput)
    expect([parsed.primaryVersion, parsed.secondaryVersion]).toEqual([3, 1])
    expect(parsed.fields).toHaveLength(4)
    for (const key of ['primaryVersion', 'secondaryVersion']) {
      const { [key]: _dropped, ...rest } = customerMergeInput as Record<string, unknown>
      expect(() => CustomerMergeInput.parse(rest)).toThrow()
    }
    // 下見と実行で同じ守りを掛ける（実行だけ素通しにしない）。
    expect(() => CustomerMergeInput.parse({ ...customerMergeInput, secondaryId: UUID })).toThrow()
  })
})

describe('CustomerList', () => {
  it('carries items, nextCursor and total', () => {
    // 「当てはまるお客様 42名」と 8 行の一覧は別の数である（`total` は絞り込み後の総数）。
    const list = CustomerList.parse({
      items: [customerSummary],
      nextCursor: 'a2FuYToxMTExMTExMQ',
      total: 42,
    })
    expect([list.items.length, list.total]).toEqual([1, 42])
    expect(list.nextCursor).toBe('a2FuYToxMTExMTExMQ')
    // 続きが無ければ null。0 件でも器の形は変えない（表を空のまま残さないため）。
    const empty = CustomerList.parse({ items: [], total: 0 })
    expect([empty.items, empty.nextCursor, empty.total]).toEqual([[], null, 0])
    expect(() => CustomerList.parse({ items: [], total: -1 })).toThrow()
  })
})

describe('customer schemas', () => {
  it('reject an unknown key so a stale field never lands silently', () => {
    const cases: [{ parse: (input: unknown) => unknown }, Record<string, unknown>][] = [
      [CustomerSummary, customerSummary],
      [CustomerDetail, customerDetail],
      [Prescription, prescription],
      [OwnedGlasses, ownedGlasses],
      [CustomerNote, customerNote],
      [CustomerCreate, { name: '田中 花子' }],
      [CustomerPatch, { version: 3 }],
      [CustomerSearchQuery, {}],
      [CustomerLookupQuery, { phoneLast4: '5678' }],
      [CustomerCandidate, { customer: customerSummary, match: 'strong' }],
      [CustomerList, { items: [customerSummary], total: 42 }],
      [CustomerNoteQuery, {}],
      [CustomerNoteInput, { kind: 'memo', storeId: UUID2, body: '鼻パッドを低めに' }],
      [CustomerNotePatch, { revision: 2, body: '直した文字' }],
      [CustomerNotePublishInput, { revision: 2, body: '強い光がまぶしい' }],
      [CustomerMergePreviewRequest, { primaryId: UUID, secondaryId: UUID2 }],
      [
        CustomerMergePreview,
        {
          fields: mergeFields,
          result: customerSummary,
          noteCount: 8,
          losingCustomerNumber: 'G-02310',
        },
      ],
      [CustomerMergeField, mergeFields[0]],
      [CustomerMergeInput, customerMergeInput],
      [
        CustomerMergeResult,
        { customer: customerDetail, mergedId: UUID2, movedReservations: 3, movedNotes: 1 },
      ],
    ]
    for (const [schema, valid] of cases) {
      expect(() => schema.parse(valid)).not.toThrow()
      // R2 のキーも、綴りの古い欄も、黙って通さない。
      for (const stale of [{ handwritingKey: 'notes/x.svg' }, { customerCode: CUSTOMER_NUMBER }]) {
        expect(() => schema.parse({ ...valid, ...stale })).toThrow()
      }
    }
  })
})

/* --------------------------------------------------------------------------- *
 * P5 来店受付とウォークイン（`008-reception-and-walkin`）
 * --------------------------------------------------------------------------- */

const ARRIVED_AT = '2026-08-27T02:02:00.000Z'

const walkinCreate = { storeId: UUID, purposeId: UUID2 }

const walkin = {
  id: UUID,
  ticketNo: 5,
  arrivedAt: ARRIVED_AT,
  purposeId: UUID2,
  purposeNote: null,
  customerId: null,
  reservationId: uuidOf(3),
  status: 'waiting',
  waitedMinutes: 6,
  leftAt: null,
  version: 1,
}

const walkinSummary = {
  id: UUID,
  ticketNo: 4,
  arrivedAt: ARRIVED_AT,
  waitedMinutes: 6,
  purposeNote: 'フレームの相談',
  status: 'waiting',
}

const visitEventInput = {
  storeId: UUID,
  subjectType: 'walkin',
  subjectId: UUID2,
  stage: 'consulting',
}

const boardCell = (over: Record<string, unknown> = {}) => ({
  stage: 'measuring',
  state: 'next',
  at: null,
  label: '視力測定機 A',
  note: null,
  needsAttention: false,
  ...over,
})

const boardRow = {
  subjectType: 'reservation',
  subjectId: UUID,
  displayName: '田中 花子 様',
  visitCount: 4,
  purposeLabel: '新調相談',
  cells: [boardCell()],
  isWaitingTooLong: false,
}

const historyQuery = { from: '2026-08-01', to: '2026-08-27' }

const historyEntry = {
  entryId: UUID,
  sessionId: UUID2,
  startedAt: NOW,
  displayName: '田中 花子 様',
  visitCount: 4,
  outcome: 'booked',
  reservationStatus: 'confirmed',
}

const relaxation = {
  label: '期間を「今月（8月1日 〜 8月27日）」まで広げる',
  count: 12,
  query: { from: '2026-08-01', to: '2026-08-27' },
}

const historyDetail = {
  entryId: UUID,
  sessionId: UUID2,
  reservation: null,
  receivedBy: '中村 彩',
  receivedAt: NOW,
  changes: [{ occurredAt: NOW, what: '新しく受け付けました', actorName: '中村 彩' }],
}

describe('WalkinCreate', () => {
  it('takes no ticket number — the server assigns it', () => {
    expect(WalkinCreate.parse(walkinCreate).storeId).toBe(UUID)
    // 整理番号をクライアントから受けると、同時受付でそのまま重複する。
    expect(() => WalkinCreate.parse({ ...walkinCreate, ticketNo: 5 })).toThrow()
    expect(() => WalkinCreate.parse({ ...walkinCreate, visitDate: '2026-08-27' })).toThrow()
  })

  it('accepts exactly one of purposeId and purposeNote', () => {
    expect(WalkinCreate.parse(walkinCreate).purposeId).toBe(UUID2)
    const noted = WalkinCreate.parse({ storeId: UUID, purposeNote: 'フレームの相談' })
    expect([noted.purposeId, noted.purposeNote]).toEqual([undefined, 'フレームの相談'])
  })

  it('rejects a payload carrying both purposes', () => {
    expect(() => WalkinCreate.parse({ ...walkinCreate, purposeNote: 'フレームの相談' })).toThrow()
  })

  it('rejects a payload carrying neither purpose', () => {
    expect(() => WalkinCreate.parse({ storeId: UUID })).toThrow()
    // 空文字は「伺っていない」であって自由記述ではない。
    expect(() => WalkinCreate.parse({ storeId: UUID, purposeNote: '   ' })).toThrow()
  })

  it('accepts a purposeNote of exactly 80 characters and rejects 81', () => {
    expect(
      WalkinCreate.parse({ storeId: UUID, purposeNote: 'あ'.repeat(80) }).purposeNote,
    ).toHaveLength(80)
    expect(() => WalkinCreate.parse({ storeId: UUID, purposeNote: 'あ'.repeat(81) })).toThrow()
  })

  it('allows an explicit null staffId — received without deciding the staff', () => {
    // 「担当はまだ伺っていない」（欄が無い）と「担当を決めずに受け付ける」（null）を分ける。
    expect(WalkinCreate.parse({ ...walkinCreate, staffId: null }).staffId).toBeNull()
    expect('staffId' in WalkinCreate.parse(walkinCreate)).toBe(false)
    expect(() => WalkinCreate.parse({ ...walkinCreate, staffId: 'unassigned' })).toThrow()
  })

  it('allows arrivedAt to be omitted — the server fills it in', () => {
    expect(WalkinCreate.parse(walkinCreate).arrivedAt).toBeUndefined()
    expect(WalkinCreate.parse({ ...walkinCreate, arrivedAt: ARRIVED_AT }).arrivedAt).toBe(
      ARRIVED_AT,
    )
    expect(() => WalkinCreate.parse({ ...walkinCreate, arrivedAt: '2026-08-27 11:02' })).toThrow()
  })

  it('rejects an unknown key so a stale client field never lands silently', () => {
    expect(() => WalkinCreate.parse({ ...walkinCreate, waitedMinutes: 0 })).toThrow()
    expect(() => WalkinCreate.parse({ ...walkinCreate, organizationId: ORG })).toThrow()
  })
})

describe('Walkin', () => {
  it('bounds ticketNo to 1..999, rejecting 0 and 1000', () => {
    expect(Walkin.parse({ ...walkin, ticketNo: 1 }).ticketNo).toBe(1)
    expect(Walkin.parse({ ...walkin, ticketNo: 999 }).ticketNo).toBe(999)
    for (const ticketNo of [0, 1000, 4.5, -1]) {
      expect(() => Walkin.parse({ ...walkin, ticketNo })).toThrow()
    }
  })

  it('requires waitedMinutes to be a non-negative integer', () => {
    expect(Walkin.parse({ ...walkin, waitedMinutes: 0 }).waitedMinutes).toBe(0)
    // 受付時刻が未来でも負の分を出さない（丸めるのはドメイン層）。
    expect(() => Walkin.parse({ ...walkin, waitedMinutes: -1 })).toThrow()
    expect(() => Walkin.parse({ ...walkin, waitedMinutes: 6.5 })).toThrow()
  })

  it('accepts only waiting / serving / booked / left', () => {
    for (const status of ['waiting', 'serving', 'booked', 'left']) {
      expect(Walkin.parse({ ...walkin, status }).status).toBe(status)
    }
    // 「待たずにお帰り」は `waiting → left` の遷移で数える。別の語を足さない。
    for (const status of ['abandoned', 'done', 'arrived']) {
      expect(() => Walkin.parse({ ...walkin, status })).toThrow()
    }
  })

  it('allows a null leftAt and rejects a non-datetime string', () => {
    expect(Walkin.parse(walkin).leftAt).toBeNull()
    expect(Walkin.parse({ ...walkin, status: 'left', leftAt: NOW }).leftAt).toBe(NOW)
    expect(() => Walkin.parse({ ...walkin, leftAt: '2026-08-27 11:40' })).toThrow()
  })

  it('always carries reservationId — the reception opens one booking at the same time', () => {
    expect(Walkin.parse(walkin).reservationId).toBe(uuidOf(3))
    const { reservationId: _dropped, ...withoutReservation } = walkin
    expect(() => Walkin.parse(withoutReservation)).toThrow()
    expect(() => Walkin.parse({ ...walkin, reservationId: null })).toThrow()
  })
})

describe('WalkinListQuery', () => {
  it('requires date so no list is ever built without one day to narrow it', () => {
    expect(WalkinListQuery.parse({ storeId: UUID, date: '2026-08-27' }).date).toBe('2026-08-27')
    // 日付の条件を落とすと、昨日帰られたお客様が今朝の待ち行列に残る。
    expect(() => WalkinListQuery.parse({ storeId: UUID })).toThrow()
    expect(() => WalkinListQuery.parse({ storeId: UUID, date: '2026-8-7' })).toThrow()
  })

  it('takes several statuses as an array', () => {
    const query = { storeId: UUID, date: '2026-08-27' }
    expect(WalkinListQuery.parse({ ...query, status: ['waiting', 'serving'] }).status).toEqual([
      'waiting',
      'serving',
    ])
    // `?status=waiting,serving` の形でも届く。
    expect(WalkinListQuery.parse({ ...query, status: 'waiting,serving' }).status).toHaveLength(2)
    expect(WalkinListQuery.parse(query).status).toEqual([])
    expect(() => WalkinListQuery.parse({ ...query, status: ['abandoned'] })).toThrow()
  })
})

describe('WalkinPatch', () => {
  it('requires version and takes only customerId / staffId / status / reservationId', () => {
    const patch = WalkinPatch.parse({
      version: 1,
      customerId: UUID2,
      staffId: uuidOf(2),
      status: 'serving',
      reservationId: uuidOf(3),
    })
    expect([patch.version, patch.status]).toEqual([1, 'serving'])
    // 版を送らない更新は、2 台の iPad が同じ来店を同時に触ったとき片方を黙って捨てる。
    expect(() => WalkinPatch.parse({ customerId: UUID2 })).toThrow()
    for (const stale of [{ ticketNo: 5 }, { purposeId: UUID2 }, { arrivedAt: ARRIVED_AT }]) {
      expect(() => WalkinPatch.parse({ version: 1, ...stale })).toThrow()
    }
  })
})

describe('WalkinSummary', () => {
  it('carries only the six fields the ledger band shows', () => {
    const summary = WalkinSummary.parse(walkinSummary)
    expect(Object.keys(summary).sort()).toEqual([
      'arrivedAt',
      'id',
      'purposeNote',
      'status',
      'ticketNo',
      'waitedMinutes',
    ])
    expect(() => WalkinSummary.parse({ ...walkinSummary, customerId: UUID2 })).toThrow()
  })
})

describe('VisitStage', () => {
  it('takes the eight words received / waiting / consulting / fitting / measuring / checkout / handover / left', () => {
    for (const stage of [
      'received',
      'waiting',
      'consulting',
      'fitting',
      'measuring',
      'checkout',
      'handover',
      'left',
    ]) {
      expect(VisitStage.parse(stage)).toBe(stage)
    }
    // `left`（退店）を「お渡し」に当てない。`handover` はご来店中に数える別の工程である。
    for (const stage of ['done', 'arrived', 'lens', 'handoff']) {
      expect(() => VisitStage.parse(stage)).toThrow()
    }
  })
})

describe('VisitEventInput', () => {
  it('accepts a note of exactly 120 characters and rejects 121', () => {
    expect(VisitEventInput.parse({ ...visitEventInput, note: 'あ'.repeat(120) }).note).toHaveLength(
      120,
    )
    expect(() => VisitEventInput.parse({ ...visitEventInput, note: 'あ'.repeat(121) })).toThrow()
  })

  it('allows occurredAt to be omitted — the server fills it in', () => {
    expect(VisitEventInput.parse(visitEventInput).occurredAt).toBeUndefined()
    expect(() =>
      VisitEventInput.parse({ ...visitEventInput, occurredAt: '2026-08-27 11:10' }),
    ).toThrow()
    // 埋めたあとの 1 件は必ず発生時刻を持つ（盤面はこの値で並べる）。
    const event = VisitEvent.parse({
      id: UUID,
      subjectType: 'walkin',
      subjectId: UUID2,
      stage: 'consulting',
      occurredAt: NOW,
    })
    expect([event.occurredAt, event.staffId, event.note]).toEqual([NOW, null, null])
  })

  it('takes the two words reservation and walkin as subjectType', () => {
    expect(VisitEventInput.parse(visitEventInput).subjectType).toBe('walkin')
    expect(
      VisitEventInput.parse({ ...visitEventInput, subjectType: 'reservation' }).subjectType,
    ).toBe('reservation')
    for (const subjectType of ['customer', 'session', 'walk_in']) {
      expect(() => VisitEventInput.parse({ ...visitEventInput, subjectType })).toThrow()
    }
  })
})

describe('VisitBoardCell', () => {
  it('takes the five words done / doing / next / waiting / empty as state', () => {
    for (const state of ['done', 'doing', 'next', 'waiting']) {
      expect(VisitBoardCell.parse(boardCell({ state })).state).toBe(state)
    }
    expect(VisitBoardCell.parse({ stage: 'fitting', state: 'empty' }).state).toBe('empty')
    for (const state of ['skipped', 'todo', 'active']) {
      expect(() => VisitBoardCell.parse(boardCell({ state }))).toThrow()
    }
  })

  it('bounds label to 30 characters', () => {
    expect(VisitBoardCell.parse(boardCell({ label: 'あ'.repeat(30) })).label).toHaveLength(30)
    expect(() => VisitBoardCell.parse(boardCell({ label: 'あ'.repeat(31) }))).toThrow()
  })

  it('keeps the attention sentence in a field of its own, never merged into label', () => {
    const cell = VisitBoardCell.parse(
      boardCell({ note: '視力測定機 A は点検で止まっています。', needsAttention: true }),
    )
    // 設備名（label）はそのまま残り、注意（note）は別の欄で別の上限を持つ。
    expect([cell.label, cell.note]).toEqual([
      '視力測定機 A',
      '視力測定機 A は点検で止まっています。',
    ])
    expect(
      VisitBoardCell.parse(boardCell({ note: 'あ'.repeat(40), needsAttention: true })).note,
    ).toHaveLength(40)
    expect(() =>
      VisitBoardCell.parse(boardCell({ note: 'あ'.repeat(41), needsAttention: true })),
    ).toThrow()
  })

  it('turns needsAttention true exactly when the cell carries an attention sentence', () => {
    // 色だけで伝えないための欄なので、文と旗が食い違った応答を通さない。
    expect(() =>
      VisitBoardCell.parse(boardCell({ note: '本日はお休みです。担当を決め直してください。' })),
    ).toThrow()
    expect(() => VisitBoardCell.parse(boardCell({ needsAttention: true }))).toThrow()
    expect(
      VisitBoardCell.parse(
        boardCell({ note: '本日はお休みです。担当を決め直してください。', needsAttention: true }),
      ).needsAttention,
    ).toBe(true)
  })

  it('leaves an empty cell without a time, a label or an attention', () => {
    const empty = VisitBoardCell.parse({ stage: 'checkout', state: 'empty' })
    expect([empty.at, empty.label, empty.note, empty.needsAttention]).toEqual([
      null,
      '',
      null,
      false,
    ])
    // 何も起きていない欄に文字を足さない（工程を飛ばした行は飛ばした列を空のまま置く）。
    for (const filled of [{ at: NOW }, { label: '視力測定機 A' }]) {
      expect(() => VisitBoardCell.parse({ stage: 'checkout', state: 'empty', ...filled })).toThrow()
    }
  })
})

describe('VisitBoardQuery', () => {
  it('defaults scope to active', () => {
    expect(VisitBoardQuery.parse({ storeId: UUID, date: '2026-08-27' }).scope).toBe('active')
    expect(VisitBoardQuery.parse({ storeId: UUID, date: '2026-08-27', scope: 'all' }).scope).toBe(
      'all',
    )
    expect(() =>
      VisitBoardQuery.parse({ storeId: UUID, date: '2026-08-27', scope: 'today' }),
    ).toThrow()
  })
})

describe('VisitBoardRow', () => {
  it('allows a null visitCount on a walk-in row', () => {
    // 「ウォークイン 003」の行は来店回数の札を持たない（お客様がまだ特定されていない）。
    const row = VisitBoardRow.parse({
      ...boardRow,
      subjectType: 'walkin',
      displayName: 'ウォークイン 003',
      visitCount: null,
    })
    expect([row.displayName, row.visitCount]).toEqual(['ウォークイン 003', null])
    expect(VisitBoardRow.parse(boardRow).visitCount).toBe(4)
  })
})

describe('VisitBoard', () => {
  it('always carries serverNow so no board is drawn from the tablet clock', () => {
    const board = VisitBoard.parse({
      date: '2026-08-27',
      activeCount: 4,
      rows: [boardRow],
      serverNow: NOW,
    })
    expect([board.activeCount, board.serverNow]).toEqual([4, NOW])
    expect(() =>
      VisitBoard.parse({ date: '2026-08-27', activeCount: 4, rows: [boardRow] }),
    ).toThrow()
  })
})

describe('ReceptionHistoryQuery', () => {
  it('accepts a span of exactly 92 days and rejects 93', () => {
    expect(ReceptionHistoryQuery.parse({ from: '2026-05-27', to: '2026-08-27' }).to).toBe(
      '2026-08-27',
    )
    expect(() => ReceptionHistoryQuery.parse({ from: '2026-05-26', to: '2026-08-27' })).toThrow()
  })

  it('rejects a span whose from is later than its to', () => {
    // 逆向きの範囲を 0 件で返すと、画面が黙って空になり理由が分からない。
    expect(() => ReceptionHistoryQuery.parse({ from: '2026-08-27', to: '2026-08-01' })).toThrow()
  })

  it('bounds name to 40 characters', () => {
    expect(ReceptionHistoryQuery.parse({ ...historyQuery, name: '田中' }).name).toBe('田中')
    expect(() => ReceptionHistoryQuery.parse({ ...historyQuery, name: 'あ'.repeat(41) })).toThrow()
  })

  it('defaults limit to 50 and rejects 0 and 201', () => {
    expect(ReceptionHistoryQuery.parse(historyQuery).limit).toBe(50)
    expect(ReceptionHistoryQuery.parse({ ...historyQuery, limit: '20' }).limit).toBe(20)
    expect(() => ReceptionHistoryQuery.parse({ ...historyQuery, limit: 0 })).toThrow()
    expect(() => ReceptionHistoryQuery.parse({ ...historyQuery, limit: 201 })).toThrow()
  })
})

describe('ReceptionHistoryEntry', () => {
  it('allows a null sessionId — a web booking has no reception session', () => {
    const web = ReceptionHistoryEntry.parse({ ...historyEntry, sessionId: null, outcome: null })
    expect([web.sessionId, web.outcome]).toEqual([null, null])
    expect(ReceptionHistoryEntry.parse(historyEntry).sessionId).toBe(UUID2)
  })

  it('always carries entryId', () => {
    expect(ReceptionHistoryEntry.parse(historyEntry).entryId).toBe(UUID)
    const { entryId: _dropped, ...withoutEntryId } = historyEntry
    expect(() => ReceptionHistoryEntry.parse(withoutEntryId)).toThrow()
  })
})

describe('ReceptionHistoryList', () => {
  it('may carry relaxations only when the list is empty', () => {
    const empty = ReceptionHistoryList.parse({ items: [], total: 0, relaxations: [relaxation] })
    expect(empty.relaxations).toHaveLength(1)
    // 緩められる条件が 1 つも無ければ 0 件のままでよい（行き止まりを作らない工夫であって義務ではない）。
    expect(ReceptionHistoryList.parse({ items: [], total: 0 }).relaxations).toEqual([])
  })

  it('rejects a response carrying relaxations alongside one or more items', () => {
    expect(() =>
      ReceptionHistoryList.parse({
        items: [historyEntry],
        total: 46,
        relaxations: [relaxation],
      }),
    ).toThrow()
    expect(
      ReceptionHistoryList.parse({ items: [historyEntry], total: 46, nextCursor: 'c1' }).nextCursor,
    ).toBe('c1')
  })

  it('bounds relaxations to three', () => {
    const three = [1, 2, 3].map((n) => ({ ...relaxation, count: n }))
    expect(
      ReceptionHistoryList.parse({ items: [], total: 0, relaxations: three }).relaxations,
    ).toHaveLength(3)
    expect(() =>
      ReceptionHistoryList.parse({ items: [], total: 0, relaxations: [...three, relaxation] }),
    ).toThrow()
  })
})

describe('ReceptionHistoryDetail', () => {
  it('carries changes as an array and allows a null recording', () => {
    const detail = ReceptionHistoryDetail.parse(historyDetail)
    expect(detail.changes).toHaveLength(1)
    expect(detail.changes[0]?.what).toBe('新しく受け付けました')
    // 録音は P7（`010-recording`）が埋めるまで常に null である。
    expect(detail.recording).toBeNull()
    expect(() => ReceptionHistoryDetail.parse({ ...historyDetail, changes: null })).toThrow()
  })
})

describe('SearchRelaxation', () => {
  it('requires a count of one or more so no candidate points at zero hits', () => {
    expect(SearchRelaxation.parse(relaxation).count).toBe(12)
    expect(() => SearchRelaxation.parse({ ...relaxation, count: 0 })).toThrow()
    expect(() => SearchRelaxation.parse({ ...relaxation, count: 1.5 })).toThrow()
  })

  it('bounds label to 60 characters', () => {
    expect(SearchRelaxation.parse({ ...relaxation, label: 'あ'.repeat(60) }).label).toHaveLength(60)
    expect(() => SearchRelaxation.parse({ ...relaxation, label: 'あ'.repeat(61) })).toThrow()
    expect(() => SearchRelaxation.parse({ ...relaxation, label: '' })).toThrow()
  })
})

describe('LedgerView', () => {
  it('always carries walkinWaitingCount and nextTicketNo, and allows a null estimatedWaitMinutes', () => {
    const view = LedgerView.parse(ledgerView)
    expect([view.walkinWaitingCount, view.nextTicketNo]).toEqual([2, 5])
    // 目安は空き枠エンジンが出せたときだけ載せる（担当の空きを見ない数字をお客様に伝えない）。
    expect(
      LedgerView.parse({ ...ledgerView, estimatedWaitMinutes: null }).estimatedWaitMinutes,
    ).toBeNull()
    for (const key of ['walkinWaitingCount', 'nextTicketNo']) {
      const { [key]: _dropped, ...missing } = ledgerView as Record<string, unknown>
      expect(() => LedgerView.parse(missing)).toThrow()
    }
    expect(() => LedgerView.parse({ ...ledgerView, nextTicketNo: 1000 })).toThrow()
    expect(() => LedgerView.parse({ ...ledgerView, walkinWaitingCount: -1 })).toThrow()
  })
})

describe('ReservationCancelInput', () => {
  const input = { version: 1, reason: 'no_show' as const }

  it('accepts only the four cancel reasons', () => {
    for (const reason of ['customer', 'store', 'duplicate', 'no_show']) {
      expect(ReservationCancelInput.parse({ ...input, reason }).reason).toBe(reason)
    }
    expect(() => ReservationCancelInput.parse({ ...input, reason: 'cancelled' })).toThrow()
    expect(() => ReservationCancelInput.parse({ ...input, reason: '' })).toThrow()
  })

  it('requires a version of one or more', () => {
    expect(() => ReservationCancelInput.parse({ reason: 'no_show' })).toThrow()
    expect(() => ReservationCancelInput.parse({ ...input, version: 0 })).toThrow()
    expect(() => ReservationCancelInput.parse({ ...input, version: 1.5 })).toThrow()
  })

  it('refuses a status written straight from the client', () => {
    expect(() => ReservationCancelInput.parse({ ...input, status: 'done' })).toThrow()
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * P6 予約の検索・変更・取消（`009-change-and-cancel`）
 * ─────────────────────────────────────────────────────────────────────────── */

const reservationSummary = {
  id: UUID,
  code: 'EY-2608-0142',
  startsAt: START,
  durationMinutes: 60,
  status: 'confirmed',
  source: 'phone',
  customerName: '田中 花子',
  visitCount: 4,
  purposeLabel: '新調相談・視力測定',
  staffName: '佐藤 美咲',
}

describe('ReservationSearchQuery', () => {
  it('accepts a name, a phone or a code on its own', () => {
    // お客様が読み上げてくださるのは 3 つのうちどれか 1 つである。
    expect(ReservationSearchQuery.parse({ name: '田中' }).name).toBe('田中')
    expect(ReservationSearchQuery.parse({ phone: '5678' }).phone).toBe('5678')
    expect(ReservationSearchQuery.parse({ code: 'EY-2608-0142' }).code).toBe('EY-2608-0142')
    expect(ReservationSearchQuery.parse({ kana: 'たなか はなこ' }).kana).toBe('たなか はなこ')
  })

  it('takes a phone of exactly four digits or of full length, and rejects five to nine', () => {
    // 下 4 桁は `customers.phone_last4` の完全一致、全桁は `phone_normalized` の前方一致。
    expect(ReservationSearchQuery.parse({ phone: '5678' }).phone).toBe('5678')
    expect(ReservationSearchQuery.parse({ phone: '090-1234-5678' }).phone).toBe('090-1234-5678')
    expect(ReservationSearchQuery.parse({ phone: '09012345678' }).phone).toBe('09012345678')
    // 途中まで打った 5〜9 桁を通すと、どちらの経路にも乗らない問い合わせが作れてしまう。
    for (const phone of ['56789', '123456', '1234567', '12345678', '123456789']) {
      expect(() => ReservationSearchQuery.parse({ phone }), phone).toThrow()
    }
  })

  it('takes both EY-2608-0142 and EY-W-2608-0031 as a code', () => {
    // お客様が読み上げるのは Web のご予約番号のほうなので、両方の書式で引けるようにする。
    expect(ReservationSearchQuery.parse({ code: 'EY-2608-0142' }).code).toBe('EY-2608-0142')
    expect(ReservationSearchQuery.parse({ code: 'EY-W-2608-0031' }).code).toBe('EY-W-2608-0031')
    expect(() => ReservationSearchQuery.parse({ code: 'EY-2608-014' })).toThrow()
    expect(() => ReservationSearchQuery.parse({ code: '0142' })).toThrow()
  })

  it('takes a code that has carried over into five digits', () => {
    // 組織 × YYMM の連番が 9999 を越えた月は 5 桁になる。
    expect(ReservationSearchQuery.parse({ code: 'EY-2608-10000' }).code).toBe('EY-2608-10000')
    expect(ReservationSearchQuery.parse({ code: 'EY-W-2608-10000' }).code).toBe('EY-W-2608-10000')
    expect(() => ReservationSearchQuery.parse({ code: 'EY-2608-100000' })).toThrow()
  })

  it('defaults includeCancelled to false', () => {
    // 取り消されたご予約は既定で並べない（「取消済み」の札を押したときだけ加わる）。
    expect(ReservationSearchQuery.parse({ name: '田中' }).includeCancelled).toBe(false)
    expect(ReservationSearchQuery.parse({ includeCancelled: 'true' }).includeCancelled).toBe(true)
    expect(ReservationSearchQuery.parse({ includeCancelled: '1' }).includeCancelled).toBe(true)
    expect(ReservationSearchQuery.parse({ includeCancelled: '0' }).includeCancelled).toBe(false)
  })

  it('takes only false for crossStore', () => {
    // Q-04 のいまの前提。別店舗のご予約は見せないので、画面に押せない導線を置かない。
    // 答えが来たら `z.boolean()` へ戻す（そのときだけ true が通るようになる）。
    expect(ReservationSearchQuery.parse({ name: '田中' }).crossStore).toBe(false)
    expect(ReservationSearchQuery.parse({ crossStore: false }).crossStore).toBe(false)
    expect(() => ReservationSearchQuery.parse({ crossStore: true })).toThrow()
  })

  it('rejects an unknown key', () => {
    expect(() => ReservationSearchQuery.parse({ name: '田中', storeIds: [UUID] })).toThrow()
    expect(() => ReservationSearchQuery.parse({ name: '田中', organizationId: ORG })).toThrow()
  })
})

describe('ReservationList', () => {
  it('carries one to three relaxations only when the result is empty', () => {
    const empty = ReservationList.parse({ items: [], total: 0, relaxations: [relaxation] })
    expect(empty.relaxations).toHaveLength(1)
    expect(ReservationList.parse({ items: [], total: 0 }).relaxations).toEqual([])
    const three = [1, 2, 3].map((n) => ({ ...relaxation, count: n }))
    expect(ReservationList.parse({ items: [], total: 0, relaxations: three })).toBeTruthy()
    expect(() =>
      ReservationList.parse({ items: [], total: 0, relaxations: [...three, relaxation] }),
    ).toThrow()
    // 1 件以上あるのに候補が付くと、いま見えている一覧が信用できなくなる。
    expect(() =>
      ReservationList.parse({ items: [reservationSummary], total: 4, relaxations: [relaxation] }),
    ).toThrow()
    expect(ReservationList.parse({ items: [reservationSummary], total: 4 }).items[0]?.code).toBe(
      'EY-2608-0142',
    )
  })
})

describe('ReservationSummary', () => {
  it('allows a null staffName — the row is drawn as 担当が未定', () => {
    const undecided = ReservationSummary.parse({ ...reservationSummary, staffName: null })
    expect(undecided.staffName).toBeNull()
    const { staffName: _dropped, ...omitted } = reservationSummary
    expect(ReservationSummary.parse(omitted).staffName).toBeNull()
    expect(ReservationSummary.parse(reservationSummary).staffName).toBe('佐藤 美咲')
  })
})

describe('ReservationChangeInput', () => {
  it('requires a version and lets every other field be omitted', () => {
    expect(ReservationChangeInput.parse({ version: 3, startsAt: START }).version).toBe(3)
    expect(
      ReservationChangeInput.parse({ version: 3, durationMinutes: 90 }).startsAt,
    ).toBeUndefined()
    expect(ReservationChangeInput.parse({ version: 3, purposeIds: [UUID] }).purposeIds).toEqual([
      UUID,
    ])
    expect(
      ReservationChangeInput.parse({ version: 3, noteInternal: '車でお越し' }).noteCustomer,
    ).toBeUndefined()
    // 版が無い変更は楽観ロックを外して送っているのと同じなので通さない。
    expect(() => ReservationChangeInput.parse({ startsAt: START })).toThrow()
    expect(() => ReservationChangeInput.parse({ version: 0, startsAt: START })).toThrow()
  })

  it('takes a null staffId — 担当をあとで決める へ戻す', () => {
    expect(ReservationChangeInput.parse({ version: 3, staffId: null }).staffId).toBeNull()
    expect(ReservationChangeInput.parse({ version: 3, staffId: UUID2 }).staffId).toBe(UUID2)
  })

  it('defaults notify to false', () => {
    // CHANGE-DIFF「お電話でのご予約のため、メールは送りません。」
    expect(ReservationChangeInput.parse({ version: 3, startsAt: START }).notify).toBe(false)
    expect(ReservationChangeInput.parse({ version: 3, startsAt: START, notify: true }).notify).toBe(
      true,
    )
  })

  it('rejects the same purpose or the same equipment twice', () => {
    // 変更は確定と同じ占有行を積み直すので、同じ id を 2 回受けると枠が二重に減る。
    expect(() => ReservationChangeInput.parse({ version: 3, purposeIds: [UUID, UUID] })).toThrow()
    expect(() => ReservationChangeInput.parse({ version: 3, equipmentIds: [UUID, UUID] })).toThrow()
    expect(
      ReservationChangeInput.parse({ version: 3, equipmentIds: [UUID, UUID2] }).equipmentIds,
    ).toEqual([UUID, UUID2])
  })

  it('rejects an input that changes nothing', () => {
    // 何も変わらない要求を通すと、版だけが進んで差分表が空のまま監査に 1 行残る。
    expect(() => ReservationChangeInput.parse({ version: 3 })).toThrow()
    expect(() => ReservationChangeInput.parse({ version: 3, notify: true })).toThrow()
  })
})

describe('ReservationCancelInput（理由の必須）', () => {
  it('rejects an input with no reason', () => {
    // 理由の無い取消は ANALYTICS-CANCEL の内訳と受付履歴の説明を空にする。
    expect(() => ReservationCancelInput.parse({ version: 1 })).toThrow()
    // 既定値も持たない（押し間違いが「お客様のご都合」として残らないようにする）。
    expect(ReservationCancelInput.parse({ version: 1, reason: 'store' }).reason).toBe('store')
  })
})

describe('ReservationChangeHistory', () => {
  it('bounds what to 120 characters and allows a null actorName', () => {
    const line = { occurredAt: NOW, what: 'ご来店時刻を 11:00 から 14:00 へ', actorName: '中村 彩' }
    expect(ReservationChangeHistory.parse(line).what).toBe('ご来店時刻を 11:00 から 14:00 へ')
    expect(ReservationChangeHistory.parse({ ...line, what: 'あ'.repeat(120) }).what).toHaveLength(
      120,
    )
    expect(() => ReservationChangeHistory.parse({ ...line, what: 'あ'.repeat(121) })).toThrow()
    expect(() => ReservationChangeHistory.parse({ ...line, what: '' })).toThrow()
    // 共有端末でご本人の確認をしていない操作は名前が残らない。
    expect(ReservationChangeHistory.parse({ ...line, actorName: null }).actorName).toBeNull()
    const { actorName: _dropped, ...omitted } = line
    expect(ReservationChangeHistory.parse(omitted).actorName).toBeNull()
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * P7 受付の録音（`specs/glasses_management/features/010-recording`）
 * ─────────────────────────────────────────────────────────────────────────── */

const recording = {
  id: UUID,
  code: 'EY-R-1482',
  receptionSessionId: UUID2,
  reservationId: null,
  state: 'stored',
  contentType: 'audio/mp4',
  durationSeconds: 192,
  bytes: 1_400_000,
  retainUntil: '2026-09-26T02:08:00.000Z',
  legalHold: false,
  uploadAttempts: 1,
  createdAt: NOW,
}

const alert = {
  id: UUID,
  code: 'recording.upload_failed',
  severity: 'action',
  audience: 'store',
  title: '録音の保存に3回失敗しました',
  body: 'EY-R-1482　田中 花子 様。ご予約は成立しています。',
  targetType: 'recording',
  targetId: UUID2,
  occurredAt: NOW,
  readAt: null,
  resolvedAt: null,
  resolvedBy: null,
}

describe('RecordingCode', () => {
  it('accepts EY-R-0001 and EY-R-10000 but not a reservation code', () => {
    // 組織で通しの 4 桁ゼロ埋め。9999 を越えた組織だけ 5 桁になる。
    expect(RecordingCode.parse('EY-R-0001')).toBe('EY-R-0001')
    expect(RecordingCode.parse('EY-R-1482')).toBe('EY-R-1482')
    expect(RecordingCode.parse('EY-R-10000')).toBe('EY-R-10000')
    // ご予約番号（`EY-YYMM-NNNN`）とは別の採番系統なので、取り違えを書式で弾く。
    expect(() => RecordingCode.parse('EY-2608-0142')).toThrow()
    expect(() => RecordingCode.parse('EY-R-001')).toThrow()
    expect(() => RecordingCode.parse('EY-R-100000')).toThrow()
    expect(() => RecordingCode.parse('ey-r-0001')).toThrow()
  })
})

describe('RecordingState', () => {
  it('is an allow-list of five states and fails closed on anything else', () => {
    expect(RecordingState.options).toEqual([
      'recording',
      'uploading',
      'stored',
      'failed',
      'deleted',
    ])
    for (const state of RecordingState.options) expect(RecordingState.parse(state)).toBe(state)
    // 知らない語を通すと、掃除の Cron が拾えない状態の行が黙って増える。
    for (const unknown of ['pending', 'purged', 'STORED', '']) {
      expect(() => RecordingState.parse(unknown), unknown).toThrow()
    }
  })
})

describe('RecordingContentType', () => {
  it('accepts audio/mp4, audio/webm and audio/mpeg only', () => {
    expect(RecordingContentType.options).toEqual(['audio/mp4', 'audio/webm', 'audio/mpeg'])
    // 許可リストの外は 400。R2 に置ける形式を 3 つに絞って再生側の分岐を増やさない。
    for (const unknown of ['audio/wav', 'video/mp4', 'application/octet-stream', 'audio/*']) {
      expect(() => RecordingContentType.parse(unknown), unknown).toThrow()
    }
  })
})

describe('RecordingCreate', () => {
  it('requires a reception session id, a store id and an ISO startedAt', () => {
    const parsed = RecordingCreate.parse({
      receptionSessionId: UUID,
      storeId: UUID2,
      startedAt: NOW,
    })
    expect(parsed.receptionSessionId).toBe(UUID)
    expect(parsed.storeId).toBe(UUID2)
    // 既定は iPadOS の Safari が確実に出せる `audio/mp4`。
    expect(parsed.contentType).toBe('audio/mp4')
    expect(() => RecordingCreate.parse({ storeId: UUID2, startedAt: NOW })).toThrow()
    expect(() => RecordingCreate.parse({ receptionSessionId: UUID, startedAt: NOW })).toThrow()
    expect(() =>
      RecordingCreate.parse({ receptionSessionId: UUID, storeId: UUID2, startedAt: '2026-08-27' }),
    ).toThrow()
  })

  it('rejects an unknown key so a stale client field never lands silently', () => {
    // R2 のキーは端末が決めるものではない。受けた時点で 400 にする。
    expect(
      RecordingCreate.parse({ receptionSessionId: UUID, storeId: UUID2, startedAt: NOW }).storeId,
    ).toBe(UUID2)
    expect(() =>
      RecordingCreate.parse({
        receptionSessionId: UUID,
        storeId: UUID2,
        startedAt: NOW,
        r2Key: 'recordings/org/store/2026/08/x.m4a',
      }),
    ).toThrow()
    expect(() =>
      RecordingCreate.parse({
        receptionSessionId: UUID,
        storeId: UUID2,
        startedAt: NOW,
        organizationId: ORG,
      }),
    ).toThrow()
  })
})

describe('RecordingStatePatch', () => {
  it('bounds durationSeconds to 0..21600 and bytes to 0..104857600', () => {
    expect(RecordingStatePatch.parse({ state: 'stored', durationSeconds: 0 }).durationSeconds).toBe(
      0,
    )
    expect(
      RecordingStatePatch.parse({ state: 'stored', durationSeconds: 21_600 }).durationSeconds,
    ).toBe(21_600)
    expect(() => RecordingStatePatch.parse({ state: 'stored', durationSeconds: -1 })).toThrow()
    expect(() => RecordingStatePatch.parse({ state: 'stored', durationSeconds: 21_601 })).toThrow()
    // 100MB。1 録音 1 キーなので、越えた要求は分割せず 1 回の失敗として数える。
    expect(RecordingStatePatch.parse({ state: 'stored', bytes: 104_857_600 }).bytes).toBe(
      104_857_600,
    )
    expect(() => RecordingStatePatch.parse({ state: 'stored', bytes: 104_857_601 })).toThrow()
    expect(() => RecordingStatePatch.parse({ state: 'stored', bytes: -1 })).toThrow()
    expect(() => RecordingStatePatch.parse({ state: 'stored', bytes: 1.5 })).toThrow()
  })

  it('accepts a failureReason of 120 characters and rejects 121', () => {
    expect(
      RecordingStatePatch.parse({ state: 'failed', failureReason: 'あ'.repeat(120) }).failureReason,
    ).toHaveLength(120)
    expect(() =>
      RecordingStatePatch.parse({ state: 'failed', failureReason: 'あ'.repeat(121) }),
    ).toThrow()
    expect(RecordingStatePatch.parse({ state: 'failed' }).failureReason).toBeUndefined()
  })
})

describe('Recording', () => {
  it('never carries the R2 key — parsing strips it', () => {
    // 応答は必ずこのスキーマを通す。`strictObject` なので、行をそのまま渡すと落ちる。
    expect(() => Recording.parse({ ...recording, r2Key: 'recordings/o/s/2026/08/x.m4a' })).toThrow()
    expect(Object.keys(Recording.parse(recording))).not.toContain('r2Key')
    expect(Object.keys(Recording.parse(recording))).not.toContain('downloadUrl')
  })

  it('keeps reservationId nullable because a discarded reception has no reservation', () => {
    expect(Recording.parse(recording).reservationId).toBeNull()
    const { reservationId: _dropped, ...omitted } = recording
    expect(Recording.parse(omitted).reservationId).toBeNull()
    expect(Recording.parse({ ...recording, reservationId: UUID2 }).reservationId).toBe(UUID2)
  })

  it('bounds uploadAttempts to 0..99', () => {
    expect(Recording.parse({ ...recording, uploadAttempts: 0 }).uploadAttempts).toBe(0)
    expect(Recording.parse({ ...recording, uploadAttempts: 99 }).uploadAttempts).toBe(99)
    expect(() => Recording.parse({ ...recording, uploadAttempts: -1 })).toThrow()
    expect(() => Recording.parse({ ...recording, uploadAttempts: 100 })).toThrow()
  })
})

describe('RecordingSummary', () => {
  it('carries only id, state and durationSeconds', () => {
    const parsed = RecordingSummary.parse({ id: UUID, state: 'stored', durationSeconds: 192 })
    expect(Object.keys(parsed).sort()).toEqual(['durationSeconds', 'id', 'state'])
    // 「03:12」を出すのに要るのは長さだけ。埋め込み側に R2 の手がかりを渡さない。
    expect(() => RecordingSummary.parse(recording)).toThrow()
    expect(RecordingSummary.parse({ id: UUID, state: 'failed' }).durationSeconds).toBeNull()
  })
})

describe('RecordingListQuery', () => {
  it('defaults limit to 50 and rejects 0 and 201', () => {
    expect(RecordingListQuery.parse({}).limit).toBe(50)
    expect(RecordingListQuery.parse({}).state).toEqual([])
    expect(RecordingListQuery.parse({ limit: '8' }).limit).toBe(8)
    expect(RecordingListQuery.parse({ state: 'failed' }).state).toEqual(['failed'])
    expect(RecordingListQuery.parse({ state: 'failed,stored' }).state).toEqual(['failed', 'stored'])
    expect(() => RecordingListQuery.parse({ limit: 0 })).toThrow()
    expect(() => RecordingListQuery.parse({ limit: 201 })).toThrow()
    expect(() => RecordingListQuery.parse({ state: 'purged' })).toThrow()
  })

  it('ご予約・受付で絞れる（画面が「録音を聞く」の 1 本を特定する手段）', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(RecordingListQuery.parse({ reservationId: id }).reservationId).toBe(id)
    expect(RecordingListQuery.parse({ receptionSessionId: id }).receptionSessionId).toBe(id)
    expect(RecordingListQuery.parse({}).reservationId).toBeUndefined()
    expect(() => RecordingListQuery.parse({ reservationId: 'いろは' })).toThrow()
  })
})

describe('RecordingList', () => {
  it('has the items / nextCursor / total shape', () => {
    const list = RecordingList.parse({ items: [recording], total: 1 })
    expect(list.items[0]?.code).toBe('EY-R-1482')
    expect(list.nextCursor).toBeNull()
    expect(RecordingList.parse({ total: 0 }).items).toEqual([])
  })
})

describe('RecordingPlaybackTicket', () => {
  it('requires a token of 32..256 characters', () => {
    const token = 'a'.repeat(64)
    const parsed = RecordingPlaybackTicket.parse({ token, expiresAt: NOW, durationSeconds: 192 })
    expect(parsed.token).toBe(token)
    expect(RecordingPlaybackTicket.parse({ token, expiresAt: NOW }).durationSeconds).toBeNull()
    expect(() => RecordingPlaybackTicket.parse({ token: 'a'.repeat(31), expiresAt: NOW })).toThrow()
    expect(
      RecordingPlaybackTicket.parse({ token: 'a'.repeat(32), expiresAt: NOW }).token,
    ).toHaveLength(32)
    expect(() =>
      RecordingPlaybackTicket.parse({ token: 'a'.repeat(257), expiresAt: NOW }),
    ).toThrow()
  })
})

describe('RecordingHoldInput', () => {
  it('requires a reason of 1..120 characters', () => {
    expect(RecordingHoldInput.parse({ legalHold: true, reason: '苦情の調査' }).legalHold).toBe(true)
    expect(
      RecordingHoldInput.parse({ legalHold: false, reason: 'あ'.repeat(120) }).reason,
    ).toHaveLength(120)
    // 理由の無い保全は、外していいのかを後から誰も判断できない。
    expect(() => RecordingHoldInput.parse({ legalHold: true })).toThrow()
    expect(() => RecordingHoldInput.parse({ legalHold: true, reason: '' })).toThrow()
    expect(() => RecordingHoldInput.parse({ legalHold: true, reason: 'あ'.repeat(121) })).toThrow()
  })
})

describe('RecordingPurgeRequest', () => {
  it('defaults limit to 100 and accepts an injected now', () => {
    expect(RecordingPurgeRequest.parse({}).limit).toBe(100)
    expect(RecordingPurgeRequest.parse({}).now).toBeUndefined()
    // 保持期限の境界をテストから確かめるための注入口。
    expect(RecordingPurgeRequest.parse({ now: NOW }).now).toBe(NOW)
    expect(RecordingPurgeRequest.parse({ limit: 500 }).limit).toBe(500)
    expect(() => RecordingPurgeRequest.parse({ limit: 0 })).toThrow()
    expect(() => RecordingPurgeRequest.parse({ limit: 501 })).toThrow()
    expect(() => RecordingPurgeRequest.parse({ now: '2026-08-27' })).toThrow()
  })
})

describe('RecordingPurgeResult', () => {
  it('counts examined, deleted, skippedHeld and failed', () => {
    const parsed = RecordingPurgeResult.parse({
      examined: 12,
      deleted: 9,
      skippedHeld: 2,
      failed: 1,
    })
    expect(Object.keys(parsed).sort()).toEqual(['deleted', 'examined', 'failed', 'skippedHeld'])
    // 保全で残したものと消せなかったものを 1 つの数に混ぜない。
    expect(parsed.skippedHeld).toBe(2)
    expect(() => RecordingPurgeResult.parse({ examined: 1, deleted: 0, skippedHeld: 0 })).toThrow()
    expect(() =>
      RecordingPurgeResult.parse({ examined: -1, deleted: 0, skippedHeld: 0, failed: 0 }),
    ).toThrow()
  })
})

describe('RecordingRetainedError', () => {
  it('carries retainUntil and legalHold alongside the error code', () => {
    const parsed = RecordingRetainedError.parse({
      error: 'recording_retained',
      retainUntil: '2026-09-26T02:08:00.000Z',
      legalHold: false,
    })
    expect(parsed.error).toBe('recording_retained')
    // 「いつから消せるか」を返さないと、画面が「もう一度あとで」としか言えない。
    expect(parsed.retainUntil).toBe('2026-09-26T02:08:00.000Z')
    expect(parsed.legalHold).toBe(false)
    expect(() =>
      RecordingRetainedError.parse({ error: 'not_found', retainUntil: NOW, legalHold: false }),
    ).toThrow()
    expect(() => RecordingRetainedError.parse({ error: 'recording_retained' })).toThrow()
  })
})

describe('AlertCode', () => {
  it('is the ten-value allow-list and spells store.no_shift', () => {
    expect(AlertCode.options).toHaveLength(10)
    expect(AlertCode.parse('recording.upload_failed')).toBe('recording.upload_failed')
    // `staff.no_shift` にしない（`07-nfr.md` §11.3 / §11.4 と同じ綴り）。
    expect(AlertCode.parse('store.no_shift')).toBe('store.no_shift')
    expect(() => AlertCode.parse('staff.no_shift')).toThrow()
    expect(AlertCode.options).toEqual([
      'recording.upload_failed',
      'web_booking.pending',
      'equipment.maintenance_scheduled',
      'store.closed_with_reservations',
      'reservation.unclosed',
      'store.no_shift',
      'web_booking.auto_cancelled',
      'notifier.send_failed',
      'org.not_synced',
      'd1.capacity_warning',
    ])
  })
})

describe('Alert', () => {
  it('bounds title to 1..60 and body to 0..120', () => {
    expect(Alert.parse(alert).title).toBe('録音の保存に3回失敗しました')
    expect(Alert.parse({ ...alert, title: 'あ'.repeat(60) }).title).toHaveLength(60)
    expect(() => Alert.parse({ ...alert, title: 'あ'.repeat(61) })).toThrow()
    expect(() => Alert.parse({ ...alert, title: '' })).toThrow()
    expect(Alert.parse({ ...alert, body: '' }).body).toBe('')
    expect(Alert.parse({ ...alert, body: 'あ'.repeat(120) }).body).toHaveLength(120)
    expect(() => Alert.parse({ ...alert, body: 'あ'.repeat(121) })).toThrow()
    // 運用の失敗は `audience='ops'` で残し、ALERTS には出さない。
    expect(Alert.parse({ ...alert, audience: 'ops' }).audience).toBe('ops')
    const { audience: _dropped, ...omitted } = alert
    expect(Alert.parse(omitted).audience).toBe('store')
  })
})

describe('AlertListQuery', () => {
  it('does not expose an audience selector to store clients', () => {
    // 運用のアラートを業務のお知らせに混ぜない。
    expect(AlertListQuery.parse({}).limit).toBe(50)
    expect(AlertListQuery.parse({ storeId: UUID }).storeId).toBe(UUID)
    expect(() => AlertListQuery.parse({ audience: 'store' })).toThrow()
    expect(() => AlertListQuery.parse({ audience: 'ops' })).toThrow()
    expect(AlertListQuery.parse({ kind: 'action' }).kind).toBe('action')
    expect(() => AlertListQuery.parse({ kind: 'unknown' })).toThrow()
  })
})

describe('AlertList', () => {
  it('has the items / nextCursor / total shape', () => {
    const list = AlertList.parse({ items: [alert], nextCursor: null, total: 1 })
    expect(list.items[0]?.code).toBe('recording.upload_failed')
    expect(list.total).toBe(1)
    expect(AlertList.parse({ total: 0 }).items).toEqual([])
    expect(AlertList.parse({ total: 0 }).nextCursor).toBeNull()
    // `counts` の 4 分類は P10。
    expect(() => AlertList.parse({ items: [], total: 0, counts: { all: 0 } })).toThrow()
  })
})

/* --- P8 お客様向け Web 予約（011-web-booking） ---------------------------- */

const webBookingSettingsInput = {
  isPublished: true,
  opensAt: '10:30',
  closesAt: '18:00',
  acceptFromHours: 2,
  acceptUntilDays: 30,
  changeDeadlineDays: 1,
  requiresApproval: true,
  message: '9月30日（水）は棚卸しのためお休みをいただきます。',
  publishedPurposeIds: [UUID, UUID2],
  version: 3,
}

const webBookingSettings = {
  ...webBookingSettingsInput,
  storeId: UUID,
  landingPath: 'eyex.jp/ginza',
  updatedAt: NOW,
}

const publicBookingCreate = {
  purposeId: UUID,
  startsAt: START,
  contactName: '山口 真央',
  contactKana: 'やまぐち まお',
  contactPhone: '080-2345-6789',
  contactEmail: 'm.yamaguchi@example.jp',
}

const publicBookingResult = {
  code: 'EY-W-2608-0031',
  status: 'pending',
  startsAt: START,
  endsAt: END,
  storeName: 'EYEX 銀座店',
  purposeName: '新しいメガネを作る',
  contactName: '山口 真央',
  managementCode: 'K7M4PXQ2',
  emailed: true,
}

const publicReservationStatus = {
  code: 'EY-W-2608-0031',
  status: 'confirmed',
  startsAt: START,
  endsAt: END,
  storeName: 'EYEX 銀座店',
  purposeName: '新しいメガネを作る',
  durationMinutes: 60,
  contactName: '山口 真央',
  changeDeadlineAt: '2026-08-28T14:59:59.999Z',
}

describe('WebBookingSettingsInput', () => {
  it('accepts a 0-character and a 120-character message and rejects 121', () => {
    expect(WebBookingSettingsInput.parse({ ...webBookingSettingsInput, message: '' }).message).toBe(
      '',
    )
    expect(
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, message: 'あ'.repeat(120) })
        .message,
    ).toHaveLength(120)
    expect(() =>
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, message: 'あ'.repeat(121) }),
    ).toThrow()
    // 画面の「27文字／120文字まで」は符号位置で数える。UTF-16 の長さで見ない。
    const { message: _dropped, ...omitted } = webBookingSettingsInput
    expect(WebBookingSettingsInput.parse(omitted).message).toBe('')
  })

  it('accepts acceptUntilDays 1 and 180 and rejects 0 and 181', () => {
    expect(
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, acceptUntilDays: 1 })
        .acceptUntilDays,
    ).toBe(1)
    expect(
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, acceptUntilDays: 180 })
        .acceptUntilDays,
    ).toBe(180)
    expect(() =>
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, acceptUntilDays: 0 }),
    ).toThrow()
    expect(() =>
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, acceptUntilDays: 181 }),
    ).toThrow()
  })

  it('accepts acceptFromHours 0 and 168 and rejects -1 and 169', () => {
    expect(
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, acceptFromHours: 0 })
        .acceptFromHours,
    ).toBe(0)
    expect(
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, acceptFromHours: 168 })
        .acceptFromHours,
    ).toBe(168)
    expect(() =>
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, acceptFromHours: -1 }),
    ).toThrow()
    expect(() =>
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, acceptFromHours: 169 }),
    ).toThrow()
    // 画面に項目が無かった時代の既定は 2 時間先から（目的の最長 60 分＋片付け 10 分）。
    const { acceptFromHours: _dropped, ...omitted } = webBookingSettingsInput
    expect(WebBookingSettingsInput.parse(omitted).acceptFromHours).toBe(2)
  })

  it('accepts changeDeadlineDays 0 and 30 and rejects 31', () => {
    expect(
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, changeDeadlineDays: 0 })
        .changeDeadlineDays,
    ).toBe(0)
    expect(
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, changeDeadlineDays: 30 })
        .changeDeadlineDays,
    ).toBe(30)
    expect(() =>
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, changeDeadlineDays: 31 }),
    ).toThrow()
    expect(() =>
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, changeDeadlineDays: -1 }),
    ).toThrow()
    // WEB-CANCEL の「変更・取り消しは前日までに」は既定 1 日前。
    const { changeDeadlineDays: _dropped, ...omitted } = webBookingSettingsInput
    expect(WebBookingSettingsInput.parse(omitted).changeDeadlineDays).toBe(1)
  })

  it('rejects opensAt equal to or later than closesAt', () => {
    expect(() =>
      WebBookingSettingsInput.parse({
        ...webBookingSettingsInput,
        opensAt: '18:00',
        closesAt: '18:00',
      }),
    ).toThrow()
    expect(() =>
      WebBookingSettingsInput.parse({
        ...webBookingSettingsInput,
        opensAt: '18:30',
        closesAt: '18:00',
      }),
    ).toThrow()
    // 桁落ちの `9:00` を通すと文字列比較の大小が壊れる。
    expect(() =>
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, opensAt: '9:00' }),
    ).toThrow()
    expect(
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, opensAt: '09:00' }).opensAt,
    ).toBe('09:00')
  })

  it('requires version so a blind overwrite cannot be sent', () => {
    const { version: _dropped, ...omitted } = webBookingSettingsInput
    expect(() => WebBookingSettingsInput.parse(omitted)).toThrow()
    expect(WebBookingSettingsInput.parse(webBookingSettingsInput).version).toBe(3)
  })

  it('rejects an unknown key so a stale settings field never lands silently', () => {
    expect(() =>
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, autoConfirm: true }),
    ).toThrow()
    // ご案内のページは `stores.slug` から組み立てるので、保存で受け取らない。
    expect(() =>
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, landingPath: 'eyex.jp/ginza' }),
    ).toThrow()
    expect(() =>
      WebBookingSettingsInput.parse({ ...webBookingSettingsInput, storeId: UUID }),
    ).toThrow()
  })
})

describe('WebBookingSettings', () => {
  it('keeps requiresApproval true by default because there is no auto-confirm option', () => {
    const { requiresApproval: _dropped, ...omitted } = webBookingSettings
    expect(WebBookingSettings.parse(omitted).requiresApproval).toBe(true)
    expect(WebBookingSettings.parse(webBookingSettings).landingPath).toBe('eyex.jp/ginza')
    // 「自動で確定する」を選ばせる UI は作らないが、列としては `false` も持てる。
    expect(
      WebBookingSettings.parse({ ...webBookingSettings, requiresApproval: false }).requiresApproval,
    ).toBe(false)
    // 公開する目的が 0 件でも契約は通す（公開の可否は 422 で返す判断であって 400 ではない）。
    expect(
      WebBookingSettings.parse({ ...webBookingSettings, publishedPurposeIds: [] })
        .publishedPurposeIds,
    ).toEqual([])
  })
})

describe('WebBookingCode', () => {
  it('accepts EY-W-2608-0031 and EY-W-2608-10000 and rejects EY-2608-0031', () => {
    expect(WebBookingCode.parse('EY-W-2608-0031')).toBe('EY-W-2608-0031')
    // 9999 を越えた月は 5 桁へ桁上げする。
    expect(WebBookingCode.parse('EY-W-2608-10000')).toBe('EY-W-2608-10000')
    // 店内の採番（`reservations.code`）と混ぜない。
    expect(() => WebBookingCode.parse('EY-2608-0031')).toThrow()
    for (const code of ['ey-w-2608-0031', 'EY-W-2608-031', 'EY-W-268-0031', 'EY-W-2608-100000']) {
      expect(() => WebBookingCode.parse(code)).toThrow()
    }
  })
})

describe('PublicStorePurpose', () => {
  it('carries the public-facing name and the duration only — no internal name', () => {
    const parsed = PublicStorePurpose.parse({
      id: UUID,
      name: '新しいメガネを作る',
      durationMinutes: 60,
    })
    expect(Object.keys(parsed).sort()).toEqual(['durationMinutes', 'id', 'name'])
    expect(parsed.name).toBe('新しいメガネを作る')
    // 出るのは `visit_purposes.name_public` だけ。店内名・技能・設備は 1 つも出さない。
    expect(() =>
      PublicStorePurpose.parse({
        id: UUID,
        name: '新しいメガネを作る',
        nameInternal: '新規作成',
        durationMinutes: 60,
      }),
    ).toThrow()
    expect(() =>
      PublicStorePurpose.parse({
        id: UUID,
        name: '新しいメガネを作る',
        durationMinutes: 60,
        requiredSkills: ['refraction'],
      }),
    ).toThrow()
  })
})

describe('PublicAvailabilityQuery', () => {
  it('accepts a 7-day window and rejects an 8-day one', () => {
    // WEB-03-DATETIME の週は「8月27日 〜 9月2日」の 7 日ぶん（両端を含める）。
    const week = { purposeId: UUID, from: '2026-08-27', to: '2026-09-02' }
    expect(PublicAvailabilityQuery.parse(week).to).toBe('2026-09-02')
    expect(() => PublicAvailabilityQuery.parse({ ...week, to: '2026-09-03' })).toThrow()
    // 逆向きの範囲は黙って 0 件にせず入力を直させる。
    expect(() =>
      PublicAvailabilityQuery.parse({ ...week, from: '2026-09-02', to: '2026-08-27' }),
    ).toThrow()
    expect(() => PublicAvailabilityQuery.parse({ from: '2026-08-27', to: '2026-09-02' })).toThrow()
  })
})

describe('PublicAvailabilityResponse', () => {
  it('exposes only whether a slot is open — never the staff or equipment behind it', () => {
    const parsed = PublicAvailabilityResponse.parse({
      days: [
        { date: '2026-08-27', isClosed: false, isFull: false, slots: [] },
        {
          date: '2026-08-29',
          isClosed: false,
          isFull: false,
          slots: [
            { startsAt: START, isAvailable: true },
            { startsAt: END, isAvailable: false },
          ],
        },
        { date: '2026-09-01', isClosed: true, isFull: false, slots: [] },
      ],
    })
    expect(parsed.days).toHaveLength(3)
    expect(Object.keys(parsed.days[1]?.slots[0] ?? {}).sort()).toEqual(['isAvailable', 'startsAt'])
    // 社内の事情（誰が・どの台が空いているか）をお客様の画面へ出さない。
    for (const slot of [
      { startsAt: START, isAvailable: true, staffIds: [UUID] },
      { startsAt: START, isAvailable: true, equipmentIds: [UUID] },
      { startsAt: START, isAvailable: true, remaining: 2 },
    ]) {
      expect(() =>
        PublicAvailabilityResponse.parse({
          days: [{ date: '2026-08-29', isClosed: false, isFull: false, slots: [slot] }],
        }),
      ).toThrow()
    }
  })
})

describe('PublicBookingCreate', () => {
  it('requires contactEmail because an approval flow needs a way back to the customer', () => {
    const { contactEmail: _dropped, ...omitted } = publicBookingCreate
    expect(() => PublicBookingCreate.parse(omitted)).toThrow()
    expect(() => PublicBookingCreate.parse({ ...publicBookingCreate, contactEmail: '' })).toThrow()
    expect(() =>
      PublicBookingCreate.parse({ ...publicBookingCreate, contactEmail: 'm.yamaguchi' }),
    ).toThrow()
    expect(PublicBookingCreate.parse(publicBookingCreate).contactEmail).toBe(
      'm.yamaguchi@example.jp',
    )
    // ふりがなだけは空でもよい（お客様が自分で消せる）。
    expect(PublicBookingCreate.parse({ ...publicBookingCreate, contactKana: '' }).contactKana).toBe(
      '',
    )
  })

  it('accepts a 40-character name and rejects 41', () => {
    expect(
      PublicBookingCreate.parse({ ...publicBookingCreate, contactName: 'あ'.repeat(40) })
        .contactName,
    ).toHaveLength(40)
    expect(() =>
      PublicBookingCreate.parse({ ...publicBookingCreate, contactName: 'あ'.repeat(41) }),
    ).toThrow()
    expect(() => PublicBookingCreate.parse({ ...publicBookingCreate, contactName: '' })).toThrow()
    expect(() =>
      PublicBookingCreate.parse({ ...publicBookingCreate, contactKana: 'あ'.repeat(41) }),
    ).toThrow()
  })

  it('accepts a hyphenated phone number and rejects a 9-digit one', () => {
    expect(PublicBookingCreate.parse(publicBookingCreate).contactPhone).toBe('080-2345-6789')
    expect(
      PublicBookingCreate.parse({ ...publicBookingCreate, contactPhone: '08023456789' })
        .contactPhone,
    ).toBe('08023456789')
    // 桁が足りない番号ではご連絡できない。
    expect(() =>
      PublicBookingCreate.parse({ ...publicBookingCreate, contactPhone: '012345678' }),
    ).toThrow()
    expect(() => PublicBookingCreate.parse({ ...publicBookingCreate, contactPhone: '' })).toThrow()
  })
})

describe('PublicBookingResult', () => {
  it('returns the management code in plaintext exactly here and nowhere else', () => {
    const parsed = PublicBookingResult.parse(publicBookingResult)
    expect(parsed.managementCode).toBe('K7M4PXQ2')
    expect(parsed.code).toBe('EY-W-2608-0031')
    // 8 文字（誤読しない英数字）から。長い短命の鍵も同じ欄で返せるよう 32 文字まで。
    expect(
      PublicBookingResult.parse({ ...publicBookingResult, managementCode: 'A'.repeat(32) })
        .managementCode,
    ).toHaveLength(32)
    expect(() =>
      PublicBookingResult.parse({ ...publicBookingResult, managementCode: 'A'.repeat(7) }),
    ).toThrow()
    expect(() =>
      PublicBookingResult.parse({ ...publicBookingResult, managementCode: 'A'.repeat(33) }),
    ).toThrow()
    const { managementCode: _dropped, ...omitted } = publicBookingResult
    expect(() => PublicBookingResult.parse(omitted)).toThrow()
  })

  it('carries emailed so the done screen can stop claiming a mail that never left', () => {
    expect(PublicBookingResult.parse(publicBookingResult).emailed).toBe(true)
    expect(PublicBookingResult.parse({ ...publicBookingResult, emailed: false }).emailed).toBe(
      false,
    )
    // 既定で真にすると、メールが出なかった日に「お送りしました。」が出てしまう。
    const { emailed: _dropped, ...omitted } = publicBookingResult
    expect(() => PublicBookingResult.parse(omitted)).toThrow()
    // 承認待ちのまま完了画面へ進む経路があるので、`status` は 2 値を取る。
    expect(PublicBookingResult.parse({ ...publicBookingResult, status: 'confirmed' }).status).toBe(
      'confirmed',
    )
    expect(() =>
      PublicBookingResult.parse({ ...publicBookingResult, status: 'cancelled' }),
    ).toThrow()
  })
})

describe('PublicReservationVerification', () => {
  it('rejects a request that carries neither a phone number nor an email', () => {
    expect(() => PublicReservationVerification.parse({ code: 'EY-W-2608-0031' })).toThrow()
    expect(
      PublicReservationVerification.parse({
        code: 'EY-W-2608-0031',
        contactPhone: '080-2345-6789',
      }).contactPhone,
    ).toBe('080-2345-6789')
    expect(
      PublicReservationVerification.parse({
        code: 'EY-W-2608-0031',
        contactEmail: 'm.yamaguchi@example.jp',
      }).contactEmail,
    ).toBe('m.yamaguchi@example.jp')
    expect(() =>
      PublicReservationVerification.parse({ code: 'EY-2608-0142', contactPhone: '080-2345-6789' }),
    ).toThrow()
  })
})

describe('PublicReservationStatus', () => {
  it('never carries the management code', () => {
    const parsed = PublicReservationStatus.parse(publicReservationStatus)
    expect(parsed.changeDeadlineAt).toBe('2026-08-28T14:59:59.999Z')
    // 確認番号の平文は予約を作ったときの 1 回しか返らない。
    expect(Object.keys(parsed)).not.toContain('managementCode')
    expect(() =>
      PublicReservationStatus.parse({ ...publicReservationStatus, managementCode: 'K7M4PXQ2' }),
    ).toThrow()
    expect(() =>
      PublicReservationStatus.parse({ ...publicReservationStatus, contactPhone: '080-2345-6789' }),
    ).toThrow()
    expect(
      PublicReservationStatus.parse({ ...publicReservationStatus, status: 'cancelled' }).status,
    ).toBe('cancelled')
  })
})

describe('WebBookingReviewInput', () => {
  it('requires a reason when the decision is reject', () => {
    expect(WebBookingReviewInput.parse({ decision: 'approve' }).reason).toBe('')
    expect(() => WebBookingReviewInput.parse({ decision: 'reject' })).toThrow()
    expect(() => WebBookingReviewInput.parse({ decision: 'reject', reason: '' })).toThrow()
    expect(
      WebBookingReviewInput.parse({
        decision: 'reject',
        reason: '同じ時間に別のご予約が入りました',
      }).reason,
    ).toBe('同じ時間に別のご予約が入りました')
    expect(() =>
      WebBookingReviewInput.parse({ decision: 'reject', reason: 'あ'.repeat(121) }),
    ).toThrow()
    expect(() => WebBookingReviewInput.parse({ decision: 'cancel' })).toThrow()
  })
})

describe('Analytics contracts', () => {
  const analyticsQuery = {
    storeId: UUID,
    metric: 'reservation_count',
    from: '2026-01-01',
    to: '2027-02-04', // 両端を含めて 400 日
  }

  it('allows exactly 400 inclusive days and supplies report defaults', () => {
    const parsed = AnalyticsQuery.parse(analyticsQuery)
    expect(parsed.granularity).toBe('day')
    expect(parsed.countBy).toBe('visit_date')
    expect(() => AnalyticsQuery.parse({ ...analyticsQuery, to: '2027-02-05' })).toThrow()
    expect(() => AnalyticsQuery.parse({ ...analyticsQuery, metric: 'guests' })).toThrow()
    expect(() => AnalyticsQuery.parse({ ...analyticsQuery, unexpected: true })).toThrow()
  })

  it('keeps the nine physical metrics and eight dimensions fail-closed', () => {
    expect(AnalyticsDailyMetric.options).toEqual([
      'closed',
      'reservations',
      'scheduled_reservations',
      'reservations_received',
      'receptions',
      'cancellations',
      'wait_seconds_histogram',
      'revisit_eligible',
      'revisit_returning_90d',
    ])
    expect(AnalyticsDailyDimension.options).toEqual([
      'total',
      'staff',
      'purpose',
      'hour',
      'source',
      'cancellation_category',
      'wait_seconds',
      'visit_frequency',
    ])
    expect(() => AnalyticsDailyDimension.parse('cancel_reason')).toThrow()
  })

  it('allows only the dimension key vocabulary for persisted daily rows', () => {
    const base = {
      id: UUID,
      organizationId: ORG,
      storeId: UUID2,
      date: '2026-08-27',
      metric: 'cancellations',
      dimension: 'cancellation_category',
      dimensionKey: 'web',
      dimensionLabel: 'Webからの取消',
      value: 2,
      createdAt: NOW,
      updatedAt: NOW,
    }
    expect(AnalyticsDailyRow.parse(base).dimensionKey).toBe('web')
    expect(AnalyticsDailyRow.parse(base).dimensionLabel).toBe('Webからの取消')
    expect(() => AnalyticsDailyRow.parse({ ...base, dimensionLabel: '' })).toThrow()
    expect(() => AnalyticsDailyRow.parse({ ...base, dimensionKey: 'other' })).toThrow()
    expect(() => AnalyticsDailyRow.parse({ ...base, value: 1.5 })).toThrow()
    expect(() =>
      AnalyticsDailyRow.parse({
        ...base,
        metric: 'receptions',
        dimension: 'hour',
        dimensionKey: '10',
        dimensionLabel: '10時台',
      }),
    ).toThrow()
    expect(() =>
      AnalyticsDailyRow.parse({
        ...base,
        metric: 'revisit_eligible',
        dimension: 'total',
        dimensionKey: '',
        dimensionLabel: '合計',
      }),
    ).toThrow()
    expect(
      AnalyticsDailyRow.parse({
        ...base,
        metric: 'wait_seconds_histogram',
        dimension: 'wait_seconds',
        dimensionKey: 'hour:23:481',
      }).dimensionKey,
    ).toBe('hour:23:481')
    expect(() =>
      AnalyticsDailyRow.parse({
        ...base,
        metric: 'wait_seconds_histogram',
        dimension: 'wait_seconds',
        dimensionKey: 'hour:24:481',
      }),
    ).toThrow()
  })

  it('bounds an internal rollup to 31 inclusive days and three stores', () => {
    expect(
      AnalyticsRollupRequest.parse({
        from: '2026-08-01',
        to: '2026-08-31',
        limit: 3,
        storeCursor: 'opaque-store-cursor',
      }),
    ).toMatchObject({ limit: 3, storeCursor: 'opaque-store-cursor' })
    expect(() =>
      AnalyticsRollupRequest.parse({ from: '2026-08-01', to: '2026-09-01', limit: 3 }),
    ).toThrow()
    expect(() =>
      AnalyticsRollupRequest.parse({ from: '2026-08-01', to: '2026-08-31', limit: 4 }),
    ).toThrow()
  })

  it('keeps zero rates distinct from suppressed rates and has no guests response field', () => {
    expect(
      AnalyticsPoint.parse({
        key: '2026-08-27',
        label: '8/27',
        value: 0,
        secondaryValue: 0,
        isClosed: false,
        isOverTarget: false,
      }).secondaryValue,
    ).toBe(0)
    expect(
      AnalyticsPoint.parse({
        key: 'unassigned',
        label: '担当未定',
        value: 9,
        secondaryValue: null,
        isClosed: false,
        isOverTarget: false,
      }).secondaryValue,
    ).toBeNull()
    expect(() =>
      AnalyticsPoint.parse({
        key: 'x',
        label: 'x',
        value: 1,
        secondaryValue: 1.1,
        isClosed: false,
        isOverTarget: false,
      }),
    ).toThrow()
    expect(
      AnalyticsTargets.parse({
        waitMinutes: 8,
        cancellationRatePercent: 10,
        revisitWindowDays: 90,
      }),
    ).toEqual({ waitMinutes: 8, cancellationRatePercent: 10, revisitWindowDays: 90 })
    expect(() =>
      AnalyticsTargets.parse({
        waitMinutes: 9,
        cancellationRatePercent: 10,
        revisitWindowDays: 90,
      }),
    ).toThrow()
    expect(
      AnalyticsRollupResult.parse({
        processedStores: 1,
        failedStores: [],
        nextStoreCursor: null,
        from: '2026-08-01',
        to: '2026-08-01',
        upserted: 9,
        dropped: 0,
      }).dropped,
    ).toBe(0)
  })

  it('accepts 40文字の担当snapshotを分析pointとseriesで保持する', () => {
    const displayName = 'あ'.repeat(40)
    expect(
      AnalyticsPoint.parse({
        key: 'staff-1',
        label: displayName,
        value: 0,
        secondaryValue: null,
        isClosed: false,
        isOverTarget: false,
      }).label,
    ).toBe(displayName)
    expect(AnalyticsSeries.parse({ name: displayName, points: [], pattern: 'solid' }).name).toBe(
      displayName,
    )
  })

  it('keeps summaries to three display-ready values and defaults an omitted rate to null', () => {
    expect(
      AnalyticsPoint.parse({
        key: '2026-08-27',
        label: '8/27',
        value: 12,
        isClosed: false,
        isOverTarget: false,
      }).secondaryValue,
    ).toBeNull()

    const report = {
      metric: 'wait_time',
      from: '2026-08-01',
      to: '2026-08-31',
      granularity: 'hour',
      countBy: 'visit_date',
      series: [],
      summary: [
        { label: '中央値', value: '8分40秒', unit: '', isOverTarget: true },
        { label: '前の月', value: '7分20秒', unit: '', isOverTarget: false },
        { label: '受付', value: '328', unit: '件', isOverTarget: false },
      ],
      target: 480,
      suppressed: false,
      businessDays: 27,
      pendingDays: 0,
    }
    expect(AnalyticsReport.parse(report).summary).toHaveLength(3)
    expect(() =>
      AnalyticsReport.parse({
        ...report,
        summary: [...report.summary, report.summary[0]],
      }),
    ).toThrow()
    expect(() =>
      AnalyticsReport.parse({
        ...report,
        summary: [{ label: '中央値', value: 520, unit: '秒', isOverTarget: true }],
      }),
    ).toThrow()
  })
})

describe('P10 terminal and audit contracts', () => {
  const terminal = {
    id: UUID,
    storeId: UUID,
    name: '銀座店 レジ横iPad',
    kind: 'shared',
    placeNote: 'レジの右側',
    deviceLabel: 'EYEX-iPad-07',
    autoLockSeconds: 120,
    isActive: true,
    hasPin: true,
    lastSeenAt: '2026-08-27T02:08:00.000Z',
    isOnline: true,
    version: 1,
    createdAt: '2026-08-27T02:08:00.000Z',
  }

  it('Pin accepts 4..6 digits and rejects other lengths or non-digits', () => {
    expect(Pin.parse('2580')).toBe('2580')
    expect(Pin.parse('258025')).toBe('258025')
    for (const value of ['123', '1234567', '12a4']) expect(() => Pin.parse(value)).toThrow()
  })

  it('Terminal is strict, bounds its name and never carries pinHash', () => {
    expect(Terminal.parse(terminal)).toMatchObject({ hasPin: true, isOnline: true })
    expect(() => Terminal.parse({ ...terminal, name: '' })).toThrow()
    expect(() => Terminal.parse({ ...terminal, name: 'a'.repeat(61) })).toThrow()
    expect(() => Terminal.parse({ ...terminal, pinHash: 'secret' })).toThrow()
    expect(TerminalKind.options).toEqual(['shared', 'personal'])
  })

  it('Terminal query/input/patch defaults and optimistic locking are explicit', () => {
    expect(TerminalListQuery.parse({ storeId: UUID })).toEqual({
      storeId: UUID,
      includeInactive: false,
    })
    expect(TerminalInput.parse({ name: '受付', kind: 'shared' })).toMatchObject({
      autoLockSeconds: 120,
      isActive: true,
    })
    expect(() => TerminalInput.parse({ name: '受付', kind: 'shared', stale: true })).toThrow()
    expect(() => TerminalPatch.parse({ name: '受付' })).toThrow()
    expect(TerminalPatch.parse({ version: 1 })).toEqual({ version: 1 })
  })

  it('TerminalSessionStart is discriminated by mode', () => {
    expect(
      TerminalSessionStart.parse({ mode: 'personal', staffId: UUID, pin: '2580' }).staffId,
    ).toBe(UUID)
    expect(TerminalSessionStart.parse({ mode: 'shared', pin: '2580' }).mode).toBe('shared')
    expect(() => TerminalSessionStart.parse({ mode: 'personal', pin: '2580' })).toThrow()
    expect(() =>
      TerminalSessionStart.parse({ mode: 'shared', staffId: UUID, pin: '2580' }),
    ).toThrow()
  })

  it('TerminalSession and reauthentication expose no PIN material', () => {
    const session = TerminalSession.parse({
      id: UUID,
      terminalId: UUID,
      staffId: null,
      mode: 'shared',
      startedAt: '2026-08-27T02:08:00.000Z',
      expiresAt: '2026-08-27T02:10:00.000Z',
      sessionToken: 'a'.repeat(64),
    })
    expect(session.staffId).toBeNull()
    expect(session.sessionToken).toHaveLength(64)
    expect(() => TerminalSession.parse({ ...session, sessionToken: undefined })).toThrow()
    expect(() => TerminalSession.parse({ ...session, sessionToken: 'a'.repeat(63) })).toThrow()
    expect(() => TerminalSession.parse({ ...session, sessionToken: 'a'.repeat(129) })).toThrow()
    expect(() =>
      TerminalSession.parse({ ...session, sessionToken: `${'a'.repeat(63)}+` }),
    ).toThrow()
    expect(() => TerminalSession.parse({ ...session, credentialHash: 'secret' })).toThrow()
    expect(JSON.stringify(session)).not.toContain('2580')
    expect(ReauthInput.parse({ staffId: UUID, pin: '2580', reason: 'settings' }).reason).toBe(
      'settings',
    )
    expect(() => ReauthInput.parse({ staffId: UUID, pin: '2580', reason: 'anything' })).toThrow()
  })

  it('PIN errors keep retry information bounded', () => {
    expect(PinInvalidError.parse({ error: 'pin_invalid', remainingAttempts: 2 })).toBeTruthy()
    expect(() => PinInvalidError.parse({ error: 'pin_invalid', remainingAttempts: 3 })).toThrow()
    expect(
      PinLockedError.parse({ error: 'pin_locked', retryAfterSeconds: 30, remainingAttempts: 0 }),
    ).toBeTruthy()
  })

  it('audit actors and target types fail closed and use plural table names', () => {
    expect(AuditActorType.options).toEqual(['staff', 'terminal', 'system', 'customer'])
    expect(AuditTargetType.parse('reservations')).toBe('reservations')
    expect(() => AuditTargetType.parse('reservation')).toThrow()
  })

  it('AuditEvent and list/search contracts preserve nullable actors and cursor shape', () => {
    const event = {
      id: UUID,
      occurredAt: '2026-08-27T02:08:00.000Z',
      actorType: 'system',
      actorId: null,
      terminalId: null,
      action: 'organization.synced',
      targetType: 'organizations',
      targetId: UUID,
      correlationId: null,
      beforeJson: null,
      afterJson: { active: true },
    }
    expect(AuditEvent.parse(event).actorId).toBeNull()
    expect(AuditSearchQuery.parse({}).limit).toBe(50)
    expect(() => AuditSearchQuery.parse({ limit: 201 })).toThrow()
    expect(AuditEventList.parse({ items: [event], nextCursor: null, total: 1 }).total).toBe(1)
  })

  it('alert mutations are read-state-only and staff PIN updates never echo the PIN', () => {
    expect(AlertPatch.parse({ readAt: null })).toEqual({ readAt: null })
    expect(() => AlertPatch.parse({ resolved: true })).toThrow()
    expect(() => AlertPatch.parse({ readAt: null, resolved: true })).toThrow()
    expect(() => AlertPatch.parse({})).toThrow()
    expect(AlertReadAllResult.parse({ updated: 0 }).updated).toBe(0)
    expect(StaffPinInput.parse({ pin: '2580' }).pin).toBe('2580')
    expect(
      PinSetResult.parse({ staffId: UUID, updatedAt: '2026-08-27T02:08:00.000Z' }),
    ).not.toHaveProperty('pin')
  })
})
