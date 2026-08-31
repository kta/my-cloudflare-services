/**
 * 受付の録音のうち、D1 も R2 も KV も要らない部分。
 *
 * ここに置くのは**純関数だけ**である。`Date.now()` を 1 度も呼ばず、時刻は引数で受ける。
 *
 * 1. **状態遷移**（`nextState`）— 許す辺は 5 本だけで、`stored` と `deleted` からは動かせない。
 *    許されない遷移は**例外にせず値で返す**（呼び出し側が 409 `invalid_transition` にする。
 *    throw にすると `app.onError` が 500 にして、端末の再送が落ちた理由を受付が読めなくなる）。
 * 2. **録音番号**（`nextRecordingCode`）— `EY-R-NNNN`。**組織で通し**の 4 桁ゼロ埋めで、
 *    予約番号 `EY-YYMM-NNNN`（組織 × JST の暦月）とは別の採番系統である。予約は成立していて
 *    録音だけが失敗している状態を指すのがこの番号なので、予約番号では代用できない。
 * 3. **R2 のキー**（`r2KeyFor`）— `id` から決まるので、再送は必ず同じキーを上書きする
 *    （第 2 の冪等キー。`03-data-model.md` §10.1）。前置 `recordings/` で手書きメモの
 *    `notes/` と分け、掃除がこの前置の外を巻き込まないようにする。
 * 4. **お知らせの本文**（`uploadFailedAlert`）— 3 回続けて失敗したときに何を伝えるか。
 *    **失われていないものを先に言う**。
 */

import type { Alert, AlertCode, RecordingContentType, RecordingState } from '@app/contracts'
import { toJstDateString } from '@app/shared'

/* --- 状態遷移 ------------------------------------------------------------- */

/**
 * 許す辺（5 本）。`stored` と `deleted` は行き止まりで、鍵そのものを持たない。
 *
 * `stored → deleted` をここに入れない。削除は `canDelete()`（最低保持期限と保全）を
 * 必ず通る別の経路で、遷移として許すと期限を素通りできてしまう。
 */
const ALLOWED_TRANSITIONS: Readonly<Record<string, readonly RecordingState[]>> = {
  recording: ['uploading', 'failed'],
  uploading: ['stored', 'failed'],
  failed: ['uploading'],
}

/** 遷移の結果。`ok: false` はそのまま 409 `invalid_transition` になる。 */
export type NextStateResult =
  | { ok: true; state: RecordingState }
  | { ok: false; error: 'invalid_transition' }

/** `current` から `wanted` へ進めてよいか。**例外を投げない。** */
export function nextState(current: RecordingState, wanted: RecordingState): NextStateResult {
  const allowed = ALLOWED_TRANSITIONS[current] ?? []
  if (!allowed.includes(wanted)) return { ok: false, error: 'invalid_transition' }
  return { ok: true, state: wanted }
}

/* --- 録音番号 ------------------------------------------------------------- */

/** 録音番号の接頭辞。`ReservationCode`（`EY-YYMM-…`）と書式で取り違えないための 4 文字。 */
const RECORDING_CODE_PREFIX = 'EY-R-'

/** 連番のゼロ埋め幅。9999 を越えた組織は 5 桁になり、`/^EY-R-\d{4,5}$/` で通る。 */
const RECORDING_CODE_DIGITS = 4

/**
 * 次に振る録音番号。直前の番号が無い組織（1 本目）は `EY-R-0001` から始める。
 *
 * **頭を切らない。**`padStart` は幅を越えた文字列をそのまま返すので、9999 の次は
 * `EY-R-10000` になる。ここで 4 桁に切ると 5 桁の組織が `0001` へ巻き戻り、
 * `recordings_org_code_idx` に弾かれ続けて 1 本も録音が立たなくなる。
 *
 * `previous` は `recordings.code` そのもの（`EY-R-NNNN`）である。書式は契約の
 * `RecordingCode` と一意 index が保証しているので、ここで書式を検め直さない。
 */
export function nextRecordingCode(previous: string | null): string {
  const serial =
    previous === null ? 0 : Number.parseInt(previous.slice(RECORDING_CODE_PREFIX.length), 10)
  return `${RECORDING_CODE_PREFIX}${String(serial + 1).padStart(RECORDING_CODE_DIGITS, '0')}`
}

/* --- R2 のキー ------------------------------------------------------------ */

/** 形式ごとの拡張子。再生側が推し直さなくて済むよう 1 対 1 にする。 */
const EXTENSIONS: Readonly<Record<RecordingContentType, string>> = {
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
}

