/**
 * Building blocks shared by the Construction Stage inspection templates (one file per stage builds its sections from
 * these). Each stage follows its own paper form exactly: "circle one" rows become tap choices, coloured by meaning
 * (green OK, red defect, amber see notes, grey not applicable), and nothing is asked that the form does not ask.
 */
import { prisma } from '../../lib/prisma';
import { TemplateField, TemplateFieldOption, templateFieldSchema } from '../../modules/templates/templates.schemas';

export const INSPECTION_TYPE = 'construction_stage';
export const PROPERTY_TYPES = ['residential_house', 'apartment'];

export type Tone = 'ok' | 'bad' | 'warn' | 'na';
export const COLOR: Record<Tone, string> = { ok: '#1FA463', bad: '#E63329', warn: '#E8A33D', na: '#94A1B2' };

export type Draft = Omit<TemplateField, 'order'>;
export const numbered = (fields: Draft[]): TemplateField[] => fields.map((f, i) => ({ ...f, order: i }));
export const slug = (label: string) => label.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'opt';

/** Plain options (no colour). */
export function opts(...labels: string[]): TemplateFieldOption[] {
  const seen = new Set<string>();
  return labels.map((label) => {
    let value = slug(label);
    let n = 2;
    while (seen.has(value)) value = `${value.slice(0, 55)}_${n++}`;
    seen.add(value);
    return { value, label };
  });
}

export interface Choice { label: string; tone: Tone }
export const ok = (label: string): Choice => ({ label, tone: 'ok' });
export const bad = (label: string): Choice => ({ label, tone: 'bad' });
export const warn = (label: string): Choice => ({ label, tone: 'warn' });
export const na = (label: string): Choice => ({ label, tone: 'na' });

export const OK_DEFECT = [ok('Yes — OK'), bad('No — defect')];
export const YES_DEFECT = [bad('Yes — defect'), ok('No — OK')];
export const NO_OK_YES_DEFECT = [ok('No — OK'), bad('Yes — defect')];
export const MEAS = 'Photos with measurements';

/**
 * One checklist row from the paper form: a coloured tap choice, and (only where the form has a photo box beside the row)
 * a photo button. `group` puts the row under a heading.
 */
export function check(key: string, label: string, choices: Choice[], group: string, o: { required?: boolean; photosAlways?: string } = {}): Draft[] {
  const options: TemplateFieldOption[] = choices.map((c) => ({ value: slug(c.label), label: c.label, color: COLOR[c.tone] }));
  const rows: Draft[] = [{ key, type: 'pill-select', label, options, required: o.required ?? true, sectionLetter: group }];
  if (o.photosAlways) rows.push({ key: `${key}Photos`, type: 'photos', label: o.photosAlways, sectionLetter: group });
  return rows;
}

// ───────────────────────── Job Information (shared by every stage) ─────────────────────────

/** The two choices the form offers for "Stage" on each stage's own form. The key is per stage so each keeps its own answer. */
const STAGE_CHOICES: { stageId: string; key: string; options: string[] }[] = [
  { stageId: 'pre_pour', key: 'stageOption', options: ['Pre-pour for slab', 'Base'] },
  { stageId: 'slab', key: 'stageOptionSlab', options: ['Slab Down', 'Base'] },
  { stageId: 'framework', key: 'stageOptionFrame', options: ['Frame'] },
];

export function jobInfoFields(existing: TemplateField[]): TemplateField[] {
  const weather = existing.find((f) => f.key === 'weather');
  const weatherOther = existing.find((f) => f.key === 'weatherOther');
  if (!weather) throw new Error('The existing Job Information template has no weather field to reuse');
  const list: Draft[] = [
    // The form's first line, before the header table.
    { key: 'reportEmailed', type: 'yesno', label: 'Email the Word report to Houspect (info@houspectvic.com.au)' },
    { key: 'photosInEgnyte', type: 'yesno', label: 'Photos loaded to Egnyte?' },
    // The Lock Up and Fixing forms add a "Total…" after that question.
    { key: 'photosTotal', type: 'numeric', label: 'Total photos', gate: { fieldKey: 'constructionStage', equalsAny: ['lock_up', 'fixing'] } },
    // "V" is locked ahead of the number the inspector types (the paper form is pre-printed "V2").
    { key: 'jobNumber', type: 'text', label: 'Job No', prefix: 'V', required: true, placeholder: 'e.g. 2' },
    { key: 'inspectionDate', type: 'date', label: 'Inspection Date', required: true },
    { key: 'assignedInspector', type: 'text', label: 'Inspector initials', required: true },
    { key: 'clientName', type: 'text', label: 'Client name', required: true },
    { key: 'inspectionAddress', type: 'text', label: 'Inspection Address', required: true },
    { ...(weather as Draft), required: true },
    ...(weatherOther ? [weatherOther as Draft] : []),
    // The app writes the chosen stage into the hidden answer "constructionStage"; each stage shows only its own two choices.
    ...STAGE_CHOICES.map((c): Draft => ({
      key: c.key, type: 'pill-select', label: 'Stage', required: true, options: opts(...c.options),
      gate: { fieldKey: 'constructionStage', equals: c.stageId },
    })),
    // The Pre-Pour, Slab Down and Frame forms have a Comments box in the header; the Lock Up and Fixing forms do not.
    { key: 'comments', type: 'textarea', label: 'Comments', placeholder: 'Anything to flag about this job', gate: { fieldKey: 'constructionStage', equalsAny: ['pre_pour', 'slab', 'framework'] } },
  ];
  return numbered(list);
}

