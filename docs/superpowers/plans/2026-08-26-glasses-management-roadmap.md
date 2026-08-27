# glasses_management プログラムロードマップ

**目的:** EYEX予約の全181 UC・125 ACを、独立した検証可能なフェーズで `glasses_management` に実装する。

**正本:** `specs/glasses_management/features/002-eyex-reservation-product/spec.md`、`docs/superpowers/specs/2026-08-26-glasses-management-design.md`、同featureの`design/SCREEN_INVENTORY.md`。

## フェーズと完了条件

| フェーズ | 成果 | 主なUC/AC | 完了条件 |
|---|---|---|---|
| 0 | サービス移行と基盤 | 横断 | 旧モック廃止、新Worker/D1/R2/KV/notifier/admin連携、権限・監査・冪等・JSTの骨格 |
| 1 | 受付可否エンジン | UC 087–098, 109–122, 159–166 | 店舗、営業時間、目的、技能、勤務、設備、資源確保、設定版 |
| 2 | 電話・店頭予約と顧客 | UC 001–042, 172–177 | 5工程、顧客候補、復唱、競合、録音、顧客台帳 |
| 3 | 台帳・来店・検索 | UC 043–062 | ウォークイン、進捗、現在時刻、検索、変更、取消、履歴 |
| 4 | 店舗切替と共有iPad | UC 063–072, 130–138, 150–158 | 店舗境界、共有端末、PIN再認証、失効、PIIマスク |
| 5 | 顧客向けWeb予約 | UC 073–086, 167–171 | ポータル、店舗URL、確定メール、管理コード、変更取消、成立照会 |
| 6 | 設定公開・注意事項 | UC 139–148, 159–166 | 下書き、影響確認、公開、復元、注意事項の版・レビュー・権限 |
| 7 | 録音運用・監査 | UC 035–042, 123–129, 153–156 | R2再生、最低保持、保全、削除照合、追記型監査 |
| 8 | 分析・通知・訂正 | UC 099–108, 178–181 | 集計、抑制、アラート、既読/対応、顧客統合・誤関連解除 |
| 9 | 画面証跡と品質 | 全UC/AC | 全状態、アクセシビリティ、E2E一意対応、coverage、`pnpm check` |

## フェーズ共通TODO

- [ ] 対象UC/ACを、実装前に失敗するunit/integration/E2Eテストへ落とす。
- [ ] `*.time.test.ts`でJST・期限のちょうど／±境界を固定時計で検証する。
- [ ] `permissions.test.ts`へ全APIの未認証、期限切れ、別署名、staff、admin、共有端末、未知パスを追加する。
- [ ] `tenant-isolation.test.ts`で3組織・複数店舗・偽装入力・越境read/writeを検証する。
- [ ] 画面IDごとに通常と該当するexception状態の個別PNG・viewport・UC/ACを記録する。
- [ ] 実装後に対象serviceの`test:all`と`e2e`、最終的に`pnpm check`を実行する。

## 実行順の依存

`0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9` を基本順序とする。Phase 7の録音メタデータ基盤はPhase 2で先行してよいが、R2削除照合と運用画面の完了判定はPhase 7とする。Phase 5はPhase 1の可否エンジンとPhase 2の予約確定を消費する。Phase 9は各フェーズ完了時にも増分で実行する。
