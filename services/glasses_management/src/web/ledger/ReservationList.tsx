import type { LedgerFilter, LedgerView } from '@app/contracts'
import { focusRing } from '@app/ui'
import { filterLedgerRows, type LedgerListRow, SOURCE_LABELS } from '../../worker/domain/ledger'
import { jstClock } from './metrics'

/*
 * 予約リスト（承認済みモック docs/frontend/mockups/eye/images/LEDGER-LIST.png）。
 *
 * 同じ日を時間順に読み、次に何をすべきかを左端の 1 列だけで進める面。
 * **押せるのは左端の 1 列と絞り込みの札だけで、ほかは読むだけである。**
 * 白い箱を並べず、罫線だけで区切る。
 *
 * 実測値（screens/LEDGER-LIST.html と assets/eye.css）:
 *   絞り込みの帯 = 高さ 60px・padding 0 32px・地 --surface-2、札 = min-height 44px・
 *   padding 0 16px・ピル（選択中は 2px の --brand ＋ 地 --brand-tint）。
 *   列幅 = 120px / 96px / 224px / 1fr / 140px・gap 16px。行 = min-height 62px・下罫 1px。
 *   時刻 18px 等幅 700（トークンの最寄りは 17px の text-lead）、ほか 15px（同 16px の text-body）。
 *   左端のボタン = min-height 46px・角 8px。通信断のときは 4 列（112px / 250px / 1fr / 140px）。
 *   出どころの語は「受け付け」欄でボタンの**右**に置く（AC-LEDGER-12 が要る語を、
 *   モックの 62px の行を保ったまま入れる唯一の置き方。縦に積むと 90px になる）。
 *
 * この面が描かないもの（P2 の範囲）:
 * - お客様のお名前と来店回数（`customers` は 007-customer-records）。「—」だけを置く
 * - 左端のボタンの行き先（来店受付は 008、変更・取消は 009）。押せる形で置くだけ
 *
 * 件数は応答の `counts` をそのまま出す。画面で数え直すと、札の数字と行数のどちらが
 * 正しいのか画面から判断できなくなる。
 */

/** 一覧に出す行の上限。9 行目からは末尾の 1 行にまとめる（引き算の決め）。 */
const MAX_ROWS = 8

const FILTERS: readonly LedgerFilter[] = ['all', 'upcoming', 'pending']

const FILTER_LABELS: Record<LedgerFilter, string> = {
  all: 'すべて',
  upcoming: 'これから',
  pending: '確認待ち',
}

type ReservationListPhase = 'loading' | 'ready' | 'error' | 'forbidden'

export type ReservationListProps = {
  /** 台帳の応答。読み込み中・読み込めなかったときは null。 */
  view: LedgerView | null
  filter: LedgerFilter
  onFilterChange: (filter: LedgerFilter) => void
  /** 省略時は `view` の有無から決める（null なら読み込み中）。 */
  phase?: ReservationListPhase
  /** 通信断のとき。「受け付け」の列ごと落とし、書き込みの操作を出さない。 */
  isOffline?: boolean
  /**
   * 「ご来店」を押したとき。ご予約のお客様を受け付ける入口は**この 1 つ**である ——
   * 来店受付ボードに載るのは「もうお着きの方」だけなので、まだお着きでないご予約は
   * 盤面から探せない（`worker/domain/visit-board.ts` の `isPresent`）。
   * 渡さなければ語だけの置き物になる（`005` が先に描いたときの姿）。
   */
  onCheckin?: (reservationId: string) => void
  /**
   * 「内容を確認」を押したとき。Web から入って**担当がまだ空**のご予約が確認待ちで、
   * 受信日の 24:00 JST を越えると日次 Cron が黙って取り消す（お客様へメールは送らない）。
   * 押しても何も起きない札を置いておくと、その黙った取消がそのまま起きる（UX 監査 NEW-05）。
   */
  onReview?: (reservationId: string) => void
}

/** 行から始められる次の操作。行き先は 008 / 009 が作るので、ここでは語と形だけを決める。 */
type RowAction = {
  label: string
  /** 押せない行（受け付けが済んだ行・ご来店の無かった行）は文字だけを置く。 */
  pressable: boolean
  tone: 'pine' | 'walkin' | 'web'
  /** 行き先。`checkin` だけがこのフェーズ（008）の持ち場である。 */
  kind: 'checkin' | 'guide' | 'review'
}

const TONE_CLASS: Record<RowAction['tone'], string> = {
  pine: 'border-line-strong bg-surface text-ink',
  walkin: 'border-walkin bg-walkin-soft text-walkin',
  web: 'border-web bg-web-soft text-web',
}

