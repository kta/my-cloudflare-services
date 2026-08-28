/**
 * EYEX予約（`glasses_management`）の Zod 単一ソース。
 *
 * このファイルだけが API の入出力の形を持つ。Worker は `zValidator` で受け、
 * 返すときも必ずここのスキーマで `parse` してから `c.json` する。
 * フロントは `hc<AppType>` から型を受け取るので、手書きの型を作らない。
 *
 * 追加はフェーズごとに行う（`specs/glasses_management/features/*`）。
 * P0（基盤）の範囲は、admin から届く組織・店舗権限の同期と、店舗そのものだけ。
 */
import { z } from 'zod'
import { Plan } from './auth'

/* ------------------------------------------------------------------------- *
 * admin → glasses_management の同期
 *
 * admin が組織と利用者の正であり、このドメインはその写しだけを持つ。
 * cross-D1 JOIN ができないので、service binding 経由の push で収束させる。
 * ------------------------------------------------------------------------- */

/**
 * 組織スナップショット。`revision` は admin 側で単調増加し、受け取る側は
 * 自分が持つ revision 未満の配信を無視する（古い配信で巻き戻さない）。
 */
export const OrganizationSync = z.strictObject({
  // admin の正本 id はこのドメインより古く、UUID とは限らない（seed の
  // `org-admin-seed` など）。テナントキーとしては非空であればよい。
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  plan: Plan,
  isDisabled: z.boolean(),
  createdAt: z.string().datetime(),
  revision: z.number().int().nonnegative().default(0),
})
export type OrganizationSync = z.infer<typeof OrganizationSync>

/**
 * 店舗スコープ権限の語彙。許可リストであり、知らない値は落ちる（fail close）。
 * `packages/contracts/src/auth.ts` の `AdministrablePermission` と**同一集合**で
 * あることをテストで固定する（相互 import は循環になるため値で持つ）。
 */
export const StorePermission = z.enum([
  'store.read',
  'store.manage',
  'reservation.read',
  'reservation.write',
  'customer.read',
  'customer.write',
  // 店舗をまたぐ来店・購入・調整履歴。無い場合は選択中店舗の行だけが見え、
  // 他店に行があるという標識も出さない。
  'customer.history',
  // 注意事項（制限情報）。閲覧と、版を伴う公開・改訂・非表示化を分けておき、
  // 見る権限が書く権限に化けないようにする。
  'attention.read',
  'attention.write',
  'attention.publish',
  'attention.revise',
  'attention.hide',
  'settings.read',
  'settings.manage',
  'recording.read',
  'recording.manage',
  'audit.read',
  'terminal.manage',
  // 分析。読み取り専用。予約の行を見せずに数字だけを渡せるように分けてある。
  'analytics.read',
])
export type StorePermission = z.infer<typeof StorePermission>

/**
 * 担当店舗。admin が利用者・標準ロール・担当店舗の源泉で、結果の membership
 * だけがここへ届く。担当解除は行を消さず `permissions` を空にして配る
 * （削除専用の経路を持たずに収束させるため）。
 */
export const StoreMembership = z.strictObject({
  id: z.string().uuid(),
  organizationId: z.string().trim().min(1).max(200),
  storeId: z.string().uuid(),
  userId: z.string().min(1).max(200),
  permissions: StorePermission.array(),
  createdAt: z.string().datetime(),
})
export type StoreMembership = z.infer<typeof StoreMembership>

/* ------------------------------------------------------------------------- *
 * 店舗
 * ------------------------------------------------------------------------- */

/** このドメインが持つ店舗。1 つの組織の下に複数ある。 */
export const Store = z.strictObject({
  id: z.string().uuid(),
  // 正本の組織 id を指す。組織 id は UUID とは限らないが、店舗自身の id は UUID。
  organizationId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(60),
  // お客様向け Web 予約の URL（`/w/:storeSlug`）に出る。**全組織横断で一意**。
  // 公開ページは未認証で organization_id を持たないため、slug 単独で店舗を決める。
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  phone: z.string().trim().max(30).default(''),
  address: z.string().trim().max(200).default(''),
  accessNote: z.string().trim().max(200).default(''),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
})
export type Store = z.infer<typeof Store>

