/**
 * お客様向け Web 予約のドメイン。**D1 も `Date.now()` も触らない純関数だけ**を置く。
 *
 * 1. **公開設定の解決** — `web_booking_settings` の 1 行（無いこともある）と来店目的から、
 *    「この店舗をお客様に出すか」「何を出すか」「いつまで受けるか」を 1 つの形にする。
 *    行が無い店舗は**未公開**で、公開する目的が 0 件の店舗も公開しない
 *    （目的を選べない予約画面は成立しない。`03-data-model.md` §11.1）。
 * 2. **承認要否** — 「お店が確かめてから確定する」の 1 値だけを持つ。**自動確定の
 *    選択肢を作らない**（承認待ちの経路が二重になる）。
 * 3. **変更・取消の締切** — 来店日の `change_deadline_days` 日前の 23:59:59.999 JST。
 *    その 1 ミリ秒後（翌 00:00:00.000 JST）から 409 `change_deadline_passed`。
 *    営業終了時刻を締切にしない（店舗ごとに締切が動くとお客様に説明できない）。
 * 4. **確認待ちの自動取消** — **受信日**（`created_at` の JST 暦日）の 24:00 JST を過ぎたら
 *    取り消す。**来店日で判定しない** — 来店日起算にすると 3 週間先のご予約が `pending` の
 *    まま ALERTS に居座り、「本日中に確認しないと自動で取り消されます。」が嘘になる。
 * 5. **ご予約番号の採番** — `EY-W-YYMM-NNNN`。`reservations.code`（`EY-YYMM-NNNN`）とは
 *    別系統で、**混ぜない**（`booking.ts` の採番をそのまま流用しない）。
 *
 * 受付の窓（`opens_at`〜`closes_at` / `accept_from_hours` / `accept_until_days`）を
 * 枠へ掛けるのは**空き枠エンジン 1 本**である（`availability.ts` の `webWindow`）。
 * 店内と Web で答えがずれないよう、ここに 2 本目の判定を書かない。
 */
import type { PublicStorePurpose } from '@app/contracts'
import { toJstDateString } from '@app/shared'
import type { WebWindow } from './availability'
import { addJstDays } from './store-settings'

export type { WebWindow } from './availability'

const MS_PER_HOUR = 60 * 60 * 1000
/** JST の暦日の終わり（23:59:59.999）を UTC で表すためのずらし幅。 */
const JST_OFFSET_MS = 9 * MS_PER_HOUR
/** 暦日の最後の 1 ミリ秒。24:00 ちょうどは翌日なので、ここまでを「その日」とする。 */
const LAST_MS_OF_DAY = 24 * MS_PER_HOUR - 1

/**
 * 公開設定の 1 行（`web_booking_settings`）。真偽値は `'0' | '1'` の文字で持つ
 * （D1 に boolean が無い。`03-data-model.md` の決め）。
 */
export type WebBookingSettingsRow = {
  isPublished: string
  opensAt: string
  closesAt: string
  acceptFromHours: number
  acceptUntilDays: number
  changeDeadlineDays: number
  requiresApproval: string
  message: string | null
  version: number
  updatedAt: string
}

/**
 * 行が無い店舗をどう読むか。**画面に出す既定値ではなく、読み取りの既定値**である
 * （SETTINGS-WEB を一度も開いていない店舗も、この値で「公開していません」と読める）。
 * 値は `03-data-model.md` §11.1 の銀座店 seed と既定値の表そのまま。
 */
const DEFAULTS = {
  opensAt: '10:30',
  closesAt: '18:00',
  acceptFromHours: 2,
  acceptUntilDays: 30,
  changeDeadlineDays: 1,
} as const

/** 公開の候補になる来店目的 1 件（`visit_purposes` の 1 行）。 */
export type PublishablePurpose = {
  id: string
  /** **対客名**（`name_public`）。店内名（`name_internal`）をここに入れない。 */
  namePublic: string
  durationMinutes: number
  isWebPublished: string
  isActive: string
  sortOrder?: number
}

/** 解決した公開設定。お客様の面と SETTINGS-WEB の両方がこの 1 つを読む。 */
export type Publication = {
  isPublished: boolean
  /** `eye.jp/ginza`。表に持たず、公開ドメインと `stores.slug` から組み立てる。 */
  landingPath: string
  window: WebWindow
  changeDeadlineDays: number
  requiresApproval: boolean
  message: string
  /** 公開するご用件。**対客名と目安の分数だけ**で、技能も設備も持たない。 */
  purposes: PublicStorePurpose[]
  version: number
  updatedAt: string
}

/* --- 公開設定の解決 -------------------------------------------------------- */

