import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useCallback, useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmAction, ConfirmStep } from './ConfirmStep'
import { DoneStep } from './DoneStep'

/*
 * 工程 5 ご確認（承認済みモック docs/frontend/mockups/eye/images/BOOK-05-CONFIRM.png）。
 *
 * この面の仕事は「声に出す文をそのまま大きく置き、言い直しがあった箇所だけへ戻す」こと。
 *
 * 実測値（screens/BOOK-05-CONFIRM.html と assets/eye.css）:
 *   本文 1fr ／ 右の柱 372px。復唱の箱は内側 30px 32px・上に 24px、文 24px / 行間 2。
 *   戻り口は 4 列・間 12px・文字 15px。確定は `.btn.primary.big`（最小高 56px）。
 *   録音は右下 20/20 の白カード（2px の `--color-danger` 罫）に移る。
 *
 * 復唱の目的は `visit_purposes.name_internal` をそのまま読む（台帳の帯だけが `name_short`）。
 * モックの「視力測定とメガネの新調」は工程 2 の札と違うので採らない（AC-BOOK-13）。
 */

const NOW = '2026-08-27T02:11:00.000Z' // 11:11 JST
const STARTS_AT = '2026-08-27T02:00:00.000Z' // 11:00 JST
const ENDS_AT = '2026-08-27T03:00:00.000Z' // 12:00 JST
const HOLD_UNTIL = '2026-08-27T02:18:00.000Z' // 11:18 JST（420 秒）

/**
 * 受付の器。**確定のボタンは面ではなく帯の右端にある**（承認済みモック
 * BOOK-05-CONFIRM の `.btn.primary.big`）ので、器がどう配線すればよいかをここで固定する。
 */
function open(
  props: Partial<Parameters<typeof ConfirmStep>[0]> = {},
  action: Partial<Parameters<typeof ConfirmAction>[0]> = {},
) {
  return render(
    <>
      <ConfirmStep
        storeName="EYE 銀座店"
        startsAt={STARTS_AT}
        endsAt={ENDS_AT}
        durationMinutes={60}
        purposeNames={['メガネを新しく作る']}
        customerName="田中 花子"
        phoneDigits="09012345678"
        staffName="佐藤 美咲"
        staffSkills="視力測定・加工"
        equipmentNames={['視力測定機 A', '相談カウンター 2']}
        holdExpiresAt={HOLD_UNTIL}
        now={NOW}
        onJumpTo={() => {}}
        onKeepEditing={() => {}}
        {...props}
      />
      <footer>
        <ConfirmAction isOffline={props.isOffline} onConfirm={() => {}} {...action} />
      </footer>
    </>,
  )
}

function recitation(): HTMLElement {
  return screen.getByRole('region', { name: '復唱する文' })
}