function actionOf(row: LedgerListRow): RowAction | null {
  // 受け付けが済んだご予約に押し直す導線はモックに無い。押し間違いは取り消して受け直す。
  if (row.status === 'arrived' || row.status === 'serving' || row.status === 'done') return null
  if (row.status === 'no_show') return null
  if (row.source === 'walkin')
    return { label: 'ご案内', pressable: true, tone: 'walkin', kind: 'guide' }
  // Web から入って担当がまだ決まっていないご予約が「確認待ち」の中身になる。
  if (row.source === 'web' && row.isUnassigned)
    return { label: '内容を確認', pressable: true, tone: 'web', kind: 'review' }
  return { label: 'ご来店', pressable: true, tone: 'pine', kind: 'checkin' }
}

/** 押せない行に置く事実の語。 */
function factOf(row: LedgerListRow): string | null {
  if (row.status === 'no_show') return 'ご来店なし'
  if (row.status === 'arrived' || row.status === 'serving' || row.status === 'done')
    return '受付済み'
  return null
}

/** 台帳の応答（担当軸の行）を時刻順に平坦化する。並べ方は `buildLedgerRows` と同じ。 */
function rowsOf(view: LedgerView): LedgerListRow[] {
  return view.lanes
    .filter((lane) => lane.kind !== 'walkin')
    .flatMap((lane, laneIndex) =>
      lane.entries.map((entry) => ({
        laneIndex,
        row: {
          reservationId: entry.reservationId,
          startsAt: entry.startsAt,
          endsAt: entry.endsAt,
          purposeLabel: entry.purposeLabel,
          source: entry.source,
          status: entry.status,
          staffName: lane.kind === 'staff' ? lane.name : null,
          isUnassigned: entry.isUnassigned,
        },
      })),
    )
    .sort((a, b) =>
      a.row.startsAt === b.row.startsAt
        ? a.laneIndex - b.laneIndex
        : a.row.startsAt < b.row.startsAt
          ? -1
          : 1,
    )
    .map((item) => item.row)
}

function minutesOf(row: LedgerListRow): number {
  return Math.round((Date.parse(row.endsAt) - Date.parse(row.startsAt)) / 60_000)
}

/** 0 件の絞り込みは行き止まりにしない。見出し 1 行＋なぜ 0 件かの 1 行＋緩める操作 1 つ。 */
function emptyCopy(filter: LedgerFilter, serverNow: string): { heading: string; reason: string } {
  if (filter === 'pending')
    return {
      heading: '「確認待ち」のご予約はありません。',
      reason: 'Webから入って、担当がまだ決まっていないご予約だけを出しています。',
    }
  if (filter === 'upcoming')
    return {
      heading: '「これから」のご予約はありません。',
      reason: `${jstClock(serverNow)} より後に始まるご予約だけを出しています。`,
    }
  return {
    heading: '本日のご予約はまだありません。',
    reason: 'この日はまだ 1 件も入っていません。',
  }
}

