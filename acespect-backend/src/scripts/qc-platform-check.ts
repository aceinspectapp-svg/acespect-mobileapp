/**
 * End-to-end check of the platform layer, through the real HTTP routes of an
 * in-process app: sign-in hardening, MFA, invitations, tenant isolation,
 * support mode, permissions, SLA / escalation, DLP, templates, inspections,
 * reports and privacy. It creates real rows, so it refuses to run against
 * anything but a local database:
 *   DATABASE_URL=postgresql://...@localhost:5433/qc_scratch npx ts-node --files src/scripts/qc-platform-check.ts
 */
import { AddressInfo } from 'net';
import sharp from 'sharp';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { totp } from '../utils/totp';
import { getForm } from '../modules/qc/spec/qcSpec';
import { runSlaScan } from '../modules/qc/qc.sla.service';
import { runDlpScan } from '../modules/qc/qc.dlp.service';
import { enforceRetention } from '../modules/qc/qc.privacy.service';
import { ensureTemplateReferenceData } from '../modules/qc/qc.templates.service';
import { outbox } from '../lib/mailer';

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  console.error('Refusing to run: DATABASE_URL must point at a local scratch database.');
  process.exit(1);
}

let failures = 0;
const ok = (cond: unknown, label: string, extra?: unknown) => {
  if (!cond) failures++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${!cond && extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 300) : ''}`);
};

const app = createApp();
const server = app.listen(0);
const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;

interface Res { status: number; body: any }
async function api(method: string, path: string, opts: { token?: string; body?: unknown; client?: string; form?: FormData; raw?: boolean } = {}): Promise<Res> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.client) headers['X-Client-Id'] = opts.client;
  let body: string | FormData | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const res = await fetch(BASE + path, { method, headers, body });
  const text = await res.text();
  let parsed: any = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* binary or text */ }
  return { status: res.status, body: opts.raw ? text : parsed };
}
const errCode = (r: Res) => r.body?.error?.code ?? r.body?.code;

const ADDR = { streetNumber: '10', streetName: 'Elm', streetType: 'Street', suburb: 'Melbourne', state: 'VIC', postcode: '3000' };
const PW = 'Str0ng-Passw0rd!';
const sfx = Date.now().toString().slice(-5);
const opt = (form: string, key: string, i = 0) => getForm(form).fields.find((f) => f.key === key)!.options![i]!;
const png = () => sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();

async function login(email: string, password = PW): Promise<Res> {
  return api('POST', '/auth/login', { body: { email, password } });
}

/** Accept the invitation of a freshly created person and return a signed-in token (handles the MFA-enrol step). */
async function activate(inv: { url: string }, email: string): Promise<{ token: string; mfaSecret?: string; backupCodes?: string[] }> {
  const token = inv.url.split('/accept/')[1]!;
  const r = await api('POST', `/auth/invitations/${token}/accept`, { body: { password: PW, acceptTerms: true } });
  if (r.body.mfaEnrollRequired) {
    const start = await api('POST', '/auth/mfa/enroll/start', { body: { mfaToken: r.body.mfaToken } });
    const done = await api('POST', '/auth/mfa/enroll/complete', { body: { mfaToken: r.body.mfaToken, code: totp(start.body.secret) } });
    return { token: done.body.accessToken, mfaSecret: start.body.secret, backupCodes: done.body.backupCodes };
  }
  if (!r.body.accessToken) throw new Error(`activate ${email}: ${JSON.stringify(r.body)}`);
  return { token: r.body.accessToken };
}

async function main() {
  await ensureTemplateReferenceData();
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });

  // ───────────── Sign-in as the Super Admin ─────────────
  console.log('Super Admin sign-in and lockout');
  const saLogin = await login('admin@test.com', 'Admin123456!x');
  ok(saLogin.status === 200 && saLogin.body.accessToken, 'Super Admin signs in', saLogin.body);
  const sa = saLogin.body.accessToken as string;

  // ───────────── Build two clients through the API ─────────────
  const world = async (tag: string, abn: string, acn: string, mcAbn: string, extra: Record<string, unknown> = {}, expect = 201) => {
    const client = await api('POST', '/qc/clients', {
      token: sa,
      body: {
        ...extra, legal_entity_name: `${tag} Developer ${sfx} Pty Ltd`, entity_type: 'Company (Pty Ltd)', abn, acn, gst_registered: true, client_type: 'Developer and builder', registered_office_address: ADDR,
        primary_contact_name: 'Pat Admin', primary_contact_email: 'pat@example.com', primary_contact_phone: '0412345678', accounts_contact_email: 'accounts@example.com', states_and_territories_of_operation: ['VIC'],
        default_time_zone: opt('E01', 'default_time_zone'), contract_start_date: '2026-10-01', mfa_required_for_all_roles: false, idle_session_timeout: 30,
        plan_and_limits: ['Standard', '', '', ''], first_client_admin_name_and_email: ['Cal Admin', `ca${tag}${sfx}@example.com`],
      },
    });
    if (client.status !== expect) throw new Error('client create ' + JSON.stringify(client.body));
    if (expect !== 201) return client as never;
    return client.body as { client: { id: string; status: string }; invitation: { url: string }; firstAdmin: { id: string; email: string } };
  };
  const A = await world('A', '51824753556', '004085616', '53004085616');
  ok(A.client.status === 'PENDING_ACTIVATION', 'new client is Pending activation until its first admin activates');
  ok(!!A.invitation.url.includes('/accept/'), 'first Client Admin gets an activation link');
  const B = await world('B', '53004085616', '004085616', '51824753556');

  console.log('Invitations, MFA, lockout');
  const caA = await activate(A.invitation, A.firstAdmin.email);
  ok(!!caA.token && !!caA.mfaSecret, 'Client Admin must enrol MFA at first sign-in');
  const clientRow = await prisma.qcClient.findUniqueOrThrow({ where: { id: A.client.id } });
  ok(clientRow.status === 'ACTIVE', 'client became Active when its first admin activated');
  const reuse = await api('POST', `/auth/invitations/${A.invitation.url.split('/accept/')[1]}/accept`, { body: { password: PW, acceptTerms: true } });
  ok(reuse.status === 410 && errCode(reuse) === 'INVITATION_USED', 'invitation link works once', reuse.body);
  const caB = await activate(B.invitation, B.firstAdmin.email);

  ok((caA.backupCodes ?? []).length === 8, 'eight backup codes are issued once at enrolment');
  const viaBackup = await login(A.firstAdmin.email);
  const backupTry = await api('POST', '/auth/mfa/verify', { body: { mfaToken: viaBackup.body.mfaToken, code: caA.backupCodes![0] } });
  ok(backupTry.status === 200 && backupTry.body.accessToken, 'a backup code signs in');
  const viaBackup2 = await login(A.firstAdmin.email);
  const backupReuse = await api('POST', '/auth/mfa/verify', { body: { mfaToken: viaBackup2.body.mfaToken, code: caA.backupCodes![0] } });
  ok(backupReuse.status === 401, 'a backup code works only once', backupReuse.status);
  const second = await login(A.firstAdmin.email);
  ok(second.status === 200 && second.body.mfaRequired === true, 'Client Admin sign-in asks for the MFA code');
  const badMfa = await api('POST', '/auth/mfa/verify', { body: { mfaToken: second.body.mfaToken, code: '000000' } });
  ok(badMfa.status === 401, 'wrong MFA code refused', badMfa.status);
  const goodMfa = await api('POST', '/auth/mfa/verify', { body: { mfaToken: second.body.mfaToken, code: totp(caA.mfaSecret!) } });
  ok(goodMfa.status === 200 && goodMfa.body.accessToken, 'right MFA code signs in');
  const ca = goodMfa.body.accessToken as string;

  const shortPw = await api('POST', `/auth/invitations/xxxxxxxxxxxxxxxx/accept`, { body: { password: 'short', acceptTerms: true } });
  ok(shortPw.status === 400, 'password under 12 characters refused', shortPw.status);
  for (let i = 0; i < 5; i++) await login(A.firstAdmin.email, 'wrong-password-123');
  const locked = await login(A.firstAdmin.email, PW);
  ok(locked.status === 423 && errCode(locked) === 'ACCOUNT_LOCKED', 'account locks after 5 failures, even with the right password', locked.body);
  await prisma.user.update({ where: { id: A.firstAdmin.id }, data: { lockedUntil: null, failedLoginCount: 0 } });

  // ───────────── Organisation set-up by the Client Admin ─────────────
  console.log('Client Admin builds the organisation');
  const mcBody = (name: string, abn: string) => ({
    legal_entity_name: name, entity_type: 'Company (Pty Ltd)', abn, acn: '004085616', registering_authority: opt('E02', 'registering_authority'), registration_or_licence_category: opt('E02', 'registration_or_licence_category'),
    registration_or_licence_number: 'DB-U12345', registration_or_licence_expiry: '2027-06-30', business_address: ADDR, primary_contact_name: 'Bob Builder', primary_contact_email: 'bob@example.com',
    primary_contact_phone: '0411111111', after_hours_emergency_phone: '0422222222', public_liability_insurer: 'Insurer', public_liability_policy_number: 'PL1', public_liability_sum_insured: 20000000,
    public_liability_expiry: '2027-01-01', workers_compensation_insurer: 'WC', workers_compensation_policy_number: 'WC1', workers_compensation_expiry: '2027-01-01',
  });
  const mcA = await api('POST', '/qc/master-contractors', { token: ca, body: mcBody(`Builder A ${sfx}`, '53004085616') });
  ok(mcA.status === 201, 'Client Admin creates a Master Contractor in their own client', mcA.body);
  const mcAId = mcA.body.masterContractor.id as string;
  const mcB = await api('POST', '/qc/master-contractors', { token: caB.token, body: mcBody(`Builder B ${sfx}`, '51824753556') });
  const mcBId = mcB.body.masterContractor.id as string;

  const renderer = await prisma.qcTradeCategory.findFirstOrThrow({ where: { code: 'REND' } });
  const trade = await api('POST', '/qc/trade-companies', {
    token: ca,
    body: { legal_entity_name: `Render Co ${sfx}`, abn: '53004085616', gst_registered: true, trade_categories: [renderer.id], public_liability_insurer_policy_number_expiry: ['Ins', 'P1', '2027-01-01'], primary_contact_name: 'Tess', primary_contact_mobile: '0433333333', primary_contact_email: 'tess@example.com', business_address: ADDR, engaged_by: [mcAId] },
  });
  ok(trade.status === 201, 'trade company created and engaged by the client\'s contractor', trade.body);
  const tradeId = trade.body.tradeCompany.id as string;
  const badEngage = await api('POST', '/qc/trade-companies', { token: ca, body: { ...trade.body.tradeCompany, legal_entity_name: 'X', abn: '51824753556', engaged_by: [mcBId], trade_categories: [renderer.id], gst_registered: true, public_liability_insurer_policy_number_expiry: ['a', 'b', '2027-01-01'], primary_contact_name: 'T', primary_contact_mobile: '0433333333', primary_contact_email: 't@example.com', business_address: ADDR } });
  ok(badEngage.status === 400, 'cannot engage another client\'s contractor', badEngage.status);

  const projBody = (mcId: string, n: string) => ({
    project_name: `Project ${n} ${sfx}`, job_number: `J${n}${sfx}`, builder: mcId, project_type: opt('E07', 'project_type'), ncc_building_classes: ['1a'], state_or_territory: 'VIC',
    local_government_area: 'Melbourne', expected_practical_completion_date: '2027-12-01', dlp_length: 12,
  });
  const pA = await api('POST', '/qc/projects', { token: ca, body: projBody(mcAId, 'A') });
  ok(pA.status === 201, 'Client Admin creates a project (developer forced to own client)', pA.body);
  const projectA = pA.body.project.id as string;
  const pB = await api('POST', '/qc/projects', { token: caB.token, body: projBody(mcBId, 'B') });
  const projectB = pB.body.project.id as string;
  const siteA = (await api('POST', '/qc/sites', { token: ca, body: { projectId: projectA, site_name: 'Stage 1', site_address: ADDR, site_contact_name: 'Sam', site_contact_mobile: '0444444444', site_induction_required: false } })).body.site.id as string;
  const lotBody = (ref: string) => ({ siteId: siteA, lot_reference: ref, lot_number: ref.replace(/\D/g, ''), dwelling_type: 'Detached house', ncc_building_class: opt('E09', 'ncc_building_class'), storeys: 2, floor_system: opt('E09', 'floor_system'), frame: opt('E09', 'frame'), wall_cladding: [opt('E09', 'wall_cladding')], roof_cover: opt('E09', 'roof_cover') });
  const lot1 = (await api('POST', '/qc/lots', { token: ca, body: lotBody('Lot 1') })).body.lot.id as string;
  const lot2 = (await api('POST', '/qc/lots', { token: ca, body: lotBody('Lot 2') })).body.lot.id as string;

  // ───────────── Tenant isolation ─────────────
  console.log('Tenant isolation');
  const cross = await api('GET', `/qc/projects/${projectB}`, { token: ca });
  ok(cross.status === 404, 'another client\'s project answers 404, not 403', cross.status);
  const crossLogged = await prisma.qcSecurityEvent.count({ where: { type: 'CROSS_TENANT', clientId: B.client.id } });
  ok(crossLogged > 0, 'the cross-tenant attempt was logged');
  const listA = await api('GET', '/qc/projects', { token: ca });
  ok(listA.body.projects.length === 1 && listA.body.projects[0].id === projectA, 'project list shows only own client');
  const patchB = await api('PATCH', `/qc/projects/${projectB}`, { token: ca, body: { project_name: 'hijack' } });
  ok(patchB.status === 404, 'cannot edit another client\'s project', patchB.status);
  const lotsB = await api('GET', `/qc/lots?projectId=${projectB}`, { token: ca });
  ok(lotsB.status === 404, 'cannot list another client\'s lots', lotsB.status);
  const hdr = await api('GET', '/qc/projects', { token: ca, client: B.client.id });
  ok(hdr.status === 404, 'X-Client-Id for a client you do not belong to is refused', hdr.status);

  console.log('Support mode');
  const saNoSession = await api('GET', '/qc/projects', { token: sa });
  ok(saNoSession.status === 409 && errCode(saNoSession) === 'SUPPORT_MODE_REQUIRED', 'Super Admin needs support mode to see client data', saNoSession.body);
  const noReason = await api('POST', '/qc/support/start', { token: sa, body: { clientId: A.client.id, reason: 'x' } });
  ok(noReason.status === 400, 'support mode requires a reason', noReason.status);
  const start = await api('POST', '/qc/support/start', { token: sa, body: { clientId: A.client.id, reason: 'Investigating a support ticket', ticketRef: 'T-100' } });
  ok(start.status === 201, 'support session starts', start.body);
  const saIn = await api('GET', '/qc/projects', { token: sa });
  ok(saIn.status === 200 && saIn.body.projects.length === 1, 'Super Admin sees the client inside the session');
  const saWrong = await api('GET', `/qc/projects/${projectB}`, { token: sa });
  ok(saWrong.status === 409 || saWrong.status === 404, 'session for client A does not open client B', saWrong.status);
  const sessions = await api('GET', '/qc/support-sessions', { token: ca });
  ok(sessions.status === 200 && sessions.body.sessions.length === 1 && sessions.body.sessions[0].reason.includes('support ticket'), 'the client can see the support session');
  const audit = await api('GET', '/qc/audit?action=support', { token: ca });
  ok(audit.status === 200 && audit.body.entries.length >= 1, 'support start is in the client\'s audit trail');
  const end = await api('POST', '/qc/support/end', { token: sa });
  ok(end.status === 200, 'support session ends');

  // ───────────── People and permissions ─────────────
  console.log('People, invitations and permissions');
  const person = (over: Record<string, unknown>) => ({ white_card_number: 'WC1', white_card_issuing_state_or_territory: 'VIC', ...over });
  const mkPerson = async (token: string, body: Record<string, unknown>) => api('POST', '/qc/people', { token, body: person(body) });
  const mcMgr = await mkPerson(ca, { email_address: `mgr${sfx}@example.com`, first_name: 'Mia', last_name: 'Manager', role: 'MC_MANAGER', masterContractorId: mcAId });
  ok(mcMgr.status === 201 && mcMgr.body.invitation.url, 'Client Admin adds an MC Manager and gets an activation link', mcMgr.body);
  const cuNo = await mkPerson(ca, { email_address: `cu${sfx}@example.com`, first_name: 'Cia', last_name: 'User', role: 'CLIENT_USER' });
  const cuYes = await mkPerson(ca, { email_address: `cuy${sfx}@example.com`, first_name: 'Cyd', last_name: 'Planner', role: 'CLIENT_USER', optionalPermissions: ['Plan and assign inspections', 'Create projects'] });
  const pmP = await mkPerson(ca, { email_address: `pm${sfx}@example.com`, first_name: 'Pia', last_name: 'PM', role: 'MC_PROJECT_MANAGER', masterContractorId: mcAId, projectIds: [projectA] });
  const supP = await mkPerson(ca, { email_address: `sup${sfx}@example.com`, first_name: 'Sue', last_name: 'Super', mobile: '0455555556', role: 'MC_SITE_SUPERVISOR', masterContractorId: mcAId, projectIds: [projectA] });
  const trP = await mkPerson(ca, { email_address: `tr${sfx}@example.com`, first_name: 'Tom', last_name: 'Trade', mobile: '0466666666', role: 'TRADE_USER', tradeCompanyId: tradeId, tradeCategoryIds: [renderer.id] });
  ok([cuNo, cuYes, pmP, supP, trP].every((p) => p.status === 201), 'all roles can be created', [cuNo.body, pmP.body, supP.body, trP.body]);
  const piP = await api('POST', '/qc/support/start', { token: sa, body: { clientId: A.client.id, reason: 'Credential the inspector' } });
  void piP;
  const piCreate = await api('POST', '/qc/people', {
    token: sa,
    body: person({
      email_address: `pi${sfx}@example.com`, first_name: 'Ivy', last_name: 'Inspector', mobile: '0455555555', role: 'PRIVATE_INSPECTOR',
      credentials: { engagement_type: opt('E06', 'engagement_type'), registering_authority: opt('E06', 'registering_authority'), registration_category: opt('E06', 'registration_category'), registration_number: 'BI-U1', registration_expiry: '2027-05-01', qualifications: 'Dip Building', professional_indemnity_insurer_policy_number_lim: ['Ins', 'P1', 1000000, '2027-01-01'], public_liability_insurer_policy_number_expiry: ['a', 'b', '2027-01-01'], approved_for_clients: [A.client.id], signature_image: '/api/v1/media/00000000-0000-0000-0000-000000000000' },
    }),
  });
  ok(piCreate.status === 201, 'Super Admin credentials a Private Inspector', piCreate.body);
  const piId = piCreate.body.person.id as string;
  await api('POST', `/qc/people/${piId}/credentials/status`, { token: sa, body: { status: 'APPROVED' } });
  await api('POST', '/qc/support/end', { token: sa });

  const tokens: Record<string, string> = {};
  tokens.mgr = (await activate(mcMgr.body.invitation, 'mgr')).token;
  tokens.cuNo = (await activate(cuNo.body.invitation, 'cuNo')).token;
  tokens.cuYes = (await activate(cuYes.body.invitation, 'cuYes')).token;
  tokens.pm = (await activate(pmP.body.invitation, 'pm')).token;
  tokens.sup = (await activate(supP.body.invitation, 'sup')).token;
  tokens.trade = (await activate(trP.body.invitation, 'trade')).token;
  tokens.pi = (await activate(piCreate.body.invitation, 'pi')).token;

  const cuProject = await api('POST', '/qc/projects', { token: tokens.cuNo, body: projBody(mcAId, 'X') });
  ok(cuProject.status === 403, 'Client User without the permission cannot create a project', cuProject.status);
  const cuProject2 = await api('POST', '/qc/projects', { token: tokens.cuYes, body: projBody(mcAId, 'Y') });
  ok(cuProject2.status === 201, 'Client User with "Create projects" can', cuProject2.body);
  const mgrCreatesCu = await mkPerson(tokens.mgr, { email_address: `bad${sfx}@example.com`, first_name: 'No', last_name: 'Way', role: 'CLIENT_USER' });
  ok(mgrCreatesCu.status === 403, 'MC Manager cannot create client users', mgrCreatesCu.status);
  const mgrCreatesTrade = await mkPerson(tokens.mgr, { email_address: `tr2${sfx}@example.com`, first_name: 'Tim', last_name: 'Trade', mobile: '0466666667', role: 'TRADE_USER', tradeCompanyId: tradeId, tradeCategoryIds: [renderer.id] });
  ok(mgrCreatesTrade.status === 201, 'MC Manager can create trade users', mgrCreatesTrade.body);
  const tradeListsPeople = await api('GET', '/qc/people', { token: tokens.trade });
  ok(tradeListsPeople.status === 403, 'Trade User cannot list people', tradeListsPeople.status);
  const securityForbidden = await prisma.qcSecurityEvent.count({ where: { type: 'FORBIDDEN', clientId: A.client.id } });
  ok(securityForbidden >= 3, 'refused requests are logged', securityForbidden);
  const cuLog = await api('GET', '/qc/security-log', { token: tokens.cuNo });
  ok(cuLog.status === 403, 'only admins see the security log', cuLog.status);
  const caLog = await api('GET', '/qc/security-log?type=FORBIDDEN', { token: ca });
  ok(caLog.status === 200 && caLog.body.events.length >= 3, 'Client Admin reads their own security log');

  console.log('Deactivation ends sessions');
  const supTokenOk = await api('GET', '/qc/me', { token: tokens.sup });
  ok(supTokenOk.status === 200, 'supervisor token works');
  const deact = await api('POST', `/qc/people/${supP.body.person.id}/deactivate`, { token: ca, body: { reason: 'Left the company' } });
  ok(deact.status === 200, 'Client Admin deactivates a user', deact.body);
  const supAfter = await api('GET', '/qc/me', { token: tokens.sup });
  ok(supAfter.status === 401, 'the deactivated user\'s token stops working immediately', supAfter.status);
  const supLogin = await login(`sup${sfx}@example.com`);
  ok(supLogin.status === 403 || supLogin.status === 401, 'and they cannot sign in again', supLogin.status);


  // ───────────── Reference data, templates ─────────────
  console.log('Templates');
  const stages = (await api('GET', '/qc/stages', { token: ca })).body.stages as Array<{ id: string; stage_number: string; stage_name: string; statutory_mandatory_notification_stage: boolean }>;
  ok(stages.length >= 10, `stage definitions seeded (${stages.length})`);
  const codes = (await api('GET', '/qc/result-codes', { token: ca })).body.resultCodes as Array<{ code: string; creates_a_defect: boolean }>;
  ok(codes.length === 7 && codes.filter((c) => c.creates_a_defect).length === 4, 'seven result codes, four create defects');
  const stageBy = (n: string) => stages.find((s) => s.stage_number === n)!;

  const itemBody = (n: string, extra: Record<string, unknown> = {}) => ({
    item_number: n, section: 'Documentation and Site', location_or_element: 'Footing', check_description: `Check ${n}`, what_to_check_and_method: 'Visual and measure', reference: 'NCC 2025 H1D6',
    guide_value_or_acceptable_tolerance: 'As specified', item_type: 'Result only', photo_rule: 'When result is not OK (default)', mandatory_item: true, locked_by_super_admin: false,
    applies_to_floor_systems: 'All', applies_to_building_classes: '1a, 1b', sequence: Number(n.split('.').pop()), active: true, ...extra,
  });
  const mkBase = async (code: string, stageNo: string, nItems = 2, extraItems: Array<Record<string, unknown>> = []) => {
    const t = await api('POST', '/qc/templates', { token: sa, body: { template_name: `${code} checklist`, template_code: `${code}${sfx}`, stage: stageBy(stageNo).id, jurisdiction: 'Victoria', code_basis: 'NCC 2025 Volume Two', applies_to_building_classes: '1a', applies_to_floor_systems: 'All' } });
    if (t.status !== 201) throw new Error('template ' + JSON.stringify(t.body));
    const id = t.body.template.id as string;
    for (let i = 1; i <= nItems; i++) await api('POST', `/qc/templates/${id}/items`, { token: sa, body: itemBody(`${stageNo}.${i}`) });
    for (const x of extraItems) await api('POST', `/qc/templates/${id}/items`, { token: sa, body: x });
    return id;
  };
  const preId = await mkBase('PRE', '1', 1, [
    itemBody('1.2', { item_type: 'Measurement', measurement_unit: 'mm', tolerance_minimum_and_maximum: [0, 5], locked_by_super_admin: true }),
    itemBody('1.3'),
  ]);
  const frameId = await mkBase('FRM', '3');
  const pciId = await mkBase('PCI', '8');
  const caEditBase = await api('PATCH', `/qc/templates/${preId}`, { token: ca, body: { instructions_to_inspector: 'x' } });
  ok(caEditBase.status === 403, 'Client Admin cannot edit a base template', caEditBase.status);
  const tooEarly = await api('POST', `/qc/templates/${preId}/publish`, { token: sa, body: { new_version_number: 'abc', change_summary: 'x', effective_for_new_inspections_from: '2026-10-01' } });
  ok(tooEarly.status === 400, 'version number must look like 1.1', tooEarly.status);
  for (const [id, label] of [[preId, '1.0'], [frameId, '1.0'], [pciId, '1.0']] as const) {
    const pub = await api('POST', `/qc/templates/${id}/publish`, { token: sa, body: { new_version_number: label, change_summary: 'First release', effective_for_new_inspections_from: '2026-10-01', notify_client_admins: true } });
    if (pub.status !== 200) throw new Error('publish ' + JSON.stringify(pub.body));
  }
  const frozen = await api('POST', `/qc/templates/${preId}/items`, { token: sa, body: itemBody('1.9') });
  ok(frozen.status === 409 && errCode(frozen) === 'TEMPLATE_PUBLISHED', 'a published version cannot be edited', frozen.body);

  const clone = await api('POST', `/qc/templates/${preId}/clone`, { token: ca, body: { new_template_name: 'Our pre-pour checklist', level: 'Client' } });
  ok(clone.status === 201, 'Client Admin clones a published template', clone.body);
  const cloneId = clone.body.template.id as string;
  const cloneItems = (await api('GET', `/qc/templates/${cloneId}`, { token: ca })).body.template.items as Array<{ id: string; itemNumber: string; locked: boolean }>;
  const lockedItem = cloneItems.find((i) => i.locked)!;
  const rmLocked = await api('DELETE', `/qc/template-items/${lockedItem.id}`, { token: ca });
  ok(rmLocked.status === 403, 'locked items cannot be removed from a client copy', rmLocked.status);
  const editLocked = await api('PATCH', `/qc/template-items/${lockedItem.id}`, { token: ca, body: { check_description: 'changed' } });
  ok(editLocked.status === 403, 'locked items cannot be edited in a client copy', editLocked.status);
  const addOwn = await api('POST', `/qc/templates/${cloneId}/items`, { token: ca, body: itemBody('1.50', { section: 'Our checks' }) });
  ok(addOwn.status === 201, 'client can add its own item', addOwn.body);
  const otherClientClone = await api('GET', `/qc/templates/${cloneId}`, { token: caB.token });
  ok(otherClientClone.status === 404, 'another client cannot see this clone', otherClientClone.status);

  // New base version with one more item; the client copy sees the difference and can merge it.
  const draft = await api('POST', `/qc/templates/${preId}/draft`, { token: sa });
  ok(draft.status === 201, 'Super Admin starts a new draft version', draft.body);
  const versionDraftId = draft.body.template.id as string;
  await api('POST', `/qc/templates/${versionDraftId}/items`, { token: sa, body: itemBody('1.4') });
  const pub2 = await api('POST', `/qc/templates/${versionDraftId}/publish`, { token: sa, body: { new_version_number: '1.1', change_summary: 'Added item 1.4', effective_for_new_inspections_from: '2026-10-01', notify_client_admins: true } });
  ok(pub2.status === 200, 'version 1.1 published', pub2.body);
  const oldVer = await api('GET', `/qc/templates/${preId}`, { token: ca });
  ok(oldVer.body.template.versionStatus === 'RETIRED', 'the earlier version is retired but still readable');
  const notes = await prisma.qcNotification.count({ where: { clientId: A.client.id, type: 'inspection.assigned', title: { contains: 'new version' } } });
  ok(notes >= 1, 'Client Admin was notified of the new version', notes);
  const diff = await api('GET', `/qc/templates/${cloneId}/diff`, { token: ca });
  ok(diff.status === 200 && diff.body.added.length === 1 && diff.body.added[0].itemNumber === '1.4', 'diff shows the added item', diff.body);
  const mergeNeedsDraft = await api('POST', `/qc/templates/${cloneId}/merge`, { token: ca, body: { itemNumbers: ['1.4'] } });
  ok(mergeNeedsDraft.status === 200 && mergeNeedsDraft.body.added === 1, 'merge brings the new item into the client copy', mergeNeedsDraft.body);
  const pubClone = await api('POST', `/qc/templates/${cloneId}/publish`, { token: ca, body: { new_version_number: '1.0', change_summary: 'Client release', effective_for_new_inspections_from: '2026-10-01', notify_client_admins: false } });
  ok(pubClone.status === 200, 'client copy published', pubClone.body);

  // Excel round trip.
  const xl = await api('GET', `/qc/templates/${cloneId}/export`, { token: ca, raw: true });
  ok(xl.status === 200 && String(xl.body).startsWith('PK'), 'checklist exports to Excel');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Items');
  ws.addRow(['Item number', 'Section', 'Location or element', 'Check description', 'Item type']);
  ws.addRow(['9.1', 'Imported', 'Slab', 'Check slab edge', 'Result only']);
  ws.addRow(['9.1', 'Imported', 'Slab', 'Duplicate number', 'Result only']);
  ws.addRow(['9.3', 'Imported', 'Slab', 'Bad type', 'Rocket']);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const importDraft = await api('POST', `/qc/templates/${cloneId}/draft`, { token: ca });
  const importId = importDraft.body.template.id as string;
  const mkForm = (file: Buffer, name: string, extra: Record<string, string> = {}) => { const f = new FormData(); f.append('files', new Blob([new Uint8Array(file)]), name); for (const [k, v] of Object.entries(extra)) f.append(k, v); return f; };
  const imp = await api('POST', `/qc/templates/${importId}/import`, { token: ca, form: mkForm(buf, 'items.xlsx') });
  ok(imp.status === 200 && imp.body.report.imported === 0 && imp.body.report.errors.length === 2, 'import with errors imports nothing and reports each bad row', imp.body);
  const impPartial = await api('POST', `/qc/templates/${importId}/import`, { token: ca, form: mkForm(buf, 'items.xlsx', { partial: 'true' }) });
  ok(impPartial.body.report.imported === 1, 'partial import keeps the good rows', impPartial.body);

  // ───────────── Project plan, lots, lifecycle ─────────────
  console.log('Project plan, lot import, lifecycle');
  const early = await api('POST', `/qc/projects/${projectA}/status`, { token: ca, body: { status: 'CONSTRUCTION' } });
  ok(early.status === 400, 'construction cannot start with no inspection plan', early.body);
  const seed = await api('POST', `/qc/projects/${projectA}/plan/seed`, { token: ca });
  const plan = seed.body.plan as Array<{ id: string; stageId: string; stageNumber: string; mandatoryNotification: boolean; templateId: string | null }>;
  ok(plan.length >= 10, `plan seeded from the stage list (${plan.length})`);
  const mandatory = plan.find((p) => p.mandatoryNotification)!;
  const offMandatory = await api('PATCH', `/qc/projects/${projectA}/plan/${mandatory.id}`, { token: ca, body: { enabled: false } });
  ok(offMandatory.status === 400, 'a mandatory notification stage cannot be switched off', offMandatory.body);
  const tplFor: Record<string, string> = { '1': cloneId, '3': frameId, '8': pciId };
  for (const row of plan) {
    if (tplFor[row.stageNumber]) {
      const r = await api('PATCH', `/qc/projects/${projectA}/plan/${row.id}`, { token: ca, body: { templateId: tplFor[row.stageNumber] } });
      if (r.status !== 200) throw new Error('assign template ' + JSON.stringify(r.body));
    } else if (!row.mandatoryNotification) {
      await api('PATCH', `/qc/projects/${projectA}/plan/${row.id}`, { token: ca, body: { enabled: false } });
    }
  }
  const wrongTpl = await api('PATCH', `/qc/projects/${projectA}/plan/${plan.find((p) => p.stageNumber === '3')!.id}`, { token: ca, body: { templateId: pciId } });
  ok(wrongTpl.status === 400, 'a template for a different stage is refused', wrongTpl.body);
  const holdBy = await api('PATCH', `/qc/projects/${projectA}/plan/${plan.find((p) => p.stageNumber === '1')!.id}`, { token: tokens.cuYes, body: { holdPoint: true } });
  ok(holdBy.status === 403, 'only a Client Admin sets hold points', holdBy.status);
  await api('PATCH', `/qc/projects/${projectA}/plan/${plan.find((p) => p.stageNumber === '1')!.id}`, { token: ca, body: { holdPoint: true } });

  const csv = 'Lot number,Unit number,Dwelling type,NCC class,Storeys,Floor system\n3,,Detached house,1a,2,Slab on ground - waffle pod\n4,,Spaceship,1a,2,Slab on ground - waffle pod\nLot 1,,Detached house,1a,2,Slab on ground - waffle pod\n';
  const badImport = await api('POST', `/qc/sites/${siteA}/lots/import`, { token: ca, form: mkForm(Buffer.from(csv), 'lots.csv') });
  ok(badImport.status === 200 && badImport.body.report.added === 0 && badImport.body.report.errors.length === 2, 'lot import with bad rows imports nothing and reports each', badImport.body);
  const partialImport = await api('POST', `/qc/sites/${siteA}/lots/import`, { token: ca, form: mkForm(Buffer.from(csv), 'lots.csv', { partial: 'true' }) });
  ok(partialImport.body.report?.added === 1, 'partial lot import adds the good row', { first: badImport.body, second: partialImport.body });

  const matrix = await api('GET', `/qc/projects/${projectA}/matrix`, { token: ca });
  ok(matrix.status === 200 && matrix.body.lots.length >= 3 && matrix.body.stages.length === 3, `planning matrix: ${matrix.body.lots?.length} lots x ${matrix.body.stages?.length} stages`, matrix.body);
  const badMove = await api('POST', `/qc/projects/${projectA}/status`, { token: ca, body: { status: 'PRACTICAL_COMPLETION' } });
  ok(badMove.status === 409, 'cannot skip from Set-up to Practical completion', badMove.body);
  const goConstruction = await api('POST', `/qc/projects/${projectA}/status`, { token: ca, body: { status: 'CONSTRUCTION' } });
  ok(goConstruction.status === 200, 'construction starts once the plan is complete', goConstruction.body);
  const patchStatus = await api('PATCH', `/qc/projects/${projectA}`, { token: ca, body: { status: 'ARCHIVED' } });
  ok(patchStatus.status === 400, 'status cannot be changed through a plain edit', patchStatus.body);

  // Documents.
  const docForm = mkForm(Buffer.from('%PDF-1.4 test'), 'plans.pdf', { title: 'Endorsed plans', document_type: 'Endorsed plans (architectural)', revision: 'A', applies_to: 'Project', visible_to: 'Client roles,Private Inspector' });
  const doc1 = await api('POST', `/qc/projects/${projectA}/documents`, { token: ca, form: new FormData() });
  void doc1;
  const docUpload = await (async () => {
    const f = new FormData();
    f.append('files', new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }), 'plans.pdf');
    f.append('title', 'Endorsed plans'); f.append('document_type', 'Endorsed plans (architectural)'); f.append('revision', 'A'); f.append('applies_to', 'Project'); f.append('visible_to', 'Client roles,Private Inspector');
    return api('POST', `/qc/projects/${projectA}/documents`, { token: ca, form: f });
  })();
  void docForm;
  ok(docUpload.status === 201, 'Client Admin uploads a project document', docUpload.body);
  const piDocs = await api('GET', `/qc/projects/${projectA}/documents`, { token: tokens.pi });
  const mgrDocs = await api('GET', `/qc/projects/${projectA}/documents`, { token: tokens.mgr });
  ok(piDocs.body.documents?.length === 1 && mgrDocs.body.documents?.length === 0, 'document visibility follows the chosen audiences', { pi: piDocs.body, mgr: mgrDocs.body });
  const directMedia = await api('GET', docUpload.body.document.fileUrl.replace('/api/v1', ''), { raw: true });
  ok(directMedia.status === 403, 'a tenant file cannot be fetched without a signed link', directMedia.status);

  // ───────────── Inspection lifecycle ─────────────
  console.log('Inspections');
  const stage1 = stageBy('1').id;
  const reqBody = (lots: string[], stageId = stage1) => ({ projectId: projectA, stageId, lotIds: lots, stage_complete_confirmation: true, ready_from_date: '2026-10-10', site_contact_name_and_mobile: 'Sam 0444444444', rbsNotifiedOn: '2026-10-08', rbsName: 'RBS Pty Ltd' });
  const noConfirm = await api('POST', '/qc/inspections/request', { token: ca, body: { ...reqBody([lot1]), stage_complete_confirmation: false } });
  ok(noConfirm.status === 400, 'a request needs the stage-complete confirmation', noConfirm.body);
  const noRbs = await api('POST', '/qc/inspections/request', { token: ca, body: { ...reqBody([lot1]), rbsNotifiedOn: undefined } });
  ok(noRbs.status === 400, 'a mandatory stage needs the RBS notification', noRbs.body);
  const requested = await api('POST', '/qc/inspections/request', { token: tokens.mgr, body: reqBody([lot1]) });
  ok(requested.status === 201 && requested.body.inspections[0].ref.startsWith('INS-'), 'Master Contractor requests a stage inspection', requested.body);
  const insId = requested.body.inspections[0].id as string;
  const dup = await api('POST', '/qc/inspections/request', { token: ca, body: reqBody([lot1]) });
  ok(dup.status === 409, 'a second request for the same lot and stage is refused', dup.body);
  const planNo = await api('POST', '/qc/inspections/plan', { token: tokens.cuNo, body: { inspectionIds: [insId], inspectorId: piId, plannedFrom: '2026-10-12T22:00:00Z', plannedTo: '2026-10-13T02:00:00Z' } });
  ok(planNo.status === 403, 'a Client User without the permission cannot plan inspections', planNo.status);
  const planBadInspector = await api('POST', '/qc/inspections/plan', { token: ca, body: { inspectionIds: [insId], inspectorId: A.firstAdmin.id, plannedFrom: '2026-10-12T22:00:00Z', plannedTo: '2026-10-13T02:00:00Z' } });
  ok(planBadInspector.status === 400, 'only an approved Private Inspector can be assigned', planBadInspector.body);
  const planned = await api('POST', '/qc/inspections/plan', { token: tokens.cuYes, body: { inspectionIds: [insId], inspectorId: piId, plannedFrom: '2026-10-12T22:00:00Z', plannedTo: '2026-10-13T02:00:00Z', notifyMasterContractor: true } });
  ok(planned.status === 200 && planned.body.inspections[0].status === 'PLANNED', 'Client User with the permission plans and assigns it', planned.body);
  const piNotes = await prisma.qcNotification.count({ where: { userId: piId, type: 'inspection.assigned' } });
  ok(piNotes >= 1, 'the inspector was notified');
  const cuSees = await api('GET', `/qc/inspections/${insId}`, { token: tokens.trade });
  ok(cuSees.status === 403, 'a Trade User cannot see inspections', cuSees.status);
  const otherPi = await api('POST', `/qc/inspections/${insId}/start`, { token: tokens.mgr, body: { weather: 'Fine', site_access: 'Full' } });
  ok(otherPi.status === 403, 'only the assigned inspector can start it', otherPi.status);
  const noAccess = await api('POST', `/qc/inspections/${insId}/start`, { token: tokens.pi, body: { weather: 'Fine', site_access: 'Partial' } });
  ok(noAccess.status === 400, 'partial access needs the limitations described', noAccess.body);
  const started = await api('POST', `/qc/inspections/${insId}/start`, { token: tokens.pi, body: { weather: 'Fine', temperature: 18, site_access: 'Full' } });
  ok(started.status === 200 && started.body.inspection.status === 'IN_PROGRESS' && started.body.inspection.results.length === 5, 'inspector starts it; items are snapshotted from the template', started.body);
  const mgrSeesInProgress = await api('GET', `/qc/inspections/${insId}`, { token: tokens.mgr });
  ok(mgrSeesInProgress.status === 404, 'the Builder does not see work in progress', mgrSeesInProgress.status);

  const putResult = (item: string, body: Record<string, unknown>) => api('PUT', `/qc/inspections/${insId}/results/${item}`, { token: tokens.pi, body });
  const r1 = await putResult('1.1', { result: 'OK' });
  ok(r1.status === 200, 'record an OK result', r1.body);
  const outTol = await putResult('1.2', { result: 'OK', measurement: { value: 7, unit: 'mm' } });
  ok(outTol.status === 400, 'a measurement outside tolerance cannot be OK without an explanation', outTol.body);
  const noPhoto = await putResult('1.2', { result: 'Minor Defect', comments: 'Slab edge out by 7 mm', locationDetail: 'North edge', measurement: { value: 7, unit: 'mm' } });
  ok(noPhoto.status === 400, 'a defect result needs a photo', noPhoto.body);
  const evForm = new FormData();
  evForm.append('files', new Blob([new Uint8Array(await png())], { type: 'image/png' }), 'edge.png');
  evForm.append('linkedType', 'Inspection'); evForm.append('linkedId', insId); evForm.append('phase', 'Identification');
  const evidence = await api('POST', '/qc/evidence', { token: tokens.pi, form: evForm });
  ok(evidence.status === 201 && evidence.body.evidence[0].fileHash.length === 64, 'photo evidence is stored with its SHA-256 hash', evidence.body);
  const photoUrl = evidence.body.evidence[0].url as string;
  const verified = await api('GET', `/qc/evidence/${evidence.body.evidence[0].id}/verify`, { token: ca });
  ok(verified.status === 200 && verified.body.ok === true, 'the stored file still matches its hash', verified.body);
  const defectResult = await putResult('1.2', { result: 'Minor Defect', comments: 'Slab edge out by 7 mm', locationDetail: 'North edge', measurement: { value: 7, unit: 'mm' }, photoUrls: [photoUrl] });
  ok(defectResult.status === 200 && defectResult.body.raisedDefectIds.length === 1, 'a defect result raises a draft defect', defectResult.body);
  const defectDraftId = defectResult.body.raisedDefectIds[0] as string;
  const naNoReason = await putResult('1.3', { result: 'N/A' });
  ok(naNoReason.status === 400, 'N/A needs a reason', naNoReason.body);
  const stale = await putResult('1.1', { result: 'N/A', reason: 'x', clientUpdatedAt: '2020-01-01T00:00:00Z' });
  ok(stale.status === 200 && stale.body.stale === true, 'an older offline write does not overwrite a newer result', stale.body);
  const early1 = await api('POST', `/qc/inspections/${insId}/complete`, { token: tokens.pi, body: { declaration: true } });
  ok(early1.status === 409 && errCode(early1) === 'UNANSWERED_ITEMS', 'cannot complete with unanswered items', early1.body);
  await putResult('1.3', { result: 'OK' });
  const items = started.body.inspection.results.map((r: { itemNumber: string }) => r.itemNumber) as string[];
  for (const it of items) { const cur = (await api('GET', `/qc/inspections/${insId}`, { token: tokens.pi })).body.inspection.results.find((r: { itemNumber: string; resultCode: string | null }) => r.itemNumber === it); if (!cur.resultCode) await putResult(it, { result: 'OK' }); }
  const early2 = await api('POST', `/qc/inspections/${insId}/complete`, { token: tokens.pi, body: { declaration: true } });
  ok(early2.status === 409 && errCode(early2) === 'DRAFT_DEFECTS', 'cannot complete while a defect is still a draft', early2.body);
  const confirm = await api('POST', `/qc/defects/${defectDraftId}/actions/confirm`, {
    token: tokens.pi,
    body: { defect_title: 'Slab edge out of tolerance', description: 'Slab edge out by 7 mm', room_or_area: 'External - front', element: 'Cladding, render or brickwork', location_detail: 'North edge', severity: 'Minor Defect', nature_of_defect: 'Workmanship', trade_category: renderer.id },
  });
  ok(confirm.status === 200 && confirm.body.defect.status.key === 'open', 'inspector confirms the draft defect', confirm.body);
  const complete = await api('POST', `/qc/inspections/${insId}/complete`, { token: tokens.pi, body: { declaration: true, overall_summary_notes: 'One minor defect.' } });
  ok(complete.status === 200 && complete.body.inspection.status === 'COMPLETED' && complete.body.inspection.locked, 'inspection completed, signed and locked', complete.body);
  const lockedResult = await putResult('1.1', { result: 'OK' });
  ok(lockedResult.status === 409 && errCode(lockedResult) === 'INSPECTION_LOCKED', 'a completed inspection cannot be changed', lockedResult.body);
  const addendum = await api('POST', `/qc/inspections/${insId}/addendum`, { token: tokens.pi, body: { addendum_text: 'Late photo supplied', reason: 'Late evidence' } });
  ok(addendum.status === 201 && addendum.body.addenda.length === 1, 'an addendum can be added after lock', addendum.body);
  const mgrSeesDone = await api('GET', `/qc/inspections/${insId}`, { token: tokens.mgr });
  ok(mgrSeesDone.status === 200, 'the Builder sees the completed inspection');

  const report = await api('POST', `/qc/inspections/${insId}/report`, { token: ca });
  ok(report.status === 201 && report.body.report.hash.length === 64, 'stage inspection report generated and hashed', report.body);
  const link = await api('GET', `/qc/reports/${report.body.report.id}/download`, { token: ca });
  ok(link.status === 200 && link.body.url.includes('?e='), 'download returns a short-lived signed link', link.body);
  const pdf = await fetch(BASE.replace('/api/v1', '') + link.body.url);
  const head = Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString('latin1');
  ok(pdf.status === 200 && head === '%PDF', 'the signed link serves the PDF');
  const tampered = await fetch(BASE.replace('/api/v1', '') + link.body.url.replace(/s=./, 's=x'));
  ok(tampered.status === 403, 'an edited link is refused', tampered.status);
  const expired = await fetch(BASE.replace('/api/v1', '') + link.body.url.replace(/e=\d+/, 'e=1'));
  ok(expired.status === 403, 'an expired link is refused', expired.status);
  const dlLog = await prisma.qcSecurityEvent.count({ where: { type: 'REPORT_DOWNLOAD', clientId: A.client.id } });
  ok(dlLog >= 1, 'the download was logged');
  const otherDl = await api('GET', `/qc/reports/${report.body.report.id}/download`, { token: caB.token });
  ok(otherDl.status === 404, 'another client cannot download this report', otherDl.status);

  // Hold point: lot 2's Pre-Pour is not done, so Frame cannot be requested for it.
  const frameBlocked = await api('POST', '/qc/inspections/request', { token: ca, body: reqBody([lot2], stageBy('3').id) });
  ok(frameBlocked.status === 409 && errCode(frameBlocked) === 'HOLD_POINT', 'a hold point blocks the next stage until the earlier one is complete', frameBlocked.body);
  const frameOk = await api('POST', '/qc/inspections/request', { token: ca, body: reqBody([lot1], stageBy('3').id) });
  ok(frameOk.status === 201, 'the next stage can be requested once the hold point is cleared', frameOk.body);

  // ───────────── SLA, overdue, escalation ─────────────
  console.log('SLA clocks and escalation');
  const defRow = await prisma.qcDefect.findFirstOrThrow({ where: { id: defectDraftId } });
  ok(defRow.sourceInspectionId === insId && defRow.sourceItemNumber === '1.2' && defRow.foundAtStage === 'Pre-Pour', 'the defect remembers its inspection, item and stage');
  const noDates = !defRow.ackDueAt && !defRow.rectifyDueAt;
  ok(noDates, 'an unreleased defect has no SLA clocks yet');
  const rel = await api('POST', `/qc/defects/${defectDraftId}/actions/release`, { token: tokens.pi, body: { cover_note: 'Please action' } });
  ok(rel.status === 200 && rel.body.defect.status.key === 'assigned', 'inspector releases the defect to the Builder', rel.body);
  const released = await prisma.qcDefect.findFirstOrThrow({ where: { id: defectDraftId } });
  ok(!!released.ackDueAt && !!released.rectifyDueAt && released.rectifyDueAt > released.ackDueAt, 'releasing starts the clocks from the policy in force', { ack: released.ackDueAt, rect: released.rectifyDueAt });
  await new Promise((r) => setTimeout(r, 800));
  const pmNotes = await prisma.qcNotification.count({ where: { entityId: defectDraftId, type: 'defect.released' } });
  ok(pmNotes >= 1, 'the Builder\'s people were notified of the release');

  const slaGet = await api('GET', `/qc/sla?projectId=${projectA}`, { token: ca });
  ok(slaGet.status === 200 && slaGet.body.sla.source.minor === 'default', 'SLA policy reads with its source', slaGet.body);
  const slaBad = await api('PUT', `/qc/sla/minor?projectId=${projectA}`, { token: ca, body: { acknowledge: { value: 2, unit: 'business_days' }, rectifyFrom: { value: 10, unit: 'business_days' }, rectifyTo: { value: 5, unit: 'business_days' }, reinspect: { value: 3, unit: 'business_days' } } });
  ok(slaBad.status === 400, 'a rectification range that runs backwards is refused', slaBad.body);
  const slaPut = await api('PUT', `/qc/sla/minor?projectId=${projectA}`, { token: ca, body: { acknowledge: { value: 2, unit: 'business_days' }, rectifyFrom: { value: 12, unit: 'business_days' }, orByNextStage: false, reinspect: { value: 3, unit: 'business_days' } } });
  ok(slaPut.status === 200 && slaPut.body.sla.source.minor === 'project', 'project override saved', slaPut.body);
  const afterChange = await prisma.qcDefect.findFirstOrThrow({ where: { id: defectDraftId } });
  ok(afterChange.rectifyDueAt!.getTime() === released.rectifyDueAt!.getTime(), 'a policy change does not move the due dates of defects already released');
  const slaUser = await api('PUT', `/qc/sla/minor?projectId=${projectA}`, { token: tokens.cuNo, body: {} });
  ok(slaUser.status === 403, 'only admins set SLA targets', slaUser.status);
  const audits = await api('GET', '/qc/audit?action=sla', { token: ca });
  ok(audits.body.entries.length >= 1 && audits.body.entries[0].before !== undefined, 'SLA changes are audited with before and after', audits.body);
  const rev = await api('DELETE', `/qc/sla?projectId=${projectA}&severity=minor`, { token: ca });
  ok(rev.status === 200 && rev.body.sla.source.minor === 'default', 'the project can revert to the client default', rev.body);

  await prisma.qcDefect.update({ where: { id: defectDraftId }, data: { ackDueAt: new Date(Date.now() - 3_600_000) } });
  const scan1 = await runSlaScan();
  const flagged = await prisma.qcDefect.findFirstOrThrow({ where: { id: defectDraftId } });
  ok(scan1.flagged >= 1 && flagged.flags.includes('overdue'), 'a breached acknowledgement clock flags the defect Overdue', { scan1, flags: flagged.flags });
  const esc1 = await prisma.qcEscalation.findMany({ where: { defectId: defectDraftId }, orderBy: { level: 'asc' } });
  ok(esc1.length === 1 && esc1[0]!.level === 1, 'level 1 (reminder) was raised', esc1.length);
  const escNote = await prisma.qcNotification.count({ where: { entityId: defectDraftId, type: 'defect.overdue' } });
  ok(escNote >= 1, 'the responsible party was notified');
  await runSlaScan();
  ok((await prisma.qcEscalation.count({ where: { defectId: defectDraftId } })) === 1, 'a second scan does not repeat level 1');
  await prisma.qcEscalation.updateMany({ where: { defectId: defectDraftId }, data: { triggeredAt: new Date(Date.now() - 10 * 86_400_000) } });
  await runSlaScan();
  const l2 = await prisma.qcDefect.findFirstOrThrow({ where: { id: defectDraftId } });
  ok(l2.escalationLevel === 2 && l2.flags.includes('escalated'), 'after the wait period level 2 flags it Escalated', { level: l2.escalationLevel, flags: l2.flags });
  await prisma.qcEscalation.updateMany({ where: { defectId: defectDraftId }, data: { triggeredAt: new Date(Date.now() - 20 * 86_400_000) } });
  await runSlaScan();
  const l3 = await prisma.qcDefect.findFirstOrThrow({ where: { id: defectDraftId } });
  ok(l3.escalationLevel === 3 && l3.flags.includes('contract_review'), 'level 3 flags it for contract review', { level: l3.escalationLevel, flags: l3.flags });
  const cuEsc = await api('POST', `/qc/defects/${defectDraftId}/escalate`, { token: tokens.cuNo, body: { action: 'Escalate', target_level: 4, reason_or_resolution_note: 'Need to refer' } });
  ok(cuEsc.status === 403, 'a Client User without the permission cannot escalate manually', cuEsc.status);
  const manual = await api('POST', `/qc/defects/${defectDraftId}/escalate`, { token: ca, body: { action: 'Escalate', target_level: 4, reason_or_resolution_note: 'Referring to dispute resolution' } });
  ok(manual.status === 201 && manual.body.escalation.level === 4 && manual.body.escalation.manual, 'a Client Admin escalates manually to level 4', manual.body);
  const referral = await api('POST', `/qc/escalations/${manual.body.escalation.id}/referral`, { token: ca, body: { referral_type: 'DBDRV', referral_date: '2026-10-20', reference_number: 'DB-1' } });
  ok(referral.status === 200 && referral.body.escalation.referralType === 'DBDRV', 'an external referral is recorded', referral.body);
  const escLog = await api('GET', `/qc/escalations?projectId=${projectA}`, { token: ca });
  ok(escLog.status === 200 && escLog.body.escalations.length >= 4, 'the escalation log lists every level', escLog.body.escalations?.length);

  // ───────────── Password reset, SSO, config scoping, legacy mobile accounts ─────────────
  console.log('Password reset, SSO, config scope, legacy accounts');
  const cuEmail = `cu${sfx}@example.com`;
  outbox.length = 0;
  const forgot = await api('POST', '/auth/password/forgot', { body: { email: cuEmail } });
  const forgotUnknown = await api('POST', '/auth/password/forgot', { body: { email: 'nobody@example.com' } });
  ok(forgot.status === 200 && forgotUnknown.status === 200, 'reset request answers the same for unknown emails');
  const resetMail = outbox.find((m) => m.to === cuEmail && m.subject.includes('Reset'));
  ok(!!resetMail && !outbox.some((m) => m.to === 'nobody@example.com'), 'a reset email is sent only to a real account');
  const resetToken = /\/reset\/([\w-]+)/.exec(resetMail?.text ?? '')?.[1] ?? '';
  const weakReset = await api('POST', '/auth/password/reset', { body: { token: resetToken, password: 'short' } });
  ok(weakReset.status === 400, 'reset enforces the 12 character minimum', weakReset.status);
  const NEWPW = 'An0ther-Str0ng-Pass!';
  const goodReset = await api('POST', '/auth/password/reset', { body: { token: resetToken, password: NEWPW } });
  ok(goodReset.status === 200, 'a valid reset link changes the password', goodReset.body);
  const reuseReset = await api('POST', '/auth/password/reset', { body: { token: resetToken, password: NEWPW } });
  ok(reuseReset.status === 410, 'a reset link works once', reuseReset.status);
  ok((await login(cuEmail, PW)).status === 401 && (await login(cuEmail, NEWPW)).status === 200, 'the old password stops working, the new one works');
  const oldSession = await api('GET', '/qc/me', { token: tokens.cuNo });
  ok(oldSession.status === 401, 'resetting a password signs out the person\'s other sessions', oldSession.status);
  tokens.cuNo = (await login(cuEmail, NEWPW)).body.accessToken;
  const ssoBogus = await api('POST', '/auth/sso/google', { body: { idToken: 'not-a-real-token' } });
  ok([400, 401, 501].includes(ssoBogus.status), 'single sign-on refuses an unverifiable token', ssoBogus.status);

  const cfgA = await api('GET', '/qc/config', { token: ca });
  ok(cfgA.status === 200 && cfgA.body.clients.length === 1 && cfgA.body.clients[0].id === A.client.id, 'the config bundle shows a Client Admin only their own client', cfgA.body.clients?.map((c: { name: string }) => c.name));
  const cfgB = await api('GET', '/qc/config', { token: caB.token });
  ok(cfgB.status === 200 && cfgB.body.clients.every((c: { id: string }) => c.id === B.client.id), 'and the other client only theirs');
  const cfgSa = await api('GET', '/qc/config', { token: sa });
  ok(cfgSa.status === 200 && cfgSa.body.clients.length === 0, 'the Super Admin sees no client data in the config bundle outside support mode', cfgSa.body.clients?.length);
  const cfgTrade = await api('GET', '/qc/config', { token: tokens.trade });
  ok(cfgTrade.status === 200 && cfgTrade.body.clients.every((c: { id: string }) => c.id === A.client.id), 'a Trade User\'s bundle is limited to their client');

  // An account that predates memberships (the mobile Houspect inspectors) keeps working on its own assignments.
  const legacyReg = await api('POST', '/auth/register', { body: { email: `legacy${sfx}@example.com`, password: 'Legacy-Passw0rd!', name: 'Legacy Inspector' } });
  ok(legacyReg.status === 201, 'a plain account can still register');
  const legacy = legacyReg.body.accessToken as string;
  await api('POST', '/qc/support/start', { token: sa, body: { clientId: A.client.id, reason: 'Assign a defect to a legacy account' } });
  const legacyDefect = await api('POST', '/qc/defects', { token: sa, body: { propertyId: lot2, assignedToId: legacyReg.body.user.id, defect_title: 'Legacy defect', description: 'Crack', room_or_area: 'External - front', severity: 'Minor Defect' } });
  await api('POST', '/qc/support/end', { token: sa });
  ok(legacyDefect.status === 201, 'a defect can be assigned to a legacy account', legacyDefect.body);
  const myTasks = await api('GET', '/qc/tasks/assigned', { token: legacy });
  ok(myTasks.status === 200 && myTasks.body.tasks.length === 1, 'the legacy account sees its own task');
  const myDefect = await api('GET', `/qc/defects/${legacyDefect.body.defect.id}`, { token: legacy });
  ok(myDefect.status === 200 && myDefect.body.defect.id === legacyDefect.body.defect.id, 'and its own defect');
  const otherDefect = await api('GET', `/qc/defects/${defectDraftId}`, { token: legacy });
  ok([403, 404].includes(otherDefect.status), 'but not anyone else\'s', otherDefect.status);
  const legacyList = await api('GET', '/qc/defects', { token: legacy });
  ok(legacyList.status === 200 && legacyList.body.defects.length === 1, 'its defect list holds only its own work', legacyList.body.defects?.length);
  const legacyNoPeople = await api('GET', '/qc/people', { token: legacy });
  ok(legacyNoPeople.status === 403, 'and it cannot list people', legacyNoPeople.status);

  // ───────────── Dashboard and reports ─────────────
  console.log('Dashboard and reports');
  const dash = await api('GET', `/qc/dashboard?projectId=${projectA}`, { token: ca });
  ok(dash.status === 200 && dash.body.totals.open >= 1 && dash.body.totals.escalated >= 1 && dash.body.bySeverity.length >= 1, 'dashboard counts open, overdue and escalated defects', dash.body.totals);
  const dashTrade = await api('GET', '/qc/dashboard', { token: tokens.trade });
  ok(dashTrade.status === 403, 'Trade Users have no dashboard', dashTrade.status);
  const open = await api('POST', '/qc/reports/open-items', { token: ca, body: { projectId: projectA } });
  ok(open.status === 201, 'Open Items Register (PDF)', open.body);
  const openX = await api('POST', '/qc/reports/open-items?format=xlsx', { token: ca, body: { projectId: projectA } });
  ok(openX.status === 201 && openX.body.report.fileName.endsWith('.xlsx'), 'Open Items Register (Excel)', openX.body);
  const escRep = await api('POST', '/qc/reports/escalations', { token: ca, body: {} });
  ok(escRep.status === 201, 'Escalation log (PDF)', escRep.body);
  const pack = await api('POST', `/qc/defects/${defectDraftId}/evidence-pack`, { token: ca });
  ok(pack.status === 201 && pack.body.report.fileName.endsWith('.zip'), 'evidence pack ZIP generated', pack.body);
  const packLink = await api('GET', `/qc/reports/${pack.body.report.id}/download`, { token: ca });
  const zipBytes = Buffer.from(await (await fetch(BASE.replace('/api/v1', '') + packLink.body.url)).arrayBuffer());
  const JSZip = (await import('jszip')).default;
  const z = await JSZip.loadAsync(zipBytes);
  const manifest = JSON.parse(await z.file('manifest.json')!.async('string'));
  ok(manifest.files.length >= 2 && manifest.files.every((f: { sha256: string }) => f.sha256.length === 64), 'the pack carries a manifest with SHA-256 hashes', manifest.files?.length);
  const record = JSON.parse(await z.file('defect.json')!.async('string'));
  ok(record.historyChainIntact === true && record.history.length >= 3, 'and the defect history with its hash chain');
  const portfolio = await api('GET', '/qc/portfolio', { token: ca });
  ok(portfolio.status === 200 && portfolio.body.projects.length === 2, 'portfolio lists the client\'s projects', portfolio.body);
  const portCu = await api('GET', '/qc/portfolio', { token: tokens.cuNo });
  ok(portCu.status === 403, 'portfolio is for Client Admins', portCu.status);

  // ───────────── DLP ─────────────
  console.log('Practical completion and DLP');
  const pcDate = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
  const dlpBad = await api('POST', `/qc/projects/${projectA}/dlp/start`, { token: tokens.cuNo, body: { practical_completion_date: pcDate } });
  ok(dlpBad.status === 403, 'only authorised roles set practical completion', dlpBad.status);
  const dlpStart = await api('POST', `/qc/projects/${projectA}/dlp/start`, { token: ca, body: { practical_completion_date: pcDate, basis: 'Occupancy permit issued', permit_or_certificate_number: 'OP-1', dlp_length: 12, applies_to: 'Whole project' } });
  ok(dlpStart.status === 200 && dlpStart.body.project.status === 'DLP', 'practical completion starts the DLP', dlpStart.body);
  const dlpInfo = await api('GET', `/qc/projects/${projectA}/dlp`, { token: ca });
  ok(!!dlpInfo.body.dlp.dlpEndDate && dlpInfo.body.dlp.summary.total === 0, 'DLP end date computed, nothing raised yet', dlpInfo.body);
  const dlpDef = await api('POST', '/qc/defects', { token: tokens.pi, body: { propertyId: lot1, assignedToId: piId, defect_title: 'Door sticks', description: 'Front door sticks on frame', room_or_area: 'Entry', severity: 'Minor Defect' } });
  ok(dlpDef.status === 201, 'inspector logs a DLP defect', dlpDef.body);
  const dlpDefRow = await prisma.qcDefect.findFirstOrThrow({ where: { id: dlpDef.body.defect.id } });
  ok(dlpDefRow.dlpDefect === true, 'defects raised during the DLP are flagged as DLP defects');
  // A draft is the inspector's alone and does not count; confirm it (with its photo) and it becomes an open DLP defect.
  const dlpId = dlpDef.body.defect.id as string;
  await prisma.qcDefect.update({ where: { id: dlpId }, data: { photoUrls: [String(photoUrl.split('?')[0])] } });
  const dlpConfirm = await api('POST', `/qc/defects/${dlpId}/actions/confirm`, { token: tokens.pi, body: { defect_title: 'Door sticks', description: 'Front door sticks on frame', room_or_area: 'External - front', element: 'Cladding, render or brickwork', location_detail: 'Front door', severity: 'Minor Defect', nature_of_defect: 'Workmanship', trade_category: renderer.id } });
  ok(dlpConfirm.status === 200, 'the DLP defect is confirmed', dlpConfirm.body);
  const blocked = await api('POST', `/qc/projects/${projectA}/dlp/closeout`, { token: ca, body: { developer_sign_off_name_position_date: 'Pat Admin, Director, 1 Oct 2027', declaration: true } });
  ok(blocked.status === 409 && errCode(blocked) === 'OPEN_DEFECTS', 'sign-off is blocked while DLP defects are open', blocked.body);
  const exc = await api('POST', `/qc/defects/${dlpId}/actions/accept_exception`, { token: ca, body: { basis: 'Owner agreed', reason: 'Minor and acceptable to the owner' } });
  ok(exc.status === 200 && exc.body.defect.status.key === 'accepted_exception', 'Client Admin accepts the defect as an exception', exc.body);
  const closeOut = await api('POST', `/qc/projects/${projectA}/dlp/closeout`, { token: ca, body: { developer_sign_off_name_position_date: 'Pat Admin, Director, 1 Oct 2027', declaration: true } });
  ok(closeOut.status === 201 && closeOut.body.summary.exceptions === 1, 'with the defect resolved the developer signs off the DLP', closeOut.body);
  const after = await prisma.qcProject.findUniqueOrThrow({ where: { id: projectA } });
  ok(after.status === 'DLP_COMPLETE' && !!after.dlpSignedOffAt, 'project is DLP complete');
  const dlpReport = await api('POST', `/qc/projects/${projectA}/dlp/report`, { token: ca });
  ok(dlpReport.status === 201, 'DLP close-out report generated', dlpReport.body);
  const lockedSa = await api('POST', '/qc/support/start', { token: sa, body: { clientId: A.client.id, reason: 'Check closed record lock' } });
  void lockedSa;
  const saEditClosed = await api('PATCH', `/qc/defects/${dlpId}`, { token: sa, body: { dueDate: '2027-01-01' } });
  ok(saEditClosed.status === 409 && errCode(saEditClosed) === 'RECORD_LOCKED', 'a terminal record is locked, even to the Super Admin', saEditClosed.body);
  await api('POST', '/qc/support/end', { token: sa });

  // DLP reminders and escalation window, on a second project.
  const proj2 = (await api('POST', '/qc/projects', { token: ca, body: projBody(mcAId, 'C') })).body.project.id as string;
  await prisma.qcProject.update({ where: { id: proj2 }, data: { status: 'DLP', dlpStartDate: new Date(Date.now() - 300 * 86_400_000), dlpEndDate: new Date(Date.now() + 20 * 86_400_000) } });
  const dr = await runDlpScan();
  ok(dr.reminders >= 1, 'a DLP reminder goes out inside the reminder window', dr);
  const reminderRec = await prisma.qcRecord.count({ where: { kind: 'dlp_reminder', projectId: proj2, title: '30' } });
  ok(reminderRec === 1, 'the 30-day reminder is recorded once');
  const dr2 = await runDlpScan();
  const again30 = await prisma.qcRecord.count({ where: { kind: 'dlp_reminder', projectId: proj2, title: '30' } });
  ok(again30 === 1 && dr2.reminders <= 1, 'a later scan does not repeat the same reminder');

  // ───────────── Closed records, last admin, shared logins ─────────────
  console.log('Archived projects, last admin, one login for several clients');
  await api('POST', '/qc/support/start', { token: sa, body: { clientId: A.client.id, reason: 'Check the last-admin rule' } });
  const lastAdmin = await api('POST', `/qc/people/${A.firstAdmin.id}/deactivate`, { token: sa, body: { reason: 'Left the company' } });
  ok(lastAdmin.status === 409 && errCode(lastAdmin) === 'LAST_ADMIN', 'the last active Client Admin cannot be deactivated', lastAdmin.body);
  await api('POST', '/qc/support/end', { token: sa });

  const noReasonArchive = await api('POST', `/qc/projects/${proj2}/status`, { token: ca, body: { status: 'ARCHIVED' } });
  ok(noReasonArchive.status === 400, 'archiving needs a reason', noReasonArchive.body);
  const archive = await api('POST', `/qc/projects/${proj2}/status`, { token: ca, body: { status: 'ARCHIVED', reason: 'Project complete' } });
  ok(archive.status === 200, 'a finished project can be archived', archive.body);
  const siteOnArchived = await api('POST', '/qc/sites', { token: ca, body: { projectId: proj2, site_name: 'Late site', site_address: ADDR, site_contact_name: 'Sam', site_contact_mobile: '0444444444', site_induction_required: false } });
  ok(siteOnArchived.status === 409 && errCode(siteOnArchived) === 'PROJECT_ARCHIVED', 'an archived project is read-only', siteOnArchived.body);
  const editArchived = await api('PATCH', `/qc/projects/${proj2}`, { token: ca, body: { project_name: 'Renamed' } });
  ok(editArchived.status === 409, 'its details cannot be edited either', editArchived.status);
  const reopen = await api('POST', `/qc/projects/${proj2}/status`, { token: ca, body: { status: 'CONSTRUCTION', reason: 'Late claim' } });
  ok(reopen.status === 200, 'it can be reopened with a reason', reopen.body);

  // One login can hold roles in several clients: each client's admin links the existing account instead of being refused.
  const legacyEmail = `legacy${sfx}@example.com`;
  const linkedA = await mkPerson(ca, { email_address: legacyEmail, first_name: 'Legacy', last_name: 'Inspector', role: 'CLIENT_USER' });
  ok(linkedA.status === 201 && linkedA.body.linked === true, 'an existing account is given a role instead of refused', linkedA.body);
  const dupLink = await mkPerson(ca, { email_address: legacyEmail, first_name: 'Legacy', last_name: 'Inspector', role: 'CLIENT_USER' });
  ok(dupLink.status === 409 && errCode(dupLink) === 'ALREADY_MEMBER', 'but not twice in the same client', dupLink.body);
  const linkedB = await mkPerson(caB.token, { email_address: legacyEmail, first_name: 'Legacy', last_name: 'Inspector', role: 'CLIENT_USER' });
  ok(linkedB.status === 201, 'a second client can give the same login another role', linkedB.body);
  const memberCount = await prisma.qcMembership.count({ where: { user: { email: legacyEmail }, status: 'ACTIVE' } });
  ok(memberCount === 2, 'the person now holds roles in two clients', memberCount);
  const noCtx = await api('GET', '/qc/me', { token: legacy });
  ok(noCtx.status === 409 && errCode(noCtx) === 'CONTEXT_REQUIRED', 'they are asked which client they are working in', noCtx.body);
  const asB = await api('GET', '/qc/me', { token: legacy, client: B.client.id });
  const asA = await api('GET', '/qc/me', { token: legacy, client: A.client.id });
  ok(asB.status === 200 && asA.status === 200 && asA.body.clientId === A.client.id && asB.body.clientId === B.client.id, 'and work in either one by naming it', { a: asA.body.role, b: asB.body.role });
  const dataIsolated = await api('GET', '/qc/projects', { token: legacy, client: A.client.id });
  ok(dataIsolated.status === 200 && dataIsolated.body.projects.every((p: { clientId: string }) => p.clientId === A.client.id), 'each context shows only its own client data');
  const sw = await api('POST', '/qc/context/switch', { token: legacy, body: { clientId: A.client.id } });
  ok(sw.status === 200, 'switching context is accepted');
  const swLog = await prisma.qcSecurityEvent.count({ where: { type: 'CONTEXT_SWITCH', clientId: A.client.id } });
  ok(swLog >= 1, 'and recorded', swLog);
  const swForeign = await api('POST', '/qc/context/switch', { token: tokens.cuNo, body: { clientId: B.client.id } });
  ok(swForeign.status === 404, 'a client you do not belong to cannot be switched to', swForeign.status);

  // ───────────── Gap closers ─────────────
  console.log('ABN override, bulk release, storage limit, hand-over on removal');
  const dupAbn = (await world('D', '51824753556', '004085616', '53004085616', {}, 409)) as unknown as Res;
  ok(dupAbn.status === 409 && errCode(dupAbn) === 'ABN_TAKEN', 'a repeated ABN is refused', dupAbn.body);
  const okAbn = await world('E', '51824753556', '004085616', '53004085616', { abnOverrideReason: 'Separate trading arm of the same group' });
  ok(okAbn.client.status === 'PENDING_ACTIVATION', 'it can be used again with a stated reason');
  const abnAudit = await prisma.qcAuditEntry.count({ where: { action: 'client.abn-override' } });
  ok(abnAudit === 1, 'and the override is audited');

  const rel1 = await api('POST', '/qc/defects', { token: tokens.pi, body: { propertyId: lot2, assignedToId: piId, defect_title: 'Bulk one', description: 'Chip', room_or_area: 'External - front', severity: 'Minor Defect' } });
  await prisma.qcDefect.update({ where: { id: rel1.body.defect.id }, data: { photoUrls: [String(photoUrl.split('?')[0])] } });
  const conf1 = await api('POST', `/qc/defects/${rel1.body.defect.id}/actions/confirm`, { token: tokens.pi, body: { defect_title: 'Bulk one', description: 'Chip', room_or_area: 'External - front', element: 'Cladding, render or brickwork', location_detail: 'Wall', severity: 'Minor Defect', nature_of_defect: 'Workmanship', trade_category: renderer.id } });
  ok(conf1.status === 200, 'a second defect is confirmed ready to release');
  const bulk = await api('POST', '/qc/defects/bulk/release', { token: tokens.pi, body: { ids: [rel1.body.defect.id, defectDraftId] } });
  const okRes = bulk.body.results?.find((r: { id: string }) => r.id === rel1.body.defect.id);
  const badRes = bulk.body.results?.find((r: { id: string }) => r.id === defectDraftId);
  ok(bulk.status === 200 && okRes?.ok === true && badRes?.ok === false, 'bulk release releases the ready one and reports the one that cannot move', bulk.body);

  await prisma.qcClient.update({ where: { id: A.client.id }, data: { data: { ...((await prisma.qcClient.findUniqueOrThrow({ where: { id: A.client.id } })).data as object), plan_and_limits: ['Tiny', '', '', 0.000000001] } } });
  const bigForm = new FormData();
  bigForm.append('files', new Blob([new Uint8Array(await png())], { type: 'image/png' }), 'x.png');
  bigForm.append('linkedType', 'Inspection'); bigForm.append('linkedId', insId);
  const full = await api('POST', '/qc/evidence', { token: tokens.pi, form: bigForm });
  ok(full.status === 409 && errCode(full) === 'PLAN_LIMIT', 'evidence uploads stop at the storage limit', full.body);
  const usage2 = await api('GET', '/qc/usage', { token: ca });
  ok(usage2.body.storageBytes > 0, 'usage reports the evidence stored', usage2.body);
  await prisma.qcClient.update({ where: { id: A.client.id }, data: { data: { ...((await prisma.qcClient.findUniqueOrThrow({ where: { id: A.client.id } })).data as object), plan_and_limits: ['Standard', '', '', ''] } } });

  const teamMember = await api('POST', `/qc/projects/${projectA}/team`, { token: ca, body: { assigneeType: 'PERSON', assigneeId: piId, project_role: opt('E10', 'project_role'), start_date: '2026-10-01' } });
  ok(teamMember.status === 201, 'the inspector joins the project team', teamMember.body);
  const rm1 = await api('DELETE', `/qc/team/${teamMember.body.member.id}`, { token: ca, body: { removalReason: 'Moved to another job' } });
  ok(rm1.status === 409 && errCode(rm1) === 'OPEN_WORK', 'removing someone with open items asks who takes over', rm1.body);

  // ───────────── Notifications ─────────────
  console.log('Notifications');
  const nlist = await api('GET', '/qc/notifications?unread=true', { token: tokens.pi });
  ok(nlist.status === 200 && nlist.body.notifications.length >= 1, 'inspector has unread notifications', nlist.body);
  const nid = nlist.body.notifications[0].id as string;
  const nread = await api('POST', `/qc/notifications/${nid}/read`, { token: tokens.pi });
  ok(nread.status === 200, 'mark one read');
  const otherRead = await api('POST', `/qc/notifications/${nid}/ack`, { token: ca });
  ok(otherRead.status === 404, 'nobody else can touch a notification', otherRead.status);
  const prefs = await api('GET', '/qc/notification-prefs', { token: ca });
  ok(prefs.body.events.some((e: { type: string; mandatory: boolean }) => e.type === 'defect.safety_hazard' && e.mandatory), 'preferences list mandatory events');
  const putPrefs = await api('PUT', '/qc/notification-prefs', { token: ca, body: { events: [{ type: 'defect.released', inApp: true, email: 'DIGEST' }, { type: 'defect.safety_hazard', inApp: false, email: 'OFF' }] } });
  ok(putPrefs.status === 200, 'preferences saved');
  const prefs2 = await api('GET', '/qc/notification-prefs', { token: ca });
  const sh = prefs2.body.events.find((e: { type: string }) => e.type === 'defect.safety_hazard');
  const rl = prefs2.body.events.find((e: { type: string }) => e.type === 'defect.released');
  ok(sh.inApp === true && sh.email === 'IMMEDIATE' && rl.email === 'DIGEST', 'a mandatory alert cannot be switched off; others can');
  const pushBad = await api('POST', '/qc/push-token', { token: tokens.pi, body: { token: 'nope' } });
  ok(pushBad.status === 400, 'invalid push token refused', pushBad.status);
  const pushOk = await api('POST', '/qc/push-token', { token: tokens.pi, body: { token: 'ExponentPushToken[abc123]', platform: 'ios' } });
  ok(pushOk.status === 200, 'push token registered');

  // ───────────── Privacy, records, tenant export ─────────────
  console.log('Privacy and records');
  const pr = await api('POST', '/qc/privacy/requests', { token: sa, body: { request_type: 'Access', requester_name_and_contact: 'Ivy Inspector, ivy@example.com', relationship_to_platform: 'Inspector', date_received: '2026-10-01' } });
  ok(pr.status === 201 && pr.body.request.data.due_date === '2026-10-31', 'privacy request logged with a 30-day due date', pr.body);
  const prNo = await api('POST', `/qc/privacy/requests/${pr.body.request.id}/export`, { token: sa, body: { userId: piId } });
  ok(prNo.status === 400, 'no export before identity is verified', prNo.status);
  await api('PATCH', `/qc/privacy/requests/${pr.body.request.id}`, { token: sa, body: { identityVerified: true, status: 'In progress' } });
  const prExport = await api('POST', `/qc/privacy/requests/${pr.body.request.id}/export`, { token: sa, body: { userId: piId }, raw: true });
  ok(prExport.status === 200 && String(prExport.body).includes('Ivy'), 'personal data export after verification');
  const prCa = await api('GET', '/qc/privacy/requests', { token: ca });
  ok(prCa.status === 403, 'privacy registers are Super Admin only', prCa.status);
  const br = await api('POST', '/qc/privacy/breaches', { token: sa, body: { detected_at_and_by: '2026-10-02T09:00:00Z', description: 'Misdirected email', data_types_involved: ['Names and contact details'], containment_actions: 'Recalled', assessment_decision: 'Pending' } });
  ok(br.status === 201 && br.body.incident.data.assessment_due === '2026-11-01', 'breach logged with a 30-day assessment due date', br.body);
  const brElig = await api('PATCH', `/qc/privacy/breaches/${br.body.incident.id}`, { token: sa, body: { assessment_decision: 'Eligible data breach' } });
  ok(brElig.status === 400, 'an eligible breach must record the regulator notification', brElig.body);
  const sp = await api('POST', '/qc/privacy/subprocessors', { token: sa, body: { name: 'Mail provider', purpose: 'Email', data_types: 'Names, email', processing_location: 'USA', outside_australia: true, status: 'Approved' } });
  ok(sp.status === 400, 'an overseas sub-processor cannot be approved without an APP 8 assessment', sp.body);
  const hold = await api('POST', '/qc/legal-holds', { token: ca, body: { scope: 'Project', subject: projectA, reason: 'Dispute with the builder', dispute_body: 'VCAT' } });
  ok(hold.status === 201, 'Client Admin places a legal hold', hold.body);
  const foreignHold = await api('POST', '/qc/legal-holds', { token: ca, body: { scope: 'Project', subject: projectB, reason: 'x' } });
  ok(foreignHold.status === 404, 'a hold cannot target another client\'s project', foreignHold.status);
  const relHold = await api('POST', `/qc/legal-holds/${hold.body.hold.id}/release`, { token: ca, body: { reason: 'Dispute settled' } });
  ok(relHold.status === 200 && relHold.body.hold.status === 'RELEASED', 'and releases it with a reason');
  const exp = await api('POST', `/qc/clients/${A.client.id}/export`, { token: ca, body: { export_contents: ['Data (CSV, JSON)', 'Audit trail'] }, raw: true });
  const expJson = JSON.parse(String(exp.body));
  ok(exp.status === 200 && expJson.defects.length >= 2 && expJson.auditTrail.length > 10, 'Client Admin exports their tenant data', exp.status);
  const expOther = await api('POST', `/qc/clients/${B.client.id}/export`, { token: ca, body: {} });
  ok(expOther.status === 404, 'but not another client\'s', expOther.status);
  const usage = await api('GET', '/qc/usage', { token: ca });
  ok(usage.status === 200 && usage.body.users >= 5, 'usage reports users and projects', usage.body);

  // Plan limits.
  await prisma.qcClient.update({ where: { id: B.client.id }, data: { data: { ...((await prisma.qcClient.findUniqueOrThrow({ where: { id: B.client.id } })).data as object), plan_and_limits: ['Starter', 3, 1, 5] } } });
  const limitUser = await api('POST', '/qc/people', { token: caB.token, body: person({ email_address: `lim${sfx}@example.com`, first_name: 'Lim', last_name: 'It', role: 'CLIENT_USER' }) });
  ok(limitUser.status === 201, 'within the plan limit a user can be added');
  const limitUser2 = await api('POST', '/qc/people', { token: caB.token, body: person({ email_address: `lim2${sfx}@example.com`, first_name: 'Lim', last_name: 'Two', role: 'CLIENT_USER' }) });
  ok(limitUser2.status === 409 && errCode(limitUser2) === 'PLAN_LIMIT', 'beyond the plan limit it is refused with a clear message', limitUser2.body);
  const limitProj = await api('POST', '/qc/projects', { token: caB.token, body: projBody(mcBId, 'Z') });
  ok(limitProj.status === 409 && errCode(limitProj) === 'PLAN_LIMIT', 'the project limit applies too', limitProj.body);

  // Suspension and offboarding block sign-in; sessions end.
  const sus = await api('POST', `/qc/clients/${B.client.id}/status`, { token: sa, body: { status: 'SUSPENDED', reason: 'Non-payment' } });
  ok(sus.status === 200, 'Super Admin suspends a client');
  const susApi = await api('GET', '/qc/me', { token: caB.token });
  ok(susApi.status === 401, 'its people are signed out at once', susApi.status);
  const susLogin = await login(B.firstAdmin.email);
  ok(susLogin.status === 403 && errCode(susLogin) === 'CLIENT_SUSPENDED', 'and cannot sign in while it is suspended', susLogin.body);
  const off = await api('POST', `/qc/clients/${B.client.id}/offboard`, { token: sa, body: { request_type: 'Offboard tenant', export_contents: ['Data (CSV, JSON)'], grace_period: 60, confirmation: true } });
  ok(off.status === 200, 'offboarding starts a grace period', off.body);
  const destroyEarly = await api('POST', `/qc/clients/${B.client.id}/destroy`, { token: sa });
  ok(destroyEarly.status === 409 && errCode(destroyEarly) === 'GRACE_PERIOD', 'data is not destroyed during the grace period', destroyEarly.body);

  // Retention housekeeping and audit integrity.
  const ret = await enforceRetention();
  ok(typeof ret.tokens === 'number', 'retention housekeeping runs', ret);
  const verifyChain = await api('GET', '/qc/audit/verify', { token: ca });
  ok(verifyChain.status === 200 && verifyChain.body.ok === true && verifyChain.body.checked > 20, `audit trail chain verifies (${verifyChain.body.checked} entries)`, verifyChain.body);
  // Skipped with QC_CHECK_TAMPER=off so the data left behind is clean for manual testing.
  if (process.env.QC_CHECK_TAMPER !== 'off') {
    const first = await prisma.qcAuditEntry.findFirstOrThrow({ where: { clientId: A.client.id }, orderBy: { createdAt: 'asc' } });
    await prisma.qcAuditEntry.update({ where: { id: first.id }, data: { reason: 'tampered' } });
    const tamper = await api('GET', '/qc/audit/verify', { token: ca });
    ok(tamper.body.ok === false, 'editing an audit entry is detected', tamper.body);
  }

  console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
}

main()
  .catch((e) => { failures++; console.error(e); })
  .finally(async () => {
    server.close();
    await prisma.$disconnect();
    process.exit(failures ? 1 : 0);
  });
