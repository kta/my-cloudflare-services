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

/**
 * 店頭の整理番号（「ウォークイン 005」）。**店舗 × 来店日（JST）で 1 から採り直す**。
 * 上限を 999 にしてあるのは表示が 3 桁ゼロ埋めだからで、1000 番目を採ると
 * 台帳の札が桁あふれする。台帳（`LedgerView.nextTicketNo`）と受付
 * （`Walkin.ticketNo`）が同じ境界を見るよう、値そのものをここに 1 つ置く。
 */
const TicketNo = z.number().int().min(1).max(999)

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

/** 両端を含む日数で範囲を制限する。400 日なら日差 399 までを許す。 */
const spanWithinInclusiveDays =
  (maxDays: number) =>
  (value: { from: string; to: string }): boolean =>
    spanWithinDays(maxDays - 1)(value)

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

/* ------------------------------------------------------------------------- *
 * P2 空き枠と予約台帳（`specs/glasses_management/features/005-availability-and-ledger`）
 *
 * ここに置くのは**読むための形**だけである。予約を書く経路（確定・変更・取消）は
 * `006-booking-flow` と `009-change-and-cancel` が足す。
 * お客様のお名前・来店回数は `007-customer-records`、お待ちの人数は
 * `008-reception-and-walkin` が足すので、この段階では null と 0 の器で持つ。
 * ------------------------------------------------------------------------- */

/* --- クエリの原始型 ------------------------------------------------------- */

/**
 * クエリ文字列は数値も**文字列**で届く（`?durationMinutes=60`）。`QueryFlag` と
 * 同じ理由で文字列と数値の両方を受け、境界はこのあとの `pipe` の側で見る。
 */
const QueryInteger = z.union([
  z.number(),
  z
    .string()
    .regex(/^\d{1,4}$/)
    .transform(Number),
])

/**
 * カンマ区切りの id 列（`?purposeIds=<uuid>,<uuid>`）。分解を Worker の手書きに
 * 残すと件数の上限が契約の外へ出て、6 件目が黙って通る。配列そのものも受ける。
 */
const QueryIdList = (max: number) =>
  z
    .union([
      Uuid.array(),
      z.string().transform((value) =>
        value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part !== ''),
      ),
    ])
    .pipe(Uuid.array().max(max))
    .default([])

/* --- 予約（読むだけ） ----------------------------------------------------- */

/** 業務側の予約番号。書式は 1 種類だけで、9999 を越えた月は 5 桁へ桁上げする。 */
export const ReservationCode = z.string().regex(/^EY-\d{4}-\d{4,5}$/)
export type ReservationCode = z.infer<typeof ReservationCode>

/**
 * お客様に読み上げていただく Web のご予約番号（`web_bookings.public_code`）。
 * `reservations.code` とは**別の採番系統**なので、同じ月に別々の連番が共存する。
 */
export const WebBookingCode = z.string().regex(/^EY-W-\d{4}-\d{4,5}$/)
export type WebBookingCode = z.infer<typeof WebBookingCode>

/**
 * ご予約の出どころ。**4 値**で、画面に出す語も 4 語
 * （お電話 / 店頭 / Web予約 / ウォークイン）。台帳の帯の色は 3 系統
 * （緑＝`phone`・`counter` ／ 青＝`web` ／ 茶＝`walkin`）で、緑は既定なので
 * 帯に語を書かない。店頭で先の日時を伺った `counter` と、予約なしでいらした
 * `walkin` は業務上まったく別なので 1 つにまとめない。
 */
export const ReservationSource = z.enum(['phone', 'counter', 'walkin', 'web'])
export type ReservationSource = z.infer<typeof ReservationSource>

/**
 * ご予約の状態。`confirmed → arrived → serving → done` の一方向で、
 * 取消は `confirmed` からの `cancelled` / `no_show` だけ。
 */
export const ReservationStatus = z.enum([
  'confirmed',
  'arrived',
  'serving',
  'done',
  'cancelled',
  'no_show',
])
export type ReservationStatus = z.infer<typeof ReservationStatus>

/**
 * 担当・設備の押さえ。**担当が未定（`targetId` が null）でも枠は消費する**ので、
 * 未定のまま行を作る。作らないと同時受付上限の数え方が台帳とずれ、同じ時刻に
 * 上限を越えた予約が入る。
 */
export const ReservationAssignment = z
  .strictObject({
    kind: z.enum(['staff', 'equipment']),
    targetId: Uuid.nullable().default(null),
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
  })
  .refine(startsBeforeEnds, { message: '終了は開始より後にする', path: ['endsAt'] })
export type ReservationAssignment = z.infer<typeof ReservationAssignment>

/** ご用件 1 件。所要時間は**予約した時点の写し**で、あとで目的を直しても動かない。 */
export const ReservationPurposeLine = z.strictObject({
  purposeId: Uuid,
  nameInternal: z.string().trim().min(1).max(40),
  durationMinutes: DurationMinutes,
  sortOrder: z.number().int().nonnegative(),
})
export type ReservationPurposeLine = z.infer<typeof ReservationPurposeLine>

/**
 * ご予約 1 件（LEDGER-DETAIL）。お客様・注意ごと・録音は
 * `007-customer-records` と `010-recording` が足す（P2 は `customer_id` が常に NULL）。
 * ご要望・店内メモの上限は `03-data-model.md` §7.1 の列（500 文字）に合わせ、
 * 画面と同じ符号位置で数える。
 */
export const ReservationDetail = z
  .strictObject({
    id: Uuid,
    code: ReservationCode,
    storeId: Uuid,
    source: ReservationSource,
    status: ReservationStatus,
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
    durationMinutes: DurationMinutes,
    /*
     * 詳細の見出しに出るお客様（AC-CUST-25「見出しに『田中 花子 様』が出る」）。
     * 帯（`LedgerEntry`）と**同じ 2 欄**を詳細も運ぶ — 帯から開く道しか無いうちは
     * 画面が持ち回れるが、ご予約番号で直に開く道（`009`）が付いた瞬間に見出しが空になる。
     * お客様の付いていないご予約（ウォークインの前身）は 3 欄とも null。
     * **省略可にしてあるのは形の弱さではなく移行の都合**で、応答は必ず 3 欄を載せる。
     */
    customerId: Uuid.nullable().optional(),
    customerName: z.string().trim().max(40).nullable().optional(),
    visitCount: z.number().int().nonnegative().nullable().optional(),
    // **読む側の下限は 0 件にする。**「1 予約に 1 件以上」（`03-data-model.md` §7.2）と
    // 「`kind='staff'` はちょうど 1 行」（§7.3）は**書く側の不変条件**で、D1 には CHECK が無い。
    // 読む側で 1 件以上を強いると、行が 1 本欠けただけでご予約 1 件の詳細が
    // まるごと 500 になり、受付は原因も分からないまま行き止まる（画面は欠けを本文で言える）。
    purposes: ReservationPurposeLine.array().max(5),
    // `kind='staff'` はちょうど 1 本（未定でも作る）、`kind='equipment'` は 0〜5 本。
    assignments: ReservationAssignment.array().max(6),
    webBookingCode: WebBookingCode.nullable().default(null),
    // 台帳の帯・一覧は `name_short`、詳細・復唱・受付は `name_internal` を出す。
    purposeLabel: z.string().trim().max(30),
    purposeLabelInternal: z.string().trim().max(220),
    noteCustomer: z.string().refine(codePointsAtMost(500)).default(''),
    noteInternal: z.string().refine(codePointsAtMost(500)).default(''),
    version: Version,
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
    createdBy: Uuid.nullable().default(null),
    cancelledAt: IsoDateTime.nullable().default(null),
    // CHANGE-CANCEL の 4 択。取消の入力そのものは `009-change-and-cancel` が足す。
    cancelReason: z.enum(['customer', 'store', 'duplicate', 'no_show']).nullable().default(null),
  })
  .refine(startsBeforeEnds, { message: '終了は開始より後にする', path: ['endsAt'] })
  .refine((value) => (value.webBookingCode !== null) === (value.source === 'web'), {
    // Web のご予約番号はお客様が読み上げる番号なので、Web から入った予約は必ず持ち、
    // お電話・店頭・ウォークインの予約は決して持たない。
    message: 'Web のご予約番号は source が web のときだけ持つ',
    path: ['webBookingCode'],
  })
export type ReservationDetail = z.infer<typeof ReservationDetail>

/** 一覧・検索結果の 1 行。`staffName` が null の行は「決めてください」と描く。 */
export const ReservationSummary = z.strictObject({
  id: Uuid,
  code: ReservationCode,
  startsAt: IsoDateTime,
  durationMinutes: DurationMinutes,
  status: ReservationStatus,
  source: ReservationSource,
  customerName: z.string().trim().max(40).nullable().default(null),
  visitCount: z.number().int().nonnegative().nullable().default(null),
  purposeLabel: z.string().trim().max(30),
  staffName: z.string().trim().max(40).nullable().default(null),
})
export type ReservationSummary = z.infer<typeof ReservationSummary>

/* --- 台帳 ----------------------------------------------------------------- */

/**
 * 台帳の並べ方。**URL のクエリに乗る語は `resource`** であって `equipment` ではない
 * （応答の中の `LedgerLane.kind` の `equipment` とは別の語彙である）。
 */
export const LedgerAxis = z.enum(['staff', 'resource'])
export type LedgerAxis = z.infer<typeof LedgerAxis>

/**
 * 表示のかたち。並べ方（`axis`）とは**別のセグメント**で、4 通りすべてが有効な
 * 組み合わせである。1 つの enum にまとめると、予約リストへ切り替えたときに
 * 設備・場所の並べ方が失われてタイムテーブルへ戻れなくなる。
 */
export const LedgerViewMode = z.enum(['timetable', 'list'])
export type LedgerViewMode = z.infer<typeof LedgerViewMode>

/** 予約リストの絞り込み。語は `pending`（`pending_review` ではない）。 */
export const LedgerFilter = z.enum(['all', 'upcoming', 'pending'])
export type LedgerFilter = z.infer<typeof LedgerFilter>

/** 台帳の取得。日付を移すたびに取り直す（先読みしない）。 */
export const LedgerQuery = z.strictObject({
  storeId: Uuid,
  date: LocalDate,
  axis: LedgerAxis.default('staff'),
  view: LedgerViewMode.default('timetable'),
  filter: LedgerFilter.default('all'),
})
export type LedgerQuery = z.infer<typeof LedgerQuery>

/**
 * 台帳の帯 1 本。`purposeLabel` は `visit_purposes.name_short`（1〜5 文字）を
 * 「・」で連ねたもので、目的は最大 5 件なので 29 文字に収まる。
 * お名前と来店回数は `007-customer-records` が入れるまで null のままである。
 */
export const LedgerEntry = z
  .strictObject({
    reservationId: Uuid,
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
    customerName: z.string().trim().max(40).nullable().default(null),
    visitCount: z.number().int().nonnegative().nullable().default(null),
    purposeLabel: z.string().trim().max(30),
    source: ReservationSource,
    status: ReservationStatus,
    isUnassigned: z.boolean().default(false),
  })
  .refine(startsBeforeEnds, { message: '終了は開始より後にする', path: ['endsAt'] })
export type LedgerEntry = z.infer<typeof LedgerEntry>

/**
 * 埋まっている帯。休憩（`staff_shifts.kind='break'`）・点検
 * （`equipment_maintenance`）・受付を止めた帯（`store_blackout_windows` と
 * 臨時休業）の 3 つを同じ器で描く。
 */
export const LedgerBlock = z
  .strictObject({
    kind: z.enum(['break', 'maintenance', 'closed']),
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
    label: z.string().trim().max(30).default(''),
  })
  .refine(startsBeforeEnds, { message: '終了は開始より後にする', path: ['endsAt'] })
export type LedgerBlock = z.infer<typeof LedgerBlock>

/**
 * 台帳の 1 行。「担当が未定」と「ご来店お待ち」は担当者でも設備でもない擬似行なので
 * `id` を持たない。お待ちの人数（「2名」）は `subtitle` に載せる
 * （`walk_ins` は `008-reception-and-walkin` が足すので P2 は常に「0名」）。
 */
export const LedgerLane = z.strictObject({
  kind: z.enum(['staff', 'equipment', 'unassigned', 'walkin']),
  id: Uuid.nullable(),
  name: z.string().trim().min(1).max(40),
  subtitle: z.string().trim().max(40).default(''),
  entries: LedgerEntry.array().default([]),
  blocks: LedgerBlock.array().default([]),
})
export type LedgerLane = z.infer<typeof LedgerLane>

/**
 * 台帳の応答。`serverNow` は**現在時刻の線と札の出どころ**なので必ず載せる
 * （端末の時計がずれると台帳が嘘をつくため、iPad の時計は読まない）。
 *
 * **受け付けを止めた日は 3 通りとも同じ形で返す**（定休日・臨時休業・店舗まるごとの
 * 受付停止）。`opensAt` と `closesAt` を null にし、`lanes` と `counts` を空にする。
 * 画面は目盛りだけの空の格子を出さず「◯月◯日（◯）は定休日です。」と日付を戻す操作を
 * 1 つ出す（AC-LEDGER-22）。`LedgerBlock(kind='closed')` はその日の**一部**を閉じる
 * ときのための器で、丸一日を閉じるのに帯は使わない。
 */
export const LedgerView = z.strictObject({
  date: LocalDate,
  axis: LedgerAxis,
  view: LedgerViewMode,
  opensAt: LocalTime.nullable(),
  closesAt: LocalTime.nullable(),
  slotMinutes: z.number().int().min(5).max(60),
  lanes: LedgerLane.array().default([]),
  // LEDGER-LIST の絞り込みの札（「すべて 12件／これから 7件／確認待ち 1件」）。
  counts: z.strictObject({
    all: z.number().int().nonnegative(),
    upcoming: z.number().int().nonnegative(),
    pendingReview: z.number().int().nonnegative(),
  }),
  /*
   * LEDGER-WALKIN の受付パネルが props で受ける 3 欄（`008-reception-and-walkin` T-002）。
   * **画面がこのために API を 1 本増やさない**ので台帳の応答に載せる。
   * `walkinWaitingCount` は当日（JST）の `walk_ins.status='waiting'` の件数、
   * `nextTicketNo` は「ウォークイン 005」の 005 で、どちらも欠けると受付パネルが
   * 開いた瞬間に何も言えない（人数も番号も端末側では出せない）。
   */
  walkinWaitingCount: z.number().int().nonnegative(),
  /*
   * 「目安 15分」。**空き枠エンジンが返す「次に空く時刻 − 現在時刻」だけ**から出し、
   * 出せないときは null にする（待ち人数の掛け算で作らない）。お客様に口で伝える
   * 約束になる数字なので、担当の空きを見ていない値を載せる欄をここに作らない。
   */
  estimatedWaitMinutes: z.number().int().nonnegative().nullable().default(null),
  nextTicketNo: TicketNo,
  serverNow: IsoDateTime,
})
export type LedgerView = z.infer<typeof LedgerView>

