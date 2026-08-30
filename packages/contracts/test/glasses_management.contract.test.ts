import {
  Actor,
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
  DeletedResult,
  Equipment,
  EquipmentInput,
  EquipmentKind,
  EquipmentListQuery,
  EquipmentMaintenance,
  EquipmentMaintenanceInput,
  EquipmentPatch,
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
  PurposeListQuery,
  PurposeOrderInput,
  PurposeRequirement,
  PurposeRequirementsInput,
  ReservationAssignment,
  ReservationCode,
  ReservationDetail,
  ReservationPurposeLine,
  ReservationSource,
  ReservationStatus,
  ReservationSummary,
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
  StaffShift,
  StaffShiftQuery,
  StaffShiftsInput,
  StaffSkillsInput,
  Store,
  StoreDetail,
  StoreMembership,
  StorePatch,
  StorePermission,
  Version,
  VisitPurpose,
  VisitPurposeInput,
  VisitPurposePatch,
  WebBookingCode,
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
