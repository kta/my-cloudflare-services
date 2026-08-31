import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useState } from 'react'
import { expect, it } from 'vitest'
import { AppShell } from './AppShell'
import { LockVeil } from './LockVeil'
import { maskName, maskPhone } from './mask'
import { useAutoLock } from './useIdle'

/*
 * HOME-SHARED-LOCKED.png（UC-TERM-08 / AC-TERM-11 / AC-TERM-12）。
 *
 * 伏せるのは**お客様のお名前と電話番号だけ**で、セッションごと終わらせない。
 * 時刻は**引数で注入**する（`Date.now()` に依存しない）。裏に回った iPadOS は
 * `setTimeout` を絞るので、**経過を数えず「最後にさわった時刻との差」で判定する**。
 */

const AUTO_LOCK_SECONDS = 120
const T0 = Date.parse('2026-08-27T02:00:00.000Z')

let clock = T0
let loads = 0

/** 表に戻った・時間が過ぎたことを、時計を進めてから端末に知らせる。 */
async function pass(seconds: number) {
  clock = T0 + seconds * 1000
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

function Workbench({ mode = 'shared' as 'shared' | 'personal' }) {
  const { locked, unlock } = useAutoLock({
    seconds: AUTO_LOCK_SECONDS,
    enabled: mode === 'shared',
    now: () => clock,
  })
  const [rows, setRows] = useState<{ time: string; name: string; phone: string }[]>([])

  useEffect(() => {
    // 伏せている間は読み直さない。表に戻ったときに読み直す。
    if (locked) return
    loads += 1
    setRows([
      { time: '11:00', name: '田中 花子', phone: '090-1234-5678' },
      { time: '13:00', name: '相川 みどり', phone: '080-1111-2222' },
    ])
  }, [locked])

  return (
    <AppShell
      storeName="EYEX 銀座店"
      storeSubline="銀座店 レジ横iPad（みんなで使う端末）"
      current="home"
      onNavigate={() => undefined}
      rail={false}
      onToggleRail={() => undefined}
      terminalNote={['銀座店 レジ横iPad', '共有で使っています']}
      {...(locked
        ? { barTag: { text: 'お客様の情報を隠しています', tone: 'danger' as const } }
        : {})}
      veil={locked ? <LockVeil onContinue={unlock} onQuit={() => undefined} /> : null}
    >
      <p>本日のご予約　12件</p>
      <ul>
        {rows.map((row) => (
          <li key={row.time}>
            <span>{row.time}</span>
            <span>{`${locked ? maskName(row.name) : row.name} 様`}</span>
            <span>{locked ? maskPhone(row.phone) : row.phone}</span>
          </li>
        ))}
      </ul>
      <label htmlFor="memo">メモ</label>
      <input id="memo" />
    </AppShell>
  )
}

function open(mode: 'shared' | 'personal' = 'shared') {
  clock = T0
  loads = 0
  const user = userEvent.setup()
  render(<Workbench mode={mode} />)
  return user
}

function veil() {
  return screen.queryByRole('dialog', { name: 'お客様の情報を隠しています' })
}

it('120 秒ちょうどでは伏せない', async () => {
  open()
  await pass(120)
  expect(veil()).not.toBeInTheDocument()
  expect(screen.getByText('田中 花子 様')).toBeInTheDocument()
})

it('120 秒 +1 秒で画面全体が覆われ、サイドバーも覆われる', async () => {
  open()
  await pass(121)
  const cover = veil()
  expect(cover).toBeInTheDocument()
  // サイドバーごと覆う（さわるまでどこへも進めないことを形で示す）。
  const root = screen.getByRole('navigation', { name: '画面の切り替え' }).closest('[data-shell]')
  expect(root).not.toBeNull()
  expect(root?.contains(cover as Node)).toBe(true)
})

it('伏せるのはお名前と電話番号だけで、時刻・件数・端末名は読めたまま', async () => {
  open()
  await pass(121)
  expect(screen.queryByText('田中 花子 様')).not.toBeInTheDocument()
  expect(screen.queryByText('090-1234-5678')).not.toBeInTheDocument()
  expect(screen.getAllByText('●●●● 様')).toHaveLength(2)
  expect(screen.getByText('090-●●●●-●●●●')).toBeInTheDocument()
  expect(screen.getByText('11:00')).toBeInTheDocument()
  expect(screen.getByText(/本日のご予約/)).toBeInTheDocument()
  expect(screen.getByText('銀座店 レジ横iPad')).toBeInTheDocument()
})

it('「2分間さわらなかったので伏せました。さわると元に戻ります。」が出る', async () => {
  open()
  await pass(121)
  expect(
    screen.getByText('2分間さわらなかったので伏せました。さわると元に戻ります。'),
  ).toBeInTheDocument()
})

it('「画面にさわって続ける」で元に戻り、そのとき最新を読み直す', async () => {
  const user = open()
  await pass(121)
  expect(loads).toBe(1)
  await user.click(screen.getByRole('button', { name: '画面にさわって続ける' }))
  expect(veil()).not.toBeInTheDocument()
  expect(screen.getByText('田中 花子 様')).toBeInTheDocument()
  expect(loads).toBe(2)
})

it('伏せている間は API を 1 回も叩かない', async () => {
  open()
  const before = loads
  await pass(121)
  await pass(300)
  expect(loads).toBe(before)
})

it('裏に回ったまま 120 秒 +1 秒が過ぎて表に戻ると、戻った時点ですでに伏せられている', async () => {
  open()
  // 裏に回っている間はタイマーが絞られる。戻った瞬間の差で判定する。
  await pass(600)
  expect(veil()).toBeInTheDocument()
})

it('読み上げのフォーカス移動も「さわった」に数える', async () => {
  open()
  clock = T0 + 119_000
  await act(async () => {
    screen.getByLabelText('メモ').dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
  })
  await pass(200)
  expect(veil()).not.toBeInTheDocument()
})

it('個人の端末では伏せない', async () => {
  open('personal')
  await pass(600)
  expect(veil()).not.toBeInTheDocument()
})

it('覆いは role="dialog" と aria-modal="true" を持ち、Esc では閉じない（さわって続ける）', async () => {
  const user = open()
  await pass(121)
  expect(veil()).toHaveAttribute('aria-modal', 'true')
  await user.keyboard('{Escape}')
  expect(veil()).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '画面にさわって続ける' }))
  expect(veil()).not.toBeInTheDocument()
})
