/**
 * 枠の仮の押さえ（KV `SHORT_LIVED`）。
 *
 * **これは排他ではない。**復唱している 7 分のあいだに別の端末が同じ枠を触ったことを
 * 早く気づかせるための、表示だけの仕組みである。KV に CAS が無いので「取れなかった」を
 * 判定できず、`POST /api/staff/holds` は **409 を返さず常に 200** を返す。
 * 枠の一次排他は確定のバッチが打つ `reservation_slot_locks` が担う
 * （`design/04-api.md` §6.3 / `03-data-model.md` §7.6）。
 *
 * 切れても入力は消えず、確定も試せる。420 秒を過ぎた `holdId` を付けた確定を
 * 404 にも 409 にもしない — 枠が空いていればそのまま通る。
 *
 * **鍵は `hold:<orgId>:<storeId>:<holdId>` の 1 通りだけ。**枠は `KV.put` の第 3 引数
 * `metadata` に載せる。鍵に `targetId` と `startsAt` を入れると
 * `DELETE /api/staff/holds/:holdId` が鍵を組み立てられない。
 *
 * **1 押さえ = 1 鍵 = 1 行**にする。`metadata` は担当 1 ＋ 設備 0〜5 を
 * `staffId` / `equipmentIds` として 1 つに持ち、読むときに `HoldOccupancy` の
 * レーン（担当 1 ＋ 設備 N）へ展開する。§6.3 の metadata は `kind` / `targetId` の
 * 単数で書かれているが、契約の `Hold` は id を 1 つしか持たず、
 * `DELETE /api/staff/holds/:holdId` はその 1 つの id で**押さえまるごと**を返せなければ
 * ならない。レーンごとに鍵を分けると設備のレーンの id がクライアントへ渡らず、
 * 選び直しても 420 秒返せない。書き込みも 1 予約 3 write から 1 write に減る。
 *
 * **時刻はすべて引数で受ける。**`Date.now()` を書かない。
 */
import type { KVNamespace } from '@cloudflare/workers-types'
import type { HoldOccupancy } from './availability'

/**
 * 仮の押さえの寿命。BOOK-05-CONFIRM の statusbar `11:11` と
 * 「仮の押さえ → 11:18 まで」の差そのもの。
 */
export const HOLD_TTL_SECONDS = 420
/** 残りがこの秒数になったら `role="status"` の警告を出す（残り 60 秒ちょうどで出す）。 */
export const HOLD_WARNING_SECONDS = 60
/**
 * 「まだ入力中です」で取り直せる回数。**延長の API は作らない** —
 * 押し直しは `DELETE` → `POST` の 2 本で足りる（Q-06 のいまの前提）。
 */
export const HOLD_RENEW_MAX = 10

/** 鍵の頭。 */
const HOLD_KEY_HEAD = 'hold'

/** `KV.put` の `metadata`。読むときにレーン（担当 1 ＋ 設備 N）へ展開する。 */
type HoldMetadata = {
  /** `null` は「あとで決める」。未定のレーンも枠を消費する。 */
  staffId: string | null
  equipmentIds: string[]
  startsAt: string
  endsAt: string
  /** 自分の受付が置いた押さえを自分で塞がりに数えないための目印。 */
  receptionSessionId: string | null
}

/** 押さえ 1 本。ルートはこれをそのまま契約の `Hold` へ写せる。 */
export type HoldEntry = HoldMetadata & { id: string; expiresAt: string }

/* --- 鍵 ------------------------------------------------------------------ */

/** `hold:<orgId>:<storeId>:` まで。`KV.list` の prefix になる。 */
function holdPrefix(organizationId: string, storeId: string): string {
  return `${HOLD_KEY_HEAD}:${organizationId}:${storeId}:`
}

/** `hold:<orgId>:<storeId>:<holdId>`。**鍵の形はこの 1 通りだけ。** */
function holdKey(organizationId: string, storeId: string, holdId: string): string {
  return `${holdPrefix(organizationId, storeId)}${holdId}`
}

/* --- 期限 ---------------------------------------------------------------- */

/** 押さえた時刻から 420 秒後。画面はこの値だけで残り時間を数える（端末の時計を見ない）。 */
function holdExpiresAt(now: Date): string {
  return new Date(now.getTime() + HOLD_TTL_SECONDS * 1000).toISOString()
}

/** 残り秒数。**420 秒ちょうどはまだ生きている**ので 0 を返す（切れてはいない）。 */
export function holdRemainingSeconds(hold: { expiresAt: string }, now: Date): number {
  const left = Date.parse(hold.expiresAt) - now.getTime()
  return left <= 0 ? 0 : Math.ceil(left / 1000)
}

/** まだ押さえているか。`now <= expiresAt` のあいだは生きている。 */
export function isHoldAlive(hold: { expiresAt: string }, now: Date): boolean {
  return now.getTime() <= Date.parse(hold.expiresAt)
}

/**
 * 残り 60 秒ちょうどで `true`、61 秒では `false`。切れたあとも `false`
 * （切れた押さえに「まだ入力中です」を出しても取り直しにならない。出すのは別の面）。
 */
export function holdWarning(hold: { expiresAt: string }, now: Date): boolean {
  return isHoldAlive(hold, now) && holdRemainingSeconds(hold, now) <= HOLD_WARNING_SECONDS
}

/** 取り直しの答え。10 回を越えたら断る（無限に押さえ続けられない）。 */
export type HoldRenewal =
  | { ok: true; renewals: number; expiresAt: string }
  | { ok: false; error: 'renew_limit'; renewals: number }

