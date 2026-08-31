/**
 * 受付条件（営業時間・止める帯・予約の間隔）を解くドメイン。
 *
 * ここに置くのは**純関数だけ**で、D1 も `Date.now()` も触らない。時刻はすべて
 * 引数で受ける。閉店間際にお受けできるかどうかは店の一番静かに壊れる判定なので、
 * 実行日と実行時刻に依存させない。
 *
 * 時刻は `HH:MM`（JST の壁時計・ゼロ埋め）で持ち、大小はそのまま**文字列比較**で
 * 見る（`'18:40' < '19:00'`）。契約側の `LocalTime` が時を 2 桁に強制しているので
 * `9:00` は入ってこない。
 *
 * 区間は半開 `[startsAt, endsAt)`。18:40 に終わる区間は 18:40 を含まない。
 */
import type { EquipmentKind, LocalDate, LocalTime, SkillCode, Weekday } from '@app/contracts'
import { toJstDateString } from '@app/shared'

/* --- 入力の形 ------------------------------------------------------------ */

/** 曜日 1 行のうち、営業時間を解くのに要るぶんだけ（`store_business_hours`）。 */
export type WeeklyHours = {
  weekday: number
  isClosed: boolean
  opensAt: string | null
  closesAt: string | null
}

/** 受付を止める帯 1 本（`store_blackout_windows`）。曜日ごとに 0 本以上ある。 */
export type BlackoutBand = {
  weekday: number
  startsAt: string
  endsAt: string
}

/** 臨時のお休みと特別営業（`store_calendar_exceptions`）。曜日の行より優先する。 */
export type DayException = {
  date: string
  kind: 'closed' | 'special'
  opensAt: string | null
  closesAt: string | null
  note?: string | null
}

/** 勤務の曜日 1 行（`staff_weekly_shifts`）。 */
export type WeeklyShift = {
  weekday: number
  isOff: boolean
  startsAt: string | null
  endsAt: string | null
}

/* --- 出力の形 ------------------------------------------------------------ */

/** 受付できる区間。半開 `[startsAt, endsAt)`。 */
export type AcceptableWindow = { startsAt: LocalTime; endsAt: LocalTime }

/** ある 1 日の営業時間を解いた結果。 */
export type BusinessDay = {
  date: LocalDate
  weekday: Weekday
  isClosed: boolean
  opensAt: LocalTime | null
  closesAt: LocalTime | null
  windows: AcceptableWindow[]
}

/**
 * 保存を拒む理由。これ以外はすべて警告を出して通す（004 spec の決め）。
 * 3 語の外へは出さない（`Rejection` としてだけ受け渡す）。
 */
type RejectionCode = 'closes_before_opens' | 'blackout_outside_hours' | 'intro_text_too_long'

/** 拒む文は「〜のため保存できません。〜を直してください。」の 2 文に揃える。 */
export type Rejection = { code: RejectionCode; message: string }

/* --- 語彙 ---------------------------------------------------------------- */

/** 0=日 … 6=土。`store_business_hours.weekday` と同じ並び。 */
const WEEKDAY_LABELS = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日']

/** SETTINGS-STAFF の「できること（技能）」6 チップ。 */
const SKILL_LABELS: Record<SkillCode, string> = {
  measure: '視力測定',
  processing: '加工',
  sales_reception: '販売・受付',
  fitting: 'フィッティング',
  contact_lens: 'コンタクトの相談',
  repair: '修理・部品交換',
}

/** `AvailabilityLane.subtitle` / `LedgerLane.subtitle` の上限（契約と同じ 40 文字）。 */
const LANE_SUBTITLE_MAX = 40

/** SETTINGS-EQUIPMENT の種別 3 値。 */
const EQUIPMENT_KIND_LABELS: Record<EquipmentKind, string> = {
  measure: '視力測定機',
  counter: '相談カウンター',
  workbench: '加工室',
}

const REJECTION_MESSAGES: Record<RejectionCode, string> = {
  closes_before_opens: '閉店が開店より前のため保存できません。閉店の時刻を直してください。',
  blackout_outside_hours:
    '受付を止める時間帯が営業時間の外にあるため保存できません。時間を直してください。',
  intro_text_too_long:
    '紹介文が 200 文字を超えているため保存できません。文字数を減らしてください。',
}

const MINUTES_PER_DAY = 24 * 60
const MS_PER_DAY = 86_400_000
/** 紹介文の上限（SETTINGS-STORE「200文字まで」）。 */
const INTRO_TEXT_MAX = 200

/* --- 時刻と日付の変換 ---------------------------------------------------- */

/** `HH:MM` → 0 時からの分。 */
function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':')
  return Number(hours) * 60 + Number(minutes)
}

