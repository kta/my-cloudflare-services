import { AppBar, BarButton, BarPush, Screen, Wordmark } from '../../design/chrome'
import { SearchPlate } from '../../design/controls'
import { Workspace } from '../../design/layouts'
import { Card, ListRow } from '../../design/surfaces'

/*
 * CUSTOMER-CURRENT — 承認済みモック `staff-approved.html#customer-ledger`。
 *
 *   .workspace{grid-template-columns:390px 1fr}
 *   .list{padding:16px;background:#e7ede9}
 *   .detail{padding:22px}
 *   .search{min-height:48px;border:2px solid var(--g);border-radius:8px;padding:12px}
 *   .customer-top{grid-template-columns:repeat(3,1fr);gap:12px}
 *   .card{background:#fff;border:1px solid var(--l);border-radius:9px;
 *         padding:14px;margin-top:10px}
 *   .attention{background:#fff0ed;border:1px solid #d4a299}
 *
 * 「対応時に確認」は淡い赤の面で、来店履歴より前に置く。接客の直前に読むもの
 * なので、時系列（履歴）の後ろへ回さない。
 */

export default function CustomerCurrent() {
  return (
    <Screen>
      <AppBar>
        <Wordmark subtitle="銀座店" />
        <BarButton>予約台帳</BarButton>
        <BarButton>予約検索</BarButton>
        <BarButton on current>
          顧客台帳
        </BarButton>
        <BarPush>
          <BarButton on>＋ 予約を取る</BarButton>
        </BarPush>
      </AppBar>
      <Workspace
        list={
          <>
            <SearchPlate label="顧客を検索">氏名・電話番号</SearchPlate>
            <ListRow selected>
              <b>田中 花子</b>
              <br />
              090-1234-5678
            </ListRow>
            <ListRow>
              <b>田中 一郎</b>
              <br />
              090-1234-9912
            </ListRow>
          </>
        }
        detail={
          <>
            <h1>田中 花子 様</h1>
            {/* `.card` 自身が margin-top:10px を持つので、格子側は間隔を足さない。 */}
            <div className="grid grid-cols-3 gap-3">
              <Card className="mt-2.5">
                <b>現在の度数</b>
                <br />R -2.25 / L -2.00
                <br />
                PD 62.0 · ADD +1.00
              </Card>
              <Card className="mt-2.5">
                <b>最新メモ</b>
                <br />
                PC作業用。鼻パッドは低め。
              </Card>
              <Card className="mt-2.5">
                <b>現在のメガネ</b>
                <br />
                遠近両用1本 · 近用1本
              </Card>
            </div>
            <Card tone="attention" className="mt-2.5">
              <b>対応時に確認</b>
              <br />
              度数変更の理由を段階的に説明する。
              <br />
              <small>発生日時 2026.02.10 · 根拠 接客記録 · 推奨対応あり</small>
            </Card>
            <Card className="mt-2.5">
              <b>来店履歴</b>
              <br />
              2026.05.18 銀座店 フィッティング調整
              <br />
              2026.02.10 丸の内店 視力測定・新調 <small>（履歴閲覧権限あり）</small>
            </Card>
          </>
        }
      />
    </Screen>
  )
}
