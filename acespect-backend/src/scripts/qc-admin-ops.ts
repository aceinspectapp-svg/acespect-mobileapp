/**
 * The Super Admin / Client Admin web-portal operations that qc-platform-check does not reach on its own:
 * every list / edit / delete / revert the portal screens offer, the validation each one enforces, who may and
 * may not use it, and that nothing leaks between clients. Called from qc-platform-check.ts with the world it built
 * (it adds its own records and leaves the platform check's records alone).
 */
import sharp from 'sharp';
import { prisma } from '../lib/prisma';

type Res = { status: number; body: any };
export interface OpsCtx {
  api: (method: string, path: string, opts?: { token?: string; body?: unknown; client?: string; form?: FormData; raw?: boolean }) => Promise<Res>;
  ok: (cond: unknown, label: string, extra?: unknown) => void;
  errCode: (r: Res) => string | undefined;
  sa: string;
  ca: string;
  caB: string;
  tokens: Record<string, string>;
  A: { client: { id: string } };
  B: { client: { id: string } };
  projectA: string;
  siteA: string;
  lot1: string;
  lot2: string;
  mcAId: string;
  mcBId: string;
  tradeId: string;
  piId: string;
  defectId: string;
  sfx: string;
  renderer: { id: string };
  stages: Array<{ id: string; stage_number: string }>;
  world: (tag: string, abn: string, acn: string, mcAbn: string, extra?: Record<string, unknown>, expect?: number) => Promise<any>;
  mcBody: (name: string, abn: string) => Record<string, unknown>;
  projBody: (mcId: string, n: string) => Record<string, unknown>;
  lotBody: (ref: string) => Record<string, unknown>;
  ADDR: Record<string, unknown>;
}

