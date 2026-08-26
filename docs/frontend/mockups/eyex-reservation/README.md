# EYEX予約 承認済みモック

- 承認日: 2026-08-26
- 承認範囲: 中核画面の視覚方向。全状態の個別PNGと最終レビューが完了するまでは、プロダクト全体を承認済みと扱わない。
- HTML: [`approved.html`](./approved.html)
- 旧合成スクリーンショット: `approved-overview.png`（最新要件の証跡には使用しない）
- スタッフ画面HTML: [`staff-approved.html`](./staff-approved.html)
- 旧スタッフ合成スクリーンショット: `staff-approved-overview.png`（最新要件の証跡には使用しない）
- 店舗切替HTML: [`store-switch-approved.html`](./store-switch-approved.html)
- 店舗切替スクリーンショット: [`store-switch-approved.png`](./store-switch-approved.png)
- 旧Web予約HTML・画像: `web-booking-approved.html` / `web-booking-approved.png`（目的・日時だけの旧案。最新要件の証跡には使用しない）
- 設定HTML: [`settings-approved.html`](./settings-approved.html)
- 設定スクリーンショット: [`settings-approved.png`](./settings-approved.png)
- 設定SP HTML: [`settings-responsive-approved.html`](./settings-responsive-approved.html)
- 設定SPスクリーンショット: [`settings-responsive-approved.png`](./settings-responsive-approved.png)
- 設定6工程HTML: [`settings-complete-approved.html`](./settings-complete-approved.html)
- 分析HTML: [`analytics-approved.html`](./analytics-approved.html)
- 分析スクリーンショット: [`analytics-approved.png`](./analytics-approved.png)
- 受付履歴HTML: [`reception-history-approved.html`](./reception-history-approved.html)
- 受付履歴スクリーンショット: [`reception-history-approved.png`](./reception-history-approved.png)
- Web予約完全フローHTML: [`web-booking-complete-approved.html`](./web-booking-complete-approved.html)
- 管理・運用画面HTML: [`operations-approved.html`](./operations-approved.html)
- 例外・回復状態HTML: [`exception-states-approved.html`](./exception-states-approved.html)
- 画面・状態・UC/AC台帳: [`../../../../specs/glasses_reservation/features/002-eyex-reservation-product/design/SCREEN_INVENTORY.md`](../../../../specs/glasses_reservation/features/002-eyex-reservation-product/design/SCREEN_INVENTORY.md)
- 要件: [`../../../../specs/glasses_reservation/features/002-eyex-reservation-product/design/EYEX_RESERVATION_DESIGN.md`](../../../../specs/glasses_reservation/features/002-eyex-reservation-product/design/EYEX_RESERVATION_DESIGN.md)

## 正とするもの

このモックは見た目と情報階層の正である。実装では HTML 内の色・寸法を直接コピーせず、
`packages/ui/src/theme.css` のセマンティックトークンへ翻訳する。

トップと予約画面について、以後のモックは次の語彙を継承する。

- 横向き iPad を主利用環境とし、主要操作は 44pt 以上にする。
- TORETAからは、主操作の優先順位、左入力・右補助・下進捗の構造、会話順の入力を取り込む。
- EYEX予約の配色、文言、接客メモ、眼鏡店固有の来店目的は独自に設計する。
- 予約開始から確定まで、iPadマイクの録音状態を常時表示する。
- 復唱画面では、スタッフがそのまま読み上げられる完全な文章を表示する。

## 完成判定

現存HTMLと同名PNGがあるだけでは完成と判定しない。各主要画面と重要状態について、
spec配下の`SCREEN_INVENTORY.md`のscreen_id単位の個別PNG、viewport、UC/AC対応、アクセシビリティ試験記録が必要である。

次は未完了として扱う。

- 個別PNGがなく縦長overviewにだけ含まれる画面。
- 通常状態しかなく、業務上必要なempty、validation、403、409、通信失敗、セッション失効がない画面。
- iPad横向きだけでSplit View、文字拡大、キーボードfocusを確認していない画面。
- 最新specと異なる文言、店舗境界、権限、録音表示を含む画像。

店舗横断の空き枠検索・比較、他店舗候補の自動提示、店舗間送客は対象外とする。
