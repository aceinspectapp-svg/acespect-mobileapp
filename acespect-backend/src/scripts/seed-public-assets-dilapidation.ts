// One-off content overlay: publishes a v2 for the Dilapidation + Public
// Assets profile's job-info, description and elevations sections, adding
// the road/laneway asset survey checklist ported from the Houspect Victoria
// "Dilapidation PUBLIC ASSETS Type 1 - Inspector Template" (footpaths,
// nature strip & street furniture, kerbs & channel, road surface, laneway
// fencing/walls, laneway surface), organised as addable "Part A / Part B"
// survey sections (one per road or laneway being surveyed), each containing
// only the asset categories relevant to whether it's a frontage road or a
// laneway/ROW. Every other (inspectionType, propertyType) lineage is
// untouched -- purely additive content for one profile, using the existing
// versioning flow (archive prior published row, publish the new one) so any
// inspection already mid-draft keeps whatever version it started with.
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'public_assets';

function numbered(fields: Omit<TemplateField, 'order'>[]): TemplateField[] {
  return fields.map((f, i) => ({
    ...f,
    order: i,
    itemFields: f.itemFields ? numbered(f.itemFields as Omit<TemplateField, 'order'>[]) : undefined,
  }));
}

const opt = (value: string, label: string): TemplateFieldOption => ({ value, label });
const items = (labels: string[]): TemplateFieldOption[] => labels.map((l, i) => opt(`item${i}`, l));
const YES_NO: TemplateFieldOption[] = [opt('yes', 'Yes'), opt('no', 'No')];
const yesno = (key: string, label: string) => ({ key, label, type: 'yesno' as const, options: YES_NO });
const chips = (key: string, label: string, options: string[]) => ({ key, label, type: 'pill-select' as const, options: items(options) });
const chipsMulti = (key: string, label: string, options: string[]) => ({ key, label, type: 'chip-multiselect' as const, allowOther: true, options: items(options) });

/** A generic "most significant items" damage sub-list -- location, defect type, start point/direction, width, length, photos. */
function damageList(key: string, label: string, defectTypes: string[]): Omit<TemplateField, 'order'> {
  return {
    key, label, type: 'damage-list',
    itemFields: numbered([
      { key: 'location', label: 'Location / position', type: 'text', placeholder: 'e.g. at House No / Panel No 1 / kerb / 1st drain grate' },
      { key: 'damageType', label: 'Crack / gap / other', type: 'pill-select', options: items(defectTypes) },
      { key: 'startDirection', label: 'Start point & direction', type: 'text' },
      { key: 'widthMm', label: 'Width', type: 'numeric', unit: 'mm' },
      { key: 'lengthMm', label: 'Length', type: 'numeric', unit: 'mm' },
      { key: 'photos', label: 'Photos', type: 'photos' },
    ]),
  };
}

/** Named street-furniture/asset survey (light posts, bollards, trees, ...): pick asset type, count, condition, then the same damage fields. */
function streetAssetList(key: string, label: string, assetTypes: string[], conditionOptions: string[]): Omit<TemplateField, 'order'> {
  return {
    key, label, type: 'repeating-group',
    repeat: { presentation: 'strip', addable: true, addButtonLabel: `Add ${label} item` },
    itemFields: numbered([
      { key: 'assetType', label: 'Asset type', type: 'pill-select', options: items(assetTypes) },
      chips('count', 'There are', ['Nil', '1', '2', '3']),
      chipsMulti('condition', 'Condition', [...conditionOptions, 'OK']),
      { key: 'location', label: 'Location', type: 'text' },
      { key: 'startDirection', label: 'Start point & direction', type: 'text' },
      { key: 'widthMm', label: 'Width', type: 'numeric', unit: 'mm' },
      { key: 'lengthMm', label: 'Length', type: 'numeric', unit: 'mm' },
      { key: 'photos', label: 'Photos', type: 'photos' },
    ]),
  };
}

