import { AppBar, BarButton, BarPush, Screen, Wordmark } from '../../design/chrome'
import { LedgerGrid } from '../../design/ledger'

/*
 * LEDGER-DAY — 承認済みモック `staff-approved.html#ledger`。
 *
 *   .ledger{padding:16px;display:grid;
 *           grid-template-columns:180px repeat(7,1fr);font-size:14px}
 *   .cell{min-height:72px;border-right:1px solid var(--l);
 *         border-bottom:1px solid var(--l);padding:8px;background:#fff}
 *   .head{min-height:40px;background:#dce5e0;font-weight:700}
 *   .appt{background:var(--gs);font-weight:700}
 *   .walk{background:#fff0e8}
 *   .now{left:calc(180px + (100% - 180px) * .324);top:40px;bottom:0;
 *        border-left:3px solid var(--warn);z-index:4}
 *
 * 現在時刻の線は列の境界に乗っていない。11:08 という実時刻をそのまま示すのが
 * 台帳の役目なので、格子へ丸めない。
 */

const COLUMNS = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00']

export default function LedgerDay() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="銀座店 · 営業中" />
        <BarButton on current>
          予約台帳
        </BarButton>
        <BarButton>来店受付</BarButton>
        <BarButton>受付履歴</BarButton>
        <BarButton>顧客台帳</BarButton>
        <BarPush>
          <BarButton on>＋ 予約を取る</BarButton>
        </BarPush>
      </AppBar>
      {/* 台帳は 1 日が 1 画面に収まる前提なので、内側でスクロールを持たない。 */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <LedgerGrid
          columns={COLUMNS}
          now={{ label: '現在 11:08', ratio: 0.324 }}
          lanes={[
            {
              name: '佐藤 美咲',
              cells: [
                {
                  span: 2,
                  tone: 'appointment',
                  children: (
                    <>
                      田中 花子
                      <br />
                      新調相談 · 電話
                    </>
                  ),
                },
                {},
                {
                  span: 2,
                  tone: 'appointment',
                  children: (
                    <>
                      松本 一郎
                      <br />
                      調整 · 店頭
                    </>
                  ),
                },
                { span: 2 },
              ],
            },
            {
              name: '高橋 健',
              cells: [
                {},
                {
                  span: 3,
                  tone: 'appointment',
                  children: (
                    <>
                      伊藤 健
                      <br />
                      視力測定 · Web予約
                    </>
                  ),
                },
                { span: 3 },
              ],
            },
            {
              name: 'ウォークイン',
              cells: [
                { span: 2 },
                {
                  span: 2,
                  tone: 'walkin',
                  children: (
                    <>
                      ウォークイン 003
                      <br />
                      顧客未登録
                    </>
                  ),
                },
                { span: 3 },
              ],
            },
          ]}
        />
      </div>
    </Screen>
  )
}
