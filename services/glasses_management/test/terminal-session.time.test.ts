import { describe, expect, it } from 'vitest'
import {
  isPinLocked,
  isWeakPin,
  nextFailureState,
  parsePinFailure,
  pinFailureKey,
} from '../src/worker/domain/pin'
import {
  expiresAtFrom,
  isOnline,
  isSessionLive,
  sessionAuthorizationAt,
  sharedExpiresAtFrom,
  shouldMask,
} from '../src/worker/domain/terminal-session'

const NOW = new Date('2026-08-27T02:08:00.000Z')
const before = (milliseconds: number) => new Date(NOW.getTime() - milliseconds)

describe('端末の自動ロック', () => {
  it('最後にさわってから120秒ちょうどでは伏せない', () => {
    expect(
      shouldMask(
        {
          kind: 'shared',
          autoLockSeconds: 120,
          lastTouchedAt: before(120_000),
          recordingActive: false,
        },
        NOW,
      ),
    ).toBe(false)
  })

  it('最後にさわってから120秒+1msで伏せる', () => {
    expect(
      shouldMask(
        {
          kind: 'shared',
          autoLockSeconds: 120,
          lastTouchedAt: before(120_001),
          recordingActive: false,
        },
        NOW,
      ),
    ).toBe(true)
  })

  it('端末ごとの30秒設定を使う', () => {
    expect(
      shouldMask(
        {
          kind: 'shared',
          autoLockSeconds: 30,
          lastTouchedAt: before(30_001),
          recordingActive: false,
        },
        NOW,
      ),
    ).toBe(true)
  })

  it('個人端末と録音中は経過時間にかかわらず伏せない', () => {
    for (const input of [
      {
        kind: 'personal' as const,
        autoLockSeconds: 30,
        lastTouchedAt: before(31_000),
        recordingActive: false,
      },
      {
        kind: 'shared' as const,
        autoLockSeconds: 30,
        lastTouchedAt: before(31_000),
        recordingActive: true,
      },
    ]) {
      expect(shouldMask(input, NOW)).toBe(false)
    }
  })
})

describe('端末セッションの時刻境界', () => {
  it('開始時刻から端末設定秒数後を期限にする', () => {
    expect(expiresAtFrom(NOW, 120)).toBe('2026-08-27T02:10:00.000Z')
  })

  it('共有業務は自動で伏せても終わらず、24時間または明示終了まで生きる', () => {
    expect(sharedExpiresAtFrom(NOW)).toBe('2026-08-28T02:08:00.000Z')
  })

  it('期限ちょうどで失効し、失効済みは revoked_at の値に関わらず生きない', () => {
    const expiresAt = expiresAtFrom(NOW, 120)
    expect(
      isSessionLive({ expiresAt, revokedAt: null }, new Date('2026-08-27T02:09:59.999Z')),
    ).toBe(true)
    expect(isSessionLive({ expiresAt, revokedAt: null }, new Date(expiresAt))).toBe(false)
    expect(isSessionLive({ expiresAt, revokedAt: NOW.toISOString() }, NOW)).toBe(false)
  })

  it('個人権限は期限ちょうどで共有主体へ戻り、開始24時間ちょうどでfallbackも終わる', () => {
    const personal = {
      mode: 'personal' as const,
      startedAt: NOW.toISOString(),
      expiresAt: expiresAtFrom(NOW, 120),
      revokedAt: null,
    }
    expect(sessionAuthorizationAt(personal, new Date('2026-08-27T02:09:59.999Z'))).toBe('personal')
    expect(sessionAuthorizationAt(personal, new Date('2026-08-27T02:10:00.000Z'))).toBe('shared')
    expect(sessionAuthorizationAt(personal, new Date('2026-08-28T02:07:59.999Z'))).toBe('shared')
    expect(sessionAuthorizationAt(personal, new Date('2026-08-28T02:08:00.000Z'))).toBeNull()
    expect(sessionAuthorizationAt(personal, new Date('2026-08-28T02:08:00.001Z'))).toBeNull()
    expect(
      sessionAuthorizationAt({ ...personal, revokedAt: '2026-08-27T02:09:00.000Z' }, NOW),
    ).toBeNull()
  })

  it('last_seen_at がなく、または5分ちょうどを超えた端末はオフラインである', () => {
    expect(isOnline(null, NOW)).toBe(false)
    expect(isOnline(before(300_000).toISOString(), NOW)).toBe(true)
    expect(isOnline(before(300_001).toISOString(), NOW)).toBe(false)
  })
})

describe('PIN の境界', () => {
  it('同一数字と昇降順の連番だけを弱いPINとして拒む', () => {
    expect(isWeakPin('0000')).toBe(true)
    expect(isWeakPin('1234')).toBe(true)
    expect(isWeakPin('4321')).toBe(true)
    expect(isWeakPin('2580')).toBe(false)
  })

  it('共有PINと個人PINの失敗回数キーを分離する', () => {
    expect(pinFailureKey('org', 'terminal', null)).toBe('pin:org:terminal:shared')
    expect(pinFailureKey('org', 'terminal', 'staff')).toBe('pin:org:terminal:staff')
  })

  it('3回目で30秒ロックに入る', () => {
    expect(nextFailureState(0)).toEqual({
      attempts: 1,
      locked: false,
      remainingAttempts: 2,
      retryAfterSeconds: 0,
    })
    expect(nextFailureState(1)).toEqual({
      attempts: 2,
      locked: false,
      remainingAttempts: 1,
      retryAfterSeconds: 0,
    })
    expect(nextFailureState(2)).toEqual({
      attempts: 3,
      locked: true,
      remainingAttempts: 0,
      retryAfterSeconds: 30,
    })
  })

  it('ロックから30秒ちょうどは入力できず、+1msで解ける', () => {
    const lockedAt = before(30_000)
    expect(isPinLocked(lockedAt, NOW)).toBe(true)
    expect(isPinLocked(lockedAt, new Date(NOW.getTime() + 1))).toBe(false)
    expect(isPinLocked(null, NOW)).toBe(false)
  })

  it('KVの壊れた値は試行回数として使わない', () => {
    expect(parsePinFailure(null)).toBeNull()
    expect(parsePinFailure('{broken')).toBeNull()
    expect(parsePinFailure('{"attempts":3,"failedAt":"not-a-date"}')).toBeNull()
    expect(parsePinFailure('{"attempts":2,"failedAt":"2026-08-27T02:08:00.000Z"}')).toEqual({
      attempts: 2,
      failedAt: '2026-08-27T02:08:00.000Z',
    })
  })
})
