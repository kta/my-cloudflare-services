import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/*
 * D1 は SQLite。このリポジトリの決め:
 * - 外部キーを宣言しない。整合性はアプリ層で守る。
 * - id はアプリ生成（`crypto.randomUUID()`）。DB 側の自動採番を使わない。
 * - ドメインの全行が `organization_id` を持ち、全クエリで JWT の `org` により絞る。
 * - 真偽値は text の '0' / '1'。日時は ISO8601 文字列。日付は 'YYYY-MM-DD'、時刻は 'HH:MM'。
 * - DDL の DEFAULT に意味を持たせない（時刻・状態・フラグはアプリ層で入れる）。
 * - 時間順の並びは created_at で取る（UUID v4 は並び替えに使えない）。
 *
 * テーブルはフェーズごとに増える（specs/glasses_management/design/03-data-model.md）。
 * P0（基盤）の 3 つに、P1（店舗の受付条件）の 16 と P2（枠の一次排他）の 1、
 * P3（電話・店頭からの予約受付）の 3 と P4（顧客台帳）の 4、
 * P5（来店受付とウォークイン）の 2 と P7（受付の録音）の 2、
 * P8（お客様向け Web 予約）の 2 と P9（分析）の 1 を足した 34 表がここにある。
 */

/**
 * 組織の写し。正本は admin ドメインにあり、service binding で押し込まれる。
 * D1 はデータベースをまたいで JOIN できないので、ここに写しを持ってアプリ層で突き合わせる。
 * plan / is_disabled はテナントの毎リクエストで読む（admin 側の変更が即座に効く）。
 * revision は admin 側で単調増加し、古い配信を無視するために使う。
 */
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  plan: text('plan'), // 'free' | 'contracted'（null は 'free' 扱い）
  isDisabled: text('is_disabled'), // '0' | '1'（null は '0' 扱い）
  createdAt: text('created_at').notNull(),
  revision: text('revision'), // 整数の文字列。null は 0 扱い
})

/**
 * 店舗。予約・台帳・受付条件・Web 予約公開のすべてがこの単位に属する。
 * slug はお客様向け Web 予約の URL（/w/:storeSlug）に出るので、組織の中で一意。
 */
export const stores = sqliteTable(
  'stores',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    phone: text('phone').notNull().default(''),
    address: text('address').notNull().default(''),
    accessNote: text('access_note').notNull().default(''),
    isActive: text('is_active').notNull(), // '0' | '1'
    createdAt: text('created_at').notNull(),
    // ここから下は P1（0001_*.sql）で ALTER TABLE ADD COLUMN する列。
    // 既存行に入れる値が無いので、すべて NULL 可にする（SQLite は DEFAULT なしの
    // NOT NULL 列を後から足せない。DDL の DEFAULT に意味を持たせない決めも守る）。
    namePublic: text('name_public'), // NULL なら name を使う
    nearestStation: text('nearest_station'),
    parkingNote: text('parking_note'),
    introText: text('intro_text'), // 0〜200文字
    sortOrder: integer('sort_order'), // NULL の行は created_at 順で後ろへ置く
    updatedAt: text('updated_at'), // NULL は created_at として読む
    updatedBy: text('updated_by'), // staff.id
  },
  (t) => [
    // 一覧は組織で絞って並べる
    index('stores_org_created_idx').on(t.organizationId, t.createdAt),
    // /api/public/** は未認証で organization_id を持たないので slug 単独で引く。
    // よって slug は全組織横断で一意にする。P0 は (organization_id, slug) で張って
    // いたので、0001_*.sql が DROP INDEX してからこれを張り直す。
    // 代償として slug は組織をまたいで先取り順になる（取れない保存は 400 で返す）。
    uniqueIndex('stores_slug_idx').on(t.slug),
  ],
)

/**
 * 担当店舗の写し。admin が利用者・標準ロール・担当店舗の源泉で、結果の membership
 * だけがここへ届く。担当解除は行を消さず permissions を空文字にして配るので、
 * 削除専用の経路を持たずに収束する。permissions は空白区切りの許可リスト。
 */
export const storeMemberships = sqliteTable(
  'store_memberships',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    userId: text('user_id').notNull(),
    permissions: text('permissions').notNull().default(''),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 「この利用者はこの店舗で何ができるか」を 1 行で引く
    uniqueIndex('store_memberships_org_user_store_unique_idx').on(
      t.organizationId,
      t.userId,
      t.storeId,
    ),
    index('store_memberships_org_store_idx').on(t.organizationId, t.storeId),
  ],
)

/* ───────────────────────────────────────────────────────────────────────────
 * P1 店舗の受付条件（0001_*.sql）
 * 「いつ・誰が・どの設備で・どのご用件を受けられるか」を 6 面で決める表。
 * この 6 面が P2 以降の空き枠エンジンと予約台帳の入力になる。
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * 曜日ごとの通常営業時間。空き枠エンジンの第 1 入力。
 * 1 店舗 7 行そろっているのが正常で、行が欠けた曜日は定休と同じに扱う。
 */
export const storeBusinessHours = sqliteTable(
  'store_business_hours',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    weekday: integer('weekday').notNull(), // 0=日 / 1=月 / … / 6=土
    isClosed: text('is_closed').notNull(), // '0' | '1'
    opensAt: text('opens_at'), // 'HH:MM'。is_closed='1' のとき NULL
    closesAt: text('closes_at'), // 'HH:MM'。同上
    // 受付を止める帯の正本は store_blackout_windows。この 2 列には書き込まない
    // （帯は 1 日に 3 本あるので、1 帯しか持てないこの形では表せない）。
    breakStart: text('break_start'),
    breakEnd: text('break_end'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 空き枠エンジンが 1 日分を 1 行で引く。重複行を DB 側で禁じる。
    uniqueIndex('store_business_hours_org_store_weekday_idx').on(
      t.organizationId,
      t.storeId,
      t.weekday,
    ),
  ],
)

/**
 * 受付を止める時間帯。曜日ごとに 0 本以上あり、空き枠エンジンは営業時間から
 * この帯を差し引く。銀座店は 朝の支度 / お昼 / 閉店前の片付け の 3 本を持つ。
 */
export const storeBlackoutWindows = sqliteTable(
  'store_blackout_windows',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    weekday: integer('weekday').notNull(), // 0=日 … 6=土
    startsAt: text('starts_at').notNull(), // 'HH:MM'
    endsAt: text('ends_at').notNull(), // 'HH:MM'
    label: text('label').notNull(), // 1〜20文字
    sortOrder: integer('sort_order').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 空き枠エンジンが 1 日分の帯をまとめて引く。同じ曜日に何本でも足せるので一意にしない。
    index('store_blackout_windows_org_store_weekday_idx').on(
      t.organizationId,
      t.storeId,
      t.weekday,
      t.startsAt,
    ),
  ],
)

/**
 * 臨時休業と特別営業。store_business_hours より優先し、行があれば曜日を一切見ない。
 */
export const storeCalendarExceptions = sqliteTable(
  'store_calendar_exceptions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    date: text('date').notNull(), // 'YYYY-MM-DD'（JST の暦日）
    kind: text('kind').notNull(), // 'closed' | 'special'
    opensAt: text('opens_at'), // kind='special' のときだけ非 NULL
    closesAt: text('closes_at'), // 同上
    note: text('note'), // 0〜60文字
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by'), // staff.id
  },
  (t) => [
    // 空き枠エンジンの 1 日引き。同じ日に 2 行を作らせない（上書きは UPDATE）。
    uniqueIndex('store_calendar_exceptions_org_store_date_idx').on(
      t.organizationId,
      t.storeId,
      t.date,
    ),
  ],
)

