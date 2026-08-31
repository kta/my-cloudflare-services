import type {
  Equipment,
  LedgerAxis,
  LedgerFilter,
  LedgerView,
  LedgerViewMode,
  LocalDate,
  ReservationDetail as ReservationDetailShape,
  StaffMember,
  VisitPurpose,
} from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { cn, focusRing, focusRingOnPine } from '@app/ui'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { client } from '../client'
import { WalkinPanel } from '../reception/WalkinPanel'
import { dateLabel, nowChipLabel, shiftDate } from './metrics'
import { OfflineBanner } from './OfflineBanner'
import { ReservationDetail, type ReservationDetailPhase } from './ReservationDetail'
import { ReservationList } from './ReservationList'
import { Timetable } from './Timetable'

/*
 * 予約台帳の器（承認済みモック docs/frontend/mockups/eyex/images/LEDGER-STAFF.png）。
 *
 * 実測（LEDGER-STAFF.html と assets/eyex.css）:
 *   日付の帯   = ‹ ／ 2026年8月27日（木） ／ 本日 ／ ›（上のバーの中央のピル）
 *   ツールバー = セグメント 2 つ（`.segmented` padding 3px・ボタン padding 0 16px）
 *   現在の札   = `.nowchip` min-height 32px・padding 0 12px・ピル・--alert の枠と文字
 *
 * **並べ方（axis）と表示のかたち（view）は別の指定**で、4 通りすべてが有効な組み合わせ。
 * 1 つのセグメントにまとめると、予約リストへ切り替えたときに設備・場所の並べ方が失われる。
 *
 * 現在時刻は**応答の `serverNow` だけ**から出す。端末の時計は「最初にどの日を尋ねるか」の
 * 初期値にしか使わない（iPad の時計がずれた日に台帳が黙って嘘をつかないため）。
 *
 * 台帳の上に開く 1 件の詳細（`ReservationDetail`）と、書けなくなったことを伝える帯
 * （`OfflineBanner`）はこの器が繋ぐ。**詳細はモーダルにしない** —— 後ろの台帳は
 * 見えたままで、押した帯の左端へ矢印が刺さる（AC-LEDGER-15 / 19）。
 */

/** 詳細の矢印は面の左 40px にある。まだ帯を押していないときの置き場所に使う。 */
const ARROW_LEFT_PX = 40
/** 帯の下端から詳細の頭までの隙間。 */
const POPOVER_GAP_PX = 8
/**
 * 台帳を丸ごと取り直す間隔（`design/07-nfr.md` §4.4 の 60 秒）。
 *
 * **現在時刻の線と札を動かす手立てはこれだけである。** 線も札も応答の `serverNow` から
 * しか出さないので、端末の時計で数え直すと AC-LEDGER-03 の「端末の時計を 1 時間進めても
 * 線は動かない」が壊れる。取り直しは通信が切れている間の自動再試行も兼ねる。
 */
const RELOAD_INTERVAL_MS = 60_000

export type LedgerScreenProps = {
  storeId: string
  /** 最初に開く日。省かれたら端末の時計の JST 暦日を初手に使う。 */
  initialDate?: LocalDate
  /** 最初から開いておくご予約（個人トップの 1 行から来たとき）。 */
  initialReservationId?: string
  /** 来店受付ボードの「＋ ご来店を受け付ける」から来たとき、受付パネルを開いた姿で出す。 */
  initialWalkinOpen?: boolean
  /** 予約リストの差し替え口。省くと `ReservationList` をそのまま出す。 */
  renderList?: (view: LedgerView) => ReactNode
  /**
   * 日付の帯を上のバーの中央へ差し込む口（`AppShell` の `barCenter`）。
   * モックはこの帯を緑のバーの中央に置く。省いたときは台帳の先頭に緑の帯として自分で出す。
   */
  onBarCenter?: (bar: ReactNode) => void
  /** 設備が 1 台も無い店舗の空の面から「設定を開く」で行く先（IDX-LEDGER-02 の E1）。 */
  onOpenSettings?: () => void
  /**
   * 予約リストの「ご来店」を押したとき。ご予約のお客様を受け付ける入口はここ 1 つで、
   * 器（`App`）が来店受付の面をその 1 件で開く。
   */
  onOpenCheckin?: (reservationId: string) => void
  /**
   * 業務の期限が切れた（401）とき。台帳を開いたまま切れると、そのままでは
   * 通信断の帯が出て「再接続を試す」を押し続ける行き止まりになるので、外へ知らせる。
   */
  onSessionExpired?: () => void
}