describe('復唱', () => {
  it('文に工程 1 の日付と時刻・工程 2 の所要・工程 4 の名前と番号が入る', () => {
    open()
    const said = recitation().textContent ?? ''
    expect(said).toContain('8月27日、木曜日の午前11時')
    expect(said).toContain('EYE 銀座店')
    expect(said).toContain('所要時間は約60分です。')
    expect(said).toContain('田中 花子様')
    expect(said).toContain('お電話番号は090-1234-5678で')
    expect(said).toContain('お間違いないでしょうか？')
  })

  it('目的は工程 2 で押した札と同じ店内の名前で読み上げられる', () => {
    open()
    expect(recitation().textContent ?? '').toContain('メガネを新しく作るのご相談を承りました。')
    // 台帳の帯だけが短い名前を使う。復唱でモックの言い換えは採らない。
    expect(screen.queryByText(/視力測定とメガネの新調/)).not.toBeInTheDocument()
  })

  it('目的を 2 つ選ぶと「と」でつないで読み上げる', () => {
    open({ purposeNames: ['メガネを新しく作る', '視力測定だけ'] })
    expect(recitation().textContent ?? '').toContain(
      'メガネを新しく作ると視力測定だけのご相談を承りました。',
    )
  })

  it('4 つの戻り口から工程 1・2・3・4 へ戻れる', async () => {
    const onJumpTo = vi.fn()
    open({ onJumpTo })
    const back = screen.getByRole('group', { name: '言い直しがあった箇所だけ直せます' })
    const labels = within(back)
      .getAllByRole('button')
      .map((node) => node.textContent)
    expect(labels).toEqual(['日にちと時刻', 'ご来店の目的', '担当と場所', 'お名前と番号'])
    for (const label of labels) {
      await userEvent.click(within(back).getByRole('button', { name: label ?? '' }))
    }
    expect(onJumpTo.mock.calls.map(([step]) => step)).toEqual([1, 2, 3, 4])
  })

  it('仮の押さえの残り時間が出て、残り 60 秒で「まだ入力中です」の警告が出る', async () => {
    const onKeepEditing = vi.fn()
    const { rerender } = open({ onKeepEditing })
    const summary = screen.getByRole('complementary', { name: '確保する内容' })
    expect(within(summary).getByText('11:18 まで')).toBeVisible()
    expect(within(summary).getByText('あと7分')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'まだ入力中です' })).not.toBeInTheDocument()

    function at(now: string) {
      return (
        <ConfirmStep
          storeName="EYE 銀座店"
          startsAt={STARTS_AT}
          endsAt={ENDS_AT}
          durationMinutes={60}
          purposeNames={['メガネを新しく作る']}
          customerName="田中 花子"
          phoneDigits="09012345678"
          staffName="佐藤 美咲"
          equipmentNames={['視力測定機 A']}
          holdExpiresAt={HOLD_UNTIL}
          now={now}
          onJumpTo={() => {}}
          onKeepEditing={onKeepEditing}
        />
      )
    }
    // 残り 61 秒ではまだ出さない。
    rerender(at('2026-08-27T02:16:59.000Z'))
    expect(screen.queryByRole('button', { name: 'まだ入力中です' })).not.toBeInTheDocument()
    // 残り 60 秒ちょうどで出す。
    rerender(at('2026-08-27T02:17:00.000Z'))
    const warning = screen.getByRole('status')
    expect(warning).toHaveTextContent('この枠をあと1分お預かりしています')
    const keep = screen.getByRole('button', { name: 'まだ入力中です' })
    expect(keep.className).toContain('min-h-11')
    await userEvent.click(keep)
    expect(onKeepEditing).toHaveBeenCalledTimes(1)
  })
})

/**
 * 受付の器。確定は 1 回だけ効かせたいので、`Idempotency-Key` は工程 1 を始めた時点で
 * 作って成功するまで同じ値を送る。器がどう配線すればよいかをここで固定する。
 */
function Booking({ onCall = () => {} }: { onCall?: (key: string) => void }) {
  const issued = useRef(new Map<string, string>())
  const key = useRef('idem-0001')
  const [confirming, setConfirming] = useState(false)
  const [code, setCode] = useState<string | null>(null)

  const confirm = useCallback(async () => {
    setConfirming(true)
    onCall(key.current)
    const already = issued.current.get(key.current)
    const next = already ?? 'EY-2608-0142'
    issued.current.set(key.current, next)
    await Promise.resolve()
    setCode(next)
    setConfirming(false)
  }, [onCall])

  if (code !== null) {
    return (
      <DoneStep
        reservation={{
          code,
          startsAt: STARTS_AT,
          endsAt: ENDS_AT,
          durationMinutes: 60,
          purposeLabel: 'メガネを新しく作る',
          customerName: '田中 花子',
          phoneDigits: '09012345678',
          staffName: '佐藤 美咲',
          equipmentNames: ['相談カウンター 2'],
        }}
        onBookAgain={() => {}}
        onOpenLedger={() => {}}
      />
    )
  }
  return (
    <>
      <ConfirmStep
        storeName="EYE 銀座店"
        startsAt={STARTS_AT}
        endsAt={ENDS_AT}
        durationMinutes={60}
        purposeNames={['メガネを新しく作る']}
        customerName="田中 花子"
        phoneDigits="09012345678"
        staffName="佐藤 美咲"
        equipmentNames={['視力測定機 A']}
        holdExpiresAt={HOLD_UNTIL}
        now={NOW}
        onJumpTo={() => {}}
        onKeepEditing={() => {}}
      />
      <footer>
        <ConfirmAction confirming={confirming} onConfirm={confirm} />
      </footer>
    </>
  )
}

