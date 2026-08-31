/**
 * 録音の最低保持期限と、消してよいかどうかの判定。
 *
 * ここに置くのは**純関数だけ**である。D1 も R2 も触らず、`Date.now()` を 1 度も呼ばない
 * （現在時刻は必ず引数で受ける）。録音は要配慮情報なので、**消しすぎと消し忘れの両方が事故**で、
 * どちらも「テストを回した日によって答えが変わる」書き方をした瞬間に静かに壊れる。
 *
 * 最低保持期限は `state='stored'` になった時刻から決まる（`03-data-model.md` §15）。
 * 成立予約（`reservation_id` 非 NULL）は **30 日**、破棄受付は **24 時間**である。
 * 期限**ちょうどはまだ消せない**。消せるのは +1 秒からで、AC-REC-11 / AC-REC-12 が
 * 「30日ちょうどは消せない／30日と1秒で消せる」を明文で求めている。
 *
 * `retain_until` は D1 に ISO8601（UTC）の文字列で入っている。**ISO 文字列同士の比較は
 * 辞書順が時系列と一致する**ので、掃除の Cron の絞り込み（`retain_until < ?`）は
 * D1 の文字列比較のままでよい。この関数だけが `Date` に直して境界を数える。
 */

import type { RecordingState } from '@app/contracts'

/** 成立予約の最低保持期限（秒）。30 日 = 2,592,000 秒。 */
const RETAIN_SECONDS_BOOKED = 2_592_000

/** 破棄受付の最低保持期限（秒）。24 時間 = 86,400 秒。 */
const RETAIN_SECONDS_DISCARDED = 86_400

/**
 * 動かない録音を `failed` に落とすまでの猶予（秒）。24 時間。
 * 保持期限の 24 時間と同じ数だが**別の物差し**なので、定数を共有しない
 * （どちらかを変えたときに、もう一方が黙って一緒に動くほうが危ない）。
 */
const STALE_UPLOAD_SECONDS = 86_400

/**
 * 保管庫に入った録音の最低保持期限。
 *
 * 「録音ごとに保持期間を指定できるようにする」案は却下してある（消し忘れと消しすぎの
 * 両方を招く）。分岐はここの 1 か所、**成立予約か破棄受付か**の 2 値だけである。
 */
export function retainUntilFor({
  hasReservation,
  storedAt,
}: {
  hasReservation: boolean
  storedAt: Date
}): Date {
  const seconds = hasReservation ? RETAIN_SECONDS_BOOKED : RETAIN_SECONDS_DISCARDED
  return new Date(storedAt.getTime() + seconds * 1000)
}

/** 消せないときに 409 `recording_retained` へ載せる 2 つ（`RecordingRetainedError`）。 */
export type CanDeleteResult =
  | { ok: true }
  | { ok: false; retainUntil: string | null; legalHold: boolean }

/**
 * この録音の実体を消してよいか。**通常の削除も手動の削除も同じ関数を通す**
 * （経路ごとに判定を書くと、片方だけが最低保持期限を素通りする）。
 *
 * 消せないのは次の 3 つで、**保全が期限より強い**。
 *
 * 1. `legalHold` が立っている — 期限を何年過ぎても消さない（AC-REC-13）。外した瞬間から
 *    期限だけで決まる。
 * 2. `now <= retainUntil` — **ちょうどは消せない**。`retainUntil` が NULL（まだ `stored` に
 *    なっていない）なら、期限そのものが決まっていないので消せない側に倒す。
 * 3. `state === 'deleted'` — 実体はもう無い。R2 の delete を二度投げない。
 */
export function canDelete({
  state,
  retainUntil,
  legalHold,
  now,
}: {
  state: RecordingState
  retainUntil: string | null
  legalHold: boolean
  now: Date
}): CanDeleteResult {
  const retained = retainUntil === null || now.getTime() <= Date.parse(retainUntil)
  if (legalHold || retained || state === 'deleted') return { ok: false, retainUntil, legalHold }
  return { ok: true }
}

/**
 * 24 時間動かない録音を D1 側で絞り込むための境目（ISO8601）。**これより前に
 * 録り始めた行だけ**が候補になる（`created_at < staleUploadBefore(now)` は
 * `isStaleUpload()` の「24 時間を越えた」とちょうど同じ境界を指す。ちょうどは入らない）。
 *
 * 猶予の秒数をクエリ側へ書き写さないための 1 本である。両方に数字を書くと、
 * 片方だけ直したときに「SQL は拾うのに関数は落とさない」行が静かに増える。
 */
export function staleUploadBefore(now: Date): string {
  return new Date(now.getTime() - STALE_UPLOAD_SECONDS * 1000).toISOString()
}

/** 24 時間動かないまま放置されうる状態。`stored` と `deleted` はもう動かない。 */
const STALE_TARGET_STATES: ReadonlySet<RecordingState> = new Set<RecordingState>([
  'recording',
  'uploading',
  'failed',
])

/**
 * 録り始めてから 24 時間、保管庫に入らないままの録音か。真なら `failed` に落とし、
 * 「録音の保存に3回失敗しました」のお知らせを 1 行立てる（`07-nfr.md` §11.2）。
 *
 * **ちょうど 24 時間はまだ落とさない。**越えた瞬間（24 時間 1 秒）から落とす。
 * 落とすのは警告を出し続けないためであり、同時に端末側の控えを消してよい合図でもある
 * （AC-REC-20 の「24 時間送れないままだと `failed` になり、そのときに端末からも消える」）。
 */
export function isStaleUpload({
  state,
  createdAt,
  now,
}: {
  state: RecordingState
  createdAt: string
  now: Date
}): boolean {
  if (!STALE_TARGET_STATES.has(state)) return false
  return now.getTime() - Date.parse(createdAt) > STALE_UPLOAD_SECONDS * 1000
}
