import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

/*
 * 承認済みモック（docs/frontend/mockups/eyex/images/HOME.png）の骨格が
 * 実際に描かれていることを固定する。見た目の寸法は e2e の突き合わせで見るので、
 * ここでは「何が読めて、何が押せるか」を見る。
 */

const stores = [
  {
    id: '11111111-2222-4333-8444-555555555555',
    organizationId: 'eyex',
    name: 'EYEX 銀座店',
    slug: 'ginza',
    phone: '',
    address: '',
    accessNote: '',
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  {
    id: '22222222-2222-4333-8444-555555555555',
    organizationId: 'eyex',
    name: 'EYEX 丸の内店',
    slug: 'marunouchi',
    phone: '',
    address: '',
    accessNote: '',
    isActive: false,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
]

/** 木曜は 10:00–19:00、火曜は定休。 */
const businessHours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  isClosed: weekday === 2,
  opensAt: weekday === 2 ? null : '10:00',
  closesAt: weekday === 2 ? null : '19:00',
  breakStart: null,
  breakEnd: null,
}))

function mockFetch(handler: (url: string) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => handler(String(input))),
  )
}

beforeEach(() => {
  sessionStorage.clear()
  mockFetch((url) => {
    if (url.includes('/api/auth/token')) {
      return new Response(JSON.stringify({ token: 'test-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/staff/alerts')) {
      return new Response(
        JSON.stringify({ items: [], counts: { all: 3, alert: 1, info: 2, done: 0 } }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      )
    }
    if (url.includes('/business-hours')) {
      return new Response(JSON.stringify({ rows: businessHours }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/staff/stores')) {
      return new Response(JSON.stringify(stores), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('not found', { status: 404 })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function startWork() {
  render(<App />)
  await userEvent.type(screen.getByLabelText('お店のコード'), 'eyex')
  await userEvent.click(screen.getByRole('button', { name: '業務を始める' }))
}

describe('業務開始', () => {
  it('コードが空のまま始めようとすると、何を入れるか教える', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('button', { name: '業務を始める' }))
    expect(screen.getByText('お店のコードを入れてください。')).toBeInTheDocument()
  })

  it('始めると店舗名が上のバーに出る', async () => {
    await startWork()
    await waitFor(() => expect(screen.getByText('EYEX 銀座店')).toBeInTheDocument())
  })

  /*
   * 上のバーの営業状態は、以前 `'営業中　10:00–19:00'` という文字列リテラルだった。
   * 店舗が変わっても、曜日が変わっても、定休日でも、真夜中でも同じ 1 行を出していた。
   * いまは保存された営業時間から出す（判定は `shell/hours.ts` の純関数で、
   * 曜日ごと・時刻ごとの網羅はそちらの面が持つ）。
   */
  it('上のバーの営業状態は、保存された営業時間から出す', async () => {
    await startWork()
    await waitFor(() => expect(screen.getByText('EYEX 銀座店')).toBeInTheDocument())
    await waitFor(() =>
      expect(screen.getByText(/(営業中|営業時間外|本日は定休日)/)).toBeInTheDocument(),
    )
    // 時間帯は保存された値そのもの。憶測の数字を書かない。
    expect(screen.queryByText(/10:00–19:00/)).not.toBeNull()
  })
})

describe('左サイドバー', () => {
  it('行き先を上から順に持つ', async () => {
    await startWork()
    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: '画面の切り替え' })).toBeInTheDocument(),
    )
    for (const label of [
      'トップ',
      '予約台帳',
      '来店受付',
      '予約を探す',
      '受付履歴',
      '顧客台帳',
      '分析',
      '設定',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: '予約を取る' })).toBeInTheDocument()
    expect(screen.getByText('お店の運用')).toBeInTheDocument()
  })

  it('つまみで細い柱にたたむと、文字は見えなくなるが読み上げ名は残る', async () => {
    await startWork()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '予約台帳' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: 'サイドバーをたたむ' }))
    // アイコンだけのボタンに名前が無いのは重大な欠陥なので、名前は残したまま隠す
    const collapsed = screen.getByRole('button', { name: '予約台帳' })
    expect(collapsed.querySelector('.sr-only')?.textContent).toBe('予約台帳')
    expect(screen.getByRole('button', { name: 'サイドバーをひらく' })).toBeInTheDocument()
  })

  it('横に広い画面へ移ると、たたんだ状態が既定になる', async () => {
    await startWork()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '予約台帳' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: '予約台帳' }))
    expect(screen.getByRole('button', { name: 'サイドバーをひらく' })).toBeInTheDocument()
  })

  it('いま開いている行き先が分かる', async () => {
    await startWork()
    await waitFor(() => expect(screen.getByRole('button', { name: 'トップ' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'トップ' })).toHaveAttribute('aria-current', 'page')
  })
})

