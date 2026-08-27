import type { ReactNode } from 'react'

/*
 * ANALYTICS — 承認済みモック `analytics-approved.html`。
 *
 * このモックだけ別の寸法体系で描かれている。他の面はバー 76px・本文 16px だが、
 * ここはステータスバー 25px + バー 67px、本文 10〜11px で、緑も #286b55、
 * 罫線も #d7ded9 と僅かに違う。数字を一度に多く並べる面なので、業務面より
 * 一段小さく組まれている。色と寸法は `--*-viz-*` トークンへ分けて持つ。
 *
 *   .status{height:25px;padding:5px 16px;background:#fbfcfb;font:600 10px 'IBM Plex Mono'}
 *   .bar{height:67px;background:var(--g);padding:0 18px;gap:10px}
 *   .brand{font-size:18px;font-weight:700}
 *   .brand small{display:block;font-size:10px;font-weight:400}
 *   .nav{height:42px;padding:0 11px;border-radius:8px;color:#d9ebe3}
 *   .nav.on{background:#fff;color:var(--g);font-weight:700}
 *   .titlebar{height:58px;padding:0 18px;border-bottom:1px solid var(--l);background:#fff}
 *   .titlebar h3{font-size:18px}
 *   .pill{margin-left:auto;padding:6px 9px;border-radius:15px}
 *   .diagnosis{grid-template-rows:58px 1fr}
 *   .diagbody{grid-template-columns:220px 1fr 275px}
 *   .metriclist{padding:14px;background:#e9eeeb}
 *   .metric{padding:11px;border-radius:8px;font-size:11px}
 *   .report{padding:18px}
 *   .big{font:600 32px 'IBM Plex Mono';color:var(--g)}
 *   .bars{height:190px;gap:13px;padding:12px 20px;border-bottom:1px solid #aebcb4}
 *   .barcol{flex:1;border-radius:5px 5px 0 0}
 *   .barcol span{position:absolute;bottom:-25px;font-size:9px}
 *   .finding{margin-top:36px;padding:13px;font-size:11px}
 *   .inspector{border-left:1px solid var(--l);padding:15px;background:#f0f2ef}
 *   .card{padding:12px;margin-bottom:10px;font-size:10px;line-height:1.6}
 *   .definition{font-size:9px;padding-top:9px;border-top:1px solid #e5eae7}
 *
 * 指標をひとつだけ選ばせ、時間帯まで割ってから「確認すること」を並べる。
 * 数字の隣に原因候補が無いと、待ち時間が長い日が「忙しかった」で終わる。
 */

/** 時間帯ごとの待ち時間。目標を超えた 2 本だけ色を変える（`--co` / `--amber`）。 */
const HOURS: { label: string; height: string; tone: 'plain' | 'warn' | 'critical' }[] = [
  { label: '10時', height: '38%', tone: 'plain' },
  { label: '11時', height: '52%', tone: 'plain' },
  { label: '12時', height: '34%', tone: 'plain' },
  { label: '13時', height: '78%', tone: 'warn' },
  { label: '14時', height: '93%', tone: 'critical' },
  { label: '15時', height: '61%', tone: 'plain' },
  { label: '16時', height: '45%', tone: 'plain' },
]

const BAR_TONE = {
  plain: 'bg-viz-bar',
  warn: 'bg-viz-warn',
  critical: 'bg-viz-critical',
} as const

const METRICS = [
  '予約と来店',
  '待ち時間',
  '工程所要時間',
  '取消・無断キャンセル',
  'Web予約',
  '録音・運用品質',
]

