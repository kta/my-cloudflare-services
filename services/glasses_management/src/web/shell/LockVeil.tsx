import { focusRing } from '@app/ui'
import { useEffect, useRef } from 'react'

/*
 * HOME-SHARED-LOCKED.png。離席した共有の iPad を覆う 1 枚（UC-TERM-08）。
 *
 * 画面の計画（DESIGN_RULE パス 1）
 *   主役は 1 画面に 1 つ ——「さわると元に戻る」こと。覆いは新しい色を作らず
 *   `--color-paper` を薄く敷くだけで、白い箱と 3px の松葉色だけが立つ。
 *   **サイドバーごと覆う**（さわるまでどこへも進めないことを形で示す）。
 *
 * **伏せるのは画面だけ**で、セッションは終わらせない（打ちかけの入力は残る）。
 * **Esc では閉じない** —— 閉じる手は「画面にさわって続ける」と「業務を終える」の 2 つ。
 */

export function LockVeil({ onContinue, onQuit }: { onContinue: () => void; onQuit: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <div className="absolute inset-0 z-40">
      <div aria-hidden="true" className="absolute inset-0 bg-paper/85" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lock-veil-title"
        className="absolute inset-0 grid place-items-center"
      >
        <div className="w-140 rounded-panel border-3 border-pine bg-surface px-10 pt-9 pb-8.5">
          <h2
            id="lock-veil-title"
            ref={heading}
            tabIndex={-1}
            className="text-title font-bold text-ink outline-none"
          >
            お客様の情報を隠しています
          </h2>
          <p className="mt-2.5 text-body text-ink-muted">
            2分間さわらなかったので伏せました。さわると元に戻ります。
          </p>
          <div className="mt-7.5 flex gap-4">
            <button
              type="button"
              onClick={onContinue}
              className={`min-h-14 flex-1 rounded-card bg-pine px-6 text-lead font-bold text-on-pine ${focusRing}`}
            >
              画面にさわって続ける
            </button>
            <button
              type="button"
              onClick={onQuit}
              className={`min-h-14 rounded-card border border-line-strong bg-surface px-6 text-lead font-semibold text-ink ${focusRing}`}
            >
              業務を終える
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
