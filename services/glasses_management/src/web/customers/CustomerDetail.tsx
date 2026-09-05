import type { CustomerDetail as CustomerDetailShape, CustomerNote } from '@app/contracts'
import { toJstDateString } from '@app/shared'
import { cn, focusRing } from '@app/ui'
import { lastVisitLabel, visitLabel } from '../../worker/domain/customers'
import { formatPhoneDigits } from '../booking/CustomerStep'
import { dateLabel, jstClock } from '../ledger/metrics'
import { axisLabel, diopterLabel, pdLabel } from './CustomerList'

/*
 * お客様の詳細（承認済みモック docs/frontend/mockups/eye/images/CUSTOMER-DETAIL.png）。
 *
 * 題材: 「前回どう見えていたか」から接客を始めるための面。
 * シグネチャ: **左の「度数の移り変わり」1 枚が主役で、いま有効な 1 行に
 * 「いま使っています」の札が付くこと**（緑・太字だけで区別しない。AC-CUST-09）。
 *
 * 実測（screens/CUSTOMER-DETAIL.html と assets/eye.css）:
 *   本文 padding 32px 40px、中は 2 列 `1fr 300px`（w-75）・gap 28px。
 *   お名前 26px/700、ふりがな＋お客様番号 13px、`dt` 13px・`dd` 16px/600・各項目 padding 0 16px。
 *   カードは 1px の --line・角 16px・padding 20px 22px、見出し 14px --ink-2（margin 0 0 14px）。
 *   表のセル padding 12px 6px・下 1px の罫・右寄せ（1 列目だけ左）、見出し行 13px/600、
 *   本体 16px 等幅（1 列目だけ 15px の本文書体）、最終行は罫なし。
 *   いまお使いのメガネ 上に margin 32px・各行 padding 16px 0・題 16px・補足 13px。
 *   右は 注意ごと（--alert 系）と 次のご予約（--brand 系）の 2 枚だけ。
 *
 * この面が描かないもの:
 * - 顧客情報の編集画面（feature spec のスコープ外）。「内容を直す」は器が答える。
 * - 手書きの表示切替と紙の撮影（同じくスコープ外）。手書きへの入口は**注意ごとの行**に置く
 *   （「内容を直す」の中には置かない。手書きは注意ごとに属する記録である）。
 */

export type CustomerDetailPhase = 'loading' | 'ready' | 'error' | 'notFound' | 'forbidden'

export type CustomerDetailProps = {
  detail: CustomerDetailShape | null
  /** 省略時は `detail` の有無から決める（null なら読み込み中）。 */
  phase?: CustomerDetailPhase
  /** 一覧へ戻る。この製品に router は無いので、面の中に出口を置く。 */
  onBack: () => void
  onEdit: () => void
  /** 予約の 5 工程へ、そのお客様を持って渡す（AC-CUST-26）。 */
  onStartBooking: (customerId: string) => void
  /** 注意ごとの行から手書きメモの面へ（AC-CUST-18）。 */
  onOpenHandwriting: (noteId: string) => void
  /**
   * おまとめの入口（AC-CUST-14）。**店長で、かつ同じお電話番号の重複が見つかったときだけ**
   * 器が渡す —— 渡されないときはボタンごと出さない（AC-CUST-16「入口が画面のどこにも出ず」）。
   */
  onOpenMerge?: () => void
}

/** 「注意ごと N件」に数えるのは `attention` かつ `published` の行だけ（申し込みは数えない）。 */
function publishedAttentions(notes: readonly CustomerNote[]): CustomerNote[] {
  return notes.filter((note) => note.kind === 'attention' && note.status === 'published')
}

/** 注意ごとの本文。1 行目を太く、2 行目以降を補足として読ませる（契約は本文 1 本だけ）。 */
function splitBody(body: string): { head: string; rest: string | null } {
  const [head = '', ...rest] = body.split('\n')
  const tail = rest.join('\n').trim()
  return { head, rest: tail === '' ? null : tail }
}

