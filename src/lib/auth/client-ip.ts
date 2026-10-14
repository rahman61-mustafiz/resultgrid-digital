import { isIP } from "node:net"

/**
 * The client address from an `x-forwarded-for` value, or null. Proxies
 * append to the header, so it can be a comma-separated list (Hostinger
 * sends the same IPv6 address three times); the first entry is the client.
 * Anything that isn't a plain IP is dropped rather than failing the
 * security_events insert (ip_address is `inet`).
 */
export function clientIp(forwardedFor: string | null | undefined): string | null {
  const first = forwardedFor?.split(",")[0]?.trim()
  return first && isIP(first) ? first : null
}