/**
 * 予約の刻み・片付け時間・同時受付上限。1 店舗 1 行。
 * 行が無い店舗は「設定未完」として空き枠を 0 件にする（暗黙の既定値を作らない）。
 */
export const storeSlotRules = sqliteTable(
  'store_slot_rules',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    slotMinutes: integer('slot_minutes').notNull(), // 5〜120
    cleanupMinutes: integer('cleanup_minutes').notNull(), // 0〜60。予約の後ろに付く
    maxParallel: integer('max_parallel').notNull(), // 1〜20
    version: integer('version').notNull(), // 行を直接 PATCH するときの楽観ロック
    updatedAt: text('updated_at').notNull(),
    updatedBy: text('updated_by'), // staff.id
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 空き枠エンジンが毎回 1 行引く。2 行目を DB 側で禁じる。
    uniqueIndex('store_slot_rules_org_store_idx').on(t.organizationId, t.storeId),
  ],
)

/**
 * 設定 7 画面の楽観ロックを 1 本にまとめる版。1 店舗 1 行。
 * どの面を保存しても version を +1 する。保存は対象表の書き込みと同じ db.batch() に入れ、
 * 版の条件を全文へ配って、版を +1 する文を最後に置く（その meta.changes === 0 が 409）。
 */
export const storeSettingsRevision = sqliteTable(
  'store_settings_revision',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    version: integer('version').notNull(), // 1 以上
    updatedAt: text('updated_at').notNull(),
    updatedBy: text('updated_by'), // staff.id
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 設定面の保存が毎回 1 行引く。2 行目を DB 側で禁じる。
    uniqueIndex('store_settings_revision_org_store_idx').on(t.organizationId, t.storeId),
  ],
)

/**
 * 接客するスタッフ。並び順がそのまま予約台帳（担当軸）の行順になる。
 * 兼務は店舗ごとに 1 行を作り、admin_user_id の一致で同一人物と分かるようにする。
 */
export const staff = sqliteTable(
  'staff',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    adminUserId: text('admin_user_id'), // 個人ログインを許すスタッフだけ埋まる
    displayName: text('display_name').notNull(), // 1〜30文字
    kana: text('kana'), // 並べ替え用
    jobLabel: text('job_label'), // 0〜20文字。'店長'
    role: text('role').notNull(), // 'manager' | 'staff'
    maxParallelReservations: integer('max_parallel_reservations').notNull(), // 1〜5
    pinHash: text('pin_hash'), // NULL は「PIN 未設定」＝個人ログイン不可。平文は保存しない
    pinUpdatedAt: text('pin_updated_at'),
    isActive: text('is_active').notNull(), // '0' | '1'
    sortOrder: integer('sort_order').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    // 台帳の行・LOGIN-STAFF のタイル順・設定の一覧。
    index('staff_org_store_sort_idx').on(t.organizationId, t.storeId, t.sortOrder),
    // 個人ログイン時に JWT の sub から staff 行を解決する。
    index('staff_org_admin_user_idx').on(t.organizationId, t.adminUserId),
  ],
)

/**
 * スタッフが持つ技能。purpose_requirements（kind='skill'）と突き合わせて担当候補を絞る。
 * 語彙は 6 値（measure / processing / sales_reception / fitting / contact_lens / repair）。
 */
export const staffSkills = sqliteTable(
  'staff_skills',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    // staff.store_id の非正規化コピー。空き枠エンジンが 1 クエリで店舗を絞れるようにする。
    storeId: text('store_id').notNull(),
    staffId: text('staff_id').notNull(),
    skillCode: text('skill_code').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 同じ技能を 2 回付けさせない。
    uniqueIndex('staff_skills_org_staff_skill_idx').on(t.organizationId, t.staffId, t.skillCode),
    // 空き枠エンジンの「この技能を持つ担当は誰か」。
    index('staff_skills_org_store_skill_idx').on(t.organizationId, t.storeId, t.skillCode),
  ],
)

/**
 * 勤務の曜日テンプレート。staff_shifts の正本で、SETTINGS-STAFF の 7 列グリッドの保存先。
 * 1 スタッフ・1 effective_from につき 7 行ちょうど（保存は 7 行の置き換え）。
 */
export const staffWeeklyShifts = sqliteTable(
  'staff_weekly_shifts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    staffId: text('staff_id').notNull(),
    weekday: integer('weekday').notNull(), // 0=日 … 6=土
    isOff: text('is_off').notNull(), // '0' | '1'
    startsAt: text('starts_at'), // 'HH:MM'。is_off='0' のとき非 NULL
    endsAt: text('ends_at'), // 同上
    breakStart: text('break_start'), // 担当ひとりの休憩（台帳の灰帯）。両方 NULL か両方非 NULL
    breakEnd: text('break_end'),
    effectiveFrom: text('effective_from').notNull(), // 'YYYY-MM-DD'
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 保存時の置き換えと展開。同じ適用開始日に同じ曜日の 2 行を作らせない。
    uniqueIndex('staff_weekly_shifts_org_staff_weekday_idx').on(
      t.organizationId,
      t.staffId,
      t.effectiveFrom,
      t.weekday,
    ),
  ],
)

/**
 * 日ごとの勤務帯と休憩帯。編集の対象ではなく staff_weekly_shifts の展開結果で、
 * 保存の直後と日次 Cron が 62 日先まで作り直す。
 */
export const staffShifts = sqliteTable(
  'staff_shifts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    staffId: text('staff_id').notNull(),
    date: text('date').notNull(), // 'YYYY-MM-DD'（JST の暦日）
    startsAt: text('starts_at').notNull(), // 'HH:MM'
    endsAt: text('ends_at').notNull(), // 'HH:MM'
    kind: text('kind').notNull(), // 'work' | 'break'
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 台帳 1 日分の行をまとめて引く。
    index('staff_shifts_org_store_date_idx').on(t.organizationId, t.storeId, t.date),
    // 空き枠エンジンの「この担当はその時間帯に勤務しているか」。
    index('staff_shifts_org_staff_date_idx').on(t.organizationId, t.staffId, t.date),
  ],
)

/**
 * 視力測定機・相談カウンター・加工室など、1 予約が同時に押さえられる設備・場所。
 * 1 台 1 行にする（台帳の行と 1 対 1）。設定画面の「相談カウンター 1・2」の 1 行は表示側のまとめ。
 */
export const equipment = sqliteTable(
  'equipment',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    name: text('name').notNull(), // 1〜30文字
    kind: text('kind').notNull(), // 'measure' | 'counter' | 'workbench'
    // 台帳の行名の下に出る小さい文字。kind からは導けない
    // （視力測定機 A と 検査室 1 はどちらも measure だが表示が違う）。
    roleLabel: text('role_label'),
    capacity: integer('capacity').notNull(), // 1〜10
    isActive: text('is_active').notNull(), // '0' | '1'
    inactiveReason: text('inactive_reason'), // is_active='0' のときだけ非 NULL
    ledgerDisplay: text('ledger_display').notNull(), // 'grey' | 'hide'。効くのは止めている設備だけ
    sortOrder: integer('sort_order').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    // 台帳（設備軸）の行・設定の一覧。
    index('equipment_org_store_sort_idx').on(t.organizationId, t.storeId, t.sortOrder),
    // 空き枠エンジンの「この種別の設備は何が空いているか」。
    index('equipment_org_store_kind_idx').on(t.organizationId, t.storeId, t.kind),
  ],
)

