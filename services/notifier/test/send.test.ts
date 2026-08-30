import { env, SELF } from 'cloudflare:test'
import {
  ManagementCodeReissuedEmail,
  NotificationJob,
  ReservationConfirmedEmail,
} from '@app/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { app, type Bindings, deliverNotification } from '../src/index'

const BASE = 'https://notifier.test'
const INTERNAL_KEY = 'dev-internal-key'
const JSON_HEADERS = { 'content-type': 'application/json' }

const reservationId = 'b9e4f0e8-bbe0-4e8e-95a2-5e0ecf2525ab'
type FetchCall = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function internalHeaders(key = INTERNAL_KEY): Record<string, string> {
  return { ...JSON_HEADERS, 'x-internal-key': key }
}

function confirmedJob(id = `reservation:${crypto.randomUUID()}`) {
  return {
    id,
    organizationId: crypto.randomUUID(),
    type: 'reservation.confirmed' as const,
    payload: {
      reservationId,
      to: 'customer@example.test',
      managementCode: 'EYEX-123456',
      reservationNumber: 'EYEX-20260826-0001',
      storeName: '銀座店',
      appointmentAt: '2026-09-01T03:00:00.000Z',
    },
  }
}

function reissuedJob(id = `management-code:${crypto.randomUUID()}`) {
  return {
    id,
    organizationId: crypto.randomUUID(),
    type: 'reservation.management_code_reissued' as const,
    payload: {
      reservationId,
      to: 'customer@example.test',
      managementCode: 'EYEX-654321',
      reservationNumber: 'EYEX-20260826-0001',
    },
  }
}

function request(body: unknown, key = INTERNAL_KEY): Request {
  return new Request(`${BASE}/api/internal/send`, {
    method: 'POST',
    headers: internalHeaders(key),
    body: JSON.stringify(body),
  })
}

