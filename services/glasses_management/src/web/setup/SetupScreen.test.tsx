/**
 * はじめの設定。
 *
 * 新しい会社はここを通らないと何も始められない。**一度に 1 つだけ問い、派生できる
 * ものは聞かない**（合い言葉の既定は入口で打った会社のコード）。断られた理由が
 * その場で読め、直すべき場所へ連れて行かれることを固定する。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SetupScreen } from './SetupScreen'

const CREATED = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: 'eyex',
  name: '銀座店',
  slug: 'eyex',
  phone: '',
  address: '',
  accessNote: '',
  isActive: true,
  createdAt: '2026-09-05T00:00:00.000Z',
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }) as Response
}

function renderFirst(send: (input: unknown) => Promise<Response>, onCreated = vi.fn()) {
  render(<SetupScreen organizationId="eyex" send={send as never} onCreated={onCreated} />)
  return { onCreated }
}

const nameField = () => screen.getByLabelText('お店の名前')
const submit = () => screen.getByRole('button', { name: 'このお店で始める' })

afterEach(() => vi.restoreAllMocks())

describe('SetupScreen（最初のお店）', () => {
  it('押しても何も起きない行き先の柱を出さない', () => {
    renderFirst(vi.fn())
    expect(screen.queryByRole('navigation', { name: '画面の切り替え' })).toBeNull()
  })

  it('お店がまだ無いので、上の帯に実在しない店名を出さない', () => {
    renderFirst(vi.fn())
    expect(screen.queryByText('EYE 銀座店')).toBeNull()
    expect(screen.getByText('EYE予約')).toBeInTheDocument()
  })

  it('いまいる場所と見出しを出す', () => {
    renderFirst(vi.fn())
    expect(
      screen.getByRole('heading', { name: '最初のお店を登録します', level: 1 }),
    ).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'いまいる場所' })).toHaveTextContent(
      'はじめの設定',
    )
  })

  it('会社のコードをそのまま合い言葉の既定にする（派生できるものは聞かない）', () => {
    renderFirst(vi.fn())
    expect(screen.getByText('/w/eyex')).toBeInTheDocument()
  })

  it('聞くのは店名だけ。電話・住所・道順はこの面に置かない', () => {
    renderFirst(vi.fn())
    expect(nameField()).toBeInTheDocument()
    expect(screen.queryByLabelText('電話番号')).toBeNull()
    expect(screen.queryByLabelText('住所')).toBeNull()
    expect(screen.queryByLabelText('道順のご案内')).toBeNull()
  })

  it('登録した時点で何が入るかを、埋もれさせずに見せる', () => {
    renderFirst(vi.fn())
    const box = screen.getByRole('heading', { name: 'はじめから入っています', level: 2 })
    expect(box).toBeInTheDocument()
    expect(screen.getByText('月〜土 10:00–19:00・日曜定休')).toBeInTheDocument()
    expect(screen.getByText('30 分・片付け 10 分・同時 3 件')).toBeInTheDocument()
    expect(screen.getByText('メガネを新しく作る')).toBeInTheDocument()
    expect(screen.getByText('どれもあとから設定で変えられます。')).toBeInTheDocument()
  })

  it('あとから足せるものは、入力の締めに書く', () => {
    renderFirst(vi.fn())
    expect(screen.getByText(/あとから設定で足せます/)).toBeInTheDocument()
  })

  it('3 段が別々のことを言う（会社・場所・すること）', () => {
    renderFirst(vi.fn())
    // バー = どの会社にいるか
    expect(screen.getByText('eyex')).toBeInTheDocument()
    // いまいる場所 = どの面か
    expect(screen.getAllByText('はじめの設定')).toHaveLength(1)
    // 見出し = 何をするか
    expect(screen.getAllByText('最初のお店を登録します')).toHaveLength(1)
  })

  it('店名だけ入れて始められる', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(201, CREATED))
    const { onCreated } = renderFirst(send)

    fireEvent.change(nameField(), { target: { value: '銀座店' } })
    fireEvent.click(submit())

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED))
    expect(send).toHaveBeenCalledWith({
      name: '銀座店',
      slug: 'eyex',
      phone: '',
      address: '',
      accessNote: '',
    })
  })

  it('合い言葉は畳んであり、変えたい人だけが開く', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(201, CREATED))
    renderFirst(send)

    expect(screen.queryByLabelText('お客様のページの合い言葉')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '変える' }))

    fireEvent.change(nameField(), { target: { value: '銀座店' } })
    fireEvent.change(screen.getByLabelText('お客様のページの合い言葉'), {
      target: { value: 'ginza' },
    })
    fireEvent.click(submit())

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ slug: 'ginza' })),
    )
  })

  it('店名が空なら送らずにその場で伝え、入力へ戻す', async () => {
    const send = vi.fn()
    renderFirst(send)

    fireEvent.click(submit())

    expect(await screen.findByText('お店の名前を入れてください。')).toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()
    expect(nameField()).toHaveFocus()
  })

  it('合い言葉が使われていたら、空いている案を入れて開いて見せる', async () => {
    const send = vi
      .fn()
      .mockResolvedValue(jsonResponse(409, { error: 'store_slug_taken', slug: 'eyex' }))
    renderFirst(send)

    fireEvent.change(nameField(), { target: { value: '銀座店' } })
    fireEvent.click(submit())

    expect(
      await screen.findByText('この合い言葉は使われています。別の合い言葉を入れてください。'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('お客様のページの合い言葉')).toHaveValue('eyex-2')
  })

  it('使えない文字は送る前に断り、使える文字を示す', async () => {
    const send = vi.fn()
    renderFirst(send)

    fireEvent.change(nameField(), { target: { value: '銀座店' } })
    fireEvent.click(screen.getByRole('button', { name: '変える' }))
    fireEvent.change(screen.getByLabelText('お客様のページの合い言葉'), {
      target: { value: 'Ginza_本店' },
    })
    fireEvent.click(submit())

    expect(
      await screen.findByText('合い言葉は小文字の英数字とハイフンだけが使えます。'),
    ).toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()
  })

  it('管理者でなければ、誰に頼めばよいかまで伝える', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(403, { error: 'forbidden' }))
    renderFirst(send)

    fireEvent.change(nameField(), { target: { value: '銀座店' } })
    fireEvent.click(submit())

    expect(
      await screen.findByText('お店の登録は会社の管理者だけが行えます。管理者にご依頼ください。'),
    ).toBeInTheDocument()
  })

  it('通信に失敗しても、入れた店名は消えない', async () => {
    const send = vi.fn().mockRejectedValue(new Error('offline'))
    renderFirst(send)

    fireEvent.change(nameField(), { target: { value: '銀座店' } })
    fireEvent.click(submit())

    expect(
      await screen.findByText('お店を登録できませんでした。もう一度お試しください。'),
    ).toBeInTheDocument()
    expect(nameField()).toHaveValue('銀座店')
  })

  it('送っている間は二度押しできない', async () => {
    let release: (value: Response) => void = () => {}
    const send = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve
      }),
    )
    renderFirst(send)

    fireEvent.change(nameField(), { target: { value: '銀座店' } })
    fireEvent.click(submit())
    await waitFor(() => expect(submit()).toBeDisabled())
    fireEvent.click(submit())

    expect(send).toHaveBeenCalledTimes(1)
    release(jsonResponse(201, CREATED))
  })

  it('最初の 1 店では「やめる」を出さない（戻る先が無い）', () => {
    renderFirst(vi.fn())
    expect(screen.queryByRole('button', { name: 'やめる' })).toBeNull()
  })
})

describe('SetupScreen（2 店舗目以降）', () => {
  function renderAdditional(onCancel = vi.fn()) {
    render(
      <SetupScreen
        organizationId="eyex"
        existingCount={1}
        send={vi.fn()}
        onCreated={vi.fn()}
        onCancel={onCancel}
      />,
    )
    return { onCancel }
  }

  it('言い回しを「お店を追加します」に替える', () => {
    renderAdditional()
    expect(screen.getByRole('heading', { name: 'お店を追加します', level: 1 })).toBeInTheDocument()
  })

  it('既にある数を避けた合い言葉を既定にする', () => {
    renderAdditional()
    expect(screen.getByText('/w/eyex-2')).toBeInTheDocument()
  })

  it('やめて戻れる', () => {
    const { onCancel } = renderAdditional()
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
