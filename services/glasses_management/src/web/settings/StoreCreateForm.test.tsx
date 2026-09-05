/**
 * お店の登録フォーム。
 *
 * 新しい会社はここを通らないと何も始められないので、**断られた理由が読める**ことを
 * 一番に固定する。合い言葉の重複と、管理者でないことは別の文言で伝える。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StoreCreateForm } from './StoreCreateForm'

const CREATED = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: 'eyex',
  name: '銀座店',
  slug: 'ginza',
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

function fill(name: string, slug: string): void {
  fireEvent.change(screen.getByLabelText('お店の名前'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('お客様向けページの合い言葉'), {
    target: { value: slug },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('StoreCreateForm', () => {
  it('名前と合い言葉を入れて登録すると、作られたお店を親へ渡す', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(201, CREATED))
    const onCreated = vi.fn()
    render(<StoreCreateForm send={send} onCreated={onCreated} />)

    fill('銀座店', 'ginza')
    fireEvent.click(screen.getByRole('button', { name: 'このお店を登録する' }))

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(CREATED))
    expect(send).toHaveBeenCalledWith({
      name: '銀座店',
      slug: 'ginza',
      phone: '',
      address: '',
      accessNote: '',
    })
  })

  it('任意の項目も一緒に送る', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(201, CREATED))
    render(<StoreCreateForm send={send} onCreated={() => {}} />)

    fill('新宿店', 'shinjuku')
    fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '03-1234-5678' } })
    fireEvent.change(screen.getByLabelText('住所'), { target: { value: '東京都新宿区1-1-1' } })
    fireEvent.change(screen.getByLabelText('道順のご案内'), {
      target: { value: '東口から徒歩3分' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'このお店を登録する' }))

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        name: '新宿店',
        slug: 'shinjuku',
        phone: '03-1234-5678',
        address: '東京都新宿区1-1-1',
        accessNote: '東口から徒歩3分',
      }),
    )
  })

  it('名前が空なら送らずにその場で伝える', async () => {
    const send = vi.fn()
    render(<StoreCreateForm send={send} onCreated={() => {}} />)

    fill('   ', 'ginza')
    fireEvent.click(screen.getByRole('button', { name: 'このお店を登録する' }))

    expect(await screen.findByText('お店の名前を入れてください。')).toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()
  })

  it('合い言葉に使えない文字があれば、使える文字を示して送らない', async () => {
    const send = vi.fn()
    render(<StoreCreateForm send={send} onCreated={() => {}} />)

    fill('銀座店', 'Ginza_本店')
    fireEvent.click(screen.getByRole('button', { name: 'このお店を登録する' }))

    expect(
      await screen.findByText('合い言葉は小文字の英数字とハイフンだけが使えます。'),
    ).toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()
  })

  it('合い言葉が短すぎれば送らない', async () => {
    const send = vi.fn()
    render(<StoreCreateForm send={send} onCreated={() => {}} />)

    fill('銀座店', 'g')
    fireEvent.click(screen.getByRole('button', { name: 'このお店を登録する' }))

    expect(await screen.findByText('合い言葉は 2 文字以上で入れてください。')).toBeInTheDocument()
    expect(send).not.toHaveBeenCalled()
  })

  it('合い言葉が使われていたら、別の言葉を選べるように伝える', async () => {
    const send = vi
      .fn()
      .mockResolvedValue(jsonResponse(409, { error: 'store_slug_taken', slug: 'ginza' }))
    render(<StoreCreateForm send={send} onCreated={() => {}} />)

    fill('銀座店', 'ginza')
    fireEvent.click(screen.getByRole('button', { name: 'このお店を登録する' }))

    expect(
      await screen.findByText('この合い言葉は使われています。別の合い言葉を入れてください。'),
    ).toBeInTheDocument()
  })

  it('管理者でなければ、誰に頼めばよいかまで伝える', async () => {
    const send = vi.fn().mockResolvedValue(jsonResponse(403, { error: 'forbidden' }))
    render(<StoreCreateForm send={send} onCreated={() => {}} />)

    fill('銀座店', 'ginza')
    fireEvent.click(screen.getByRole('button', { name: 'このお店を登録する' }))

    expect(
      await screen.findByText('お店の登録は会社の管理者だけが行えます。管理者にご依頼ください。'),
    ).toBeInTheDocument()
  })

  it('通信に失敗したら、やり直せると分かる文言を出す', async () => {
    const send = vi.fn().mockRejectedValue(new Error('offline'))
    render(<StoreCreateForm send={send} onCreated={() => {}} />)

    fill('銀座店', 'ginza')
    fireEvent.click(screen.getByRole('button', { name: 'このお店を登録する' }))

    expect(
      await screen.findByText('お店を登録できませんでした。もう一度お試しください。'),
    ).toBeInTheDocument()
  })

  it('送っている間は二度押しできない', async () => {
    let release: (value: Response) => void = () => {}
    const send = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve
      }),
    )
    render(<StoreCreateForm send={send} onCreated={() => {}} />)

    fill('銀座店', 'ginza')
    const button = screen.getByRole('button', { name: 'このお店を登録する' })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)

    expect(send).toHaveBeenCalledTimes(1)
    release(jsonResponse(201, CREATED))
  })

  it('合い言葉がそのまま URL になることを画面で伝える', () => {
    render(<StoreCreateForm send={vi.fn()} onCreated={() => {}} />)
    expect(screen.getByText(/お客様にお伝えするページの住所/)).toBeInTheDocument()
  })
})
