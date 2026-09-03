import type { CustomerDetail, CustomerSummary, Prescription } from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { cn, focusRing } from '@app/ui'
import { useEffect, useMemo, useState } from 'react'
import {
  type CustomerRow,
  type CustomerSort,
  filterCustomers,
  last4,
  lastVisitLabel,
  pageCustomers,
  searchFilter,
  searchMode,
  visitLabel,
} from '../../worker/domain/customers'
import { jstClock } from '../ledger/metrics'

/*
 * 顧客台帳の一覧と、選んだ 1 名の要約
 * （承認済みモック docs/frontend/mockups/eyex/images/CUSTOMER-LIST.png）。
 *
 * 題材: お名前があいまいなまま、来店回数と最後のご来店から 1 名に手繰る面。
 * シグネチャ: **選んだ 1 名の要約が、一覧を閉じずに右に出続けること。**
 *
 * 実測（screens/CUSTOMER-LIST.html と assets/eyex.css）:
 *   本文は 2 ペイン `1fr 360px`（w-90）。ツールバー 56px・padding 0 16px・gap 10px。
 *   segmented のボタン min-height 38px（触れる大きさは 44pt へ上げる）・padding 0 16px・14px 600。
 *   検索欄の帯 padding 16px 20px・下に 1px の罫、欄は min-height 52px・角 12px・17px。
 *   見出し行 34px・地 --surface-2・下に 1px の --line-strong・12px。
 *   行は 4 列 220px / 72px / 132px / 1fr・gap 12px・padding 0 20px・**min-height 60px**
 *   （モックは高さ固定だが、実装は `min-height` に直す。05-screen-flow.md §7.5）。
 *   選択行は地 --brand-tint ＋ 左 4px の緑（`box-shadow: inset` の代わりに左の罫で描く）。
 *   右の要約 padding 32px 28px・お名前 21px・4 項目は各 padding 18px 0。
 *
 * 絞り込みと並べ替えは `worker/domain/customers.ts` の純関数をそのまま画面でも使う
 * （P2 の `ReservationList` が `filterLedgerRows` でしているのと同じ）。規則の出どころを
 * 2 つにしないためで、同じ条件は `onConditions` で器へも上げてサーバ側でも絞る。
 *
 * この面が描かないもの: 度数の履歴表（詳細の主役なので要約には出さない。AC-CUST-08）、
 * おまとめの入口（店長だけの操作なので `CustomerMerge` の側が持つ）。
 */

/** 1 画面に出す行。9 行目からは「ほか N名」と「続きを見る」に逃がす。 */
const PAGE_ROWS = 8

/** 「（木）」。JST の暦日から出す。 */
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** 絞り込みが持つ条件はご来店の回数の 4 段だけ（AC-CUST-03。空いた場所を埋めるために足さない）。 */
const VISIT_RANGES = [
  { key: 'first', label: '初', min: 0, max: 0 },
  { key: 'once', label: '1回', min: 1, max: 1 },
  { key: 'few', label: '2〜4回', min: 2, max: 4 },
  { key: 'many', label: '5回以上', min: 5, max: null },
] as const

export type VisitRangeKey = (typeof VISIT_RANGES)[number]['key']

/** 札が表す回数の幅。器はこれをそのままサーバへの `visitCountMin` / `Max` に写す。 */
export function visitRangeBounds(
  key: VisitRangeKey | null,
): { min: number; max: number | null } | null {
  const range = VISIT_RANGES.find((option) => option.key === key)
  return range === undefined ? null : { min: range.min, max: range.max }
}

/** 一覧が持っている条件。器はこれをそのままサーバへの問い合わせに写す。 */
export type CustomerListConditions = {
  query: string
  sort: CustomerSort
  visitRange: VisitRangeKey | null
}

export type CustomerListPhase = 'loading' | 'ready' | 'error' | 'forbidden'

