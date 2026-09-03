import type {
  Equipment,
  Hold,
  LocalDate,
  ReservationChangeHistory,
  ReservationDetail,
  ReservationSummary,
  SearchRelaxation,
  StaffMember,
} from '@app/contracts'
import { auth, toJstDateString } from '@app/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReservationSnapshot } from '../../worker/domain/reservation-change'
import { client } from '../client'
import { dateLabel, jstClock } from '../ledger/metrics'
import { type CancelReason, ChangeCancel } from './ChangeCancel'
import { ChangeDateTime } from './ChangeDateTime'
import { ChangeDiff, type SlotTaken } from './ChangeDiff'
import { ChangeDone } from './ChangeDone'
import { type ConflictChoice, type ConflictFieldRow, ConflictPanel } from './ConflictPanel'
import { ReservationSearch, type SearchConditions, type SearchPhase } from './ReservationSearch'

/*
 * 予約を探して直す面の器（承認済みモック CHANGE-SEARCH → CHANGE-DATETIME → CHANGE-DIFF
 * → CHANGE-DONE、枝として CHANGE-CANCEL と EX-CONFLICT）。
 *
 * **URL による画面の切り替えを持ち込まない**（この製品に router は無い。P0 の `App` と
 * 同じく `useState` で面を出し分ける）。`?step=` を URL に書き換えない。
 *
 * 器の仕事:
 *   1. 左ペインの条件をそのままサーバへ写し、押した札で取り直す。
 *   2. 選ばれた 1 件の中身と、担当・場所・お電話番号のお名前を引き当てる
 *      （`ReservationDetail` は id しか持たないので、店舗の名簿と突き合わせる）。
 *   3. **変更先の枠を先に押さえてから**確定へ進む。元を先に空けると、空けた瞬間に
 *      別の端末へ枠を取られたときに戻せない。
 *   4. 確定の 409 を 2 つに分ける —— 枠の競合（`slot_taken`）は BOOK-CONFLICT と同じ形、
 *      版の競合（`version_conflict`）は EX-CONFLICT（両方を並べ、**選ぶまでどちらも
 *      書き換えない**）へ。
 *   5. 取り消し（CHANGE-CANCEL）と、変更・取消どちらの完了（CHANGE-DONE）も出す。
 *
 * この器が持たない唯一の出口は「担当・場所を変える」（BOOK-03-SLOT-STAFF の再利用）で、
 * 外から `onChangeSlot` を渡すとそちらへ流れる。渡されないときは 1 行で断る
 * （押して何も起きないボタンを置かない）。
 */

/** 1 画面に出す結果の上限（`ReservationSearchQuery.limit` の既定と同じ）。 */
const PAGE_LIMIT = 50
/** 残り時間の刻み。仮の押さえの残りは器が 1 秒ずつ進める（端末の時計を読まない）。 */
const TICK_MS = 1000

/** 何も入れていない状態。「これから」＝本日以降のご予約。 */
const BLANK: SearchConditions = {
  name: '',
  phone: '',
  code: '',
  period: 'upcoming',
  source: null,
  includeCancelled: false,
}

/** 条件をそのままサーバへの問い合わせに写す。 */
function searchParams(
  storeId: string,
  conditions: SearchConditions,
  today: LocalDate,
): URLSearchParams {
  const params = new URLSearchParams({ storeId, limit: String(PAGE_LIMIT) })
  if (conditions.name !== '') params.set('name', conditions.name)
  if (conditions.phone !== '') params.set('phone', conditions.phone)
  if (conditions.code !== '') params.set('code', conditions.code)
  if (conditions.period === 'today') {
    params.set('from', today)
    params.set('to', today)
  } else if (conditions.period === 'upcoming') {
    params.set('from', today)
  } else {
    params.set('from', conditions.period.from)
    params.set('to', conditions.period.to)
  }
  if (conditions.source === 'web') params.set('source', 'web')
  if (conditions.includeCancelled) params.set('includeCancelled', 'true')
  return params
}

