/**
 * スキーマの形（列と index）を固定する。index は「実際に投げるクエリの形」に
 * 合わせて張る決めなので、名前と対象列がずれたら気づけるようにしておく。
 * FK は宣言しない（アプリ層で整合を守る）ことも、ここで確かめる。
 */
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import {
  alerts,
  analyticsDaily,
  auditEvents,
  customerGlasses,
  customerNotes,
  customerPrescriptions,
  customers,
  equipment,
  equipmentMaintenance,
  idempotencyRecords,
  organizations,
  purposeRequirements,
  receptionSessions,
  recordings,
  reservationAssignments,
  reservationPurposes,
  reservationSlotLocks,
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
  visitEvents,
  visitPurposes,
  walkIns,
  webBookingSettings,
  webBookings,
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
    // 台帳 1 日分（LEDGER-STAFF / RESOURCE / LIST）と、空き枠エンジンの重なり判定。
    expect(columnsOf(table, 'reservations_org_store_start_idx')).toEqual([
      'organization_id',
      'store_id',
      'starts_at',
    ])
    expect(isUnique(table, 'reservations_org_store_start_idx')).toBe(false)
  })

  it('受付日での分析範囲走査用 index を持つ', () => {
    expect(columnsOf(table, 'reservations_org_store_created_idx')).toEqual([
      'organization_id',
      'store_id',
      'created_at',
    ])
  })

  it('組織の中で予約番号が一意である', () => {
    // 採番は組織 × YYMM の連番。店舗をまたぐ検索で番号が衝突しないよう組織で一意にする。
    expect(isUnique(table, 'reservations_org_code_idx')).toBe(true)
    expect(columnsOf(table, 'reservations_org_code_idx')).toEqual(['organization_id', 'code'])
  })

  it('絞り込み用に組織・店舗・状態・開始時刻の index を持つ', () => {
    // LEDGER-LIST の「すべて／これから／確認待ち」と、お知らせの確認待ち件数。
    expect(columnsOf(table, 'reservations_org_store_status_start_idx')).toEqual([
      'organization_id',
      'store_id',
      'status',
      'starts_at',
    ])
  })

  it('顧客の次のご予約を引く index を持つ', () => {
    // 顧客詳細の「次のご予約」と来店回数の再計算（customers は P4 で足す）。
    expect(columnsOf(table, 'reservations_org_customer_start_idx')).toEqual([
      'organization_id',
      'customer_id',
      'starts_at',
    ])
  })

  it('version / cancelled_at / cancel_reason を持つ', () => {
    // 変更・取消（P6）はこの 3 列だけで足りる。表も列も足さない。
    // 版はバッチの最後の UPDATE が +1 する軸なので NOT NULL の整数で持つ
    // （NULL 可にすると版の EXISTS ガードが NULL 比較で必ず外れ、409 のはずの
    //  要求が「1 行も当たらないまま成功」に化ける）。
    expect(table.columns.find((c) => c.name === 'version')?.columnType).toBe('SQLiteInteger')
    expect(table.columns.find((c) => c.name === 'version')?.notNull).toBe(true)
    // 取り消していないご予約は 2 列とも NULL。取消の理由は 4 語の text で、
    // 真偽値（is_cancelled）に潰さない — ANALYTICS-CANCEL の内訳が作れなくなる。
    for (const name of ['cancelled_at', 'cancel_reason']) {
      expect(
        table.columns.find((c) => c.name === name),
        name,
      ).toBeDefined()
      expect(table.columns.find((c) => c.name === name)?.notNull, name).toBe(false)
    }
    expect(table.columns.find((c) => c.name === 'cancel_reason')?.columnType).toBe('SQLiteText')
    expect(table.columns.filter((c) => c.name.startsWith('is_'))).toHaveLength(0)
  })
})

describe('reservation_purposes', () => {
  const table = getTableConfig(reservationPurposes)

  it('予約 id と並び順で引ける', () => {
    // 台帳の帯の purposeLabel は、この並び順どおりに name_short を「・」で連ねる。
    expect(columnsOf(table, 'reservation_purposes_org_reservation_idx')).toEqual([
      'organization_id',
      'reservation_id',
      'sort_order',
    ])
    expect(isUnique(table, 'reservation_purposes_org_reservation_idx')).toBe(false)
  })
})