/* ------------------------------------------------------------------------- *
 * 操作主体
 * ------------------------------------------------------------------------- */

/**
 * 認可で使う解決済みの操作主体。**リクエスト入力から作らない**（JWT と
 * 端末セッションから組み立てる）。共有端末では個人を推測せず端末を主体にする。
 */
export const Actor = z.strictObject({
  subjectId: z.string().min(1).max(200),
  organizationId: z.string().trim().min(1).max(200),
  kind: z.enum(['staff', 'terminal', 'system', 'customer']),
  terminalId: z.string().uuid().nullable().default(null),
})
export type Actor = z.infer<typeof Actor>

/* ------------------------------------------------------------------------- *
 * P1 店舗の受付条件（`specs/glasses_management/features/004-store-settings`）
 *
 * 店長が「いつ・誰が・どの設備で・どのご用件を受けられるか」を決める 6 面の
 * 入出力。綴りは `design/04-api.md` §4.3 と `design/03-data-model.md` の列名に
 * 揃える（`publicName` / `intro` のような短縮した別名を作らない）。
 * ------------------------------------------------------------------------- */

/* --- 原始型 -------------------------------------------------------------- */

/** JST の暦日。`2026-8-7` のような桁落ちを通すと日付の比較が壊れる。 */
export const LocalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export type LocalDate = z.infer<typeof LocalDate>

/**
 * 店舗の時計の時刻。時は必ず 2 桁にする。空き枠エンジンと保存時の検証は
 * `'18:40' < '19:00'` の**文字列比較**で大小を見るので、`9:00` を通すと
 * `'9:00' > '18:40'` になって受付できる区間が黙って壊れる。
 */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export type LocalTime = z.infer<typeof LocalTime>

/** 0=日 … 6=土（`store_business_hours.weekday` と同じ並び）。 */
export const Weekday = z.number().int().min(0).max(6)
export type Weekday = z.infer<typeof Weekday>

/** 楽観ロックの版。設定 6 面はすべて `store_settings_revision.version` を送る。 */
export const Version = z.number().int().nonnegative()
export type Version = z.infer<typeof Version>

/** UTC の ISO8601。JST への読み替えはドメイン層が行う。 */
const IsoDateTime = z.string().datetime()
/** このドメインが発行する ID。 */
const Uuid = z.string().uuid()
/** ご用件の所要時間。5 分の格子に載らない値を作らせない。 */
const DurationMinutes = z.number().int().min(5).max(480).multipleOf(5)

/** 半開区間 `[startsAt, endsAt)` の左右が逆でないこと。 */
const startsBeforeEnds = (value: { startsAt: string; endsAt: string }): boolean =>
  value.startsAt < value.endsAt

/**
 * `from`〜`to` の日数が上限以内で、向きも正しいこと。
 * 逆向きの範囲は 0 件を返さずに入力を直させる（画面が黙って空になるのを防ぐ）。
 */
const spanWithinDays =
  (maxDays: number) =>
  (value: { from: string; to: string }): boolean => {
    const days =
      (Date.parse(`${value.to}T00:00:00.000Z`) - Date.parse(`${value.from}T00:00:00.000Z`)) /
      86_400_000
    return days >= 0 && days <= maxDays
  }

/** 同じ値を 2 回書かせない。 */
const noDuplicates = (values: readonly string[]): boolean => new Set(values).size === values.length

/**
 * 画面が数えているのと同じ文字数（**符号位置**）で上限を見る。
 * `z.string().max()` は UTF-16 の長さなので、絵文字を 1 文字と数える画面の
 * 「200文字／200文字まで」と食い違い、保存できるはずの文が黙って 400 になる。
 */
const codePointsAtMost =
  (max: number) =>
  (value: string): boolean =>
    [...value].length <= max

/**
 * 一覧の絞り込みに使う真偽値。クエリ文字列は必ず**文字列**で届く
 * （`?includeInactive=true`）ので、`true` / `1` / `false` / `0` の 4 語を受ける。
 * 欄そのものが無ければ `false`。知らない語は落として **400** にする
 * （`zValidator` を通さずに手で `parse` すると 500 に化けるため、必ずこの形で受ける）。
 * 真偽値そのものも受けるのは、値から組み立てるサーバ内の呼び出しを壊さないためである。
 */
