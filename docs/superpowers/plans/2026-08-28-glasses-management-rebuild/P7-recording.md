# P7 受付の録音 — TODO

- spec: [`specs/glasses_management/features/010-recording/spec.md`](../../../../specs/glasses_management/features/010-recording/spec.md)
- 依存: P5
- 状態: 未着手
- 目的: 受付の音を iPad のマイクで録り、非公開の R2 へ置き、予約詳細・予約検索・受付履歴から
  Worker 越しに聞けるようにする。マイクが使えないときと保存に失敗したときは「予約は成立している」ことと
  切り分けて知らせ、最低保持期限（成立 30 日 / 破棄 24 時間）より前には消せないようにする。

---

## このフェーズの前提（着手前に 3 分で確認する）

| 事項 | いまの前提 | 出どころ |
|---|---|---|
| マイクの直し方 3 手順 | 業務画面は「ホーム画面に追加」した Web アプリとして配る。EX-MIC-DENIED の 3 手順の文言をそのまま使う | `design/09-open-questions.md` Q-05 |
| `recording.read` をサーバで強制するか | **強制する**。再生・一覧は `recording.read`、保全・削除は `recording.manage` | `design/09-open-questions.md` Q-03 |
| 保持期間 | 成立予約は録音完了から 30 日、破棄受付は 24 時間、最低保持中の削除は拒否 | `design/09-open-questions.md` Q-02 |
| 再生チケットの寿命 | 900 秒（WCAG 2.2.1 の essential 免除を主張する） | `design/09-open-questions.md` Q-06 |
| 個人モード（`requirePersonalMode()`） | **P7 では作らない。** MODE-PERSONAL と PIN は `013-terminals-and-audit`（spec のスコープ外）。P7 は `requireStorePermission()` までで守る | `features/010-recording/spec.md` スコープ外 / `features/013-terminals-and-audit/spec.md` T-011 |
| `terminals` 表 | **P10 まで無い。** `reception_sessions.terminal_id` は常に NULL。端末名は `null` として扱い、`alerts.body` からその一句を落とす（モックの本文と一致する） | `design/03-data-model.md` §12 |

このフェーズで足す 3 つの逸脱（いずれも spec と設計文書の突き合わせで出たもの。実装者が迷わないようここで確定させる）:

1. **`GET /api/staff/alerts` を最小形で P7 に足す。** spec のスコープ外は「お知らせの一覧（ALERTS）の**画面**」であり、
   AC-REC-19 は「お知らせを見る」ことを求めている。読む経路が 1 本も無いと AC-REC-19 に E2E を 1 本も貼れない。
   P7 が足すのは `audience='store'` の一覧だけ（`kind` の 4 分類・`counts`・`PATCH`・`read-all` は P10）。
2. **`alerts.body` の上限は 120 文字**（`design/04-api.md` §4.9 の `Alert`）。`design/03-data-model.md` §11.3 の
   「0〜200文字」とは食い違うので、契約は 04-api を正とし、D1 の列は `text` のまま制限しない。
3. **破棄受付の録音が 3 回失敗したときの本文**は「ご予約は成立しています。」を使えない（予約が無い）。
   `受付の記録は残っています。` に差し替える。モックは成立予約の 1 状態しか描いていないので、
   DESIGN_RULE の品質フロアで補う範囲として扱う。

---

## T-001 契約を書く（Red）

- **目的**: 録音とお知らせの入出力の形を Zod で 1 か所に決め、**応答に R2 のキーが載らないこと**を型で固定する。
- **触るファイル**
  - `packages/contracts/src/glasses_management.ts`（追記）
  - `packages/contracts/src/index.ts`（re-export に足す）
  - `packages/contracts/test/glasses_management.contract.test.ts`（追記）
- **先に書くテスト**（`pnpm --filter @app/contracts test`）
  このファイルの既存のテスト名は英語なので、**そのファイルの慣習に合わせて英語で書く**（サービス側のテストは日本語）。
  - `RecordingCode` > `accepts EY-R-0001 and EY-R-10000 but not a reservation code`
  - `RecordingState` > `is an allow-list of five states and fails closed on anything else`
  - `RecordingContentType` > `accepts audio/mp4, audio/webm and audio/mpeg only`
  - `RecordingCreate` > `requires a reception session id, a store id and an ISO startedAt`
  - `RecordingCreate` > `rejects an unknown key so a stale client field never lands silently`
  - `RecordingStatePatch` > `bounds durationSeconds to 0..21600 and bytes to 0..104857600`
  - `RecordingStatePatch` > `accepts a failureReason of 120 characters and rejects 121`
  - `Recording` > `never carries the R2 key — parsing strips it`
  - `Recording` > `keeps reservationId nullable because a discarded reception has no reservation`
  - `Recording` > `bounds uploadAttempts to 0..99`
  - `RecordingSummary` > `carries only id, state and durationSeconds`
  - `RecordingListQuery` > `defaults limit to 50 and rejects 0 and 201`
  - `RecordingPlaybackTicket` > `requires a token of 32..256 characters`
  - `RecordingHoldInput` > `requires a reason of 1..120 characters`
  - `RecordingPurgeRequest` > `defaults limit to 100 and accepts an injected now`
  - `RecordingPurgeResult` > `counts examined, deleted, skippedHeld and failed`
  - `RecordingRetainedError` > `carries retainUntil and legalHold alongside the error code`
  - `AlertCode` > `is the ten-value allow-list and spells store.no_shift`
  - `Alert` > `bounds title to 1..60 and body to 0..120`
  - `AlertListQuery` > `defaults audience to store`
  - `AlertList` > `has the items / nextCursor / total shape`
- **実装**
  - 原始型に `RecordingCode = z.string().regex(/^EY-R-\d{4,5}$/)` を足す（組織で通しの 4 桁ゼロ埋め。
    9999 を越えたら 5 桁。`ReservationCode` とは別の採番系統）。
  - `RecordingState = z.enum(['recording','uploading','stored','failed','deleted'])`。
  - `RecordingContentType = z.enum(['audio/mp4','audio/webm','audio/mpeg'])`（既定 `audio/mp4`）。
  - `Recording` は `id` / `code` / `receptionSessionId` / `reservationId: Uuid|null` / `state` / `contentType` /
    `durationSeconds: int|null` / `bytes: int|null` / `retainUntil: IsoDateTime|null` / `legalHold: boolean` /
    `uploadAttempts: int 0..99` / `createdAt`。**`r2Key` を持たない**（`z.strictObject` にして、
    行をそのまま渡したら落ちるようにする）。
  - `Alert` / `AlertCode` / `AlertListQuery` / `AlertList` を足す。`AlertListQuery` は
    `storeId?` / `audience: 'store'|'ops' (既定 'store')` / `limit` / `cursor` の 4 つだけ（`kind` と `counts` は P10）。
- **完了条件**: 契約テストが緑。`packages/contracts` のカバレッジ 4 指標 80% 以上。
- **依存**: なし

## T-002 スキーマを書き、index を固定する（Red → Green）

- **目的**: `recordings` と `alerts` を足し、index が実際に投げるクエリの形に合っていることをテストで固定する。
- **触るファイル**
  - `services/glasses_management/src/worker/db/schema.ts`（追記）
  - `services/glasses_management/test/schema.test.ts`（追記）
  - `services/glasses_management/migrations/0006_*.sql`（生成物）
