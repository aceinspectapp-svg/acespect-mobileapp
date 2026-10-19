import net from 'node:net';
import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

/**
 * Makes `req.ip` the visitor's real address.
 *
 * Behind Railway, Express works the address out from X-Forwarded-For and the `trust proxy` setting, which needs the number of proxies in
 * front to be known and fixed. Railway does not promise that, and in practice the address Express lands on is one of Railway's own
 * servers -- the same few addresses for every visitor -- so every per-address rate limit was shared by everyone (and the security log
 * recorded the wrong address). Railway's edge overwrites X-Real-IP with the real client address on every request it forwards, which is the
 * header its staff point to for this, so when CLIENT_IP_HEADER names it, that is what `req.ip` becomes.
 *
 * Only a well-formed IP address is accepted; anything else leaves Express's own value alone. Where no proxy is in front (development,
 * tests) CLIENT_IP_HEADER is empty and nothing changes.
 */
export function clientIp(req: Request, _res: Response, next: NextFunction): void {
  const name = env.CLIENT_IP_HEADER.trim().toLowerCase();
  if (name) {
    const raw = req.headers[name];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.split(',')[0]?.trim();
    if (value && net.isIP(value)) Object.defineProperty(req, 'ip', { value, configurable: true, enumerable: true });
  }
  next();
}
