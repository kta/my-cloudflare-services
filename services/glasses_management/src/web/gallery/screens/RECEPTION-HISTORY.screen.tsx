import type { ReactNode } from 'react'
import {
  StatusBar,
  TerminalBar,
  TerminalNav,
  TerminalPrimary,
  TerminalScreen,
  TerminalWordmark,
} from '../../design/chrome'

/*
 * RECEPTION-HISTORY — 承認済みモック `reception-history-approved.html`。
 *
 * 端末 1 台だけを描いた別の寸法体系（ステータスバー 25px + バー 67px、本文
 * 10〜11px、緑 #286b55）。実測は次のとおり。
 *
 *   .history{height:calc(100% - 92px);grid-template-columns:390px 1fr}
 *   .list{background:#edf1ee;border-right:1px solid var(--l);padding:14px}
 *   .tools{display:flex;gap:7px}
 *   .search{height:42px;flex:1;border:2px solid var(--g);border-radius:8px;
 *           padding:11px;font-size:11px}
 *   .filter{height:42px;border:1px solid #c8d4cd;border-radius:8px;padding:0 10px}
 *   .day{font-size:11px;font-weight:700;margin:12px 2px 6px}
 *   .event{border:1px solid var(--l);border-radius:9px;padding:11px;
 *          margin-top:7px;font-size:10px}
 *   .event.on{border:2px solid var(--g);background:#f2f8f4}
 *   .event time{font:600 11px 'IBM Plex Mono';color:var(--g)}
 *   .source{float:right;border-radius:12px;padding:3px 6px;background:var(--gs)}
 *   .detail{padding:19px 23px}
 *   .badge{margin-left:auto;border-radius:15px;padding:6px 9px;font-size:10px}
 *   .detailgrid{grid-template-columns:1.15fr .85fr;gap:12px;margin-top:14px}
 *   .card{border:1px solid var(--l);border-radius:9px;padding:13px;
 *         font-size:10px;line-height:1.6}
 *   .card h4{margin:0 0 9px}
 *   .row{display:flex;justify-content:space-between;padding:8px 0;
 *        border-top:1px solid #e8ece9}
 *   .wave{height:45px;margin-top:8px;
 *         background:repeating-linear-gradient(90deg,#89b4a2,#89b4a2 3px,
 *                    transparent 3px,transparent 8px);opacity:.65}
 *
 * 受付は電話・店頭・Web・変更が混ざる。経路を件ごとにピルで名乗らせるのは、
 * 「誰がどこから入れた予約か」を後から辿れるようにするため。
 */

/** 記録 1 件（`.event`）。選択中だけ緑の 2px 罫になる。 */
function Event({
  source,
  time,
  title,
  detail,
  selected = false,
}: {
  source: string
  time: string
  title: string
  detail: string
  selected?: boolean
}) {
  return (
    <article
      aria-current={selected ? 'true' : undefined}
      className={
        selected
          ? 'rounded-card border-2 border-terminal-pine bg-terminal-selected text-terminal-note'
          : 'rounded-card border border-terminal-line bg-surface text-terminal-note'
      }
      style={{ padding: '11px', marginTop: '7px' }}
    >
      <span
        className="float-right bg-terminal-pine-soft text-terminal-pine"
        style={{ borderRadius: '12px', padding: '3px 6px' }}
      >
        {source}
      </span>
      <time className="font-mono font-semibold text-terminal-body text-terminal-pine">{time}</time>
      <br />
      <b>{title}</b>
      <br />
      {detail}
    </article>
  )
}

/** カードの中の 1 行（`.row`）。項目名と値を両端へ寄せる。 */
function DataRow({ name, value }: { name: string; value: string }) {
  return (
    <div
      className="flex justify-between border-terminal-hairline border-t"
      style={{ padding: '8px 0' }}
    >
      <span>{name}</span>
      <b>{value}</b>
    </div>
  )
}

function DetailCard({ children, as = 'div' }: { children: ReactNode; as?: 'div' | 'aside' }) {
  const Tag = as
  return (
    <Tag
      className="rounded-card border border-terminal-line bg-surface text-terminal-note"
      style={{ padding: '13px', lineHeight: 1.6 }}
    >
      {children}
    </Tag>
  )
}

/** `.card h4`。ブラウザ既定の 1.33em の余白を、モックの 0 0 9px へ持ち直す。 */
function CardHeading({ children, lead = 0 }: { children: ReactNode; lead?: number }) {
  return <h3 style={{ margin: `${lead}px 0 9px` }}>{children}</h3>
}

