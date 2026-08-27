import {
  ManagementCodeIssuedEmail,
  ManagementCodeReissuedEmail,
  NotificationJob,
  type NotificationJob as NotificationJobValue,
  ReservationConfirmedEmail,
} from '@app/contracts'
import { internalAuth } from '@app/shared'
import type { KVNamespace } from '@cloudflare/workers-types'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'

export const DEDUPE_TTL_SECONDS = 24 * 60 * 60

export type Bindings = {
  DEDUPE: KVNamespace
  // Required in the type so internalAuth remains fail-closed at runtime when
  // the secret is missing: an absent value never matches a supplied header.
  INTERNAL_KEY: string
  MAIL_FROM?: string
  RESEND_API_KEY?: string
}

type MailMessage = {
  from: string
  to: string[]
  subject: string
  text: string
  html: string
}

type DeliveryResult =
  | { status: 'sent' | 'duplicate'; id: string }
  | {
      status: 'failed'
      reason: 'not_configured' | 'dedupe' | 'upstream' | 'conflict' | 'in_progress'
    }

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

type DedupeMarker = {
  status: 'sent'
  payloadHash: string
}

async function dedupeKey(job: NotificationJobValue): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify({ organizationId: job.organizationId, id: job.id })),
  )
  return `eyex:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    )
  }
  return value
}

async function notificationPayloadHash(job: NotificationJobValue): Promise<string> {
  const canonical = JSON.stringify({ type: job.type, payload: canonicalize(job.payload) })
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function parseDedupeMarker(value: string): DedupeMarker | 'legacy' | null {
  // Keep markers written by the previous implementation as duplicate-only
  // records. New records always carry a hash so a reused job id cannot hide a
  // changed email payload.
  if (value === 'sent') return 'legacy'
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'status' in parsed &&
      parsed.status === 'sent' &&
      'payloadHash' in parsed &&
      typeof parsed.payloadHash === 'string' &&
      parsed.payloadHash.length > 0
    ) {
      return { status: 'sent', payloadHash: parsed.payloadHash }
    }
  } catch {
    // A malformed marker is treated as a KV failure below; sending would make
    // the dedupe state impossible to reason about.
  }
  return null
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ??
      character,
  )
}

function payloadFor(job: NotificationJobValue) {
  if (job.type === 'reservation.confirmed') return ReservationConfirmedEmail.parse(job.payload)
  if (job.type === 'reservation.management_code_issued') {
    return ManagementCodeIssuedEmail.parse(job.payload)
  }
  return ManagementCodeReissuedEmail.parse(job.payload)
}

function subjectFor(job: NotificationJobValue): string {
  if (job.type === 'reservation.confirmed') return 'EYEX ご予約完了のお知らせ'
  if (job.type === 'reservation.management_code_issued') {
    return 'EYEX 予約管理コードのお知らせ'
  }
  return 'EYEX 予約管理コード再発行のお知らせ'
}

function messageFor(job: NotificationJobValue, from: string): MailMessage {
  const payload = payloadFor(job)
  const reservationLabel = payload.reservationNumber ?? payload.reservationId
  const lines = [
    'EYEXをご利用いただきありがとうございます。',
    '',
    `予約番号: ${reservationLabel}`,
    ...(payload.storeName ? [`店舗: ${payload.storeName}`] : []),
    ...(payload.appointmentAt ? [`来店日時: ${payload.appointmentAt}`] : []),
    `管理コード: ${payload.managementCode}`,
    '',
    '予約の変更・取消には予約番号と管理コードが必要です。',
  ]
  const text = lines.join('\n')
  const html = `<p>${escapeHtml(lines[0] ?? '')}</p><dl>${lines
    .slice(2, -2)
    .map((line) => {
      const separator = line.indexOf(': ')
      if (separator < 0) return `<dd>${escapeHtml(line)}</dd>`
      const label = line.slice(0, separator)
      const value = line.slice(separator + 2)
      return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`
    })
    .join('')}</dl><p>${escapeHtml(lines.at(-1) ?? '')}</p>`

  return {
    from,
    to: [payload.to],
    subject: subjectFor(job),
    text,
    html,
  }
}

/**
 * Deliver one validated notification. The marker is written only after
 * Resend accepts the request, so an upstream failure remains retryable. The
 * Resend idempotency header closes the small race between duplicate Workers
 * requests while the KV write is still propagating.
 */
export async function deliverNotification(
  job: NotificationJobValue,
  bindings: Bindings,
  fetcher: typeof fetch = fetch,
): Promise<DeliveryResult> {
  const payloadHash = await notificationPayloadHash(job)
  const key = await dedupeKey(job)
  let existing: string | null
  try {
    existing = await bindings.DEDUPE.get(key)
  } catch {
    console.error('notification_dedupe_read_failed', { id: job.id })
    return { status: 'failed', reason: 'dedupe' }
  }
  if (existing !== null) {
    const marker = parseDedupeMarker(existing)
    if (marker === 'legacy') return { status: 'duplicate', id: job.id }
    if (marker === null) {
      console.error('notification_dedupe_marker_invalid', { id: job.id })
      return { status: 'failed', reason: 'dedupe' }
    }
    if (marker.payloadHash !== payloadHash) {
      console.error('notification_dedupe_payload_conflict', { id: job.id })
      return { status: 'failed', reason: 'conflict' }
    }
    return { status: 'duplicate', id: job.id }
  }

  const from = bindings.MAIL_FROM?.trim()
  const apiKey = bindings.RESEND_API_KEY?.trim()
  if (!from || !apiKey) {
    console.error('notification_mail_not_configured', { id: job.id })
    return { status: 'failed', reason: 'not_configured' }
  }

  const message = messageFor(job, from)
  let response: Response
  try {
    response = await fetcher(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': key,
        'user-agent': 'eyex-notifier/1.0',
      },
      body: JSON.stringify(message),
    })
  } catch {
    console.error('notification_mail_delivery_failed', { id: job.id })
    return { status: 'failed', reason: 'upstream' }
  }
  if (!response.ok) {
    if (response.status === 409) {
      const body: unknown = await response.json().catch(() => null)
      if (
        body !== null &&
        typeof body === 'object' &&
        'name' in body &&
        body.name === 'invalid_idempotent_request'
      ) {
        return { status: 'failed', reason: 'conflict' }
      }
      if (
        body !== null &&
        typeof body === 'object' &&
        'name' in body &&
        body.name === 'concurrent_idempotent_requests'
      ) {
        return { status: 'failed', reason: 'in_progress' }
      }
      console.error('notification_mail_delivery_failed', { id: job.id, status: response.status })
      return { status: 'failed', reason: 'upstream' }
    }
    console.error('notification_mail_delivery_failed', { id: job.id, status: response.status })
    return { status: 'failed', reason: 'upstream' }
  }

  try {
    await bindings.DEDUPE.put(
      key,
      JSON.stringify({ status: 'sent', payloadHash } satisfies DedupeMarker),
      { expirationTtl: DEDUPE_TTL_SECONDS },
    )
  } catch {
    // The email may already have been accepted. Returning 502 makes the
    // caller's fallback visible; a retry is safe because both this KV marker
    // and Resend's idempotency key use the same job id.
    console.error('notification_dedupe_write_failed', { id: job.id })
    return { status: 'failed', reason: 'dedupe' }
  }
  return { status: 'sent', id: job.id }
}

const app = new Hono<{ Bindings: Bindings }>()

app.onError((error, c) => {
  console.error('notifier_unhandled_error', error)
  return c.json({ error: 'internal_error' }, 500)
})

// This is an internal service-binding endpoint. A missing or wrong secret is
// always 401; the endpoint never falls back to a public/API-key path.
app.use('/api/internal/*', internalAuth())

const routes = app
  .get('/api/health', (c) => c.json({ status: 'ok' as const }))
  .post('/api/internal/send', zValidator('json', NotificationJob), async (c) => {
    const job = c.req.valid('json')
    const result = await deliverNotification(job, c.env)
    if (result.status === 'failed' && result.reason === 'conflict') {
      return c.json({ error: 'idempotency_conflict' as const }, 409)
    }
    if (result.status === 'failed' && result.reason === 'in_progress') {
      return c.json({ error: 'idempotency_in_progress' as const }, 409)
    }
    if (result.status === 'failed') return c.json({ error: 'send_failed' }, 502)
    return c.json({ status: result.status, id: result.id }, 200)
  })

export type AppType = typeof routes
export { app }
export default app
