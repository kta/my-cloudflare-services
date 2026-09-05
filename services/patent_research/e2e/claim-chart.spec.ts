import { execSync } from 'node:child_process'
import { expect, type Page, test } from '@playwright/test'

// コーパスサイドカーの状態を跨ぐ scenario があるので、この 1 ファイルは直列に走らせる
// （playwright.config.ts の workers: 1 と合わせて順序を保つ）。
test.describe.configure({ mode: 'serial' })

/*
 * 実 workerd の Worker と実コーパスサイドカーに対する通し。
 *
 * 検証するのは製品の主張ただ 1 つ:
 *   照合できなかった AI の主張は、削除されないが支持の根拠には決してならない。
 */

const CORPUS_PORT = 8898

async function openWorkspace(page: Page, org: string): Promise<void> {
  await page.goto('/')
  await page.getByLabel('作業空間').fill(org)
  await page.getByRole('button', { name: '作業空間を開く' }).click()
  await expect(page.getByText('新しい案件')).toBeVisible()
}

async function createMatter(page: Page, title: string): Promise<void> {
  await page.getByLabel(/発明の名前/).fill(title)
  await page.getByRole('button', { name: '案件を作る' }).click()
  await expect(page.getByRole('button', { name: 'クレームチャート' })).toBeVisible()
}

async function defineElements(page: Page): Promise<void> {
  await page.getByRole('button', { name: '構成要件' }).click()
  await page
    .getByLabel('請求項 1 の文')
    .fill('撮像部が眼部を撮像し、前記画像から瞳孔中心を検出する')
  await page.getByRole('button', { name: '構成要件に割る' }).click()
  await page.getByRole('button', { name: '構成要件を保存する' }).click()
  await expect(page.getByText('保存しました。')).toBeVisible()
}

/** 検索して最初のヒットを、選んだ構成要件の典拠に積む。 */
async function searchAndAttach(page: Page, terms: string): Promise<void> {
  await page.getByRole('button', { name: '先行技術検索' }).click()
  await page.getByLabel('構成要件').selectOption({ index: 1 })
  await page.getByLabel('検索語').fill(terms)
  await page.getByRole('button', { name: '検索する' }).click()
  await expect(page.getByText('実行した検索式')).toBeVisible()
  await page.getByRole('button', { name: '典拠に積む' }).first().click()
}

// @e2e-covers AC-EVID-01
test('公報の原文を引いた典拠は照合済みになり、人間が開示を認められる', async ({ page }) => {
  await openWorkspace(page, 'e2e-verified')
  await createMatter(page, '視線追跡による眼鏡フィッティング支援')
  await defineElements(page)
  await searchAndAttach(page, '瞳孔 中心')
  await expect(page.getByText(/典拠に積みました（照合済み）/)).toBeVisible()

  await page.getByRole('button', { name: 'クレームチャート' }).click()
  await expect(page.getByRole('img', { name: /照合済み/ }).first()).toBeVisible()
  await page.getByRole('button', { name: '開示を認める' }).first().click()
  await expect(page.getByText('確認済み')).toBeVisible()
})

// @e2e-covers AC-EVID-02 AC-EVID-03
test('原文に無い引用は棄却され、AI の主張と実際の原文が対比されて残る', async ({
  page,
  request,
}) => {
  await openWorkspace(page, 'e2e-rejected')
  await createMatter(page, '作話を弾く案件')
  await defineElements(page)
  await searchAndAttach(page, '瞳孔 中心')

  // AI が「この段落にこう書いてある」と偽った典拠を、API から直接積む
  // （画面からは原文をそのまま引くので、作話を作れるのはスキル経路だけである）。
  const token = await page.evaluate(() => globalThis.sessionStorage.getItem('app.auth.token'))
  expect(token, 'サインイン済みならトークンが保管されている').toBeTruthy()
  const matterId = new URL(page.url()).pathname.split('/')[2] as string
  const elements = await request.get(`/api/matters/${matterId}/elements`, {
    headers: { authorization: `Bearer ${token}` },
  })
  // 画面の「構成要件」の選択肢は先頭が「（要件に紐づけない）」なので、index 1 は要件 A に当たる。
  // クレームチャートも既定で先頭の要件を開くので、作話も同じ要件 A に積む。
  const [first] = (await elements.json()) as { id: string }[]
  const posted = await request.post(`/api/matters/${matterId}/evidence`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      elementId: (first as { id: string }).id,
      pubNumber: '特開2020-100002',
      paraNo: 'C001',
      quotedText: 'コンクリートの養生方法に関する発明である。',
      relation: 'discloses',
    },
  })
  expect((await posted.json()).quoteCheck).toBe('quote_mismatch')

  await page.reload()
  await page.getByRole('button', { name: 'クレームチャート' }).click()
  await expect(page.getByText('棄却された典拠')).toBeVisible()
  await expect(page.getByText('AI が引用したとする文')).toBeVisible()
  await expect(page.getByText('コンクリートの養生方法に関する発明である。')).toBeVisible()
  await expect(page.getByText(/支持の根拠にはならないが、記録として残す/)).toBeVisible()

  // 照合を通っていない典拠は、人間が承認できない
  const review = await request.post(`/api/evidence/${(await posted.json()).id}/review`, {
    headers: { authorization: `Bearer ${token}` },
    data: { review: 'confirmed' },
  })
  expect(review.status()).toBe(409)
})

