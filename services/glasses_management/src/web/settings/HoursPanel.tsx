import type { BusinessHoursRow, BusinessHoursView } from '@app/contracts'
import { cn, focusRing } from '@app/ui'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { acceptableWindows, lastAcceptableStart } from '../../worker/domain/store-settings'
import { client } from '../client'
import { LoadFailed } from '../shell/LoadFailed'
import {
  jstWeekday,
  type SaveOutcome,
  type SettingsPanelProps,
  WEEKDAY_NAMES,
  WEEKDAYS_FROM_MONDAY,
} from './sections'

/*
 * 営業時間（承認済みモック docs/frontend/mockups/eyex/images/SETTINGS-HOURS.png）。
 *
 * 実測: .cols = 1fr + 1fr / gap 24px。群の見出しは margin 28px 2px 12px。
 * グループ表の行は min-height 56px。「＋ 止める時間帯を足す」は表の最後の行で
 * 文字は --color-pine の 600。「曜日ごとの上書き」「予約の間隔」は罫だけの行
 * （padding 16px 0）。最後の 1 行は 13px --color-ink-muted。
 *
 * モックの「お昼の休憩 13:00–14:00」は 12:00–13:00 の誤記（P1 の決め #6）。
 * 「通常の営業時間」の 3 行目（お昼の休憩）は出さない —— `break_start` /
 * `break_end` は常に NULL で、どの帯が昼かはラベルの決め打ちでしか選べない。
 * 帯は右の「受付を止める時間帯」1 か所で直す。
 *
 * 「最後にお受けできる時刻」は画面で計算しない。空き枠エンジンと式が 2 つに
 * 割れると、案内した時刻と押せる枠が食い違う（T-009）。サーバの
 * `SlotRulesView.lastAcceptableAt` が載っているときだけ出す。
 */

const CLOSES_BEFORE_OPENS = '閉店が開店より前のため保存できません。閉店の時刻を直してください。'
const BLACKOUT_OUTSIDE_HOURS =
  '受付を止める時間帯が営業時間の外にあるため保存できません。時間を直してください。'

type Band = { key: string; label: string; startsAt: string; endsAt: string }

type SlotRulesResponse = {
  slotMinutes: number
  cleanupMinutes: number
  maxParallel: number
  version: number
  updatedAt: string
  lastAcceptableAt?: Record<string, string | null>
}

type Draft = {
  opensAt: string
  closesAt: string
  bands: Band[]
  slotMinutes: number
  cleanupMinutes: number
  maxParallel: number
}

type Loaded = {
  hours: BusinessHoursView
  rules: SlotRulesResponse
  /** いちばん短いご用件の所要。引けなかったときは null（そのときは保存済みの値を出す）。 */
  shortestDurationMinutes: number | null
}

