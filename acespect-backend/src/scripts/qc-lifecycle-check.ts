/**
 * End-to-end check of the QC master data + defect lifecycle (requirements spec
 * sections 6-9) at the service level. It creates real rows, so it refuses to
 * run against anything but a local database:
 *   DATABASE_URL=postgresql://...@localhost:5432/<scratch db> npx ts-node src/scripts/qc-lifecycle-check.ts
 * Stub file URLs stand in for photo uploads; nothing touches photo storage.
 */
import { prisma } from '../lib/prisma';
import * as master from '../modules/qc/qc.master.service';
import * as people from '../modules/qc/qc.people.service';
import * as defects from '../modules/qc/qc.defects.service';
import { ApiError } from '../utils/ApiError';

if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '')) {
  console.error('Refusing to run: DATABASE_URL must point at a local scratch database.');
  process.exit(1);
}

let failures = 0;
function ok(cond: unknown, label: string) {
  if (!cond) {
    failures++;
    console.log('  FAIL', label);
  } else console.log('  ok  ', label);
}
async function rejects(fn: () => Promise<unknown>, status: number, label: string, codeOrText?: string) {
  try {
    await fn();
    ok(false, `${label} (expected ${status}, got success)`);
  } catch (e) {
    const err = e as ApiError;
    const matches = err.statusCode === status && (!codeOrText || err.code === codeOrText || err.message.includes(codeOrText));
    ok(matches, `${label} -> ${err.statusCode} ${err.code ?? ''} ${matches ? '' : err.message}`);
  }
}

const ADDR = { streetNumber: '10', streetName: 'Elm', streetType: 'Street', suburb: 'Melbourne', state: 'VIC', postcode: '3000' };
const F16 = (over: Record<string, unknown> = {}) => ({
  defect_title: 'Cracked render near front door',
  description: 'Hairline crack 2mm wide, 600mm long above the front door.',
  room_or_area: 'External - front',
  element: 'Cladding, render or brickwork',
  location_detail: 'North wall, 600 mm above door head',
  severity: 'Major Defect',
  nature_of_defect: 'Workmanship',
  trade_category: '',
  ...over,
});

