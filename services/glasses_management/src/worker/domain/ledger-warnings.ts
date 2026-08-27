import type { LedgerWarning, ReceptionProgress } from '@app/contracts'

const DEFAULT_LONG_WAIT_THRESHOLD_MS = 12 * 60 * 1000

type LedgerWarningInput = {
  progress: ReceptionProgress | null
  waitStartedAt: string | null
  assignedStaffId: string | null
  assignedEquipmentIds: string[]
  now: Date
}

/**
 * Derives display-safe warnings from persisted operational state. The caller
 * supplies time explicitly so boundary behavior is deterministic and the
 * future store warning configuration can replace the default threshold.
 */
export function ledgerWarnings(input: LedgerWarningInput): LedgerWarning[] {
  if (input.progress !== 'waiting' || input.waitStartedAt === null) return []
  const startedAt = new Date(input.waitStartedAt)
  if (Number.isNaN(startedAt.getTime())) return []
  if (input.now.getTime() - startedAt.getTime() < DEFAULT_LONG_WAIT_THRESHOLD_MS) return []
  return [
    {
      code: 'long_wait',
      message: '待機時間が12分を超えています。次のご案内を確認してください。',
    },
  ]
}