const QueryFlag = z
  .union([z.boolean(), z.enum(['true', '1', 'false', '0'])])
  .default(false)
  .transform((value) => value === true || value === 'true' || value === '1')

/* --- 店舗の情報（SETTINGS-STORE） ---------------------------------------- */

/**
 * SETTINGS-STORE が読む店舗。`settingsVersion` は `store_settings_revision` の
 * 版で、設定 6 面の保存はすべてこの 1 本で衝突を見る（`stores` は版を持たない）。
 */
export const StoreDetail = Store.extend({
  namePublic: z.string().trim().max(60).nullable().default(null),
  nearestStation: z.string().trim().max(40).nullable().default(null),
  parkingNote: z.string().trim().max(60).nullable().default(null),
  // 「78文字／200文字まで」。数える前に trim すると画面の残り文字数とずれる。
  // 上限は画面と同じ符号位置で数える（`max()` の UTF-16 長は絵文字を 2 と数える）。
  introText: z.string().refine(codePointsAtMost(200)).nullable().default(null),
  sortOrder: z.number().int().nonnegative().nullable().default(null),
  updatedAt: IsoDateTime.nullable().default(null),
  updatedBy: Uuid.nullable().default(null),
  settingsVersion: Version,
})
export type StoreDetail = z.infer<typeof StoreDetail>

/** SETTINGS-STORE の「保存」。`version` は `store_settings_revision.version`。 */
export const StorePatch = z.strictObject({
  name: z.string().trim().min(1).max(60).optional(),
  namePublic: z.string().trim().max(60).nullable().optional(),
  phone: z.string().trim().max(30).optional(),
  address: z.string().trim().max(200).optional(),
  nearestStation: z.string().trim().max(40).nullable().optional(),
  accessNote: z.string().trim().max(200).optional(),
  parkingNote: z.string().trim().max(60).nullable().optional(),
  introText: z.string().refine(codePointsAtMost(200)).nullable().optional(),
  sortOrder: z.number().int().nonnegative().nullable().optional(),
  version: Version,
})
export type StorePatch = z.infer<typeof StorePatch>

/* --- 営業時間と受付を止める帯（SETTINGS-HOURS） --------------------------- */

/**
 * 曜日 1 行。`breakStart` / `breakEnd` は決定ブリーフの列名を保つためだけに
 * 残してあり、**常に null** にする。受付を止める帯の正本は
 * `store_blackout_windows`（1 日に 3 本ある）である。
 */
export const BusinessHoursRow = z
  .strictObject({
    weekday: Weekday,
    isClosed: z.boolean(),
    opensAt: LocalTime.nullable().default(null),
    closesAt: LocalTime.nullable().default(null),
    breakStart: LocalTime.nullable().default(null),
    breakEnd: LocalTime.nullable().default(null),
  })
  .refine((row) => !row.isClosed || (row.opensAt === null && row.closesAt === null), {
    message: '定休の曜日に開店・閉店の時刻を入れない',
    path: ['opensAt'],
  })
  .refine(
    (row) =>
      row.isClosed || (row.opensAt !== null && row.closesAt !== null && row.opensAt < row.closesAt),
    { message: '閉店は開店より後にする', path: ['closesAt'] },
  )
export type BusinessHoursRow = z.infer<typeof BusinessHoursRow>

/** 保存された止める帯 1 本。 */
export const BlackoutWindow = z
  .strictObject({
    id: Uuid,
    weekday: Weekday,
    startsAt: LocalTime,
    endsAt: LocalTime,
    label: z.string().trim().min(1).max(20),
    sortOrder: z.number().int().nonnegative().default(0),
  })
  .refine(startsBeforeEnds, { message: '終了は開始より後にする', path: ['endsAt'] })
export type BlackoutWindow = z.infer<typeof BlackoutWindow>

/** 「＋ 止める時間帯を足す」で増える 1 本。 */
export const BlackoutWindowInput = z
  .strictObject({
    weekday: Weekday,
    startsAt: LocalTime,
    endsAt: LocalTime,
    label: z.string().trim().min(1).max(20),
    sortOrder: z.number().int().nonnegative().default(0),
  })
  .refine(startsBeforeEnds, { message: '終了は開始より後にする', path: ['endsAt'] })
