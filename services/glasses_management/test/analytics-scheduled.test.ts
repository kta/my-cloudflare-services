import { describe, expect, it, vi } from 'vitest'
import { runScheduledMaintenance } from '../src/worker/index'

describe('分析の日次Cron', () => {
  it('scheduledTimeのJST境界を使い、前処理失敗後も分析と録音掃除を続ける', async () => {
    const now = new Date('2026-08-27T15:00:00.000Z') // JST 2026-08-28 00:00
    const applyWebPublications = vi.fn().mockRejectedValue(new Error('publication failed'))
    const readRollupCursor = vi.fn().mockResolvedValue('saved-cursor')
    const rollupAnalytics = vi.fn().mockResolvedValue({
      nextStoreCursor: 'next-cursor',
      failedStores: [],
      dropped: 0,
    })
    const writeRollupCursor = vi.fn().mockResolvedValue(undefined)
    const purgeRecordings = vi.fn().mockResolvedValue(undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await runScheduledMaintenance(now, {
      applyWebPublications,
      readRollupCursor,
      rollupAnalytics,
      writeRollupCursor,
      purgeRecordings,
    })

    expect(applyWebPublications).toHaveBeenCalledWith(now)
    expect(rollupAnalytics).toHaveBeenCalledWith({
      from: '2026-08-27',
      to: '2026-09-04',
      limit: 3,
      storeCursor: 'saved-cursor',
      now,
      completedThrough: '2026-08-27',
    })
    expect(rollupAnalytics).toHaveBeenCalledTimes(1)
    expect(writeRollupCursor).toHaveBeenCalledWith('next-cursor')
    expect(purgeRecordings).toHaveBeenCalledWith(now)
    expect(error).toHaveBeenCalledWith('scheduled web publications apply failed', expect.any(Error))
    error.mockRestore()
  })

  it('店舗単位の失敗とdropを構造化して残し、録音掃除を続ける', async () => {
    const now = new Date('2026-08-27T15:00:00.000Z')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const purgeRecordings = vi.fn().mockResolvedValue(undefined)

    await runScheduledMaintenance(now, {
      applyWebPublications: vi.fn().mockResolvedValue(undefined),
      readRollupCursor: vi.fn().mockResolvedValue(undefined),
      rollupAnalytics: vi.fn().mockResolvedValue({
        nextStoreCursor: null,
        failedStores: ['store-failed'],
        dropped: 2,
      }),
      writeRollupCursor: vi.fn().mockResolvedValue(undefined),
      purgeRecordings,
    })

    expect(error).toHaveBeenCalledWith('scheduled analytics rollup completed with anomalies', {
      failedStores: ['store-failed'],
      dropped: 2,
    })
    expect(purgeRecordings).toHaveBeenCalledWith(now)
    error.mockRestore()
  })

  it('4店舗を複数日に分けても、各ページを31日以内でcatch-upしてforecastを確定できる', async () => {
    const rollupAnalytics = vi
      .fn()
      .mockResolvedValueOnce({ nextStoreCursor: 'stores-4', failedStores: [], dropped: 0 })
      .mockResolvedValueOnce({ nextStoreCursor: null, failedStores: [], dropped: 0 })
    const tasks = {
      applyWebPublications: vi.fn().mockResolvedValue(undefined),
      readRollupCursor: vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce('stores-4'),
      rollupAnalytics,
      writeRollupCursor: vi.fn().mockResolvedValue(undefined),
      purgeRecordings: vi.fn().mockResolvedValue(undefined),
    }

    await runScheduledMaintenance(new Date('2026-08-27T15:00:00.000Z'), tasks)
    await runScheduledMaintenance(new Date('2026-08-28T15:00:00.000Z'), tasks)

    expect(rollupAnalytics).toHaveBeenNthCalledWith(1, {
      from: '2026-08-27',
      to: '2026-09-04',
      limit: 3,
      storeCursor: undefined,
      now: new Date('2026-08-27T15:00:00.000Z'),
      completedThrough: '2026-08-27',
    })
    expect(rollupAnalytics).toHaveBeenNthCalledWith(2, {
      from: '2026-08-28',
      to: '2026-09-05',
      limit: 3,
      storeCursor: 'stores-4',
      now: new Date('2026-08-28T15:00:00.000Z'),
      completedThrough: '2026-08-28',
    })
  })

  it('cursor保存が失敗しても既知のfailedStores/droppedを構造化ログし、録音掃除を続ける', async () => {
    const now = new Date('2026-08-27T15:00:00.000Z')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const purgeRecordings = vi.fn().mockResolvedValue(undefined)

    await runScheduledMaintenance(now, {
      applyWebPublications: vi.fn().mockResolvedValue(undefined),
      readRollupCursor: vi.fn().mockResolvedValue(undefined),
      rollupAnalytics: vi.fn().mockResolvedValue({
        nextStoreCursor: 'next-cursor',
        failedStores: ['store-failed'],
        dropped: 2,
      }),
      writeRollupCursor: vi.fn().mockRejectedValue(new Error('kv unavailable')),
      purgeRecordings,
    })

    expect(error).toHaveBeenCalledWith('scheduled analytics rollup completed with anomalies', {
      failedStores: ['store-failed'],
      dropped: 2,
    })
    expect(error).toHaveBeenCalledWith('scheduled analytics rollup failed', expect.any(Error))
    expect(purgeRecordings).toHaveBeenCalledWith(now)
    error.mockRestore()
  })
})
