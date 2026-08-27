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
