import type { PublicStoreDetail, PublicStorePurpose, PublicStoreSummary } from '@app/contracts'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PublicBookingApp,
  type PublicLoaders,
  publicFlowOf,
  publicLoaders,
  publicStoreSlug,
} from './PublicBookingApp'

/*
 * お客様向けの器（承認済みモック docs/frontend/mockups/eye/images/WEB-01-STORE.png 〜
 * WEB-06-DONE.png と WEB-CANCEL.png の共通部分）。
 *
 * 実測（screens/WEB-0*.html の <style> と assets/eye.css）:
 *   上のバー 56px・地 --brand・左に ‹ 48×48px、店名 19px/700・副題 12px（opacity .9）
 *   進捗 白地・下 1px 罫・padding 10px 16px、帯は 4px 高・間 4px・角 2px
 *   本文 padding 32px 28px、下端の固定は左右 28px・下 32px・主操作は全幅 56px/18px
 *
 * ここで見るのは「何が読めて、何が押せるか」。寸法そのものは e2e の突き合わせが見る。
 */

const GINZA: PublicStoreSummary = {
  slug: 'ginza',
  name: 'EYE 銀座店',
  accessNote: '銀座駅 A2出口から徒歩3分',
}
const MARUNOUCHI: PublicStoreSummary = {
  slug: 'marunouchi',
  name: 'EYE 丸の内店',
  accessNote: '東京駅 丸の内南口から徒歩5分',
}

const GINZA_DETAIL: PublicStoreDetail = {
  ...GINZA,
  phone: '03-1234-5678',
  address: '東京都中央区銀座1-2-3',
  message: '',
  isPublished: true,
}

const PURPOSES: PublicStorePurpose[] = [
  { id: '11111111-1111-4111-8111-111111111111', name: '新しいメガネを作る', durationMinutes: 60 },
  { id: '22222222-2222-4222-8222-222222222222', name: 'かけ具合の調整', durationMinutes: 20 },
]

/** JST 2026年8月27日（木）。端末の時計を読ませないため必ず注ぐ。 */
const TODAY = '2026-08-27'

function loaders(over: Partial<PublicLoaders> = {}): PublicLoaders {
  return {
    stores: () => Promise.resolve([GINZA, MARUNOUCHI]),
    store: () => Promise.resolve(GINZA_DETAIL),
    purposes: () => Promise.resolve(PURPOSES),
    availability: () => Promise.resolve({ days: [] }),
    ...over,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
  setOnline(true)
})

