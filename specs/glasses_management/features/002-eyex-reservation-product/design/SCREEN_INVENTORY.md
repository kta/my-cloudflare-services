# EYEX予約 画面・状態・証跡台帳

- 更新日: 2026-08-26
- 判定: 中核方向は承認済み。全状態の個別PNG生成と最終レビューが完了するまでは設計全体をApprovedにしない。

## トレーサビリティ

| screen_id | 画面・状態 | US | UC | AC | viewport | source |
|---|---|---|---|---|---|---|
| HOME-DEFAULT | トップ通常 | 04 | 001–008 | 01,09,120,122–125 | iPad横 | `approved.html#home` |
| BOOK-MIC-PERMISSION | マイク事前説明 | 03 | 031–034,177 | 05,07,113–115 | iPad横 | `approved.html#permission` |
| BOOK-TIME | 希望時刻 | 01 | 009–014 | 01,02,88 | iPad横 | `approved.html#time` |
| BOOK-PURPOSE-CONFLICT | 目的選択後の資源再検証 | 01,17 | 013–019,088–091 | 08,43,44,68,88 | iPad横 | `approved.html#purpose-conflict` |
| BOOK-CUSTOMER | 顧客候補複数・選択済み | 02 | 021–030 | 03,04,10,20,21,24,91 | iPad横 | `approved.html#customer` |
| BOOK-REPEAT | 復唱・確定 | 01,03 | 020,031–042 | 05–08,15,75–79,115 | iPad横 | `approved.html#repeat` |
| LEDGER-DAY | 台帳・現在時刻・ウォークイン | 07 | 043–054 | 11–13,17–19,25,26 | iPad横 | `staff-approved.html#ledger` |
| RES-SEARCH | 選択店舗固定検索・録音 | 04,08,09 | 055–072 | 14,15,20–23,27–31,60,62,79,90 | iPad横 | `staff-approved.html#reservation-search` |
| CUSTOMER-CURRENT | 現在情報優先 | 02 | 021–030,139–148,181 | 04,10,16,24,84–87,91,116–118,121 | iPad横 | `staff-approved.html#customer-ledger` |
| JOURNEY-DEFAULT | 来店受付・進捗 | 07 | 047–054 | 11,12,17,18,25,26 | iPad横 | `staff-approved.html#journey` |
| STORE-SWITCH | 店舗切替 | 09,10 | 063–072 | 27–31,55,62 | iPad横 | `store-switch-approved.html` |
| WEB-STORE-SEARCH | 全店ポータル店舗検索 | 06,11 | 073,074,167,168 | 92 | SP 375 | `web-booking-complete-approved.html#store-search` |
| WEB-STORE-DETAIL | 店舗詳細 | 06,11 | 074,167,168 | 92 | SP 375 | `web-booking-complete-approved.html#store-detail` |
| WEB-PURPOSE | Web来店目的 | 06,11 | 075,111,118 | 32–34,67,70,93 | SP 375 | `web-booking-complete-approved.html#purpose` |
| WEB-DATETIME | Web日時 | 06,11 | 076,082,083 | 35,36 | SP 375 | `web-booking-complete-approved.html#datetime` |
| WEB-CUSTOMER | Web顧客情報 | 06,11 | 077 | 32,33 | SP 375 | `web-booking-complete-approved.html#customer-info` |
| WEB-CONFIRM | Web確認 | 06,11 | 078,079,086 | 37,38 | SP 375 | `web-booking-complete-approved.html#confirm` |
| WEB-COMPLETE | Web完了 | 06,11 | 080 | 39 | SP 375 | `web-booking-complete-approved.html#complete` |
| WEB-IDENTITY | 本人確認・変更取消 | 06,11 | 081,113,169,170 | 94 | SP 375 | `web-booking-complete-approved.html#identity` |
| WEB-UNKNOWN | 成立不明照会 | 06,11 | 079,084,171 | 38,95 | SP 375 | `web-booking-complete-approved.html#unknown` |
| SETTINGS-STORE-HOURS | 店舗・営業時間 | 12,13 | 087,092–098 | 40,41,45,46,48 | iPad横 | `settings-complete-approved.html#store-hours` |
| SETTINGS-PURPOSES | 来店目的・初期値 | 12,13,17 | 088,089,092–098,117–122 | 40–48,67–70 | iPad横 | `settings-complete-approved.html#purposes` |
| SETTINGS-STAFF-SKILLS | スタッフ・技能・勤務 | 12,13 | 090,092–098 | 40,43,45,46,48 | iPad横 | `settings-complete-approved.html#staff-skills` |
| SETTINGS-EQUIPMENT | 設備・点検 | 12,13 | 091–098 | 40,44–48 | iPad横 | `settings-complete-approved.html#equipment` |
| SETTINGS-WEB | Web予約設定 | 16 | 109–116 | 63–71 | iPad横 | `settings-complete-approved.html#web-settings` |
| SETTINGS-IMPACT | 影響確認・公開 | 12,13,16,17 | 093–097,115,159–166 | 45,46,66,104–109 | iPad横 | `settings-complete-approved.html#impact` |
| SETTINGS-SP | 設定ガイド固定ステッパー | 12,16 | 087–122 | 72–74 | SP 375 | `settings-responsive-approved.html` |
| DEVICE-LIST | 共有端末・失効 | 18 | 130–138,150–152,157,158 | 80–83,96–98 | iPad横 | `operations-approved.html#devices` |
| REAUTH | 共有端末での管理再認証 | 18,19 | 137,138 | 82,87,101 | iPad横 | `operations-approved.html#reauth` |
| RECORDING-OPS | 保存期間・失敗・保全 | 03,08,15 | 035–042,123–129,153,154 | 75–79,99–101,115 | iPad横 | `operations-approved.html#recording-ops` |
| ATTENTION-PERMISSIONS | 注意事項権限 | 19 | 139–148 | 84–87,118 | iPad横 | `operations-approved.html#attention-settings` |
| ATTENTION-REVIEW | 確認待ち・公開・差戻し・却下 | 19 | 141–147 | 85–87,116,117 | iPad横 | `operations-approved.html#attention-review` |
| SETTINGS-RESULT | 公開結果・部分再試行・復元 | 12,13,16,17 | 092–098,159–166 | 45–48,63–71,104–109 | iPad横 | `operations-approved.html#publish-result` |
| AUDIT-DETAIL | 監査検索・詳細 | 15 | 038,071,096,129,133,147,155,156 | 23,60,78,80,81,86,102,103 | iPad横 | `operations-approved.html#audit` |
| ANALYTICS | 運用分析 | 14 | 099–108,180 | 49–55,119 | iPad横 | `analytics-approved.html` |
| RECEPTION-HISTORY | 受付履歴 | 04 | 054–062 | 56–62 | iPad横 | `reception-history-approved.html` |
| EX-MIC-DENIED | マイク拒否 | 03 | 033,034,177 | 113–115 | iPad横 | `exception-states-approved.html#mic-denied` |
| EX-UPLOAD-FAILED | 予約成立・録音保存失敗 | 03,08 | 034,041,062,176 | 77,100,111,115 | iPad横 | `exception-states-approved.html#upload-failed` |
| EX-CONFLICT | 同時編集409 | 02,07,19 | 172,173 | 110 | iPad横 | `exception-states-approved.html#conflict` |
| EX-STORE-UNSAVED | 未保存中の店舗切替 | 09 | 065,070 | 29,30 | iPad横 | `exception-states-approved.html#unsaved-store-switch` |
| EX-SHARED-LOCK | 共有端末PIIマスク | 18 | 135,157 | 97 | iPad横 | `exception-states-approved.html#shared-lock` |
| EX-SESSION-REVOKED | 共有セッション失効 | 18 | 136,158 | 83,98,112 | iPad横 | `exception-states-approved.html#session-revoked` |
| EX-EMPTY | 検索・履歴0件 | 04 | 054–057 | 57,61 | iPad横 | `exception-states-approved.html#empty` |
| EX-403 | 権限不足 | 15,18,19 | 029,042,098,106,137 | 79,82,91 | iPad横 | `exception-states-approved.html#permission-denied` |

## 撮影ルール

1. `overview`は目次用途に限定し、レビュー証跡は上表のscreen_id単位で個別PNGを作る。
2. ファイル名は `<screen_id>--<state_id>--<viewport>.png` とする。
3. iPad横は1024×768相当、Split Viewは最小実用幅、SPは375×812を基本とする。
4. 200%文字拡大、キーボードfocus、Increase Contrast相当は通常画面とは別に記録する。
5. VoiceOver名・role・value、Tab順、Escape、フォーカス復帰はPNGではなくアクセシビリティ試験記録へ残す。
