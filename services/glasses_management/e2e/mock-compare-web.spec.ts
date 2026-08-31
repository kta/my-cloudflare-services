import type { APIRequestContext, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

/*
 * お客様向け Web 予約の 7 面を、承認済みモックの基準画像
 * （docs/frontend/mockups/eyex/reference/WEB-*.png）と 1 枚ずつ重ねて、違う画素の割合を測る。
 *
 *   pnpm --filter @app/glasses_management exec playwright test --project=mock-phone
 *
 * 業務画面の突き合わせ（`mock-compare.spec.ts` / mock project = iPad 1194×810）と作りは同じで、
 * 端末だけが iPhone（390×800 = 844 − ステータスバー 44）になる。基準画像は端末の帯を外した
 * reference/ 側で 780×1600 = 390×800 @2x なので、`scale: 'device'` を必ず付ける
 * （既定の `'css'` だと CSS ピクセルまで縮められて寸法が合わない）。
 *
 * この突き合わせは合否の主役ではない。文言・並び・押せるかは `web-booking.spec.ts` が見る。
 * ここが見るのは「承認された見た目からどれだけ離れているか」だけで、
 * `maxDiffPixelRatio` は**下げるだけ。上げてはいけない。**
 *
 * **どの面にも共通で残る差**（1 面ごとには書かない）:
 *   - 公開している店舗が 銀座店 の 1 店だけである。seed が Web 予約の設定を置くのは銀座店
 *     だけで、丸の内店・新宿店は受付条件 6 面を持たない（`seed.mjs` の決め）。モックは
 *     3 店舗を描いているので、WEB-01 は店舗の札 2 枚ぶんがまるごと差になる。
 *   - 店名が `stores.name_public` の「EYEX 銀座店（銀座4丁目）」。モックは「EYEX 銀座店」。
 *   - ご来店の日時は走らせた日から数えた営業日で、モックの 8月29日（土）11:00 とは違う。
 *   - ご予約番号・確認番号はその場で採る値（モックは EY-W-2608-0031）。
 *   - 和文の字形（承認済みモックは端末の実機、こちらは Chromium）。
 *   - 問いかけの見出し（20px）が 2 行に折り返す面がある。承認済みモックは 1 行で、
 *     折り返したぶん本文がまるごと 50px ほど下へずれるので、下の要素がすべて差になる。
 *     これは寸法ではなく字送りの差で、任意値を書かずに寄せられる限界である。
 *
 * **いまの実測は 6.6%〜13.4%** で、TODO の目安（各 5% 以下）には届いていない。上に並べた
 * 「わざと違うところ」（公開している店舗が 1 店・目的が 5 件・確認番号の箱・時刻の札の枚数）
 * がそのまま画素の差になっているためで、盤面と決めを変えない限りここから下がらない。
 * 値は**実測のまま**据え、下げるときだけ書き換える。
 */

const SLUG = 'ginza'
const uid = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`
/** 新しいメガネを作る（60 分）。モックの WEB-02 以降はこの目的を選んだ姿である。 */
const NEW_GLASSES = uid('e0010000', 0)

const MS_PER_DAY = 24 * 60 * 60 * 1000

const CONTACT = {
  name: '山口 真央',
  kana: 'やまぐち まお',
  phone: '080-2345-6789',
  email: 'm.yamaguchi@example.jp',
} as const

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

function jstDay(at: Date | string = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date(at))
}

function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * MS_PER_DAY)
    .toISOString()
    .slice(0, 10)
}

function clock(at: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(at))
}

function dayLabel(date: string): string {
  const day = new Date(`${date}T00:00:00.000Z`)
  return `${day.getUTCMonth() + 1}月${day.getUTCDate()}日（${WEEKDAYS[day.getUTCDay()]}）`
}

type PublicDay = {
  date: string
  isClosed: boolean
  slots: { startsAt: string; isAvailable: boolean }[]
}

/** 撮るためだけに使う枠。**業務の e2e が使う手前の日を取らない**ので 27 日先から探す。 */
async function openSlot(request: APIRequestContext): Promise<{ date: string; startsAt: string }> {
  const today = jstDay()
  for (let offset = 27; offset <= 30; offset += 1) {
    const date = shiftDay(today, offset)
    const res = await request.get(`/api/public/stores/${SLUG}/availability`, {
      params: { purposeId: NEW_GLASSES, from: date, to: date },
    })
    expect(res.status()).toBe(200)
    const day = ((await res.json()) as { days: PublicDay[] }).days[0]
    const slot = day?.slots.find((row) => row.isAvailable)
    if (slot !== undefined && day !== undefined) return { date: day.date, startsAt: slot.startsAt }
  }
  throw new Error('撮るための空き枠が 27〜30 日先に無い')
}

/**
 * 週を送って目当ての日を出す。週の頭は必ず今日で、送りは 7 日ずつなので、
 * 送る回数は日付から先に決まる（読み込み中に札が無いのを「この週に無い」と読まない）。
 */
async function revealDay(page: Page, date: string): Promise<void> {
  const hops = Math.floor(
    (Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${jstDay()}T00:00:00.000Z`)) /
      MS_PER_DAY /
      7,
  )
  for (let hop = 0; hop < hops; hop += 1) {
    await page.getByRole('button', { name: '次の週' }).click()
  }
  // 定休の日は札の名前が「9月30日（水）　定休」になるので、頭だけで当てる。
  await expect(
    page.getByRole('button', { name: new RegExp(`^${escaped(dayLabel(date))}`) }),
  ).toHaveCount(1)
}
/** 正規表現に入れる前に記号を逃がす。 */
function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test.describe('お客様向け Web 予約と承認済みモックの差', () => {
  test('WEB-01-STORE — ご希望の店舗をお選びください', async ({ page }) => {
    await page.goto(`/w/${SLUG}`)
    await expect(page.getByRole('heading', { name: 'ご希望の店舗をお選びください' })).toBeVisible()

    /*
     * いま残っている差（**許してよいと決めた差**）:
     *   - 店舗の札が 1 枚（モックは 3 枚）。公開しているのは銀座店だけである（頭に書いた共通の差）。
     *   - 補足が「1店舗を表示しています。」。モックの「近い順に3店舗を表示しています。」から
     *     「近い順に」を落としてある（位置情報を使わない。TODO 0.2 の #1）。
     *   - 上のバーの題が店名（`/w/ginza` は店舗を選んだ状態で開く）。モックは「EYEX ご予約」で、
     *     選択中の札と主操作の店名はモックと同じ姿である。
     */
    // 実測 114,084 / 1,248,000 ＝ 9.1414%（2026-08-31）。日付・番号がその場で変わるぶんの余りを足してある。
    // **この値は下げるだけ。上げてはいけない。**
    await expect(page).toHaveScreenshot('WEB-01-STORE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.092,
    })
  })

  test('WEB-02-PURPOSE — ご用件をお選びください', async ({ page }) => {
    await page.goto(`/w/${SLUG}`)
    await page.getByRole('button', { name: /で予約を進める$/ }).click()
    await expect(page.getByRole('heading', { name: 'ご用件をお選びください' })).toBeVisible()

    /*
     * いま残っている差（**許してよいと決めた差**）:
     *   - ご用件が 5 件（モックは「修理・部品の交換」を入れた 6 件）。
     *     修理・部品交換は `is_web_published='0'` なので出さない（TODO 0.2 の #2）。
     *   - 表記が `visit_purposes.name_public`（「新しいメガネを作る」）。
     *     モックの「メガネを新しく作る」は店内名の写し間違いである（TODO 0.2 の #3）。
     *   - モックはどれも選ばれていないが、こちらも同じである（主操作は押せない姿）。
     */
    // 実測 133,467 / 1,248,000 ＝ 10.6944%（2026-08-31）。日付・番号がその場で変わるぶんの余りを足してある。
    // **この値は下げるだけ。上げてはいけない。**
    await expect(page).toHaveScreenshot('WEB-02-PURPOSE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.1075,
    })
  })

  test('WEB-03-DATETIME — ご希望の日時をお選びください', async ({ page, request }) => {
    const slot = await openSlot(request)
    await page.goto(`/w/${SLUG}`)
    await page.getByRole('button', { name: /で予約を進める$/ }).click()
    await page.getByText('新しいメガネを作る', { exact: true }).click()
    await page.getByRole('button', { name: '日時を選ぶ' }).click()
    await revealDay(page, slot.date)
    await page.getByRole('button', { name: dayLabel(slot.date), exact: true }).click()
    await page.getByRole('button', { name: clock(slot.startsAt), exact: true }).click()

    /*
     * いま残っている差（**許してよいと決めた差**）:
     *   - 時刻の札を返ってきた枠ぶんすべて出す（10:30〜17:30 の 13〜14 枚）。モックは 8 枚しか
     *     描いていない。**押せない時刻を隠さない**のがこの面の決めで、枚数を切ると
     *     「満」の札が画面から消える。
     *   - その週の日と、選んだ日・時刻が走らせた日から数えた営業日である（頭に書いた共通の差）。
     *   - 「満」の札が出るかどうかも盤面しだいで、モックの 13:00 / 14:30 とは位置が違う。
     */
    // 実測 142,977 / 1,248,000 ＝ 11.4565%（2026-08-31）。日付・番号がその場で変わるぶんの余りを足してある。
    // **この値は下げるだけ。上げてはいけない。**
    await expect(page).toHaveScreenshot('WEB-03-DATETIME.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.12,
    })
  })

  test('WEB-04-FORM — お客様のことを教えてください', async ({ page, request }) => {
    await walkToForm(page, request)

    /*
     * いま残っている差（**許してよいと決めた差**）:
     *   - 4 欄が空（モックは山口 真央 様の値が入った姿）。伺う前の姿をそのまま撮る。
     *   - 主操作の手前に「4つの欄が埋まると進めます」の 1 行がある。押す前に理由が読めるよう
     *     置いた行で、モックには無い（`07-nfr.md` §2.3「理由なしの disabled を置かない」）。
     */
    // 実測 85,762 / 1,248,000 ＝ 6.8720%（2026-08-31）。日付・番号がその場で変わるぶんの余りを足してある。
    // **この値は下げるだけ。上げてはいけない。**
    await expect(page).toHaveScreenshot('WEB-04-FORM.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.069,
    })
  })

  test('WEB-05-CONFIRM — この内容でお間違いないですか', async ({ page, request }) => {
    await walkToForm(page, request)
    await fillContact(page)
    await page.getByRole('button', { name: '入力内容を確認する' }).click()
    await expect(page.getByRole('heading', { name: 'この内容でお間違いないですか' })).toBeVisible()

    /*
     * いま残っている差（**許してよいと決めた差**）:
     *   - ご来店の日時・店名・ご用件の表記（頭に書いた共通の差）。
     *   - ご用件が「新しいメガネを作る」。モックは「メガネを新しく作る」（TODO 0.2 の #3）。
     */
    // 実測 166,804 / 1,248,000 ＝ 13.3657%（2026-08-31）。日付・番号がその場で変わるぶんの余りを足してある。
    // **この値は下げるだけ。上げてはいけない。**
    await expect(page).toHaveScreenshot('WEB-05-CONFIRM.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.139,
    })
  })

  test('WEB-06-DONE — ご予約を承りました', async ({ page, request }) => {
    await walkToForm(page, request)
    await fillContact(page)
    await page.getByRole('button', { name: '入力内容を確認する' }).click()
    await page.getByRole('button', { name: 'この内容で予約する' }).click()
    await expect(page.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()

    /*
     * いま残っている差（**許してよいと決めた差**）:
     *   - 「確認番号」の箱がもう 1 つある。モックは「ご予約番号」しか描いていないが、
     *     出さないとメールが届かなかったお客様が WEB-CANCEL を通れない（TODO 0.2 の #4）。
     *   - 見出しが「ご予約を承りました」。承認制なので確定していない（Q-01 のいまの前提）。
     *   - 「この画面のご予約番号と確認番号をお控えください。メールはお送りできませんでした。」の
     *     1 行が出る。preview には通知サービスが繋がっておらず、確認のメールが落ちるからである
     *     （送信の成功を偽装しない。AC-WEB-17）。
     *   - 番号とご来店の日時（頭に書いた共通の差）。
     */
    // 実測 139,274 / 1,248,000 ＝ 11.1598%（2026-08-31）。日付・番号がその場で変わるぶんの余りを足してある。
    // **この値は下げるだけ。上げてはいけない。**
    await expect(page).toHaveScreenshot('WEB-06-DONE.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.117,
    })
  })

  test('WEB-CANCEL — ご予約をお調べしました', async ({ page, request }) => {
    const keys = await bookForShot(page, request)
    await page.goto(`/w/${SLUG}/manage`)
    await page.getByLabel('ご予約番号').fill(keys.code)
    await page.getByLabel('確認番号').fill(keys.managementCode)
    await page.getByRole('button', { name: 'ご予約をお調べする' }).click()
    await expect(page.getByRole('heading', { name: 'ご予約をお調べしました' })).toBeVisible()

    /*
     * いま残っている差（**許してよいと決めた差**）:
     *   - ご来店の日時・ご予約番号・ご用件の表記（頭に書いた共通の差）。
     *   - 期限の 1 行は設定（`change_deadline_days`）から組み立てる。既定の 1 で
     *     モックの「変更・取り消しは前日までにお願いいたします。」と一字一句同じになる。
     */
    // 実測 81,987 / 1,248,000 ＝ 6.5695%（2026-08-31）。日付・番号がその場で変わるぶんの余りを足してある。
    // **この値は下げるだけ。上げてはいけない。**
    await expect(page).toHaveScreenshot('WEB-CANCEL.png', {
      scale: 'device',
      maxDiffPixelRatio: 0.071,
    })
  })
})

