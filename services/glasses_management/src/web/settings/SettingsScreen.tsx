import type { StaffMember } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { type ComponentType, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { client, subjectFromToken } from '../client'
import { CalendarPanel } from './CalendarPanel'
import { EquipmentPanel } from './EquipmentPanel'
import { HoursPanel } from './HoursPanel'
import { PurposePanel } from './PurposePanel'
import { PermissionRefusal, SaveBar } from './SaveBar'
import { StaffPanel } from './StaffPanel'
import { StoreInfoPanel } from './StoreInfoPanel'
import {
  actorOf,
  DEFAULT_ACTOR,
  type PanelDraft,
  type SaveOutcome,
  SETTINGS_GROUP_LABEL,
  SETTINGS_SECTIONS,
  type SettingsActor,
  type SettingsPanelProps,
  type SettingsSectionKey,
  toJstDay,
} from './sections'

/*
 * 設定の器（承認済みモック docs/frontend/mockups/eyex/images/SETTINGS-STORE.png）。
 *
 * 実測（SETTINGS-*.html の <style>。6 面とも同じ）:
 *   .set             = 236px + 1fr の 2 列
 *   第2サイドバー     = 地 --color-surface-2 / 右に 1px --color-line / padding 4px 10px 0
 *   項目             = min-height 44px / padding 0 12px / 角 8px。選択中は地 --color-pine
 *   保存バー          = 高さ 56px / padding 0 20px（SaveBar.tsx）
 *   本体             = padding 32px 40px
 *
 * 6 面は 1 つの画面の中で切り替える（面ごとにルートを分けない）。器に
 * overflow: hidden を置かず、本体だけを縦に流す。
 */

/** 文字を 200% にすると rem 基準の幅が実質半分になる。倒す境目を rem で見る。 */
const COMPACT_QUERY = '(max-width: 60rem)'

const DEFAULT_PANELS: Partial<Record<SettingsSectionKey, ComponentType<SettingsPanelProps>>> = {
  store: StoreInfoPanel,
  calendar: CalendarPanel,
  hours: HoursPanel,
  purposes: PurposePanel,
  staff: StaffPanel,
  equipment: EquipmentPanel,
}

/** 保存の顛末に対する言い方。403 は EX-PERMISSION の面で断るので知らせを出さない。 */
const SAVE_NOTICES: Record<SaveOutcome, string | null> = {
  saved: '保存しました',
  failed: '保存できませんでした。入力はそのまま残っています。',
  conflict: 'ほかの端末が先に保存しました。画面を開き直して、もう一度お試しください。',
  forbidden: null,
}

type Summary = {
  dirtyCount: number
  danger: boolean
  dangerNote: string | null
  blocked: string | null
}

const CLEAN: Summary = { dirtyCount: 0, danger: false, dangerNote: null, blocked: null }

export type SettingsScreenProps = {
  storeId: string
  /** いまの時刻（ISO8601）。実行時刻に依存させないため、面へはここから注ぐ。 */
  now?: string
  initialSection?: SettingsSectionKey
  /** 面の差し込み口。まだ無い面は「この面はこれから作ります。」を出す。 */
  panels?: Partial<Record<SettingsSectionKey, ComponentType<SettingsPanelProps>>>
}

export function SettingsScreen({ storeId, now, initialSection, panels }: SettingsScreenProps) {
  const [section, setSection] = useState<SettingsSectionKey>(initialSection ?? 'store')
  const [summary, setSummary] = useState<Summary>(CLEAN)
  const [notice, setNotice] = useState<string | null>(null)
  const [refused, setRefused] = useState<readonly string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const draft = useRef<PanelDraft | null>(null)
  const compact = useCompactSidebar()
  const { actor, staff } = useViewer(storeId)
  const registry = useMemo(() => ({ ...DEFAULT_PANELS, ...panels }), [panels])

  const current = SETTINGS_SECTIONS.find((item) => item.key === section) ?? SETTINGS_SECTIONS[0]
  const title = current?.label ?? '設定'
  const Panel = registry[section]
  /*
   * いまの時刻は 1 度だけ決める。描画のたびに `new Date()` を読むと `now` が毎回
   * 変わり、それを読み口に持つ面（設備と点検・ご来店の目的）が描き直すたびに
   * 読み直して、打ち込んだ下書きを消してしまう。
   */
  const at = useMemo(() => now ?? new Date().toISOString(), [now])

  // 面が値を変えるたびに呼ばれる。中身が同じ知らせで描き直さない。
  const onDraftChange = useCallback((next: PanelDraft) => {
    draft.current = next
    const summarised: Summary = {
      dirtyCount: next.changes.length,
      danger: next.danger,
      dangerNote: next.dangerNote,
      blocked: next.blocked ?? null,
    }
    setSummary((prev) => (same(prev, summarised) ? prev : summarised))
  }, [])

  function goToSection(key: SettingsSectionKey) {
    if (key === section) return
    draft.current = null
    setSection(key)
    setSummary(CLEAN)
    setNotice(null)
    setRefused(null)
  }

  async function onSave() {
    const pending = draft.current
    if (!pending) return
    const changes = [...pending.changes]
    setSaving(true)
    setNotice(null)
    try {
      const outcome = await pending.save()
      setRefused(outcome === 'forbidden' ? changes : null)
      setNotice(SAVE_NOTICES[outcome])
    } catch {
      setNotice(SAVE_NOTICES.failed)
    } finally {
      setSaving(false)
    }
  }

  function onDiscard() {
    draft.current?.discard()
    setNotice(null)
    setRefused(null)
  }

  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label="設定の項目"
        className={cn(
          'flex shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface-2 px-2.5 pt-1',
          compact ? 'w-19 items-center' : 'w-59',
        )}
      >
        {!compact && (
          <p className="px-3 pt-1 text-fine leading-tight text-ink-muted">{SETTINGS_GROUP_LABEL}</p>
        )}
        {SETTINGS_SECTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => goToSection(item.key)}
            aria-current={item.key === section ? 'page' : undefined}
            className={cn(
              'flex min-h-11 items-center rounded-ctl text-body',
              compact ? 'w-13 justify-center' : 'w-full px-3',
              item.key === section ? 'bg-pine font-bold text-on-pine' : 'text-ink',
              focusRing,
            )}
          >
            {/* 柱にたたんでも名前は消さない。目に見えなくなるだけで読み上げには残る。 */}
            <span className={compact ? 'sr-only' : undefined}>{item.label}</span>
            {compact && (
              <span aria-hidden="true" className="text-body font-bold">
                {item.label.slice(0, 1)}
              </span>
            )}
          </button>
        ))}
      </nav>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <SaveBar
          title={title}
          dirtyCount={summary.dirtyCount}
          danger={summary.danger}
          dangerNote={summary.dangerNote}
          blocked={summary.blocked}
          saving={saving}
          onSave={onSave}
          onDiscard={onDiscard}
        />

        <div className="min-h-0 flex-1 overflow-auto px-10 py-8">
          {/* 保存の顛末は割り込まない知らせで伝える（AC-SET-02 / AC-SET-19）。 */}
          <p role="status">
            {notice && (
              <span
                className={cn(
                  'mb-6 inline-block rounded-ctl border px-3 py-2 text-body',
                  notice === SAVE_NOTICES.saved
                    ? 'border-pine-line bg-pine-soft text-pine-deep'
                    : 'border-danger bg-danger-soft text-danger',
                )}
              >
                {notice}
              </span>
            )}
          </p>

          {refused && <PermissionRefusal target={title} actor={actor} changes={refused} />}

          {Panel ? (
            <Panel
              key={section}
              storeId={storeId}
              now={at}
              today={toJstDay(at)}
              actor={actor}
              staff={staff}
              onDraftChange={onDraftChange}
            />
          ) : (
            <p className="text-body text-ink-muted">この面はこれから作ります。</p>
          )}
        </div>
      </section>
    </div>
  )
}