/**
 * 案が返した「外した条件以外はそのまま」のクエリを、左ペインの条件へ写し戻す。
 * **画面は条件を組み立て直さない**（サーバが返した形をそのまま次の問い合わせにする）。
 */
function conditionsFromQuery(record: Record<string, unknown>): SearchConditions {
  const text = (key: string) => (typeof record[key] === 'string' ? (record[key] as string) : '')
  const from = text('from')
  const to = text('to')
  const sources = Array.isArray(record.source) ? record.source : []
  return {
    name: text('name'),
    phone: text('phone'),
    code: text('code'),
    period: from !== '' && to !== '' ? { from, to } : 'upcoming',
    source: sources.includes('web') ? 'web' : null,
    includeCancelled: record.includeCancelled === true,
  }
}

/** ご予約 1 件の姿を、差分と読み上げ文が読む形へ写す。 */
function snapshotOf(
  detail: ReservationDetail,
  staffNames: Map<string, string>,
  placeNames: Map<string, string>,
): ReservationSnapshot {
  const staff = detail.assignments.find((row) => row.kind === 'staff')
  const staffId = staff?.targetId ?? null
  const equipmentIds = detail.assignments
    .filter((row) => row.kind === 'equipment' && row.targetId !== null)
    .map((row) => row.targetId ?? '')
  return {
    startsAt: detail.startsAt,
    endsAt: detail.endsAt,
    durationMinutes: detail.durationMinutes,
    purposeIds: detail.purposes.map((row) => row.purposeId),
    purposeLabel: detail.purposeLabelInternal,
    staffId,
    staffName: staffId === null ? null : (staffNames.get(staffId) ?? null),
    equipmentIds,
    equipmentNames: equipmentIds.map((id) => placeNames.get(id) ?? ''),
  }
}

/** 版が合わなかったときにサーバが載せてくる相手の姿（`conflictingVersion`）。 */
type VersionConflict = {
  version: number
  startsAt: string
  endsAt: string
  staffName: string | null
  equipmentNames?: readonly string[]
  savedAt: string
  savedBy: string | null
}

/** 「8月27日（木）」。年をまたぐ知らせは出さないので年を落とす。 */
function monthDayLabel(instant: string): string {
  return dateLabel(toJstDateString(instant)).replace(/^\d+年/, '')
}

/** 「8月27日（木）11:00–12:00」。競合の左右の表と完了の 1 行が使う。 */
function rangeLabel(startsAt: string, endsAt: string): string {
  return `${monthDayLabel(startsAt)}${jstClock(startsAt)}–${jstClock(endsAt)}`
}

function placeLabel(names: readonly string[]): string {
  const kept = names.filter((name) => name !== '')
  return kept.length === 0 ? '指定なし' : kept.join('・')
}

/**
 * 競合の左右に並べる 3 行。**旧値がある行＝変わった行**の 1 つの規則で描くので、
 * 元のご予約（`before`）から動いた項目にだけ `previous` を入れる。
 */
function conflictRows(
  before: ReservationSnapshot,
  mine: ReservationSnapshot,
  theirs: VersionConflict,
): ConflictFieldRow[] {
  const wasWhen = rangeLabel(before.startsAt, before.endsAt)
  const wasStaff = before.staffName ?? '担当が未定'
  const wasPlace = placeLabel(before.equipmentNames)
  const theirWhen = rangeLabel(theirs.startsAt, theirs.endsAt)
  const theirStaff = theirs.staffName ?? '担当が未定'
  const theirPlace = placeLabel(theirs.equipmentNames ?? before.equipmentNames)
  const myWhen = rangeLabel(mine.startsAt, mine.endsAt)
  const myStaff = mine.staffName ?? '担当が未定'
  const myPlace = placeLabel(mine.equipmentNames)
  const cell = (value: string, was: string) => ({ value, previous: value === was ? null : was })
  return [
    {
      key: 'datetime',
      term: 'お日にちとお時間',
      theirs: cell(theirWhen, wasWhen),
      mine: cell(myWhen, wasWhen),
    },
    {
      key: 'staff',
      term: '担当',
      theirs: cell(theirStaff, wasStaff),
      mine: cell(myStaff, wasStaff),
    },
    {
      key: 'equipment',
      term: '場所',
      theirs: cell(theirPlace, wasPlace),
      mine: cell(myPlace, wasPlace),
    },
  ]
}