export type BlackoutWindowInput = z.infer<typeof BlackoutWindowInput>

/**
 * SETTINGS-HOURS の「保存」。営業時間と止める帯は 1 回の操作で一緒に送る
 * （画面の「保存」は 1 つで、帯だけを保存する経路を持たない）。
 */
export const BusinessHoursInput = z
  .strictObject({
    rows: BusinessHoursRow.array().length(7),
    blackouts: BlackoutWindowInput.array().max(70).default([]),
    version: Version,
  })
  .refine((value) => noDuplicates(value.rows.map((row) => String(row.weekday))), {
    message: '同じ曜日を 2 行に書かない',
    path: ['rows'],
  })
export type BusinessHoursInput = z.infer<typeof BusinessHoursInput>

/**
 * 営業時間の応答。`warnings` は**保存を止めなかった**指摘（刻みが片付けより
 * 短い、など）で、拒否は 3 つだけという決めを応答の側からも守らせる。
 */
export const BusinessHoursView = z.strictObject({
  rows: BusinessHoursRow.array().length(7),
  blackouts: BlackoutWindow.array().default([]),
  version: Version,
  warnings: z.string().array().default([]),
})
export type BusinessHoursView = z.infer<typeof BusinessHoursView>

/* --- 営業日（SETTINGS-CALENDAR） ----------------------------------------- */

/** 臨時のお休みと特別営業。`store_business_hours` より優先する。 */
export const CalendarException = z.strictObject({
  id: Uuid,
  date: LocalDate,
  kind: z.enum(['closed', 'special']),
  opensAt: LocalTime.nullable().default(null),
  closesAt: LocalTime.nullable().default(null),
  note: z.string().trim().max(60).nullable().default(null),
})
export type CalendarException = z.infer<typeof CalendarException>

/** 日付をひとつ押したときに作る行。 */
export const CalendarExceptionInput = z
  .strictObject({
    date: LocalDate,
    kind: z.enum(['closed', 'special']),
    opensAt: LocalTime.nullable().default(null),
    closesAt: LocalTime.nullable().default(null),
    note: z.string().trim().max(60).nullable().default(null),
  })
  .refine(
    (value) =>
      value.kind !== 'special' ||
      (value.opensAt !== null && value.closesAt !== null && value.opensAt < value.closesAt),
    { message: '特別営業は開店と閉店の両方を入れる', path: ['opensAt'] },
  )
  .refine(
    (value) => value.kind !== 'closed' || (value.opensAt === null && value.closesAt === null),
    { message: '臨時のお休みに開店・閉店の時刻を入れない', path: ['opensAt'] },
  )
export type CalendarExceptionInput = z.infer<typeof CalendarExceptionInput>

/** SETTINGS-CALENDAR は 2 か月ぶんを一度に描く。 */
export const CalendarExceptionQuery = z
  .strictObject({ from: LocalDate, to: LocalDate })
  .refine(spanWithinDays(92), { message: '一度に取れるのは 92 日まで', path: ['to'] })
export type CalendarExceptionQuery = z.infer<typeof CalendarExceptionQuery>

/* --- 予約の間隔（SETTINGS-HOURS 右カラム） -------------------------------- */

/** 刻み・片付け・同時受付の上限。1 店舗 1 行。 */
export const SlotRules = z.strictObject({
  slotMinutes: z.number().int().min(5).max(120).default(30),
  cleanupMinutes: z.number().int().min(0).max(60).default(10),
  maxParallel: z.number().int().min(1).max(20).default(3),
  version: Version,
  updatedAt: IsoDateTime,
})
export type SlotRules = z.infer<typeof SlotRules>

/** 「予約の間隔」の保存。 */
export const SlotRulesInput = z.strictObject({
  slotMinutes: z.number().int().min(5).max(120),
  cleanupMinutes: z.number().int().min(0).max(60),
  maxParallel: z.number().int().min(1).max(20),
  version: Version,
})
export type SlotRulesInput = z.infer<typeof SlotRulesInput>

/**
 * 「木曜日に最後にお受けできるのは 18:20 です。」の 7 曜日ぶん。
 * `z.record` にすると曜日の欠けと余りを落とせないので、7 キーちょうどで書く。
 * 休みの曜日は枠が 1 つも無いので null になる。
 */
