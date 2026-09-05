/**
 * 会社を作ってから使い始めるまで（`014-store-provisioning`）。
 *
 * 新しい会社は店舗を作る手段が無く、店舗の設定は担当店舗の権限で守られ、その権限は
 * 店舗が無いと持てなかった。この輪を切る 1 本と、切ったことで他社へ漏れていない
 * ことを確かめる。会社のコードは筋書きごとに新しく作る（dev グラントが知らない
 * 組織にもトークンを出し、`organizations` に行を作る）。
 */
import { type APIRequestContext, expect, type Page, test } from '@playwright/test'
import { signedTokenFor } from './support/auth'

const INTERNAL_HEADERS = { 'x-internal-key': 'dev-internal-key' }

/** 会社のコードは毎回新しく作る。合い言葉は全組織横断で一意なので同じく。 */
const newOrg = (): string => `eyex${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`
const newSlug = (): string => `s${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`

async function tokenFor(
  request: APIRequestContext,
  org: string,
  role: 'admin' | 'staff' = 'admin',
): Promise<string> {
  // 店舗をまだ 1 つも持たない会社を作るので、seed の端末からは取れない。
  // e2e 自身で署名する（サーバに credential 無しの経路は残さない）。
  return signedTokenFor(org, role)
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

async function createStore(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
) {
  return request.post('/api/staff/stores', { headers: bearer(token), data: body })
}

/**
 * 会社の管理者として業務を始める。
 *
 * 画面の dev ログインは **staff** のトークンを取る（`IssueTokenRequest.role` の既定）。
 * お店の登録は会社の管理者だけなので、admin のトークンを先に発行して差し込む。
 * 実運用では admin の `/api/auth/login` が本人のロールを載せて返す。
 */
async function startAsAdmin(page: Page, request: APIRequestContext, org: string): Promise<void> {
  const token = await tokenFor(request, org, 'admin')
  await page.addInitScript(
    ([t, o]) => {
      sessionStorage.setItem('app.auth.token', t as string)
      sessionStorage.setItem('app.auth.org', o as string)
    },
    [token, org],
  )
  await page.goto('/')
}

// @e2e-covers UC-PROV-01 AC-PROV-01
test('お店が 1 つも無い会社には、登録する面が最初に立つ', async ({ page, request }) => {
  const org = newOrg()
  await startAsAdmin(page, request, org)

  await expect(
    page.getByRole('heading', { name: '最初のお店を登録します', level: 1 }),
  ).toBeVisible()
  await expect(page.getByLabel('お店の名前')).toBeVisible()
  // 押しても何も起きない行き先を並べない。
  await expect(page.getByRole('navigation', { name: '画面の切り替え' })).toBeHidden()
  await expect(page.getByRole('button', { name: '新しい予約を取る' })).toBeHidden()
  // 3 段が別々のことを言う。上の帯 = どの会社か、いまいる場所 = どの面か。
  // 実在しない店名は出さない。
  await expect(page.getByRole('banner')).toContainText(org)
  await expect(page.getByRole('navigation', { name: 'いまいる場所' })).toContainText('はじめの設定')
  await expect(page.getByText('EYE 銀座店')).toBeHidden()
})

// @e2e-covers AC-PROV-02
test('店名だけ入れれば、会社のコードが合い言葉になって業務へ入れる', async ({ page, request }) => {
  const org = newOrg()
  await startAsAdmin(page, request, org)

  // 合い言葉は聞かれない。出来上がる住所として見えているだけ。
  await expect(page.getByText(`/w/${org}`)).toBeVisible()
  await page.getByLabel('お店の名前').fill('銀座店')
  await page.getByRole('button', { name: 'このお店で始める' }).click()

  await expect(page.getByRole('button', { name: '新しい予約を取る' })).toBeVisible()
})

// @e2e-covers UC-PROV-02 AC-PROV-03
test('2 店舗目以降も同じ導線から増やせる', async ({ page, request }) => {
  const org = newOrg()
  const token = await tokenFor(request, org)
  expect((await createStore(request, token, { name: '銀座店', slug: newSlug() })).status()).toBe(
    201,
  )

  await startAsAdmin(page, request, org)
  // お店を増やす道は**上のバーの店名**にある（トップの主操作の下に行を足さない）。
  await page.getByRole('button', { name: /お店を切り替える$/ }).click()
  await page.getByRole('button', { name: 'お店を追加する' }).click()
  await expect(page.getByRole('heading', { name: 'お店を追加します', level: 1 })).toBeVisible()
  // 2 店舗目の合い言葉には連番が付く。
  await expect(page.getByText(`/w/${org}-2`)).toBeVisible()
  await page.getByLabel('お店の名前').fill('丸の内店')
  await page.getByRole('button', { name: 'このお店で始める' }).click()

  const list = await request.get('/api/staff/stores', { headers: bearer(token) })
  expect(((await list.json()) as unknown[]).length).toBe(2)
})

// @e2e-covers UC-PROV-03
test('お客様向けページの合い言葉は登録した人が決める', async ({ request }) => {
  const org = newOrg()
  const token = await tokenFor(request, org)
  const slug = newSlug()

  const created = await createStore(request, token, { name: '合い言葉の店', slug })

  expect(created.status()).toBe(201)
  expect((await created.json()).slug).toBe(slug)
})

// @e2e-covers AC-PROV-04
test('使われている合い言葉は、別の言葉を選べるように断る', async ({ page, request }) => {
  const taken = newSlug()
  const owner = await tokenFor(request, newOrg())
  expect((await createStore(request, owner, { name: '先客', slug: taken })).status()).toBe(201)

  await startAsAdmin(page, request, newOrg())
  await page.getByLabel('お店の名前').fill('後から来た店')
  await page.getByRole('button', { name: '変える' }).click()
  await page.getByLabel('お客様のページの合い言葉').fill(taken)
  await page.getByRole('button', { name: 'このお店で始める' }).click()

  await expect(
    page.getByText('この合い言葉は使われています。別の合い言葉を入れてください。'),
  ).toBeVisible()
  // 使われていた合い言葉を握ったままにせず、次の案を入れて見せる。
  await expect(page.getByLabel('お客様のページの合い言葉')).toHaveValue(`${taken}-2`)
})

// @e2e-covers AC-PROV-05
test('使えない文字の合い言葉は、使える文字を示して断る', async ({ page, request }) => {
  await startAsAdmin(page, request, newOrg())
  await page.getByLabel('お店の名前').fill('記号の店')
  await page.getByRole('button', { name: '変える' }).click()
  await page.getByLabel('お客様のページの合い言葉').fill('Ginza_本店')
  await page.getByRole('button', { name: 'このお店で始める' }).click()

  await expect(page.getByText('合い言葉は小文字の英数字とハイフンだけが使えます。')).toBeVisible()
})

// @e2e-covers UC-PROV-05 AC-PROV-06
test('登録した直後の営業時間は 7 曜日ぶん入り、日曜だけ定休になる', async ({ request }) => {
  const token = await tokenFor(request, newOrg())
  const created = await createStore(request, token, { name: '既定時間店', slug: newSlug() })
  const storeId = (await created.json()).id

  const res = await request.get(`/api/staff/stores/${storeId}/business-hours`, {
    headers: bearer(token),
  })
  const body = (await res.json()) as {
    rows: Array<{ weekday: number; isClosed: boolean; opensAt: string | null }>
  }

  expect(body.rows).toHaveLength(7)
  expect(body.rows.find((r) => r.weekday === 0)?.isClosed).toBe(true)
  expect(body.rows.find((r) => r.weekday === 1)).toMatchObject({
    isClosed: false,
    opensAt: '10:00',
  })
})

// @e2e-covers AC-PROV-07
test('登録した直後の予約の間隔は刻み 30 分・片付け 10 分・同時 3 件', async ({ request }) => {
  const token = await tokenFor(request, newOrg())
  const created = await createStore(request, token, { name: '既定枠店', slug: newSlug() })
  const storeId = (await created.json()).id

  const res = await request.get(`/api/staff/stores/${storeId}/slot-rules`, {
    headers: bearer(token),
  })

  expect(await res.json()).toMatchObject({ slotMinutes: 30, cleanupMinutes: 10, maxParallel: 3 })
})

// @e2e-covers AC-PROV-08
test('登録した直後にご来店の目的が 3 件入っている', async ({ request }) => {
  const token = await tokenFor(request, newOrg())
  const created = await createStore(request, token, { name: '既定目的店', slug: newSlug() })
  const storeId = (await created.json()).id

  const res = await request.get(`/api/staff/purposes?storeId=${storeId}`, {
    headers: bearer(token),
  })
  const list = (await res.json()) as Array<{ nameInternal: string }>

  expect(list.map((p) => p.nameInternal)).toEqual([
    'メガネを新しく作る',
    '調整・修理',
    'その他のご相談',
  ])
})

// @e2e-covers AC-PROV-09
test('登録した直後に空き枠の面が引ける', async ({ request }) => {
  const token = await tokenFor(request, newOrg())
  const created = await createStore(request, token, { name: '空き枠の店', slug: newSlug() })
  const storeId = (await created.json()).id

  const res = await request.get(
    `/api/staff/availability?storeId=${storeId}&date=2026-08-27&purposeIds=`,
    { headers: bearer(token) },
  )

  // 目的の指定なしでも「引ける」ことを見る（枠の中身は P2 の筋書きが見る）。
  expect([200, 400]).toContain(res.status())
  expect(res.status()).not.toBe(403)
})

// @e2e-covers UC-PROV-04 AC-PROV-10
test('登録した本人は、そのまま同じお店の設定を保存できる', async ({ request }) => {
  const token = await tokenFor(request, newOrg())
  const created = await createStore(request, token, { name: '続けて設定店', slug: newSlug() })
  const storeId = (await created.json()).id

  const res = await request.patch(`/api/staff/stores/${storeId}`, {
    headers: bearer(token),
    data: { phone: '03-0000-0000', version: 1 },
  })

  expect(res.status()).toBe(200)
})

// @e2e-covers UC-PROV-07 AC-PROV-11
test('会社の管理者でない店員はお店を登録できない', async ({ request }) => {
  const org = newOrg()
  const staff = await tokenFor(request, org, 'staff')

  const res = await createStore(request, staff, { name: '店員が作る店', slug: newSlug() })

  expect(res.status()).toBe(403)
  const admin = await tokenFor(request, org, 'admin')
  const list = await request.get('/api/staff/stores', { headers: bearer(admin) })
  expect((await list.json()) as unknown[]).toHaveLength(0)
})

// @e2e-covers UC-PROV-08 AC-PROV-12
test('他社が使っている合い言葉は取れない', async ({ request }) => {
  const slug = newSlug()
  const first = await tokenFor(request, newOrg())
  expect((await createStore(request, first, { name: '先客', slug })).status()).toBe(201)

  const second = await tokenFor(request, newOrg())
  const blocked = await createStore(request, second, { name: '後客', slug })

  expect(blocked.status()).toBe(409)
  expect(await blocked.json()).toEqual({ error: 'store_slug_taken', slug })
})

// @e2e-covers UC-PROV-09 AC-PROV-13
test('他社のお店は一覧に出ない', async ({ request }) => {
  const mine = await tokenFor(request, newOrg())
  const theirs = await tokenFor(request, newOrg())
  const ours = await createStore(request, mine, { name: '自社', slug: newSlug() })
  const yours = await createStore(request, theirs, { name: '他社', slug: newSlug() })

  const res = await request.get('/api/staff/stores', { headers: bearer(mine) })
  const ids = ((await res.json()) as Array<{ id: string }>).map((s) => s.id)

  expect(ids).toContain((await ours.json()).id)
  expect(ids).not.toContain((await yours.json()).id)
})

// @e2e-covers AC-PROV-14
test('本文に他社の会社 id を混ぜても、他社にはお店が作られない', async ({ request }) => {
  const mine = newOrg()
  const theirs = newOrg()
  const mineToken = await tokenFor(request, mine)
  const theirsToken = await tokenFor(request, theirs)

  const spoofed = await createStore(request, mineToken, {
    name: '偽装する店',
    slug: newSlug(),
    organizationId: theirs,
  })
  expect(spoofed.status()).toBe(400)

  const list = await request.get('/api/staff/stores', { headers: bearer(theirsToken) })
  expect((await list.json()) as unknown[]).toHaveLength(0)
})

// @e2e-covers UC-PROV-10 AC-PROV-17
test('お店を登録した記録が監査に残る', async ({ request }) => {
  const token = await tokenFor(request, newOrg())
  const created = await createStore(request, token, { name: '監査に残る店', slug: newSlug() })
  const storeId = (await created.json()).id

  const res = await request.get(`/api/staff/audit?storeId=${storeId}`, { headers: bearer(token) })
  const body = (await res.json()) as { items?: Array<{ action: string; targetId: string }> }
  const items = body.items ?? []

  expect(items.some((e) => e.action === 'store.created' && e.targetId === storeId)).toBe(true)
})

// @e2e-covers AC-PROV-18
test('止められた会社ではお店を登録できない', async ({ request }) => {
  const org = newOrg()
  const token = await tokenFor(request, org)
  const disable = await request.post('/api/internal/organizations/sync', {
    headers: INTERNAL_HEADERS,
    data: {
      id: org,
      name: '止まった会社',
      plan: 'free',
      isDisabled: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      revision: 99,
    },
  })
  expect(disable.status()).toBe(200)

  const res = await createStore(request, token, { name: '止まった会社の店', slug: newSlug() })

  expect(res.status()).toBe(403)
})