/** 0 時からの分 → `HH:MM`。ゼロ埋めを崩さない（文字列比較が壊れる）。 */
function toLocalTime(minutes: number): LocalTime {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY - 1, minutes))
  const hours = String(Math.floor(clamped / 60)).padStart(2, '0')
  return `${hours}:${String(clamped % 60).padStart(2, '0')}`
}

/** JST の暦日 `YYYY-MM-DD` の曜日（0=日 … 6=土）。 */
export function weekdayOf(date: LocalDate): Weekday {
  // 暦日は JST の壁掛けカレンダーそのものなので、UTC の 0 時として読んで
  // 曜日だけを取り出す（時差を足すと曜日が 1 つずれる）。
  return new Date(`${date}T00:00:00.000Z`).getUTCDay()
}

/** JST の暦日を日数ぶん進める（負なら戻る）。月跨ぎ・年跨ぎ・うるう年を素で通す。 */
export function addJstDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.parse(`${date}T00:00:00.000Z`) + days * MS_PER_DAY)
  return shifted.toISOString().slice(0, 10)
}

/**
 * UTC の瞬間 → その瞬間が属する JST の営業日。
 * UTC 15:00 ちょうどは翌日の JST 0:00 なので、そこで日付が変わる。
 */
export function businessDateOf(instant: string | Date): LocalDate {
  return toJstDateString(instant)
}

/* --- 営業時間の解決 ------------------------------------------------------ */

/**
 * 営業時間から止める帯を差し引いて、受付できる区間を出す。
 * 帯は重なっていても順不同でもよい（画面から届いた順に並ぶ）。
 * 長さ 0 の区間は作らない — 押せない枠を案内することになる。
 */
export function acceptableWindows(
  opensAt: string,
  closesAt: string,
  blackouts: readonly { startsAt: string; endsAt: string }[],
): AcceptableWindow[] {
  if (opensAt >= closesAt) return []
  const bands = blackouts
    .map((band) => ({
      startsAt: band.startsAt < opensAt ? opensAt : band.startsAt,
      endsAt: band.endsAt > closesAt ? closesAt : band.endsAt,
    }))
    .filter((band) => band.startsAt < band.endsAt)
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0))

  const windows: AcceptableWindow[] = []
  let cursor = opensAt
  for (const band of bands) {
    if (band.startsAt > cursor) windows.push({ startsAt: cursor, endsAt: band.startsAt })
    if (band.endsAt > cursor) cursor = band.endsAt
  }
  if (cursor < closesAt) windows.push({ startsAt: cursor, endsAt: closesAt })
  return windows
}

/** 定休の日の答え。開店・閉店を持たず、区間は 0 本。 */
function closedDay(date: LocalDate, weekday: Weekday): BusinessDay {
  return { date, weekday, isClosed: true, opensAt: null, closesAt: null, windows: [] }
}

/**
 * ある 1 日の営業時間を解く。**解決順は 店舗まるごとの受付停止 → 例外 → 曜日**で、
 * 例外の行がある日は曜日の行を一切見ない。曜日の行が欠けていれば定休として扱う。
 * 止める帯は例外の日でも曜日のものを引き続き差し引く（帯は曜日に付いている）。
 */
export function resolveBusinessDay(input: {
  date: LocalDate
  weeklyRows: readonly WeeklyHours[]
  exceptions?: readonly DayException[]
  blackouts?: readonly BlackoutBand[]
  /**
   * 店舗まるごとの受付を止めているか（`stores.is_active = '0'`）。
   * 止めた店舗は**曜日にも例外にも関わりなく**その日を閉じる。定休日・臨時休業と
   * 同じ型で出す（AC-LEDGER-22「臨時休業の日と、店舗まるごとの受付を止めた日も
   * 同じ型で出す」）。
   */
  isSuspended?: boolean
}): BusinessDay {
  const { date, weeklyRows } = input
  const weekday = weekdayOf(date)
  const bands = (input.blackouts ?? []).filter((band) => band.weekday === weekday)

  if (input.isSuspended === true) return closedDay(date, weekday)

  const exception = (input.exceptions ?? []).find((row) => row.date === date)
  if (exception) {
    if (exception.kind === 'closed' || exception.opensAt === null || exception.closesAt === null) {
      return closedDay(date, weekday)
    }
    return {
      date,
      weekday,
      isClosed: false,
      opensAt: exception.opensAt,
      closesAt: exception.closesAt,
      windows: acceptableWindows(exception.opensAt, exception.closesAt, bands),
    }
  }

  const row = weeklyRows.find((candidate) => candidate.weekday === weekday)
  if (!row || row.isClosed || row.opensAt === null || row.closesAt === null) {
    return closedDay(date, weekday)
  }
  return {
    date,
    weekday,
    isClosed: false,
    opensAt: row.opensAt,
    closesAt: row.closesAt,
    windows: acceptableWindows(row.opensAt, row.closesAt, bands),
  }
}