const LastAcceptableAt = z.strictObject({
  '0': LocalTime.nullable(),
  '1': LocalTime.nullable(),
  '2': LocalTime.nullable(),
  '3': LocalTime.nullable(),
  '4': LocalTime.nullable(),
  '5': LocalTime.nullable(),
  '6': LocalTime.nullable(),
})

/** 予約の間隔の応答。最後にお受けできる時刻は**サーバが空き枠から出す**。 */
export const SlotRulesView = SlotRules.extend({
  lastAcceptableAt: LastAcceptableAt,
  warnings: z.string().array().default([]),
})
export type SlotRulesView = z.infer<typeof SlotRulesView>

/* --- スタッフと技能（SETTINGS-STAFF） ------------------------------------ */

/**
 * できること（技能）の 6 値。`staff_skills.skill_code` と同じ綴りにする。
 * 7 つ目を足すには SETTINGS-STAFF と SETTINGS-PURPOSE の両方を変える必要がある。
 */
export const SkillCode = z.enum([
  'measure',
  'processing',
  'sales_reception',
  'fitting',
  'contact_lens',
  'repair',
])
export type SkillCode = z.infer<typeof SkillCode>

/** 台帳の行・LOGIN-STAFF のタイル・設定の一覧が読むスタッフ。 */
export const StaffMember = z.strictObject({
  id: Uuid,
  displayName: z.string().trim().min(1).max(40),
  kana: z.string().trim().max(40).nullable().default(null),
  jobLabel: z.string().trim().max(40).nullable().default(null),
  role: z.enum(['staff', 'manager']).default('staff'),
  isActive: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  skills: SkillCode.array().default([]),
  adminUserId: z.string().min(1).max(200).nullable().default(null),
  // `pin_hash` が非 NULL かをサーバが毎回導出する。**ハッシュ自体は外へ出さない**
  // （`z.strictObject` なので `pinHash` を積んだ応答はここで落ちる）。
  hasPin: z.boolean(),
  maxParallelReservations: z.number().int().min(1).max(5).default(1),
  pinUpdatedAt: IsoDateTime.nullable().default(null),
})
export type StaffMember = z.infer<typeof StaffMember>

/** 「＋ スタッフを足す」。技能は `StaffSkillsInput` が別に置き換える。 */
export const StaffMemberInput = z.strictObject({
  displayName: z.string().trim().min(1).max(40),
  kana: z.string().trim().max(40).nullable().default(null),
  jobLabel: z.string().trim().max(40).nullable().default(null),
  role: z.enum(['staff', 'manager']).default('staff'),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().default(0),
  adminUserId: z.string().min(1).max(200).nullable().default(null),
  maxParallelReservations: z.number().int().min(1).max(5).default(1),
})
export type StaffMemberInput = z.infer<typeof StaffMemberInput>

/** SETTINGS-STAFF 右の編集。「いま使える」を切っても行は消さない。 */
export const StaffMemberPatch = z.strictObject({
  displayName: z.string().trim().min(1).max(40).optional(),
  kana: z.string().trim().max(40).nullable().optional(),
  jobLabel: z.string().trim().max(40).nullable().optional(),
  role: z.enum(['staff', 'manager']).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  adminUserId: z.string().min(1).max(200).nullable().optional(),
  maxParallelReservations: z.number().int().min(1).max(5).optional(),
  version: Version,
})
export type StaffMemberPatch = z.infer<typeof StaffMemberPatch>

/** 「できること（技能）」の 6 チップの一括置換。0 件でよい。 */
export const StaffSkillsInput = z
  .strictObject({ skills: SkillCode.array().max(6) })
  .refine((value) => noDuplicates(value.skills), {
    message: '同じ技能を 2 回付けない',
    path: ['skills'],
  })
export type StaffSkillsInput = z.infer<typeof StaffSkillsInput>

/** 曜日テンプレートの展開結果。**読み取り専用**で、人は曜日の側を直す。 */
export const StaffShift = z
  .strictObject({
    id: Uuid,
    staffId: Uuid,
    date: LocalDate,
    startsAt: LocalTime,
    endsAt: LocalTime,
    kind: z.enum(['work', 'break']),
  })
  .refine(startsBeforeEnds, { message: '終了は開始より後にする', path: ['endsAt'] })
