import type {
  CustomerDetail,
  LocalDate,
  ReservationDetail,
  StaffMember,
  VisitBoardCell,
  VisitBoardRow,
  VisitBoard as VisitBoardShape,
} from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { cn, focusRing, UndoBar } from '@app/ui'
import { useCallback, useEffect, useState } from 'react'
import { BOARD_STAGES } from '../../worker/domain/visit-board'
import { client } from '../client'
import { currentPowerLabel, pdLabel } from '../customers/CustomerList'
import { OfflineBanner } from '../ledger/OfflineBanner'
import { type CheckinLastVisit, CheckinPanel, type CheckinSubject } from './CheckinPanel'
import { LinkCustomerPanel } from './LinkCustomerPanel'
import { STAGE_LABELS, VisitBoard } from './VisitBoard'

/*
 * 来店受付の器（承認済みモック docs/frontend/mockups/eyex/images/RECEPTION-JOURNEY.png ／
 * RECEPTION-CHECKIN.png）。
 *
 * **URL による画面の切り替えを持ち込まない**（この製品に router は無い）。行き先は `App` の
 * `current === 'reception'` が決め、この面の中の切り替えは `pane` が持つ
 * （`customers/CustomerScreen.tsx` と同じ決め）。
 *
 * 器の仕事:
 *   1. 盤面を取り、「ご来店中／本日すべて」で取り直す。**60 秒ごとに取り直す** ——
 *      「お待たせ中 18分」は応答の `serverNow` からしか出さないので、取り直さないと
 *      朝の分数のまま止まる（`ledger/LedgerScreen.tsx` と同じ間隔）。
 *   2. 「次にやること」の欄と退店を `POST /api/staff/visits` へ繋ぐ（**追記だけ**）。
 *   3. まだ受け付けていないご予約の行から来店受付の面を開き、そのご予約とお客様を取る。
 *
 * この器が持たないもの: 店頭のお客様の受付パネル（台帳の側。`005` / T-017）と、
 * ご来店がなかったの記録（予約の取消のルートは `009-change-and-cancel` が付ける）。
 */

/** 盤面を取り直す間隔。現在時刻の出どころは応答の `serverNow` だけである。 */
const RELOAD_INTERVAL_MS = 60_000

export type ReceptionScreenProps = {
  storeId: string
  /** 最初に開く日。省かれたら端末の時計の JST 暦日を初手に使う。 */
  initialDate?: LocalDate
  /** 「＋ ご来店を受け付ける」の行き先（店頭の受付パネルは台帳にある）。 */
  onOpenLedger?: () => void
  /**
   * 開いた瞬間から来店受付の面にしておくご予約。台帳の予約リストの「ご来店」から来る
   * （まだお着きでないご予約は盤面に載らないので、入口は台帳の側にある）。
   */
  initialCheckinId?: string
  /** 業務の期限が切れた（401）とき。 */
  onSessionExpired?: () => void
  /** Shell が検知した通信断。書込み操作を先に止める。 */
  isOffline?: boolean
}