export default function ReceptionHistory() {
  return (
    <TerminalScreen>
      <StatusBar time="14:32" />
      <TerminalBar>
        <TerminalWordmark subtitle="銀座店　⌄" />
        <TerminalNav>予約台帳</TerminalNav>
        <TerminalNav on>受付履歴</TerminalNav>
        <TerminalNav>予約検索</TerminalNav>
        <TerminalPrimary>＋ 予約を取る</TerminalPrimary>
      </TerminalBar>
      <main className="grid min-h-0 flex-1" style={{ gridTemplateColumns: '390px 1fr' }}>
        <aside
          className="min-h-0 overflow-auto border-terminal-line border-r bg-terminal-panel"
          style={{ padding: '14px' }}
        >
          <div className="flex" style={{ gap: '7px' }}>
            {/* モックの検索欄は入力ではなく板で、文字は本文色で描かれている。 */}
            <div
              className="flex-1 rounded-ctl border-2 border-terminal-pine bg-surface text-terminal-body"
              style={{ height: '42px', padding: '11px' }}
            >
              ⌕ 氏名・電話番号・予約番号
            </div>
            <button
              type="button"
              className="rounded-ctl border border-terminal-filter-line bg-surface"
              style={{ height: '42px', padding: '0 10px' }}
            >
              要確認
            </button>
          </div>
          <div className="font-bold text-terminal-body" style={{ margin: '12px 2px 6px' }}>
            8月26日（水）
          </div>
          <Event
            source="店頭"
            time="14:26"
            title="ウォークイン 006を受付"
            detail="顧客未登録 · 山田"
          />
          <Event
            selected
            source="電話"
            time="14:18"
            title="田中 花子様の予約を登録"
            detail="8/28 11:00 · 視力測定・新調相談"
          />
          <Event
            source="Web"
            time="13:54"
            title="伊藤 健様の予約を受付"
            detail="8/29 13:30 · フレーム相談"
          />
          <Event
            source="変更"
            time="13:32"
            title="松本 一郎様の日時を変更"
            detail="8/27 15:00 → 8/28 10:00"
          />
        </aside>
        <section className="min-h-0 overflow-auto" style={{ padding: '19px 23px' }}>
          <div className="flex items-center">
            <div>
              <h1 className="text-terminal-h2" style={{ margin: 0 }}>
                田中 花子様の予約を登録
              </h1>
              <small>2026年8月26日 14:18 · 受付者 鈴木</small>
            </div>
            <span
              className="ml-auto bg-terminal-pine-soft text-terminal-note text-terminal-pine"
              style={{ borderRadius: '15px', padding: '6px 9px' }}
            >
              予約済み
            </span>
          </div>
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: '1.15fr .85fr', marginTop: '14px' }}
          >
            <DetailCard>
              <CardHeading>予約内容</CardHeading>
              <DataRow name="来店" value="8月28日（金）11:00" />
              <DataRow name="目的" value="視力測定・新調相談" />
              <DataRow name="予約番号" value="EY-0828-1142" />
              <DataRow name="受付経路" value="電話" />
              <CardHeading lead={13}>iPad録音</CardHeading>
              <button
                type="button"
                className="rounded-ctl border border-terminal-filter-line bg-surface"
                style={{ height: '42px', padding: '0 10px' }}
              >
                ▶ 03:12を再生
              </button>
              {/*
               * 波形は再生位置を持たない装飾。録音があることだけを示し、
               * 中身を読み取れるようには描かない。
               */}
              <div
                aria-hidden="true"
                style={{
                  height: '45px',
                  marginTop: '8px',
                  opacity: 0.65,
                  background:
                    'repeating-linear-gradient(90deg,var(--color-terminal-wave),var(--color-terminal-wave) 3px,transparent 3px,transparent 8px)',
                }}
              />
            </DetailCard>
            <DetailCard as="aside">
              <CardHeading>お客様</CardHeading>
              <b className="text-grid">田中 花子 様</b>
              <br />
              090-1234-5678
              <br />
              4回来店 · 主利用店 銀座
              <DataRow name="顧客照合" value="既存顧客" />
              <DataRow name="変更履歴" value="なし" />
            </DetailCard>
          </div>
        </section>
      </main>
    </TerminalScreen>
  )
}