/**
 * 設備の点検予定。空き枠エンジンが「その時間帯は使えない」と読む。
 * 重なる行があってよく、和集合で塞ぐ。既存予約は自動で動かさない。
 */
export const equipmentMaintenance = sqliteTable(
  'equipment_maintenance',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    equipmentId: text('equipment_id').notNull(),
    startsAt: text('starts_at').notNull(), // ISO8601 (UTC)
    endsAt: text('ends_at').notNull(),
    note: text('note'), // 0〜60文字
    createdAt: text('created_at').notNull(),
    createdBy: text('created_by'), // staff.id
  },
  (t) => [
    // 台帳 1 日分に「点検」の帯を重ねる。
    index('equipment_maintenance_org_store_start_idx').on(t.organizationId, t.storeId, t.startsAt),
    // 空き枠エンジンの設備別判定と、設定の「次の点検」。
    index('equipment_maintenance_org_equipment_start_idx').on(
      t.organizationId,
      t.equipmentId,
      t.startsAt,
    ),
  ],
)

/**
 * ご来店の目的マスタ。所要時間と、必要な技能・設備（purpose_requirements）を持つ。
 * 名前を 3 列持つのは幅の制約による（台帳の帯は 68px しかなく name_internal が切れる）。
 */
export const visitPurposes = sqliteTable(
  'visit_purposes',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id'), // NULL はチェーン共通。非 NULL はその店舗だけの目的
    nameInternal: text('name_internal').notNull(), // 1〜30文字。予約詳細・復唱・受付で出す
    namePublic: text('name_public').notNull(), // 1〜30文字。お客様の面と確認メールで出す
    nameShort: text('name_short').notNull(), // 1〜5文字。台帳の帯・一覧・影響カードで出す
    durationMinutes: integer('duration_minutes').notNull(), // 5〜240
    isWebPublished: text('is_web_published').notNull(), // '0' | '1'
    isActive: text('is_active').notNull(), // '0' | '1'
    sortOrder: integer('sort_order').notNull(),
    version: integer('version').notNull(), // 行を直接 PATCH するときの楽観ロック
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    // 予約の目的選択・ウォークイン・設定の一覧。
    index('visit_purposes_org_store_sort_idx').on(t.organizationId, t.storeId, t.sortOrder),
    // 公開 API（お客様向け Web 予約）の目的一覧。
    index('visit_purposes_org_web_idx').on(t.organizationId, t.storeId, t.isWebPublished),
  ],
)

/**
 * 目的が要求する技能・設備種別。空き枠エンジンの第 5・第 6 条件。
 * 同じ kind の行が複数あるときはすべて満たす（AND）。
 * 1 目的が持てるのは skill が 1 行まで、equipment_kind が 2 行まで。
 */
export const purposeRequirements = sqliteTable(
  'purpose_requirements',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    purposeId: text('purpose_id').notNull(),
    kind: text('kind').notNull(), // 'skill' | 'equipment_kind'
    // kind='skill' → staff_skills.skill_code の 6 値／kind='equipment_kind' → equipment.kind の 3 値
    value: text('value').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 同じ要求を 2 回書かせない。空き枠エンジンの目的別引き。
    uniqueIndex('purpose_requirements_org_purpose_idx').on(
      t.organizationId,
      t.purposeId,
      t.kind,
      t.value,
    ),
  ],
)

/* ───────────────────────────────────────────────────────────────────────────
 * 予約の 3 表（P1 では読み取り専用の器）
 * 設定の保存が「止めると影響するご予約」を数えるために、P1 の時点で行が要る。
 * 書き込み経路（採番・枠の排他・監査）は P3 が足す。
 * ─────────────────────────────────────────────────────────────────────────── */

/** 予約の本体。台帳・検索・変更・分析のすべてがこの表を軸にする。 */
export const reservations = sqliteTable(
  'reservations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    code: text('code').notNull(), // 'EY-YYMM-NNNN'（1 書式。Web の対客番号は別列）
    customerId: text('customer_id'), // ウォークインは NULL のまま確定できる
    source: text('source').notNull(), // 'phone' | 'counter' | 'walkin' | 'web'
    status: text('status').notNull(), // 'confirmed' | 'arrived' | 'serving' | 'done' | 'cancelled' | 'no_show'
    startsAt: text('starts_at').notNull(), // ISO8601 (UTC)
    endsAt: text('ends_at').notNull(), // 片付け時間は含めない
    durationMinutes: integer('duration_minutes').notNull(), // 5〜480
    noteCustomer: text('note_customer'), // 0〜500文字
    noteInternal: text('note_internal'), // 0〜500文字。お客様には見せない
    version: integer('version').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    createdBy: text('created_by'), // 共有端末で個人未確認なら NULL
    cancelledAt: text('cancelled_at'),
    cancelReason: text('cancel_reason'), // 'customer' | 'store' | 'duplicate' | 'no_show'
  },
  (t) => [
    // 台帳 1 日分と、空き枠エンジンの重なり判定。
    index('reservations_org_store_start_idx').on(t.organizationId, t.storeId, t.startsAt),
    // 予約番号での検索と、YYMM 連番の採番衝突検出。
    uniqueIndex('reservations_org_code_idx').on(t.organizationId, t.code),
    // 予約リストの絞り込み（すべて／これから／確認待ち）とお知らせの件数。
    index('reservations_org_store_status_start_idx').on(
      t.organizationId,
      t.storeId,
      t.status,
      t.startsAt,
    ),
    // 顧客詳細の「次のご予約」と来店回数の再計算。
    index('reservations_org_customer_start_idx').on(t.organizationId, t.customerId, t.startsAt),
  ],
)

/**
 * 1 予約に載せる目的。所要時間は予約時点の写しで凍結する
 * （目的の所要を変えても既存予約は書き換えない。だから影響は「これから」の枠だけに限れる）。
 */
export const reservationPurposes = sqliteTable(
  'reservation_purposes',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    reservationId: text('reservation_id').notNull(),
    purposeId: text('purpose_id').notNull(),
    durationMinutes: integer('duration_minutes').notNull(), // 予約時点の写し
    sortOrder: integer('sort_order').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 台帳・詳細・復唱文の目的表示。
    index('reservation_purposes_org_reservation_idx').on(
      t.organizationId,
      t.reservationId,
      t.sortOrder,
    ),
    // 目的別の集計と、目的の所要を変えたときの影響プレビュー。
    index('reservation_purposes_org_purpose_idx').on(t.organizationId, t.purposeId),
  ],
)

/** 担当と設備の押さえ。target_id が NULL（あとで決める）でも枠は消費する。 */
export const reservationAssignments = sqliteTable(
  'reservation_assignments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    reservationId: text('reservation_id').notNull(),
    kind: text('kind').notNull(), // 'staff' | 'equipment'
    targetId: text('target_id'), // NULL = 未定。空き枠エンジンはこの行も重なりとして数える
    startsAt: text('starts_at').notNull(), // ISO8601 (UTC)
    endsAt: text('ends_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 「この担当／この設備はその時間帯に空いているか」。
    index('reservation_assignments_org_target_start_idx').on(
      t.organizationId,
      t.kind,
      t.targetId,
      t.startsAt,
    ),
    // 予約詳細と変更差分。店舗の絞り込みは reservations との JOIN で行う（この表に store_id を置かない）。
    index('reservation_assignments_org_reservation_idx').on(t.organizationId, t.reservationId),
  ],
)

