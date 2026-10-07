/**
 * Construction Stage inspections, stage A1: Pre-Pour (slab).
 *
 * Built from "Stage A1 Pre-Pour Inspector template, 4 Aug 2023", following its headings and row order exactly. The paper
 * form's "circle one" rows become tap choices, coloured by meaning (green OK, red defect, amber see notes, grey not
 * applicable). Nothing is asked that the paper form does not ask: defects and notes go in the Defects list and the notes
 * boxes, as on the form.
 *
 * One Construction Stage profile carries every stage; the sections of this stage use the key prefix "pp_" (see
 * templates.sections.ts). Job Information ("job-info") is shared by all stages. The same templates are published for
 * Residential House and Apartment.
 *
 *   npx tsx src/scripts/seed-construction-pre-pour.ts          (idempotent: unchanged templates are skipped; also runs on every server start)
 */
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption, templateFieldSchema } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'construction_stage';
const PROPERTY_TYPES = ['residential_house', 'apartment'];

type Tone = 'ok' | 'bad' | 'warn' | 'na';
const COLOR: Record<Tone, string> = { ok: '#1FA463', bad: '#E63329', warn: '#E8A33D', na: '#94A1B2' };

type Draft = Omit<TemplateField, 'order'>;
const numbered = (fields: Draft[]): TemplateField[] => fields.map((f, i) => ({ ...f, order: i }));
const slug = (label: string) => label.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'opt';

/** Plain options (no colour). */
function opts(...labels: string[]): TemplateFieldOption[] {
  const seen = new Set<string>();
  return labels.map((label) => {
    let value = slug(label);
    let n = 2;
    while (seen.has(value)) value = `${value.slice(0, 55)}_${n++}`;
    seen.add(value);
    return { value, label };
  });
}

interface Choice { label: string; tone: Tone }
const ok = (label: string): Choice => ({ label, tone: 'ok' });
const bad = (label: string): Choice => ({ label, tone: 'bad' });
const warn = (label: string): Choice => ({ label, tone: 'warn' });
const na = (label: string): Choice => ({ label, tone: 'na' });

/**
 * One checklist row from the paper form: a coloured tap choice, and (only where the form has a "Photos with
 * measurements" box beside the row) a photo button. `group` puts the row under a heading.
 */
function check(key: string, label: string, choices: Choice[], group: string, o: { required?: boolean; photosAlways?: string } = {}): Draft[] {
  const options: TemplateFieldOption[] = choices.map((c) => ({ value: slug(c.label), label: c.label, color: COLOR[c.tone] }));
  const rows: Draft[] = [{ key, type: 'pill-select', label, options, required: o.required ?? true, sectionLetter: group }];
  if (o.photosAlways) rows.push({ key: `${key}Photos`, type: 'photos', label: o.photosAlways, sectionLetter: group });
  return rows;
}

const OK_DEFECT = [ok('Yes — OK'), bad('No — defect')];
const YES_DEFECT = [bad('Yes — defect'), ok('No — OK')];

// ───────────────────────── Job Information (shared by every stage) ─────────────────────────

function jobInfoFields(existing: TemplateField[]): TemplateField[] {
  const weather = existing.find((f) => f.key === 'weather');
  const weatherOther = existing.find((f) => f.key === 'weatherOther');
  if (!weather) throw new Error('The existing Job Information template has no weather field to reuse');
  const list: Draft[] = [
    // "V" is locked ahead of the number the inspector types (the paper form is pre-printed "V2").
    { key: 'jobNumber', type: 'text', label: 'Job No', prefix: 'V', required: true, placeholder: 'e.g. 2' },
    { key: 'inspectionDate', type: 'date', label: 'Inspection Date', required: true },
    { key: 'assignedInspector', type: 'text', label: 'Inspector initials', required: true },
    { key: 'clientName', type: 'text', label: 'Client name', required: true },
    { key: 'inspectionAddress', type: 'text', label: 'Inspection Address', required: true },
    { ...(weather as Draft), required: true },
    ...(weatherOther ? [weatherOther as Draft] : []),
    { key: 'stageOption', type: 'pill-select', label: 'Stage', required: true, options: opts('Pre-pour for slab', 'Base') },
    { key: 'comments', type: 'textarea', label: 'Comments', placeholder: 'Anything to flag about this job' },
  ];
  return numbered(list);
}

