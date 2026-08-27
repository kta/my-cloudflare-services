import { AppBar, BarButton, BarPush, Screen, Wordmark } from '../../design/chrome'
import { FilterButton, FilterLine, SearchField } from '../../design/controls'
import { Workspace } from '../../design/layouts'
import { Card, ListRow } from '../../design/surfaces'

/*
 * RES-SEARCH — 承認済みモック `staff-approved.html#reservation-search`。
 *
 *   .workspace{grid-template-columns:390px 1fr}
 *   .list{padding:16px;background:#e7ede9;border-right:1px solid var(--l)}
 *   .detail{padding:22px}
 *   .search{min-height:48px;border:2px solid var(--g);border-radius:8px;padding:12px}
 *   .filterline{display:flex;gap:8px;margin:10px 0}
 *   .row,.card{background:#fff;border:1px solid var(--l);border-radius:9px;
 *              padding:14px;margin-top:10px}
 *   .row.selected{border:3px solid var(--g);background:var(--gs)}
 *   .grid{grid-template-columns:repeat(3,1fr);gap:12px}
 *   .audio{border:1px solid var(--l);padding:14px;border-radius:9px;margin-top:14px}
 *   .audio button{width:44px;height:44px;border-radius:50%;background:var(--g);color:#fff}
 *
 * 検索対象は 1 店舗に固定されている。一覧の上に「銀座店の予約だけを表示」と
 * 名乗らせるのは、他店舗が漏れて見えていないことを画面自身に言わせるため。
 */

export default function ReservationSearch() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="銀座店 · 検索対象店舗" />
        <BarButton>予約台帳</BarButton>
        <BarButton on current>
          予約検索
        </BarButton>
        <BarButton>顧客台帳</BarButton>
        <BarPush>
          <BarButton on>＋ 予約を取る</BarButton>
        </BarPush>
      </AppBar>
      <Workspace
        list={
          <>
            <SearchField label="予約を検索" value="" placeholder="氏名・電話番号・予約番号" />
            <FilterLine>
              <FilterButton>今後の予約</FilterButton>
              <FilterButton>電話・店頭・Web予約</FilterButton>
            </FilterLine>
            <p>
              <strong>銀座店の予約だけを表示</strong>
              <br />
              <small>他店舗はヘッダーから切り替えてください。</small>
            </p>
            <ListRow selected>
              <b>田中 花子 様</b>
              <br />
              8/27 11:00 · 新調相談
            </ListRow>
            <ListRow>
              <b>伊藤 健 様</b>
              <br />
              8/29 13:30 · 調整
            </ListRow>
          </>
        }
        detail={
          <>
            <h1>8月27日（水）11:00</h1>
            {/* `.card` 自身が margin-top:10px を持つので、格子側は間隔を足さない。 */}
            <div className="grid grid-cols-3 gap-3">
              <Card className="mt-2.5">
                <b>予約内容</b>
                <br />
                視力測定・新調相談
                <br />
                佐藤 美咲 · 測定機A
              </Card>
              <Card className="mt-2.5">
                <b>お客様</b>
                <br />
                田中 花子 様
                <br />
                4回来店
              </Card>
              <Card className="mt-2.5">
                <b>状態</b>
                <br />
                予約済み
                <br />
                電話予約
              </Card>
            </div>
            {/* `.audio` は地色を持たない。台紙の色をそのまま透かす。 */}
            <div className="mt-3.5 rounded-card border border-line p-3.5">
              <button
                type="button"
                aria-label="予約受付時の録音を再生"
                className="h-11 w-11 rounded-circle border-0 bg-pine p-0 text-on-pine"
              >
                ▶
              </button>
              {/* モックはボタンと文の間を全角空白 1 つで空けている。 */}
              {'　予約受付時の録音 · 03:12 · 保存済み'}
              <br />
              <small>ダウンロードはできません。再生操作は監査されます。</small>
            </div>
            <FilterLine>
              <FilterButton variant="danger">予約を取り消す</FilterButton>
              <FilterButton>日時・内容を変更する</FilterButton>
            </FilterLine>
          </>
        }
      />
    </Screen>
  )
}