/* ───────────────────────────────────────────────────────────────────────────
 * P2 枠の一次排他（0002_*.sql）
 * 予約の 3 表（reservations / reservation_purposes / reservation_assignments）は
 * P1 が読み取り専用の器として作ってある。P2 で足すのはこの 1 表だけ。
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * 枠の一次排他。刻み（`store_slot_rules.slot_minutes`）単位に展開した占有行で、
 * 予約の確定・変更と同じ `db.batch()` で「上限つき条件付き INSERT」として書く。
 *
 * この表が要るのは D1 の制約による。`db.batch()` は全文を投げてから結果をまとめて
 * 受け取るので、同じバッチの中で読んで判定して書けない。「確定の直前に重なりを
 * 再検査する」方式は 読み → アプリ側で判定 → 書き の 2 往復になり、その間に別端末の
 * 書き込みが入る窓が空く。1 文で上限を数えながら書ける形はこの表しかない
 * （specs/glasses_management/design/03-data-model.md §7.6）。
 *
 * 空き枠エンジンは同じ判定を表示のために先回りで行うが、最後の砦はこの表である。
 * 取り消した予約（status IN ('cancelled','no_show')）の行は残さず DELETE する
 * （空き枠を即座に戻すため）。
 */
export const reservationSlotLocks = sqliteTable(
  'reservation_slot_locks',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    reservationId: text('reservation_id').notNull(), // 取消・変更で一括 DELETE する
    // 'staff' | 'equipment' | 'store'。'store' は店舗まるごとのレーンで、
    // 同時受付上限（store_slot_rules.max_parallel）をここで数える。担当ごとのレーンだけでは
    // target_key が違う予約どうしが数え合わず、上限 3 の店の同じ枠に 4 件入ってしまう。
    kind: text('kind').notNull(),
    // staff.id / equipment.id / 'unassigned' / 'store'。担当が未定のレーンと
    // 店舗まるごとのレーンは固定値で表す。NULL を使わないのは、NULL 同士が `=` で結べず、
    // 上限判定の COUNT(*) がそのレーンだけを数えられなくなるため。
    targetKey: text('target_key').notNull(),
    slotStart: text('slot_start').notNull(), // ISO8601 (UTC)。slot_minutes の格子に載った時刻
    // このバッチの時刻。同じ予約の古い行と新しい行をこの値で見分ける
    // （変更は「新しい枠を取ってから古い枠を返す」順に書く）。
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 上限判定の COUNT(*) を 1 枠 1 回で引く。
    // **一意にしない。** 一意 index は「1」しか表現できず、設定で編集できる 3 つの上限
    // （equipment.capacity 1〜10 / staff.max_parallel_reservations 1〜5 /
    // store_slot_rules.max_parallel 1〜20）がすべて 1 に潰れる。さらに
    // target_key='unassigned' のレーンが 1 本に縛られると、担当を決めずに受け付ける
    // ウォークインが同じ枠に 2 人目を作れなくなる（目の前のお客様を受け付けられない）。
    index('reservation_slot_locks_org_store_target_slot_idx').on(
      t.organizationId,
      t.storeId,
      t.kind,
      t.targetKey,
      t.slotStart,
    ),
    // 取消・変更のときの一括 DELETE と、枠のガードの COUNT(*)。
    index('reservation_slot_locks_org_reservation_idx').on(t.organizationId, t.reservationId),
  ],
)

/* ───────────────────────────────────────────────────────────────────────────
 * P3 電話・店頭からの予約受付（0003_*.sql）
 * 予約を「書く」最初のフェーズで、確定の 1 バッチが必要とする 3 表を足す。
 * 予約の 4 表（reservations / reservation_purposes / reservation_assignments /
 * reservation_slot_locks）は P1・P2 が作ってあるので、ここでは作り直さない。
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * 誰が・どの端末で・何を変えたか。**追記専用で削除しない。**
 * この表が P3 に要るのは、予約の確定が reservations / reservation_purposes /
 * reservation_assignments と同じ `db.batch()` で監査を書く決めによる
 * （specs/glasses_management/design/03-data-model.md §7.1 の不変条件）。
 * 監査の追記に失敗したら本処理も成功させない。
 *
 * 業務の経路から UPDATE / DELETE を発行しない。訂正は打ち消しの行を足す。
 * 行が消えるのは日次 Cron の保持期限（400 日）だけである。
 * before_json / after_json に平文 PIN・ハッシュ・メールアドレス全文を入れない。
 */
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    // 店舗に紐づかない操作（admin からの組織同期）だけ NULL。
    // NULL になるのは target_type='organization' の行に限る。
    storeId: text('store_id'),
    actorType: text('actor_type').notNull(), // 'staff' | 'terminal' | 'system' | 'customer'
    actorId: text('actor_id'), // staff.id 等。'system' では NULL
    terminalId: text('terminal_id'), // terminals は P10。それまで常に NULL
    // ドット区切り。'reservation.created' / 'reservation.cancelled' / 'settings.updated' など
    action: text('action').notNull(),
    // 'reservation' | 'customer' | 'recording' | 'store' | 'staff' | 'equipment' |
    // 'visit_purpose' | 'web_booking' | 'terminal' | 'organization'
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    beforeJson: text('before_json'), // 差分表示（CHANGE-DIFF）の材料
    afterJson: text('after_json'),
    // 1 操作でまとまった複数行を束ねる。同じ db.batch() には同じ値を入れる。
    correlationId: text('correlation_id'),
    occurredAt: text('occurred_at').notNull(), // ISO8601 (UTC)
  },
  (t) => [
    // 監査の時系列閲覧。追記専用なので一意にしない。
    index('audit_events_org_occurred_idx').on(t.organizationId, t.occurredAt),
    // HISTORY-LIST の「そのあとの変更」（1 予約の履歴）。
    index('audit_events_org_target_idx').on(
      t.organizationId,
      t.targetType,
      t.targetId,
      t.occurredAt,
    ),
  ],
)

/**
 * 再送しても同じ応答を返すための記録。予約の確定が `Idempotency-Key` ヘッダーで使う。
 * 主キーが冪等キーそのもの（`{organizationId}:{scope}:{clientKey}`）なので、
 * `INSERT ... ON CONFLICT DO NOTHING` の衝突がそのまま排他になる。**追加の一意 index を張らない。**
 * 短命な排他（枠の仮押さえ）は KV（SHORT_LIVED）が担い、この表では扱わない。
 */
export const idempotencyRecords = sqliteTable(
  'idempotency_records',
  {
    key: text('key').primaryKey(), // '{organizationId}:{scope}:{clientKey}'
    organizationId: text('organization_id').notNull(),
    scope: text('scope').notNull(), // 'reservation.create' | 'reservation.cancel' | 'web_booking.create' 等
    requestHash: text('request_hash').notNull(), // SHA-256 hex（64文字）。違えば 409 idempotency_conflict
    responseJson: text('response_json'), // status='done' のとき非 NULL
    status: text('status').notNull(), // 'in_progress' | 'done'
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(), // created_at + 24h
  },
  (t) => [
    // 期限切れ行を消す Cron のため。ドメインの表と違い、この表だけは物理削除する。
    index('idempotency_records_expires_idx').on(t.expiresAt),
  ],
)

/**
 * 受付開始から予約確定または破棄までの記録単位。**破棄でも行を残す**（行は削除しない）。
 *
 * 予約フローの 5 工程の下書きは端末ではなくこの表の draft_json に置く。iPadOS の Safari は
 * 裏に回ったタブを容易に捨て、戻ると読み込み直すので、端末のメモリだけに持つと伺った内容が丸ごと消える。
 * ただし**お客様のお名前・お電話番号そのものは書かない**。選んだ id と入力途中の文字だけを持つ
 * （07-nfr.md §6.6 の禁止表）。
 *
 * outcome を書くときは ended_at も同じ UPDATE で書き、draft_json は NULL に戻す。
 * outcome='booked' なら reservation_id が非 NULL。
 */
