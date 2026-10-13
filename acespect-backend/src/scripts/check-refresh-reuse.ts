/**
 * Checks the login renewal (refresh token) rules, against a scratch database:
 *
 *   DATABASE_URL=postgresql://user:pass@localhost:5432/scratch?schema=public npm run check:refresh-reuse
 *
 * A refresh token works once, but a renewal whose answer was lost (a restart mid-request, a dropped connection) or two tabs renewing at the
 * same moment must not end the session: for a short leeway after a token was swapped, it still renews. After that, or after any other kind of
 * revocation (sign-out, sign-out everywhere, a deactivated account), it must be refused.
 */
import { prisma } from '../lib/prisma';
import { authService, revokeAllSessions } from '../modules/auth/auth.service';

let failures = 0;
const check = (ok: boolean, what: string, detail = ''): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
};
const refused = async (token: string): Promise<string | null> => {
  try {
    await authService.refresh(token, { appClient: 'web' });
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

async function newSession(label: string) {
  const email = `refresh-check-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const r = await authService.register({ email, password: 'Refresh-Check-123!', name: 'Refresh Check' } as never);
  return { userId: r.user.id, token: r.refreshToken };
}

async function main() {
  const made: string[] = [];
  try {
    // 1. a swapped token still renews, once more, straight away (a lost answer / a second tab)
    const a = await newSession('a'); made.push(a.userId);
    const first = await authService.refresh(a.token, { appClient: 'web' });
    check(!!first.refreshToken && first.refreshToken !== a.token, 'a refresh hands out a new token');
    const again = await refused(a.token);
    check(again === null, 'the token that was just swapped still renews (an answer lost on the way does not end the session)', again ?? '');

    // 2. two renewals with the same token at the same moment both succeed
    const b = await newSession('b'); made.push(b.userId);
    const both = await Promise.allSettled([authService.refresh(b.token, { appClient: 'web' }), authService.refresh(b.token, { appClient: 'web' })]);
    check(both.every((x) => x.status === 'fulfilled'), 'two tabs renewing together both get a login', both.map((x) => x.status).join(', '));

    // 3. after the leeway it is refused
    await prisma.refreshToken.updateMany({ where: { userId: a.userId, rotatedAt: { not: null } }, data: { rotatedAt: new Date(Date.now() - 5 * 60_000) } });
    const late = await refused(a.token);
    check(late === 'INVALID_REFRESH_TOKEN', 'a swapped token is refused once the leeway has passed', late ?? 'was accepted');

    // 4. signing out everywhere ends the leeway too
    const c = await newSession('c'); made.push(c.userId);
    await authService.refresh(c.token, { appClient: 'web' });
    await revokeAllSessions(c.userId, 'check');
    const afterAll = await refused(c.token);
    check(afterAll === 'INVALID_REFRESH_TOKEN', 'after "sign out everywhere", the swapped token is refused at once', afterAll ?? 'was accepted');

    // 5. an ordinary sign-out is never reusable
    const d = await newSession('d'); made.push(d.userId);
    await authService.logout(d.token);
    const afterLogout = await refused(d.token);
    check(afterLogout === 'INVALID_REFRESH_TOKEN', 'a signed-out token is refused', afterLogout ?? 'was accepted');

    // 6. a deactivated account is refused, even inside the leeway
    const e = await newSession('e'); made.push(e.userId);
    await authService.refresh(e.token, { appClient: 'web' });
    await prisma.user.update({ where: { id: e.userId }, data: { isActive: false } });
    const inactive = await refused(e.token);
    check(inactive === 'INVALID_REFRESH_TOKEN', 'a deactivated account is refused', inactive ?? 'was accepted');

    // 7. an unknown token is refused
    check((await refused('0'.repeat(96))) === 'INVALID_REFRESH_TOKEN', 'an unknown token is refused');
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: made } } });
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
  process.exitCode = failures ? 1 : 0;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