/* --- 空き枠 --------------------------------------------------------------- */

/** 業務側の空き枠の取得。8 条件をすべて掛けた結果を返す。 */
export const AvailabilityQuery = z.strictObject({
  storeId: Uuid,
  date: LocalDate,
  purposeIds: QueryIdList(5),
  durationMinutes: QueryInteger.pipe(DurationMinutes).optional(),
  staffId: Uuid.optional(),
  equipmentIds: QueryIdList(5),
  // 変更のとき自分自身を塞がりに数えない。
  excludeReservationId: Uuid.optional(),
  // 自分の受付が置いた仮の押さえを塞がりに数えない（自分の押さえで戻れなくなる）。
  excludeReceptionSessionId: Uuid.optional(),
  axis: LedgerAxis.default('staff'),
})
export type AvailabilityQuery = z.infer<typeof AvailabilityQuery>

/**
 * 置けない理由。**判定に使った理由を必ず添える**（BOOK-02b が
 * 「視力測定機が 11:30 から点検です。」と理由を出すため）。
 * `web_window` と `lead_time` は Web 予約（`011-web-booking`）だけが使う。
 */
export const AvailabilityReason = z.enum([
  'closed',
  'outside_hours',
  'break',
  'maintenance',
  'staff_busy',
  'staff_off',
  // 使える台はあるが、その時間はすべて埋まっている。
  'equipment_busy',
  // その種別の設備・場所が**この店舗に 1 台も無い**（未登録、または全台を止めている）。
  // `equipment_busy` と分けるのは、BOOK-02b が理由をそのまま文にする面だからである
  // （「視力測定機がすべて埋まっています」と「1 台も使える機械がありません」は別の話で、
  // 前者は時間をずらせば取れ、後者は設定を直すまで何時でも取れない）。
  'no_equipment',
  'no_skill',
  'max_parallel',
  'web_window',
  'lead_time',
])
export type AvailabilityReason = z.infer<typeof AvailabilityReason>

/**
 * **応答まるごとに掛かる理由**。枠ごとの `AvailabilityReason`（12 値）に、
 * ご用件そのものをお受けできないこと（無い目的・止めた目的・他店舗の目的）だけを
 * 足した語彙である。`04-api.md` §3.6 の「`store_closed` / `purpose_unavailable` は
 * **200 の応答本文で `slots: []` + `reason`** を返すのが既定」を満たすために置く。
 * 枠ごとの理由に混ぜないのは、`purpose_unavailable` が枠の性質ではなく
 * 求めそのものの性質だからである。
 */
export const AvailabilityBlockReason = z.enum([
  ...AvailabilityReason.options,
  'purpose_unavailable',
])
export type AvailabilityBlockReason = z.infer<typeof AvailabilityBlockReason>

/** 枠 1 つ。`remaining` は「あと N枠」で、0 は「満席」と描く。 */
export const AvailabilitySlot = z
  .strictObject({
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
    remaining: z.number().int().nonnegative(),
    isAvailable: z.boolean(),
    staffIds: Uuid.array().default([]),
    equipmentIds: Uuid.array().default([]),
    reason: AvailabilityReason.nullable().default(null),
  })
  .refine(startsBeforeEnds, { message: '終了は開始より後にする', path: ['endsAt'] })
export type AvailabilitySlot = z.infer<typeof AvailabilitySlot>

/** 担当軸・設備軸の 1 行。担当が未定のレーンは `id` を持たない。 */
export const AvailabilityLane = z.strictObject({
  kind: z.enum(['staff', 'equipment', 'unassigned']),
  id: Uuid.nullable(),
  name: z.string().trim().min(1).max(40),
  subtitle: z.string().trim().max(40).default(''),
  slots: AvailabilitySlot.array().default([]),
})
export type AvailabilityLane = z.infer<typeof AvailabilityLane>

/**
 * 空き枠の応答。定休日・受けられないご用件は **200 で `slots: []` + 理由**を返す
 * （409 を返すのは営業日でないと分かった状態で予約を確定しようとしたときだけ）。
 * `alternatives` は BOOK-CONFLICT が出す代わりの時刻で、3 件までに閉じる
 * （4 つ目を出しても画面に置き場が無い）。
 */
export const AvailabilityResponse = z.strictObject({
  date: LocalDate,
  opensAt: LocalTime.nullable(),
  closesAt: LocalTime.nullable(),
  isClosed: z.boolean(),
  slotMinutes: z.number().int().min(5).max(60),
  cleanupMinutes: z.number().int().min(0).max(60),
  durationMinutes: DurationMinutes,
  slots: AvailabilitySlot.array().default([]),
  lanes: AvailabilityLane.array().default([]),
  alternatives: AvailabilitySlot.array().max(3).default([]),
  // その日ぜんぶが同じ理由で落ちているときだけ載る（定休日は `closed`、
  // お受けできないご用件は `purpose_unavailable`）。置ける枠が 1 つでもあれば null。
  reason: AvailabilityBlockReason.nullable().default(null),
  serverNow: IsoDateTime,
})
export type AvailabilityResponse = z.infer<typeof AvailabilityResponse>

/* ------------------------------------------------------------------------- *
 * P3 電話・店頭からの予約受付（`specs/glasses_management/features/006-booking-flow`）
 *
 * ここに置くのは**書くための形**である。読む側（`ReservationDetail` / 台帳 /
 * 空き枠）は P2 が持っているのでそのまま使い、同じ形を二度作らない。
 *
 * お客様の台帳（`customers`）は P4（`007-customer-records`）が作った。新規のお客様は
 * `POST /api/staff/customers`（`CustomerCreate`）で先に登録し、返る id をここへ渡す
 * 2 段構えにしたので、この面に `customerDraft`（登録と確定を 1 本にまとめる欄）は足さない
 * — 確定の 1 バッチに新規登録まで混ぜると、枠が取れずに確定が失敗したときの巻き戻しが
 * 「予約」と「お客様」の 2 つの資源にまたがってしまう。
 * 伺ったお名前・お電話番号は `reception_sessions.draft_json`（下）に打ちかけの文字として置く。
 * ------------------------------------------------------------------------- */

/* --- 予約の確定 ----------------------------------------------------------- */

/**
 * ご予約の確定（BOOK-05-CONFIRM「復唱を終えて予約を確定する」）。
 * `Idempotency-Key` ヘッダーと合わせて 1 回だけ効かせる（`04-api.md` §6.1）。
 *
 * `durationMinutes` を省いたときは目的の合計を使う。**目的の合計とは限らない**ので
 * 欄そのものを消さない（「お取りする時間」で 60 分の用件を 90 分押さえられる）。
 */
export const StaffReservationCreate = z
  .strictObject({
    storeId: Uuid,
    startsAt: IsoDateTime,
    purposeIds: Uuid.array().min(1).max(5),
    durationMinutes: DurationMinutes.optional(),
    // **null（＝「担当はあとで決める」を押した）と、欄が無い（＝まだ伺っていない）を分ける。**
    // 既定値で null に潰すと、押していない端末の本文が「あとで決める」に化ける。
    // どちらでも枠は消費するので `reservation_assignments` の行は作る。
    staffId: Uuid.nullable().optional(),
    equipmentIds: Uuid.array().max(5).default([]),
    // 新規のお客様は先に `POST /api/staff/customers`（`CustomerCreate`）で登録し、
    // 返った id をここへ渡す（`customerDraft` は足さない。上のコメント参照）。
    customerId: Uuid.optional(),
    noteCustomer: z.string().refine(codePointsAtMost(500)).default(''),
    noteInternal: z.string().refine(codePointsAtMost(500)).default(''),
    source: ReservationSource,
    // 仮の押さえは表示のためだけの仕組みなので任意。期限切れの `holdId` でも確定は止めない
    // （`04-api.md` §6.3）。枠が取れるかどうかは確定のバッチの中だけで決まる。
    holdId: Uuid.optional(),
    receptionSessionId: Uuid.optional(),
  })
  // **同じ id を 2 回受けない。**確定は受け取った並びのぶんだけ
  // `reservation_purposes` / `reservation_assignments` / `reservation_slot_locks` を積むので、
  // 同じ設備を 2 回送るとその設備の空きが 1 予約で 2 つ減り、同じ目的を 2 回送ると
  // 所要が倍になって復唱の文にも二度出る（実測: 設備の占有行が 5 → 10 行）。
  // 落とす場所は D1 ではなくここにする（`reservation_slot_locks` に一意 index は無い）。
  .refine((value) => noDuplicates(value.purposeIds), {
    message: '同じ目的を 2 回選ばない',
    path: ['purposeIds'],
  })
  .refine((value) => noDuplicates(value.equipmentIds), {
    message: '同じ設備を 2 回選ばない',
    path: ['equipmentIds'],
  })
export type StaffReservationCreate = z.infer<typeof StaffReservationCreate>

/* --- 枠の仮の押さえ（KV） ------------------------------------------------- */

/**
 * 枠の仮の押さえ（`POST /api/staff/holds`）。**排他ではない**ので常に 200 が返り、
 * 409 `slot_taken` を返さない（KV に CAS が無く「取れなかった」を判定できない）。
 *
 * `receptionSessionId` を運ぶのは、空き枠エンジンが**同じ受付が置いた押さえを塞がりに
 * 数えない**ため（`AvailabilityQuery.excludeReceptionSessionId`）。これが無いと
 * 11:00 に置いてから 11:30 へ動かしたとき、11:00 が 7 分間だれにも取れなくなる。
 */
export const HoldInput = z
  .strictObject({
    storeId: Uuid,
    startsAt: IsoDateTime,
    durationMinutes: DurationMinutes,
    // 担当も設備も決まっていない工程 3 の途中でも押さえられる（未定の枠を押さえる）。
    // ここは「まだ伺っていない」と「あとで決める」を分ける必要が無いので null に寄せる。
    staffId: Uuid.nullable().default(null),
    equipmentIds: Uuid.array().max(5).default([]),
    receptionSessionId: Uuid.nullable().default(null),
  })
  // 押さえも 1 台につき 1 レーンへ展開するので、同じ設備を 2 回送るとその設備が
  // 1 つの押さえで 2 つ塞がって見える（確定と同じ数え方をここでも守る）。
  .refine((value) => noDuplicates(value.equipmentIds), {
    message: '同じ設備を 2 回選ばない',
    path: ['equipmentIds'],
  })
export type HoldInput = z.infer<typeof HoldInput>

/**
 * 押さえ 1 本。TTL は **420 秒**（BOOK-05-CONFIRM の statusbar `11:11` と
 * 「仮の押さえ → 11:18 まで」の差）。`expiresAt` を必ず載せるので、画面は残り時間を
 * 別の呼び出しで聞き直さずに数えられる（端末の時計ではなくこの値で数える）。
 * 延長の API は作らない。取り直しは `DELETE` → `POST` の 2 本で足りる。
 */
export const Hold = z
  .strictObject({
    id: Uuid,
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
    expiresAt: IsoDateTime,
    staffId: Uuid.nullable().default(null),
    equipmentIds: Uuid.array().max(5).default([]),
    receptionSessionId: Uuid.nullable().default(null),
  })
  .refine(startsBeforeEnds, { message: '終了は開始より後にする', path: ['endsAt'] })
export type Hold = z.infer<typeof Hold>

/* --- 受付セッション（5 工程の下書き） ------------------------------------- */

/** 受付の結果。進行中は null で、行は破棄でも残す（`03-data-model.md` §8.1）。 */
const ReceptionSessionOutcome = z.enum(['booked', 'discarded'])

/** 受付を始める（「新しい予約を取る」）。始めた時点では店舗しか決まっていない。 */
export const ReceptionSessionStart = z.strictObject({ storeId: Uuid })
export type ReceptionSessionStart = z.infer<typeof ReceptionSessionStart>

/**
 * 5 工程で伺った内容の下書き（`reception_sessions.draft_json`）。
 * 端末のメモリだけに持たない — iPadOS の Safari は裏に回ったタブを容易に破棄し、
 * 戻ると読み込み直すので、伺った内容が丸ごと消える。
 *
 * **持てるのは選んだ id と打ちかけの文字だけ**である。確定したお客様のお名前・
 * お電話番号そのものを持つ欄を作らない（`07-nfr.md` §6.6）。`nameTyped` /
 * `phoneTyped` は工程 4 で打っている**途中の文字**で、お客様を指す値ではない
 * （台帳と結びつけるのは P4）。
 */
export const ReceptionSessionDraft = z.strictObject({
  purposeIds: Uuid.array().max(5).default([]),
  staffId: Uuid.nullable().default(null),
  equipmentIds: Uuid.array().max(5).default([]),
  startsAt: IsoDateTime.nullable().default(null),
  durationMinutes: DurationMinutes.nullable().default(null),
  customerId: Uuid.nullable().default(null),
  phoneTyped: z.string().trim().max(20).default(''),
  nameTyped: z.string().trim().max(40).default(''),
  kanaTyped: z.string().trim().max(40).default(''),
  noteTyped: z.string().refine(codePointsAtMost(500)).default(''),
  // 手書きは R2 に置き、ここには鍵だけを持つ（1 枚 3〜12KB を D1 に積むと、
  // 5 枚 × 5,000 顧客で 500MB の 6 割を手書きが占める）。1 受付 5 枚まで。
  // 鍵は `notes/{organizationId}/sessions/{receptionSessionId}/{noteId}.svg`。
  handwritingKeys: z.string().trim().min(1).max(200).array().max(5).default([]),
  // 「まだ入力中です」で仮の押さえを取り直した回数（Q-06 のいまの前提は 10 回まで）。
  // **端末の state だけに持たない。**下書きをサーバに置いた理由（iPadOS の Safari は
  // 裏に回ったタブを容易に捨てる）が、そのまま上限の抜け道になる — タブを読み込み
  // 直すたびに 0 に戻り、いくらでも押さえ続けられる。上限そのものは Worker が数える
  // （`POST /api/staff/holds` が 409 `renew_limit`）。
  holdRenewals: z.number().int().nonnegative().default(0),
})
export type ReceptionSessionDraft = z.infer<typeof ReceptionSessionDraft>

/**
 * 下書きの保存（`PATCH /api/staff/reception-sessions/:sessionId`）。
 * **欄ごとの差分ではなく下書きまるごと 1 つ**を送る。差分にすると「この欄を消した」と
 * 「この欄は触っていない」が同じ形になり、工程を戻ったときに選び直しが消えるか残るかが
 * 端末ごとに変わる。画面は 5 工程ぶんを手元に持っているので、丸ごと送れる。
 */
export const ReceptionSessionDraftPatch = z.strictObject({ draft: ReceptionSessionDraft })
export type ReceptionSessionDraftPatch = z.infer<typeof ReceptionSessionDraftPatch>