// ───────────────────────── Pre-Pour sections ─────────────────────────

const description: Draft[] = [
  { key: 'streetPhotos', type: 'photos', label: 'Site from the street — take 4 to 6 photos', required: true },
  { key: 'elevationPhotos', type: 'photos', label: 'Sides and rear elevations' },
  { key: 'neighbourPhotos', type: 'photos', label: 'Where the property sits against neighbouring properties, structures and the streetscape' },
  { key: 'constructedBy', type: 'pill-select', label: 'Constructed by', options: opts('Metricon', 'Carlisle', 'Simonds'), allowOther: true, required: true },
  { key: 'constructionIs', type: 'pill-select', label: 'Construction is', options: opts('Single storey', 'Double storey', 'Split level'), allowOther: true, required: true },
  { key: 'foundations', type: 'pill-select', label: 'Foundations are', options: opts('Concrete slab', 'Timber stumps', 'Concrete stumps', 'Brick piers'), allowOther: true, required: true },
  { key: 'frontage', type: 'pill-select', label: 'Street frontage is', options: opts('North', 'South', 'East', 'West'), required: true },
  { key: 'blockSlope', type: 'pill-select', label: 'The block is', options: opts('Steep sloping', 'Gently sloping', 'Mostly flat'), required: true },
  { key: 'supervisorOnSite', type: 'yesno', label: 'Supervisor on site', required: true },
  { key: 'ownersOnSite', type: 'yesno', label: 'Owners on site', required: true },
  { key: 'safetyIssues', type: 'yesno', label: 'Safety issues', required: true },
  { key: 'safetyDescribe', type: 'textarea', label: 'Describe safety matters', required: true, gate: { fieldKey: 'safetyIssues', equals: 'yes' } },
  {
    key: 'plansSpecs', type: 'chip-multiselect', label: 'Plans & specifications', required: true,
    options: [...opts('Full set of drawings', 'Working drawings', 'Schematics', 'List of specifications', 'Limited documents'), { value: 'other', label: 'Other' }],
  },
  { key: 'plansSpecsOther', type: 'textarea', label: 'Other plans or documents — specify', gate: { fieldKey: 'plansSpecs', equalsAny: ['other'] } },
  { key: 'clientIssuesList', type: 'pill-select', label: 'Client list of issues (print or refer to it and answer every item)', required: true, options: opts('Yes', 'N/A') },
];

const SITE = 'Site and facilities';
const siteFacilities: Draft[] = [
  ...check('builderSign', "Builder's sign displayed", [ok('Yes — OK'), bad('No — defect')], SITE),
  ...check('powerSupply', 'Power supply to site', [ok('Yes — OK'), warn('No — see notes')], SITE),
  ...check('waterSupply', 'Water supply to site', [ok('Yes — OK'), warn('No'), bad('Leaking')], SITE),
  ...check('siteToilet', 'Site toilet in position', [ok('Yes — OK'), warn('No — see notes')], SITE),
  ...check('securityFencing', 'Security fencing in place', [ok('Yes — OK'), warn('No — see notes')], SITE),
  ...check('rubbishDangerous', 'Rubbish dangerous on site', [ok('No'), bad('Yes — defect')], SITE),
  ...check('siteManaged', 'Is the site well managed?', [ok('Yes'), bad('No'), warn('Can be improved by cleaning up rubbish for access & safety reasons')], SITE),
  ...check('kerbDamage', 'Damage to kerb / path / crossover', [ok('OK'), warn('See notes'), warn('Other')], SITE),
];

