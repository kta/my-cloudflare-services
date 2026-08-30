import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/*
 * 実装した画面を、承認済みモックの基準画像（docs/frontend/mockups/eyex/reference/<画面ID>.png）と
 * 1 枚ずつ重ねて、違う画素の割合を測る。
 *
 *   pnpm --filter @app/glasses_management exec playwright test --project=mock
 *
 * 不一致のときは test-results/ に `-diff.png` が残るので、そこを見て直す。
 * モックは Retina 相当（deviceScaleFactor 2）で撮ってあるので、`scale: 'device'` を必ず付ける
 * （既定の `'css'` だと CSS ピクセルまで縮められて寸法が合わない）。
 * 基準画像は端末のステータスバーを外した reference/ 側を使う
 * （`node docs/frontend/mockups/eyex/reference.mjs` で作り直せる）。
 * `maxDiffPixelRatio` はその画面の「いま許している差」であり、
 * **フェーズが進むたびに下げる**。上げてはいけない。
 *
 * この突き合わせは合否の主役ではない。文言・並び・押せるかは各画面の e2e で見る。
 * ここが見るのは「承認された見た目からどれだけ離れているか」だけである。
 *
 * 盤面は `seed.mjs` が入れる EYEX 銀座店。この project は業務の e2e より先に走る
 * （playwright.config.ts の project の並び）ので、撮るのは必ず seed のままの姿である。
 */

const ORG = 'org-eyex-seed'
/** seed.mjs が固定 id で入れる EYEX 銀座店と、その 1 人目の担当（佐藤 美咲）。 */
const GINZA = '11111111-1111-4111-8111-111111111111'
const SATO = 'c0010000-0000-4000-8000-000000000000'
/** ご来店の目的の 1 件目（メガネを新しく作る・60 分）。 */
const PURPOSE_NEW_GLASSES = 'e0010000-0000-4000-8000-000000000000'
/** dev グラントが載せる `sub`。個人トップの「わたし」はこれと突き合わせて決まる。 */
const VIEWER = `dev:${ORG}`
/**
 * モック 3 面が描いている瞬間（JST 2026年8月27日（木）11:08）。seed のご予約は
 * この日に固定してあるが、サーバの時計は実時刻で進むので 2 つとも据える:
 *   端末の時計 …… 台帳が「最初にどの日を尋ねるか」だけを読む
 *   応答の `serverNow` …… 現在時刻の線・札・「これから」の件数が読む
 * 盤面（D1）には手を触れない。詳しい理由は `ledger.spec.ts` の頭に書いてある。
 */
const SERVER_NOW = '2026-08-27T02:08:00.000Z'

type LedgerBody = {
  serverNow: string
  counts: { all: number; upcoming: number; pendingReview: number }
  lanes: { kind: string; entries: { reservationId: string; startsAt: string }[] }[]
}

async function pinTo1108(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date(SERVER_NOW))
  await page.route(
    (url) => url.pathname === '/api/staff/ledger',
    async (route) => {
      const response = await route.fetch()
      if (!response.ok()) {
        await route.fulfill({ response })
        return
      }
      const body = (await response.json()) as LedgerBody
      const drawn = new Map(
        body.lanes
          .filter((lane) => lane.kind === 'staff' || lane.kind === 'unassigned')
          .flatMap((lane) => lane.entries)
          .map((entry) => [entry.reservationId, entry]),
      )
      const counts =
        drawn.size === 0
          ? body.counts
          : {
              ...body.counts,
              upcoming: [...drawn.values()].filter(
                (entry) => Date.parse(entry.startsAt) > Date.parse(SERVER_NOW),
              ).length,
            }
      await route.fulfill({ response, json: { ...body, counts, serverNow: SERVER_NOW } })
    },
  )
}

/**
 * `settings.manage` を持たないスタッフへ戻す。顧客台帳の突き合わせは、店長かどうかで
 * 「おまとめ」の入口の有無が変わる（AC-CUST-16）ので、**test の実行順に権限が残っていると
 * 盤面が揺れる** —— この関数を呼んだあとの姿だけを基準にする。
 */
async function revokeManager(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/internal/store-memberships/sync', {
    headers: { 'x-internal-key': 'dev-internal-key' },
    data: {
      id: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f',
      organizationId: ORG,
      storeId: GINZA,
      userId: VIEWER,
      permissions: [
        'store.read',
        'reservation.read',
        'reservation.write',
        'customer.read',
        'customer.write',
        'settings.read',
      ],
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  })
  expect(res.status()).toBe(200)
}

/**
 * admin からの担当店舗の配信を模す。`staff` の書き換えには `settings.manage` が要る。
 * `store-settings.spec.ts` と同じ行 id へ upsert するので、古い権限の行は残らない。
 */