export function HoursPanel({ storeId, now, onDraftChange }: SettingsPanelProps) {
  const fieldId = useId()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [failed, setFailed] = useState(false)
  // 読み直しの合図。読み込みの useEffect の依存に入れる。
  const [reloadCount, setReloadCount] = useState(0)
  const [adding, setAdding] = useState<{ label: string; startsAt: string; endsAt: string } | null>(
    null,
  )

  useEffect(() => {
    let alive = true
    Promise.all([
      client.api.staff.stores[':storeId']['business-hours'].$get({ param: { storeId } }),
      client.api.staff.stores[':storeId']['slot-rules'].$get({ param: { storeId } }),
      // いちばん短いご用件。「最後にお受けできる時刻」を下書きから引き直すのに要る。
      client.api.staff.purposes.$get({ query: { storeId } }),
    ])
      .then(async ([hoursRes, rulesRes, purposeRes]) => {
        if (!hoursRes.ok || !rulesRes.ok) throw new Error('load failed')
        const purposes = purposeRes.ok
          ? ((await purposeRes.json()) as { durationMinutes: number; isActive?: boolean }[])
          : []
        const durations = purposes
          .filter((row) => row.isActive !== false)
          .map((row) => row.durationMinutes)
        return {
          hours: (await hoursRes.json()) as BusinessHoursView,
          rules: (await rulesRes.json()) as SlotRulesResponse,
          shortestDurationMinutes: durations.length === 0 ? null : Math.min(...durations),
        }
      })
      .then((next) => {
        if (!alive) return
        setLoaded(next)
        setDraft(toDraft(next))
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [storeId, reloadCount])

  const base = useMemo(() => (loaded ? toDraft(loaded) : null), [loaded])

  const changes = useMemo(() => (base && draft ? describeChanges(base, draft) : []), [base, draft])

  const blocked = useMemo(() => {
    if (!draft) return []
    const messages: string[] = []
    if (draft.closesAt <= draft.opensAt) messages.push(CLOSES_BEFORE_OPENS)
    const outside = draft.bands.some(
      (band) =>
        band.startsAt >= band.endsAt ||
        band.startsAt < draft.opensAt ||
        band.endsAt > draft.closesAt,
    )
    if (outside) messages.push(BLACKOUT_OUTSIDE_HOURS)
    return messages
  }, [draft])

  const warnings = useMemo(() => {
    if (!draft || draft.slotMinutes >= draft.cleanupMinutes) return []
    // 文言の正本は src/worker/domain/store-settings.ts の warnBusinessHours。
    // 保存の前に出す必要があるので、比較 1 つぶんだけ画面にも置く。
    return [
      `予約の刻み（${draft.slotMinutes}分）が 1件あたりの片付け（${draft.cleanupMinutes}分）より短いため、続けてお受けできない時刻ができます。`,
    ]
  }, [draft])

  const save = useCallback(async (): Promise<SaveOutcome> => {
    if (!loaded || !draft) return 'failed'
    const days = baseWeekdays(loaded.hours.rows)
    const rows: BusinessHoursRow[] = loaded.hours.rows.map((row) =>
      days.has(row.weekday) ? { ...row, opensAt: draft.opensAt, closesAt: draft.closesAt } : row,
    )
    const blackouts = [
      // 基準と違う曜日（定休・金・日）の帯はこの面で触っていないので、そのまま返す。
      ...loaded.hours.blackouts
        .filter((band) => !days.has(band.weekday))
        .map(({ id: _id, ...rest }) => rest),
      ...[...days].flatMap((weekday) =>
        draft.bands.map((band, index) => ({
          weekday,
          startsAt: band.startsAt,
          endsAt: band.endsAt,
          label: band.label,
          sortOrder: index,
        })),
      ),
    ]

    const hoursRes = await client.api.staff.stores[':storeId']['business-hours'].$put({
      param: { storeId },
      json: { rows, blackouts, version: loaded.hours.version },
    })
    const hoursStatus: number = hoursRes.status
    if (hoursStatus === 403) return 'forbidden'
    if (hoursStatus === 409) return 'conflict'
    if (!hoursRes.ok) return 'failed'
    const hours = (await hoursRes.json()) as BusinessHoursView

    // 版は 1 本しか無いので、2 本目は 1 本目が進めた版を持ち越す。
    const rulesRes = await client.api.staff.stores[':storeId']['slot-rules'].$put({
      param: { storeId },
      json: {
        slotMinutes: draft.slotMinutes,
        cleanupMinutes: draft.cleanupMinutes,
        maxParallel: draft.maxParallel,
        version: hours.version,
      },
    })
    const rulesStatus: number = rulesRes.status
    if (rulesStatus === 403) return 'forbidden'
    if (rulesStatus === 409) return 'conflict'
    if (!rulesRes.ok) return 'failed'

    const next = {
      hours,
      rules: (await rulesRes.json()) as SlotRulesResponse,
      // ご用件は保存で変わらないので、読み込んだときの値をそのまま持ち越す。
      shortestDurationMinutes: loaded.shortestDurationMinutes,
    }
    setLoaded(next)
    setDraft(toDraft(next))
    setAdding(null)
    return 'saved'
  }, [draft, loaded, storeId])

  const discard = useCallback(() => {
    if (loaded) setDraft(toDraft(loaded))
    setAdding(null)
  }, [loaded])

  useEffect(() => {
    onDraftChange({
      changes,
      blocked: blocked[0] ?? null,
      danger: false,
      dangerNote: null,
      save,
      discard,
    })
  }, [onDraftChange, changes, blocked, save, discard])

  if (failed)
    return (
      <LoadFailed
        what="営業時間"
        onRetry={() => {
          setFailed(false)
          setReloadCount((n) => n + 1)
        }}
      />
    )
  if (!loaded || !draft)
    return (
      <p role="status" className="text-body text-ink-muted">
        営業時間を読み込んでいます…
      </p>
    )

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev))

  const setBand = (key: string, patch: Partial<Band>) =>
    setDraft((prev) =>
      prev
        ? { ...prev, bands: prev.bands.map((b) => (b.key === key ? { ...b, ...patch } : b)) }
        : prev,
    )

  const weekday = jstWeekday(now ?? new Date().toISOString())
  /*
   * 「最後にお受けできる時刻」は**いま打ち込んでいる下書きから引き直す**。
   * 保存済みの値をそのまま出していたころ、閉店を 19:00 → 18:00 に直しても
   * この 1 行は動かず、保存する前に何が起きるかを確かめる役に立たなかった
   * （実装不足の洗い出し settings-02）。
   * いちばん短いご用件を引けなかったときだけ、保存済みの値へ落とす。
   */
  const savedLastAcceptable = loaded.rules.lastAcceptableAt?.[String(weekday)] ?? null
  const lastAcceptable =
    loaded.shortestDurationMinutes === null
      ? savedLastAcceptable
      : lastAcceptableStart({
          windows: acceptableWindows(
            draft.opensAt,
            draft.closesAt,
            draft.bands.map((band) => ({
              weekday,
              startsAt: band.startsAt,
              endsAt: band.endsAt,
            })),
          ),
          shortestDurationMinutes: loaded.shortestDurationMinutes,
          cleanupMinutes: draft.cleanupMinutes,
          closesAt: draft.closesAt,
        })

  return (
    <div>
      <div className="flex flex-wrap gap-6">
        <div className="min-w-0 flex-1">
          <fieldset className="min-w-0">
            <Legend className="mt-0">通常の営業時間</Legend>
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <TimeRow
                id={`${fieldId}-opens`}
                label="開店"
                value={draft.opensAt}
                onChange={(value) => set('opensAt', value)}
              />
              <TimeRow
                id={`${fieldId}-closes`}
                label="閉店"
                value={draft.closesAt}
                onChange={(value) => set('closesAt', value)}
              />
            </div>
          </fieldset>

          {blocked.map((message) => (
            <p
              key={message}
              role="status"
              className="mt-3 px-0.5 text-grid font-semibold text-danger"
            >
              {message}
            </p>
          ))}

          <fieldset className="min-w-0">
            <Legend>曜日ごとの上書き</Legend>
            <ul>
              {overrideLines(loaded.hours.rows).map((line) => (
                <li
                  key={line.label}
                  className="flex min-h-14 items-center gap-4 border-t border-line py-4 first:border-t-0"
                >
                  <span className="whitespace-nowrap text-body text-ink">{line.label}</span>
                  <span
                    className={cn('ml-auto text-body text-ink-muted', line.mono && 'font-mono')}
                  >
                    {line.value}
                  </span>
                </li>
              ))}
            </ul>
          </fieldset>
        </div>

        <div className="min-w-0 flex-1">
          <fieldset className="min-w-0">
            <Legend className="mt-0">受付を止める時間帯</Legend>
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              {draft.bands.map((band, index) => (
                <fieldset
                  key={band.key}
                  className="flex min-h-14 items-center gap-2 border-b border-line px-4 py-2 last:border-b-0"
                >
                  <legend className="sr-only">受付を止める時間帯 {index + 1}</legend>
                  <input
                    aria-label="名前"
                    value={band.label}
                    onChange={(e) => setBand(band.key, { label: e.target.value })}
                    autoComplete="off"
                    className={cn(
                      'min-h-11 w-full min-w-0 rounded-ctl bg-surface px-2 text-body text-ink',
                      focusRing,
                    )}
                  />
                  <input
                    aria-label="開始"
                    type="time"
                    value={band.startsAt}
                    onChange={(e) => setBand(band.key, { startsAt: e.target.value })}
                    className={cn(
                      'min-h-11 shrink-0 rounded-ctl bg-surface px-2 text-right font-mono text-body text-ink',
                      focusRing,
                    )}
                  />
                  <span aria-hidden="true" className="text-body text-ink-muted">
                    –
                  </span>
                  <input
                    aria-label="終了"
                    type="time"
                    value={band.endsAt}
                    onChange={(e) => setBand(band.key, { endsAt: e.target.value })}
                    className={cn(
                      'min-h-11 shrink-0 rounded-ctl bg-surface px-2 text-right font-mono text-body text-ink',
                      focusRing,
                    )}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      set(
                        'bands',
                        draft.bands.filter((b) => b.key !== band.key),
                      )
                    }
                    className={cn(
                      'min-h-11 shrink-0 rounded-ctl px-3 text-body font-semibold text-danger',
                      focusRing,
                    )}
                  >
                    消す
                  </button>
                </fieldset>
              ))}

              {adding ? (
                <div className="flex min-h-14 flex-wrap items-center gap-2 px-4 py-2">
                  <input
                    aria-label="足す時間帯の名前"
                    value={adding.label}
                    onChange={(e) => setAdding({ ...adding, label: e.target.value })}
                    autoComplete="off"
                    className={cn(
                      'min-h-11 w-full min-w-0 flex-1 rounded-ctl border border-line bg-surface px-2 text-body text-ink',
                      focusRing,
                    )}
                  />
                  <input
                    aria-label="足す時間帯の開始"
                    type="time"
                    value={adding.startsAt}
                    onChange={(e) => setAdding({ ...adding, startsAt: e.target.value })}
                    className={cn(
                      'min-h-11 shrink-0 rounded-ctl border border-line bg-surface px-2 font-mono text-body text-ink',
                      focusRing,
                    )}
                  />
                  <input
                    aria-label="足す時間帯の終了"
                    type="time"
                    value={adding.endsAt}
                    onChange={(e) => setAdding({ ...adding, endsAt: e.target.value })}
                    className={cn(
                      'min-h-11 shrink-0 rounded-ctl border border-line bg-surface px-2 font-mono text-body text-ink',
                      focusRing,
                    )}
                  />
                  <button
                    type="button"
                    disabled={
                      adding.label.trim() === '' || adding.startsAt === '' || adding.endsAt === ''
                    }
                    onClick={() => {
                      set('bands', [
                        ...draft.bands,
                        {
                          key: `added-${draft.bands.length}-${adding.startsAt}`,
                          label: adding.label.trim(),
                          startsAt: adding.startsAt,
                          endsAt: adding.endsAt,
                        },
                      ])
                      setAdding(null)
                    }}
                    className={cn(
                      'min-h-11 shrink-0 rounded-ctl bg-pine px-4 text-body font-semibold text-on-pine disabled:bg-surface-2 disabled:text-ink-faint',
                      focusRing,
                    )}
                  >
                    足す
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding({ label: '', startsAt: '', endsAt: '' })}
                  className={cn(
                    'flex min-h-14 w-full items-center px-4 py-2 text-body font-semibold text-pine',
                    focusRing,
                  )}
                >
                  ＋ 止める時間帯を足す
                </button>
              )}
            </div>
          </fieldset>

          <fieldset className="min-w-0">
            <Legend>予約の間隔</Legend>
            <NumberRow
              id={`${fieldId}-cleanup`}
              label="1件あたりの片付け時間"
              unit="分"
              value={draft.cleanupMinutes}
              onChange={(value) => set('cleanupMinutes', value)}
            />
            <NumberRow
              id={`${fieldId}-slot`}
              label="予約をお受けする刻み"
              unit="分ごと"
              value={draft.slotMinutes}
              onChange={(value) => set('slotMinutes', value)}
            />
            <NumberRow
              id={`${fieldId}-parallel`}
              label="同じ時刻に受けられる件数"
              unit="件まで"
              value={draft.maxParallel}
              onChange={(value) => set('maxParallel', value)}
            />
          </fieldset>

          {warnings.map((warning) => (
            <p key={warning} role="status" className="mt-3 px-0.5 text-grid text-amber">
              {warning}
            </p>
          ))}

          {lastAcceptable && (
            <p className="mt-7 px-0.5 text-grid text-ink-muted">
              {WEEKDAY_NAMES[weekday]}曜日に最後にお受けできるのは {lastAcceptable} です。
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/* --- 表示のための導出 ---------------------------------------------------- */

/** 7 行のうち最も多い開店・閉店の組。モックの「通常の営業時間」はこれを指す。 */
function baseHours(rows: readonly BusinessHoursRow[]): { opensAt: string; closesAt: string } {
  const counts = new Map<string, number>()
  for (const weekday of WEEKDAYS_FROM_MONDAY) {
    const row = rows.find((r) => r.weekday === weekday)
    if (!row || row.isClosed || !row.opensAt || !row.closesAt) continue
    const key = `${row.opensAt}|${row.closesAt}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best = ''
  let seen = 0
  for (const [key, count] of counts) {
    if (count > seen) {
      best = key
      seen = count
    }
  }
  const [opensAt = '10:00', closesAt = '19:00'] = best.split('|')
  return { opensAt, closesAt }
}

/** 通常の営業時間に一致する曜日。帯もこの曜日ぶんを直す。 */
function baseWeekdays(rows: readonly BusinessHoursRow[]): Set<number> {
  const { opensAt, closesAt } = baseHours(rows)
  return new Set(
    rows
      .filter((row) => !row.isClosed && row.opensAt === opensAt && row.closesAt === closesAt)
      .map((row) => row.weekday),
  )
}

function toDraft(loaded: Loaded): Draft {
  const { opensAt, closesAt } = baseHours(loaded.hours.rows)
  const days = baseWeekdays(loaded.hours.rows)
  const seen = new Map<string, Band>()
  for (const band of loaded.hours.blackouts) {
    if (!days.has(band.weekday)) continue
    const key = `${band.label}|${band.startsAt}|${band.endsAt}`
    if (!seen.has(key))
      seen.set(key, { key, label: band.label, startsAt: band.startsAt, endsAt: band.endsAt })
  }
  const bands = [...seen.values()].sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.label.localeCompare(b.label),
  )
  return {
    opensAt,
    closesAt,
    bands,
    slotMinutes: loaded.rules.slotMinutes,
    cleanupMinutes: loaded.rules.cleanupMinutes,
    maxParallel: loaded.rules.maxParallel,
  }
}

/** モックの「曜日ごとの上書き」。基準と違う曜日を月曜始まりで並べ、残りを 1 行にまとめる。 */
function overrideLines(
  rows: readonly BusinessHoursRow[],
): { label: string; value: string; mono: boolean }[] {
  const days = baseWeekdays(rows)
  const lines: { label: string; value: string; mono: boolean }[] = []
  for (const weekday of WEEKDAYS_FROM_MONDAY) {
    if (days.has(weekday)) continue
    const row = rows.find((r) => r.weekday === weekday)
    const name = `${WEEKDAY_NAMES[weekday]}曜日`
    if (!row || row.isClosed || !row.opensAt || !row.closesAt) {
      lines.push({ label: name, value: 'お休み（定休日）', mono: false })
      continue
    }
    lines.push({ label: name, value: `${row.opensAt}–${row.closesAt}`, mono: true })
  }
  const normal = WEEKDAYS_FROM_MONDAY.filter((weekday) => days.has(weekday))
  if (normal.length > 0)
    lines.push({
      label: `${normal.map((weekday) => WEEKDAY_NAMES[weekday]).join('・')}曜日`,
      value: '通常どおり',
      mono: false,
    })
  return lines
}

/** EX-PERMISSION の「下書きは残っています」に並べる行。件数がそのまま未保存の札になる。 */
function describeChanges(base: Draft, draft: Draft): string[] {
  const lines: string[] = []
  if (base.opensAt !== draft.opensAt)
    lines.push(`開店を ${base.opensAt} から ${draft.opensAt} に変える`)
  if (base.closesAt !== draft.closesAt)
    lines.push(`閉店を ${base.closesAt} から ${draft.closesAt} に変える`)

  const before = new Map(base.bands.map((band) => [band.key, band]))
  for (const band of draft.bands) {
    const was = before.get(band.key)
    if (!was) {
      lines.push(`受付を止める時間帯に ${band.label} ${band.startsAt}–${band.endsAt} を足す`)
      continue
    }
    if (was.label !== band.label || was.startsAt !== band.startsAt || was.endsAt !== band.endsAt)
      lines.push(
        `${was.label} を ${was.startsAt}–${was.endsAt} から ${band.label} ${band.startsAt}–${band.endsAt} に変える`,
      )
  }
  const after = new Set(draft.bands.map((band) => band.key))
  for (const band of base.bands)
    if (!after.has(band.key)) lines.push(`受付を止める時間帯から ${band.label} を消す`)

  if (base.cleanupMinutes !== draft.cleanupMinutes)
    lines.push(
      `1件あたりの片付け時間を ${base.cleanupMinutes}分 から ${draft.cleanupMinutes}分 に変える`,
    )
  if (base.slotMinutes !== draft.slotMinutes)
    lines.push(`予約をお受けする刻みを ${base.slotMinutes}分 から ${draft.slotMinutes}分 に変える`)
  if (base.maxParallel !== draft.maxParallel)
    lines.push(
      `同じ時刻に受けられる件数を ${base.maxParallel}件 から ${draft.maxParallel}件 に変える`,
    )
  return lines
}

/* --- 小さな行 ------------------------------------------------------------ */

function TimeRow({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 border-b border-line px-4 py-2 last:border-b-0">
      <label htmlFor={id} className="shrink-0 whitespace-nowrap text-body text-ink">
        {label}
      </label>
      <input
        id={id}
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'ml-auto min-h-11 rounded-ctl bg-surface px-2 text-right font-mono text-body text-ink',
          focusRing,
        )}
      />
    </div>
  )
}

function NumberRow({
  id,
  label,
  unit,
  value,
  onChange,
}: {
  id: string
  label: string
  unit: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 border-t border-line py-4 first:border-t-0">
      <label htmlFor={id} className="shrink-0 whitespace-nowrap text-body text-ink">
        {label}
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn(
          'ml-auto min-h-11 w-20 rounded-ctl bg-transparent px-2 text-right font-mono text-body text-ink',
          focusRing,
        )}
      />
      <span className="shrink-0 text-body text-ink-muted">{unit}</span>
    </div>
  )
}

/** 群の見出し（モックの `.groupname` = margin 28px 2px 12px / 13px 600）。 */
function Legend({ className, children }: { className?: string; children: string }) {
  return (
    <legend className={cn('mt-7 mb-3 px-0.5 text-grid font-semibold text-ink-muted', className)}>
      {children}
    </legend>
  )
}
