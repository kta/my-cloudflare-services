type Session = {
  mode: 'shared' | 'personal'
  staffId: string | null
  terminalId: string
}

export type AuditActor = {
  kind: 'staff' | 'terminal' | 'system'
  subjectId: string | null
  terminalId: string | null
}

/** 主体は本文ではなく、認証済みclaimsとサーバが読んだ端末セッションから決める。 */
export function resolveActor(session: Session | null): AuditActor {
  if (session?.mode === 'personal' && session.staffId !== null) {
    return { kind: 'staff', subjectId: session.staffId, terminalId: session.terminalId }
  }
  if (session?.mode === 'shared') {
    return { kind: 'terminal', subjectId: session.terminalId, terminalId: session.terminalId }
  }
  return { kind: 'system', subjectId: null, terminalId: null }
}
