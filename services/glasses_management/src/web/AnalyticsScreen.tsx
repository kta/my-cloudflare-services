import {
  type AnalyticsGranularity,
  type AnalyticsMetric,
  type AnalyticsMetricValue,
  AnalyticsReport,
  type AnalyticsStageDistribution,
  type StorePermission,
} from '@app/contracts'
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
  VizPeriodField,
  VizPill,
  VizReport,
  VizSegment,
  VizSurface,
  VizTitleBar,
} from './design/analytics'
import { Action, Actions } from './design/controls'
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

/** 一番高い柱。抑制されて 0 に潰れた柱は山として扱わない。 */
function peakOf<T extends { label: string; valueText: string; percent: number }>(
  rows: T[],
): T | undefined {
  return rows.reduce<T | undefined>(
    (best, row) =>
      row.percent > 0 && (best === undefined || row.percent > best.percent) ? row : best,
    undefined,
  )
}

/**
 * 指標そのものを柱にする（取消・無断キャンセルのように、内訳ではなく
 * 「目標に対してどれだけか」を読む観点で使う）。
 *
 * 目標がある指標では、目標を 100 とせず「一番大きい値と目標の大きい方」を
 * 100 にする。目標を 100 にすると超過分が枠の外へ出て、どれだけ超えたのかが
 * 柱の高さから読めなくなる。
 */
function metricColumns(metrics: AnalyticsMetricValue[]): {
  rows: {
    label: string
    valueText: string
    percent: number
    tone: 'plain' | 'critical'
    exceedsTarget: boolean
  }[]
  target: { percent: number; label: string } | undefined
} {
  const targeted = metrics.find((metric) => metric.target !== null && !metric.suppressed)
  const ceiling = metrics.reduce(
    (max, metric) => Math.max(max, metric.suppressed ? 0 : (metric.value ?? 0)),
    targeted?.target ?? 0,
  )
  const percentOf = (value: number) => (ceiling > 0 ? Math.round((value / ceiling) * 100) : 0)
  return {
    rows: metrics.map((raw) => {
      const view = metricView(raw)
      const hidden = raw.suppressed || raw.value === null
      return {
        label: raw.label,
        valueText: view.valueText,
        percent: hidden ? 0 : percentOf(raw.value ?? 0),
        tone: raw.exceedsTarget ? ('critical' as const) : ('plain' as const),
        exceedsTarget: raw.exceedsTarget,
      }
    }),
    target:
      targeted === undefined || targeted.target === null
        ? undefined
        : { percent: percentOf(targeted.target), label: `店舗目標 ${targeted.target}件` },
  }
}

/*
 * 左列の 6 つ。承認済みモック `analytics-approved.html` の `.metriclist` と
 * 同じ順・同じ文言である。これは指標そのものではなく「見る観点」で、ひとつ
 * 選ぶと中央がその観点だけを掘り下げる。指標を全部縦に積むと、数字は並んで
 * いるのに「何を見ている面なのか」が消える。
 */
type SectionId = 'reservations' | 'wait' | 'stage' | 'cancel' | 'web' | 'quality'

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'reservations', label: '予約と来店' },
  { id: 'wait', label: '待ち時間' },
  { id: 'stage', label: '工程所要時間' },
  { id: 'cancel', label: '取消・無断キャンセル' },
  { id: 'web', label: 'Web予約' },
  { id: 'quality', label: '録音・運用品質' },
]

/** 観点ごとに掘り下げる指標。ここに無い指標はその観点では出さない。 */
const SECTION_METRICS: Record<SectionId, AnalyticsMetric[]> = {
  reservations: ['reservations', 'visits'],
  wait: [],
  stage: [],
  cancel: ['cancellations', 'no_shows'],
  web: [],
  quality: [],
}

const GRANULARITY_OPTIONS = GRANULARITIES.map((value) => ({
  value,
  label: granularityLabel(value),
}))