/** `'1'` だけを真として読む。列が壊れていたら公開しない側に倒す。 */
function isOn(flag: string | null | undefined): boolean {
  return flag === '1'
}

/**
 * 店舗 1 つの公開設定を解決する。
 *
 * **公開する目的が 0 件なら `is_published='1'` でも公開しない。**保存を拒む側（422）と
 * 読み取り側の答えを 1 つにするためで、そうしないと「保存できないはずの状態」で
 * 保存された古い行が、目的の無い予約画面をお客様に見せてしまう。
 *
 * `now` は行が無い店舗の `updatedAt` にだけ効く（画面が版と更新時刻を必ず読むため）。
 */
export function resolvePublication(input: {
  slug: string
  settings: WebBookingSettingsRow | null
  purposes: readonly PublishablePurpose[]
  /** `wrangler.jsonc` の `vars` にある公開ドメイン（`eye.jp`）。 */
  publicOrigin: string
  now: Date
}): Publication {
  const { settings } = input
  const purposes = [...input.purposes]
    .filter((purpose) => isOn(purpose.isWebPublished) && isOn(purpose.isActive))
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((purpose) => ({
      id: purpose.id,
      name: purpose.namePublic,
      durationMinutes: purpose.durationMinutes,
    }))

  // 公開ドメインは `https://` を付けて書かれていることがある（vars を人が編集する）。
  // `landingPath` は画面にそのまま出る 1..60 文字なので、綴りを 1 つに寄せる。
  const origin = input.publicOrigin.replace(/^https?:\/\//, '').replace(/\/+$/, '')

  return {
    isPublished: isOn(settings?.isPublished) && purposes.length > 0,
    landingPath: `${origin}/${input.slug}`,
    window: {
      opensAt: settings?.opensAt ?? DEFAULTS.opensAt,
      closesAt: settings?.closesAt ?? DEFAULTS.closesAt,
      acceptFromHours: settings?.acceptFromHours ?? DEFAULTS.acceptFromHours,
      acceptUntilDays: settings?.acceptUntilDays ?? DEFAULTS.acceptUntilDays,
    },
    changeDeadlineDays: settings?.changeDeadlineDays ?? DEFAULTS.changeDeadlineDays,
    requiresApproval: requiresApproval(settings),
    message: settings?.message ?? '',
    purposes,
    version: settings?.version ?? 0,
    updatedAt: settings?.updatedAt ?? input.now.toISOString(),
  }
}

/**
 * お店が確かめてから確定するか。**行が無い店舗も「確かめる」**として読む
 * （既定で自動確定にすると、設定を一度も開いていない店舗のご予約が誰にも見られずに
 * 確定する）。`'0'` を保存できる列は残すが、それを選ばせる UI は作らない。
 */
export function requiresApproval(settings: WebBookingSettingsRow | null): boolean {
  return settings === null ? true : isOn(settings.requiresApproval)
}

/* --- 受付の窓（日で数えるほう） -------------------------------------------- */

/**
 * 何日先まで受けるか（JST の暦日）。`now` の JST 暦日から `acceptUntilDays` 日先まで。
 *
 * **時刻ではなく暦日で切る。**時刻で切ると、同じ日の中に選べる枠と選べない枠が
 * 混ざり、WEB-03-DATETIME の「30日先まで」という言い方と合わなくなる。
 */
function acceptUntilDate(acceptUntilDays: number, now: Date): string {
  return addJstDays(toJstDateString(now), acceptUntilDays)
}

/**
 * その週（`weekStartsOn` から 7 日）へ送れるか。**週の先頭が受付の窓の中にあれば送れる。**
 *
 * 30 日先ちょうどを含む週は開ける（窓の外の日はその中で押せない枠として出る）。
 * その次の週は先頭から窓の外なので、`›` を押せなくする。
 */
export function canOpenWeek(weekStartsOn: string, acceptUntilDays: number, now: Date): boolean {
  return weekStartsOn <= acceptUntilDate(acceptUntilDays, now)
}

/* --- 変更・取消の締切 ------------------------------------------------------ */

/**
 * 変更・取消の締切。来店日の `changeDeadlineDays` 日前の **23:59:59.999 JST**。
 * `0` なら来店日そのものの 23:59:59.999 JST まで変えられる。
 */
export function changeDeadlineAt(visitDate: string, changeDeadlineDays: number): string {
  const lastDay = addJstDays(visitDate, -changeDeadlineDays)
  return new Date(
    Date.parse(`${lastDay}T00:00:00.000Z`) - JST_OFFSET_MS + LAST_MS_OF_DAY,
  ).toISOString()
}

/**
 * 締切を過ぎているか。**23:59:59.999 JST ちょうどはまだ変えられる**（`now <= 締切`）。
 * その 1 ミリ秒後から 409 `change_deadline_passed`（`07-nfr.md` §10.3）。
 */
export function isChangeDeadlinePassed(
  booking: { visitDate: string; changeDeadlineDays: number },
  now: Date,
): boolean {
  return now.getTime() > Date.parse(changeDeadlineAt(booking.visitDate, booking.changeDeadlineDays))
}

/* --- 確認待ちの自動取消 ---------------------------------------------------- */

/**
 * 確認待ちのまま受信日を越えたか。
 *
 * **起算は受信日（`createdAt` の JST 暦日）で、来店日ではない。**この関数が来店日を
 * 引数に取らないのは、取れるようにすると呼ぶ側が間違えるからである。
 * 受信日の 23:59:59.999 JST までは残し、翌 00:00:00.000 JST から取り消す。
 */
export function shouldAutoCancel(
  booking: { status: string; createdAt: string },
  now: Date,
): boolean {
  if (booking.status !== 'pending') return false
  const receivedOn = toJstDateString(booking.createdAt)
  const lastMoment = Date.parse(`${receivedOn}T00:00:00.000Z`) - JST_OFFSET_MS + LAST_MS_OF_DAY
  return now.getTime() > lastMoment
}

/** 自動で取り消したことをお店へ伝える 1 行（`alerts` に入れる 5 つ）。 */
export type AutoCancelledAlert = {
  code: 'web_booking.auto_cancelled'
  severity: 'info'
  audience: 'store'
  title: string
  body: string
}

/**
 * 自動取消のお知らせ。**お客様のお名前・お電話番号を本文に入れない**
 * （`07-nfr.md` §6.6。ご予約番号だけで台帳を引ける）。`severity` を `info` にするのは、
 * 取り消し済みの予約に対してお店ができることがもう無いからである。
 */
export function autoCancelledAlert(input: { publicCode: string }): AutoCancelledAlert {
  return {
    code: 'web_booking.auto_cancelled',
    severity: 'info',
    audience: 'store',
    title: '確認待ちのWeb予約を自動で取り消しました',
    body: `${input.publicCode}　受け取った日のうちに確認できなかったため、自動で取り消しました。`,
  }
}

/* --- ご予約番号（対客）の採番 ---------------------------------------------- */

/** 対客のご予約番号の接頭辞。**店内の `EY-` と混ぜない。** */
const WEB_CODE_PREFIX = 'EY-W'
/** 連番のゼロ埋め幅。9999 を越えた月は 5 桁になり、`/^EY-W-\d{4}-\d{4,5}$/` で通る。 */
const WEB_CODE_DIGITS = 4
/** `EY-W-` のあと `YYMM-` までの長さ。SQL の `SUBSTR` と同じ数である。 */
const WEB_CODE_SERIAL_OFFSET = `${WEB_CODE_PREFIX}-YYMM-`.length

/** 採番を試す回数（最初の 1 本 ＋ 打ち直し 4 本）。尽きたら 409 `code_exhausted`。 */
export const WEB_CODE_ATTEMPTS = 5

/** JST の暦月 `YYMM`。UTC 15:00 で翌月へ変わる（`booking.ts` と同じ数え方）。 */
export function webBookingCodeMonth(now: Date): string {
  const jst = toJstDateString(now)
  return `${jst.slice(2, 4)}${jst.slice(5, 7)}`
}

function formatPublicCode(month: string, serial: number): string {
  return `${WEB_CODE_PREFIX}-${month}-${String(serial).padStart(WEB_CODE_DIGITS, '0')}`
}

/**
 * 次に振るご予約番号。`maxSerial` はその組織・その暦月の最大の連番で、
 * **数として**採る（文字列の `MAX` では `9999 > 10000` になり、桁上げした月の採番が
 * 10000 に戻り続けて必ず衝突する。`booking.ts` と同じ落とし穴）。
 */
export function nextPublicCode(month: string, maxSerial: number | null): string {
  return formatPublicCode(month, (maxSerial ?? 0) + 1)
}

/** 打ち直しの 1 手。月はそのままに連番だけ +1 する。 */
export function bumpPublicCode(code: string): string {
  const month = code.slice(WEB_CODE_PREFIX.length + 1, WEB_CODE_SERIAL_OFFSET - 1)
  const serial = Number.parseInt(code.slice(WEB_CODE_SERIAL_OFFSET), 10)
  return formatPublicCode(month, (Number.isFinite(serial) ? serial : 0) + 1)
}