async function grantStore(request: APIRequestContext): Promise<void> {
  const res = await request.post('/api/internal/store-memberships/sync', {
    headers: { 'x-internal-key': 'dev-internal-key' },
    data: {
      id: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f',
      organizationId: ORG,
      storeId: GINZA,
      userId: VIEWER,
      permissions: [
        'store.read',
        'store.manage',
        'reservation.read',
        'reservation.write',
        'customer.read',
        'customer.write',
        'settings.read',
        'settings.manage',
      ],
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  })
  expect(res.status()).toBe(200)
}

/**
 * 個人端末の「わたし」を作る。`staff.adminUserId` に業務端末の `sub` を書くと、
 * トップの右に「本日わたしが担当するご予約」が出る（seed は誰にも当てていない）。
 * **必ず元へ戻す。** ほかの面は seed のままの盤面で撮る決めである。
 */
async function beMe(request: APIRequestContext, adminUserId: string | null): Promise<void> {
  const token = await request.post('/api/auth/token', {
    data: { organizationId: ORG, role: 'staff' },
  })
  const { token: bearer } = (await token.json()) as { token: string }
  const headers = { authorization: `Bearer ${bearer}` }
  const store = await request.get(`/api/staff/stores/${GINZA}`, { headers })
  const { settingsVersion } = (await store.json()) as { settingsVersion: number }
  const res = await request.patch(`/api/staff/stores/${GINZA}/staff/${SATO}`, {
    headers,
    data: { adminUserId, version: settingsVersion },
  })
  expect(res.status()).toBe(200)
}

async function startWork(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('お店のコード').fill(ORG)
  await page.getByRole('button', { name: '業務を始める' }).click()
  await page.getByRole('navigation', { name: '画面の切り替え' }).waitFor()
}

/** 予約台帳を 2026年8月27日（木）11:08 の姿で開く。 */
async function openLedger(page: Page): Promise<void> {
  await pinTo1108(page)
  await startWork(page)
  await page
    .getByRole('navigation', { name: '画面の切り替え' })
    .getByRole('button', { name: '予約台帳', exact: true })
    .click()
  await expect(page.getByText('2026年8月27日（木）')).toBeVisible()
  await expect(page.getByRole('grid', { name: '予約台帳' })).toBeVisible()
}

/** 設定の 1 面を開く。中身が届くまで待ってから撮る（読み込み中の姿を基準と比べない）。 */
async function openSection(page: Page, section: string): Promise<void> {
  await startWork(page)
  await page
    .getByRole('navigation', { name: '画面の切り替え' })
    .getByRole('button', { name: '設定', exact: true })
    .click()
  await page
    .getByRole('navigation', { name: '設定の項目' })
    .getByRole('button', { name: section, exact: true })
    .click()
  await expect(page.getByRole('heading', { name: section, exact: true })).toBeVisible()
}

test.describe('承認済みモックとの突き合わせ', () => {
  test('HOME — トップ（共有端末）', async ({ page }) => {
    await startWork(page)
    await expect(page.locator('header').first()).toContainText('EYEX 銀座店')
    /*
     * いま残っている差（2026-08-28）:
     *   - 下辺の日付の帯（2026年 8月 24〜30 とカレンダー）… まだ無い（台帳の P2 が持ち込む）
     *   - 上のバーの「お知らせ 3」… P10 で足す（いまは「業務を終える」を置いている）
     * 店名は seed が入ったので「EYEX 銀座店」に揃い、実測は 3.1389%（2026-08-30 の再測）。
     * 器（上のバー・サイドバー・主操作の 2 枚）は画素まで合っている。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('HOME.png', { scale: 'device', maxDiffPixelRatio: 0.0314 })
  })

  test('LEDGER-STAFF — 予約台帳・担当者別', async ({ page }) => {
    await openLedger(page)
    await expect(page.getByRole('status')).toHaveText('現在 11:08')
    /*
     * いま残っている差（2026-08-31 の 4 巡目、AC-CUST-24 を実装したあとの再測。
     * 実測 3.1832% ＝ 123,141 / 3,868,560 画素。3 巡目の 3.1327% から 0.0505 ポイント増えた
     * ——増分の出どころは「お客様のお名前と来店回数の印」を実際に描くようになったこと
     * （田中 花子 様／4回目・松本 様。`Timetable.tsx` の `Band`）。モックの見た目には
     * 近づいたが、名前と印の正確な位置・余白がモックの手描きと 1px まで揃ってはいない
     * ぶんが画素の差として残る）:
     *   - 行が 1 本増えて 6 行になり、行の高さがそのぶん縮む。11:00 のウォークインを
     *     LEDGER-WALKIN と LEDGER-LIST が 渡辺 由紀 に置いているので、実装は割当の事実に
     *     従って 渡辺 由紀 の行を出す。LEDGER-STAFF だけがこの行を描いていない。
     *   - 「担当が未定」の行に 11:02 と 15:30 の帯が増える。`kind='staff'` の割当行は
     *     1 予約にちょうど 1 行なので、担当を置かない予約は作れない（I-05）。
     *   - 佐々木 亮 様 の帯が「フィッティング」… `visit_purposes.name_short` にその語は
     *     無く（技能であって目的ではない）、実装は「調整」を出す。
     *   - 「ご来店お待ち」が 0名 で帯が「いまお待ちのお客様はいません。」… `walk_ins` は
     *     008-reception-and-walkin。モックは 2名 と ウォークイン 004 の帯を描いている。
     *   - 日付の帯（‹ 2026年8月27日（木） 本日 ›）が上のバーの中央でなく台帳の先頭にある。
     *     `AppShell` に中央の差し込み口が無い（P2 の判断記録）。
     *   - 上のバー右の「お知らせ 3」… P10。ツールバーの「絞り込み」… spec のスコープ外
     *     （モックはボタンだけで中身を描いていない）。
     *   - 行見出しの小さい文字（視力測定・加工／フィッティング／販売・受付）を出さない。
     *     `staff.job_label` は「店長」しか持たず、技能から語を組み立てない決めである。
     *   - 休憩の帯の地が `--color-busy-soft`（モックは濃い灰の `--busy`）。埋まった枠の文字を
     *     `--color-ink-muted` のまま 4.5:1 に保つため、地を明るくする側で解いた（決定 9）。
     *     AC-LEDGER-11 が名指ししている名前で、見出し行の `--color-surface-2` とは別の値。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('LEDGER-STAFF.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0319,
    })
  })

  test('LEDGER-RESOURCE — 予約台帳・設備別', async ({ page }) => {
    await openLedger(page)
    await page
      .getByRole('group', { name: '台帳の並べ方' })
      .getByRole('button', { name: '設備・場所' })
      .click()
    await expect(page.getByRole('rowheader', { name: /視力測定機 A/ })).toBeVisible()
    /*
     * いま残っている差（2026-08-31 の 4 巡目、AC-CUST-24 を実装したあとの再測。
     * 実測 3.6835% ＝ 142,499 / 3,868,560 画素。LEDGER-STAFF と同じ理由
     * （お客様のお名前と来店回数の印を実際に描くようになった）で微増している）:
     *   - 行が 5 行でなく 7 行になり、行の高さがそのぶん縮む。設備は 1 台 1 行で、
     *     フィッティング台 と 加工室（止めている・`ledger_display='grey'`）も台帳に残る。
     *     設定画面が「6件」と数えるのは相談カウンター 1・2 をまとめた表示側の勘定である。
     *   - 点検の帯が 8月27日に無い。seed の点検は 8月28日（金）10:00–12:00 で、
     *     モックは 8月27日の 11:30–12:00 に描いている（AC-LEDGER-11 は 8月28日で見る）。
     *   - 「いま空いています」の帯が 検査室 1 だけでなく フィッティング台 と 加工室 にも出る。
     *   - 日付の帯の位置・「お知らせ 3」・「絞り込み」・行見出しの小さい文字は LEDGER-STAFF と同じ。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('LEDGER-RESOURCE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0369,
    })
  })

  test('LEDGER-LIST — 予約台帳・予約リスト', async ({ page }) => {
    await openLedger(page)
    await page
      .getByRole('group', { name: '表示のかたち' })
      .getByRole('button', { name: '予約リスト' })
      .click()
    await expect(page.getByRole('button', { name: 'すべて 12件' })).toBeVisible()
    /*
     * いま残っている差（2026-08-31 の再測。実測 5.1521% ＝ 199,309 / 3,868,560 画素。
     * 行の高さを 90px から**モックと同じ 62px**へ戻したぶん、表が上へ詰まって
     * 5.1114% から 0.0407 ポイント増えた。モックは 7 行＋まとめ、実装は 8 行＋まとめで
     * 行の数が違うので、行が正しい高さになるほど下の行どうしがずれる）。
     * 3 面の中でいちばん大きいのは、左のサイドバーの姿が違うためである:
     *   - モックのこの 1 面だけサイドバーが開いている（ほかの 2 面は細い柱）。実装は
     *     予約台帳を細い柱で開く（`RAIL_BY_DEFAULT`）ので、左 260px ぶんがまるごと違う。
     *     たたむ・ひらくは押せるので、行き先が失われているわけではない。
     *   - お客様のお名前と来店回数の印（伊藤 健 様／2回目）… 007 で足す。「—」を置いている。
     *   - 「ご用件」が短い名前（調整・視力測定）。モックは業務の名前（今のメガネを調整したい）。
     *     `LedgerEntry` が運ぶのは `name_short` だけで、`name_internal` は詳細だけが持つ。
     *   - 「受け付け」の欄で、出どころの語をボタンの**右**に置いている（モックは行の左端の
     *     ボタンだけ）。4 語をこの欄にそのまま出すのが AC-LEDGER-12 で、縦に積むと 1 行が
     *     90px になってモックの 62px を保てないため、横に並べて折り返させている。
     *   - 末尾の 1 行が「このあと 15:00 ほか 4件。」（モックは「このあと 14:00 松本 一郎 様
     *     ほか 5件。」）。一覧に出す行を 8 つまでにした引き算の決めと、お名前が無いことによる。
     *   - 押した行の地を緑にしない（モックは 田中 花子 様 の行を選んで描いている）。
     *     リストから詳細を開く導線は 008 / 009 の操作面に譲っている。
     *   - 日付の帯の位置・「お知らせ 3」・「絞り込み」は LEDGER-STAFF と同じ。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('LEDGER-LIST.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0516,
    })
  })

  test('LEDGER-DETAIL — 予約台帳・帯を押して開いた詳細', async ({ page }) => {
    await openLedger(page)
    await page
      .getByRole('gridcell', {
        name: '11:00から12:00　田中 花子 様　4回目　新調相談・視力測定　佐藤 美咲',
      })
      .click()
    await expect(page.getByRole('dialog', { name: '予約の詳細' })).toContainText('11:00–12:00')
    /*
     * いま残っている差（2026-08-31 の 4 巡目、AC-CUST-24 を実装したあとの再測。
     * 実測 7.8915% ＝ 305,287 / 3,868,560 画素）。3 面の中でいちばん大きい。
     * 台帳そのものの差（LEDGER-STAFF と同じ）に加えて:
     *   - 行が 1 本増えたぶん、詳細を刺す帯が 28px 上に来る。440×460 の面がまるごとずれる。
     *   - **詳細の面（この✕付きの吹き出し）自身はお客様のお名前・来店回数を出さない**
     *     ——頭の行は時刻と所要時間だけの 1 行のまま。`ReservationDetail`（契約・
     *     `packages/contracts`）に `customerId` / `customerName` の列が無く、
     *     API 応答がお客様を運ばない（`services/glasses_management/src/worker` と
     *     `packages/contracts` は別担当の持ち物なので、この回では直していない。
     *     AC-CUST-25 の「詳細を開くとその方の見出しが出る」はこの吹き出しでは
     *     まだ満たせず、`docs/superpowers/progress/` へ引き継ぐ）。
     *     一方、背後の帯（`Timetable.tsx`）自身は AC-CUST-24 のとおりお名前と
     *     来店回数の印を描くようになったので、そのぶん画素の差がわずかに増えている。
     *   - 「録音を聞く 03:12」… `recordings` は 010。押した先も、録音があるかを知る手段も無い。
     *   - 出どころの札が「お電話」（モックは「電話予約」）。AC-LEDGER-05 が 4 語に揃えると
     *     決めているので、モックの側を直さず実装だけを揃えた。
     *   - ご用件が短い名前の連なり（「メガネを新しく作る・視力測定だけ」）。モックは
     *     「メガネを新しく作る」の 1 語で、seed の #3 は目的を 2 件持つ。
     *   - 受付済みの札に時刻を添えない（「受付済み 11:02」の 11:02）。受付時刻の列と
     *     それを書く経路は `008-reception-and-walkin` にあり、P2 は時刻を作れない。
     *   - 閉じる ✕ を頭の右に置いている。モックに ✕ は無いが、物理キーボードを持たない
     *     共有端末で Esc が使えない（IDX-LEDGER-04 の 6d）。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('LEDGER-DETAIL.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.079,
    })
  })

  test('EX-OFFLINE — 通信が切れた台帳', async ({ page }) => {
    await openLedger(page)
    await page
      .getByRole('group', { name: '表示のかたち' })
      .getByRole('button', { name: '予約リスト' })
      .click()
    await expect(page.getByRole('table', { name: '本日のご予約' })).toBeVisible()
    // 台帳の取り直しだけを落とす（あとから足した route が先に効く）。
    await page.route(
      (url) => url.pathname === '/api/staff/ledger',
      async (route) => await route.abort('failed'),
    )
    await page.getByRole('button', { name: '次の日' }).click()
    await expect(page.getByText('通信が切れています')).toBeVisible()
    /*
     * いま残っている差（2026-08-31 の再測。実測 6.1260% ＝ 236,986 / 3,868,560 画素。
     * 「現在 11:08」の札を落とし、「11:09 に自動でも試します」の 1 行を足したぶんで
     * 6.0447% から 0.0813 ポイント増えた。どちらもモックへ寄せた変更だが、この面は
     * モックがツールバーごと落としているので、札を消しても地の色が合うわけではない）:
     *   - 左のサイドバーが細い柱（モックはこの面だけ開いている）。LEDGER-LIST と同じ理由で、
     *     左 260px ぶんがまるごと違う。
     *   - お客様のお名前と来店回数、「ご用件」が短い名前（LEDGER-LIST と同じ 2 つ）。
     *   - 帯の下に並べ方・表示のかたちのセグメントが残る。モックはこの面でツールバーごと
     *     落としているが、読むかたちの切り替えは通信が切れても効く（落とすと読めなくなる）。
     *     「現在 11:08」の札だけはモックと同じく落とす（いま何時かは届いていない）。
     *   - 末尾の 1 行が「このあと 15:00 ほか 4件。」（モックは「このあと 15:30 中井 さくら 様
     *     など 3件が続きます。」）。行を 8 つまでにした引き算の決めとお名前が無いことによる。
     *   - 日付の帯の位置・「お知らせ 3」は LEDGER-STAFF と同じ。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('EX-OFFLINE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0613,
    })
  })

  test('SETTINGS-STORE — 設定・店舗の情報', async ({ page }) => {
    await openSection(page, '店舗の情報')
    await expect(page.getByLabel('店名', { exact: true })).toHaveValue('EYEX 銀座店')
    /*
     * いま許している差:
     *   - 第2サイドバー: モックの 14 項目に対して 6 項目しか出さない（P1 の決め #1）。
     *     残る 8 項目は行き先が無く、押せて何も起きない行を置かないため。
     *   - 保存バー左の「キャンセル」→「変更を捨てる」（決め #2。予約の取り消しと取り違えない）。
     *   - 上のバーの「お知らせ 3」… P10。
     *   - 各行の `›`（別の面へ行く印）を出さない。その場で直せる欄だからである。
     *   - 紹介文のカードの「未保存」の札を出さない。未保存は上のバーが 1 か所で言う
     *     （状態の札を 2 か所に置かない）。
     * 実測 3.5774%（2026-08-30）。**この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('SETTINGS-STORE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0358,
    })
  })

  test('SETTINGS-CALENDAR — 設定・営業日', async ({ page }) => {
    await openSection(page, '営業日')
    await expect(page.getByTestId('closed-days')).toBeVisible()
    /*
     * いま許している差:
     *   - 第2サイドバーの 6 項目・「変更を捨てる」・「お知らせ 3」（上と同じ 3 つ）。
     *   - 本日の輪は実行日に付く。基準画像は 2026-08-27 に付いている。
     *   - 「この店舗で予約を受け付ける」は読み取りだけ（保存する経路がまだ無い）。
     * 実測 4.3223%（2026-08-30）。本日の輪が実行日に付くぶんだけ余裕を持たせて 4.40% にしてある。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('SETTINGS-CALENDAR.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.044,
    })
  })

  test('SETTINGS-HOURS — 設定・営業時間', async ({ page }) => {
    await openSection(page, '営業時間')
    await expect(page.getByLabel('閉店')).toHaveValue('19:00')
    /*
     * いま許している差:
     *   - 第2サイドバーの 6 項目・「変更を捨てる」・「お知らせ 3」。
     *   - お昼の帯は 12:00–13:00（モックの 13:00–14:00 は誤記。決め #6）。
     *   - 「通常の営業時間」に「お昼の休憩」の行を持たない（帯は右の 1 か所で直す）。
     *   - 最後の 1 行は実行日の曜日で書き変わる（基準画像は木曜の 18:20）。
     * 実測 3.7907%（2026-08-30）。最後の 1 行が実行日の曜日で書き変わるぶんだけ余裕を持たせて
     * 3.85% にしてある。**この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('SETTINGS-HOURS.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0385,
    })
  })

  test('SETTINGS-PURPOSE — 設定・ご来店の目的', async ({ page }) => {
    await openSection(page, 'ご来店の目的')
    await expect(page.getByText('ご来店の目的　6件')).toBeVisible()
    /*
     * いま許している差:
     *   - 第2サイドバーの 6 項目・「変更を捨てる」・「お知らせ 3」。
     *   - 行を選ぶまで下半分（編集の箱と影響のカード）が出ない。モックは
     *     「メガネを新しく作る」を選んだ姿を描いている。
     *   - 「台帳に出す短い名前」の 1 行を足している（台帳の帯に収める唯一の追加）。
     * 実測 4.8129%（2026-08-30）。**この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('SETTINGS-PURPOSE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0482,
    })
  })

  test('SETTINGS-STAFF — 設定・スタッフと技能', async ({ page }) => {
    await openSection(page, 'スタッフと技能')
    await expect(page.getByText('スタッフ　6名')).toBeVisible()
    /*
     * いま許している差:
     *   - 第2サイドバーの 6 項目・「変更を捨てる」・「お知らせ 3」。
     *   - 勤務時間の 7 列が空（お休み）。seed は曜日テンプレート（staff_weekly_shifts）だけを
     *     持ち、日付への展開（staff_shifts）は保存と日次 Cron が作るためである。
     *   - PIN の「作り直す」を出さない（再設定は P10）。
     *   - 勤務は読み取りの札ではなく直せる欄にしてある（AC-SET-12 が直して保存し直すため）。
     *     「お休み」の印は字ごと label で包んで 44pt にしたので、7 列が縦に伸びる（決め #14）。
     * 実測 4.7714%（2026-08-30）。**この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('SETTINGS-STAFF.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0478,
    })
  })

  test('SETTINGS-EQUIPMENT — 設定・設備と点検', async ({ page }) => {
    await openSection(page, '設備と点検')
    await expect(page.getByText('設備と場所　6件')).toBeVisible()
    /*
     * いま許している差:
     *   - 第2サイドバーの 6 項目・「変更を捨てる」・「お知らせ 3」。
     *   - 行を選ぶまで下半分（編集の箱と赤いカード）が出ない。モックは「視力測定機 B」を
     *     選び、「いま使える」を切った未保存の姿を描いている。
     *   - 影響するご予約の件数はご予約の行が入る P3 まで 0 件のままである。
     * 実測 4.3737%（2026-08-30）。**この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('SETTINGS-EQUIPMENT.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0438,
    })
  })
  test('HOME-PERSONAL — トップ（個人端末）', async ({ page, request }) => {
    await grantStore(request)
    await beMe(request, VIEWER)
    try {
      await pinTo1108(page)
      await startWork(page)
      await expect(page.getByRole('region', { name: '本日わたしが担当するご予約' })).toBeVisible()
      /*
       * いま残っている差:
       *   - お客様のお名前と来店回数（田中 花子 様／4回目）… `customers` は 007。行は
       *     時刻・状態の札・ご用件の 2 段組みで、お名前の段が空いている。
       *   - 左の主操作 2 枚が共有端末と同じ（モックは「わたしの予約を見る」等の個人向け）。
       *   - 下辺の日付の帯・上のバーの「お知らせ 3」は HOME と同じ。
       * 実測 4.7504%（2026-08-31 の初測）。**この値は下げるだけ。上げてはいけない。**
       */
      await expect(page).toHaveScreenshot('HOME-PERSONAL.png', {
        scale: 'device',
        maxDiffPixelRatio: 0.0476,
      })
    } finally {
      await beMe(request, null)
    }
  })

  /* --- 予約の受付（BOOK-01〜06 / BOOK-CONFLICT） -------------------------- */

  /**
   * 受付の 5 工程は **2026年9月2日（水）** で撮る。台帳が見る 8月27日・28日 とも、
   * 業務の e2e（`booking.spec.ts`）が書く 9月3日 とも重ならない日である。水曜は
   * 佐藤 美咲 を含む 5 名が 10:00–19:00 で出るので、担当の行が並ぶ姿は木曜と変わらない。
   * 暦は本日を含む週の月曜から 2 週（8月24日〜9月6日）を描くので、この日も同じ面から押せる。
   */
  const BOOK_DAY = '9月2日（水）'

  /** 受付の工程 1 を開く。時計は台帳と同じ 11:08 に据える（暦の「本日」がそこで決まる）。 */
  async function openBooking(page: Page): Promise<void> {
    await pinTo1108(page)
    await startWork(page)
    await page.getByRole('button', { name: /新しい予約を取る/ }).click()
    await expect(
      page.getByRole('heading', { name: 'お日にちはいつがよろしいですか？' }),
    ).toBeVisible()
  }

  /** 工程 1。お日にちとお時間を選ぶ。時刻の窓（8 枚）の外は「ほかの時刻も見る」で開く。 */
  async function pickDateTime(page: Page, hhmm: string): Promise<void> {
    await page.getByRole('button', { name: new RegExp(`^${BOOK_DAY}`) }).click()
    const slot = page.getByRole('button', { name: new RegExp(`^${hhmm} `) })
    const more = page.getByRole('button', { name: /^ほかの時刻も見る/ })
    await expect(slot.or(more).first()).toBeVisible()
    if ((await slot.count()) === 0) await more.click()
    await expect(slot).toBeEnabled()
    await slot.click()
  }

  /** 「次へ進む」を押す。丸は 5 工程を通して帯の 1 つきり（承認済みモックの `.stepbar`）。 */
  async function proceed(page: Page): Promise<void> {
    const next = page.locator('[data-booking-stepbar]').getByRole('button', { name: /^次へ進む/ })
    await expect(next).toBeEnabled()
    await next.click()
  }

  /**
   * 既定の置き場所が先約・仮の押さえと重なっていたら、同じ時刻で受けられる担当へ移す。
   * BOOK-05-CONFIRM は復唱のまま終わるので 11:00 の押さえを持ったままになり、
   * そのあとの BOOK-06-DONE が同じ 11:00 で重なる。撮る順に依らせないための手当て。
   */
  async function clearClash(page: Page): Promise<void> {
    const board = page.getByRole('table', { name: 'ご予約を置く盤' })
    if ((await board.getByText('重なっています').count()) === 0) return
    await page
      .getByRole('button', { name: /\d{2}:\d{2}–\d{2}:\d{2} が空いています$/ })
      .first()
      .click()
    await expect(board.getByText('重なっています')).toHaveCount(0)
  }

  /** 工程 2 まで歩き、ご用件を押す。 */
  async function openPurpose(page: Page, hhmm: string): Promise<void> {
    await openBooking(page)
    await pickDateTime(page, hhmm)
    await proceed(page)
    await expect(
      page.getByRole('heading', { name: '本日はどのようなご用件でしょうか？' }),
    ).toBeVisible()
  }

  /** 工程 3 まで歩く。 */
  async function openSlot(page: Page, hhmm: string): Promise<void> {
    await openPurpose(page, hhmm)
    await page.getByRole('button', { name: /^メガネを新しく作る/ }).click()
    await expect(page.getByText('✓ 選んでいます')).toBeVisible()
    await proceed(page)
    await expect(page.getByRole('table', { name: 'ご予約を置く盤' })).toBeVisible()
  }

  /** 工程 4 まで歩く。 */
  async function openCustomer(page: Page, hhmm: string): Promise<void> {
    await openSlot(page, hhmm)
    await clearClash(page)
    await proceed(page)
    await expect(page.getByRole('heading', { name: 'お電話番号を伺えますか？' })).toBeVisible()
  }

  /** 工程 5 まで歩く。お名前とお電話番号はモックと同じ「田中 花子」で伺う。 */
  async function openConfirm(page: Page, hhmm: string): Promise<void> {
    await openCustomer(page, hhmm)
    await page.getByLabel('お名前').fill('田中 花子')
    await page.getByLabel('ふりがな').fill('たなか はなこ')
    await proceed(page)
    await expect(page.getByRole('heading', { name: 'この文をそのまま読み上げます' })).toBeVisible()
  }

  test('BOOK-01-DATETIME — 工程 1・お日にちとお時間', async ({ page }) => {
    await openBooking(page)
    await page.getByRole('button', { name: new RegExp(`^${BOOK_DAY}`) }).click()
    await expect(page.getByRole('button', { name: /^11:00 / })).toBeEnabled()
    /*
     * いま残っている差:
     *   - 暦で選んでいる日が 9月2日（水）… モックは 8月27日（木）を選んでいる。撮る日を
     *     台帳の 8月27日 と業務 e2e の 9月3日 のどちらからも外した結果である。
     *   - 時刻を**まだ押していない**。モックは 11:00 を押した姿（3px の緑罫）で、帯の
     *     「次へ」も有効になっている。ここは日にちだけを選んだ姿で撮っている。
     *   - 暦の見出しが「2026年8月」… 2 週の窓（8月24日〜9月6日）は 9 月にまたがる。
     *   - 時刻の札は 8 枚 ＋「ほかの時刻も見る（あと10件）」。モックは 8 枠だけを描く
     *     （うち 11:30 と 14:30 は「満席」で押せない）。サーバは営業時間ぶんの格子を
     *     18 枠返すので、9 枚目から先はこのボタンの中にある。
     *   - 録音の帯が「● 録音していません ▮▮▮ --:--」（灰）。モックは 12 面すべてが
     *     「● 録音中 ▮▮▮ 01:08」（赤地）。録音そのものは P7 なので、録音していないのに
     *     「録音中」と書かない。**12 面すべてに共通の差である。**
     *   - 上のバーに「あとで続ける」が増えている（受付を進行中のまま残す出口）。
     *     モックには無い。**12 面すべてに共通の差である。**
     *   - 上のバーの「お知らせ 3」… P10 で足す。
     * 実測は下の値のとおり。**この値は下げるだけ。上げてはいけない。**
     */
    // 実測 134,359 / 3,868,560 ＝ 3.4730%（2026-08-31 の 3 巡目）。**この値は下げるだけ。**
    await expect(page).toHaveScreenshot('BOOK-01-DATETIME.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0348,
    })
  })

  test('BOOK-02-PURPOSE — 工程 2・ご来店の目的', async ({ page }) => {
    await openPurpose(page, '11:00')
    await page.getByRole('button', { name: /^メガネを新しく作る/ }).click()
    await expect(page.getByText('11:00–12:00 で受け付けられます。')).toBeVisible()
    /*
     * いま残っている差:
     *   - 目的の札が 6 枚（seed の 6 件）で並び順も seed のまま。
     *   - 右の要約のご来店日が 2026年9月2日（水）… 上と同じ理由。
     *   - 録音の帯・「あとで続ける」… BOOK-01 に書いた 12 面共通の差。
     *   - 上のバーの「お知らせ 3」… P10。
     */
    // 実測 86,138 / 3,868,560 ＝ 2.2267%（2026-08-31 の 3 巡目）。**この値は下げるだけ。**
    await expect(page).toHaveScreenshot('BOOK-02-PURPOSE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0223,
    })
  })

  test('BOOK-02b-PURPOSE-CONFLICT — 工程 2・その時刻に収まらない', async ({ page }) => {
    // 18:00 は 30 分なら受けられるが、閉店前の片付け（18:40–19:00）があるので 60 分は入らない。
    await openPurpose(page, '18:00')
    await page.getByRole('button', { name: /^メガネを新しく作る/ }).click()
    await expect(
      page.getByRole('heading', { name: '18:00 から60分の受付ができません' }),
    ).toBeVisible()
    /*
     * いま残っている差:
     *   - 収まらない時刻が 18:00（モックは 11:00）… seed の盤面で 60 分がちょうど入らない
     *     時刻が閉店前しか無い。理由の 1 文も「その時間は営業時間の外です。」になる。
     *   - 代わりの時刻の並びと件数はサーバが返したまま。
     *   - 録音の帯・「あとで続ける」… BOOK-01 に書いた 12 面共通の差。
     */
    // 実測 113,711 / 3,868,560 ＝ 2.9394%（2026-08-31 の 3 巡目。モックと同じく
    // 「お取りする時間」の 4 列を落として、その場所を警告の箱へ渡した）。**この値は下げるだけ。**
    await expect(page).toHaveScreenshot('BOOK-02b-PURPOSE-CONFLICT.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0295,
    })
  })

  test('BOOK-03-SLOT-STAFF — 工程 3・担当者の軸', async ({ page }) => {
    await openSlot(page, '11:00')
    /*
     * いま残っている差:
     *   - 行は **3 行**（佐藤 美咲・小林 学・担当が未定）。「メガネを新しく作る」は
     *     `measure` の技能を要るので、水曜に出ている 5 名のうちその技能を持つ 2 名しか
     *     並ばない（seed の技能割り当て）。モックは 4 名を描く。
     *   - 担当の名前の下の技能行は seed の技能をそのまま並べる（佐藤 美咲 は
     *     「視力測定・加工・販売・受付」）。モックは「視力測定・加工」の 2 つだけを描く。
     *   - 列は 10:00–18:30 の 18 列あり、窓には**モックと同じ 8 列**（10:00–13:30）が
     *     ちょうど入る。残りは盤の中だけを横へ流す。
     *   - 先約の帯が 1 本も無い（9月2日 のご予約はまだ 0 件）。モックは 佐藤 美咲 の
     *     11:00 の先約と重なりの警告を描いている。重なりの面そのものは
     *     `booking.spec.ts` の AC-BOOK-05 が実データで確かめる。先約が無いので、
     *     凡例の色見本も帯と同じ緑になる（モックは重なっているので赤）。
     *   - 録音の帯・「あとで続ける」… BOOK-01 に書いた 12 面共通の差。
     */
    // 実測 148,288 / 3,868,560 ＝ 3.8332%（2026-08-31 の 3 巡目）。**この値は下げるだけ。**
    await expect(page).toHaveScreenshot('BOOK-03-SLOT-STAFF.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0384,
    })
  })

  test('BOOK-03b-SLOT-RESOURCE — 工程 3・設備の軸', async ({ page }) => {
    await openSlot(page, '11:00')
    await page.getByRole('button', { name: '設備・場所', exact: true }).click()
    await expect(page.getByRole('columnheader', { name: '設備・場所' })).toBeVisible()
    /*
     * いま残っている差:
     *   - 行は **6 行**（視力測定機 A・視力測定機 B・検査室 1・相談カウンター 1・
     *     相談カウンター 2・フィッティング台）。「メガネを新しく作る」が要る種別
     *     （`measure` と `counter`）の設備がすべて並ぶ。加工室は止めてあるので出ない。
     *     モックは **4 行**（視力測定機 A/B・相談カウンター 1/2）を描く。
     *   - 設備の行の塞がりは「点検」「受付停止」で言う（機械は休憩しない）。
     *   - 先約の帯が無いのは BOOK-03-SLOT-STAFF と同じ理由。
     *   - 録音の帯・「あとで続ける」… BOOK-01 に書いた 12 面共通の差。
     */
    // 実測 166,038 / 3,868,560 ＝ 4.2920%（2026-08-31 の 3 巡目）。**この値は下げるだけ。**
    await expect(page).toHaveScreenshot('BOOK-03b-SLOT-RESOURCE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.043,
    })
  })

  test('BOOK-03c-DRAG — 工程 3・帯を運んでいる途中', async ({ page }) => {
    await openSlot(page, '11:00')
    const grip = page.getByRole('button', { name: /^ご予約をつかんで動かす/ })
    const from = await grip.boundingBox()
    const head = await page
      .getByRole('table', { name: 'ご予約を置く盤' })
      .getByRole('columnheader', { name: '14:00', exact: true })
      .boundingBox()
    await page.mouse.move((from?.x ?? 0) + 12, (from?.y ?? 0) + 12)
    await page.mouse.down()
    await page.mouse.move((head?.x ?? 0) + (head?.width ?? 0) / 2, (from?.y ?? 0) + 12, {
      steps: 8,
    })
    await expect(page.getByText('14:00–15:00 へ')).toBeVisible()
    /*
     * いま残っている差:
     *   - 先約の帯が無い（9月2日 は 0 件）。運んでいる帯・もとの場所・破線の枠は同じ形。
     *   - 行き先が 14:00–15:00（モックは 13:00–14:00）。seed の 佐藤 美咲 は 13:00–14:00 が
     *     休憩なので、そこへは置けない（モックの盤面と seed の勤務が違う）。
     *   - 「もとの 11:00 に戻す」は運んでいる間には出さない（指を離してから出す）。
     *     モックは運んでいる最中にも描いている。凡例は「動かしているご予約／置く先」
     *     に差し替わる（モックと同じ）。
     *   - 右の「確保するもの」は 担当 / 設備 / 時刻 の 3 行。モックの「場所」の行は
     *     設備の行と同じものなので足していない。
     *   - 録音の帯・「あとで続ける」… BOOK-01 に書いた 12 面共通の差。
     */
    // 実測 133,738 / 3,868,560 ＝ 3.4569%（2026-08-31 の 3 巡目）。**この値は下げるだけ。**
    await expect(page).toHaveScreenshot('BOOK-03c-DRAG.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0347,
    })
    await page.mouse.up()
  })

  test('BOOK-04-CUSTOMER — 工程 4・お客様', async ({ page }) => {
    await openCustomer(page, '11:00')
    /*
     * いま残っている差:
     *   - 候補の吹き出し（BOOK-04b）を出さない。`customers` は 007-customer-records
     *     で初めてできるので、この工程は伺った文字を受付セッションに置くだけである。
     *   - 右の要約の「担当と場所」に出るのは seed の盤面で置いた担当（モックは
     *     佐藤 美咲／視力測定機 A）。行そのものはモックにもある。
     *   - 手書きの記入者が「ご担当者（スタッフ）」。dev グラントの `sub` は
     *     `staff.admin_user_id` のどれとも一致しないので名前を引き当てられない。
     *     モックは「山田 大輔（店長）」。
     *   - 録音の帯・「あとで続ける」… BOOK-01 に書いた 12 面共通の差。
     */
    // 実測 99,892 / 3,868,560 ＝ 2.5822%（2026-08-31 の 3 巡目）。**この値は下げるだけ。**
    await expect(page).toHaveScreenshot('BOOK-04-CUSTOMER.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0259,
    })
  })

  test('BOOK-04c-KEYPAD — 工程 4・テンキー', async ({ page }) => {
    await openCustomer(page, '11:00')
    await page.getByLabel('お電話番号').click()
    const keypad = page.getByRole('group', { name: '電話番号のテンキー' })
    await expect(keypad).toBeVisible()
    for (const digit of '0901234'.split('')) {
      await keypad.getByRole('button', { name: digit, exact: true }).click()
    }
    await keypad.getByRole('button', { name: '5', exact: true }).click()
    await expect(page.getByText('あと3桁', { exact: true })).toBeVisible()
    /*
     * いま残っている差:
     *   - 最下段が「削除 ／ 0 ／ 完了」（承認済みモック 7 面のうち 5 面がこの並び）。
     *     ハイフンのキーは置かない —— 欄が桁数から自動で整形するので押しても意味が無い。
     *   - テンキーの左はお名前・ふりがな・ご要望の欄のまま。モックはここを
     *     「ここまでの入力」の 3 行（ご来店日時／目的／担当と場所）に差し替えている。
     *   - 録音の帯・「あとで続ける」… BOOK-01 に書いた 12 面共通の差。
     */
    // 実測 106,277 / 3,868,560 ＝ 2.7472%（2026-08-31 の 3 巡目）。**この値は下げるだけ。**
    await expect(page).toHaveScreenshot('BOOK-04c-KEYPAD.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0276,
    })
  })

  test('BOOK-04d-HANDWRITE — 工程 4・手書き', async ({ page }) => {
    await openCustomer(page, '11:00')
    await page.getByRole('button', { name: '手書きで書く' }).click()
    await expect(page.getByRole('heading', { name: 'ご要望をそのまま書き留めます' })).toBeVisible()
    /*
     * いま残っている差:
     *   - 「文字に変換する」のボタンと、右の柱の「文字にするとこうなります」の下書きを
     *     出さない（AC-BOOK-12。読み取り結果が存在しないので、空欄だけを置かない）。
     *   - 用紙は白紙。モックは書いた筆跡を描いている。
     *   - 記入者が「ご担当者（スタッフ）」（BOOK-04-CUSTOMER と同じ理由）。
     *   - 録音の帯・「あとで続ける」… BOOK-01 に書いた 12 面共通の差。
     */
    // 実測 159,450 / 3,868,560 ＝ 4.1217%（2026-08-31 の 3 巡目）。**この値は下げるだけ。**
    await expect(page).toHaveScreenshot('BOOK-04d-HANDWRITE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0413,
    })
  })

  test('BOOK-04b-CUSTOMER-MATCH — 工程4・候補の吹き出し', async ({ page }) => {
    await openCustomer(page, '11:00')
    await page.getByLabel('お電話番号').click()
    const keypad = page.getByRole('group', { name: '電話番号のテンキー' })
    for (const digit of '09012345678'.split('')) {
      await keypad.getByRole('button', { name: digit, exact: true }).click()
    }
    await keypad.getByRole('button', { name: '完了' }).click()
    await expect(page.getByRole('dialog', { name: 'お客様の候補' })).toBeVisible()
    await expect(page.getByText('同じ番号のご来店が2件見つかりました。')).toBeVisible()
    /*
     * いま残っている差（2 巡目の実測 214,428 / 3,868,560 ＝ 5.5429% 画素。
     * 1 巡目は 220,632 ＝ 5.7031%）:
     *   - 吹き出しがモックより 110px ほど下から出る。吹き出しは番号の欄を親にした
     *     `top-17 / left-109`（モックの実測どおり）だが、その欄より上の見出し・補足が
     *     実装のほうが背が高い。器（工程 4 の見出し）を縮める話なので P3 の持ち物。
     *   - 吹き出しの丈を `max-h-110`（440px）で頭打ちにし、候補の並びだけを縦に流す
     *     ようにした（2 巡目の直し）。足の「どちらでもありません」がこの機種でも
     *     必ず見える —— 頭打ちが無いと画面の外へ出て押せなくなっていた。
     *     2 件目の候補は下が少しだけ隠れる。
     *   - お名前とふりがなの欄の下に「お選びになると入ります」の 1 行が付く（2 巡目の
     *     直し。AC-CUST-05 / AC-CUST-22）。モックは同じ文を**欄の中**に描いているが、
     *     欄の中は薄い飾りの場所なので「飾りとして薄めない」という決めに合わせて外へ出した。
     *   - 右の柱が「候補をお選びになると、ここに出ます。」（モックは 4 項目が入った姿）。
     *     モック自身が「お名前の欄は未選択のまま・右の柱は選択後」という食い違った 1 枚で、
     *     実装は未選択の姿に揃えている。
     *   - 右下が「録音していません」（モックは「録音中 02:14」）… 録音は P10。
     *   - 上のバー右の「お知らせ 3」… P10。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('BOOK-04b-CUSTOMER-MATCH.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0555,
    })
  })

  test('BOOK-05-CONFIRM — 工程 5・復唱', async ({ page }) => {
    await openConfirm(page, '11:00')
    /*
     * いま残っている差（**許してよいと決めた差**のうちの 1 つ）:
     *   - 復唱の文の目的が「メガネを新しく作る」… `visit_purposes.name_internal` に揃えた。
     *     モックの「視力測定とメガネの新調」は工程 2 で押した札と違うので採らない。
     *   - 「仮の押さえ」の**時刻**はサーバの実時刻から数えるので走るたびに変わる（端末の
     *     時計は 8月27日 11:08 に据えてある。モックは「11:18 まで」）。**残り時間のほうは
     *     420 秒で頭打ちにしてある**ので「あと7分」で動かない。
     *   - 設備を選んでいない受付なので札は「この枠は空いています」。モックは
     *     担当 1 ＋ 設備 2 で「3つとも空いています」。
     *   - お客様の行を右の要約に足した（AC-BOOK-11 が工程 5 に名前を求めている）。
     *   - 録音は右下の常駐表示で「録音していません」（灰）。モックは「録音中」（赤）。
     *     上のバーの「あとで続ける」も BOOK-01 に書いたとおり。
     */
    // 実測 133,122〜133,174 / 3,868,560 ＝ 3.4412〜3.4425%（2026-08-31 の 3 巡目。
    // 押さえの期限の時刻だけが走るたびに動く）。**この値は下げるだけ。**
    await expect(page).toHaveScreenshot('BOOK-05-CONFIRM.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0345,
    })
  })

  test('BOOK-06-DONE — 完了', async ({ page }) => {
    // ここだけがご予約を 1 件書く。書く日は 9月2日（水）で、台帳の e2e も業務 e2e も見ない。
    await openConfirm(page, '11:00')
    await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
    await expect(page.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()
    /*
     * いま残っている差（**許してよいと決めた差**のうちの 1 つ）:
     *   - 「控えは 090-1234-5678 へお送りしました。」を出さない。notifier はメールだけを
     *     送り、`to` はメールアドレス型なので、お電話番号へ控えを送る手立てが無い。
     *     代わりに「予約番号 … をお控えいただくようお伝えください」を出す。
     *   - 予約番号はその場で採った番号（モックは EY-2608-0142）。
     *   - 担当・設備は工程 3 で重なりを解いた結果（モックは 佐藤 美咲／相談カウンター 2）。
     *   - 完了の面は工程の帯を持たないので、録音の表示もここには無い。
     */
    // 実測 63,690 / 3,868,560 ＝ 1.6464%（2026-08-31 の 3 巡目）。**この値は下げるだけ。**
    await expect(page).toHaveScreenshot('BOOK-06-DONE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0166,
    })
  })

  test('BOOK-CONFLICT — 確定の瞬間に枠が埋まっていた', async ({ page, request }) => {
    await openConfirm(page, '14:00')
    // ほかの端末が同じ担当の同じ時刻を先に取る。
    const holding = await page.getByRole('complementary', { name: '確保する内容' }).innerText()
    const staffId = holding.includes('佐藤 美咲') ? SATO : null
    const token = await request.post('/api/auth/token', {
      data: { organizationId: ORG, role: 'staff' },
    })
    const { token: bearer } = (await token.json()) as { token: string }
    const taken = await request.post('/api/staff/reservations', {
      headers: { authorization: `Bearer ${bearer}` },
      data: {
        storeId: GINZA,
        startsAt: new Date(Date.parse('2026-09-02T14:00:00.000+09:00')).toISOString(),
        purposeIds: [PURPOSE_NEW_GLASSES],
        durationMinutes: 60,
        staffId,
        equipmentIds: [],
        source: 'phone',
      },
    })
    expect(taken.status()).toBe(200)

    await page.getByRole('button', { name: '復唱を終えて予約を確定する' }).click()
    await expect(
      page.getByRole('heading', { name: 'この枠は、ほかの端末で先に確定されました' }),
    ).toBeVisible()
    /*
     * いま残っている差:
     *   - 埋まった時刻が 14:00（モックは 11:00）。BOOK-06-DONE が 11:00 を使ったあとなので、
     *     同じ面をもう一度歩ける時刻へずらしている。
     *   - 「時刻を変えたくない場合」の担当の入れ替え案は、代わりの担当が居るときだけ出る。
     *     出る担当は seed の勤務しだいで、技能もそのぶん長い（モックは
     *     「担当を 小林 学（視力測定）に変える」）。代わりの時刻の札の設備の補足行は、
     *     この受付が設備を押さえていないので空になる（モックは「相談カウンター 2」）。
     *   - 録音の帯・「あとで続ける」… BOOK-01 に書いた 12 面共通の差。
     */
    /*
     * 実測 111,483 / 3,868,560 ＝ 2.8818%（2026-08-31 の 3 巡目）。
     *
     * **12 面で唯一、前の巡（0.0287）より上げた値である。**上げた理由は 1 つだけ:
     * 工程 4 の札に ✓ を戻したこと。この面は工程 5 から工程 3 へ差し戻したもので、
     * お客様は伺い終えている（モックの帯も「4 お客様」を done で描く）。ただし
     * モックは done の札に ✓ を描かないので、その 1 文字ぶん（実測 +506px）だけ
     * 差が増える。✓ を落とせば 110,977px（2.8687%）で前の値に収まるが、そうすると
     * 「済んだ工程」と「まだの工程」の違いが**色だけ**になる（§2.5 に反する）。
     * 増分は ✓ 1 文字ぶんに限られ、ほかの 11 面はすべて下がっている。
     */
    await expect(page).toHaveScreenshot('BOOK-CONFLICT.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0289,
    })
  })

  /* --- 顧客台帳（CUSTOMER-LIST / CUSTOMER-DETAIL / CUSTOMER-NEW /
   *              CUSTOMER-MERGE / CUSTOMER-HANDWRITE / BOOK-04b-CUSTOMER-MATCH） -----
   *
   * レビュー時点（2026-08-31）では 6 面のうち 2 面しか突き合わせが無かった —— 残る
   * 4 面は部品（`src/web/customers/`）だけが実装され、器（`CustomerScreen.tsx` /
   * `book/CustomerStep.tsx`）に差し込まれていなかったため、ブラウザから開けなかった。
   * このレビューで配線し、6 面すべてをここで撮る。
   */

  /** 顧客台帳を開く。一覧が届くまで待ってから撮る（読み込み中の灰色の帯を基準と比べない）。 */
  async function openCustomers(page: Page, request: APIRequestContext): Promise<void> {
    // 店長かどうかで「おまとめ」の入口の有無が変わる（AC-CUST-16）ので、test の実行順に
    // 依らない姿にする（`CUSTOMER-MERGE` だけが `grantStore` で店長に上げる）。
    await revokeManager(request)
    await pinTo1108(page)
    await startWork(page)
    await page
      .getByRole('navigation', { name: '画面の切り替え' })
      .getByRole('button', { name: '顧客台帳', exact: true })
      .click()
    await expect(page.getByRole('listbox', { name: 'お客様の一覧' })).toBeVisible()
    // 絞り込みの札「ご来店 2〜4回」を付ける（モックがこの札を付けた姿を描いている）。
    await page.getByRole('button', { name: '絞り込み' }).click()
    await page
      .getByRole('group', { name: 'ご来店の回数で絞り込む' })
      .getByRole('button', { name: '2〜4回' })
      .click()
    // 札を選んでも一覧は開いたままなので、もう一度押して閉じる（モックは閉じた姿）。
    await page.getByRole('button', { name: '絞り込み' }).click()
    await expect(page.getByRole('group', { name: 'ご来店の回数で絞り込む' })).toHaveCount(0)
    await expect(page.getByText('当てはまるお客様 42名')).toBeVisible()
    // 田中 花子 様の行を選ぶ（右の要約がその方の姿になるまで待つ）。
    await page.getByRole('option', { name: /^田中 花子 様/ }).click()
    await expect(
      page.getByRole('complementary', { name: '選んだお客様の要約' }).getByRole('heading'),
    ).toHaveText('田中 花子 様')
  }

  test('CUSTOMER-LIST — 顧客台帳・一覧と右の要約', async ({ page, request }) => {
    await openCustomers(page, request)
    /*
     * いま残っている差（2 巡目の実測 161,962 / 3,868,560 ＝ 4.1866% 画素。
     * 1 巡目は 174,662 ＝ 4.5149%）:
     *   - 一覧の 6 行目が 木下 亮太 様、8 行目が 松本 一郎 様（モックは 川上 恵 様 と
     *     田中 花子 様）。モックは札「ご来店 2〜4回」を付けた姿でありながら「初」の
     *     川上 恵 様を並べていて、それ自身が食い違っている。実装は札のとおりに
     *     2〜4回 だけを残すので、その 1 行ぶんだけ顔ぶれが繰り上がる。
     *   - 1 巡目にあった「行が 9px 下から始まる」ずれは消した（ツールバーの上下の余白を
     *     モックの 56px に合わせた。触れる大きさ 44pt はそのまま）。8 行ぶんの字の
     *     重なりが解けたぶんが、この回の下がり幅のほとんどである。
     *   - ご来店の列は平文の等幅に直した（1 巡目は数字入りの丸い印だった）。来店回数の
     *     色つきの印はお名前の右に添えるもので、回数の列をすでに持つこの面には入れない
     *     —— `docs/frontend/mockups/eyex/README.md` の決め。
     *   - 右の要約の「次のご予約」が「ご予約はありません」（モックは 8月27日（木）11:00）。
     *     次のご予約は**サーバの実時刻**で選ぶので、seed の 2026年8月27日 を過ぎた日に
     *     走らせるとここは空になる。台帳の e2e が見る盤面を動かさないための代償で、
     *     日付そのものは `customers.spec.ts` が台帳の帯で見ている。
     *   - 上のバー右の「お知らせ 3」… P10 で足す（いまは「業務を終える」）。
     *   - 検索欄の左の虫めがねの字が無い（`type="search"` の欄に飾りを足していない）。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('CUSTOMER-LIST.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0419,
    })
  })

  test('CUSTOMER-DETAIL — 顧客台帳・お客様の詳細', async ({ page, request }) => {
    await openCustomers(page, request)
    await page.getByRole('button', { name: 'くわしく見る' }).click()
    await expect(page.getByRole('table', { name: '度数の移り変わり' })).toBeVisible()
    // モックはサイドバーをひらいた 216px で描いている（顧客台帳の既定は細い柱）。
    await page.getByRole('button', { name: 'サイドバーをひらく' }).click()
    await expect(page.getByRole('button', { name: 'サイドバーをたたむ' })).toBeVisible()
    /*
     * いま残っている差（2 巡目の実測 260,873 / 3,868,560 ＝ 6.7435% 画素。
     * 1 巡目は 263,375 ＝ 6.8082%）:
     *   - 度数の表の 1 行目に「いま使っています」の札が入る。**緑と太字だけで区別しない**
     *     という AC-CUST-09 の要求で、モックは札を描いていない。2 巡目で札を測定日の
     *     **下**へ落とした —— 同じ行に並べると 1 列目が札のぶん広がり、「左」と「PD」の
     *     2 列が器の外へ押し出されて読めなくなっていた（1 巡目の姿）。いまは 4 列とも
     *     入るが、1 行目だけ 2 段になるので表の下 2 行がモックより下へずれる。
     *   - ツールバーは 2 巡目で 56px に直した（1 巡目は 5px 高く、下の全部がずれていた）。
     *   - ツールバー左に「‹ お客様の一覧へ戻る」が増えている。この製品に router が無く、
     *     これが無いと詳細が行き止まりになる（T-015 の判断記録）。モックには無い。
     *   - 右下の「次のご予約」が「ご予約はありません。」… CUSTOMER-LIST と同じ理由。
     *   - 注意ごとの行が「手書きメモを見る ›」を持つ（モックは文だけ）。手書きへの入口は
     *     「内容を直す」の中ではなくこの行に置く、という feature spec の決めによる。
     *   - サイドバーの行がモックより 1 行ぶん下から始まる（`AppShell` が「トップ」を
     *     1 行目に持つ。P0/P1 の器の持ち物で、この面だけの話ではない）。
     *   - 上のバーの副題が「顧客台帳」（モックは「顧客台帳 田中 花子 様」）。副題は
     *     行き先の名前で、面の中の状態を映さない（`AppShell` の持ち物）。
     *   - 上のバー右の「お知らせ 3」… P10。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('CUSTOMER-DETAIL.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0675,
    })
  })

  test('CUSTOMER-NEW — 顧客台帳・新しいお客様の登録', async ({ page }) => {
    await pinTo1108(page)
    await startWork(page)
    await page
      .getByRole('navigation', { name: '画面の切り替え' })
      .getByRole('button', { name: '顧客台帳', exact: true })
      .click()
    await expect(page.getByRole('listbox', { name: 'お客様の一覧' })).toBeVisible()
    await page.getByRole('button', { name: '新しいお客様を登録' }).click()
    await expect(page.getByRole('heading', { name: 'お客様のことをお伺いします' })).toBeVisible()
    const keypad = page.getByRole('group', { name: '電話番号のテンキー' })
    for (const digit of '09012345678'.split('')) {
      await keypad.getByRole('button', { name: digit, exact: true }).click()
    }
    await expect(page.getByText('同じお電話番号のお客様がいます')).toBeVisible()
    /*
     * いま残っている差（2 巡目の実測 331,047 / 3,868,560 ＝ 8.5576% 画素。
     * 1 巡目は 366,766 ＝ 9.4807%）:
     *   - サイドバーがたたんだ細い柱（モックはひらいた 216px）。この面だけひらくと、
     *     `AppShell` が 1 行目に持つ「トップ」のぶん全部が 1 行ずれて、たたんだ姿より
     *     画素の差が大きくなる（2 巡目に実測して確かめた: 391,773 画素）。器の行を
     *     減らす話なので P0/P1 の持ち物として置いた。
     *   - 該当は 1 件になった（2 巡目の直し）。1 巡目は先頭 7 桁だけ一致した
     *     090-1234-9912 の方も「同じお電話番号のお客様」として並べていて、見出しが
     *     嘘になっていた。全桁一致（`match === 'strong'`）だけを並べる。
     *   - 該当行の字が「ご来 店」「4 回」と割れなくなった（2 巡目の直し）。
     *   - 下端の 2 つ（「あとで登録する」「登録してご予約に進む」）はモックと同じ位置に
     *     戻った —— 1 巡目は器が `overflow-hidden` で、該当が 2 件出ると画面の外へ出て
     *     押せなくなっていた。
     *   - テンキーの下の「区切りのハイフンは自動で入ります。」の 1 行を落とした（2 巡目。
     *     説明文が 3 つになり引き算の規準を超えていた。同じことはキーの読み上げ名が言う）。
     *   - 右下の「録音中 02:41」… 録音は P10。
     *   - 上のバー右の「お知らせ 3」… P10。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('CUSTOMER-NEW.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0856,
    })
  })

  test('CUSTOMER-MERGE — 顧客台帳・お客様のおまとめ', async ({ page, request }) => {
    await grantStore(request)
    await pinTo1108(page)
    await startWork(page)
    await page
      .getByRole('navigation', { name: '画面の切り替え' })
      .getByRole('button', { name: '顧客台帳', exact: true })
      .click()
    await expect(page.getByRole('listbox', { name: 'お客様の一覧' })).toBeVisible()
    // おまとめの見本（渡会 昭 様・渡会 章 様）で検索する。
    await page
      .getByRole('searchbox', { name: 'お名前・電話番号　一部でも探せます' })
      .fill('わたらい')
    await page.getByRole('option', { name: /^渡会 昭 様/ }).click()
    await expect(page.getByRole('button', { name: 'くわしく見る' })).toBeVisible()
    await page.getByRole('button', { name: 'くわしく見る' }).click()
    // 渡会 昭 様は度数・注意ごとの記録を持たない見本なので、表ではなく見出しで着地を待つ。
    await expect(page.getByRole('heading', { name: '渡会 昭 様' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'おまとめ' })).toBeVisible()
    await page.getByRole('button', { name: 'おまとめ' }).click()
    await expect(page.getByText('が ふたつ登録されています')).toBeVisible()
    /*
     * いま残っている差（実測 328,536 / 3,868,560 ＝ 8.4926% 画素。1 巡目から動かない）:
     *   - 見比べる 2 件が 渡会 昭 様／渡会 章 様（モックは 田中 花子 様の 2 件）。
     *     `007-customer-records` の seed に同姓同名・同番号の重複を持つのはこの組だけで、
     *     `customers.spec.ts` のおまとめの代表フローもこの 2 件を使う。
     *   - 「A を残します」「B を残します」の下の登録日・登録店舗（`registeredLabel`）が
     *     空欄。`CustomerDetail` 契約に登録日・登録店舗の列が無く、でっち上げないため
     *     （`CustomerScreen.tsx` の `toMergeSide` を参照）。
     *   - 接客のメモの行に「両方を残します」の帯が 1 本増える。モックは両側が「✓ 残す」に
     *     なった結果だけを描いていて、そこへ至る操作を持たない。
     *   - サイドバーがたたんだ細い柱（モックはひらいた 216px）。CUSTOMER-NEW と同じ理由
     *     （ひらくと実測 357,392 画素まで増える）。
     *   - 上のバー右の「お知らせ 3」… P10。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('CUSTOMER-MERGE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.085,
    })
  })

  test('CUSTOMER-HANDWRITE — 顧客台帳・手書きメモ', async ({ page, request }) => {
    /*
     * 手書きメモの入口は「注意ごとの行」からしか開けず（`CustomerDetail.tsx` の
     * `Attentions`）、注意ごとの行が立つのは `kind='attention' AND status='published'`
     * の 1 行だけ ——このフェーズに承認の面（P10）が無いので、**`published` を作れる経路が
     * `seed.mjs` の直接 SQL 以外に無い**。田中 花子 様がその唯一の見本であり、
     * ここではそれ以外の 1 名を作れない（作っても「注意ごと」の行が立たず、
     * 手書きへの入口へ辿り着けない）。
     *
     * `seed.mjs` は手書きの本体を持たない（「筆跡は R2 の本体を伴うので seed には置かない」
     * という同ファイルの決め）ので、田中 花子 様は現状「手書きメモ　0枚」のまま
     * —— 見つけたが、この回では直していない。
     * **田中 花子 様に手書きを足して直すのはこのレビューでは避けた** —— 接客のメモの件数
     * （おまとめの下見が読む「7件」。`customers.spec.ts` が厳密に検証する）を動かすと、
     * その test を壊すため。R2 に本体を持たせたうえで seed 側に見本を 1 名足すのが
     * 正しい直し方だが、他の e2e が数える「お客様 46名」等の総数も動くので、
     * 私の担当（`src/web` / `e2e`）の外にある `seed.mjs` の設計判断を伴う変更として
     * 引き継ぎに残す。
     */
    await openCustomers(page, request)
    await page.getByRole('button', { name: 'くわしく見る' }).click()
    await expect(page.getByRole('table', { name: '度数の移り変わり' })).toBeVisible()
    await page.getByRole('button', { name: /手書きメモを見る/ }).click()
    await expect(page.getByRole('heading', { name: /手書きメモ/ })).toBeVisible()
    /*
     * いま残っている差（実測 283,611 / 3,868,560 ＝ 7.3312% 画素。1 巡目から動かない）:
     *   - **見出しが「手書きメモ　0枚」で、サムネも本文の筆跡も無い**（モックは
     *     「手書きメモ　3枚」で 1 枚を選んだ姿）。理由は上の説明のとおりで、
     *     `seed.mjs`（この担当の外）に手書きの本体を足すまで直らない。
     *   - サイドバーがたたんだ細い柱（モックはひらいた 216px）。CUSTOMER-NEW と同じ理由
     *     （ひらくと実測 324,493 画素まで増える）。
     *   - 道具の列（「大きく」「小さく」「赤ペンも見る」「紙を撮り直す」）を出さない。
     *     押せて何も起きないボタンを作らないための決め（P4 の計画）。
     *   - 上のバー右の「お知らせ 3」… P10。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('CUSTOMER-HANDWRITE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0734,
    })
  })
})