export default function Analytics() {
  return (
    /*
     * このモックの body は `font-family` しか書いておらず、行間はブラウザ既定の
     * `normal` のまま。アプリの土台は本文 1.5 なので、この面だけ戻す。
     * 1.5 のままだと 10〜11px の行が 1px ずつ伸び、右の点検欄が下へ流れる。
     */
    <div
      className="flex h-dvh min-h-0 flex-col bg-viz-paper font-sans text-viz-ink"
      style={{ lineHeight: 'normal' }}
    >
      <div
        className="flex shrink-0 justify-between bg-viz-status px-4 py-1.25 font-figure font-semibold text-viz-note"
        style={{ height: '25px' }}
      >
        <span>9:41</span>
        <span>Wi‑Fi　● 100%</span>
      </div>

      <header
        className="flex shrink-0 items-center gap-2.5 bg-viz-pine px-4.5 text-on-pine"
        style={{ height: '67px' }}
      >
        <p className="font-bold text-lead">
          EYEX予約
          <small className="block font-normal text-viz-note">銀座店　⌄</small>
        </p>
        {['予約台帳', '来店受付', '分析'].map((tab) => {
          const on = tab === '分析'
          return (
            <button
              key={tab}
              type="button"
              aria-current={on ? 'page' : undefined}
              className={`rounded-ctl px-2.75 text-body ${
                on ? 'bg-surface font-bold text-viz-pine' : 'bg-transparent text-viz-on-pine-muted'
              }`}
              style={{ height: '42px' }}
            >
              {tab}
            </button>
          )
        })}
      </header>

      <main className="grid min-h-0 flex-1" style={{ gridTemplateRows: '58px 1fr' }}>
        <div className="flex items-center border-viz-line border-b bg-surface px-4.5">
          <h1 className="text-lead">店舗運用の分析</h1>
          <span className="ml-auto rounded-full bg-viz-pine-soft px-2.25 py-1.5 text-viz-note text-viz-pine">
            8月1日〜8月25日 · JST · 10:15更新
          </span>
        </div>

        <div className="grid min-h-0" style={{ gridTemplateColumns: '220px 1fr 275px' }}>
          <nav aria-label="指標" className="min-h-0 overflow-auto bg-viz-panel p-3.5">
            {METRICS.map((metric) => {
              const on = metric === '待ち時間'
              return (
                <div
                  key={metric}
                  aria-current={on ? 'true' : undefined}
                  className={`rounded-ctl p-2.75 text-viz-body ${
                    on ? 'bg-surface font-bold text-viz-pine' : ''
                  }`}
                >
                  {metric}
                </div>
              )
            })}
          </nav>

          <section aria-label="待ち時間" className="min-h-0 overflow-auto p-4.5">
            <small className="text-viz-ink-muted text-viz-note">受付から最初の接客開始まで</small>
            <div className="font-figure font-semibold text-viz-figure text-viz-pine">
              中央値 8分40秒
            </div>
            <p className="text-viz-ink-muted text-viz-note">
              前月比 +1分20秒　店舗目標 8分以内　対象214件
            </p>
            <div
              className="flex items-end gap-3.25 border-viz-axis border-b px-5 py-3"
              style={{ height: '190px' }}
            >
              {HOURS.map((hour) => (
                <div
                  key={hour.label}
                  className={`relative flex-1 ${BAR_TONE[hour.tone]}`}
                  // 棒の頭だけ丸める。高さは実測の割合そのまま。
                  style={{ height: hour.height, borderRadius: '5px 5px 0 0' }}
                >
                  {/* 目盛は基線の下へ抜ける。棒の高さに影響させない。 */}
                  <span className="absolute text-viz-fine" style={{ bottom: '-25px' }}>
                    {hour.label}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-9 rounded-card border border-viz-line bg-surface p-3.25 text-viz-body">
              <b>14時台の待ち時間が12分を超えています</b>
              <br />
              <span className="text-viz-ink-muted text-viz-note">
                視力測定開始までの待機が主因です。対象18件の工程を確認できます。
              </span>
            </div>
          </section>

          <aside
            aria-label="確認すること"
            className="min-h-0 overflow-auto border-viz-line border-l bg-viz-rail p-3.75"
          >
            <h3>確認すること</h3>
            <VizCard>
              <b>視力測定機Aの重複</b>
              <br />
              14時台に7件。予約設定と実際の開始時刻に差があります。
            </VizCard>
            <VizCard>
              <b>担当未定の予約</b>
              <br />
              5件で受付後に担当決定。中央値が4分長くなっています。
            </VizCard>
            <VizCard>
              <b>対象データ</b>
              <br />
              来店214件 / 除外3件
              <div className="border-viz-hairline border-t pt-2.25 text-viz-fine text-viz-ink-muted">
                中央値: 受付済みから最初の接客開始まで。取消と計測欠損は除外。
              </div>
            </VizCard>
          </aside>
        </div>
      </main>
    </div>
  )
}

/**
 * 点検欄のカード（`.card`）。この面だけ行間 1.6 で組まれている（10px の
 * 3 行を読ませるため）。文字寸法に紐づかない組みなのでインラインで持つ。
 */
function VizCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="mb-2.5 rounded-card border border-viz-line bg-surface p-3 text-viz-note"
      style={{ lineHeight: 1.6 }}
    >
      {children}
    </div>
  )
}
