# Glasses Reservation Mock Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存の眼鏡店CRM・予約台帳モックを、DB/APIなしでCloudflare Workerから配信するReact SPAとして移植する。

**Architecture:** `services/glasses_reservation` はVite、React、Cloudflare Vite pluginを用いる。WorkerはSPAアセットを配信するだけで、顧客・予約・通知の状態は `useReducer` を使ってブラウザタブ内にだけ保持する。URLの`view`クエリは直接表示とE2Eの入口にし、画面内の操作は状態遷移で実現する。

**Tech Stack:** TypeScript, React 19, Vite 8, Cloudflare Vite plugin, Tailwind CSS 4, Vitest + Testing Library, Playwright

**Spec:** `specs/glasses_reservation/00_service-spec.md`, `specs/glasses_reservation/features/001-glasses-reservation-mock/spec.md`

## Global Constraints

- サービスディレクトリとパッケージ名は `glasses_reservation` / `@app/glasses_reservation`、Worker名は `glasses-reservation` とする。
- D1、Hono API、認証、Zod契約、service binding、Terraform、ops監視は追加しない。
- 元モックの文言、主要画面、操作、ブラウザ内だけの状態遷移を保持する。リロード後の初期化を仕様とする。
- 色、書体、角丸は `packages/ui/src/theme.css` のセマンティックトークンだけを参照する。raw hex、Tailwind既定パレット、任意値を使わない。
- productionコードより先に該当テストを書き、REDを確認してからGREENへ進む。Reactカバレッジの全指標は60%以上とする。
- Approved UC/ACはE2Eの各シナリオへ `@e2e-covers` で一意に対応付ける。
- ユーザーの未コミット変更（adminおよび既存`docs/superpowers`）は編集しない。コミット、push、デプロイは行わない。

## File Structure

- `services/glasses_reservation/package.json`: service scriptsと既存カタログ依存。
- `services/glasses_reservation/wrangler.jsonc`: アセット配信用Worker設定。D1/API bindingなし。
- `services/glasses_reservation/vite.config.ts`: port 5175のReact + Tailwind + Cloudflare Vite設定。
- `services/glasses_reservation/src/worker/index.ts`: `fetch`でアセットへフォールスルーする最小Worker。
- `services/glasses_reservation/src/web/model.ts`: 顧客、予約、画面、通知、選択候補の型と初期モックデータ。
- `services/glasses_reservation/src/web/reservationReducer.ts`: 予約・顧客・画面の純粋な状態遷移。
- `services/glasses_reservation/src/web/App.tsx`: shell、ホーム、予約入力、台帳、一覧、カルテ、ダッシュボード、メニュー、録音ウィジェット。
- `services/glasses_reservation/src/web/app.css`: トークンだけを使う画面レイアウトとレスポンシブ規則。
- `services/glasses_reservation/src/web/*.test.ts(x)`: reducerと画面操作のunit test。
- `services/glasses_reservation/e2e/glasses-reservation.spec.ts`: UC/ACに対応するPlaywright test。
- root `package.json`: `@app/glasses_reservation test:all` をroot combined testへ追加。
- `Makefile`: `make dev/glasses_reservation` を追加。

### Task 1: 静的SPAの足場と最小Worker

**Files:**
- Create: `services/glasses_reservation/package.json`
- Create: `services/glasses_reservation/tsconfig.json`
- Create: `services/glasses_reservation/vite.config.ts`
- Create: `services/glasses_reservation/vitest.web.config.ts`
- Create: `services/glasses_reservation/playwright.config.ts`
- Create: `services/glasses_reservation/wrangler.jsonc`
- Create: `services/glasses_reservation/index.html`
- Create: `services/glasses_reservation/src/worker/index.ts`
- Create: `services/glasses_reservation/src/web/main.tsx`
- Create: `services/glasses_reservation/src/web/test/setup.ts`
- Modify: `package.json`
- Modify: `Makefile`

**Interfaces:**
- Produces: `pnpm --filter @app/glasses_reservation {dev,build,typecheck,test:web,e2e}` と、port 5175でのSPA配信。