export type CustomerListProps = {
  /** 台帳の 1 ページ。読み込み中は null。 */
  items: CustomerSummary[] | null
  /** 省略時は `items` の有無から決める（null なら読み込み中）。 */
  phase?: CustomerListPhase
  /** 選ばれた 1 名の中身。器が `onSelect` を受けて取り直す（届くまでは null）。 */
  summary: CustomerDetail | null
  /** 要約そのものの様子。省略時は `summary` の有無から決める。 */
  summaryPhase?: 'loading' | 'ready' | 'error'
  onSelect: (customerId: string | null) => void
  onOpenDetail: (customerId: string) => void
  /** 予約の 5 工程へ、そのお客様を持って渡す（AC-CUST-26）。 */
  onStartBooking: (customerId: string) => void
  onCreate: () => void
  /** 検索語・並べ方・絞り込みが変わったとき。器がサーバ側の条件を合わせる。 */
  onConditions?: (conditions: CustomerListConditions) => void
  /**
   * 検索欄の初めの中身。予約を探す面の「顧客台帳で調べる」から来たとき、伺った
   * お名前をそのまま欄に残す（AC-CHANGE-24）。**欄を空にして結果だけ絞らない** ——
   * 何で絞られているのか読めない一覧になる。
   */
  initialQuery?: string
  /** 読み込みに失敗したときの「もう一度読み込む」。渡されないとボタンを出さない。 */
  onRetry?: () => void
}

/* --- 度数の綴り ----------------------------------------------------------- */

/**
 * 度数 1 つの文字。**綴りはこの 1 か所だけ**にする —— 要約の「いまの度数」と詳細の
 * 表が同じ文字を出すことが AC-CUST-09 の検証点なので、2 か所で組み立てない。
 * 符号は必ず添える（`-2.25` / `+0.75`）。測っていない側は「—」。
 */
export function diopterLabel(value: number | null): string {
  if (value === null) return '—'
  return `${value < 0 ? '-' : '+'}${Math.abs(value).toFixed(2)}`
}

/** 軸（0〜180 の整数）。測っていなければ「—」。 */
export function axisLabel(value: number | null): string {
  return value === null ? '—' : String(value)
}

/** 瞳孔間距離（mm）。度数と違って 0.5 刻みなので小数 1 桁で綴る。 */
export function pdLabel(value: number | null): string {
  return value === null ? '—' : value.toFixed(1)
}

/** 要約の「いまの度数」（「R -2.25　／　L -2.00」）。いま有効な 1 行が無ければ null。 */
export function currentPowerLabel(prescriptions: readonly Prescription[]): string | null {
  const current = prescriptions.find((row) => row.isCurrent)
  if (current === undefined) return null
  return `R ${diopterLabel(current.rSph)}　／　L ${diopterLabel(current.lSph)}`
}

/** 「8月27日（木）11:00」。年をまたぐ知らせは出さないので年を落とす。 */
function shortDateTimeLabel(startsAt: string): string {
  const day = new Date(`${toJstDateString(startsAt)}T00:00:00.000Z`)
  const weekday = WEEKDAYS[day.getUTCDay()]
  return `${day.getUTCMonth() + 1}月${day.getUTCDate()}日（${weekday}）${jstClock(startsAt)}`
}

/* --- 一覧の行 ------------------------------------------------------------- */

/**
 * 応答の 1 行を、探し方と並べ方の純関数が読む形へ写す。
 * まとめられた行はサーバの一覧に載らないので `mergedIntoId` は常に null になる。
 */
function toRow(customer: CustomerSummary): CustomerRow {
  return {
    id: customer.id,
    customerNumber: customer.customerNumber,
    name: customer.name,
    kana: customer.kana,
    phoneNormalized: customer.phone,
    phoneLast4: customer.phone === null ? null : last4(customer.phone),
    address: null,
    memo: customer.memoShort,
    visitCount: customer.visitCount,
    lastVisitAt: customer.lastVisitAt,
    mergedIntoId: null,
  }
}

/**
 * 行そのものの読み上げ名。列の見出しは飾りの帯なので、**値と項目名をここで対にする**
 * （「ご来店 4回」まで畳まないと、読み上げでは数字だけが並ぶ）。
 */
function rowName(row: CustomerRow): string {
  return [
    `${row.name} 様`,
    row.kana,
    `ご来店 ${visitLabel(row.visitCount, 'list')}`,
    `最後のご来店 ${lastVisitLabel(row.lastVisitAt)}`,
    row.memo,
  ]
    .filter((part) => part !== '')
    .join('　')
}

/* --- 面 ------------------------------------------------------------------- */

