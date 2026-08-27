import { describe, expect, it } from 'vitest'
import { assertVersion, nextVersion, VersionConflictError } from '../src/worker/domain/version'

describe('version assertions', () => {
  it('accepts an expected version and computes the next version', async () => {
    await expect(assertVersion(4, 4)).resolves.toBeUndefined()
    expect(nextVersion(4)).toBe(5)
  })

  it('raises a 409-compatible conflict for a stale version', async () => {
    await expect(assertVersion(5, 4)).rejects.toMatchObject({
      code: 'version_conflict',
      status: 409,
      currentVersion: 5,
      expectedVersion: 4,
    })
  })

  it('rejects versions that are not safe non-negative integers', async () => {
    await expect(assertVersion(-1, -1)).rejects.toBeInstanceOf(RangeError)
    await expect(assertVersion(Number.NaN, Number.NaN)).rejects.toBeInstanceOf(RangeError)
    expect(() => nextVersion(Number.MAX_SAFE_INTEGER)).toThrow(RangeError)
  })

  it('exposes a stable error type for callers that need to map the conflict', async () => {
    try {
      await assertVersion(2, 1)
      throw new Error('expected assertVersion to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(VersionConflictError)
    }
  })
})