- [ ] **Step 1: 配信を検証する失敗E2Eを書く**

```ts
import { expect, test } from '@playwright/test'

test('静的SPAをWorkerが配信する', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/EYEX予約/)
  await expect(page.getByRole('button', { name: '新規予約' })).toBeVisible()
})
```

- [ ] **Step 2: E2Eを実行してREDを確認する**

Run: `pnpm --filter @app/glasses_reservation e2e`

Expected: packageまたはweb server設定が存在せずFAILする。

- [ ] **Step 3: 最小設定とWorkerを実装する**

`wrangler.jsonc` は `name: "glasses-reservation"`、`main: "src/worker/index.ts"`、SPA assets設定だけを持つ。`vite.config.ts` は既存serviceと同じplugin順でportを5175にする。Workerは `/api` やD1 bindingを加えず、`env.ASSETS.fetch(request)` を返す。

```ts
export interface Env {
  ASSETS: Fetcher
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
```

`main.tsx` は `createRoot(document.getElementById('root')!).render(<App />)` とする。root scriptsに `pnpm --filter @app/glasses_reservation test:all` を追加し、Makefileには同パッケージのdev targetを追加する。

- [ ] **Step 4: 配信E2EをGREENにする**

Run: `pnpm --filter @app/glasses_reservation e2e`

Expected: SPAタイトルと新規予約ボタンが見えてPASSする。

### Task 2: モック状態モデルと予約フロー

**Files:**
- Create: `services/glasses_reservation/src/web/model.ts`
- Create: `services/glasses_reservation/src/web/reservationReducer.ts`
- Create: `services/glasses_reservation/src/web/reservationReducer.test.ts`
- Create: `services/glasses_reservation/src/web/App.test.tsx`
- Modify: `services/glasses_reservation/src/web/App.tsx`

**Interfaces:**
- Produces: `ReservationState`, `reservationReducer(state, action)`, `initialReservationState`。
- Actions: `openBooking`, `setCustomerQuery`, `selectCustomer`, `registerCustomer`, `setAppointment`, `selectSlot`, `confirmReservation`, `saveReservationChange`, `cancelReservation`, `setView`, `setRecordPaused`。

- [ ] **Step 1: 顧客候補、予約確定、取消の失敗unit testを書く**

```ts
it('既存電話番号の一部から佐藤みどりを選択できる', () => {
  const queried = reservationReducer(initialReservationState, {
    type: 'setCustomerQuery', field: 'phone', value: '090000000',
  })
  expect(queried.customerSuggestion?.name).toBe('佐藤 みどり')
  const selected = reservationReducer(queried, { type: 'selectCustomer', customerId: 'customer-sato' })
  expect(selected.draftCustomer).toMatchObject({ name: '佐藤 みどり', phone: '090-0000-0000' })
})

it('選択済み候補の予約を確定し、取消すると台帳から除く', () => {
  const confirmed = reservationReducer(selectableState, { type: 'confirmReservation' })
  expect(confirmed.notice).toBe('予約を確定しました')
  const cancelled = reservationReducer(confirmed, { type: 'cancelReservation', reservationId: 'reservation-new' })
  expect(cancelled.notice).toBe('予約をキャンセルしました')
  expect(cancelled.reservations.find((entry) => entry.id === 'reservation-new')).toBeUndefined()
})
```

- [ ] **Step 2: REDを確認する**

Run: `pnpm --filter @app/glasses_reservation exec vitest run --config vitest.web.config.ts src/web/reservationReducer.test.ts`

Expected: reducerまたはexportが存在せずFAILする。

- [ ] **Step 3: 型付き初期データと純粋reducerを実装する**

`model.ts` に `Customer`, `Reservation`, `View`、`DraftCustomer`, `AppointmentDraft` を定義する。既存顧客は `customer-sato`（佐藤みどり、`090-0000-0000`）を含める。`reservationReducer.ts` は外部I/Oを持たず、確定時にid `reservation-new` の予約と通知を作り、取消時に対象予約を配列から除く。

- [ ] **Step 4: 予約入力画面の失敗component testを書く**