describe('reservation_assignments', () => {
  const table = getTableConfig(reservationAssignments)

  it('種別・対象・開始時刻で「その担当はその時間に空いているか」を引ける', () => {
    expect(columnsOf(table, 'reservation_assignments_org_target_start_idx')).toEqual([
      'organization_id',
      'kind',
      'target_id',
      'starts_at',
    ])
  })

  it('予約 id で 1 件分をまとめて引ける', () => {
    // 予約詳細と変更差分。店舗の絞り込みは reservations との JOIN で行うので store_id を置かない。
    expect(columnsOf(table, 'reservation_assignments_org_reservation_idx')).toEqual([
      'organization_id',
      'reservation_id',
    ])
    expect(table.columns.map((c) => c.name)).not.toContain('store_id')
  })

  it('担当が未定の押さえを表すため target_id は NULL 可', () => {
    expect(table.columns.find((c) => c.name === 'target_id')?.notNull).toBe(false)
  })
})

describe('reservation_slot_locks', () => {
  const table = getTableConfig(reservationSlotLocks)

  it('組織・店舗・種別・対象キー・枠の開始の複合 index を持つ', () => {
    // 上限判定の COUNT(*) を 1 枠 1 回で引く。
    expect(columnsOf(table, 'reservation_slot_locks_org_store_target_slot_idx')).toEqual([
      'organization_id',
      'store_id',
      'kind',
      'target_key',
      'slot_start',
    ])
  })

  it('その index は一意でない（上限つきの条件付き INSERT が上限を数えるため）', () => {
    // 一意にすると設定で編集できる 3 つの上限（equipment.capacity /
    // staff.max_parallel_reservations / store_slot_rules.max_parallel）がすべて 1 に潰れ、
    // 担当を決めずに受け付けるウォークインが同じ枠に 2 人目を作れなくなる。
    expect(isUnique(table, 'reservation_slot_locks_org_store_target_slot_idx')).toBe(false)
    expect(table.indexes.filter((i) => i.config.unique)).toHaveLength(0)
  })

  it('予約 id で一括 DELETE できる index を持つ', () => {
    // 取消・変更のときの一括 DELETE と、枠のガードの COUNT(*)。
    expect(columnsOf(table, 'reservation_slot_locks_org_reservation_idx')).toEqual([
      'organization_id',
      'reservation_id',
    ])
  })

  it('対象キーは NOT NULL（担当が未定のレーンは unassigned の固定値で表す）', () => {
    // NULL 同士は = で結べないので、NULL を使うと上限判定の COUNT(*) が
    // 担当未定のレーンだけを数えられなくなる。
    expect(table.columns.find((c) => c.name === 'target_key')?.notNull).toBe(true)
  })

  it('刻みに展開した枠の開始と、バッチの時刻を見分ける作成日時を持つ', () => {
    const names = table.columns.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'organization_id',
        'store_id',
        'reservation_id',
        'kind',
        'target_key',
        'slot_start',
        'created_at',
      ]),
    )
  })
})

describe('audit_events', () => {
  const table = getTableConfig(auditEvents)

  it('組織と発生時刻で時系列に引ける index を持つ', () => {
    expect(columnsOf(table, 'audit_events_org_occurred_idx')).toEqual([
      'organization_id',
      'occurred_at',
    ])
    // 追記専用の表なので一意にしない（同じ時刻に何行でも積まれる）。
    expect(isUnique(table, 'audit_events_org_occurred_idx')).toBe(false)
  })

  it('1 予約の履歴を対象種別と対象 id で引ける index を持つ', () => {
    // HISTORY-LIST の「そのあとの変更」タイムラインが 1 予約分をこの順で引く。
    expect(columnsOf(table, 'audit_events_org_target_idx')).toEqual([
      'organization_id',
      'target_type',
      'target_id',
      'occurred_at',
    ])
  })

  it('store_id だけが NULL 可（組織同期の行のため）', () => {
    // admin からの組織同期（target_type='organization'）だけが店舗に紐づかない。
    // それ以外の骨格の列は NOT NULL にして、誰が何にいつ何をしたかを必ず残す。
    expect(table.columns.find((c) => c.name === 'store_id')?.notNull).toBe(false)
    for (const name of [
      'organization_id',
      'actor_type',
      'action',
      'target_type',
      'target_id',
      'occurred_at',
    ]) {
      expect(table.columns.find((c) => c.name === name)?.notNull, name).toBe(true)
    }
  })
})

