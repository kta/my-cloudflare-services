/**
 * スキーマの形（列と index）を固定する。index は「実際に投げるクエリの形」に
 * 合わせて張る決めなので、名前と対象列がずれたら気づけるようにしておく。
 * FK は宣言しない（アプリ層で整合を守る）ことも、ここで確かめる。
 */
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import {
  equipment,
  equipmentMaintenance,
  organizations,
  purposeRequirements,
  reservationAssignments,
  reservationPurposes,
  reservations,
  staff,
  staffShifts,
  staffSkills,
  staffWeeklyShifts,
  storeBlackoutWindows,
  storeBusinessHours,
  storeCalendarExceptions,
  storeMemberships,
  storeSettingsRevision,
  storeSlotRules,
  stores,
  visitPurposes,
} from '../src/worker/db/schema'

/** index の対象列を SQL 列名の配列で取り出す。 */
const columnsOf = (table: ReturnType<typeof getTableConfig>, name: string): string[] => {
  const idx = table.indexes.find((i) => i.config.name === name)
  if (!idx) throw new Error(`index ${name} が無い`)
  return idx.config.columns.map((c) => ('name' in c ? c.name : ''))
}

/** index が一意かどうか。 */
const isUnique = (table: ReturnType<typeof getTableConfig>, name: string): boolean =>
  table.indexes.find((i) => i.config.name === name)?.config.unique === true

describe('organizations', () => {
  const table = getTableConfig(organizations)

  it('組織 id を主キーにし、外部キーを持たない', () => {
    expect(table.name).toBe('organizations')
    expect(table.columns.filter((c) => c.primary).map((c) => c.name)).toEqual(['id'])
    expect(table.foreignKeys).toHaveLength(0)
  })

  it('毎リクエストで読む列（plan / is_disabled / revision）を持つ', () => {
    const names = table.columns.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining(['name', 'plan', 'is_disabled', 'created_at', 'revision']),
    )
  })
})

describe('stores', () => {
  const table = getTableConfig(stores)

  it('組織で絞って作成順に並べる index を持つ', () => {
    const idx = table.indexes.find((i) => i.config.name === 'stores_org_created_idx')
    expect(idx?.config.columns.map((c) => ('name' in c ? c.name : ''))).toEqual([
      'organization_id',
      'created_at',
    ])
    expect(idx?.config.unique).toBe(false)
  })

  it('slug は全組織横断で一意（公開ページが組織を知らずに引く）', () => {
    // /api/public/** は未認証で organization_id を持たないので slug 単独で引く。
    // 組織内一意（P0 の stores_org_slug_unique_idx）だと 2 行返って店舗を決められない。
    expect(isUnique(table, 'stores_slug_idx')).toBe(true)
    expect(columnsOf(table, 'stores_slug_idx')).toEqual(['slug'])
    expect(table.indexes.map((i) => i.config.name)).not.toContain('stores_org_slug_unique_idx')
  })

  it('お客様に見せる名前・道順・紹介文・並び順・更新者の 7 列を持ち、すべて NULL 可', () => {
    // 既存行に入れる値が無いので、後から足す列は必ず NULL 可にする（SQLite の
    // ALTER TABLE ADD COLUMN は DEFAULT なしの NOT NULL を足せない）。
    const added = [
      'name_public',
      'nearest_station',
      'parking_note',
      'intro_text',
      'sort_order',
      'updated_at',
      'updated_by',
    ]
    for (const name of added) {
      const column = table.columns.find((c) => c.name === name)
      expect(column, `${name} が無い`).toBeDefined()
      expect(column?.notNull, `${name} は NULL 可でなければならない`).toBe(false)
    }
    expect(table.columns.find((c) => c.name === 'sort_order')?.columnType).toBe('SQLiteInteger')
  })

  it('P0 が出した 3 列の NOT NULL と既定値を変えない（表の作り直しを起こさない）', () => {
    for (const name of ['phone', 'address', 'access_note']) {
      const column = table.columns.find((c) => c.name === name)
      expect(column?.notNull, name).toBe(true)
      expect(column?.default, name).toBe('')
    }
  })

  it('外部キーを宣言しない', () => {
    expect(table.foreignKeys).toHaveLength(0)
  })
})

describe('store_memberships', () => {
  const table = getTableConfig(storeMemberships)

  it('「この利用者はこの店舗で何ができるか」を 1 行で引ける', () => {
    const idx = table.indexes.find(
      (i) => i.config.name === 'store_memberships_org_user_store_unique_idx',
    )
    expect(idx?.config.unique).toBe(true)
    expect(idx?.config.columns.map((c) => ('name' in c ? c.name : ''))).toEqual([
      'organization_id',
      'user_id',
      'store_id',
    ])
  })

  it('店舗から引く index も持つ', () => {
    expect(table.indexes.map((i) => i.config.name)).toContain('store_memberships_org_store_idx')
  })

  it('外部キーを宣言しない', () => {
    expect(table.foreignKeys).toHaveLength(0)
  })
})

