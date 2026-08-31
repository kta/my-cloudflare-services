/**
 * 再生の短命チケット（KV `SHORT_LIVED`）。
 *
 * 録音の本体は非公開の R2 にあり、**署名付き URL もダウンロード URL も画面へ渡さない**
 * （`07-nfr.md` §5.8。渡すと録音が店の外へ出て、誰が聞いたかも残らない）。代わりに
 * 再生を 2 段に割る —
 *
 * 1. `POST .../playback` が**この Worker 宛の**チケットを 1 枚出す（このファイル）。
 * 2. `GET .../stream?token=...` が R2 から読んで `audio/*` をそのまま返す。
 *
 * チケットは `Authorization` ヘッダーの**代わりではなく上乗せ**である。ヘッダーだけで
 * 開けるようにすると、業務トークンを持っている人が録音 id を総当たりするだけで
 * 担当していない店舗の録音まで聞けてしまう。逆にチケットだけで開けるようにすると、
 * URL が 1 本流れた時点で誰でも聞ける。**両方が要る。**
 *
 * 寿命は **900 秒**（`09-open-questions.md` Q-06）。300 秒では最長の録音
 * （HISTORY-LIST の `06:12` = 372 秒）を 1 回聞き通せず、聞いている途中で切れる。
 * WCAG 2.2.1 の時間制限に当たるが、要配慮情報の持ち出しを短く抑えるための
 * essential な例外として主張する（切れたら「もう一度開く」で取り直せる）。
 */

import type { KVNamespace } from '@cloudflare/workers-types'

/** チケットの寿命（秒）。KV の TTL と `expiresAt` の両方がこの 1 つから出る。 */
const TICKET_TTL_SECONDS = 900

/**
 * チケットに書く中身。**録音の実体の在りか（`r2Key`）を書かない** — KV は
 * D1 より漏れやすい場所ではないが、鍵の写しを 2 か所に置く理由が無い。
 */
type TicketBody = {
  recordingId: string
  storeId: string
  /** 誰が聞いたか。監査には別に 1 行残るので、ここは照合用の控えである。 */
  staffId: string | null
}

/** KV の鍵。**組織を鍵に含める**ので、他組織のチケットはそもそも引き当たらない。 */
const ticketKey = (organizationId: string, token: string): string =>
  `play:${organizationId}:${token}`

/**
 * チケットを 1 枚出す。トークンは `crypto.randomUUID()` を 2 本つないだ 64 文字で、
 * 契約（`RecordingPlaybackTicket.token` は 32〜256 文字）の内側にある。
 *
 * **`now` は引数で受ける。**`expiresAt` と KV の TTL が同じ 1 つの時刻から出ないと、
 * 画面が「まだ使える」と思っているチケットが KV から消えている状態が作れてしまう。
 */
export async function issueTicket(
  kv: KVNamespace,
  input: {
    organizationId: string
    recordingId: string
    storeId: string
    staffId: string | null
    now: Date
  },
): Promise<{ token: string; expiresAt: string }> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')
  const body: TicketBody = {
    recordingId: input.recordingId,
    storeId: input.storeId,
    staffId: input.staffId,
  }
  await kv.put(ticketKey(input.organizationId, token), JSON.stringify(body), {
    expirationTtl: TICKET_TTL_SECONDS,
  })
  return {
    token,
    expiresAt: new Date(input.now.getTime() + TICKET_TTL_SECONDS * 1000).toISOString(),
  }
}

/**
 * ストリームの 1 リクエストぶんの検査。**鍵が無い / 別の組織 / 別の録音**のいずれでも偽。
 *
 * 期限切れは KV の TTL が消してくれるので、ここで時刻を見ない（見ると、消し忘れた鍵を
 * 期限だけで通す道と、期限を過ぎた鍵を消す道の 2 本を持つことになる）。
 *
 * 使い切りにはしない。1 回の再生セッションのあいだ `<audio>` が範囲要求を
 * 何度も投げるので、1 回で捨てると再生が最初の数秒で止まる。
 */
export async function verifyTicket(
  kv: KVNamespace,
  input: { organizationId: string; recordingId: string; token: string | undefined },
): Promise<boolean> {
  if (input.token === undefined || input.token === '') return false
  const held = await kv.get(ticketKey(input.organizationId, input.token))
  if (held === null) return false
  // 壊れた値は「無い」として扱う（読めない鍵で再生を通さない）。**投げない** —
  // ここで例外にすると `app.onError` が 500 を返し、聞けない理由が受付に伝わらない。
  try {
    const parsed = JSON.parse(held) as Partial<TicketBody>
    return parsed.recordingId === input.recordingId
  } catch {
    return false
  }
}
