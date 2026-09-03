import type {
  LocalDate,
  RecordingSummary,
  ReservationDetail,
  ReservationSource,
  ReservationSummary,
  SearchRelaxation,
} from '@app/contracts'
import { cn, focusRing, TextInput } from '@app/ui'
import type { ReactNode } from 'react'
import { visitLabel } from '../../worker/domain/customers'
import { jstClock } from '../ledger/metrics'
import { hasPlayableRecording, RecordingPlayer } from '../recording/RecordingPlayer'
import { EmptyState, LoadingState } from '../shell/EmptyState'

/*
 * 予約を探す・1 件を確かめる（承認済みモック
 * docs/frontend/mockups/eyex/images/CHANGE-SEARCH.png ／ EX-EMPTY-SEARCH.png）。
 *
 * 題材: お客様と電話でつながったまま、お名前かお電話番号だけで目当ての 1 件を当て、
 * 中身を読み上げて確かめてから変更か取り消しへ進む面。
 * シグネチャ: **選んだ 1 件が右に出続け、左の一覧が閉じないこと。**
 *
 * 実測（screens/CHANGE-SEARCH.html ／ EX-EMPTY-SEARCH.html と assets/eyex.css）:
 *   2 段組みは 340px 1fr（`w-85`）。0 件の面だけ 300px 1fr（`w-75`）で、左を白地にし
 *   右に 1px の --line-strong の罫を引く（サイドバーと同じ地色が続くと境目が消える）。
 *   左ペイン padding 32px 24px・見出し 17px（0 件は 16px）・欄の間 16px（0 件は 14px）。
 *   入力欄 min-height 52px・角 12px・17px。絞り込みの札 min-height 44px・padding 0 14px・
 *   ピル・14px/600（選択中は緑地・白文字）。
 *   「結果 4件」13px・margin 26px 0 10px。結果の行 min-height 62px・padding 10px 12px・
 *   角 12px・行間 10px。左の時刻は幅 74px の等幅 12px、名前 15px、概要 12px。
 *   右ペイン padding 36px 40px。予約番号は等幅 15px、日時 26px/600、所要 15px、
 *   項目名の列 128px の 13px、値 17px/600、注意ごとのカードは上に 26px。
 *   0 件の右は見出し 22px（下 30px）・小見出し 16px/700・案は 3 列 gap 14px・
 *   min-height 112px・padding 14px 16px・件数は等幅 22px/700・案の文 15px。
 *
 * この面が描かないもの:
 * - 「丸の内店・新宿店のご予約も含める」… 別店舗のご予約は見せない決め（Q-04 の
 *   いまの前提）。押せない導線を置かない。
 */

/** 「8/27（木）」。年をまたぐ知らせは出さないので年を落とす。 */
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

function jstOf(instant: string): Date {
  return new Date(Date.parse(instant) + JST_OFFSET_MS)
}

/** 一覧の左の 1 行目（「8/27（木）」）。 */
function slashDay(instant: string): string {
  const at = jstOf(instant)
  return `${at.getUTCMonth() + 1}/${at.getUTCDate()}（${WEEKDAYS[at.getUTCDay()] ?? ''}）`
}

/** 詳細の見出し（「8月27日（木）」）。 */
function longDay(instant: string): string {
  const at = jstOf(instant)
  return `${at.getUTCMonth() + 1}月${at.getUTCDate()}日（${WEEKDAYS[at.getUTCDay()] ?? ''}）`
}