const STREET_ASSETS = ['Stormwater cover', 'Utility pit cover', 'Light post', 'Tree', 'Parking sign / Traffic sign', 'Bollard / Parking meter', 'Traffic light', 'Public bin / seating', 'Bike rack', 'Phone booth / Bus or tram stop', 'Planter box / sculpture / artwork / playground', 'Bike lane', 'Traffic island', 'Pedestrian crossing'];

/**
 * One asset category surveyed within a Part (Footpaths & Crossovers, Nature
 * Strip, Kerbs & Channel, Road Surface, Fencing, Laneway Surface): overview
 * (material/condition/wide photos), a cracking/deterioration summary, a
 * generic damage list, a street-assets survey, and what obscured the
 * survey. `gate` ties visibility to the Part's partType selection so only
 * the relevant categories show for a frontage road vs. a laneway.
 */
function assetCategory(opts: {
  prefix: string; group: string; gate: { fieldKey: string; equals: string };
  materialOptions: string[]; conditionOptions: string[]; defectTypes: string[];
  extras?: Omit<TemplateField, 'order' | 'sectionLetter' | 'gate'>[];
}): Omit<TemplateField, 'order'>[] {
  const { prefix, group, gate, materialOptions, conditionOptions, defectTypes, extras = [] } = opts;
  return [
    { key: `${prefix}_material`, label: 'Material overview', type: 'chip-multiselect', allowOther: true, options: items(materialOptions), sectionLetter: group, gate },
    { key: `${prefix}_condition`, label: 'Condition overview', type: 'pill-select', options: items(conditionOptions), sectionLetter: group, gate },
    { key: `${prefix}_widePhotos`, label: 'Wide photos at start (min 4)', type: 'photos', sectionLetter: group, gate },
    { key: `${prefix}_summary`, label: 'Cracking / gaps / other deterioration', type: 'pill-select', options: items(['No significant cracking/damage', 'Several minor cracks', 'Numerous cracking throughout', 'Other']), sectionLetter: group, gate },
    { key: `${prefix}_summaryOther`, label: 'Other (define)', type: 'text', sectionLetter: group, gate },
    { ...damageList(`${prefix}_damages`, 'Most significant items', defectTypes), sectionLetter: group, gate },
    { ...streetAssetList(`${prefix}_assets`, 'Street assets', STREET_ASSETS, conditionOptions), sectionLetter: group, gate },
    ...extras.map((f) => ({ ...f, sectionLetter: group, gate })),
    { key: `${prefix}_obscuredBy`, label: 'Sections were obscured by', type: 'chip-multiselect', allowOther: true, options: items(['Overgrown grass', 'Parked vehicles', 'Stored goods', 'Vegetation']), sectionLetter: group, gate },
  ];
}

const DEFECT_TYPES = ['Crack', 'Subsidence', 'Gap', 'Chipping'];
const SURFACE_MATERIALS = ['Concrete', 'Asphalt', 'Pavers', 'Gravel', 'Bluestone', 'Mix'];