export function ReceptionScreen({
  storeId,
  initialDate,
  onOpenLedger,
  initialCheckinId,
  onSessionExpired,
  isOffline: shellOffline = false,
}: ReceptionScreenProps) {
  const [date] = useState<LocalDate>(() => initialDate ?? toJstDateString(new Date()))
  const [scope, setScope] = useState<'active' | 'all'>('active')
  const [board, setBoard] = useState<VisitBoardShape | null>(null)
  const [failed, setFailed] = useState<null | 'error' | 'forbidden' | 'expired'>(null)
  const [reload, setReload] = useState(0)
  // 自動で取り直した回数。通信断の帯が「次にいつ自動で試すか」を出すのに使う。
  const [autoRound, setAutoRound] = useState(0)
  const [retrying, setRetrying] = useState(false)
  const [busy, setBusy] = useState(false)
  // 開いている来店受付の面。null なら盤面。
  const [checkinId, setCheckinId] = useState<string | null>(initialCheckinId ?? null)
  // 受け付ける面から戻ってきた行（盤面がお客様欄へ焦点を返す）。
  const [returnTo, setReturnTo] = useState<string | null>(null)
  // 工程の記録が届かなかったときの 1 文。届いたときは盤面そのものが結果を語る。
  const [notice, setNotice] = useState<string | null>(null)
  // 結びつけを開いている行（お客様を特定しないまま受け付けたウォークイン）。
  const [linking, setLinking] = useState<VisitBoardRow | null>(null)
  const [reservation, setReservation] = useState<ReservationDetail | null>(null)
  const [customer, setCustomer] = useState<CustomerDetail | null>(null)
  const [staffNames, setStaffNames] = useState<Map<string, string>>(() => new Map())

  const load = useCallback(async () => {
    try {
      const res = await client.api.staff.visits.board.$get({ query: { storeId, date, scope } })
      const status: number = res.status
      if (status === 401) {
        // 期限が切れた業務は、やり直しても同じ 401 になる。通信断のふりをして
        // 「再接続を試す」を押させ続けない（台帳 `ledger/LedgerScreen.tsx` と同じ扱い）。
        setFailed('expired')
        onSessionExpired?.()
        return
      }
      if (!res.ok) {
        setFailed(status === 403 ? 'forbidden' : 'error')
        return
      }
      setBoard(await res.json())
      setFailed(null)
      setAutoRound(0)
    } finally {
      setRetrying(false)
    }
  }, [storeId, date, scope, onSessionExpired])

  useEffect(() => {
    let live = true
    load().catch(() => {
      if (live) {
        setFailed('error')
        setRetrying(false)
      }
    })
    return () => {
      live = false
    }
  }, [load, reload])

  useEffect(() => {
    const timer = setInterval(() => {
      setAutoRound((count) => count + 1)
      setReload((count) => count + 1)
    }, RELOAD_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  // 名簿は日付を動かしても変わらないので、店舗 1 つにつき 1 度だけ読む。
  useEffect(() => {
    let live = true
    client.api.staff.stores[':storeId'].staff
      .$get({ param: { storeId } })
      .then(async (res) => {
        if (!live || !res.ok) return
        const rows: StaffMember[] = await res.json()
        setStaffNames(new Map(rows.map((row) => [row.id, row.displayName])))
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [storeId])

  // 来店受付の面を開いたら、そのご予約とお客様を取る。
  useEffect(() => {
    if (checkinId === null) {
      setReservation(null)
      setCustomer(null)
      return
    }
    let live = true
    async function read(reservationId: string) {
      const res = await client.api.staff.reservations[':reservationId'].$get({
        param: { reservationId },
      })
      if (!live || !res.ok) return
      const detail: ReservationDetail = await res.json()
      if (!live) return
      setReservation(detail)
      const customerId = detail.customerId ?? null
      if (customerId === null) return
      const found = await client.api.staff.customers[':customerId'].$get({ param: { customerId } })
      if (!live || !found.ok) return
      setCustomer(await found.json())
    }
    read(checkinId).catch(() => undefined)
    return () => {
      live = false
    }
  }, [checkinId])

  /** 工程を 1 行足す。**追記だけ**なので、どの操作もこの 1 本を通る。 */
  /*
   * 直前に積んだ工程を、数秒だけ戻せるようにしておく（UX 監査 NEW-04）。
   * 押す前に確認を挟むと、1 日に何十回も押す操作が毎回止まる。だから押させてから、
   * **戻す行を 1 本足して**打ち消す（`visit_events` は追記だけで、盤面は
   * 「いまの工程より右は記録があっても空に戻す」ので、前の工程を積み直せば戻る）。
   */
  const [undoable, setUndoable] = useState<{
    row: Pick<VisitBoardRow, 'subjectType' | 'subjectId'>
    back: 'received' | VisitBoardCell['stage']
    message: string
  } | null>(null)

  /**
   * 押す前に立っていた工程。**盤面がいま描いている姿から読む** —— 追記だけの
   * `visit_events` では「1 つ前」をサーバに聞けないので、押した列より左で最後に
   * 済んでいる列を戻り先にする。左に 1 つも無ければ「受付」まで戻す。
   */
  function previousStage(
    row: VisitBoardRow,
    stage: VisitBoardCell['stage'] | 'left',
  ): 'received' | VisitBoardCell['stage'] {
    const target = BOARD_STAGES.indexOf(stage as (typeof BOARD_STAGES)[number])
    const cut = target < 0 ? BOARD_STAGES.length : target
    const done = row.cells.filter(
      (cell) =>
        cell.state !== 'empty' &&
        BOARD_STAGES.indexOf(cell.stage as (typeof BOARD_STAGES)[number]) < cut,
    )
    return done[done.length - 1]?.stage ?? 'received'
  }

  const addVisitEvent = useCallback(
    async (
      row: Pick<VisitBoardRow, 'subjectType' | 'subjectId'>,
      stage: 'received' | 'waiting' | 'left' | VisitBoardCell['stage'],
      note?: string,
    ) => {
      setBusy(true)
      setNotice(null)
      try {
        const res = await client.api.staff.visits.$post({
          json: {
            storeId,
            subjectType: row.subjectType,
            subjectId: row.subjectId,
            stage,
            ...(note === undefined ? {} : { note }),
          },
        })
        if (res.status === 401) {
          setFailed('expired')
          onSessionExpired?.()
          return
        }
        /*
         * 断られたことを黙って飲み込まない。押したのに何も変わらない盤面は、
         * 「押せていない」のか「もう済んでいる」のか手元から見分けられない。
         */
        if (!res.ok) {
          setNotice(
            res.status === 404
              ? 'このご来店は見つかりませんでした。盤面を読み直してください。'
              : '記録できませんでした。もう一度お試しください。',
          )
        }
        setReload((count) => count + 1)
      } finally {
        setBusy(false)
      }
    },
    [storeId, onSessionExpired],
  )

  /** 一度は読めていて、いまの取り直しだけが落ちている（＝通信断）。 */
  const offline = shellOffline || (failed === 'error' && board !== null)

  /*
   * 受け付ける面は**盤面が届いてから**開く。予定時刻との差の 1 行はサーバの `serverNow`
   * だけから出す決めで、届く前に描くと端末の時計で一瞬だけ違う分数を出してしまう。
   */
  if (checkinId !== null && reservation !== null && board !== null) {
    return (
      <CheckinPanel
        subject={checkinSubject(reservation, customer, staffNames)}
        serverNow={board.serverNow}
        attentions={attentionsOf(customer)}
        lastVisit={lastVisitOf(customer)}
        busy={busy}
        isOffline={offline}
        onBack={() => {
          setCheckinId(null)
          setReturnTo(reservation.id)
        }}
        onReceive={(stage, note) => {
          const target = { subjectType: 'reservation' as const, subjectId: reservation.id }
          setCheckinId(null)
          setReturnTo(reservation.id)
          addVisitEvent(target, stage, note).catch(() =>
            setNotice('記録できませんでした。もう一度お試しください。'),
          )
        }}
      />
    )
  }

  if (failed === 'expired') {
    return (
      <div role="alert" className="grid flex-1 content-center justify-items-start gap-3 p-11">
        <p className="text-title font-bold text-ink">業務の時間が切れました。</p>
        <p className="text-body text-ink-muted">
          お店のコードを入れて、もう一度業務を始めてください。
        </p>
      </div>
    )
  }

  if (failed === 'forbidden') {
    return (
      <div role="alert" className="grid flex-1 content-center justify-items-start gap-3 p-11">
        <p className="text-title font-bold text-ink">このお店の来店受付を見る権限がありません。</p>
        {/* やり直しても結果は同じなので、やり直す道を出さない。 */}
        <p className="text-body text-ink-muted">お店の管理者にご確認ください。</p>
      </div>
    )
  }

  if (failed !== null && board === null) {
    return (
      <div role="alert" className="grid flex-1 content-center justify-items-start gap-3 p-11">
        <p className="text-title font-bold text-ink">
          来店受付ボードを読み込めませんでした。もう一度お試しください。
        </p>
        <button
          type="button"
          onClick={() => setReload((count) => count + 1)}
          className={cn(
            'min-h-13 rounded-ctl bg-pine px-6 text-lead font-bold text-on-pine',
            focusRing,
          )}
        >
          もう一度読み込む
        </button>
      </div>
    )
  }

  if (board === null) {
    return (
      <p role="status" className="p-11 text-body text-ink-muted">
        読み込んでいます…
      </p>
    )
  }

  return (
    /* 結びつけのパネルは盤面に重なる（`position: absolute` の受け皿がここに要る）。 */
    /*
      画面の器は `<main>` で、名前を持つ。持たなかったころ、この面には読み上げの
      ランドマークが 1 つも無く、画面を切り替えても「いまどこにいるか」を耳で
      確かめる手がかりが無かった（実装不足の洗い出し foundation-01 / T-011）。
      名前は左の柱の行き先と同じ語にする（2 通りの呼び方を覚えさせない）。
    */
    <main aria-label="来店受付" className="relative flex h-full min-h-0 flex-col">
      {/*
       * 一度読めたあとに取り直せなくなった状態（通信断）。盤面は残したまま、
       * **いつ時点の姿か**と**いま書けないこと**を文字で言う。60 秒ごとの取り直しが
       * そのまま自動再試行になるので、次に試す時刻も出す（台帳と同じ帯を使う）。
       */}
      {offline && !shellOffline && (
        <OfflineBanner
          lastServerNow={board.serverNow}
          nextRetryAt={new Date(
            Date.parse(board.serverNow) + RELOAD_INTERVAL_MS * (autoRound + 1),
          ).toISOString()}
          isRetrying={retrying}
          onRetry={() => {
            setRetrying(true)
            setReload((count) => count + 1)
          }}
        />
      )}
      <VisitBoard
        board={board}
        scope={scope}
        onScopeChange={setScope}
        notice={notice}
        focusSubjectId={returnTo}
        onAdvance={(row, cell) => {
          if (offline) return
          const back = previousStage(row, cell.stage)
          addVisitEvent(row, cell.stage)
            .then(() =>
              setUndoable({
                row,
                back,
                message: `${row.displayName}を「${STAGE_LABELS[cell.stage as (typeof BOARD_STAGES)[number]] ?? cell.stage}」へ進めました。`,
              }),
            )
            .catch(() => setNotice('記録できませんでした。もう一度お試しください。'))
        }}
        onLeave={(row) => {
          if (offline) return
          const back = previousStage(row, 'left')
          addVisitEvent(row, 'left')
            .then(() =>
              setUndoable({ row, back, message: `${row.displayName}のご来店を終えました。` }),
            )
            .catch(() => setNotice('記録できませんでした。もう一度お試しください。'))
        }}
        onOpenCheckin={(row) => {
          setReturnTo(null)
          setCheckinId(row.subjectId)
        }}
        onLinkCustomer={setLinking}
        isOffline={offline}
        {...(onOpenLedger === undefined ? {} : { onReceiveVisit: onOpenLedger })}
      />
      {undoable !== null && (
        <UndoBar
          message={undoable.message}
          onUndo={() => {
            const back = undoable
            setUndoable(null)
            addVisitEvent(back.row, back.back).catch(() =>
              setNotice('元に戻せませんでした。もう一度お試しください。'),
            )
          }}
          onDismiss={() => setUndoable(null)}
        />
      )}
      {linking !== null && (
        <LinkCustomerPanel
          storeId={storeId}
          date={date}
          walkinId={linking.subjectId}
          displayName={linking.displayName}
          onLinked={() => {
            setLinking(null)
            setReload((count) => count + 1)
          }}
          onClose={() => setLinking(null)}
        />
      )}
    </main>
  )
}

/** 受け付ける面の 1 枚のカードに出すもの。担当は名簿と突き合わせて名前にする。 */
function checkinSubject(
  reservation: ReservationDetail,
  customer: CustomerDetail | null,
  staffNames: ReadonlyMap<string, string>,
): CheckinSubject {
  const staff = reservation.assignments.find((row) => row.kind === 'staff')
  const name = customer?.name ?? reservation.customerName ?? null
  return {
    reservationId: reservation.id,
    displayName: name === null ? 'お客様' : `${name} 様`,
    kana: customer?.kana ?? '',
    phone: customer?.phone ?? null,
    visitCount: customer?.visitCount ?? reservation.visitCount ?? null,
    startsAt: reservation.startsAt,
    endsAt: reservation.endsAt,
    purposeLabel: reservation.purposeLabel,
    staffName:
      staff?.targetId == null ? 'あとで決める' : (staffNames.get(staff.targetId) ?? 'あとで決める'),
    isReceived: ['arrived', 'serving', 'done'].includes(reservation.status),
  }
}

/** 注意ごと（`attention` かつ `published`）の 1 行目。申し込み中の下書きは出さない。 */
function attentionsOf(customer: CustomerDetail | null): string[] {
  return (customer?.notes ?? [])
    .filter((note) => note.kind === 'attention' && note.status === 'published')
    .map((note) => (note.body.split('\n')[0] ?? '').trim())
    .filter((body) => body !== '')
}

/** 右の欄。ご来店が 1 度も無いお客様は null（欄ごと「まだありません」に落ちる）。 */
function lastVisitOf(customer: CustomerDetail | null): CheckinLastVisit | null {
  if (customer === null || customer.lastVisitAt === null) return null
  const current = customer.prescriptions.find((row) => row.isCurrent) ?? null
  return {
    visitedOn: customer.lastVisitAt,
    powerLabel: currentPowerLabel(customer.prescriptions),
    pdLabel: current === null ? null : pdLabel(current.pd),
    staffName: customer.frequentStaffName,
    wishNote: customer.memoShort === '' ? null : customer.memoShort,
  }
}
