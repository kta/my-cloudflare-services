export class VersionConflictError extends Error {
  readonly code = 'version_conflict' as const
  readonly status = 409 as const
  readonly currentVersion: number
  readonly expectedVersion: number

  constructor(currentVersion: number, expectedVersion: number) {
    super(
      `version conflict: expected ${String(expectedVersion)}, current ${String(currentVersion)}`,
    )
    this.name = 'VersionConflictError'
    this.currentVersion = currentVersion
    this.expectedVersion = expectedVersion
  }
}

function assertValidVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('version must be a non-negative safe integer')
  }
}

/** Compare the version supplied by a caller with the row currently in D1. */
export async function assertVersion(current: number, expected: number): Promise<void> {
  assertValidVersion(current)
  assertValidVersion(expected)
  if (current !== expected) throw new VersionConflictError(current, expected)
}

export function nextVersion(current: number): number {
  assertValidVersion(current)
  if (current === Number.MAX_SAFE_INTEGER) {
    throw new RangeError('version cannot be incremented beyond the safe integer range')
  }
  return current + 1
}
