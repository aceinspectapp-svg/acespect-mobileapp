/**
 * Checks who the rate limits count, against a running copy of the real API (started here on a spare port), with small limits so it is quick:
 *
 *   DATABASE_URL=postgresql://user:pass@localhost:5432/scratch?schema=public npm run check:rate-limits
 *
 * The limits used to be counted per "address" where that address was one of Railway's own servers, shared by every visitor, so a few people
 * testing together used up 300 requests / 15 minutes for everyone. Here: visitors are told apart by the X-Real-IP header, a signed-in user is
 * counted by user whatever their address, sign-in is limited per account, renewing a login has a generous limit of its own, and photos are exempt.
 */
import type { Server } from 'node:http';

process.env.NODE_ENV = 'test';
process.env.CLIENT_IP_HEADER = 'x-real-ip';
process.env.API_RATE_LIMIT_ANON = '30';
process.env.API_RATE_LIMIT_USER = '8';
process.env.JWT_ACCESS_SECRET ??= 'check-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET ??= 'check-refresh-secret-0123456789abcdef';
delete process.env.RATE_LIMIT_OFF;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (a scratch database) is required');

let failures = 0;
const check = (ok: boolean, what: string, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
};

async function main() {
  const { createApp } = await import('../app');
  const { signAccessToken } = await import('../utils/jwt');
  const { prisma } = await import('../lib/prisma');
  const server: Server = await new Promise((ok) => { const s = createApp().listen(0, () => ok(s)); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1`;

  const hit = async (path: string, init: { ip?: string; token?: string; method?: string; body?: unknown } = {}): Promise<{ status: number; code?: string; wait?: number }> => {
    const res = await fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', ...(init.ip ? { 'X-Real-IP': init.ip } : {}), ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await res.text();
    let code: string | undefined;
    let wait: number | undefined;
    try { const e = JSON.parse(text)?.error; code = e?.code; wait = e?.retryAfterSeconds; } catch { /* plain text */ }
    return { status: res.status, code, wait };
  };
  const run = async (n: number, f: () => Promise<{ status: number; code?: string; wait?: number }>) => { const out = []; for (let i = 0; i < n; i++) out.push(await f()); return out; };
  const statuses = (r: { status: number }[]) => r.map((x) => x.status).join(' ');

  try {
    // 1. visitors are told apart by X-Real-IP: A uses up its 5, B is untouched
    const a = await run(32, () => hit('/web/users', { ip: '203.0.113.10' }));
    check(a.slice(0, 30).every((x) => x.status !== 429) && a.slice(30).every((x) => x.status === 429), 'one visitor is limited after its own 30 requests', `${a.filter((x) => x.status === 429).length} of 32 refused`);
    const b = await run(3, () => hit('/web/users', { ip: '203.0.113.11' }));
    check(b.every((x) => x.status !== 429), 'a different visitor is not affected by the first one', statuses(b));
    check(a[31]!.code === 'RATE_LIMITED' && (a[31]!.wait ?? 0) > 0, 'the refusal is a readable JSON error (RATE_LIMITED) that says how long to wait, not a bare "HTTP 429"', `wait ${a[31]!.wait}s`);

    // 2. a signed-in user is counted as that user, from any address; another user has their own allowance
    const tokenU = signAccessToken({ sub: 'user-aaaa', role: 'INSPECTOR', tv: 0 });
    const u1 = await run(4, () => hit('/web/users', { ip: '203.0.113.20', token: tokenU }));
    const u2 = await run(5, () => hit('/web/users', { ip: '203.0.113.21', token: tokenU }));
    check(u1.every((x) => x.status !== 429) && u2.slice(0, 4).every((x) => x.status !== 429) && u2[4]!.status === 429, 'a user is counted as one person across addresses (limit 8: the 9th is refused)', `${statuses(u1)} | ${statuses(u2)}`);
    const tokenV = signAccessToken({ sub: 'user-bbbb', role: 'INSPECTOR', tv: 0 });
    const v = await run(8, () => hit('/web/users', { ip: '203.0.113.20', token: tokenV }));
    check(v.every((x) => x.status !== 429), 'a second user on the same address has an allowance of their own', statuses(v));
    check(v.length === 8 && (await hit('/web/users', { ip: '203.0.113.30' })).status !== 429, 'and a user running out does not use up the address for visitors without a login');

    // 3. a forged or expired token earns nothing: it is counted by address
    const forged = await run(32, () => hit('/web/users', { ip: '203.0.113.40', token: 'not.a.token' }));
    check(forged.slice(0, 30).every((x) => x.status !== 429) && forged[30]!.status === 429, 'a made-up token is counted by address, not trusted', `${forged.filter((x) => x.status === 429).length} of 32 refused`);

    // 4. a bogus X-Real-IP is ignored (falls back to the connection's own address)
    const bogus = await run(32, () => hit('/web/users', { ip: 'not-an-ip' }));
    check(bogus.slice(0, 30).every((x) => x.status !== 429) && bogus[30]!.status === 429, 'a malformed X-Real-IP is ignored (counted by the connection itself)', `${bogus.filter((x) => x.status === 429).length} of 32 refused`);

    // 5. sign-in is limited per account: one account's failed attempts do not stop another
    const login = (email: string) => hit('/auth/login', { ip: '203.0.113.50', method: 'POST', body: { email, password: 'wrong-password-123' } });
    // only FAILED attempts count, 10 per account and address
    const l1 = await run(12, () => login('one@example.com'));
    check(l1.slice(0, 10).every((x) => x.status !== 429) && l1.slice(10).every((x) => x.status === 429), 'sign-in: one account is limited after 10 failed tries', statuses(l1.slice(8)));
    const l2 = await login('two@example.com');
    check(l2.status !== 429, 'sign-in: a different account from the same address is not locked out', String(l2.status));

    // 6. renewing a login has its own generous limit
    // 28 renewals: well past the sign-in limit (which they must not share), under the general limit of 30 that every request to the API counts toward
    const r = await run(28, () => hit('/auth/refresh', { ip: '203.0.113.60', method: 'POST', body: { refreshToken: 'x'.repeat(96) } }));
    check(r.every((x) => x.status !== 429), '28 login renewals from one address are all allowed (renewing has its own, larger limit)', `${r.filter((x) => x.status === 429).length} refused`);

    // 7. photos are never limited
    const m = await run(30, () => hit('/media/00000000-0000-0000-0000-000000000000', { ip: '203.0.113.70' }));
    check(m.every((x) => x.status !== 429), '30 photo requests from one address are never limited', `${m.filter((x) => x.status === 429).length} refused`);
  } finally {
    server.close();
    await prisma.$disconnect();
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exitCode = failures ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