describe('お客様向けの器', () => {
  it('/w/ginza を開くと業務のサイドバーを 1 つも描かない', async () => {
    expect(publicStoreSlug('/w/ginza')).toBe('ginza')
    expect(publicStoreSlug('/')).toBeNull()
    render(<PublicBookingApp slug="ginza" today={TODAY} loaders={loaders()} />)
    await screen.findByRole('radio', { name: /EYE 銀座店/ })

    expect(screen.queryAllByRole('navigation')).toHaveLength(0)
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.queryByText('予約台帳')).toBeNull()
  })

  it('上のバーに店名と「ステップ N / 6」を出す', async () => {
    render(<PublicBookingApp slug="ginza" today={TODAY} loaders={loaders()} />)
    await screen.findByRole('radio', { name: /EYE 銀座店/ })

    const bar = screen.getByRole('banner')
    expect(bar).toHaveTextContent('EYE 銀座店')
    expect(bar).toHaveTextContent('ステップ 1 / 6')
    expect(bar).toHaveTextContent('店舗')
  })

  it('進捗は role="img" で「全6ステップのうち1つ目です」と読める', async () => {
    render(<PublicBookingApp slug="ginza" today={TODAY} loaders={loaders()} />)
    await screen.findByRole('radio', { name: /EYE 銀座店/ })

    expect(screen.getByRole('img', { name: '全6ステップのうち1つ目です' })).toBeInTheDocument()
  })

  it('WEB-CANCEL の進捗は「2つの手順のうち2つ目です」と読める', async () => {
    expect(publicFlowOf('/w/ginza/manage')).toBe('manage')
    render(
      <PublicBookingApp
        slug="ginza"
        flow="manage"
        today={TODAY}
        loaders={loaders()}
        laterSteps={(seam) => (
          <button type="button" onClick={seam.next}>
            ご予約をお調べする
          </button>
        )}
      />,
    )
    expect(screen.getByRole('img', { name: '2つの手順のうち1つ目です' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'ご予約をお調べする' }))

    expect(screen.getByRole('img', { name: '2つの手順のうち2つ目です' })).toBeInTheDocument()
  })

  it('‹ は 1 つ前の工程へ戻り、入力は消えない', async () => {
    render(<PublicBookingApp slug="ginza" today={TODAY} loaders={loaders()} />)
    const ginza = await screen.findByRole('radio', { name: /EYE 銀座店/ })
    expect(ginza).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: '銀座店で予約を進める' }))
    await screen.findByRole('radio', { name: /新しいメガネを作る/ })

    await userEvent.click(screen.getByRole('button', { name: '前の画面へ戻る' }))

    expect(await screen.findByRole('radio', { name: /EYE 銀座店/ })).toBeChecked()
  })

  it('読み込み中・空・エラー・通信が切れたの 4 状態を、見出し 1 行と理由 1 行と次の一手 1 つで出す', async () => {
    const loading = render(
      <PublicBookingApp
        slug="ginza"
        today={TODAY}
        loaders={loaders({ stores: () => new Promise(() => undefined) })}
      />,
    )
    expect(await screen.findByText('読み込んでいます')).toBeInTheDocument()
    expect(screen.getByText('ご予約を受け付けている店舗をお呼びしています。')).toBeInTheDocument()
    expect(screen.getByText('そのままお待ちください。')).toBeInTheDocument()
    loading.unmount()

    const empty = render(
      <PublicBookingApp today={TODAY} loaders={loaders({ stores: () => Promise.resolve([]) })} />,
    )
    expect(await screen.findByText('いまはWebでご予約を承れません')).toBeInTheDocument()
    expect(screen.getByText('ご予約を受け付けている店舗がありません。')).toBeInTheDocument()
    expect(
      screen.getByText('お電話でご予約を承ります。お近くの店舗までお問い合わせください。'),
    ).toBeInTheDocument()
    empty.unmount()

    setOnline(false)
    const offline = render(
      <PublicBookingApp
        slug="ginza"
        today={TODAY}
        loaders={loaders({ stores: () => Promise.reject(new Error('つながりません')) })}
      />,
    )
    expect(await screen.findByText('通信が切れています')).toBeInTheDocument()
    expect(screen.getByText('電波の届く場所で、もう一度お試しください。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeInTheDocument()
    offline.unmount()

    setOnline(true)
    render(
      <PublicBookingApp
        slug="ginza"
        today={TODAY}
        loaders={loaders({ stores: () => Promise.reject(new Error('500')) })}
      />,
    )
    expect(await screen.findByText('読み込めませんでした')).toBeInTheDocument()
    expect(screen.getByText('通信が混み合っているようです。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'もう一度読み込む' })).toBeInTheDocument()
  })

  it('下端の主操作は 56px 以上で、下の安全領域に重ならない', async () => {
    render(<PublicBookingApp slug="ginza" today={TODAY} loaders={loaders()} />)
    const action = await screen.findByRole('button', { name: '銀座店で予約を進める' })

    expect(action.className).toContain('min-h-14')
    const sticky = action.closest('div')
    expect(sticky?.getAttribute('style')).toContain('safe-area-inset-bottom')
  })
})

describe('通信', () => {
  beforeEach(() => {
    sessionStorage.setItem('app.auth.token', 'staff-token-that-must-never-leave-the-back-office')
  })

  it('公開面のクライアントは bearer を 1 度も付けない', async () => {
    // Response の本文は一度しか読めないので、呼ばれるたびに作り直す。
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(
          new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
        ),
      )

    await publicLoaders.stores()
    await publicLoaders.store('ginza')
    await publicLoaders.purposes('ginza')
    await publicLoaders.availability(
      'ginza',
      '11111111-1111-4111-8111-111111111111',
      '2026-08-27',
      '2026-09-02',
    )

    expect(fetchSpy).toHaveBeenCalledTimes(4)
    for (const [, init] of fetchSpy.mock.calls) {
      expect(new Headers(init?.headers).has('authorization')).toBe(false)
    }

    // 公開していない店舗は 404 で返る。読み取りはそこで落ち、画面は 4 状態の型で受ける。
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    await expect(publicLoaders.store('not-published')).rejects.toThrow()
  })
})

/** 端末が電波を掴んでいるかどうか。jsdom の `navigator.onLine` は読み取り専用なので差し替える。 */
function setOnline(online: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}