async function main() {
  const admin = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } });
  const SA = { id: admin.id, role: 'ADMIN' };

  console.log('Validation');
  await rejects(() => master.createClient({ legal_entity_name: 'Bad Co' }), 400, 'client with missing fields');
  await rejects(
    () => master.createClient({ legal_entity_name: 'Bad Abn Pty Ltd', entity_type: 'Company (Pty Ltd)', abn: '12345678901', acn: '004085616' }),
    400, 'invalid ABN rejected', 'ABN',
  );

  const suffix = Date.now().toString().slice(-5);
  const clientInput = {
    legal_entity_name: `Test Developer ${suffix} Pty Ltd`, entity_type: 'Company (Pty Ltd)', abn: '51824753556', acn: '004085616',
    gst_registered: true, client_type: 'Developer and builder', registered_office_address: ADDR,
    primary_contact_name: 'Pat Admin', primary_contact_email: 'PAT@Example.com', primary_contact_phone: '0412 345 678',
    accounts_contact_email: 'accounts@example.com', states_and_territories_of_operation: ['VIC'],
    default_time_zone: undefined as unknown, contract_start_date: '2026-10-01', mfa_required_for_all_roles: false, idle_session_timeout: 30,
    first_client_admin_name_and_email: ['Pat Admin', `pat${suffix}@example.com`],
  };
  const tz = (await import('../modules/qc/spec/qcSpec')).getForm('E01').fields.find((f) => f.key === 'default_time_zone')!.options![0];
  clientInput.default_time_zone = tz;
  const { client } = await master.createClient(clientInput);
  ok(client.clientCode?.startsWith('CLI-'), `client created ${client.clientCode}`);
  ok((client.data as Record<string, unknown>).primary_contact_phone === '+61412345678', 'phone normalised to E.164');
  ok((client.data as Record<string, unknown>).primary_contact_email === 'pat@example.com', 'email lower-cased');
  await rejects(() => master.createClient(clientInput), 409, 'duplicate ABN rejected', 'ABN_TAKEN');

  const mcSpecF = (await import('../modules/qc/spec/qcSpec')).getForm('E02');
  const opt = (code: string, key: string) => (code === 'E02' ? mcSpecF : (null as never)).fields.find((f) => f.key === key)!.options![0];
  const mc = await master.createMasterContractor({
    clientId: client.id, legal_entity_name: `Test Builder ${suffix}`, entity_type: 'Company (Pty Ltd)', abn: '53004085616', acn: '004085616',
    registering_authority: opt('E02', 'registering_authority'), registration_or_licence_category: opt('E02', 'registration_or_licence_category'),
    registration_or_licence_number: 'DB-U12345', registration_or_licence_expiry: '2027-06-30', business_address: ADDR,
    primary_contact_name: 'Bob Builder', primary_contact_email: 'bob@example.com', primary_contact_phone: '0411111111',
    after_hours_emergency_phone: '0422222222', public_liability_insurer: 'Insurer', public_liability_policy_number: 'PL1',
    public_liability_sum_insured: 20000000, public_liability_expiry: '2027-01-01', workers_compensation_insurer: 'WC', workers_compensation_policy_number: 'WC1',
    workers_compensation_expiry: '2027-01-01',
  });
  ok(!!mc.id, 'master contractor created');

  const plumber = await prisma.qcTradeCategory.findFirstOrThrow({ where: { code: 'PLMB' } });
  const renderer = await prisma.qcTradeCategory.findFirstOrThrow({ where: { code: 'REND' } });
  const tradeInput = (name: string, abn: string, cat: string) => ({
    legal_entity_name: name, abn, gst_registered: true, trade_categories: [cat], public_liability_insurer_policy_number_expiry: ['Ins', 'P1', '2027-01-01'],
    primary_contact_name: 'Tess Trade', primary_contact_mobile: '0433333333', primary_contact_email: 'tess@example.com', business_address: ADDR, engaged_by: [mc.id],
  });
  const rendCo = await master.createTradeCompany(tradeInput(`Render Co ${suffix}`, '53004085616', renderer.id));
  const plumbCo = await master.createTradeCompany(tradeInput(`Plumb Co ${suffix}`, '51824753556', plumber.id));
  ok(rendCo.categories.length === 1, 'trade company created with category');

  const projForm = (await import('../modules/qc/spec/qcSpec')).getForm('E07');
  const popt = (key: string) => projForm.fields.find((f) => f.key === key)!.options![0];
  const project = await master.createProject({
    project_name: `Test Project ${suffix}`, job_number: `J${suffix}`, developer: client.id, builder: mc.id, project_type: popt('project_type'),
    ncc_building_classes: ['1a'], state_or_territory: 'VIC', local_government_area: 'Melbourne', expected_practical_completion_date: '2027-12-01', dlp_length: 12,
  });
  ok(project.projectRef?.startsWith('PRJ-'), `project created ${project.projectRef}`);
  const siteF = (await import('../modules/qc/spec/qcSpec')).getForm('E08');
  const site = await master.createSite({
    projectId: project.id, site_name: 'Stage 1', site_address: ADDR, site_contact_name: 'Sam Site', site_contact_mobile: '0444444444', site_induction_required: false,
  });
  void siteF;
  const lotF = (await import('../modules/qc/spec/qcSpec')).getForm('E09');
  const lo = (key: string) => lotF.fields.find((f) => f.key === key)!.options![0];
  const lot = await master.createLot({
    siteId: site.id, lot_reference: 'Lot 7', lot_number: '7', dwelling_type: 'Townhouse', ncc_building_class: lo('ncc_building_class'), storeys: 2,
    floor_system: lo('floor_system'), frame: lo('frame'), wall_cladding: [lo('wall_cladding')], roof_cover: lo('roof_cover'),
  });
  ok(lot.propertyType.key === 'townhouse', 'lot created, dwelling type mapped to property type');

  console.log('People');
  const pi = await people.createPerson({
    email_address: `pi${suffix}@example.com`, first_name: 'Ivy', last_name: 'Inspector', mobile: '0455555555', white_card_number: 'WC123', white_card_issuing_state_or_territory: 'VIC',
    role: 'PRIVATE_INSPECTOR', credentials: {
      engagement_type: 'Contract panel inspector', registering_authority: (await import('../modules/qc/spec/qcSpec')).getForm('E06').fields.find((f) => f.key === 'registering_authority')!.options![0],
      registration_category: (await import('../modules/qc/spec/qcSpec')).getForm('E06').fields.find((f) => f.key === 'registration_category')!.options![0],
      registration_number: 'BI-U1', registration_expiry: '2027-05-01', qualifications: 'Dip Building',
      professional_indemnity_insurer_policy_number_lim: ['Ins','P1',1000000,'2027-01-01'], public_liability_insurer_policy_number_expiry: ['a', 'b', '2027-01-01'], approved_for_clients: [client.id],
    },
  });
  const pm = await people.createPerson({
    email_address: `pm${suffix}@example.com`, first_name: 'Pia', last_name: 'Manager', white_card_number: 'WC2', white_card_issuing_state_or_territory: 'VIC',
    role: 'MC_PROJECT_MANAGER', clientId: client.id, masterContractorId: mc.id,
  });
  const trade = await people.createPerson({
    email_address: `tu${suffix}@example.com`, first_name: 'Tom', last_name: 'Trade', mobile: '0466666666', white_card_number: 'WC3', white_card_issuing_state_or_territory: 'VIC',
    role: 'TRADE_USER', clientId: client.id, tradeCompanyId: rendCo.id, tradeCategoryIds: [renderer.id],
  });
  const cadmin = await people.createPerson({ email_address: `ca${suffix}@example.com`, first_name: 'Cal', last_name: 'Admin', role: 'CLIENT_ADMIN', clientId: client.id });
  const piU = { id: pi.person.id, role: pi.person.role };
  const pmU = { id: pm.person.id, role: pm.person.role };
  const trU = { id: trade.person.id, role: trade.person.role };
  const caU = { id: cadmin.person.id, role: cadmin.person.role };
  ok(piU.role === 'INSPECTOR' && pmU.role === 'FIELD_USER' && caU.role === 'CLIENT', 'QC roles map to platform login roles');
  await rejects(() => people.createPerson({ email_address: `x${suffix}@example.com`, first_name: 'No', last_name: 'Mobile', role: 'TRADE_USER', clientId: client.id, tradeCompanyId: rendCo.id, tradeCategoryIds: [renderer.id] }), 400, 'trade user needs mobile and white card');

  console.log('Assignment rules');
  await rejects(() => defects.createDefect(SA, { propertyId: lot.id, assignedToId: pmU.id }), 400, 'cannot assign a defect to a non-inspector', 'Private Inspector');
  const { client: client2 } = await master.createClient({ ...clientInput, legal_entity_name: `Other Developer ${suffix} Pty Ltd`, abn: '33051775556', acn: '004085616', first_client_admin_name_and_email: ['Oz Admin', `oz${suffix}@example.com`] });
  const outsider = await people.createPerson({ email_address: `ex${suffix}@example.com`, first_name: 'Eve', last_name: 'Elsewhere', mobile: '0499999999', white_card_number: 'W7', white_card_issuing_state_or_territory: 'VIC', role: 'PRIVATE_INSPECTOR', credentials: { engagement_type: 'Contract panel inspector', registering_authority: (await import('../modules/qc/spec/qcSpec')).getForm('E06').fields.find((f) => f.key === 'registering_authority')!.options![0], registration_category: (await import('../modules/qc/spec/qcSpec')).getForm('E06').fields.find((f) => f.key === 'registration_category')!.options![0], registration_number: 'BI-3', registration_expiry: '2027-05-01', qualifications: 'x', professional_indemnity_insurer_policy_number_lim: ['I', 'P', 1, '2027-01-01'], public_liability_insurer_policy_number_expiry: ['a', 'b', '2027-01-01'], approved_for_clients: [client2.id] } });
  await rejects(() => defects.createDefect(SA, { propertyId: lot.id, assignedToId: outsider.person.id }), 400, 'inspector not approved for this client is refused', 'not approved');
  const otherClientCred = await prisma.qcInspectorCredential.findUniqueOrThrow({ where: { userId: pi.person.id } });
  ok(otherClientCred.status === 'PENDING', 'new inspector credentials start Pending');
  await prisma.qcInspectorCredential.update({ where: { userId: pi.person.id }, data: { status: 'SUSPENDED' } });
  await rejects(() => defects.createDefect(SA, { propertyId: lot.id, assignedToId: pi.person.id }), 400, 'suspended inspector cannot take new defects', 'suspended');
  await prisma.qcInspectorCredential.update({ where: { userId: pi.person.id }, data: { status: 'APPROVED' } });

  console.log('Defect lifecycle');
  const draft = await defects.createDefect(SA, { propertyId: lot.id, assignedToId: piU.id });
  ok(draft.isDraft && draft.status.key === 'open' && /^J\d+-D0001$/.test(draft.defectRef ?? ''), `draft created ${draft.defectRef}`);
  await rejects(() => defects.performAction({ defectId: draft.id, action: 'release', input: {}, fileUrls: [], requester: piU }), 409, 'cannot release a draft', 'INVALID_TRANSITION');
  await rejects(() => defects.performAction({ defectId: draft.id, action: 'confirm', input: F16({ trade_category: renderer.id }), fileUrls: [], requester: piU }), 400, 'confirm needs at least one photo');
  await rejects(() => defects.performAction({ defectId: draft.id, action: 'confirm', input: F16({ trade_category: renderer.id, severity: 'Catastrophic' }), fileUrls: ['u/1'], requester: piU }), 400, 'bad severity rejected');
  let d = await defects.performAction({ defectId: draft.id, action: 'confirm', input: F16({ trade_category: renderer.id }), fileUrls: ['u/1.jpg'], requester: piU });
  ok(!d.defect.isDraft && d.defect.title?.startsWith('Cracked'), 'confirmed as Open');
  const run = (action: string, input: Record<string, unknown>, who: { id: string; role: string }, files: string[] = []) =>
    defects.performAction({ defectId: draft.id, action, input, fileUrls: files, requester: who });
  const key = async () => (await prisma.qcDefect.findUniqueOrThrow({ where: { id: draft.id }, include: { status: true } })).status.key;

  await rejects(() => run('release', {}, trU), 403, 'trade user cannot release');
  await run('release', { cover_note: 'Please review' }, piU);
  ok((await key()) === 'assigned', 'released -> Assigned');
  await rejects(() => run('allocate', { trade_company: plumbCo.id, target_rectification_date: '2026-11-01' }, pmU), 409, 'category mismatch needs confirmation', 'CATEGORY_MISMATCH');
  await run('allocate', { trade_company: rendCo.id, target_rectification_date: '2026-11-01', trade_user: trU.id }, pmU);
  ok((await key()) === 'allocated', 'allocated');
  await rejects(() => run('verify_or_reject', { method: 'On-site re-inspection', date_inspected_or_reviewed: '2026-10-05', outcome: 'Verified' }, piU, ['f']), 409, 'cannot verify while Allocated', 'INVALID_TRANSITION');
  await rejects(() => run('acknowledge', { acknowledgement: true, scheduled_attendance_date: '2026-10-01' }, trU), 400, 'cannot schedule in the past');
  await run('acknowledge', { acknowledgement: true, scheduled_attendance_date: '2099-01-01' }, trU);
  await run('progress', { progress_note: 'Started prep work', percent_complete: 30 }, trU);
  ok((await key()) === 'in_progress', 'in progress');
  await rejects(() => run('mark_rectified', { completion_date: '2026-10-09', work_done: 'Fixed' }, trU), 400, 'rectified needs after photos');
  await run('mark_rectified', { completion_date: '2026-10-09', work_done: 'Re-rendered and painted' }, trU, ['after/1.jpg']);
  ok((await key()) === 'rectified', 'rectified');
  await run('submit_reinspection', { builder_assessment: 'Work complete - request re-inspection', date_work_checked: '2026-10-10' }, pmU);
  ok((await key()) === 'pending_re_inspection', 'pending re-inspection');
  await rejects(() => run('verify_or_reject', { method: 'Evidence review (only where policy allows)', date_inspected_or_reviewed: '2026-10-11', outcome: 'Verified' }, piU, ['f']), 400, 'desk review blocked for Major');
  const rej = await run('verify_or_reject', { method: 'On-site re-inspection', date_inspected_or_reviewed: '2026-10-11', outcome: 'Rejected', fail_reason: 'Crack has reopened at the corner' }, piU, ['fresh/1.jpg']);
  ok((await key()) === 'reopened' && rej.defect.reworkCount === 1, 'rejected -> Reopened, rework count 1');
  await run('allocate', { trade_company: rendCo.id, target_rectification_date: '2026-11-15' }, pmU);
  await run('acknowledge', { acknowledgement: true, scheduled_attendance_date: '2099-01-01' }, trU);
  await run('progress', { progress_note: 'Second attempt' }, trU);
  await run('mark_rectified', { completion_date: '2026-10-20', work_done: 'Redone' }, trU, ['after/2.jpg']);
  await run('submit_reinspection', { builder_assessment: 'Work complete - request re-inspection', date_work_checked: '2026-10-21' }, pmU);
  await run('verify_or_reject', { method: 'On-site re-inspection', date_inspected_or_reviewed: '2026-10-22', outcome: 'Verified' }, piU, ['fresh/2.jpg']);
  ok((await key()) === 'verified', 'verified');
  await rejects(() => run('close', { confirm_lock: true }, piU), 409, 'inspector cannot close under Developer sign-off policy', 'INVALID_TRANSITION');
  await run('close', { confirm_lock: true }, caU);
  ok((await key()) === 'closed', 'closed by Client Admin');
  await rejects(() => run('hold', { reason_category: 'Awaiting materials', explanation: 'x' }, caU), 409, 'closed defect is terminal', 'INVALID_TRANSITION');

  const events = await prisma.qcDefectEvent.findMany({ where: { defectId: draft.id }, orderBy: { createdAt: 'asc' } });
  let chainOk = true;
  events.forEach((e, i) => { if (e.prevHash !== (i === 0 ? null : events[i - 1]!.hash)) chainOk = false; });
  ok(events.length >= 14 && chainOk, `history is append-only and hash-chained (${events.length} events)`);

  console.log('Hold / dispute / exception');
  const second = await defects.createDefect(SA, { propertyId: lot.id, assignedToId: piU.id });
  const run2 = (action: string, input: Record<string, unknown>, who: { id: string; role: string }, files: string[] = []) =>
    defects.performAction({ defectId: second.id, action, input, fileUrls: files, requester: who });
  await run2('confirm', F16({ trade_category: renderer.id, severity: 'Safety Hazard', defect_title: 'Exposed live wiring in ceiling' }), piU, ['p.jpg']);
  const afterConfirm = await prisma.qcDefect.findUniqueOrThrow({ where: { id: second.id }, include: { status: true } });
  ok(afterConfirm.status.key === 'assigned', 'Safety Hazard auto-released to the Builder');
  await rejects(() => run2('hold', { reason_category: 'Awaiting materials', explanation: 'Waiting on parts' }, pmU), 400, 'Safety Hazard hold needs Client Admin confirmation');
  await run2('hold', { reason_category: 'Awaiting materials', explanation: 'Waiting on parts', client_admin_confirmation: true }, pmU);
  await run2('resume', { explanation: 'Parts arrived' }, pmU);
  ok((await prisma.qcDefect.findUniqueOrThrow({ where: { id: second.id }, include: { status: true } })).status.key === 'assigned', 'resume returns to previous status');
  await run2('dispute_assignment', { reason_category: 'Duplicate', explanation: 'This duplicates defect 12 raised earlier.' }, pmU);
  await rejects(() => run2('resolve_dispute', { decision: 'Direct Builder to proceed', note: 'Proceed' }, pmU), 403, 'builder cannot resolve its own dispute');
  await run2('resolve_dispute', { decision: 'Request Inspector review', note: 'Please recheck' }, caU);
  await run2('inspector_review', { outcome: 'Withdraw defect', reason: 'It is a duplicate' }, piU);
  ok((await prisma.qcDefect.findUniqueOrThrow({ where: { id: second.id }, include: { status: true } })).status.key === 'withdrawn', 'dispute -> inspector review -> Withdrawn');

  console.log('Visibility');
  const other = await people.createPerson({ email_address: `o${suffix}@example.com`, first_name: 'Other', last_name: 'Inspector', mobile: '0477777777', white_card_number: 'W9', white_card_issuing_state_or_territory: 'VIC', role: 'PRIVATE_INSPECTOR', credentials: { engagement_type: 'Contract panel inspector', registering_authority: (await import('../modules/qc/spec/qcSpec')).getForm('E06').fields.find((f) => f.key === 'registering_authority')!.options![0], registration_category: (await import('../modules/qc/spec/qcSpec')).getForm('E06').fields.find((f) => f.key === 'registration_category')!.options![0], registration_number: 'BI-2', registration_expiry: '2027-05-01', qualifications: 'x', professional_indemnity_insurer_policy_number_lim: ['Ins','P1',1000000,'2027-01-01'], public_liability_insurer_policy_number_expiry: ['a', 'b', '2027-01-01'], approved_for_clients: [client.id] } });
  await rejects(() => defects.getDefectDetail(draft.id, { id: other.person.id, role: 'INSPECTOR' }), 403, 'unassigned inspector cannot see the defect');
  const detail = await defects.getDefectDetail(draft.id, trU);
  ok(!!detail.defect, 'allocated trade user can see the defect');

  console.log('Deactivate with reassignment');
  const third = await defects.createDefect(SA, { propertyId: lot.id, assignedToId: other.person.id });
  void third;
  await rejects(() => people.deactivatePerson(other.person.id, { reason: 'Left the company' }), 409, 'open work blocks deactivation', 'OPEN_WORK');
  const res = await people.deactivatePerson(other.person.id, { reason: 'Left the company', reassignToId: piU.id });
  ok(res.reassigned === 1, 'open work reassigned on deactivation');

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