function same(a: Summary, b: Summary): boolean {
  return (
    a.dirtyCount === b.dirtyCount &&
    a.danger === b.danger &&
    a.dangerNote === b.dangerNote &&
    a.blocked === b.blocked
  )
}

/**
 * 第2サイドバーを細い柱に倒すか。文字を 200% にすると 1rem が 32px になるので、
 * rem のメディアクエリがそのまま文字倍率を拾う。
 */
function useCompactSidebar(): boolean {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(COMPACT_QUERY)
    setCompact(query.matches)
    const onChange = (event: MediaQueryListEvent) => setCompact(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return compact
}

/**
 * 403 の本文に出す「操作者（役割）」。いま「自分は誰か」を返す経路が無いので、
 * JWT の `sub` とスタッフの `adminUserId` を突き合わせて名乗りを引き当てる。
 * 引き当てられなければ名前を作らず「ご担当者（スタッフ）」と書く。
 */
function useViewer(storeId: string): {
  actor: SettingsActor
  staff: readonly StaffMember[] | null
} {
  const [staff, setStaff] = useState<readonly StaffMember[] | null>(null)

  useEffect(() => {
    let alive = true
    // 断られたときの名乗りと「最後に直したのは」にしか使わない。取れなくても画面は止めない。
    client.api.staff.stores[':storeId'].staff
      .$get({ param: { storeId } })
      .then(async (res) => (res.ok ? ((await res.json()) as StaffMember[]) : null))
      .then((rows) => {
        if (alive) setStaff(rows)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [storeId])

  const actor = useMemo(() => {
    const subject = subjectFromToken()
    const found = subject ? staff?.find((member) => member.adminUserId === subject) : undefined
    return found ? actorOf(found.displayName, found.role) : DEFAULT_ACTOR
  }, [staff])

  return { actor, staff }
}