/** 観点ごとの工程分布。待ち時間と所要時間は同じ形なので、段だけを変える。 */
const SECTION_STAGE: Partial<Record<SectionId, AnalyticsStageDistribution['stage']>> = {
  wait: 'reception_to_service_start',
  stage: 'service_duration',
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
  const [section, setSection] = useState<SectionId>('reservations')

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
  const metrics = (report?.metrics ?? []).filter((raw) =>
    SECTION_METRICS[section].includes(raw.metric),
  )
  const stage = SECTION_STAGE[section]
  const distribution = stage
    ? report?.stageDistributions.find((raw) => raw.stage === stage)
    : undefined
  // 予約と来店の観点だけは、時間帯の内訳をそのまま柱に使う。モックの柱は
  // 「時間帯ごとの山」で、内訳の中でこれだけが横軸に順序を持つ。
  const hourBreakdown =
    section === 'reservations'
      ? report?.breakdowns.find((raw) => raw.dimension === 'hour')
      : undefined
  const otherBreakdowns = (report?.breakdowns ?? []).filter(
    (raw) => section === 'reservations' && raw.dimension !== 'hour',
  )
  const funnel = section === 'web' && report ? funnelView(report.funnel) : undefined
  /*
   * 点検欄は多くとも 3 枚（モックと同じ）。原因候補は今見ている観点のものだけを
   * 2 つまで出し、残りの 1 枚は必ず「対象データ」に使う。何件を数えて何件を
   * 除いたのかが読めない原因候補は、ただの当て推量になる。
   */
  const candidateGroups = report
    ? SECTION_METRICS[section]
        .map((metric) => ({
          label: report.metrics.find((raw) => raw.metric === metric)?.label ?? metric,
          items: causeCandidatesForMetric(report, metric),
        }))
        .filter((group) => group.items.length > 0)
    : []
  // 3 枚のうち 1 枚は必ず「対象データ」に使うので、候補は 2 つまで。
  let budget = 2

  return (
    /*
     * 骨格は承認済みモック `analytics-approved.html` の「運用診断」:
     * 左に観点、中央にその観点を掘り下げたレポート、右に確認すべき原因候補。
     */
    <VizSurface label="店舗運用の分析">
      <VizTitleBar title="店舗運用の分析">
        {/* モックの titlebar には期間ピルしかないが、期間を選ぶ手段はどこかに
            要る。ピルと同じ寸法・同じ淡い緑に収めて、帯を 1 段のまま保つ。 */}
        <VizSegment
          label="集計粒度"
          options={GRANULARITY_OPTIONS}
          value={granularity}
          onChange={(next) => {
            setGranularity(next as AnalyticsGranularity)
          }}
        />
        <VizPeriodField id="analytics-date" label="対象日" value={date} onChange={setDate} />
        {context && (
          <VizPill>
            <span>{context.periodText}</span>
            <span>{context.timezoneText}</span>
            <span>{`最終更新 ${context.lastUpdatedText}`}</span>
          </VizPill>
        )}
      </VizTitleBar>

      <VizBody>
        <VizMetricList>
          {SECTIONS.map((item) => (
            <VizMetricItem
              key={item.id}
              on={item.id === section}
              onClick={() => setSection(item.id)}
            >
              {item.label}
            </VizMetricItem>
          ))}
        </VizMetricList>

        <VizReport label="レポート">
          {/* 対象件数と比較対象は、どの観点を見ていても同じ場所に出る
              (AC-EYEX-49)。帯のピルに全部詰めると 58px の 1 段に収まらない。 */}
          {context && (
            <VizNote>
              <span>{context.totalCountText}</span>
              {'　'}
              <span>{`比較対象 ${context.previousPeriodText}`}</span>
            </VizNote>
          )}

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

          {metrics.map((raw, index) => {
            const metric = metricView(raw)
            /*
             * モックのレポート列は「大きい数字ひとつ」で始まる。観点に指標が
             * 2 つあっても大きい数字を 2 つ積むと、どちらを見ている面なのかが
             * 消えるので、2 つ目からは同じ内容を 1 行に畳んで置く。
             */
            const lead = index === 0
            return (
              <section key={metric.metric} aria-label={metric.label} className="mt-4.5">
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <h2 className="my-0 text-h3">{metric.label}</h2>
                  {metric.exceedsTarget && <VizFlag>目標超過</VizFlag>}
                  {!lead && <span className="text-viz-body">{metric.valueText}</span>}
                </div>
                <VizNote>{metric.definition}</VizNote>
                {lead && <VizFigure>{metric.valueText}</VizFigure>}
                <VizNote>{metric.comparisonText}</VizNote>
                <VizNote>{metric.targetText}</VizNote>
                {metric.suppressionNote && <VizNote>{metric.suppressionNote}</VizNote>}
              </section>
            )
          })}

          {/*
           * 目標がある観点は、指標そのものを柱にして目標線と並べる。ただし
           * その観点が既に自前の柱（内訳・分布・離脱）を持つときは足さない。
           * 1 つの観点に柱が 2 つ並ぶと、どちらを読む面なのかが消える。
           */}
          {hourBreakdown === undefined &&
            distribution === undefined &&
            funnel === undefined &&
            metrics.some((raw) => raw.target !== null) &&
            (() => {
              const columns = metricColumns(metrics)
              return (
                <section aria-label="目標との比較" className="mt-4.5">
                  <VizColumnChart
                    label="目標との比較"
                    rows={columns.rows}
                    target={columns.target}
                  />
                </section>
              )
            })()}

          {hourBreakdown &&
            (() => {
              const view = breakdownView(hourBreakdown)
              return (
                <section aria-label={`${view.label}の内訳`} className="mt-4.5">
                  {view.suppressionNote && <VizNote>{view.suppressionNote}</VizNote>}
                  <VizColumnChart
                    label={`${view.label}の内訳`}
                    rows={columnTones(
                      view.rows.map((row) => ({
                        label: row.label,
                        valueText: row.valueText,
                        percent: row.percent,
                      })),
                    )}
                  />
                  {/* `.finding` — 一番高い柱を文章で言い切る。原因は言わない。 */}
                  {peakOf(view.rows) && (
                    <VizFinding>
                      <b>{`最も多いのは${peakOf(view.rows)?.label}で ${peakOf(view.rows)?.valueText}`}</b>
                    </VizFinding>
                  )}
                </section>
              )
            })()}

          {distribution &&
            (() => {
              const view = distributionView(distribution)
              /*
               * 目標は分布そのものには無いので、90 パーセンタイルを目標線の
               * 代わりにはしない。線を引くのは店舗目標がある指標だけ。
               */
              return (
                <section aria-label={`${view.label} の分布`} className="mt-4.5">
                  <h2 className="my-0 text-h3">{view.label}</h2>
                  <VizNote>{view.definition}</VizNote>
                  <p className="my-0 text-viz-body">{view.summaryText}</p>
                  <VizNote>{view.sampleCountText}</VizNote>
                  {view.suppressionNote && <VizNote>{view.suppressionNote}</VizNote>}
                  {/*
                   * 分布の柱は「多い/少ない」であって良し悪しではない。一番高い
                   * バケットを赤で塗ると、ただの山が異常に見える。塗り分けるのは
                   * 目標を超えた柱だけなので、ここは一色で通す。
                   */}
                  <VizColumnChart
                    label={`${view.label} の分布`}
                    rows={view.rows.map((row) => ({ ...row, tone: 'plain' as const }))}
                  />
                  {peakOf(view.rows) && (
                    <VizFinding>
                      <b>{`最も多いのは${peakOf(view.rows)?.label}で ${peakOf(view.rows)?.valueText}`}</b>
                    </VizFinding>
                  )}
                </section>
              )
            })()}

          {otherBreakdowns.map((raw) => {
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

          {funnel && (
            <section aria-label="Web予約の離脱" className="mt-4.5">
              <h2 className="my-0 text-h3">Web予約の離脱</h2>
              <VizNote>{funnel.sessionCountText}</VizNote>
              {funnel.suppressionNote && <VizNote>{funnel.suppressionNote}</VizNote>}
              <VizColumnChart
                label="Web予約の離脱"
                rows={funnel.steps.map((step) => ({
                  label: step.label,
                  valueText: step.countText,
                  percent: step.percent,
                  tone: 'plain' as const,
                  noteText: step.dropText,
                }))}
              />
              {/* `.finding` — 一番大きい離脱を文章で言い切る。 */}
              <VizFinding>
                <b>{funnel.largestDropText}</b>
              </VizFinding>
            </section>
          )}

          {section === 'quality' && report && (
            <>
              <section aria-label="運用品質の警告" className="mt-4.5">
                <h2 className="my-0 text-h3">運用品質の警告</h2>
                {report.qualityWarnings.length === 0 && (
                  <VizNote>この期間に運用品質の警告はありません。</VizNote>
                )}
                {report.qualityWarnings.map((warning) => (
                  <VizFinding key={warning.code}>
                    <b className="block">{`${warning.count}件`}</b>
                    <span className="block">{warning.message}</span>
                    <span className="block text-viz-ink-muted">{warning.nextAction}</span>
                  </VizFinding>
                ))}
              </section>
              {/* 除外は品質と同じ観点に置く。何を数えなかったのかを知らずに
                  警告だけ読んでも、件数の意味が決まらない (AC-EYEX-54)。 */}
              <section aria-label="除外したデータ" className="mt-4.5">
                <h2 className="my-0 text-h3">除外したデータ</h2>
                {report.exclusions.length === 0 && (
                  <VizNote>この期間に除外した来店はありません。</VizNote>
                )}
                {report.exclusions.map((exclusion) => (
                  <VizFinding key={exclusion.reason}>
                    <b className="block">{`${exclusion.count}件`}</b>
                    <span className="block">{exclusion.description}</span>
                    <span className="block text-viz-ink-muted">{exclusion.caveat}</span>
                  </VizFinding>
                ))}
              </section>
            </>
          )}
        </VizReport>

        <VizInspector>
          {candidateGroups.map((group) => {
            const shown = group.items.slice(0, budget)
            budget -= shown.length
            if (shown.length === 0) return null
            return (
              <section key={group.label} aria-label={`${group.label}の原因候補`}>
                <p className="mb-2 text-viz-fine text-viz-ink-muted">
                  原因を断定するものではありません。根拠件数とあわせて確認してください。
                </p>
                {shown.map((candidate) => (
                  <VizCard key={candidate.code} title={candidate.hypothesis}>
                    {/* 件数は数字だが、和文と続けて読む 1 行なので等幅にしない。 */}
                    <span className="block">{`根拠件数 ${candidate.evidenceCount}件`}</span>
                    <span className="block">{`確認対象: ${candidate.inspectionTarget}`}</span>
                  </VizCard>
                ))}
              </section>
            )
          })}

          {context && report && (
            <VizCard title="対象データ">
              <span className="block">
                {`来店${report.totalCount}件 / 除外${report.exclusions.reduce(
                  (total, item) => total + item.count,
                  0,
                )}件`}
              </span>
              {/* `.definition` は指標定義。ここに重ねると同じ文が 2 度出るので、
                  定義は指標ごとの数字の隣に置いたままにする。 */}
              <VizDefinition>
                {`${report.timezone} · 抑制された値は「非表示」とだけ表示します。`}
              </VizDefinition>
            </VizCard>
          )}
        </VizInspector>
      </VizBody>
    </VizSurface>
  )
}
