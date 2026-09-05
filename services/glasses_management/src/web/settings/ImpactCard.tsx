import type { SettingsImpactItem } from '@app/contracts'
import { formatJstDate } from './sections'

/*
 * 「保存の前に、直すと困る件数を見せる」1 枚。設備と点検・ご来店の目的・営業時間の
 * 3 面が同じ位置（右の列）・同じ言い方で使う。
 *
 * 承認済みモックの実測値（docs/frontend/mockups/eye/screens/SETTINGS-EQUIPMENT.html
 * と SETTINGS-PURPOSE.html、assets/eye.css）:
 *   カード = 角 16px / 1px の縁 / padding 20px 22px、行 = padding 8px 0。
 *   赤（止める操作）= 地 --alert-tint・縁 #d9a9a4、茶（延ばす操作）= 地 --walkin-tint・縁 #d9bb92。
 * 縁の 2 色は theme.css にトークンが無いので、対になる文字色から作る
 * （`border-danger/40` = 計算値 #d39f9c、`border-walkin/40` = #d4b28d）。装飾の縁なので
 * 3:1 は要らない — 件数と中身は必ず文字で読める。
 *
 * 件数が 0 のときは 1 文字も出さない（AC-SET-14。「影響はありません」も言わない）。
 * 件数の変化は接客中の読み上げを断ち切らないよう、割り込まない知らせで伝える（AC-SET-19）。
 */

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** UTC の瞬間を JST の壁掛け時計として読む。UTC 15:00 で日付が変わる。 */
function jstClock(instant: string) {
  const shifted = new Date(Date.parse(instant) + JST_OFFSET_MS)
  return {
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: WEEKDAY_JA[shifted.getUTCDay()] ?? '',
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  }
}

/** 「8月28日（金）10:00」。影響カードの 1 行の頭。 */
function formatJstStamp(instant: string): string {
  const at = jstClock(instant)
  return `${at.month}月${at.day}日（${at.weekday}）${at.time}`
}

/** 「2026年8月28日（金）10:00–12:00」。設備の「次の点検」。 */
export function formatJstRange(from: string, to: string): string {
  return `${formatJstDate(from)}${jstTimeOf(from)}–${jstTimeOf(to)}`
}

/** JST の時刻 `HH:MM`。時刻の入力欄に使う。 */
export function jstTimeOf(instant: string): string {
  return jstClock(instant).time
}

/** JST の暦日 + `HH:MM` → UTC の ISO8601。入力欄の値を API の形へ戻す。 */
export function jstInstant(date: string, time: string): string {
  return new Date(Date.parse(`${date}T${time}:00.000Z`) - JST_OFFSET_MS).toISOString()
}

/** JST の暦日を進める（負なら戻る）。月跨ぎ・年跨ぎ・うるう年を素で通す。 */
export function addJstDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

/** 赤は「止める」、茶は「延ばす」。色だけに意味を持たせず、見出しに必ず件数を書く。 */
export type ImpactTone = 'danger' | 'note'

const TONE_CLASS: Record<ImpactTone, string> = {
  danger: 'border-danger/40 bg-danger-soft',
  note: 'border-walkin/40 bg-walkin-soft',
}

export function ImpactCard({
  title,
  items,
  tone,
}: {
  title: string
  items: readonly SettingsImpactItem[]
  tone: ImpactTone
}) {
  return (
    <div role="status">
      {items.length > 0 && (
        <section className={`rounded-panel border px-5.5 py-5 ${TONE_CLASS[tone]}`}>
          <h3 className="text-lead font-bold text-ink">{`${title}　${items.length}件`}</h3>
          <ul aria-label={title} className="mt-1.5">
            {items.map((item, index) => (
              <li
                key={`${item.at}-${item.label}`}
                className={`flex items-center gap-4 py-2 text-body ${
                  index === 0 ? '' : 'border-line border-t'
                }`}
              >
                <span className="whitespace-nowrap text-ink">{formatJstStamp(item.at)}</span>
                <span className="ml-auto text-right text-ink-muted">{item.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
