import {
  type AvailabilityException,
  type AvailabilityExceptionMode,
  type AvailabilityPurpose,
  type AvailabilityStaffShift,
  AvailabilityStoreSettings,
  type StorePermission,
  type WebBookingPublication,
} from '@app/contracts'
import { Button, Chip, Field, Notice, Select, TextInput } from '@app/ui'
import { type ReactNode, useEffect, useState } from 'react'
import { SettingsPublication } from './SettingsPublication'
import {
  DEFAULT_PURPOSE_TEMPLATE,
  deriveStepStates,
  SETTINGS_STEP_BY_ID,
  SETTINGS_STEPS,
  type SettingsStepId,
  STEP_STATE_LABEL,
  stepperSummary,
  WEEKDAY_LABEL,
} from './settings-guide'
import type { StaffScreenProps } from './staff-screen'

/**
 * 全店共通設定と店舗上書きの適用元（AC-EYEX-48, 69）.
 *
 * 設定APIはまだ適用元を返さない。推測した既定値を描くと「全店共通のはず」と
 * 誤読されるため、渡されないあいだは 未取得 と明示する。
 */
type ChainDefaults = {
  source: 'chain' | 'store'
  /** 全店共通値から店舗が上書きした項目名。 */
  overriddenFields: readonly string[]
}

/**
 * Web予約の受付条件。契約にまだ無い項目なので UI view type であって API 契約ではない。
 * 公開・下書き APIが出来たらそちらの契約へ置き換える。
 */
type WebBookingRules = {
  bookableDays: number
  cutoffMinutes: number
  changeDeadline: string
  afterDeadlineGuidance: string
}

type Props = StaffScreenProps & {
  permissions: StorePermission[]
  /** JST `YYYY-MM-DD`, injected: this screen never reads the clock. */
  today: string
  step?: SettingsStepId
  chainDefaults?: ChainDefaults
  webBooking?: WebBookingPublication
  webBookingRules?: WebBookingRules
}

const JST = 'Asia/Tokyo'
const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** モックの「9月15日 10:00に公開」に使う、年を落とした JST 表記。 */
const shortDateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: JST,
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** UTC の瞬間 → JST の壁時計 `YYYY-MM-DDTHH:mm`（入力欄が読む形）。 */
function toJstWallClock(instant: string): string {
  const parsed = new Date(instant)
  if (Number.isNaN(parsed.getTime())) return ''
  const shifted = new Date(parsed.getTime() + 9 * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 16)
}

/** JST の壁時計 `YYYY-MM-DDTHH:mm` → 保存される UTC の瞬間。 */
function fromJstWallClock(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}:00+09:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

const UNKNOWN = '未取得'
const EXCEPTION_MODE_LABEL: Record<AvailabilityExceptionMode, string> = {
  closed: '休業',
  open: '臨時営業',
  paused: '受付停止',
}

function newId(): string {
  return crypto.randomUUID()
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/** モックは「開始2時間前」。分が時間で割り切れるときだけ時間で読ませる。 */
function formatCutoff(minutes: number): string {
  return minutes % 60 === 0 ? `開始${minutes / 60}時間前` : `開始${minutes}分前`
}

function formatRange(period?: { startTime: string; endTime: string }): string {
  return period ? `${period.startTime}–${period.endTime}` : '休業日'
}

/** A labelled panel. `Card` takes no aria-label and these panels need a name. */
function Panel({
  label,
  className,
  plain = false,
  children,
}: {
  label: string
  className?: string
  /** カードが直接キャンバスに並ぶ区画（モックの Web予約工程）。枠を重ねない。 */
  plain?: boolean
  children: ReactNode
}) {
  return (
    <section
      aria-label={label}
      className={`${plain ? '' : 'rounded-ctl border border-line bg-surface p-5'} ${className ?? ''}`}
    >
      {children}
    </section>
  )
}

/**
 * モックの `.field` — 白地・1px 罫・角丸 9px・見出しは太字で 1 行目。
 * Web予約工程はこのカードだけで組む（settings-complete-approved.html #web-settings）。
 */
function FieldCard({
  term,
  value,
  children,
  wide = false,
}: {
  term: string
  value?: string
  children?: ReactNode
  wide?: boolean
}) {
  return (
    <div
      className={`min-h-19 rounded-card border border-line bg-surface p-4 ${wide ? 'sm:col-span-2' : ''}`}
    >
      <p className="font-sans font-semibold text-ink text-sm">{term}</p>
      {value !== undefined && <p className="font-sans text-ink text-sm">{value}</p>}
      {children}
    </div>
  )
}

function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-b-0">
      <dt className="font-sans text-sm text-ink-muted">{term}</dt>
      <dd className="font-sans text-sm font-medium text-ink">{children}</dd>
    </div>
  )
}

type Draft = AvailabilityStoreSettings

/**
 * 設定ガイド 6 工程（AC-EYEX-40）とその編集画面。
 *
 * 下書き・影響確認・Web予約公開の API はまだ無い。無いものは推測せず、
 * 未取得 / 準備中 として画面に出す。
 */