describe('store_business_hours', () => {
  const table = getTableConfig(storeBusinessHours)

  it('組織・店舗・曜日で 1 行に決まる', () => {
    // 空き枠エンジンが 1 日分を 1 行で引く。重複行は DB 側で禁じる。
    expect(isUnique(table, 'store_business_hours_org_store_weekday_idx')).toBe(true)
    expect(columnsOf(table, 'store_business_hours_org_store_weekday_idx')).toEqual([
      'organization_id',
      'store_id',
      'weekday',
    ])
  })

  it('受付を止める帯を持たない列（break_start / break_end）は NULL 可のまま残す', () => {
    // 帯の正本は store_blackout_windows。この 2 列には書き込まない。
    for (const name of ['break_start', 'break_end']) {
      expect(table.columns.find((c) => c.name === name)?.notNull, name).toBe(false)
    }
  })
})

describe('store_blackout_windows', () => {
  const table = getTableConfig(storeBlackoutWindows)

  it('1 日分の帯を開始時刻順にまとめて引ける', () => {
    expect(columnsOf(table, 'store_blackout_windows_org_store_weekday_idx')).toEqual([
      'organization_id',
      'store_id',
      'weekday',
      'starts_at',
    ])
    // 同じ曜日に帯を何本でも足せる（銀座店は 3 本）ので一意にしない。
    expect(isUnique(table, 'store_blackout_windows_org_store_weekday_idx')).toBe(false)
  })
})

describe('store_calendar_exceptions', () => {
  const table = getTableConfig(storeCalendarExceptions)

  it('同じ店舗の同じ日に 2 行を作れない', () => {
    expect(isUnique(table, 'store_calendar_exceptions_org_store_date_idx')).toBe(true)
    expect(columnsOf(table, 'store_calendar_exceptions_org_store_date_idx')).toEqual([
      'organization_id',
      'store_id',
      'date',
    ])
  })
})

describe('store_slot_rules', () => {
  const table = getTableConfig(storeSlotRules)

  it('1 店舗 1 行（2 行目を DB 側で禁じる）', () => {
    expect(isUnique(table, 'store_slot_rules_org_store_idx')).toBe(true)
    expect(columnsOf(table, 'store_slot_rules_org_store_idx')).toEqual([
      'organization_id',
      'store_id',
    ])
  })

  it('刻み・片付け・同時受付上限を整数で持つ', () => {
    const names = table.columns.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining(['slot_minutes', 'cleanup_minutes', 'max_parallel', 'version']),
    )
  })
})

describe('store_settings_revision', () => {
  const table = getTableConfig(storeSettingsRevision)

  it('1 店舗 1 行で、version を持つ', () => {
    // 設定 6 面の楽観ロックはこの 1 本にまとめる。
    expect(isUnique(table, 'store_settings_revision_org_store_idx')).toBe(true)
    expect(columnsOf(table, 'store_settings_revision_org_store_idx')).toEqual([
      'organization_id',
      'store_id',
    ])
    const version = table.columns.find((c) => c.name === 'version')
    expect(version?.notNull).toBe(true)
    expect(version?.columnType).toBe('SQLiteInteger')
  })
})

describe('staff', () => {
  const table = getTableConfig(staff)

  it('台帳の行順（組織・店舗・並び順）で引ける', () => {
    expect(columnsOf(table, 'staff_org_store_sort_idx')).toEqual([
      'organization_id',
      'store_id',
      'sort_order',
    ])
  })

  it('個人ログインのために adminUserId から引ける', () => {
    expect(columnsOf(table, 'staff_org_admin_user_idx')).toEqual([
      'organization_id',
      'admin_user_id',
    ])
  })

  it('PIN は担当ごとに持ち、未設定を NULL で表す', () => {
    expect(table.columns.find((c) => c.name === 'pin_hash')?.notNull).toBe(false)
    expect(table.columns.find((c) => c.name === 'pin_updated_at')?.notNull).toBe(false)
  })
})

describe('staff_skills', () => {
  const table = getTableConfig(staffSkills)

  it('同じ技能を 2 回付けられない', () => {
    expect(isUnique(table, 'staff_skills_org_staff_skill_idx')).toBe(true)
    expect(columnsOf(table, 'staff_skills_org_staff_skill_idx')).toEqual([
      'organization_id',
      'staff_id',
      'skill_code',
    ])
  })

  it('「この技能を持つ担当は誰か」を店舗で絞って引ける', () => {
    // store_id は staff.store_id の非正規化コピー。空き枠エンジンが 1 クエリで店舗を絞る。
    expect(columnsOf(table, 'staff_skills_org_store_skill_idx')).toEqual([
      'organization_id',
      'store_id',
      'skill_code',
    ])
  })
})