export const receptionSessions = sqliteTable(
  'reception_sessions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    reservationId: text('reservation_id'), // 破棄なら NULL のまま
    terminalId: text('terminal_id'), // terminals は P10。それまで常に NULL
    actorId: text('actor_id'), // staff.id。共有端末で個人未確認なら NULL
    startedAt: text('started_at').notNull(), // ISO8601 (UTC)
    endedAt: text('ended_at'), // 進行中は NULL
    outcome: text('outcome'), // 'booked' | 'discarded'。進行中は NULL
    draftJson: text('draft_json'), // 進行中のみ非 NULL。確定・破棄で NULL へ戻す
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // HISTORY-LIST の日別一覧。
    index('reception_sessions_org_store_started_idx').on(t.organizationId, t.storeId, t.startedAt),
    // 予約詳細から受付と録音へたどる。
    index('reception_sessions_org_reservation_idx').on(t.organizationId, t.reservationId),
  ],
)

/* ───────────────────────────────────────────────────────────────────────────
 * P4 顧客台帳（0004_*.sql）
 * お客様を「探す・特定する・思い出す」ための 4 表。**組織単位で 1 本**にし、
 * 店舗をまたいで共有する（03-data-model.md §9）。別の店舗で書かれた度数・手書き・
 * 履歴も同じ組織なら読める。「別の店舗だから見えない」という分岐は作らない。
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * 顧客台帳の本体。予約・受付・メモ・度数のすべてがこの行に集まる。
 *
 * 電話番号は 3 列に分けて持つ。`phone` は伺ったままの表示用、`phone_normalized` は
 * 数字だけ、`phone_last4` はその末尾 4 桁の写しで、3 つとも NULL か 3 つとも非 NULL。
 * 下 4 桁の検索を後方一致（`LIKE '%' || ?`）で書くと前方ワイルドカードで B-tree が
 * 効かず、年 20,000 行ずつ増えて消えない顧客表を毎回全走査することになる。
 * 写しの列を持って完全一致で引けるようにするのはそのためである。
 *
 * `visit_count` は `reservations` の `status='done'` の件数を書き戻した値で、
 * 読むたびに数え直さない。`merged_into_id` が非 NULL の行は参照専用（検索・一覧から
 * 外し、予約とメモは統合先へ付け替える）。行は削除しない。
 */
export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    // 'G-NNNNN'。統合で失った番号は再利用しない。reservations.code / recordings.code と
    // 紛れないよう code とは呼ばない。
    customerNumber: text('customer_number').notNull(),
    name: text('name').notNull(), // 1〜40文字
    kana: text('kana'), // ひらがなと空白。五十音順一覧の並び
    phone: text('phone'), // 表示用の生文字列 '090-1234-5678'
    phoneNormalized: text('phone_normalized'), // 数字のみ '09012345678'
    phoneLast4: text('phone_last4'), // phone_normalized の末尾 4 桁の写し
    email: text('email'), // Web 予約から入る
    birthDate: text('birth_date'), // 'YYYY-MM-DD'
    address: text('address'), // 0〜120文字
    memo: text('memo'), // 0〜60文字。一覧の「覚えておくこと」列
    firstVisitAt: text('first_visit_at'), // ISO8601 (UTC)
    lastVisitAt: text('last_visit_at'), // ISO8601 (UTC)。一覧の「最後のご来店」
    visitCount: integer('visit_count').notNull(), // 0 以上。done の件数の書き戻し
    mergedIntoId: text('merged_into_id'), // 非 NULL の行は検索・一覧から外す
    version: integer('version').notNull(), // 1 以上。楽観ロック
    createdStoreId: text('created_store_id'), // stores.id
    createdTerminalId: text('created_terminal_id'), // terminals は P10。それまで常に NULL
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    // BOOK-04b の候補提示（前方一致 `LIKE ? || '%'`）と CUSTOMER-NEW の重複警告。
    // 同じ番号のご家族が並ぶので一意にしない。
    index('customers_org_phone_idx').on(t.organizationId, t.phoneNormalized),
    // LEDGER-WALKIN / CUSTOMER-NEW の「下 4 桁でも探せます」。完全一致で引く。
    index('customers_org_phone_last4_idx').on(t.organizationId, t.phoneLast4),
    // CUSTOMER-LIST の五十音順一覧。カーソルは (kana, id) の複合で OFFSET を使わない。
    index('customers_org_kana_idx').on(t.organizationId, t.kana),
    // お客様番号での引き当てと、G-NNNNN の採番衝突検出。
    uniqueIndex('customers_org_customer_number_idx').on(t.organizationId, t.customerNumber),
    // 「ご来店の回数順」以外の並べ替えと、来店の古い順の抽出。
    index('customers_org_last_visit_idx').on(t.organizationId, t.lastVisitAt),
  ],
)

/**
 * 度数の履歴。CUSTOMER-DETAIL の「度数の移り変わり」表。
 * 測定日は時刻を持たない（'YYYY-MM-DD'）。度数と PD は数値で持ち、
 * 表示のときに小数 2 桁（PD は 1 桁）へ整形する。
 * `is_current='1'` は顧客ごとにちょうど 1 行で、新しい測定を足すときは
 * 古い行を '0' にする UPDATE と同じ `db.batch()` で書く。
 */
export const customerPrescriptions = sqliteTable(
  'customer_prescriptions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    customerId: text('customer_id').notNull(),
    storeId: text('store_id').notNull(), // 測定した店舗
    measuredAt: text('measured_at').notNull(), // 'YYYY-MM-DD'（JST の暦日）
    rSph: real('r_sph'), // -20.00〜+20.00（0.25 刻み）
    rCyl: real('r_cyl'), // -10.00〜0.00
    rAxis: integer('r_axis'), // 0〜180
    rAdd: real('r_add'), // 0.00〜+4.00。遠近のみ
    lSph: real('l_sph'),
    lCyl: real('l_cyl'),
    lAxis: integer('l_axis'),
    lAdd: real('l_add'),
    pd: real('pd'), // 40.0〜80.0（mm）
    note: text('note'), // 0〜200文字
    isCurrent: text('is_current').notNull(), // '0' | '1'。表の緑・太字行
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // CUSTOMER-DETAIL の履歴表（新しい順・最大 20 行）。
    index('customer_prescriptions_org_customer_measured_idx').on(
      t.organizationId,
      t.customerId,
      t.measuredAt,
    ),
  ],
)

/**
 * いまお使いのメガネ。CUSTOMER-DETAIL の「いまお使いのメガネ 2本」。
 * 買い替えても行を削除せず、古い行を `is_current='0'` にする。
 * `is_current='1'` の本数に上限はない（0 本でも成り立つ）。
 */
export const customerGlasses = sqliteTable(
  'customer_glasses',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    customerId: text('customer_id').notNull(),
    storeId: text('store_id').notNull(), // お渡しした店舗
    purchasedAt: text('purchased_at').notNull(), // 'YYYY-MM-DD'（JST の暦日）
    frameName: text('frame_name'), // 0〜60文字
    lensName: text('lens_name'), // 0〜40文字
    usageLabel: text('usage_label'), // 0〜20文字。'お出かけ用' / 'PC作業用'
    note: text('note'), // 0〜200文字
    isCurrent: text('is_current').notNull(), // '0' | '1'
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // CUSTOMER-DETAIL の一覧（新しい順）。何本でも持てるので一意にしない。
    index('customer_glasses_org_customer_purchased_idx').on(
      t.organizationId,
      t.customerId,
      t.purchasedAt,
    ),
  ],
)

