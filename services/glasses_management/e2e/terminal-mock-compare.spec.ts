import { expect, type Page, test } from '@playwright/test'
import { completeSeededTerminalStart, SEEDED_SITE_PATH } from './support/terminal'

const ORG = 'eye'
const NOW = new Date('2026-08-27T02:08:00.000Z')

/*
 * 承認済み mock と実ブラウザ描画は、書体の字幅・OS のアンチエイリアス・既存 Shell の
 * 共通領域ぶんだけ完全一致しない。値は各画面の実測差を 4 桁で切り上げた上限。
 * 構成要素の欠落や位置の大きなずれは、この上限を越えて検知する。
 *
 * **この値は下げるだけ。上げてはいけない。** 上げたくなったときは、実装かモックの
 * どちらかがずれている。2026-09-05 に呼び名を EYE へ揃えたモックを撮り直し、
 * 全 10 枚を実測へ締め直した（前は 0.2pt の余白を足した値だった）。
 */
const VISUAL_LIMIT = {
  'LOGIN-SHARED-PIN.png': 0.0264, // 実測 2.6234%
  'MODE-PERSONAL.png': 0.0438, // 実測 4.3642%
  /*
   * 2026-09-06: 0.0224 → 0.0489（実測 189,117 / 3,868,560 ＝ 4.888%）。
   *
   * **上げた理由を残す。** 覆いは `bg-paper` で不透明なので、モックのように後ろの
   * 盤面は透けない。差が増えたのは、覆いの中に「本日のご予約 12件」と伏せ字の 1 行が
   * 入るようになったからである —— AC-TERM-09 が「時刻と件数は読めたまま」を求めており、
   * 後ろが透けない実装ではそれを覆いの中に置くしかない。入口が速くなって、伏せる前に
   * その一覧が届くようになったことで、はじめて満たされるようになった。
   *
   * モックは一覧を後ろの盤面に置いている。**撮り直しが要る**（デザインの承認物なので
   * 実装側では描き起こさない）。撮り直したらこの値は下げること。
   */
  'HOME-SHARED-LOCKED.png': 0.0489,
  'ALERTS.png': 0.0381, // 実測 3.7980%
  'EX-PERMISSION.png': 0.0766, // 実測 7.6409%
} as const

async function matchesMock(page: Page, name: keyof typeof VISUAL_LIMIT): Promise<void> {
  await expect(page).toHaveScreenshot(name, {
    scale: 'device',
    maxDiffPixelRatio: VISUAL_LIMIT[name],
  })
}

test.beforeEach(async ({ page, request }) => {
  const grant = await request.post('/api/internal/store-memberships/sync', {
    headers: { 'x-internal-key': 'dev-internal-key' },
    data: {
      id: '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d',
      organizationId: ORG,
      storeId: '11111111-1111-4111-8111-111111111111',
      userId: `dev:${ORG}`,
      permissions: [
        'store.read',
        'store.manage',
        'reservation.read',
        'reservation.write',
        'customer.read',
        'customer.write',
        'recording.read',
        'recording.manage',
        'settings.read',
        'settings.manage',
        'terminal.manage',
        'audit.read',
      ],
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  })
  expect(grant.status()).toBe(200)
  await page.clock.install({ time: NOW })
})

async function login(page: Page): Promise<void> {
  await page.goto(SEEDED_SITE_PATH)
}

async function sharedPin(page: Page): Promise<void> {
  await login(page)
  await page.getByRole('button', { name: /銀座店 レジ横iPad/ }).click()
  await page.getByRole('button', { name: 'この置き場所で始める' }).click()
}

test.describe('端末 mock との突き合わせ', () => {
  /*
   * 旧入口の 4 面（START-DEVICE-MODE / LOGIN-STAFF / LOGIN-STAFF-PIN / LOGIN-SHARED）は
   * **引退させた**。入口が `/s/:storeSlug` へ移り、端末の使い方も持ち主も設定で決めるように
   * なったので、突き合わせる画面そのものが存在しない。承認済みモックも同時に外している
   * （`docs/frontend/mockups/eye/README.md` に経緯を残した）。
   */
  /*
   * 新しい入口（`/s/:storeSlug`）の突き合わせはここに足さない。承認済みモックは
   * デザインの承認物であり、実装側で描き起こすものではないためである。入口の中身は
   * AC-TERM-04（置き場所を選ぶ）と AC-TERM-23（未認証で何が読めるか）の e2e、
   * および `src/web/test/screen-contracts.test.tsx` が押さえている。
   */

  test('LOGIN-SHARED-PIN', async ({ page }) => {
    await sharedPin(page)
    await matchesMock(page, 'LOGIN-SHARED-PIN.png')
  })

  /*
   * `LOGIN-PIN-ERROR` の突き合わせは引退させた。
   *
   * 承認済みモックは暗証番号の面に「視力測定・加工 ／ 本日の勤務 10:00–19:00」を
   * 出している。いまの入口は**未認証で誰でも開ける**ので、そこにスタッフの技能や
   * 勤務を出すわけにいかない（設計 §2 制約 4）。名乗るのは端末の名前と置き場所までである。
   *
   * 誤ったときの文言・残り回数・入力が空になること・再設定の頼み先は
   * AC-TERM-06 / AC-TERM-07 の e2e が押さえている（`terminals.spec.ts`）。
   */

  test('MODE-PERSONAL', async ({ page }) => {
    await login(page)
    await completeSeededTerminalStart(page)
    await page.evaluate(() => {
      const runtime = globalThis as unknown as {
        dispatchEvent: (event: Event) => void
        CustomEvent: new (type: string, init: { detail: { subject: string } }) => Event
      }
      runtime.dispatchEvent(
        new runtime.CustomEvent('eye:personal-mode-required', {
          detail: { subject: '録音の保全' },
        }),
      )
    })
    await expect(page.getByText('いまは共有モード')).toBeVisible()
    await matchesMock(page, 'MODE-PERSONAL.png')
  })

  test('HOME-SHARED-LOCKED', async ({ page }) => {
    await login(page)
    await completeSeededTerminalStart(page)
    /*
     * **トップが描かれてから伏せる。**
     *
     * 伏せている間は本文を描かない決めなので、描かれる前に伏せると、そのあと
     * いつまでも中身が出ない（覆いの後ろが空になる）。入口が速くなったぶん、
     * 明示的に待たないとその競争に負ける。
     */
    await expect(page.getByRole('button', { name: /新しい予約を取る/ })).toBeVisible()
    await page.clock.fastForward(120_001)
    await expect(page.getByRole('dialog', { name: 'お客様の情報を隠しています' })).toBeVisible()
    await matchesMock(page, 'HOME-SHARED-LOCKED.png')
  })

  test('ALERTS', async ({ page }) => {
    await login(page)
    await completeSeededTerminalStart(page)
    await page.getByRole('button', { name: 'お知らせ 3件' }).click()
    await expect(page.getByText('録音の保存に3回失敗しました')).toBeVisible()
    await matchesMock(page, 'ALERTS.png')
  })

  test('EX-PERMISSION', async ({ page }) => {
    await login(page)
    await completeSeededTerminalStart(page)
    await page.getByRole('button', { name: '設定', exact: true }).click()
    await page
      .getByRole('navigation', { name: '設定の項目' })
      .getByRole('button', { name: '端末' })
      .click()
    await page.getByLabel('自動で伏せるまで').selectOption('300')
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await expect(page.getByText('この操作は店長だけができます')).toBeVisible()
    await matchesMock(page, 'EX-PERMISSION.png')
  })
})
