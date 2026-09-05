import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DeviceMode } from './DeviceMode'

describe('端末の使い方', () => {
  it('個人と共有の違いと、あとから変更できることを読める', () => {
    render(<DeviceMode deviceLabel="EYE-iPad-07" onPersonal={vi.fn()} onShared={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'この iPad の使い方を決めてください' })).toBeTruthy()
    expect(screen.getByText('はじめの1回だけの設定です。')).toBeTruthy()
    expect(screen.getAllByText('記録される名前')).toHaveLength(2)
    expect(screen.getAllByText('お客様の情報')).toHaveLength(2)
    expect(screen.getAllByText('暗証番号')).toHaveLength(2)
    expect(screen.getByText(/設定 › 端末/)).toHaveTextContent('EYE-iPad-07')
  })

  it('2つの使い方へ進める', () => {
    const onPersonal = vi.fn()
    const onShared = vi.fn()
    render(<DeviceMode deviceLabel="EYE-iPad-07" onPersonal={onPersonal} onShared={onShared} />)
    fireEvent.click(screen.getByRole('button', { name: '個人の端末にする' }))
    fireEvent.click(screen.getByRole('button', { name: 'みんなで使う端末にする' }))
    expect(onPersonal).toHaveBeenCalledOnce()
    expect(onShared).toHaveBeenCalledOnce()
  })

  it('ヘルプを開くと、端末の使い方を選び直せる場所を案内する', () => {
    render(<DeviceMode deviceLabel="EYE-iPad-07" onPersonal={vi.fn()} onShared={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'ヘルプ' }))

    expect(screen.getByRole('dialog', { name: '端末の使い方について' })).toHaveTextContent(
      'あとから「設定 › 端末」で変更できます。',
    )
  })

  it('375pxでも選択肢を縦に並べて横へあふれさせない', () => {
    render(<DeviceMode deviceLabel="EYE-iPad-07" onPersonal={vi.fn()} onShared={vi.fn()} />)

    expect(screen.getByTestId('device-mode-options')).toHaveClass('grid-cols-1')
  })
})
