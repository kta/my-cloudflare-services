import type { LedgerEntry, ReservationStatus, StaffMember } from '@app/contracts'
import { auth, toJstDateString } from '@app/shared'
import { focusRing } from '@app/ui'
import { useEffect, useState } from 'react'
import { client } from '../client'
import { jstClock } from '../ledger/metrics'
import { maskCustomerIdentity } from '../shell/mask'

/*
 * 個人端末のトップに出る「本日わたしが担当するご予約」
 * （承認済みモック docs/frontend/mockups/eye/images/HOME-PERSONAL.png の右の一覧）。
 *
 * 題材: 朝いちばんに自分の持ち場を確かめる 1 枚。読むだけで、押すと台帳のその帯が開く。
 * シグネチャ: **白い箱を並べず、1px の罫線だけで行を分けること。**
 *
 * 実測（HOME-PERSONAL.html）: 見出し 1 行 ＋ 時刻（等幅）・お名前・状態の札・ご用件の
 * 2 行組み、行の間は 1px の罫線。
 *
 * 「わたし」は JWT の `sub` と `staff.adminUserId` を突き合わせて引き当てる
 * （設定の名乗りと同じ道。`SettingsScreen` の `subjectFromToken` と同じ読み方）。
 * **誰にも当たらない端末（＝共有端末）では通常この面を出さない**。自動で伏せた背景に
 * 限り、モックどおり時刻・件数・伏せ字の氏名を出す。担当のご予約が 0 件の日だけ、事実 1 行と
 * なぜ空かの 1 行と「店全体の台帳を見る」を出して行き止まりにしない（AC-LEDGER-21）。
 *
 * この面が描かないもの: お客様のお名前と来店回数（`customers` は `007-customer-records`）。
 */

const STATUS_LABELS: Record<ReservationStatus, string> = {
  confirmed: 'ご予約',
  arrived: '受付済み',
  serving: 'ご案内中',
  done: 'お帰り',
  cancelled: '取り消し',
  no_show: 'ご来店なし',
}

export type MyReservationsProps = {
  storeId: string
  /** 共有端末を伏せた背景では、時刻と件数だけ読める本日の一覧を出す。 */
  showShared?: boolean
  /** 共有セッションでは、JWTの担当者情報にかかわらずロック専用一覧を作る。 */
  sharedTerminal?: boolean
  /** ロック時にだけ使う、PIIを伏せた表示専用snapshot。 */
  onSharedSnapshot?: (snapshot: {
    customerName: string
    customerPhone: string
    time: string
    count: number
  }) => void
  /** 1 行を押したとき。台帳のその帯の詳細を開く。 */
  onOpen: (reservationId: string) => void
  /** 「店全体の台帳を見る」を押したとき。 */
  onOpenLedger: () => void
}

/** JWT の本文から `sub` だけを読む。署名は確かめない（サーバが確かめる）。 */
function subjectFromToken(): string | null {
  const token = auth.getToken()
  if (token === null) return null
  const payload = token.split('.')[1]
  if (payload === undefined) return null
  try {
    const decoded: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
    const sub = (decoded as { sub?: unknown }).sub
    return typeof sub === 'string' ? sub : null
  } catch {
    return null
  }
}