const PEGS = 'Boundary survey pegs';
function setbackBlock(side: 'front' | 'right' | 'rear' | 'left', title: string, datum: string[]): Draft[] {
  const g = title;
  return [
    { key: `${side}Datum`, type: 'pill-select', label: 'Datum point you used', options: opts(...datum), allowOther: true, required: true, sectionLetter: g },
    { key: `${side}Plan`, type: 'numeric', label: `${title} on plan`, unit: 'mm', required: true, sectionLetter: g },
    { key: `${side}Site`, type: 'numeric', label: `${title} on site (approx)`, unit: 'mm', required: true, sectionLetter: g },
    {
      key: `${side}Result`, type: 'pill-select', label: `${title} — result`, required: true, sectionLetter: g, allowOther: true,
      options: [
        { value: 'ok', label: 'OK', color: COLOR.ok },
        { value: 'variation_okay', label: 'Variation appears to be okay', color: COLOR.ok },
        { value: 'builder_to_recheck', label: 'Builder to re-check', color: COLOR.warn },
      ],
    },
  ];
}
const measurements: Draft[] = [
  {
    key: 'boundaryPegs', type: 'chip-multiselect', label: 'Boundary survey pegs are visible at', required: true, sectionLetter: PEGS,
    options: [{ value: 'front', label: 'Front' }, { value: 'rear', label: 'Rear' }, { value: 'left_side', label: 'Left side' }, { value: 'right_side', label: 'Right side' }, { value: 'none_visible', label: 'None visible', exclusive: true }],
  },
  ...setbackBlock('front', 'Front setback', ['Estimated from pegs', 'Footpath', 'Permanent fence', 'Retaining wall', 'Brick wall']),
  ...setbackBlock('right', 'Right side setback', ['Estimated from pegs', 'Permanent fence', 'Retaining wall', 'Brick wall']),
  ...setbackBlock('rear', 'Rear setback', ['Estimated from pegs', 'Permanent fence', 'Retaining wall', 'Brick wall']),
  ...setbackBlock('left', 'Left side setback', ['Estimated from pegs', 'Permanent fence', 'Retaining wall', 'Brick wall']),
];

const SLAB = 'Slab and formwork';
const REO = 'Reinforcing';
const WAFFLE = 'Waffle pods';
const SERVICES = 'Services and penetrations';
const POUR = [ok('Part of main pour & OK'), bad('Defect'), warn('Infill later — refer notes')];
const MEAS = 'Photos with measurements';
const formwork: Draft[] = [
  ...check('slabDimensions', 'Slab formwork dimensions', [ok('OK'), bad('Defect'), bad('Overhangs, too short, etc.')], SLAB, { photosAlways: MEAS }),
  ...check('garageSlab', 'Garage slab formed', POUR, SLAB, { photosAlways: MEAS }),
  ...check('porchSlab', 'Porch slab formed', POUR, SLAB, { photosAlways: MEAS }),
  ...check('alfrescoSlab', 'Alfresco slab formed', POUR, SLAB, { photosAlways: MEAS }),
  ...check('poolFormed', 'Inground pool formed', [na('Not applicable'), ok('OK'), bad('Defect'), warn('Refer notes')], SLAB),
  ...check('formworkBowed', 'Formwork bowed', YES_DEFECT, SLAB),
  ...check('formworkPegged', 'Formwork pegged & secure', OK_DEFECT, SLAB),
  ...check('footingDepths', 'Footing depths', [ok('OK'), warn('Could not see')], SLAB),
  ...check('excessWater', 'Excess water to footings', [ok('No — OK'), warn('Could not see')], SLAB),
  ...check('polythene', 'Polyethylene positioned, overlaid and sealed', [ok('Yes — OK'), bad('No — defect'), warn('Covered in backfill')], SLAB),

  ...check('reoPosition', 'Reinforcing in position', OK_DEFECT, REO),
  ...check('reoClearances', 'Reinforcing clearances', OK_DEFECT, REO),
  ...check('reoDamaged', 'Reinforcing damaged', YES_DEFECT, REO),
  ...check('reoSaddles', 'Reo securely on saddles', OK_DEFECT, REO),
  ...check('sideBars', 'Side bars, corner bars in correct positions', OK_DEFECT, REO),

  ...check('wafflePositioned', 'Waffle pods positioned', OK_DEFECT, WAFFLE),
  ...check('waffleSpacings', 'Waffle pod spacings', OK_DEFECT, WAFFLE),
  ...check('waffleDamaged', 'Waffle pods damaged', YES_DEFECT, WAFFLE),

  ...check('waterSupplyPipe', 'Water supply pipe position to slab', OK_DEFECT, SERVICES),
  ...check('wastesCorrect', 'Wastes correct sizes & locations', OK_DEFECT, SERVICES),
  ...check('wasteCapped', 'Waste pipes capped', OK_DEFECT, SERVICES),
  ...check('utilityPenetrations', 'Utility supply penetrations positioned as per plan', OK_DEFECT, SERVICES),
  ...check('kitchenBenchPenetrations', 'Kitchen bench supply penetrations correct', OK_DEFECT, SERVICES),
  ...check('termitePartA', 'Termite Part A (collars at penetrations)', OK_DEFECT, SERVICES),
  ...check('showerSetDowns', 'Shower set downs apparent', OK_DEFECT, SERVICES),
];