describe('idempotency_records', () => {
  const table = getTableConfig(idempotencyRecords)

  it('冪等キーそのものが主キーで、追加の一意 index を張らない', () => {
    // INSERT の衝突がそのまま排他になる。同じことを二重に張らない。
    expect(table.columns.filter((c) => c.primary).map((c) => c.name)).toEqual(['key'])
    expect(table.indexes.filter((i) => i.config.unique)).toHaveLength(0)
  })

  it('期限切れを掃除する Cron のための expires_at の index を持つ', () => {
    // この表だけは物理削除する（created_at + 24h を過ぎた行）。
    expect(columnsOf(table, 'idempotency_records_expires_idx')).toEqual(['expires_at'])
  })
})

describe('reception_sessions', () => {
  const table = getTableConfig(receptionSessions)

  it('店舗と開始日時で日別に引ける index を持つ', () => {
    expect(columnsOf(table, 'reception_sessions_org_store_started_idx')).toEqual([
      'organization_id',
      'store_id',
      'started_at',
    ])
  })

  it('予約 id から受付をたどれる index を持つ', () => {
    // 予約詳細から受付と録音へたどる。
    expect(columnsOf(table, 'reception_sessions_org_reservation_idx')).toEqual([
      'organization_id',
      'reservation_id',
    ])
  })

  it('下書き・終了・結果は NULL 可（進行中の行が成り立つ）', () => {
    // 受付を始めた瞬間の行は「まだ終わっていない」ので 3 列とも NULL になる。
    for (const name of ['draft_json', 'ended_at', 'outcome']) {
      expect(table.columns.find((c) => c.name === name)?.notNull, name).toBe(false)
    }
  })
})