export function CustomerList({
  items,
  phase,
  summary,
  summaryPhase,
  onSelect,
  onOpenDetail,
  onStartBooking,
  onCreate,
  onConditions,
  initialQuery = '',
  onRetry,
}: CustomerListProps) {
  const [query, setQuery] = useState(initialQuery)
  const [sort, setSort] = useState<CustomerSort>('kana')
  const [visitRange, setVisitRange] = useState<VisitRangeKey | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [limit, setLimit] = useState(PAGE_ROWS)
  // 選んだ 1 名は画面が覚える。**札を付けても並べ方を変えても外れない**（AC-CUST-03）。
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const state = phase ?? (items === null ? 'loading' : 'ready')

  useEffect(() => {
    onConditions?.({ query, sort, visitRange })
    setLimit(PAGE_ROWS)
  }, [query, sort, visitRange, onConditions])

  const found = useMemo(() => {
    const rows = (items ?? []).map(toRow)
    const matched = filterCustomers(rows, searchFilter(query))
    const range = VISIT_RANGES.find((option) => option.key === visitRange)
    const narrowed =
      range === undefined
        ? matched
        : matched.filter(
            (row) =>
              row.visitCount >= range.min && (range.max === null || row.visitCount <= range.max),
          )
    return pageCustomers(narrowed, { sort, limit })
  }, [items, query, visitRange, sort, limit])

  const remaining = found.total - found.items.length

  function pick(customerId: string) {
    setSelectedId(customerId)
    onSelect(customerId)
  }

  /*
   * 一覧が届いたら先頭の 1 名を選ぶ。
   *
   * 以前は何も選ばれずに開き、画面の 30% を占める右ペインが灰色の 1 行だけだった。
   * 承認済みモック `CUSTOMER-LIST.png` は選択済みの姿で描かれており、
   * 68 枚のモックに右ペインが空の絵は 1 枚も無い（UX 監査 UI-09）。
   * **一度でも自分で選んだら、そのあとは触らない**（並べ方や絞り込みを変えても、
   * 選んだ人が外れないのが AC-CUST-03 の約束である）。
   */
  const firstId = found.items[0]?.id ?? null
  useEffect(() => {
    if (selectedId !== null || firstId === null) return
    setSelectedId(firstId)
    onSelect(firstId)
  }, [firstId, selectedId, onSelect])

  function clearConditions() {
    setQuery('')
    setVisitRange(null)
    setFilterOpen(false)
  }

  return (
    <main aria-label="顧客台帳" className="flex h-full min-h-0 flex-col bg-paper">
      {/* ツールバーはモックの 56px。触れる大きさ 44pt のキー（`min-h-11`）＋ segmented の
          内側の余白 2px ＋ 上下 3px ＋ 下の罫 1px でちょうど 56px になる。ここが 9px 高いと、
          下に続く 8 行ぜんぶがモックから 9px ずれる。 */}
      <div className="flex min-w-0 flex-none flex-wrap items-center gap-2.5 border-line border-b bg-surface px-4 py-0.75">
        <fieldset aria-label="一覧の並べ方" className="flex gap-0.5 rounded-ctl bg-surface-2 p-0.5">
          {(
            [
              { key: 'kana', label: 'お名前順' },
              { key: 'visits', label: 'ご来店の回数順' },
            ] as const
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={sort === option.key}
              onClick={() => setSort(option.key)}
              className={cn(
                'min-h-11 rounded-ctl px-4 text-grid font-semibold',
                sort === option.key
                  ? 'bg-surface text-pine ring-1 ring-line'
                  : 'bg-transparent text-ink-muted',
                focusRing,
              )}
            >
              {option.label}
            </button>
          ))}
        </fieldset>

        <div className="relative">
          <button
            type="button"
            aria-expanded={filterOpen}
            onClick={() => setFilterOpen((open) => !open)}
            className={cn(
              'min-h-11 rounded-ctl border border-line-strong bg-surface px-3.5 text-grid font-semibold text-ink',
              focusRing,
            )}
          >
            絞り込み
          </button>
          {filterOpen && (
            <fieldset
              aria-label="ご来店の回数で絞り込む"
              className="absolute top-full left-0 z-10 mt-1 flex w-44 flex-col gap-1 rounded-card border border-line-strong bg-surface p-2"
            >
              {VISIT_RANGES.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={visitRange === option.key}
                  onClick={() =>
                    setVisitRange((current) => (current === option.key ? null : option.key))
                  }
                  className={cn(
                    'min-h-11 rounded-ctl px-3 text-left text-body font-semibold',
                    visitRange === option.key
                      ? 'border border-pine-line bg-pine-soft text-pine-deep'
                      : 'border border-transparent text-ink',
                    focusRing,
                  )}
                >
                  {option.label}
                </button>
              ))}
            </fieldset>
          )}
        </div>

        {visitRange !== null && (
          <span className="inline-flex min-h-5.5 items-center rounded-ctl border border-pine-line bg-pine-soft px-2 text-note font-semibold text-pine-deep">
            {`ご来店 ${VISIT_RANGES.find((option) => option.key === visitRange)?.label ?? ''}`}
          </span>
        )}

        {items !== null && (
          <p className="ml-auto text-grid text-ink-muted">{`当てはまるお客様 ${found.total}名`}</p>
        )}

        <button
          type="button"
          onClick={onCreate}
          className={cn(
            'min-h-11 rounded-ctl bg-pine px-4 text-body font-semibold text-on-pine',
            items === null && 'ml-auto',
            focusRing,
          )}
        >
          <span aria-hidden="true">＋ </span>新しいお客様を登録
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <section
          aria-label="お客様を探す"
          className="flex min-w-0 flex-1 flex-col overflow-y-auto border-line border-r bg-surface"
        >
          <div className="flex-none border-line border-b px-5 py-4">
            <label htmlFor="customer-search" className="sr-only">
              お名前・電話番号　一部でも探せます
            </label>
            <input
              id="customer-search"
              type="search"
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="お名前・電話番号　一部でも探せます"
              className={cn(
                'min-h-13 w-full rounded-card border border-line-strong bg-surface px-3.5 text-lead text-ink',
                'placeholder:text-ink-faint',
                focusRing,
              )}
            />
          </div>

          {state === 'error' && (
            /*
             * 通信が切れたときもここへ落ちる。**行き止まりにしない** —— この製品に
             * router は無く「画面を開き直す」道が無いので、同じ場所からもう一度
             * 引けるようにする（台帳の `OfflineBanner` の「再接続を試す」と同じ考え）。
             */
            <div role="alert" className="px-5 py-6">
              <p className="text-body text-ink-muted">
                お客様の一覧を読み込めませんでした。通信が切れているかもしれません。
              </p>
              {onRetry !== undefined && (
                <button
                  type="button"
                  onClick={onRetry}
                  className={cn(
                    'mt-4 min-h-11 rounded-ctl border border-line-strong bg-surface px-4 text-body font-semibold text-ink',
                    focusRing,
                  )}
                >
                  もう一度読み込む
                </button>
              )}
            </div>
          )}
          {state === 'forbidden' && (
            <p role="alert" className="px-5 py-6 text-body text-ink-muted">
              顧客台帳を見る権限がありません。お店の管理者にご確認ください。
            </p>
          )}
          {state === 'loading' && <ListSkeleton />}
          {state === 'ready' &&
            (found.items.length === 0 ? (
              <EmptyResult query={query} visitRange={visitRange} onClear={clearConditions} />
            ) : (
              <>
                <div
                  aria-hidden="true"
                  className="flex min-h-8.5 flex-none items-center gap-3 border-line-strong border-b bg-surface-2 px-5 text-note text-ink-muted"
                >
                  <span className="w-55">お名前</span>
                  <span className="w-18">ご来店</span>
                  <span className="w-33">最後のご来店</span>
                  <span className="min-w-0 flex-1">覚えておくこと</span>
                </div>

                <div role="listbox" aria-label="お客様の一覧" className="flex-none">
                  {found.items.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      role="option"
                      aria-selected={row.id === selectedId}
                      aria-label={rowName(row)}
                      onClick={() => pick(row.id)}
                      className={cn(
                        'flex min-h-15 w-full items-center gap-3 border-line border-b border-l-4 px-5 text-left',
                        row.id === selectedId
                          ? 'border-l-pine bg-pine-soft'
                          : 'border-l-transparent bg-surface',
                        focusRing,
                      )}
                    >
                      <span className="w-55">
                        <span className="block text-body font-semibold text-ink">{`${row.name} 様`}</span>
                        <span className="block text-note text-ink-muted">{row.kana}</span>
                      </span>
                      {/* 来店回数は**平文**で出す。色つきの印（`ledger/Timetable.tsx` の
                          `VisitBadge`）はお名前の右に添えるもので、回数の列をすでに持つ
                          この面には入れない（モックの規準 `docs/frontend/mockups/eyex/README.md`）。
                          数字は等幅で桁を揃える。 */}
                      <span className="w-18 font-mono text-body font-semibold text-ink">
                        {visitLabel(row.visitCount, 'list')}
                      </span>
                      <span className="w-33 text-grid text-ink-muted">
                        {lastVisitLabel(row.lastVisitAt)}
                      </span>
                      {/* 「…」で切ってよいのはこの列だけ。お名前・日付・番号は切らない。 */}
                      <span className="min-w-0 flex-1 truncate text-grid text-ink-muted">
                        {row.memo}
                      </span>
                    </button>
                  ))}
                </div>

                {remaining > 0 && (
                  <div className="flex flex-none items-center gap-2.5 px-5 pt-4.5 text-grid text-ink-muted">
                    <span>{`ほか ${remaining}名`}</span>
                    <button
                      type="button"
                      onClick={() => setLimit((current) => current + PAGE_ROWS)}
                      className={cn(
                        'ml-auto min-h-11 rounded-ctl px-2 text-grid font-semibold text-pine',
                        focusRing,
                      )}
                    >
                      続きを見る<span aria-hidden="true"> ›</span>
                    </button>
                  </div>
                )}
              </>
            ))}
        </section>

        <SummaryPane
          selectedId={selectedId}
          summary={summary}
          phase={summaryPhase ?? (summary === null ? 'loading' : 'ready')}
          onOpenDetail={onOpenDetail}
          onStartBooking={onStartBooking}
        />
      </div>
    </main>
  )
}

