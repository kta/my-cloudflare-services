import {
  AvailabilitySlotsResponse,
  AvailabilityStoreSettings,
  type CustomerCandidate,
  Recording,
  type RecordingEndReason,
  type RecordingState,
  Reservation,
  type StorePermission,
} from '@app/contracts'
import { type ReactNode, useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { barOverlay } from './app-chrome'
import { BookingCustomerStepContext } from './CustomerPanel'
import {
  FieldButton,
  FlowButton,
  type FlowStep,
  Option,
  OptionGrid,
  ProgressFooter,
  RailSummary,
  Readout,
  Script,
} from './design/booking'
import { Action, Actions } from './design/controls'
import { Modal } from './design/dialogs'
import { TextAreaField, TextField } from './design/forms'
import { BookingLayout } from './design/layouts'
import { FailureNotice } from './design/notices'
import { Card, Notice } from './design/surfaces'
import { createMicrophoneRecorder } from './microphone'
import {
  BookingRecordingRail,
  type MicrophonePermissionResult,
  RecordingIndicator,
  RecordingUploadFailedScreen,
} from './RecordingIndicator'
import { canTransitionRecording } from './recording'
import {
  createStaffBookingDraft,
  desiredTimes,
  hasUnsavedBookingInput,
  japaneseDayLabel,
  nearestAlternatives,
  receivableDates,
  recitalSentence,
  STAFF_BOOKING_STEPS,
  type StaffBookingDraft,
  staffBookingReducer,
  stepPosition,
  toReservationCreate,
  totalDurationMinutes,
} from './staff-booking'
import type { StaffScreenProps } from './staff-screen'

/*
 * 電話・店頭予約、5 工程固定。承認済みモックが見た目と情報階層の正である
 * （BOOK-TIME / BOOK-PURPOSE-CONFLICT / BOOK-CUSTOMER / BOOK-REPEAT /
 * BOOK-MIC-PERMISSION、および EX-MIC-DENIED / EX-UPLOAD-FAILED）。
 *
 * 構造は 3 列ではなく 2 列である: 左に読み上げる問いかけと選択肢、右に 1 本の
 * 脇の列（工程ごとに「ここまでの内容 / 代替時刻 / 選択中のお客様 /
 * 確保する接客資源」と中身が入れ替わる）、下に 5 工程の進捗バー。
 *
 * 進捗バーの右端には録音が `● 02:14` として常時出る。工程状態は下線の色だけ
 * でなく、位置とラベルと読み上げ用の状態語でも読める。
 *
 * 何も永続化しない。途中の受付は記憶の中だけにある。
 */

export type BookingFlowProps = StaffScreenProps & {
  /** JST YYYY-MM-DD, injected — この画面は時計を読まない。 */
  today: string
  newIdempotencyKey?: () => string
  /** お客様の特定は別部品。4 工程目の 2 列をまるごと受け持つ。 */
  customerSlot?: ReactNode
  /**
   * この受付を捨てるとスタッフの作業が失われるかを親へ知らせる。店舗切替を
   * 割り込ませるために使う（UC-EYEX-065, AC-EYEX-29）。
   */
  onUnsavedInputChange?: (hasUnsavedInput: boolean) => void
  /** 注入された時刻。この画面は壁時計を読まない。 */
  now?: string
  /** 唯一の時計境界。`startedAt` / `endedAt` と録音の経過秒はここから来る。 */
  clock?: () => string
  /** 選択中店舗でこの操作者に許されていること。 */
  permissions?: StorePermission[]
  /** ブラウザのマイク権限。注入なので `navigator` に触れない（AC-EYEX-113）。 */
  requestMicrophonePermission?: () => Promise<MicrophonePermissionResult>
  captureRecordingAudio?: () => Promise<Blob | null>
  /** 誰が録音しているか。共有 iPad は人ではなく端末として録音する。 */
  recorder?: { type: 'personal' | 'shared_terminal'; id: string }
  newRecordingSessionId?: () => string
}

/** 再送は回数を区切り、数を隠さない。 */
const MAX_UPLOAD_ATTEMPTS = 5

/*
 * 1 フローに 1 つのマイク。権限要求と収録は同じ端末セッションの表裏なので、
 * 同じ recorder から来なければならない。
 */
const defaultMicrophone = createMicrophoneRecorder(
  typeof navigator === 'undefined'
    ? { getUserMedia: async () => Promise.reject(new Error('no media devices')) }
    : navigator.mediaDevices,
)

/* ------------------------------------------------------------------ *
 * 工程バーの読み替え
 * ------------------------------------------------------------------ */

/**
 * 下書きの工程を、下部バーが読む 5 つの状態へ均す。
 *
 * 予約が成立した後（`complete`）は 5 つとも済んでいる。工程番号を持たない
 * 状態なので、位置の比較ではなくここで明示的に振り分ける。
 */
function flowSteps(step: StaffBookingDraft['step']): FlowStep[] {
  const current = stepPosition(step)
  return STAFF_BOOKING_STEPS.map((entry, index) => {
    const position = index + 1
    const state: FlowStep['state'] =
      step === 'complete' || position < current ? 'done' : position === current ? 'current' : 'todo'
    return { label: entry.label, state }
  })
}

/* ------------------------------------------------------------------ *
 * 画面
 * ------------------------------------------------------------------ */

export function BookingFlow({
  storeId,
  storeName,
  api,
  navigate,
  today,
  newIdempotencyKey = () => crypto.randomUUID(),
  customerSlot,
  onUnsavedInputChange,
  now = `${today}T00:00:00.000+09:00`,
  clock = () => now,
  permissions = [],
  requestMicrophonePermission = () => defaultMicrophone.requestPermission(),
  captureRecordingAudio = () => defaultMicrophone.capture(),
  recorder = { type: 'personal', id: 'unknown' },
  newRecordingSessionId = () => crypto.randomUUID(),
}: BookingFlowProps) {
  const [draft, dispatch] = useReducer(staffBookingReducer, undefined, createStaffBookingDraft)
  /*
   * 4 工程目は 2 つの面を持つ。モックが描いているのは「特定」の面（電話番号と
   * 候補）だけで、氏名・かな・メモは候補を選んだ後の面に移した。工程番号は
   * どちらも 4 / 5 のままである。
   */
  const [customerStage, setCustomerStage] = useState<'identify' | 'details'>('identify')
  const unsavedInput = hasUnsavedBookingInput(draft)
  useEffect(() => {
    onUnsavedInputChange?.(unsavedInput)
  }, [onUnsavedInputChange, unsavedInput])

  /*
   * 録音は予約の隣に立つ。破棄した受付にも録音は残り、成立した予約の隣で
   * 再送が続くこともある（UC-EYEX-041, AC-EYEX-89）。
   */
  const [sessionId] = useState(newRecordingSessionId)
  const [recordingState, setRecordingState] = useState<RecordingState>('permission_check')
  const recordingRef = useRef<RecordingState>('permission_check')
  /** 一度ブラウザに拒否されたか。要求前と拒否後で脇の列の言うことが変わる。 */
  const [permissionDenied, setPermissionDenied] = useState(false)
  /** スタッフが「録音せず続ける」を選ぶまで、録音の面は脇の列に立っている。 */
  const [recordingOffered, setRecordingOffered] = useState(true)
  const [requestingPermission, setRequestingPermission] = useState(false)
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null)
  const [upload, setUpload] = useState<{
    attempt: number
    maxAttempts: number
    lastAttemptAt: string
  } | null>(null)

  const mayRecord = permissions.includes('recording.read')

  /*
   * 経過秒は注入された時計からしか来ない。テストは凍った時計を渡すので
   * 00:00 のまま止まり、実機だけが 1 秒ごとに進む。
   */
  const clockRef = useRef(clock)
  clockRef.current = clock
  useEffect(() => {
    if (recordingState !== 'recording' || startedAt === null) {
      setElapsedSeconds(null)
      return undefined
    }
    const began = Date.parse(startedAt)
    const tick = () =>
      setElapsedSeconds(Math.max(0, Math.floor((Date.parse(clockRef.current()) - began) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [recordingState, startedAt])

  /*
   * 状態変更は Worker と同じ遷移表を通る。サーバーが拒む遷移をクライアントが
   * 描くことも送ることもできない。
   */
  const moveRecording = useCallback((to: RecordingState): boolean => {
    if (!canTransitionRecording(recordingRef.current, to)) return false
    recordingRef.current = to
    setRecordingState(to)
    return true
  }, [])

  /** 真実はサーバーが持つ。それを描いてよいかは遷移表が決める。 */
  const applyServerState = (recording: Recording) => {
    if (recording.state === recordingRef.current) return
    moveRecording(recording.state)
  }

  const [settings, setSettings] = useState<AvailabilityStoreSettings>()
  const [loadError, setLoadError] = useState<string>()
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api(`/api/staff/stores/${storeId}/availability/settings`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`settings ${response.status}`)
        return AvailabilityStoreSettings.parse(await response.json())
      })
      .then((parsed) => {
        if (!cancelled) setSettings(parsed)
      })
      .catch(() => {
        if (!cancelled)
          setLoadError('受付設定を読み込めませんでした。通信を確認してもう一度お試しください。')
      })
    return () => {
      cancelled = true
    }
  }, [api, storeId])

  const purposes = settings?.purposes ?? []
  const selectedPurposes = purposes.filter((purpose) => draft.purposeIds.includes(purpose.id))
  /*
   * この予約が押さえる接客資源。目的が要求する技能・設備を店舗設定へ引き当てた
   * ものなので、割り当てが確定する前でもスタッフが読み上げられる。
   */
  const requiredSkills = new Set(selectedPurposes.flatMap((purpose) => purpose.requiredSkills))
  const heldStaff =
    requiredSkills.size === 0
      ? []
      : (settings?.staff ?? []).filter(
          (member) =>
            member.isActive &&
            member.canBook &&
            [...requiredSkills].every((skill) => member.skills.includes(skill)),
        )
  const heldEquipment = [
    ...new Set(selectedPurposes.flatMap((purpose) => purpose.requiredEquipment)),
  ]
  const durationMinutes = totalDurationMinutes(purposes, draft.purposeIds)
  const step = draft.step
  const entry = STAFF_BOOKING_STEPS.find((item) => item.step === step)
  const recital =
    draft.date && draft.startTime
      ? recitalSentence({
          date: draft.date,
          startTime: draft.startTime,
          storeName,
          purposeNames: selectedPurposes.map((purpose) => purpose.staffName),
          durationMinutes,
          customerName: draft.customer.name,
          phone: draft.customer.phone,
        })
      : ''

  const readSlots = async () => {
    const response = await api(
      `/api/staff/stores/${storeId}/availability/slots?date=${draft.date}&purposeIds=${draft.purposeIds.join(',')}`,
    )
    if (!response.ok) throw new Error(`slots ${response.status}`)
    return AvailabilitySlotsResponse.parse(await response.json()).slots
  }

  // 希望時刻は目的が決まるまで願いでしかない。所要時間・技能・設備はここで
  // 確かめ、外れても入力は一つも捨てない。
  const confirmAvailability = async () => {
    setChecking(true)
    try {
      const slots = await readSlots()
      if (slots.some((slot) => slot.startTime === draft.startTime)) {
        setCustomerStage('identify')
        dispatch({ type: 'availability_confirmed' })
        return
      }
      dispatch({
        type: 'availability_rejected',
        alternatives: nearestAlternatives(slots, draft.startTime ?? ''),
      })
    } catch {
      dispatch({ type: 'submit_failed', error: 'network' })
    } finally {
      setChecking(false)
    }
  }

  const confirmBooking = async () => {
    const payload = toReservationCreate(draft, recital)
    if (!payload) return
    // 再送は最初の試行が使った鍵をそのまま運ぶ。
    const idempotencyKey = draft.idempotencyKey ?? newIdempotencyKey()
    dispatch({ type: 'submit_started', idempotencyKey })
    try {
      const response = await api(`/api/staff/stores/${storeId}/reservations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify(payload),
      })
      if (response.status === 201) {
        const created = Reservation.parse(await response.json())
        dispatch({ type: 'submit_succeeded', reservationNumber: created.reservationNumber })
        // 復唱が終わったので録音もここで終わる。確定画面の隣で、録音は録音の
        // 都合で進み続ける。
        await stopRecording(created.id, 'completed')
        return
      }
      if (response.status === 409) {
        const slots = await readSlots().catch(() => [])
        dispatch({
          type: 'submit_conflicted',
          alternatives: nearestAlternatives(slots, draft.startTime ?? ''),
        })
        return
      }
      if (response.status === 400) {
        dispatch({ type: 'submit_failed', error: 'idempotency_key_required' })
        return
      }
      dispatch({ type: 'submit_failed', error: 'network' })
    } catch {
      dispatch({ type: 'submit_failed', error: 'network' })
    }
  }

  const applyPermissionResult = (result: MicrophonePermissionResult) => {
    /*
     * 拒否は録音の失敗ではない。まだ何も収録していないので受付は止めず、
     * 脇の列を回復手順（Safari の設定）へ入れ替えるだけにする。録音なしで
     * 続けるかどうかは、スタッフがその面で決める（UC-EYEX-177 / AC-EYEX-114）。
     */
    if (result !== 'granted') {
      setPermissionDenied(true)
      return
    }
    setPermissionDenied(false)
    setStartedAt(clock())
    moveRecording('recording')
  }

  const requestPermission = async () => {
    if (requestingPermission) return
    setRequestingPermission(true)
    try {
      applyPermissionResult(await requestMicrophonePermission())
    } finally {
      setRequestingPermission(false)
    }
  }

  /*
   * ブラウザの権限要求は、脇の列の「録音を開始する」からしか開かない。画面を
   * 開いただけで求めると、何のために録るかを説明する前に許可を尋ねることに
   * なる（AC-EYEX-113）。
   */
  const declineRecording = () => {
    setRecordingOffered(false)
  }

  const sendRecording = async (reservationId: string | null, endReason: RecordingEndReason) => {
    if (!moveRecording('uploading')) return
    const endedAt = clock()
    const attempt = (upload?.attempt ?? 0) + 1
    setUpload({ attempt, maxAttempts: MAX_UPLOAD_ATTEMPTS, lastAttemptAt: endedAt })
    const began = startedAt ?? endedAt
    try {
      const response = await api(`/api/staff/stores/${storeId}/recordings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey: sessionId,
          receptionSessionId: sessionId,
          reservationId,
          recorderType: recorder.type,
          recorderId: recorder.id,
          startedAt: began,
          endedAt,
          durationSeconds: Math.max(
            0,
            Math.floor((Date.parse(endedAt) - Date.parse(began)) / 1000),
          ),
          endReason,
          contentType: 'audio/webm',
        }),
      })
      if (!response.ok) throw new Error(`recording ${response.status}`)
      const created = Recording.parse(await response.json())
      setRecordingId(created.id)
      const audio = await captureRecordingAudio()
      if (audio) {
        const stored = await api(`/api/staff/stores/${storeId}/recordings/${created.id}/audio`, {
          method: 'PUT',
          headers: { 'content-type': 'audio/webm' },
          body: audio,
        })
        if (!stored.ok) throw new Error(`audio ${stored.status}`)
        applyServerState(Recording.parse(await stored.json()))
        return
      }
      applyServerState(created)
    } catch {
      moveRecording('failed')
    }
  }

  const retryUpload = async () => {
    if (recordingId === null) return
    if (!moveRecording('uploading')) return
    const at = clock()
    setUpload({
      attempt: Math.min((upload?.attempt ?? 1) + 1, MAX_UPLOAD_ATTEMPTS),
      maxAttempts: MAX_UPLOAD_ATTEMPTS,
      lastAttemptAt: at,
    })
    try {
      const response = await api(`/api/staff/stores/${storeId}/recordings/${recordingId}/retry`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error(`retry ${response.status}`)
      applyServerState(Recording.parse(await response.json()))
    } catch {
      moveRecording('failed')
    }
  }

  const stopRecording = async (reservationId: string | null, endReason: RecordingEndReason) => {
    if (!moveRecording('stopped')) return
    await sendRecording(reservationId, endReason)
  }

  const discard = () => {
    dispatch({ type: 'discard_confirmed' })
    setCustomerStage('identify')
    // AC-EYEX-89: 破棄した受付にも録音は残る。受付セッション ID と終了理由を
    // 持ち、予約 ID は持たない。
    void stopRecording(null, 'discarded')
  }

  /** モックのヘッダー右のチップ（`8月27日 11:00 · 新調相談`）。 */
  const contextChip = draft.date
    ? [
        japaneseDayLabel(draft.date).replace(/（.）$/, ''),
        draft.startTime ? ` ${draft.startTime}` : '',
        /*
         * 目的名が乗るのは目的を選び終えてから。モックの BOOK-PURPOSE-CONFLICT の
         * チップは日付と時刻までで、まだ確定していない目的をヘッダーに書かない。
         */
        step !== 'purpose' && selectedPurposes.length > 0
          ? ` · ${selectedPurposes.map((purpose) => purpose.staffName).join('・')}`
          : '',
      ].join('')
    : ''

  /*
   * モックのバーは 1 本だけで、工程のチップも副題もその中にある
   * (`BOOK-TIME` は `8月27日` のチップ、`BOOK-REPEAT` は副題が `銀座店 · 最終確認`
   * でチップ無し)。2 本目の緑帯は作らず、バーへ書き込む。
   */
  const showChip = contextChip !== '' && step !== 'recital' && step !== 'complete'
  useEffect(() => {
    barOverlay.set({
      chip: showChip ? contextChip : undefined,
      subtitle: step === 'recital' || step === 'complete' ? `${storeName} · 最終確認` : undefined,
    })
    return () => barOverlay.set({})
  }, [contextChip, showChip, step, storeName])

  const customerReady =
    draft.customer.name.trim() !== '' &&
    draft.customer.kana.trim() !== '' &&
    draft.customer.phone.trim() !== ''

  const back = () => {
    if (step === 'customer' && customerStage === 'details') {
      setCustomerStage('identify')
      return
    }
    // 最初の工程で戻ると受付そのものを離れることになるので、必ず一度尋ねる。
    if (step === 'date') {
      dispatch({ type: 'discard_requested' })
      return
    }
    dispatch({ type: 'back' })
  }

  /** 候補（または新規）が定まった。氏名・メモの面へ進む。 */
  const onCustomerConfirmed = (candidate: CustomerCandidate | undefined, typedPhone: string) => {
    dispatch({
      type: 'customer_changed',
      customer: candidate
        ? {
            name: candidate.name,
            kana: candidate.kana,
            phone: candidate.phone,
            ...(candidate.email ? { email: candidate.email } : {}),
          }
        : // 新規登録でも、伺った番号をもう一度打たせない。
          { phone: typedPhone },
    })
    setCustomerStage('details')
  }

  /* ---------------------------------------------------------------- *
   * 全画面の状態（脇の列のカードではない）
   * ---------------------------------------------------------------- */

  /** 破棄の確認はどの面の上にも出る（全画面の録音状態も含む）。 */
  const discardDialog = draft.confirmingDiscard && (
    <Modal urgent title="入力を破棄しますか？" titleId="booking-discard-title">
      <p>日、時間、来店目的、お客様情報がすべて失われます。</p>
      <Actions>
        {/* 危険な方を既定にしない: 主操作は入力を守る側に置く。 */}
        <Action size="roomy" onClick={() => dispatch({ type: 'discard_cancelled' })}>
          入力に戻る
        </Action>
        <Action size="roomy" variant="danger" onClick={discard}>
          破棄する
        </Action>
      </Actions>
    </Modal>
  )

  /*
   * 高さは親（アプリのヘッダーの下の領域）にぴったり合わせる。`min-h-dvh` に
   * するとヘッダーの分だけはみ出し、下部バーがスクロールで隠れてしまう —
   * モックの下部バーは常に見えていなければならない。
   */
  const frame = (body: ReactNode) => (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      {body}
      {discardDialog}
    </div>
  )

  /*
   * 録音の可否で予約入力を塞がない。電話を受けた直後に開く画面なので、先に
   * 全画面の確認を挟むと受付そのものが止まる。録音の状態は下部バーの表示で
   * 足り、拒否されたときの回復手順もそこから開く。
   */

  if (step === 'complete' && recordingState === 'failed')
    return frame(
      <RecordingUploadFailedScreen
        upload={upload}
        onRetryUpload={() => {
          void retryUpload()
        }}
        onOpenReservation={() => navigate({ screen: 'reception-history' })}
      />,
    )

  /* ---------------------------------------------------------------- *
   * 2 列 + 下部バー
   * ---------------------------------------------------------------- */

  /*
   * 録音の面は予約入力の列を取らず、脇の列に立つ（AC-EYEX-05）。予約が確定して
   * いない段階でも保存失敗が見えるのは、この面が受付の最初から最後まで同じ
   * 場所に居続けるからである（UC-EYEX-034）。
   */
  const recordingRail =
    mayRecord && recordingOffered ? (
      <BookingRecordingRail
        state={recordingState}
        denied={permissionDenied}
        requesting={requestingPermission}
        onStart={() => void requestPermission()}
        onDecline={declineRecording}
        onRetryUpload={() => void retryUpload()}
      />
    ) : null

  const summaryTitle =
    step === 'recital'
      ? '確保する接客資源'
      : step === 'purpose' && draft.alternatives.length > 0
        ? '代替時刻'
        : 'ここまでの内容'
  const showSummary = step !== 'complete' && (contextChip !== '' || step === 'recital')
  // 要約が空でも録音の面だけは残る。そのときは列そのものが録音の列になる。
  const railTitle = showSummary ? summaryTitle : '録音'

  const showRail = showSummary || recordingRail !== null

  const main = (
    <>
      {loadError && <FailureNotice>{loadError}</FailureNotice>}

      {entry && step !== 'complete' && (
        <Script
          step={`${stepPosition(step)} / 5　${entry.label}`}
          question={
            step === 'customer' && customerStage === 'details'
              ? 'お客様のお名前を伺えますか？'
              : entry.prompt
          }
        >
          {step === 'time' && (
            <p>ここでは希望時刻を伺います。来店目的を選んだ後に受付可能か確認します。</p>
          )}
        </Script>
      )}

      {step === 'date' && settings && (
        <OptionGrid label="来店予定日">
          {receivableDates(settings, today).map((date) => (
            <Option
              key={date}
              selected={draft.date === date}
              onClick={() => dispatch({ type: 'date_selected', date })}
            >
              {japaneseDayLabel(date)}
            </Option>
          ))}
        </OptionGrid>
      )}

      {step === 'time' && settings && draft.date && (
        <OptionGrid label="来店予定時刻">
          {desiredTimes(settings, draft.date).map((time) => (
            <Option
              key={time}
              selected={draft.startTime === time}
              onClick={() => dispatch({ type: 'time_selected', startTime: time })}
            >
              {time}
            </Option>
          ))}
        </OptionGrid>
      )}

      {step === 'purpose' && (
        <>
          <OptionGrid label="来店目的">
            {purposes.map((purpose) => {
              const pressed = draft.purposeIds.includes(purpose.id)
              return (
                <Option
                  key={purpose.id}
                  selected={pressed}
                  onClick={() =>
                    dispatch({
                      type: 'purposes_changed',
                      purposeIds: pressed
                        ? draft.purposeIds.filter((id) => id !== purpose.id)
                        : [...draft.purposeIds, purpose.id],
                    })
                  }
                >
                  {purpose.customerLabel}
                  <br />
                  <small>約{purpose.durationMinutes}分</small>
                </Option>
              )
            })}
          </OptionGrid>
          {/*
           * 受付できないことは、選んだ選択肢を消さずに伝える。案内が選択肢に
           * 密着しているのは「今押したもの」への返答だと読ませるためで、
           * モック BOOK-PURPOSE-CONFLICT はここに余白を置いていない。
           */}
          {draft.error === 'slot_unavailable' ? (
            <Notice>
              <strong>{`${draft.startTime}は${durationMinutes}分の受付ができません`}</strong>
              <br />
              {draft.alternatives.length > 0
                ? `入力内容は保持しています。${draft.alternatives
                    .map((slot) => slot.startTime)
                    .join('、')}から代替時刻を選べます。`
                : '入力内容は保持しています。日を選び直してください。'}
            </Notice>
          ) : (
            draft.purposeIds.length > 0 && (
              <p className="font-sans text-body text-ink">{`合計 約${durationMinutes}分`}</p>
            )
          )}
        </>
      )}

      {step === 'customer' && customerStage === 'details' && (
        /*
         * この面はモックに無い（モックが描く 4 工程目は「特定」の面だけ）。
         * 新しい見た目を作らず、運用面と同じ入力の語彙で 1 列に積む。
         */
        <div className="mt-6 flex max-w-2xl flex-col gap-4">
          <TextField
            id="booking-name"
            label="お名前"
            value={draft.customer.name}
            onChange={(event) =>
              dispatch({ type: 'customer_changed', customer: { name: event.target.value } })
            }
          />
          <TextField
            id="booking-kana"
            label="フリガナ"
            value={draft.customer.kana}
            onChange={(event) =>
              dispatch({ type: 'customer_changed', customer: { kana: event.target.value } })
            }
          />
          <TextField
            id="booking-phone"
            label="お電話番号"
            inputMode="tel"
            value={draft.customer.phone}
            onChange={(event) =>
              dispatch({ type: 'customer_changed', customer: { phone: event.target.value } })
            }
          />
          <TextField
            id="booking-email"
            label="メールアドレス（任意）"
            type="email"
            value={draft.customer.email ?? ''}
            onChange={(event) =>
              dispatch({ type: 'customer_changed', customer: { email: event.target.value } })
            }
          />
          {/* 予約メモ はこの予約のこと、店内引き継ぎ事項 は引き継ぐスタッフのこと。 */}
          <TextAreaField
            id="booking-memo"
            label="予約メモ"
            rows={3}
            value={draft.reservationMemo}
            onChange={(event) =>
              dispatch({ type: 'notes_changed', notes: { reservationMemo: event.target.value } })
            }
          />
          <TextAreaField
            id="booking-handoff"
            label="店内引き継ぎ事項"
            rows={3}
            value={draft.handoffNote}
            onChange={(event) =>
              dispatch({ type: 'notes_changed', notes: { handoffNote: event.target.value } })
            }
          />
        </div>
      )}

      {step === 'recital' && (
        <>
          <Readout>{`「${recital}」`}</Readout>
          {draft.error === 'network' && (
            <FailureNotice>
              送信できませんでした。入力内容はそのまま残っています。もう一度お試しください。
            </FailureNotice>
          )}
          {draft.error === 'idempotency_key_required' && (
            <FailureNotice>
              送信キーが受け付けられませんでした。入力内容はそのまま残っています。もう一度お試しください。
            </FailureNotice>
          )}
        </>
      )}

      {step === 'complete' && (
        <Card label="予約を確定しました">
          {/* カードの内側 14px がそのまま見出しの上になる。 */}
          <h1 className="mt-0">予約を確定しました</h1>
          <p>予約番号</p>
          {/* 予約番号は桁で読み合わせるので等幅で置く（和文は含まない）。 */}
          <p className="font-figure text-lead">{draft.reservationNumber}</p>
          <p>録音の保存状態は予約詳細と受付履歴で確認できます。</p>
          <Actions>
            <Action size="roomy" onClick={discard}>
              続けて予約を取る
            </Action>
            <Action
              size="roomy"
              variant="primary"
              onClick={() => navigate({ screen: 'reception-history' })}
            >
              受付履歴を開く
            </Action>
          </Actions>
        </Card>
      )}
    </>
  )

  const rail = (
    <>
      <h2>{railTitle}</h2>

      {recordingRail}

      {showSummary && step === 'purpose' && draft.alternatives.length > 0 && (
        /*
         * 候補どうしの間に空白を置かない。モックは inline-block を隙間なく
         * 並べており、間に改行が入ると 4px の空白で 2 つ目が折り返す。
         */
        <fieldset aria-label="代替時刻">
          {draft.alternatives.map((slot) => (
            <FieldButton
              key={slot.startTime}
              onClick={() => dispatch({ type: 'alternative_selected', startTime: slot.startTime })}
            >
              {slot.startTime}　受付可能
            </FieldButton>
          ))}
        </fieldset>
      )}

      {showSummary && step === 'recital' && (
        <>
          <RailSummary>
            {/*
             * 確保するのは「接客資源」であって来店目的ではない（モック BOOK-REPEAT は
             * 担当者・設備・カウンターを並べる）。担当者の確定割り当ては予約成立時に
             * サーバーが行うので、ここでは選んだ目的が要求する技能を満たす担当者と、
             * 要求する設備を出す。店舗設定にどちらも無いときは所要時間だけが残る。
             */}
            {heldStaff.map((member) => (
              <span key={member.id} className="block">
                {member.name}
              </span>
            ))}
            {heldEquipment.map((name) => (
              <span key={name} className="block">
                {name}
              </span>
            ))}
            <span className="block">所要時間 約{durationMinutes}分</span>
          </RailSummary>
          <FlowButton primary disabled={draft.submitting} onClick={() => void confirmBooking()}>
            復唱を終えて予約を確定する
          </FlowButton>
        </>
      )}

      {showSummary && summaryTitle === 'ここまでの内容' && (
        <>
          {draft.date && <RailSummary>{japaneseDayLabel(draft.date)}</RailSummary>}
          {draft.startTime && step !== 'time' && <RailSummary>{draft.startTime}</RailSummary>}
          {selectedPurposes.length > 0 && (
            <RailSummary>
              {selectedPurposes.map((purpose) => (
                <span key={purpose.id} className="block">
                  {purpose.staffName}
                </span>
              ))}
            </RailSummary>
          )}
          {step === 'time' && (
            <Notice>来店目的の選択後、所要時間・スタッフ・設備を確認します。</Notice>
          )}
          {step === 'purpose' && (
            <FlowButton
              primary
              disabled={draft.purposeIds.length === 0 || checking}
              onClick={() => void confirmAvailability()}
            >
              お客様情報へ進む
            </FlowButton>
          )}
          {step === 'customer' && customerStage === 'details' && (
            <FlowButton
              primary
              disabled={!customerReady}
              onClick={() => dispatch({ type: 'customer_confirmed' })}
            >
              復唱へ進む
            </FlowButton>
          )}
        </>
      )}
    </>
  )

  const identifying = step === 'customer' && customerStage === 'identify'

  return frame(
    <>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {step === 'customer' && (
          /* 特定の面は畳んでも捨てない: 戻ると伺った番号と候補がそのまま残る。 */
          <div
            hidden={!identifying}
            inert={!identifying || undefined}
            className={identifying ? 'flex min-h-0 flex-1' : 'hidden'}
          >
            <BookingCustomerStepContext.Provider
              value={{
                header: entry && (
                  <Script
                    step={`${stepPosition(step)} / 5　${entry.label}`}
                    question={entry.prompt}
                  />
                ),
                onConfirm: onCustomerConfirmed,
              }}
            >
              {customerSlot ?? null}
            </BookingCustomerStepContext.Provider>
          </div>
        )}
        {!identifying && (
          <BookingLayout
            main={main}
            rail={showRail ? rail : undefined}
            railLabel={showRail ? railTitle : undefined}
          />
        )}
      </div>

      <ProgressFooter
        announceState
        steps={flowSteps(step)}
        back={step !== 'complete' ? <FlowButton onClick={back}>戻る</FlowButton> : undefined}
        record={
          <RecordingIndicator
            // `iPad録音` を名乗るのは脇の列の面。バーは同じ状態の短い写しである。
            name="録音の経過"
            state={recordingOffered && mayRecord ? recordingState : null}
            elapsedSeconds={elapsedSeconds}
          />
        }
      />
    </>,
  )
}