/**
 * 受付 1 件。進行中は `outcome` も `endedAt` も null で、`draft` だけが載る。
 *
 * §8.1 の 3 つの不変条件（`outcome` と `endedAt` を同じ UPDATE で書く／`booked` なら
 * `reservationId` が非 NULL／終わった受付の `draft` は NULL）は**書く側で守る**。
 * 読む側で強いると、1 列が食い違っただけで「受けかけのご予約」からの復帰が丸ごと
 * 500 になり、伺った内容へ戻る道が無くなる（`ReservationDetail.purposes` の 0 件と同じ考え方）。
 */
export const ReceptionSession = z.strictObject({
  id: Uuid,
  storeId: Uuid,
  reservationId: Uuid.nullable().default(null),
  // 端末は P10（`013-terminal-and-audit`）まで常に null。
  terminalId: Uuid.nullable().default(null),
  // 共有モードで個人が未確認なら null。
  actorId: Uuid.nullable().default(null),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.nullable().default(null),
  outcome: ReceptionSessionOutcome.nullable().default(null),
  draft: ReceptionSessionDraft.nullable().default(null),
  createdAt: IsoDateTime,
})
export type ReceptionSession = z.infer<typeof ReceptionSession>

/**
 * 受付を閉じる（`POST /api/staff/reception-sessions/:sessionId/close`）。
 * **`discarded` しか受けない。**成立（`booked`）は確定の 1 バッチが書く値なので、
 * 端末から送れると、予約の無い受付を成立として残せてしまう。
 * 「あとで続ける」はこのルートを通らない（進行中のまま残し、押さえだけ解放する）。
 */
export const ReceptionSessionClose = z.strictObject({ outcome: z.literal('discarded') })
export type ReceptionSessionClose = z.infer<typeof ReceptionSessionClose>

/* ------------------------------------------------------------------------- *
 * P4 顧客台帳（`specs/glasses_management/features/007-customer-records`）
 *
 * お客様を「探す・特定する・思い出す」ところの入出力。**電話番号の引き方は 2 本立て**で、
 * 台帳と受付は下 4 桁の完全一致（`PhoneSuffix` → `customers.phone_last4`）、予約の工程は
 * 正規化した番号の前方一致（`PhoneNormalized` → `customers.phone_normalized`）である。
 * 後方一致は B-tree が効かず顧客表の全走査になるので、契約の側でも欄を分けておく。
 *
 * 手書きの筆跡は R2（binding `RECORDINGS`）の `notes/{organizationId}/{customerId}/{noteId}.svg`
 * に置く。**契約に載せるのは SVG の本体だけ**で、R2 のキーも署名付き URL も返さない。
 * ------------------------------------------------------------------------- */

/* --- 原始型 --------------------------------------------------------------- */

/**
 * 打ち込まれたままのお電話番号。ハイフンも全角も受ける（数字だけへ落とすのは
 * ドメイン層の `normalizePhone`）。契約でハイフンを禁じると、受付が打ち終わる前に
 * 欄が赤くなり、お客様に伺いながら打てなくなる。
 */
export const PhoneInput = z.string().trim().min(10).max(20)
export type PhoneInput = z.infer<typeof PhoneInput>

/** 正規化した番号。10 桁または 11 桁で、先頭は 0。前方一致で引く側の値である。 */
export const PhoneNormalized = z.string().regex(/^0\d{9,10}$/)
export type PhoneNormalized = z.infer<typeof PhoneNormalized>

/**
 * 下 4 桁（LEDGER-WALKIN「下4桁でも探せます」）。**ちょうど 4 桁**だけを番号として扱い、
 * 3 桁も 5 桁もお名前として扱う（`customers.phone_last4` の完全一致で引く）。
 */
export const PhoneSuffix = z.string().regex(/^\d{4}$/)
export type PhoneSuffix = z.infer<typeof PhoneSuffix>

/**
 * お客様番号（CUSTOMER-DETAIL「お客様番号 G-01842」）。おまとめで失った番号は
 * 再利用しない。`reservations.code` / `recordings.code` とは別の系統である。
 */
export const CustomerNumber = z.string().regex(/^G-\d{5}$/)
export type CustomerNumber = z.infer<typeof CustomerNumber>

/** 一覧の続きを指す不透明な文字列。`(kana, id)` / `(visit_count, id)` の 2 種を包む。 */
const Cursor = z.string().min(1).max(512)

/** 一覧の 1 ページ。`QueryInteger` と同じ理由で `?limit=8` の文字列も受ける。 */
const Limit = QueryInteger.pipe(z.number().int().min(1).max(200)).default(50)

/** 0 以上の整数（件数・回数）。クエリ文字列でも本文でも同じ境界で見る。 */
const CountInteger = z.number().int().nonnegative()

/**
 * `QueryFlag` は欄そのものが無いとき `false` になる。他店で書かれた記録は既定で
 * 見せる（`03-data-model.md` §9.4）ので、既定を `true` にした同じ形をここで作る。
 */
const IncludeOtherStores = z
  .union([z.boolean(), z.enum(['true', '1', 'false', '0'])])
  .default(true)
  .transform((value) => value === true || value === 'true' || value === '1')

/* --- お客様 --------------------------------------------------------------- */

/**
 * 一覧の 1 行と、埋め込みのお客様。CUSTOMER-LIST の 4 列（お名前 / ご来店 /
 * 最後のご来店 / 覚えておくこと）がそのまま載る。
 *
 * `customerNumber` を持つのは、おまとめの下見が「まとめると、こうなります」で
 * お客様番号 G-01842 を出すからである（`CustomerMergePreview.result` はこの形）。
 * `lastVisitAt` は暦日で持つ — 来店済み（`arrived` / `serving` / `done`）の予約の
 * 最終 `starts_at` を JST の暦日へ落とした値で、0 件のお客様は null（画面は「—」）。
 */
export const CustomerSummary = z.strictObject({
  id: Uuid,
  customerNumber: CustomerNumber,
  name: z.string().trim().min(1).max(40),
  kana: z.string().trim().max(40).default(''),
  // 表示用の生文字列（`customers.phone`）は載せない。画面は数字から整形する。
  phone: PhoneNormalized.nullable().default(null),
  visitCount: CountInteger,
  lastVisitAt: LocalDate.nullable().default(null),
  // 一覧で「…」に切ってよい唯一の列。お名前・日付・番号は切らずに折り返す。
  memoShort: z.string().refine(codePointsAtMost(40)).default(''),
})
export type CustomerSummary = z.infer<typeof CustomerSummary>

/* --- 度数といまお使いのメガネ --------------------------------------------- */

/** 球面。測定機が出すのは 0.25 の格子の上だけなので、間の値を作らせない。 */
const Diopter = z.number().min(-30).max(30).multipleOf(0.25)
/** 乱視。 */
const Cylinder = z.number().min(-10).max(10).multipleOf(0.25)
/** 加入度数（遠近のみ）。 */
const AddPower = z.number().min(0).max(5).multipleOf(0.25)
/** 軸。0〜180 の整数で、181 は角度として存在しない。 */
const Axis = z.number().int().min(0).max(180)
/** 瞳孔間距離（mm）。度数と違って **0.5 刻み**である。 */
const PupillaryDistance = z.number().min(40).max(85).multipleOf(0.5)

/**
 * 度数 1 行（CUSTOMER-DETAIL「度数の移り変わり」）。**文字列で持たない** —
 * 「R -2.25 L -2.00 PD 62.0」は表示時の整形であって、保存する形ではない。
 * 片目だけ測ることも PD を測らないこともあるので、値はすべて null を取る。
 */
export const Prescription = z.strictObject({
  id: Uuid,
  // 測定日は暦日だけを持つ（時刻を持たない）。
  measuredAt: LocalDate,
  rSph: Diopter.nullable().default(null),
  lSph: Diopter.nullable().default(null),
  rCyl: Cylinder.nullable().default(null),
  lCyl: Cylinder.nullable().default(null),
  rAxis: Axis.nullable().default(null),
  lAxis: Axis.nullable().default(null),
  rAdd: AddPower.nullable().default(null),
  lAdd: AddPower.nullable().default(null),
  pd: PupillaryDistance.nullable().default(null),
  note: z.string().refine(codePointsAtMost(200)).default(''),
  // 顧客ごとにちょうど 1 行が true。古い行を false にする UPDATE は同じバッチで書く。
  isCurrent: z.boolean(),
})
export type Prescription = z.infer<typeof Prescription>

/** いまお使いのメガネ 1 本。買い替えても行は消さず `isCurrent` を落とす。 */
export const OwnedGlasses = z.strictObject({
  id: Uuid,
  purchasedAt: LocalDate,
  frameName: z.string().trim().max(60).default(''),
  lensName: z.string().trim().max(60).default(''),
  usageLabel: z.string().trim().max(30).default(''),
  note: z.string().refine(codePointsAtMost(200)).default(''),
  isCurrent: z.boolean(),
})
export type OwnedGlasses = z.infer<typeof OwnedGlasses>

/* --- メモ・注意ごと・手書き ----------------------------------------------- */

/** 種別。`attention` かつ `published` の行だけが「注意ごと N件」に数えられる。 */
const CustomerNoteKind = z.enum(['memo', 'attention'])

/** 状態。昇格の申し込みは `draft` のまま置き、承認の面（P10）が `published` へ上げる。 */
const CustomerNoteStatus = z.enum(['draft', 'published', 'hidden'])

/**
 * 筆跡そのもの。**R2 に置き、D1 には `customer_notes.handwriting_key` だけを持つ**
 * （1 枚 3〜12KB × 5 枚 × 5,000 顧客で 300MB になり、D1 の 500MB の 6 割を占める）。
 * 読み出しは Worker が R2 から取り、許可リストで再直列化してからここへ載せる。
 */
const HandwritingSvg = z.string().max(512 * 1024)

/** メモ 1 件。手書きの読み取り結果も `body` に入る（人がいつでも直せる）。 */
export const CustomerNote = z.strictObject({
  id: Uuid,
  kind: CustomerNoteKind,
  body: z.string().refine(codePointsAtMost(2000)).default(''),
  handwritingSvg: HandwritingSvg.nullable().default(null),
  authorId: Uuid.nullable().default(null),
  authorName: z.string().trim().max(40).default(''),
  revision: CountInteger,
  status: CustomerNoteStatus,
  // 書いた店舗（「丸の内店 記入 中村 彩」）。他店の 1 枚も同じ組織なら読める。
  storeId: Uuid,
  createdAt: IsoDateTime,
})
export type CustomerNote = z.infer<typeof CustomerNote>

/** メモの取得。`status` を渡さなければ絞り込まない。 */
export const CustomerNoteQuery = z.strictObject({
  kind: CustomerNoteKind.optional(),
  // クエリ文字列はカンマ区切りで届く（`?status=draft,published`）。分解を Worker の
  // 手書きに残すと、語彙の検査が契約の外へ出て知らない語が黙って通る。
  status: z
    .union([
      CustomerNoteStatus.array(),
      z.string().transform((value) =>
        value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part !== ''),
      ),
    ])
    .pipe(CustomerNoteStatus.array().max(3))
    .default([]),
  includeOtherStores: IncludeOtherStores,
})
export type CustomerNoteQuery = z.infer<typeof CustomerNoteQuery>

/**
 * メモの追加。**本文と筆跡の両方が空なら拒む** — 空の 1 件を残せると、手書きの面が
 * 「1枚」と数えたまま中身の無い行ができ、5 枚の上限もそれで埋まる。
 */
export const CustomerNoteInput = z
  .strictObject({
    kind: CustomerNoteKind,
    body: z.string().refine(codePointsAtMost(2000)).default(''),
    handwritingSvg: HandwritingSvg.nullable().default(null),
    storeId: Uuid,
  })
  .refine((value) => value.body.trim() !== '' || value.handwritingSvg !== null, {
    message: '本文か手書きのどちらかを入れる',
    path: ['body'],
  })
export type CustomerNoteInput = z.infer<typeof CustomerNoteInput>

/**
 * 読み取った文字の修正（CUSTOMER-HANDWRITE「文字を保存する」）。
 * **筆跡は書いたときのまま残す**ので、この経路に手書きの欄を置かない。
 * `published` へ上げるのも承認の面の仕事なので、状態は `draft` と `hidden` だけを許す。
 */
export const CustomerNotePatch = z.strictObject({
  revision: CountInteger,
  body: z.string().refine(codePointsAtMost(2000)).optional(),
  status: z.enum(['draft', 'hidden']).optional(),
})
export type CustomerNotePatch = z.infer<typeof CustomerNotePatch>

/**
 * 注意ごとへの申し込み（「注意ごととして登録を申し込む」）。
 * **申し込みだけでは注意ごとにならない**（`kind='attention'` / `status='draft'` で立てる）。
 * 誤読がそのまま接客の禁忌になるのを避けるため、本文は 1 文字以上を要求する。
 */
export const CustomerNotePublishInput = z.strictObject({
  revision: CountInteger,
  body: z.string().trim().min(1).refine(codePointsAtMost(2000)),
})
export type CustomerNotePublishInput = z.infer<typeof CustomerNotePublishInput>

/* --- 詳細・検索・候補 ----------------------------------------------------- */

/**
 * お客様の詳細（CUSTOMER-DETAIL）。「よくご担当した者」は列を持たず、`status='done'` の
 * 予約に紐づく担当のうち最も多い者（同数なら新しいほう）をサーバが読み出し時に決める。
 * 「注意ごと N件」も欄を持たない — `notes` の `kind='attention'` かつ
 * `status='published'` を数えれば出るので、同じ数を 2 か所に置かない。
 */
export const CustomerDetail = CustomerSummary.extend({
  email: z.string().trim().email().max(320).nullable().default(null),
  birthDate: LocalDate.nullable().default(null),
  // CUSTOMER-MERGE の「ご住所」。P4 は読むだけで、直す画面は作らない。
  address: z.string().trim().max(120).nullable().default(null),
  memo: z.string().refine(codePointsAtMost(2000)).default(''),
  firstVisitAt: LocalDate.nullable().default(null),
  frequentStaffName: z.string().trim().max(40).nullable().default(null),
  prescriptions: Prescription.array().max(20).default([]),
  glasses: OwnedGlasses.array().default([]),
  notes: CustomerNote.array().default([]),
  nextReservation: ReservationSummary.nullable().default(null),
  // 非 NULL の行は参照専用（検索からも一覧からも外れる）。
  mergedIntoId: Uuid.nullable().default(null),
  version: Version,
})
export type CustomerDetail = z.infer<typeof CustomerDetail>

/** 台帳の検索（CUSTOMER-LIST）。`OFFSET` は使わず `cursor` で続きを取る。 */
export const CustomerSearchQuery = z.strictObject({
  query: z.string().trim().max(40).optional(),
  // 並べ方は「お名前順」と「ご来店の回数順」の 2 つだけ（segmented の 2 枚）。
  sort: z.enum(['kana', 'visits']).default('kana'),
  // 絞り込みの札が持つのはご来店の回数の 4 段（初 / 1回 / 2〜4回 / 5回以上）だけ。
  visitCountMin: QueryInteger.pipe(CountInteger).optional(),
  visitCountMax: QueryInteger.pipe(CountInteger).optional(),
  lastVisitFrom: LocalDate.optional(),
  lastVisitTo: LocalDate.optional(),
  staffId: Uuid.optional(),
  limit: Limit,
  cursor: Cursor.optional(),
})
export type CustomerSearchQuery = z.infer<typeof CustomerSearchQuery>