export type StaffShift = z.infer<typeof StaffShift>

/** 勤務の取得。展開は 62 日先までなので、それ以上をまとめて求めさせない。 */
export const StaffShiftQuery = z
  .strictObject({ from: LocalDate, to: LocalDate, staffId: Uuid.optional() })
  .refine(spanWithinDays(62), { message: '一度に取れるのは 62 日まで', path: ['to'] })
export type StaffShiftQuery = z.infer<typeof StaffShiftQuery>

/**
 * 勤務の曜日 1 行。休憩は `staff_weekly_shifts.break_start` / `break_end` の
 * **1 組しか保存できない**ので、2 件目を黙って捨てないよう 1 件までに閉じる。
 */
const WeeklyShiftRow = z
  .strictObject({
    weekday: Weekday,
    isOff: z.boolean(),
    startsAt: LocalTime.nullable().default(null),
    endsAt: LocalTime.nullable().default(null),
    breaks: z.strictObject({ startsAt: LocalTime, endsAt: LocalTime }).array().max(1).default([]),
  })
  .refine(
    (row) =>
      row.isOff || (row.startsAt !== null && row.endsAt !== null && row.startsAt < row.endsAt),
    { message: '働く曜日は終了を開始より後にする', path: ['endsAt'] },
  )

/**
 * SETTINGS-STAFF の「勤務時間」7 列グリッド。送られた 7 行を
 * `staff_weekly_shifts` に正本として保存し、`effectiveFrom` から 62 日先まで
 * `staff_shifts` へ展開して置き換える。
 * 営業時間の外にはみ出しても**拒まない**（警告を 1 行出して通す）。
 */
export const StaffShiftsInput = z.strictObject({
  staffId: Uuid,
  weekly: WeeklyShiftRow.array().length(7),
  effectiveFrom: LocalDate,
  version: Version,
})
export type StaffShiftsInput = z.infer<typeof StaffShiftsInput>

/** スタッフの取得。`date` を渡すとその日の勤務を同梱する。 */
export const StaffListQuery = z.strictObject({
  includeInactive: QueryFlag,
  date: LocalDate.optional(),
})
export type StaffListQuery = z.infer<typeof StaffListQuery>

/* --- 設備と点検（SETTINGS-EQUIPMENT） ------------------------------------ */

/**
 * 設備・場所の種別。**フィッティング台は `counter`** に置く（作業台という語の
 * 見た目に引きずられて `workbench` を割り当てない）。
 */
export const EquipmentKind = z.enum(['measure', 'counter', 'workbench'])
export type EquipmentKind = z.infer<typeof EquipmentKind>

/** 1 台 1 行。設定画面の「相談カウンター 1・2」は表示側のまとめである。 */
export const Equipment = z.strictObject({
  id: Uuid,
  name: z.string().trim().min(1).max(40),
  kind: EquipmentKind,
  capacity: z.number().int().min(1).max(10).default(1),
  isActive: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  inactiveReason: z.string().trim().max(60).nullable().default(null),
  // LEDGER-RESOURCE の行名の下に出る小さい文字。`kind` からは導けない。
  roleLabel: z.string().trim().min(1).max(20),
  ledgerDisplay: z.enum(['grey', 'hide']),
})
export type Equipment = z.infer<typeof Equipment>

/** 「＋ 設備を足す」。台帳の見せ方は「灰色にして残す」から始める。 */
export const EquipmentInput = z.strictObject({
  name: z.string().trim().min(1).max(40),
  kind: EquipmentKind,
  capacity: z.number().int().min(1).max(10).default(1),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().default(0),
  inactiveReason: z.string().trim().max(60).nullable().default(null),
  roleLabel: z.string().trim().min(1).max(20),
  ledgerDisplay: z.enum(['grey', 'hide']).default('grey'),
})
export type EquipmentInput = z.infer<typeof EquipmentInput>

