import { describe, expect, it } from 'vitest'
import { AuditAppendError } from '../src/worker/domain/audit'
import { recoverCustomerPhoneConflict } from '../src/worker/domain/walkin'

describe('recoverCustomerPhoneConflict', () => {
  it('recovers a customer phone uniqueness race using the committed customer', async () => {
    const result = await recoverCustomerPhoneConflict(
      async () => {
        throw new AuditAppendError(
          new Error(
            'UNIQUE constraint failed: customers.organization_id, customers.phone_normalized',
          ),
        )
      },
      async () => 'linked-existing-customer',
    )

    expect(result).toBe('linked-existing-customer')
  })

  it('also recognizes the raw D1 uniqueness error emitted by a direct batch', async () => {
    const result = await recoverCustomerPhoneConflict(
      async () => {
        throw new Error(
          'D1_ERROR: UNIQUE constraint failed: customers.organization_id, customers.phone_normalized: SQLITE_CONSTRAINT',
        )
      },
      async () => 'linked-existing-customer',
    )

    expect(result).toBe('linked-existing-customer')
  })

  it('does not mask an unrelated audit failure', async () => {
    await expect(
      recoverCustomerPhoneConflict(
        async () => {
          throw new AuditAppendError(new Error('audit storage unavailable'))
        },
        async () => 'unreachable',
      ),
    ).rejects.toThrow('audit event could not be appended')
  })
})