describe('分析', () => {
  it('分析を開くと、現在の店舗を初期値にしてoverviewを一度読む', async () => {
    const calls: string[] = []
    mockFetch((url) => {
      calls.push(url)
      if (url.includes('/api/auth/token'))
        return new Response(JSON.stringify({ token: 't' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      if (url.includes('/api/staff/stores'))
        return new Response(JSON.stringify(stores), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      if (url.includes('/api/staff/analytics'))
        return new Response(
          JSON.stringify({
            metric: 'overview',
            from: '2026-08-20',
            to: '2026-09-03',
            granularity: 'day',
            countBy: 'visit_date',
            series: [{ name: '予約数', pattern: 'solid', points: [] }],
            summary: [],
            target: null,
            suppressed: false,
            businessDays: 0,
            pendingDays: 0,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      return new Response('not found', { status: 404 })
    })
    await startWork()
    await userEvent.click(await screen.findByRole('button', { name: '分析' }))
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'トップ' })).toHaveAttribute('aria-selected', 'true'),
    )
    expect(screen.getByLabelText('店舗')).toHaveValue(stores[0]?.id)
    await waitFor(() =>
      expect(calls.some((url) => url.includes('/api/staff/analytics?'))).toBe(true),
    )
    expect(calls.filter((url) => url.includes('/api/staff/analytics/targets'))).toHaveLength(0)
  })
})

describe('トップ', () => {
  it('主操作は 2 つだけ', async () => {
    await startWork()
    await waitFor(() => expect(screen.getByText('新しい予約を取る')).toBeInTheDocument())
    expect(screen.getByText('お電話・ご来店のお客様')).toBeInTheDocument()
    expect(screen.getByText('予約を変更する')).toBeInTheDocument()
    expect(screen.getByText('日時・内容の変更、取り消し')).toBeInTheDocument()
  })

  it('「予約を変更する」を押すと予約を探す面へ移る（押して何も起きないボタンを置かない）', async () => {
    await startWork()
    await waitFor(() => expect(screen.getByText('予約を変更する')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /予約を変更する/ }))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'お客様を伺って探します' })).toBeInTheDocument(),
    )
  })

  /*
   * 「◯◯へ切り替える」のチップは、以前 `onClick` を持っていなかった。
   * トップの 5 つの操作のうち 2 つが飾りになっていた（UX 監査 SHELL-07）。
   */
  it('ほかのお店のチップを押すと、その店舗に切り替わる', async () => {
    await startWork()
    await waitFor(() => expect(screen.getByText('新しい予約を取る')).toBeInTheDocument())
    // いまは銀座店。丸の内店のチップだけが出ている。
    expect(screen.getByRole('button', { name: 'EYEX 丸の内店へ切り替える' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'EYEX 丸の内店へ切り替える' }))
    // 切り替わると、上のバーの店名が変わり、チップは銀座店のほうに入れ替わる。
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'EYEX 銀座店へ切り替える' })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: 'EYEX 丸の内店へ切り替える' })).toBeNull()
  })

  it('お店が届いていないときは、その理由と次の行動を出す', async () => {
    mockFetch((url) =>
      url.includes('/api/auth/token')
        ? new Response(JSON.stringify({ token: 't' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response(JSON.stringify({ error: 'not_synced' }), { status: 503 }),
    )
    await startWork()
    await waitFor(() =>
      expect(
        screen.getByText(
          'お店の情報がまだ届いていません。しばらくしてからもう一度開いてください。',
        ),
      ).toBeInTheDocument(),
    )
  })
})

/*
 * 存在しないお店のコードでも、以前はアプリ本体に入れてしまっていた。
 * 端末モードの選択も置き場所も暗証番号も飛ばし、上のバーには実在しない店の
 * 「営業中 10:00–19:00」まで出ていた（UX 監査 SHELL-03）。
 * **入口で止めて、コードを直す道を示す。**
 */
describe('知らないお店のコード', () => {
  function noStores() {
    mockFetch((url) =>
      url.includes('/api/auth/token')
        ? new Response(JSON.stringify({ token: 't' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response(JSON.stringify([]), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
    )
  }

  it('お店が 1 つも見つからないコードでは、入口で止めて理由を言う', async () => {
    noStores()
    render(<App />)
    await userEvent.type(screen.getByLabelText('お店のコード'), 'nonexistent')
    await userEvent.click(screen.getByRole('button', { name: '業務を始める' }))
    await waitFor(() =>
      expect(
        screen.getByText(
          'このコードのお店が見つかりませんでした。お店のコードをお確かめのうえ、もう一度お試しください。',
        ),
      ).toBeInTheDocument(),
    )
  })

  it('止めたあとも入口に留まり、アプリ本体には入らない', async () => {
    noStores()
    render(<App />)
    await userEvent.type(screen.getByLabelText('お店のコード'), 'nonexistent')
    await userEvent.click(screen.getByRole('button', { name: '業務を始める' }))
    await waitFor(() => expect(screen.getByLabelText('お店のコード')).toBeInTheDocument())
    // 左サイドバーも、偽の営業時間も出さない。
    expect(screen.queryByRole('navigation', { name: '画面の切り替え' })).toBeNull()
    expect(screen.queryByText(/営業中/)).toBeNull()
  })
})

describe('業務を終える', () => {
  it('終えると業務開始の画面へ戻る', async () => {
    await startWork()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '業務を終える' })).toBeInTheDocument(),
    )
    await userEvent.click(screen.getByRole('button', { name: '業務を終える' }))
    expect(screen.getByLabelText('お店のコード')).toBeInTheDocument()
  })
})

/*
 * 器は、画面を移っただけで勝手に姿を変えない。
 *
 * 以前は左サイドバーの幅が画面ごとの既定（RAIL_BY_DEFAULT）で上書きされ、
 * 操作していないのに 216px と 76px を行き来していた（実測: トップ216 → 台帳76 →
 * 受付76 → 探す216 → 履歴216 → 顧客76 → 分析76 → 設定76）。
 * 本文の左端がそのたび 140px 横に飛ぶ。UX 監査 UI-04。
 */
describe('器の安定', () => {
  it('サイドバーを一度たたんだら、画面を移ってもたたんだまま', async () => {
    await startWork()
    const nav = await screen.findByRole('navigation', { name: '画面の切り替え' })
    await userEvent.click(screen.getByRole('button', { name: 'サイドバーをたたむ' }))
    expect(screen.getByRole('button', { name: 'サイドバーをひらく' })).toBeInTheDocument()

    await userEvent.click(within(nav).getByRole('button', { name: '受付履歴' }))
    // 画面を移っても、たたんだ状態が勝手に戻らない。
    expect(screen.getByRole('button', { name: 'サイドバーをひらく' })).toBeInTheDocument()
  })

  it('画面ごとの既定は初回だけ。行き来しても幅が往復しない', async () => {
    await startWork()
    const nav = await screen.findByRole('navigation', { name: '画面の切り替え' })
    // 台帳は時間軸を広く見たいので、初めて開くときだけ細い柱になる。
    await userEvent.click(within(nav).getByRole('button', { name: '予約台帳' }))
    expect(screen.getByRole('button', { name: 'サイドバーをひらく' })).toBeInTheDocument()
    // 自分でひらいたら、その意思が残る。
    await userEvent.click(screen.getByRole('button', { name: 'サイドバーをひらく' }))
    await userEvent.click(within(nav).getByRole('button', { name: 'トップ' }))
    await userEvent.click(within(nav).getByRole('button', { name: '予約台帳' }))
    expect(screen.getByRole('button', { name: 'サイドバーをたたむ' })).toBeInTheDocument()
  })
})

/*
 * 未読のお知らせは、どの画面からでも見える。
 * 以前は home / ledger / customers / settings の 4 画面にしかベルが出ず、
 * 来店受付・予約を探す・受付履歴・分析では「録音の保存に3回失敗しました」が
 * 画面から消えていた。UX 監査 UI-05。
 */
describe('お知らせのベル', () => {
  it.each(['予約台帳', '来店受付', '予約を探す', '受付履歴', '顧客台帳', '分析', '設定'])(
    '%s でも未読の件数が見える',
    async (label) => {
      await startWork()
      const nav = await screen.findByRole('navigation', { name: '画面の切り替え' })
      await userEvent.click(within(nav).getByRole('button', { name: label }))
      expect(screen.getByRole('button', { name: /^お知らせ/ })).toBeInTheDocument()
    },
  )
})