- **先に書くテスト**（`getTableConfig` で index の名前と対象列を見る。`pnpm --filter @app/glasses_management test`）
  - `recordings` > `録音番号は組織の中で一意（採番の衝突を DB が弾く）`
  - `recordings` > `保持期限切れを掃除する index を持つ`
  - `recordings` > `受付セッションから 1 本を引ける`
  - `recordings` > `予約から「録音を聞く」を引ける`
  - `recordings` > `外部キーを宣言しない`
  - `alerts` > `新しい順の一覧を引く index を持つ`
  - `alerts` > `未対応の件数を数える index を持つ`
- **実装**
  - `recordings`: `id`(PK) / `organization_id` / `store_id` / `code` / `reception_session_id` /
    `reservation_id`(NULL 可) / `r2_key` / `content_type` / `duration_seconds`(integer, NULL 可) /
    `bytes`(integer, NULL 可) / `state` / `retain_until` / `legal_hold`(`'0'|'1'`) /
    `upload_attempts`(integer) / `created_at` / `updated_at` / `deleted_at`(NULL 可)。
    index は `recordings_org_code_idx`（**一意**）/ `recordings_org_state_retain_idx` /
    `recordings_org_session_idx` / `recordings_org_reservation_idx`。
  - `alerts`: `id`(PK) / `organization_id` / `store_id` / `code` / `severity` / `audience` / `title` /
    `body`(NULL 可) / `target_type`(NULL 可) / `target_id`(NULL 可) / `occurred_at` / `read_at`(NULL 可) /
    `resolved_at`(NULL 可) / `resolved_by`(NULL 可) / `created_at`。
    index は `alerts_org_store_occurred_idx` / `alerts_org_store_resolved_idx`。
  - `r2_key` は `recordings/{organizationId}/{storeId}/{YYYY}/{MM}/{id}.{ext}`。前置 `recordings/` で
    手書き SVG（`notes/`）と分ける。**掃除はこの列が指すキーだけを消し、プレフィクス走査をしない**。
  - FK を宣言しない。真偽値は `'0'|'1'`。日時は ISO 文字列。DDL の DEFAULT に意味を持たせない。
- **手順**: 編集 → `pnpm --filter @app/glasses_management db:generate` → 生成された SQL を目で読む
  （テーブル再作成が出ていないこと）→ `db:migrate:local`
- **完了条件**: `migrations/0006_*.sql` が生成され、7 本が緑。
- **依存**: T-001

## T-003 保持期限の境界を書く（Red）