describe('staff_weekly_shifts', () => {
  const table = getTableConfig(staffWeeklyShifts)

  it('同じ適用開始日に同じ曜日の 2 行を作れない', () => {
    expect(isUnique(table, 'staff_weekly_shifts_org_staff_weekday_idx')).toBe(true)
    expect(columnsOf(table, 'staff_weekly_shifts_org_staff_weekday_idx')).toEqual([
      'organization_id',
      'staff_id',
      'effective_from',
      'weekday',
    ])
  })
})

describe('staff_shifts', () => {
  const table = getTableConfig(staffShifts)

  it('台帳の 1 日分と、担当ひとりの 1 日分の両方を引ける', () => {
    expect(columnsOf(table, 'staff_shifts_org_store_date_idx')).toEqual([
      'organization_id',
      'store_id',
      'date',
    ])
    expect(columnsOf(table, 'staff_shifts_org_staff_date_idx')).toEqual([
      'organization_id',
      'staff_id',
      'date',
    ])
  })
})

describe('equipment', () => {
  const table = getTableConfig(equipment)

  it('台帳の行順と、種別での絞り込みの 2 つを引ける', () => {
    expect(columnsOf(table, 'equipment_org_store_sort_idx')).toEqual([
      'organization_id',
      'store_id',
      'sort_order',
    ])
    expect(columnsOf(table, 'equipment_org_store_kind_idx')).toEqual([
      'organization_id',
      'store_id',
      'kind',
    ])
  })

  it('役割の表示と台帳の見せ方を列で持つ', () => {
    // role_label は kind から導けない（視力測定機 A と 検査室 1 はどちらも measure）。
    expect(table.columns.find((c) => c.name === 'role_label')?.notNull).toBe(false)
    expect(table.columns.find((c) => c.name === 'ledger_display')?.notNull).toBe(true)
  })
})

describe('equipment_maintenance', () => {
  const table = getTableConfig(equipmentMaintenance)

  it('店舗の 1 日分と、設備ごとの次の点検を引ける', () => {
    expect(columnsOf(table, 'equipment_maintenance_org_store_start_idx')).toEqual([
      'organization_id',
      'store_id',
      'starts_at',
    ])
    expect(columnsOf(table, 'equipment_maintenance_org_equipment_start_idx')).toEqual([
      'organization_id',
      'equipment_id',
      'starts_at',
    ])
  })
})

describe('visit_purposes', () => {
  const table = getTableConfig(visitPurposes)

  it('一覧の並び順と、Web 公開だけの絞り込みを引ける', () => {
    expect(columnsOf(table, 'visit_purposes_org_store_sort_idx')).toEqual([
      'organization_id',
      'store_id',
      'sort_order',
    ])
    expect(columnsOf(table, 'visit_purposes_org_web_idx')).toEqual([
      'organization_id',
      'store_id',
      'is_web_published',
    ])
  })

  it('店舗ID は NULL 可（NULL はチェーン共通の目的）', () => {
    expect(table.columns.find((c) => c.name === 'store_id')?.notNull).toBe(false)
  })

  it('台帳の帯に出す短い名前を列で持つ', () => {
    // name_internal（最大 30 文字）を台帳の 68px の帯へ流すと読めなくなる。
    expect(table.columns.find((c) => c.name === 'name_short')?.notNull).toBe(true)
  })
})

describe('purpose_requirements', () => {
  const table = getTableConfig(purposeRequirements)

  it('同じ要求を 2 回書けない', () => {
    expect(isUnique(table, 'purpose_requirements_org_purpose_idx')).toBe(true)
    expect(columnsOf(table, 'purpose_requirements_org_purpose_idx')).toEqual([
      'organization_id',
      'purpose_id',
      'kind',
      'value',
    ])
  })
})

describe('reservations', () => {
  const table = getTableConfig(reservations)

  it('組織・店舗・開始時刻で 1 日分を引く index を持つ', () => {
    // P1 は読み取り専用の器として作る（書き込み経路は P3）。設定の影響試算が読む。
    expect(columnsOf(table, 'reservations_org_store_start_idx')).toEqual([
      'organization_id',
      'store_id',
      'starts_at',
    ])
    expect(isUnique(table, 'reservations_org_code_idx')).toBe(true)
  })
})

describe('外部キー', () => {
  it('16 表のどれも外部キーを宣言していない（整合はアプリ層で守る）', () => {
    const added = [
      storeBusinessHours,
      storeBlackoutWindows,
      storeCalendarExceptions,
      storeSlotRules,
      storeSettingsRevision,
      staff,
      staffSkills,
      staffWeeklyShifts,
      staffShifts,
      equipment,
      equipmentMaintenance,
      visitPurposes,
      purposeRequirements,
      reservations,
      reservationPurposes,
      reservationAssignments,
    ]
    expect(added).toHaveLength(16)
    for (const t of added) {
      const table = getTableConfig(t)
      expect(table.foreignKeys, `${table.name} が外部キーを宣言している`).toHaveLength(0)
      // 全ドメイン行が organization_id を持つ（テナントスコープの前提）。
      expect(
        table.columns.map((c) => c.name),
        table.name,
      ).toContain('organization_id')
    }
  })
})
