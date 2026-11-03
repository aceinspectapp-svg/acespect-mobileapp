/**
 * End-to-end check of Houspect user management (Admin -> Users), through the real HTTP routes of an in-process app:
 * adding each role, invitation and activation, role changes, switching accounts off and on, hand-over of a reviewer's open reviews, the
 * last-admin / self / QC-managed protections, resent invitations, password reset links, closed self sign-up, two-step sign-in for platform
 * roles, who may do what, and the audit trail. A tiny stand-in mail server lets it prove that when email works the link goes to the person
 * and is not shown to the administrator. It creates real rows, so it refuses to run against anything but a local database:
 *
 *   DATABASE_URL=postgresql://...@localhost:5433/qc_scratch npm run check:user-management
 */
import net, { AddressInfo } from 'net';

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  console.error('Refusing to run: DATABASE_URL must point at a local scratch database.');
  process.exit(1);
}
process.env.RATE_LIMIT_OFF = '1';
process.env.SELF_SIGNUP = 'off';
process.env.QC_JOBS = 'off';

let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 300) : ''}`);
};

// ── a stand-in mail server: accepts everything and keeps what it was sent ──
const mails: Array<{ to: string; data: string }> = [];
function startMailServer(): Promise<net.Server> {
  const server = net.createServer((sock) => {
    let to = '';
    let inData = false;
    let data = '';
    let buf = '';
    sock.write('220 stub ESMTP\r\n');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === '.') { inData = false; mails.push({ to, data }); data = ''; sock.write('250 queued\r\n'); } else data += (line.startsWith('..') ? line.slice(1) : line) + '\n';
          continue;
        }
        const cmd = line.toUpperCase();
        if (cmd.startsWith('EHLO') || cmd.startsWith('HELO')) sock.write('250 stub\r\n');
        else if (cmd.startsWith('MAIL FROM')) sock.write('250 ok\r\n');
        else if (cmd.startsWith('RCPT TO')) { to = line.replace(/^RCPT TO:\s*<?/i, '').replace(/>.*$/, ''); sock.write('250 ok\r\n'); }
        else if (cmd === 'DATA') { inData = true; sock.write('354 go\r\n'); }
        else if (cmd === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function main() {
  const mailServer = await startMailServer();
  process.env.SMTP_URL = `smtp://127.0.0.1:${(mailServer.address() as AddressInfo).port}`;

  const { createApp } = await import('../app');
  const { prisma } = await import('../lib/prisma');
  const { env } = await import('../config/env');
  const { usersService } = await import('../modules/web/users.service');
  const { drainAudit } = await import('../lib/auditTrail');

  const app = createApp();
  const server = app.listen(0);
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  interface Res { status: number; body: any }
  async function api(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<Res> {
    const headers: Record<string, string> = {};
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(BASE + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const text = await res.text();
    let body: any = text;
    try { body = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: res.status, body };
  }
  const code = (r: Res) => r.body?.error?.code;

  const sfx = Date.now().toString().slice(-6);
  const PW = 'Str0ng-Passw0rd!';
  const email = (n: string) => `um.${n}.${sfx}@example.com`;
  const linkIn = (to: string) => {
    const m = [...mails].reverse().find((x) => x.to.toLowerCase() === to.toLowerCase());
    // Mail bodies are quoted-printable: long lines are wrapped with "=" and "=3D" stands for "=".
    const text = m?.data.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_x, h: string) => String.fromCharCode(parseInt(h, 16)));
    return text?.match(/https?:\/\/\S+\/(?:accept|reset)\/[A-Za-z0-9_-]+/)?.[0];
  };
  const tokenOf = (url: string) => url.split('/').pop()!;
  const accept = (url: string, password = PW) => api('POST', `/auth/invitations/${tokenOf(url)}/accept`, { body: { password, acceptTerms: true } });
  const login = (e: string, password = PW) => api('POST', '/auth/login', { body: { email: e, password } });

  // The seeded Super Admin is the first administrator.
  const seed = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  const adminLogin = await login(seed.email, 'Admin123456!x');
  ok(adminLogin.status === 200 && adminLogin.body.accessToken, 'the first administrator signs in', adminLogin.body);
  const admin = adminLogin.body.accessToken as string;

  console.log('Sign-up is closed');
  const reg = await api('POST', '/auth/register', { body: { email: email('walkin'), password: PW, name: 'Walk In' } });
  ok(reg.status === 403 && code(reg) === 'SIGNUP_DISABLED', 'the phone cannot create an account', reg.body);
  const cfg = await api('GET', '/auth/sso/config');
  ok(cfg.body.selfSignup === false, 'the phone is told sign-up is closed', cfg.body);
  ok(!(await prisma.user.findUnique({ where: { email: email('walkin') } })), 'and no account was made');

  console.log('Adding people (email works: the link goes to the person, not to the administrator)');
  const addInspector = await api('POST', '/web/users', { token: admin, body: { name: 'Ivy Inspector', email: email('insp'), role: 'inspector', phone: '0412345678', licenseNumber: 'DBU-1' } });
  ok(addInspector.status === 201 && addInspector.body.user.status === 'invited', 'admin adds an inspector', addInspector.body);
  ok(addInspector.body.invitation.mail === 'SENT' && !addInspector.body.invitation.url, 'the invitation is emailed and the link is not shown to the admin', addInspector.body.invitation);
  const inspLink = linkIn(email('insp'));
  ok(!!inspLink, 'the person received the link by email');
  const preLogin = await login(email('insp'), 'anything-at-all-1');
  ok(preLogin.status === 401, 'nobody can sign in before activating (no password is known)', preLogin.status);
  const dup = await api('POST', '/web/users', { token: admin, body: { name: 'Dup', email: email('insp').toUpperCase(), role: 'reviewer' } });
  ok(dup.status === 409 && code(dup) === 'EMAIL_TAKEN', 'the same email twice is refused (any capitalisation)', dup.body);
  const badEmail = await api('POST', '/web/users', { token: admin, body: { name: 'X', email: 'not-an-email', role: 'reviewer' } });
  ok(badEmail.status === 400, 'an invalid email is refused', badEmail.status);
  const badRole = await api('POST', '/web/users', { token: admin, body: { name: 'X', email: email('x'), role: 'superuser' } });
  ok(badRole.status === 400, 'an unknown role is refused', badRole.status);

  const shortPw = await accept(inspLink!, 'short');
  ok(shortPw.status === 400, 'a password under 12 characters is refused', shortPw.status);
  const noTerms = await api('POST', `/auth/invitations/${tokenOf(inspLink!)}/accept`, { body: { password: PW, acceptTerms: false } });
  ok(noTerms.status === 400, 'terms must be accepted', noTerms.status);
  const act1 = await accept(inspLink!);
  ok(act1.status === 200 && act1.body.accessToken && act1.body.user.role === 'INSPECTOR', 'the inspector activates and is signed in as an inspector', act1.body);
  const inspTok = act1.body.accessToken as string;
  const inspRefresh = act1.body.refreshToken as string;
  const again = await accept(inspLink!);
  ok(again.status === 410, 'the link works once', again.status);

  const addReviewer = await api('POST', '/web/users', { token: admin, body: { name: 'Rita Reviewer', email: email('rev'), role: 'reviewer' } });
  const revTok = (await accept(linkIn(email('rev'))!)).body.accessToken as string;
  const addReviewer2 = await api('POST', '/web/users', { token: admin, body: { name: 'Ron Reviewer', email: email('rev2'), role: 'reviewer' } });
  const rev2Tok = (await accept(linkIn(email('rev2'))!)).body.accessToken as string;
  ok(addReviewer.status === 201 && addReviewer2.status === 201 && !!revTok && !!rev2Tok, 'two reviewers are added and activated');
  const revCan = await api('GET', '/web/assignments', { token: revTok });
  ok(revCan.status === 200, 'a reviewer can use the review screens', revCan.status);

  console.log('Who may do what');
  const byInsp = await api('POST', '/web/users', { token: inspTok, body: { name: 'N', email: email('n1'), role: 'inspector' } });
  const byRev = await api('POST', '/web/users', { token: revTok, body: { name: 'N', email: email('n2'), role: 'inspector' } });
  ok(byInsp.status === 403 && byRev.status === 403, 'only an administrator can add people', [byInsp.status, byRev.status]);
  const anonymous = await api('POST', '/web/users', { body: { name: 'N', email: email('n3'), role: 'inspector' } });
  ok(anonymous.status === 401, 'signing in is required', anonymous.status);
  const listAdmin = await api('GET', '/web/users', { token: admin });
  const rowOf = (r: Res, e: string) => r.body.users.find((u: any) => u.email === e);
  ok(rowOf(listAdmin, email('insp'))?.status === 'active' && rowOf(listAdmin, email('insp'))?.lastSignInAt, 'the admin list shows status and last sign-in', rowOf(listAdmin, email('insp')));
  const listRev = await api('GET', '/web/users', { token: revTok });
  ok(listRev.status === 200 && rowOf(listRev, email('insp')) && !('lastSignInAt' in rowOf(listRev, email('insp'))), 'a reviewer sees names but not sign-in details', rowOf(listRev, email('insp')));

  console.log('Role changes and hand-over of open reviews');
  const inspector = await prisma.user.findUniqueOrThrow({ where: { email: email('insp') } });
  const reviewer = await prisma.user.findUniqueOrThrow({ where: { email: email('rev') } });
  const reviewer2 = await prisma.user.findUniqueOrThrow({ where: { email: email('rev2') } });
  const mkInspection = (status: 'SUBMITTED' | 'IN_REVIEW' | 'APPROVED', rid: string | null, job: string) =>
    prisma.inspection.create({ data: { inspectorId: inspector.id, reviewerId: rid, status, jobNo: `${job}-${sfx}`, inspectionType: 'Dilapidation', propertyType: 'Commercial Properties' } as never });
  const open1 = await mkInspection('SUBMITTED', reviewer.id, 'UM-1');
  const open2 = await mkInspection('IN_REVIEW', reviewer.id, 'UM-2');
  const done = await mkInspection('APPROVED', reviewer.id, 'UM-3');
  const selfRole = await api('POST', `/web/users/${seed.id}/role`, { token: admin, body: { role: 'reviewer' } });
  ok(selfRole.status === 409 && code(selfRole) === 'SELF', 'an administrator cannot change their own role', selfRole.body);
  const badTarget = await api('POST', `/web/users/${reviewer.id}/role`, { token: admin, body: { role: 'inspector', reassignToId: inspector.id } });
  ok(badTarget.status === 400, 'open reviews can only be handed to an active reviewer', badTarget.body);
  const demote = await api('POST', `/web/users/${reviewer.id}/role`, { token: admin, body: { role: 'inspector', reassignToId: reviewer2.id } });
  ok(demote.status === 200 && demote.body.user.role === 'inspector' && demote.body.handedBack === 2, 'a reviewer becomes an inspector and two open reviews are handed on', demote.body);
  const moved = await prisma.inspection.findMany({ where: { id: { in: [open1.id, open2.id, done.id] } }, select: { id: true, reviewerId: true } });
  ok(moved.find((i) => i.id === open1.id)?.reviewerId === reviewer2.id && moved.find((i) => i.id === open2.id)?.reviewerId === reviewer2.id, 'the open reviews now belong to the other reviewer');
  ok(moved.find((i) => i.id === done.id)?.reviewerId === reviewer.id, 'finished reviews keep their reviewer on record');
  const revNow = await api('GET', '/web/assignments', { token: revTok });
  ok(revNow.status === 403, 'the change applies on their very next request, without signing out', revNow.status);
  const promote = await api('POST', `/web/users/${reviewer.id}/role`, { token: admin, body: { role: 'reviewer' } });
  ok(promote.status === 200 && (await api('GET', '/web/assignments', { token: revTok })).status === 200, 'and back to reviewer works the same way', promote.body);
  const same = await api('POST', `/web/users/${reviewer.id}/role`, { token: admin, body: { role: 'reviewer' } });
  ok(same.status === 200 && same.body.handedBack === 0, 'asking for the role they already have changes nothing');

  console.log('Switching an account off and on');
  const hold = await mkInspection('SUBMITTED', reviewer2.id, 'UM-4');
  const meBefore = await api('GET', '/auth/me', { token: inspTok });
  ok(meBefore.status === 200, 'the inspector is signed in');
  const off = await api('POST', `/web/users/${inspector.id}/deactivate`, { token: admin, body: { reason: 'Left the company' } });
  ok(off.status === 200 && off.body.user.status === 'deactivated' && off.body.user.deactivationReason === 'Left the company', 'admin switches the inspector off with a reason', off.body);
  ok((await api('GET', '/auth/me', { token: inspTok })).status === 401, 'their access token stops working at once');
  const ref = await api('POST', '/auth/refresh', { body: { refreshToken: inspRefresh } });
  ok(ref.status === 401, 'and so does their refresh token', ref.body);
  const logAgain = await login(email('insp'));
  ok(logAgain.status === 403 && code(logAgain) === 'ACCOUNT_INACTIVE', 'signing in again says the account is switched off', logAgain.body);
  const off2 = await api('POST', `/web/users/${inspector.id}/deactivate`, { token: admin, body: {} });
  ok(off2.status === 200, 'switching off twice is harmless');
  const on = await api('POST', `/web/users/${inspector.id}/reactivate`, { token: admin });
  ok(on.status === 200 && on.body.user.status === 'active' && on.body.needsInvitation === false, 'admin switches them back on', on.body);
  ok((await login(email('insp'))).status === 200, 'they sign in with the same password as before');
  const offRev = await api('POST', `/web/users/${reviewer2.id}/deactivate`, { token: admin, body: { reason: 'On leave' } });
  ok(offRev.status === 200 && offRev.body.handedBack >= 2, 'switching off a reviewer with no replacement named returns their open reviews', offRev.body);
  const back = await prisma.inspection.findUniqueOrThrow({ where: { id: hold.id }, select: { reviewerId: true } });
  ok(back.reviewerId === null, 'to the unassigned queue');
  await api('POST', `/web/users/${reviewer2.id}/reactivate`, { token: admin });

  console.log('Protections');
  const offSelf = await api('POST', `/web/users/${seed.id}/deactivate`, { token: admin, body: {} });
  ok(offSelf.status === 409 && code(offSelf) === 'SELF', 'an administrator cannot switch themselves off', offSelf.body);
  const addAdmin = await api('POST', '/web/users', { token: admin, body: { name: 'Ada Admin', email: email('adm'), role: 'admin' } });
  const admin2 = (await accept(linkIn(email('adm'))!)).body.accessToken as string;
  ok(addAdmin.status === 201 && !!admin2 && addAdmin.body.user.role === 'admin', 'an administrator can add another administrator');
  const a2 = await prisma.user.findUniqueOrThrow({ where: { email: email('adm') } });
  const offA2 = await api('POST', `/web/users/${a2.id}/deactivate`, { token: admin, body: {} });
  ok(offA2.status === 200, 'with two administrators one can be switched off');
  const guard = await usersService.deactivate(seed.id, {}, { id: reviewer.id, role: 'REVIEWER' }).then(() => 'allowed', (e: { code?: string }) => e.code);
  ok(guard === 'LAST_ADMIN', 'the last active administrator cannot be switched off', guard);
  const guard2 = await usersService.changeRole(seed.id, 'inspector', null, { id: reviewer.id, role: 'REVIEWER' }).then(() => 'allowed', (e: { code?: string }) => e.code);
  ok(guard2 === 'LAST_ADMIN', 'or demoted', guard2);
  await api('POST', `/web/users/${a2.id}/reactivate`, { token: admin });

  const qcUser = await api('POST', '/web/users', { token: admin, body: { name: 'Quin QC', email: email('qc'), role: 'inspector' } });
  const qc = await prisma.user.findUniqueOrThrow({ where: { email: email('qc') } });
  const client = await prisma.qcClient.create({ data: { name: `UM Client ${sfx}`, data: {} } });
  await prisma.qcMembership.create({ data: { userId: qc.id, clientId: client.id, role: 'PRIVATE_INSPECTOR' } });
  const qcOff = await api('POST', `/web/users/${qc.id}/deactivate`, { token: admin, body: {} });
  const qcRole = await api('POST', `/web/users/${qc.id}/role`, { token: admin, body: { role: 'reviewer' } });
  ok(qcUser.status === 201 && qcOff.status === 409 && code(qcOff) === 'QC_MANAGED' && qcRole.status === 409, 'someone who also holds a QC role is managed on the QC page, not here', [qcOff.body, qcRole.body]);
  const qcListed = rowOf(await api('GET', '/web/users', { token: admin }), email('qc'));
  ok(qcListed?.qcManaged === true, 'and the list says so');
  const cl = await prisma.user.findFirstOrThrow({ where: { role: 'CLIENT' } }).catch(() => null);
  if (cl) ok((await api('POST', `/web/users/${cl.id}/deactivate`, { token: admin, body: {} })).status === 404, 'QC-only accounts (client users) are not touched by this page');

  console.log('Invitations and password help');
  const addLate = await api('POST', '/web/users', { token: admin, body: { name: 'Lee Late', email: email('late'), role: 'inspector' } });
  const firstLink = linkIn(email('late'))!;
  const lateUser = await prisma.user.findUniqueOrThrow({ where: { email: email('late') } });
  const resend = await api('POST', `/web/users/${lateUser.id}/invitation`, { token: admin });
  const secondLink = linkIn(email('late'))!;
  ok(addLate.status === 201 && resend.status === 200 && secondLink !== firstLink && !resend.body.invitation.url, 'a resent invitation is emailed as a new link', resend.body);
  ok((await accept(firstLink)).status === 410, 'and the earlier link stops working');
  const resetBefore = await api('POST', `/web/users/${lateUser.id}/password-reset`, { token: admin });
  ok(resetBefore.status === 409 && code(resetBefore) === 'NOT_ACTIVATED', 'a reset link is not offered before the person has activated', resetBefore.body);
  ok((await accept(secondLink)).status === 200, 'the new link activates the account');
  const resendLate = await api('POST', `/web/users/${lateUser.id}/invitation`, { token: admin });
  ok(resendLate.status === 409 && code(resendLate) === 'ALREADY_ACTIVATED', 'an activated account is not sent another invitation', resendLate.body);
  const reset = await api('POST', `/web/users/${lateUser.id}/password-reset`, { token: admin });
  ok(reset.status === 200 && reset.body.reset.mail === 'SENT' && !reset.body.reset.url, 'a password reset link is emailed to the person, not shown', reset.body);
  const resetLink = linkIn(email('late'))!;
  const newPw = 'Another-Str0ng-One!';
  const doReset = await api('POST', `/auth/password/reset`, { body: { token: tokenOf(resetLink), password: newPw } });
  ok(doReset.status === 204 || doReset.status === 200, 'the reset link sets a new password', doReset.body);
  ok((await login(email('late'), newPw)).status === 200 && (await login(email('late'))).status === 401, 'which works, and the old password does not');

  const addTemp = await api('POST', '/web/users', { token: admin, body: { name: 'Tia Temp', email: email('temp'), role: 'reviewer' } });
  const tmp = await prisma.user.findUniqueOrThrow({ where: { email: email('temp') } });
  const cancelOk = await api('DELETE', `/web/users/${tmp.id}/invitation`, { token: admin });
  ok(addTemp.status === 201 && cancelOk.status === 204 && !(await prisma.user.findUnique({ where: { id: tmp.id } })), 'an unused invitation can be cancelled and the account removed');
  const cancelUsed = await api('DELETE', `/web/users/${inspector.id}/invitation`, { token: admin });
  ok(cancelUsed.status === 409, 'an account that has been used cannot be deleted', cancelUsed.body);
  const reOffNever = await api('POST', '/web/users', { token: admin, body: { name: 'Nia Never', email: email('never'), role: 'inspector' } });
  const never = await prisma.user.findUniqueOrThrow({ where: { email: email('never') } });
  const neverLink = linkIn(email('never'))!;
  await api('POST', `/web/users/${never.id}/deactivate`, { token: admin, body: {} });
  ok((await accept(neverLink)).status === 410, 'a switched-off person cannot use their unused invitation');
  const reOn = await api('POST', `/web/users/${never.id}/reactivate`, { token: admin });
  ok(reOffNever.status === 201 && reOn.body.needsInvitation === true, 'reactivating someone who never activated says a new invitation is needed', reOn.body);

  console.log('When email is not set up the administrator gets the link once');
  const savedSmtp = env.SMTP_URL;
  env.SMTP_URL = '';
  const addNoMail = await api('POST', '/web/users', { token: admin, body: { name: 'Max NoMail', email: email('nomail'), role: 'inspector' } });
  ok(addNoMail.status === 201 && addNoMail.body.invitation.mail !== 'SENT' && /\/accept\//.test(addNoMail.body.invitation.url ?? ''), 'the link is shown to the administrator instead', addNoMail.body.invitation);
  ok((await accept(addNoMail.body.invitation.url)).status === 200, 'and it activates the account');
  env.SMTP_URL = savedSmtp;

  console.log('Two-step sign-in for platform roles (off unless switched on)');
  const plain = await login(email('rev'));
  ok(plain.status === 200 && plain.body.accessToken, 'by default a reviewer signs in with a password only', plain.body);
  env.MFA_REQUIRED_PLATFORM_ROLES = 'ADMIN,REVIEWER';
  const mfaRev = await login(email('rev'));
  const mfaAdm = await login(seed.email, 'Admin123456!x');
  ok(mfaRev.body.mfaEnrollRequired === true && mfaAdm.body.mfaEnrollRequired === true, 'when switched on, reviewers and admins must set up an authenticator', [mfaRev.body, mfaAdm.body]);
  const mfaInsp = await login(email('insp'));
  ok(mfaInsp.status === 200 && mfaInsp.body.accessToken, 'inspectors on the phone are not affected', mfaInsp.body);
  env.MFA_REQUIRED_PLATFORM_ROLES = '';

  console.log('Audit trail');
  await drainAudit();
  const actions = await prisma.auditEvent.groupBy({ by: ['action'], where: { occurredAt: { gt: new Date(Date.now() - 30 * 60_000) }, action: { startsWith: 'user.' } }, _count: true });
  const have = new Set(actions.map((a) => a.action));
  ok(['user.create', 'user.role_change', 'user.deactivate', 'user.reactivate', 'user.invitation_resent', 'user.password_reset_sent', 'user.delete'].every((a) => have.has(a)), 'every action is on record', [...have]);
  const evt = await prisma.auditEvent.findFirst({ where: { action: 'user.deactivate' }, orderBy: { occurredAt: 'desc' } });
  ok(!!evt && JSON.stringify(evt.after).includes('false') && !!evt.actorId, 'with who did it and the before and after', evt);
  const written = await prisma.auditEvent.findMany({ where: { action: { startsWith: 'user.' }, occurredAt: { gt: new Date(Date.now() - 30 * 60_000) } }, select: { message: true, before: true, after: true, metadata: true } });
  const leak = written.filter((e) => JSON.stringify(e).includes(PW) || JSON.stringify(e).includes('/accept/') || JSON.stringify(e).includes('/reset/')).length;
  ok(leak === 0, 'and no password or link is written into it');

  // tidy up what this check made
  const made = await prisma.user.findMany({ where: { email: { contains: `.${sfx}@example.com` } }, select: { id: true } });
  await prisma.inspection.deleteMany({ where: { jobNo: { endsWith: `-${sfx}` } } });
  await prisma.qcClient.deleteMany({ where: { name: `UM Client ${sfx}` } });
  await prisma.user.deleteMany({ where: { id: { in: made.map((m) => m.id) } } }).catch(() => undefined);

  server.close();
  mailServer.close();
  await prisma.$disconnect();
  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
