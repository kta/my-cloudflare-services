import type {
  AvailabilityResponse,
  AvailabilitySlot,
  CustomerCandidate,
  Hold,
  LedgerAxis,
  ReservationDetail,
  StaffMember,
  VisitPurpose,
} from '@app/contracts'
import { ReceptionSession, type ReceptionSessionDraft } from '@app/contracts'
import { auth, toJstDateString } from '@app/shared'
import { cn, focusRing, focusRingOnPine } from '@app/ui'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { client, subjectFromToken } from '../client'
import { dateLabel, jstClock } from '../ledger/metrics'
import { MicDeniedPanel } from '../recording/MicDeniedPanel'
import { RecordingBadge } from '../recording/RecordingBadge'
import { UploadFailedPanel } from '../recording/UploadFailedPanel'
import { useRecorder } from '../recording/useRecorder'
import { ConfirmAction, ConfirmStep } from './ConfirmStep'
import { type ConflictChoice, ConflictNotice } from './ConflictNotice'
import { type CustomerDraft, CustomerStep, customerStepReady } from './CustomerStep'
import { DateTimeStep } from './DateTimeStep'
import { DoneStep } from './DoneStep'
import type { HandwrittenNote } from './Handwriting'
import { PurposeStep } from './PurposeStep'
import type { SlotChoice } from './SlotStep'
import { SlotStep } from './SlotStep'
import { StepBar } from './StepBar'
import {
  type BookingStepKey,
  emptyDraft,
  nextStep,
  previousStep,
  type StepGuard,
  stepFromDraft,
} from './steps'

/*
 * 受付の器（承認済みモック docs/frontend/mockups/eyex/images/BOOK-01-DATETIME.png ほか 12 面）。
 *
 * 5 工程が同じ器の上で動き、いまどの工程にいるか・録音がどこにあるかが工程を移っても
 * 変わらない状態にする。
 *
 * 実測: 端末 1194×834。上のバー 64px（P0 の骨格と同じ形）。下の帯 76px。
 * **予約フローはサイドバーを出さない**（`design/05-screen-flow.md` §3.3）ので、
 * `AppShell` を通さずこの面が自分で上のバーを描く。
 *
 * **下端の帯は 5 工程を通して 1 本きり**である。工程 3（盤）も BOOK-CONFLICT も
 * 自分の帯を持たず、可否（`StepGuard`）だけを上げてくる。工程 5 だけ、丸い「次へ」の
 * 代わりに「復唱を終えて予約を確定する」（`.btn.primary.big`）が帯の右端へ入る。
 *
 * 伺った内容は端末のメモリだけに持たない —— iPadOS の Safari は裏に回ったタブを容易に
 * 捨て、戻ると読み込み直す。下書きはサーバの `reception_sessions` に置き、端末に残すのは
 * 受付セッション id だけにする（`design/07-nfr.md` §5.3 / §6.6）。
 *
 * 出口は 2 つある。「やめる」は 2 択の確認のうえで受付を `discarded` として閉じ、
 * 「あとで続ける」は進行中のまま残す（`design/05-screen-flow.md` §4.3）。
 */

export type BookingScreenProps = {
  storeId: string
  storeName: string
  /** いまの時刻（ISO8601）。実行時刻に依存させないため器から注ぐ。 */
  now?: string
  /** 最初に開く工程。省くと、受けかけの下書きから中断した工程へ着地する。 */
  initialStep?: BookingStepKey
  /**
   * 顧客台帳の「この方のご予約を取る」（AC-CUST-26）から来たときの、その方。
   * 工程 4 のお名前・ふりがな・お電話番号をこれで埋め、打ち直させない。
   * 新しい受付（再開ではない）のときだけ効く。
   */
  initialCustomer?: { id?: string; name: string; kana: string; phone: string | null }
  /** 受付を閉じた／あとで続けるでトップへ戻る。 */
  onExit: () => void
  /** 完了の面の「台帳で見る」。省くとトップへ戻る。 */
  onOpenLedger?: () => void
  /** 業務の期限が切れた（401）。 */
  onSessionExpired?: () => void
  /** Shell が検知した通信断。書込みは下書きを保ったまま止める。 */
  isOffline?: boolean
}

/** 端末に置くのはこの 1 つだけ。お名前・お電話番号は置かない（§6.6）。 */
const SESSION_KEY = 'eyex.booking.session'
const MS_PER_MINUTE = 60_000
/** 仮の押さえの残り時間を数え直す間隔。端末の時計は読まず、器の時刻を 1 秒ずつ進める。 */
const TICK_MS = 1_000
/** 押さえも目的も決まっていないうちの暫定の所要（工程 1 が使う刻み）。 */
const FALLBACK_DURATION_MINUTES = 30

/** 手書きの記入者が引き当てられないときの名乗り（設定の面と同じ言い方）。 */
const DEFAULT_WRITER = 'ご担当者（スタッフ）'

/**
 * BOOK-CONFLICT は工程 5 から工程 3 へ差し戻した面なので、伺い終えたお客様（工程 4）の
 * ✓ を帯に残す。ここを落とすと「お名前をもう一度伺うのか」に見える。
 */
const CONFLICT_DONE_STEPS = ['customer'] as const

/**
 * 受けかけの受付を読む。**`hc<AppType>` にこの読み口がまだ無い**ので、
 * 契約のスキーマで受け取り直す。読めない・形が違うときは新しい受付を始める。
 *
 * 末尾の `/draft` を落とさない —— `/api/staff/reception-sessions/:id` は
 * 受付履歴の詳細（`ReceptionHistoryDetail`）を返す別の口で、下書きを持たない。
 * そちらを叩いていたころは `safeParse` が必ず落ち、タブが捨てられて戻るたびに
 * 伺った内容が消えて工程 1 からやり直しになっていた。
 */
