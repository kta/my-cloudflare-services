# EYEX予約 実装画面の証跡（impl スクリーンショット）

`specs/glasses_management/features/002-eyex-reservation-product/design/SCREEN_INVENTORY.md`
の screen_id ごとに、**実装が実際に描画している画面**を撮ったものである。承認済み
モック（`docs/frontend/mockups/eyex-reservation/`）と並べて突き合わせるための証跡で、
ロードマップ Phase 9 の「画面IDごとに通常と該当するexception状態の個別PNG・viewport・
UC/ACを記録する」に対応する。

- 撮影日: 2026-08-27
- 実装ソース: ブランチ `002-eyex-reservation-product`
- 生成物: 44枚（`impl--<screen_id>--<state_id>--<viewport>.png`）
- viewport: `ipad-landscape` = 1180×820 / `sp` = 375×812、いずれも
  `deviceScaleFactor: 1`・`fullPage: true`

ファイル名はモック PNG と同じ `<screen_id>--<state_id>--<viewport>.png` に `impl--`
を付けただけである。したがって同じ行の 2 つのファイル名は、接頭辞以外が一致する。

## 再生成

`services/glasses_management` を作業ディレクトリにして実行する。ポート 4175 が
埋まっていることがあるので、先に落とす。

```sh
lsof -ti:4175 | xargs kill -9; pnpm run build && (pnpm exec vite preview --port 4175 --strictPort &) && sleep 5 && node e2e/screens.capture.ts
```

- スクリプト本体は `services/glasses_management/e2e/screens.capture.ts`。
  `*.spec.ts` ではないので `playwright.config.ts` の `testDir: './e2e'` からは
  **収集されない**（`pnpm exec playwright test` は従来どおり 86 tests / 13 files）。
- API はすべて `page.route` で差し替えており、フィクスチャと画面遷移は
  `e2e/*.spec.ts` が主張しているものと同じである。したがって各 PNG は、対応する
  E2E が assert している状態そのものを写している。
- 何度実行しても同じ 44 個のファイル名を上書きするだけなので、**ファイル集合の
  意味では冪等**である。ただし当日日付・録音の保持期限（実行時刻からの相対値）が
  画面に出る screen_id があるため、バイト列は実行ごとに変わりうる。

## 台帳

