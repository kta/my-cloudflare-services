import { z } from 'zod'

/**
 * Notification contracts shared by the domain Workers and the notifier.
 *
 * The notifier deliberately accepts only the two customer-facing reservation
 * messages required by the EYE flow. Keeping the payload discriminated by a
 * small allow-list prevents callers from turning this endpoint into a generic
 * arbitrary-mail relay.
 */

const EmailAddress = z.string().trim().email().max(320)
const ReservationId = z.string().uuid()
const ManagementCode = z.string().trim().min(1).max(128)
const ReservationNumber = z.string().trim().min(1).max(100)
const StoreName = z.string().trim().min(1).max(200)
const AppointmentAt = z.string().datetime()

/** Information included in a web reservation confirmation email. */
export const ReservationConfirmedEmail = z.strictObject({
  reservationId: ReservationId,
  to: EmailAddress,
  managementCode: ManagementCode,
  reservationNumber: ReservationNumber.optional(),
  storeName: StoreName.optional(),
  appointmentAt: AppointmentAt.optional(),
})
export type ReservationConfirmedEmail = z.infer<typeof ReservationConfirmedEmail>

/** Information included when a company reissues a reservation management code. */
export const ManagementCodeReissuedEmail = z.strictObject({
  reservationId: ReservationId,
  to: EmailAddress,
  managementCode: ManagementCode,
  reservationNumber: ReservationNumber.optional(),
  storeName: StoreName.optional(),
  appointmentAt: AppointmentAt.optional(),
})
export type ManagementCodeReissuedEmail = z.infer<typeof ManagementCodeReissuedEmail>

/** Information included when a company first issues a management code. */
export const ManagementCodeIssuedEmail = z.strictObject({
  reservationId: ReservationId,
  to: EmailAddress,
  managementCode: ManagementCode,
  reservationNumber: ReservationNumber.optional(),
  storeName: StoreName.optional(),
  appointmentAt: AppointmentAt.optional(),
})
export type ManagementCodeIssuedEmail = z.infer<typeof ManagementCodeIssuedEmail>

const NotificationId = z.string().trim().min(1).max(256)
const OrganizationId = z.string().trim().min(1).max(100)

/**
 * The complete internal notification envelope. `id` is both the application
 * idempotency key and the key sent to Resend's Idempotency-Key header.
 */
export const NotificationJob = z.discriminatedUnion('type', [
  z.strictObject({
    id: NotificationId,
    organizationId: OrganizationId,
    type: z.literal('reservation.confirmed'),
    payload: ReservationConfirmedEmail,
  }),
  z.strictObject({
    id: NotificationId,
    organizationId: OrganizationId,
    type: z.literal('reservation.management_code_issued'),
    payload: ManagementCodeIssuedEmail,
  }),
  z.strictObject({
    id: NotificationId,
    organizationId: OrganizationId,
    type: z.literal('reservation.management_code_reissued'),
    payload: ManagementCodeReissuedEmail,
  }),
])
export type NotificationJob = z.infer<typeof NotificationJob>

export const NotificationResult = z.strictObject({
  status: z.enum(['sent', 'duplicate']),
  id: NotificationId,
})
export type NotificationResult = z.infer<typeof NotificationResult>