// @e2e-covers AC-EVID-04
test('典拠が 1 件も無い構成要件は新規性の勝ち筋として際立つ', async ({ page }) => {
  await openWorkspace(page, 'e2e-open-element')
  await createMatter(page, '勝ち筋を見る案件')
  await defineElements(page)
  await page.getByRole('button', { name: 'クレームチャート' }).click()
  await expect(page.getByText('典拠 0 件 — 新規性の勝ち筋').first()).toBeVisible()
  await expect(page.getByText(/まだ探していないだけかもしれません/)).toBeVisible()
})

// @e2e-covers AC-EVID-05
test('実行した検索式とヒット件数が記録に残る', async ({ page }) => {
  await openWorkspace(page, 'e2e-search-log')
  await createMatter(page, '検索式を残す案件')
  await defineElements(page)
  await page.getByRole('button', { name: '先行技術検索' }).click()
  await page.getByLabel('検索語').fill('瞳孔 中心')
  await page.getByRole('button', { name: '検索する' }).click()

  await expect(page.getByText('実行した検索式')).toBeVisible()
  // 同じ式が「実行した検索式」の欄と「検索の記録」の両方に出る（どちらも意図した表示）。
  await expect(page.getByText('"瞳孔" AND "中心"').first()).toBeVisible()
  await expect(page.getByText(/件（うち公開日不明/)).toBeVisible()
  await expect(page.getByText(/検索の記録 1 件/)).toBeVisible()
})

// @e2e-covers AC-EVID-07
test('未出願の発明は、既定で外部 LLM へ送られない', async ({ page }) => {
  await openWorkspace(page, 'e2e-secret')
  await createMatter(page, '秘密を守る案件')
  await page.getByRole('button', { name: '発明を書く' }).click()
  const consent = page.getByLabel(/外部の LLM/)
  await expect(consent).not.toBeChecked()
  await expect(page.getByText(/依頼者の秘密を扱う場合は開けないでください/)).toBeVisible()
})

// コーパスを実際に落として確かめる。届かないことを 0 件と偽らないのが要件なので、
// 代役ではなく本物のサイドカーを止める。
// @e2e-covers AC-EVID-06
test('コーパスに届かないとき、0 件ではなく届かなかったと言う', async ({ page }) => {
  await openWorkspace(page, 'e2e-corpus-down')
  await createMatter(page, 'コーパスが落ちた案件')
  await defineElements(page)

  execSync(`lsof -ti tcp:${CORPUS_PORT} | xargs kill`, { stdio: 'ignore' })
  try {
    await page.getByRole('button', { name: '先行技術検索' }).click()
    await page.getByLabel('検索語').fill('瞳孔')
    await page.getByRole('button', { name: '検索する' }).click()
    await expect(page.getByText(/0 件ではなく「まだ見ていない」状態です/)).toBeVisible()
    await expect(page.getByText(/ヒット 0 件/)).toHaveCount(0)
    // 実行できなかった検索を調査報告書に載せない
    await expect(page.getByText(/検索の記録 1 件/)).toHaveCount(0)
  } finally {
    execSync(
      `INTERNAL_KEY=dev-internal-key nohup bash e2e/fixtures/build-corpus.sh .wrangler/e2e-corpus.db ${CORPUS_PORT} >/dev/null 2>&1 &`,
      { stdio: 'ignore' },
    )
  }
})
