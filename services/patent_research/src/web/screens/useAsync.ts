import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api'

/*
 * 画面の読み込み。3 つの状態（読み込み中 / 失敗 / 中身）を必ず区別する。
 *
 * `null` を「空」と「まだ読んでいない」の両方に使わないのが肝心である。混ぜると
 * 「該当なし」と「まだ見ていない」が画面上で同じ見え方になり、この製品では
 * それが調査の結論を誤らせる。
 */

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: { code: string; detail: string | null } | null
  reload: () => void
}

export function useAsync<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
  onSignOut: () => void,
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<{ code: string; detail: string | null } | null>(null)
  const [nonce, setNonce] = useState(0)

  // 依存は呼び出し側が渡す（案件 id など）。load 自体は毎回新しい関数なので、
  // deps だけを見て再実行を決める。
  const run = useCallback(load, deps)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    run()
      .then((value) => {
        if (alive) setData(value)
      })
      .catch((err: unknown) => {
        if (!alive) return
        // access token は短命で、このサービスに refresh は無い。401 に「もう一度」を
        // 出しても永久に成功しないので、素直にサインアウトする。
        if (err instanceof ApiError && err.status === 401) {
          onSignOut()
          return
        }
        setError(
          err instanceof ApiError
            ? { code: err.code, detail: err.detail }
            : { code: 'network_error', detail: null },
        )
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [run, nonce, onSignOut])

  return { data, loading, error, reload: () => setNonce((n) => n + 1) }
}
