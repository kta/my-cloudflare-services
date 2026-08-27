import type { ReactNode } from 'react'

/*
 * 突き合わせ台に並ぶ画面。
 *
 * 1 画面 1 ファイルで、ファイル名がそのまま画面 ID になる
 * （`docs/frontend/reference/ref--<ID>.png` と同じ綴り）。ここに一覧を持たない
 * のは、画面を足すたびに同じファイルを奪い合わないようにするため。
 */
type ScreenModule = { default: () => ReactNode }

const MODULES = import.meta.glob<ScreenModule>('./*.screen.tsx', { eager: true })

export const SCREENS: Record<string, { render: () => ReactNode }> = Object.fromEntries(
  Object.entries(MODULES).map(([path, module]) => [
    path.replace('./', '').replace('.screen.tsx', ''),
    { render: module.default },
  ]),
)
