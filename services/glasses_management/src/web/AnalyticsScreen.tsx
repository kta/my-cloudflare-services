import { type AnalyticsGranularity, AnalyticsReport, type StorePermission } from '@app/contracts'
import { Button, Chip, Notice, Select, TextInput } from '@app/ui'
import { type CSSProperties, useCallback, useEffect, useState } from 'react'
import { PermissionDenied } from './admin-chrome'
import {
  breakdownView,
  causeCandidatesForMetric,
  distributionView,
  funnelView,
  granularityLabel,
  metricView,
  reportContext,
  statusGuidance,
} from './analytics-view'
import type { StaffScreenProps } from './staff-screen'

type Props = StaffScreenProps & {
  permissions: StorePermission[]
  /** JST `YYYY-MM-DD`, injected: a screen never reads the clock itself. */
  today: string
  /** Injected instant, for the same reason. */
  now: string
}

const GRANULARITIES: AnalyticsGranularity[] = ['day', 'week', 'month']

const LOAD_FAILURE =
  '集計を読み込めませんでした。通信を確認してもう一度お試しください。数値は表示していません。'

/** 承認済みモック `analytics-approved.html` の 3 列: 220px / 1fr / 275px。 */
const DIAGNOSIS_COLUMNS: CSSProperties = { gridTemplateColumns: '220px 1fr 275px' }

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/**
 * A bar is decoration only. Every bar in this screen sits next to its own label
 * and its own number, so the chart never carries meaning by colour or length
 * alone, and a suppressed row is drawn at zero width — a residual width would
 * leak the magnitude the server decided to hide (AC-EYEX-119).
 */
function Bar({ percent }: { percent: number }) {
  return (
    <div aria-hidden="true" className="h-2 w-full rounded-full bg-line">
      <div data-bar className="h-2 rounded-full bg-pine" style={{ width: `${percent}%` }} />
    </div>
  )
}

/**
 * モックの `.bars` — 縦の柱。突出した 1 本を danger、その次を amber で染めるが、
 * 色はあくまで補強で、どの柱にもラベルと件数が文字で付く。抑制された柱は幅も
 * 高さも 0 にする（どちらか一方でも残ると隠した大きさが読めてしまう）。
 */
function ColumnChart({ rows }: { rows: { label: string; valueText: string; percent: number }[] }) {
  const sorted = [...rows].map((row) => row.percent).sort((left, right) => right - left)
  const highest = sorted[0] ?? 0
  const second = sorted[1] ?? 0
  return (
    <ul className="flex h-48 items-end gap-3.5 border-line border-b px-5 pt-3">
      {rows.map((row) => {
        const tone =
          row.percent > 0 && row.percent === highest
            ? 'bg-danger'
            : row.percent > 0 && row.percent === second
              ? 'bg-amber'
              : 'bg-pine'
        return (
          <li key={row.label} className="flex h-full flex-1 flex-col justify-end gap-1">
            <span className="text-center font-sans text-ink text-xs tabular-nums">
              {row.valueText}
            </span>
            <div className="flex h-full items-end">
              <div
                data-bar
                aria-hidden="true"
                className={`w-full rounded-t-ctl ${tone}`}
                style={{
                  height: `${row.percent}%`,
                  width: row.percent === 0 ? '0%' : '100%',
                }}
              />
            </div>
            <span className="text-center font-sans text-ink text-xs">{row.label}</span>
          </li>
        )
      })}
    </ul>
  )
}

function BarRows({
  rows,
}: {
  rows: { key: string; label: string; valueText: string; percent: number }[]
}) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-sans text-ink text-sm">{row.label}</span>
            <span className="font-sans text-ink text-sm tabular-nums">{row.valueText}</span>
          </div>
          <Bar percent={row.percent} />
        </li>
      ))}
    </ul>
  )
}

function SectionTitle({ children }: { children: string }) {
  return <h2 className="font-display font-semibold text-ink text-lg">{children}</h2>
}

/** モックの `.card` — インスペクタ側の小カード。 */
function InspectorCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={title}
      className="mb-2.5 rounded-card border border-line bg-surface p-3 font-sans text-ink text-sm"
    >
      <p className="font-bold">{title}</p>
      {children}
    </section>
  )
}

