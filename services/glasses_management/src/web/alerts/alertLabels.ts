import type { Alert } from '@app/contracts'

/*
 * お知らせの数え方と言い方を 1 か所に置く。左サイドバーの入口・上のバーのボタン・
 * ALERTS 左の 4 分類が必ずここを通るので、同じ 3 件が場所によって違う数にならない。
 *
 * **数字だけを裸で置かない**（`alertsEntryLabel` / `kindLabel` が必ず単位を付ける）。
 * 数えるのは `audience='store'` の行だけで、運用のアラート（`ops`）はどの数にも入れない。
 */

export type AlertKind = 'all' | 'action' | 'info' | 'resolved'

export type AlertCounts = Record<AlertKind, number>

export const EMPTY_COUNTS: AlertCounts = { all: 0, action: 0, info: 0, resolved: 0 }

export const ALERT_KINDS: readonly { key: AlertKind; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'action', label: 'アラート（対応が必要）' },
  { key: 'info', label: 'お知らせ' },
  { key: 'resolved', label: '対応済み' },
]

/** 左の柱と上のバーの入口の読み上げ名。「3」だけを読ませない。 */
export function alertsEntryLabel(count: number): string {
  return `お知らせ ${count}件`
}

/** 4 分類のボタンの読み上げ名。 */
export function kindLabel(kind: AlertKind, count: number): string {
  const found = ALERT_KINDS.find((item) => item.key === kind)
  return `${found?.label ?? 'お知らせ'} ${count}件`
}

/**
 * 行に添える札。**`severity` と `code` の両方から作る** —— `severity='info'` の行にも
 * 「Web予約」の札が付くので、札の有無を `severity` の判定に使わない。
 */
export function alertTags(alert: Alert): readonly { text: string; tone: 'danger' | 'web' }[] {
  const tags: { text: string; tone: 'danger' | 'web' }[] = []
  if (alert.severity === 'action') tags.push({ text: '対応が必要', tone: 'danger' })
  if (alert.code.startsWith('web_booking.')) tags.push({ text: 'Web予約', tone: 'web' })
  return tags
}

/**
 * 行の右端に置く「次にやること」。**手で対応済みにする操作は作らない** ——
 * ここに出る操作が成功した時点で、その 1 件を対応済みにする。
 */
export function alertAction(alert: Alert): { label: string; kind: 'retry' | 'ledger' } | null {
  if (alert.resolvedAt !== null) return null
  switch (alert.code) {
    case 'recording.upload_failed':
      return { label: 'もう一度送る', kind: 'retry' }
    case 'web_booking.pending':
    case 'web_booking.auto_cancelled':
      return { label: '台帳で確認する', kind: 'ledger' }
    case 'equipment.maintenance_scheduled':
    case 'store.closed_with_reservations':
      return { label: '影響する予約を見る', kind: 'ledger' }
    default:
      return null
  }
}

/** 1 件が対応済みになったときの数の動き（サーバへ数え直しに行かずに済ませる）。 */
export function resolveOne(counts: AlertCounts, alert: Alert): AlertCounts {
  return {
    all: Math.max(0, counts.all - 1),
    action: alert.severity === 'action' ? Math.max(0, counts.action - 1) : counts.action,
    info: alert.severity === 'info' ? Math.max(0, counts.info - 1) : counts.info,
    resolved: counts.resolved + 1,
  }
}

/** 「対応が必要」を先頭へ。同じ重さのなかは新しい順。 */
export function sortAlerts(items: readonly Alert[]): readonly Alert[] {
  return [...items].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'action' ? -1 : 1
    return a.occurredAt < b.occurredAt ? 1 : -1
  })
}

/** 右ペインの日付の見出し（「本日 8月27日（木）」）。暦日は器から注ぐ。 */
export function todayHeading(today: string): string {
  const [year = '2026', month = '1', day = '1'] = today.split('-')
  const weekday = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  }).format(new Date(`${year}-${month}-${day}T03:00:00.000Z`))
  return `本日 ${Number(month)}月${Number(day)}日（${weekday}）`
}

/** 行の左端の時刻（JST の `H:mm`）。 */
export function alertTime(occurredAt: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(occurredAt))
}
