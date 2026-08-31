import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DeviceMode } from './DeviceMode'

/*
 * 承認済みモック docs/frontend/mockups/eyex/images/START-DEVICE-MODE.png の面。
 * 見た目の寸法は e2e の突き合わせで見るので、ここでは
 * 「何が読めて、何が押せるか」を見る（UC-TERM-01 / AC-TERM-01）。
 */

function open(onChoose = vi.fn()) {
  render(<DeviceMode storeName="EYEX 銀座店" deviceLabel="EYEX-iPad-07" onChoose={onChoose} />)
  return onChoose
}

describe('端末の使い方', () => {
  it('「この iPad の使い方を決めてください」と「はじめの1回だけの設定です。」が出る', () => {
    open()
    expect(
      screen.getByRole('heading', { name: 'この iPad の使い方を決めてください' }),
    ).toBeInTheDocument()
    expect(screen.getByText('はじめの1回だけの設定です。')).toBeInTheDocument()
  })

  it('個人と共有の 2 枚に「記録される名前」「お客様の情報」「暗証番号」の 3 行が並ぶ', () => {
    open()
    const personal = screen.getByRole('region', { name: '個人の端末として使う' })
    const shared = screen.getByRole('region', { name: 'みんなで使う端末として置く' })
    for (const card of [personal, shared]) {
      for (const label of ['記録される名前', 'お客様の情報', '暗証番号']) {
        expect(within(card).getByText(label)).toBeInTheDocument()
      }
    }
    expect(within(personal).getByText('選んだスタッフご本人の名前')).toBeInTheDocument()
    expect(within(personal).getByText('そのまま表示したまま')).toBeInTheDocument()
    expect(within(shared).getByText('2分間さわらないと自動で隠す')).toBeInTheDocument()
    expect(within(shared).getByText('店舗で共通の4〜6桁')).toBeInTheDocument()
  })

  it('下に「あとから「設定 › 端末」で変更できます。」と端末の名前が出る', () => {
    open()
    expect(
      screen.getByText(/あとから「設定 › 端末」で変更できます。\s*端末の名前：EYEX-iPad-07/),
    ).toBeInTheDocument()
  })

  it('「個人の端末にする」でスタッフを選ぶ画面へ進む', async () => {
    const onChoose = open()
    await userEvent.click(screen.getByRole('button', { name: '個人の端末にする' }))
    expect(onChoose).toHaveBeenCalledWith('personal')
  })

  it('「みんなで使う端末にする」で置き場所を選ぶ画面へ進む', async () => {
    const onChoose = open()
    await userEvent.click(screen.getByRole('button', { name: 'みんなで使う端末にする' }))
    expect(onChoose).toHaveBeenCalledWith('shared')
  })

  it('ヘルプはこの面に重ねる 1 枚のシートで、別の画面を起こさない', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: 'ヘルプ' }))
    expect(screen.getByRole('dialog', { name: /ヘルプ/ })).toBeInTheDocument()
    // 重ねているだけなので、下の面の主役は読めたまま。
    expect(
      screen.getByRole('heading', { name: 'この iPad の使い方を決めてください' }),
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
