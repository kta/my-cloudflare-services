import { cn } from '@app/ui'
import type { ReactNode } from 'react'

/*
 * 権限表の骨格。寸法は `surfaces.tsx` の `Matrix` と同じ
 * （`operations-approved.html` の `.matrix`）だが、こちらはセルに操作を置ける。
 *
 *   .matrix{width:100%;border-collapse:collapse;margin-top:16px;background:#fff}
 *   .matrix th,.matrix td{border:1px solid var(--l);padding:10px;text-align:center}
 *   .matrix th:first-child,.matrix td:first-child{text-align:left}
 *   .toggle{font-weight:700;color:var(--g)}
 *
 * 列幅は指定が無く中身で決まる。決め打ちすると文言を変えたときにモックからずれる。
 * 読み取り専用の面は `Matrix` を使うこと。ここは「表の中で値を変えさせる」面
 * だけのための下位語彙で、`<table>` と `scope` の意味は同じように持つ。
 */

const CELL = 'border border-line p-2.5'

export function MatrixTable({
  label,
  columns,
  children,
  className,
}: {
  label: string
  /** 1 列目はロール名の見出し。 */
  columns: string[]
  children: ReactNode
  /**
   * 表の最小幅。セルに操作を置く面では、列が増えると選択が
   * 「店舗管理者以.」まで潰れる。表は縮めず、外の枠が横スクロールで逃がす。
   */
  className?: string
}) {
  return (
    <table
      aria-label={label}
      className={cn('mt-4 w-full border-collapse bg-surface font-sans text-body', className)}
    >
      <thead>
        <tr>
          {columns.map((column, index) => (
            <th
              key={column}
              scope="col"
              className={cn(CELL, 'font-bold', index === 0 ? 'text-left' : 'text-center')}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}

/** 1 行。行の名前は `<th scope="row">` が持つ（列見出しと同じ重みでは描かない）。 */
export function MatrixRow({ header, children }: { header: string; children: ReactNode }) {
  return (
    <tr>
      <th scope="row" className={cn(CELL, 'text-left font-normal')}>
        {header}
      </th>
      {children}
    </tr>
  )
}

export function MatrixCell({
  children,
  /** 許可されている操作だけ緑の太字（`.toggle`）。不可は本文色のまま置く。 */
  granted = false,
}: {
  children: ReactNode
  granted?: boolean
}) {
  return <td className={cn(CELL, 'text-center', granted && 'font-bold text-pine')}>{children}</td>
}
