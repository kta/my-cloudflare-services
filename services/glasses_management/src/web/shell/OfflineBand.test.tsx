import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { OfflineBanner } from '../ledger/OfflineBanner'

/*
 * EX-OFFLINE.png（AC-TERM-17 / 07-nfr.md §5.2）。
 *
 * 台帳は読めるまま、**確定・変更・ご来店の受付だけ**を止める。打ちかけの入力は消さない。
 * 時刻は**引数で注入**する（`Date.now()` を読まない）。次の自動再試行は 60 秒後。
 *
 * 帯そのものは台帳がすでに持っている（`ledger/OfflineBanner`）ので、**もう 1 枚作らない**。
 * ここで固定するのは「帯が出ているあいだ、業務の面がどう振る舞うか」である。
 */

const SINCE = '2026-08-27T02:02:00.000Z' // JST 11:02
const NEXT = '2026-08-27T02:09:00.000Z' // 60 秒後（07-nfr.md §5.2）

function Harness({ onRetry }: { onRetry: () => Promise<boolean> }) {
  const [offline, setOffline] = useState(true)
  const [memo, setMemo] = useState('')
  return (
    <div>
      {offline && (
        <OfflineBanner
          lastServerNow={SINCE}
          nextRetryAt={NEXT}
          onRetry={() => {
            void onRetry().then((ok) => {
              if (ok) setOffline(false)
            })
          }}
        />
      )}
      <h1>予約台帳</h1>
      <p>11:00　田中 花子 様</p>
      <label htmlFor="memo">ご用件</label>
      <input id="memo" value={memo} onChange={(e) => setMemo(e.target.value)} />
      <button type="button" disabled={offline}>
        この内容で確定する
      </button>
      <button type="button" disabled={offline}>
        変更を保存する
      </button>
      <button type="button" disabled={offline}>
        ご来店を受け付ける
      </button>
      <button type="button">台帳をひらく</button>
    </div>
  )
}

function open(onRetry: () => Promise<boolean> = async () => true) {
  const user = userEvent.setup()
  render(<Harness onRetry={onRetry} />)
  return user
}

it('「通信が切れています」の帯といつ時点の内容かと次に自動で試す時刻が出る', () => {
  open()
  const band = screen.getByRole('status')
  expect(band).toHaveTextContent('通信が切れています')
  expect(band).toHaveTextContent('11:02 現在')
  expect(band).toHaveTextContent('11:09 に自動でも試します')
})

it('台帳は読めるまま、予約の確定・変更・ご来店の受付だけが押せなくなる', () => {
  open()
  expect(screen.getByText(/田中 花子 様/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '台帳をひらく' })).toBeEnabled()
  expect(screen.getByRole('button', { name: 'この内容で確定する' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '変更を保存する' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'ご来店を受け付ける' })).toBeDisabled()
})

it('打ちかけの入力は消えない', async () => {
  const user = open(async () => false)
  await user.type(screen.getByLabelText('ご用件'), 'レンズの相談')
  await user.click(screen.getByRole('button', { name: '再接続を試す' }))
  expect(screen.getByRole('status')).toHaveTextContent('通信が切れています')
  expect(screen.getByLabelText('ご用件')).toHaveValue('レンズの相談')
})

it('「再接続を試す」を押すと読み直し、成功したら帯が消える', async () => {
  const onRetry = vi.fn(async () => true)
  const user = open(onRetry)
  await user.type(screen.getByLabelText('ご用件'), 'レンズの相談')
  await user.click(screen.getByRole('button', { name: '再接続を試す' }))
  expect(onRetry).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'この内容で確定する' })).toBeEnabled()
  expect(screen.getByLabelText('ご用件')).toHaveValue('レンズの相談')
})
