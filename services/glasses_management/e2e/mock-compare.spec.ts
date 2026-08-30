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
     * いま残っている差（2026-08-31 の再測。実測 3.1327% ＝ 121,187 / 3,868,560 画素。
     * 3 巡目で 3.1244% から 0.0083 ポイント増えた。増分は帯の中の折り返しを止めるのを
     * やめたぶんで、「新調相談・視力測定」が「新調相談・視力測」＋「定」と割れる
     * ——モックと同じ割り方だが、そこにモックが描いているのはお客様のお名前なので
     * 画素は近づかない。狭い帯の語が切れなくなったことの代償である）:
     *   - お客様のお名前と来店回数の印（田中 花子 様／4回目）… `customers` は
     *     007-customer-records で足す。帯の 1 行目はいま時刻である。
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
     *   - 帯の 1 行目が時刻の範囲（11:00–12:00）。お名前が無いあいだの仮の置き物で、
     *     007 でお名前に入れ替わる。
     * **この値は下げるだけ。上げてはいけない。**
     */
    await expect(page).toHaveScreenshot('LEDGER-STAFF.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.0314,
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
     * いま残っている差（2026-08-31 の再測。実測 3.6527% ＝ 141,305 / 3,868,560 画素。
     * LEDGER-STAFF と同じ理由で 3.6376% から 0.0151 ポイント増えている）:
     *   - お客様のお名前と来店回数の印（LEDGER-STAFF と同じ。007 で足す）。
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
      maxDiffPixelRatio: 0.0366,
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
      .getByRole('gridcell', { name: '11:00から12:00　新調相談・視力測定　佐藤 美咲' })
      .click()
    await expect(page.getByRole('dialog', { name: '予約の詳細' })).toContainText('11:00–12:00')
    /*
     * いま残っている差（2026-08-31 の再測。実測 7.8270% ＝ 302,793 / 3,868,560 画素）。
     * 3 面の中でいちばん大きい。
     * 台帳そのものの差（LEDGER-STAFF と同じ 9 つ）に加えて:
     *   - 行が 1 本増えたぶん、詳細を刺す帯が 28px 上に来る。440×460 の面がまるごとずれる。
     *   - お客様のお名前と来店回数（田中 花子 様／4回目）… `customers` は 007。頭の行に
     *     出すものが無いので、時刻と所要時間だけの 1 行になる。
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
      maxDiffPixelRatio: 0.0783,
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
})