/** 期間の札（「8/27〜8/31」）。 */
function rangeLabel(from: LocalDate, to: LocalDate): string {
  const short = (date: LocalDate) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`
  return `${short(from)}〜${short(to)}`
}

/**
 * 出どころの札。**4 値すべてに語を持つ**（台帳の帯は色でも分けるが、この面は
 * 色を持たないので語が唯一の手がかりである）。
 */
const SOURCE_TAGS: Record<ReservationSource, string> = {
  phone: 'お電話でのご予約',
  counter: '店頭でのご予約',
  web: 'Webでのご予約',
  walkin: 'ウォークインの受付',
}

/** CHANGE-DIFF の通知の 1 行もこの語を使う（2 か所で綴りを分けない）。 */
export function sourceTagLabel(source: ReservationSource): string {
  return SOURCE_TAGS[source]
}

/** お電話番号は打った数字のまま持ち、出すときだけ 3-4-4 に区切る。 */
function phoneLabel(digits: string): string {
  if (digits.length !== 11) return digits
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

/* --- 条件 ----------------------------------------------------------------- */

/**
 * 期間の絞り込み。`upcoming`（これから）／`today`（今日）の 2 つの札と、
 * 0 件の面から持ち帰った暦日の範囲を同じ 1 つの欄で持つ。
 */
type SearchPeriod = 'upcoming' | 'today' | { from: LocalDate; to: LocalDate }

/** 左ペインが持っている条件。器はこれをそのままサーバへの問い合わせに写す。 */
export type SearchConditions = {
  name: string
  /** 数字だけ。4 桁ちょうどは下 4 桁、10 桁以上は全桁として扱われる。 */
  phone: string
  code: string
  period: SearchPeriod
  /** 出どころの絞り込み。`null` は全部。 */
  source: 'web' | null
  includeCancelled: boolean
}

export type SearchPhase = 'loading' | 'ready' | 'error' | 'forbidden'

export type ReservationSearchProps = {
  conditions: SearchConditions
  onConditions: (next: SearchConditions) => void
  items: readonly ReservationSummary[]
  total: number
  /** 条件を 1 つ緩めた案。0 件のときだけ届く（`ReservationList` の決め）。 */
  relaxations: readonly SearchRelaxation[]
  phase: SearchPhase
  selectedId: string | null
  onSelect: (reservationId: string) => void
  /** 選んだ 1 件の中身。器が取り直す（届くまでは null）。 */
  detail: ReservationDetail | null
  detailPhase: 'loading' | 'ready' | 'error' | 'not_found'
  /** 担当のお名前。未定は null（「担当が未定」と書く）。 */
  staffName: string | null
  equipmentNames: readonly string[]
  /** お客様のお電話番号（数字だけ）。分からないときは null。 */
  customerPhone: string | null
  /**
   * この受付の録音。**器が渡したときだけ**「受付のときの録音」の行が出る（AC-REC-09 の
   * 3 か所目）。`ReservationDetail` の契約に録音の欄がまだ無いので器から注ぐ。
   */
  recording?: RecordingSummary | null
  onRelax: (relaxation: SearchRelaxation) => void
  onChangeDateTime: () => void
  onChangeSlot: () => void
  onCancelReservation: () => void
  /** 顧客台帳へ、入れたお名前を持って渡す（AC-CHANGE-24）。 */
  onOpenCustomers: (name: string) => void
  onStartBooking: () => void
  /** 読み込みに失敗したときの「もう一度探す」。渡されないとボタンを出さない。 */
  onRetry?: () => void
}

export function ReservationSearch({
  conditions,
  onConditions,
  items,
  total,
  relaxations,
  phase,
  selectedId,
  onSelect,
  detail,
  detailPhase,
  staffName,
  equipmentNames,
  customerPhone,
  recording = null,
  onRelax,
  onChangeDateTime,
  onChangeSlot,
  onCancelReservation,
  onOpenCustomers,
  onStartBooking,
  onRetry,
}: ReservationSearchProps) {
  const zero = phase === 'ready' && total === 0
  const period = conditions.period
  const set = (patch: Partial<SearchConditions>) => onConditions({ ...conditions, ...patch })

  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label="お客様を伺って探します"
        className={cn(
          'flex shrink-0 flex-col overflow-y-auto border-r px-6 py-8',
          zero ? 'w-75 border-line-strong bg-surface' : 'w-85 border-line bg-surface-2',
        )}
      >
        <h2 className={cn('mb-5 font-semibold text-ink', zero ? 'text-body' : 'text-lead')}>
          お客様を伺って探します
        </h2>

        <div className={cn('flex flex-col', zero ? 'gap-3.5' : 'gap-4')}>
          <Ask
            id="search-name"
            label="お名前"
            value={conditions.name}
            placeholder="田中"
            onChange={(name) => set({ name })}
          />
          <Ask
            id="search-phone"
            label="お電話番号"
            value={conditions.phone}
            placeholder="090-1234-5678"
            inputMode="numeric"
            onChange={(phone) => set({ phone: phone.replace(/[^0-9]/g, '') })}
          />
          <Ask
            id="search-code"
            label="予約番号"
            value={conditions.code}
            placeholder="EY-2608-0142"
            onChange={(code) => set({ code: code.toUpperCase() })}
          />
        </div>

        <fieldset aria-label="絞り込み" className="mt-5 flex flex-wrap gap-2">
          <FilterChip
            label="これから"
            on={period === 'upcoming'}
            onPress={() => set({ period: 'upcoming' })}
          />
          <FilterChip
            label="今日"
            on={period === 'today'}
            onPress={() => set({ period: 'today' })}
          />
          <FilterChip
            label="取消済み"
            on={conditions.includeCancelled}
            onPress={() => set({ includeCancelled: !conditions.includeCancelled })}
          />
          {typeof period !== 'string' && (
            <FilterChip
              label={rangeLabel(period.from, period.to)}
              on={true}
              onPress={() => set({ period: 'upcoming' })}
            />
          )}
          {conditions.source === 'web' && (
            <FilterChip label="Web予約だけ" on={true} onPress={() => set({ source: null })} />
          )}
        </fieldset>

        {phase === 'loading' ? (
          <ListSkeleton />
        ) : phase === 'ready' ? (
          <>
            {zero ? (
              <>
                <p role="status" className="mt-8 text-body font-bold text-danger">
                  結果 0件
                </p>
                <p className="mt-1.5 text-grid text-ink-muted">
                  入力した条件はそのまま残しています。
                </p>
              </>
            ) : (
              // 件数は 0 件のときだけでなく**いつも読み上げに届ける**。絞り込みの札を
              // 押して 4 件が 3 件になったことは、目で見ていない人には件数でしか分からない。
              <p role="status" className="mt-6.5 mb-2.5 text-grid text-ink-muted">
                {`結果 ${total}件`}
              </p>
            )}
            {items.length > 0 && (
              <ul className="flex flex-col gap-2.5">
                {items.map((row) => (
                  <li key={row.id}>
                    <Hit
                      row={row}
                      chosen={row.id === selectedId}
                      onPress={() => onSelect(row.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <Trouble phase={phase} onRetry={onRetry} />
        )}
      </section>

      <section className="min-w-0 flex-1 overflow-y-auto bg-surface">
        {zero ? (
          <NoHit
            conditions={conditions}
            relaxations={relaxations}
            onRelax={onRelax}
            onFocusField={(field) =>
              document.getElementById(field === 'phone' ? 'search-phone' : 'search-code')?.focus()
            }
            onOpenCustomers={() => onOpenCustomers(conditions.name)}
            onStartBooking={onStartBooking}
          />
        ) : selectedId === null ? (
          /* 空・読み込み中・失敗を形で見分ける（UX 監査 UI-10）。 */
          <EmptyState
            title="ご予約を選んでください"
            note="左の 1 件を押すと、中身をここに出します。"
            live={false}
          />
        ) : detailPhase === 'loading' ? (
          <LoadingState label="ご予約の中身を読み込んでいます" rows={6} />
        ) : detail === null || detailPhase !== 'ready' ? (
          <p role="alert" className="px-10 py-9 text-body text-ink">
            {detailPhase === 'not_found'
              ? 'このご予約は見つかりませんでした。もう一度お探しください。'
              : 'ご予約の中身を読み込めませんでした。もう一度お選びください。'}
          </p>
        ) : (
          <Detail
            detail={detail}
            recording={recording}
            staffName={staffName}
            equipmentNames={equipmentNames}
            customerPhone={customerPhone}
            onChangeDateTime={onChangeDateTime}
            onChangeSlot={onChangeSlot}
            onCancelReservation={onCancelReservation}
          />
        )}
      </section>
    </div>
  )
}

/* --- 左ペインの部品 ------------------------------------------------------- */

function Ask({
  id,
  label,
  value,
  placeholder,
  inputMode,
  onChange,
}: {
  id: string
  label: string
  value: string
  placeholder: string
  inputMode?: 'numeric'
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-grid font-semibold text-ink-muted">
        {label}
      </label>
      <TextInput
        id={id}
        value={value}
        placeholder={placeholder}
        {...(inputMode === undefined ? {} : { inputMode })}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'min-h-13 rounded-card px-3.5 text-lead',
          value === '' ? 'border-line-strong' : 'border-2 border-pine',
        )}
      />
    </div>
  )
}

/** 絞り込みの札。**選択は色だけでなく `aria-pressed` でも伝える。** */
function FilterChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPress}
      className={cn(
        'min-h-11 rounded-full px-3.5 text-grid font-semibold',
        on
          ? 'border border-pine bg-pine text-on-pine'
          : 'border border-line-strong bg-surface text-ink-muted',
        focusRing,
      )}
    >
      {label}
    </button>
  )
}

/** 結果の 1 行。読み上げの名前は一覧に見えている語をそのまま連ねる。 */
function Hit({
  row,
  chosen,
  onPress,
}: {
  row: ReservationSummary
  chosen: boolean
  onPress: () => void
}) {
  const visits = row.visitCount === null ? null : visitLabel(row.visitCount, 'badge')
  const staff = row.staffName ?? '担当が未定'
  const name = `${row.customerName ?? 'お客様'} 様`
  const when = `${slashDay(row.startsAt)}${jstClock(row.startsAt)}`
  return (
    <button
      type="button"
      aria-pressed={chosen}
      aria-label={[when, name, visits, `${row.purposeLabel}／${staff}`]
        .filter((part) => part !== null)
        .join('　')}
      onClick={onPress}
      className={cn(
        'flex min-h-15.5 w-full items-center gap-3 rounded-card px-3 py-2.5 text-left',
        chosen ? 'border-2 border-pine bg-pine-soft' : 'border border-line bg-surface',
        focusRing,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'w-18.5 shrink-0 font-mono text-note font-semibold leading-snug',
          chosen ? 'text-pine-deep' : 'text-ink-muted',
        )}
      >
        {slashDay(row.startsAt)}
        <br />
        {jstClock(row.startsAt)}
      </span>
      <span aria-hidden="true" className="min-w-0">
        <span className="flex items-center gap-1.5 text-body font-semibold text-ink">
          {name}
          {visits !== null && <Visits count={row.visitCount ?? 0} label={visits} />}
        </span>
        <span className="block truncate text-note text-ink-muted">
          {`${row.purposeLabel}／${staff}`}
        </span>
      </span>
    </button>
  )
}

/** ご来店の回数の札。初めての方だけ色を変え、語も「初めて」にする。 */
function Visits({ count, label }: { count: number; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex min-h-5.5 items-center rounded-full border px-2 text-fine font-semibold',
        count <= 0
          ? 'border-walkin bg-walkin-soft text-walkin'
          : 'border-pine-line bg-pine-soft text-pine-deep',
      )}
    >
      {label}
    </span>
  )
}

/** 読み込み中は行の高さ 62px を保った灰色の帯を置く。**回るアイコンを置かない。** */
function ListSkeleton() {
  return (
    <div role="status" aria-label="ご予約を探しています…" className="mt-6.5">
      <span className="sr-only">ご予約を探しています…</span>
      <ul aria-hidden="true" className="flex flex-col gap-2.5">
        {Array.from({ length: 4 }, (_, index) => (
          <li key={index} className="min-h-15.5 rounded-card bg-surface-2" />
        ))}
      </ul>
    </div>
  )
}

/** 読めなかった・見られないとき。事実と次の一手だけを置く。 */
function Trouble({ phase, onRetry }: { phase: SearchPhase; onRetry?: () => void }) {
  return (
    <div role="alert" className="mt-6.5">
      <p className="text-body text-ink">
        {phase === 'forbidden'
          ? 'この画面はご覧になれません。店長にお尋ねください。'
          : 'ご予約を読み込めませんでした。入れた条件はそのまま残っています。'}
      </p>
      {phase === 'error' && onRetry !== undefined && (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            'mt-4 min-h-12 rounded-ctl bg-pine px-6 text-body font-bold text-on-pine',
            focusRing,
          )}
        >
          もう一度探す
        </button>
      )}
    </div>
  )
}

/* --- 右ペイン（1 件の中身） ----------------------------------------------- */

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-6 border-t border-line py-4 first:border-t-0">
      <dt className="w-32 shrink-0 text-grid text-ink-muted">{term}</dt>
      <dd className="m-0 min-w-0 text-lead font-semibold text-ink">{children}</dd>
    </div>
  )
}

function Detail({
  detail,
  recording,
  staffName,
  equipmentNames,
  customerPhone,
  onChangeDateTime,
  onChangeSlot,
  onCancelReservation,
}: {
  detail: ReservationDetail
  recording: RecordingSummary | null
  staffName: string | null
  equipmentNames: readonly string[]
  customerPhone: string | null
  onChangeDateTime: () => void
  onChangeSlot: () => void
  onCancelReservation: () => void
}) {
  const visits = detail.visitCount == null ? null : visitLabel(detail.visitCount, 'badge')
  return (
    <section aria-label="ご予約の中身" className="flex h-full flex-col px-10 py-9">
      <div className="flex items-center gap-3">
        <span className="font-mono text-body font-semibold text-ink-muted">{detail.code}</span>
        <span className="inline-flex min-h-5.5 items-center rounded-ctl border border-line-strong bg-surface px-2 text-note text-ink-muted">
          {sourceTagLabel(detail.source)}
        </span>
      </div>

      <p className="mt-3.5 flex items-baseline gap-3">
        <span className="text-hero font-semibold text-ink">
          {`${longDay(detail.startsAt)}${jstClock(detail.startsAt)}–${jstClock(detail.endsAt)}`}
        </span>
        <span className="text-body text-ink-muted">{`所要 ${detail.durationMinutes}分`}</span>
      </p>

      <dl className="mt-6.5">
        <Fact term="ご用件">{detail.purposeLabelInternal}</Fact>
        <Fact term="お客様">
          <span className="flex flex-wrap items-center gap-2">
            {`${detail.customerName ?? 'お客様'} 様`}
            {visits !== null && <Visits count={detail.visitCount ?? 0} label={visits} />}
            {customerPhone !== null && (
              <span className="font-normal text-grid text-ink-muted">
                {`／${phoneLabel(customerPhone)}`}
              </span>
            )}
          </span>
        </Fact>
        <Fact term="担当と場所">
          <span className="flex flex-wrap items-baseline gap-2">
            {staffName ?? '担当が未定'}
            {equipmentNames.length > 0 && (
              <span className="font-normal text-grid text-ink-muted">
                {`／${equipmentNames.join('・')}`}
              </span>
            )}
          </span>
        </Fact>
        {/*
         * 「受付のときの録音」（CHANGE-SEARCH の 4 行目）。**聞ける録音があるときだけ行ごと出す** ——
         * 無効の行を残すと「まだ読めていない」のか「もう無い」のかが手元から見分けられない
         * （AC-REC-07）。実測は白い `.btn`「録音を聞く　03:12」（時間は等幅）。
         */}
        {hasPlayableRecording(recording) && (
          <Fact term="受付のときの録音">
            <RecordingPlayer recording={recording} placement="row" />
          </Fact>
        )}
      </dl>

      {detail.noteInternal !== '' && (
        <section
          aria-label="注意ごと"
          className="mt-6.5 rounded-panel border border-walkin/40 bg-walkin-soft px-5.5 py-5"
        >
          <h3 className="mb-2 text-body font-semibold text-ink">注意ごと　1件</h3>
          <p className="text-body text-ink">{detail.noteInternal}</p>
        </section>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-3.5 pt-6">
        <p className="w-full text-grid text-ink-muted">
          変更の内容は、お客様にお伝えしてから確定します。
        </p>
        <div className="ml-auto flex flex-wrap gap-3">
          <Exit label="日時を変える" tone="primary" onPress={onChangeDateTime} />
          <Exit label="担当・場所を変える" tone="plain" onPress={onChangeSlot} />
          <Exit label="取り消す" tone="danger" onPress={onCancelReservation} />
        </div>
      </div>
    </section>
  )
}

function Exit({
  label,
  tone,
  onPress,
}: {
  label: string
  tone: 'primary' | 'plain' | 'danger'
  onPress: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={cn(
        'min-h-12 whitespace-nowrap rounded-card border px-4.5 text-body font-semibold',
        tone === 'primary' && 'border-pine bg-pine text-on-pine',
        tone === 'plain' && 'border-line-strong bg-surface text-ink',
        tone === 'danger' && 'border-danger bg-surface text-danger',
        focusRing,
      )}
    >
      {label}
    </button>
  )
}

/* --- 右ペイン（0 件） ----------------------------------------------------- */

/**
 * 1 件も見つからなかったとき（EX-EMPTY-SEARCH）。**入力を捨てずに次の一手を出す**のが
 * この面の仕事なので、白い箱は 3 枚（案・ほかの探し方・出口）で止め、
 * **空いた下半分を埋めるために要素を足さない。**
 */
function NoHit({
  conditions,
  relaxations,
  onRelax,
  onFocusField,
  onOpenCustomers,
  onStartBooking,
}: {
  conditions: SearchConditions
  relaxations: readonly SearchRelaxation[]
  onRelax: (relaxation: SearchRelaxation) => void
  onFocusField: (field: 'phone' | 'code') => void
  onOpenCustomers: () => void
  onStartBooking: () => void
}) {
  return (
    <div className="flex h-full flex-col px-10 py-9">
      <h2 className="mb-7.5 text-title font-bold text-ink">
        この条件では、ご予約が見つかりませんでした
      </h2>

      {relaxations.length > 0 && (
        <>
          <h3 className="mb-3.5 text-body font-bold text-ink">条件をひとつ外すと見つかります</h3>
          <ul className="grid grid-cols-3 gap-3.5">
            {relaxations.map((relaxation) => (
              <li key={relaxation.label}>
                <button
                  type="button"
                  // 読み上げでは件数と案が続けて読まれる（AC-CHANGE-22 の
                  // 「5件　「Web予約だけ」を外す」）。見た目の改行に名前を委ねない。
                  aria-label={`${relaxation.count}件　${relaxation.label}`}
                  onClick={() => onRelax(relaxation)}
                  className={cn(
                    'flex min-h-28 w-full flex-col items-start rounded-card border border-line-strong bg-surface px-4 py-3.5 text-left',
                    focusRing,
                  )}
                >
                  <span className="font-mono text-title font-bold text-pine-deep">
                    {relaxation.count}
                    <span className="ml-1 font-sans text-grid font-semibold text-ink-muted">
                      件
                    </span>
                  </span>
                  <span className="mt-1.5 text-body leading-normal text-ink">
                    {relaxation.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="mt-8 mb-3.5 text-body font-bold text-ink">ほかの探し方</h3>
      <ul>
        <li>
          <OtherWay
            label="お電話番号で探す"
            note="下4桁だけでも探せます"
            onPress={() => onFocusField('phone')}
          />
        </li>
        <li>
          <OtherWay
            label="予約番号で探す"
            note="控えの EY- から始まる番号"
            onPress={() => onFocusField('code')}
          />
        </li>
      </ul>

      <div className="mt-auto flex justify-end gap-3 pt-6">
        <button
          type="button"
          onClick={onOpenCustomers}
          className={cn(
            'min-h-12 rounded-card border border-line-strong bg-surface px-4.5 text-body font-semibold text-ink',
            focusRing,
          )}
        >
          顧客台帳で調べる
        </button>
        <button
          type="button"
          onClick={onStartBooking}
          className={cn(
            'min-h-12 rounded-card border border-pine bg-pine px-4.5 text-body font-semibold text-on-pine',
            focusRing,
          )}
        >
          新しく予約を取る
        </button>
      </div>
      <p className="sr-only">{`入れたお名前は「${conditions.name}」です。`}</p>
    </div>
  )
}

function OtherWay({ label, note, onPress }: { label: string; note: string; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={cn(
        'flex min-h-12 w-full items-center gap-3 border-t border-line py-2 text-left text-body text-ink',
        focusRing,
      )}
    >
      {label}
      <span className="text-grid text-ink-muted">{note}</span>
      <span aria-hidden="true" className="ml-auto text-ink-faint">
        ›
      </span>
    </button>
  )
}
