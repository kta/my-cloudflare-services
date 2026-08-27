import type { ReactNode } from 'react'
import { SCREENS } from './screens/index'

/*
 * デザインの突き合わせ台。
 *
 * 承認済みモックは 1 枚 1 状態の静止画なので、API を通さずに固定の値で同じ
 * 状態を描き、Playwright でモックと 1 枚ずつ突き合わせる。ここに並ぶのは
 * 表示だけを持つ画面で、通信も権限判定も持たない（それらは業務側の関心事で、
 * 見た目が合っているかの判定を鈍らせる）。
 *
 *   /__gallery?screen=<画面ID>
 */

export function Gallery({ screen }: { screen: string | null }): ReactNode {
  if (screen === null) return <GalleryIndex />
  const entry = SCREENS[screen]
  if (!entry)
    return (
      <p className="p-8 font-sans text-body text-ink">
        {`画面 ${screen} はまだ作られていません。`}
      </p>
    )
  return entry.render()
}

function GalleryIndex() {
  return (
    <main className="mx-auto max-w-4xl p-8 font-sans text-ink">
      <h1 className="font-bold text-title">デザイン突き合わせ台</h1>
      <ul className="mt-4 grid gap-1">
        {Object.keys(SCREENS)
          .sort()
          .map((id) => (
            <li key={id}>
              <a className="text-pine underline" href={`/__gallery?screen=${id}`}>
                {id}
              </a>
            </li>
          ))}
      </ul>
    </main>
  )
}
