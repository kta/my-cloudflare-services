# サービス仕様: glasses_reservation

- パッケージ: `services/glasses_reservation` (`@app/glasses_reservation`)
- Worker 名: `glasses-reservation`
- 所有 D1: なし（ブラウザ内メモリだけを使う高忠実度モック）
- ステータス: Approved

## 目的・責務

眼鏡店スタッフが電話応対中に、顧客の照会、予約候補の選択、予約の確定・変更・取消を試せる、操作可能な予約台帳モックを提供する。元の `/Users/spmac/Documents/workspace/kuon/glasses` の画面、文言、遷移および操作感を移植する。

このサービスは永続データ、API、認証、テナント管理、他サービス連携を所有しない。画面の状態はブラウザタブのReact stateだけに保持し、リロードで初期状態に戻る。

## エンティティ（画面内モックデータ）

| エンティティ | 主な属性 | 備考 |
|---|---|---|
| 顧客 | 氏名 / 電話番号 / 来店情報 | 初期データと登録操作の結果をメモリに保持 |
| 予約 | 顧客 / 日時 / 担当 / 用件 / 状態 | 確定・変更・取消をメモリに反映 |

## API 面

API は提供しない。Cloudflare Worker はViteアセットを同一オリジンで配信するだけとする。

## 非機能・横断

- React SPA と Worker は同一オリジンで配信する。
- 色・フォント・角丸は `packages/ui/src/theme.css` のセマンティックトークン経由で表現する。
- 375px 以上のレスポンシブ表示、キーボード操作、可視フォーカス、reduced-motion を維持する。
- UI unit test とPlaywright E2Eで主要導線およびモック固有の操作を検証する。

## features

この初回移植は `features/001-glasses-reservation-mock/` で管理する。
