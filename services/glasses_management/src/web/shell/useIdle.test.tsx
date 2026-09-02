import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useIdle } from './useIdle'

type Clock = { now: () => number; advance: (milliseconds: number) => void }

function createClock(start = 0): Clock {
  let value = start
  return {
    now: () => value,
    advance: (milliseconds) => {
      value += milliseconds
    },
  }
}

function IdleProbe({
  clock,
  enabled = true,
  onPollingEnabledChange = () => {},
  onResume = () => {},
}: {
  clock: Clock
  enabled?: boolean
  onPollingEnabledChange?: (enabled: boolean) => void
  onResume?: () => void
}) {
  const idle = useIdle({
    enabled,
    idleAfterMs: 2 * 60 * 1000,
    now: clock.now,
    onPollingEnabledChange,
    onResume,
  })

  return (
    <div>
      <output aria-label="伏せ中">{String(idle.isMasked)}</output>
      <output aria-label="APIを読み続ける">{String(idle.pollingEnabled)}</output>
      <button type="button" onClick={idle.resume}>
        画面にさわって続ける
      </button>
    </div>
  )
}

function setVisibility(value: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('useIdle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('注入した時刻で2分の無操作後に伏せ、API polling を止める', () => {
    vi.useFakeTimers()
    const clock = createClock()
    const onPollingEnabledChange = vi.fn()
    render(<IdleProbe clock={clock} onPollingEnabledChange={onPollingEnabledChange} />)

    act(() => {
      clock.advance(2 * 60 * 1000 + 1)
      vi.advanceTimersByTime(2 * 60 * 1000 + 1)
    })

    expect(screen.getByLabelText('伏せ中')).toHaveTextContent('true')
    expect(screen.getByLabelText('APIを読み続ける')).toHaveTextContent('false')
    expect(onPollingEnabledChange).toHaveBeenLastCalledWith(false)
  })

  it('2分ちょうどでは伏せず、1ミリ秒後に伏せる', () => {
    vi.useFakeTimers()
    const clock = createClock()
    render(<IdleProbe clock={clock} />)

    act(() => {
      clock.advance(2 * 60 * 1000)
      vi.advanceTimersByTime(2 * 60 * 1000)
    })
    expect(screen.getByLabelText('伏せ中')).toHaveTextContent('false')

    act(() => {
      clock.advance(1)
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByLabelText('伏せ中')).toHaveTextContent('true')
  })

  it('無効な画面で時間が過ぎても、有効になった瞬間から2分を測り直す', () => {
    vi.useFakeTimers()
    const clock = createClock()
    const view = render(<IdleProbe clock={clock} enabled={false} />)

    act(() => {
      clock.advance(10 * 60 * 1000)
      vi.advanceTimersByTime(10 * 60 * 1000)
    })
    view.rerender(<IdleProbe clock={clock} enabled />)
    act(() => vi.advanceTimersByTime(1))

    expect(screen.getByLabelText('伏せ中')).toHaveTextContent('false')

    act(() => {
      clock.advance(2 * 60 * 1000 + 1)
      vi.advanceTimersByTime(2 * 60 * 1000 + 1)
    })
    expect(screen.getByLabelText('伏せ中')).toHaveTextContent('true')
  })

  it('focusin を操作として扱い、非表示から戻った時にも注入時計で期限を判定する', () => {
    vi.useFakeTimers()
    const clock = createClock()
    render(<IdleProbe clock={clock} />)

    act(() => {
      clock.advance(119 * 1000)
      document.dispatchEvent(new FocusEvent('focusin'))
      setVisibility('hidden')
      clock.advance(2 * 60 * 1000 + 1)
      setVisibility('visible')
    })

    expect(screen.getByLabelText('伏せ中')).toHaveTextContent('true')
  })

  it('続ける操作で伏せと polling を戻し、再開 callback を一度だけ渡す', () => {
    vi.useFakeTimers()
    const clock = createClock()
    const onPollingEnabledChange = vi.fn()
    const onResume = vi.fn()
    render(
      <IdleProbe
        clock={clock}
        onPollingEnabledChange={onPollingEnabledChange}
        onResume={onResume}
      />,
    )

    act(() => {
      clock.advance(2 * 60 * 1000 + 1)
      vi.advanceTimersByTime(2 * 60 * 1000 + 1)
    })
    act(() => screen.getByRole('button', { name: '画面にさわって続ける' }).click())

    expect(screen.getByLabelText('伏せ中')).toHaveTextContent('false')
    expect(screen.getByLabelText('APIを読み続ける')).toHaveTextContent('true')
    expect(onPollingEnabledChange).toHaveBeenLastCalledWith(true)
    expect(onResume).toHaveBeenCalledTimes(1)
  })

  it('同じイベント周期の続ける操作を重ねても、再読込を二重に依頼しない', () => {
    vi.useFakeTimers()
    const clock = createClock()
    const onResume = vi.fn()
    render(<IdleProbe clock={clock} onResume={onResume} />)

    act(() => {
      clock.advance(2 * 60 * 1000 + 1)
      vi.advanceTimersByTime(2 * 60 * 1000 + 1)
    })
    const continueButton = screen.getByRole('button', { name: '画面にさわって続ける' })
    act(() => {
      continueButton.click()
      continueButton.click()
    })

    expect(onResume).toHaveBeenCalledTimes(1)
  })
})
