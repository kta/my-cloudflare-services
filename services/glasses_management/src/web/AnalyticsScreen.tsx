import { type AnalyticsGranularity, AnalyticsReport, type StorePermission } from '@app/contracts'
import { useCallback, useEffect, useState } from 'react'
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
import {
  VizBar,
  VizBody,
  VizCard,
  VizColumnChart,
  VizDefinition,
  VizFigure,
  VizFinding,
  VizFlag,
  VizInspector,
  VizMetricItem,
  VizMetricList,
  VizNote,
  VizPill,
  VizReport,
  VizSurface,
  VizTitleBar,
} from './design/analytics'
import { Action, Actions } from './design/controls'
import { SelectField, TextField } from './design/forms'
import { FailureNotice, StatusNotice } from './design/notices'
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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/** 突出した 1 本を critical、その次を warn に染める（`analytics-approved.html`）。 */
function columnTones(
  rows: { label: string; valueText: string; percent: number }[],
): { label: string; valueText: string; percent: number; tone: 'plain' | 'warn' | 'critical' }[] {
  const sorted = rows.map((row) => row.percent).sort((left, right) => right - left)
  const highest = sorted[0] ?? 0
  const second = sorted[1] ?? 0
  return rows.map((row) => ({
    ...row,
    tone:
      row.percent > 0 && row.percent === highest
        ? 'critical'
        : row.percent > 0 && row.percent === second
          ? 'warn'
          : 'plain',
  }))
}

