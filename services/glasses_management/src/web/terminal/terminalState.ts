/*
 * 端末の業務セッション。**平文の暗証番号は一切ここへ来ない**（PIN は
 * `POST /api/staff/terminals/:terminalId/sessions` の本文で 1 回だけ使い、
 * 返ってきたセッションの id しか持ち帰らない）。
 *
 * 保存先が `sessionStorage` なのは、iPad を閉じて開き直すあいだは業務を続けたいが、
 * ブラウザのタブを閉じたら**残さない**ため。localStorage に置くと、共有端末で
 * 「誰の業務か」が翌日まで残る。
 */

export type TerminalMode = 'personal' | 'shared'

export type TerminalContext = {
  terminalId: string
  terminalName: string
  mode: TerminalMode
  staffId: string | null
  staffName: string | null
  sessionId: string
  /** 自動で伏せるまでの秒数（既定 120）。伏せる側は P10 の T-017 が使う。 */
  autoLockSeconds: number
}

const KEY = 'eyex.terminal.session'

export function loadTerminal(): TerminalContext | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw === null) return null
    const value: unknown = JSON.parse(raw)
    return isTerminalContext(value) ? value : null
  } catch {
    return null
  }
}

export function saveTerminal(context: TerminalContext): void {
  sessionStorage.setItem(KEY, JSON.stringify(context))
}

export function clearTerminal(): void {
  sessionStorage.removeItem(KEY)
}

/**
 * 左の柱の下に出す 2 行（AC-TERM-03 / AC-TERM-05）。
 * 個人は「佐藤 美咲の iPad」、共有は置き場所の名前をそのまま出す。
 */
export function terminalNote(context: TerminalContext): readonly string[] {
  return context.mode === 'personal'
    ? [`${context.staffName ?? context.terminalName}の iPad`, '個人で使っています']
    : [context.terminalName, '共有で使っています']
}

function isTerminalContext(value: unknown): value is TerminalContext {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.terminalId === 'string' &&
    typeof row.terminalName === 'string' &&
    (row.mode === 'personal' || row.mode === 'shared') &&
    typeof row.sessionId === 'string' &&
    typeof row.autoLockSeconds === 'number'
  )
}