```tsx
it('必要な条件が揃うまで候補を出さず、揃うと5候補を表示する', async () => {
  const user = userEvent.setup()
  render(<App />)
  await user.click(screen.getByRole('button', { name: '新規予約' }))
  expect(screen.getByText('日付・時間・ご用件を選ぶと候補を表示します')).toBeVisible()
  await user.type(screen.getByLabelText('日付'), '2025-05-20')
  await user.selectOptions(screen.getByLabelText('開始時間'), '14:00')
  await user.click(screen.getByRole('button', { name: '検眼・カウンセリング' }))
  expect(screen.getAllByRole('button', { name: /14:00 〜 15:30/ })).toHaveLength(1)
})
```

- [ ] **Step 5: 予約入力UIを実装してGREENにする**

`App.tsx` はreducerを唯一の状態更新手段とし、ホームの「新規予約」、電話予約の顧客検索、電話番号途中一致、未登録顧客登録、日付・開始時間・用件、5件の候補枠、候補選択、確定、ホームに戻る操作を実装する。入力要素は再マウントしない構造にして、文字入力中のフォーカスを維持する。

Run: `pnpm --filter @app/glasses_reservation test:web`

Expected: reducerと予約入力のtestがPASSし、coverageが全指標60%以上となる。

### Task 3: 他画面・共通ナビゲーション・モック操作

**Files:**
- Modify: `services/glasses_reservation/src/web/App.tsx`
- Modify: `services/glasses_reservation/src/web/App.test.tsx`
- Create: `services/glasses_reservation/src/web/app.css`

**Interfaces:**
- Consumes: Task 2の`ReservationState`とactions。
- Produces: `home`, `booking`, `ledger`, `list`, `customer`, `dashboard`の6 view。

- [ ] **Step 1: 画面遷移・タブ・変更・取消の失敗component testを書く**

```tsx
it('台帳で予約を変更して取消できる', async () => {
  const user = userEvent.setup()
  render(<App initialView="ledger" />)
  await user.click(screen.getByRole('button', { name: /佐藤 みどり/ }))
  expect(screen.getByRole('heading', { name: '予約詳細' })).toBeVisible()
  await user.click(screen.getByRole('button', { name: '予約を変更' }))
  await user.click(screen.getByRole('button', { name: '変更を保存' }))
  expect(screen.getByText('予約内容を変更しました')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'キャンセル' }))
  expect(screen.getByText('予約をキャンセルしました')).toBeVisible()
})

it.each(['来店履歴', 'メガネ情報', 'コンタクト情報', '会計履歴'])('%sタブを表示する', async (tab) => {
  const user = userEvent.setup()
  render(<App initialView="customer" />)
  await user.click(screen.getByRole('tab', { name: tab }))
  expect(screen.getByRole('tabpanel')).toBeVisible()
})
```

- [ ] **Step 2: REDを確認する**

Run: `pnpm --filter @app/glasses_reservation exec vitest run --config vitest.web.config.ts src/web/App.test.tsx`

Expected: 台帳詳細、変更、取消、またはタブが未実装のためFAILする。

- [ ] **Step 3: 6画面とメニューを実装する**

ホームは「新規予約」「予約変更」「受付履歴」「予約を検索」「顧客台帳」と日付ストリップを表示する。ヘッダーロゴは常にホームへ戻し、メニューはdialogとして開閉して6 viewへ遷移する。台帳は佐藤みどりの予約を詳細表示し、変更保存と取消をreducerへ渡す。一覧には担当者selectによる絞り込みを置く。カルテは4タブを`role=tab`/`tabpanel`で実装する。ダッシュボードの「予約一覧を見る」はlist viewへ遷移する。録音ウィジェットはbooking viewだけに置き、停止／再開の`aria-pressed`を切り替える。

- [ ] **Step 4: トークン利用だけのCSSとレスポンシブを実装する**

`app.css` において色、font-family、border-radiusは `var(--color-*)`、`var(--font-*)`、`var(--radius-ctl)` のみを使う。desktopのbookingはフォームと候補の2列、600px幅以下は1列にする。`min-height: 100dvh`、`focus-visible`、`@media (prefers-reduced-motion: reduce)` を実装する。

