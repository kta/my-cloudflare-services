import { useCallback, useEffect, useRef, useState } from 'react'

/*
 * 自動で伏せる（UC-TERM-08 / AC-TERM-11、07-nfr.md §10.3）。
 *
 * **経過を数えるタイマーに頼らない。**iPadOS は裏に回ったタブの `setTimeout` を
 * 強く絞るので、数えているだけでは伏せられないまま表に戻ってしまう。
 * 「最後にさわった時刻」を持ち、`visibilitychange` で表に戻った瞬間に
 * `now − lastTouch` を比べて、超えていればその場で伏せる。
 *
 * さわったに数えるのは `pointerdown` / `keydown` / **`focusin`**（読み上げの移動）。
 * 境界は「ちょうどでは伏せず、+1 秒で伏せる」。
 */

export type AutoLock = {
  locked: boolean
  /** 「画面にさわって続ける」。伏せを解いて、最後にさわった時刻を今にする。 */
  unlock: () => void
}

export function useAutoLock({
  seconds,
  enabled,
  now = () => Date.now(),
}: {
  seconds: number
  enabled: boolean
  /** 時刻は引数で注入する（テストで `Date.now()` に依存しない）。 */
  now?: () => number
}): AutoLock {
  const [locked, setLocked] = useState(false)
  const lastTouch = useRef(now())
  const nowRef = useRef(now)
  nowRef.current = now

  const check = useCallback(() => {
    if (!enabled) return
    // 120 秒ちょうどでは伏せない。+1 秒で伏せる。
    if (nowRef.current() - lastTouch.current > seconds * 1000) setLocked(true)
  }, [enabled, seconds])

  useEffect(() => {
    if (!enabled) {
      setLocked(false)
      return
    }
    function touch() {
      lastTouch.current = nowRef.current()
    }
    document.addEventListener('pointerdown', touch, true)
    document.addEventListener('keydown', touch, true)
    document.addEventListener('focusin', touch, true)
    document.addEventListener('visibilitychange', check)
    const timer = setInterval(check, 1000)
    return () => {
      document.removeEventListener('pointerdown', touch, true)
      document.removeEventListener('keydown', touch, true)
      document.removeEventListener('focusin', touch, true)
      document.removeEventListener('visibilitychange', check)
      clearInterval(timer)
    }
  }, [enabled, check])

  const unlock = useCallback(() => {
    lastTouch.current = nowRef.current()
    setLocked(false)
  }, [])

  return { locked, unlock }
}