export function ReservationList({
  view,
  filter,
  onFilterChange,
  phase,
  isOffline = false,
  onCheckin,
  onReview,
}: ReservationListProps) {
  const state = phase ?? (view === null ? 'loading' : 'ready')

  if (state === 'error')
    return (
      <p role="alert" className="px-8 py-6 text-body text-ink-muted">
        予約リストを読み込めませんでした。画面を開き直してください。
      </p>
    )
  if (state === 'forbidden')
    return (
      <p role="alert" className="px-8 py-6 text-body text-ink-muted">
        このお店の予約台帳を見る権限がありません。お店の管理者にご確認ください。
      </p>
    )
  if (state === 'loading' || view === null)
    return (
      <p role="status" className="px-8 py-6 text-body text-ink-muted">
        予約リストを読み込んでいます…
      </p>
    )

  const all = rowsOf(view)
  const rows = filterLedgerRows(all, filter, new Date(view.serverNow))
  const shown = rows.slice(0, MAX_ROWS)
  const hidden = rows.slice(MAX_ROWS)
  const nextHidden = hidden[0]
  const counts: Record<LedgerFilter, number> = {
    all: view.counts.all,
    upcoming: view.counts.upcoming,
    pending: view.counts.pendingReview,
  }
  const empty = emptyCopy(filter, view.serverNow)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <fieldset
        aria-label="表示する予約の絞り込み"
        className="flex h-15 min-w-0 flex-none items-center gap-2.5 border-line border-b bg-surface-2 px-8"
      >
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={key === filter}
            // 読み上げでも「すべて 12件」と続けて読ませる（子要素の間に空白が入らないため）。
            aria-label={`${FILTER_LABELS[key]} ${counts[key]}件`}
            onClick={() => onFilterChange(key)}
            className={`min-h-11 rounded-full px-4 text-body font-semibold ${focusRing} ${
              key === filter
                ? 'border-2 border-pine bg-pine-soft text-pine-deep'
                : 'border border-line-strong bg-surface text-ink'
            }`}
          >
            {FILTER_LABELS[key]}
            <span className="font-normal">{` ${counts[key]}件`}</span>
          </button>
        ))}
      </fieldset>

      <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6.5">
        {shown.length === 0 ? (
          <div className="max-w-2xl">
            <h2 className="text-title font-bold text-ink">{empty.heading}</h2>
            <p className="mt-2 text-body text-ink-muted">{empty.reason}</p>
            {filter !== 'all' && (
              <button
                type="button"
                onClick={() => onFilterChange('all')}
                className={`mt-5 min-h-11.5 rounded-ctl border border-line-strong bg-surface px-4 text-body font-semibold text-ink ${focusRing}`}
              >
                すべてを見る
              </button>
            )}
          </div>
        ) : (
          <>
            <table aria-label="本日のご予約" className="w-full border-collapse text-left">
              <thead>
                <tr className="border-line border-b">
                  {!isOffline && (
                    <th scope="col" className="w-30 pb-2.5 text-grid font-normal text-ink-muted">
                      受け付け
                    </th>
                  )}
                  <th
                    scope="col"
                    className={`${isOffline ? 'w-28' : 'w-24'} pb-2.5 text-grid font-normal text-ink-muted`}
                  >
                    時間
                  </th>
                  <th
                    scope="col"
                    className={`${isOffline ? 'w-62.5' : 'w-56'} pb-2.5 text-grid font-normal text-ink-muted`}
                  >
                    お客様
                  </th>
                  <th scope="col" className="pb-2.5 text-grid font-normal text-ink-muted">
                    ご用件
                  </th>
                  <th scope="col" className="w-35 pb-2.5 text-grid font-normal text-ink-muted">
                    担当
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const action = actionOf(row)
                  const fact = factOf(row)
                  return (
                    /*
                       行に予約 id を残す。並走するテストが同じ暦日・同じ時刻に別の
                       ご予約を足すことがあり、時刻とお名前だけでは「この 1 件」を
                       指せない（台帳の帯が `data-ledger-cell` を持っているのと同じ理由）。
                    */
                    <tr
                      key={row.reservationId}
                      data-reservation-id={row.reservationId}
                      className="h-15.5 border-line border-b"
                    >
                      {!isOffline && (
                        /* 次の操作と出どころの語を**横に**並べる。縦へ積むと 1 行が 90px 近くなり、
                           8 行目と末尾の「このあと …」が iPad の高さに収まらなくなる
                           （モックの行は 62px）。語は幅の余りで折り返させ、切らない。 */
                        <td className="py-1 pr-4 align-middle">
                          <span className="flex items-center gap-1.5">
                            {action !== null && (
                              <button
                                type="button"
                                {...(action.kind === 'checkin' && onCheckin !== undefined
                                  ? { onClick: () => onCheckin(row.reservationId) }
                                  : action.kind === 'review' && onReview !== undefined
                                    ? { onClick: () => onReview(row.reservationId) }
                                    : {})}
                                className={`min-h-11.5 shrink-0 rounded-ctl border px-2 text-note font-semibold ${TONE_CLASS[action.tone]} ${focusRing}`}
                              >
                                {action.label}
                              </button>
                            )}
                            {fact !== null && (
                              <span className="shrink-0 text-note text-ink-muted">{fact}</span>
                            )}
                            <span className="min-w-0 text-fine text-ink-muted">
                              {SOURCE_LABELS[row.source]}
                            </span>
                          </span>
                        </td>
                      )}
                      <td className="py-2.5 pr-4 align-middle">
                        <span className="font-mono text-lead font-bold text-ink">
                          {jstClock(row.startsAt)}
                        </span>
                        <span className="block text-note text-ink-muted">{`${minutesOf(row)}分`}</span>
                      </td>
                      <td className="py-2.5 pr-4 align-middle text-body text-ink">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">お名前はまだ出せません</span>
                        {isOffline && (
                          <span className="block text-note text-ink-muted">
                            {SOURCE_LABELS[row.source]}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 align-middle text-body text-ink-muted">
                        {row.purposeLabel}
                      </td>
                      <td
                        className={`py-2.5 align-middle text-body ${
                          row.staffName === null ? 'text-ink-faint' : 'text-ink-muted'
                        }`}
                      >
                        {row.staffName ?? '決めてください'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {nextHidden !== undefined && (
              <p className="mt-6 text-grid text-ink-muted">
                {`このあと ${jstClock(nextHidden.startsAt)} ほか ${hidden.length}件。`}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