/** 一覧の応答（`04-api.md` §1.2 の形）。`total` は「当てはまるお客様 42名」。 */
export const CustomerList = z.strictObject({
  items: CustomerSummary.array().default([]),
  nextCursor: Cursor.nullable().default(null),
  total: CountInteger,
})
export type CustomerList = z.infer<typeof CustomerList>

/**
 * お電話番号やお名前からの照会。**4 つとも空なら拒む** — 空の照会は台帳の全走査になる。
 * `phone` は正規化して `phone_normalized` の前方一致、`phoneLast4` は `phone_last4` の
 * 完全一致で、引き方そのものが違うので欄を分けてある。
 */
export const CustomerLookupQuery = z
  .strictObject({
    phone: PhoneInput.optional(),
    phoneLast4: PhoneSuffix.optional(),
    name: z.string().trim().max(40).optional(),
    kana: z.string().trim().max(40).optional(),
  })
  .refine(
    (value) =>
      [value.phone, value.phoneLast4, value.name, value.kana].some((f) => (f ?? '') !== ''),
    { message: 'お電話番号・下 4 桁・お名前・ふりがなのどれか 1 つを入れる', path: ['phone'] },
  )
export type CustomerLookupQuery = z.infer<typeof CustomerLookupQuery>

/**
 * 候補 1 件（BOOK-04b-CUSTOMER-MATCH）。**確からしさは 2 段だけ**で、全桁が一致したものが
 * `strong`（「よく一致しています」）、前方一致だけ・下 4 桁だけのものが `weak`
 * （「確かめが必要です」）。3 段目を作ると添える札の文言が無く、自動確定への逃げ道にもなる。
 * **1 件でも自動で確定しない**ので、応答は常に配列で返す。
 */
export const CustomerCandidate = z.strictObject({
  customer: CustomerSummary,
  match: z.enum(['strong', 'weak']),
  lastVisitAt: LocalDate.nullable().default(null),
  // 「お選びになると引き継がれること」の 4 項目（現在の度数 / 前回の担当 / 注意ごと / ご連絡先）。
  currentPrescription: Prescription.nullable().default(null),
  lastStaffName: z.string().trim().max(40).nullable().default(null),
  attentionSummary: z.string().refine(codePointsAtMost(60)).default(''),
})
export type CustomerCandidate = z.infer<typeof CustomerCandidate>

/** 新しいお客様の登録（CUSTOMER-NEW）。**お名前だけで登録できる。** */
export const CustomerCreate = z.strictObject({
  name: z.string().trim().min(1).max(40),
  kana: z.string().trim().max(40).optional(),
  phone: PhoneInput.optional(),
  email: z.string().trim().email().max(320).optional(),
  birthDate: LocalDate.optional(),
  memo: z.string().refine(codePointsAtMost(2000)).optional(),
})
export type CustomerCreate = z.infer<typeof CustomerCreate>

/** 更新。`version` は必須で、版だけを送る「何も変えない保存」は拒まない。 */
export const CustomerPatch = CustomerCreate.partial().extend({ version: Version })
export type CustomerPatch = z.infer<typeof CustomerPatch>

/* --- おまとめ ------------------------------------------------------------- */

/** 同じ行を両側に置かせない（残さない側に自分自身を統合先として書けてしまう）。 */
const differentCustomers = (value: { primaryId: string; secondaryId: string }): boolean =>
  value.primaryId !== value.secondaryId

/** 見比べ表の項目。CUSTOMER-MERGE が描くのはこのうち 4 つである。 */
const CustomerMergeFieldName = z.enum([
  'name',
  'kana',
  'phone',
  'email',
  'address',
  'birthDate',
  'memo',
  'notes',
])

/**
 * 項目ごとの残す側。**`'both'` は接客のメモだけ**に許す（7 + 1 = 8 件）。
 * お名前やお電話番号を 2 つ持つ行は作れないので、他の項目で `'both'` は意味を持たない。
 */
export const CustomerMergeField = z
  .strictObject({
    field: CustomerMergeFieldName,
    primaryValue: z.string().max(2000).nullable().default(null),
    secondaryValue: z.string().max(2000).nullable().default(null),
    choice: z.enum(['primary', 'secondary', 'both']),
  })
  .refine((value) => value.choice !== 'both' || value.field === 'notes', {
    message: "'both' を選べるのは接客のメモだけ",
    path: ['choice'],
  })
export type CustomerMergeField = z.infer<typeof CustomerMergeField>

/** おまとめの下見。取り消せない操作の前に、まとめたあとの姿と失う番号を読ませる。 */
export const CustomerMergePreviewRequest = z
  .strictObject({ primaryId: Uuid, secondaryId: Uuid })
  .refine(differentCustomers, { message: '同じお客様どうしはまとめない', path: ['secondaryId'] })
export type CustomerMergePreviewRequest = z.infer<typeof CustomerMergePreviewRequest>

/** 下見の中身。`losingCustomerNumber` は「G-02310 は使えなくなります。」の番号。 */
export const CustomerMergePreview = z.strictObject({
  fields: CustomerMergeField.array().max(8).default([]),
  result: CustomerSummary,
  noteCount: CountInteger,
  losingCustomerNumber: CustomerNumber,
})
export type CustomerMergePreview = z.infer<typeof CustomerMergePreview>

/**
 * おまとめの実行。**両側の `version` を要求する** — 下見のあとに片方へ新しい予約が
 * 入っていたら拒み、下見からやり直させる（AC-CUST-15）。下見と同じ守りをここにも掛ける。
 */
export const CustomerMergeInput = z
  .strictObject({
    primaryId: Uuid,
    secondaryId: Uuid,
    primaryVersion: Version,
    secondaryVersion: Version,
    fields: CustomerMergeField.array().max(8).default([]),
  })
  .refine(differentCustomers, { message: '同じお客様どうしはまとめない', path: ['secondaryId'] })
export type CustomerMergeInput = z.infer<typeof CustomerMergeInput>

/** 実行の結果。残さない側の行は消さず、`mergedIntoId` を書いて参照専用にする。 */
export const CustomerMergeResult = z.strictObject({
  customer: CustomerDetail,
  mergedId: Uuid,
  movedReservations: CountInteger,
  movedNotes: CountInteger,
})
export type CustomerMergeResult = z.infer<typeof CustomerMergeResult>

/* ------------------------------------------------------------------------- *
 * P5 来店受付とウォークイン（`specs/glasses_management/features/008-reception-and-walkin`）
 *
 * お客様が店に着いてから帰るまで。**顧客未特定のまま受付と接客を始められる**ことが
 * この一式の芯で、`customerId` は最後まで `null` を許す（あとから紐づける）。
 *
 * 記録は 2 系統ある。`walk_ins` は「予約なしのご来店 1 件」の**いまの姿**（列を書き換える。
 * だから `version` を持つ）、`visit_events` は「工程が動いた事実」の**追記だけの並び**
 * （行を書き換えないので版を持たない）である。盤面（`VisitBoard`）は後者から毎回組み立てる。
 *
 * 待ち時間・お待たせの判定は列に持たない。`serverNow − arrivedAt` を応答の側で出す
 * （端末の時計を読ませない。`Walkin.waitedMinutes` / `VisitBoard.serverNow`）。
 * ------------------------------------------------------------------------- */

/* --- クエリの原始型 ------------------------------------------------------- */

/**
 * カンマ区切りの語の列（`?status=waiting,serving`）。`QueryIdList` と同じ理由で
 * 分解を Worker の手書きに残さない（知らない語がそこで黙って落ち、絞り込みが
 * 効いていないのに 200 が返る）。配列そのものも受ける。
 */
const QueryWordList = <S extends z.ZodType<string, string>>(word: S, max: number) =>
  z
    .union([
      z.array(word),
      z.string().transform((value) =>
        value
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part !== ''),
      ),
    ])
    .pipe(z.array(word).max(max))
    .default([])

/* --- ウォークイン --------------------------------------------------------- */

/**
 * 予約なしのご来店の状態（`03-data-model.md` §7.4）。**4 語**で、`visit_events.stage` の
 * 写しではない（「先の日時のご予約に振り替えたか」は工程が持たない軸である）。
 *
 * `waiting` から直接 `left` になった行が「待ちきれずお帰りになった」件数で、
 * これを `left` の 1 語に潰すと ANALYTICS-WAIT の母数から落ち、待ち時間が実態より
 * 必ず良い側に出る。
 */
const WalkinStatus = z.enum(['waiting', 'serving', 'booked', 'left'])

/**
 * 4 択に無いご用件の自由記述（LEDGER-STAFF の「フレームの相談」）。
 * 上限は **80 文字**で、`walk_ins.purpose_note` の列がこれを収める。
 */
const PurposeNote = z.string().trim().min(1).max(80)

/**
 * ご用件は**ちょうど一方**だけを受ける。4 択から選んだなら `purposeId`、
 * 4 択に無いご用件なら `purposeNote` である。両方を許すと台帳の帯に出す語が
 * 2 つになり、どちらを出すかが画面ごとに割れる。どちらも無いと、受け付けたあとに
 * 「何のご用件で来られたか」を誰も答えられない受付が残る。
 */
const exactlyOnePurpose = (
  value: { purposeId?: string; purposeNote?: string },
  ctx: z.RefinementCtx,
): void => {
  const chosen = value.purposeId !== undefined
  const written = value.purposeNote !== undefined
  if (chosen === written) {
    ctx.addIssue({
      code: 'custom',
      message: 'ご用件は 4 択から選ぶか、自由記述で書くかのどちらか一方にする',
      path: ['purposeId'],
    })
  }
}

/**
 * 店頭の受け付け（`POST /api/staff/walkins`。LEDGER-WALKIN「受付して台帳に載せる」）。
 *
 * **整理番号を受け取らない。**同時に 2 台の iPad から受け付けると、クライアントが
 * 採った番号はそのまま重複する。採番は店舗 × 来店日でサーバが行う。
 *
 * `staffId` は `null`（「担当を決めずに受け付ける」）と欄が無い（まだ伺っていない）を
 * 分ける（`StaffReservationCreate` と同じ扱い）。`startsAt` / `durationMinutes` は
 * LEDGER-WALKIN が台帳に点線で描く「ここに入ります 11:30–12:30」で、省略時は
 * `arrivedAt` とご用件の所要から決める。`arrivedAt` の省略はサーバ時刻で埋める。
 */
export const WalkinCreate = z
  .strictObject({
    storeId: Uuid,
    purposeId: Uuid.optional(),
    purposeNote: PurposeNote.optional(),
    customerId: Uuid.optional(),
    staffId: Uuid.nullable().optional(),
    startsAt: IsoDateTime.optional(),
    durationMinutes: DurationMinutes.optional(),
    arrivedAt: IsoDateTime.optional(),
  })
  .superRefine(exactlyOnePurpose)
export type WalkinCreate = z.infer<typeof WalkinCreate>

/**
 * 予約なしのご来店 1 件。
 *
 * `reservationId` が**必ず**入るのは、受付と同時に `source='walkin'` の予約を 1 件
 * 起こすからである（`03-data-model.md` §7.4）。起こさないと LEDGER-WALKIN が
 * 「ここに入ります」と描いた枠が空き枠エンジンから見て空いたままになり、同じ瞬間に
 * お電話のご予約が同じ担当を取れてしまう。
 *
 * `waitedMinutes` は列ではなく `serverNow − arrivedAt` を分へ切り捨てた値である。
 * **読む側でご用件の排他を強いない** — 1 列が食い違っただけで待ちの帯がまるごと
 * 500 になり、目の前のお客様が画面から消える（書く側の不変条件として守る）。
 */
export const Walkin = z.strictObject({
  id: Uuid,
  ticketNo: TicketNo,
  arrivedAt: IsoDateTime,
  purposeId: Uuid.nullable().default(null),
  purposeNote: z.string().trim().max(80).nullable().default(null),
  customerId: Uuid.nullable().default(null),
  reservationId: Uuid,
  status: WalkinStatus,
  waitedMinutes: z.number().int().nonnegative(),
  leftAt: IsoDateTime.nullable().default(null),
  version: Version,
})
export type Walkin = z.infer<typeof Walkin>

/**
 * 受け付けたあとの更新（`PATCH /api/staff/walkins/:walkinId`）。
 * 顧客の紐づけと担当決めを 2 台の iPad が同時に触るので `version` を必須にする。
 * 整理番号・受付時刻・ご用件はここから動かせない（受け付けた事実を書き換えない）。
 */
export const WalkinPatch = z.strictObject({
  version: Version,
  customerId: Uuid.optional(),
  // 「あとで決める」へ戻せるので null も受ける。
  staffId: Uuid.nullable().optional(),
  status: WalkinStatus.optional(),
  reservationId: Uuid.optional(),
})
export type WalkinPatch = z.infer<typeof WalkinPatch>

/**
 * 待ちの一覧（`GET /api/staff/walkins`）。**`date` は必須**である。
 * 日付の条件を落とすと、昨日帰られたお客様が今朝の待ち行列に残り、
 * 「いまお待ち N名」も `LedgerView.estimatedWaitMinutes` も一緒に狂う。
 */
export const WalkinListQuery = z.strictObject({
  storeId: Uuid,
  date: LocalDate,
  status: QueryWordList(WalkinStatus, 4),
})
export type WalkinListQuery = z.infer<typeof WalkinListQuery>

/** 台帳の最下段の帯 1 本（LEDGER-STAFF「ウォークイン 004　受付 11:02　お待ち 6分」）。 */
export const WalkinSummary = z.strictObject({
  id: Uuid,
  ticketNo: TicketNo,
  arrivedAt: IsoDateTime,
  waitedMinutes: z.number().int().nonnegative(),
  purposeNote: z.string().trim().max(80).nullable().default(null),
  status: WalkinStatus,
})
export type WalkinSummary = z.infer<typeof WalkinSummary>

/* --- 来店受付ボード ------------------------------------------------------- */

/**
 * 店内の工程（`03-data-model.md` §7.5）。**8 語**で、`left` は退店、`waiting` は
 * 工程と工程の間のお待たせを指し、この 2 つは盤面の列を持たない。
 *
 * **この宣言順は画面の並びではない。**RECEPTION-JOURNEY の 6 列は
 * 受付 → ご相談 → フレーム選び → 視力測定 → レンズ・お会計 → お渡し の順で、
 * 列は UI 側の定数（`BOARD_STAGES`）から作る。宣言順から作ると列が入れ替わる。
 */
export const VisitStage = z.enum([
  'received',
  'waiting',
  'measuring',
  'consulting',
  'fitting',
  'checkout',
  'handover',
  'left',
])
export type VisitStage = z.infer<typeof VisitStage>