export function SettingsScreen({
  storeId,
  storeName,
  api,
  navigate,
  today,
  permissions,
  step,
  chainDefaults,
  webBooking,
  webBookingRules,
}: Props) {
  const canRead = permissions.includes('settings.read')
  const canManage = permissions.includes('settings.manage')
  const [draft, setDraft] = useState<Draft>()
  const [current, setCurrent] = useState<SettingsStepId>(step ?? 'store-hours')
  const [selectedPurposeId, setSelectedPurposeId] = useState<string>()
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [exceptionDate, setExceptionDate] = useState('')
  const [exceptionMode, setExceptionMode] = useState<AvailabilityExceptionMode>('closed')
  const [exceptionReason, setExceptionReason] = useState('')
  /**
   * Web予約の公開設定はまだ取得・保存の API が無い（報告済み）。渡された値を
   * 編集できる形で保持し、保存先が無いことは画面で明言する。
   */
  const [webDraft, setWebDraft] = useState<WebBookingPublication | undefined>(webBooking)
  useEffect(() => {
    setWebDraft(webBooking)
  }, [webBooking])

  useEffect(() => {
    if (!canRead) return
    let active = true
    void (async () => {
      const response = await api(`/api/staff/stores/${storeId}/availability/settings`)
      if (!response.ok) {
        if (active) setError('設定を取得できませんでした。もう一度お試しください。')
        return
      }
      const parsed = AvailabilityStoreSettings.safeParse(await readJson(response))
      if (!active) return
      if (!parsed.success) {
        setError('設定を取得できませんでした。もう一度お試しください。')
        return
      }
      setDraft(parsed.data)
      setSelectedPurposeId(parsed.data.purposes[0]?.id)
    })()
    return () => {
      active = false
    }
  }, [api, storeId, canRead])

  if (!canRead) {
    // 承認済みモック exception-states-approved.html #permission-denied の文言と
    // 回復手段。設定の存在や中身はここから先を一切描かない。
    return (
      <section aria-label="店舗設定" className="mx-auto max-w-3xl space-y-4 p-8 text-center">
        <p aria-hidden="true" className="font-display text-5xl text-pine">
          —
        </p>
        <h2 className="font-display font-semibold text-2xl text-ink">
          この設定を表示する権限がありません
        </h2>
        <p className="font-sans text-ink-muted text-sm">
          権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。
        </p>
        <div className="flex justify-center">
          <Button className="min-h-12" onClick={() => navigate({ screen: 'home' })}>
            業務開始画面へ戻る
          </Button>
        </div>
      </section>
    )
  }

  const states = deriveStepStates({
    current,
    settings: draft,
    webBookingConfigured: webBooking !== undefined,
  })
  const summary = stepperSummary(states, current)
  const activeStep = SETTINGS_STEP_BY_ID[current]

  const update = (change: (previous: Draft) => Draft) => {
    setSaved(false)
    setDraft((previous) => (previous ? change(previous) : previous))
  }

  const periodOf = (dayOfWeek: number) =>
    draft?.businessHours.find((day) => day.dayOfWeek === dayOfWeek)?.periods[0]

  const setDayPeriod = (
    dayOfWeek: number,
    period: { startTime: string; endTime: string } | undefined,
  ) =>
    update((previous) => {
      const rest = previous.businessHours.filter((day) => day.dayOfWeek !== dayOfWeek)
      return {
        ...previous,
        businessHours: [...rest, { dayOfWeek, periods: period ? [period] : [] }].sort(
          (left, right) => left.dayOfWeek - right.dayOfWeek,
        ),
      }
    })

  /** 公開状態のひとことは、受付停止 > 公開中 > 予約公開 > 非公開 の順に読む。 */
  const publishStateLabel = !webDraft
    ? UNKNOWN
    : webDraft.status === 'published'
      ? draft?.receptionStatus === 'paused'
        ? '受付停止'
        : '公開中'
      : webDraft.startsAt
        ? `${shortDateTimeFormat.format(new Date(webDraft.startsAt))}に公開`
        : '非公開'
  const receptionEndLabel = !webDraft
    ? UNKNOWN
    : webDraft.endsAt
      ? dateTimeFormat.format(new Date(webDraft.endsAt))
      : '設定なし'
  const publicPurposeLabel = !webDraft
    ? UNKNOWN
    : (draft?.purposes ?? [])
        .filter((purpose) => webDraft.publicPurposeIds.includes(purpose.id))
        .map((purpose) => purpose.staffName)
        .join('、') || 'なし'

  const selectedPurpose = draft?.purposes.find((purpose) => purpose.id === selectedPurposeId)
  const updatePurpose = (change: Partial<AvailabilityPurpose>) =>
    update((previous) => ({
      ...previous,
      purposes: previous.purposes.map((purpose) =>
        purpose.id === selectedPurposeId ? { ...purpose, ...change } : purpose,
      ),
    }))

  const shiftOf = (staffId: string) => draft?.shifts.find((shift) => shift.staffId === staffId)
  const updateShift = (staffId: string, change: Partial<AvailabilityStaffShift>) =>
    update((previous) => {
      const existing = previous.shifts.find((shift) => shift.staffId === staffId)
      if (!existing) {
        return {
          ...previous,
          shifts: [
            ...previous.shifts,
            {
              id: newId(),
              staffId,
              date: today,
              startTime: '10:00',
              endTime: '19:00',
              breaks: [],
              ...change,
            },
          ],
        }
      }
      return {
        ...previous,
        shifts: previous.shifts.map((shift) =>
          shift.id === existing.id ? { ...shift, ...change } : shift,
        ),
      }
    })

  const save = async () => {
    if (!draft) return
    const { storeId: _storeId, ...input } = draft
    const response = await api(`/api/staff/stores/${storeId}/availability/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      // 何も削除しない: 予約・履歴に紐づく shifts / maintenance / exceptions は
      // そのまま送り返す（UC-EYEX-122, AC-EYEX-70）。
      body: JSON.stringify(input),
    })
    if (response.status === 409) {
      setSaved(false)
      setError('設定が他の端末で更新されています。再読み込みしてください。')
      return
    }
    const body = (await readJson(response)) as { error?: string } | undefined
    if (!response.ok) {
      setSaved(false)
      setError(body?.error ?? '設定を保存できませんでした。もう一度お試しください。')
      return
    }
    const parsed = AvailabilityStoreSettings.safeParse(body)
    if (parsed.success) setDraft(parsed.data)
    setError(undefined)
    setSaved(true)
  }

  return (
    <section
      aria-label="店舗設定"
      className="flex min-h-full flex-col gap-4 p-4 md:flex-row md:p-6"
    >
      <nav
        aria-label="設定工程"
        className="sticky top-0 z-10 shrink-0 rounded-ctl border border-line bg-surface p-3 md:static md:w-64 md:p-4"
      >
        <div className="flex items-baseline justify-between gap-2 font-sans text-xs text-ink-muted md:hidden">
          <span className="font-semibold text-pine">{summary.headline}</span>
          <span>{summary.remainingLabel}</span>
        </div>
        <p className="font-sans text-xs text-ink-muted md:hidden">
          現在の状態: {summary.stateLabel}
        </p>
        <ol className="mt-2 grid grid-cols-6 gap-1 md:mt-0 md:flex md:flex-col md:gap-1">
          {SETTINGS_STEPS.map((candidate, index) => {
            const state = states[candidate.id]
            return (
              <li key={candidate.id} className="relative">
                {index > 0 && (
                  <span
                    aria-hidden="true"
                    className="-left-1/2 absolute top-4 right-1/2 h-px bg-line md:hidden"
                  />
                )}
                <button
                  type="button"
                  aria-label={`工程${candidate.number} ${candidate.label} ${STEP_STATE_LABEL[state]}`}
                  aria-current={state === 'editing' ? 'step' : undefined}
                  onClick={() => setCurrent(candidate.id)}
                  className="relative flex min-h-12 w-full flex-col items-center gap-1 rounded-ctl px-1 py-2 text-center font-sans focus-visible:ring-2 focus-visible:ring-pine focus-visible:outline-none md:flex-row md:items-baseline md:gap-2 md:px-3 md:text-left"
                >
                  <span
                    aria-hidden="true"
                    className={`grid size-8 shrink-0 place-items-center rounded-full border font-mono text-xs ${
                      state === 'complete'
                        ? 'border-pine bg-pine/10 text-pine'
                        : state === 'editing'
                          ? 'border-pine bg-pine text-on-pine'
                          : 'border-line bg-surface text-ink-muted'
                    }`}
                  >
                    {state === 'complete' ? '✓' : candidate.number}
                  </span>
                  <span className="text-xs leading-tight text-ink md:hidden">
                    {candidate.shortLabel}
                  </span>
                  <span className="hidden text-sm text-ink md:inline md:flex-1">
                    {candidate.label}
                  </span>
                  <span className="hidden font-sans text-xs text-ink-muted md:inline">
                    {STEP_STATE_LABEL[state]}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </nav>

      <div className="min-w-0 flex-1 space-y-4">
        <header className="space-y-1">
          <h1 className="font-display text-xl font-semibold text-ink">{storeName} · 設定ガイド</h1>
          <p className="font-sans text-sm text-ink-muted">
            適用元:{' '}
            {chainDefaults ? (chainDefaults.source === 'chain' ? '全店共通' : '店舗設定') : UNKNOWN}
          </p>
          {chainDefaults && chainDefaults.overriddenFields.length > 0 && (
            <p className="font-sans text-sm text-ink-muted">
              店舗上書き: {chainDefaults.overriddenFields.join('、')}
            </p>
          )}
          {!canManage && <Notice tone="info">設定を変更する権限がありません。</Notice>}
          {error && <Notice>{error}</Notice>}
          {saved && <Notice tone="success">設定を保存しました。</Notice>}
        </header>

        {/* 第6工程は公開画面が自分の見出しを持つ（モックどおり見出しを重ねない）。 */}
        {current !== 'impact' && (
          <div className="space-y-2">
            <h2 className="font-display text-lg font-semibold text-ink">{activeStep.label}</h2>
            <p className="font-sans text-sm text-ink-muted">{activeStep.description}</p>
          </div>
        )}

        {!draft && !error && <p className="font-sans text-sm text-ink-muted">読み込み中です。</p>}

        {draft && current === 'store-hours' && (
          <div className="space-y-4">
            <Panel label="営業時間" className="space-y-3">
              {WEEKDAY_LABEL.map((name, dayOfWeek) => {
                const period = periodOf(dayOfWeek)
                return (
                  <div key={name} className="flex flex-wrap items-center gap-3">
                    <span className="w-12 font-sans text-sm text-ink">{name}曜</span>
                    {canManage ? (
                      <>
                        <label className="flex min-h-12 items-center gap-2 font-sans text-sm text-ink">
                          <input
                            type="checkbox"
                            aria-label={`${name}曜を営業日にする`}
                            checked={period !== undefined}
                            onChange={(event) =>
                              setDayPeriod(
                                dayOfWeek,
                                event.target.checked
                                  ? { startTime: '10:00', endTime: '19:00' }
                                  : undefined,
                              )
                            }
                          />
                          営業
                        </label>
                        <TextInput
                          type="time"
                          aria-label={`${name}曜の営業開始`}
                          className="min-h-12 w-32"
                          value={period?.startTime ?? ''}
                          disabled={!period}
                          onChange={(event) =>
                            period &&
                            setDayPeriod(dayOfWeek, { ...period, startTime: event.target.value })
                          }
                        />
                        <TextInput
                          type="time"
                          aria-label={`${name}曜の営業終了`}
                          className="min-h-12 w-32"
                          value={period?.endTime ?? ''}
                          disabled={!period}
                          onChange={(event) =>
                            period &&
                            setDayPeriod(dayOfWeek, { ...period, endTime: event.target.value })
                          }
                        />
                      </>
                    ) : (
                      <span className="font-sans text-sm text-ink">{formatRange(period)}</span>
                    )}
                  </div>
                )
              })}
            </Panel>

            <Panel label="臨時営業・休業日" className="space-y-3">
              <h3 className="font-display text-base font-semibold text-ink">臨時営業・休業日</h3>
              <ul aria-label="臨時営業・休業日" className="space-y-2">
                {draft.exceptions.length === 0 && (
                  <li className="font-sans text-sm text-ink-muted">設定なし</li>
                )}
                {draft.exceptions.map((exception) => (
                  <li
                    key={`${exception.date}-${exception.mode}`}
                    className="flex flex-wrap items-center gap-3 font-sans text-sm text-ink"
                  >
                    <span>{exception.date}</span>
                    <Chip>{EXCEPTION_MODE_LABEL[exception.mode]}</Chip>
                    <span>{exception.periods.map((period) => formatRange(period)).join('・')}</span>
                    <span className="text-ink-muted">{exception.reason ?? ''}</span>
                  </li>
                ))}
              </ul>
              {canManage && (
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="日付" htmlFor="exception-date">
                    <TextInput
                      id="exception-date"
                      type="date"
                      className="min-h-12"
                      value={exceptionDate}
                      onChange={(event) => setExceptionDate(event.target.value)}
                    />
                  </Field>
                  <Field label="区分" htmlFor="exception-mode">
                    <Select
                      id="exception-mode"
                      className="min-h-12"
                      value={exceptionMode}
                      onChange={(event) =>
                        setExceptionMode(event.target.value as AvailabilityExceptionMode)
                      }
                    >
                      <option value="closed">休業</option>
                      <option value="open">臨時営業</option>
                      <option value="paused">受付停止</option>
                    </Select>
                  </Field>
                  <Field label="理由" htmlFor="exception-reason">
                    <TextInput
                      id="exception-reason"
                      className="min-h-12"
                      value={exceptionReason}
                      onChange={(event) => setExceptionReason(event.target.value)}
                    />
                  </Field>
                  <Button
                    className="min-h-12"
                    onClick={() => {
                      if (exceptionDate === '') return
                      const exception: AvailabilityException = {
                        date: exceptionDate,
                        mode: exceptionMode,
                        periods:
                          exceptionMode === 'open'
                            ? [{ startTime: '10:00', endTime: '17:00' }]
                            : [],
                        ...(exceptionReason === '' ? {} : { reason: exceptionReason }),
                      }
                      update((previous) => ({
                        ...previous,
                        exceptions: [...previous.exceptions, exception],
                      }))
                      setExceptionDate('')
                      setExceptionReason('')
                    }}
                  >
                    臨時設定を追加
                  </Button>
                </div>
              )}
            </Panel>

            <Panel label="受付停止" className="space-y-3">
              <h3 className="font-display text-base font-semibold text-ink">受付状態</h3>
              {canManage ? (
                <Field label="受付状態" htmlFor="reception-status">
                  <Select
                    id="reception-status"
                    className="min-h-12"
                    value={draft.receptionStatus}
                    onChange={(event) =>
                      update((previous) => ({
                        ...previous,
                        receptionStatus: event.target.value === 'paused' ? 'paused' : 'open',
                      }))
                    }
                  >
                    <option value="open">受付中</option>
                    <option value="paused">受付停止</option>
                  </Select>
                </Field>
              ) : (
                <p className="font-sans text-sm text-ink">
                  {draft.receptionStatus === 'paused' ? '受付停止' : '受付中'}
                </p>
              )}
              <p className="font-sans text-sm text-ink-muted">
                受付停止は新しいWeb予約だけを止めます。既存予約は取り消されません。
              </p>
            </Panel>
          </div>
        )}

        {draft && current === 'purposes' && (
          <div className="space-y-4">
            {draft.purposes.length === 0 ? (
              <Panel label="標準テンプレート" className="space-y-3">
                <h3 className="font-display text-base font-semibold text-ink">標準テンプレート</h3>
                <p className="font-sans text-sm text-ink-muted">
                  新規店舗向けの初期値です。読み込んだあとで店舗ごとに変更できます。
                </p>
                <ul className="space-y-2">
                  {DEFAULT_PURPOSE_TEMPLATE.map((template) => (
                    <li
                      key={template.staffName}
                      className="space-y-1 rounded-ctl border border-line p-3 font-sans text-sm text-ink"
                    >
                      <span className="block font-medium">{template.staffName}</span>
                      <span className="block text-ink-muted">{template.customerLabel}</span>
                      <span className="block text-ink-muted">
                        {template.durationMinutes}分 · {template.slotIntervalMinutes}分単位 · 同時
                        {template.maxConcurrent}件
                      </span>
                      <span className="block text-ink-muted">
                        技能: {template.requiredSkills.join('、')}
                      </span>
                      <span className="block text-ink-muted">
                        設備: {template.requiredEquipment.join('、')}
                      </span>
                      <Chip tone={template.isPublic ? 'success' : 'neutral'}>
                        {template.isPublic ? 'Web公開' : 'Web非公開'}
                      </Chip>
                    </li>
                  ))}
                </ul>
                {canManage && (
                  <Button
                    className="min-h-12"
                    onClick={() =>
                      update((previous) => {
                        const purposes = DEFAULT_PURPOSE_TEMPLATE.map((template) => ({
                          id: newId(),
                          ...template,
                        }))
                        setSelectedPurposeId(purposes[0]?.id)
                        return { ...previous, purposes }
                      })
                    }
                  >
                    標準テンプレートを読み込む
                  </Button>
                )}
              </Panel>
            ) : (
              <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
                <Panel label="来店目的" className="space-y-2">
                  <ul className="space-y-1">
                    {draft.purposes.map((purpose) => (
                      <li key={purpose.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedPurposeId(purpose.id)}
                          aria-current={purpose.id === selectedPurposeId ? 'true' : undefined}
                          className="min-h-12 w-full rounded-ctl px-3 py-2 text-left font-sans text-sm text-ink focus-visible:ring-2 focus-visible:ring-pine focus-visible:outline-none"
                        >
                          {purpose.staffName}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Panel>

                {selectedPurpose && (
                  <div className="space-y-4">
                    <Panel label="来店目的の設定" className="space-y-3">
                      {canManage ? (
                        <>
                          <Field label="スタッフ向け名称" htmlFor="purpose-staff-name">
                            <TextInput
                              id="purpose-staff-name"
                              className="min-h-12"
                              value={selectedPurpose.staffName}
                              onChange={(event) => updatePurpose({ staffName: event.target.value })}
                            />
                          </Field>
                          <Field label="顧客向け表示名" htmlFor="purpose-customer-label">
                            <TextInput
                              id="purpose-customer-label"
                              className="min-h-12"
                              value={selectedPurpose.customerLabel}
                              onChange={(event) =>
                                updatePurpose({ customerLabel: event.target.value })
                              }
                            />
                          </Field>
                          <Field label="標準所要時間（分）" htmlFor="purpose-duration">
                            <TextInput
                              id="purpose-duration"
                              type="number"
                              className="min-h-12"
                              value={selectedPurpose.durationMinutes}
                              onChange={(event) =>
                                updatePurpose({ durationMinutes: Number(event.target.value) })
                              }
                            />
                          </Field>
                          <Field label="時間調整単位（分）" htmlFor="purpose-interval">
                            <TextInput
                              id="purpose-interval"
                              type="number"
                              className="min-h-12"
                              value={selectedPurpose.slotIntervalMinutes}
                              onChange={(event) =>
                                updatePurpose({ slotIntervalMinutes: Number(event.target.value) })
                              }
                            />
                          </Field>
                          <Field label="同時受付数" htmlFor="purpose-concurrent">
                            <TextInput
                              id="purpose-concurrent"
                              type="number"
                              className="min-h-12"
                              value={selectedPurpose.maxConcurrent}
                              onChange={(event) =>
                                updatePurpose({ maxConcurrent: Number(event.target.value) })
                              }
                            />
                          </Field>
                          <Field label="必要技能" htmlFor="purpose-skills">
                            <TextInput
                              id="purpose-skills"
                              className="min-h-12"
                              value={selectedPurpose.requiredSkills.join(', ')}
                              onChange={(event) =>
                                updatePurpose({
                                  requiredSkills: splitList(event.target.value),
                                })
                              }
                            />
                          </Field>
                          <Field label="必要設備" htmlFor="purpose-equipment">
                            <TextInput
                              id="purpose-equipment"
                              className="min-h-12"
                              value={selectedPurpose.requiredEquipment.join(', ')}
                              onChange={(event) =>
                                updatePurpose({
                                  requiredEquipment: splitList(event.target.value),
                                })
                              }
                            />
                          </Field>
                          <label className="flex min-h-12 items-center gap-2 font-sans text-sm text-ink">
                            <input
                              type="checkbox"
                              aria-label="Web予約に公開する"
                              checked={selectedPurpose.isPublic}
                              onChange={(event) =>
                                updatePurpose({ isPublic: event.target.checked })
                              }
                            />
                            Web予約に公開する
                          </label>
                        </>
                      ) : (
                        <dl>
                          <Row term="スタッフ向け名称">{selectedPurpose.staffName}</Row>
                          <Row term="顧客向け表示名">{selectedPurpose.customerLabel}</Row>
                          <Row term="標準所要時間">{selectedPurpose.durationMinutes}分</Row>
                          <Row term="必要技能">{selectedPurpose.requiredSkills.join('、')}</Row>
                          <Row term="必要設備">{selectedPurpose.requiredEquipment.join('、')}</Row>
                        </dl>
                      )}
                      <p className="font-sans text-sm text-ink-muted">
                        非公開にすると新規の選択肢から外れます。既存予約と履歴は削除されません。
                      </p>
                    </Panel>

                    <Panel label="Web予約プレビュー" className="space-y-2">
                      <h3 className="font-display text-base font-semibold text-ink">
                        Web予約プレビュー
                      </h3>
                      <p className="font-sans text-base text-ink">
                        {selectedPurpose.customerLabel}
                      </p>
                      <p className="font-sans text-sm text-ink-muted">
                        約{selectedPurpose.durationMinutes}分
                      </p>
                      <p className="font-sans text-sm text-ink-muted">
                        {selectedPurpose.isPublic
                          ? 'この目的はWeb予約の選択肢に表示されます。'
                          : 'この目的はWeb予約の選択肢に表示されません。'}
                      </p>
                    </Panel>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {draft && current === 'staff-skills' && (
          <Panel label="スタッフ" className="space-y-4">
            <ul aria-label="スタッフ" className="space-y-4">
              {draft.staff.length === 0 && (
                <li className="font-sans text-sm text-ink-muted">スタッフが登録されていません。</li>
              )}
              {draft.staff.map((member) => {
                const shift = shiftOf(member.id)
                return (
                  <li key={member.id} className="space-y-2 rounded-ctl border border-line p-3">
                    <p className="font-sans text-sm font-medium text-ink">{member.name}</p>
                    {canManage ? (
                      <div className="flex flex-wrap items-end gap-3">
                        <Field label={`${member.name}の技能`} htmlFor={`skills-${member.id}`}>
                          <TextInput
                            id={`skills-${member.id}`}
                            className="min-h-12"
                            value={member.skills.join(', ')}
                            onChange={(event) =>
                              update((previous) => ({
                                ...previous,
                                staff: previous.staff.map((row) =>
                                  row.id === member.id
                                    ? { ...row, skills: splitList(event.target.value) }
                                    : row,
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field
                          label={`${member.name}の勤務開始`}
                          htmlFor={`shift-start-${member.id}`}
                        >
                          <TextInput
                            id={`shift-start-${member.id}`}
                            type="time"
                            className="min-h-12"
                            value={shift?.startTime ?? ''}
                            onChange={(event) =>
                              updateShift(member.id, { startTime: event.target.value })
                            }
                          />
                        </Field>
                        <Field
                          label={`${member.name}の勤務終了`}
                          htmlFor={`shift-end-${member.id}`}
                        >
                          <TextInput
                            id={`shift-end-${member.id}`}
                            type="time"
                            className="min-h-12"
                            value={shift?.endTime ?? ''}
                            onChange={(event) =>
                              updateShift(member.id, { endTime: event.target.value })
                            }
                          />
                        </Field>
                        <Field
                          label={`${member.name}の休憩開始`}
                          htmlFor={`break-start-${member.id}`}
                        >
                          <TextInput
                            id={`break-start-${member.id}`}
                            type="time"
                            className="min-h-12"
                            value={shift?.breaks[0]?.startTime ?? ''}
                            onChange={(event) =>
                              updateShift(member.id, {
                                breaks: [
                                  {
                                    startTime: event.target.value,
                                    endTime: shift?.breaks[0]?.endTime ?? event.target.value,
                                  },
                                ],
                              })
                            }
                          />
                        </Field>
                        <Field
                          label={`${member.name}の休憩終了`}
                          htmlFor={`break-end-${member.id}`}
                        >
                          <TextInput
                            id={`break-end-${member.id}`}
                            type="time"
                            className="min-h-12"
                            value={shift?.breaks[0]?.endTime ?? ''}
                            onChange={(event) =>
                              updateShift(member.id, {
                                breaks: [
                                  {
                                    startTime: shift?.breaks[0]?.startTime ?? event.target.value,
                                    endTime: event.target.value,
                                  },
                                ],
                              })
                            }
                          />
                        </Field>
                        <label className="flex min-h-12 items-center gap-2 font-sans text-sm text-ink">
                          <input
                            type="checkbox"
                            aria-label={`${member.name}は予約を受け付ける`}
                            checked={member.canBook}
                            onChange={(event) =>
                              update((previous) => ({
                                ...previous,
                                staff: previous.staff.map((row) =>
                                  row.id === member.id
                                    ? { ...row, canBook: event.target.checked }
                                    : row,
                                ),
                              }))
                            }
                          />
                          予約受付可
                        </label>
                      </div>
                    ) : (
                      <dl>
                        <Row term="技能">{member.skills.join('、')}</Row>
                        <Row term="勤務">{formatRange(shift)}</Row>
                        <Row term="休憩">{formatRange(shift?.breaks[0])}</Row>
                        <Row term="予約受付">{member.canBook ? '受付可' : '受付不可'}</Row>
                      </dl>
                    )}
                  </li>
                )
              })}
            </ul>
          </Panel>
        )}

        {draft && current === 'equipment' && (
          <div className="space-y-4">
            <Panel label="設備" className="space-y-4">
              <ul aria-label="設備" className="space-y-4">
                {draft.equipment.map((item) => (
                  <li key={item.id} className="space-y-2 rounded-ctl border border-line p-3">
                    <p className="font-sans text-sm font-medium text-ink">{item.name}</p>
                    {canManage ? (
                      <div className="flex flex-wrap items-end gap-3">
                        <Field label={`${item.name}の台数`} htmlFor={`capacity-${item.id}`}>
                          <TextInput
                            id={`capacity-${item.id}`}
                            type="number"
                            className="min-h-12"
                            value={item.capacity}
                            onChange={(event) =>
                              update((previous) => ({
                                ...previous,
                                equipment: previous.equipment.map((row) =>
                                  row.id === item.id
                                    ? { ...row, capacity: Number(event.target.value) }
                                    : row,
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field
                          label={`${item.name}の利用可能開始`}
                          htmlFor={`equipment-start-${item.id}`}
                        >
                          <TextInput
                            id={`equipment-start-${item.id}`}
                            type="time"
                            className="min-h-12"
                            value={item.availablePeriods[0]?.startTime ?? ''}
                            onChange={(event) =>
                              update((previous) => ({
                                ...previous,
                                equipment: previous.equipment.map((row) =>
                                  row.id === item.id
                                    ? {
                                        ...row,
                                        availablePeriods: [
                                          {
                                            startTime: event.target.value,
                                            endTime: row.availablePeriods[0]?.endTime ?? '19:00',
                                          },
                                        ],
                                      }
                                    : row,
                                ),
                              }))
                            }
                          />
                        </Field>
                        <Field
                          label={`${item.name}の利用可能終了`}
                          htmlFor={`equipment-end-${item.id}`}
                        >
                          <TextInput
                            id={`equipment-end-${item.id}`}
                            type="time"
                            className="min-h-12"
                            value={item.availablePeriods[0]?.endTime ?? ''}
                            onChange={(event) =>
                              update((previous) => ({
                                ...previous,
                                equipment: previous.equipment.map((row) =>
                                  row.id === item.id
                                    ? {
                                        ...row,
                                        availablePeriods: [
                                          {
                                            startTime:
                                              row.availablePeriods[0]?.startTime ?? '10:00',
                                            endTime: event.target.value,
                                          },
                                        ],
                                      }
                                    : row,
                                ),
                              }))
                            }
                          />
                        </Field>
                      </div>
                    ) : (
                      <dl>
                        <Row term="台数">{item.capacity}台</Row>
                        <Row term="利用可能時間">{formatRange(item.availablePeriods[0])}</Row>
                      </dl>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel label="点検停止" className="space-y-2">
              <h3 className="font-display text-base font-semibold text-ink">点検停止</h3>
              <ul aria-label="点検停止" className="space-y-2">
                {draft.maintenance.length === 0 && (
                  <li className="font-sans text-sm text-ink-muted">設定なし</li>
                )}
                {draft.maintenance.map((item) => {
                  const equipment = draft.equipment.find((row) => row.id === item.equipmentId)
                  return (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center gap-3 font-sans text-sm text-ink"
                    >
                      <span>{equipment?.name ?? UNKNOWN}</span>
                      <span>{item.date}</span>
                      <span>
                        {item.startTime}–{item.endTime}
                      </span>
                      <span className="text-ink-muted">{item.reason}</span>
                    </li>
                  )
                })}
              </ul>
            </Panel>
          </div>
        )}

        {draft && current === 'web-booking' && (
          <div className="space-y-4">
            <Panel label="Web予約設定" plain className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldCard term="公開状態" value={publishStateLabel}>
                  {canManage && webDraft && (
                    <div className="mt-2 space-y-2">
                      <Select
                        aria-label="公開状態"
                        className="min-h-12"
                        value={webDraft.status}
                        onChange={(event) =>
                          setWebDraft({
                            ...webDraft,
                            status: event.target.value === 'published' ? 'published' : 'hidden',
                          })
                        }
                      >
                        <option value="published">公開</option>
                        <option value="hidden">非公開</option>
                      </Select>
                      <TextInput
                        aria-label="公開開始日時（JST）"
                        type="datetime-local"
                        className="min-h-12 w-full"
                        value={webDraft.startsAt ? toJstWallClock(webDraft.startsAt) : ''}
                        onChange={(event) =>
                          setWebDraft({
                            ...webDraft,
                            startsAt: fromJstWallClock(event.target.value),
                          })
                        }
                      />
                    </div>
                  )}
                </FieldCard>

                <FieldCard term="受付終了" value={receptionEndLabel}>
                  {canManage && webDraft && (
                    <TextInput
                      aria-label="受付終了日時（JST）"
                      type="datetime-local"
                      className="mt-2 min-h-12 w-full"
                      value={webDraft.endsAt ? toJstWallClock(webDraft.endsAt) : ''}
                      onChange={(event) =>
                        setWebDraft({ ...webDraft, endsAt: fromJstWallClock(event.target.value) })
                      }
                    />
                  )}
                </FieldCard>

                <FieldCard
                  term="予約可能期間"
                  value={webBookingRules ? `${webBookingRules.bookableDays}日先まで` : UNKNOWN}
                />
                <FieldCard
                  term="直前受付期限"
                  value={webBookingRules ? formatCutoff(webBookingRules.cutoffMinutes) : UNKNOWN}
                />
                <FieldCard
                  term="変更・取消期限"
                  value={webBookingRules ? webBookingRules.changeDeadline : UNKNOWN}
                />
                <FieldCard
                  term="期限後の案内"
                  value={webBookingRules ? webBookingRules.afterDeadlineGuidance : UNKNOWN}
                />

                <FieldCard term="公開する来店目的" value={publicPurposeLabel} wide>
                  {canManage && webDraft && (
                    <ul className="mt-2 space-y-1">
                      {draft.purposes.map((purpose) => (
                        <li key={purpose.id}>
                          <label className="flex min-h-12 items-center gap-2 font-sans text-ink text-sm">
                            <input
                              type="checkbox"
                              aria-label={`${purpose.staffName}をWeb予約に公開する`}
                              checked={webDraft.publicPurposeIds.includes(purpose.id)}
                              onChange={(event) =>
                                setWebDraft({
                                  ...webDraft,
                                  publicPurposeIds: event.target.checked
                                    ? [...webDraft.publicPurposeIds, purpose.id]
                                    : webDraft.publicPurposeIds.filter((id) => id !== purpose.id),
                                })
                              }
                            />
                            {purpose.staffName}
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </FieldCard>

                <FieldCard
                  term="受付時間"
                  value={WEEKDAY_LABEL.map(
                    (name, dayOfWeek) => `${name} ${formatRange(periodOf(dayOfWeek))}`,
                  ).join(' / ')}
                  wide
                />
              </div>

              {!webDraft && (
                <Notice tone="info">Web予約の公開設定はまだ取得できていません。</Notice>
              )}
              {canManage && webDraft && (
                <Notice tone="info">
                  Web予約の公開設定を保存するAPIはまだありません。ここでの変更は保存されません。
                </Notice>
              )}
              <p className="font-sans text-ink-muted text-sm">
                受付停止は新しいWeb予約だけを止めます。既存予約は取り消されません。
              </p>
            </Panel>

            <Panel label="店舗ページプレビュー" className="space-y-2">
              <h3 className="font-display font-semibold text-base text-ink">店舗ページ</h3>
              <p className="font-sans text-ink-muted text-sm">
                店舗名、アクセス、電話番号、注意事項をプレビュー
              </p>
              <dl>
                <Row term="店舗名">{storeName}</Row>
                <Row term="アクセス">{webDraft ? webDraft.accessText : UNKNOWN}</Row>
                <Row term="電話番号">{webDraft ? webDraft.contactPhone : UNKNOWN}</Row>
                <Row term="注意事項">{webDraft ? webDraft.notice : UNKNOWN}</Row>
              </dl>
            </Panel>
          </div>
        )}

        {draft && current === 'impact' && (
          <SettingsPublication
            storeId={storeId}
            storeName={storeName}
            api={api}
            navigate={navigate}
            permissions={permissions}
            today={today}
            dirty={!saved}
          />
        )}

        {draft && canManage && (
          <div className="flex justify-end">
            <Button className="min-h-12" onClick={() => void save()}>
              設定を保存
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

/** `眼鏡作製技能, 調整` → `['眼鏡作製技能','調整']`。空要素は落とす。 */
function splitList(value: string): string[] {
  return value
    .split(/[,、]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}
