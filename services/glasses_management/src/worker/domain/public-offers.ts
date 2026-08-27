/*
 * 顧客Web予約の候補枠（オファー）を組み立てるための純粋関数。
 *
 * なぜ日付を走査するのか: 承認済みモックの第 2 工程は日付入力を持たず、既製の
 * ショートリストを並べる。空き計算そのものは 1 日単位でしか意味を持たないので、
 * 「今日から数日ぶんを順に計算し、先に埋まった順で必要件数だけ採る」という
 * 走査が候補提示の実体になる。日付は顧客の入力ではなく走査の結果である。
 */

/** JST の today から days 日ぶんの日付キー（YYYY-MM-DD）を昇順で返す。 */
export function upcomingJstDates(todayJst: string, days: number): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(todayJst)) throw new RangeError('invalid JST date key')
  if (!Number.isSafeInteger(days) || days < 1) throw new RangeError('days must be a positive integer')
  // JST 日付キーどうしの加算なので、UTC 正午ではなく 00:00Z 起点で日数だけ足す。
  // 日付キーは時刻を持たないため、この加算に夏時間も時差も入り込まない。
  const start = Date.parse(`${todayJst}T00:00:00.000Z`)
  if (Number.isNaN(start)) throw new RangeError('invalid JST date key')
  return Array.from({ length: days }, (_unused, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  )
}

/**
 * 顧客に見せてよい候補か。開始済みの枠を候補に混ぜると、押せるのに必ず失敗する
 * ボタンを出すことになるので、開始ちょうどの枠も候補から外す。
 */
export function isOfferableSlot(slot: { readonly startAt: string }, now: Date): boolean {
  const startAt = Date.parse(slot.startAt)
  if (Number.isNaN(startAt)) return false
  return startAt > now.getTime()
}
