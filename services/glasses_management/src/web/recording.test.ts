import type { RecordingState } from '@app/contracts'
import { describe, expect, test } from 'vitest'
import {
  canDeleteRecording,
  canRetryRecording,
  canTransitionRecording,
  formatRecordingDuration,
  formatRecordingInstant,
  MINIMUM_CONFIRMED_RETENTION_DAYS,
  MINIMUM_DISCARDED_RETENTION_HOURS,
  minimumRetentionSummary,
  minimumRetentionUntil,
  RECORDING_OPS_FILTERS,
  RECORDING_STATE_LABEL,
  recordingStateTone,
  retentionLabel,
} from './recording'

const ALL_STATES: readonly RecordingState[] = [
  'permission_check',
  'recording',
  'stopped',
  'uploading',
  'stored',
  'failed',
  'held',
  'pending_deletion',
  'deleted',
]

/**
 * 録音の状態遷移は予約の状態と独立している (UC-EYEX-176, AC-EYEX-115)。
 * 許可された遷移だけを列挙し、それ以外は全て拒否されることを表で確かめる。
 */
const LEGAL: ReadonlyArray<readonly [RecordingState, RecordingState]> = [
  ['permission_check', 'recording'],
  ['permission_check', 'failed'],
  ['recording', 'stopped'],
  ['recording', 'failed'],
  ['stopped', 'uploading'],
  ['stopped', 'failed'],
  ['uploading', 'stored'],
  ['uploading', 'failed'],
  ['stored', 'held'],
  ['stored', 'pending_deletion'],
  ['stored', 'deleted'],
  ['failed', 'uploading'],
  ['failed', 'deleted'],
  ['held', 'stored'],
  ['held', 'pending_deletion'],
  ['pending_deletion', 'held'],
  ['pending_deletion', 'deleted'],
]

describe('recording state machine (UC-EYEX-176 / AC-EYEX-115)', () => {
  test.each(LEGAL)('%s は %s へ遷移できる', (from, to) => {
    expect(canTransitionRecording(from, to)).toBe(true)
  })

  test('表にない遷移は全て拒否される', () => {
    const legal = new Set(LEGAL.map(([from, to]) => `${from}->${to}`))
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        if (legal.has(`${from}->${to}`)) continue
        expect({ from, to, allowed: canTransitionRecording(from, to) }).toEqual({
          from,
          to,
          allowed: false,
        })
      }
    }
  })

  test('削除済みは終端で、復元経路を持たない', () => {
    for (const to of ALL_STATES) expect(canTransitionRecording('deleted', to)).toBe(false)
  })

  test('全ての状態に日本語ラベルがあり、色だけに依存しない (AC-EYEX-115)', () => {
    for (const state of ALL_STATES) {
      expect(RECORDING_STATE_LABEL[state]).toMatch(/\S/)
      expect(recordingStateTone(state)).toMatch(/^(success|warning|danger|neutral)$/)
    }
    expect(RECORDING_STATE_LABEL.permission_check).toBe('権限確認')
    expect(RECORDING_STATE_LABEL.recording).toBe('録音中')
    expect(RECORDING_STATE_LABEL.stopped).toBe('停止')
    expect(RECORDING_STATE_LABEL.uploading).toBe('送信中')
    expect(RECORDING_STATE_LABEL.stored).toBe('保存済み')
    expect(RECORDING_STATE_LABEL.failed).toBe('失敗')
    expect(RECORDING_STATE_LABEL.held).toBe('保全中')
    expect(RECORDING_STATE_LABEL.pending_deletion).toBe('削除予定')
    expect(RECORDING_STATE_LABEL.deleted).toBe('削除済み')
  })
})

describe('録音運用一覧の区分と再試行 (UC-EYEX-154 / AC-EYEX-100)', () => {
  test('保存中・失敗・保全中・削除予定・削除済みを区別する', () => {
    expect(RECORDING_OPS_FILTERS.map((filter) => filter.label)).toEqual([
      '保存中',
      '保存済み',
      '失敗',
      '保全中',
      '削除予定',
      '削除済み',
    ])
    expect(RECORDING_OPS_FILTERS.map((filter) => filter.state)).toEqual([
      'uploading',
      'stored',
      'failed',
      'held',
      'pending_deletion',
      'deleted',
    ])
  })

  test('再試行できるのは失敗した録音だけ', () => {
    for (const state of ALL_STATES) {
      expect({ state, retry: canRetryRecording(state) }).toEqual({
        state,
        retry: state === 'failed',
      })
    }
  })
})