/** 工程の対象。予約とウォークインの 2 系統だけで、お客様そのものは対象にしない。 */
const VisitSubjectType = z.enum(['reservation', 'walkin'])

/**
 * 工程を進める（`POST /api/staff/visits`）。**追記だけ**なので「1 件足す」形しか無い。
 * 訂正は打ち消しの行を足す（前の行を書き換える経路を契約に作らない）。
 * `occurredAt` の省略はサーバ時刻で埋める。`note` には RECEPTION-CHECKIN の
 * 消し込みの結果（確かめた行と確かめなかった行）を残す。
 */
export const VisitEventInput = z.strictObject({
  storeId: Uuid,
  subjectType: VisitSubjectType,
  subjectId: Uuid,
  stage: VisitStage,
  occurredAt: IsoDateTime.optional(),
  staffId: Uuid.optional(),
  note: z.string().trim().max(120).optional(),
})
export type VisitEventInput = z.infer<typeof VisitEventInput>

/** 追記された工程 1 件。`occurredAt` は必ず入る（省略ぶんはサーバが埋めたあとである）。 */
export const VisitEvent = z.strictObject({
  id: Uuid,
  subjectType: VisitSubjectType,
  subjectId: Uuid,
  stage: VisitStage,
  occurredAt: IsoDateTime,
  staffId: Uuid.nullable().default(null),
  note: z.string().trim().max(120).nullable().default(null),
})
export type VisitEvent = z.infer<typeof VisitEvent>

/** 盤面の取得（`GET /api/staff/visits/board`）。既定は「ご来店中」だけ。 */
export const VisitBoardQuery = z.strictObject({
  storeId: Uuid,
  date: LocalDate,
  scope: z.enum(['active', 'all']).default('active'),
})
export type VisitBoardQuery = z.infer<typeof VisitBoardQuery>

/**
 * 盤面の欄 1 つ。状態は **5 語**（済みました / 対応中 / 次にやること / お待たせ中 / 空）。
 *
 * `note` と `needsAttention` を `label` と**別に**持つのは、担当が勤務外・設備が点検中の
 * ときに色だけで伝えないためである（AC-RECEP-14 / AC-RECEP-15）。設備名と注意を
 * 1 つの文字列へ混ぜると、読み上げが「視力測定機 A」と言うべき場所で長い注意を読み、
 * 30 文字の `label` にも収まらない。文と旗は必ず揃える（片方だけの応答を通さない）。
 */
export const VisitBoardCell = z
  .strictObject({
    stage: VisitStage,
    state: z.enum(['done', 'doing', 'next', 'waiting', 'empty']),
    at: IsoDateTime.nullable().default(null),
    // 「視力測定機 A」「お待たせ中 18分」。
    label: z.string().trim().max(30).default(''),
    // 「本日はお休みです。担当を決め直してください。」「視力測定機 A は点検で止まっています。」
    note: z.string().trim().max(40).nullable().default(null),
    needsAttention: z.boolean().default(false),
  })
  .refine((cell) => cell.needsAttention === (cell.note !== null), {
    message: '注意の文を持つ欄だけが needsAttention を立てる',
    path: ['needsAttention'],
  })
  .refine(
    (cell) =>
      cell.state !== 'empty' || (cell.at === null && cell.label === '' && cell.note === null),
    {
      // 工程を飛ばした行は飛ばした列を空のまま置く。空いた欄を文字で埋めない。
      message: '空の欄は時刻も label も注意も持たない',
      path: ['state'],
    },
  )
export type VisitBoardCell = z.infer<typeof VisitBoardCell>

/**
 * 盤面の 1 行（お客様 1 人）。`displayName` は「田中 花子 様」か「ウォークイン 003」で、
 * `visitCount` はお客様が特定できていない来店では null になる（札を出さない）。
 */
export const VisitBoardRow = z.strictObject({
  subjectType: VisitSubjectType,
  subjectId: Uuid,
  displayName: z.string().trim().min(1).max(40),
  visitCount: z.number().int().nonnegative().nullable().default(null),
  purposeLabel: z.string().trim().max(30).default(''),
  cells: VisitBoardCell.array().default([]),
  isWaitingTooLong: z.boolean().default(false),
})
export type VisitBoardRow = z.infer<typeof VisitBoardRow>

/**
 * 盤面（RECEPTION-JOURNEY）。`activeCount` は**最新の工程が `left` でない行の数**で、
 * 「お渡し」に居る人も数える。`serverNow` は必ず載せる — お待たせ中の分数は
 * この値と最後の記録の差で描くので、端末の時計を読ませると iPad ごとに違う分数が出る。
 */
export const VisitBoard = z.strictObject({
  date: LocalDate,
  activeCount: z.number().int().nonnegative(),
  rows: VisitBoardRow.array().default([]),
  serverNow: IsoDateTime,
})
export type VisitBoard = z.infer<typeof VisitBoard>

/* --- 取消とご来店なし ------------------------------------------------------ */

/**
 * ご予約を取り消す／ご来店がなかったとして残す（`POST /api/staff/reservations/:reservationId/cancel`）。
 *
 * **`reason` が `no_show` のときだけ `status` が `no_show` になる**（それ以外は `cancelled`）。
 * 受付履歴の「結果」の 3 語（成立／取消／ご来店なし）はこの 1 か所でしか分岐しないので、
 * 画面が `status` を直に送る形にしない — 送れるようにすると、来ていないお客様の予約を
 * 「成立」に書き換えられる。
 *
 * `version` を必須にするのは、当日の締めを 2 台の iPad が同時に流すからである。
 * 取り消し済みの予約は版が進んでいるので、遅れて届いた 2 台目は 409 になる。
 *
 * このフェーズが要るのは `no_show` の枝（AC-RECEP-16）だけなので、欄は 2 つに絞ってある。
 * 取消の理由の言い直しやお客様への連絡は `009-change-and-cancel` が足す。
 */
export const ReservationCancelInput = z.strictObject({
  version: z.number().int().min(1),
  reason: z.enum(['customer', 'store', 'duplicate', 'no_show']),
})
export type ReservationCancelInput = z.infer<typeof ReservationCancelInput>

/* --- 受付履歴 ------------------------------------------------------------- */

/**
 * 条件を 1 つ緩めた候補（HISTORY-EMPTY「期間を「今月（8月1日 〜 8月27日）」まで広げる　12件」）。
 *
 * `count` が 1 以上なのは、押しても 0 件のままの候補を出さないためである
 * （0 件の画面から 0 件の画面へ送るのは行き止まりを 1 つ増やすだけである）。
 * `query` はそのまま再送できる形にする（画面が条件を組み立て直さない）。
 */
export const SearchRelaxation = z.strictObject({
  label: z.string().trim().min(1).max(60),
  count: z.number().int().min(1),
  query: z.record(z.string(), z.unknown()),
})
export type SearchRelaxation = z.infer<typeof SearchRelaxation>

/**
 * 受付履歴の絞り込み（`GET /api/staff/reception-sessions`。HISTORY-LIST）。
 *
 * 期間は**ご来店日**で絞る（受け付けた日ではない）。`staffId` は**接客する担当**
 * （`reservation_assignments`）で、受け付けた人（`reception_sessions.actor_id`）ではない
 * — 共有端末では NULL になり、その受付が絞り込みから丸ごと漏れる。
 *
 * 画面の「結果」3 語はここへ落とす。成立＝`confirmed,arrived,serving,done` /
 * 取消＝`cancelled` / ご来店なし＝`no_show` である（契約に新しい語を足さない）。
 * 読み足しは `cursor` で行い、`OFFSET` を使わない。
 */
export const ReceptionHistoryQuery = z
  .strictObject({
    storeId: Uuid.optional(),
    from: LocalDate,
    to: LocalDate,
    staffId: Uuid.optional(),
    // 「結果」の絞り込みは `status` の 1 本だけである。`outcome`（受付セッションの
    // 成否）をここに置かない — ルートもドメインも見ないので、`?outcome=discarded` が
    // 200 を返しながら 1 件も絞られていない、という黙って効かない絞り込みになる。
    status: QueryWordList(ReservationStatus, 6),
    name: z.string().trim().max(40).optional(),
    limit: Limit,
    cursor: Cursor.optional(),
  })
  .refine(spanWithinDays(92), { message: '一度に取れるのは 92 日まで', path: ['to'] })
export type ReceptionHistoryQuery = z.infer<typeof ReceptionHistoryQuery>

/**
 * 受付履歴の 1 行。
 *
 * **`entryId` が行の識別子**で、`reception_sessions.id` ?? `reservations.id` ?? `walk_ins.id`
 * である。`sessionId` を必須にできないのは、スタッフが受け付けない Web のご予約が
 * 受付セッションを持たないからで、必須にするとその行が一覧から丸ごと落ちる
 * （お客様からのお問い合わせに答えられない受付が出る）。
 */
export const ReceptionHistoryEntry = z.strictObject({
  entryId: Uuid,
  sessionId: Uuid.nullable().default(null),
  startedAt: IsoDateTime,
  displayName: z.string().trim().min(1).max(40),
  visitCount: z.number().int().nonnegative().nullable().default(null),
  outcome: ReceptionSessionOutcome.nullable().default(null),
  reservationStatus: ReservationStatus.nullable().default(null),
})
export type ReceptionHistoryEntry = z.infer<typeof ReceptionHistoryEntry>

/**
 * 受付履歴の一覧（`04-api.md` §1.2 の `{ items, nextCursor, total }`）。
 *
 * `relaxations` は **0 件の応答に同梱する**（追加の往復を作ると 0 件の画面がその分だけ
 * 遅れて出る）。1 件以上あるのに候補が付いた応答は落とす — 出せば「もっと広げますか」と
 * 読める操作が結果の隣に並び、いま見えている一覧が信用できなくなる。
 * 逆に 0 件でも候補が 0 件のことはある（緩められる条件が無い／全解除しても 0 件）。
 */
export const ReceptionHistoryList = z
  .strictObject({
    items: ReceptionHistoryEntry.array().default([]),
    nextCursor: Cursor.nullable().default(null),
    total: CountInteger,
    relaxations: SearchRelaxation.array().max(3).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.total !== 0 && value.relaxations.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: '条件を緩める候補は 0 件のときだけ添える',
        path: ['relaxations'],
      })
    }
  })
export type ReceptionHistoryList = z.infer<typeof ReceptionHistoryList>

/**
 * 「そのあとの変更」の 1 行（HISTORY-LIST 右「8/20 14:32　新しく受け付けました　中村 彩」）。
 * `audit_events` を `target_id` で引いて**古い順**に組み立てる。
 */
export const ReservationChangeHistory = z.strictObject({
  occurredAt: IsoDateTime,
  what: z.string().trim().min(1).max(120),
  actorName: z.string().trim().max(40).nullable().default(null),
})
export type ReservationChangeHistory = z.infer<typeof ReservationChangeHistory>

/**
 * 受付 1 件の詳細（`GET /api/staff/reception-sessions/:sessionId`。値は `entryId`）。
 *
 * `receivedBy` は null を許す — Web のご予約は**受け付けた人がいない**ので、
 * 1..40 を強いると Web から入った 1 件を開いた瞬間に 500 になる（`sessionId` を
 * null 可にしたのと同じ理由である）。
 *
 * `recording` は **P7（`010-recording`）が埋めるまで常に null** なので、いまは null しか
 * 受けない形にしておく。器だけ先に広げると「まだ無い」と「空だった」が同じ形になる。
 */
/*
 * 録音の語は**受付履歴より前**に置く。受付履歴の 1 件がその録音を埋め込むので、
 * うしろに置くと import 時に未定義を読むことになる（`const` は巻き上がらない）。
 */
/**
 * 録音の状態。`recording`（録っている）→ `uploading`（送っている）→ `stored`（保管庫にある）
 * の 3 段に、`failed`（端末に実体が残っている）と `deleted`（実体を消したあとの行）を足した 5 値。
 * 知らない語を通すと、掃除の Cron が拾えない状態の行が黙って増える。
 */
export const RecordingState = z.enum(['recording', 'uploading', 'stored', 'failed', 'deleted'])
export type RecordingState = z.infer<typeof RecordingState>

/** 録音の長さ。上限 21,600 秒 = 6 時間（1 受付の録音がここに届くことはない）。 */
const DurationSeconds = z.number().int().min(0).max(21_600)

/**
 * 予約詳細・受付履歴に埋め込む録音。「● 録音を聞く　03:12」を描くのに要るのは
 * 長さだけなので、埋め込み側に R2 の手がかりを渡さない。
 */
export const RecordingSummary = z.strictObject({
  id: Uuid,
  state: RecordingState,
  durationSeconds: DurationSeconds.nullable().default(null),
})
export type RecordingSummary = z.infer<typeof RecordingSummary>

export const ReceptionHistoryDetail = z.strictObject({
  entryId: Uuid,
  sessionId: Uuid.nullable().default(null),
  reservation: ReservationDetail.nullable().default(null),
  receivedBy: z.string().trim().min(1).max(40).nullable().default(null),
  receivedAt: IsoDateTime,
  changes: ReservationChangeHistory.array().default([]),
  /*
   * その受付の録音。**`stored` の 1 本だけ**を載せる。
   * 以前は `z.null()` で型ごと固定していたので、録音が保存されていても
   * この面に「受付のときの録音」が一度も出なかった
   * （実装不足の洗い出し recording-01）。送信の途中や失敗した録音は載せない
   * —— 押しても鳴らないボタンを作らない（AC-REC-07）。
   */
  recording: RecordingSummary.nullable().default(null),
})
export type ReceptionHistoryDetail = z.infer<typeof ReceptionHistoryDetail>

/* ------------------------------------------------------------------------- *
 * P6 予約の検索・変更・取消（`specs/glasses_management/features/009-change-and-cancel`）
 *
 * ここに足すのは**探す形**と**書き換える形**の 2 つだけである。ご予約 1 件の姿
 * （`ReservationDetail`）・一覧の 1 行（`ReservationSummary`）・条件を緩めた候補
 * （`SearchRelaxation`）・仮の押さえ（`HoldInput` / `Hold`）・取消の入力
 * （`ReservationCancelInput`）・経緯の 1 行（`ReservationChangeHistory`）は
 * P2〜P5 が既に持っているので、同じ形を二度作らない。
 *
 * 変更・取消は `Idempotency-Key` を受けない。二重適用を止めるのは `version` の
 * 楽観ロックだけで、冪等キーを重ねると「版が合わないので 409」と「同じキーなので
 * 200 を焼き直す」が同じ要求に同時に当たる（`04-api.md` §6.1）。
 * ------------------------------------------------------------------------- */

/* --- 検索 ----------------------------------------------------------------- */