/** One "Part" of the survey (a road frontage, or a laneway/ROW) -- direction/start/end metadata, then every asset category gated on which kind of Part it is. */
function partInstance(): Omit<TemplateField, 'order'> {
  const frontageGate = { fieldKey: 'partType', equals: 'frontage' };
  const lanewayGate = { fieldKey: 'partType', equals: 'laneway' };
  return {
    key: 'parts',
    label: 'Survey Parts (roads / laneways)',
    type: 'repeating-group',
    repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add Part (road or laneway)' },
    itemFields: numbered([
      chips('partType', 'This part is', ['Frontage to project site', 'Laneway / ROW to side or rear']),
      { key: 'roadLaneName', label: 'Name of road / lane', type: 'text' },
      { key: 'startEndPhotos', label: 'Wide view photos and street signs (start, min 4)', type: 'photos' },
      chips('runsDirection', 'The road / lane runs', ['South to north', 'East to West', 'Other']),
      chips('surveyStart', 'Survey commenced at', ['South end', 'West end', 'East end', 'Other']),
      { key: 'startRef', label: 'Start reference (e.g. 3m past boundary of house no. / crossover / corner / intersection)', type: 'text' },
      chips('surveyDirection', 'And proceeded', ['North', 'East', 'West', 'Other']),
      chips('surveyEnd', 'To end point of survey', ['North end', 'West end', 'East end', 'Other']),
      { key: 'endRef', label: 'End reference (e.g. 3m past boundary of house no. / crossover / corner / intersection)', type: 'text' },
      { key: 'endPhotos', label: 'Wide view photos looking back (end, min 4)', type: 'photos' },
      { key: 'otherDescription', label: 'Other description', type: 'textarea', maxLength: 500 },

      // Frontage-only asset categories
      ...assetCategory({ prefix: 'footpaths', group: 'Footpaths & Crossovers', gate: frontageGate, materialOptions: SURFACE_MATERIALS, conditionOptions: ['Significant cracks and chipping', 'Patches', 'Satisfactory with typical wear and tear', 'New', 'Poor'], defectTypes: DEFECT_TYPES }),
      ...assetCategory({ prefix: 'naturestrip', group: 'Nature Strip, Light Posts, Signage, Trees', gate: frontageGate, materialOptions: ['Grass', 'Asphalt', 'Pavers', 'Concrete', 'Gravel', 'Mix'], conditionOptions: ['Significant cracks and damage', 'Patches', 'Satisfactory with typical wear and tear', 'New', 'Poor'], defectTypes: DEFECT_TYPES }),
      ...assetCategory({ prefix: 'kerbs', group: 'Kerbs & Channel', gate: frontageGate, materialOptions: SURFACE_MATERIALS, conditionOptions: ['Significant cracks and chipping', 'Patches', 'Satisfactory with typical wear and tear', 'New', 'Poor'], defectTypes: DEFECT_TYPES }),
      ...assetCategory({
        prefix: 'roadsurface', group: 'Road Surface & Parking Bays', gate: frontageGate, materialOptions: SURFACE_MATERIALS,
        conditionOptions: ['Significant cracks', 'Pot holes', 'Patches', 'Satisfactory with typical shrinkage cracks and wear and tear', 'New', 'Poor'], defectTypes: DEFECT_TYPES,
        extras: [
          chips('lineMarkings', 'Painted line markings are', ['Worn', 'Satisfactory with typical wear and tear', 'New']),
          yesno('guardRails', 'Guard rails along roadways'),
          yesno('retainingWalls', 'Retaining walls'),
          yesno('bridges', 'Bridges'),
          { key: 'other', label: 'Other (add page with tables and notes)', type: 'textarea', maxLength: 500 },
        ],
      }),

      // Laneway-only asset categories
      ...assetCategory({ prefix: 'fenceleft', group: 'Left Side Fences & Walls of Laneway', gate: lanewayGate, materialOptions: ['Timber palings', 'Corrugated metal', 'Brick walls', 'Galvanised steel post and mesh wire', 'Mix'], conditionOptions: ['Poor', 'Aged', 'Generally satisfactory', 'New', 'Other'], defectTypes: [...DEFECT_TYPES, 'Loose palings', 'Graffiti'] }),
      ...assetCategory({ prefix: 'fenceright', group: 'Right Side Fences & Walls of Laneway', gate: lanewayGate, materialOptions: ['Timber palings', 'Corrugated metal', 'Brick walls', 'Galvanised steel post and mesh wire', 'Mix'], conditionOptions: ['Poor', 'Aged', 'Generally satisfactory', 'New', 'Other'], defectTypes: [...DEFECT_TYPES, 'Loose palings', 'Graffiti'] }),
      ...assetCategory({
        prefix: 'lanesurface', group: 'Laneway Surface', gate: lanewayGate, materialOptions: SURFACE_MATERIALS,
        conditionOptions: ['Significant cracks', 'Pot holes', 'Patches', 'Satisfactory with typical shrinkage cracks and wear and tear', 'New', 'Poor'], defectTypes: DEFECT_TYPES,
        extras: [chips('lineMarkings', 'Painted line markings are', ['NA', 'Worn', 'Satisfactory with typical wear and tear', 'New'])],
      }),
    ]),
  };
}