/** 「編集中：視力測定機 B」。行は消さず `isActive` を切る。 */
export const EquipmentPatch = z.strictObject({
  name: z.string().trim().min(1).max(40).optional(),
  kind: EquipmentKind.optional(),
  capacity: z.number().int().min(1).max(10).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  inactiveReason: z.string().trim().max(60).nullable().optional(),
  roleLabel: z.string().trim().min(1).max(20).optional(),
  ledgerDisplay: z.enum(['grey', 'hide']).optional(),
  version: Version,
})
export type EquipmentPatch = z.infer<typeof EquipmentPatch>

/** 設備の取得。 */
export const EquipmentListQuery = z.strictObject({
  includeInactive: QueryFlag,
  kind: EquipmentKind.optional(),
})
export type EquipmentListQuery = z.infer<typeof EquipmentListQuery>

/** 点検予定。空き枠エンジンが「その時間帯は使えない」と読む。 */
export const EquipmentMaintenance = z
  .strictObject({
    id: Uuid,
    equipmentId: Uuid,
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
    note: z.string().trim().max(60).nullable().default(null),
  })
  .refine(startsBeforeEnds, { message: '終了は開始より後にする', path: ['endsAt'] })
export type EquipmentMaintenance = z.infer<typeof EquipmentMaintenance>

/** 「止める期間」の追加。 */
export const EquipmentMaintenanceInput = z
  .strictObject({
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
    note: z.string().trim().max(60).nullable().default(null),
  })
  .refine(startsBeforeEnds, { message: '終了は開始より後にする', path: ['endsAt'] })
export type EquipmentMaintenanceInput = z.infer<typeof EquipmentMaintenanceInput>

/** 「次の点検」の取得。 */
export const MaintenanceQuery = z
  .strictObject({ from: LocalDate, to: LocalDate })
  .refine(spanWithinDays(92), { message: '一度に取れるのは 92 日まで', path: ['to'] })
export type MaintenanceQuery = z.infer<typeof MaintenanceQuery>

/* --- ご来店の目的（SETTINGS-PURPOSE） ------------------------------------ */

/**
 * 目的が要求する技能・設備種別。同じ `kind` の行が複数あるときは**すべて満たす**。
 * `kind` で `value` の語彙が変わるので判別可能な union で表す。
 */
export const PurposeRequirement = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('skill'), value: SkillCode }),
  z.strictObject({ kind: z.literal('equipment_kind'), value: EquipmentKind }),
])
export type PurposeRequirement = z.infer<typeof PurposeRequirement>

/** ご来店の目的。`storeId` が null の行はチェーン共通。 */
export const VisitPurpose = z.strictObject({
  id: Uuid,
  storeId: Uuid.nullable().default(null),
  nameInternal: z.string().trim().min(1).max(40),
  namePublic: z.string().trim().min(1).max(40),
  // 台帳の帯・HOME の一覧・設定の影響カードに出す短い名前（`新調相談`）。
  nameShort: z.string().trim().min(1).max(5),
  durationMinutes: DurationMinutes,
  isWebPublished: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  requirements: PurposeRequirement.array().default([]),
  version: Version,
})
export type VisitPurpose = z.infer<typeof VisitPurpose>

/** 「＋ 目的を足す」。 */
export const VisitPurposeInput = z.strictObject({
  storeId: Uuid.nullable().default(null),
  nameInternal: z.string().trim().min(1).max(40),
  namePublic: z.string().trim().min(1).max(40),
  nameShort: z.string().trim().min(1).max(5),
  durationMinutes: DurationMinutes,
  isWebPublished: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().nonnegative().default(0),
})
export type VisitPurposeInput = z.infer<typeof VisitPurposeInput>

/** 「編集中：メガネを新しく作る」。所要時間を変えても既存の予約は変わらない。 */
export const VisitPurposePatch = z.strictObject({
  nameInternal: z.string().trim().min(1).max(40).optional(),
  namePublic: z.string().trim().min(1).max(40).optional(),
  nameShort: z.string().trim().min(1).max(5).optional(),
  durationMinutes: DurationMinutes.optional(),
  isWebPublished: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  version: Version,
})
export type VisitPurposePatch = z.infer<typeof VisitPurposePatch>

/**
 * 「必要な技能」「必要な設備・場所」の一括置換。
 * SETTINGS-PURPOSE の編集欄が技能 1 つ・設備 2 つしか置き場を持たないので、
 * 超える入力は画面に出せない値になる。必要数は人数に比例させない（固定）。
 */