export function LedgerScreen({
  storeId,
  initialDate,
  initialReservationId,
  initialWalkinOpen = false,
  renderList,
  onBarCenter,
  onOpenSettings,
  onOpenCheckin,
  onSessionExpired,
}: LedgerScreenProps) {
  const [date, setDate] = useState<LocalDate>(() => initialDate ?? toJstDateString(new Date()))
  const [axis, setAxis] = useState<LedgerAxis>('staff')
  const [mode, setMode] = useState<LedgerViewMode>('timetable')
  // 絞り込みは画面の中だけで効かせる。応答の `counts` は 3 つとも載るので取り直さない。
  const [filter, setFilter] = useState<LedgerFilter>('all')
  const [data, setData] = useState<LedgerView | null>(null)
  // 読めなかった理由。通信が落ちた（`error`）のと、この店舗を見る権限が無い（`forbidden`）のは
  // 次の一手が違う（前者はやり直せる、後者はやり直しても同じ）。
  // 読めなかった理由。通信が落ちた（`error`）／この店舗を見る権限が無い（`forbidden`）／
  // 業務の期限が切れた（`expired`）は次の一手がそれぞれ違う。
  const [failed, setFailed] = useState<null | 'error' | 'forbidden' | 'expired'>(null)
  const [reload, setReload] = useState(0)
  // 取り直しが飛んでいる間。通信断の帯の「つなぎ直しています…」がこれを読む。
  const [retrying, setRetrying] = useState(false)
  // 通信が切れてから自動で試した回数。0 に戻るのは読めたときだけで、
  // 次に試す時刻（最後に読めた `serverNow` ＋ 60 秒 × 回数）の出どころになる。
  const [autoRound, setAutoRound] = useState(0)
  // 開いているご予約。台帳の帯を押すと入り、閉じる 3 つの道のどれでも null に戻る。
  const [openId, setOpenId] = useState<string | null>(initialReservationId ?? null)
  const [detail, setDetail] = useState<ReservationDetailShape | null>(null)
  const [detailPhase, setDetailPhase] = useState<ReservationDetailPhase>('loading')
  const [anchor, setAnchor] = useState({ left: ARROW_LEFT_PX, top: 0, bandTop: 0 })
  /*
   * 店頭のお客様の受付パネル（LEDGER-WALKIN）。台帳の上に右 400px で重ねる。
   * **入口は来店受付ボードの「＋ ご来店を受け付ける」だけ**にしてある（台帳の
   * ツールバーにボタンを足すと、承認済みの LEDGER-STAFF / LEDGER-LIST の姿が変わる）。
   */
  const [walkinOpen, setWalkinOpen] = useState(initialWalkinOpen)
  const [purposes, setPurposes] = useState<readonly VisitPurpose[]>([])
  // 担当と場所のお名前。詳細は id しか持たないので、店舗の名簿と突き合わせる。
  const [staffNames, setStaffNames] = useState<Map<string, string>>(() => new Map())
  const [placeNames, setPlaceNames] = useState<Map<string, string>>(() => new Map())
  const stageRef = useRef<HTMLDivElement>(null)

  // ご用件の 4 択（受付パネル）。店舗 1 つにつき 1 度だけ読む。
  useEffect(() => {
    let live = true
    client.api.staff.purposes
      .$get({ query: { storeId } })
      .then(async (res) => {
        if (!live || !res.ok) return
        const rows: VisitPurpose[] = await res.json()
        if (live) setPurposes(rows)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [storeId])

  /**
   * 読めなかった事実は**読めたときにだけ**消す。取り直しの入り口で消すと、通信断の帯が
   * 試している最中だけ消えてしまい、「つなぎ直しています…」を出す場所が無くなる。
   */
  const load = useCallback(async () => {
    setRetrying(true)
    try {
      const res = await client.api.staff.ledger.$get({
        query: { storeId, date, axis, view: mode, filter: 'all' },
      })
      const status: number = res.status
      if (status === 401) {
        // 期限が切れた業務は、やり直しても同じ 401 になる。通信断のふりをして
        // 「再接続を試す」を押させ続けない。
        setFailed('expired')
        onSessionExpired?.()
        return
      }
      if (!res.ok) {
        setFailed(status === 403 ? 'forbidden' : 'error')
        return
      }
      setData(await res.json())
      setFailed(null)
      setAutoRound(0)
    } finally {
      setRetrying(false)
    }
  }, [storeId, date, axis, mode, onSessionExpired])

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

  // 60 秒ごとに取り直す。開いたままの iPad の線と札が朝の時刻で止まらないための唯一の
  // 手立てであり、通信が切れている間はそのまま自動再試行になる（UC-LEDGER-09 主フロー 3）。
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
    async function read() {
      const [staffRes, placeRes] = await Promise.all([
        client.api.staff.stores[':storeId'].staff.$get({ param: { storeId } }),
        client.api.staff.stores[':storeId'].equipment.$get({ param: { storeId } }),
      ])
      if (!live) return
      if (staffRes.ok) {
        const rows: StaffMember[] = await staffRes.json()
        setStaffNames(new Map(rows.map((row) => [row.id, row.displayName])))
      }
      if (placeRes.ok) {
        const rows: Equipment[] = await placeRes.json()
        setPlaceNames(new Map(rows.map((row) => [row.id, row.name])))
      }
    }
    // 名簿が読めなくても台帳は読める。落ちても詳細のお名前が出ないだけにする。
    read().catch(() => undefined)
    return () => {
      live = false
    }
  }, [storeId])

  // 開いた 1 件を読む。無い id・他テナントの id は 404 で、403 と取り違えない。
  useEffect(() => {
    if (openId === null) {
      setDetail(null)
      return
    }
    let live = true
    setDetail(null)
    setDetailPhase('loading')
    async function read(reservationId: string) {
      const res = await client.api.staff.reservations[':reservationId'].$get({
        param: { reservationId },
      })
      if (!live) return
      const status: number = res.status
      if (status === 404) {
        setDetailPhase('not_found')
        return
      }
      if (status === 403) {
        setDetailPhase('forbidden')
        return
      }
      if (!res.ok) {
        setDetailPhase('error')
        return
      }
      setDetail(await res.json())
      setDetailPhase('ready')
    }
    read(openId).catch(() => {
      if (live) setDetailPhase('error')
    })
    return () => {
      live = false
    }
  }, [openId])

  // 通信が切れたら、最後に読めた台帳をそのまま出し続ける（読むことは続けられる）。
  // 操作の状態もその日・その並べ方へ戻し、届いていない日を出しているふりをしない。
  // 権限が無い・期限が切れたのに古い台帳を出し続けない。通信断だけが
  // 「読めたものをそのまま残す」。
  const offline = failed === 'error' && data !== null
  useEffect(() => {
    if (!offline || data === null) return
    setDate(data.date)
    setAxis(data.axis)
    // 通信が切れたら時間順のリストへ寄せる（AC-LEDGER-18・IDX-LEDGER-09 主フロー 4）。
    // ただしリストは**担当の行からしか**組み立てられないので、最後に読めたのが
    // 設備・場所のタイムテーブルだったときだけはそのまま残す（設備の行を平坦化しても
    // 「担当」の欄が 1 つも埋まらず、同じご予約が台数ぶん並んでしまう）。
    setMode(data.view === 'list' || data.axis === 'staff' ? 'list' : 'timetable')
  }, [offline, data])

  // 尋ねた日・並べ方・かたちと届いた応答が食い違っている間は、古い台帳を出さない。
  const fresh =
    data !== null && data.date === date && data.axis === axis && data.view === mode ? data : null
  const shown = offline ? data : fresh
  // 「本日」の行き先も本日かどうかの判定も、応答の `serverNow` から出す。
  const today = data === null ? date : toJstDateString(new Date(data.serverNow))
  // 通信が切れている間は「現在 11:08」を出さない。届いていない以上いま何時かは分からず、
  // 同じ時刻が帯の「11:08 現在のものです」と 2 つの意味で並ぶ（モック EX-OFFLINE も出さない）。
  const chip = shown === null || offline ? null : nowChipLabel(date, shown.serverNow)

  useEffect(() => {
    if (onBarCenter === undefined) return
    onBarCenter(<DateBar date={date} today={today} onPick={setDate} />)
    return () => onBarCenter(null)
  }, [onBarCenter, date, today])

  // 詳細は押した帯の左端へ矢印を刺す。台帳を隠さないので、器の中の座標で置く。
  useEffect(() => {
    if (openId === null) return
    const stage = stageRef.current
    const cell = stage?.querySelector<HTMLElement>('[data-ledger-cell][aria-selected="true"]')
    if (!stage || !cell) return
    const band = cell.getBoundingClientRect()
    const box = stage.getBoundingClientRect()
    setAnchor({
      // 矢印を合わせる先は帯の左端そのもの。詳細はそこから 40px 左へ出る
      //（足してから引くと打ち消し合って、詳細が帯の左端から始まってしまう）。
      left: band.left - box.left,
      top: band.bottom - box.top + POPOVER_GAP_PX,
      // 下に入らないときに帯の上へ返せるよう、帯の上端も渡す（詳細が自分で収める）。
      bandTop: band.top - box.top,
    })
  }, [openId])

  const staffAssignment = detail?.assignments.find((row) => row.kind === 'staff')
  const staffName =
    staffAssignment?.targetId == null ? null : (staffNames.get(staffAssignment.targetId) ?? null)
  const equipmentNames =
    detail?.assignments
      .filter((row) => row.kind === 'equipment' && row.targetId !== null)
      .map((row) => placeNames.get(row.targetId ?? '') ?? '')
      .filter((name) => name !== '') ?? []

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* 上のバーへ差し込む口が無い器（テストや単体での確認）では、緑の帯を自分で出す。 */}
      {onBarCenter === undefined && (
        <div className="flex shrink-0 items-center bg-pine px-4 py-2 text-on-pine">
          <DateBar date={date} today={today} onPick={setDate} />
        </div>
      )}

      <div className="flex h-14 shrink-0 items-center gap-2.5 border-b border-line bg-surface px-4">
        <Segmented
          label="台帳の並べ方"
          options={[
            { key: 'staff', label: '担当者' },
            { key: 'resource', label: '設備・場所' },
          ]}
          current={axis}
          onPick={(key) => setAxis(key as LedgerAxis)}
        />
        <Segmented
          label="表示のかたち"
          options={[
            { key: 'timetable', label: 'タイムテーブル' },
            { key: 'list', label: '予約リスト' },
          ]}
          current={mode}
          onPick={(key) => setMode(key as LedgerViewMode)}
        />
        {chip !== null && (
          <p
            role="status"
            className="ml-auto flex min-h-8 items-center gap-2 rounded-full border border-danger bg-danger-soft px-3 text-grid font-semibold text-danger"
          >
            <span aria-hidden="true" className="h-4 w-0.75 rounded-full bg-danger" />
            {chip}
          </p>
        )}
      </div>

      {offline && data !== null && (
        <OfflineBanner
          lastServerNow={data.serverNow}
          nextRetryAt={new Date(
            Date.parse(data.serverNow) + RELOAD_INTERVAL_MS * (autoRound + 1),
          ).toISOString()}
          isRetrying={retrying}
          onRetry={() => setReload((count) => count + 1)}
        />
      )}

      {failed === 'expired' ? (
        <div role="alert" className="grid flex-1 content-center justify-items-start gap-3 p-11">
          <p className="text-title font-bold text-ink">業務の時間が切れました。</p>
          <p className="text-body text-ink-muted">
            お店のコードを入れて、もう一度業務を始めてください。
          </p>
        </div>
      ) : failed === 'forbidden' ? (
        <div role="alert" className="grid flex-1 content-center justify-items-start gap-3 p-11">
          <p className="text-title font-bold text-ink">
            このお店の予約台帳を見る権限がありません。
          </p>
          {/* やり直しても結果は同じなので、やり直す道を出さない。 */}
          <p className="text-body text-ink-muted">お店の管理者にご確認ください。</p>
        </div>
      ) : failed !== null && data === null ? (
        <div role="alert" className="grid flex-1 content-center justify-items-start gap-3 p-11">
          <p className="text-title font-bold text-ink">
            台帳を読み込めませんでした。もう一度お試しください。
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
      ) : shown === null ? (
        <p role="status" className="p-11 text-body text-ink-muted">
          読み込んでいます…
        </p>
      ) : (
        /*
         * 受付パネルを閉じたときの戻り先。パネルは**来店受付ボードから**開くので、
         * この面に「開いた要素」が無い —— それでも焦点を body へ落とさず、台帳そのものへ返す
         * （次の Tab が文書の先頭からやり直しにならない）。見た目は変わらない。
         */
        <div ref={stageRef} tabIndex={-1} className="relative flex min-h-0 flex-1 flex-col">
          {mode === 'list' ? (
            (renderList?.(shown) ?? (
              <ReservationList
                view={shown}
                filter={filter}
                onFilterChange={setFilter}
                isOffline={offline}
                {...(onOpenCheckin === undefined ? {} : { onCheckin: onOpenCheckin })}
              />
            ))
          ) : (
            <Timetable
              view={shown}
              selectedReservationId={openId}
              onSelectEntry={(entry) => setOpenId(entry === null ? null : entry.reservationId)}
              onOpenSettings={onOpenSettings}
            />
          )}
          {walkinOpen && (
            <WalkinPanel
              storeId={storeId}
              purposes={purposes}
              walkinWaitingCount={shown.walkinWaitingCount}
              estimatedWaitMinutes={shown.estimatedWaitMinutes}
              nextTicketNo={shown.nextTicketNo}
              onReceived={() => {
                setWalkinOpen(false)
                setReload((count) => count + 1)
              }}
              onClose={() => setWalkinOpen(false)}
              returnFocusTo={stageRef}
            />
          )}
          {openId !== null && (
            <ReservationDetail
              detail={detail}
              phase={detailPhase}
              staffName={staffName}
              equipmentNames={equipmentNames}
              anchor={anchor}
              isOffline={offline}
              onClose={() => setOpenId(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 日付の帯（モックの `.datepill`）。緑の面の上に置くので、焦点の輪は白にする。
 * 実測: min-height 44px・gap 12px・padding 0 14px・ピル・地は白 16%・17px 700。
 * 「本日」はモックでは印だが、AC-LEDGER-04 が押して戻れることを求めるのでボタンにする。
 * 触れる大きさは 44pt 以上（`design/07-nfr.md` §2.1）。
 */
function DateBar({
  date,
  today,
  onPick,
}: {
  date: LocalDate
  today: LocalDate
  onPick: (date: LocalDate) => void
}) {
  return (
    <div className="mx-auto flex min-h-11 items-center gap-3 rounded-full bg-on-pine/16 px-3.5">
      <StepButton label="前の日" glyph="‹" onPress={() => onPick(shiftDate(date, -1))} />
      <p className="text-center text-lead font-bold">{dateLabel(date)}</p>
      <button
        type="button"
        onClick={() => onPick(today)}
        aria-pressed={date === today}
        className={cn(
          'min-h-11 rounded-ctl px-2.5 text-grid font-semibold',
          date === today ? 'bg-on-pine text-pine' : 'bg-on-pine/16 text-on-pine',
          focusRingOnPine,
        )}
      >
        本日
      </button>
      <StepButton label="次の日" glyph="›" onPress={() => onPick(shiftDate(date, 1))} />
    </div>
  )
}

function StepButton({
  label,
  glyph,
  onPress,
}: {
  label: string
  glyph: string
  onPress: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className={cn(
        'min-h-11 min-w-11 rounded-full text-title font-bold text-on-pine',
        focusRingOnPine,
      )}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  )
}

/** モックの `.segmented`。触れる大きさだけはモックの 38px でなく 44pt に上げる。 */
function Segmented({
  label,
  options,
  current,
  onPick,
}: {
  label: string
  options: readonly { key: string; label: string }[]
  current: string
  onPick: (key: string) => void
}) {
  return (
    <fieldset aria-label={label} className="flex gap-0.5 rounded-ctl bg-surface-2 p-0.5">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={current === option.key}
          onClick={() => onPick(option.key)}
          className={cn(
            'min-h-11 rounded-ctl px-4 text-grid font-semibold',
            current === option.key
              ? 'bg-surface text-pine ring-1 ring-line'
              : 'bg-transparent text-ink-muted',
            focusRing,
          )}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  )
}