export function MyReservations({
  storeId,
  showShared = false,
  sharedTerminal = false,
  onSharedSnapshot,
  onOpen,
  onOpenLedger,
}: MyReservationsProps) {
  // null は「まだ分からない」。わたしが誰か分からない端末では最後まで null のままで、
  // この面は 1 つも要素を描かない。
  const [rows, setRows] = useState<LedgerEntry[] | null>(null)
  const [shared, setShared] = useState(false)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    let live = true
    async function read() {
      // 最初にどの日を尋ねるかだけは端末の時計を使う。並べ替えも件数も応答から出す。
      const date = toJstDateString(new Date())
      const [staffRes, ledgerRes] = await Promise.all([
        client.api.staff.stores[':storeId'].staff.$get({ param: { storeId } }),
        client.api.staff.ledger.$get({
          query: { storeId, date, axis: 'staff', view: 'list', filter: 'all' },
        }),
      ])
      if (!live || !staffRes.ok || !ledgerRes.ok) return
      const staff: StaffMember[] = await staffRes.json()
      const subject = subjectFromToken()
      const me = subject === null ? undefined : staff.find((row) => row.adminUserId === subject)
      const view = await ledgerRes.json()
      if (!live) return
      if (sharedTerminal || me === undefined) {
        const unique = new Map<string, LedgerEntry>()
        for (const lane of view.lanes) {
          if (lane.kind !== 'staff' && lane.kind !== 'unassigned') continue
          for (const entry of lane.entries) unique.set(entry.reservationId, entry)
        }
        const upcoming = [...unique.values()]
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          .slice(0, 4)
        const first = upcoming[0]
        const masked = maskCustomerIdentity({
          name: first?.customerName ?? '',
          // 台帳応答は電話番号を返さない。固定の非実在値を伏せ字へ変換し、raw PIIを持ち込まない。
          phone: '09000000000',
        })
        onSharedSnapshot?.({
          customerName: masked.name,
          customerPhone: masked.phone,
          time: first ? jstClock(first.startsAt) : '—',
          count: view.counts.all,
        })
        setShared(true)
        setTotal(view.counts.all)
        setRows(upcoming)
        return
      }
      const lane = view.lanes.find((row) => row.id === me.id)
      // 応答の行は開始の早い順に並んでいる（`buildLedgerView`）。並べ直さない。
      setRows(lane?.entries ?? [])
    }
    read().catch(() => undefined)
    return () => {
      live = false
    }
  }, [onSharedSnapshot, sharedTerminal, storeId])

  // わたしが誰か分からない端末（共有端末）には出さない。
  if (rows === null || (shared && !showShared)) return null

  return (
    <section aria-label={shared ? '本日のご予約' : '本日わたしが担当するご予約'} className="w-100">
      <h2 className="text-lead font-bold text-ink">
        {shared ? '本日のご予約' : '本日わたしが担当するご予約'}
        {(shared || rows.length > 0) && (
          <span className="ml-3 font-normal text-ink-muted">{`${shared ? total : rows.length}件`}</span>
        )}
      </h2>
      {rows.length === 0 ? (
        <>
          <p className="mt-3 text-body text-ink">本日ご担当のご予約はありません。</p>
          <p className="mt-1 text-grid text-ink-muted">
            本日はお休みか、まだ 1 件も割り当てられていません。
          </p>
          <button
            type="button"
            onClick={onOpenLedger}
            className={`mt-4 min-h-11 rounded-ctl border border-line-strong bg-surface px-4 text-body font-semibold text-ink ${focusRing}`}
          >
            店全体の台帳を見る
          </button>
        </>
      ) : (
        <ul className="mt-3 border-line border-t">
          {rows.map((entry) => (
            <li key={entry.reservationId} className="border-line border-b">
              {/* モックの 1 行は 2 段組み。上の段に時刻と状態の札、下の段にご用件。
                  お客様のお名前は 007-customer-records が上の段へ足す。 */}
              <button
                type="button"
                onClick={() => onOpen(entry.reservationId)}
                className={`flex min-h-15 w-full flex-col justify-center gap-1 py-2.5 text-left ${focusRing}`}
              >
                <span className="flex w-full items-center gap-3">
                  <span className="font-mono text-lead font-bold text-ink">
                    {jstClock(entry.startsAt)}
                  </span>
                  <span className="ml-auto rounded-full border border-line-strong px-2.5 py-0.5 text-note font-semibold text-ink-muted">
                    {shared ? '●●●● 様' : STATUS_LABELS[entry.status]}
                  </span>
                </span>
                <span className="text-body text-ink-muted">{entry.purposeLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
