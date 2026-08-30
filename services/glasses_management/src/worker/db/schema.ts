import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

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
 * P3（電話・店頭からの予約受付）の 3 を足した 23 表がここにある。
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
