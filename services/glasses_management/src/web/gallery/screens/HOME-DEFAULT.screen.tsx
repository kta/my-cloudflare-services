import { AppBar, BarButton, BarPush, Screen, Wordmark } from '../../design/chrome'

/*
 * HOME-DEFAULT — 承認済みモック `approved.html#home`。
 *
 *   .home{grid-template-columns:1fr .8fr;gap:70px;padding:92px 100px}
 *   .hero{gap:18px}
 *   .hero button{min-height:108px;text-align:left;border:1px solid var(--line);
 *       border-radius:12px;background:var(--surface);padding:22px 28px;
 *       font-size:24px}
 *   .hero button:first-child{background:var(--brand);color:#fff}
 *   .quick{align-content:start}
 *   .quick button{min-height:76px;text-align:left;border:0;
 *       border-bottom:1px solid var(--line);background:transparent;font-size:18px}
 *   .days{position:absolute;left:100px;right:100px;bottom:50px;
 *       grid-template-columns:repeat(8,1fr);gap:8px}
 *   .days button{min-height:64px;border:1px solid var(--line);background:#fff;
 *       border-radius:8px}
 *
 * 電話を取った直後に最初に押すものが、画面のいちばん大きい面積を持つ。
 */

const QUICK = ['受付履歴', '予約を検索', '顧客台帳', '予約台帳', '来店受付']

const DAYS = ['24 月', '25 火', '26 水', '27 木', '28 金', '29 土', '30 日', 'カレンダー']

export default function HomeDefault() {
  return (
    <Screen>
      <AppBar variant="booking">
        <Wordmark variant="booking" subtitle="銀座店 · 営業中" />
        <BarPush variant="booking">
          <BarButton outline variant="booking">
            お知らせ 2件
          </BarButton>
          <BarButton outline variant="booking">
            アラート 1件
          </BarButton>
          <BarButton outline variant="booking">
            設定
          </BarButton>
        </BarPush>
      </AppBar>
      <main className="relative min-h-0 flex-1 font-sans">
        <div className="grid gap-17.5 px-25 pt-23" style={{ gridTemplateColumns: '1fr .8fr' }}>
          <div className="grid gap-4.5">
            <button
              type="button"
              className="min-h-27 rounded-panel border border-line bg-pine px-7 py-5.5 text-left text-on-pine text-title"
            >
              新しい予約を取る
              <br />
              <small>電話・店頭のお客様</small>
            </button>
            <button
              type="button"
              className="min-h-27 rounded-panel border border-line bg-surface px-7 py-5.5 text-left text-ink text-title"
            >
              予約を変更する
            </button>
          </div>
          <nav aria-label="ほかの業務" className="grid content-start">
            {QUICK.map((label) => (
              <button
                key={label}
                type="button"
                className="min-h-19 border-line border-b bg-transparent text-left text-ink text-lead"
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
        {/* 日付の並びは選択肢の集まりなので fieldset で名前を持たせる。 */}
        <fieldset
          aria-label="日付"
          className="absolute right-25 bottom-12.5 left-25 grid grid-cols-8 gap-2"
        >
          {DAYS.map((day) => (
            <button
              key={day}
              type="button"
              className="min-h-16 rounded-ctl border border-line bg-surface text-ink"
            >
              {day}
            </button>
          ))}
        </fieldset>
      </main>
    </Screen>
  )
}