/** 横棒の並び。長さは補強で、どの行にもラベルと数値が文字で並ぶ。 */
function BarRows({
  rows,
}: {
  rows: { key: string; label: string; valueText: string; percent: number }[]
}) {
  return (
    <ul className="mt-2.5 flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="flex items-baseline justify-between gap-3 text-viz-body">
            <span>{row.label}</span>
            <span>{row.valueText}</span>
          </div>
          <VizBar percent={row.percent} />
        </li>
      ))}
    </ul>
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
    /*
     * 骨格は承認済みモック `analytics-approved.html` の「運用診断」:
     * 左に指標、中央に一つの指標を掘り下げたレポート、右に確認すべき原因候補。
     */
    <VizSurface label="店舗運用の分析">
      <VizTitleBar title="店舗運用の分析">
        {/* モックの titlebar には期間ピルしかないが、期間を選ぶ手段はどこかに
            要る。レポート列を数字から始めたいので、ここへ小さく置く。 */}
        <div className="flex items-center gap-3">
          <SelectField
            hideLabel
            id="analytics-granularity"
            label="集計粒度"
            className="w-24"
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
          </SelectField>
          <TextField
            hideLabel
            id="analytics-date"
            label="対象日"
            type="date"
            className="w-44"
            value={date}
            onChange={(event) => {
              setDate(event.target.value)
            }}
          />
        </div>
        {context && (
          <VizPill>
            <span>{context.periodText}</span>
            <span>{context.timezoneText}</span>
            <span>{`最終更新 ${context.lastUpdatedText}`}</span>
            <span>{context.totalCountText}</span>
            <span>{`比較対象 ${context.previousPeriodText}`}</span>
          </VizPill>
        )}
      </VizTitleBar>

      <VizBody>
        <VizMetricList>
          {report?.metrics.map((raw) => (
            <VizMetricItem
              key={raw.metric}
              on={raw.metric === activeMetric}
              onClick={() => setSelectedMetric(raw.metric)}
            >
              {raw.label}
            </VizMetricItem>
          ))}
        </VizMetricList>

        <VizReport label="レポート">
          {failed && (
            <>
              <FailureNotice>{LOAD_FAILURE}</FailureNotice>
              <Actions>
                <Action inset="tight" onClick={reload}>
                  再試行する
                </Action>
              </Actions>
            </>
          )}

          {guidance &&
            /* 失敗は割り込ませ、まだ集計中なだけの案内は割り込ませない。 */
            (report?.status === 'failed' ? (
              <FailureNotice>
                <span className="block">{guidance.reason}</span>
                <span className="block">{guidance.nextAction}</span>
              </FailureNotice>
            ) : (
              <StatusNotice>
                <span className="block">{guidance.reason}</span>
                <span className="block">{guidance.nextAction}</span>
              </StatusNotice>
            ))}

          {orderedMetrics.map((raw) => {
            const metric = metricView(raw)
            return (
              <section key={metric.metric} aria-label={metric.label} className="mt-4.5">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <h2 className="my-0 text-h3">{metric.label}</h2>
                  {metric.exceedsTarget && <VizFlag>目標超過</VizFlag>}
                </div>
                <VizNote>{metric.definition}</VizNote>
                <VizFigure>{metric.valueText}</VizFigure>
                <VizNote>{metric.comparisonText}</VizNote>
                <VizNote>{metric.targetText}</VizNote>
                {metric.suppressionNote && <VizNote>{metric.suppressionNote}</VizNote>}
              </section>
            )
          })}

          {report?.stageDistributions.map((raw) => {
            const distribution = distributionView(raw)
            return (
              <section
                key={distribution.stage}
                aria-label={`${distribution.label} の分布`}
                className="mt-4.5"
              >
                <h2 className="my-0 text-h3">{distribution.label}</h2>
                <VizNote>{distribution.definition}</VizNote>
                <p className="my-0 text-viz-body">{distribution.summaryText}</p>
                <VizNote>{distribution.sampleCountText}</VizNote>
                {distribution.suppressionNote && <VizNote>{distribution.suppressionNote}</VizNote>}
                <VizColumnChart rows={columnTones(distribution.rows)} />
              </section>
            )
          })}

          {report?.breakdowns.map((raw) => {
            const breakdown = breakdownView(raw)
            return (
              <section
                key={`${breakdown.dimension}-${raw.metric}`}
                aria-label={`${breakdown.label}の内訳`}
                className="mt-4.5"
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2 className="my-0 text-h3">{breakdown.label}</h2>
                  {breakdown.suppressed && <VizFlag>非表示</VizFlag>}
                </div>
                {breakdown.suppressionNote && <VizNote>{breakdown.suppressionNote}</VizNote>}
                <BarRows rows={breakdown.rows} />
              </section>
            )
          })}

          {report && (
            <section aria-label="Web予約の離脱" className="mt-4.5">
              <h2 className="my-0 text-h3">Web予約の離脱</h2>
              {(() => {
                const funnel = funnelView(report.funnel)
                return (
                  <>
                    <VizNote>{funnel.sessionCountText}</VizNote>
                    {/* `.finding` — 一番大きい離脱を文章で言い切る。 */}
                    <VizFinding>
                      <b>{funnel.largestDropText}</b>
                    </VizFinding>
                    {funnel.suppressionNote && <VizNote>{funnel.suppressionNote}</VizNote>}
                    <ul className="mt-2.5 flex flex-col gap-2.5">
                      {funnel.steps.map((step) => (
                        <li key={step.stage}>
                          <div className="flex items-baseline justify-between gap-3 text-viz-body">
                            <span>{step.label}</span>
                            <span>{step.countText}</span>
                            <span className="text-viz-ink-muted">{step.dropText}</span>
                          </div>
                          <VizBar percent={step.percent} />
                        </li>
                      ))}
                    </ul>
                  </>
                )
              })()}
            </section>
          )}
        </VizReport>

        <VizInspector>
          {report?.metrics.map((raw) => {
            const candidates = causeCandidatesForMetric(report, raw.metric)
            if (candidates.length === 0) return null
            return (
              <section key={raw.metric} aria-label={`${raw.label}の原因候補`}>
                <p className="mb-2 text-viz-fine text-viz-ink-muted">
                  原因を断定するものではありません。根拠件数とあわせて確認してください。
                </p>
                {candidates.map((candidate) => (
                  <VizCard key={candidate.code} title={candidate.hypothesis}>
                    {/* 件数は数字だが、和文と続けて読む 1 行なので等幅にしない。 */}
                    <span className="block">{`根拠件数 ${candidate.evidenceCount}件`}</span>
                    <span className="block">{`確認対象: ${candidate.inspectionTarget}`}</span>
                  </VizCard>
                ))}
              </section>
            )
          })}

          {context && (
            <VizCard title="対象データ">
              <span className="block">
                {`来店${report?.totalCount ?? 0}件 / 除外${
                  report?.exclusions.reduce((total, item) => total + item.count, 0) ?? 0
                }件`}
              </span>
              {/* `.definition` は指標定義。ここに重ねると同じ文が 2 度出るので、
                  定義は指標ごとの数字の隣に置いたままにする。 */}
              <VizDefinition>
                {`${report?.timezone ?? 'Asia/Tokyo'} · 抑制された値は「非表示」とだけ表示します。`}
              </VizDefinition>
            </VizCard>
          )}

          {report && report.exclusions.length > 0 && (
            <section aria-label="除外したデータ">
              {report.exclusions.map((exclusion) => (
                <VizCard key={exclusion.reason} title={`${exclusion.count}件`}>
                  <span className="block">{exclusion.description}</span>
                  <VizDefinition>{exclusion.caveat}</VizDefinition>
                </VizCard>
              ))}
            </section>
          )}

          {report && report.qualityWarnings.length > 0 && (
            <section aria-label="運用品質の警告">
              {report.qualityWarnings.map((warning) => (
                <VizCard key={warning.code} title={`${warning.count}件`}>
                  <span className="block">{warning.message}</span>
                  <VizDefinition>{warning.nextAction}</VizDefinition>
                </VizCard>
              ))}
            </section>
          )}
        </VizInspector>
      </VizBody>
    </VizSurface>
  )
}