/** 「-2.25　-0.50　180」。測っていない側は「—」で埋め、列をずらさない。 */
function eyeLabel(sph: number | null, cyl: number | null, axis: number | null): string {
  return `${diopterLabel(sph)}　${diopterLabel(cyl)}　${axisLabel(axis)}`
}

export function CustomerDetail({
  detail,
  phase,
  onBack,
  onEdit,
  onStartBooking,
  onOpenHandwriting,
  onOpenMerge,
}: CustomerDetailProps) {
  const state = phase ?? (detail === null ? 'loading' : 'ready')

  return (
    <main aria-label="お客様の詳細" className="flex h-full min-h-0 flex-col bg-paper">
      {/* ツールバーはモックの 56px。触れる大きさ 44pt（`min-h-11`）＋ 上下 5px ＋ 下の罫 1px。 */}
      <div className="flex min-w-0 flex-none items-center gap-2.5 border-line border-b bg-surface px-4 py-1.25">
        <button
          type="button"
          onClick={onBack}
          className={cn('min-h-11 rounded-ctl px-2 text-body font-semibold text-pine', focusRing)}
        >
          <span aria-hidden="true">‹ </span>お客様の一覧へ戻る
        </button>
        {detail !== null && (
          <div className="ml-auto flex items-center gap-2.5">
            {onOpenMerge !== undefined && (
              <button
                type="button"
                onClick={onOpenMerge}
                className={cn(
                  'min-h-11 rounded-ctl border border-line-strong bg-surface px-4 text-body font-semibold text-ink',
                  focusRing,
                )}
              >
                おまとめ
              </button>
            )}
            <button
              type="button"
              onClick={onEdit}
              className={cn(
                'min-h-11 rounded-ctl border border-line-strong bg-surface px-4 text-body font-semibold text-ink',
                focusRing,
              )}
            >
              内容を直す
            </button>
            <button
              type="button"
              onClick={() => onStartBooking(detail.id)}
              className={cn(
                'min-h-11 rounded-ctl bg-pine px-4 text-body font-semibold text-on-pine',
                focusRing,
              )}
            >
              この方のご予約を取る
            </button>
          </div>
        )}
      </div>

      {state === 'loading' && (
        <p role="status" className="px-10 py-8 text-body text-ink-muted">
          お客様を読み込んでいます…
        </p>
      )}
      {state === 'notFound' && (
        <p role="alert" className="px-10 py-8 text-body text-ink-muted">
          このお客様は見つかりませんでした。一覧からもう一度お選びください。
        </p>
      )}
      {state === 'error' && (
        <p role="alert" className="px-10 py-8 text-body text-ink-muted">
          お客様を読み込めませんでした。画面を開き直してください。
        </p>
      )}
      {state === 'forbidden' && (
        <p role="alert" className="px-10 py-8 text-body text-ink-muted">
          顧客台帳を見る権限がありません。お店の管理者にご確認ください。
        </p>
      )}
      {state === 'ready' && detail !== null && (
        <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
          <Identity detail={detail} />
          <div className="mt-7 flex min-w-0 flex-wrap gap-7">
            <div className="min-w-0 flex-1">
              <Prescriptions detail={detail} />
              <Glasses detail={detail} />
            </div>
            <div className="w-75 flex-none">
              <Attentions detail={detail} onOpenHandwriting={onOpenHandwriting} />
              <NextReservation detail={detail} />
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

/** 基本情報。箱で囲まず、間隔だけで束ねる（モックの `.who`）。 */
function Identity({ detail }: { detail: CustomerDetailShape }) {
  const attentions = publishedAttentions(detail.notes)
  const facts: readonly { term: string; value: string; mono?: boolean }[] = [
    {
      term: 'お電話',
      value: detail.phone === null ? 'ご登録がありません' : formatPhoneDigits(detail.phone),
      mono: detail.phone !== null,
    },
    { term: 'ご来店', value: visitLabel(detail.visitCount, 'list') },
    { term: '最後のご来店', value: lastVisitLabel(detail.lastVisitAt) },
    { term: 'よくご担当した者', value: detail.frequentStaffName ?? '—' },
  ]
  return (
    <section aria-label="基本情報" className="flex flex-wrap items-end gap-y-3">
      <div className="pr-2">
        {/* 画面の名前は上のバーが持つので、この面の見出しはお名前から始める。 */}
        <h2 className="text-hero font-bold text-ink">{`${detail.name} 様`}</h2>
        <p className="text-grid text-ink-muted">
          {`${detail.kana}　／　お客様番号 ${detail.customerNumber}`}
        </p>
      </div>
      {facts.map((fact) => (
        <dl key={fact.term} className="flex-none px-4">
          <dt className="text-grid whitespace-nowrap text-ink-muted">{fact.term}</dt>
          <dd
            className={cn(
              'mt-0.75 whitespace-nowrap text-body font-semibold text-ink',
              fact.mono === true && 'font-mono',
            )}
          >
            {fact.value}
          </dd>
        </dl>
      ))}
      {attentions.length > 0 && (
        <span className="ml-auto inline-flex min-h-5.5 items-center rounded-ctl border border-danger/40 bg-danger-soft px-2 text-note font-semibold text-danger">
          {`注意ごと ${attentions.length}件`}
        </span>
      )}
    </section>
  )
}

/** 度数の移り変わり。この面の主役の 1 枚。 */
function Prescriptions({ detail }: { detail: CustomerDetailShape }) {
  // 応答は新しい順で来るが、画面でも並べ直す（表の並びが応答の都合で入れ替わらない）。
  const rows = [...detail.prescriptions].sort((a, b) =>
    a.measuredAt === b.measuredAt ? 0 : a.measuredAt < b.measuredAt ? 1 : -1,
  )
  return (
    <section
      aria-label="度数の記録"
      className="rounded-panel border border-line bg-surface px-5.5 py-5"
    >
      <h3 className="mb-3.5 text-grid text-ink-muted">度数の移り変わり</h3>
      {rows.length === 0 ? (
        <>
          <p className="text-body text-ink">度数の記録はまだありません。</p>
          <p className="mt-2 text-grid text-ink-muted">
            ご予約を取って測定すると、ここに記録が残ります。
          </p>
        </>
      ) : (
        /* 200% 拡大で列が入らない日は、面ごとではなく表だけを横へ流す。 */
        <div className="overflow-x-auto">
          <table
            aria-label="度数の移り変わり"
            className="w-full border-collapse text-right whitespace-nowrap"
          >
            <thead className="sticky top-0 bg-surface">
              <tr>
                <th
                  scope="col"
                  className="border-line border-b px-1.5 py-3 text-left text-grid font-semibold text-ink-muted"
                >
                  測定日
                </th>
                {['右　球面・乱視・軸', '左　球面・乱視・軸', 'PD'].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="border-line border-b px-1.5 py-3 text-grid font-semibold text-ink-muted"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id}
                  className={cn(
                    row.isCurrent && 'font-semibold text-pine-deep',
                    !row.isCurrent && 'text-ink',
                  )}
                >
                  <td
                    className={cn(
                      'px-1.5 py-3 text-left text-body',
                      index < rows.length - 1 && 'border-line border-b',
                    )}
                  >
                    {/* 測定日と札は**縦に積む**。同じ行に並べると 1 列目が札のぶん広がり、
                        iPad 横（1194px）で「左」と「PD」の 2 列が器の外へ押し出されて
                        読めなくなる（度数は「…」で切ってよい文字ではない）。 */}
                    <span className="flex w-fit flex-col items-start gap-1">
                      <span>{lastVisitLabel(row.measuredAt)}</span>
                      {row.isCurrent && (
                        <span className="inline-flex min-h-5.5 items-center rounded-ctl border border-pine-line bg-pine-soft px-2 text-note font-semibold text-pine-deep">
                          いま使っています
                        </span>
                      )}
                    </span>
                  </td>
                  {[
                    { column: '右', value: eyeLabel(row.rSph, row.rCyl, row.rAxis) },
                    { column: '左', value: eyeLabel(row.lSph, row.lCyl, row.lAxis) },
                    { column: 'PD', value: pdLabel(row.pd) },
                  ].map((cell) => (
                    <td
                      key={cell.column}
                      className={cn(
                        'px-1.5 py-3 font-mono text-body',
                        index < rows.length - 1 && 'border-line border-b',
                      )}
                    >
                      {cell.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** いまお使いのメガネ。見出しの本数は `isCurrent` の行数と必ず一致させる。 */
function Glasses({ detail }: { detail: CustomerDetailShape }) {
  const worn = detail.glasses.filter((row) => row.isCurrent)
  return (
    <section aria-label="お使いのメガネ" className="mt-8">
      <h3 className="text-grid font-semibold text-ink-muted">
        {`いまお使いのメガネ　${worn.length}本`}
      </h3>
      {worn.length === 0 ? (
        <p className="mt-3 text-body text-ink-muted">ご登録がありません。</p>
      ) : (
        <ul aria-label="いまお使いのメガネ" className="mt-3.5">
          {worn.map((row) => (
            <li key={row.id} className="border-line border-t py-4 first:border-t-0">
              <p className="text-body font-semibold text-ink">{row.usageLabel}</p>
              <p className="mt-0.75 text-grid text-ink-muted">
                {`${lastVisitLabel(row.purchasedAt)} お渡し／${row.frameName}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** 注意ごと。行そのものが手書きメモの面への入口になる。 */
function Attentions({
  detail,
  onOpenHandwriting,
}: {
  detail: CustomerDetailShape
  onOpenHandwriting: (noteId: string) => void
}) {
  const attentions = publishedAttentions(detail.notes)
  return (
    <section
      aria-label="注意ごと"
      className="rounded-panel border border-danger/40 bg-danger-soft px-5.5 py-5"
    >
      <h3 className="text-grid font-semibold text-danger">{`注意ごと　${attentions.length}件`}</h3>
      {attentions.length === 0 ? (
        <p className="mt-2 text-body text-ink-muted">ありません。</p>
      ) : (
        <ul className="mt-2">
          {attentions.map((note) => {
            const { head, rest } = splitBody(note.body)
            return (
              <li
                key={note.id}
                className="border-danger/40 border-t pt-3 first:border-t-0 first:pt-0"
              >
                <button
                  type="button"
                  aria-label={`${head}　手書きメモを見る`}
                  onClick={() => onOpenHandwriting(note.id)}
                  className={cn('w-full rounded-ctl py-2 text-left', focusRing)}
                >
                  <span className="block text-body font-semibold text-ink">{head}</span>
                  {rest !== null && (
                    <span className="mt-1.5 block text-grid text-ink-muted">{rest}</span>
                  )}
                  <span className="mt-2 block min-h-6 text-grid font-semibold text-pine-deep">
                    手書きメモを見る<span aria-hidden="true"> ›</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** 次のご予約。日時は年から書く（詳細は 1 名の記録なので、年をまたぐ予定が普通にある）。 */
function NextReservation({ detail }: { detail: CustomerDetailShape }) {
  const next = detail.nextReservation
  return (
    <section
      aria-label="次のご予約"
      className="mt-2.5 rounded-panel border border-pine-line bg-pine-soft px-5.5 py-5"
    >
      <h3 className="text-grid font-semibold text-pine-deep">次のご予約</h3>
      {next === null ? (
        <p className="mt-2 text-body text-ink-muted">ご予約はありません。</p>
      ) : (
        <>
          <p className="mt-1.5 text-bar font-semibold text-ink">
            {`${dateLabel(toJstDateString(next.startsAt))}${jstClock(next.startsAt)}`}
          </p>
          <p className="mt-1.5 text-grid text-ink-muted">
            {`${next.purposeLabel}（約${next.durationMinutes}分）／担当 ${next.staffName ?? 'これから決めます'}`}
          </p>
        </>
      )}
    </section>
  )
}