async function readReceptionSession(sessionId: string): Promise<ReceptionSession | null> {
  const res = await auth.authFetch(`/api/staff/reception-sessions/${sessionId}/draft`)
  if (!res.ok) return null
  const parsed = ReceptionSession.safeParse(await res.json())
  return parsed.success ? parsed.data : null
}

/** 「2026年8月27日（木）11:00」。工程 4 の右の柱に出す。 */
function stampLabel(startsAt: string): string {
  return `${dateLabel(toJstDateString(startsAt))}${jstClock(startsAt)}`
}

export function BookingScreen({
  storeId,
  storeName,
  now,
  initialStep,
  initialCustomer,
  onExit,
  onOpenLedger,
  onSessionExpired,
  isOffline: shellOffline = false,
}: BookingScreenProps) {
  const clock = useMemo(() => now ?? new Date().toISOString(), [now])
  const titleId = useId()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [phase, setPhase] = useState<'starting' | 'ready' | 'failed'>('starting')
  const [attempt, setAttempt] = useState(0)
  const [step, setStep] = useState<BookingStepKey>(initialStep ?? 'datetime')
  const [draft, setDraft] = useState<ReceptionSessionDraft>(() =>
    initialCustomer === undefined
      ? emptyDraft()
      : {
          ...emptyDraft(),
          nameTyped: initialCustomer.name,
          kanaTyped: initialCustomer.kana,
          phoneTyped: initialCustomer.phone ?? '',
          // 顧客台帳の「ご予約を取る」から来たときは、その 1 名で決まっている。
          customerId: initialCustomer.id ?? null,
        },
  )
  const [confirming, setConfirming] = useState(false)
  const confirmRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  // 工程が自分で言ってくる「次へ」の可否。どの工程のものかを持たないと、
  // 工程を移った直後に前の工程の可否が残る。
  const [reported, setReported] = useState<{ step: BookingStepKey; guard: StepGuard } | null>(null)

  /* --- 工程 3〜5 が要るもの ---------------------------------------------- */

  const [axis, setAxis] = useState<LedgerAxis>('staff')
  const [board, setBoard] = useState<AvailabilityResponse | null>(null)
  const [boardPhase, setBoardPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [boardAttempt, setBoardAttempt] = useState(0)
  const [purposes, setPurposes] = useState<readonly VisitPurpose[]>([])
  const [staffRows, setStaffRows] = useState<readonly StaffMember[]>([])
  /** 手書きのご要望。R2 へ上げる口がまだ無いので、この受付のあいだだけ端末に置く。 */
  const [notes, setNotes] = useState<readonly HandwrittenNote[]>([])
  const [slot, setSlot] = useState<SlotChoice | null>(null)
  /*
   * 工程 3 を**開いたときの**置き場所。盤の中で動かしているあいだは変えない ——
   * 変えると「もとの 11:00 に戻す」の行き先が、いま運んでいる先そのものになってしまう。
   * `undefined` は「まだ伺っていない」で、盤はいちばん上の行に帯を置く（BOOK-03 の実測）。
   * `null` は「担当はあとで決める」を押したという答えである。
   */
  const [slotOrigin, setSlotOrigin] = useState<{
    staffId: string | null | undefined
    equipmentIds: string[]
  }>({ staffId: undefined, equipmentIds: [] })
  const [hold, setHold] = useState<Hold | null>(null)
  const [booking, setBooking] = useState(false)
  const [bookingFailed, setBookingFailed] = useState(false)
  const [booked, setBooked] = useState<ReservationDetail | null>(null)
  const [conflict, setConflict] = useState<{
    takenAt: string
    alternatives: readonly AvailabilitySlot[]
  } | null>(null)
  const [tick, setTick] = useState(clock)
  /*
   * 通信が切れている。`fetch` が**届かなかった**ときだけ立てる（応答が返ってきた
   * 400/409 は通信の問題ではない）。台帳と同じ考え方で、読めているものは消さずに残す。
   */
  const [offline, setOffline] = useState(false)
  const isOffline = offline || shellOffline
  /*
   * 工程 1 を始めた時点で作り、成功するまで同じ値を送る（`04-api.md` §6.1）。
   * 枠を取られて選び直したときだけ作り直す —— 中身が変わるので、同じ鍵では
   * 409 `idempotency_conflict` になる。
   */
  const idempotencyKey = useRef(crypto.randomUUID())
  /** 担当・設備の名前。軸を切り替えるたびに増える（同じ id を二度引かない）。 */
  const laneNames = useRef(new Map<string, string>())
  const holdRef = useRef<Hold | null>(null)

  /*
   * 受付中の録音（`010-recording`）。工程 1〜4 は帯の中、工程 5 は右下の常駐へ移り、
   * 経過時間は移った瞬間も減らない（同じ 1 本を数え続けているため）。
   *
   * **許可はこの面が立ち上がった時点で求める。**この面は「新しい予約を取る」を押した
   * その処理から同期的に差し替わってくるので、Safari の操作の有効期間の中に収まる。
   * 工程を移っただけ・描き直しただけでは `start()` が二度目を求めない（1 受付 1 本）。
   */
  const recorder = useRecorder({ storeId, receptionSessionId: sessionId })
  /** 「直したので、もう一度確かめる」を押した。読み込み直すまでのあいだ二度押しをさせない。 */
  const [micRechecking, setMicRechecking] = useState(false)
  const startRecording = recorder.start
  useEffect(() => {
    startRecording()
  }, [startRecording])

  useEffect(() => {
    let live = true
    async function begin() {
      const saved = sessionStorage.getItem(SESSION_KEY)
      if (saved !== null) {
        const resumed = await readReceptionSession(saved)
        if (!live) return
        if (resumed !== null && resumed.outcome === null) {
          setSessionId(resumed.id)
          if (resumed.draft !== null) {
            setDraft(resumed.draft)
            // 中断した工程へ戻す。工程の途中へ黙って飛ばさない（§5.3）。
            if (initialStep === undefined) setStep(stepFromDraft(resumed.draft))
          }
          setPhase('ready')
          return
        }
        // 終わった受付・読めない受付の id は捨てる（残すと毎回ここで足踏みする）。
        sessionStorage.removeItem(SESSION_KEY)
      }
      const res = await client.api.staff['reception-sessions'].$post({ json: { storeId } })
      if (!live) return
      const status: number = res.status
      if (status === 401) {
        onSessionExpired?.()
        setPhase('failed')
        return
      }
      if (!res.ok) {
        setPhase('failed')
        return
      }
      const created = await res.json()
      sessionStorage.setItem(SESSION_KEY, created.id)
      setSessionId(created.id)
      setPhase('ready')
    }
    begin().catch(() => {
      if (live) setPhase('failed')
    })
    return () => {
      live = false
    }
  }, [storeId, attempt, initialStep, onSessionExpired])

  // 目的の一覧は工程 2 のあとも要る（復唱と完了が `name_internal` を読む）。
  useEffect(() => {
    let live = true
    client.api.staff.purposes
      .$get({ query: { storeId } })
      .then(async (res) => (res.ok ? await res.json() : []))
      .then((rows) => {
        if (live) setPurposes(rows)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [storeId])

  // 手書きの記入者の名乗りにしか使わない。取れなくても受付は止めない。
  useEffect(() => {
    let live = true
    client.api.staff.stores[':storeId'].staff
      .$get({ param: { storeId } })
      .then(async (res) => (res.ok ? await res.json() : []))
      .then((rows) => {
        if (live) setStaffRows(rows)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [storeId])

  const startsAt = draft.startsAt
  const durationMinutes = draft.durationMinutes ?? FALLBACK_DURATION_MINUTES
  const purposeKey = draft.purposeIds.join(',')

  // 工程 3 の盤。`axis` を替えたらこの 1 本を引き直す（画面で並べ替えない）。
  useEffect(() => {
    if (step !== 'slot' || startsAt === null) return
    let live = true
    setBoard(null)
    setBoardPhase('loading')
    async function read() {
      const res = await client.api.staff.availability.$get({
        query: {
          storeId,
          date: toJstDateString(String(startsAt)),
          axis,
          purposeIds: purposeKey,
          durationMinutes: String(durationMinutes),
          ...(sessionId === null ? {} : { excludeReceptionSessionId: sessionId }),
        },
      })
      if (!live) return
      setOffline(false)
      if (!res.ok) {
        setBoardPhase('error')
        return
      }
      const answer = await res.json()
      for (const lane of answer.lanes) {
        if (lane.id !== null) laneNames.current.set(lane.id, lane.name)
      }
      setBoard(answer)
      setBoardPhase('ready')
    }
    read().catch(() => {
      if (!live) return
      setBoardPhase('error')
      setOffline(true)
    })
    return () => {
      live = false
    }
  }, [step, storeId, startsAt, axis, purposeKey, durationMinutes, sessionId, boardAttempt])

  // 仮の押さえの残り時間。端末の時計を読まず、器が持っている時刻を 1 秒ずつ進める。
  useEffect(() => {
    if (step !== 'confirm' || hold === null) return
    const timer = setInterval(
      () => setTick((at) => new Date(Date.parse(at) + TICK_MS).toISOString()),
      TICK_MS,
    )
    return () => clearInterval(timer)
  }, [step, hold])

  /*
   * ソフトキーボードが出ても帯と録音を隠さない（AC-BOOK-18）。
   *
   * iPadOS の Safari は**ソフトキーボードで layout viewport を縮めない**ので、
   * `h-dvh` の最下段に置いた帯はキーボードの下へ潜る。お名前・ふりがな・ご要望は
   * キーボードが出る欄なので、工程 4 でそのまま起きる。
   * 見えている高さ（`visualViewport`）に器そのものを合わせて、帯を底へ貼り直す。
   */
  const [viewportHeight, setViewportHeight] = useState<number | null>(null)
  useEffect(() => {
    const viewport = window.visualViewport
    if (viewport === null || viewport === undefined) return
    const sync = () => setViewportHeight(viewport.height)
    sync()
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
    }
  }, [])

  // 確認の面が出たら焦点をそこへ移し、閉じたら開いた操作へ戻す（§7.6）。
  useEffect(() => {
    if (confirming) {
      openerRef.current = document.activeElement as HTMLElement | null
      confirmRef.current?.focus()
      return
    }
    openerRef.current?.focus()
    openerRef.current = null
  }, [confirming])

  /**
   * 下書きを丸ごと 1 つ送る。欄ごとの差分にすると「消した」と「触っていない」が
   * 同じ形になる。送れなくても手元の下書きは残るので、工程は止めない。
   */
  const saveDraft = useCallback(
    async (next: ReceptionSessionDraft) => {
      if (sessionId === null) return
      await client.api.staff['reception-sessions'][':sessionId']
        .$patch({ param: { sessionId }, json: { draft: next } })
        .catch(() => undefined)
    },
    [sessionId],
  )

  const onSlotChange = useCallback((choice: SlotChoice) => setSlot(choice), [])

  /**
   * 同じお電話番号のご登録を照会する（AC-CUST-04）。`GET /api/staff/customers/lookup` は
   * query を zValidator で受けない（`04-api.md` の決め）ので、`CustomerScreen` の一覧と
   * 同じ道 —— 型だけ `hc` に借り、query 文字列は fetch の側で足す。
   */
  const onCustomerLookup = useCallback(
    async (phoneDigits: string): Promise<readonly CustomerCandidate[]> => {
      const res = await client.api.staff.customers.lookup.$get(undefined, {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          auth.authFetch(`${String(input)}?phone=${encodeURIComponent(phoneDigits)}`, init),
      })
      if (!res.ok) throw new Error('customer_lookup_failed')
      return (await res.json()) as CustomerCandidate[]
    },
    [],
  )

  /* --- 工程 4 の下書き ---------------------------------------------------- */

  const customer: CustomerDraft = {
    phoneTyped: draft.phoneTyped,
    nameTyped: draft.nameTyped,
    kanaTyped: draft.kanaTyped,
    noteTyped: draft.noteTyped,
    customerId: draft.customerId,
    notes,
  }

  const writer = useMemo(() => {
    const subject = subjectFromToken()
    const found =
      subject === null ? undefined : staffRows.find((member) => member.adminUserId === subject)
    if (found === undefined) return DEFAULT_WRITER
    return found.jobLabel === null ? found.displayName : `${found.displayName}（${found.jobLabel}）`
  }, [staffRows])

  /* --- 工程のあいだの持ち回り -------------------------------------------- */

  /*
   * 帯の丸の可否。工程 5 は丸そのものを持たない（確定のボタンに替わる）ので素通し、
   * 工程 4 は打ちかけの下書きがそのまま答え、ほかは工程が言ってきたものを使う。
   * BOOK-CONFLICT は工程 5 の上に出るが、丸は「時刻か担当を選ぶと進めます」で止まる。
   */
  const guard: StepGuard =
    conflict !== null
      ? (reported?.guard ?? { canProceed: false, blockedReason: '時刻か担当を選ぶと進めます' })
      : step === 'confirm'
        ? { canProceed: true, blockedReason: '' }
        : step === 'customer'
          ? customerStepReady(customer)
          : reported?.step === step
            ? reported.guard
            : { canProceed: false, blockedReason: 'まだ伺っていません' }

  const onGuardChange = useCallback((next: StepGuard) => setReported({ step, guard: next }), [step])

  /** 工程を移る前に、その工程が決めたことを下書きへ畳んで 1 つ送る。 */
  function foldDraft(): ReceptionSessionDraft {
    if (slot === null) return draft
    return {
      ...draft,
      startsAt: slot.startsAt,
      staffId: slot.staffId,
      equipmentIds: slot.equipmentIds,
    }
  }

  async function goTo(next: BookingStepKey | null) {
    if (next === null) return
    const folded = foldDraft()
    setDraft(folded)
    // 工程 3 を出たところが、次に開いたときの「もとの場所」になる。
    if (step === 'slot' && slot !== null) {
      setSlotOrigin({ staffId: slot.staffId, equipmentIds: [...slot.equipmentIds] })
    }
    setStep(next)
    await saveDraft(folded)
  }

  /** 「入力をやめる」。伺った内容は消えるが、受付の行と録音は記録として残る。 */
  async function discard() {
    setConfirming(false)
    releaseHold()
    // やめても受付の記録と録音は残す（UC-REC-09）。録り終えてから送る。
    recorder.stop()
    if (sessionId !== null) {
      await client.api.staff['reception-sessions'][':sessionId'].close
        .$post({ param: { sessionId }, json: { outcome: 'discarded' } })
        .catch(() => undefined)
    }
    sessionStorage.removeItem(SESSION_KEY)
    onExit()
  }

  /** 「あとで続ける」。受付は進行中のまま残し、続きから戻れるようにする。 */
  async function pause() {
    releaseHold()
    // 面を離れる。マイクを掴んだままにせず、ここまでの音を送る。
    recorder.stop()
    const folded = foldDraft()
    setDraft(folded)
    await saveDraft(folded)
    onExit()
  }

  /* --- 確定 --------------------------------------------------------------- */

  const chosenPurposes = draft.purposeIds
    .map((id) => purposes.find((row) => row.id === id))
    .filter((row): row is VisitPurpose => row !== undefined)
  const purposeNames = chosenPurposes.map((row) => row.nameInternal)
  const purposeLabel = purposeNames.join('・')
  const chosenStaffId = slot?.staffId ?? draft.staffId
  const chosenEquipmentIds = slot?.equipmentIds ?? draft.equipmentIds
  const staffName = chosenStaffId === null ? null : (laneNames.current.get(chosenStaffId) ?? null)
  const equipmentNames = chosenEquipmentIds
    .map((id) => laneNames.current.get(id))
    .filter((name): name is string => name !== undefined)
  const placedStartsAt = slot?.startsAt ?? startsAt
  const placedEndsAt =
    slot?.endsAt ??
    (placedStartsAt === null
      ? null
      : new Date(Date.parse(placedStartsAt) + durationMinutes * MS_PER_MINUTE).toISOString())

  async function confirmBooking() {
    if (booking || placedStartsAt === null) return
    setBooking(true)
    setBookingFailed(false)
    try {
      const res = await client.api.staff.reservations.$post(
        {
          json: {
            storeId,
            startsAt: placedStartsAt,
            purposeIds: draft.purposeIds,
            durationMinutes,
            staffId: chosenStaffId,
            equipmentIds: chosenEquipmentIds,
            // 候補から選んだ 1 名をご予約に結び付ける。載せていなかったころ、
            // 予約行の `customer_id` は NULL のままで、台帳の帯にお名前も来店回数も
            // 出ず、来店回数も一生増えなかった（AC-CUST-24 / 25、AC-CUST-10 / 11）。
            ...(draft.customerId === null ? {} : { customerId: draft.customerId }),
            noteCustomer: draft.noteTyped,
            source: 'phone',
            ...(hold === null ? {} : { holdId: hold.id }),
            ...(sessionId === null ? {} : { receptionSessionId: sessionId }),
          },
        },
        { headers: { 'Idempotency-Key': idempotencyKey.current } },
      )
      setOffline(false)
      const body: unknown = await res.json()
      if (res.ok) {
        setBooked(body as ReservationDetail)
        sessionStorage.removeItem(SESSION_KEY)
        // 復唱が終わった。ここで録り終えて送る（送れなければ端末に控える）。
        recorder.stop()
        // ご予約そのものが枠を持つので、押さえは返す（同じ枠を二重に数えさせない）。
        releaseHold()
        return
      }
      const failure = body as { error?: string; alternatives?: AvailabilitySlot[] }
      if (failure.error === 'slot_taken') {
        // 枠が取れなかったとき、サーバは `in_progress` を消している。内容が変わるので鍵を作り直す。
        idempotencyKey.current = crypto.randomUUID()
        setConflict({ takenAt: placedStartsAt, alternatives: failure.alternatives ?? [] })
        return
      }
      if (failure.error === 'idempotency_conflict') {
        /*
         * 同じ鍵で違う中身を送った。`in_progress` のまま落ちた Worker の残りが相手だと、
         * 鍵を替えないかぎり 24 時間ずっとこの 409 が返り、伺った内容を持ったまま
         * 確定できなくなる（`04-api.md` §6.2 が「鍵を作り直して送り直す」を認めている）。
         */
        idempotencyKey.current = crypto.randomUUID()
      }
      setBookingFailed(true)
    } catch {
      // 届かなかった。伺った内容はそのまま残し、つながってからもう一度押してもらう。
      setOffline(true)
      setBookingFailed(true)
    } finally {
      setBooking(false)
    }
  }

  /* --- 仮の押さえ --------------------------------------------------------- */

  /*
   * 押さえは**復唱のあいだだけ**持つ。TODO は工程 3 で打つと書いているが、盤を眺めた
   * だけで 420 秒その枠がだれにも取れなくなるのは、設計自身が避けたかったこと
   * （`design/04-api.md` §6.3 の「11:00 に置いてから 11:30 へ動かしたとき…」）である。
   * 承認済みモックで「仮の押さえ 11:18 まで」が出るのも BOOK-05-CONFIRM の 1 面きりで、
   * T-008 の目的も「復唱の間に別の端末が同じ枠を触ったことを早く気づかせる」ことである。
   *
   * 枠が変われば `holdKey` が変わり、片づけ（`DELETE`）と打ち直し（`POST`）が続けて走る。
   * 工程 5 を離れる・承る・受付を閉じるときも、同じ片づけで返す。
   * **延長の API は作らない**（Q-06）ので、取り直しも `DELETE` → `POST` の 2 本で済ませる。
   */
  const holdInput =
    step === 'confirm' && booked === null && conflict === null && placedStartsAt !== null
      ? {
          storeId,
          startsAt: placedStartsAt,
          durationMinutes,
          staffId: chosenStaffId,
          equipmentIds: [...chosenEquipmentIds],
          receptionSessionId: sessionId,
        }
      : null
  const holdKey =
    holdInput === null
      ? null
      : `${holdInput.startsAt}|${holdInput.durationMinutes}|${holdInput.staffId ?? ''}|${holdInput.equipmentIds.join(',')}`
  const holdInputRef = useRef(holdInput)
  holdInputRef.current = holdInput

  const takeHold = useCallback(() => {
    const input = holdInputRef.current
    if (input === null) return
    client.api.staff.holds
      .$post({ json: input })
      .then(async (res) => (res.ok ? await res.json() : null))
      .then((taken) => {
        if (taken === null) return
        holdRef.current = taken
        setHold(taken)
      })
      .catch(() => undefined)
  }, [])

  const releaseHold = useCallback(() => {
    const previous = holdRef.current
    holdRef.current = null
    setHold(null)
    if (previous === null) return
    /*
     * 店舗が分かっているので必ず渡す。渡さないとサーバが `KV.list` で店舗を探し当てる
     * ことになり、無料枠で最初に当たる上限（list 1,000 回/日）を取り消しのたびに削る。
     * **`hc<AppType>` にこのクエリの口がまだ無い**（ルートが `param` だけで書かれている）
     * ので、受けかけの受付を読むところと同じく `authFetch` で直に投げる。
     */
    auth
      .authFetch(
        `/api/staff/holds/${encodeURIComponent(previous.id)}?storeId=${encodeURIComponent(storeId)}`,
        { method: 'DELETE' },
      )
      .catch(() => undefined)
  }, [storeId])

  useEffect(() => {
    if (holdKey === null) return
    takeHold()
    return releaseHold
  }, [holdKey, takeHold, releaseHold])

  /**
   * 「まだ入力中です」。**延長の API は作らない**ので、返して打ち直す 2 本で取り直す。
   *
   * 取り直した回数は端末の state に置かない —— 下書きをサーバに置いた理由（iPadOS の
   * Safari は裏に回ったタブを容易に捨てる）が、そのまま上限（Q-06 の 10 回）の抜け道に
   * なる。数は下書きへ載せ、**打ち直しの前に送る** —— サーバはこの下書きを読んで
   * 409 `renew_limit` を決める。
   */
  async function keepEditing() {
    const next = { ...draft, holdRenewals: (draft.holdRenewals ?? 0) + 1 }
    setDraft(next)
    releaseHold()
    await saveDraft(next)
    takeHold()
  }

  /** BOOK-CONFLICT で選び直した枠を、その場で押さえ直す。 */
  function chooseAfterConflict(choice: ConflictChoice) {
    const base = slot ?? {
      startsAt: placedStartsAt ?? '',
      endsAt: placedEndsAt ?? '',
      staffId: chosenStaffId,
      equipmentIds: [...chosenEquipmentIds],
    }
    const next: SlotChoice =
      choice.kind === 'time'
        ? { ...base, startsAt: choice.startsAt, endsAt: choice.endsAt }
        : { ...base, staffId: choice.staffId }
    onSlotChange(next)
  }

  /** 「続けて予約を取る」。受付を新しく始め、伺った内容は 1 つも持ち越さない。 */
  function bookAgain() {
    sessionStorage.removeItem(SESSION_KEY)
    idempotencyKey.current = crypto.randomUUID()
    laneNames.current = new Map()
    holdRef.current = null
    setBooked(null)
    setConflict(null)
    setDraft(emptyDraft())
    setSlot(null)
    setHold(null)
    setNotes([])
    setReported(null)
    setStep('datetime')
    setSessionId(null)
    setPhase('starting')
    setAttempt((count) => count + 1)
  }

  const staffSwap = useMemo(() => {
    if (conflict === null) return null
    const column = board?.lanes
      .find((lane) => lane.id === chosenStaffId)
      ?.slots.findIndex((cell) => cell.startsAt === conflict.takenAt)
    if (column === undefined || column < 0) return null
    const free = board?.lanes.find(
      (lane) =>
        lane.kind === 'staff' &&
        lane.id !== null &&
        lane.id !== chosenStaffId &&
        lane.slots[column]?.isAvailable === true,
    )
    if (free === undefined || free.id === null) return null
    return {
      staffId: free.id,
      staffName: free.name,
      staffSubtitle: free.subtitle,
      resourceLabel: equipmentNames.join('・'),
    }
  }, [conflict, board, chosenStaffId, equipmentNames])

  /* --- 画面 --------------------------------------------------------------- */

  /*
   * 録音の印は工程 1〜4 が帯の中、工程 5 だけが右下の常駐（`05-screen-flow.md` §2.6）。
   * BOOK-CONFLICT は工程 3 へ差し戻した面なので、承認済みモックのとおり帯の中に戻る。
   */
  /*
   * 例外の 2 面（承認済みモック EX-MIC-DENIED / EX-UPLOAD-FAILED）。どちらも
   * **工程の面を全面差し替える**（上のバーだけが残る）。
   *   マイクを断られた …… どの工程にいても同じ形。「録音せずに続ける」でその工程へ戻る。
   *   録音だけ送れなかった …… 承ったあとの完了の面の代わりに出す。予約の成立が先に読める。
   */
  const micDenied = phase === 'ready' && booked === null && recorder.micDenied
  const uploadFailed = phase === 'ready' && booked !== null && recorder.state === 'buffered'
  const recordingInBar = booked === null && !micDenied && (step !== 'confirm' || conflict !== null)
  const barStep: BookingStepKey = conflict === null ? step : 'slot'

  /** 右下に常駐する録音の印。**1 つの画面に 1 か所しか出さない**ので、器が 1 つだけ作る。 */
  const floatingBadge = () => (
    <RecordingBadge
      state={recorder.state}
      elapsedSeconds={recorder.elapsedSeconds}
      placement="floating"
    />
  )

  return (
    <div
      data-booking-frame
      className="relative flex h-dvh flex-col bg-paper text-ink"
      style={viewportHeight === null ? undefined : { height: `${viewportHeight}px` }}
    >
      <header className="flex h-16 shrink-0 items-center gap-4 bg-pine px-4 text-on-pine">
        <button
          type="button"
          aria-label="トップへ"
          onClick={() => setConfirming(true)}
          className={cn(
            'grid size-12 place-items-center rounded-card bg-on-pine/20 text-title',
            focusRingOnPine,
          )}
        >
          <span aria-hidden="true">⌂</span>
        </button>
        <div className="min-w-0">
          <p className="truncate text-bar font-bold">{storeName}</p>
          <p className="truncate text-note opacity-90">新しい予約を取る</p>
        </div>
        {/*
          承ったあとの上のバーは「予約台帳／トップへ戻る」に替わる（承認済みモック
          BOOK-06-DONE）。もう止める入力も破棄する下書きも無いので、
          「あとで続ける」「やめる」をこの面に残さない。
        */}
        <div className="ml-auto flex items-center gap-2">
          {booked !== null ? (
            <>
              <button
                type="button"
                onClick={onOpenLedger ?? onExit}
                className={cn(
                  'min-h-12 rounded-card px-3 text-lead font-semibold text-on-pine',
                  focusRingOnPine,
                )}
              >
                予約台帳
              </button>
              <button
                type="button"
                onClick={onExit}
                className={cn(
                  'min-h-12 rounded-card px-3 text-lead font-bold text-on-pine',
                  focusRingOnPine,
                )}
              >
                トップへ戻る
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  pause().catch(() => onExit())
                }}
                className={cn(
                  'min-h-12 rounded-card px-3 text-lead font-semibold text-on-pine',
                  focusRingOnPine,
                )}
              >
                あとで続ける
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className={cn(
                  'min-h-12 rounded-card px-3 text-lead font-bold text-on-pine',
                  focusRingOnPine,
                )}
              >
                やめる
              </button>
            </>
          )}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {phase === 'starting' ? (
          <p role="status" className="p-11 text-body text-ink-muted">
            受付を始めています…
          </p>
        ) : phase === 'failed' ? (
          <div role="alert" className="grid content-start gap-3 p-11">
            <p className="text-title font-bold text-ink">受付を始められませんでした。</p>
            <p className="text-body text-ink-muted">
              通信を確かめて、もう一度お試しください。伺った内容はまだありません。
            </p>
            <button
              type="button"
              onClick={() => {
                setPhase('starting')
                setAttempt((count) => count + 1)
              }}
              className={cn(
                'min-h-12 justify-self-start rounded-ctl bg-pine px-6 text-lead font-bold text-on-pine',
                focusRing,
              )}
            >
              もう一度始める
            </button>
          </div>
        ) : micDenied ? (
          /*
           * できないのは録音だけ。**受付はこのまま最後まで続けられる**ことを先に言い切り、
           * 直し方は右へ寄せる（AC-REC-03 / AC-REC-04 / AC-REC-16）。
           */
          <MicDeniedPanel
            onContinueWithoutRecording={recorder.continueWithoutRecording}
            /*
             * 同じ読み込みのまま尋ね直しても、ブラウザはダイアログを出さずに即断る。
             * 読み込み直して判定し直す —— 伺った内容は `reception_sessions` の下書きから
             * 引き直すので、端末に残すのは受付セッション id だけでよい。
             */
            onRecheck={() => {
              setMicRechecking(true)
              window.location.reload()
            }}
            recheck={micRechecking ? 'checking' : 'idle'}
            onAbandon={() => setConfirming(true)}
            indicator={floatingBadge()}
          />
        ) : uploadFailed ? (
          /*
           * 承ったのに録音だけ送れなかった。**成立が上、失敗が下**（AC-REC-06 / AC-REC-18）。
           * 完了の面（DoneStep）の代わりに出す —— 同じ面に 2 つの結末を並べない。
           */
          <UploadFailedPanel
            reservation={{
              code: booked?.code ?? '',
              startsAt: booked?.startsAt ?? clock,
              endsAt: booked?.endsAt ?? clock,
              purposeLabel: booked?.purposeLabelInternal ?? purposeLabel,
              customerName: draft.nameTyped === '' ? null : draft.nameTyped,
              staffName,
              equipmentNames,
            }}
            durationSeconds={recorder.elapsedSeconds}
            nextAttemptAt={recorder.nextAttemptAt}
            onContinue={onOpenLedger ?? onExit}
            onRetry={recorder.retryNow}
            retry={recorder.retrying}
            indicator={floatingBadge()}
          />
        ) : booked !== null ? (
          <DoneStep
            reservation={{
              code: booked.code,
              startsAt: booked.startsAt,
              endsAt: booked.endsAt,
              durationMinutes: booked.durationMinutes,
              purposeLabel: booked.purposeLabelInternal,
              customerName: draft.nameTyped,
              phoneDigits: draft.phoneTyped,
              staffName,
              equipmentNames,
            }}
            isOffline={isOffline}
            onBookAgain={bookAgain}
            onOpenLedger={onOpenLedger ?? onExit}
          />
        ) : conflict !== null ? (
          <ConflictNotice
            takenAt={conflict.takenAt}
            takenLabel={[staffName ?? '担当が未定', ...equipmentNames].join('・')}
            staffName={staffName ?? '担当が未定'}
            summary={{
              date: toJstDateString(conflict.takenAt),
              purposeLabel,
              durationMinutes,
              customerLabel: draft.nameTyped === '' ? '' : `${draft.nameTyped} 様`,
            }}
            alternatives={conflict.alternatives.map((alternative) => ({
              startsAt: alternative.startsAt,
              endsAt: alternative.endsAt,
              resourceLabel: alternative.equipmentIds
                .map((id) => laneNames.current.get(id))
                .filter((name): name is string => name !== undefined)
                .join('・'),
            }))}
            staffSwap={staffSwap}
            onChoose={chooseAfterConflict}
            onGuardChange={onGuardChange}
            onBackToDate={() => {
              setConflict(null)
              setStep('datetime')
            }}
          />
        ) : step === 'datetime' ? (
          <DateTimeStep
            storeId={storeId}
            now={clock}
            receptionSessionId={sessionId}
            draft={draft}
            onDraftChange={setDraft}
            onGuardChange={onGuardChange}
          />
        ) : step === 'purpose' ? (
          <PurposeStep
            storeId={storeId}
            receptionSessionId={sessionId}
            draft={draft}
            onDraftChange={setDraft}
            onGuardChange={onGuardChange}
            onPickAnotherDay={() => setStep('datetime')}
          />
        ) : step === 'slot' ? (
          <SlotStep
            availability={board}
            phase={isOffline ? 'offline' : boardPhase}
            axis={axis}
            onAxisChange={setAxis}
            purposeLabel={purposeLabel}
            startsAt={startsAt ?? clock}
            durationMinutes={durationMinutes}
            staffId={slotOrigin.staffId}
            equipmentIds={slotOrigin.equipmentIds}
            onChange={onSlotChange}
            onGuardChange={onGuardChange}
            onRetry={() => setBoardAttempt((count) => count + 1)}
            onBackToDate={() => setStep('datetime')}
          />
        ) : step === 'customer' ? (
          <CustomerStep
            value={customer}
            onChange={(next) => {
              setNotes(next.notes)
              setDraft((current) => ({
                ...current,
                phoneTyped: next.phoneTyped,
                nameTyped: next.nameTyped,
                kanaTyped: next.kanaTyped,
                noteTyped: next.noteTyped,
                // 選んだ 1 名は下書きに置く。サーバに残るので、タブを捨てて戻っても
                // 結び付けが消えない（実装不足の洗い出し customers-01）。
                customerId: next.customerId,
              }))
            }}
            soFar={{
              dateTimeLabel: placedStartsAt === null ? '' : stampLabel(placedStartsAt),
              purposeLabel,
              durationMinutes,
              staffLabel: staffName,
              equipmentLabel: equipmentNames.join('／') || null,
            }}
            writer={writer}
            now={clock}
            onLookup={onCustomerLookup}
            isOffline={isOffline}
          />
        ) : (
          <ConfirmStep
            storeName={storeName}
            startsAt={placedStartsAt ?? clock}
            endsAt={placedEndsAt ?? clock}
            durationMinutes={durationMinutes}
            purposeNames={purposeNames}
            customerName={draft.nameTyped}
            phoneDigits={draft.phoneTyped}
            staffName={staffName}
            equipmentNames={equipmentNames}
            holdExpiresAt={hold?.expiresAt ?? null}
            now={tick}
            renewalsUsed={draft.holdRenewals ?? 0}
            phase={bookingFailed ? 'error' : 'ready'}
            isOffline={isOffline}
            onJumpTo={(target) =>
              setStep(
                (['datetime', 'purpose', 'slot', 'customer'] as const)[target - 1] ?? 'datetime',
              )
            }
            onKeepEditing={() => {
              keepEditing().catch(() => undefined)
            }}
          />
        )}
        {/*
          工程 5 だけ、録音の印が帯から右下の常駐表示へ移る（`design/05-screen-flow.md` §2.6）。
          例外の 2 面は自分の中へ同じ印を 1 つ置いているので、ここでは出さない
          （**録音の印は 1 つの画面に 1 か所**）。
        */}
        {phase === 'ready' &&
          !recordingInBar &&
          !micDenied &&
          !uploadFailed &&
          booked === null &&
          floatingBadge()}
      </div>

      {/* 完了の面と例外の 2 面は工程の帯を持たない（承認済みモック BOOK-06-DONE / EX-MIC-DENIED）。 */}
      {phase === 'ready' && booked === null && !micDenied && (
        <StepBar
          current={barStep}
          done={conflict === null ? undefined : CONFLICT_DONE_STEPS}
          guard={guard}
          onBack={() => {
            if (conflict !== null) {
              setConflict(null)
              setStep('slot')
              return
            }
            goTo(previousStep(step)).catch(() => undefined)
          }}
          onNext={() => {
            if (conflict !== null) {
              setConflict(null)
              setStep('confirm')
              return
            }
            goTo(nextStep(step)).catch(() => undefined)
          }}
          recording={
            recordingInBar ? (
              <RecordingBadge
                state={recorder.state}
                elapsedSeconds={recorder.elapsedSeconds}
                placement="bar"
              />
            ) : null
          }
          action={
            step === 'confirm' && conflict === null ? (
              <ConfirmAction
                confirming={booking}
                isOffline={isOffline}
                onConfirm={() => {
                  confirmBooking().catch(() => setBookingFailed(true))
                }}
              />
            ) : undefined
          }
        />
      )}

      {/*
        破棄の確認。`design/05-screen-flow.md` §7.6 は取り消しの確認だけを
        `role="alertdialog"` と決めている。面が差し替わるので見出しへ焦点を移し、
        閉じたら開いた操作へ戻す。
      */}
      {confirming && (
        <div className="absolute inset-0 z-20 grid place-items-center bg-ink/30 p-8">
          <div
            ref={confirmRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setConfirming(false)
            }}
            className="w-full max-w-md rounded-panel border border-line bg-surface p-6"
          >
            <h2 id={titleId} className="text-title font-bold text-ink">
              入力をやめますか
            </h2>
            <p className="mt-2 text-body text-ink-muted">
              伺った内容は消えます。この受付の記録と録音は残ります。
            </p>
            {/* 既定の操作は「続ける」に置く。やめるほうは戻せない（CHANGE-CANCEL と同じ逆転）。 */}
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className={cn(
                  'min-h-12 rounded-ctl bg-pine px-6 text-lead font-bold text-on-pine',
                  focusRing,
                )}
              >
                続ける
              </button>
              <button
                type="button"
                onClick={() => {
                  discard().catch(() => onExit())
                }}
                className={cn(
                  'min-h-12 rounded-ctl border border-danger bg-surface px-6 text-lead font-semibold text-danger',
                  focusRing,
                )}
              >
                入力をやめる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
