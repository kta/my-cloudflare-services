import { describe, expect, it } from 'vitest'
import { ledgerWarnings } from '../src/worker/domain/ledger-warnings'

describe('ledger warnings', () => {
  it('raises a text-bearing long-wait warning at the 12-minute threshold', () => {
    expect(
      ledgerWarnings({
        progress: 'waiting',
        waitStartedAt: '2026-08-31T00:00:00.000Z',
        assignedStaffId: null,
        assignedEquipmentIds: [],
        now: new Date('2026-08-31T00:12:00.000Z'),
      }),
    ).toEqual([
      {
        code: 'long_wait',
        message: '待機時間が12分を超えています。次のご案内を確認してください。',
      },
    ])
  })

  it('does not flag a waiting customer one millisecond before the threshold', () => {
    expect(
      ledgerWarnings({
        progress: 'waiting',
        waitStartedAt: '2026-08-31T00:00:00.000Z',
        assignedStaffId: null,
        assignedEquipmentIds: [],
        now: new Date('2026-08-31T00:11:59.999Z'),
      }),
    ).toEqual([])
  })
})
