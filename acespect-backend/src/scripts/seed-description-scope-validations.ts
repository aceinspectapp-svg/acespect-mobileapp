// Rebuilds Dilapidation × Residential House's "Description & Overview"
// section per direct inspector feedback on the live template. Full field
// list rewritten from scratch rather than patched, since almost every field
// changed shape (options, required-ness, or both) -- easier to read and
// verify as one flat definition than as a diff.
//
//  1. Construction is: drops "House" (too generic) and "Apartment in a
//     multi-level apartment complex" (this profile is Residential House --
//     Apartment already has its own separate templates), replaced with a
//     storey breakdown. Duplex/Townhouse kept.
//  2. Street frontage: adds the four intercardinal directions.
//  3/4/5/6. Wall cladding (both floors), Foundations, Windows, Roof
//     covering: each gets/keeps an "Other" option, paired with its own
//     sibling text field that's required ONLY once "Other" is selected --
//     needs `gate`, which already supported this for a single value, so no
//     engine change there.
//  5. Windows also becomes multi-select (was single-choice pill-select),
//     which makes "Mix of aluminium and timber" redundant -- an inspector
//     now just selects both.
//  7. Roof design already had "Other"; it was missing the required detail
//     box that every other "Other" option gets here.
//  9. Scope for inspection becomes single-select (was multi, which the
//     4 options were never meant to combine) and its "specify where"
//     comment becomes required for exactly two of the four choices
//     (Internal only / External only) -- needs the new `gate.equalsAny`
//     (OR-of-many), since a plain `equals` only fires on one value. The
//     third partial-scope option ("...to part of property") keeps its own,
//     un-required "which part" field so that capability isn't lost.
// 10. The required-field set below is deliberately narrow and explicit --
//     everything not listed stays optional, including the two "Other"-detail
//     exceptions above which are required only conditionally. "Constructed
//     year" vs "under construction at stage" are "either/or" required via
//     the new `requiredGroup` (satisfied once either one has an answer).
// 11. Photography trimmed to just the two overview shots that remain
//     (street number / neighbouring properties / relationship-to-site /
//     signage photos removed).
//
// NOT done here: "pull the project site address from an address database"
// (point 8) is a genuine feature (a places/geocoding API, a key, a backend
// proxy, an autocomplete field renderer) rather than a template change --
// flagged back to the requester rather than guessed at.
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'residential_house';
const SECTION_KEY = 'description';

type Field = Omit<TemplateField, 'order'>;

function mkOpts(labels: string[]): TemplateFieldOption[] {
  const seen = new Set<string>();
  return labels.map((label) => {
    let value = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'opt';
    let n = 2;
    while (seen.has(value)) value = `${value.slice(0, 57)}_${n++}`;
    seen.add(value);
    return { value, label };
  });
}
const opts = (...labels: string[]) => mkOpts(labels);

function numbered(fields: Field[]): TemplateField[] {
  return fields.map((f, i) => ({ ...f, order: i }));
}

const OVERVIEW = 'Property & Project Site Overview';
const DESCRIPTION = 'Property Description';
const SCOPE = 'Scope, Safety and Limitations';

/** An "Other" pill/chip option paired with its own required-when-selected detail box. */
function otherDetail(key: string, sourceKey: string, label = 'If Other — specify material', sectionLetter?: string): Field {
  return { key, type: 'textarea', label, required: true, gate: { fieldKey: sourceKey, equals: 'other' }, sectionLetter };
}