/**
 * ご予約を探す（`GET /api/staff/reservations`。CHANGE-SEARCH / EX-EMPTY-SEARCH）。
 *
 * お名前・お電話番号・予約番号のどれか 1 つで届く（お客様が読み上げてくださるのは
 * どれか 1 つである）。**`phone` は 4 桁ちょうどか 10 桁以上のどちらか**で、
 * 途中まで打った 5〜9 桁は落とす — 下 4 桁は `customers.phone_last4` の完全一致、
 * 全桁は `phone_normalized` の前方一致で、その中間はどちらの index にも乗らない。
 * `code` は業務側と Web の 2 書式を受ける（お客様が読み上げるのは `EY-W-` のほう）。
 *
 * `crossStore` が `false` しか受けないのは Q-04 の**いまの前提**である。別店舗の
 * ご予約は見せないと決めたので、押せない導線を画面にも契約にも置かない。
 * 答えが「見せる」に決まったら `z.boolean()` へ戻す（そのときだけ true が通る）。
 */
export const ReservationSearchQuery = z.strictObject({
  storeId: Uuid.optional(),
  name: z.string().trim().max(40).optional(),
  kana: z.string().trim().max(40).optional(),
  // 4 桁ちょうど（下 4 桁）を先に見る。10〜20 文字はハイフン・全角を含む全桁である。
  phone: z.union([PhoneSuffix, PhoneInput]).optional(),
  code: z.union([ReservationCode, WebBookingCode]).optional(),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
  status: QueryWordList(ReservationStatus, 6),
  source: QueryWordList(ReservationSource, 4),
  staffId: Uuid.optional(),
  includeCancelled: QueryFlag,
  crossStore: z.literal(false).default(false),
  limit: Limit,
  cursor: Cursor.optional(),
})
export type ReservationSearchQuery = z.infer<typeof ReservationSearchQuery>

/**
 * 検索の応答（`04-api.md` §1.2 の `{ items, nextCursor, total }`）。
 *
 * `relaxations` は `ReceptionHistoryList` と同じ決めで **0 件のときだけ**添える。
 * 1 件以上あるのに候補が並ぶと、いま見えている一覧が信用できなくなる。
 * 0 件でも候補が 0 件のことはある（緩められる条件が無い／全部外しても 0 件）。
 */
export const ReservationList = z
  .strictObject({
    items: ReservationSummary.array().default([]),
    nextCursor: Cursor.nullable().default(null),
    total: CountInteger,
    relaxations: SearchRelaxation.array().max(3).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.total !== 0 && value.relaxations.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: '条件を緩める候補は 0 件のときだけ添える',
        path: ['relaxations'],
      })
    }
  })
export type ReservationList = z.infer<typeof ReservationList>

/* --- 変更 ----------------------------------------------------------------- */

/** 変更として数える欄。`notify` と `version` は「変わったもの」に数えない。 */
const CHANGE_FIELDS = [
  'startsAt',
  'durationMinutes',
  'purposeIds',
  'staffId',
  'equipmentIds',
  'noteCustomer',
  'noteInternal',
] as const

/**
 * ご予約を変更する（`PATCH /api/staff/reservations/:reservationId`。CHANGE-DIFF）。
 *
 * `version` だけが必須で、直す欄だけを送る。**欄が無い＝そのまま**で、
 * `staffId: null` は「担当をあとで決めるへ戻す」である（`StaffReservationCreate` と
 * 同じ分け方）。1 つも変更点が無い入力を落とすのは、通すと差分表が空のまま版だけが
 * 進み、何も起きていない操作が監査に 1 行残るからである。
 *
 * `notify` の既定が false なのは、店内のご予約にメールを送らないため
 * （CHANGE-DIFF「お電話でのご予約のため、メールは送りません。」）。
 */
export const ReservationChangeInput = z
  .strictObject({
    version: z.number().int().min(1),
    startsAt: IsoDateTime.optional(),
    durationMinutes: DurationMinutes.optional(),
    purposeIds: Uuid.array().min(1).max(5).optional(),
    staffId: Uuid.nullable().optional(),
    equipmentIds: Uuid.array().max(5).optional(),
    noteCustomer: z.string().refine(codePointsAtMost(500)).optional(),
    noteInternal: z.string().refine(codePointsAtMost(500)).optional(),
    notify: z.boolean().default(false),
  })
  .refine((value) => CHANGE_FIELDS.some((key) => value[key] !== undefined), {
    message: '変更する欄を 1 つ以上送る',
    path: ['version'],
  })
  // 変更は確定と同じ `reservation_purposes` / `reservation_assignments` /
  // `reservation_slot_locks` を積み直すので、同じ id を 2 回受けるとその設備の空きが
  // 1 予約で 2 つ減り、同じ目的で所要が倍になる（`StaffReservationCreate` と同じ理由）。
  .refine((value) => value.purposeIds === undefined || noDuplicates(value.purposeIds), {
    message: '同じ目的を 2 回選ばない',
    path: ['purposeIds'],
  })
  .refine((value) => value.equipmentIds === undefined || noDuplicates(value.equipmentIds), {
    message: '同じ設備を 2 回選ばない',
    path: ['equipmentIds'],
  })
export type ReservationChangeInput = z.infer<typeof ReservationChangeInput>

/* ------------------------------------------------------------------------- *
 * P7 受付の録音（`specs/glasses_management/features/010-recording`）
 *
 * 録音の実体は非公開の R2（binding `RECORDINGS`）にあり、D1 が持つのは状態だけである。
 * **この節のどのスキーマにも `r2Key` とダウンロード URL を置かない。** 応答は必ず
 * ここのスキーマで `parse` してから返すので、行をそのまま渡すと `strictObject` が落ちる
 * （落ちる形にしてあるのが目的で、黙って剥がすと剥がし忘れに気づけない）。
 *
 * お知らせ（`alerts`）をここで作るのは、録音の 3 回失敗を積む場所が P7 の時点で
 * 要るからである（`03-data-model.md` §12）。P7 が足すのは `audience='store'` の
 * 一覧に要る形だけで、4 分類の `kind` と `counts` は P10（`013-terminals-and-audit`）。
 * ------------------------------------------------------------------------- */

/* --- 原始型 --------------------------------------------------------------- */

/**
 * 録音番号（ALERTS の `EY-R-1482`）。**組織で通しの 4 桁ゼロ埋め**で、9999 を越えた
 * 組織だけ 5 桁になる。`ReservationCode`（`EY-YYMM-NNNN`）とは別の採番系統なので、
 * 取り違えを書式で弾く（お知らせの本文に載るのはこちらの番号である）。
 */
export const RecordingCode = z.string().regex(/^EY-R-\d{4,5}$/)
export type RecordingCode = z.infer<typeof RecordingCode>

/**
 * 録音の形式。**既定は `audio/mp4`**（AAC 32kbps モノラル）で、iPadOS の Safari の
 * MediaRecorder が確実に出せる形式である（60 分でも約 14MB）。`audio/webm` は取れない
 * 端末があるので既定にしない。許可リストの外は 400 にして、再生側の分岐を増やさない。
 */
export const RecordingContentType = z.enum(['audio/mp4', 'audio/webm', 'audio/mpeg'])
export type RecordingContentType = z.infer<typeof RecordingContentType>

/**
 * 録音のバイト数。上限 104,857,600 = 100MB は R2 の 1 オブジェクトの上限ではなく
 * **この API が受ける 1 録音の上限**である。1 録音 = 1 キーなので分割送信を作らない。
 */
const RecordingBytes = z.number().int().min(0).max(104_857_600)

/* --- 録音 ----------------------------------------------------------------- */

/**
 * 録音の開始（`POST /api/staff/recordings`）。受付セッションを指して 1 本だけ立てる。
 * `r2Key` は**サーバが `id` から決める**ので、端末から受けない（受けると 1 録音 1 キーの
 * 前提が端末側の都合で崩れ、再送が R2 に二重に置かれる）。
 */
export const RecordingCreate = z.strictObject({
  receptionSessionId: Uuid,
  storeId: Uuid,
  contentType: RecordingContentType.default('audio/mp4'),
  startedAt: IsoDateTime,
})
export type RecordingCreate = z.infer<typeof RecordingCreate>

/**
 * 状態の更新（`PATCH /api/staff/recordings/:recordingId`）。許されない遷移は
 * 409 `invalid_transition` で、契約では止めない（遷移の可否は `domain/recording.ts` が持つ）。
 * `failureReason` は端末が読んだ失敗の理由で、お客様の情報を書かない。
 */
export const RecordingStatePatch = z.strictObject({
  state: RecordingState,
  durationSeconds: DurationSeconds.optional(),
  bytes: RecordingBytes.optional(),
  failureReason: z.string().trim().max(120).optional(),
})
export type RecordingStatePatch = z.infer<typeof RecordingStatePatch>

/**
 * 録音 1 件。**`r2Key` を持たない。** `strictObject` なので、D1 の行をそのまま渡すと
 * ここで落ちる（剥がし忘れが 200 で外へ出るより、500 で落ちるほうがよい）。
 *
 * `reservationId` が null なのは破棄受付の録音で、最低保持期限が 24 時間になる側である
 * （成立予約は 30 日）。`retainUntil` は `state='stored'` になるまで決まらないので null 可。
 */
export const Recording = z.strictObject({
  id: Uuid,
  code: RecordingCode,
  receptionSessionId: Uuid,
  reservationId: Uuid.nullable().default(null),
  state: RecordingState,
  contentType: RecordingContentType,
  durationSeconds: DurationSeconds.nullable().default(null),
  bytes: RecordingBytes.nullable().default(null),
  retainUntil: IsoDateTime.nullable().default(null),
  legalHold: z.boolean(),
  uploadAttempts: z.number().int().min(0).max(99),
  createdAt: IsoDateTime,
})
export type Recording = z.infer<typeof Recording>

/** 録音の一覧（`GET /api/staff/recordings`）。`OFFSET` を使わず `cursor` で続きを取る。 */
export const RecordingListQuery = z.strictObject({
  storeId: Uuid.optional(),
  state: QueryWordList(RecordingState, 5),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
  /*
   * ご予約 1 件・受付 1 件にぶら下がる録音を引く。
   * この 2 つが無かったころ、台帳の詳細・予約検索・受付履歴のどこからも
   * 「録音を聞く」に辿り着けなかった —— API は動いているのに、画面が
   * その 1 本を特定する手段を持っていなかった（実装不足の洗い出し recording-03 / 02）。
   */
  reservationId: Uuid.optional(),
  receptionSessionId: Uuid.optional(),
  limit: Limit,
  cursor: Cursor.optional(),
})
export type RecordingListQuery = z.infer<typeof RecordingListQuery>

/** 一覧の応答（`04-api.md` §1.2 の `{ items, nextCursor, total }`）。 */
export const RecordingList = z.strictObject({
  items: Recording.array().default([]),
  nextCursor: Cursor.nullable().default(null),
  total: CountInteger,
})
export type RecordingList = z.infer<typeof RecordingList>

/**
 * 再生の 1 段目（`POST /api/staff/recordings/:recordingId/playback`）が返す短命チケット。
 * **寿命は 900 秒**で、300 秒では最長の録音（HISTORY-LIST の `06:12` = 372 秒）を
 * 1 回聞き通せない。`token` は Authorization ヘッダーの代わりではなく上乗せである。
 */
export const RecordingPlaybackTicket = z.strictObject({
  token: z.string().min(32).max(256),
  expiresAt: IsoDateTime,
  durationSeconds: DurationSeconds.nullable().default(null),
})
export type RecordingPlaybackTicket = z.infer<typeof RecordingPlaybackTicket>

/**
 * 保全の指定と解除（`POST /api/staff/recordings/:recordingId/hold`）。
 * **理由を必須にする** — 理由の無い保全は、外していいのかを後から誰も判断できない。
 */
export const RecordingHoldInput = z.strictObject({
  legalHold: z.boolean(),
  reason: z.string().trim().min(1).max(120),
})
export type RecordingHoldInput = z.infer<typeof RecordingHoldInput>

/**
 * 保持期限を過ぎた録音の掃除（`POST /api/internal/maintenance/recordings/purge`）。
 * `now` はテストが境界を確かめるための注入口で、省くとサーバの時刻を使う。
 */
export const RecordingPurgeRequest = z.strictObject({
  now: IsoDateTime.optional(),
  limit: QueryInteger.pipe(z.number().int().min(1).max(500)).default(100),
})
export type RecordingPurgeRequest = z.infer<typeof RecordingPurgeRequest>

/**
 * 掃除の結果。**保全で残したもの（`skippedHeld`）と消せなかったもの（`failed`）を
 * 1 つの数に混ぜない** — 前者は正常で、後者は次の実行で拾い直す対象である。
 */
export const RecordingPurgeResult = z.strictObject({
  examined: CountInteger,
  deleted: CountInteger,
  skippedHeld: CountInteger,
  failed: CountInteger,
})
export type RecordingPurgeResult = z.infer<typeof RecordingPurgeResult>

/**
 * 最低保持期限の内側で削除を求められたときの 409。「いつから消せるか」を返さないと、
 * 画面が「もう一度あとで」としか言えない。保全で消せない場合は `legalHold` が真になる。
 */
export const RecordingRetainedError = z.strictObject({
  error: z.literal('recording_retained'),
  retainUntil: IsoDateTime,
  legalHold: z.boolean(),
})
export type RecordingRetainedError = z.infer<typeof RecordingRetainedError>

/* --- お知らせ ------------------------------------------------------------- */

/**
 * お知らせの種別（10 値）。**綴りは `store.no_shift`**（`staff.no_shift` にしない。
 * `07-nfr.md` §11.3 / §11.4 と同じ）。下 3 値は `audience='ops'` で作り、ALERTS には
 * 出さない（運用の失敗を業務の「お知らせ」に積むと「対応が必要」の意味が薄まる）。
 */