/** 完了の面に出す「この操作は受付履歴に残ります（…）」の材料。 */
type DoneAudit = { at: string; actorName: string }

export function ChangeScreen({
  storeId,
  storeName,
  now,
  onOpenCustomers,
  onStartBooking,
  onOpenLedger,
  onGoHome,
  onSubline,
  initialReservationId,
  initialStep = 'datetime',
  onChangeSlot,
  onSessionExpired,
  isOffline = false,
}: {
  storeId: string
  /** 完了の脚注に出す店舗の名前（「銀座店 この端末・11:12　操作者 中村 彩」）。 */
  storeName: string
  /**
   * いまの時刻（ISO8601）。端末の時計を読まないため外から注ぐ。省略すると器が
   * 開いた瞬間の時刻で始め、仮の押さえの残りだけを 1 秒ずつ進める。
   */
  now?: string
  /** 顧客台帳へ、入れたお名前を持って渡す（AC-CHANGE-24）。 */
  onOpenCustomers: (name: string) => void
  onStartBooking: () => void
  /** 完了の面の「台帳で見る」。 */
  onOpenLedger: () => void
  /** 完了の面の「トップへ戻る」。 */
  onGoHome: () => void
  /** 上のバーの小見出し（「予約を変更する」／「予約の変更　EY-2608-0142」）。 */
  onSubline?: (subline: string) => void
  /**
   * 台帳の詳細から「変更する」「取り消す」で来たときの予約。
   * **押した予約をそのまま開く。** 渡さなければ、これまでどおり検索から始まる。
   */
  initialReservationId?: string
  /** 上と対で、日時変更と取り消しのどちらから始めるか。 */
  initialStep?: 'datetime' | 'cancel'
  /** 担当・場所を変える（BOOK-03-SLOT-STAFF の再利用）。渡されないと 1 行で断る。 */
  onChangeSlot?: (detail: ReservationDetail) => void
  onSessionExpired?: () => void
  /** Shell が検知した通信断。変更・取消の送信は行わない。 */
  isOffline?: boolean
}) {
  /*
   * 暦日は面を開いた時刻で決める。**残り時間の時計とは別に持つ** —— 1 秒ごとに
   * 進む値を検索の依存に混ぜると、毎秒 `GET /api/staff/reservations` を投げてしまう。
   */
  const opened = useMemo(() => now ?? new Date().toISOString(), [now])
  const today = toJstDateString(new Date(opened))
  const [clock, setClock] = useState(opened)
  useEffect(() => setClock(opened), [opened])

  const [step, setStep] = useState<'search' | 'datetime' | 'diff' | 'cancel' | 'done'>(
    initialReservationId === undefined ? 'search' : initialStep,
  )
  const [conditions, setConditions] = useState<SearchConditions>(BLANK)
  const [reload, setReload] = useState(0)
  const [items, setItems] = useState<readonly ReservationSummary[]>([])
  const [total, setTotal] = useState(0)
  const [relaxations, setRelaxations] = useState<readonly SearchRelaxation[]>([])
  const [phase, setPhase] = useState<SearchPhase>('loading')

  const [selectedId, setSelectedId] = useState<string | null>(initialReservationId ?? null)
  const [detail, setDetail] = useState<ReservationDetail | null>(null)
  const [detailReload, setDetailReload] = useState(0)
  const [detailPhase, setDetailPhase] = useState<'loading' | 'ready' | 'error' | 'not_found'>(
    'loading',
  )
  const [customerPhone, setCustomerPhone] = useState<string | null>(null)
  const [staffNames, setStaffNames] = useState<Map<string, string>>(() => new Map())
  const [placeNames, setPlaceNames] = useState<Map<string, string>>(() => new Map())

  const [chosenStartsAt, setChosenStartsAt] = useState<string | null>(null)
  const [hold, setHold] = useState<Hold | null>(null)
  const holdRef = useRef<Hold | null>(null)
  const [renewals, setRenewals] = useState(0)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [slotTaken, setSlotTaken] = useState<SlotTaken | null>(null)
  const [conflict, setConflict] = useState<VersionConflict | null>(null)
  /** 競合の面で送っている間（二重に送らせない）。 */
  const [resolving, setResolving] = useState(false)
  /** 完了の面。何を承ったのか・変更前の時間帯・監査の 1 行。 */
  const [done, setDone] = useState<{
    kind: 'changed' | 'cancelled'
    previousRange: string | null
    audit: DoneAudit
  } | null>(null)
  // まだ画面に居場所の無い遷移を押されたときの答え（押して何も起きないボタンにしない）。
  const [notice, setNotice] = useState<string | null>(null)

  /* --- 名簿（店舗 1 つにつき 1 度だけ） --- */
  useEffect(() => {
    let live = true
    Promise.all([
      client.api.staff.stores[':storeId'].staff.$get({ param: { storeId } }),
      client.api.staff.stores[':storeId'].equipment.$get({ param: { storeId } }),
    ])
      .then(async ([staffRes, placeRes]) => {
        if (!live) return
        if (staffRes.ok) {
          const rows: StaffMember[] = await staffRes.json()
          if (live) setStaffNames(new Map(rows.map((row) => [row.id, row.displayName])))
        }
        if (placeRes.ok) {
          const rows: Equipment[] = await placeRes.json()
          if (live) setPlaceNames(new Map(rows.map((row) => [row.id, row.name])))
        }
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [storeId])

  /* --- 検索 --- */
  useEffect(() => {
    let live = true
    const params = searchParams(storeId, conditions, today)
    setPhase('loading')
    /*
     * `GET /api/staff/reservations` の query は `ReservationSearchQuery` の
     * `strictObject` なので、hc へ部分的な条件を渡す形が作れない。経路だけ型のついた
     * クライアントに引かせ、条件は fetch の側で足す（`customers/CustomerScreen.tsx`
     * と同じ道）。
     */
    client.api.staff.reservations
      .$get(undefined as never, {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          auth.authFetch(`${String(input)}?${params.toString()}`, init),
      })
      .then(async (res) => {
        const status: number = res.status
        if (!live) return
        if (status === 401) {
          setPhase('error')
          onSessionExpired?.()
          return
        }
        if (!res.ok) {
          setPhase(status === 403 ? 'forbidden' : 'error')
          return
        }
        const list = await res.json()
        if (!live) return
        setItems(list.items)
        setTotal(list.total)
        setRelaxations(list.relaxations)
        setPhase('ready')
      })
      .catch(() => {
        if (live) setPhase('error')
      })
    return () => {
      live = false
    }
  }, [storeId, conditions, today, reload, onSessionExpired])

  /* --- 選んだ 1 件 --- */
  useEffect(() => {
    if (selectedId === null) return
    let live = true
    setDetail(null)
    setCustomerPhone(null)
    setDetailPhase('loading')
    client.api.staff.reservations[':reservationId']
      .$get({ param: { reservationId: selectedId } })
      .then(async (res) => {
        const status: number = res.status
        if (!live) return
        if (!res.ok) {
          setDetailPhase(status === 404 ? 'not_found' : 'error')
          return
        }
        const found: ReservationDetail = await res.json()
        if (!live) return
        setDetail(found)
        setDetailPhase('ready')
      })
      .catch(() => {
        if (live) setDetailPhase('error')
      })
    return () => {
      live = false
    }
  }, [selectedId, detailReload])

  /** お電話番号は詳細に載らないので、お客様の台帳から 1 本引く（モックの「／090-…」）。 */
  const customerId = detail?.customerId ?? null
  useEffect(() => {
    if (customerId === null || customerId === undefined) return
    let live = true
    client.api.staff.customers[':customerId']
      .$get({ param: { customerId } })
      .then(async (res) => {
        if (!live || !res.ok) return
        const found: { phone?: string | null } = await res.json()
        if (live) setCustomerPhone(found.phone ?? null)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [customerId])

  /* --- 仮の押さえ（変更先の枠を先に確保する） --- */
  const releaseHold = useCallback(() => {
    const previous = holdRef.current
    holdRef.current = null
    setHold(null)
    if (previous === null) return
    /*
     * 店舗が分かっているので必ず渡す。渡さないとサーバが `KV.list` で店舗を探し当てる
     * ことになり、無料枠で最初に当たる上限（list 1,000 回/日）を削る。
     */
    auth
      .authFetch(
        `/api/staff/holds/${encodeURIComponent(previous.id)}?storeId=${encodeURIComponent(storeId)}`,
        { method: 'DELETE' },
      )
      .catch(() => undefined)
  }, [storeId])

  const takeHold = useCallback(
    (startsAt: string, durationMinutes: number) => {
      client.api.staff.holds
        .$post({ json: { storeId, startsAt, durationMinutes } })
        .then(async (res) => (res.ok ? await res.json() : null))
        .then((taken) => {
          if (taken === null) return
          holdRef.current = taken
          setHold(taken)
        })
        .catch(() => undefined)
    },
    [storeId],
  )

  const duration = detail?.durationMinutes ?? 0
  useEffect(() => {
    if (step !== 'datetime' || chosenStartsAt === null || duration === 0) return
    takeHold(chosenStartsAt, duration)
    return releaseHold
  }, [step, chosenStartsAt, duration, takeHold, releaseHold])

  /*
   * 仮の押さえの残り時間。**端末の時計を読まず**、器が持っている時刻を 1 秒ずつ進める
   * （`booking/BookingScreen.tsx` と同じ手）。押さえていない間は進めない。
   */
  useEffect(() => {
    if (step !== 'datetime' || hold === null) return
    const timer = setInterval(
      () => setClock((at) => new Date(Date.parse(at) + TICK_MS).toISOString()),
      TICK_MS,
    )
    return () => clearInterval(timer)
  }, [step, hold])

  /* --- 面の名前 --- */
  useEffect(() => {
    if (detail === null) {
      onSubline?.('予約を変更する')
      return
    }
    onSubline?.(
      step === 'search'
        ? '予約を変更する'
        : step === 'cancel'
          ? `予約の取り消し　${detail.code}`
          : `予約の変更　${detail.code}`,
    )
  }, [step, detail, onSubline])

  function backToSearch() {
    releaseHold()
    setChosenStartsAt(null)
    setSlotTaken(null)
    setConflict(null)
    setConfirmError(null)
    setDone(null)
    setStep('search')
  }

  const before = detail === null ? null : snapshotOf(detail, staffNames, placeNames)
  const after =
    before === null || chosenStartsAt === null
      ? before
      : {
          ...before,
          startsAt: chosenStartsAt,
          endsAt: new Date(
            Date.parse(chosenStartsAt) + before.durationMinutes * 60 * 1000,
          ).toISOString(),
        }

  /**
   * 監査の 1 行を読み直す。**端末の時計で「11:12」と書かない** —— 受付履歴に実際に
   * 残った時刻と操作者を、経緯の最後の 1 行から取る（読めなければ空のまま出す）。
   */
  async function auditOf(reservationId: string, fallbackAt: string): Promise<DoneAudit> {
    try {
      const res = await client.api.staff.reservations[':reservationId'].history.$get({
        param: { reservationId },
      })
      if (!res.ok) return { at: fallbackAt, actorName: 'この端末' }
      const rows: ReservationChangeHistory[] = await res.json()
      const last = rows.at(-1)
      return {
        at: last?.occurredAt ?? fallbackAt,
        actorName: last?.actorName ?? 'この端末',
      }
    } catch {
      return { at: fallbackAt, actorName: 'この端末' }
    }
  }

  /** 409 の本文を読み分ける。版の競合は `conflict` へ、枠の競合は BOOK-CONFLICT の形へ。 */
  function takeConflict(body: unknown, targetStartsAt: string): void {
    const error = (body as { error?: string }).error
    if (error === 'version_conflict') {
      setConflict((body as { current: VersionConflict }).current)
      return
    }
    const alternatives = (body as { alternatives?: { startsAt: string; endsAt: string }[] })
      .alternatives
    setSlotTaken({
      takenAt: targetStartsAt,
      takenLabel: [before?.staffName ?? '担当が未定', ...(before?.equipmentNames ?? [])]
        .filter((name) => name !== '')
        .join('・'),
      staffName: before?.staffName ?? '担当が未定',
      summary: {
        date: toJstDateString(new Date(targetStartsAt)),
        purposeLabel: detail?.purposeLabelInternal ?? '',
        durationMinutes: detail?.durationMinutes ?? 0,
        customerLabel: detail?.customerName == null ? '' : `${detail.customerName} 様`,
      },
      alternatives: (alternatives ?? []).map((slot) => ({
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        resourceLabel: '',
      })),
      staffSwap: null,
    })
  }

  /** 変更を確定する。**送るのはここだけ**（差分の面も競合の面も送らない）。 */
  async function patchTo(startsAt: string, version: number, previousRange: string) {
    if (detail === null || isOffline) return
    const res = await client.api.staff.reservations[':reservationId'].$patch({
      param: { reservationId: detail.id },
      json: { version, startsAt },
    })
    const status: number = res.status
    if (status === 409) {
      takeConflict(await res.json(), startsAt)
      return
    }
    if (!res.ok) {
      setConfirmError('うまく処理できませんでした。伺った内容は残っています。')
      return
    }
    const saved: ReservationDetail = await res.json()
    releaseHold()
    setDetail(saved)
    setConflict(null)
    setChosenStartsAt(null)
    setDone({
      kind: 'changed',
      previousRange,
      audit: await auditOf(saved.id, saved.updatedAt),
    })
    setStep('done')
    setReload((count) => count + 1)
  }

  async function confirm() {
    if (detail === null || chosenStartsAt === null || before === null) return
    setConfirming(true)
    setConfirmError(null)
    try {
      await patchTo(
        chosenStartsAt,
        detail.version,
        `${jstClock(before.startsAt)}–${jstClock(before.endsAt)}`,
      )
    } finally {
      setConfirming(false)
    }
  }

  /** 取り消す。理由は面が選ばせてからしか届かない（`ReservationCancelInput` は必須）。 */
  async function cancelReservation(reason: CancelReason) {
    if (detail === null || isOffline) return
    setConfirming(true)
    try {
      const res = await client.api.staff.reservations[':reservationId'].cancel.$post({
        param: { reservationId: detail.id },
        json: { version: detail.version, reason },
      })
      const status: number = res.status
      if (status === 409) {
        takeConflict(await res.json(), detail.startsAt)
        return
      }
      if (!res.ok) {
        setNotice('取り消せませんでした。もう一度お試しください。')
        setStep('search')
        return
      }
      const saved: ReservationDetail = await res.json()
      setDetail(saved)
      setDone({
        kind: 'cancelled',
        previousRange: null,
        audit: await auditOf(saved.id, saved.updatedAt),
      })
      setStep('done')
      setReload((count) => count + 1)
    } finally {
      setConfirming(false)
    }
  }

  /**
   * 競合の出口。**押した時点ではまだ何も保存していない。**
   *
   * - 相手の内容を残す … 書き込みを送らず、最新の版を読み直す（AC-CHANGE-23）。
   * - あなたの内容で上書きする／1項目ずつ選ぶ … 送る前に空き枠を**当て直し**、
   *   空いていれば相手の最新 `version` を載せて `PATCH` する（AC-CHANGE-20）。
   *   混ぜた組み合わせはどちらの端末も検証していないので、当て直しを省かない。
   */
  async function resolveConflict(choice: ConflictChoice) {
    if (detail === null || conflict === null || before === null) return
    if (choice.kind === 'theirs') {
      releaseHold()
      setChosenStartsAt(null)
      setConflict(null)
      setDetailReload((count) => count + 1)
      setStep('search')
      setNotice('ほかの端末の内容を残しました。この端末で入れていた変更は取り消しています。')
      return
    }
    const keepMine = choice.kind === 'mine' ? true : (choice.picks.datetime ?? 'theirs') === 'mine'
    if (!keepMine) {
      // 日時は相手のまま。送るものが無いので、相手を残したのと同じ道へ落とす。
      await resolveConflict({ kind: 'theirs' })
      return
    }
    const startsAt = after?.startsAt ?? before.startsAt
    setResolving(true)
    try {
      const free = await client.api.staff.availability.$get({
        query: {
          storeId,
          date: toJstDateString(new Date(startsAt)),
          axis: 'staff',
          durationMinutes: String(before.durationMinutes),
          excludeReservationId: detail.id,
        },
      })
      if (free.ok) {
        const answer = await free.json()
        const slot = answer.slots.find((row) => row.startsAt === startsAt)
        if (slot !== undefined && !(slot.isAvailable && slot.remaining > 0)) {
          setConflict(null)
          takeConflict({ error: 'slot_taken', alternatives: answer.alternatives }, startsAt)
          setStep('diff')
          return
        }
      }
      await patchTo(
        startsAt,
        conflict.version,
        `${jstClock(before.startsAt)}–${jstClock(before.endsAt)}`,
      )
    } finally {
      setResolving(false)
    }
  }

  const staffName = before?.staffName ?? null
  const equipmentNames = before?.equipmentNames.filter((name) => name !== '') ?? []

  return (
    <div className="flex h-full min-h-0 flex-col">
      {notice !== null && (
        <p
          role="status"
          className="flex-none border-b border-line bg-surface px-4 py-2 text-grid text-ink-muted"
        >
          {notice}
        </p>
      )}
      <div className="min-h-0 flex-1">
        {conflict !== null && before !== null && after !== null ? (
          <ConflictPanel
            theirs={{
              actorName: conflict.savedBy ?? 'ほかの端末',
              // 端末の登録簿がこの製品に無く、409 の応答も保存した人の名前しか
              // 載せない。無い名前をでっち上げず、空のまま渡す。
              terminalName: '',
              savedAt: conflict.savedAt,
            }}
            mine={{ terminalName: 'この端末' }}
            rows={conflictRows(before, after, conflict)}
            phase={resolving ? 'loading' : 'ready'}
            onResolve={(choice) => {
              resolveConflict(choice).catch(() => {
                setConflict(null)
                setConfirmError('うまく処理できませんでした。伺った内容は残っています。')
                setStep('diff')
              })
            }}
            onAbort={backToSearch}
          />
        ) : step === 'done' && detail !== null && done !== null ? (
          <ChangeDone
            kind={done.kind}
            reservation={{
              code: detail.code,
              startsAt: detail.startsAt,
              endsAt: detail.endsAt,
              durationMinutes: detail.durationMinutes,
              customerName: detail.customerName ?? null,
              staffName,
              equipmentNames,
            }}
            previousRange={done.previousRange}
            tell={
              done.kind === 'changed'
                ? [
                    `${monthDayLabel(detail.startsAt)}${jstClock(detail.startsAt)} のご来店に変わりました。担当は${staffName ?? '当日ご案内する者'}、所要は約${detail.durationMinutes}分です。`,
                    ...(detail.noteCustomer === '' ? [] : [detail.noteCustomer]),
                  ]
                : [
                    `${monthDayLabel(detail.startsAt)}${jstClock(detail.startsAt)} のご予約を取り消しました。`,
                  ]
            }
            audit={{
              storeName,
              terminalName: 'この端末',
              at: done.audit.at,
              actorName: done.audit.actorName,
            }}
            onOpenLedger={onOpenLedger}
            onGoHome={onGoHome}
          />
        ) : step === 'cancel' && detail !== null ? (
          <ChangeCancel
            target={{
              code: detail.code,
              startsAt: detail.startsAt,
              endsAt: detail.endsAt,
              durationMinutes: detail.durationMinutes,
              customerName: detail.customerName ?? null,
              visitCount: detail.visitCount ?? null,
              phoneDigits: customerPhone ?? '',
              purposeLabel: detail.purposeLabelInternal,
              purposeNote:
                detail.purposeLabel === detail.purposeLabelInternal ? '' : detail.purposeLabel,
              staffName,
              equipmentNames,
            }}
            onBack={backToSearch}
            onCancel={(reason) => {
              cancelReservation(reason).catch(() => {
                setNotice('取り消せませんでした。もう一度お試しください。')
                setStep('search')
              })
            }}
            isOffline={isOffline}
          />
        ) : step === 'search' ? (
          <ReservationSearch
            conditions={conditions}
            onConditions={(next) => {
              setNotice(null)
              setConditions(next)
            }}
            items={items}
            total={total}
            relaxations={relaxations}
            phase={phase}
            selectedId={selectedId}
            onSelect={(reservationId) => {
              setNotice(null)
              setSelectedId(reservationId)
            }}
            detail={detail}
            detailPhase={detailPhase}
            staffName={staffName}
            equipmentNames={equipmentNames}
            customerPhone={customerPhone}
            onRelax={(relaxation) => setConditions(conditionsFromQuery(relaxation.query))}
            onChangeDateTime={() => {
              if (detail === null) return
              setConfirmError(null)
              setSlotTaken(null)
              setStep('datetime')
            }}
            onChangeSlot={() => {
              if (detail === null) return
              if (onChangeSlot === undefined) {
                setNotice('担当・場所を変える画面はこれから作ります。')
                return
              }
              onChangeSlot(detail)
            }}
            onCancelReservation={() => {
              if (detail === null) return
              setNotice(null)
              setStep('cancel')
            }}
            onOpenCustomers={onOpenCustomers}
            onStartBooking={onStartBooking}
            onRetry={() => setReload((count) => count + 1)}
          />
        ) : step === 'datetime' && detail !== null ? (
          <ChangeDateTime
            storeId={storeId}
            reservationId={detail.id}
            target={{
              code: detail.code,
              startsAt: detail.startsAt,
              endsAt: detail.endsAt,
              durationMinutes: detail.durationMinutes,
              customerName: detail.customerName ?? null,
              visitCount: detail.visitCount ?? null,
              purposeLabel: detail.purposeLabelInternal,
              staffName,
              equipmentNames,
            }}
            now={clock}
            chosenStartsAt={chosenStartsAt}
            onChoose={setChosenStartsAt}
            holdExpiresAt={hold?.expiresAt ?? null}
            renewalsUsed={renewals}
            onKeepEditing={() => {
              // 延長の API は作らない。返して打ち直す 2 本で取り直す。
              setRenewals((count) => count + 1)
              releaseHold()
              if (chosenStartsAt !== null) takeHold(chosenStartsAt, detail.durationMinutes)
            }}
            onBack={backToSearch}
            onNext={() => setStep('diff')}
          />
        ) : step === 'diff' && before !== null && after !== null && detail !== null ? (
          <ChangeDiff
            source={detail.source}
            before={before}
            after={after}
            confirming={confirming}
            error={confirmError}
            slotTaken={slotTaken}
            onReselect={(choice) => {
              setSlotTaken(null)
              setChosenStartsAt(choice.startsAt)
              setStep('datetime')
            }}
            onBack={() => {
              setSlotTaken(null)
              setStep('datetime')
            }}
            onConfirm={() => {
              confirm().catch(() =>
                setConfirmError('うまく処理できませんでした。伺った内容は残っています。'),
              )
            }}
            isOffline={isOffline}
          />
        ) : (
          <p className="px-11 py-9 text-body text-ink-muted">読み込んでいます…</p>
        )}
      </div>
    </div>
  )
}