/**
 * 録音本体を置く R2 のキー。`recordings/{org}/{store}/{YYYY}/{MM}/{id}.{ext}`。
 *
 * 年月は **JST** で切る。UTC のまま切ると、JST 9月1日 00:30 の受付が 8 月の棚に落ちて、
 * 月ごとに数えたときの帳尻が合わなくなる（`toJstDateString` はこの 1 か所を経由する）。
 *
 * 前置 `recordings/` は同じバケットに入る手書きメモ（`notes/`）と分けるためで、
 * 掃除は**行が指すキーだけ**を消す（プレフィクスを走査すると手書きを巻き込む）。
 */
export function r2KeyFor({
  organizationId,
  storeId,
  id,
  contentType,
  createdAt,
}: {
  organizationId: string
  storeId: string
  id: string
  contentType: RecordingContentType
  createdAt: string
}): string {
  const jst = toJstDateString(createdAt)
  return `recordings/${organizationId}/${storeId}/${jst.slice(0, 4)}/${jst.slice(5, 7)}/${id}.${EXTENSIONS[contentType]}`
}

/* --- お知らせの本文 -------------------------------------------------------- */

/** 「録音の保存に3回失敗しました」のお知らせ 1 行ぶん（`alerts` に入れる 4 つ）。 */
export type UploadFailedAlert = {
  code: AlertCode
  severity: Alert['severity']
  title: string
  body: string
}

/** 見出し。モックの ALERTS の文言そのままで、`title` の上限 60 文字の内側にある。 */
const UPLOAD_FAILED_TITLE = '録音の保存に3回失敗しました'

/** 本文の上限（`04-api.md` §4.9 の `Alert.body`）。 */
const ALERT_BODY_MAX = 120

/** お名前のうしろに必ず付く 3 文字。切り詰めの予算を数えるのに使う。 */
const HONORIFIC = ' 様。'

/**
 * 文字列を予算に収める。越えたぶんを落とし、落としたことが分かるよう末尾に `…` を付ける。
 * 空のお名前（お客様がまだ分からない受付）はそのまま空で返し、呼び出し側が一句ごと落とす。
 * **数えるのは書記素ではなくコードポイントである**（契約の `max(120)` と同じ物差しにする）。
 */
function clampName(name: string, max: number): string {
  const chars = [...name.trim()]
  if (chars.length <= max) return chars.join('')
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`
}

/**
 * 同じ録音の送信が 3 回続けて失敗したときに立てるお知らせ。
 *
 * **失われていないものを先に言う。**成立した予約の録音なら「ご予約は成立しています。」、
 * 破棄した受付なら予約が無いので「受付の記録は残っています。」に差し替える
 * （前者をそのまま出すと嘘になる）。
 *
 * 端末名を必ず後ろに足すのは、音声の実体が**その端末にしか無い**からである。
 * レジ横 iPad で失敗した録音を受付 iPad から押しても直らない（`07-nfr.md` §5.6）。
 * `terminals` 表は P10 まで無いので、いまは `null` が渡り、この一句が落ちる。
 *
 * 120 文字を越えるときに削るのは**お客様名だけ**である。番号・成立文・端末名を削ると、
 * 「どの録音か」「何が無事か」「どこへ行けばよいか」のどれかが読めなくなる。
 */
export function uploadFailedAlert({
  code,
  customerName,
  hasReservation,
  terminalName,
}: {
  code: string
  customerName: string | null
  hasReservation: boolean
  terminalName: string | null
}): UploadFailedAlert {
  const survives = hasReservation ? 'ご予約は成立しています。' : '受付の記録は残っています。'
  const terminal = terminalName === null ? '' : `　${terminalName} に残っています`
  const fixed = [...`${code}　${survives}${terminal}${HONORIFIC}`].length
  const kept = clampName(customerName ?? '', ALERT_BODY_MAX - fixed)
  const subject = kept === '' ? '' : `${kept}${HONORIFIC}`
  const body = `${code}　${subject}${survives}${terminal}`
  return {
    code: 'recording.upload_failed',
    severity: 'action',
    title: UPLOAD_FAILED_TITLE,
    // 最後にもう一度、本文そのものを上限で切る。お名前を全部落としても固定の一句だけで
    // 120 文字を越えられる組織（端末名が長い。P10）があり、越えた本文は D1 に入って
    // しまうので、それを読む `GET /api/staff/alerts` が組織まるごと 500 になる。
    // 切るのは末尾からで、**どの録音の話か**（先頭の番号）は必ず残る。
    body: clampName(body, ALERT_BODY_MAX),
  }
}