/**
 * その日に最後にお受けできる開始時刻（SETTINGS-HOURS「木曜日に最後にお受けできるのは
 * 18:20 です。」）。
 *
 * 最後の区間の終わりから最短のご用件の所要を引き、`開始 + 所要 + 片付け <= 閉店` を
 * 満たすまで下げる。その区間に収まらなければ 1 つ前の区間で同じことをやり直し、
 * どの区間にも収まらなければ `null` を返す。区間が 0 本（定休）なら `null`。
 *
 * **P2 の空き枠エンジンはこの関数を呼ぶ。式を 2 つ作らない** — 表示と押せる枠が
 * 食い違うと、お客様に案内した時刻が押せないという一番困る形で壊れる。
 */
export function lastAcceptableStart(input: {
  windows: readonly AcceptableWindow[]
  shortestDurationMinutes: number
  cleanupMinutes: number
  closesAt: string | null
}): LocalTime | null {
  const { windows, shortestDurationMinutes, cleanupMinutes, closesAt } = input
  if (windows.length === 0) return null
  // 片付けは予約の後ろに付くので、閉店から片付けを引いた時刻が上限になる。
  const limit = closesAt === null ? null : toMinutes(closesAt) - cleanupMinutes

  for (let i = windows.length - 1; i >= 0; i -= 1) {
    const window = windows[i]
    if (!window) continue
    const end = toMinutes(window.endsAt)
    const start = (limit === null ? end : Math.min(end, limit)) - shortestDurationMinutes
    if (start >= toMinutes(window.startsAt)) return toLocalTime(start)
  }
  return null
}

/**
 * `SlotRulesView.lastAcceptableAt` の 7 曜日ぶん。休みの曜日は `null`。
 * 曜日の表示なので臨時のお休み（例外）は見ない。
 */
export function lastAcceptableByWeekday(input: {
  rows: readonly WeeklyHours[]
  blackouts: readonly BlackoutBand[]
  shortestDurationMinutes: number
  cleanupMinutes: number
}): Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', LocalTime | null> {
  const answer: Record<string, LocalTime | null> = {}
  for (let weekday = 0; weekday <= 6; weekday += 1) {
    const row = input.rows.find((candidate) => candidate.weekday === weekday)
    const windows =
      !row || row.isClosed || row.opensAt === null || row.closesAt === null
        ? []
        : acceptableWindows(
            row.opensAt,
            row.closesAt,
            input.blackouts.filter((band) => band.weekday === weekday),
          )
    answer[String(weekday)] = lastAcceptableStart({
      windows,
      shortestDurationMinutes: input.shortestDurationMinutes,
      cleanupMinutes: input.cleanupMinutes,
      closesAt: row?.closesAt ?? null,
    })
  }
  return answer as Record<'0' | '1' | '2' | '3' | '4' | '5' | '6', LocalTime | null>
}

/* --- 保存を拒む 3 条件 --------------------------------------------------- */

/** 同じ理由を何行ぶん見つけても、画面には 2 文を 1 度だけ出す。 */
function rejectionsOf(codes: readonly RejectionCode[]): Rejection[] {
  return [...new Set(codes)].map((code) => ({ code, message: REJECTION_MESSAGES[code] }))
}

/** 閉店が開店以前の曜日があれば拒む。定休の曜日は時刻を持たないので見ない。 */
export function validateBusinessHours(rows: readonly WeeklyHours[]): Rejection[] {
  const broken = rows.some(
    (row) =>
      !row.isClosed &&
      (row.opensAt === null || row.closesAt === null || row.closesAt <= row.opensAt),
  )
  return broken ? rejectionsOf(['closes_before_opens']) : []
}

/** 営業時間の外にはみ出す帯があれば拒む（1 曜日ぶん）。 */
export function validateBlackouts(
  windows: readonly { startsAt: string; endsAt: string }[],
  opensAt: string | null,
  closesAt: string | null,
): Rejection[] {
  if (opensAt === null || closesAt === null) {
    // 定休の曜日に帯を残さない。開いていない時間を止める設定は意味を持たない。
    return windows.length > 0 ? rejectionsOf(['blackout_outside_hours']) : []
  }
  const outside = windows.some((band) => band.startsAt < opensAt || band.endsAt > closesAt)
  return outside ? rejectionsOf(['blackout_outside_hours']) : []
}