describe('予約の 4 表', () => {
  it('4 表とも外部キーを宣言しない', () => {
    const tables = [reservations, reservationPurposes, reservationAssignments, reservationSlotLocks]
    expect(tables).toHaveLength(4)
    for (const t of tables) {
      const table = getTableConfig(t)
      expect(table.foreignKeys, `${table.name} が外部キーを宣言している`).toHaveLength(0)
      expect(
        table.columns.map((c) => c.name),
        table.name,
      ).toContain('organization_id')
    }
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

/* ───────────────────────────────────────────────────────────────────────────
 * P4 顧客台帳（0004_*.sql）
 * ─────────────────────────────────────────────────────────────────────────── */

describe('customers', () => {
  const table = getTableConfig(customers)

  it('組織と正規化した番号で引ける（工程の前方一致）', () => {
    // BOOK-04b は伺いながら打つので phone_normalized の前方一致で候補を出す。
    expect(columnsOf(table, 'customers_org_phone_idx')).toEqual([
      'organization_id',
      'phone_normalized',
    ])
    // 同じ番号を持つご家族が並ぶので一意にしない。
    expect(isUnique(table, 'customers_org_phone_idx')).toBe(false)
  })

  it('組織と下 4 桁で引ける（台帳と受付の完全一致）', () => {
    // 後方一致（LIKE '%' || ?）は B-tree が効かず顧客表の全走査になるので、
    // 末尾 4 桁を写した列を持って完全一致で引く。
    expect(columnsOf(table, 'customers_org_phone_last4_idx')).toEqual([
      'organization_id',
      'phone_last4',
    ])
    // お電話番号は任意なので 3 列とも NULL 可（3 つとも NULL か 3 つとも非 NULL）。
    for (const name of ['phone', 'phone_normalized', 'phone_last4']) {
      expect(table.columns.find((c) => c.name === name)?.notNull, name).toBe(false)
    }
  })

  it('組織とふりがなで五十音順に並べられる', () => {
    // CUSTOMER-LIST の既定の並び。カーソルは (kana, id) の複合で OFFSET を使わない。
    expect(columnsOf(table, 'customers_org_kana_idx')).toEqual(['organization_id', 'kana'])
    expect(isUnique(table, 'customers_org_kana_idx')).toBe(false)
  })

  it('お客様番号は組織の中で一意', () => {
    // G-NNNNN の採番衝突をここで検出する。統合で失った番号は再利用しない。
    expect(isUnique(table, 'customers_org_customer_number_idx')).toBe(true)
    expect(columnsOf(table, 'customers_org_customer_number_idx')).toEqual([
      'organization_id',
      'customer_number',
    ])
    // reservations.code / recordings.code と紛れないよう code とは呼ばない。
    expect(table.columns.map((c) => c.name)).not.toContain('code')
  })

  it('組織と最終来店で並べ替えられる', () => {
    expect(columnsOf(table, 'customers_org_last_visit_idx')).toEqual([
      'organization_id',
      'last_visit_at',
    ])
    // 来店回数は status='done' の件数から書き戻す値。読むたびに COUNT(*) しない。
    expect(table.columns.find((c) => c.name === 'visit_count')?.columnType).toBe('SQLiteInteger')
    expect(table.columns.find((c) => c.name === 'version')?.columnType).toBe('SQLiteInteger')
    // まとめられた行は削除せず、この列で検索・一覧から外す。
    expect(table.columns.find((c) => c.name === 'merged_into_id')?.notNull).toBe(false)
    // 登録端末は terminals（P10）が来るまで常に NULL。列だけ先に置く。
    expect(table.columns.find((c) => c.name === 'created_terminal_id')?.notNull).toBe(false)
  })
})

describe('customer_prescriptions', () => {
  const table = getTableConfig(customerPrescriptions)

  it('顧客ごとに測定日で引ける（詳細の履歴表）', () => {
    expect(columnsOf(table, 'customer_prescriptions_org_customer_measured_idx')).toEqual([
      'organization_id',
      'customer_id',
      'measured_at',
    ])
    // 度数と PD を text で持たない（表示のときに小数 2 桁・PD は 1 桁へ整形する）。
    for (const name of ['r_sph', 'r_cyl', 'r_add', 'l_sph', 'l_cyl', 'l_add', 'pd']) {
      expect(table.columns.find((c) => c.name === name)?.columnType, name).toBe('SQLiteReal')
    }
    for (const name of ['r_axis', 'l_axis']) {
      expect(table.columns.find((c) => c.name === name)?.columnType, name).toBe('SQLiteInteger')
    }
  })
})

describe('customer_glasses', () => {
  const table = getTableConfig(customerGlasses)

  it('顧客ごとにお渡し日で引ける', () => {
    expect(columnsOf(table, 'customer_glasses_org_customer_purchased_idx')).toEqual([
      'organization_id',
      'customer_id',
      'purchased_at',
    ])
    // いまお使いのメガネは何本でもよい（モックの田中 花子 様は 2 本）ので一意にしない。
    expect(isUnique(table, 'customer_glasses_org_customer_purchased_idx')).toBe(false)
  })
})

describe('customer_notes', () => {
  const table = getTableConfig(customerNotes)

  it('顧客ごとに作成順で引ける（手書きのサムネイル）', () => {
    expect(columnsOf(table, 'customer_notes_org_customer_created_idx')).toEqual([
      'organization_id',
      'customer_id',
      'created_at',
    ])
    // SVG の本体は R2（binding RECORDINGS、前置 notes/）に置き、D1 はキーだけを持つ。
    expect(table.columns.find((c) => c.name === 'handwriting_key')?.notNull).toBe(false)
    expect(table.columns.map((c) => c.name)).not.toContain('handwriting_svg')
    // 読み取った文字を人が直すたびに +1 する。
    expect(table.columns.find((c) => c.name === 'revision')?.columnType).toBe('SQLiteInteger')
  })

  it('種別と状態で「注意ごと N件」を数えられる', () => {
    // 数えるのは kind='attention' かつ status='published' の行だけ（draft は数えない）。
    expect(columnsOf(table, 'customer_notes_org_customer_kind_idx')).toEqual([
      'organization_id',
      'customer_id',
      'kind',
      'status',
    ])
    expect(isUnique(table, 'customer_notes_org_customer_kind_idx')).toBe(false)
  })
})

describe('顧客の 4 表', () => {
  it('外部キーを 1 つも宣言しない', () => {
    const tables = [customers, customerPrescriptions, customerGlasses, customerNotes]
    expect(tables).toHaveLength(4)
    for (const t of tables) {
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

/* ───────────────────────────────────────────────────────────────────────────
 * P5 来店受付とウォークイン（0005_*.sql）
 * ─────────────────────────────────────────────────────────────────────────── */

describe('walk_ins', () => {
  const table = getTableConfig(walkIns)

  it('整理番号を組織・店舗・来店日で一意にする', () => {
    // 採番は MAX(ticket_no) + 1 を読んでから INSERT するので、同時受付で同じ番号を
    // 読んだ 2 台をここで弾く。弾かれた側は +1 して採番し直す。
    expect(columnsOf(table, 'walk_ins_org_store_date_ticket_idx')).toEqual([
      'organization_id',
      'store_id',
      'visit_date',
      'ticket_no',
    ])
    expect(isUnique(table, 'walk_ins_org_store_date_ticket_idx')).toBe(true)
    // 店舗 × 日でリセットするので、来店日を含まない一意にはしない。
    expect(columnsOf(table, 'walk_ins_org_store_date_ticket_idx')).toContain('visit_date')
  })

  it('台帳の最下段を受付時刻順に引く index を持つ', () => {
    expect(columnsOf(table, 'walk_ins_org_store_arrived_idx')).toEqual([
      'organization_id',
      'store_id',
      'arrived_at',
    ])
    expect(isUnique(table, 'walk_ins_org_store_arrived_idx')).toBe(false)
  })

  it('「いまお待ち N名」を来店日で絞って数える index を持つ', () => {
    // 来店日を先に置かないと昨日の waiting まで数えてしまう。
    expect(columnsOf(table, 'walk_ins_org_store_date_status_idx')).toEqual([
      'organization_id',
      'store_id',
      'visit_date',
      'status',
    ])
    expect(isUnique(table, 'walk_ins_org_store_date_status_idx')).toBe(false)
  })

  it('外部キーを持たず、version を整数で持つ', () => {
    expect(table.name).toBe('walk_ins')
    expect(table.foreignKeys).toHaveLength(0)
    expect(table.columns.filter((c) => c.primary).map((c) => c.name)).toEqual(['id'])
    // 顧客の紐づけと担当決めを 2 台の iPad が同時に触るので楽観ロックを持つ。
    expect(table.columns.find((c) => c.name === 'version')?.columnType).toBe('SQLiteInteger')
    expect(table.columns.find((c) => c.name === 'version')?.notNull).toBe(true)
    expect(table.columns.find((c) => c.name === 'ticket_no')?.columnType).toBe('SQLiteInteger')
    // 受付と同時に source='walkin' の予約を 1 件起こすので、予約 ID は必ず埋まる。
    expect(table.columns.find((c) => c.name === 'reservation_id')?.notNull).toBe(true)
    // お客様を特定しないまま受け付けられる。
    expect(table.columns.find((c) => c.name === 'customer_id')?.notNull).toBe(false)
    // ご用件は 4 択（purpose_id）か自由記述（purpose_note）のどちらか一方。
    expect(table.columns.find((c) => c.name === 'purpose_id')?.notNull).toBe(false)
    expect(table.columns.find((c) => c.name === 'purpose_note')?.notNull).toBe(false)
    // status='left' のときだけ埋まる。
    expect(table.columns.find((c) => c.name === 'left_at')?.notNull).toBe(false)
  })

  it('真偽値の列を持たない（状態は 4 語の text）', () => {
    // waiting / serving / booked / left の 4 語を is_waiting のような真偽の組で
    // 表すと、どれでもない行とどれでもある行が作れてしまう。
    expect(table.columns.filter((c) => c.name.startsWith('is_'))).toHaveLength(0)
    expect(table.columns.find((c) => c.name === 'status')?.columnType).toBe('SQLiteText')
    expect(table.columns.find((c) => c.name === 'status')?.notNull).toBe(true)
    // 来店日は JST の暦日（'YYYY-MM-DD'）。arrived_at から導いた写しを列に持つ。
    expect(table.columns.find((c) => c.name === 'visit_date')?.columnType).toBe('SQLiteText')
    expect(table.columns.find((c) => c.name === 'visit_date')?.notNull).toBe(true)
  })
})

describe('visit_events', () => {
  const table = getTableConfig(visitEvents)

  it('そのお客様の工程を発生順に引く index を持つ', () => {
    // ボードの 1 行はこの並びそのもの。現在地は occurred_at 最大の行。
    expect(columnsOf(table, 'visit_events_org_subject_idx')).toEqual([
      'organization_id',
      'subject_type',
      'subject_id',
      'occurred_at',
    ])
    // 同じ工程を 2 回記録できる（打ち消しの行を足して訂正する）ので一意にしない。
    expect(isUnique(table, 'visit_events_org_subject_idx')).toBe(false)
  })

  it('当日のボード全体を引く index を持つ', () => {
    expect(columnsOf(table, 'visit_events_org_store_occurred_idx')).toEqual([
      'organization_id',
      'store_id',
      'occurred_at',
    ])
    expect(isUnique(table, 'visit_events_org_store_occurred_idx')).toBe(false)
  })

  it('追記専用なので updated_at を持たない', () => {
    expect(table.name).toBe('visit_events')
    expect(table.foreignKeys).toHaveLength(0)
    // 行を書き換えないので更新時刻の置き場所を作らない。訂正は打ち消しの行を足す。
    expect(table.columns.map((c) => c.name)).not.toContain('updated_at')
    // 対象は予約かウォークインのどちらか（reservation_id / walkin_id に割らない）。
    expect(table.columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(['subject_type', 'subject_id', 'stage', 'occurred_at']),
    )
    expect(table.columns.map((c) => c.name)).not.toContain('reservation_id')
    // 誰が進めたかは残すが、担当以外も進められるので NULL 可。
    expect(table.columns.find((c) => c.name === 'staff_id')?.notNull).toBe(false)
    expect(table.columns.find((c) => c.name === 'note')?.notNull).toBe(false)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * P7 受付の録音（0006_*.sql）
 * ─────────────────────────────────────────────────────────────────────────── */

describe('recordings', () => {
  const table = getTableConfig(recordings)

  it('録音番号は組織の中で一意（採番の衝突を DB が弾く）', () => {
    // 採番は直前の番号を読んでから INSERT するので、同じ番号を読んだ 2 台目をここで
    // 弾く。弾かれた側は採番し直す（walk_ins.ticket_no と同じ作法。最大 5 回）。
    expect(columnsOf(table, 'recordings_org_code_idx')).toEqual(['organization_id', 'code'])
    expect(isUnique(table, 'recordings_org_code_idx')).toBe(true)
    // 店舗ではなく組織で通しの番号なので、店舗を混ぜない。
    expect(columnsOf(table, 'recordings_org_code_idx')).not.toContain('store_id')
  })

  it('保持期限切れを掃除する index を持つ', () => {
    // 掃除は state='stored' かつ retain_until < now の行だけを引く。
    expect(columnsOf(table, 'recordings_org_state_retain_idx')).toEqual([
      'organization_id',
      'state',
      'retain_until',
    ])
    expect(isUnique(table, 'recordings_org_state_retain_idx')).toBe(false)
  })

  it('受付セッションから 1 本を引ける', () => {
    // HISTORY-LIST の「受付のときの録音」。1 受付 1 録音だが、一意にはしない
    // （録り直しの行を残せなくなる。1 本しか立てない保証はルート側が持つ）。
    expect(columnsOf(table, 'recordings_org_session_idx')).toEqual([
      'organization_id',
      'reception_session_id',
    ])
    expect(isUnique(table, 'recordings_org_session_idx')).toBe(false)
  })

  it('予約から「録音を聞く」を引ける', () => {
    // LEDGER-DETAIL / CHANGE-SEARCH の「● 録音を聞く　03:12」。
    expect(columnsOf(table, 'recordings_org_reservation_idx')).toEqual([
      'organization_id',
      'reservation_id',
    ])
    expect(isUnique(table, 'recordings_org_reservation_idx')).toBe(false)
  })

  it('外部キーを宣言しない', () => {
    expect(table.name).toBe('recordings')
    expect(table.foreignKeys).toHaveLength(0)
    expect(table.columns.filter((c) => c.primary).map((c) => c.name)).toEqual(['id'])
    const names = table.columns.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'organization_id',
        'store_id',
        'code',
        'reception_session_id',
        'reservation_id',
        'r2_key',
        'content_type',
        'duration_seconds',
        'bytes',
        'state',
        'retain_until',
        'legal_hold',
        'upload_attempts',
        'created_at',
        'updated_at',
        'deleted_at',
      ]),
    )
    // 破棄受付の録音は予約を持たない（最低保持期限が 24 時間になる側）。
    expect(table.columns.find((c) => c.name === 'reservation_id')?.notNull).toBe(false)
    // 実体の在り処。**応答には載せない**（契約の Recording が持たない）。
    expect(table.columns.find((c) => c.name === 'r2_key')?.notNull).toBe(true)
    // state='stored' になるまで決まらない。
    expect(table.columns.find((c) => c.name === 'retain_until')?.notNull).toBe(false)
    expect(table.columns.find((c) => c.name === 'deleted_at')?.notNull).toBe(false)
    // 長さとバイト数は完了まで NULL。真偽値は text の '0' | '1'。
    expect(table.columns.find((c) => c.name === 'duration_seconds')?.columnType).toBe(
      'SQLiteInteger',
    )
    expect(table.columns.find((c) => c.name === 'duration_seconds')?.notNull).toBe(false)
    expect(table.columns.find((c) => c.name === 'bytes')?.notNull).toBe(false)
    expect(table.columns.find((c) => c.name === 'upload_attempts')?.columnType).toBe(
      'SQLiteInteger',
    )
    expect(table.columns.find((c) => c.name === 'upload_attempts')?.notNull).toBe(true)
    expect(table.columns.find((c) => c.name === 'legal_hold')?.columnType).toBe('SQLiteText')
    expect(table.columns.find((c) => c.name === 'legal_hold')?.notNull).toBe(true)
  })
})

describe('alerts', () => {
  const table = getTableConfig(alerts)

  it('新しい順の一覧を引く index を持つ', () => {
    expect(columnsOf(table, 'alerts_org_store_occurred_idx')).toEqual([
      'organization_id',
      'store_id',
      'occurred_at',
    ])
    expect(isUnique(table, 'alerts_org_store_occurred_idx')).toBe(false)
  })

  it('未対応の件数を数える index を持つ', () => {
    // サイドバーの「お知らせ 3」は resolved_at IS NULL を数える。
    expect(columnsOf(table, 'alerts_org_store_resolved_idx')).toEqual([
      'organization_id',
      'store_id',
      'resolved_at',
    ])
    expect(isUnique(table, 'alerts_org_store_resolved_idx')).toBe(false)
    expect(table.name).toBe('alerts')
    expect(table.foreignKeys).toHaveLength(0)
    // 同じ code + target_id の未解決行があれば新しい行を作らない（連打しない）。
    expect(table.columns.find((c) => c.name === 'target_id')?.notNull).toBe(false)
    expect(table.columns.find((c) => c.name === 'resolved_at')?.notNull).toBe(false)
  })
})

describe('web_booking_settings', () => {
  const table = getTableConfig(webBookingSettings)

  it('店舗ごとに 1 行しか持てない', () => {
    // 公開 API が店舗ごとに 1 行だけ引く。2 行目は DB 側で禁じる。
    expect(columnsOf(table, 'web_booking_settings_org_store_idx')).toEqual([
      'organization_id',
      'store_id',
    ])
    expect(isUnique(table, 'web_booking_settings_org_store_idx')).toBe(true)
    // 張るのはこの 1 本だけ（ほかの引き方をしない）。
    expect(table.indexes).toHaveLength(1)
  })

  it('外部キーを宣言していない', () => {
    expect(table.name).toBe('web_booking_settings')
    expect(table.foreignKeys).toHaveLength(0)
    expect(table.columns.filter((c) => c.primary).map((c) => c.name)).toEqual(['id'])
    const names = table.columns.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'organization_id',
        'store_id',
        'is_published',
        'opens_at',
        'closes_at',
        'accept_from_hours',
        'accept_until_days',
        'change_deadline_days',
        'requires_approval',
        'message',
        'version',
        'updated_at',
        'created_at',
      ]),
    )
    // 「ご案内のページ eyex.jp/ginza」はこの表に持たない（stores.slug から組み立てる）。
    expect(names).not.toContain('landing_path')
    // 真偽値は text の '0' | '1'。受け付ける時間は 'HH:MM' の text。
    for (const name of ['is_published', 'requires_approval', 'opens_at', 'closes_at']) {
      expect(table.columns.find((c) => c.name === name)?.columnType).toBe('SQLiteText')
      expect(table.columns.find((c) => c.name === name)?.notNull).toBe(true)
    }
    // 受付の窓と締切は整数。
    for (const name of [
      'accept_from_hours',
      'accept_until_days',
      'change_deadline_days',
      'version',
    ]) {
      expect(table.columns.find((c) => c.name === name)?.columnType).toBe('SQLiteInteger')
      expect(table.columns.find((c) => c.name === name)?.notNull).toBe(true)
    }
    // お知らせ文だけ NULL 可（お知らせを出さない店舗がある）。
    expect(table.columns.find((c) => c.name === 'message')?.notNull).toBe(false)
    // DDL の DEFAULT に意味を持たせない（既定値はアプリ層とドメイン層が入れる）。
    expect(table.columns.filter((c) => c.hasDefault)).toHaveLength(0)
  })
})

describe('web_bookings', () => {
  const table = getTableConfig(webBookings)

  it('予約 1 件に Web 予約 1 件しか結び付かない', () => {
    // 台帳から付帯情報を引く。二重に作らせない。
    expect(columnsOf(table, 'web_bookings_org_reservation_idx')).toEqual([
      'organization_id',
      'reservation_id',
    ])
    expect(isUnique(table, 'web_bookings_org_reservation_idx')).toBe(true)
  })

  it('ご予約番号は組織の中で一意', () => {
    // WEB-CANCEL の番号引きと、採番が衝突したことの検出を兼ねる。
    expect(columnsOf(table, 'web_bookings_org_public_code_idx')).toEqual([
      'organization_id',
      'public_code',
    ])
    expect(isUnique(table, 'web_bookings_org_public_code_idx')).toBe(true)
    // `reservations.code`（EY-YYMM-NNNN）とは別の採番系統なので、店舗を混ぜない。
    expect(columnsOf(table, 'web_bookings_org_public_code_idx')).not.toContain('store_id')
  })

  it('店舗と状態で「確認待ち」を数える index を持つ', () => {
    // LEDGER-LIST の「確認待ち 1件」・ALERTS の「Web予約が2件、確認待ちです」。
    expect(columnsOf(table, 'web_bookings_org_store_status_idx')).toEqual([
      'organization_id',
      'store_id',
      'status',
    ])
    expect(isUnique(table, 'web_bookings_org_store_status_idx')).toBe(false)
    expect(columnsOf(table, 'web_bookings_status_created_idx')).toEqual(['status', 'created_at'])
    expect(table.indexes).toHaveLength(4)
  })

  it('確認鍵と確認番号はハッシュの列しか持たない', () => {
    expect(table.name).toBe('web_bookings')
    expect(table.foreignKeys).toHaveLength(0)
    expect(table.columns.filter((c) => c.primary).map((c) => c.name)).toEqual(['id'])
    const names = table.columns.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining([
        'organization_id',
        'store_id',
        'reservation_id',
        'public_code',
        'confirmation_key_hash',
        'management_code_hash',
        'contact_name',
        'contact_kana',
        'contact_phone',
        'contact_email',
        'status',
        'created_at',
        'confirmed_at',
        'cancelled_at',
        'updated_at',
      ]),
    )
    // 生の確認鍵・確認番号を保存しない。一度漏れると全予約が開く。
    for (const name of ['confirmation_key', 'management_code']) {
      expect(names).not.toContain(name)
    }
    for (const name of ['confirmation_key_hash', 'management_code_hash']) {
      expect(table.columns.find((c) => c.name === name)?.notNull).toBe(true)
    }
    // メールアドレスは必須（承認制なので、連絡手段の無いお客様の予約は宙に浮く）。
    expect(table.columns.find((c) => c.name === 'contact_email')?.notNull).toBe(true)
    // ふりがなだけは無くてよい。
    expect(table.columns.find((c) => c.name === 'contact_kana')?.notNull).toBe(false)
    // 確定・取消はまだ起きていないので NULL 可。作成と更新は必ず値がある。
    expect(table.columns.find((c) => c.name === 'confirmed_at')?.notNull).toBe(false)
    expect(table.columns.find((c) => c.name === 'cancelled_at')?.notNull).toBe(false)
    expect(table.columns.find((c) => c.name === 'updated_at')?.notNull).toBe(true)
    expect(table.columns.filter((c) => c.hasDefault)).toHaveLength(0)
  })
})

describe('analytics_daily', () => {
  const table = getTableConfig(analyticsDaily)

  it('has only the non-null aggregate columns and no foreign key', () => {
    expect(table.name).toBe('analytics_daily')
    expect(table.foreignKeys).toHaveLength(0)
    expect(table.columns.map((column) => column.name)).toEqual([
      'id',
      'organization_id',
      'store_id',
      'date',
      'metric',
      'dimension',
      'dimension_key',
      'dimension_label',
      'value',
      'created_at',
      'updated_at',
    ])
    for (const column of table.columns) expect(column.notNull, column.name).toBe(true)
    expect(
      table.columns.find((column) => column.name === 'dimension_label')?.default,
    ).toBeUndefined()
    expect(table.columns.find((column) => column.name === 'value')?.columnType).toBe(
      'SQLiteInteger',
    )
    expect(table.checks.map((constraint) => constraint.name)).toContain(
      'analytics_daily_value_nonnegative_check',
    )
  })

  it('makes a same-day histogram bucket idempotent and reads periods by metric', () => {
    expect(isUnique(table, 'analytics_daily_org_store_date_metric_dim_idx')).toBe(true)
    expect(columnsOf(table, 'analytics_daily_org_store_date_metric_dim_idx')).toEqual([
      'organization_id',
      'store_id',
      'date',
      'metric',
      'dimension',
      'dimension_key',
    ])
    expect(columnsOf(table, 'analytics_daily_org_store_metric_date_idx')).toEqual([
      'organization_id',
      'store_id',
      'metric',
      'date',
    ])
  })
})
