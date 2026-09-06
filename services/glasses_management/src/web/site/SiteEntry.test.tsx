/**
 * 業務端末の入口 `/s/:storeSlug`。
 *
 * 人が打つのは暗証番号だけ。置き場所を選ぶ面には店名と端末の名前しか出さず、
 * スタッフの氏名・勤務・在席は出さない（設計 §2 制約 4）。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SiteEntry } from './SiteEntry'

const SITE = {
  store: { slug: 'ginza', name: 'EYE 銀座店' },
  terminals: [
    { id: 't1', name: '銀座店 レジ横iPad', placeNote: 'レジの右側', kind: 'shared' as const },
    { id: 't2', name: '佐藤 美咲の iPad', placeNote: '本人が持ち歩く', kind: 'personal' as const },
  ],
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)),
  )
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  mockFetch((url) => (url.includes('/api/public/sites/ginza') ? json(SITE) : json({}, 404)))
})

describe('置き場所を選ぶ面', () => {
  it('店名と置き場所の名前を出す', async () => {
    render(<SiteEntry slug="ginza" onStarted={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'EYE 銀座店' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /銀座店 レジ横iPad/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /佐藤 美咲の iPad/ })).toBeInTheDocument()
  })

  it('在席や接続の状態を出さない（未認証で漏らさない）', async () => {
    const { container } = render(<SiteEntry slug="ginza" onStarted={vi.fn()} />)
    await screen.findByRole('heading', { name: 'EYE 銀座店' })
    expect(container.textContent).not.toContain('業務中')
    expect(container.textContent).not.toContain('つながっていません')
    expect(container.textContent).not.toContain('まだ誰も使っていません')
  })

  it('置き場所が 1 つも無ければ、行き止まりにせず理由を出す', async () => {
    mockFetch((url) =>
      url.includes('/api/public/sites/ginza')
        ? json({ store: SITE.store, terminals: [] })
        : json({}, 404),
    )
    render(<SiteEntry slug="ginza" onStarted={vi.fn()} />)
    expect(await screen.findByText(/この店舗で使える端末がまだありません/)).toBeInTheDocument()
  })

  it('知らない slug は、打ち直せる形で伝える', async () => {
    mockFetch(() => json({ error: 'not_found' }, 404))
    render(<SiteEntry slug="nope" onStarted={vi.fn()} />)
    expect(await screen.findByText(/この住所のお店が見つかりませんでした/)).toBeInTheDocument()
  })
})

describe('暗証番号', () => {
  async function pickFirstPlace() {
    render(<SiteEntry slug="ginza" onStarted={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /銀座店 レジ横iPad/ }))
    fireEvent.click(screen.getByRole('button', { name: 'この置き場所で始める' }))
  }

  it('置き場所を選ぶとテンキーが出る', async () => {
    await pickFirstPlace()
    expect(await screen.findByText('4〜6桁の暗証番号を入力してください')).toBeInTheDocument()
  })

  it('正しい暗証番号で業務が始まる', async () => {
    const onStarted = vi.fn()
    mockFetch((url, init) => {
      if (url.includes('/api/public/sites/ginza/terminals/t1/sessions')) {
        expect(JSON.parse(String(init?.body))).toEqual({ pin: '135790' })
        return json({
          token: 'tok',
          session: {
            id: 's1',
            terminalId: 't1',
            staffId: null,
            mode: 'shared',
            startedAt: '2026-08-27T02:08:00.000Z',
            expiresAt: '2026-08-27T14:00:00.000Z',
            sessionToken: 'st',
          },
        })
      }
      return url.includes('/api/public/sites/ginza') ? json(SITE) : json({}, 404)
    })
    render(<SiteEntry slug="ginza" onStarted={onStarted} />)
    fireEvent.click(await screen.findByRole('button', { name: /銀座店 レジ横iPad/ }))
    fireEvent.click(screen.getByRole('button', { name: 'この置き場所で始める' }))
    await screen.findByText('4〜6桁の暗証番号を入力してください')
    for (const digit of ['1', '3', '5', '7', '9', '0']) {
      fireEvent.click(screen.getByRole('button', { name: digit }))
    }
    fireEvent.click(screen.getByRole('button', { name: /確定/ }))
    await waitFor(() =>
      expect(onStarted).toHaveBeenCalledWith(
        'tok',
        expect.objectContaining({ terminalId: 't1', sessionToken: 'st', mode: 'shared' }),
      ),
    )
  })

  it('違う暗証番号は残り回数を出す', async () => {
    mockFetch((url) => {
      if (url.includes('/terminals/t1/sessions')) {
        return json({ error: 'pin_invalid', remainingAttempts: 2 }, 401)
      }
      return url.includes('/api/public/sites/ginza') ? json(SITE) : json({}, 404)
    })
    render(<SiteEntry slug="ginza" onStarted={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /銀座店 レジ横iPad/ }))
    fireEvent.click(screen.getByRole('button', { name: 'この置き場所で始める' }))
    await screen.findByText('4〜6桁の暗証番号を入力してください')
    for (const digit of ['0', '0', '0', '0']) {
      fireEvent.click(screen.getByRole('button', { name: digit }))
    }
    fireEvent.click(screen.getByRole('button', { name: /確定/ }))
    expect(
      await screen.findByText(/暗証番号が違います。あと2回お試しいただけます/),
    ).toBeInTheDocument()
  })

  it('ロック中は待ち時間を出す', async () => {
    mockFetch((url) => {
      if (url.includes('/terminals/t1/sessions')) {
        return json({ error: 'pin_locked', retryAfterSeconds: 900, remainingAttempts: 0 }, 429)
      }
      return url.includes('/api/public/sites/ginza') ? json(SITE) : json({}, 404)
    })
    render(<SiteEntry slug="ginza" onStarted={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: /銀座店 レジ横iPad/ }))
    fireEvent.click(screen.getByRole('button', { name: 'この置き場所で始める' }))
    await screen.findByText('4〜6桁の暗証番号を入力してください')
    for (const digit of ['0', '0', '0', '0']) {
      fireEvent.click(screen.getByRole('button', { name: digit }))
    }
    fireEvent.click(screen.getByRole('button', { name: /確定/ }))
    expect(await screen.findByText(/900秒お待ちください/)).toBeInTheDocument()
  })

  it('やめると置き場所選びに戻る', async () => {
    await pickFirstPlace()
    await screen.findByText('4〜6桁の暗証番号を入力してください')
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(await screen.findByRole('heading', { name: 'EYE 銀座店' })).toBeInTheDocument()
  })
})