| screen_id | 実装 PNG | 承認モック PNG | viewport | UC | AC |
|---|---|---|---|---|---|
| HOME-DEFAULT | `impl--HOME-DEFAULT--default--ipad-landscape.png` | `HOME-DEFAULT--default--ipad-landscape.png` | 1180×820 | 001–008 | 01,09,120,122–125 |
| BOOK-MIC-PERMISSION | `impl--BOOK-MIC-PERMISSION--default--ipad-landscape.png` | `BOOK-MIC-PERMISSION--default--ipad-landscape.png` | 1180×820 | 031–034,177 | 05,07,113–115 |
| BOOK-TIME | `impl--BOOK-TIME--selected--ipad-landscape.png` | `BOOK-TIME--selected--ipad-landscape.png` | 1180×820 | 009–014 | 01,02,88 |
| BOOK-PURPOSE-CONFLICT | `impl--BOOK-PURPOSE-CONFLICT--resource-conflict--ipad-landscape.png` | `BOOK-PURPOSE-CONFLICT--resource-conflict--ipad-landscape.png` | 1180×820 | 013–019,088–091 | 08,43,44,68,88 |
| BOOK-CUSTOMER | `impl--BOOK-CUSTOMER--multiple-selected--ipad-landscape.png` | `BOOK-CUSTOMER--multiple-selected--ipad-landscape.png` | 1180×820 | 021–030 | 03,04,10,20,21,24,91 |
| BOOK-REPEAT | `impl--BOOK-REPEAT--default--ipad-landscape.png` | `BOOK-REPEAT--default--ipad-landscape.png` | 1180×820 | 020,031–042 | 05–08,15,75–79,115 |
| LEDGER-DAY | `impl--LEDGER-DAY--walkin-now--ipad-landscape.png` | `LEDGER-DAY--walkin-now--ipad-landscape.png` | 1180×820 | 043–054 | 11–13,17–19,25,26 |
| RES-SEARCH | `impl--RES-SEARCH--store-fixed--ipad-landscape.png` | `RES-SEARCH--store-fixed--ipad-landscape.png` | 1180×820 | 055–072 | 14,15,20–23,27–31,60,62,79,90 |
| CUSTOMER-CURRENT | `impl--CUSTOMER-CURRENT--default--ipad-landscape.png` | `CUSTOMER-CURRENT--default--ipad-landscape.png` | 1180×820 | 021–030,139–148,181 | 04,10,16,24,84–87,91,116–118,121 |
| JOURNEY-DEFAULT | `impl--JOURNEY-DEFAULT--default--ipad-landscape.png` | `JOURNEY-DEFAULT--default--ipad-landscape.png` | 1180×820 | 047–054 | 11,12,17,18,25,26 |
| STORE-SWITCH | `impl--STORE-SWITCH--default--ipad-landscape.png` | `store-switch-approved.png`（画面全体のモック。個別 PNG なし） | 1180×820 | 063–072 | 27–31,55,62 |
| SETTINGS-STORE-HOURS | `impl--SETTINGS-STORE-HOURS--draft--ipad-landscape.png` | `SETTINGS-STORE-HOURS--draft--ipad-landscape.png` | 1180×820 | 087,092–098 | 40,41,45,46,48 |
| SETTINGS-PURPOSES | `impl--SETTINGS-PURPOSES--draft--ipad-landscape.png` | `SETTINGS-PURPOSES--draft--ipad-landscape.png` | 1180×820 | 088,089,092–098,117–122 | 40–48,67–70 |
| SETTINGS-STAFF-SKILLS | `impl--SETTINGS-STAFF-SKILLS--impact--ipad-landscape.png` | `SETTINGS-STAFF-SKILLS--impact--ipad-landscape.png` | 1180×820 | 090,092–098 | 40,43,45,46,48 |
| SETTINGS-EQUIPMENT | `impl--SETTINGS-EQUIPMENT--maintenance--ipad-landscape.png` | `SETTINGS-EQUIPMENT--maintenance--ipad-landscape.png` | 1180×820 | 091–098 | 40,44–48 |
| SETTINGS-WEB | `impl--SETTINGS-WEB--scheduled--ipad-landscape.png` | `SETTINGS-WEB--scheduled--ipad-landscape.png` | 1180×820 | 109–116 | 63–71 |
| SETTINGS-IMPACT | `impl--SETTINGS-IMPACT--blocked--ipad-landscape.png` | `SETTINGS-IMPACT--blocked--ipad-landscape.png` | 1180×820 | 093–097,115,159–166 | 45,46,66,104–109 |
| SETTINGS-RESULT | `impl--SETTINGS-RESULT--partial-failure--ipad-landscape.png` | `SETTINGS-RESULT--partial-failure--ipad-landscape.png` | 1180×820 | 092–098,159–166 | 45–48,63–71,104–109 |
| SETTINGS-SP | `impl--SETTINGS-SP--default--sp.png` | `settings-responsive-approved.png`（画面全体のモック。個別 PNG なし） | 375×812 | 087–122 | 72–74 |
| DEVICE-LIST | `impl--DEVICE-LIST--default--ipad-landscape.png` | `DEVICE-LIST--default--ipad-landscape.png` | 1180×820 | 130–138,150–152,157,158 | 80–83,96–98 |
| REAUTH | `impl--REAUTH--manager-pin--ipad-landscape.png` | `REAUTH--manager-pin--ipad-landscape.png` | 1180×820 | 137,138 | 82,87,101 |
| RECORDING-OPS | `impl--RECORDING-OPS--failure-hold--ipad-landscape.png` | `RECORDING-OPS--failure-hold--ipad-landscape.png` | 1180×820 | 035–042,123–129,153,154 | 75–79,99–101,115 |
| ATTENTION-PERMISSIONS | `impl--ATTENTION-PERMISSIONS--default--ipad-landscape.png` | `ATTENTION-PERMISSIONS--default--ipad-landscape.png` | 1180×820 | 139–148 | 84–87,118 |
| ATTENTION-REVIEW | `impl--ATTENTION-REVIEW--pending--ipad-landscape.png` | `ATTENTION-REVIEW--pending--ipad-landscape.png` | 1180×820 | 141–147 | 85–87,116,117 |
| AUDIT-DETAIL | `impl--AUDIT-DETAIL--default--ipad-landscape.png` | `AUDIT-DETAIL--default--ipad-landscape.png` | 1180×820 | 038,071,096,129,133,147,155,156 | 23,60,78,80,81,86,102,103 |
| ANALYTICS | `impl--ANALYTICS--default--ipad-landscape.png` | `analytics-approved.png`（画面全体のモック。個別 PNG なし） | 1180×820 | 099–108,180 | 49–55,119 |
| RECEPTION-HISTORY | `impl--RECEPTION-HISTORY--default--ipad-landscape.png` | `reception-history-approved.png`（画面全体のモック。個別 PNG なし） | 1180×820 | 054–062 | 56–62 |
| EX-MIC-DENIED | `impl--EX-MIC-DENIED--default--ipad-landscape.png` | `EX-MIC-DENIED--default--ipad-landscape.png` | 1180×820 | 033,034,177 | 113–115 |
| EX-UPLOAD-FAILED | `impl--EX-UPLOAD-FAILED--retry--ipad-landscape.png` | `EX-UPLOAD-FAILED--retry--ipad-landscape.png` | 1180×820 | 034,041,062,176 | 77,100,111,115 |
| EX-CONFLICT | `impl--EX-CONFLICT--stale--ipad-landscape.png` | `EX-CONFLICT--stale--ipad-landscape.png` | 1180×820 | 172,173 | 110 |
| EX-STORE-UNSAVED | `impl--EX-STORE-UNSAVED--confirm--ipad-landscape.png` | `EX-STORE-UNSAVED--confirm--ipad-landscape.png` | 1180×820 | 065,070 | 29,30 |
| EX-SHARED-LOCK | `impl--EX-SHARED-LOCK--masked--ipad-landscape.png` | `EX-SHARED-LOCK--masked--ipad-landscape.png` | 1180×820 | 135,157 | 97 |
| EX-SESSION-REVOKED | `impl--EX-SESSION-REVOKED--default--ipad-landscape.png` | `EX-SESSION-REVOKED--default--ipad-landscape.png` | 1180×820 | 136,158 | 83,98,112 |
| EX-EMPTY | `impl--EX-EMPTY--default--ipad-landscape.png` | `EX-EMPTY--default--ipad-landscape.png` | 1180×820 | 054–057 | 57,61 |
| EX-403 | `impl--EX-403--default--ipad-landscape.png` | `EX-403--default--ipad-landscape.png` | 1180×820 | 029,042,098,106,137 | 79,82,91 |
| WEB-STORE-SEARCH | `impl--WEB-STORE-SEARCH--default--sp.png` | `WEB-STORE-SEARCH--default--sp.png` | 375×812 | 073,074,167,168 | 92 |
| WEB-STORE-DETAIL | `impl--WEB-STORE-DETAIL--default--sp.png` | `WEB-STORE-DETAIL--default--sp.png` | 375×812 | 074,167,168 | 92 |
| WEB-PURPOSE | `impl--WEB-PURPOSE--selected--sp.png` | `WEB-PURPOSE--selected--sp.png` | 375×812 | 075,111,118 | 32–34,67,70,93 |
| WEB-DATETIME | `impl--WEB-DATETIME--selected--sp.png` | `WEB-DATETIME--selected--sp.png` | 375×812 | 076,082,083 | 35,36 |
| WEB-CUSTOMER | `impl--WEB-CUSTOMER--filled--sp.png` | `WEB-CUSTOMER--filled--sp.png` | 375×812 | 077 | 32,33 |
| WEB-CONFIRM | `impl--WEB-CONFIRM--default--sp.png` | `WEB-CONFIRM--default--sp.png` | 375×812 | 078,079,086 | 37,38 |
| WEB-COMPLETE | `impl--WEB-COMPLETE--default--sp.png` | `WEB-COMPLETE--default--sp.png` | 375×812 | 080 | 39 |
| WEB-IDENTITY | `impl--WEB-IDENTITY--code--sp.png` | `WEB-IDENTITY--code--sp.png` | 375×812 | 081,113,169,170 | 94 |
| WEB-UNKNOWN | `impl--WEB-UNKNOWN--checking--sp.png` | `WEB-UNKNOWN--checking--sp.png` | 375×812 | 079,084,171 | 38,95 |

