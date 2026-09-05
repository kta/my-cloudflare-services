import { type VisitPurpose, WebBookingSettings, WebPreviewResult } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { client } from '../client'
import { LoadFailed } from '../shell/LoadFailed'
import type { PanelDraft, SaveOutcome, SettingsPanelProps } from './sections'

/*
 * 設定 — Web予約の公開（承認済みモック docs/frontend/mockups/eye/images/SETTINGS-WEB.png）。
 *
 * この面の仕事は「お客様に何がどう見えるか」を保存の前に見せることである。
 * 左を触ると右のプレビューがその場で変わり、店内名・技能・設備が 1 つも出ていないことを
 * 店長が自分の目で確かめてから公開する。
 *
 * 実測（SETTINGS-WEB.html の <style>）:
 *   .cols      = 1fr + 300px / gap 28px
 *   .groupname = margin 20px 2px 10px
 *   .grouped .gr = min-height 52px、.setbody .lines > * = padding 14px 0
 *   .pv        = 角 16px / 1px --color-line-strong。帯は緑地に白（padding 12px 16px）
 *   .pv-body   = padding 18px 16px 20px。1 件は min-height 56px / padding 8px 14px / 角 12px
 *   .pv-note   = margin-top 16px / padding 12px 14px / 角 8px / 地 --color-pine-soft
 * モックの 14px・15px はトークンに無いので、大小の関係だけ保って
 * 問い 16px（--text-body）> 件名 13px（--text-grid）> 補足 12px（--text-note）に翻訳した。
 *
 * モックと違うところ（`P8-web-booking.md` §0.2）:
 *   #5 「受け付ける内容」は 5 行（「何時間先から受ける」を足す。既定は 2 時間先から）
 *   #6 プレビューは公開する目的の全件（銀座店は 5 件。モックは 4 件）
 *
 * モックの `<span class="toggle" aria-hidden="true">` はそのまま持ち込まない ——
 * 見た目だけの偽物の切り替えでは読み上げも操作もできないので、行そのものを
 * `role="switch"` の押せる 52px にして、つまみは `aria-hidden` の絵に落とす。
 * 各行の `›` も出さない —— その場で直せる欄に「別の面へ行く」印を付けない
 * （StoreInfoPanel と同じ判断）。行き先の面はまだ無い。
 */

/** お知らせ文の上限。画面の「27文字／120文字まで」と同じ**符号位置**で数える。 */
const MESSAGE_MAX = 120

const NO_PURPOSE_PUBLISHED =
  '公開する目的が 0 件のため公開できません。ご来店の目的を 1 つ以上 Web に出してください。'
const CLOSES_BEFORE_OPENS =
  '受け付ける終了が開始より前のため保存できません。終了の時刻を直してください。'
const WINDOW_OUT_OF_RANGE =
  '受け付ける範囲が決められる幅を超えているため保存できません。何時間先から（0〜168）と何日先まで（1〜180）を直してください。'

/** 承認要否は 1 値しか無い。自動確定の選択肢を作らない（`04-api.md` §4.10）。 */
const APPROVAL_LABEL = 'お店が確かめてから確定する'

type Settings = WebBookingSettings

type Draft = {
  isPublished: boolean
  opensAt: string
  closesAt: string
  /** 入力欄の生の値。空にできるので数では持たない。 */
  acceptFromHours: string
  acceptUntilDays: string
  message: string
  publishedPurposeIds: string[]
}

function toDraft(settings: Settings): Draft {
  return {
    isPublished: settings.isPublished,
    opensAt: settings.opensAt,
    closesAt: settings.closesAt,
    acceptFromHours: String(settings.acceptFromHours),
    acceptUntilDays: String(settings.acceptUntilDays),
    message: settings.message,
    publishedPurposeIds: [...settings.publishedPurposeIds],
  }
}

const publishLabel = (isPublished: boolean): string =>
  isPublished ? '公開しています' : '公開していません'