/** 読み込み中は行の高さを保った灰色の帯を置く。**回るアイコンを置かない。** */
function ListSkeleton() {
  return (
    <div role="status" className="flex-none">
      <span className="sr-only">お客様の一覧を読み込んでいます…</span>
      <ul aria-hidden="true">
        {Array.from({ length: PAGE_ROWS }, (_, index) => (
          <li key={index} className="min-h-15 border-line border-b bg-surface-2" />
        ))}
      </ul>
    </div>
  )
}

/**
 * 当てはまるお客様が 0 名のとき（AC-CUST-01）。表を空のまま残さず、
 * **見出し 1 行＋なぜ 0 件かの 1 行＋条件を緩める操作 1 つ**の 3 つだけを出す。
 */
function EmptyResult({
  query,
  visitRange,
  onClear,
}: {
  query: string
  visitRange: VisitRangeKey | null
  onClear: () => void
}) {
  const searching = query.trim() !== ''
  const heading = searching
    ? `「${query.trim()}」で当てはまるお客様はいません。`
    : '当てはまるお客様はいません。'
  const reason = searching
    ? searchMode(query).kind === 'phoneLast4'
      ? 'お電話番号は下 4 桁の一致で探しています。'
      : 'お名前とふりがなの一部で探しています。'
    : 'ご来店の回数で絞り込んでいます。'
  const action = searching ? '検索をやめて全件を見る' : '絞り込みをやめて全件を見る'
  return (
    <div role="status" className="max-w-2xl px-5 py-6.5">
      <h2 className="text-title font-bold text-ink">{heading}</h2>
      <p className="mt-2 text-body text-ink-muted">{reason}</p>
      <button
        type="button"
        onClick={onClear}
        className={cn(
          'mt-5 min-h-11.5 rounded-ctl border border-line-strong bg-surface px-4 text-body font-semibold text-ink',
          focusRing,
        )}
      >
        {visitRange === null || searching ? action : '絞り込みをやめて全件を見る'}
      </button>
    </div>
  )
}

