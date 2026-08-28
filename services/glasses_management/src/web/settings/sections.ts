import type { StaffMember } from '@app/contracts'

/*
 * 設定 6 面の目次と、器（SettingsScreen）と面（*Panel）のあいだの約束。
 *
 * 第2サイドバーに出すのは 6 項目だけにする。承認済みモック
 * （docs/frontend/mockups/eyex/screens/SETTINGS-STORE.html）は 14 項目を描いているが、
 * 残る 8 項目は行き先がまだ無い。押せて何も起きない行を置かない（P1 の決め #1）。
 * 「公開」は P8 が足す。
 */

export type SettingsSectionKey = 'store' | 'calendar' | 'hours' | 'purposes' | 'staff' | 'equipment'

export type SettingsSection = {
  key: SettingsSectionKey
  /** 第2サイドバーの行き先の名前。保存バーの見出しと 403 の本文にもそのまま出る。 */
  label: string
}

/** 第2サイドバーの群の見出し。いまは 1 群しか無い。 */
export const SETTINGS_GROUP_LABEL = '店舗の設定'

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { key: 'store', label: '店舗の情報' },
  { key: 'calendar', label: '営業日' },
  { key: 'hours', label: '営業時間' },
  { key: 'purposes', label: 'ご来店の目的' },
  { key: 'staff', label: 'スタッフと技能' },
  { key: 'equipment', label: '設備と点検' },
]

/** 保存の顛末。器の保存バーがこの 4 つを言い分ける。 */
export type SaveOutcome = 'saved' | 'failed' | 'forbidden' | 'conflict'

/**
 * 面が器へ渡す下書き。値が変わるたびに `onDraftChange` で丸ごと渡す。
 *
 * `changes` の件数がそのまま「未保存の変更 N件」になり、403 で断られたときは
 * 「下書きは残っています」の下にこの行がそのまま並ぶ（AC-SET-17）。
 * `danger` は影響試算の `severity === 'action'` に当たり、`true` のときだけ
 * 札を赤くする。色だけで伝えないので `dangerNote` を必ず添える（AC-SET-14 / 18）。
 */
export type PanelDraft = {
  changes: readonly string[]
  /** 保存を拒む 2 文。null なら押せる。文そのものは面が画面にも出す。 */
  blocked?: string | null
  danger: boolean
  dangerNote: string | null
  save: () => Promise<SaveOutcome>
  discard: () => void
}

/** 403 の本文に出す操作者。`role` は「スタッフ」「店長」の 2 値（AC-SET-17）。 */
export type SettingsActor = {
  name: string
  role: 'staff' | 'manager'
  /** 「中村 彩（スタッフ）」の括弧の中。`role` から導くが、面が直に読めるよう持たせる。 */
  roleLabel: string
}

export type SettingsPanelProps = {
  storeId: string
  /** いまの時刻（ISO8601）。実行時刻に依存させないため必ず器から注ぐ。 */
  now?: string
  /** いまの JST の暦日（YYYY-MM-DD）。`now` から導いて器が渡す。 */
  today?: string
  actor?: SettingsActor
  /** 面のスタッフ一覧（器が 1 度だけ引く）。まだ届いていなければ null。 */
  staff?: readonly StaffMember[] | null
  onDraftChange: (draft: PanelDraft) => void
}

export const ROLE_LABELS: Record<SettingsActor['role'], string> = {
  staff: 'スタッフ',
  manager: '店長',
}

export function actorOf(name: string, role: SettingsActor['role']): SettingsActor {
  return { name, role, roleLabel: ROLE_LABELS[role] }
}

/** 誰か分からないまま名前を作らない。役割は最も弱いほうへ倒す。 */
export const DEFAULT_ACTOR: SettingsActor = actorOf('ご担当者', 'staff')

/**
 * AC-SET-17 の 3 文。`target` は第2サイドバーの項目名で、1 文目と 3 文目に入る。
 * モック EX-PERMISSION は 3 文目を「設定は」と書いているが、spec の型を正とする。
 */
export function refusalText(target: string, actor: SettingsActor): string {
  return `${target}を変えられるのは 店長 だけです。${actor.name}（${actor.roleLabel}）の権限では保存できません。${target}はまだ何も変わっていません。`
}

/** 曜日の呼び名（0=日 … 6=土）。`store_business_hours.weekday` と同じ並び。 */
export const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'] as const

/** 月曜始まりの並び。モックの「曜日ごとの上書き」はこの順で並ぶ。 */
export const WEEKDAYS_FROM_MONDAY = [1, 2, 3, 4, 5, 6, 0] as const

/** JST の暦で `yyyy年M月d日（曜）` を組む。 */
export function formatJstDate(iso: string): string {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(new Date(iso))
  const at = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${at('year')}年${at('month')}月${at('day')}日（${at('weekday')}）`
}

/** JST の暦日（YYYY-MM-DD）。 */
export function toJstDay(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso))
  const at = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${at('year')}-${at('month')}-${at('day')}`
}

/** JST の曜日（0=日 … 6=土）。 */
export function jstWeekday(iso: string): number {
  const label = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  }).format(new Date(iso))
  const found = WEEKDAY_NAMES.indexOf(label as (typeof WEEKDAY_NAMES)[number])
  return found === -1 ? 0 : found
}