- **目的**: 「ちょうど」と「+1 秒」の両側を固定し、保全が期限より強いことを固定する。**時刻は引数で注入する。**
- **触るファイル**: `services/glasses_management/test/recording.time.test.ts`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management exec vitest run recording.time`）
  - `retainUntilFor` > `成立予約は stored になった時刻から 30 日後を返す`
  - `retainUntilFor` > `破棄受付は stored になった時刻から 24 時間後を返す`
  - `retainUntilFor` > `うるう年の 2月28日 に録った成立予約は 3月29日 を指す`
  - `canDelete` > `成立予約の 30 日ちょうどは消せない`
  - `canDelete` > `成立予約の 30 日と 1 秒で消せる`
  - `canDelete` > `破棄受付の 24 時間ちょうどは消せない`
  - `canDelete` > `破棄受付の 24 時間と 1 秒で消せる`
  - `canDelete` > `保全が立っていれば期限を 1 年過ぎても消せない`
  - `canDelete` > `保全を外した瞬間に、期限を過ぎているものは消せる`
  - `canDelete` > `state='deleted' の録音は二度目の削除を受け付けない`
  - `isStaleUpload` > `recording のまま 24 時間ちょうどは落とさない`
  - `isStaleUpload` > `recording のまま 24 時間と 1 秒で failed に落とす`
  - `isStaleUpload` > `stored の行は何時間経っても落とさない`
- **実装（テスト側の書き方）**: `now` は必ずテストが作った `new Date('2026-08-27T02:08:00.000Z')` 系の固定値を渡す。
  `Date.now()` / `vi.useFakeTimers()` に頼らない。30 日 = 2,592,000 秒、24 時間 = 86,400 秒を数値で書く。
- **完了条件**: 13 本が「関数が無い」理由で失敗する。
- **依存**: T-001

## T-004 状態遷移・採番・お知らせ本文を書く（Red）

- **目的**: 純関数の側（D1 も R2 も触らない部分）を先に固定する。
- **触るファイル**: `services/glasses_management/test/recording.domain.test.ts`（新規）
- **先に書くテスト**
  - `nextState` > `recording から uploading へ進める`
  - `nextState` > `uploading から stored へ進める`
  - `nextState` > `uploading から failed へ落とせる`
  - `nextState` > `failed から uploading へ戻せる（再送）`
  - `nextState` > `stored から recording へは戻せない`
  - `nextState` > `deleted からはどこへも動かせない`
  - `nextState` > `許されない遷移は invalid_transition を返し、例外を投げない`
  - `nextRecordingCode` > `1 本も無い組織では EY-R-0001 を返す`
  - `nextRecordingCode` > `EY-R-1482 の次は EY-R-1483`
  - `nextRecordingCode` > `EY-R-9999 の次は EY-R-10000（桁が伸びても書式は保つ）`
  - `r2KeyFor` > `recordings/ の前置と年月で分ける（手書きメモの notes/ と混ざらない）`
  - `r2KeyFor` > `同じ録音 id からは必ず同じキーが出る（再送が二重に置かれない）`
  - `uploadFailedAlert` > `成立予約は「EY-R-1482　田中 花子 様。ご予約は成立しています。」を本文にする`
  - `uploadFailedAlert` > `破棄受付は「受付の記録は残っています。」に差し替える`
  - `uploadFailedAlert` > `端末名があれば「銀座店 レジ横iPad に残っています」を後ろに足す`
  - `uploadFailedAlert` > `端末名が null なら端末の一句を落とす（P10 まではこちらになる）`
  - `uploadFailedAlert` > `本文が 120 文字を超えないよう、お客様名を先に切り詰める`
  - `uploadFailedAlert` > `見出しは常に「録音の保存に3回失敗しました」で severity は action`
- **完了条件**: 18 本が「関数が無い」理由で失敗する。
- **依存**: T-001

## T-005 代表フローを書く（Red）

- **目的**: 開始 → 本体送信 → 保存済み、失敗と再送、1 受付 1 録音、再生の 2 段、監査の残り方を、
  実 D1・実 R2・実 KV の上で固定する。
- **触るファイル**: `services/glasses_management/test/recording.integration.test.ts`（新規）/
  `services/glasses_management/test/helpers.ts`（受付セッションと予約を作るヘルパーを足す）
- **先に書くテスト**
  - 録音の開始 > `受付セッションを指して作ると state='recording' と EY-R-NNNN が返る`
  - 録音の開始 > `同じ受付セッションに 2 本目を作ろうとしても 1 本しか立たない`
  - 録音の開始 > `知らない受付セッションを指すと 404 not_found`
  - 本体の受け取り > `audio/mp4 を送ると R2 に 1 オブジェクトが増え state='stored' になる`
  - 本体の受け取り > `応答に r2Key もダウンロード URL も含まれない`
  - 本体の受け取り > `成立予約の retainUntil は stored の 30 日後になる`
  - 本体の受け取り > `破棄受付の retainUntil は stored の 24 時間後になる`
  - 本体の受け取り > `100MB を 1 バイト超えると 413 payload_too_large`
  - 本体の受け取り > `許可リストに無い Content-Type は 400`
  - 保存の失敗 > `failed へ落とすと upload_attempts が 1 増える`
  - 保存の失敗 > `3 回目の失敗で alerts に 1 行だけ立つ（4 回目で増えない）`
  - 保存の失敗 > `再送が成功すると stored になり、同じ R2 キーを上書きする`
  - 保存の失敗 > `stored の録音に retry を投げると 409 invalid_transition`
  - 再生 > `playback が 900 秒のチケットを返し、KV に play:<org>:<token> が 1 本置かれる`
  - 再生 > `チケットつきの stream が音声そのものを返す（JSON ではない）`
  - 再生 > `Range ヘッダーを付けると 206 と Content-Range が返る`
  - 再生 > `チケット無しの stream は 401 unauthorized`
  - 再生 > `別の録音のチケットでは開けない`
  - 保全と削除 > `hold を立てると legalHold が true になる`
  - 保全と削除 > `期限内の削除は 409 recording_retained で retainUntil と legalHold を返す`
  - 保全と削除 > `期限後・保全なしの削除は R2 のオブジェクトを消して state='deleted' にする（行は残る）`
  - 一覧 > `state=failed で絞ると失敗した録音だけが items / nextCursor / total の形で返る`
  - 監査 > `開始・保存・失敗・再生・保全・解除・削除が audit_events に 1 行ずつ残る`
  - 監査 > `再生は必ず残る（チケットを出すたびに 1 行）`
  - 監査 > `1 本の録音に対する操作を時系列で引ける`
- **注意**: D1 / KV / R2 はテストファイル内で共有される。組織 id は毎回 `crypto.randomUUID()` で作る。
- **完了条件**: 25 本が「ルートがまだ無い」理由で赤い（内訳は 開始 3 / 本体 6 / 失敗 4 / 再生 5 /
  保全と削除 3 / 一覧 1 / 監査 3）。緑にするのは T-010（14 本）・T-011（8 本）・T-013（3 本）である。
- **依存**: T-002

## T-006 権限マトリクスに録音の行を足す（Red）

- **目的**: 新しい 11 本のルートが default-deny の内側にあり、401（期限切れ）と 403（権限不足）を取り違えないことを固定する。
- **触るファイル**: `services/glasses_management/test/permissions.test.ts`
- **先に書くテスト**: 主体 6 種（未認証 / 権限なし staff / `recording.read` を持つ staff /
  `recording.manage` を持つ staff / 期限切れ / 別 secret 署名）× 経路 11 本の表に足す。
  - `POST /api/staff/recordings`
  - `PUT /api/staff/recordings/:id/content`
  - `PATCH /api/staff/recordings/:id`
  - `POST /api/staff/recordings/:id/retry`
  - `GET /api/staff/recordings`
  - `POST /api/staff/recordings/:id/playback`
  - `GET /api/staff/recordings/:id/stream`
  - `POST /api/staff/recordings/:id/hold`
  - `DELETE /api/staff/recordings/:id`
  - `GET /api/staff/alerts`
  - `POST /api/internal/maintenance/recordings/purge`
  加えて次の 5 本:
  - `期限切れトークンは 403 ではなく 401 を返す（固定の過去時刻で作る）`
  - `テナントのトークンでは保守の経路に触れない`
  - `違う共有鍵の保守呼び出しは 401`
  - `鍵なしの保守呼び出しは 401`
  - `録音の未知パス（/api/staff/recordings/not-a-route）も default-deny で塞がる`
- **要る権限**（`design/04-api.md` §2.2）: 一覧・再生・ストリームは `recording.read`、保全・削除は `recording.manage`。
  開始・本体・状態更新・再送は権限を要求しない（受付そのものの操作なので）。
  **「ご本人の確認」は P7 では要求しない**（P10 が `requirePersonalMode()` を足して同じ表に行を増やす）。
- **完了条件**: 追加した行がすべて緑。
- **依存**: T-002

## T-007 テナント分離に録音の観点を足す（Red）

- **目的**: 他組織・権限外店舗の録音が、読めない・聞けない・保全できない・一覧にも出ないことを潰す。
- **触るファイル**: `services/glasses_management/test/tenant-isolation.test.ts`
- **先に書くテスト**
  - `3 テナントが同時に録音を持っても、各自の録音しか一覧に出ない`
  - `他テナントの録音 id を直接指しても 404 で、存在の有無すら漏れない`
  - `他テナントで発行した再生チケットは、こちらの stream では通らない`
  - `他テナントの録音に保全を立てられない`
  - `他テナントの録音を削除できない`
  - `クエリに他テナントの organizationId を混ぜても自分の録音しか返らない`
  - `保守の掃除は組織をまたいで他テナントの録音を消さない`
  - `alerts も組織で絞られ、他テナントのお知らせが混ざらない`
- **完了条件**: 8 本が緑。
- **依存**: T-002

## T-008 `domain/retention.ts` を実装する（Green）

- **目的**: T-003 を緑にする。最低保持期限の算出と削除可否を、時刻を引数で受ける純関数にする。
- **触るファイル**: `services/glasses_management/src/worker/domain/retention.ts`（新規）
- **実装**
  - `retainUntilFor({ hasReservation: boolean, storedAt: Date }): Date` —
    成立予約は `storedAt + 2_592_000 秒`、破棄受付は `storedAt + 86_400 秒`。
  - `canDelete({ state, retainUntil, legalHold, now }): { ok: true } | { ok: false; retainUntil; legalHold }` —
    `legalHold` が真なら不可。`now <= retainUntil` なら不可（**ちょうどは不可、+1 秒で可**）。
    `state === 'deleted'` なら不可。
  - `isStaleUpload({ state, createdAt, now }): boolean` — `state` が `recording` / `uploading` / `failed` で
    `now - createdAt > 86_400 秒` のとき真（**ちょうどは偽**）。
  - `Date.now()` をこのファイルに書かない。ISO 文字列の比較は `toISOString()` 同士なら辞書順で正しく並ぶので、
    D1 のクエリ側は文字列比較のままでよい（この一句をコメントに残す）。
- **完了条件**: `recording.time.test.ts` の 13 本が緑。
- **依存**: T-003

## T-009 `domain/recording.ts` を実装する（Green）

- **目的**: T-004 を緑にする。状態遷移・録音番号の採番・R2 キー・お知らせ本文を純関数にする。
- **触るファイル**: `services/glasses_management/src/worker/domain/recording.ts`（新規）
- **実装**
  - `nextState(current, wanted): { ok: true; state } | { ok: false; error: 'invalid_transition' }`。
    許す辺は `recording→uploading` / `recording→failed` / `uploading→stored` / `uploading→failed` /
    `failed→uploading` の 5 本だけ。`stored` と `deleted` からは動かせない。**例外を投げない**（呼び出し側が 409 にする）。
  - `nextRecordingCode(previous: string | null): string` — `null` なら `EY-R-0001`。
    数値部 + 1 を 4 桁ゼロ埋め。9999 を越えたらゼロ埋めせず 5 桁にする。
  - `r2KeyFor({ organizationId, storeId, id, contentType, createdAt }): string` —
    `recordings/{organizationId}/{storeId}/{YYYY}/{MM}/{id}.{ext}`。`ext` は `audio/mp4`→`m4a`、
    `audio/webm`→`webm`、`audio/mpeg`→`mp3`。`createdAt` の年月は **JST** で切る。
  - `uploadFailedAlert({ code, customerName, hasReservation, terminalName }): { title; body; severity; code }` —
    `title` は `録音の保存に3回失敗しました`、`severity` は `action`、`code` は `recording.upload_failed`。
    `body` は `{code}　{customerName} 様。{成立文}` に、端末名があれば `　{terminalName} に残っています` を足す。
    成立文は `ご予約は成立しています。` / `受付の記録は残っています。` の 2 つだけ。**120 文字を超えないよう
    お客様名から先に切り詰める**（切り詰めたら末尾に `…` を付ける）。
- **完了条件**: `recording.domain.test.ts` の 18 本が緑。
- **依存**: T-004

## T-010 録音のルート 5 本を実装する（Green）

- **目的**: 開始・本体の受け取り・状態更新・再送・一覧を通す。
- **触るファイル**: `services/glasses_management/src/worker/index.ts`（チェーンに足す）
- **実装**
  - `POST /api/staff/recordings`（`zValidator('json', RecordingCreate)`）—
    `reception_sessions` を org + store で引き、無ければ 404 `not_found`。既に録音があればその行を返す（1 受付 1 録音）。
    `code` は `ORDER BY length(code) DESC, code DESC LIMIT 1` で直前の番号を読み、`nextRecordingCode()` で採番。
    **一意 index に弾かれたら最大 5 回まで再試行する**（`walk_ins.ticket_no` と同じ作法。採番の衝突は失敗に数えない）。
    `state='recording'` / `upload_attempts=0` / `legal_hold='0'` で INSERT。
  - `PUT /api/staff/recordings/:recordingId/content` — 生 body を受ける唯一のルート。
    `Content-Type` を `RecordingContentType` で検査し、外れたら 400。`Content-Length` が 104,857,600 を
    超えたら 413 `payload_too_large`（**この 1 回を失敗として数える**）。`c.env.RECORDINGS.put(r2Key, body)` →
    `state='stored'` / `retain_until` / `bytes` / `duration_seconds` / `updated_at` を `db.batch()` で書く。
    **同じ `r2_key` へ上書きするので、再送で R2 に二重に置かれない。**
  - `PATCH /api/staff/recordings/:recordingId`（`RecordingStatePatch`）— `nextState()` が偽なら 409 `invalid_transition`。
    `failed` へ落とすときに `upload_attempts` を 1 増やし、**3 に達したら `alerts` に 1 行立てる**
    （同じ `code` + `target_id` の未解決行があれば作らない）。
  - `POST /api/staff/recordings/:recordingId/retry` — `failed` からのみ `uploading` へ戻す。
    それ以外は 409 `invalid_transition`。**サーバは音声を持っていないので、ここでは状態を戻すだけ**
    （実体を送り直すのは端末。T-016）。
  - `GET /api/staff/recordings`（`zValidator('query', RecordingListQuery)`）— `{ items, nextCursor, total }`。
    並びは `created_at` 昇順。`OFFSET` を使わず `(created_at, id)` の複合カーソルにする。
  - 応答はすべて `Recording.parse(...)` を通してから `c.json` する（**行をそのまま返さない**。`r2Key` が漏れる）。
- **完了条件**: `recording.integration.test.ts` のうち 開始 3 本・本体 6 本・失敗 4 本・一覧 1 本の
  **合計 14 本**が緑。
- **依存**: T-005, T-008, T-009

## T-011 再生の 2 段と保全・削除を実装する（Green）

- **目的**: R2 のキーもダウンロード URL も画面へ出さずに、その場で聞けるようにする。
- **触るファイル**
  - `services/glasses_management/src/worker/domain/playback.ts`（新規）
  - `services/glasses_management/src/worker/index.ts`
- **実装**
  - `issueTicket({ organizationId, recordingId, staffId, now })` — `crypto.randomUUID()` を 2 本つないだ
    64 文字のトークンを作り、KV `SHORT_LIVED` の `play:<orgId>:<token>` に **TTL 900 秒**で
    `{ recordingId, storeId, staffId }` を置く。`expiresAt = now + 900 秒`。
  - `verifyTicket({ organizationId, recordingId, token })` — 鍵が無い / 別 org / 別 recording なら偽。
    **`Authorization` ヘッダーの代わりではなく上乗せ**（ヘッダーだけでは他店舗の録音まで開けてしまう）。
  - `POST /api/staff/recordings/:recordingId/playback`（`recording.read`）— `state='stored'` 以外は 404。
    `RecordingPlaybackTicket` を返し、**`audit_events` に `recording.played` を必ず 1 行残す**。
  - `GET /api/staff/recordings/:recordingId/stream`（`recording.read` + query `token`）—
    `verifyTicket` が偽なら 401 `unauthorized`。R2 から読み、`Range` があれば 206 と `Content-Range` を返す。
    **このルートだけは応答が JSON ではないので契約 `parse` の対象外にする**。その理由をコードのコメントに残す。
  - `POST /api/staff/recordings/:recordingId/hold`（`recording.manage`。`RecordingHoldInput`）—
    `legal_hold` を `'0'|'1'` で書き、`recording.hold_set` / `recording.hold_cleared` を監査に残す。
  - `DELETE /api/staff/recordings/:recordingId`（`recording.manage`）— `canDelete()` が偽なら
    **409 `recording_retained`**（応答に `retainUntil` と `legalHold` を載せる）。真なら
    `RECORDINGS.delete(r2Key)` → `state='deleted'` / `deleted_at` を書く。**行は消さない。**
  - `GET /api/staff/alerts`（`zValidator('query', AlertListQuery)`）— `audience='store'` を既定にして
    `occurred_at` の新しい順に返す。P7 が返すのは `{ items, nextCursor, total }` まで
    （`counts` と 4 分類のタブは P10）。
- **完了条件**: 再生 5 本・保全と削除 3 本の **合計 8 本**が緑（`GET /api/staff/alerts` はここで足すが、
  一覧の 1 本は T-010 で緑になっている）。
- **依存**: T-010

## T-012 保守の経路と Cron を 1 本足す（Green）

- **目的**: 保持期限を過ぎた録音の実体を消し、24 時間動かない録音を `failed` に落としてお知らせに上げる。
- **触るファイル**
  - `services/glasses_management/src/worker/index.ts`（`POST /api/internal/maintenance/recordings/purge`）
  - `services/glasses_management/wrangler.jsonc`（`triggers.crons` を新設）
  - `services/glasses_management/worker-configuration.d.ts`（`pnpm -r cf-typegen` の生成物）
- **実装**
  - `POST /api/internal/maintenance/recordings/purge`（共有鍵。`RecordingPurgeRequest`）—
    `now` を受け取れるようにする（テストの注入口）。`limit` 既定 100。
    1. `state='stored'` かつ `retain_until < now` の行を `recordings_org_state_retain_idx` で引く。
    2. `legal_hold='1'` は触らず `skippedHeld` に数える。
    3. `RECORDINGS.delete(r2Key)` → `state='deleted'` / `deleted_at`。失敗したら `failed` に数え、
       **行はそのまま残して次回の実行で再び対象にする**。
    4. `isStaleUpload()` が真の行を `state='failed'` にし、`uploadFailedAlert()` の 1 行を立てる
       （同じ `code` + `target_id` の未解決行があれば作らない）。
    5. `RecordingPurgeResult`（`examined` / `deleted` / `skippedHeld` / `failed`）を返す。
    6. **プレフィクス走査で R2 を消さない**（`notes/` の手書きメモを巻き込む）。行が指すキーだけを消す。
  - `wrangler.jsonc` に `"triggers": { "crons": ["55 14 * * *"] }` を足し（UTC。**JST 23:55** の意図をコメントに残す）、
    `export default { fetch: app.fetch, scheduled }` に変える。`scheduled` は purge を try/catch で包んで呼ぶだけにし、
    **1 つが失敗しても後続を止めない**形を最初から作る（P8 以降がこの中に処理を足す）。
    これは `design/04-api.md` §3.2 の「Cron を最初に必要とするフェーズの TASKS で足す」に従うもので、
    アカウント全体の Cron 枠 5 本のうち **1 本目**を使う。
  - binding を変えたので `pnpm -r cf-typegen` を回す。
- **完了条件**: 掃除の 6 本と権限表の保守 3 本が緑。`pnpm --filter @app/glasses_management typecheck` が緑。
- **依存**: T-011

## T-013 監査を書き切る（Green）

- **目的**: 録音は要配慮情報なので、**閲覧・再生まで含めて**誰が・いつ・どの録音に何をしたかを追えるようにする。
- **触るファイル**: `services/glasses_management/src/worker/index.ts` /
  `services/glasses_management/test/recording.integration.test.ts`
- **実装**
  - 残す `action` は 7 つ: `recording.started` / `recording.stored` / `recording.failed` / `recording.played` /
    `recording.hold_set` / `recording.hold_cleared` / `recording.deleted`。
    `target_type='recording'` / `target_id=recordings.id`。
  - `recording.stored` と `recording.failed` と保持期限による `recording.deleted` は `actor_type='system'`、
    残りは `staff`。
  - **`recording.played` だけは落とさない。**best-effort にせず、監査の書き込みを含めて `db.batch()` で
    まとめて書き、失敗したらチケットも発行しない。
  - 横断して読む画面は作らない（モックにも画面一覧にも無い）。確かめるのは API と integration テストだけ。
- **完了条件**: 監査の 3 本が緑。Worker 側カバレッジ 4 指標 80% 以上。
- **依存**: T-012

## T-014 画面の計画と `RecordingBadge` を作る

- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 電話口でお客様の言葉を聞きながら、録れているかどうかを視野の端で確かめる面。
  - トークン計画: 録っている＝`--color-danger` の輪郭と点、録っていない＝`--color-line-strong` の輪郭と
    `--color-ink-faint` の点。地は `--color-surface` の 1 枚だけ。角は `--radius-full`（帯）と
    `--radius-panel`（右下）の 2 段。経過時間は `--font-mono`。**新しい色を足さない。**
  - シグネチャ: **録音の印は画面に 1 か所しか出さない**（帯か右下のどちらか）。状態は必ず色に文字を添える。
- **目的**: 録音の状態を出す唯一の部品を `@app/ui` に置き、帯と右下の 2 形をどの画面からも同じ実装で出せるようにする。
- **触るファイル**
  - `packages/ui/src/recording-badge.tsx`（新規）/ `packages/ui/src/index.ts`（export に足す）
  - `packages/ui/src/recording-badge.test.tsx`（新規。**`packages/ui/test/` に置かない** —
    `packages/ui/vitest.config.ts` の `include` は `src/**/*.test.{ts,tsx}` なので、
    `test/` に置いたファイルは 1 度も走らない）
- **見るべきモックと実測値**
  - **BOOK-01-DATETIME**（帯の `.rec`）: 高さ 48px / 左右余白 14px / gap 10px / 枠 1px `--alert` /
    角 pill / 地 `--alert-tint` / 文字 600 14px / 点 12px 円 / 経過時間 mono 15px。
    帯（`.stepbar`）は高さ 76px・左右 18px・gap 14px・上辺 1px 罫。左の戻る丸は 48px、右の `.fab` は 64px。
  - **BOOK-05-CONFIRM**（右下の `.rec-float`）: `right: 20px` / `bottom: 20px` / 内側 12px 16px / gap 12px /
    角 16px / 地 白 / 枠 **2px** `--alert` / 影 `0 10px 24px rgba(20,40,33,.18)` / 点 14px /
    文字 15px `--alert` / 時間 mono・左に 10px。
  - **EX-MIC-DENIED・EX-UPLOAD-FAILED**（灰色版 `.float`）: `right: 20px` / `bottom: 20px` /
    内側 12px 18px / gap 14px / 角 16px / 地 白 / 枠 **1px** `--line-strong` / 点 12px `--ink-3` /
    文字 15px / 時間 mono 15px。
- **先に書くテスト**（`pnpm --filter @app/ui test`）
  - `RecordingBadge` > `録音中は「録音中」と経過時間を出す`
  - `RecordingBadge` > `止まっているときは「録音していません」と「--:--」を出す`
  - `RecordingBadge` > `許可を尋ねている間は「マイクの許可を確かめています」を出す`
  - `RecordingBadge` > `端末に保管中は「録音は端末に保管中」と経過時間を出す`
  - `RecordingBadge` > `role="status" を持ち、状態が変わると読み上げに届く`
  - `RecordingBadge` > `色だけで状態を伝えない（どの状態でも文字が 1 つ以上ある）`
  - `RecordingBadge` > `帯の形と右下の形を placement で切り替える`
- **実装**: `placement: 'bar' | 'floating'`、`state: 'recording' | 'asking' | 'off' | 'buffered'`、
  `elapsedSeconds: number | null`。`elapsedSeconds` が `null` のとき `--:--`。
  色・寸法は `packages/ui/src/theme.css` のトークン経由のみ（Tailwind 既定パレットと任意値を書かない）。
  **音の大きさのメーター（`.meter`）は装飾なので `aria-hidden` にし、`prefers-reduced-motion` では動かさない。**
- **完了条件**: 7 本が緑。`pnpm --filter @app/ui test` が
  `packages/ui/vitest.config.ts` の閾値（lines 100 / functions 100 / branches 94 / statements 96）を
  満たしたまま通る。**閾値を下げない。**
- **依存**: なし

## T-015 画面のテストを書く（Red）

- **目的**: 「何が読めて、何が押せるか」を先に固定する。
- **触るファイル**
  - `services/glasses_management/src/web/recording/useRecorder.test.ts`（新規）
  - `services/glasses_management/src/web/recording/RecordingIndicator.test.tsx`（新規）
  - `services/glasses_management/src/web/recording/MicDenied.test.tsx`（新規）
  - `services/glasses_management/src/web/recording/UploadFailed.test.tsx`（新規）
  - `services/glasses_management/src/web/recording/RecordingPlayer.test.tsx`（新規）
- **先に書くテスト**（`pnpm --filter @app/glasses_management test:web`）
  - `useRecorder` > `受付を始める操作を押したそのイベントの中でマイクの許可を求める`
  - `useRecorder` > `画面が切り替わっただけでは許可を求めない`
  - `useRecorder` > `尋ねている間の状態は asking で、答えが来るまで受付の操作は止まらない`
  - `useRecorder` > `断られたら off になり、録音の行を作りに行かない`
  - `useRecorder` > `工程を進めても止めても、録音は 1 本のまま続く`
  - `useRecorder` > `経過時間は注入した now の差から出す（実時刻を読まない）`
  - `useRecorder` > `録音が途中で止まったら off に落ち、受付の操作は続けられる`
  - `useRecorder` > `送信に成功したら端末の控えを消す`
  - `useRecorder` > `送信に失敗したら端末に控えを置き、5 分後の時刻を返す`
  - `useRecorder` > `端末の控えに氏名・電話番号・メール・度数を書かない`
  - `useRecorder` > `セッションが失効しているあいだは送信も再生も行わない`
  - `useRecorder` > `同じ端末で次のセッションが立つと自動の再送が再開する`
  - `useRecorder` > `failed に落ちた録音は端末の控えからも消える`
  - `RecordingIndicator` > `復唱の工程では帯ではなく右下に出る`
  - `RecordingIndicator` > `1 つの画面に録音の印は 1 か所しか出ない`
  - `MicDenied` > `できないのは録音だけだと先に言い切る`
  - `MicDenied` > `いまも使えることを 3 行で出す`
  - `MicDenied` > `直し方が番号つきの 3 手順で並ぶ`
  - `MicDenied` > `「録音せずに続ける」で同じ受付の続きへ戻る`
  - `MicDenied` > `「直したので、もう一度確かめる」で読み込み直し、下書きを失わない`
  - `MicDenied` > `右下は灰色の「録音していません　--:--」`
  - `UploadFailed` > `先に「ご予約は確定しています」と予約番号が出る`
  - `UploadFailed` > `そのあとに「保存できなかったのは、この受付の録音だけです」が出る`
  - `UploadFailed` > `次に自動で送り直す時刻が出る`
  - `UploadFailed` > `「このまま続ける」で予約台帳へ戻る`
  - `UploadFailed` > `「もう一度送る」が押せる`
  - `RecordingPlayer` > `録音が無い予約では再生の導線を出さない`
  - `RecordingPlayer` > `削除済みの録音でも再生の導線を出さない`
  - `RecordingPlayer` > `再生位置のバーと「03:24 / 06:12」が進む`
  - `RecordingPlayer` > `画面にも DOM にも保管庫の URL とダウンロードの導線が出ない`
- **注意**: `MediaRecorder` / `navigator.mediaDevices` / IndexedDB は jsdom に無い。
  **`useRecorder` の依存（`getUserMedia` / `createRecorder` / `outbox` / `now`）を引数で受ける形にして、
  テストは差し替えたものを渡す。**グローバルを直接 monkey patch しない。
- **完了条件**: 30 本が「まだ実装が無い」理由で失敗する。
- **依存**: T-014

## T-016 端末側の録音と待避を実装する（Green）

- **目的**: 1 受付 1 本の録音を工程をまたいで続け、送れなかったものを端末に置いて 5 分ごとに送り直す。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 受付が終わるまで背景で走り続ける 1 本の録音。画面には現れず、印だけが出る。
  - トークン計画: 画面の要素を増やさない。状態は `RecordingBadge` の 4 値だけで表す。
  - シグネチャ: **1 受付 = 1 本 = 1 R2 キー**。分割も再開もしない。
- **触るファイル**
  - `services/glasses_management/src/web/recording/useRecorder.ts`（新規）
  - `services/glasses_management/src/web/recording/outbox.ts`（新規。IndexedDB）
- **実装**
  - 許可: `navigator.mediaDevices.getUserMedia({ audio: true })` を、**「新しい予約を取る」「ご来店を受け付ける」
    「変更する」を押したハンドラの中から同期的に呼ぶ**。ルート遷移の副作用として呼ばない
    （Safari はユーザー操作を起点にしない要求をそのまま断る）。尋ねている間は `state='asking'`。
  - 形式: `MediaRecorder`、`mimeType: 'audio/mp4'`、`audioBitsPerSecond: 32000`、モノラル。
    `isTypeSupported('audio/mp4')` が偽なら `'audio/webm'` を試し、それも駄目なら `off` に落とす。
    60 分でも約 14MB に収まり、1 ファイル上限 100MB（約 7 時間）に届かないので**分割送信を作らない**。
  - 経過時間: 開始時刻を保持し、注入した `now()` との差から `mm:ss` を作る。30 秒ごとに再計算する。
    **実時刻を読まない。**
  - 端末の控え（`outbox.ts`）: IndexedDB `eye-recording-outbox` / object store `blobs` / key は `recordingId`。
    置くのは `{ recordingId, blob, contentType, durationSeconds, startedAt, attempts, nextAttemptAt }` **だけ**。
    氏名・電話番号・メール・度数を書かない。
  - 消す条件は 2 つだけ: ①送信に成功した ②サーバが `state='failed'`（24 時間経過）を返した。
    **端末セッションの失効では消さない**（自動ロック 2 分や担当交代のたびに消すと「11:20 に自動でもう一度送ります。
    操作は要りません。」が守れない）。失効しているあいだは送信も再生も行わず、次に**同じ端末で**有効な
    セッションが立った時点で自動の再送を再開する。控えを画面で再生する操作も書き出す操作も出さない。
  - 自動再送: **5 分（300,000ms）の固定間隔**。3 回続けて失敗したらサーバ側が `alerts` に上げる（T-010）。
    通信断の再接続（1 分間隔）はこの仕組みと別に持つ（P2 の EX-OFFLINE。ここでは作らない）。
  - 録音が途中で止まったら（`onerror` / track の `ended`）`state='off'` に落とし、`RecordingBadge` の
    `role="status"` で読み上げに届ける。**受付の操作は止めない。**
- **完了条件**: `useRecorder.test.ts` の 13 本が緑。
- **依存**: T-015

## T-017 常駐の録音表示を配る（Green）

- **目的**: 受付の最初から復唱の終わりまで、録音が動いていることを 1 か所で見せ続ける。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 視野の端に置く 1 つの印。読むためではなく、見えていることが目的。
  - トークン計画: `RecordingBadge` の 2 形（帯 / 右下）をそのまま使う。新しい色も箱も足さない。
  - シグネチャ: **工程 1〜4 は帯の右、工程 5（復唱）から右下へ移る。移った瞬間も経過時間は減らない。**
- **触るファイル**
  - `services/glasses_management/src/web/recording/RecordingIndicator.tsx`（新規）
  - 予約フロー（P3）・来店受付（P5）・変更フロー（P6）の各画面から呼ぶ 1 行の追加
- **見るべきモックと実測値**
  - **BOOK-01-DATETIME**: 帯の右、`.fab`（64px 円）の左に置く。帯の高さ 76px、左右 18px、gap 14px。
  - **BOOK-05-CONFIRM**: 右下 `right: 20px` / `bottom: 20px`。本文の外・DOM でも本文の後ろに置く。
  - **RECEPTION-CHECKIN / CHANGE-DIFF / CUSTOMER-NEW**: 同じ右下の形。
- **実装**
  - 出す形の対応: 帯 = BOOK-01・02・02b・03・03b・03c・04・04b・04c・04d・BOOK-CONFLICT・CHANGE-DATETIME。
    右下 = BOOK-05-CONFIRM・CHANGE-DIFF・CUSTOMER-NEW・RECEPTION-CHECKIN。
  - **重なる操作ボタンがある面では `bottom` を 84px へ上げる。**
  - `role="status"`（`aria-live="polite"`）。`aria-modal="true"` を持つ面の中に入れない
    （入れるとアクセシビリティツリーから外れ、失敗した瞬間の知らせが読まれなくなる）。
  - DOM 順は「アプリバー → サイドバー → 本文 → 常駐する録音の印」。`position: absolute` でも DOM は本文の後ろ。
  - **共有端末の自動マスク（2 分）は、録音中の受付セッションがある間は動かさない**
    （復唱の直前に読む文が消える）。受付が `booked` / `discarded` で閉じた時点から 120 秒を数え直す。
- **完了条件**: `RecordingIndicator.test.tsx` の 2 本が緑。
- **依存**: T-016

## T-018 マイクが使えない面と保存に失敗した面を作る（Green）

- **目的**: できないことを 1 つに絞って言い切り、次の一手をボタンで出す。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: お客様を待たせたまま読む 2 つの知らせ。読む時間は 3 秒しかない。
  - トークン計画: `Card` の `tone="warn"` + `lead`（左 6px `--color-danger`）1 枚だけを赤にする。
    残りは白と `--color-paper` の 2 段。主操作は `--color-pine` の 1 つだけ。
  - シグネチャ: **失われていないものを先に言う。**成功が上、失敗が下、次の一手が最後。
- **触るファイル**
  - `services/glasses_management/src/web/recording/MicDenied.tsx`（新規）
  - `services/glasses_management/src/web/recording/UploadFailed.tsx`（新規）
- **見るべきモックと実測値**
  - **EX-MIC-DENIED**（`images/EX-MIC-DENIED.png` 1194×834）: 左右 2 段組 `1fr 400px`。
    左は内側 40px 44px、右は左辺 1px 罫 + 地 白 + 内側 40px 32px。
    赤いカードは左に 6px の帯、見出し 23px `--alert`（**句点を打たない**）、本文 16px・行間 1.6。
    手順の丸番号は 30px 円・地 `--brand`・文字 700 15px。右下は灰色の「録音していません　--:--」。
    ボタンは「録音せずに続ける」（緑・主操作）／「直したので、もう一度確かめる」（白）／「受付をやめる」（文字だけ）の 3 つ。
    その下に 13px の補足「できないのは録音だけです。この受付をあとから聞き直すことはできません。」。
  - **EX-UPLOAD-FAILED**（`images/EX-UPLOAD-FAILED.png` 1194×834）: 左右 2 段組 `1fr 372px`。
    左上に 60px の緑丸「✓」+ 見出し 23px「ご予約は確定しています」+ 予約番号（mono 700 16px）。
    その下に赤いカード（見出し 16px `--alert`・本文 16px）。ボタンは「このまま続ける」（緑）／「もう一度送る」（白）。
    その下に 13px の「11:20 に自動でもう一度送ります。操作は要りません。」。
    右は「確定したご予約」の 4 項目（ラベル 13px `--ink-2` / 値 16px 600）。右下は灰色の「録音は端末に保管中　03:24」。
- **実装**
  - EX-MIC-DENIED は予約フローの**どの工程でも同じ形**で全面差し替え。サイドバーは出さない。
  - 「録音せずに続ける」は**ここまで伺った日時とお客様を保ったまま**同じ受付の続きへ戻る。
    許可を説明するだけの別画面を挟まない。
  - 「直したので、もう一度確かめる」は**読み込み直して**判定し直す（同じページ読み込みのまま呼び直しても
    ダイアログは出ずに即断られる）。工程の入力は `reception_sessions.draft_json` から引き直し、
    端末には受付セッション id だけを持ち越す。まだ使えないときは同じ面に留まって理由が読める。
  - 「受付をやめる」の確認は 2 択（「入力をやめる」／「続ける」）。**既定は「続ける」**。
    やめても `reception_sessions`（`outcome='discarded'`）と録音は残す。
  - 直し方 3 手順の文言（「ホーム画面の「設定」を開く」→「一覧から「EYE予約」を選ぶ」→「「マイク」をオンにする」）は
    **1 か所の定数に置き、端末の配り方が変わったら差し替えられるようにする**
    （`design/09-open-questions.md` Q-05。いまの前提は「ホーム画面に追加した Web アプリ」）。
  - 読み込み中 / 375px / 200% 文字拡大 / VoiceOver は DESIGN_RULE の品質フロアで補う。
    触れるものは 44pt 以上。状態を色だけで伝えない。
- **完了条件**: `MicDenied.test.tsx` の 6 本と `UploadFailed.test.tsx` の 5 本が緑。
- **依存**: T-017

## T-019 再生の導線を 3 か所に足す（Green）

- **目的**: 1 件を選んだあとの 3 か所からだけ聞けるようにし、録音が無いときは導線を出さない。
- **画面の計画（DESIGN_RULE パス 1）**
  - 題材: 「言った言わない」を確かめるために、1 件の受付だけを聞き直す動作。
  - トークン計画: 赤い輪郭のボタン 1 つ（`--color-danger` の枠と文字 / `--color-danger-soft` の地）。
    再生位置のバーだけ `--color-pine`。新しい色を足さない。
  - シグネチャ: **一覧から一括で聞ける導線を作らない。**入口は 1 件を選んだあとの 3 か所だけ。
- **触るファイル**
  - `services/glasses_management/src/web/recording/RecordingPlayer.tsx`（新規）
  - 予約詳細（P2 の `/ledger?selected=`）・予約検索（P6 の `/search`）・受付履歴（P5 の `/history`）から呼ぶ 1 行
- **見るべきモックと実測値**
  - **LEDGER-DETAIL**（`images/LEDGER-DETAIL.png`）: popover の上段右に「● 録音を聞く　03:12」。
    高さ 40px / 左右 12px / 枠 1px `--alert` / 角 pill / 地 `--alert-tint` / 文字 600 13px。
  - **CHANGE-SEARCH**（`images/CHANGE-SEARCH.png`）: 「受付のときの録音」の行に白いボタン「録音を聞く　03:12」（時間は mono）。
  - **HISTORY-LIST**（`images/HISTORY-LIST.png`）: 「受付のときの録音」の下に横並び 3 つ（gap 16px・最大幅 520px）。
    ボタン「再生する」は高さ 44px・左右 18px。バーは高さ 8px・角 4px・地 `--surface-2`・進み `--brand`。
    右に mono 600 13px の「03:24 / 06:12」。
- **実装**
  - 手順は 3 段で固定する。**`<audio src="/api/...">` に URL を直接入れない**（`/api/staff/*` は
    default-deny の内側で、`<audio>` のリクエストには `Authorization` が付かず必ず 401 になる）。
    1. `POST .../playback` でチケット（`token` / `expiresAt`）を得る。
    2. `fetch('/api/staff/recordings/<id>/stream?token=<token>', { headers: { Authorization: 'Bearer <token>' } })`
       → `await res.blob()` → `URL.createObjectURL(blob)` を `<audio src>` に入れる。
    3. 再生を終えたら `URL.revokeObjectURL()` する。
  - チケットが切れたら「もう一度開く」で取り直す（900 秒 = 6分12秒の録音を 1 回聞き通せる長さ）。
  - `recording` が `null` / `state !== 'stored'` のときは**ボタンそのものを出さない**（無効化ではなく非表示）。
  - `recording.read` を持たないスタッフには 403 が返る。そのときはサイドバーからも行き先を隠し、
    「この画面は店長だけがご覧になれます」＋「前の画面に戻る」を出す（EX-PERMISSION の形は当てない）。
- **完了条件**: `RecordingPlayer.test.tsx` の 4 本が緑。web 側カバレッジ 4 指標 60% 以上。
- **依存**: T-018

## T-020 E2E を書き、spec を Approved に上げる

- **目的**: Approved の UC/AC 29 個に、有効な `@e2e-covers` をちょうど 1 つずつ貼る。
- **触るファイル**
  - `services/glasses_management/e2e/recording.spec.ts`（新規）
  - `services/glasses_management/playwright.config.ts`（`ipad` project に `launchOptions` を足す）
  - `specs/glasses_management/features/010-recording/spec.md`（`- ステータス:` を `Draft` → `Approved`）
  - `docs/testing/E2E_TRACEABILITY.md`（`## 現在の基準線` の表に 1 行足す）
- **マイクの用意**
  - `ipad` project の `launchOptions.args` に
    `--use-fake-device-for-media-capture` / `--use-fake-ui-for-media-stream` を足す。
  - 許可あり = `context.grantPermissions(['microphone'])`。
    拒否 = `page.addInitScript` で `navigator.mediaDevices.getUserMedia` を `NotAllowedError` で reject させる。
- **貼る mapping（29 個 / 22 本）**

  | # | test の題 | `@e2e-covers` |
  |---|---|---|
  | 1 | 受付を始めると、その押した操作のなかで許可を求める | `UC-REC-01 AC-REC-15` |
  | 2 | 復唱まで進めても経過時間は減らない | `UC-REC-02 AC-REC-01` |
  | 3 | 工程を戻しても録音は 1 本のまま | `AC-REC-02` |
  | 4 | マイクが切られていると、直し方が 3 手順で出る | `UC-REC-03 AC-REC-03` |
  | 5 | 録音せずに続けると、伺った内容が残ったまま戻る | `AC-REC-04` |
  | 6 | 直したので、もう一度確かめる | `AC-REC-16` |
  | 7 | 途中で止まると「録音していません」に変わる | `AC-REC-05` |
  | 8 | 止まったことが読み上げにも届く | `AC-REC-17` |
  | 9 | 終わった録音が保管庫へ入り、保持期限が決まる | `UC-REC-04` |
  | 10 | 保存に失敗しても、先に予約の成立を言う | `UC-REC-05 AC-REC-06` |
  | 11 | 失敗した予約も台帳に載り、「録音を聞く」は出ない | `AC-REC-07` |
  | 12 | もう一度送ると「録音を聞く」が出る | `UC-REC-06 AC-REC-08` |
  | 13 | このまま続けると右下に「録音は端末に保管中」が残る | `AC-REC-18` |
  | 14 | 台帳から「● 録音を聞く　03:12」で聞ける | `UC-REC-07 AC-REC-09` |
  | 15 | 受付履歴から「再生する」で位置のバーが進む | `AC-REC-10` |
  | 16 | 成立予約は 30 日ちょうどで消せず、+1 秒で消せる | `AC-REC-11` |
  | 17 | 破棄受付は 24 時間ちょうどで消せず、+1 秒で消せる | `AC-REC-12` |
  | 18 | 保全を立てた録音は片づけで消えない | `UC-REC-08 AC-REC-13` |
  | 19 | 他組織の録音は再生も保全もできず、一覧にも出ない | `AC-REC-14` |
  | 20 | 3 回失敗するとお知らせに 1 件立つ | `AC-REC-19` |
  | 21 | 端末セッションが失効しても未送信の録音は残る | `AC-REC-20` |
  | 22 | 受付をやめても記録と録音が残る | `UC-REC-09` |

- **実装（書き方の決め）**: `// @e2e-covers ...` の**直後**に `test(...)` を置く（空行だけは挟んでよい。
  `test.describe` の中に入れない。`test.only` / `test.skip` / `test.fixme` にしない）。
  16・17 の境界は `POST /api/internal/maintenance/recordings/purge` の `now` に固定値を注入して確かめる
  （`request.post` を使う。ブラウザの時計を動かさない）。
- **完了条件**: `pnpm --filter @app/glasses_management e2e` が緑。`pnpm run test:traceability` が
  `E2E traceability: all approved UC/AC identifiers are mapped exactly once.` を出す。
- **依存**: T-013, T-019

## T-021 モックとの突き合わせに 2 画面を足す

- **目的**: 実装した EX-MIC-DENIED と EX-UPLOAD-FAILED を、承認済みモックと画素で比べて差を数字にする。
- **触るファイル**: `services/glasses_management/e2e/mock-compare.spec.ts`
- **やること**
  - `mock` project（1194×810 / `deviceScaleFactor: 2`）で
    `toHaveScreenshot('EX-MIC-DENIED.png', { scale: 'device' })` /
    `toHaveScreenshot('EX-UPLOAD-FAILED.png', { scale: 'device' })` を撮る。
    基準画像は `docs/frontend/mockups/eye/reference/` に既にある（ステータスバーを外した派生物）。
  - 経過時間（`03:24` など）と時刻は動くので、撮る前に固定値へ差し替える。
  - `maxDiffPixelRatio` は「いま許している差」。**下げるだけで、上げてはいけない。**
    残っている差が何かを 1 行ずつコメントに書く。P7 の時点で残ることが分かっているのは 2 つ:
    ①灰色版の枠が `--color-line-strong`（P0 でコントラストのために `#b6c2bc`→`#778d82` へ暗くした）ぶん濃い
    ②右ペインの予約内容は P3 が確定させる値なので、seed の値と一致しない部分がある。
- **完了条件**: `pnpm --filter @app/glasses_management exec playwright test --project=mock` が緑。
  2 画面とも差分 5% 以下。
- **依存**: T-020

## T-022 完了の確認

- **目的**: このフェーズが終わったことを、機械が確かめられる形で残す。
- **触るファイル**: `docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md`（追記）/
  `knip.jsonc`（entry を実在のものだけにする）
- **先に書くテスト**: なし（既存のテストを走らせるだけ）。
- **実装**: 下のコマンドを上から順に実行し、赤いものを直してから次のコマンドへ進む。**飛ばさない。**

```sh
pnpm --filter @app/contracts test                     # 緑
pnpm --filter @app/ui test                            # 緑
pnpm --filter @app/glasses_management test            # 緑・4 指標 80% 以上
pnpm --filter @app/glasses_management test:web        # 緑・4 指標 60% 以上
pnpm --filter @app/glasses_management e2e             # 緑
pnpm --filter @app/glasses_management exec playwright test --project=mock   # 緑
pnpm check                                            # 緑（lint / knip / typecheck / test / traceability）
```

- `knip.jsonc` に `src/worker/domain/*.ts` の新規 3 本と `src/web/recording/*` が
  未使用として挙がらないことを確かめる（挙がったら entry ではなく**呼び出し側**を直す）。
- 進捗台帳（`docs/superpowers/progress/2026-08-28-glasses-management-rebuild.md`）に、
  実行したコマンドとその結果・カバレッジの実測値・`maxDiffPixelRatio` の実測値を書く。
- **完了条件**
  - 上の 7 コマンドがすべて緑。
  - `specs/glasses_management/features/010-recording/spec.md` が `- ステータス: Approved` で、
    UC-REC-01〜09 と AC-REC-01〜20 の 29 個すべてに `@e2e-covers` が 1 対 1 で付いている。
  - Worker 側カバレッジ 4 指標 80% 以上 / web 側 60% 以上（**閾値を下げない・広く除外しない**）。
  - 進捗台帳に、実行したコマンドとその結果・カバレッジの実測値・`maxDiffPixelRatio` の実測値を書いた。
- **依存**: T-021