/** 工程 4（お客様の情報）まで通す。 */
async function walkToForm(page: Page, request: APIRequestContext): Promise<void> {
  const slot = await openSlot(request)
  await page.goto(`/w/${SLUG}`)
  await page.getByRole('button', { name: /で予約を進める$/ }).click()
  await page.getByText('新しいメガネを作る', { exact: true }).click()
  await page.getByRole('button', { name: '日時を選ぶ' }).click()
  await revealDay(page, slot.date)
  await page.getByRole('button', { name: dayLabel(slot.date), exact: true }).click()
  await page.getByRole('button', { name: clock(slot.startsAt), exact: true }).click()
  await page.getByRole('button', { name: 'お客様の情報を入力する' }).click()
  await expect(page.getByRole('heading', { name: 'お客様のことを教えてください' })).toBeVisible()
}

async function fillContact(page: Page): Promise<void> {
  await page.getByLabel('お名前').fill(CONTACT.name)
  await page.getByLabel('ふりがな').fill(CONTACT.kana)
  await page.getByLabel('お電話番号').fill(CONTACT.phone)
  await page.getByLabel('メールアドレス').fill(CONTACT.email)
}

/** WEB-CANCEL を撮るための 1 件。番号 2 つは完了の画面から読む。 */
async function bookForShot(
  page: Page,
  request: APIRequestContext,
): Promise<{ code: string; managementCode: string }> {
  await walkToForm(page, request)
  await fillContact(page)
  await page.getByRole('button', { name: '入力内容を確認する' }).click()
  await page.getByRole('button', { name: 'この内容で予約する' }).click()
  await expect(page.getByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()
  const read = async (term: string): Promise<string> => {
    const lines = (await page.getByRole('group', { name: term }).innerText())
      .split('\n')
      .map((line) => line.trim())
    return lines[lines.length - 1] ?? ''
  }
  return { code: await read('ご予約番号'), managementCode: await read('確認番号') }
}
