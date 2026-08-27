import { describe, expect, it } from 'vitest'
import {
  alertDedupeKey,
  DEFAULT_ALERT_CONDITIONS,
  longWaitAlerts,
  recordingFailureAlerts,
  settingsContradictionAlerts,
} from '../src/worker/domain/alerts'

const now = new Date('2026-08-31T00:00:00.000Z')

describe('default alert conditions', () => {
  it('covers every configurable warning condition exactly once', () => {
    expect(DEFAULT_ALERT_CONDITIONS.map((condition) => condition.code)).toEqual([
      'long_wait',
      'recording_save_failure',
      'settings_contradiction',
    ])
  })

  it('carries a minute threshold only on the wait condition', () => {
    for (const condition of DEFAULT_ALERT_CONDITIONS) {
      expect(condition.thresholdMinutes === null).toBe(condition.code !== 'long_wait')
    }
  })
})

describe('longWaitAlerts', () => {
  const waiting = (waitStartedAt: string, id = 'walkin-1') => ({
    subjectType: 'walkin' as const,
    subjectId: id,
    subject: `来店番号 ${id}`,
    waitStartedAt,
    isWaiting: true,
  })

  it('raises nothing exactly on the threshold', () => {
    expect(
      longWaitAlerts({
        entries: [waiting('2026-08-30T23:45:00.000Z')],
        thresholdMinutes: 15,
        now,
      }),
    ).toHaveLength(0)
  })

  it('raises one alert a second past the threshold', () => {
    const alerts = longWaitAlerts({
      entries: [waiting('2026-08-30T23:44:59.000Z')],
      thresholdMinutes: 15,
      now,
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ kind: 'alert', code: 'long_wait', subjectType: 'walkin' })
    expect(alerts[0]?.reason).toContain('15')
    expect(alerts[0]?.nextAction.length).toBeGreaterThan(0)
  })

  it('ignores anyone who is no longer waiting', () => {
    expect(
      longWaitAlerts({
        entries: [{ ...waiting('2026-08-30T20:00:00.000Z'), isWaiting: false }],
        thresholdMinutes: 15,
        now,
      }),
    ).toHaveLength(0)
  })

  it('ignores an unparseable wait start rather than raising a false alarm', () => {
    expect(
      longWaitAlerts({ entries: [waiting('not-a-time')], thresholdMinutes: 15, now }),
    ).toHaveLength(0)
  })

  it('names the wait start as the occurrence time, not the moment of evaluation', () => {
    const alerts = longWaitAlerts({
      entries: [waiting('2026-08-30T23:00:00.000Z')],
      thresholdMinutes: 15,
      now,
    })
    expect(alerts[0]?.occurredAt).toBe('2026-08-30T23:15:00.000Z')
  })
})

describe('recordingFailureAlerts', () => {
  it('raises one alert per failed recording with its reason', () => {
    const alerts = recordingFailureAlerts([
      {
        id: 'rec-1',
        state: 'failed',
        failureReason: 'upload_aborted',
        updatedAt: '2026-08-30T23:00:00.000Z',
      },
      { id: 'rec-2', state: 'saved', failureReason: null, updatedAt: '2026-08-30T23:00:00.000Z' },
    ])
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      code: 'recording_save_failure',
      subjectType: 'recording',
      subjectId: 'rec-1',
      occurredAt: '2026-08-30T23:00:00.000Z',
    })
    expect(alerts[0]?.reason).toContain('upload_aborted')
  })

  it('still explains a failure that recorded no reason', () => {
    const alerts = recordingFailureAlerts([
      { id: 'rec-3', state: 'failed', failureReason: null, updatedAt: '2026-08-30T23:00:00.000Z' },
    ])
    expect(alerts[0]?.reason.length).toBeGreaterThan(0)
  })
})

describe('settingsContradictionAlerts', () => {
  const purpose = {
    id: 'purpose-1',
    staffName: '視力測定',
    durationMinutes: 30,
    slotIntervalMinutes: 15,
    maxConcurrent: 2,
    isPublic: '1',
  }

  it('accepts a consistent purpose', () => {
    expect(settingsContradictionAlerts([purpose], now)).toHaveLength(0)
  })

  it('flags a duration that is not a whole number of slots', () => {
    const alerts = settingsContradictionAlerts([{ ...purpose, durationMinutes: 20 }], now)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      code: 'settings_contradiction',
      subjectType: 'visit_purpose',
      subjectId: 'purpose-1',
      kind: 'alert',
    })
    expect(alerts[0]?.occurredAt).toBe(now.toISOString())
  })

  it('flags a capacity that can never accept a booking', () => {
    expect(settingsContradictionAlerts([{ ...purpose, maxConcurrent: 0 }], now)).toHaveLength(1)
  })

  it('flags a public purpose with no duration', () => {
    expect(
      settingsContradictionAlerts([{ ...purpose, durationMinutes: 0, isPublic: '1' }], now),
    ).toHaveLength(1)
  })

  it('does not divide by a zero slot interval', () => {
    const alerts = settingsContradictionAlerts([{ ...purpose, slotIntervalMinutes: 0 }], now)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.reason.length).toBeGreaterThan(0)
  })

  it('reports one alert per contradictory purpose even when several rules break', () => {
    const alerts = settingsContradictionAlerts(
      [{ ...purpose, durationMinutes: 20, maxConcurrent: 0 }],
      now,
    )
    expect(alerts).toHaveLength(1)
  })
})

describe('alertDedupeKey', () => {
  it('is stable for the same condition and subject so re-evaluation never duplicates', () => {
    expect(alertDedupeKey('long_wait', 'walkin-1', '2026-08-31T00:00:00.000Z')).toBe(
      alertDedupeKey('long_wait', 'walkin-1', '2026-08-31T00:00:00.000Z'),
    )
  })

  it('separates different subjects and different occurrences', () => {
    const base = alertDedupeKey('long_wait', 'walkin-1', '2026-08-31T00:00:00.000Z')
    expect(alertDedupeKey('long_wait', 'walkin-2', '2026-08-31T00:00:00.000Z')).not.toBe(base)
    expect(alertDedupeKey('long_wait', 'walkin-1', '2026-08-31T01:00:00.000Z')).not.toBe(base)
    expect(
      alertDedupeKey('recording_save_failure', 'walkin-1', '2026-08-31T00:00:00.000Z'),
    ).not.toBe(base)
  })
})