/**
 * 「まだ入力中です」を押したときの残り時間。**420 秒に戻る。**
 * 延長の API を持たないので、回数を数えられるのは画面（と受付の下書き）だけである。
 * サーバから見ると `DELETE` → `POST` の 2 本でしかない。
 */
export function renewHold(state: { renewals: number }, now: Date): HoldRenewal {
  if (state.renewals >= HOLD_RENEW_MAX) {
    return { ok: false, error: 'renew_limit', renewals: state.renewals }
  }
  return { ok: true, renewals: state.renewals + 1, expiresAt: holdExpiresAt(now) }
}

/* --- 空き枠へ渡す形 ------------------------------------------------------ */

/**
 * 押さえをレーンへ展開して「塞がり」に数える形にする。**切れたものは落とす。**
 * 1 本の押さえが担当 1 ＋ 設備 N の行になり、どれも同じ `holdId` を持つ。
 * 担当が未定（`staffId === null`）でも担当のレーンは 1 行できる — 未定の枠も消費する。
 */
export function holdOccupancies(holds: readonly HoldEntry[], now: Date): HoldOccupancy[] {
  const rows: HoldOccupancy[] = []
  for (const hold of holds) {
    if (!isHoldAlive(hold, now)) continue
    const band = {
      holdId: hold.id,
      receptionSessionId: hold.receptionSessionId,
      startsAt: hold.startsAt,
      endsAt: hold.endsAt,
    }
    rows.push({ ...band, kind: 'staff', targetId: hold.staffId })
    for (const id of hold.equipmentIds) rows.push({ ...band, kind: 'equipment', targetId: id })
  }
  return rows
}

/* --- KV ------------------------------------------------------------------ */

/**
 * 押さえを置く。TTL は 420 秒で、値には id をそのまま入れる（空の値を作らない）。
 * `holdId` はルートが振る（応答の `Hold.id` になり、`DELETE` の宛先にもなる）。
 */
export async function putHold(
  kv: KVNamespace,
  input: {
    organizationId: string
    storeId: string
    holdId: string
    startsAt: string
    endsAt: string
    staffId: string | null
    equipmentIds: readonly string[]
    receptionSessionId: string | null
  },
  now: Date,
): Promise<HoldEntry> {
  const metadata: HoldMetadata = {
    staffId: input.staffId,
    equipmentIds: [...input.equipmentIds],
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    receptionSessionId: input.receptionSessionId,
  }
  await kv.put(holdKey(input.organizationId, input.storeId, input.holdId), input.holdId, {
    expirationTtl: HOLD_TTL_SECONDS,
    metadata,
  })
  return { ...metadata, id: input.holdId, expiresAt: holdExpiresAt(now) }
}

/**
 * 押さえを返す。**無かったら `false`**（ルートは 404 `not_found` にする）。
 * 鍵に組織が入っているので、他テナントの `holdId` を消そうとしても届かない。
 *
 * `DELETE /api/staff/holds/:holdId` は path に店舗を持たない（`04-api.md` §3.6）ので、
 * 店舗が分からない呼び出しでは `hold:<orgId>:` を **1 回だけ** list して鍵を探す。
 * 店舗が分かっているなら `storeId` を渡す — list を 1 回節約できる
 * （list は 1,000 回/日で、この設計で最初に当たる上限である。§6.3）。
 */
export async function deleteHold(
  kv: KVNamespace,
  organizationId: string,
  holdId: string,
  storeId?: string,
): Promise<boolean> {
  if (storeId !== undefined && storeId !== '') {
    const key = holdKey(organizationId, storeId, holdId)
    if ((await kv.get(key, 'text')) === null) return false
    await kv.delete(key)
    return true
  }
  const listed = await kv.list({ prefix: `${HOLD_KEY_HEAD}:${organizationId}:` })
  const found = listed.keys.find((key) => key.name.endsWith(`:${holdId}`))
  if (!found) return false
  await kv.delete(found.name)
  return true
}

/**
 * その店舗の生きている押さえを、空き枠エンジンが数える形で返す。
 *
 * **`KV.list` を 1 回だけ叩く。**無料枠の list は 1,000 回/日で、この設計で最初に当たる
 * 上限である（`design/04-api.md` §6.3）。cursor を追わないのは、1 店舗が 420 秒のあいだに
 * 1 ページ（1,000 件）ぶんの押さえを持つことがないためである。
 *
 * **`/api/public/**` からは呼ばない。**Web 予約の閲覧数がそのまま list 数になり、
 * 上限を越えて空き枠が丸ごと落ちる。お客様に「他の端末が押さえ中」を見せる必要は無く、
 * 一次排他は確定時の D1 が担うので、読まなくても二重予約にはならない。
 */
export async function listHoldOccupancies(
  kv: KVNamespace,
  organizationId: string,
  storeId: string,
  now: Date,
): Promise<HoldOccupancy[]> {
  const prefix = holdPrefix(organizationId, storeId)
  const listed = await kv.list<HoldMetadata>({ prefix })
  const entries: HoldEntry[] = []
  for (const key of listed.keys) {
    const metadata = key.metadata
    if (!metadata) continue
    entries.push({
      ...metadata,
      id: key.name.slice(prefix.length),
      // KV の期限は秒。無い行（TTL を付け損ねた行）は生きているものとして扱う。
      expiresAt:
        key.expiration === undefined
          ? holdExpiresAt(now)
          : new Date(key.expiration * 1000).toISOString(),
    })
  }
  return holdOccupancies(entries, now)
}