/** SETTINGS-HOURS の「保存」が拒む理由をまとめて出す（営業時間 7 行 + 帯）。 */
export function validateHoursInput(input: {
  rows: readonly WeeklyHours[]
  blackouts: readonly BlackoutBand[]
}): Rejection[] {
  const codes: RejectionCode[] = validateBusinessHours(input.rows).map((r) => r.code)
  for (const row of input.rows) {
    const bands = input.blackouts.filter((band) => band.weekday === row.weekday)
    if (bands.length === 0) continue
    codes.push(
      ...validateBlackouts(
        bands,
        row.isClosed ? null : row.opensAt,
        row.isClosed ? null : row.closesAt,
      ).map((r) => r.code),
    )
  }
  return rejectionsOf(codes)
}

/**
 * お客様に見せる紹介文の文字数（SETTINGS-STORE「78文字／200文字まで」）。
 * 画面の数字と同じ数え方にするため、UTF-16 の長さではなく**符号位置**で数える。
 * 契約の `z.string().max(200)` が先に落とすので、ここは文言を作るための判定である。
 */
export function validateIntroText(introText: string | null | undefined): Rejection[] {
  if (introText === null || introText === undefined) return []
  return [...introText].length > INTRO_TEXT_MAX ? rejectionsOf(['intro_text_too_long']) : []
}

/* --- 警告どまりの 4 条件 ------------------------------------------------- */

/**
 * 刻みが片付けより短いと、続けてお受けできない時刻ができる。
 * 拒まない — 人員が抜けた日に何も保存できなくなるほうが店を止める。
 */
export function warnBusinessHours(input: {
  slotMinutes: number
  cleanupMinutes: number
}): string[] {
  if (input.slotMinutes >= input.cleanupMinutes) return []
  return [
    `予約の刻み（${input.slotMinutes}分）が 1件あたりの片付け（${input.cleanupMinutes}分）より短いため、続けてお受けできない時刻ができます。`,
  ]
}

/**
 * 担当の行名の下に出す小さい文字（BOOK-03 の「視力測定・加工」）。
 * 肩書きと技能を `・` でつなぎ、40 文字で切る（`AvailabilityLane.subtitle` の上限）。
 *
 * **技能の語を作るのはここ 1 か所である。**空き枠エンジン（`domain/availability.ts`）は
 * 受け取った文字をそのまま並べるだけで、技能の綴りを知らない。肩書きだけを渡すと、
 * 肩書きを持たない担当（世界観データでは 7 名中 6 名）の行が全部空になる。
 */
export function staffSubline(jobLabel: string | null, skills: readonly SkillCode[]): string {
  const parts = [jobLabel ?? '', ...skills.map((skill) => SKILL_LABELS[skill])].filter(
    (part) => part !== '',
  )
  return parts.join('・').slice(0, LANE_SUBTITLE_MAX)
}

/** ご用件が要る技能を持つ担当が 1 人もいなくなったことを知らせる（保存は通す）。 */
export function warnSkillsWithoutStaff(input: {
  requiredSkills: readonly SkillCode[]
  availableSkills: readonly SkillCode[]
}): string[] {
  const held = new Set(input.availableSkills)
  return [...new Set(input.requiredSkills)]
    .filter((skill) => !held.has(skill))
    .map(
      (skill) =>
        `${SKILL_LABELS[skill]} ができる担当が 1人もいません。この技能が要るご用件は受けられなくなります。`,
    )
}

/** ご用件が要る種別の設備が 1 台も使えなくなったことを知らせる（保存は通す）。 */
export function warnEquipmentKindsWithoutUnits(input: {
  requiredKinds: readonly EquipmentKind[]
  availableKinds: readonly EquipmentKind[]
}): string[] {
  const usable = new Set(input.availableKinds)
  return [...new Set(input.requiredKinds)]
    .filter((kind) => !usable.has(kind))
    .map(
      (kind) =>
        `${EQUIPMENT_KIND_LABELS[kind]} が 1台も使えません。この設備が要るご用件は受けられなくなります。`,
    )
}

/**
 * 勤務が営業時間の外にはみ出していることを知らせる（AC-SET-12）。
 * 拒まない — 開店前の準備や閉店後の片付けに人を置く日が実際にある。
 */
export function warnShiftOutsideHours(shift: WeeklyShift, hours: WeeklyHours): string[] {
  const label = WEEKDAY_LABELS[shift.weekday] ?? ''
  if (shift.isOff || shift.startsAt === null || shift.endsAt === null) return []
  if (hours.isClosed || hours.opensAt === null || hours.closesAt === null) {
    return [`${label}は定休日ですが勤務が入っています。`]
  }
  if (shift.startsAt >= hours.opensAt && shift.endsAt <= hours.closesAt) return []
  return [`${label}の勤務が営業時間（${hours.opensAt}–${hours.closesAt}）の外にはみ出しています。`]
}
