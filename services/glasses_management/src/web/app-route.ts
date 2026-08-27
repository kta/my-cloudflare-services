export function isPublicBookingPath(pathname: string): boolean {
  return pathname === '/book' || pathname === '/book/' || publicBookingSlug(pathname) !== undefined
}

export function publicBookingSlug(pathname: string): string | undefined {
  const match = /^\/book\/([^/]+)$/.exec(pathname)
  if (!match?.[1]) return undefined
  try {
    return decodeURIComponent(match[1])
  } catch {
    return undefined
  }
}

/**
 * A fully shared iPad is handed its terminal id and device token exactly once,
 * in the URL a store manager opens on it. Both are needed: the session API is
 * addressed by terminal id, and the device knows nothing else about itself.
 *
 * They live in memory only. A reload sends the manager back to the entry link,
 * which is deliberate — a device token kept in browser storage would outlive
 * the person who authorised it, and a lost iPad would keep working.
 */
export function isSharedTerminalPath(pathname: string): boolean {
  return sharedTerminalEntry(pathname) !== undefined
}

export function sharedTerminalEntry(
  pathname: string,
): { terminalId: string; token: string } | undefined {
  const match = /^\/terminal\/([^/]+)\/([^/]+)$/.exec(pathname)
  if (!match?.[1] || !match[2]) return undefined
  try {
    return { terminalId: decodeURIComponent(match[1]), token: decodeURIComponent(match[2]) }
  } catch {
    return undefined
  }
}