/**
 * 接客のメモ・注意ごと・手書き。手書きから注意ごとへの昇格は申し込み制で、
 * 申し込みは `kind='attention'` / `status='draft'` の行として作る（自動で上げない）。
 * 「注意ごと N件」に数えるのは `kind='attention'` かつ `status='published'` の行だけ。
 *
 * **手書きの SVG 本体は D1 に置かず、R2（binding `RECORDINGS`）へ置く。**
 * 1 枚 3〜12KB × 5 枚 × 5,000 顧客で約 300MB になり、D1 の 500MB の 6 割を
 * 手書きだけで占めてしまう。キーは `notes/{organizationId}/{customerId}/{id}.svg` で、
 * 前置 `notes/` が録音の `recordings/` と分かれる（掃除の Cron が自分の前置だけを見る）。
 * 読み出しは Worker が R2 から取り、許可リストで再直列化してから返す。
 * 署名付き URL をクライアントへ渡さない。枚数上限は 1 顧客 5 枚。
 */
export const customerNotes = sqliteTable(
  'customer_notes',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    customerId: text('customer_id').notNull(),
    storeId: text('store_id').notNull(), // 書いた店舗（'丸の内店 記入 中村 彩'）
    kind: text('kind').notNull(), // 'memo' | 'attention'
    // 0〜500文字。手書きの読み取り結果もここに入る。手書きだけのメモは空文字で作る
    // （NULL は使わない。読み取り前と読み取り結果が空の区別を持たない）。
    body: text('body').notNull(),
    handwritingKey: text('handwriting_key'), // R2 のキー。SVG の本体を D1 に置かない
    authorId: text('author_id'), // staff.id
    revision: integer('revision').notNull(), // 1 以上。直すたび +1
    status: text('status').notNull(), // 'draft' | 'published' | 'hidden'
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    // CUSTOMER-HANDWRITE のサムネイル一覧（新しい順）と、5 枚の上限判定。
    index('customer_notes_org_customer_created_idx').on(
      t.organizationId,
      t.customerId,
      t.createdAt,
    ),
    // 「注意ごと N件」の件数と RECEPTION-CHECKIN の確認行。
    index('customer_notes_org_customer_kind_idx').on(
      t.organizationId,
      t.customerId,
      t.kind,
      t.status,
    ),
  ],
)

/* ───────────────────────────────────────────────────────────────────────────
 * P5 来店受付とウォークイン（0005_*.sql）
 * お客様が店に着いてから帰るまでを 2 表で持つ。受付そのもの（reception_sessions）と
 * 監査（audit_events）は P3 の表をそのまま使い、ここでは作り直さない。
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * 予約なしのご来店。**お客様を特定しないまま受け付けて台帳に載せる**ための表で、
 * `customer_id` は NULL のまま確定でき、あとから既存顧客にも新規顧客にも紐づけられる。
 *
 * 受付と同時に `source='walkin'` の予約を 1 件起こす（`reservation_id` は NOT NULL）。
 * 担当が決まらない受付は `reservation_slot_locks.target_key='unassigned'` のレーンで枠を取る。
 * 予約を起こさない形にすると、同時受付の上限（`store_slot_rules.max_parallel`）を数える
 * 場所が無くなり、目の前のお客様を上限を超えて受け付けてしまう。
 *
 * `version` を持つのは、顧客の紐づけと担当決めを 2 台の iPad が同時に触るため。
 * `PATCH` は `WHERE id=? AND organization_id=? AND version=?` で書き、0 行なら 409 を返す。
 */
export const walkIns = sqliteTable(
  'walk_ins',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    // arrived_at を JST に直した暦日。採番と「いまお待ち N名」の日引きに使う写しで、
    // arrived_at から毎回計算しない（SQLite に JST の日付関数を持ち込まないため）。
    visitDate: text('visit_date').notNull(), // 'YYYY-MM-DD'（JST の暦日）
    // 1〜999。(organization_id, store_id, visit_date) の中で 1 から連番。
    // 表示は 3 桁ゼロ埋めの 'ウォークイン 004'。
    ticketNo: integer('ticket_no').notNull(),
    arrivedAt: text('arrived_at').notNull(), // ISO8601 (UTC)
    purposeId: text('purpose_id'), // visit_purposes.id。受付パネルの 4 択から選んだとき
    purposeNote: text('purpose_note'), // 0〜80文字。4 択にないご用件の自由記述
    customerId: text('customer_id'), // あとから紐づく。受付の時点では NULL でよい
    reservationId: text('reservation_id').notNull(), // 受付と同時に起こす予約
    // 'waiting' | 'serving' | 'booked' | 'left'
    // お待ち／ご案内中／先のご予約にした／お帰り。真偽値の組で表さない
    // （どれでもない行とどれでもある行を作れてしまう）。
    status: text('status').notNull(),
    leftAt: text('left_at'), // ISO8601 (UTC)。status='left' のとき非 NULL
    version: integer('version').notNull(), // 1 以上。楽観ロック
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 整理番号の重複を DB 側で禁じる。採番は MAX(ticket_no) + 1 を読んでから INSERT
    // するので、同じ値を読んだ 2 台目はここで弾かれ、+1 して採番し直す（最大 5 回）。
    // 店舗 × 日でリセットするので visit_date を含める。
    uniqueIndex('walk_ins_org_store_date_ticket_idx').on(
      t.organizationId,
      t.storeId,
      t.visitDate,
      t.ticketNo,
    ),
    // 台帳の最下段（ウォークインの帯）と受付ボードを受付時刻順に引く。
    index('walk_ins_org_store_arrived_idx').on(t.organizationId, t.storeId, t.arrivedAt),
    // 「いまお待ち N名」。**必ず当日で絞る**ので visit_date を status より前に置く
    // （昨日の waiting を数えないため）。
    index('walk_ins_org_store_date_status_idx').on(
      t.organizationId,
      t.storeId,
      t.visitDate,
      t.status,
    ),
  ],
)

/**
 * ご来店中の工程の記録。RECEPTION-JOURNEY のボード 1 行はこの表の並びそのもので、
 * 現在地は「同じ subject の `occurred_at` が最大の行」である。
 *
 * **追記のみ。UPDATE / DELETE を発行しない。**訂正は打ち消しの行を足す。
 * だから `updated_at` を持たない（置き場所があると書き換えの経路が生える）。
 *
 * 対象は予約とウォークインの 2 種で、`reservation_id` / `walkin_id` の 2 列には割らない
 * （どちらも NULL の行と両方埋まった行が作れてしまう）。`subject_type` + `subject_id` で持つ。
 *
 * `stage` は 8 値（`received` / `waiting` / `consulting` / `fitting` / `measuring` /
 * `checkout` / `handover` / `left`）。ボードの 6 列に並ぶのは `waiting` と `left` を
 * 除いた 6 値で、**列の並びは enum の宣言順と一致しない**（画面側の定数に持つ）。
 * 「ご来店中 N名」は最新の `stage` が `left` でない subject の数で、`handover` も数える。
 */