/* --- 右の要約 ------------------------------------------------------------- */

type SummaryLine = { term: string; value: string; sub: string | null; tone?: 'danger' }

/** 注意ごとの本文。1 行目を太く、2 行目以降を補足として読ませる（契約は本文 1 本だけ）。 */
function splitBody(body: string): { head: string; rest: string | null } {
  const [head = '', ...rest] = body.split('\n')
  const tail = rest.join('\n').trim()
  return { head, rest: tail === '' ? null : tail }
}

/** 要約の 4 項目（次のご予約 / いまの度数 / いまお使いのメガネ / 注意ごと）。 */
function summaryLines(detail: CustomerDetail): SummaryLine[] {
  const next = detail.nextReservation
  const current = detail.prescriptions.find((row) => row.isCurrent)
  const worn = detail.glasses.filter((row) => row.isCurrent)
  const attention = detail.notes.find(
    (note) => note.kind === 'attention' && note.status === 'published',
  )
  const power = currentPowerLabel(detail.prescriptions)
  const measured =
    current === undefined
      ? null
      : `${lastVisitLabel(current.measuredAt)} 測定${current.pd === null ? '' : `／PD ${pdLabel(current.pd)} mm`}`
  const note = attention === undefined ? null : splitBody(attention.body)
  return [
    {
      term: '次のご予約',
      value: next === null ? 'ご予約はありません' : shortDateTimeLabel(next.startsAt),
      sub:
        next === null ? null : `${next.purposeLabel}／担当 ${next.staffName ?? 'これから決めます'}`,
    },
    {
      term: 'いまの度数',
      value: power ?? '度数の記録はまだありません',
      sub: measured,
    },
    {
      term: 'いまお使いのメガネ',
      value: `${worn.length}本`,
      sub: worn.length === 0 ? 'ご登録がありません' : worn.map((row) => row.usageLabel).join('・'),
    },
    {
      term: '注意ごと',
      value: note === null ? 'ありません' : note.head,
      sub: note?.rest ?? null,
      tone: note === null ? undefined : 'danger',
    },
  ]
}

