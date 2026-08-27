import {
  type AvailabilityException,
  type AvailabilityExceptionMode,
  type AvailabilityPurpose,
  type AvailabilityStaffShift,
  AvailabilityStoreSettings,
  type StorePermission,
  type WebBookingPublication,
} from '@app/contracts'
import { Fragment, type ReactNode, useEffect, useState } from 'react'
import { Action, Actions, FilterLine } from './design/controls'
import { CheckToggle, SelectField, TextField, ToggleFilter } from './design/forms'
import { FullScreenState, GuideLayout, GuideStep } from './design/layouts'
import { FailureNotice, StatusNotice } from './design/notices'
import { Card, CardGrid, FieldCard, Preview, TitleRow } from './design/surfaces'
import { SettingsPublication } from './SettingsPublication'
import {
  DEFAULT_PURPOSE_TEMPLATE,
  deriveStepStates,
  formatJapaneseDate,
  formatSlashDate,
  SETTINGS_STEP_BY_ID,
  SETTINGS_STEPS,
  type SettingsStepId,
  STEP_STATE_LABEL,
  type StepState,
  stepperSummary,
  summariseBusinessHours,
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

/** 工程の状態を、承認済みモックの工程レールの見た目へ移す。 */
const RAIL_STATE: Record<StepState, 'todo' | 'done' | 'current'> = {
  complete: 'done',
  editing: 'current',
  incomplete: 'todo',
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

/**
 * 読み取りカードの中の複数行。`<br>` で区切るのはモックの `.field` がそう
 * 組まれているため（段落にすると既定の上下余白が入り、76px の中で位置がずれる）。
 */
function Lines({ lines }: { lines: readonly string[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={line}>
          {index > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </>
  )
}

/*
 * 入力欄の型について。
 *
 * `type="time"` / `type="date"` / `type="datetime-local"` は、値こそ 24 時間の
 * `HH:mm` と ISO の日付だが、**描かれる字はブラウザの地域設定で決まる**
 * （`10:00 AM` / `mm/dd/yyyy`）。この画面は読み取りカードも承認済みモックも
 * 24 時間表記と日本語の日付で統一されているので、編集欄だけが英語の 12 時間
 * 表記になると、同じ値が 2 通りの姿で並ぶ。
 *
 * 値の形は変わらないので、素の text にして表記をこちらで決める。刻みの
 * ピッカーは失うが、営業時間は 15 分単位の決め打ちで、時計の絵より
 * 「今なんと書いてあるか」が一致していることの方が効く。
 */
const TIME_HINT = { inputMode: 'numeric' as const, placeholder: '10:00' }
const DATE_HINT = { inputMode: 'numeric' as const, placeholder: '2026-09-23' }
const DATE_TIME_HINT = { inputMode: 'numeric' as const, placeholder: '2026-09-15T10:00' }

/**
 * 入力欄をまとめて開く面。モックは読み取りカードしか持たないので、編集は
 * 「編集」を押した先に置く（`Preview` の枠に入れて、読み取りカードとの
 * 境目を面で示す）。
 */
function Editor({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Preview label={label}>
      <div className="flex flex-col gap-3">{children}</div>
    </Preview>
  )
}

type Draft = AvailabilityStoreSettings

/**
 * 設定ガイド 6 工程（AC-EYEX-40）とその編集画面。
 *
 * 見た目は承認済みモック `settings-complete-approved.html` の語彙
 * （`design/layouts` の `GuideLayout` / `GuideStep`、`design/surfaces` の
 * `FieldCard` / `Preview`）で組む。本文は読み取りカードが既定で、入力欄は
 * 明示的な「編集」の先にある。
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
  /**
   * 入力欄を開いているか。工程を移ると閉じる — 別の工程の欄がいきなり開いて
   * いると、いま何を直しているのかが読めなくなる。
   */
  const [editing, setEditing] = useState(false)
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
      <FullScreenState
        glyph="—"
        title="この設定を表示する権限がありません"
        actions={
          <Action size="roomy" variant="primary" onClick={() => navigate({ screen: 'home' })}>
            業務開始画面へ戻る
          </Action>
        }
      >
        <p>権限のある管理者に確認してください。設定の存在や内容はこれ以上表示しません。</p>
      </FullScreenState>
    )
  }

  const states = deriveStepStates({
    current,
    settings: draft,
    webBookingConfigured: webBooking !== undefined,
  })
  const summary = stepperSummary(states, current)
  const activeStep = SETTINGS_STEP_BY_ID[current]
  const nextStep = SETTINGS_STEPS[activeStep.number]

  const goToStep = (id: SettingsStepId) => {
    setCurrent(id)
    setEditing(false)
  }

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

  /* ---------------- 工程レール（モックの `.steps`） ---------------- */

  const rail = (
    <>
      {/*
       * SP 幅だけに出す固定ステッパーの要約（AC-EYEX-72, 73）。iPad 幅の
       * モックには無い段なので、そこでは出さない。
       */}
      <div className="md:hidden">
        <p className="my-0 flex items-baseline justify-between gap-2 text-note">
          <span className="font-bold text-pine">{summary.headline}</span>
          <span>{summary.remainingLabel}</span>
        </p>
        <p className="my-0 text-note">{`現在の状態: ${summary.stateLabel}`}</p>
      </div>
      {SETTINGS_STEPS.map((candidate) => (
        <GuideStep
          key={candidate.id}
          index={candidate.number}
          label={candidate.label}
          state={RAIL_STATE[states[candidate.id]]}
          // レールに出る字は番号か ✓ と工程名だけ。状態の語は読み上げの名前が持つ。
          name={`工程${candidate.number} ${candidate.label} ${STEP_STATE_LABEL[states[candidate.id]]}`}
          onClick={() => goToStep(candidate.id)}
        />
      ))}
    </>
  )

  /* ---------------- 工程 1: 店舗と営業時間 ---------------- */

  const hours = draft ? summariseBusinessHours(draft.businessHours) : undefined
  const closedDates = (draft?.exceptions ?? [])
    .filter((exception) => exception.mode === 'closed')
    .map((exception) => formatJapaneseDate(exception.date))
  const openExceptions = (draft?.exceptions ?? [])
    .filter((exception) => exception.mode === 'open')
    .map(
      (exception) =>
        `${formatJapaneseDate(exception.date)} ${exception.periods.map((period) => formatRange(period)).join('・')}`,
    )
  const pausedExceptions = (draft?.exceptions ?? [])
    .filter((exception) => exception.mode === 'paused')
    .map((exception) => formatJapaneseDate(exception.date))

  const storeHours = draft && hours && (
    <>
      <CardGrid columns={2} mt={4}>
        <FieldCard title="通常営業時間">
          <Lines lines={hours.openLines.length > 0 ? hours.openLines : ['設定なし']} />
        </FieldCard>
        <FieldCard title="休業日">{[hours.closedLabel, ...closedDates].join('・')}</FieldCard>
        <FieldCard title="臨時営業">
          <Lines lines={openExceptions.length > 0 ? openExceptions : ['設定なし']} />
        </FieldCard>
        <FieldCard title="受付停止">
          <Lines
            lines={
              draft.receptionStatus === 'paused'
                ? ['受付停止', ...pausedExceptions]
                : pausedExceptions.length > 0
                  ? pausedExceptions
                  : ['設定なし']
            }
          />
        </FieldCard>
      </CardGrid>
      {editing && canManage && (
        <Editor label="営業時間の編集">
          {WEEKDAY_LABEL.map((name, dayOfWeek) => {
            const period = periodOf(dayOfWeek)
            return (
              <div key={name} className="flex flex-wrap items-end gap-3">
                <span className="min-h-12 w-12 leading-12">{name}曜</span>
                <span className="flex min-h-12 items-center gap-2">
                  <CheckToggle
                    label={`${name}曜を営業日にする`}
                    checked={period !== undefined}
                    onChange={(on) =>
                      setDayPeriod(
                        dayOfWeek,
                        on ? { startTime: '10:00', endTime: '19:00' } : undefined,
                      )
                    }
                  />
                  営業
                </span>
                <TextField
                  id={`business-start-${dayOfWeek}`}
                  hideLabel
                  label={`${name}曜の営業開始`}
                  {...TIME_HINT}
                  className="max-w-32"
                  value={period?.startTime ?? ''}
                  disabled={!period}
                  onChange={(event) =>
                    period && setDayPeriod(dayOfWeek, { ...period, startTime: event.target.value })
                  }
                />
                <TextField
                  id={`business-end-${dayOfWeek}`}
                  hideLabel
                  label={`${name}曜の営業終了`}
                  {...TIME_HINT}
                  className="max-w-32"
                  value={period?.endTime ?? ''}
                  disabled={!period}
                  onChange={(event) =>
                    period && setDayPeriod(dayOfWeek, { ...period, endTime: event.target.value })
                  }
                />
              </div>
            )
          })}

          <ul aria-label="臨時営業・休業日" className="flex flex-col gap-2">
            {draft.exceptions.length === 0 && <li>設定なし</li>}
            {draft.exceptions.map((exception) => (
              <li
                key={`${exception.date}-${exception.mode}`}
                className="flex flex-wrap items-center gap-3"
              >
                <span>{exception.date}</span>
                <span>{EXCEPTION_MODE_LABEL[exception.mode]}</span>
                <span>{exception.periods.map((period) => formatRange(period)).join('・')}</span>
                <span>{exception.reason ?? ''}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-3">
            <TextField
              id="exception-date"
              label="日付"
              {...DATE_HINT}
              value={exceptionDate}
              onChange={(event) => setExceptionDate(event.target.value)}
            />
            <SelectField
              id="exception-mode"
              label="区分"
              value={exceptionMode}
              onChange={(event) =>
                setExceptionMode(event.target.value as AvailabilityExceptionMode)
              }
            >
              <option value="closed">休業</option>
              <option value="open">臨時営業</option>
              <option value="paused">受付停止</option>
            </SelectField>
            <TextField
              id="exception-reason"
              label="理由"
              value={exceptionReason}
              onChange={(event) => setExceptionReason(event.target.value)}
            />
            <Action
              onClick={() => {
                if (exceptionDate === '') return
                const exception: AvailabilityException = {
                  date: exceptionDate,
                  mode: exceptionMode,
                  periods:
                    exceptionMode === 'open' ? [{ startTime: '10:00', endTime: '17:00' }] : [],
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
            </Action>
          </div>

          <SelectField
            id="reception-status"
            label="受付状態"
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
          </SelectField>
          <p className="my-0">
            受付停止は新しいWeb予約だけを止めます。既存予約は取り消されません。
          </p>
        </Editor>
      )}
    </>
  )

  /* ---------------- 工程 2: 来店目的 ---------------- */

  const purposes = draft && (
    <div>
      {draft.purposes.length === 0 ? (
        <Preview label="標準テンプレート">
          <b>標準テンプレート</b>
          <span className="block">
            新規店舗向けの初期値です。読み込んだあとで店舗ごとに変更できます。
          </span>
          {DEFAULT_PURPOSE_TEMPLATE.map((template) => (
            <span key={template.staffName} className="mt-2.5 block">
              <b>{template.staffName}</b>
              <span className="block">{template.customerLabel}</span>
              <span className="block">
                {`${template.durationMinutes}分 · ${template.slotIntervalMinutes}分単位 · 同時${template.maxConcurrent}件`}
              </span>
              <span className="block">{`技能: ${template.requiredSkills.join('、')}`}</span>
              <span className="block">{`設備: ${template.requiredEquipment.join('、')}`}</span>
              <span className="block">{template.isPublic ? 'Web公開' : 'Web非公開'}</span>
            </span>
          ))}
          {canManage && (
            <Actions gap={2.5} mt={4}>
              <Action
                onClick={() =>
                  update((previous) => {
                    const loaded = DEFAULT_PURPOSE_TEMPLATE.map((template) => ({
                      id: newId(),
                      ...template,
                    }))
                    setSelectedPurposeId(loaded[0]?.id)
                    return { ...previous, purposes: loaded }
                  })
                }
              >
                標準テンプレートを読み込む
              </Action>
            </Actions>
          )}
        </Preview>
      ) : (
        selectedPurpose && (
          <>
            <CardGrid columns={2} mt={4}>
              <FieldCard title="スタッフ向け名称">{selectedPurpose.staffName}</FieldCard>
              <FieldCard title="お客様への質問">{selectedPurpose.customerLabel}</FieldCard>
              <FieldCard title="標準所要時間">
                {`${selectedPurpose.durationMinutes}分 · ${selectedPurpose.slotIntervalMinutes}分単位`}
              </FieldCard>
              <FieldCard title="同時受付数">{`${selectedPurpose.maxConcurrent}件`}</FieldCard>
              <FieldCard title="必要技能">{selectedPurpose.requiredSkills.join('・')}</FieldCard>
              <FieldCard title="必要設備">{selectedPurpose.requiredEquipment.join('・')}</FieldCard>
            </CardGrid>
            {/* 店員向けの名称ではなく、お客様に見える言い回しで確認させる。 */}
            <Preview label="Web予約プレビュー">
              <b>Web予約プレビュー</b>
              <br />
              {`${selectedPurpose.customerLabel} · 約${selectedPurpose.durationMinutes}分`}
              <span className="block">
                {selectedPurpose.isPublic
                  ? 'この目的はWeb予約の選択肢に表示されます。'
                  : 'この目的はWeb予約の選択肢に表示されません。'}
              </span>
            </Preview>
            {editing && canManage && (
              <Editor label="来店目的の編集">
                <TextField
                  id="purpose-staff-name"
                  label="スタッフ向け名称"
                  value={selectedPurpose.staffName}
                  onChange={(event) => updatePurpose({ staffName: event.target.value })}
                />
                <TextField
                  id="purpose-customer-label"
                  label="顧客向け表示名"
                  value={selectedPurpose.customerLabel}
                  onChange={(event) => updatePurpose({ customerLabel: event.target.value })}
                />
                <TextField
                  id="purpose-duration"
                  label="標準所要時間（分）"
                  type="number"
                  value={selectedPurpose.durationMinutes}
                  onChange={(event) =>
                    updatePurpose({ durationMinutes: Number(event.target.value) })
                  }
                />
                <TextField
                  id="purpose-interval"
                  label="時間調整単位（分）"
                  type="number"
                  value={selectedPurpose.slotIntervalMinutes}
                  onChange={(event) =>
                    updatePurpose({ slotIntervalMinutes: Number(event.target.value) })
                  }
                />
                <TextField
                  id="purpose-concurrent"
                  label="同時受付数"
                  type="number"
                  value={selectedPurpose.maxConcurrent}
                  onChange={(event) => updatePurpose({ maxConcurrent: Number(event.target.value) })}
                />
                <TextField
                  id="purpose-skills"
                  label="必要技能"
                  value={selectedPurpose.requiredSkills.join(', ')}
                  onChange={(event) =>
                    updatePurpose({ requiredSkills: splitList(event.target.value) })
                  }
                />
                <TextField
                  id="purpose-equipment"
                  label="必要設備"
                  value={selectedPurpose.requiredEquipment.join(', ')}
                  onChange={(event) =>
                    updatePurpose({ requiredEquipment: splitList(event.target.value) })
                  }
                />
                <span className="flex min-h-12 items-center gap-2">
                  <CheckToggle
                    label="Web予約に公開する"
                    checked={selectedPurpose.isPublic}
                    onChange={(isPublic) => updatePurpose({ isPublic })}
                  />
                  Web予約に公開する
                </span>
                <p className="my-0">
                  非公開にすると新規の選択肢から外れます。既存予約と履歴は削除されません。
                </p>
              </Editor>
            )}
          </>
        )
      )}
    </div>
  )

  /* ---------------- 工程 3: スタッフと技能 ---------------- */

  const staffSkills = draft && (
    <>
      {draft.staff.length === 0 && (
        <Card className="mt-4 min-h-19">スタッフが登録されていません。</Card>
      )}
      {draft.staff.map((member) => {
        const shift = shiftOf(member.id)
        const line = [
          `勤務 ${formatRange(shift)}`,
          ...(shift?.breaks[0] ? [`休憩 ${formatRange(shift.breaks[0])}`] : []),
          member.canBook ? '予約受付可' : '予約受付不可',
        ].join(' · ')
        return (
          // カードは隙間なく縦に接する。空けると「1 人 1 枚」ではなく
          // 「別々の設定」に読めてしまう（モックの `.card` に margin が無い）。
          <Card key={member.id} className="min-h-19">
            <b>{member.name}</b>
            {'　'}
            {member.skills.join('・')}
            <br />
            {line}
          </Card>
        )
      })}
      {editing && canManage && (
        <Editor label="スタッフと技能の編集">
          {draft.staff.map((member) => {
            const shift = shiftOf(member.id)
            return (
              <div key={member.id} className="flex flex-wrap items-end gap-3">
                <TextField
                  id={`skills-${member.id}`}
                  label={`${member.name}の技能`}
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
                <TextField
                  id={`shift-start-${member.id}`}
                  label={`${member.name}の勤務開始`}
                  {...TIME_HINT}
                  value={shift?.startTime ?? ''}
                  onChange={(event) => updateShift(member.id, { startTime: event.target.value })}
                />
                <TextField
                  id={`shift-end-${member.id}`}
                  label={`${member.name}の勤務終了`}
                  {...TIME_HINT}
                  value={shift?.endTime ?? ''}
                  onChange={(event) => updateShift(member.id, { endTime: event.target.value })}
                />
                <TextField
                  id={`break-start-${member.id}`}
                  label={`${member.name}の休憩開始`}
                  {...TIME_HINT}
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
                <TextField
                  id={`break-end-${member.id}`}
                  label={`${member.name}の休憩終了`}
                  {...TIME_HINT}
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
                <span className="flex min-h-12 items-center gap-2">
                  <CheckToggle
                    label={`${member.name}は予約を受け付ける`}
                    checked={member.canBook}
                    onChange={(canBook) =>
                      update((previous) => ({
                        ...previous,
                        staff: previous.staff.map((row) =>
                          row.id === member.id ? { ...row, canBook } : row,
                        ),
                      }))
                    }
                  />
                  予約受付可
                </span>
              </div>
            )
          })}
        </Editor>
      )}
    </>
  )

  /* ---------------- 工程 4: 設備と点検 ---------------- */

  const maintenanceLines = (draft?.maintenance ?? []).flatMap((item) => {
    const equipment = draft?.equipment.find((row) => row.id === item.equipmentId)
    return [
      `${equipment?.name ?? UNKNOWN} · ${formatSlashDate(item.date)} ${item.startTime}–${item.endTime}`,
      item.reason,
    ]
  })

  const equipment = draft && (
    <>
      <CardGrid columns={2} mt={4}>
        {draft.equipment.map((item) => (
          <FieldCard key={item.id} title={item.name}>
            {`${item.capacity}台 · ${formatRange(item.availablePeriods[0])}`}
          </FieldCard>
        ))}
        {/* 点検停止も設備と同じ 1 枚のカードで並ぶ。停止だけ別扱いにすると、
            「今日この店で使えるもの」を数えるのに 2 か所を見ることになる。 */}
        <FieldCard title="点検停止">
          <Lines lines={maintenanceLines.length > 0 ? maintenanceLines : ['設定なし']} />
        </FieldCard>
      </CardGrid>
      {editing && canManage && (
        <Editor label="設備の編集">
          {draft.equipment.map((item) => (
            <div key={item.id} className="flex flex-wrap items-end gap-3">
              <TextField
                id={`capacity-${item.id}`}
                label={`${item.name}の台数`}
                type="number"
                value={item.capacity}
                onChange={(event) =>
                  update((previous) => ({
                    ...previous,
                    equipment: previous.equipment.map((row) =>
                      row.id === item.id ? { ...row, capacity: Number(event.target.value) } : row,
                    ),
                  }))
                }
              />
              <TextField
                id={`equipment-start-${item.id}`}
                label={`${item.name}の利用可能開始`}
                {...TIME_HINT}
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
              <TextField
                id={`equipment-end-${item.id}`}
                label={`${item.name}の利用可能終了`}
                {...TIME_HINT}
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
                                startTime: row.availablePeriods[0]?.startTime ?? '10:00',
                                endTime: event.target.value,
                              },
                            ],
                          }
                        : row,
                    ),
                  }))
                }
              />
            </div>
          ))}
        </Editor>
      )}
    </>
  )

  /* ---------------- 工程 5: Web予約 ---------------- */

  const webBookingStep = draft && (
    <>
      <section aria-label="Web予約設定">
        {/*
         * モックの 6 枚に加えて「公開する来店目的」「受付時間」を同じ形で並べる。
         * モックは 1 店舗ぶんの例なので出てこないが、この 2 つを落とすと
         * 「何がWebに出ているのか」が画面のどこにも残らない。
         */}
        <CardGrid columns={2} mt={4}>
          <FieldCard title="公開状態">{publishStateLabel}</FieldCard>
          <FieldCard title="受付終了">{receptionEndLabel}</FieldCard>
          <FieldCard title="予約可能期間">
            {webBookingRules ? `${webBookingRules.bookableDays}日先まで` : UNKNOWN}
          </FieldCard>
          <FieldCard title="直前受付期限">
            {webBookingRules ? formatCutoff(webBookingRules.cutoffMinutes) : UNKNOWN}
          </FieldCard>
          <FieldCard title="変更・取消期限">
            {webBookingRules ? webBookingRules.changeDeadline : UNKNOWN}
          </FieldCard>
          <FieldCard title="期限後の案内">
            {webBookingRules ? webBookingRules.afterDeadlineGuidance : UNKNOWN}
          </FieldCard>
          <FieldCard title="公開する来店目的">{publicPurposeLabel}</FieldCard>
          {/* 曜日を 7 行並べるとカードだけが縦に伸びる。工程1と同じ要約で読ませる。 */}
          <FieldCard title="受付時間">
            <Lines lines={hours ? hours.openLines : [UNKNOWN]} />
          </FieldCard>
        </CardGrid>
        {!webDraft && (
          <Preview tone="caution" label="Web予約の取得状態">
            Web予約の公開設定はまだ取得できていません。
          </Preview>
        )}
        {editing && canManage && webDraft && (
          <Editor label="Web予約の編集">
            <SelectField
              id="web-publish-status"
              hideLabel
              label="公開状態"
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
            </SelectField>
            <TextField
              id="web-starts-at"
              hideLabel
              label="公開開始日時（JST）"
              {...DATE_TIME_HINT}
              value={webDraft.startsAt ? toJstWallClock(webDraft.startsAt) : ''}
              onChange={(event) =>
                setWebDraft({ ...webDraft, startsAt: fromJstWallClock(event.target.value) })
              }
            />
            <TextField
              id="web-ends-at"
              hideLabel
              label="受付終了日時（JST）"
              {...DATE_TIME_HINT}
              value={webDraft.endsAt ? toJstWallClock(webDraft.endsAt) : ''}
              onChange={(event) =>
                setWebDraft({ ...webDraft, endsAt: fromJstWallClock(event.target.value) })
              }
            />
            {draft.purposes.map((purpose) => (
              <span key={purpose.id} className="flex min-h-12 items-center gap-2">
                <CheckToggle
                  label={`${purpose.staffName}をWeb予約に公開する`}
                  checked={webDraft.publicPurposeIds.includes(purpose.id)}
                  onChange={(on) =>
                    setWebDraft({
                      ...webDraft,
                      publicPurposeIds: on
                        ? [...webDraft.publicPurposeIds, purpose.id]
                        : webDraft.publicPurposeIds.filter((id) => id !== purpose.id),
                    })
                  }
                />
                {purpose.staffName}
              </span>
            ))}
            {/* 保存先の API がまだ無いことを黙らない。 */}
            <p className="my-0">
              Web予約の公開設定を保存するAPIはまだありません。ここでの変更は保存されません。
            </p>
            <p className="my-0">
              受付停止は新しいWeb予約だけを止めます。既存予約は取り消されません。
            </p>
          </Editor>
        )}
      </section>
      <Preview label="店舗ページプレビュー">
        <b>店舗ページ</b>
        {'　'}店舗名、アクセス、電話番号、注意事項をプレビュー
        <span className="mt-2.5 block">{storeName}</span>
        <span className="block">{webDraft ? webDraft.accessText : UNKNOWN}</span>
        <span className="block">{webDraft ? webDraft.contactPhone : UNKNOWN}</span>
        <span className="block">{webDraft ? webDraft.notice : UNKNOWN}</span>
      </Preview>
    </>
  )

  /* ---------------- 面 ---------------- */

  const heading =
    current === 'purposes' && selectedPurpose ? selectedPurpose.staffName : activeStep.label
  const originLabel = chainDefaults
    ? chainDefaults.source === 'chain'
      ? '全店共通'
      : '店舗設定'
    : UNKNOWN

  return (
    <section aria-label="店舗設定" className="flex min-h-full flex-col font-sans">
      <GuideLayout steps={rail}>
        {/* 第6工程は公開画面が自分の見出しを持つ（モックどおり見出しを重ねない）。 */}
        {current !== 'impact' && (
          <>
            <TitleRow push={<span>{`適用元: ${originLabel}`}</span>}>
              <h1>{heading}</h1>
            </TitleRow>
            {chainDefaults && chainDefaults.overriddenFields.length > 0 && (
              <p className="my-0">{`店舗上書き: ${chainDefaults.overriddenFields.join('、')}`}</p>
            )}
            {/* 目的は複数あり、どれを見ているのかは工程名からは分からない。 */}
            {current === 'purposes' && draft && draft.purposes.length > 1 && (
              <FilterLine>
                {draft.purposes.map((purpose) => (
                  <ToggleFilter
                    key={purpose.id}
                    on={purpose.id === selectedPurposeId}
                    onClick={() => setSelectedPurposeId(purpose.id)}
                  >
                    {purpose.staffName}
                  </ToggleFilter>
                ))}
              </FilterLine>
            )}
          </>
        )}

        {!canManage && <StatusNotice>設定を変更する権限がありません。</StatusNotice>}
        {error && <FailureNotice>{error}</FailureNotice>}
        {saved && <StatusNotice>設定を保存しました。</StatusNotice>}
        {!draft && !error && <StatusNotice>読み込み中です。</StatusNotice>}

        {current === 'store-hours' && storeHours}
        {current === 'purposes' && purposes}
        {current === 'staff-skills' && staffSkills}
        {current === 'equipment' && equipment}
        {current === 'web-booking' && webBookingStep}
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

        {draft && current !== 'impact' && (
          <Actions gap={2.5} mt={4}>
            {canManage &&
              (editing ? (
                <Action onClick={() => setEditing(false)}>編集を終える</Action>
              ) : (
                <Action onClick={() => setEditing(true)}>編集</Action>
              ))}
            {canManage && <Action onClick={() => void save()}>設定を保存</Action>}
            {nextStep && (
              <Action variant="primary" onClick={() => goToStep(nextStep.id)}>
                {`${nextStep.label}へ`}
              </Action>
            )}
          </Actions>
        )}
      </GuideLayout>
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