// ───────────────────────── Blocks every stage form repeats ─────────────────────────

/** "Description and overview": photo asks, the circle-one rows, safety, plans and specifications, and the issues lists. */
export function descriptionFields(o: { previousDefectsList?: boolean } = {}): Draft[] {
  return [
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
    ...(o.previousDefectsList
      ? [{ key: 'previousDefectsList', type: 'pill-select', label: 'Previous defects list attached (print or refer to it and answer every item)', required: true, options: opts('Yes', 'N/A') } as Draft]
      : []),
    { key: 'clientIssuesList', type: 'pill-select', label: 'Client list of issues (print or refer to it and answer every item)', required: true, options: opts('Yes', 'N/A') },
  ];
}

const SITE = 'Site and facilities';
export const siteFacilitiesFields: Draft[] = [
  ...check('builderSign', "Builder's sign displayed", [ok('Yes — OK'), bad('No — defect')], SITE),
  ...check('powerSupply', 'Power supply to site', [ok('Yes — OK'), warn('No — see notes')], SITE),
  ...check('waterSupply', 'Water supply to site', [ok('Yes — OK'), warn('No'), bad('Leaking')], SITE),
  ...check('siteToilet', 'Site toilet in position', [ok('Yes — OK'), warn('No — see notes')], SITE),
  ...check('securityFencing', 'Security fencing in place', [ok('Yes — OK'), warn('No — see notes')], SITE),
  ...check('rubbishDangerous', 'Rubbish dangerous on site', [ok('No'), bad('Yes — defect')], SITE),
  ...check('siteManaged', 'Is the site well managed?', [ok('Yes'), bad('No'), warn('Can be improved by cleaning up rubbish for access & safety reasons')], SITE),
  ...check('kerbDamage', 'Damage to kerb / path / crossover', [ok('OK'), warn('See notes'), warn('Other')], SITE),
];

export const PEGS = 'Boundary survey pegs';
export const boundaryPegs: Draft = {
  key: 'boundaryPegs', type: 'chip-multiselect', label: 'Boundary survey pegs are visible at', required: true, sectionLetter: PEGS,
  options: [{ value: 'front', label: 'Front' }, { value: 'rear', label: 'Rear' }, { value: 'left_side', label: 'Left side' }, { value: 'right_side', label: 'Right side' }, { value: 'none_visible', label: 'None visible', exclusive: true }],
};

/** "OK / variation appears to be okay / builder to re-check / Other" -- Other takes free text. */
export function resultPill(key: string, label: string, group: string): Draft {
  return {
    key, type: 'pill-select', label, required: true, sectionLetter: group, allowOther: true,
    options: [
      { value: 'ok', label: 'OK', color: COLOR.ok },
      { value: 'variation_okay', label: 'Variation appears to be okay', color: COLOR.ok },
      { value: 'builder_to_recheck', label: 'Builder to re-check', color: COLOR.warn },
    ],
  };
}

/** One side's setback: the datum point used, the mm on plan, the mm on site, and the result. */
export function setbackBlock(side: 'front' | 'right' | 'rear' | 'left', title: string, datum: string[]): Draft[] {
  return [
    { key: `${side}Datum`, type: 'pill-select', label: 'Datum point you used', options: opts(...datum), allowOther: true, required: true, sectionLetter: title },
    { key: `${side}Plan`, type: 'numeric', label: `${title} on plan`, unit: 'mm', required: true, sectionLetter: title },
    { key: `${side}Site`, type: 'numeric', label: `${title} on site (approx)`, unit: 'mm', required: true, sectionLetter: title },
    resultPill(`${side}Result`, `${title} — result`, title),
  ];
}

export const defectsFields: Draft[] = [
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

/** "Attach a list with updates": an Attached / N/A tap, then the status wording and photos of the list when attached. */
export function attachedListFields(o: { key: string; label: string; updatesLabel: string; photosLabel: string }): Draft[] {
  return [
    { key: `${o.key}Status`, type: 'pill-select', label: o.label, options: opts('Attached', 'N/A'), required: true },
    { key: `${o.key}Updates`, type: 'textarea', label: o.updatesLabel, gate: { fieldKey: `${o.key}Status`, equals: 'attached' } },
    { key: `${o.key}Photos`, type: 'photos', label: o.photosLabel, gate: { fieldKey: `${o.key}Status`, equals: 'attached' } },
  ];
}

export const clientIssuesFields: Draft[] = attachedListFields({
  key: 'clientList',
  label: 'Attach the client issues list with your comments / updates',
  updatesLabel: 'Status next to each item — "Refer to Defect No …", "Checked and not a defect", "Rectified and no longer an issue" or "Could not inspect due to …"',
  photosLabel: 'The client issues list (photos)',
});

// ───────────────────────── Publishing ─────────────────────────

export interface SectionDef { key: string; name: string; fields: TemplateField[] }

/** JSON with sorted keys, so the comparison does not depend on the key order Postgres hands back. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, val) => (val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));

export async function publish(adminId: string, propertyType: string, sectionKey: string, name: string, fields: TemplateField[]) {
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