describe('確定', () => {
  it('「復唱を終えて予約を確定する」を押すと完了画面へ移る', async () => {
    render(<Booking />)
    await userEvent.click(screen.getByRole('button', { name: '復唱を終えて予約を確定する' }))
    expect(await screen.findByRole('heading', { name: 'ご予約を承りました' })).toBeVisible()
    expect(screen.getByText('EY-2608-0142')).toBeVisible()
  })

  it('続けてもう一度押しても予約は 1 件で、同じ予約番号が返る', async () => {
    const onCall = vi.fn()
    const onConfirm = vi.fn()
    render(<ConfirmAction confirming onConfirm={onConfirm} />)
    // 確定している間の 2 度目・3 度目の押下は届かせない（同じ鍵で 2 本目を投げない）。
    const button = screen.getByRole('button', { name: '確定しています…' })
    await userEvent.click(button)
    await userEvent.click(button)
    expect(onConfirm).not.toHaveBeenCalled()

    render(<Booking onCall={onCall} />)
    const first = screen.getByRole('button', { name: '復唱を終えて予約を確定する' })
    await userEvent.click(first)
    expect(onCall).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('EY-2608-0142')).toBeVisible()
  })

  it('確定している間はボタンを disabled にせず aria-busy にしてフォーカスを保つ', () => {
    open({}, { confirming: true })
    const button = screen.getByRole('button', { name: '確定しています…' })
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })
})

describe('工程 5 の状態', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('お預かりの取り直しを使い切ったら、押せないボタンではなく 1 文に替える', () => {
    open({ now: '2026-08-27T02:17:00.000Z', renewalsUsed: 10 })
    expect(screen.queryByRole('button', { name: 'まだ入力中です' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(
      'お預かりの上限です。枠を選び直してください。',
    )
  })

  it('読み込み中・通信断・うまく処理できなかったときを持つ', () => {
    const { rerender } = open({ phase: 'loading' })
    expect(screen.getByRole('status')).toHaveTextContent('読み込んでいます')

    rerender(
      <>
        <ConfirmStep
          storeName="EYE 銀座店"
          startsAt={STARTS_AT}
          endsAt={ENDS_AT}
          durationMinutes={60}
          purposeNames={['メガネを新しく作る']}
          customerName="田中 花子"
          phoneDigits=""
          staffName={null}
          equipmentNames={[]}
          holdExpiresAt={null}
          now={NOW}
          isOffline
          onJumpTo={() => {}}
          onKeepEditing={() => {}}
        />
        <footer>
          <ConfirmAction isOffline onConfirm={() => {}} />
        </footer>
      </>,
    )
    expect(screen.getByRole('button', { name: /復唱を終えて予約を確定する/ })).toBeDisabled()
    // お電話番号を伺えなかったときは、その節ごと落とす（空欄を読み上げさせない）。
    expect(recitation().textContent ?? '').toContain('田中 花子様、お間違いないでしょうか？')
    expect(screen.getByRole('complementary', { name: '確保する内容' }).textContent ?? '').toContain(
      '担当はあとで決める',
    )
  })
})

describe('確保する内容の札', () => {
  function summary(): HTMLElement {
    return screen.getByRole('complementary', { name: '確保する内容' })
  }

  it('担当と設備の数だけ数える（「1つとも空いています」と言わない）', () => {
    // 担当 1 ＋ 設備 2 = 3。
    const view = open()
    expect(within(summary()).getByText('3つとも空いています')).toBeVisible()
    view.unmount()

    // 設備を決めていない受付は 1 つしか押さえていない。「〜とも」は 2 つ以上の言い方である。
    open({ equipmentNames: [] })
    expect(within(summary()).getByText('この枠は空いています')).toBeVisible()
  })

  it('担当も設備も決めていない受付でも、数の合わない文にしない', () => {
    open({ staffName: null, equipmentNames: [] })
    expect(within(summary()).getByText('この枠は空いています')).toBeVisible()
  })
})

describe('仮の押さえの残り時間', () => {
  function noteOf(now: string, expiresAt = HOLD_UNTIL): string {
    const view = open({ now, holdExpiresAt: expiresAt })
    const text =
      within(screen.getByRole('complementary', { name: '確保する内容' })).getByText(/^あと/)
        .textContent ?? ''
    view.unmount()
    return text
  }

  it('分だけに丸めず、秒まで数える', () => {
    // 残り 6 分 30 秒（11:11:30）。
    expect(noteOf('2026-08-27T02:11:30.000Z')).toBe('あと6分30秒')
    // 残り 45 秒（11:17:15）。
    expect(noteOf('2026-08-27T02:17:15.000Z')).toBe('あと45秒')
  })

  it('端末の時計がサーバとずれていても、420 秒より長い残り時間を出さない', () => {
    // 端末の時計が 4 日ぶん遅れている。素直に引くと「あと5290分」になる。
    expect(noteOf('2026-08-23T02:11:00.000Z')).toBe('あと7分')
  })
})