async function publishOverlay(sectionKey: string, buildFields: (existing: TemplateField[]) => TemplateField[]) {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  const latest = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const existingFields = ((published?.fields as unknown as TemplateField[]) ?? []) as TemplateField[];
  const nextFields = numbered(buildFields(existingFields) as Omit<TemplateField, 'order'>[]);

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: INSPECTION_TYPE,
      propertyType: PROPERTY_TYPE,
      sectionKey,
      name: published?.name ?? sectionKey,
      version: (latest?.version ?? 0) + 1,
      status: 'DRAFT',
      fields: nextFields as unknown as object,
      createdById: admin.id,
    },
  });

  await prisma.$transaction([
    prisma.inspectionTemplate.updateMany({
      where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    }),
    prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
  ]);

  // eslint-disable-next-line no-console
  console.log(`[public-assets-dilapidation] published ${sectionKey} v${draft.version} (${nextFields.length} fields)`);
}

async function main() {
  await publishOverlay('job-info', (existing) => [
    ...existing,
    { key: 'businessSignage', label: 'Business signage (name/signage on site — take photos)', type: 'photos' } as TemplateField,
  ]);

  await publishOverlay('description', (existing) => [
    ...existing,
    { key: 'siteAssetsOverview', label: 'Site & Assets Overview — photo sequence (6–10 pics)', type: 'photos' } as TemplateField,
    chips('proposedWorksType', 'The proposed works are to the', ['Residential property', 'Development site', 'Road', 'Pipeline', 'Bridge', 'Rail line', 'Other']) as TemplateField,
    { key: 'projectSiteAddress', label: 'At project site address', type: 'text' } as TemplateField,
    chips('siteSide', 'Which is to the', ['Left-hand side', 'Right-hand side', 'Rear', 'Front', 'Other']) as TemplateField,
    chips('siteDirection', 'Approximately', ['North', 'East', 'South', 'West', 'NE', 'NW', 'SE', 'SW', 'Other']) as TemplateField,
    chipsMulti('scopeConfirmed', 'The scope for inspection is defined in the job brief — inspector confirm', ['Footpaths, utility pit covers', 'Nature strip inc. light posts, parking signs, road signs, bollards, light posts, trees', 'Kerb and channel', 'Parking bays', 'Road surfaces', 'Traffic islands', 'Traffic lights', 'Fences along boundary', 'Trees & vegetation']) as TemplateField,
    yesno('safetyAssessed', 'Did you assess all safety and access matters on site?') as TemplateField,
    { key: 'safetyAssessedNotes', label: 'If so, please describe', type: 'textarea', maxLength: 500 } as TemplateField,
    yesno('scopeLimitations', 'Any limitations to the required scope?') as TemplateField,
    { key: 'scopeLimitationsNotes', label: 'If so, where and why', type: 'textarea', maxLength: 500 } as TemplateField,
    { key: 'siteSketch', label: 'Site sketch / map (survey start point, direction, end point — north to top)', type: 'photos' } as TemplateField,
  ]);

  await publishOverlay('elevations', () => [partInstance() as TemplateField]);

  await publishOverlay('notes', (existing) => [
    { key: 'publicAssetSafetyMatters', label: 'Any safety matters? (be conservative to alert all parties to potential risks — e.g. loose brick that could fall due to excavations/vibrations, leaning fences that could fall over)', type: 'textarea', maxLength: 1000 } as TemplateField,
    ...existing,
  ]);

  await prisma.$disconnect();
}

void main();