export const AlertCode = z.enum([
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
export type AlertCode = z.infer<typeof AlertCode>

/**
 * お知らせ 1 件。`body` の上限は **120 文字**（`04-api.md` §4.9）。
 * `03-data-model.md` §11.3 は 200 文字と書いているが、画面が読むのは 04-api の側なので
 * 契約はこちらを正とし、D1 の列は `text` のまま制限しない。
 */
export const Alert = z.strictObject({
  id: Uuid,
  code: AlertCode,
  severity: z.enum(['info', 'action']),
  audience: z.enum(['store', 'ops']).default('store'),
  title: z.string().trim().min(1).max(60),
  body: z.string().max(120).nullable().default(null),
  targetType: z.enum(['recording', 'reservation', 'equipment']).nullable().default(null),
  targetId: z.string().min(1).max(200).nullable().default(null),
  occurredAt: IsoDateTime,
  readAt: IsoDateTime.nullable().default(null),
  resolvedAt: IsoDateTime.nullable().default(null),
  resolvedBy: Uuid.nullable().default(null),
})
export type Alert = z.infer<typeof Alert>

/**
 * お知らせの一覧（`GET /api/staff/alerts`）。P7 が持つのは 4 つだけで、
 * ALERTS 左の 4 分類（`kind`）と `counts` は P10（`013-terminals-and-audit`）が足す。
 * 既定を `store` にするのは、運用のアラートを業務のお知らせに混ぜないためである。
 */
export const AlertListQuery = z.strictObject({
  storeId: Uuid.optional(),
  kind: z.enum(['all', 'action', 'info', 'resolved']).default('all'),
  limit: Limit,
  cursor: Cursor.optional(),
})
export type AlertListQuery = z.infer<typeof AlertListQuery>

/** お知らせの応答（`04-api.md` §1.2 の `{ items, nextCursor, total }`）。 */
export const AlertList = z.strictObject({
  items: Alert.array().default([]),
  nextCursor: Cursor.nullable().default(null),
  total: CountInteger,
  counts: z
    .strictObject({
      all: CountInteger,
      action: CountInteger,
      info: CountInteger,
      resolved: CountInteger,
    })
    .default({ all: 0, action: 0, info: 0, resolved: 0 }),
})
export type AlertList = z.infer<typeof AlertList>

/** お知らせの既読・対応済み更新。空の PATCH は受け付けない。 */
export const AlertPatch = z
  .strictObject({
    readAt: IsoDateTime.nullable().optional(),
  })
  .refine((value) => value.readAt !== undefined, {
    message: 'readAt を指定する',
  })
export type AlertPatch = z.infer<typeof AlertPatch>

export const AlertReadAllInput = z.strictObject({ storeId: Uuid.optional() })
export type AlertReadAllInput = z.infer<typeof AlertReadAllInput>

export const AlertReadAllResult = z.strictObject({ updated: CountInteger })
export type AlertReadAllResult = z.infer<typeof AlertReadAllResult>

/* ------------------------------------------------------------------------- *
 * P10 端末・個人モード・監査
 * ------------------------------------------------------------------------- */

export const Pin = z.string().regex(/^\d{4,6}$/, '暗証番号は4〜6桁の数字にする')
export type Pin = z.infer<typeof Pin>

export const TerminalKind = z.enum(['shared', 'personal'])
export type TerminalKind = z.infer<typeof TerminalKind>

export const Terminal = z.strictObject({
  id: Uuid,
  storeId: Uuid,
  name: z.string().trim().min(1).max(60),
  kind: TerminalKind,
  placeNote: z.string().trim().max(40).default(''),
  deviceLabel: z.string().trim().max(30).default(''),
  autoLockSeconds: z.number().int().min(30).max(1800).default(120),
  isActive: z.boolean(),
  hasPin: z.boolean(),
  lastSeenAt: IsoDateTime.nullable(),
  isOnline: z.boolean(),
  version: Version,
  createdAt: IsoDateTime,
})
export type Terminal = z.infer<typeof Terminal>

export const TerminalListQuery = z.strictObject({
  storeId: Uuid,
  includeInactive: QueryFlag,
  kind: TerminalKind.optional(),
})
export type TerminalListQuery = z.infer<typeof TerminalListQuery>

const terminalInputShape = {
  name: z.string().trim().min(1).max(60),
  kind: TerminalKind,
  placeNote: z.string().trim().max(40).default(''),
  deviceLabel: z.string().trim().max(30).default(''),
  autoLockSeconds: z.number().int().min(30).max(1800).default(120),
  isActive: z.boolean().default(true),
  pin: Pin.optional(),
}

export const TerminalInput = z.strictObject(terminalInputShape)
export type TerminalInput = z.infer<typeof TerminalInput>

export const TerminalPatch = z.strictObject({
  name: terminalInputShape.name.optional(),
  kind: terminalInputShape.kind.optional(),
  placeNote: terminalInputShape.placeNote.removeDefault().optional(),
  deviceLabel: terminalInputShape.deviceLabel.removeDefault().optional(),
  autoLockSeconds: terminalInputShape.autoLockSeconds.removeDefault().optional(),
  isActive: terminalInputShape.isActive.removeDefault().optional(),
  pin: Pin.optional(),
  version: Version,
})
export type TerminalPatch = z.infer<typeof TerminalPatch>

export const TerminalSessionStart = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('personal'), staffId: Uuid, pin: Pin }),
  z.strictObject({ mode: z.literal('shared'), pin: Pin }),
])
export type TerminalSessionStart = z.infer<typeof TerminalSessionStart>

export const TerminalSession = z.strictObject({
  id: Uuid,
  terminalId: Uuid,
  staffId: Uuid.nullable(),
  mode: z.enum(['shared', 'personal']),
  startedAt: IsoDateTime,
  expiresAt: IsoDateTime,
  sessionToken: z
    .string()
    .min(64)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/),
})
export type TerminalSession = z.infer<typeof TerminalSession>

export const ReauthInput = z.strictObject({
  staffId: Uuid,
  pin: Pin,
  reason: z.enum(['recording', 'attention', 'settings', 'customer_merge']),
})
export type ReauthInput = z.infer<typeof ReauthInput>

export const PinInvalidError = z.strictObject({
  error: z.literal('pin_invalid'),
  remainingAttempts: z.number().int().min(0).max(2),
})
export type PinInvalidError = z.infer<typeof PinInvalidError>

export const PinLockedError = z.strictObject({
  error: z.literal('pin_locked'),
  retryAfterSeconds: z.number().int().positive(),
  remainingAttempts: z.literal(0),
})
export type PinLockedError = z.infer<typeof PinLockedError>

export const StaffPinInput = z.strictObject({ pin: Pin })
export type StaffPinInput = z.infer<typeof StaffPinInput>

export const PinSetResult = z.strictObject({ staffId: Uuid, updatedAt: IsoDateTime })
export type PinSetResult = z.infer<typeof PinSetResult>

export const AuditActorType = z.enum(['staff', 'terminal', 'system', 'customer'])
export type AuditActorType = z.infer<typeof AuditActorType>

export const AuditTargetType = z.enum([
  'organizations',
  'stores',
  'store_business_hours',
  'store_blackout_windows',
  'store_calendar_exceptions',
  'store_slot_rules',
  'staff',
  'staff_skills',
  'staff_weekly_shifts',
  'staff_shifts',
  'equipment',
  'equipment_maintenance',
  'visit_purposes',
  'purpose_requirements',
  'reservations',
  'walk_ins',
  'reception_sessions',
  'customers',
  'customer_notes',
  'recordings',
  'web_bookings',
  'web_booking_settings',
  'alerts',
  'terminals',
])
export type AuditTargetType = z.infer<typeof AuditTargetType>

export const AuditEvent = z.strictObject({
  id: Uuid,
  occurredAt: IsoDateTime,
  actorType: AuditActorType,
  actorId: z.string().nullable(),
  terminalId: Uuid.nullable(),
  action: z.string().trim().min(1).max(80),
  targetType: AuditTargetType,
  targetId: z.string().min(1),
  correlationId: Uuid.nullable(),
  beforeJson: z.unknown(),
  afterJson: z.unknown(),
})
export type AuditEvent = z.infer<typeof AuditEvent>

export const AuditSearchQuery = z.strictObject({
  storeId: Uuid.optional(),
  from: LocalDate.optional(),
  to: LocalDate.optional(),
  actorId: z.string().min(1).optional(),
  action: z.string().trim().min(1).max(80).optional(),
  limit: QueryInteger.pipe(z.number().int().min(1).max(200)).default(50),
  cursor: Cursor.optional(),
})
export type AuditSearchQuery = z.infer<typeof AuditSearchQuery>

export const AuditEventList = z.strictObject({
  items: AuditEvent.array().default([]),
  nextCursor: Cursor.nullable().default(null),
  total: CountInteger,
})
export type AuditEventList = z.infer<typeof AuditEventList>

/* ------------------------------------------------------------------------- *
 * P9 分析
 * ------------------------------------------------------------------------- */

export const AnalyticsMetric = z.enum([
  'overview',
  'reservation_count',
  'reservation_source',
  'cancellation',
  'visit_frequency',
  'staff',
  'purpose',
  'wait_time',
])
export type AnalyticsMetric = z.infer<typeof AnalyticsMetric>