const GEN = 'General';
const general: Draft[] = [
  ...check('retainingWalls', 'Retaining walls as per plan / waterproofed?', [na('N/A'), ok('Yes — OK'), bad('No — defect')], GEN),
  ...check('adviseRetaining', 'Advise retaining wall/s would be prudent?', [ok('No'), warn('Yes — recommend, see notes')], GEN),
  ...check('siteDrainage', 'Any concerns re site drainage / ground falls?', [ok('No — OK'), bad('Yes — defect')], GEN),
  ...check('agiDrain', 'Recommend agi drain/s?', [ok('No'), warn('Yes — recommend, refer to notes')], GEN),
  ...check('garageKerb', 'Alignment of garage & kerb crossing per plan', OK_DEFECT, GEN),
  { key: 'generalOther', type: 'textarea', label: 'Other', placeholder: 'Any other point (the form has two blank rows)', sectionLetter: GEN },
];

const defects: Draft[] = [
  {
    key: 'defects', type: 'repeating-group', label: 'Defects — describe the location and the problem',
    repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add a defect', titleFieldKey: 'location', itemNoun: 'defect', collapsible: true },
    itemFields: numbered([
      { key: 'location', type: 'text', label: 'Location / Room', required: true, placeholder: 'e.g. Front left corner' },
      { key: 'description', type: 'textarea', label: 'Defect description and measurements', required: true },
      { key: 'photos', type: 'photos', label: 'Photos', required: true },
    ]),
  },
];

const summary: Draft[] = [
  {
    key: 'worksStatus', type: 'pill-select', label: 'The works are', required: true, sectionLetter: 'Complete these 3 statements',
    options: [{ value: 'complete', label: 'Complete', color: COLOR.ok }, { value: 'mostly_complete', label: 'Mostly complete, defects being rectified at time of inspection', color: COLOR.warn }],
    allowOther: true,
  },
  { key: 'contactedSupervisor', type: 'yesno', label: 'I have contacted the slab / site supervisor regarding defects / concerns', required: true, sectionLetter: 'Complete these 3 statements' },
  { key: 'workmanshipSatisfactory', type: 'yesno', label: 'The workmanship of the Pre-pour stage is generally to a satisfactory industry standard, except for the defects noted above', required: true, sectionLetter: 'Complete these 3 statements' },
  {
    key: 'notesToInclude', type: 'chip-multiselect', label: 'Notes — tick any you want to include', sectionLetter: 'Notes',
    options: [{ value: 'security_fencing', label: 'Security fencing needs reinstating' }, { value: 'ground_falls', label: 'Ground falls / water ponding at slab' }],
  },
  { key: 'securityFencingDetail', type: 'textarea', label: 'Security fencing is … and needs to be reinstated', gate: { fieldKey: 'notesToInclude', equalsAny: ['security_fencing'] }, sectionLetter: 'Notes' },
  { key: 'groundFallsDetail', type: 'textarea', label: 'Ground falls need to be graded away from the house / footings; water is ponding at slab …', gate: { fieldKey: 'notesToInclude', equalsAny: ['ground_falls'] }, sectionLetter: 'Notes' },
  { key: 'otherConcerns', type: 'textarea', label: 'Any other concerns', sectionLetter: 'Notes' },
];