export async function adminOps(c: OpsCtx): Promise<void> {
  const { api, ok, errCode, sa, ca, caB, tokens, A, B, sfx } = c;
  const png = () => sharp({ create: { width: 48, height: 48, channels: 3, background: { r: 30, g: 120, b: 200 } } }).png().toBuffer();
  const fileForm = async (fields: Record<string, string>, name = 'photos') => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    f.append(name, new Blob([new Uint8Array(await png())], { type: 'image/png' }), 'p.png');
    return f;
  };

  // ───────────── Clients (Super Admin) ─────────────
  console.log('Admin ops: clients');
  const list = await api('GET', '/qc/clients', { token: sa });
  ok(list.status === 200 && list.body.clients.length >= 2, 'Super Admin lists every client', list.status);
  ok(list.body.clients.every((x: any) => 'status' in x && 'name' in x || 'legalEntityName' in x || 'legal_entity_name' in x), 'each client row carries its name and status', list.body.clients[0]);
  const caList = await api('GET', '/qc/clients', { token: ca });
  ok(caList.status === 403, 'a Client Admin cannot list all clients', caList.status);
  const getOwn = await api('GET', `/qc/clients/${A.client.id}`, { token: ca });
  ok(getOwn.status === 200, 'a Client Admin opens their own client', getOwn.body);
  const getOther = await api('GET', `/qc/clients/${B.client.id}`, { token: ca });
  ok(getOther.status === 404 || getOther.status === 403, 'but not another client', getOther.status);
  const patchOwnByCa = await api('PATCH', `/qc/clients/${A.client.id}`, { token: ca, body: { primary_contact_name: 'Hacked' } });
  ok(patchOwnByCa.status === 403, 'a Client Admin cannot edit the client record (Super Admin only)', patchOwnByCa.status);
  const patched = await api('PATCH', `/qc/clients/${A.client.id}`, { token: sa, body: { primary_contact_name: 'Pat Renamed', primary_contact_phone: '0499999999' } });
  ok(patched.status === 200, 'Super Admin edits a client', patched.body);
  const reread = await api('GET', `/qc/clients/${A.client.id}`, { token: sa });
  ok(JSON.stringify(reread.body).includes('Pat Renamed'), 'the edit is saved', reread.body);
  const badAbn = await api('PATCH', `/qc/clients/${A.client.id}`, { token: sa, body: { abn: '12345' } });
  ok(badAbn.status === 400, 'an invalid ABN is refused', badAbn.body);
  const badEmail = await api('PATCH', `/qc/clients/${A.client.id}`, { token: sa, body: { primary_contact_email: 'not-an-email' } });
  ok(badEmail.status === 400, 'an invalid contact email is refused', badEmail.body);
  const dupAbn = await api('PATCH', `/qc/clients/${A.client.id}`, { token: sa, body: { abn: '53004085616' } });
  ok(dupAbn.status === 400 || dupAbn.status === 409, 'an ABN already used by another client is refused', dupAbn.status);
  const missing = await api('GET', '/qc/clients/00000000-0000-0000-0000-000000000000', { token: sa });
  ok(missing.status === 404, 'an unknown client is 404', missing.status);

  const C = await c.world('C', '33102417032', '000000019', '53004085616');
  ok(C.client.status === 'PENDING_ACTIVATION', 'a fresh client starts Pending activation');
  const st1 = await api('POST', `/qc/clients/${C.client.id}/status`, { token: sa, body: { status: 'SUSPENDED', reason: 'Unpaid invoice' } });
  ok(st1.status === 200, 'Super Admin suspends a client', st1.body);
  const st2 = await api('POST', `/qc/clients/${C.client.id}/status`, { token: sa, body: { status: 'ACTIVE' } });
  ok(st2.status === 200 || st2.status === 400, 'reactivating answers cleanly (with or without a reason)', st2.body);
  const stBad = await api('POST', `/qc/clients/${C.client.id}/status`, { token: sa, body: { status: 'NONSENSE' } });
  ok(stBad.status === 400, 'an unknown status is refused', stBad.status);
  const stCaClient = await api('POST', `/qc/clients/${A.client.id}/status`, { token: ca, body: { status: 'SUSPENDED' } });
  ok(stCaClient.status === 403, 'a Client Admin cannot change their own client status', stCaClient.status);

  // Deleting a client must not leave its never-activated first admin with a live invitation (or a blocked email).
  const D = await c.world('D', '18123456789', '004085616', '53004085616');
  const dTok = D.invitation.url.split('/accept/')[1];
  const dDel = await api('DELETE', `/qc/clients/${D.client.id}`, { token: sa });
  ok(dDel.status === 200 || dDel.status === 204, 'Super Admin deletes a client that has no projects', dDel.body);
  const dInv = await api('GET', `/auth/invitations/${dTok}`);
  ok(dInv.status === 404 || dInv.status === 410, 'its invitation link stops working', dInv.status);
  const dReg = await api('POST', '/auth/register', { body: { email: D.firstAdmin.email, password: 'Str0ng-Passw0rd!', name: 'Reused Email' } });
  ok(dReg.status === 201, 'and the email can be registered again', dReg.body);
  const dLeft = await api('DELETE', `/qc/clients/${c.A.client.id}`, { token: sa });
  ok(dLeft.status === 409, 'a client with projects cannot be deleted (offboard instead)', dLeft.status);

  // ───────────── Client defaults and usage (Client Admin) ─────────────
  console.log('Admin ops: client defaults, usage');
  const defs = await api('GET', `/qc/clients/${A.client.id}/defaults`, { token: ca });
  ok(defs.status === 200 && 'defaults' in defs.body, 'Client Admin reads the client defaults', defs.body);
  const defsSave = await api('PUT', `/qc/clients/${A.client.id}/defaults`, { token: ca, body: { mfa_required_for_all_roles: false, idle_session_timeout: 45 } });
  ok(defsSave.status === 200, 'and saves them', defsSave.body);
  const defsAgain = await api('GET', `/qc/clients/${A.client.id}/defaults`, { token: ca });
  ok(JSON.stringify(defsAgain.body).includes('45'), 'the saved default is read back', defsAgain.body);
  const defsOther = await api('GET', `/qc/clients/${B.client.id}/defaults`, { token: ca });
  ok(defsOther.status === 403 || defsOther.status === 404, 'another client\'s defaults are not readable', defsOther.status);
  const defsCu = await api('GET', `/qc/clients/${A.client.id}/defaults`, { token: tokens.cuNo });
  ok(defsCu.status === 403, 'a Client User cannot see the defaults', defsCu.status);
  const usage = await api('GET', '/qc/usage', { token: ca });
  ok(usage.status === 200 && usage.body.users >= 5 && usage.body.projects >= 1, 'usage counts people and projects', usage.body);

  // ───────────── Master contractors ─────────────
  console.log('Admin ops: master contractors');
  const mcList = await api('GET', '/qc/master-contractors', { token: ca });
  ok(mcList.status === 200 && mcList.body.masterContractors.some((m: any) => m.id === c.mcAId) && !mcList.body.masterContractors.some((m: any) => m.id === c.mcBId), 'a Client Admin sees only their own contractors', mcList.body.masterContractors?.length);
  const mcNew = await api('POST', '/qc/master-contractors', { token: ca, body: c.mcBody(`Disposable Builder ${sfx}`, '33102417032') });
  ok(mcNew.status === 201, 'Client Admin adds a contractor', mcNew.body);
  const mcNewId = mcNew.body.masterContractor.id as string;
  const mcBadAbn = await api('POST', '/qc/master-contractors', { token: ca, body: c.mcBody(`Bad ABN ${sfx}`, '123') });
  ok(mcBadAbn.status === 400, 'a contractor with an invalid ABN is refused', mcBadAbn.status);
  const mcPatch = await api('PATCH', `/qc/master-contractors/${mcNewId}`, { token: ca, body: { primary_contact_name: 'Bobby Builder', after_hours_emergency_phone: '0433333333' } });
  ok(mcPatch.status === 200, 'Client Admin edits a contractor', mcPatch.body);
  const mcPatchOther = await api('PATCH', `/qc/master-contractors/${c.mcBId}`, { token: ca, body: { primary_contact_name: 'Hijack' } });
  ok(mcPatchOther.status === 404 || mcPatchOther.status === 403, 'cannot edit another client\'s contractor', mcPatchOther.status);
  const mcPatchMgr = await api('PATCH', `/qc/master-contractors/${mcNewId}`, { token: tokens.mgr, body: { primary_contact_name: 'Nope' } });
  ok(mcPatchMgr.status === 403, 'an MC Manager cannot edit contractor organisations', mcPatchMgr.status);
  const mcDelUsed = await api('DELETE', `/qc/master-contractors/${c.mcAId}`, { token: ca });
  ok(mcDelUsed.status === 409 || mcDelUsed.status === 400, 'a contractor with projects or people cannot be deleted', mcDelUsed.status);
  const mcDel = await api('DELETE', `/qc/master-contractors/${mcNewId}`, { token: ca });
  ok(mcDel.status === 200 || mcDel.status === 204, 'an unused contractor can be deleted', mcDel.body);
  const mcGone = await api('GET', '/qc/master-contractors', { token: ca });
  ok(!mcGone.body.masterContractors.some((m: any) => m.id === mcNewId), 'and disappears from the list');

  // ───────────── Trade categories (Super Admin) and trade companies ─────────────
  console.log('Admin ops: trade categories and companies');
  const catList = await api('GET', '/qc/trade-categories', { token: ca });
  ok(catList.status === 200 && catList.body.tradeCategories.length >= 5, 'trade categories are readable by everyone', catList.body);
  const catCa = await api('POST', '/qc/trade-categories', { token: ca, body: { name: 'Sneaky', code: 'SNK' } });
  ok(catCa.status === 403, 'only the Super Admin edits the category list', catCa.status);
  const catBody = { category_name: `Pergolas ${sfx}`, code: `PRG${sfx}`, licence_required: false, active: true };
  const catNew = await api('POST', '/qc/trade-categories', { token: sa, body: catBody });
  ok(catNew.status === 201, 'Super Admin adds a trade category', catNew.body);
  const catId = (catNew.body.tradeCategory ?? catNew.body.category ?? catNew.body)?.id;
  const catDup = await api('POST', '/qc/trade-categories', { token: sa, body: catBody });
  ok(catDup.status === 400 || catDup.status === 409, 'a duplicate category code is refused', catDup.status);
  const catPatch = await api('PATCH', `/qc/trade-categories/${catId}`, { token: sa, body: { ...catBody, category_name: `Pergolas and decks ${sfx}` } });
  ok(catPatch.status === 200, 'Super Admin renames it', catPatch.body);
  const catDel = await api('DELETE', `/qc/trade-categories/${catId}`, { token: sa });
  ok(catDel.status === 200 || catDel.status === 204, 'an unused category can be deleted', catDel.body);
  const catGone = await api('GET', '/qc/trade-categories', { token: ca });
  ok(!catGone.body.tradeCategories.some((x: any) => x.id === catId), 'and is gone from the list');

  const tcList = await api('GET', '/qc/trade-companies', { token: ca });
  ok(tcList.status === 200 && tcList.body.tradeCompanies.some((t: any) => t.id === c.tradeId), 'trade companies list', tcList.body.tradeCompanies?.length);
  const tcBody = (name: string, abn: string) => ({
    legal_entity_name: name, abn, gst_registered: true, trade_categories: [c.renderer.id], public_liability_insurer_policy_number_expiry: ['Ins', 'P1', '2027-01-01'],
    primary_contact_name: 'Tess', primary_contact_mobile: '0433333333', primary_contact_email: 'tess@example.com', engaged_by: [c.mcAId], address: c.ADDR, business_address: c.ADDR,
  });
  const tcNew = await api('POST', '/qc/trade-companies', { token: ca, body: tcBody(`Tiler ${sfx}`, '33102417032') });
  ok(tcNew.status === 201, 'Client Admin adds a trade company', tcNew.body);
  const tcId = tcNew.body.tradeCompany.id as string;
  const tcPatch = await api('PATCH', `/qc/trade-companies/${tcId}`, { token: ca, body: { primary_contact_name: 'Terry', primary_contact_mobile: '0433333334' } });
  ok(tcPatch.status === 200, 'edits a trade company', tcPatch.body);
  const catUsed = await api('POST', '/qc/trade-categories', { token: sa, body: { category_name: `Fencing ${sfx}`, code: `FNC${sfx}`, licence_required: false, active: true } });
  const catUsedId = (catUsed.body.tradeCategory ?? catUsed.body.category ?? catUsed.body)?.id;
  const tcFence = await api('POST', '/qc/trade-companies', { token: ca, body: { ...tcBody(`Fencer ${sfx}`, '51824753556'), trade_categories: [catUsedId] } });
  ok(tcFence.status === 201, 'a company is created in the new category', tcFence.body);
  const catRetire = await api('DELETE', `/qc/trade-categories/${catUsedId}`, { token: sa });
  ok(catRetire.status === 200 && catRetire.body.retired === true, 'a category in use is retired, not deleted', catRetire.body);
  const catAfter = await api('GET', '/qc/trade-categories', { token: ca });
  ok(catAfter.body.tradeCategories.find((x: any) => x.id === catUsedId)?.active === false, 'and shows as inactive', catAfter.body.tradeCategories.find((x: any) => x.id === catUsedId));
  const tcFenceDel = await api('DELETE', `/qc/trade-companies/${tcFence.body.tradeCompany.id}`, { token: ca });
  ok(tcFenceDel.status === 200 || tcFenceDel.status === 204, 'that company (no people) can be deleted', tcFenceDel.body);
  const tcNoCat = await api('POST', '/qc/trade-companies', { token: ca, body: { ...tcBody(`NoCat ${sfx}`, '53004085616'), trade_categories: [] } });
  ok(tcNoCat.status === 400, 'a trade company needs at least one category', tcNoCat.status);
  const tcOther = await api('PATCH', `/qc/trade-companies/${tcId}`, { token: caB, body: { primary_contact_name: 'Hijack' } });
  ok(tcOther.status === 404 || tcOther.status === 403, 'another client cannot edit it', tcOther.status);
  const tcDelUsed = await api('DELETE', `/qc/trade-companies/${c.tradeId}`, { token: ca });
  ok(tcDelUsed.status === 409 || tcDelUsed.status === 400, 'a trade company that has people cannot be deleted', tcDelUsed.status);
  const tcDel = await api('DELETE', `/qc/trade-companies/${tcId}`, { token: ca });
  ok(tcDel.status === 200 || tcDel.status === 204, 'an unused trade company can be deleted', tcDel.body);

  // ───────────── Projects, sites, lots, team ─────────────
  console.log('Admin ops: projects, sites, lots, team');
  const projNew = await api('POST', '/qc/projects', { token: ca, body: { ...c.projBody(c.mcAId, 'Z'), project_name: `Throwaway ${sfx}`, job_number: `JZ${sfx}` } });
  ok(projNew.status === 201 || projNew.status === 409, 'a new project is created or refused by the plan limit', projNew.body);
  const limited = projNew.status === 409;
  const pid = limited ? c.projectA : (projNew.body.project.id as string);
  if (!limited) {
    const pPatch = await api('PATCH', `/qc/projects/${pid}`, { token: ca, body: { project_name: `Throwaway renamed ${sfx}`, local_government_area: 'Yarra' } });
    ok(pPatch.status === 200, 'Client Admin edits a project', pPatch.body);
    const pGet = await api('GET', `/qc/projects/${pid}`, { token: ca });
    ok(JSON.stringify(pGet.body).includes('renamed'), 'the edit is saved', pGet.body);
  }
  const pBadDate = await api('PATCH', `/qc/projects/${c.projectA}`, { token: ca, body: { expected_practical_completion_date: 'tomorrow-ish' } });
  ok(pBadDate.status === 400, 'a malformed date is refused', pBadDate.status);
  const pPatchMgr = await api('PATCH', `/qc/projects/${c.projectA}`, { token: tokens.cuNo, body: { project_name: 'x' } });
  ok(pPatchMgr.status === 403, 'a Client User without permission cannot edit a project', pPatchMgr.status);

  const sites = await api('GET', `/qc/sites?projectId=${c.projectA}`, { token: ca });
  ok(sites.status === 200 && sites.body.sites.some((s: any) => s.id === c.siteA), 'sites list for a project', sites.body);
  const siteNew = await api('POST', '/qc/sites', { token: ca, body: { projectId: c.projectA, site_name: 'Stage 2', site_address: c.ADDR, site_contact_name: 'Sal', site_contact_mobile: '0444444445', site_induction_required: true } });
  ok(siteNew.status === 201, 'Client Admin adds a site', siteNew.body);
  const siteId = siteNew.body.site.id as string;
  const siteUp = await api('PATCH', `/qc/sites/${siteId}`, { token: ca, body: { site_name: 'Stage 2 renamed', site_contact_name: 'Sally' } });
  ok(siteUp.status === 200, 'edits a site', siteUp.body);
  const lotNew = await api('POST', '/qc/lots', { token: ca, body: { ...c.lotBody('Lot 90'), siteId } });
  ok(lotNew.status === 201, 'adds a lot to it', lotNew.body);
  const lotId = lotNew.body.lot.id as string;
  const lotDup = await api('POST', '/qc/lots', { token: ca, body: { ...c.lotBody('Lot 90'), siteId } });
  ok(lotDup.status === 400 || lotDup.status === 409, 'a duplicate lot reference on one site is refused', lotDup.status);
  const lotUp = await api('PATCH', `/qc/lots/${lotId}`, { token: ca, body: { storeys: 3, dwelling_type: 'Detached house' } });
  ok(lotUp.status === 200, 'edits a lot', lotUp.body);
  const lotList = await api('GET', `/qc/lots?projectId=${c.projectA}`, { token: ca });
  ok(lotList.status === 200 && lotList.body.lots.some((l: any) => l.id === lotId), 'lots list for the project', lotList.status);
  const lotOther = await api('PATCH', `/qc/lots/${lotId}`, { token: caB, body: { storeys: 9 } });
  ok(lotOther.status === 404 || lotOther.status === 403, 'another client cannot edit the lot', lotOther.status);
  const csvT = await api('GET', '/qc/lots/csv-template', { token: ca, raw: true });
  ok(csvT.status === 200 && (String(csvT.body).split('\n')[0] ?? '').toLowerCase().includes('lot'), 'the lot CSV template downloads with a header row', String(csvT.body).slice(0, 80));
  const lotDel = await api('DELETE', `/qc/lots/${lotId}`, { token: ca });
  ok(lotDel.status === 200 || lotDel.status === 204, 'an unused lot can be deleted', lotDel.body);
  const lotDelUsed = await api('DELETE', `/qc/lots/${c.lot1}`, { token: ca });
  ok(lotDelUsed.status === 409 || lotDelUsed.status === 400, 'a lot with inspections or defects cannot be deleted', lotDelUsed.status);
  const siteDel = await api('DELETE', `/qc/sites/${siteId}`, { token: ca });
  ok(siteDel.status === 200 || siteDel.status === 204, 'an empty site can be deleted', siteDel.body);
  const siteDelUsed = await api('DELETE', `/qc/sites/${c.siteA}`, { token: ca });
  ok(siteDelUsed.status === 409 || siteDelUsed.status === 400, 'a site with lots in use cannot be deleted', siteDelUsed.status);

  const team = await api('GET', `/qc/projects/${c.projectA}/team`, { token: ca });
  ok(team.status === 200 && Array.isArray(team.body.team), 'project team lists', team.body);
  const emp = await prisma.user.findFirst({ where: { email: `cuy${sfx}@example.com` } });
  const teamAdd = await api('POST', `/qc/projects/${c.projectA}/team`, { token: ca, body: { assigneeType: 'PERSON', assigneeId: emp!.id, project_role: 'Client User', start_date: '2026-10-01' } });
  ok(teamAdd.status === 201 || teamAdd.status === 200, 'Client Admin adds someone to the project team', teamAdd.body);
  const teamAfter = await api('GET', `/qc/projects/${c.projectA}/team`, { token: ca });
  const teamRow = (teamAfter.body.team ?? []).find((t: any) => t.userId === emp!.id);
  ok(!!teamRow, 'they appear on the team', teamAfter.body);
  if (teamRow) {
    const teamDel = await api('DELETE', `/qc/team/${teamRow.id}`, { token: ca });
    ok(teamDel.status === 200 || teamDel.status === 204, 'and can be removed', teamDel.body);
  }
  const tcOfB = await api('POST', '/qc/trade-companies', { token: caB, body: { ...tcBody(`B Trade ${sfx}`, '33102417032'), engaged_by: [c.mcBId] } });
  ok(tcOfB.status === 201, 'the other client engages its own trade company', tcOfB.body);
  const foreignTrade = await api('POST', `/qc/projects/${c.projectA}/team`, { token: ca, body: { assigneeType: 'TRADE_COMPANY', assigneeId: tcOfB.body.tradeCompany?.id, project_role: 'Client User', start_date: '2026-10-01' } });
  ok(foreignTrade.status === 400 || foreignTrade.status === 404 || foreignTrade.status === 409, 'a trade company engaged only by another client cannot be put on the team', foreignTrade.body);
  const teamOther = await api('GET', `/qc/projects/${c.projectA}/team`, { token: caB });
  ok(teamOther.status === 404 || teamOther.status === 403, 'another client cannot read the team', teamOther.status);

  if (!limited) {
    const projDel = await api('DELETE', `/qc/projects/${pid}`, { token: sa, client: A.client.id });
    ok(projDel.status === 200 || projDel.status === 204, 'Super Admin can delete an empty project', projDel.body);
  }
  const projDelCa = await api('DELETE', `/qc/projects/${c.projectA}`, { token: ca });
  ok(projDelCa.status === 409 || projDelCa.status === 400, 'a project with lots, inspections or defects cannot be deleted', projDelCa.body);
  const projDelCu = await api('DELETE', `/qc/projects/${c.projectA}`, { token: tokens.cuNo });
  ok(projDelCu.status === 403, 'a Client User cannot delete a project', projDelCu.status);
  const plan = await api('GET', `/qc/projects/${c.projectA}/plan`, { token: ca });
  ok(plan.status === 200 && plan.body.plan.length >= 1, 'the inspection plan loads', plan.body);
  const planRow = plan.body.plan?.[0];
  if (planRow) {
    const planPatch = await api('PATCH', `/qc/projects/${c.projectA}/plan/${planRow.id}`, { token: ca, body: { enabled: planRow.enabled } });
    ok(planPatch.status === 200, 'a plan stage can be saved', planPatch.body);
  }
  const docs = await api('GET', `/qc/projects/${c.projectA}/documents`, { token: ca });
  ok(docs.status === 200, 'project documents list', docs.status);

  // ───────────── People ─────────────
  console.log('Admin ops: people');
  const people = await api('GET', '/qc/people', { token: ca });
  ok(people.status === 200 && people.body.people.length >= 5, 'people list', people.body.people?.length);
  const trade = people.body.people.find((p: any) => p.email === `tr${sfx}@example.com` || p.user?.email === `tr${sfx}@example.com`);
  const tradeId = trade?.id ?? (await prisma.user.findFirstOrThrow({ where: { email: `tr${sfx}@example.com` } })).id;
  const pe = await api('PATCH', `/qc/people/${tradeId}`, { token: ca, body: { first_name: 'Thomas', mobile: '0466666668' } });
  ok(pe.status === 200, 'Client Admin edits a person', pe.body);
  const peBad = await api('PATCH', `/qc/people/${tradeId}`, { token: ca, body: { mobile: 'abc' } });
  ok(peBad.status === 400, 'an invalid mobile is refused', peBad.status);
  const peOther = await api('PATCH', `/qc/people/${tradeId}`, { token: caB, body: { first_name: 'Hijack' } });
  ok(peOther.status === 404 || peOther.status === 403, 'another client cannot edit the person', peOther.status);
  const peCu = await api('PATCH', `/qc/people/${tradeId}`, { token: tokens.cuNo, body: { first_name: 'Nope' } });
  ok(peCu.status === 403, 'a Client User cannot edit people', peCu.status);
  const dup = await api('POST', '/qc/people', { token: ca, body: { email_address: `tr${sfx}@example.com`, first_name: 'Dup', last_name: 'Dup', role: 'CLIENT_USER' } });
  ok(dup.status === 409 || dup.status === 400, 'adding someone with an existing email is refused', dup.status);
  const noRole = await api('POST', '/qc/people', { token: ca, body: { email_address: `nr${sfx}@example.com`, first_name: 'No', last_name: 'Role' } });
  ok(noRole.status === 400, 'a person needs a role', noRole.status);
  const noSuper = await api('POST', '/qc/people', { token: ca, body: { email_address: `su${sfx}@example.com`, first_name: 'Su', last_name: 'Per', role: 'SUPER_ADMIN' } });
  ok(noSuper.status === 400 || noSuper.status === 403, 'a Client Admin cannot create a Super Admin', noSuper.status);
  const target = await prisma.user.findFirstOrThrow({ where: { email: `mgr${sfx}@example.com` } });
  const off = await api('POST', `/qc/people/${target.id}/deactivate`, { token: ca, body: { reason: 'Role change' } });
  ok(off.status === 200, 'deactivate', off.body);
  const re = await api('POST', `/qc/people/${target.id}/reactivate`, { token: ca });
  ok(re.status === 200 || re.status === 204, 'reactivate', re.body);
  const reAgain = await api('POST', `/qc/people/${target.id}/reactivate`, { token: ca });
  ok([200, 204, 409, 400].includes(reAgain.status), 'reactivating an active person answers cleanly', reAgain.status);
  const inv = await api('POST', `/qc/people/${target.id}/invitation`, { token: ca });
  ok(inv.status === 200 || inv.status === 201 || inv.status === 409, 'resend invitation answers (409 when already activated)', inv.body);
  const fresh = await api('POST', '/qc/people', { token: ca, body: { email_address: `inv${sfx}@example.com`, first_name: 'In', last_name: 'Vited', role: 'CLIENT_USER' } });
  ok(fresh.status === 201, 'a new person is invited', fresh.body);
  const freshInv = await api('POST', `/qc/people/${fresh.body.person.id}/invitation`, { token: ca });
  ok(freshInv.status === 200 && freshInv.body.invitation.url.includes('/accept/'), 'the invitation can be resent and gives a fresh link', freshInv.body);
  const oldTok = fresh.body.invitation.url.split('/accept/')[1];
  const oldUse = await api('GET', `/auth/invitations/${oldTok}`);
  ok(oldUse.status === 404 || oldUse.status === 410, 'the earlier link stops working after a resend', oldUse.status);
  const cur = await prisma.qcInspectorCredential.findFirstOrThrow({ where: { userId: c.piId } });
  const picred = await api('PUT', `/qc/people/${c.piId}/credentials`, { token: sa, client: A.client.id, body: { ...(cur.data as Record<string, unknown>), qualifications: 'Dip Building, Cert IV' } });
  ok(picred.status === 200, 'credentials of an inspector can be updated', picred.body);
  const credCa = await api('PUT', `/qc/people/${c.piId}/credentials`, { token: ca, body: { qualifications: 'x' } });
  ok(credCa.status === 403, 'a Client Admin cannot change an inspector\'s credentials', credCa.status);
  const assignable = await api('GET', '/qc/inspectors', { token: ca });
  ok(assignable.status === 200 && assignable.body.users.some((u: any) => u.id === c.piId), 'the approved inspector is offered for assignment', assignable.body);

  // ───────────── Stages, result codes (Super Admin) ─────────────
  console.log('Admin ops: stages and result codes');
  const stNew = await api('POST', '/qc/stages', { token: sa, body: { stage_number: `9${sfx.slice(-2)}`, stage_name: `Landscaping ${sfx}`, sequence: 99, statutory_mandatory_notification_stage: false, applies_to_floor_systems: 'All', applies_to_building_classes: '1a', active: true } });
  ok(stNew.status === 201 || stNew.status === 200, 'Super Admin adds a stage', stNew.body);
  const stId = stNew.body.stage?.id;
  if (stId) {
    const stUp = await api('PUT', `/qc/stages/${stId}`, { token: sa, body: { stage_number: stNew.body.stage.stage_number ?? `9${sfx.slice(-2)}`, stage_name: `Landscaping ${sfx} v2`, sequence: 99, statutory_mandatory_notification_stage: false, applies_to_floor_systems: 'All', applies_to_building_classes: '1a', active: false } });
    ok(stUp.status === 200, 'and edits or retires it', stUp.body);
  }
  const stCa = await api('POST', '/qc/stages', { token: ca, body: { stage_number: '98', stage_name: 'x', sequence: 98 } });
  ok(stCa.status === 403, 'a Client Admin cannot add stages', stCa.status);
  const rc = await api('PUT', '/qc/result-codes/NOT_OK', { token: sa, body: { when_to_use: 'Updated guidance text' } });
  ok(rc.status === 200 || rc.status === 404, 'a result code\'s guidance can be saved by the Super Admin', rc.body);
  const rcCa = await api('PUT', '/qc/result-codes/NOT_OK', { token: tokens.cuNo, body: { when_to_use: 'x' } });
  ok(rcCa.status === 403, 'a Client User cannot', rcCa.status);

  // ───────────── Templates list / adopt ─────────────
  console.log('Admin ops: templates');
  const tl = await api('GET', '/qc/templates', { token: ca });
  ok(tl.status === 200 && tl.body.templates.length >= 3, 'the template list loads', tl.status);
  const tlBase = await api('GET', '/qc/templates?level=BASE', { token: ca });
  ok(tlBase.status === 200, 'filtering by level works', tlBase.status);
  const clientTpl = tl.body.templates.find((t: any) => t.level === 'CLIENT' && t.versionStatus === 'PUBLISHED');
  if (clientTpl) {
    const adopt = await api('POST', `/qc/templates/${clientTpl.id}/adopt`, { token: ca, body: { projectIds: [c.projectA] } });
    ok(adopt.status === 200, 'a client template is adopted for a project', adopt.body);
    const adoptOther = await api('POST', `/qc/templates/${clientTpl.id}/adopt`, { token: ca, body: { projectIds: ['00000000-0000-0000-0000-000000000000'] } });
    ok(adoptOther.status === 404 || adoptOther.status === 400 || adoptOther.status === 200, 'adopting for an unknown project answers cleanly', adoptOther.status);
  }

  // ───────────── SLA and policy ─────────────
  console.log('Admin ops: SLA and escalation policy');
  const sla = await api('GET', '/qc/sla', { token: ca });
  ok(sla.status === 200 && sla.body.severities.length >= 3, 'SLA targets load', sla.body);
  const sev = sla.body.severities[0].key;
  const slaSave = await api('PUT', `/qc/sla/${sev}`, { token: ca, body: sla.body.sla.effective[sev] });
  ok(slaSave.status === 200, 'a Client Admin saves an SLA target', slaSave.body);
  const slaBad = await api('PUT', `/qc/sla/${sev}`, { token: ca, body: { acknowledge: { value: -3, unit: 'hours' } } });
  ok(slaBad.status === 400, 'a negative duration is refused', slaBad.status);
  const slaUnknown = await api('PUT', '/qc/sla/not_a_severity', { token: ca, body: sla.body.sla.effective[sev] });
  ok(slaUnknown.status === 400 || slaUnknown.status === 404, 'an unknown severity is refused', slaUnknown.status);
  const slaProject = await api('PUT', `/qc/sla/${sev}?projectId=${c.projectA}`, { token: ca, body: sla.body.sla.effective[sev] });
  ok(slaProject.status === 200, 'a project can override a target', slaProject.body);
  const slaRevert = await api('DELETE', `/qc/sla?projectId=${c.projectA}`, { token: ca });
  ok(slaRevert.status === 200, 'and revert to the client default', slaRevert.body);
  const slaCu = await api('PUT', `/qc/sla/${sev}`, { token: tokens.cuNo, body: sla.body.sla.effective[sev] });
  ok(slaCu.status === 403, 'a Client User cannot change SLA targets', slaCu.status);
  const pol = await api('GET', '/qc/policy', { token: ca });
  ok(pol.status === 200 && pol.body.policy.effective.levels.length >= 1, 'the escalation policy loads', pol.status);
  const polSave = await api('PUT', '/qc/policy', { token: ca, body: { closurePolicy: pol.body.policy.effective.closurePolicy, dlpReminderDays: [60, 30, 7] } });
  ok(polSave.status === 200, 'it saves', polSave.body);
  const polBack = await api('GET', '/qc/policy', { token: ca });
  ok(JSON.stringify(polBack.body.policy.effective.dlpReminderDays) === '[60,30,7]', 'and reads back', polBack.body.policy?.effective?.dlpReminderDays);
  const polProj = await api('PUT', `/qc/policy?projectId=${c.projectA}`, { token: ca, body: { dlpReminderDays: [14] } });
  ok(polProj.status === 200 && polProj.body.policy.overridden.includes('dlpReminderDays'), 'a project override is marked as overridden', polProj.body.policy?.overridden);
  const polRevert = await api('DELETE', `/qc/policy?projectId=${c.projectA}&keys=dlpReminderDays`, { token: ca });
  ok(polRevert.status === 200 && !polRevert.body.policy.overridden.includes('dlpReminderDays'), 'and can be reverted key by key', polRevert.body.policy?.overridden);
  const polBad = await api('PUT', '/qc/policy', { token: ca, body: { dlpReminderDays: ['soon'] } });
  ok(polBad.status === 400, 'a malformed policy value is refused', polBad.status);
  const polOther = await api('GET', `/qc/policy?projectId=${(await prisma.qcProject.findFirstOrThrow({ where: { clientId: B.client.id } })).id}`, { token: ca });
  ok(polOther.status === 404 || polOther.status === 403, 'another client\'s project policy is not readable', polOther.status);

  // ───────────── Inspections: list, change, completion, evidence ─────────────
  console.log('Admin ops: inspections, defects, evidence');
  const il = await api('GET', `/qc/inspections?projectId=${c.projectA}`, { token: ca });
  ok(il.status === 200 && il.body.inspections.length >= 1, 'inspections list', il.status);
  const ilOther = await api('GET', `/qc/inspections?projectId=${(await prisma.qcProject.findFirstOrThrow({ where: { clientId: B.client.id } })).id}`, { token: ca });
  ok(ilOther.status === 404 || (ilOther.status === 200 && ilOther.body.inspections.length === 0), 'another client\'s inspections never show', ilOther.status);
  const ilStatus = await api('GET', `/qc/inspections?projectId=${c.projectA}&status=NOT_A_STATUS`, { token: ca });
  ok(ilStatus.status === 200 || ilStatus.status === 400, 'a bad status filter answers cleanly', ilStatus.status);
  const one = il.body.inspections[0];
  const chg = await api('POST', `/qc/inspections/${one.id}/change`, { token: ca, body: { action: 'cancel', reason: '' } });
  ok(chg.status === 400 || chg.status === 409, 'cancelling needs a reason (or is refused for that state)', chg.body);

  const comm = await api('POST', `/qc/defects/${c.defectId}/comments`, { token: ca, form: await fileForm({ body: 'Please attach the photo of the repair', comment: 'Please attach the photo of the repair', text: 'Please attach the photo of the repair' }) });
  ok(comm.status === 201 || comm.status === 200, 'a comment with a photo is added to a defect', comm.body);
  const ph = await api('POST', `/qc/defects/${c.defectId}/photos`, { token: ca, form: await fileForm({}) });
  ok(ph.status === 200 || ph.status === 201 || ph.status === 409 || ph.status === 400, 'adding photos answers cleanly for the defect\'s state', ph.body);
  const det = await api('GET', `/qc/defects/${c.defectId}`, { token: ca });
  ok(det.status === 200 && JSON.stringify(det.body).includes('Please attach the photo'), 'the comment is on the defect', det.status);
  const escs = await api('GET', `/qc/defects/${c.defectId}/escalations`, { token: ca });
  ok(escs.status === 200, 'a defect\'s escalations list', escs.body);
  const escLog = await api('GET', '/qc/escalations', { token: ca });
  ok(escLog.status === 200 && Array.isArray(escLog.body.escalations), 'the escalation log lists', escLog.body);
  const anEsc = escLog.body.escalations?.[0];
  if (anEsc) {
    const ack = await api('POST', `/qc/escalations/${anEsc.id}/ack`, { token: ca });
    ok(ack.status === 200, 'an escalation is acknowledged', ack.body);
  }
  const evl = await api('GET', `/qc/evidence?linkedType=Defect&linkedId=${c.defectId}`, { token: ca });
  ok(evl.status === 200 && Array.isArray(evl.body.evidence), 'evidence for a defect lists', evl.body);
  if (evl.body.evidence?.[0]) {
    const ver = await api('GET', `/qc/evidence/${evl.body.evidence[0].id}/verify`, { token: ca });
    ok(ver.status === 200 && ver.body.ok === true, 'evidence verifies against its stored hash', ver.body);
  }
  const defList = await api('GET', `/qc/defects?projectId=${c.projectA}`, { token: ca });
  ok(defList.status === 200 && defList.body.defects.length >= 1, 'defects list for the project', defList.status);
  for (const q of ['status=OPEN', 'severity=Minor%20Defect', 'q=door', 'overdue=true']) {
    const r = await api('GET', `/qc/defects?${q}`, { token: ca });
    ok(r.status === 200, `defects filter ${q} answers`, r.status);
  }
  const defCa = await api('POST', '/qc/defects', { token: ca, body: { propertyId: c.lot1, assignedToId: c.piId, defect_title: 'x', description: 'x', room_or_area: 'External - front', severity: 'Minor Defect' } });
  ok(defCa.status === 403, 'a Client Admin does not raise defects (inspectors do)', defCa.status);
  const defNoLot = await api('POST', '/qc/defects', { token: tokens.pi, body: { defect_title: 'No lot', description: 'x', room_or_area: 'External - front', severity: 'Minor Defect' } });
  ok(defNoLot.status === 400, 'a defect needs a lot', defNoLot.status);
  const defBadSev = await api('POST', '/qc/defects', { token: tokens.pi, body: { propertyId: c.lot1, assignedToId: c.piId, defect_title: 'Bad severity', description: 'x', room_or_area: 'External - front', severity: 'Catastrophic' } });
  ok(defBadSev.status === 400, 'an unknown severity is refused', defBadSev.status);
  const defOther = await api('POST', '/qc/defects', { token: tokens.pi, client: B.client.id, body: { propertyId: c.lot1, assignedToId: c.piId, defect_title: 'x', description: 'x', room_or_area: 'External - front', severity: 'Minor Defect' } });
  ok(defOther.status === 404 || defOther.status === 403 || defOther.status === 400, 'another client cannot raise a defect on the lot', defOther.status);

  // ───────────── Reports, legal holds, privacy registers, audit, support, property types ─────────────
  console.log('Admin ops: reports, holds, privacy, audit, property types');
  const rep = await api('GET', `/qc/reports?projectId=${c.projectA}`, { token: ca });
  ok(rep.status === 200 && rep.body.reports.length >= 1, 'generated reports list', rep.status);
  const repCu = await api('GET', '/qc/reports', { token: tokens.trade });
  ok(repCu.status === 403, 'a Trade User cannot open reports', repCu.status);
  const portX = await api('POST', '/qc/portfolio/export', { token: ca });
  ok(portX.status === 201 && portX.body.report.fileName.endsWith('.xlsx'), 'the portfolio exports to Excel', portX.body);
  const holds = await api('GET', '/qc/legal-holds', { token: ca });
  ok(holds.status === 200 && Array.isArray(holds.body.holds), 'legal holds list', holds.body);
  const holdBad = await api('POST', '/qc/legal-holds', { token: ca, body: { scope: 'Project', subject: c.projectA } });
  ok(holdBad.status === 400, 'a hold needs a reason', holdBad.status);
  const prRq = await api('GET', '/qc/privacy/requests', { token: sa });
  ok(prRq.status === 200, 'Super Admin reads privacy requests', prRq.status);
  const prBr = await api('GET', '/qc/privacy/breaches', { token: sa });
  ok(prBr.status === 200 && Array.isArray(prBr.body.incidents), 'breach register lists', prBr.body);
  const prSp = await api('GET', '/qc/privacy/subprocessors', { token: sa });
  ok(prSp.status === 200 && Array.isArray(prSp.body.subProcessors), 'sub-processor register lists', prSp.body);
  const spNew = await api('POST', '/qc/privacy/subprocessors', { token: sa, body: { name: `Mailer ${sfx}`, purpose: 'Email', country: 'Australia', data_types: 'Names, emails', processing_location: 'Australia', outside_australia: false, status: 'APPROVED' } });
  ok(spNew.status === 201 || spNew.status === 200, 'a sub-processor is added', spNew.body);
  const spId = spNew.body.subProcessor?.id;
  if (spId) {
    const spUp = await api('PUT', `/qc/privacy/subprocessors/${spId}`, { token: sa, body: { name: `Mailer ${sfx}`, purpose: 'Email and SMS', country: 'Australia', data_types: 'Names, emails', processing_location: 'Australia', outside_australia: false, status: 'APPROVED' } });
    ok(spUp.status === 200, 'and edited', spUp.body);
  }
  const prRet = await api('GET', '/qc/privacy/retention', { token: sa });
  ok(prRet.status === 200 && Array.isArray(prRet.body.due), 'records due for destruction list', prRet.body);
  const prCa = await api('GET', '/qc/privacy/breaches', { token: ca });
  ok(prCa.status === 403, 'privacy registers are Super Admin only', prCa.status);
  const sup = await api('GET', '/qc/support-sessions', { token: ca });
  ok(sup.status === 200, 'support sessions list is readable by Client Admin', sup.status);
  const aud = await api('GET', '/qc/audit?limit=20', { token: ca });
  ok(aud.status === 200 && aud.body.entries.length >= 1, 'the audit trail lists', aud.status);
  const audCu = await api('GET', '/qc/audit', { token: tokens.cuNo });
  ok(audCu.status === 403, 'a Client User cannot read the audit trail', audCu.status);

  const pts = await api('GET', '/qc/property-types', { token: ca });
  ok(pts.status === 200, 'property types list', pts.status);
  const ptNew = await api('POST', '/qc/property-types', { token: sa, client: A.client.id, body: { name: `Granny flat ${sfx}`, label: `Granny flat ${sfx}` } });
  ok(ptNew.status === 201 || ptNew.status === 400, 'a property type is added (or its shape is refused)', ptNew.body);
  const ptCa = await api('POST', '/qc/property-types', { token: tokens.cuNo, body: { name: 'x', label: 'x' } });
  ok(ptCa.status === 403, 'a Client User cannot', ptCa.status);

  console.log('Admin ops: plan, status, ad-hoc, drafts, context');
  const planNow = (await api('GET', `/qc/projects/${c.projectA}/plan`, { token: ca })).body.plan as Array<{ id: string; mandatoryNotification: boolean; noticeDays: number | null; holdPoint: boolean }>;
  const optionalRow = planNow.find((r) => !r.mandatoryNotification) ?? planNow[0]!;
  const pn = await api('PATCH', `/qc/projects/${c.projectA}/plan/${optionalRow.id}`, { token: ca, body: { noticeDays: 2, holdPoint: true } });
  ok(pn.status === 200 && pn.body.plan.find((r: any) => r.id === optionalRow.id).noticeDays === 2, 'notice days and hold point save on a plan stage', pn.body);
  const pnBad = await api('PATCH', `/qc/projects/${c.projectA}/plan/${optionalRow.id}`, { token: ca, body: { noticeDays: 99 } });
  ok(pnBad.status === 400, 'notice days outside 0 to 30 are refused', pnBad.status);
  const pnOff = await api('PATCH', `/qc/projects/${c.projectA}/plan/${planNow.find((r) => r.mandatoryNotification)!.id}`, { token: ca, body: { enabled: false } });
  ok(pnOff.status === 400 || pnOff.status === 409, 'a statutory notification stage cannot be switched off', pnOff.status);
  const otherTpl = await prisma.qcTemplate.findFirst({ where: { level: 'CLIENT', clientId: B.client.id } });
  if (otherTpl) {
    const pnTpl = await api('PATCH', `/qc/projects/${c.projectA}/plan/${optionalRow.id}`, { token: ca, body: { templateId: otherTpl.id } });
    ok(pnTpl.status === 400 || pnTpl.status === 404, 'another client\'s template cannot be put on the plan', pnTpl.status);
  }
  const trBad = await api('POST', `/qc/projects/${c.projectA}/status`, { token: ca, body: { status: 'NOT_A_STATUS' } });
  ok(trBad.status === 400 || trBad.status === 409, 'an unknown project status is refused', trBad.status);
  const trCu = await api('POST', `/qc/projects/${c.projectA}/status`, { token: tokens.cuNo, body: { status: 'CONSTRUCTION' } });
  ok(trCu.status === 403, 'a Client User cannot change the project status', trCu.status);
  const pSetup = await api('POST', '/qc/projects', { token: sa, client: A.client.id, body: { ...c.projBody(c.mcAId, 'S'), project_name: `Status walk ${sfx}`, job_number: `JS${sfx}` } });
  if (pSetup.status === 201) {
    const sid = pSetup.body.project.id as string;
    const toArch = await api('POST', `/qc/projects/${sid}/status`, { token: sa, client: A.client.id, body: { status: 'ARCHIVED' } });
    ok(toArch.status === 400, 'archiving needs a reason', toArch.body);
    const tooSoon = await api('POST', `/qc/projects/${sid}/status`, { token: sa, client: A.client.id, body: { status: 'CONSTRUCTION' } });
    ok(tooSoon.status === 400, 'construction cannot start before there is a lot, a plan and a template for every stage', tooSoon.body);
    const toArch2 = await api('POST', `/qc/projects/${sid}/status`, { token: sa, client: A.client.id, body: { status: 'ARCHIVED', reason: 'Cancelled before start' } });
    ok(toArch2.status === 200, 'and can be archived with a reason', toArch2.body);
    const editArch = await api('PATCH', `/qc/projects/${sid}`, { token: sa, client: A.client.id, body: { project_name: 'Edited while archived' } });
    ok(editArch.status === 409 || editArch.status === 400, 'an archived project is read-only', editArch.body);
  }

  const ah = await api('POST', '/qc/inspections/adhoc', { token: sa, client: A.client.id, body: { projectId: c.projectA, lotId: c.lot2, inspectorId: c.piId, type: 'Ad-hoc visit', purpose: 'Check the repair' } });
  ok(ah.status === 201 || ah.status === 400 || ah.status === 409, 'an ad-hoc visit is created or refused with a reason (never a 500)', ah.body);
  const ahCu = await api('POST', '/qc/inspections/adhoc', { token: tokens.cuNo, body: { projectId: c.projectA, inspectorId: c.piId } });
  ok(ahCu.status === 403, 'a Client User cannot create ad-hoc visits', ahCu.status);

  const draft = await api('POST', '/qc/defects', { token: tokens.pi, body: { propertyId: c.lot2, assignedToId: c.piId, defect_title: 'Draft to edit', description: 'Chip in render', room_or_area: 'External - front', severity: 'Minor Defect' } });
  ok(draft.status === 201, 'a draft defect is raised with valid values', draft.body);
  const dId = draft.body.defect.id as string;
  const dBadSev = await api('PATCH', `/qc/defects/${dId}`, { token: tokens.pi, body: { severity: 'Catastrophic' } });
  ok(dBadSev.status === 400, 'an unknown severity on an edit is refused', dBadSev.body);
  const dEdit = await api('PATCH', `/qc/defects/${dId}`, { token: tokens.pi, body: { defect_title: 'Draft edited', severity: 'Major Defect' } });
  ok(dEdit.status === 200, 'a draft can be edited', dEdit.body);
  const dBadNew = await api('POST', '/qc/defects', { token: tokens.pi, body: { propertyId: c.lot2, assignedToId: c.piId, defect_title: 'Typo severity', description: 'x', room_or_area: 'External - front', severity: 'Catastrophic' } });
  ok(dBadNew.status === 400, 'a new defect with an unknown severity is refused, not saved without one', dBadNew.body);
  const dBadRoom = await api('POST', '/qc/defects', { token: tokens.pi, body: { propertyId: c.lot2, assignedToId: c.piId, defect_title: 'Typo room', description: 'x', room_or_area: 'Moon base', severity: 'Minor Defect' } });
  ok(dBadRoom.status === 400, 'a room that is not on the list is refused', dBadRoom.body);
  const dCu = await api('GET', `/qc/defects/${dId}`, { token: tokens.trade });
  ok(dCu.status === 403 || dCu.status === 404, 'a trade user not assigned to the defect cannot open it', dCu.status);

  const ctxBad = await api('POST', '/qc/context/switch', { token: ca, body: { clientId: B.client.id } });
  ok(ctxBad.status === 403 || ctxBad.status === 404, 'switching to a client you do not belong to is refused', ctxBad.status);
  const ctxOk = await api('POST', '/qc/context/switch', { token: ca, body: { clientId: A.client.id } });
  ok(ctxOk.status === 200, 'switching to your own client works', ctxOk.status);
  const cfg = await api('GET', '/qc/config', { token: ca });
  ok(cfg.status === 200 && Array.isArray(cfg.body.severities) && cfg.body.severities.length >= 3, 'the config bundle carries the severity list', Object.keys(cfg.body ?? {}));
  const spec = await api('GET', '/qc/spec', { token: ca });
  ok(spec.status === 200, 'the form spec loads', spec.status);
  const perms = await api('GET', '/qc/permissions', { token: ca });
  ok(perms.status === 200 && perms.body.matrix.length >= 30, 'the permission matrix loads', perms.body.matrix?.length);
  const noToken = await api('GET', '/qc/projects');
  ok(noToken.status === 401, 'nothing is readable without signing in', noToken.status);

  console.log('Admin ops: notifications');
  const all = await api('POST', '/qc/notifications/all/read', { token: ca });
  ok(all.status === 200, 'mark-all-read works (the bell\'s button)', all.body);
  const nl = await api('GET', '/qc/notifications?unread=true', { token: ca });
  ok(nl.status === 200 && nl.body.unread === 0, 'and leaves nothing unread', nl.body.unread);
  const prefs = await api('GET', '/qc/notification-prefs', { token: ca });
  ok(prefs.status === 200 && prefs.body.events.length >= 3, 'preferences load', prefs.status);
  const prefsSave = await api('PUT', '/qc/notification-prefs', { token: ca, body: { events: prefs.body.events.map((e: any) => ({ type: e.type, inApp: e.mandatory ? true : e.inApp, email: e.mandatory ? e.email : 'OFF' })) } });
  ok(prefsSave.status === 200, 'and save', prefsSave.body);
}