UC / AC の番号は `UC-EYEX-xxx` / `AC-EYEX-xx` の下 3 桁・2 桁であり、
`SCREEN_INVENTORY.md` の同じ行から写している。

## 未到達

`SCREEN_INVENTORY.md` の 43 行のうち、ブラウザで到達できなかった screen_id は
**無い**。上表の 43 行（+ 承認モックに個別 PNG が無い 4 行を含む）をすべて撮影して
いる。

補足として、下記は「撮れているが、モック側に対応する個別 PNG が無い」ものである。
比較は画面全体のモック HTML / PNG に対して行う。

| screen_id | 比較先 |
|---|---|
| STORE-SWITCH | `store-switch-approved.png` / `store-switch-approved.html` |
| SETTINGS-SP | `settings-responsive-approved.png` / `settings-responsive-approved.html` |
| ANALYTICS | `analytics-approved.png` / `analytics-approved.html` |
| RECEPTION-HISTORY | `reception-history-approved.png` / `reception-history-approved.html` |

## 注意

- 撮影ルール 4（200%文字拡大・キーボードfocus・Increase Contrast）と
  ルール 5（VoiceOver 名・role・value、Tab順、Escape、フォーカス復帰）は
  この台帳の対象外である。前者は別途アクセシビリティ試験の記録として、後者は
  PNG ではなく試験記録として残す。`e2e/staff-booking.spec.ts` の
  「keeps staff screens operable by keyboard, at 200% text…」がその挙動を
  自動で守っている。
- API はモックなので、ここに写っているのは**実装のレイアウトと文言**であって
  本番データではない。値の正しさは Worker 側の unit / integration テストが担う。