export const visitEvents = sqliteTable(
  'visit_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    subjectType: text('subject_type').notNull(), // 'reservation' | 'walkin'
    subjectId: text('subject_id').notNull(), // reservations.id または walk_ins.id
    stage: text('stage').notNull(), // 上の 8 値
    occurredAt: text('occurred_at').notNull(), // ISO8601 (UTC)
    // 誰が進めたか。受付は手の空いた人がやるので担当以外も進められ、
    // 共有端末で個人が確認できていなければ NULL のまま残す。
    staffId: text('staff_id'), // staff.id
    note: text('note'), // 0〜120文字。受付時の消し込みの結果もここに残す
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // ボードの 1 行（そのお客様の工程を発生順に引く）。同じ工程を 2 回記録できる
    // （打ち消しの行を足して訂正する）ので一意にしない。
    index('visit_events_org_subject_idx').on(
      t.organizationId,
      t.subjectType,
      t.subjectId,
      t.occurredAt,
    ),
    // 当日のボード全体と、ANALYTICS-WAIT の日次集計。
    index('visit_events_org_store_occurred_idx').on(t.organizationId, t.storeId, t.occurredAt),
  ],
)

/* ───────────────────────────────────────────────────────────────────────────
 * P7 受付の録音（0006_*.sql）
 * 受付中の音を非公開の R2 に置き、状態だけを D1 に持つ 1 表と、放っておくと予約に
 * 響くものを 1 行 1 件にする 1 表。受付そのもの（reception_sessions）と監査
 * （audit_events）は P3 の表をそのまま使い、ここでは作り直さない。
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * 受付中の録音。**実体は R2（binding `RECORDINGS`、非公開）で、D1 は状態だけを持つ。**
 * ダウンロード URL を返さず、再生は Worker が仲介する（短命チケット + ストリーム）。
 *
 * `r2_key` は `recordings/{organizationId}/{storeId}/{YYYY}/{MM}/{id}.{ext}`。
 * 前置 `recordings/` で、同じバケットに入る手書きメモ（`notes/`。§9.4）と分ける。
 * **`id` から決まるので、同じ録音の再送は必ず同じキーを上書きする**（第 2 の冪等キー）。
 * 掃除はこの列が指すキーだけを消し、プレフィクスを走査しない（走査すると手書きを巻き込む）。
 *
 * `retain_until` は `state='stored'` になった時刻から決まる（成立予約 +30 日 /
 * 破棄受付 +24 時間）ので、録り始めの行では NULL である。`legal_hold='1'` か
 * `now <= retain_until` の間は削除を 409 `recording_retained` で拒む。
 * 行は削除しない。R2 のオブジェクトだけ消して `state='deleted'` / `deleted_at` を書く。
 */
export const recordings = sqliteTable(
  'recordings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    // 'EY-R-NNNN'。組織で通しの 4 桁ゼロ埋め（9999 を越えたら 5 桁）。
    // reservations.code（EY-YYMM-NNNN）とは別の採番系統。
    code: text('code').notNull(),
    receptionSessionId: text('reception_session_id').notNull(),
    reservationId: text('reservation_id'), // NULL＝破棄受付の録音（保持は 24 時間）
    r2Key: text('r2_key').notNull(), // API の応答に載せない
    contentType: text('content_type').notNull(), // 'audio/mp4' | 'audio/webm' | 'audio/mpeg'
    durationSeconds: integer('duration_seconds'), // 完了まで NULL。'03:12' は 192
    bytes: integer('bytes'), // 完了まで NULL
    // 'recording' | 'uploading' | 'stored' | 'failed' | 'deleted'
    state: text('state').notNull(),
    // ISO8601 (UTC)。state='stored' になるまで決まらないので NULL 可。
    // ISO 文字列同士の比較は辞書順で時系列と一致するので、掃除の絞り込みは文字列比較でよい。
    retainUntil: text('retain_until'),
    legalHold: text('legal_hold').notNull(), // '0' | '1'。'1' の間は期限後も消さない
    uploadAttempts: integer('upload_attempts').notNull(), // 3 に達したら alerts に 1 件
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'), // state='deleted' のとき非 NULL
  },
  (t) => [
    // 録音番号の採番衝突を DB 側で弾く（walk_ins.ticket_no と同じ作法。弾かれたら
    // 採番し直して最大 5 回まで再試行する）。組織で通しなので store_id を含めない。
    uniqueIndex('recordings_org_code_idx').on(t.organizationId, t.code),
    // 保持期限切れを掃除する Cron。state='stored' かつ retain_until < now を引く。
    index('recordings_org_state_retain_idx').on(t.organizationId, t.state, t.retainUntil),
    // HISTORY-LIST の「受付のときの録音」。1 受付 1 録音だが**一意にしない**
    // （録り直しの行を残せなくなる。1 本しか立てない保証はルート側が持つ）。
    index('recordings_org_session_idx').on(t.organizationId, t.receptionSessionId),
    // LEDGER-DETAIL / CHANGE-SEARCH の「● 録音を聞く　03:12」。
    index('recordings_org_reservation_idx').on(t.organizationId, t.reservationId),
  ],
)

/**
 * 放っておくと予約に響くものを 1 行 1 件にする。ALERTS 画面（P10）の元データで、
 * P7 が立てるのは録音の 3 回失敗（`code='recording.upload_failed'` /
 * `severity='action'`）だけである。
 *
 * **同じ原因で連打しない。**同じ `code` + `target_id` の未解決行（`resolved_at IS NULL`）が
 * あれば新しい行を作らない。再検知は既存行の `occurred_at` を更新せず、何もしない。
 *
 * `audience='ops'` の 3 値（notifier / 組織同期 / D1 容量）は記録としては残すが
 * ALERTS には出さない（運用の失敗を業務のお知らせに積むと「対応が必要」が薄まる）。
 * `body` の上限は契約側の 120 文字で見る（列は text のまま制限しない）。
 */
export const alerts = sqliteTable(
  'alerts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    code: text('code').notNull(), // AlertCode の 10 値
    severity: text('severity').notNull(), // 'info' | 'action'
    audience: text('audience').notNull(), // 'store' | 'ops'
    title: text('title').notNull(), // 1〜60文字。'録音の保存に3回失敗しました'
    body: text('body'), // 'EY-R-1482　田中 花子 様。ご予約は成立しています。'
    targetType: text('target_type'), // 'recording' | 'reservation' | 'equipment'
    targetId: text('target_id'), // 対象表の id。行動ボタンの遷移先
    occurredAt: text('occurred_at').notNull(), // ISO8601 (UTC)
    readAt: text('read_at'), // 「すべて既読にする」で埋める
    resolvedAt: text('resolved_at'), // 非 NULL の件数が ALERTS の「対応済み」
    resolvedBy: text('resolved_by'), // staff.id
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // ALERTS の一覧（新しい順）。
    index('alerts_org_store_occurred_idx').on(t.organizationId, t.storeId, t.occurredAt),
    // サイドバーの未対応バッジ（resolved_at IS NULL を数える）。
    index('alerts_org_store_resolved_idx').on(t.organizationId, t.storeId, t.resolvedAt),
  ],
)

/* ───────────────────────────────────────────────────────────────────────────
 * P8 お客様向け Web 予約（0007_*.sql）
 * 店舗ごとに「出す・出さない／何を出すか／いつまで受けるか」を持つ 1 表と、
 * お客様が Web から入れた予約の付帯情報 1 表。予約そのものは reservations
 * （source='web'）に作り、ご用件は reservation_purposes、担当と設備は
 * reservation_assignments に載せる。確認待ちをお店へ伝える alerts は P7 の表を
 * そのまま使い、ここでは作り直さない。
 * ─────────────────────────────────────────────────────────────────────────── */