export const PurposeRequirementsInput = z
  .strictObject({ requirements: PurposeRequirement.array().max(6) })
  .refine((value) => noDuplicates(value.requirements.map((r) => `${r.kind}:${r.value}`)), {
    message: '同じ要求を 2 回書かない',
    path: ['requirements'],
  })
  .refine((value) => value.requirements.filter((r) => r.kind === 'skill').length <= 1, {
    message: '必要な技能は 1 つまで',
    path: ['requirements'],
  })
  .refine((value) => value.requirements.filter((r) => r.kind === 'equipment_kind').length <= 2, {
    message: '必要な設備・場所は 2 つまで',
    path: ['requirements'],
  })
export type PurposeRequirementsInput = z.infer<typeof PurposeRequirementsInput>

/** 「この順でお客様にお見せします。」 */
export const PurposeOrderInput = z
  .strictObject({ purposeIds: Uuid.array().min(1).max(50) })
  .refine((value) => noDuplicates(value.purposeIds), {
    message: '同じ目的を 2 回並べない',
    path: ['purposeIds'],
  })
export type PurposeOrderInput = z.infer<typeof PurposeOrderInput>

/** 目的の取得。 */
export const PurposeListQuery = z.strictObject({
  storeId: Uuid.optional(),
  includeInactive: QueryFlag,
  webPublishedOnly: QueryFlag,
})
export type PurposeListQuery = z.infer<typeof PurposeListQuery>

/* --- 保存の前に見せる影響（3 面が同じ器を使う） --------------------------- */

/**
 * 保存前の影響試算。**読み取り専用**で、未保存の下書きを body で受け取る。
 * `kind` ごとに下書きの形が違うので判別可能な union で表す。
 */
export const SettingsImpactRequest = z.discriminatedUnion('kind', [
  z.strictObject({
    storeId: Uuid,
    kind: z.literal('equipment_stop'),
    draft: z.strictObject({
      equipmentId: Uuid,
      startsAt: IsoDateTime,
      endsAt: IsoDateTime,
    }),
  }),
  z.strictObject({
    storeId: Uuid,
    kind: z.literal('purpose_duration'),
    draft: z.strictObject({
      purposeId: Uuid,
      durationMinutes: DurationMinutes,
      from: LocalDate,
      to: LocalDate,
    }),
  }),
  z.strictObject({
    storeId: Uuid,
    kind: z.literal('business_hours'),
    draft: z.strictObject({
      rows: BusinessHoursRow.array().length(7),
      blackouts: BlackoutWindowInput.array().max(70).default([]),
    }),
  }),
])
export type SettingsImpactRequest = z.infer<typeof SettingsImpactRequest>

/** 影響 1 件。Web 枠には行の id が無いので `targetId` は null を取る。 */
export const SettingsImpactItem = z.strictObject({
  at: IsoDateTime,
  label: z.string().trim().min(1).max(80),
  targetType: z.enum(['reservation', 'web_slot']),
  targetId: Uuid.nullable().default(null),
})
export type SettingsImpactItem = z.infer<typeof SettingsImpactItem>

/**
 * 影響の一覧。`severity` は**件数から一意に決まる**。
 * 数えた件数と札の色が食い違う応答を作れないよう、契約の側で結び付ける
 * （0 件のとき札を赤くしない＝AC-SET-14）。
 */
export const SettingsImpactReport = z
  .strictObject({
    affectedReservations: SettingsImpactItem.array().default([]),
    affectedWebSlots: SettingsImpactItem.array().default([]),
    lastAcceptableAt: LocalTime.nullable().default(null),
    severity: z.enum(['info', 'action']),
  })
  .refine(
    (report) =>
      (report.affectedReservations.length + report.affectedWebSlots.length === 0) ===
      (report.severity === 'info'),
    { message: '影響が 0 件なら info、1 件以上なら action にする', path: ['severity'] },
  )
export type SettingsImpactReport = z.infer<typeof SettingsImpactReport>

/** 削除の応答。 */
export const DeletedResult = z.strictObject({ id: Uuid, deleted: z.literal(true) })
export type DeletedResult = z.infer<typeof DeletedResult>
