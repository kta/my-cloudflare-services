import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { OfflineBand } from './OfflineBand'

describe('OfflineBand', () => {
  it('最後に読めた時刻を注入値のまま表示し、割り込み読み上げにしない', () => {
    render(<OfflineBand lastSyncedLabel="11:02" nextRetryLabel="11:09" onRetry={() => {}} />)

    const band = screen.getByRole('status')
    expect(band).toHaveAttribute('aria-live', 'polite')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(band).toHaveTextContent('いまご覧の内容は 11:02 現在 のものです。')
    expect(band).toHaveTextContent('11:09 に自動でも試します')
    expect(band).toHaveTextContent('予約の確定・変更・ご来店の受付は、つながってからになります。')
  })

  it('再接続中は二度押しを止め、時刻不明なら端末時計を作らない', async () => {
    const onRetry = vi.fn()
    const { rerender } = render(<OfflineBand lastSyncedLabel={null} onRetry={onRetry} />)
    expect(screen.queryByText('現在', { exact: false })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '再接続を試す' }))
    expect(onRetry).toHaveBeenCalledTimes(1)

    rerender(<OfflineBand lastSyncedLabel={null} onRetry={onRetry} isRetrying />)
    const button = screen.getByRole('button', { name: 'つなぎ直しています…' })
    expect(button).toBeDisabled()
    await userEvent.click(button)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