/**
 * Web 予約の公開設定。**1 店舗 1 行**（SETTINGS-WEB の保存先）。
 *
 * **行が無い店舗は「未公開」として読む**（is_published='0' と同じ）。
 * 「ご案内のページ eyex.jp/ginza」はこの表に持たない（stores.slug から組み立てる）。
 *
 * opens_at < closes_at。この帯は store_business_hours の内側でなくてよい
 * （Web だけ受付を狭められる）。'HH:MM' の文字列比較で大小を見るので、
 * 桁落ちの '9:00' を入れない（契約の LocalTime が入口で弾く）。
 *
 * requires_approval に「自動で確定する」の選択肢を持たせない。列は '0' / '1' を
 * 取るが、'0' は承認を要らなくするためではなく将来の拡張のために残してある
 * （P8 の UI は '1' 固定で保存する）。
 *
 * change_deadline_days は変更・取消の締切で、**来店日の N 日前の 23:59:59.999 JST**
 * まで受ける（既定 1 = 前日まで）。営業終了時刻を締切にしない — 店舗ごとに締切が
 * 動くとお客様に説明できない。
 */
export const webBookingSettings = sqliteTable(
  'web_booking_settings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    isPublished: text('is_published').notNull(), // '0' | '1'
    opensAt: text('opens_at').notNull(), // 'HH:MM'。SETTINGS-WEB の 10:30
    closesAt: text('closes_at').notNull(), // 'HH:MM'。同 18:00
    acceptFromHours: integer('accept_from_hours').notNull(), // 0〜168。既定 2
    acceptUntilDays: integer('accept_until_days').notNull(), // 1〜180。既定 30
    changeDeadlineDays: integer('change_deadline_days').notNull(), // 0〜30。既定 1
    requiresApproval: text('requires_approval').notNull(), // '0' | '1'
    message: text('message'), // 0〜120文字。お知らせを出さない店舗は NULL
    version: integer('version').notNull(), // 楽観ロック（1 以上）
    updatedAt: text('updated_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // 公開 API が店舗ごとに 1 行だけ引く。2 行目を DB 側で禁じる。
    uniqueIndex('web_booking_settings_org_store_idx').on(t.organizationId, t.storeId),
  ],
)

/**
 * お客様が Web から入れた予約の付帯情報。予約本体は reservations にある。
 *
 * **生の確認鍵・確認番号を保存しない。**列はハッシュだけで、生値はお客様への控え
 * （作成の応答）にだけ載せる。平文で持つと一度漏れたときに全予約が開く。
 * 画面とメールでは management_code_hash の元の値を「確認番号」と呼ぶ
 * （「管理コード」は内部語で、お客様には出さない）。
 *
 * public_code は reservations.code とは**独立した採番**（組織 × YYMM 内の 4 桁
 * ゼロ埋め連番、接頭辞 'EY-W-'）。モックの Web は EY-W-2608-0031、店内は
 * EY-2608-0142 で、同じ連番なら同月に共存しないので系統が別だと読める。
 *
 * contact_email は **NOT NULL**（Q-09 のいまの前提）。承認制である以上、連絡手段の
 * 無いお客様の予約は宙に浮く。確認メールを送れなかったときも予約は残し、
 * ご予約番号と確認番号を控えていただく文を画面に出す。
 *
 * status='pending' のまま**受信日（created_at の JST 暦日）の 24:00 JST** を越えた
 * ものは自動で取り消す。**起算日は受信日であって来店日ではない**（来店日起算にすると
 * 3 週間先の予約が pending のまま ALERTS に居座る）。取消は reservations.status
 * ='cancelled' / cancel_reason='store' と同じ db.batch() で書く。
 */
export const webBookings = sqliteTable(
  'web_bookings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    reservationId: text('reservation_id').notNull(),
    publicCode: text('public_code').notNull(), // 'EY-W-YYMM-NNNN'
    confirmationKeyHash: text('confirmation_key_hash').notNull(), // 確認メールのリンクの 1 回性の鍵
    managementCodeHash: text('management_code_hash').notNull(), // 画面では「確認番号」
    contactName: text('contact_name').notNull(), // 1〜40文字
    contactKana: text('contact_kana'), // ひらがな・空白。無くてよい
    contactPhone: text('contact_phone').notNull(), // 表示用の生文字列（080-2345-6789）
    contactEmail: text('contact_email').notNull(), // RFC 準拠。Q-09 の前提で必須
    status: text('status').notNull(), // 'pending' | 'confirmed' | 'cancelled'
    createdAt: text('created_at').notNull(),
    confirmedAt: text('confirmed_at'), // 確定するまで NULL
    cancelledAt: text('cancelled_at'), // 取り消すまで NULL
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    // 予約 1 件に Web 予約 1 件。台帳から付帯情報を引く。
    uniqueIndex('web_bookings_org_reservation_idx').on(t.organizationId, t.reservationId),
    // WEB-CANCEL の番号引きと採番衝突の検出。組織で通しなので店舗を含めない。
    uniqueIndex('web_bookings_org_public_code_idx').on(t.organizationId, t.publicCode),
    // LEDGER-LIST の「確認待ち 1件」・ALERTS の「Web予約が2件、確認待ちです」。
    index('web_bookings_org_store_status_idx').on(t.organizationId, t.storeId, t.status),
  ],
)

/**
 * 日次の集計（P9 分析）。**画面はこの 1 表しか読まない** — 生データ
 * （reservations / visit_events / walk_ins）の走査を画面から行わない。
 *
 * 1 行 = 店舗 × 暦日（JST） × metric × 切り口。value は real で、件数も
 * 中央値（秒）も同じ列に入る。**率は保存しない**（期間で足したときに
 * 「率の平均」になり、日ごとの母数の違いが消える）。再来は分子
 * （metric='revisits_90d'）だけを保存し、分母は同じ dimension_key の
 * 'receptions' を使って読み出し時に割る。小標本抑制（分母 20 件未満）は
 * この分母でしか判定できない。
 *
 * metric='closed' は「その日を集計した」印を兼ねる（1=定休・臨時休業／
 * 0=営業日）。定休日の 0 件（value=0 の行がある）と欠測（行が無い）を
 * これで区別する。「1日あたり」の分母（営業日数）と「まだ集計中です」の
 * 日数もここから出る。
 *
 * metric='guests'（人数）は書かない。何人のお客様かを数える経路が無く、
 * 画面にも「名」を出さない（Q-11 のいまの前提）。
 *
 * 語彙は packages/contracts の AnalyticsDailyMetric / AnalyticsDimension を
 * 単一ソースにし、**D1 に CHECK 制約を書かない**（語彙が増えるたびに
 * テーブル再作成のマイグレーションが出るのを避ける）。
 */
export const analyticsDaily = sqliteTable(
  'analytics_daily',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    storeId: text('store_id').notNull(),
    date: text('date').notNull(), // 'YYYY-MM-DD'（JST の暦日）
    metric: text('metric').notNull(), // AnalyticsDailyMetric の 8 値
    dimension: text('dimension').notNull(), // AnalyticsDimension の 6 値
    dimensionKey: text('dimension_key').notNull(), // total は ''、hour は '14'、担当未定は 'unassigned'
    value: real('value').notNull(), // 件数・秒・0/1。率は入れない
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    // 日次 upsert の一意鍵。同じ日を数え直しても 2 行目を作らせない。
    uniqueIndex('analytics_daily_org_store_date_metric_dim_idx').on(
      t.organizationId,
      t.storeId,
      t.date,
      t.metric,
      t.dimension,
      t.dimensionKey,
    ),
    // タブ 1 枚ぶんの読み出し（metric を決めて期間で引く）。
    index('analytics_daily_org_store_metric_date_idx').on(
      t.organizationId,
      t.storeId,
      t.metric,
      t.date,
    ),
  ],
)