const clientIssues: Draft[] = [
  { key: 'clientListStatus', type: 'pill-select', label: 'Attach the client issues list with your comments / updates', options: opts('Attached', 'N/A'), required: true },
  {
    key: 'clientListUpdates', type: 'textarea', label: 'Status next to each item — "Refer to Defect No …", "Checked and not a defect", "Rectified and no longer an issue" or "Could not inspect due to …"',
    gate: { fieldKey: 'clientListStatus', equals: 'attached' },
  },
  { key: 'clientListPhotos', type: 'photos', label: 'The client issues list (photos)', gate: { fieldKey: 'clientListStatus', equals: 'attached' } },
];

const SECTIONS: { key: string; name: string; fields: TemplateField[] }[] = [
  { key: 'pp_description', name: 'Description & Overview', fields: numbered(description) },
  { key: 'pp_site_facilities', name: 'Site & Facilities', fields: numbered(siteFacilities) },
  { key: 'pp_measurements', name: 'Pre-Pour: Site & Slab Measurements', fields: numbered(measurements) },
  { key: 'pp_formwork', name: 'Pre-Pour: Formwork & Measurements', fields: numbered(formwork) },
  { key: 'pp_general', name: 'Pre-Pour: General Other', fields: numbered(general) },
  { key: 'pp_defects', name: 'Defects', fields: numbered(defects) },
  { key: 'pp_summary', name: 'Statements & Notes', fields: numbered(summary) },
  { key: 'pp_client_issues', name: 'Client List of Issues', fields: numbered(clientIssues) },
];

/** JSON with sorted keys, so the comparison does not depend on the key order Postgres hands back. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));

async function publish(adminId: string, propertyType: string, sectionKey: string, name: string, fields: TemplateField[]) {
  // Fail here, not on a phone: every field must pass the same schema the template editor enforces.
  for (const f of fields) templateFieldSchema.parse(f);
  const keys = new Set<string>();
  for (const f of fields) {
    if (keys.has(f.key)) throw new Error(`${sectionKey}: duplicate field key ${f.key}`);
    keys.add(f.key);
  }
  const latest = await prisma.inspectionTemplate.findFirst({ where: { inspectionType: INSPECTION_TYPE, propertyType, sectionKey }, orderBy: { version: 'desc' } });
  const published = await prisma.inspectionTemplate.findFirst({ where: { inspectionType: INSPECTION_TYPE, propertyType, sectionKey, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
  if (published && canon(published.fields) === canon(fields) && published.name === name) {
    console.log(`  ${propertyType} / ${sectionKey}: unchanged (v${published.version})`);
    return;
  }
  const version = (latest?.version ?? 0) + 1;
  await prisma.$transaction(async (tx) => {
    await tx.inspectionTemplate.updateMany({ where: { inspectionType: INSPECTION_TYPE, propertyType, sectionKey, status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } });
    await tx.inspectionTemplate.create({
      data: { inspectionType: INSPECTION_TYPE, propertyType, sectionKey, name, version, status: 'PUBLISHED', publishedAt: new Date(), fields: fields as unknown as object, createdById: adminId },
    });
  });
  console.log(`  ${propertyType} / ${sectionKey}: v${version} published (${fields.length} fields)`);
}

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');
  for (const propertyType of PROPERTY_TYPES) {
    const existing = await prisma.inspectionTemplate.findFirst({ where: { inspectionType: INSPECTION_TYPE, propertyType, sectionKey: 'job-info', status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
    if (!existing) throw new Error(`no published Job Information template for ${INSPECTION_TYPE}/${propertyType} to build on`);
    await publish(admin.id, propertyType, 'job-info', existing.name, jobInfoFields(existing.fields as unknown as TemplateField[]));
    for (const s of SECTIONS) await publish(admin.id, propertyType, s.key, s.name, s.fields);
  }
  await prisma.$disconnect();
}

// Runs at every server start (see railway.json), so a failure must never keep the server from booting: log it and carry on.
void main().catch(async (e) => {
  console.error('⚠️  Could not seed the Construction Stage Pre-Pour templates.', e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
});
