import { useCallback, useEffect, useRef, useState } from 'react'

export type UseIdleOptions = {
  enabled: boolean
  idleAfterMs: number
  /** テストと端末時計のずれを分離するため、時刻は呼び出し側から受け取る。 */
  now: () => number
  /** 伏せている間は API の再読込・polling を止めるための外向き契約。 */
  onPollingEnabledChange?: (enabled: boolean) => void
  /** 明示した「続ける」の後に、必要な再読込を Shell 側で行うための callback。 */
  onResume?: () => void
}

export type IdleState = {
  isMasked: boolean
  pollingEnabled: boolean
  resume: () => void
}

/**
 * 共有端末の自動ロック。タイマーだけに任せず、非表示から戻った瞬間にも注入時計で
 * 期限を比較する。pointerdown / keydown / focusin はすべて「さわった」と扱う。
 */
export function useIdle({
  enabled,
  idleAfterMs,
  now,
  onPollingEnabledChange,
  onResume,
}: UseIdleOptions): IdleState {
  const [isMasked, setIsMasked] = useState(false)
  const maskedRef = useRef(false)
  const lastTouchedAt = useRef(now())
  const timerId = useRef<number | null>(null)
  const wasEnabled = useRef(enabled)

  const clearTimer = useCallback(() => {
    if (timerId.current !== null) {
      window.clearTimeout(timerId.current)
      timerId.current = null
    }
  }, [])

  const mask = useCallback(() => {
    if (maskedRef.current) {
      return
    }

    maskedRef.current = true
    setIsMasked(true)
    onPollingEnabledChange?.(false)
  }, [onPollingEnabledChange])

  const isExpired = useCallback(
    () => now() - lastTouchedAt.current > idleAfterMs,
    [idleAfterMs, now],
  )

  useEffect(() => {
    clearTimer()
    const becameEnabled = enabled && !wasEnabled.current
    wasEnabled.current = enabled

    if (!enabled) {
      maskedRef.current = false
      setIsMasked(false)
      lastTouchedAt.current = now()
      return undefined
    }

    // 業務開始前の PIN・置き場所選択にかかった時間は、共有端末の無操作時間へ
    // 持ち越さない。セッションが有効になった瞬間を新しい計測の起点にする。
    if (becameEnabled) {
      maskedRef.current = false
      setIsMasked(false)
      lastTouchedAt.current = now()
    }

    if (isMasked) {
      return undefined
    }

    const checkIdle = () => {
      if (isExpired()) {
        mask()
      }
    }
    const schedule = () => {
      clearTimer()
      const remaining = idleAfterMs - (now() - lastTouchedAt.current)
      timerId.current = window.setTimeout(checkIdle, Math.max(1, remaining + 1))
    }
    const touch = () => {
      lastTouchedAt.current = now()
      schedule()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkIdle()
      }
    }

    document.addEventListener('pointerdown', touch)
    document.addEventListener('keydown', touch)
    document.addEventListener('focusin', touch)
    document.addEventListener('visibilitychange', onVisibilityChange)
    schedule()

    return () => {
      clearTimer()
      document.removeEventListener('pointerdown', touch)
      document.removeEventListener('keydown', touch)
      document.removeEventListener('focusin', touch)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [clearTimer, enabled, idleAfterMs, isExpired, isMasked, mask, now])

  const resume = useCallback(() => {
    if (!maskedRef.current) {
      return
    }

    maskedRef.current = false
    lastTouchedAt.current = now()
    setIsMasked(false)
    onPollingEnabledChange?.(true)
    onResume?.()
  }, [now, onPollingEnabledChange, onResume])

  return { isMasked, pollingEnabled: enabled && !isMasked, resume }
}