/**
 * 店舗運用の分析 (UC-EYEX-099〜108, 180 / AC-EYEX-49〜55, 119).
 *
 * 骨格は承認済みモック `analytics-approved.html` の「運用診断」: 左に指標、
 * 中央に一つの指標を掘り下げたレポート、右に確認すべき原因候補。
 *
 * この画面の約束は二つ。数字は必ず「対象期間・JST・最終更新・対象件数・指標定義」
 * と一緒に出ること、そしてサーバが抑制した値は文字列 `非表示` 以外の形で画面に
 * 現れないこと。割合・差分・棒の長さのどれか一つでも残ると、合計から引いて
 * 個人が復元できてしまう。
 */
export function AnalyticsScreen({ storeId, api, permissions, today, navigate }: Props) {
  const mayRead = permissions.includes('analytics.read')
  const [granularity, setGranularity] = useState<AnalyticsGranularity>('day')
  const [date, setDate] = useState(today)
  const [report, setReport] = useState<AnalyticsReport>()
  const [failed, setFailed] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const [selectedMetric, setSelectedMetric] = useState<string>()

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  useEffect(() => {
    if (!mayRead) return undefined
    let active = true
    // 店舗や期間が変われば、まず古い数字を捨てる。前の店舗の値が一瞬でも
    // 残ると、それは別店舗の明細を混ぜたことになる (AC-EYEX-55)。
    setReport(undefined)
    setFailed(false)
    void (async () => {
      const query = new URLSearchParams({ granularity, date })
      try {
        const response = await api(
          `/api/staff/stores/${encodeURIComponent(storeId)}/analytics?${query.toString()}`,
        )
        const parsed = response.ok ? AnalyticsReport.safeParse(await readJson(response)) : undefined
        if (!active) return
        if (parsed?.success) setReport(parsed.data)
        else setFailed(true)
      } catch {
        if (active) setFailed(true)
      }
    })()
    return () => {
      active = false
    }
  }, [api, storeId, granularity, date, mayRead, reloadToken])

  // 権限が無い操作者には、集計の存在も内容もこれ以上見せない
  // (`exception-states-approved.html#permission-denied`)。
  if (!mayRead) return <PermissionDenied onReturnHome={() => navigate({ screen: 'home' })} />

  const context = report ? reportContext(report) : undefined
  const guidance = report ? statusGuidance(report) : undefined
  const activeMetric = selectedMetric ?? report?.metrics[0]?.metric
  // 選んだ指標を先頭へ。モックは一つの指標を掘り下げる画面なので、
  // 選択がレポート列の一番上に来ないと「どれを見ているか」が読めない。
  const orderedMetrics = [...(report?.metrics ?? [])].sort((left, right) =>
    left.metric === activeMetric ? -1 : right.metric === activeMetric ? 1 : 0,
  )

  return (
    <section aria-label="店舗運用の分析" className="flex min-h-full flex-col bg-paper">
      {/* モックの `.titlebar` — 見出しと、右端の期間ピル。 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-line border-b bg-surface px-4.5 py-3">
        <h1 className="font-display font-semibold text-ink text-xl">店舗運用の分析</h1>
        {/* モックの titlebar には期間ピルしかないが、期間を選ぶ手段はどこかに
            要る。レポート列を数字から始めたいので、ここへ小さく置く。 */}
        <div className="ml-auto flex items-center gap-3">
          <div className="w-20">
            <Select
              id="analytics-granularity"
              aria-label="集計粒度"
              className="min-h-11"
              value={granularity}
              onChange={(event) => {
                setGranularity(event.target.value as AnalyticsGranularity)
              }}
            >
              {GRANULARITIES.map((value) => (
                <option key={value} value={value}>
                  {granularityLabel(value)}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-40">
            <TextInput
              id="analytics-date"
              aria-label="対象日"
              type="date"
              className="min-h-11"
              value={date}
              onChange={(event) => {
                setDate(event.target.value)
              }}
            />
          </div>
        </div>
        {context && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-pill bg-pine-soft px-3 py-1.5 font-sans text-pine text-xs">
            <span>{context.periodText}</span>
            <span>{context.timezoneText}</span>
            <span>{`最終更新 ${context.lastUpdatedText}`}</span>
            <span>{context.totalCountText}</span>
            <span>{`比較対象 ${context.previousPeriodText}`}</span>
          </p>
        )}
      </div>

      <div style={DIAGNOSIS_COLUMNS} className="grid min-h-0 flex-1">
        {/* モックの `.metriclist` */}
        <nav aria-label="指標" className="flex flex-col gap-1 bg-panel p-3.5">
          {report?.metrics.map((raw) => {
            const on = raw.metric === activeMetric
            return (
              <button
                key={raw.metric}
                type="button"
                aria-current={on ? 'page' : undefined}
                className={`min-h-11 rounded-ctl p-2.5 text-left font-sans text-ink text-sm ${
                  on ? 'bg-surface font-bold text-pine' : ''
                }`}
                onClick={() => setSelectedMetric(raw.metric)}
              >
                {raw.label}
              </button>
            )
          })}
        </nav>

        {/* モックの `.report` */}
        <div className="flex min-w-0 flex-col gap-4.5 overflow-auto p-4.5">
          {failed && (
            <>
              <Notice tone="danger">{LOAD_FAILURE}</Notice>
              <div>
                <Button type="button" className="min-h-12" onClick={reload}>
                  再試行する
                </Button>
              </div>
            </>
          )}

          {guidance && (
            <Notice tone={report?.status === 'failed' ? 'danger' : 'info'}>
              <span className="block">{guidance.reason}</span>
              <span className="block">{guidance.nextAction}</span>
            </Notice>
          )}

          {orderedMetrics.map((raw) => {
            const metric = metricView(raw)
            return (
              <section
                key={metric.metric}
                aria-label={metric.label}
                className="flex flex-col gap-1"
              >
                <div className="flex flex-wrap items-baseline gap-3">
                  <h2 className="font-display font-semibold text-ink text-lg">{metric.label}</h2>
                  {metric.exceedsTarget && <Chip tone="warning">目標超過</Chip>}
                </div>
                <p className="font-sans text-ink-muted text-xs">{metric.definition}</p>
                {/* モックの `.big` — 見出しより大きい等幅の数字ひとつ。 */}
                <p className="font-display font-semibold text-3xl text-pine tabular-nums">
                  {metric.valueText}
                </p>
                <p className="font-sans text-ink-muted text-sm">{metric.comparisonText}</p>
                <p className="font-sans text-ink-muted text-sm">{metric.targetText}</p>
                {metric.suppressionNote && (
                  <p className="font-sans text-amber text-sm">{metric.suppressionNote}</p>
                )}
              </section>
            )
          })}

          {report?.stageDistributions.map((raw) => {
            const distribution = distributionView(raw)
            return (
              <section
                key={distribution.stage}
                aria-label={`${distribution.label} の分布`}
                className="flex flex-col gap-3"
              >
                <SectionTitle>{distribution.label}</SectionTitle>
                <p className="font-sans text-ink-muted text-xs">{distribution.definition}</p>
                <p className="font-sans text-ink text-sm tabular-nums">
                  {distribution.summaryText}
                </p>
                <p className="font-sans text-ink-muted text-sm">{distribution.sampleCountText}</p>
                {distribution.suppressionNote && (
                  <p className="font-sans text-amber text-sm">{distribution.suppressionNote}</p>
                )}
                <ColumnChart rows={distribution.rows} />
              </section>
            )
          })}

          {report?.breakdowns.map((raw) => {
            const breakdown = breakdownView(raw)
            return (
              <section
                key={`${breakdown.dimension}-${raw.metric}`}
                aria-label={`${breakdown.label}の内訳`}
                className="flex flex-col gap-3"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <SectionTitle>{breakdown.label}</SectionTitle>
                  {breakdown.suppressed && <Chip tone="warning">非表示</Chip>}
                </div>
                {breakdown.suppressionNote && (
                  <p className="font-sans text-amber text-sm">{breakdown.suppressionNote}</p>
                )}
                <BarRows rows={breakdown.rows} />
              </section>
            )
          })}

          {report && (
            <section aria-label="Web予約の離脱" className="flex flex-col gap-3">
              <SectionTitle>Web予約の離脱</SectionTitle>
              {(() => {
                const funnel = funnelView(report.funnel)
                return (
                  <>
                    <p className="font-sans text-ink-muted text-sm">{funnel.sessionCountText}</p>
                    {/* モックの `.finding` — 一番大きい離脱を文章で言い切る。 */}
                    <p className="rounded-card border border-line bg-surface p-3 font-sans font-bold text-ink text-sm">
                      {funnel.largestDropText}
                    </p>
                    {funnel.suppressionNote && (
                      <p className="font-sans text-amber text-sm">{funnel.suppressionNote}</p>
                    )}
                    <ul className="flex flex-col gap-3">
                      {funnel.steps.map((step) => (
                        <li key={step.stage} className="flex flex-col gap-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="font-sans text-ink text-sm">{step.label}</span>
                            <span className="font-sans text-ink text-sm tabular-nums">
                              {step.countText}
                            </span>
                            <span className="font-sans text-ink-muted text-sm tabular-nums">
                              {step.dropText}
                            </span>
                          </div>
                          <Bar percent={step.percent} />
                        </li>
                      ))}
                    </ul>
                  </>
                )
              })()}
            </section>
          )}
        </div>

        {/* モックの `.inspector` — 断定しない原因候補と、対象データの定義。 */}
        <aside
          aria-label="確認すること"
          className="overflow-auto border-line border-l bg-panel p-3.75"
        >
          <h2 className="mb-2.5 font-display font-semibold text-ink text-base">確認すること</h2>
          {report?.metrics.map((raw) => {
            const candidates = causeCandidatesForMetric(report, raw.metric)
            if (candidates.length === 0) return null
            return (
              <section key={raw.metric} aria-label={`${raw.label}の原因候補`}>
                <p className="mb-2 font-sans text-ink-muted text-xs">
                  原因を断定するものではありません。根拠件数とあわせて確認してください。
                </p>
                {candidates.map((candidate) => (
                  <InspectorCard key={candidate.code} title={candidate.hypothesis}>
                    <span className="block font-sans tabular-nums">{`根拠件数 ${candidate.evidenceCount}件`}</span>
                    <span className="block">{`確認対象: ${candidate.inspectionTarget}`}</span>
                  </InspectorCard>
                ))}
              </section>
            )
          })}

          {context && (
            <InspectorCard title="対象データ">
              <span className="block">
                {`来店${report?.totalCount ?? 0}件 / 除外${
                  report?.exclusions.reduce((total, item) => total + item.count, 0) ?? 0
                }件`}
              </span>
              {/* モックの `.definition` は指標定義。ここに重ねると同じ文が 2 度
                  出るので、定義は指標ごとの数字の隣に置いたままにする。 */}
              <span className="mt-2 block border-line border-t pt-2 text-ink-muted text-xs">
                {`${report?.timezone ?? 'Asia/Tokyo'} · 抑制された値は「非表示」とだけ表示します。`}
              </span>
            </InspectorCard>
          )}

          {report && report.exclusions.length > 0 && (
            <section aria-label="除外したデータ">
              {report.exclusions.map((exclusion) => (
                <InspectorCard key={exclusion.reason} title={`${exclusion.count}件`}>
                  <span className="block">{exclusion.description}</span>
                  <span className="mt-2 block border-line border-t pt-2 text-ink-muted text-xs">
                    {exclusion.caveat}
                  </span>
                </InspectorCard>
              ))}
            </section>
          )}

          {report && report.qualityWarnings.length > 0 && (
            <section aria-label="運用品質の警告">
              {report.qualityWarnings.map((warning) => (
                <InspectorCard key={warning.code} title={`${warning.count}件`}>
                  <span className="block">{warning.message}</span>
                  <span className="mt-2 block border-line border-t pt-2 text-ink-muted text-xs">
                    {warning.nextAction}
                  </span>
                </InspectorCard>
              ))}
            </section>
          )}
        </aside>
      </div>
    </section>
  )
}