const FIELDS: Field[] = [
  // -- Property & Project Site Overview -------------------------------------
  { key: 'front_elevation', type: 'photos', label: 'Front of property', sectionLetter: OVERVIEW },
  { key: 'street_view_context', type: 'photos', label: 'Street views (4–6 pics)', sectionLetter: OVERVIEW },

  // -- Property Description --------------------------------------------------
  {
    key: 'constructionIs', type: 'pill-select', label: 'Construction is', required: true, sectionLetter: DESCRIPTION,
    options: opts('Single storey house', 'Double storey house', 'Multi-storey house', 'Duplex', 'Townhouse'),
  },
  {
    key: 'constructedYear', type: 'text', label: 'Constructed — year or decade',
    required: true, requiredGroup: 'constructionAge', sectionLetter: DESCRIPTION,
  },
  {
    key: 'underConstructionStage', type: 'text', label: 'Or under construction at stage',
    required: true, requiredGroup: 'constructionAge', sectionLetter: DESCRIPTION,
  },
  {
    key: 'streetFrontage', type: 'pill-select', label: 'Street frontage', required: true, sectionLetter: DESCRIPTION,
    options: opts('North', 'South', 'East', 'West', 'NE', 'NW', 'SE', 'SW'),
  },
  {
    key: 'blockSlope', type: 'pill-select', label: 'The block is', required: true, sectionLetter: DESCRIPTION,
    options: opts('Steep sloping', 'Gently sloping', 'Mostly flat'),
  },
  {
    key: 'wallCladdingGround', type: 'chip-multiselect', label: 'Wall cladding — Ground floor', required: true, sectionLetter: DESCRIPTION,
    options: opts('Brick veneer', 'Rendered brick', 'Cement sheet', 'Concrete panels', 'Hebel', 'Weatherboards', 'Styrene foam', 'Other'),
  },
  otherDetail('wallCladdingGroundOther', 'wallCladdingGround', 'If Other — specify material', DESCRIPTION),
  {
    key: 'wallCladdingFirst', type: 'chip-multiselect', label: 'Wall cladding — First floor', sectionLetter: DESCRIPTION,
    options: opts('Not applicable', 'Brick veneer', 'Rendered brick', 'Cement sheet', 'Hebel', 'Concrete panels', 'Weatherboards', 'Styrene foam', 'Other'),
  },
  otherDetail('wallCladdingFirstOther', 'wallCladdingFirst', 'If Other — specify material', DESCRIPTION),
  {
    key: 'foundations', type: 'pill-select', label: 'Foundations', required: true, sectionLetter: DESCRIPTION,
    options: opts('Concrete slab', 'Stumps', 'Brick piers', 'Other'),
  },
  otherDetail('foundationsOther', 'foundations', 'If Other — specify material', DESCRIPTION),
  {
    key: 'roofDesign', type: 'pill-select', label: 'Roof design', required: true, sectionLetter: DESCRIPTION,
    options: opts('Pitched', 'Flat', 'Combo of pitched and flat', 'Other'),
  },
  otherDetail('roofDesignOther', 'roofDesign', 'If Other — specify details', DESCRIPTION),
  {
    key: 'roofCovering', type: 'chip-multiselect', label: 'Roof covering', required: true, sectionLetter: DESCRIPTION,
    options: opts('Tile', 'Colorbond', 'Zincalume', 'Kliplock decking', 'Other'),
  },
  otherDetail('roofCoveringOther', 'roofCovering', 'If Other — specify material', DESCRIPTION),
  {
    key: 'windows', type: 'chip-multiselect', label: 'Windows are', required: true, sectionLetter: DESCRIPTION,
    options: opts('Aluminium', 'Timber', 'Steel', 'Other'),
  },
  otherDetail('windowsOther', 'windows', 'If Other — specify material', DESCRIPTION),

  // -- Scope, Safety and Limitations ------------------------------------------
  {
    key: 'proposedWorksType', type: 'pill-select', label: 'The proposed works are to', required: true, sectionLetter: SCOPE,
    options: opts('Residential property', 'Development site', 'Road', 'Pipeline', 'Rail line', 'Bridge', 'New housing estate', 'Other'),
  },
  { key: 'projectSiteAddress', type: 'text', label: 'Project site address', required: true, sectionLetter: SCOPE },
  {
    key: 'siteSide', type: 'pill-select', label: 'In relation to the property inspected is to the', required: true, sectionLetter: SCOPE,
    options: opts('Left-hand side', 'Right-hand side', 'Rear', 'Front'),
  },
  {
    key: 'siteDirection', type: 'pill-select', label: 'Which is approximately', required: true, sectionLetter: SCOPE,
    options: opts('North', 'East', 'South', 'West', 'NE', 'NW', 'SE', 'SW'),
  },
  {
    key: 'scopeForInspection', type: 'pill-select', label: 'Scope for inspection — confirm on day of inspection', required: true, sectionLetter: SCOPE,
    options: opts('External and internal to all structures', 'External & internal to part of property', 'Internal only to', 'External only to'),
  },
  {
    key: 'scopePartDetail', type: 'text', label: 'Which part of the property?', sectionLetter: SCOPE,
    gate: { fieldKey: 'scopeForInspection', equals: 'external_internal_to_part_of_property' },
  },
  {
    key: 'scopeDetail', type: 'text', label: 'If internal only or external only — specify where', required: true, sectionLetter: SCOPE,
    gate: { fieldKey: 'scopeForInspection', equalsAny: ['internal_only_to', 'external_only_to'] },
  },
  { key: 'scopeChanges', type: 'textarea', label: 'Changes to scope?', sectionLetter: SCOPE },
  { key: 'scopeLimitations', type: 'yesno', label: 'Any limitations to scope?', sectionLetter: SCOPE },
  { key: 'scopeLimitationsNotes', type: 'textarea', label: 'If yes, describe', gate: { fieldKey: 'scopeLimitations', equals: 'yes' }, sectionLetter: SCOPE },
  { key: 'safetyIssues', type: 'yesno', label: 'Any safety issues?', sectionLetter: SCOPE },
  { key: 'safetyIssuesNotes', type: 'textarea', label: 'If yes, describe', gate: { fieldKey: 'safetyIssues', equals: 'yes' }, sectionLetter: SCOPE },
];

async function main() {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error('No published residential description template found');

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY,
      name: published.name,
      version: published.version + 1,
      status: 'DRAFT',
      fields: numbered(FIELDS) as unknown as object,
      layout: (published.layout ?? null) as unknown as object,
      createdById: admin.id,
    },
  });

  await prisma.$transaction([
    prisma.inspectionTemplate.updateMany({
      where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    }),
    prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
  ]);

  // eslint-disable-next-line no-console
  console.log(`[description-scope-validations] published v${draft.version} (${FIELDS.length} fields, ${FIELDS.filter((f) => f.required).length} required)`);

  await prisma.$disconnect();
}

void main();