function SummaryPane({
  selectedId,
  summary,
  phase,
  onOpenDetail,
  onStartBooking,
}: {
  selectedId: string | null
  summary: CustomerDetail | null
  phase: 'loading' | 'ready' | 'error'
  onOpenDetail: (customerId: string) => void
  onStartBooking: (customerId: string) => void
}) {
  return (
    <aside
      aria-label="選んだお客様の要約"
      className="flex w-90 flex-none flex-col overflow-y-auto bg-surface px-7 py-8"
    >
      {selectedId === null ? (
        <p className="text-body text-ink-muted">
          お客様の行をお選びください。選んだ方の要約がここに出ます。
        </p>
      ) : summary === null ? (
        phase === 'error' ? (
          <p role="alert" className="text-body text-ink-muted">
            この方の要約を読み込めませんでした。もう一度お選びください。
          </p>
        ) : (
          <p className="text-body text-ink-muted">要約を読み込んでいます…</p>
        )
      ) : (
        <>
          <h2 className="text-title font-bold text-ink">{`${summary.name} 様`}</h2>
          <p className="mt-1 text-grid text-ink-muted">
            {`${summary.kana}　／　${summary.customerNumber}`}
          </p>
          <dl className="mt-5">
            {summaryLines(summary).map((line) => (
              <div key={line.term} className="border-line border-t py-4.5 first:border-t-0">
                <dt className="text-grid text-ink-muted">{line.term}</dt>
                <dd
                  className={cn(
                    'mt-1 text-lead font-semibold',
                    line.tone === 'danger' ? 'text-danger' : 'text-ink',
                  )}
                >
                  {line.value}
                </dd>
                {line.sub !== null && (
                  <dd className="mt-0.5 text-grid text-ink-muted">{line.sub}</dd>
                )}
              </div>
            ))}
          </dl>
          <div className="mt-auto flex gap-2.5 pt-6">
            <button
              type="button"
              onClick={() => onOpenDetail(summary.id)}
              className={cn(
                'min-h-12 flex-1 rounded-ctl border border-line-strong bg-surface px-4 text-body font-semibold text-ink',
                focusRing,
              )}
            >
              くわしく見る
            </button>
            <button
              type="button"
              onClick={() => onStartBooking(summary.id)}
              className={cn(
                'min-h-12 flex-1 rounded-ctl bg-pine px-4 text-body font-semibold text-on-pine',
                focusRing,
              )}
            >
              ご予約を取る
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
