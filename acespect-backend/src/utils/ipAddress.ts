import net from 'node:net';

const validPort = (p: string | undefined): boolean => p === undefined || (p.length <= 5 && Number(p) <= 65535);

/**
 * The bare IP address in `value`, or null when it is not one. Azure's front end sends the client address as `IP:port` in X-Forwarded-For,
 * which is not a valid address (express-rate-limit rejects it with ERR_ERL_INVALID_IP_ADDRESS), so the port is dropped:
 * "1.2.3.4:5678" -> "1.2.3.4", "[::1]:5678" -> "::1", "[::1]" -> "::1". A plain IPv4 or IPv6 address is returned unchanged.
 */
export function bareIp(value: string | undefined | null): string | null {
  const v = value?.trim();
  if (!v) return null;
  if (net.isIP(v)) return v;
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(v);
  if (v6?.[1]) return net.isIPv6(v6[1]) && validPort(v6[2]) ? v6[1] : null;
  const v4 = /^([^:]+):(\d+)$/.exec(v);
  if (v4?.[1]) return net.isIPv4(v4[1]) && validPort(v4[2]) ? v4[1] : null;
  return null;
}