describe('最低保持期間 (UC-EYEX-153 / AC-EYEX-75, 76, 99)', () => {
  test('最低値は成立予約30日・破棄受付24時間', () => {
    expect(MINIMUM_CONFIRMED_RETENTION_DAYS).toBe(30)
    expect(MINIMUM_DISCARDED_RETENTION_HOURS).toBe(24)
  })

  test('成立予約は録音完了から30日、破棄受付は24時間', () => {
    expect(minimumRetentionUntil('2026-08-27T02:00:00.000Z', true)).toBe('2026-09-26T02:00:00.000Z')
    expect(minimumRetentionUntil('2026-08-27T02:00:00.000Z', false)).toBe(
      '2026-08-28T02:00:00.000Z',
    )
  })

  test('最低値の説明文は理由込みで示される', () => {
    expect(minimumRetentionSummary(true)).toContain('30日')
    expect(minimumRetentionSummary(false)).toContain('24時間')
  })

  test('ISO でない値は拒否する', () => {
    expect(() => minimumRetentionUntil('yesterday', true)).toThrow(RangeError)
  })
})

describe('保持期限ラベルは注入された時刻からのみ導く (AC-EYEX-75, 76)', () => {
  test('残り日数・時間・分を段階的に示す', () => {
    const until = '2026-09-26T02:00:00.000Z'
    expect(retentionLabel({ retentionUntil: until, now: '2026-08-27T02:00:00.000Z' })).toContain(
      '残り30日',
    )
    expect(retentionLabel({ retentionUntil: until, now: '2026-09-25T04:00:00.000Z' })).toContain(
      '残り22時間',
    )
    expect(retentionLabel({ retentionUntil: until, now: '2026-09-26T01:30:00.000Z' })).toContain(
      '残り30分',
    )
  })

  test('期限そのものは JST で示される', () => {
    expect(
      retentionLabel({
        retentionUntil: '2026-09-26T02:00:00.000Z',
        now: '2026-08-27T02:00:00.000Z',
      }),
    ).toContain('2026年9月26日 11:00')
  })

  test('期限を過ぎたら経過済みとして示す', () => {
    expect(
      retentionLabel({
        retentionUntil: '2026-09-26T02:00:00.000Z',
        now: '2026-09-26T02:00:00.000Z',
      }),
    ).toContain('経過')
  })

  test('保持期限が無い録音は保持期限なしとして示す', () => {
    expect(retentionLabel({ retentionUntil: null, now: '2026-08-27T02:00:00.000Z' })).toBe(
      '保持期限未設定',
    )
  })
})

describe('削除可否 (UC-EYEX-125 / AC-EYEX-75, 76, 77, 78)', () => {
  const now = '2026-09-26T02:00:00.000Z'

  test('最低保持期限より前は削除できない', () => {
    expect(
      canDeleteRecording({
        state: 'stored',
        retentionUntil: '2026-09-26T02:00:00.001Z',
        now,
      }),
    ).toBe(false)
  })

  test('期限ちょうどは削除できる', () => {
    expect(canDeleteRecording({ state: 'stored', retentionUntil: now, now })).toBe(true)
  })

  test('保全中は期限を過ぎても削除できない', () => {
    expect(
      canDeleteRecording({ state: 'held', retentionUntil: '2026-01-01T00:00:00.000Z', now }),
    ).toBe(false)
  })

  test('削除済みは再度削除できない', () => {
    expect(canDeleteRecording({ state: 'deleted', retentionUntil: null, now })).toBe(false)
  })
})

describe('表示用フォーマット', () => {
  test('長さは mm:ss', () => {
    expect(formatRecordingDuration(0)).toBe('00:00')
    expect(formatRecordingDuration(68)).toBe('01:08')
    expect(formatRecordingDuration(3600)).toBe('60:00')
  })

  test('録音日時は JST', () => {
    expect(formatRecordingInstant('2026-08-27T02:00:00.000Z')).toBe('2026年8月27日 11:00')
  })
})
