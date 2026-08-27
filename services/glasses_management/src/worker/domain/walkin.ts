import { AuditAppendError } from './audit'

const CUSTOMER_PHONE_CONFLICT =
  'UNIQUE constraint failed: customers.organization_id, customers.phone_normalized'

export function isCustomerPhoneConflict(error: unknown): boolean {
  const cause = error instanceof AuditAppendError ? error.cause : error
  return String(cause).includes(CUSTOMER_PHONE_CONFLICT)
}

/** Resolve the one safe race in customer creation: another request won the
 * organization-wide phone uniqueness constraint and committed the identity. */
export async function recoverCustomerPhoneConflict<T>(
  operation: () => Promise<T>,
  recover: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (!isCustomerPhoneConflict(error)) throw error
    return recover()
  }
}
