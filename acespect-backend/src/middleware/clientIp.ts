import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { bareIp } from '../utils/ipAddress';

/**
 * Makes `req.ip` the visitor's real address.
 *
 * Behind Railway, Express works the address out from X-Forwarded-For and the `trust proxy` setting, which needs the number of proxies in
 * front to be known and fixed. Railway does not promise that, and in practice the address Express lands on is one of Railway's own
 * servers -- the same few addresses for every visitor -- so every per-address rate limit was shared by everyone (and the security log
 * recorded the wrong address). Railway's edge overwrites X-Real-IP with the real client address on every request it forwards, which is the
 * header its staff point to for this, so when CLIENT_IP_HEADER names it, that is what `req.ip` becomes.
 *
 * Behind Azure App Service the front end appends the client as `IP:port` to X-Forwarded-For, and Express (`trust proxy` = 1, the one Azure front
 * end) hands that over as `req.ip` unchanged. A port is not part of an address, so it is dropped here: every use of `req.ip` (the rate limiters,
 * the audit and security logs) gets the bare IP, for IPv4 ("1.2.3.4:5678") and IPv6 ("[::1]:5678") alike.
 *
 * Only a well-formed IP address is accepted; anything else leaves Express's own value alone. Where no proxy is in front (development,
 * tests) CLIENT_IP_HEADER is empty and only the port clean-up applies.
 */
export function clientIp(req: Request, _res: Response, next: NextFunction): void {
  const name = env.CLIENT_IP_HEADER.trim().toLowerCase();
  let value: string | null = null;
  if (name) {
    const raw = req.headers[name];
    value = bareIp((Array.isArray(raw) ? raw[0] : raw)?.split(',')[0]);
  }
  value ??= bareIp(req.ip);
  if (value && value !== req.ip) Object.defineProperty(req, 'ip', { value, configurable: true, enumerable: true });
  next();
}