export const AnalyticsDailyMetric = z.enum([
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
export type AnalyticsDailyMetric = z.infer<typeof AnalyticsDailyMetric>

export const AnalyticsDailyDimension = z.enum([
  'total',
  'staff',
  'purpose',
  'hour',
  'source',
  'cancellation_category',
  'wait_seconds',
  'visit_frequency',
])
export type AnalyticsDailyDimension = z.infer<typeof AnalyticsDailyDimension>

const isAnalyticsDimensionKey = (dimension: AnalyticsDailyDimension, key: string): boolean => {
  switch (dimension) {
    case 'total':
      return key === ''
    case 'staff':
      return key === 'unassigned' || Uuid.safeParse(key).success
    case 'purpose':
      return Uuid.safeParse(key).success
    case 'hour':
      return /^(?:[0-9]|1[0-9]|2[0-3])$/.test(key)
    case 'source':
      return ['phone', 'counter', 'web', 'walkin'].includes(key)
    case 'cancellation_category':
      return ['customer', 'store', 'duplicate', 'no_show', 'web'].includes(key)
    case 'wait_seconds':
      return /^hour:(?:[0-9]|1[0-9]|2[0-3]):\d+$/.test(key)
    case 'visit_frequency':
      return ['first', 'second', 'third_to_fifth', 'sixth_or_more'].includes(key)
  }
}

const analyticsDimensionsByMetric: Record<
  AnalyticsDailyMetric,
  readonly AnalyticsDailyDimension[]
> = {
  closed: ['total'],
  reservations: ['total', 'purpose', 'hour', 'source'],
  scheduled_reservations: ['total'],
  reservations_received: ['total', 'purpose', 'hour', 'source'],
  receptions: ['total', 'staff', 'source', 'visit_frequency'],
  cancellations: ['cancellation_category'],
  wait_seconds_histogram: ['wait_seconds'],
  revisit_eligible: ['staff'],
  revisit_returning_90d: ['staff'],
}

/** analytics_daily の 1 行。次元と key の対応を入口で fail-close にする。 */
export const AnalyticsDailyRow = z
  .strictObject({
    id: Uuid,
    organizationId: z.string().trim().min(1).max(200),
    storeId: Uuid,
    date: LocalDate,
    metric: AnalyticsDailyMetric,
    dimension: AnalyticsDailyDimension,
    dimensionKey: z.string().max(200),
    /** ロールアップ時の名称snapshot。元マスタが無効化されても表示を保つ。 */
    dimensionLabel: z.string().trim().min(1).max(60),
    value: z.number().int().nonnegative(),
    createdAt: IsoDateTime,
    updatedAt: IsoDateTime,
  })
  .refine((row) => isAnalyticsDimensionKey(row.dimension, row.dimensionKey), {
    message: '切り口キーが次元の語彙に含まれない',
    path: ['dimensionKey'],
  })
  .refine((row) => analyticsDimensionsByMetric[row.metric].includes(row.dimension), {
    message: '指標と切り口の組み合わせが許可されていない',
    path: ['dimension'],
  })
export type AnalyticsDailyRow = z.infer<typeof AnalyticsDailyRow>

export const AnalyticsQuery = z
  .strictObject({
    storeId: Uuid,
    metric: AnalyticsMetric,
    from: LocalDate,
    to: LocalDate,
    granularity: z.enum(['day', 'month', 'hour', 'weekday']).default('day'),
    countBy: z.enum(['visit_date', 'received_date']).default('visit_date'),
  })
  .refine(spanWithinInclusiveDays(400), {
    message: '期間は400日以内にする',
    path: ['to'],
  })
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>

export const StoreIdQuery = z.strictObject({ storeId: Uuid })
export type StoreIdQuery = z.infer<typeof StoreIdQuery>

export const AnalyticsPoint = z.strictObject({
  key: z.string().min(1).max(200),
  label: z.string().min(1).max(60),
  value: z.number().nonnegative(),
  secondaryValue: z.number().min(0).max(1).nullable().default(null),
  isClosed: z.boolean(),
  isOverTarget: z.boolean(),
})
export type AnalyticsPoint = z.infer<typeof AnalyticsPoint>

export const AnalyticsSeries = z.strictObject({
  name: z.string().min(1).max(60),
  points: AnalyticsPoint.array().default([]),
  pattern: z.enum(['solid', 'hatch', 'dot']),
})
export type AnalyticsSeries = z.infer<typeof AnalyticsSeries>

export const AnalyticsReport = z.strictObject({
  metric: AnalyticsMetric,
  from: LocalDate,
  to: LocalDate,
  granularity: z.enum(['day', 'month', 'hour', 'weekday']),
  countBy: z.enum(['visit_date', 'received_date']),
  series: AnalyticsSeries.array().default([]),
  summary: z
    .strictObject({
      label: z.string().min(1).max(30),
      value: z.string().max(40),
      unit: z.string().max(8),
      isOverTarget: z.boolean(),
    })
    .array()
    .max(3)
    .default([]),
  target: z.number().nonnegative().nullable(),
  suppressed: z.boolean(),
  businessDays: z.number().int().nonnegative(),
  pendingDays: z.number().int().nonnegative(),
})
export type AnalyticsReport = z.infer<typeof AnalyticsReport>

export const AnalyticsTargets = z.strictObject({
  waitMinutes: z.literal(8),
  cancellationRatePercent: z.literal(10),
  revisitWindowDays: z.literal(90),
})
export type AnalyticsTargets = z.infer<typeof AnalyticsTargets>

export const AnalyticsRollupRequest = z
  .strictObject({
    from: LocalDate,
    to: LocalDate,
    limit: QueryInteger.pipe(z.number().int().min(1).max(3)).default(3),
    storeCursor: z.string().min(1).max(512).optional(),
  })
  .refine(spanWithinInclusiveDays(31), {
    message: '期間は31日以内にする',
    path: ['to'],
  })
export type AnalyticsRollupRequest = z.infer<typeof AnalyticsRollupRequest>

export const AnalyticsRollupResult = z.strictObject({
  processedStores: z.number().int().min(0).max(3),
  failedStores: z.string().min(1).max(200).array().max(3),
  nextStoreCursor: z.string().min(1).max(512).nullable(),
  from: LocalDate,
  to: LocalDate,
  upserted: CountInteger,
  dropped: CountInteger,
})
export type AnalyticsRollupResult = z.infer<typeof AnalyticsRollupResult>

/* ------------------------------------------------------------------------- *
 * P8 お客様向け Web 予約（`specs/glasses_management/features/011-web-booking`）
 *
 * 公開面（`/api/public/**`）は**未認証**で、組織は `stores.slug` から解決する。
 * body / query の `organizationId` を認可の根拠にしないので、この節のどのスキーマにも
 * `organizationId` を置かない。
 *
 * お客様に見せる番号は 2 つある。**ご予約番号**（`WebBookingCode`。`EY-W-YYMM-NNNN`）は
 * 画面とメールに出す控えで、**確認番号**（内部名 `managementCode`）は本人確認に使う。
 * 確認番号の平文が現れるのは `PublicBookingResult` と `PublicReservationVerificationResult`
 * だけで、照会の応答（`PublicReservationStatus`）には決して載せない。D1 が持つのは
 * ハッシュだけである。
 *
 * 社内の事情（担当・設備・技能・店内名）はこの節のどのスキーマからも出ない。
 * ご用件とお店の名前は必ず対客名（`visit_purposes.name_public` / `stores.name_public`）である。
 * ------------------------------------------------------------------------- */

/* --- 公開設定（SETTINGS-WEB） -------------------------------------------- */

/** ご案内のページ（`eyex.jp/ginza`）。表に持たず `stores.slug` から組み立てる。 */
const LandingPath = z.string().trim().min(1).max(60)

/** お知らせ文。画面の「27文字／120文字まで」と同じ**符号位置**で数える。 */
const WebBookingMessage = z.string().refine(codePointsAtMost(120)).default('')

/** 受付を開始するのは何時間先からか。既定 2（目的の最長 60 分＋片付け 10 分）。 */
const AcceptFromHours = z.number().int().min(0).max(168).default(2)

/** 何日先まで受けるか。SETTINGS-WEB の「30日先まで」。 */
const AcceptUntilDays = z.number().int().min(1).max(180)

/**
 * 変更・取消の締切（来店日の何日前か）。既定 1 = 前日 23:59:59.999 JST まで。
 * 0 は「来店日の 23:59:59.999 JST まで変えられる」を意味する。
 */
const ChangeDeadlineDays = z.number().int().min(0).max(30).default(1)

/** 公開する目的。0 件のまま公開できないが、それは 422 で返す判断であって 400 ではない。 */
const PublishedPurposeIds = Uuid.array().max(20).refine(noDuplicates).default([])

/** 受け付ける時間の前後が逆でないこと。文字列比較で見るので桁は揃っている前提。 */
const opensBeforeCloses = (value: { opensAt: string; closesAt: string }): boolean =>
  value.opensAt < value.closesAt

/**
 * SETTINGS-WEB の左（`GET /api/staff/web-booking-settings/:storeId`）。
 * 行が無い店舗も「公開していません」として同じ形で読めるようにする。
 */
export const WebBookingSettings = z.strictObject({
  storeId: Uuid,
  isPublished: z.boolean(),
  landingPath: LandingPath,
  opensAt: LocalTime,
  closesAt: LocalTime,
  acceptFromHours: AcceptFromHours,
  acceptUntilDays: AcceptUntilDays,
  changeDeadlineDays: ChangeDeadlineDays,
  // **既定は真**。「自動で確定する」を選ばせる UI は作らない（承認待ちの経路が二重になる）。
  requiresApproval: z.boolean().default(true),
  message: WebBookingMessage,
  publishedPurposeIds: PublishedPurposeIds,
  version: Version,
  updatedAt: IsoDateTime,
})
export type WebBookingSettings = z.infer<typeof WebBookingSettings>

/**
 * SETTINGS-WEB の「保存」（`PUT`）。`storeId` はパスで受けるのでここに置かない。
 * `landingPath` / `updatedAt` はサーバが決めるので受け取らない（`strictObject` が弾く）。
 */
export const WebBookingSettingsInput = z
  .strictObject({
    isPublished: z.boolean(),
    opensAt: LocalTime,
    closesAt: LocalTime,
    acceptFromHours: AcceptFromHours,
    acceptUntilDays: AcceptUntilDays,
    changeDeadlineDays: ChangeDeadlineDays,
    requiresApproval: z.boolean().default(true),
    message: WebBookingMessage,
    publishedPurposeIds: PublishedPurposeIds,
    version: Version,
  })
  .refine(opensBeforeCloses, { message: '受け付ける終了は開始より後にする', path: ['closesAt'] })
export type WebBookingSettingsInput = z.infer<typeof WebBookingSettingsInput>

/**
 * SETTINGS-WEB の右「お客様の画面の見え方」（`GET .../preview`）。
 * **保存を伴わない**ので、未保存の値をクエリで受け取れる。
 */
export const WebPreviewQuery = z.strictObject({
  purposeIds: QueryIdList(20),
  message: z.string().refine(codePointsAtMost(120)).optional(),
})
export type WebPreviewQuery = z.infer<typeof WebPreviewQuery>

/**
 * ご用件 1 件（WEB-02-PURPOSE と SETTINGS-WEB のプレビューが同じ形を読む）。**`name` は `visit_purposes.name_public`**。
 * 店内名・技能・設備を持たないのは形そのもので、`strictObject` が混入を落とす。
 */
export const PublicStorePurpose = z.strictObject({
  id: Uuid,
  name: z.string().trim().min(1).max(40),
  durationMinutes: DurationMinutes,
})
export type PublicStorePurpose = z.infer<typeof PublicStorePurpose>

/** プレビューの中身。出るのは対客名だけで、店内名は 1 つも含まない。 */
export const WebPreviewResult = z.strictObject({
  storeName: z.string().trim().min(1).max(40),
  purposes: PublicStorePurpose.array().default([]),
  message: WebBookingMessage,
})
export type WebPreviewResult = z.infer<typeof WebPreviewResult>

/**
 * 確認待ちの Web 予約を確かめる（`POST /api/staff/web-bookings/:webBookingId/review`）。
 * **却下には理由を必ず書かせる** — 理由の無い却下は、お客様へ何と伝えたかが後から分からない。
 */
export const WebBookingReviewInput = z
  .strictObject({
    decision: z.enum(['approve', 'reject']),
    reason: z.string().trim().max(120).default(''),
  })
  .refine((value) => value.decision !== 'reject' || value.reason !== '', {
    message: 'お受けできない理由を書く',
    path: ['reason'],
  })
export type WebBookingReviewInput = z.infer<typeof WebBookingReviewInput>

/* --- 公開面の読み取り（WEB-01〜WEB-03） ---------------------------------- */

/**
 * 店舗一覧（`GET /api/public/stores`）。WEB-01-STORE は 3 件を出す。
 * **位置情報を受け取らない** — 並びは `stores.sort_order`（登録順）で、
 * お客様の予約の手前に許可の関門を増やさない（`011-web-booking` の決め）。
 */
export const PublicStoreSearchQuery = z.strictObject({
  limit: QueryInteger.pipe(z.number().int().min(1).max(10)).default(3),
})
export type PublicStoreSearchQuery = z.infer<typeof PublicStoreSearchQuery>

/** 店舗 1 件。`name` は対客名（`stores.name_public`）で、店内名を返さない。 */
export const PublicStoreSummary = z.strictObject({
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().trim().min(1).max(40),
  accessNote: z.string().trim().max(60).default(''),
})
export type PublicStoreSummary = z.infer<typeof PublicStoreSummary>

/**
 * 店舗の詳細（ヘッダーの店名・道順、完了画面の地図）。`isPublished` が偽の店舗は
 * そもそも 404 になるので、この形が外へ出るのは公開中の店舗だけである。
 */
export const PublicStoreDetail = PublicStoreSummary.extend({
  phone: z.string().trim().max(30).default(''),
  address: z.string().trim().max(200).default(''),
  message: WebBookingMessage,
  isPublished: z.boolean(),
})
export type PublicStoreDetail = z.infer<typeof PublicStoreDetail>

/**
 * 週の空き（`GET /api/public/stores/:storeSlug/availability`）。
 * **両端を含めて 7 日まで** — WEB-03-DATETIME の週は「8月27日 〜 9月2日」で、
 * `from` と `to` の差は 6 日である。8 日ぶんを求めると 400 にする。
 */
export const PublicAvailabilityQuery = z
  .strictObject({
    purposeId: Uuid,
    from: LocalDate,
    to: LocalDate,
  })
  .refine(spanWithinDays(6), { message: '一度に見られるのは 7 日ぶんまで', path: ['to'] })
export type PublicAvailabilityQuery = z.infer<typeof PublicAvailabilityQuery>

/** 枠 1 つ。**空いているかどうかだけ**で、誰が・どの台がという内訳を持たない。 */
const PublicAvailabilitySlot = z.strictObject({
  startsAt: IsoDateTime,
  isAvailable: z.boolean(),
})

/** 1 日ぶん。`isClosed` は定休日、`isFull` はその日が満（「満」の札）。 */
const PublicAvailabilityDay = z.strictObject({
  date: LocalDate,
  isClosed: z.boolean(),
  isFull: z.boolean(),
  slots: PublicAvailabilitySlot.array().default([]),
})

/**
 * 週の応答。担当・設備の内訳は**返さない**（社内の事情を外に出さない）。
 * 押せない理由は「定休」「満」の 2 語だけで、`AvailabilityReason` の 12 値を出さない。
 */
export const PublicAvailabilityResponse = z.strictObject({
  days: PublicAvailabilityDay.array().default([]),
})
export type PublicAvailabilityResponse = z.infer<typeof PublicAvailabilityResponse>

/* --- 予約する・確かめる・変える・取り消す（WEB-04〜WEB-CANCEL） ---------- */

/**
 * 予約の送信（`POST /api/public/stores/:storeSlug/bookings`）。伺うのは 4 欄だけ。
 * **`contactEmail` は必須** — 承認制である以上、連絡手段の無いお客様の予約は宙に浮く
 * （`[要確認: Q-09 — いまの前提で進める]`。`design/09-open-questions.md`）。
 */
export const PublicBookingCreate = z.strictObject({
  purposeId: Uuid,
  startsAt: IsoDateTime,
  contactName: z.string().trim().min(1).max(40),
  // ふりがなだけは空でよい（お客様が自分で消せる）。
  contactKana: z.string().trim().max(40).default(''),
  contactPhone: PhoneInput,
  contactEmail: z.string().trim().email().max(320),
})
export type PublicBookingCreate = z.infer<typeof PublicBookingCreate>

/**
 * 予約の控え（WEB-06-DONE）。**確認番号の平文が現れるのはここだけ**である。
 * `emailed` に既定を持たせないのは、既定で真にすると確認メールが出なかった日にも
 * 「確認のメールをお送りしました。」が出てしまうためである（AC-WEB-17）。
 */
export const PublicBookingResult = z
  .strictObject({
    code: WebBookingCode,
    status: z.enum(['pending', 'confirmed']),
    startsAt: IsoDateTime,
    endsAt: IsoDateTime,
    storeName: z.string().trim().min(1).max(40),
    purposeName: z.string().trim().min(1).max(40),
    contactName: z.string().trim().min(1).max(40),
    managementCode: z.string().min(8).max(32),
    emailed: z.boolean(),
  })
  .refine(startsBeforeEnds, { message: '終了は開始より後にする', path: ['endsAt'] })
export type PublicBookingResult = z.infer<typeof PublicBookingResult>

/**
 * 本人確認（`POST /api/public/reservations/verify`）。ご予約番号だけでは通さない。
 * **どちらが違うかを言わない**ので、電話とメールのどちらで確かめたかも応答に出さない。
 */
export const PublicReservationVerification = z
  .strictObject({
    code: WebBookingCode,
    contactPhone: PhoneInput.optional(),
    contactEmail: z.string().trim().email().max(320).optional(),
  })
  .refine((value) => value.contactPhone !== undefined || value.contactEmail !== undefined, {
    message: 'お電話番号かメールアドレスのどちらかを入れる',
    path: ['contactPhone'],
  })
export type PublicReservationVerification = z.infer<typeof PublicReservationVerification>

/** 本人確認が通ったときの短命の鍵（KV `SHORT_LIVED` に TTL 900 秒）。 */
export const PublicReservationVerificationResult = z.strictObject({
  managementCode: z.string().min(8).max(32),
  expiresAt: IsoDateTime,
})
export type PublicReservationVerificationResult = z.infer<
  typeof PublicReservationVerificationResult
>

/**
 * 照会の明細（WEB-CANCEL）。**確認番号を持たない** — 平文が返るのは予約を作った
 * 1 回だけで、ここに載せると照会のたびに漏れる面が増える。
 * `changeDeadlineAt` は設定から作る（画面に期限の文を固定で書かせない）。
 */
const publicReservationStatusShape = {
  code: WebBookingCode,
  status: z.enum(['pending', 'confirmed', 'cancelled']),
  startsAt: IsoDateTime,
  endsAt: IsoDateTime,
  storeName: z.string().trim().min(1).max(40),
  purposeName: z.string().trim().min(1).max(40),
  durationMinutes: DurationMinutes,
  contactName: z.string().trim().min(1).max(40),
  changeDeadlineAt: IsoDateTime,
}

export const PublicReservationStatus = z
  .strictObject(publicReservationStatusShape)
  .refine(startsBeforeEnds, { message: '終了は開始より後にする', path: ['endsAt'] })
export type PublicReservationStatus = z.infer<typeof PublicReservationStatus>

/** 日時の変更（`PATCH /api/public/reservations/:code`）。 */
export const PublicReservationChange = z.strictObject({ startsAt: IsoDateTime })
export type PublicReservationChange = z.infer<typeof PublicReservationChange>

/**
 * 変更の結果。`previousStartsAt` を返すのは、「ご来店」が本当に移ったことを
 * お客様の画面が元の時刻と並べて言えるようにするためである。
 */
export const PublicReservationChangeResult = z
  .strictObject({ ...publicReservationStatusShape, previousStartsAt: IsoDateTime })
  .refine(startsBeforeEnds, { message: '終了は開始より後にする', path: ['endsAt'] })
export type PublicReservationChangeResult = z.infer<typeof PublicReservationChangeResult>

/** 取消（`POST /api/public/reservations/:code/cancel`）。理由は任意。 */
export const PublicReservationCancel = z.strictObject({
  reason: z.string().trim().max(120).default(''),
})
export type PublicReservationCancel = z.infer<typeof PublicReservationCancel>

/** 取消の結果。取り消したあとの画面は明細を出さないので、3 つで足りる。 */
export const PublicReservationMutationResult = z.strictObject({
  code: WebBookingCode,
  status: z.literal('cancelled'),
  cancelledAt: IsoDateTime,
})
export type PublicReservationMutationResult = z.infer<typeof PublicReservationMutationResult>

/* --- 保守（確認待ちの自動取消） ------------------------------------------- */

/**
 * `POST /api/internal/maintenance/web-publications/apply`。
 * `now` はテストが**受信日の 24:00 JST** の境界を確かめるための注入口で、
 * 省くとサーバの時刻を使う（`RecordingPurgeRequest` と同じ作法）。
 */
export const WebPublicationApplyRequest = z.strictObject({
  now: IsoDateTime.optional(),
  limit: QueryInteger.pipe(z.number().int().min(1).max(500)).default(100),
})
export type WebPublicationApplyRequest = z.infer<typeof WebPublicationApplyRequest>

/**
 * 保守の結果。**自動で取り消した件数（`autoCancelled`）を他の数に混ぜない** —
 * お客様の予約が消える唯一の自動処理なので、0 でないことが単独で読めるようにする。
 */
export const WebPublicationApplyResult = z.strictObject({
  applied: CountInteger,
  skipped: CountInteger,
  autoCancelled: CountInteger,
})
export type WebPublicationApplyResult = z.infer<typeof WebPublicationApplyResult>