/** モックの `10:30–18:00` は半角ハイフンではなく en dash（U+2013）。 */
const hoursLabel = (draft: Draft): string => `${draft.opensAt}–${draft.closesAt}`

const countOf = (text: string): number => [...text].length

function integerIn(raw: string, min: number, max: number): number | null {
  const value = Number(raw)
  if (raw.trim() === '' || !Number.isInteger(value) || value < min || value > max) return null
  return value
}

export function WebPublishPanel({ storeId, onDraftChange }: SettingsPanelProps) {
  const fieldId = useId()
  const [saved, setSaved] = useState<Settings | null>(null)
  const [purposes, setPurposes] = useState<readonly VisitPurpose[]>([])
  const [storeName, setStoreName] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [failed, setFailed] = useState(false)
  // 読み直しの合図。読み込みの useEffect の依存に入れる。
  const [reloadCount, setReloadCount] = useState(0)
  const [editingMessage, setEditingMessage] = useState(false)

  const load = useCallback(async () => {
    const [settingsRes, purposesRes, previewRes] = await Promise.all([
      client.api.staff['web-booking-settings'][':storeId'].$get({ param: { storeId } }),
      client.api.staff.purposes.$get(),
      /*
       * プレビューはお客様に見せる店名（`stores.name_public`）を取るために 1 度だけ読む。
       * 中身（ご用件とお知らせ文）は保存で送るのと同じ下書きから直に描く —— 1 打鍵ごとに
       * Worker を叩かないためと、公開に**足した**目的が保存の前から映るようにするため
       * （`GET .../preview` は既に公開している目的しか返さない）。
       */
      client.api.staff['web-booking-settings'][':storeId'].preview.$get({ param: { storeId } }),
    ])
    if (!settingsRes.ok || !purposesRes.ok || !previewRes.ok) throw new Error('web-booking')
    const settings = WebBookingSettings.parse(await settingsRes.json())
    setSaved(settings)
    setDraft(toDraft(settings))
    setPurposes((await purposesRes.json()) as VisitPurpose[])
    setStoreName(WebPreviewResult.parse(await previewRes.json()).storeName)
    setEditingMessage(false)
  }, [storeId])

  useEffect(() => {
    load().catch(() => setFailed(true))
  }, [load, reloadCount])

  const changes = useMemo(() => {
    if (!saved || !draft) return []
    const before = toDraft(saved)
    const lines: string[] = []
    if (draft.isPublished !== before.isPublished) {
      lines.push(
        `「Web予約を公開する」を ${publishLabel(before.isPublished)} から ${publishLabel(draft.isPublished)} に変える`,
      )
    }
    if (draft.publishedPurposeIds.length !== before.publishedPurposeIds.length) {
      lines.push(
        `「公開する目的」を ${before.publishedPurposeIds.length}件 から ${draft.publishedPurposeIds.length}件 に変える`,
      )
    }
    if (draft.opensAt !== before.opensAt || draft.closesAt !== before.closesAt) {
      lines.push(`「受け付ける時間」を ${hoursLabel(before)} から ${hoursLabel(draft)} に変える`)
    }
    if (draft.acceptFromHours !== before.acceptFromHours) {
      lines.push(
        `「何時間先から受ける」を ${before.acceptFromHours}時間先 から ${draft.acceptFromHours}時間先 に変える`,
      )
    }
    if (draft.acceptUntilDays !== before.acceptUntilDays) {
      lines.push(
        `「何日先まで受ける」を ${before.acceptUntilDays}日先 から ${draft.acceptUntilDays}日先 に変える`,
      )
    }
    if (draft.message !== before.message) lines.push('「お客様へのお知らせ文」を書き換える')
    return lines
  }, [saved, draft])

  /**
   * 保存を拒む 2 文。**画面にも必ず出す**（札を消すだけで終えない）。
   * 目的が 0 件のときに切り替えを勝手に倒さない —— 出すのをやめるかどうかは店長が決める。
   */
  const blocked = useMemo(() => {
    if (!draft) return null
    if (draft.isPublished && draft.publishedPurposeIds.length === 0) return NO_PURPOSE_PUBLISHED
    if (draft.opensAt >= draft.closesAt) return CLOSES_BEFORE_OPENS
    if (
      integerIn(draft.acceptFromHours, 0, 168) === null ||
      integerIn(draft.acceptUntilDays, 1, 180) === null
    ) {
      return WINDOW_OUT_OF_RANGE
    }
    return null
  }, [draft])

  const latest = useRef({ saved, draft, load })
  latest.current = { saved, draft, load }

  const save = useCallback(async (): Promise<SaveOutcome> => {
    const state = latest.current
    const current = state.draft
    const base = state.saved
    if (!current || !base) return 'failed'
    const acceptFromHours = integerIn(current.acceptFromHours, 0, 168)
    const acceptUntilDays = integerIn(current.acceptUntilDays, 1, 180)
    if (acceptFromHours === null || acceptUntilDays === null) return 'failed'
    try {
      const res = await client.api.staff['web-booking-settings'][':storeId'].$put({
        param: { storeId },
        json: {
          isPublished: current.isPublished,
          opensAt: current.opensAt,
          closesAt: current.closesAt,
          acceptFromHours,
          acceptUntilDays,
          // この面は締切を触らない。読んだ値をそのまま返し、他の面の保存を巻き戻さない。
          changeDeadlineDays: base.changeDeadlineDays,
          requiresApproval: true,
          message: current.message,
          publishedPurposeIds: current.publishedPurposeIds,
          version: base.version,
        },
      })
      const status: number = res.status
      if (status === 403) return 'forbidden'
      if (status === 409) return 'conflict'
      if (!res.ok) return 'failed'
      const next = WebBookingSettings.parse(await res.json())
      setSaved(next)
      setDraft(toDraft(next))
      setEditingMessage(false)
      return 'saved'
    } catch {
      return 'failed'
    }
  }, [storeId])

  const discard = useCallback(() => {
    const state = latest.current
    if (state.saved) setDraft(toDraft(state.saved))
    setEditingMessage(false)
  }, [])

  const changesKey = changes.join('\n')

  useEffect(() => {
    const next: PanelDraft = {
      changes: changesKey === '' ? [] : changesKey.split('\n'),
      blocked,
      danger: false,
      dangerNote: null,
      save,
      discard,
    }
    onDraftChange(next)
  }, [onDraftChange, changesKey, blocked, save, discard])

  if (failed) {
    return (
      <LoadFailed
        what="Web予約の公開"
        onRetry={() => {
          setFailed(false)
          setReloadCount((n) => n + 1)
        }}
      />
    )
  }
  if (!saved || !draft) {
    return (
      <p role="status" className="text-body text-ink-muted">
        Web予約の公開を読み込んでいます…
      </p>
    )
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))

  const togglePurpose = (purposeId: string) =>
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            publishedPurposeIds: prev.publishedPurposeIds.includes(purposeId)
              ? prev.publishedPurposeIds.filter((row) => row !== purposeId)
              : [...prev.publishedPurposeIds, purposeId],
          }
        : prev,
    )

  /** 右のプレビューに出す 5 件。**対客名と目安の分数だけ**で、店内名も技能も持たない。 */
  const previewPurposes = purposes.filter((purpose) =>
    draft.publishedPurposeIds.includes(purpose.id),
  )
  const messageLength = countOf(draft.message)

  return (
    <div className="flex flex-wrap gap-7">
      <div className="min-w-0 flex-1">
        <GroupName className="mt-0">公開</GroupName>
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <button
            type="button"
            role="switch"
            aria-checked={draft.isPublished}
            aria-labelledby={`${fieldId}-publish`}
            onClick={() => set('isPublished', !draft.isPublished)}
            className={cn(
              'flex w-full min-h-13 items-center gap-4 border-b border-line px-4 py-2 text-left',
              focusRing,
            )}
          >
            <span id={`${fieldId}-publish`} className="text-body text-ink">
              Web予約を公開する
            </span>
            <span className="ml-auto text-body text-ink-muted">
              {publishLabel(draft.isPublished)}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'relative h-8 w-13 shrink-0 rounded-full',
                draft.isPublished ? 'bg-pine' : 'bg-busy',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 size-7 rounded-full bg-surface',
                  draft.isPublished ? 'left-5.5' : 'left-0.5',
                )}
              />
            </span>
          </button>
          <div className="flex min-h-13 items-center gap-4 px-4 py-2">
            <span className="text-body text-ink">ご案内のページ</span>
            <span className="ml-auto font-mono text-body text-ink-muted">{saved.landingPath}</span>
          </div>
        </div>

        <GroupName>受け付ける内容</GroupName>
        <ul aria-label="受け付ける内容">
          <Line>
            <div className="flex min-h-13 items-center gap-4">
              <span className="text-body text-ink">公開する目的</span>
              <span className="ml-auto text-body text-ink-muted">
                {draft.publishedPurposeIds.length}件
              </span>
            </div>
            <fieldset>
              <legend className="sr-only">公開する目的</legend>
              {purposes.map((purpose) => (
                <label
                  key={purpose.id}
                  className="flex min-h-11 items-center gap-3 text-body text-ink"
                >
                  <input
                    type="checkbox"
                    checked={draft.publishedPurposeIds.includes(purpose.id)}
                    onChange={() => togglePurpose(purpose.id)}
                    className={cn('size-5 shrink-0 accent-pine', focusRing)}
                  />
                  <span>{purpose.namePublic}</span>
                  <span className="ml-auto text-grid text-ink-muted">
                    約{purpose.durationMinutes}分
                  </span>
                </label>
              ))}
            </fieldset>
          </Line>

          <Line>
            <div className="flex min-h-13 flex-wrap items-center gap-3">
              <span className="text-body text-ink">受け付ける時間</span>
              <span className="ml-auto flex items-center gap-2">
                <TimeField
                  label="受け付ける開始"
                  value={draft.opensAt}
                  onChange={(value) => set('opensAt', value)}
                />
                <span aria-hidden="true" className="text-body text-ink-muted">
                  –
                </span>
                <TimeField
                  label="受け付ける終了"
                  value={draft.closesAt}
                  onChange={(value) => set('closesAt', value)}
                />
              </span>
            </div>
          </Line>

          <Line>
            <NumberRow
              label="何時間先から受ける"
              unit="時間先から"
              min={0}
              max={168}
              value={draft.acceptFromHours}
              onChange={(value) => set('acceptFromHours', value)}
            />
          </Line>

          <Line>
            <NumberRow
              label="何日先まで受ける"
              unit="日先まで"
              min={1}
              max={180}
              value={draft.acceptUntilDays}
              onChange={(value) => set('acceptUntilDays', value)}
            />
          </Line>

          <Line>
            <div className="flex min-h-13 flex-wrap items-center gap-3">
              <span className="text-body text-ink">ご予約の確定</span>
              <span className="ml-auto text-body text-ink-muted">{APPROVAL_LABEL}</span>
            </div>
            <p className="text-grid text-ink-muted">自動で確定する選び方はありません。</p>
          </Line>
        </ul>

        {blocked && (
          <p role="status" className="mt-3 px-0.5 text-grid font-semibold text-danger">
            {blocked}
          </p>
        )}

        <div className="flex flex-wrap items-baseline gap-2.5">
          <GroupName>お客様へのお知らせ文</GroupName>
          {draft.message !== saved.message && (
            <span className="inline-block min-h-5.5 rounded-ctl border border-line-strong bg-surface px-2 py-px text-note font-semibold text-ink-muted">
              未保存
            </span>
          )}
        </div>
        <div className="rounded-panel border border-line bg-surface px-5.5 py-5">
          {editingMessage ? (
            <textarea
              aria-label="お客様へのお知らせ文"
              value={draft.message}
              rows={3}
              onChange={(event) =>
                // 上限は符号位置で数える。`maxLength` は UTF-16 長なので絵文字が 2 文字になる。
                set('message', [...event.target.value].slice(0, MESSAGE_MAX).join(''))
              }
              className={cn(
                'w-full rounded-ctl border border-line-strong bg-surface px-3 py-2 text-body leading-loose text-ink',
                focusRing,
              )}
            />
          ) : (
            <p className="text-body leading-loose text-ink">
              {draft.message === '' ? 'お知らせ文はまだありません。' : draft.message}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-grid text-ink-muted">{`${messageLength}文字／${MESSAGE_MAX}文字まで`}</span>
            <button
              type="button"
              onClick={() => setEditingMessage((open) => !open)}
              className={cn(
                'ml-auto min-h-11 rounded-ctl border border-line-strong px-4 text-body font-semibold text-ink',
                focusRing,
              )}
            >
              {editingMessage ? '書き終わる' : '書き直す'}
            </button>
          </div>
        </div>
      </div>

      <div className="w-75 min-w-0">
        <GroupName id={`${fieldId}-preview`} className="mt-0">
          お客様の画面の見え方
        </GroupName>
        <section
          aria-labelledby={`${fieldId}-preview`}
          className="overflow-hidden rounded-panel border border-line-strong bg-surface"
        >
          <p className="bg-pine px-4 py-3 text-grid font-bold text-on-pine">{`${storeName}　ご予約`}</p>
          <div className="px-4 pt-4.5 pb-5">
            <p className="mb-3 text-body font-bold text-ink">ご来店の目的をお選びください</p>
            {previewPurposes.length === 0 ? (
              <p className="text-grid text-ink-muted">
                公開する目的が 0 件なので、お客様には何も出ません。
              </p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {previewPurposes.map((purpose) => (
                  <li
                    key={purpose.id}
                    className="flex min-h-14 flex-col justify-center rounded-card border border-line-strong px-3.5 py-2"
                  >
                    <span className="text-grid font-semibold text-ink">{purpose.namePublic}</span>
                    <span className="text-note text-ink-muted">約{purpose.durationMinutes}分</span>
                  </li>
                ))}
              </ul>
            )}
            {draft.message !== '' && (
              <p className="mt-4 rounded-ctl bg-pine-soft px-3.5 py-3 text-grid leading-relaxed text-pine-deep">
                {draft.message}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

/** 群の見出し（`.groupname` = margin 20px 2px 10px / 13px 600 --color-ink-muted）。 */
function GroupName({
  children,
  id,
  className,
}: {
  children: ReactNode
  id?: string
  className?: string
}) {
  return (
    <h3
      id={id}
      className={cn('mt-5 mb-2.5 px-0.5 text-grid font-semibold text-ink-muted', className)}
    >
      {children}
    </h3>
  )
}

/** 罫だけの一覧の 1 行（`.setbody .lines > *` = padding 14px 0、先頭行は罫なし）。 */
function Line({ children }: { children: ReactNode }) {
  return <li className="border-t border-line py-3.5 first:border-t-0">{children}</li>
}

function TimeField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <input
      aria-label={label}
      type="time"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        'min-h-11 shrink-0 rounded-ctl border border-line-strong bg-surface px-2 text-right font-mono text-body text-ink',
        focusRing,
      )}
    />
  )
}

function NumberRow({
  label,
  unit,
  min,
  max,
  value,
  onChange,
}: {
  label: string
  unit: string
  min: number
  max: number
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex min-h-13 flex-wrap items-center gap-3">
      <span className="text-body text-ink">{label}</span>
      <span className="ml-auto flex items-center gap-2">
        <input
          aria-label={label}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            'min-h-11 w-20 rounded-ctl border border-line-strong bg-surface px-2 text-right font-mono text-body text-ink',
            focusRing,
          )}
        />
        <span className="text-body text-ink-muted">{unit}</span>
      </span>
    </div>
  )
}
