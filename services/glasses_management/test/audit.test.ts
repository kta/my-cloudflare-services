import { describe, expect, it } from 'vitest'
import { resolveActor } from '../src/worker/domain/audit'

describe('監査の操作主体', () => {
  it.each([
    {
      name: '個人モードは本人と端末を残す',
      session: { mode: 'personal' as const, staffId: 'staff-1', terminalId: 'terminal-1' },
      expected: { kind: 'staff', subjectId: 'staff-1', terminalId: 'terminal-1' },
    },
    {
      name: '共有モードは端末そのものを残す',
      session: { mode: 'shared' as const, staffId: null, terminalId: 'terminal-1' },
      expected: { kind: 'terminal', subjectId: 'terminal-1', terminalId: 'terminal-1' },
    },
    {
      name: '人も端末もいない保守処理はシステムを残す',
      session: null,
      expected: { kind: 'system', subjectId: null, terminalId: null },
    },
  ])('$name', ({ session, expected }) => {
    expect(resolveActor(session)).toEqual(expected)
  })
})
