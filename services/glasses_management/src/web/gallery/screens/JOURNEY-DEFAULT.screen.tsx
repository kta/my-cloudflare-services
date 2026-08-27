import { AppBar, BarButton, BarPush, Screen, Wordmark } from '../../design/chrome'
import { JourneyBoard } from '../../design/ledger'
import { Card } from '../../design/surfaces'

/*
 * JOURNEY-DEFAULT — 承認済みモック `staff-approved.html#journey`。
 *
 *   main.detail{padding:22px}
 *   .journey{grid-template-columns:190px repeat(4,1fr);gap:8px}
 *   .stage{min-height:80px;background:#fff;border:1px solid var(--l);
 *          border-radius:8px;padding:10px}
 *   .next{background:var(--gs);border:2px solid var(--g)}
 *   .card{…;margin-top:10px}
 *
 * 「次にご案内」は緑の 2px 罫で、盤の中でひとつだけ強い。次に手を動かす場所を
 * 迷わせないための唯一の強調なので、他の工程に同じ強さを与えない。
 */

const STAGES = ['お客様', '受付・相談', 'フレーム', '視力測定', 'レンズ・調整']

export default function JourneyDefault() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="銀座店" />
        <BarButton>予約台帳</BarButton>
        <BarButton on current>
          来店受付
        </BarButton>
        <BarButton>顧客台帳</BarButton>
        <BarPush>
          <BarButton on>＋ 店頭のお客様を受付</BarButton>
        </BarPush>
      </AppBar>
      <main className="min-h-0 flex-1 overflow-auto p-5.5 font-sans">
        <h1>接客の進み具合</h1>
        <JourneyBoard
          stages={STAGES}
          rows={[
            [
              {
                children: (
                  <>
                    <b>田中 花子</b>
                    <br />
                    待ち18分
                  </>
                ),
              },
              {
                children: (
                  <>
                    受付済み
                    <br />
                    9:58 山田
                  </>
                ),
              },
              {
                children: (
                  <>
                    相談中
                    <br />
                    佐藤
                  </>
                ),
              },
              {
                next: true,
                children: (
                  <>
                    次にご案内
                    <br />
                    測定機A 10:30
                  </>
                ),
              },
              {},
            ],
            [
              {
                children: (
                  <>
                    <b>ウォークイン 003</b>
                    <br />
                    顧客未登録
                  </>
                ),
              },
              {
                next: true,
                children: (
                  <>
                    相談待ち
                    <br />
                    このまま開始可能
                  </>
                ),
              },
              {},
              {},
              {},
            ],
          ]}
        />
        <Card className="mt-2.5">
          <b>次の引き継ぎ</b>
          {'　田中様を視力測定機Aへ案内。前回度数との変化を確認してください。'}
        </Card>
      </main>
    </Screen>
  )
}
