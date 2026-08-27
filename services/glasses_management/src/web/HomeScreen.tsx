import type { StaffLocation } from './staff-navigation'
import type { StaffScreenProps } from './staff-screen'

/*
 * EYEX スタッフ・ホーム (UC-EYEX-001〜008)。
 *
 * 承認済みモック `docs/frontend/mockups/eyex-reservation/approved.html` の
 * `#home` と `HOME-DEFAULT--default--ipad-landscape.png` をそのまま再現する。
 *
 * 集計ダッシュボードではなく「操作の入口」。design §2.1 は集計値を先に見せる
 * ことを禁じているので、見出し・営業状態・件数カードはここに置かない。店舗名と
 * 営業状態・お知らせ・アラート・設定はワークスペースのヘッダー (App.tsx) が持つ。
 *
 * 時刻は必ず注入する。`today` は JST の YYYY-MM-DD で、コンポーネント内では
 * `new Date()` を呼ばない (リポジトリ規約 / テストの決定性)。
 */

export type HomeScreenProps = StaffScreenProps & {
  /** JST の当日 (YYYY-MM-DD)。呼び出し側が注入する。 */
  today: string
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** UTC 起点の素朴な日付演算。月跨ぎ・年跨ぎ・うるう年をロケールに委ねない。 */
function shiftDay(isoDate: string, days: number): Date {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days))
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function surroundingDays(
  today: string,
): { date: string; day: number; spoken: string; weekday: string }[] {
  return [-3, -2, -1, 0, 1, 2, 3].map((offset) => {
    const date = shiftDay(today, offset)
    return {
      date: toIsoDate(date),
      day: date.getUTCDate(),
      spoken: `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`,
      weekday: WEEKDAYS[date.getUTCDay()] ?? '',
    }
  })
}

/* `.bar button` 相当の可視フォーカス。色だけに頼らない状態表現の一部。 */
const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'

/*
 * モックの `.hero button`: min-height 108px / 左寄せ / 24px / 角丸 12px。
 * 塗りだけが 2 種類で、罫線はどちらも `--line`（緑タイルにも同じ 1 本が入る）。
 * 突き合わせ台の複製（`gallery/screens/HOME-DEFAULT.screen.tsx`）と同じ組み。
 */
const HERO = `min-h-27 rounded-panel border border-line px-7 py-5.5 text-left text-title ${FOCUS}`
const HERO_PRIMARY = `${HERO} bg-pine text-on-pine`
const HERO_PLAIN = `${HERO} bg-surface text-ink`

/* モックの `.quick button`: 下線のみ・背景なし・18px・min-height 76px。 */
const QUICK = `min-h-19 border-line border-b bg-transparent text-left text-ink text-lead ${FOCUS}`

/* モックの `.days button`: min-height 64px / 白 / 8px 角丸。 */
const DAY = `min-h-16 rounded-ctl border text-ink ${FOCUS}`
const DAY_PLAIN = `${DAY} border-line bg-surface`
const DAY_SELECTED = `${DAY} border-pine bg-pine-soft font-bold`

export function HomeScreen({ navigate, today }: HomeScreenProps) {
  const days = surroundingDays(today)

  const quickActions: { label: string; to: StaffLocation }[] = [
    { label: '受付履歴', to: { screen: 'reception-history' } },
    { label: '予約を検索', to: { screen: 'reservation-search' } },
    { label: '顧客台帳', to: { screen: 'customers' } },
    { label: '予約台帳', to: { screen: 'ledger', date: today } },
    { label: '来店受付', to: { screen: 'journey' } },
  ]

  return (
    <main className="flex h-full flex-col px-25 pt-23 pb-12.5 text-ink">
      {/*
       * `.home{grid-template-columns:1fr .8fr;gap:70px}`。列比は 4 の倍数でない
       * 実測値なので、純粋な配置としてインラインで持つ（`col-span` の近似だと
       * 主タイルの幅が数 px ずれ、右の副導線の下線がモックと揃わない）。
       */}
      <div className="grid gap-17.5" style={{ gridTemplateColumns: '1fr .8fr' }}>
        <nav aria-label="主操作" className="grid gap-4.5">
          <button
            type="button"
            onClick={() => navigate({ screen: 'booking' })}
            className={HERO_PRIMARY}
          >
            新しい予約を取る
            {/* モックの `<small>` は寸法を持たず、ブラウザ既定の smaller で描く。 */}
            <br />
            <small>電話・店頭のお客様</small>
          </button>
          <button
            type="button"
            onClick={() => navigate({ screen: 'reservation-search' })}
            className={HERO_PLAIN}
          >
            予約を変更する
          </button>
        </nav>

        <nav aria-label="副操作" className="grid content-start">
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => navigate(action.to)}
              className={QUICK}
            >
              {action.label}
            </button>
          ))}
        </nav>
      </div>

      {/* `.days` — 前後 3 日 + カレンダー を 8 列で並べる。 */}
      <nav aria-label="日付" className="mt-auto grid grid-cols-8 gap-2">
        {days.map((day) => {
          const selected = day.date === today
          return (
            <button
              key={day.date}
              type="button"
              aria-current={selected ? 'date' : undefined}
              onClick={() => navigate({ screen: 'ledger', date: day.date })}
              className={selected ? DAY_SELECTED : DAY_PLAIN}
            >
              <span aria-hidden="true">{`${day.day} ${day.weekday}`}</span>
              <span className="sr-only">
                {`${day.spoken}（${day.weekday}）の予約台帳${selected ? '・選択中' : ''}`}
              </span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={() => navigate({ screen: 'ledger', date: today })}
          className={DAY_PLAIN}
        >
          カレンダー
        </button>
      </nav>
    </main>
  )
}
