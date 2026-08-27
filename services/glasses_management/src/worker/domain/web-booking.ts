const encoder = new TextEncoder()

/** A management code is issued by the company and is never persisted in plaintext. */
export function issueManagementCode(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
}

export async function hashManagementCode(code: string): Promise<string> {
  return hashOpaqueValue(code)
}

export async function hashConfirmationKey(key: string): Promise<string> {
  return hashOpaqueValue(key)
}

export async function hashVerifiedReservationSessionToken(token: string): Promise<string> {
  return hashOpaqueValue(token)
}

async function hashOpaqueValue(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
