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
 * STORE-SWITCH — 承認済みモック `store-switch-approved.html`。
 *
 * 受付履歴と同じ寸法体系（ステータスバー 25px + バー 67px、緑 #286b55）。実測は
 * 次のとおり。
 *
 *   .storebutton{border:1px solid #ffffff5c;background:#ffffff16;color:#fff;
 *                border-radius:8px;padding:8px 12px;text-align:left;font-size:10px}
 *   .storebutton b{display:block;font-size:13px}
 *   .tools{height:58px;display:flex;align-items:center;padding:0 18px;
 *          border-bottom:1px solid var(--l);background:#fff}
 *   .tools h2{font-size:18px}
 *   .grid{padding:14px;grid-template-columns:150px repeat(7,1fr);font-size:10px}
 *   .cell{min-height:58px;background:#fff;border-right:1px solid #e5eae7;
 *         border-bottom:1px solid #e5eae7;padding:7px}
 *   .head{min-height:28px;background:#e9eeeb;font:600 9px 'IBM Plex Mono'}
 *   .appt{background:var(--gs);color:var(--g);font-weight:700}
 *   .veil{position:absolute;inset:25px 0 0;background:#17382b66;
 *         padding:88px 0 0 55px}
 *   .popover{width:380px;background:#fff;border-radius:14px;
 *            box-shadow:0 24px 70px #10271e66;overflow:hidden}
 *   .pophead{padding:17px;border-bottom:1px solid var(--l)}
 *   .search{height:42px;border:2px solid var(--g);border-radius:8px;padding:11px;
 *           margin-top:12px;font-size:11px}
 *   .store{padding:13px 17px;border-bottom:1px solid #e7ebe8;font-size:10px}
 *   .store b{font-size:14px}  .store.on{background:#f0f7f3}
 *   .boundary{padding:12px 17px;background:#f4f6f4;color:#5f7168;
 *             font-size:10px;line-height:1.55}
 *
 * 幕は台帳の上に掛かるが、台帳を消さない。「今どの店舗を見ていたか」を残した
 * まま切り替えさせるための伏せ方で、別画面へ飛ばさない。
 *
 * 末尾の但し書きは飾りではない。他店舗の空き枠をここに出さないという境界を、
 * 切り替える人がその場で読めるようにしている。
 */

const COLUMNS = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00']

/** 台帳のセル。`.head` だけ書体・寸法が別（モックの `font:` 一括指定）。 */
function Cell({
  children,
  span = 1,
  tone = 'plain',
}: {
  children?: ReactNode
  span?: number
  tone?: 'plain' | 'head' | 'appointment'
}) {
  return (
    <div
      className={
        tone === 'head'
          ? 'border-terminal-grid-line border-r border-b bg-terminal-grid-head font-mono font-semibold text-terminal-micro'
          : tone === 'appointment'
            ? 'border-terminal-grid-line border-r border-b bg-terminal-pine-soft font-bold text-terminal-pine'
            : 'border-terminal-grid-line border-r border-b bg-surface'
      }
      style={{
        // モックの `.head` は `font:600 9px 'IBM Plex Mono'` と一括で書いていて、
        // 和文グリフを持たない Plex Mono の代替がブラウザ既定の書体に落ちる。
        // 共有トークンの代替列（ui-monospace / Menlo）を挟むと行箱が 1px 縮み、
        // 見出し行から下の罫が丸ごと 1px ずれる。ここだけ宣言どおりに描く。
        fontFamily: tone === 'head' ? '"IBM Plex Mono"' : undefined,
        minHeight: tone === 'head' ? '28px' : '58px',
        padding: '7px',
        gridColumn: span > 1 ? `span ${span}` : undefined,
      }}
    >
      {children}
    </div>
  )
}

/** 切替シートの 1 店舗。状態は右端へ流し、名前より小さく置く。 */
function Store({
  name,
  state,
  note,
  selected = false,
  suspended = false,
}: {
  name: string
  state: string
  note: string
  selected?: boolean
  suspended?: boolean
}) {
  return (
    <div
      className={`border-terminal-store-line border-b text-terminal-note ${
        selected ? 'bg-terminal-highlight' : ''
      }`}
      style={{ padding: '13px 17px' }}
    >
      <span
        className={`float-right font-bold ${
          suspended ? 'text-terminal-danger' : 'text-terminal-pine'
        }`}
      >
        {state}
      </span>
      <b className="text-grid">{name}</b>
      <small className="block text-terminal-ink-muted">{note}</small>
    </div>
  )
}

export default function StoreSwitch() {
  return (
    <TerminalScreen>
      <StatusBar time="9:41" />
      {/* 幕は画面（ステータスバーの下）を基準に掛かるので、ここが位置の起点。 */}
      <div className="relative min-h-0 flex-1">
        <TerminalBar>
          <TerminalWordmark />
          <button
            type="button"
            className="rounded-ctl border border-terminal-chip-line bg-terminal-chip text-left text-on-pine text-terminal-note"
            style={{ padding: '8px 12px' }}
          >
            <b className="block text-note">銀座店　⌄</b>
            営業中 · 選択中の店舗
          </button>
          <TerminalNav on>予約台帳</TerminalNav>
          <TerminalNav>来店受付</TerminalNav>
          <TerminalNav>顧客台帳</TerminalNav>
          <TerminalNav>分析</TerminalNav>
          <TerminalPrimary>＋ 予約を取る</TerminalPrimary>
        </TerminalBar>
        <div
          className="flex items-center border-terminal-line border-b bg-surface"
          style={{ height: '58px', padding: '0 18px' }}
        >
          <h1 className="text-lead">銀座店の予約台帳</h1>
          <span className="ml-auto">8月27日（木）</span>
        </div>
        <div
          className="grid text-terminal-note"
          style={{ padding: '14px', gridTemplateColumns: '150px repeat(7, 1fr)' }}
        >
          <Cell tone="head">担当者</Cell>
          {COLUMNS.map((column) => (
            <Cell key={column} tone="head">
              {column}
            </Cell>
          ))}
          <Cell>
            <b>佐藤 美咲</b>
          </Cell>
          <Cell span={2} tone="appointment">
            田中 花子
            <br />
            新調相談
          </Cell>
          <Cell />
          <Cell span={2} tone="appointment">
            松本 一郎
            <br />
            調整
          </Cell>
          <Cell span={2} />
        </div>
        <div className="absolute inset-0 bg-terminal-veil" style={{ padding: '88px 0 0 55px' }}>
          {/* 幕の上に載る切替シート。役割としては dialog なので、そう読ませる。 */}
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="store-switch-title"
            className="overflow-hidden rounded-sheet bg-surface"
            style={{ width: '380px', boxShadow: '0 24px 70px var(--color-terminal-shadow)' }}
          >
            <div className="border-terminal-line border-b" style={{ padding: '17px' }}>
              <h2 id="store-switch-title" className="text-terminal-h3" style={{ margin: 0 }}>
                作業する店舗を切り替える
              </h2>
              {/* 検索欄は入力ではなく板。突き合わせ台は状態を持たない。 */}
              <div
                className="rounded-ctl border-2 border-terminal-pine text-terminal-body"
                style={{ height: '42px', padding: '11px', marginTop: '12px' }}
              >
                ⌕ 店舗名で検索
              </div>
            </div>
            <Store selected name="銀座店" state="選択中" note="営業中 · 警告2件" />
            <Store name="丸の内店" state="営業中" note="担当店舗" />
            <Store name="日本橋店" state="営業中" note="担当店舗 · 警告1件" />
            <Store suspended name="新宿店" state="受付停止" note="設備点検中" />
            <div
              className="bg-terminal-boundary text-terminal-boundary-ink text-terminal-note"
              style={{ padding: '12px 17px', lineHeight: 1.55 }}
            >
              他店舗の空き枠はここに表示しません。切替後、その店舗の予約台帳で確認してください。
            </div>
          </section>
        </div>
      </div>
    </TerminalScreen>
  )
}
