# EYEX予約 UX 全面監査 — 完了（2026-09-03）

**この監査は完了している。** 成果物は [`REPORT.md`](./REPORT.md)。
再開トリガーは解除済み。以降は REPORT.md をイシューへ落とす作業になる。

以下は監査の記録。同じ方法で測り直すとき、または訂正の経緯を追うときに読む。

- 対象: `services/glasses_management`（EYEX予約 業務SPA + お客様向けWeb予約）
- 目的: 「アルバイトが迷わず使える／トレタ級」を 100 点として、現状 50 点との乖離を全画面・全機能で洗い出し、**1 本のレポート**にする
- 最終成果物: `docs/audit/2026-09-02-eyex-ux/REPORT.md`
- 生の所見: `docs/audit/2026-09-02-eyex-ux/findings/<area>.md`
- 実機確認の足場: Playwright + `vite preview`（ポートごとに使い捨て D1）

## 実行手順（再開時に読む）

```sh
# 1) ビルド（1 回だけ。dist を全ポートで共有）
cd services/glasses_management && pnpm run build

# 2) 監査用サーバを起こす（ポートごとに使い捨て D1 + seed）
docs/audit/2026-09-02-eyex-ux/harness/serve.sh 43xx

# 3) Playwright 台本（scratchpad/lib.mjs の start() が端末開始導線を通す）
node scratchpad/<script>.mjs
```

> 注意: ローカルの `.dev.vars` の `AUTH_PEPPER` が `.dev.vars.example` と食い違っていると
> 共有PIN `2580` が通らない。`dev-auth-pepper-change-me` に揃えてから build し直す。

## フェーズ

| # | フェーズ | 状態 |
|---|---|---|
| 0 | 足場（build / preview / Playwright 導線） | done |
| 1 | 領域別の実機監査（12 領域） | **done** |
| 2 | 横断監査（HIG/操作感・情報設計・トレタ比較） | **done** |
| 3 | 1 本のレポートへ統合 | **done**（REPORT.md。natural-japanese の文体規約を適用し lint 0 件） |
| 4 | サブエージェントによるレビュー → 反映 | **done**（review-ux.md / review-verification.md。撤回 5 件・原因の書き換え 2 件を反映） |

## 領域別の状態

| area | 画面 | 状態 | findings |
|---|---|---|---|
| shell-start-login | 端末開始・置き場所・PIN・ロック・ナビ・オフライン | **done** | findings/shell-home.md |
| home-alerts | トップ・個人トップ・お知らせ | **done** | findings/shell-home.md |
| ledger-calendar | 予約台帳（時間表/一覧/詳細） | **done** | findings/ledger-calendar.md |
| booking | 予約を取る 6 ステップ・枠ドラッグ | **done** | findings/booking.md |
| change-cancel | 予約を探す・変更・取り消し | **done** | findings/change-cancel.md |
| reception | 来店受付・ウォークイン・受付履歴 | **done** | findings/reception.md |
| recording | 録音（開始/停止/失敗/権限拒否/再生） | **done** | findings/recording.md |
| customers | 顧客台帳・新規・詳細・統合・手書き | **done** | findings/customers.md |
| settings | 設定 8 面 | **done** | findings/settings.md |
| analytics | 分析 | **done** | findings/analytics.md |
| public-web | お客様向け Web 予約（スマホ） | **done**（工程4〜6は空き枠が出ず未到達） | findings/public-web.md |
| cross-hig | 操作感・アニメ・タッチ・a11y・情報設計 | **done** | findings/cross-hig.md |

## ユーザーから既に出ている具体的な不満（必ずレポートで回収する）

1. カレンダーで予約枠を動かすとき、特定の場所を掴まないと移動できない（Google カレンダー以下）
2. 予約台帳で予約枠をクリックしても何も起きない
3. 受付中の録音画面で数字（経過時間など）が動かない
4. 設定画面で予約枠が火曜日に固定されているなど、設定の詰めが甘い
5. 顧客情報の入力項目が少なすぎる
6. 画面のユースケースが全体的に足りず情報が薄い
7. HIG 準拠のはずが「ぬるぬる」した直感的な操作感が無い

## 訂正の記録

- 2026-09-03: 旧 WEB-01/02/03（「Web 予約が成立しない」）を撤回。
  ブラウザの時計を 2026-08-27 に固定したまま、サーバの実時間に依存する
  公開側の空き枠 API を叩いたための誤判定だった。
  時計を外して再測したところ Web 予約は 12 タップで完走する。
  public-web の領域スコアを 15 → 70、総合を 32 → 38 に改めた。
  **教訓: `worker/index.ts` の公開エンドポイントは `new Date()`（サーバ実時間）を見る。
  公開側を検証するときはブラウザの時計を固定しない。**
- 2026-09-03: レビュー 2 本を反映。**追加で 4 件を撤回**した。
  - 旧 LEDGER-07（絞り込みの UI が無い）→ `ReservationList.tsx:190-213` に実装があり動作する
  - 旧 RECEP-03（本日すべてタブが機能しない）→ `scope` は正しく切り替わる。seed に来店記録が無いだけ
  - 旧 ANA-01（予約数が 3 通り）→ `seed.mjs:973-991` が週合計を代表日に書いた値。製品の欠陥ではない
  - 旧 HIG-01（transition が製品全体で 0 件）→ grep 範囲が `services/.../src/web` に限られ
    `packages/ui` を見ていなかった。共有 `Button` は `transition-colors` と `hover:` を持つ
  - REC-03 の原因も書き換え（`RecordingPlayer` は 3 か所から描画されている）
  - RECEP-02 は spec 変更案件へ格上げ（`visit-board.ts:414-421` の受入基準に基づく実装）
  **教訓: ①grep の範囲に `packages/` を含める ②サーバ側の集計を読む所見は seed の作りを先に読む
  ③画面単位でなくタスク単位の台本で歩く。**