function configuredEnv() {
  return {
    ...env,
    INTERNAL_KEY,
    MAIL_FROM: 'EYEX <no-reply@example.test>',
    RESEND_API_KEY: 're_test_key',
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('notifier internal send API', () => {
  it('rejects a request without the shared internal key', async () => {
    const response = await SELF.fetch(`${BASE}/api/internal/send`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(confirmedJob()),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
  })

  it('fails closed with 502 when mail delivery is not configured', async () => {
    const response = await SELF.fetch(request(confirmedJob()))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ error: 'send_failed' })
  })

  it('rejects unknown notification types before attempting delivery', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const response = await SELF.fetch(
      request({ ...confirmedJob(), type: 'account.password_reset' }),
    )

    expect(response.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('accepts the reservation and management-code contracts as strict payloads', () => {
    expect(ReservationConfirmedEmail.parse(confirmedJob().payload)).toMatchObject({
      reservationId,
      managementCode: 'EYEX-123456',
    })
    expect(ManagementCodeReissuedEmail.parse(reissuedJob().payload)).toMatchObject({
      reservationId,
      managementCode: 'EYEX-654321',
    })
    expect(
      ReservationConfirmedEmail.safeParse({ ...confirmedJob().payload, unexpected: true }).success,
    ).toBe(false)
  })

  it('sends a confirmation email through Resend with a tenant-namespaced idempotency key', async () => {
    const resend = vi.fn<FetchCall>(
      async () => new Response(JSON.stringify({ id: 'email-1' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', resend)
    const job = confirmedJob()

    const response = await app.fetch(request(job), configuredEnv())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'sent', id: job.id })
    expect(resend).toHaveBeenCalledTimes(1)
    const url = resend.mock.calls[0]?.[0]
    const init = resend.mock.calls[0]?.[1]
    expect(url).toBe('https://api.resend.com/emails')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer re_test_key')
    expect(new Headers(init?.headers).get('user-agent')).toBe('eyex-notifier/1.0')
    expect(new Headers(init?.headers).get('idempotency-key')).toMatch(/^eyex:[a-f0-9]{64}$/)
    await expect(new Response(init?.body).json()).resolves.toMatchObject({
      from: 'EYEX <no-reply@example.test>',
      to: ['customer@example.test'],
      subject: expect.stringContaining('予約'),
    })
  })

  it('does not deduplicate equal job ids from different organizations', async () => {
    const resend = vi.fn<FetchCall>(
      async () => new Response(JSON.stringify({ id: crypto.randomUUID() }), { status: 200 }),
    )
    const id = `reservation:${crypto.randomUUID()}`
    const first = confirmedJob(id)
    const second = { ...confirmedJob(id), organizationId: crypto.randomUUID() }

    const results = await Promise.all([
      deliverNotification(first, configuredEnv(), resend),
      deliverNotification(second, configuredEnv(), resend),
    ])

    expect(results).toEqual([
      { status: 'sent', id },
      { status: 'sent', id },
    ])
    expect(resend).toHaveBeenCalledTimes(2)
    const keys = resend.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('idempotency-key'),
    )
    expect(keys[0]).not.toBe(keys[1])
  })

  it('sends a company-issued management-code email with its dedicated subject', async () => {
    const resend = vi.fn<FetchCall>(
      async () => new Response(JSON.stringify({ id: 'email-issued' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', resend)
    const job = {
      id: `management-code:${crypto.randomUUID()}`,
      organizationId: crypto.randomUUID(),
      type: 'reservation.management_code_issued' as const,
      payload: {
        reservationId,
        to: 'customer@example.test',
        managementCode: 'EYEX-000111',
      },
    }

    const response = await app.fetch(request(job), configuredEnv())

    expect(response.status).toBe(200)
    const init = resend.mock.calls[0]?.[1]
    await expect(new Response(init?.body).json()).resolves.toMatchObject({
      subject: 'EYEX 予約管理コードのお知らせ',
    })
  })

  it('does not send the same idempotency key twice within the KV TTL', async () => {
    const resend = vi.fn<FetchCall>(
      async () => new Response(JSON.stringify({ id: 'email-2' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', resend)
    const job = reissuedJob(`management-code:${crypto.randomUUID()}`)

    const first = await app.fetch(request(job), configuredEnv())
    const second = await app.fetch(request(job), configuredEnv())

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    await expect(second.json()).resolves.toEqual({ status: 'duplicate', id: job.id })
    expect(resend).toHaveBeenCalledTimes(1)
    const key = new Headers(resend.mock.calls[0]?.[1]?.headers).get('idempotency-key')!
    await expect(env.DEDUPE.get(key).then((value) => JSON.parse(value ?? ''))).resolves.toEqual({
      status: 'sent',
      payloadHash: expect.any(String),
    })
  })

  it('rejects the same job id when the validated payload hash changes', async () => {
    const resend = vi.fn<FetchCall>(
      async () => new Response(JSON.stringify({ id: 'email-conflict' }), { status: 200 }),
    )
    vi.stubGlobal('fetch', resend)
    const job = confirmedJob(`reservation:${crypto.randomUUID()}`)
    const changedJob = {
      ...job,
      payload: { ...job.payload, managementCode: 'EYEX-999999' },
    }

    const first = await app.fetch(request(job), configuredEnv())
    const conflicting = await app.fetch(request(changedJob), configuredEnv())

    expect(first.status).toBe(200)
    expect(conflicting.status).toBe(409)
    await expect(conflicting.json()).resolves.toEqual({ error: 'idempotency_conflict' })
    expect(resend).toHaveBeenCalledTimes(1)
  })

  it('leaves no dedupe marker after an external delivery failure so a retry can recover', async () => {
    const resend = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'upstream' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'email-3' }), { status: 200 }))
    vi.stubGlobal('fetch', resend)
    const job = confirmedJob(`reservation:${crypto.randomUUID()}`)

    const failed = await app.fetch(request(job), configuredEnv())
    const retried = await app.fetch(request(job), configuredEnv())

    expect(failed.status).toBe(502)
    expect(retried.status).toBe(200)
    expect(resend).toHaveBeenCalledTimes(2)
    const key = new Headers(resend.mock.calls[1]?.[1]?.headers).get('idempotency-key')!
    await expect(env.DEDUPE.get(key).then((value) => JSON.parse(value ?? ''))).resolves.toEqual({
      status: 'sent',
      payloadHash: expect.any(String),
    })
  })

  it('returns a delivery failure when Resend rejects the request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })),
    )

    const response = await app.fetch(request(reissuedJob()), configuredEnv())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'send_failed' })
  })

  it('returns retryable in-progress when Resend is processing the same idempotency key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ name: 'concurrent_idempotent_requests' }), { status: 409 }),
      ),
    )

    const response = await app.fetch(request(reissuedJob()), configuredEnv())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'idempotency_in_progress' })
  })

  it('fails closed for a non-idempotency Resend conflict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ name: 'resource_locked' }), { status: 409 })),
    )

    const response = await app.fetch(request(reissuedJob()), configuredEnv())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'send_failed' })
  })

  it('returns a non-retryable conflict when Resend rejects an idempotency key with a changed payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ name: 'invalid_idempotent_request' }), { status: 409 }),
      ),
    )

    const response = await app.fetch(request(reissuedJob()), configuredEnv())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'idempotency_conflict' })
  })

  it('accepts only one email when two Workers submit the same job concurrently', async () => {
    let releaseFirstRequest: (() => void) | undefined
    const firstRequestAccepted = new Promise<void>((resolve) => {
      releaseFirstRequest = resolve
    })
    let activeRequest = false
    const resend = vi.fn<FetchCall>(async () => {
      if (activeRequest) {
        return new Response(JSON.stringify({ name: 'concurrent_idempotent_requests' }), {
          status: 409,
        })
      }
      activeRequest = true
      await firstRequestAccepted
      return new Response(JSON.stringify({ id: 'email-concurrent' }), { status: 200 })
    })
    const job = confirmedJob(`reservation:${crypto.randomUUID()}`)

    const first = deliverNotification(job, configuredEnv(), resend)
    await vi.waitFor(() => expect(resend).toHaveBeenCalledTimes(1))
    const second = deliverNotification(job, configuredEnv(), resend)
    await vi.waitFor(() => expect(resend).toHaveBeenCalledTimes(2))
    releaseFirstRequest?.()

    const responses = await Promise.all([first, second])
    expect(responses).toContainEqual({ status: 'sent', id: job.id })
    expect(responses).toContainEqual({ status: 'failed', reason: 'in_progress' })
    const idempotencyKeys = resend.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('idempotency-key'),
    )
    expect(new Set(idempotencyKeys)).toEqual(
      new Set([expect.stringMatching(/^eyex:[a-f0-9]{64}$/)]),
    )
  })

  it('returns a delivery failure when the Resend request cannot be made', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const response = await app.fetch(request(reissuedJob()), configuredEnv())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'send_failed' })
  })

  it('fails closed when the dedupe read is unavailable', async () => {
    const bindings = {
      ...configuredEnv(),
      DEDUPE: { get: vi.fn().mockRejectedValue(new Error('kv unavailable')) },
    } as unknown as Bindings

    const result = await deliverNotification(confirmedJob(), bindings, vi.fn())

    expect(result).toEqual({ status: 'failed', reason: 'dedupe' })
  })

  it('returns a failure when the email was accepted but the dedupe write is unavailable', async () => {
    const bindings = {
      ...configuredEnv(),
      DEDUPE: {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockRejectedValue(new Error('kv unavailable')),
      },
    } as unknown as Bindings

    const result = await deliverNotification(
      confirmedJob(),
      bindings,
      vi.fn(async () => new Response(JSON.stringify({ id: 'email-kv' }), { status: 200 })),
    )

    expect(result).toEqual({ status: 'failed', reason: 'dedupe' })
  })

  it('escapes optional email fields and falls back to the reservation id', async () => {
    const resend = vi.fn<FetchCall>(
      async () => new Response(JSON.stringify({ id: 'email-escaped' }), { status: 200 }),
    )
    const job = {
      id: `reservation:${crypto.randomUUID()}`,
      organizationId: crypto.randomUUID(),
      type: 'reservation.confirmed' as const,
      payload: {
        reservationId,
        to: 'customer@example.test',
        managementCode: `code<'&"`,
        storeName: `店<&>'"`,
      },
    }

    const result = await deliverNotification(job, configuredEnv(), resend)

    expect(result).toEqual({ status: 'sent', id: job.id })
    const init = resend.mock.calls[0]?.[1]
    const body = JSON.stringify(JSON.parse(String(init?.body)))
    expect(body).toContain('&amp;')
    expect(body).toContain('&lt;')
    expect(body).toContain('&gt;')
    expect(body).toContain('&#39;')
    expect(body).toContain('&quot;')
    expect(body).toContain(reservationId)
  })

  it('does not expose the email payload or upstream response body in the error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('secret-upstream-body', { status: 500 })),
    )

    const response = await app.fetch(request(confirmedJob()), configuredEnv())
    const body = await response.text()

    expect(response.status).toBe(502)
    expect(body).not.toContain('secret-upstream-body')
    expect(body).not.toContain('EYEX-123456')
  })
})

describe('notifier health', () => {
  it('is available without the internal key', async () => {
    const response = await SELF.fetch(`${BASE}/api/health`)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })
})

describe('NotificationJob contract', () => {
  it('requires a bounded id and a supported payload', () => {
    expect(NotificationJob.safeParse(confirmedJob()).success).toBe(true)
    expect(NotificationJob.safeParse({ ...confirmedJob(), id: ' ' }).success).toBe(false)
    expect(
      NotificationJob.safeParse({
        ...confirmedJob(),
        payload: { ...confirmedJob().payload, to: 'not-an-email' },
      }).success,
    ).toBe(false)
  })
})