- [ ] **Step 5: component testをGREENにする**

Run: `pnpm --filter @app/glasses_reservation test:web`

Expected: 画面遷移・台帳操作・タブ・録音操作がPASSし、coverageが全指標60%以上となる。

### Task 4: E2E移植と受け入れ検証

**Files:**
- Create: `services/glasses_reservation/e2e/glasses-reservation.spec.ts`
- Modify: `services/glasses_reservation/playwright.config.ts`

**Interfaces:**
- Consumes: port 5175、`App`のアクセシブルなrole/name/label。
- Produces: Approved ACの一意なPlaywright対応。

- [ ] **Step 1: 主要受け入れシナリオの失敗E2Eを書く**

```ts
// @e2e-covers: UC-GLASSES-01, AC-GLASSES-01, AC-GLASSES-03
test('既存顧客を選んで電話予約を確定する', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新規予約' }).click()
  await page.getByLabel('電話番号').fill('090000000')
  await page.getByRole('button', { name: /佐藤 みどり/ }).click()
  await page.getByLabel('日付').fill('2025-05-20')
  await page.getByLabel('開始時間').selectOption('14:00')
  await page.getByRole('button', { name: '検眼・カウンセリング' }).click()
  await page.getByRole('button', { name: /14:00 〜 15:30/ }).click()
  await page.getByRole('button', { name: '予約を確定する' }).click()
  await expect(page.getByText('予約を確定しました')).toBeVisible()
})
```

Add a separate scenario annotated `// @e2e-covers: UC-GLASSES-02, AC-GLASSES-02` for ledger change/cancel and `// @e2e-covers: AC-GLASSES-04` for menu, customer tabs, list filtering, and dashboard navigation.

- [ ] **Step 2: E2E REDを確認する**

Run: `pnpm --filter @app/glasses_reservation e2e`

Expected: missing flows or selectors make the added scenarios FAIL before implementation completion.

- [ ] **Step 3: 実装とのselector差分を補正する**

ラベル、heading、button名、link名、dialog名を上記testのアクセシブル名に合わせる。URL直打ちの`?view=booking`、`?view=ledger`、`?view=list`、`?view=customer`、`?view=dashboard`を初期viewに反映する。

- [ ] **Step 4: E2EとtraceabilityをGREENにする**

Run: `pnpm --filter @app/glasses_reservation e2e && pnpm run test:traceability`

Expected: 各UC/ACが一意に対応し、全Playwright scenarioがPASSする。

### Task 5: 最終品質ゲート

**Files:**
- Modify only if tests reveal a scoped defect: `services/glasses_reservation/src/web/{App.tsx,reservationReducer.ts,app.css}` or their tests.

**Interfaces:**
- Consumes: Tasks 1–4の完成サービス。
- Produces: 型、lint、dependency audit、unit、E2Eが通る移植。

- [ ] **Step 1: サービス単位の型とテストを実行する**

Run: `pnpm --filter @app/glasses_reservation typecheck && pnpm --filter @app/glasses_reservation test:all && pnpm --filter @app/glasses_reservation e2e`

Expected: すべてPASSする。

- [ ] **Step 2: root品質ゲートを実行する**

Run: `pnpm check`

Expected: lint、Knip、typecheck、combined test、traceabilityがPASSする。

- [ ] **Step 3: 変更範囲をセルフレビューする**

Run: `git diff --check && git status --short`

Expected: whitespace errorがなく、変更は新サービス、仕様、計画、root test/dev wiringに限定される。既存のadmin変更はユーザー変更として残る。

## Self-Review

- Spec coverage: AC-GLASSES-01とAC-GLASSES-03はTask 2/4、AC-GLASSES-02はTask 3/4、AC-GLASSES-04はTask 3/4、非永続化・非API境界はTask 1/2、レスポンシブとアクセシビリティはTask 3/5で扱う。
- Placeholder scan: 未決定事項、後回しの実装、曖昧なエラー処理記述は含めない。
- Type consistency: `ReservationState`、`reservationReducer`、`initialReservationState`、action名はTask 2で定義したものをTask 3–5で使用する。
