// Rebuilds every Dilapidation × Residential House section template to match
// the "HOUSPECT VIC DILAPIDATION Residential Structures — Inspector Template
// (Std) 1 May 2024" source PDF, which the seeded v1 templates only loosely
// approximated. Audited gaps this closes:
//   * driveway was a one-field test stub ("jobNumber: Test") -- rebuilt whole.
//   * description carried only photos: the entire property-description table
//     (construction/year/frontage/slope/cladding/foundations/roof/windows)
//     AND the whole "Scope, Safety and Limitations" block were absent.
//   * Granny flat / Studio and Balcony / Terrace had no representation at all.
//   * The Cladding / Windows-Doors / Eaves / Downpipes-gutters sub-blocks the
//     PDF repeats under every structure + elevation were missing everywhere.
//   * "Party wall abutting next property at No…" (left/rear/right elevations)
//     was missing -- material for a dilapidation report.
//   * Internal lacked the General block (renovations in progress, safety
//     advisories) and the PDF's fixed room list.
//   * Option lists throughout were generic ("Crack/Spall/Leaning") rather
//     than the PDF's own wording, and condition scales dropped "average".
// Each section is published as a new version through the normal flow (archive
// the prior published row, publish the new one), so prior versions stay
// intact as ARCHIVED and in-progress drafts keep rendering what they pinned.
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'residential_house';

type Field = Omit<TemplateField, 'order'>;

const o = (label: string): TemplateFieldOption => ({ value: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60), label });
const opts = (...labels: string[]): TemplateFieldOption[] => labels.map(o);

function numbered(fields: Field[]): TemplateField[] {
  return fields.map((f, i) => ({
    ...f,
    order: i,
    itemFields: f.itemFields ? numbered(f.itemFields as Field[]) : undefined,
  }));
}

// ── Shared PDF building blocks ───────────────────────────────────────────────

/** PDF's external damage table: Location | Desc | Runs | Width | Length | Pics. */
function externalDamages(label = 'Cracking / gaps / other deterioration — note the 2 or 3 most significant items'): Field {
  return {
    key: 'damages', type: 'damage-list', label,
    repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add damage item' },
    itemFields: numbered([
      { key: 'location', type: 'text', label: 'Damage location' },
      { key: 'damageType', type: 'pill-select', label: 'Description', options: opts('Crack', 'Subsidence', 'Gap', 'Hole', 'Chipping') },
      { key: 'direction', type: 'pill-select', label: 'Runs', options: opts('Vertical', 'Diagonal', 'Horizontal') },
      { key: 'widthMm', type: 'numeric', label: 'Width', unit: 'mm' },
      { key: 'lengthMm', type: 'numeric', label: 'Length', unit: 'mm' },
      { key: 'notes', type: 'textarea', label: 'Notes' },
      { key: 'photos', type: 'photos', label: 'Pics' },
    ]),
  };
}

/** PDF's internal damage table -- different Location/Desc vocabularies to the external one. */
function internalDamages(): Field {
  return {
    key: 'damages', type: 'damage-list', label: 'Cracks / gaps / defects',
    repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add damage item' },
    itemFields: numbered([
      { key: 'location', type: 'pill-select', label: 'Location', options: opts('Cornice mitres', 'Wall', 'Ceiling', 'Door', 'Arch', 'Other') },
      { key: 'locationDetail', type: 'text', label: 'Location detail' },
      { key: 'damageType', type: 'pill-select', label: 'Description', options: opts('Crack', 'Gap', 'Peaking', 'Stain', 'Flaking') },
      { key: 'direction', type: 'pill-select', label: 'Runs', options: opts('Vertical', 'Diagonal', 'Horizontal') },
      { key: 'widthMm', type: 'numeric', label: 'Width', unit: 'mm' },
      { key: 'lengthMm', type: 'numeric', label: 'Length', unit: 'mm' },
      { key: 'notes', type: 'textarea', label: 'Notes' },
      { key: 'photos', type: 'photos', label: 'Pics (3–5 per defect: mid-shot, then close-ups with crack card for scale)' },
    ]),
  };
}

/**
 * The four observation rows the PDF repeats verbatim under every outbuilding
 * and elevation. `variant` picks the PDF's slightly different wording between
 * outbuildings ("Paint is weathered…") and elevations ("Rusted…").
 */
function fabricBlocks(variant: 'structure' | 'elevation', gate?: TemplateField['gate']): Field[] {
  const cladding = variant === 'structure'
    ? opts('Paint is weathered', 'Paint is flaking from sections', 'Timber is cracked', 'There is decay to some boards')
    : opts('Paint is flaking from sections', 'Timber is cracked', 'Decay to some boards');
  const eaves = variant === 'structure'
    ? opts('Water stains', 'Dark mould', 'Gaps at sheet joins', 'Gaps at quads', 'Broken or cracked eave linings')
    : opts('Water stains', 'Dark mould', 'Gaps at sheet joins', 'Gaps at quads', 'Cracked');
  const downpipes = variant === 'structure'
    ? opts('Sagging or loose', 'Not connected to stormwater system', 'Rust')
    : opts('Rusted', 'Sagging or loose', 'Not connected to stormwater system');
  return [
    { key: 'cladding', type: 'chip-multiselect', label: 'Cladding', options: cladding, gate },
    { key: 'claddingPhotos', type: 'photos', label: 'Cladding pics', gate },
    {
      key: 'windowsDoors', type: 'chip-multiselect', label: 'Windows / Doors', gate,
      options: opts('Paint flaking from timber', 'Gaps at windows & cladding', 'Broken glazing', 'Decay to some frames or sashes', 'Door delaminating'),
    },
    { key: 'windowsDoorsPhotos', type: 'photos', label: 'Windows / Doors pics', gate },
    { key: 'eaves', type: 'chip-multiselect', label: 'Eaves', options: eaves, gate },
    { key: 'eavesPhotos', type: 'photos', label: 'Eaves pics', gate },
    { key: 'downpipesGutters', type: 'chip-multiselect', label: 'Downpipes / gutters', options: downpipes, gate },
    { key: 'downpipesGuttersPhotos', type: 'photos', label: 'Downpipes / gutters pics', gate },
  ];
}

const YES = { fieldKey: 'present', equals: 'yes' };

// ── Section definitions ──────────────────────────────────────────────────────

const SECTIONS: Record<string, { name: string; fields: Field[] }> = {
  // PDF page 1 — header block.
  'job-info': {
    name: 'Job Information',
    fields: [
      { key: 'jobNumber', type: 'text', label: 'Job No' },
      { key: 'inspectionDate', type: 'date', label: 'Inspection Date' },
      { key: 'assignedInspector', type: 'text', label: 'Inspector initials' },
      { key: 'clientName', type: 'text', label: 'Client name' },
      { key: 'inspectionAddress', type: 'text', label: 'Inspection Address' },
      // Business conversion, job photo-sequence numbers and the post-project
      // flag are deliberately NOT here: JobInformationScreen is hand-built and
      // renders every text field ungated in one card, so the business-name
      // follow-up showed unconditionally. Business signage is captured by
      // Description & Overview's signage photos, the photo sequence is tracked
      // automatically (System Status → Photo Sequence), and post-project lives
      // in Notes / Post Project / Defects.
      {
        key: 'weather', type: 'select-tiles', label: 'Weather',
        options: [
          { value: 'overcast', label: 'Overcast', icon: 'cloudy-outline' },
          { value: 'dry', label: 'Dry', icon: 'thermometer-outline' },
          { value: 'sunny', label: 'Sunny', icon: 'sunny-outline' },
          { value: 'intermittent_showers', label: 'Intermittent showers', icon: 'partly-sunny-outline' },
          { value: 'rain', label: 'Rain', icon: 'rainy-outline' },
          { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
        ],
      },
    ],
  },

  // PDF page 1 — "DESCRIPTION AND OVERVIEW" + "SCOPE, SAFETY AND LIMITATIONS".
  description: {
    name: 'Description & Overview',
    fields: [
      { key: 'front_elevation', type: 'photos', label: 'Front of property', sectionLetter: 'Property & Project Site Overview' },
      { key: 'street_number', type: 'photos', label: 'Street number', sectionLetter: 'Property & Project Site Overview' },
      { key: 'street_view_context', type: 'photos', label: 'Street views (4–6 pics)', sectionLetter: 'Property & Project Site Overview' },
      { key: 'neighboring_properties', type: 'photos', label: 'Neighbouring properties', sectionLetter: 'Property & Project Site Overview' },
      { key: 'relationship_construction', type: 'photos', label: 'Relationship to project site', sectionLetter: 'Property & Project Site Overview' },
      { key: 'business_signage', type: 'photos', label: 'Signage (if applicable)', sectionLetter: 'Property & Project Site Overview' },

      { key: 'constructionIs', type: 'pill-select', label: 'Construction is', options: opts('House', 'Duplex', 'Townhouse', 'Apartment in a multi-level apartment complex'), sectionLetter: 'Property Description' },
      { key: 'constructedYear', type: 'text', label: 'Constructed — year or decade', sectionLetter: 'Property Description' },
      { key: 'underConstructionStage', type: 'text', label: 'Or under construction at stage', sectionLetter: 'Property Description' },
      { key: 'streetFrontage', type: 'pill-select', label: 'Street frontage', options: opts('North', 'South', 'East', 'West'), sectionLetter: 'Property Description' },
      { key: 'blockSlope', type: 'pill-select', label: 'The block is', options: opts('Steep sloping', 'Gently sloping', 'Mostly flat'), sectionLetter: 'Property Description' },
      { key: 'wallCladdingGround', type: 'chip-multiselect', label: 'Wall cladding — Ground floor', options: opts('Brick veneer', 'Rendered brick', 'Cement sheet', 'Concrete panels', 'Hebel', 'Weatherboards', 'Styrene foam', 'Combo of'), sectionLetter: 'Property Description' },
      { key: 'wallCladdingFirst', type: 'chip-multiselect', label: 'Wall cladding — First floor', options: opts('Not applicable', 'Brick veneer', 'Rendered brick', 'Cement sheet', 'Hebel', 'Concrete panels', 'Weatherboards', 'Styrene foam', 'Combo of'), sectionLetter: 'Property Description' },
      { key: 'foundations', type: 'pill-select', label: 'Foundations', options: opts('Concrete slab', 'Stumps', 'Brick piers'), sectionLetter: 'Property Description' },
      { key: 'roofDesign', type: 'pill-select', label: 'Roof design', options: opts('Pitched', 'Flat', 'Combo of pitched and flat', 'Other'), sectionLetter: 'Property Description' },
      { key: 'roofCovering', type: 'chip-multiselect', label: 'Roof covering', options: opts('Tile', 'Colorbond', 'Zincalume', 'Kliplock decking', 'Mix of'), sectionLetter: 'Property Description' },
      { key: 'windows', type: 'pill-select', label: 'Windows are', options: opts('Aluminium', 'Timber', 'Mix of aluminium and timber', 'Steel', 'Other'), sectionLetter: 'Property Description' },

      { key: 'proposedWorksType', type: 'pill-select', label: 'The proposed works are to', options: opts('Residential property', 'Development site', 'Road', 'Pipeline', 'Rail line', 'Bridge', 'New housing estate', 'Other'), sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'projectSiteAddress', type: 'text', label: 'Project site address', sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'siteSide', type: 'pill-select', label: 'In relation to the property inspected is to the', options: opts('Left-hand side', 'Right-hand side', 'Rear', 'Front', 'Other'), sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'siteDirection', type: 'pill-select', label: 'Which is approximately', options: opts('North', 'East', 'South', 'West', 'NE', 'NW', 'SE', 'SW'), sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'scopeForInspection', type: 'chip-multiselect', label: 'Scope for inspection — confirm on day of inspection', options: opts('External and internal to all structures', 'External and internal to part of property', 'Internal only to', 'External only to'), sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'scopeDetail', type: 'text', label: 'If part / internal only / external only — specify where', sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'scopeChanges', type: 'textarea', label: 'Changes to scope?', sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'scopeLimitations', type: 'yesno', label: 'Any limitations to scope?', sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'scopeLimitationsNotes', type: 'textarea', label: 'If yes, describe', gate: { fieldKey: 'scopeLimitations', equals: 'yes' }, sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'safetyIssues', type: 'yesno', label: 'Any safety issues?', sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'safetyIssuesNotes', type: 'textarea', label: 'If yes, describe', gate: { fieldKey: 'safetyIssues', equals: 'yes' }, sectionLetter: 'Scope, Safety and Limitations' },
    ],
  },

  // PDF page 1–3 — EXTERNAL / Driveway. Previously a test stub.
  driveway: {
    name: 'Driveway',
    fields: [
      { key: 'present', type: 'yesno', label: 'Is there a driveway?' },
      { key: 'locatedAt', type: 'pill-select', label: 'Located at', options: opts('Front left', 'Front right', 'Rear', 'Side', 'Semi-circle with 2 entries/exits'), gate: YES },
      { key: 'material', type: 'pill-select', label: 'Material', options: opts('Concrete', 'Pavers', 'Asphalt', 'Gravel', 'Other'), gate: YES },
      { key: 'condition', type: 'color-select', label: 'Condition', options: opts('Satisfactory with typical wear and tear', 'Fair', 'Average', 'Poor', 'New'), gate: YES },
      { key: 'crackingSummary', type: 'pill-select', label: 'Cracking overview', options: opts('No visible significant cracking', 'Several minor cracks', 'Numerous cracking throughout'), gate: YES },
      { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Vegetation', 'Parked cars / trailer / caravan', 'Stored goods', 'Other'), gate: YES },
      { key: 'photos', type: 'photos', label: 'Driveway pics', gate: YES },
      { ...externalDamages(), gate: YES },
      { key: 'notes', type: 'textarea', label: 'Notes', gate: YES },
    ],
  },

  // PDF page 3 — Paving, fixed to the four sides.
  paving_paths: {
    name: 'Paving & Paths',
    fields: [
      {
        key: 'areas', type: 'repeating-group',
        label: 'Paving (put pool, alfresco and lightwell paving into their own sections)',
        repeat: {
          presentation: 'fixed-tabs',
          fixedInstances: [
            { key: 'front', label: 'Front' }, { key: 'left', label: 'Left' },
            { key: 'rear', label: 'Rear' }, { key: 'right', label: 'Right' },
          ],
        },
        itemFields: numbered([
          { key: 'present', type: 'yesno', label: 'Is there paving to this side?' },
          { key: 'material', type: 'chip-multiselect', label: 'Material', options: opts('Concrete', 'Pavers', 'Gravel', 'Grass only'), gate: YES },
          { key: 'condition', type: 'color-select', label: 'Condition', options: opts('Satisfactory', 'Fair', 'Average', 'Poor', 'Good in relation to its age'), gate: YES },
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Vegetation', 'Stored goods', 'Other'), gate: YES },
          { key: 'photos', type: 'photos', label: 'Pics', gate: YES },
          { ...externalDamages(), gate: YES },
          { key: 'notes', type: 'textarea', label: 'Notes', gate: YES },
        ]),
      },
    ],
  },

  // PDF page 3–5 — Fences, fixed to the four sides.
  fences: {
    name: 'Fences',
    fields: [
      {
        key: 'items', type: 'repeating-group',
        label: 'Fences (note only worst items — decayed posts and railings, rusted posts, leaning, missing palings)',
        repeat: {
          presentation: 'fixed-tabs',
          fixedInstances: [
            { key: 'front', label: 'Front' }, { key: 'left', label: 'Left' },
            { key: 'rear', label: 'Rear' }, { key: 'right', label: 'Right' },
          ],
        },
        itemFields: numbered([
          { key: 'present', type: 'yesno', label: 'Is there a fence to this side?' },
          { key: 'material', type: 'chip-multiselect', label: 'Material', options: opts('Timber pickets', 'Timber palings', 'Brick', 'Gal steel post & mesh wire', 'Metal sheets', 'Other'), gate: YES },
          { key: 'condition', type: 'chip-multiselect', label: 'Condition', options: opts('Satisfactory with typical weathering and some gaps', 'Decayed', 'Loose or missing palings', 'Leaning', 'Fair', 'Average', 'Poor'), gate: YES },
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Vegetation', 'Stored goods', 'Other'), gate: YES },
          { key: 'worstItem', type: 'textarea', label: 'Damage — describe worst item', gate: YES },
          { key: 'photos', type: 'photos', label: 'Pics', gate: YES },
          { ...externalDamages('Additional damage records (optional)'), gate: YES },
        ]),
      },
    ],
  },

  // PDF page 5 — Retaining walls.
  retaining_walls: {
    name: 'Retaining Walls',
    fields: [
      { key: 'present', type: 'yesno', label: 'Are there any retaining walls?' },
      {
        key: 'items', type: 'repeating-group', label: 'Retaining walls', gate: YES,
        repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add retaining wall', titleFieldKey: 'location' },
        itemFields: numbered([
          { key: 'location', type: 'pill-select', label: 'Location', options: opts('Left', 'Right', 'Rear', 'Front') },
          { key: 'materials', type: 'chip-multiselect', label: 'Materials', options: opts('Brick', 'Gal steel post & sleepers', 'Timber sleepers', 'Other') },
          { key: 'condition', type: 'chip-multiselect', label: 'Condition', options: opts('Satisfactory with typical weathering and some gaps', 'Decayed', 'Leaning', 'Fair', 'Average', 'Poor') },
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Vegetation', 'Stored goods', 'Other') },
          { key: 'worstItem', type: 'textarea', label: 'Damage — describe worst item' },
          { key: 'photos', type: 'photos', label: 'Pics' },
          externalDamages('Additional damage records (optional)'),
        ]),
      },
    ],
  },

  // PDF page 5–7 — Garage, Carport, Sheds, and Granny flat / Studio.
  garage_carport_sheds: {
    name: 'Garage / Carport / Sheds',
    fields: [
      {
        key: 'structures', type: 'repeating-group', label: 'Structures',
        repeat: {
          presentation: 'fixed-tabs', addable: true, addButtonLabel: 'Add structure',
          fixedInstances: [
            { key: 'garage', label: 'Garage' },
            { key: 'carport', label: 'Carport' },
            { key: 'shed', label: 'Shed / other' },
            { key: 'granny_flat', label: 'Granny flat / Studio' },
          ],
        },
        itemFields: numbered([
          { key: 'present', type: 'yesno', label: 'Present on site?' },
          { key: 'attachment', type: 'pill-select', label: 'Attachment (if the basement is the garage, record it under Internal Areas)', options: opts('Attached to house', 'Separate to house', 'Basement'), gate: YES },
          { key: 'position', type: 'pill-select', label: 'Position', options: opts('Left', 'Right', 'Rear', 'Front'), gate: YES },
          { key: 'walls', type: 'chip-multiselect', label: 'Walls', options: opts('Brick', 'Brick and metal', 'Metal', 'Fibre cement', 'Weatherboard', 'Timber framed', 'Concrete basement'), gate: YES },
          { key: 'wallsCondition', type: 'color-select', label: 'Condition', options: opts('Satisfactory condition with typical wear and tear', 'Fair', 'Average', 'Poor'), gate: YES },
          { key: 'roof', type: 'chip-multiselect', label: 'Roof', options: opts('Metal', 'Colorbond', 'Tiles', 'Fibre cement'), gate: YES },
          { key: 'floor', type: 'chip-multiselect', label: 'Floor', options: opts('Concrete hardstand', 'Concrete', 'Pavers', 'Gravel', 'Soil', 'Timber'), gate: YES },
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections of walls and floor obscured by', options: opts('Shelving', 'Stored goods', 'Parked car/s', 'Other'), gate: YES },
          { key: 'photos', type: 'photos', label: 'Pics', gate: YES },
          { ...externalDamages(), gate: YES },
          ...fabricBlocks('structure', YES),
          { key: 'notes', type: 'textarea', label: 'Notes', gate: YES },
        ]),
      },
    ],
  },

  // PDF page 7 — Pool / Spa.
  pool_spa: {
    name: 'Pool / Spa',
    fields: [
      { key: 'present', type: 'yesno', label: 'Is there a pool or spa?' },
      { key: 'position', type: 'pill-select', label: 'Located at', options: opts('Left', 'Right', 'Rear', 'Front'), gate: YES },
      { key: 'constructed', type: 'chip-multiselect', label: 'Constructed', options: opts('Fibreglass', 'Concrete and tile', 'Other'), gate: YES },
      { key: 'paving', type: 'chip-multiselect', label: 'Paving', options: opts('Tiles', 'Concrete', 'Terracotta', 'Other'), gate: YES },
      { key: 'poolFence', type: 'chip-multiselect', label: 'Pool fence', options: opts('Metal', 'Glass panels', 'Timber', 'Other'), gate: YES },
      { key: 'fenceSafety', type: 'color-select', label: 'Is the pool / spa fence OK?', options: opts('Appears to be okay', 'No, does not appear to be safe'), gate: YES },
      { key: 'condition', type: 'color-select', label: 'From limited views, condition is', options: opts('Satisfactory condition with typical wear and tear', 'Fair', 'Average', 'Poor'), gate: YES },
      { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Vegetation', 'Stored goods', 'Other'), gate: YES },
      { key: 'photos', type: 'photos', label: 'Pool / spa pics', gate: YES },
      { ...externalDamages(), gate: YES },
      { key: 'notes', type: 'textarea', label: 'Notes', gate: YES },
    ],
  },

  // PDF page 7–9 — MAIN STRUCTURE, the four elevations.
  elevations: {
    name: 'Elevations',
    fields: [
      {
        key: 'sides', type: 'repeating-group', label: 'Elevations',
        repeat: {
          presentation: 'fixed-tabs',
          fixedInstances: [
            { key: 'front', label: 'Front' }, { key: 'left', label: 'Left' },
            { key: 'rear', label: 'Rear' }, { key: 'right', label: 'Right' },
          ],
        },
        itemFields: numbered([
          { key: 'orientation', type: 'pill-select', label: 'Orientation', options: opts('North', 'South', 'East', 'West', 'Other') },
          { key: 'partyWall', type: 'yesno', label: 'Party wall abutting next property?' },
          { key: 'partyWallNumber', type: 'text', label: 'Abutting property number — could not be inspected', gate: { fieldKey: 'partyWall', equals: 'yes' } },
          { key: 'partialInspection', type: 'chip-multiselect', label: 'Could only be partly inspected to the', options: opts('Front', 'Rear', 'Side', 'To parapet above the roof line', 'Other') },
          { key: 'condition', type: 'color-select', label: 'Condition', options: opts('Satisfactory condition with typical wear and tear', 'Fair', 'Average', 'Poor') },
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Vegetation', 'Appliances', 'Trailer', 'Caravan', 'Sheds', 'Stored goods', 'Other') },
          { key: 'damageSummary', type: 'pill-select', label: 'Damage overview', options: opts('No visible significant damage', 'Several minor gaps and cracks', 'Multiple items of damage throughout') },
          { key: 'photos', type: 'photos', label: 'Elevation pics' },
          externalDamages(),
          ...fabricBlocks('elevation'),
          { key: 'notes', type: 'textarea', label: 'Notes' },
        ]),
      },
    ],
  },

  // PDF page 9–10 — Roof covering & chimneys, external.
  roof_chimneys: {
    name: 'Roof Covering & Chimneys',
    fields: [
      {
        key: 'sections', type: 'repeating-group', label: 'Roof & chimneys (general check — take photos to confirm materials and general condition)',
        repeat: {
          presentation: 'fixed-tabs',
          fixedInstances: [
            { key: 'upper', label: 'Upper roof & chimneys' },
            { key: 'lower', label: 'Lower roof & chimneys' },
          ],
        },
        itemFields: numbered([
          {
            key: 'inspectionStatus', type: 'chip-multiselect', label: 'Inspection status / limitations',
            options: opts('Not applicable as single storey', 'Not applicable — apartment', 'No chimney/s', 'Could not observe due to flat roof', 'Inspected partly from upstairs windows', 'Inspected partly from balcony', 'Limited observations from ground level using camera zoom'),
          },
          { key: 'coveringType', type: 'chip-multiselect', label: 'Roof covering', options: opts('Tile', 'Colorbond', 'Zincalume', 'Kliplock decking', 'Slate', 'Mix of') },
          {
            key: 'generalCondition', type: 'chip-multiselect', label: 'General condition',
            options: opts('Satisfactory to fair with typical weathering', 'Some surface rust', 'Cracked tiles', 'Gaps at flashings', 'Gaps / cracking to chimney brickwork', 'Chimney appears unstable'),
          },
          { key: 'photos', type: 'photos', label: 'Pics' },
          externalDamages('Damage records (optional)'),
          { key: 'notes', type: 'textarea', label: 'Notes' },
        ]),
      },
    ],
  },

  // PDF page 11–13 — INTERNAL.
  internal_areas: {
    name: 'Internal Areas',
    fields: [
      { key: 'renovationsInProgress', type: 'yesno', label: 'Renovations in progress?', sectionLetter: 'General' },
      { key: 'renovationsRooms', type: 'textarea', label: 'Which rooms?', gate: { fieldKey: 'renovationsInProgress', equals: 'yes' }, sectionLetter: 'General' },
      { key: 'renovationsPhotos', type: 'photos', label: 'Renovation pics', gate: { fieldKey: 'renovationsInProgress', equals: 'yes' }, sectionLetter: 'General' },
      { key: 'safetyAdvisories', type: 'yesno', label: 'Safety advisories to owner?', sectionLetter: 'General' },
      { key: 'safetyAdvisoryTypes', type: 'chip-multiselect', label: 'Safety advisory', options: opts('Exposed electrical cables', 'Leaking gas odour', 'Other'), gate: { fieldKey: 'safetyAdvisories', equals: 'yes' }, sectionLetter: 'General' },
      { key: 'safetyAdvisoryNotes', type: 'textarea', label: 'Describe', gate: { fieldKey: 'safetyAdvisories', equals: 'yes' }, sectionLetter: 'General' },
      { key: 'roomsNotAccessed', type: 'textarea', label: 'Any rooms not accessed — which rooms & why no access?', sectionLetter: 'General' },
      { key: 'movementObserved', type: 'yesno', label: 'Bouncy floors / sloping floors / binding doors & windows — anything indicating movement?', sectionLetter: 'General' },
      { key: 'movementWhere', type: 'textarea', label: 'Where? Describe', gate: { fieldKey: 'movementObserved', equals: 'yes' }, sectionLetter: 'General' },
      {
        key: 'rooms', type: 'repeating-group',
        label: 'Rooms — all-inclusive method: check and photograph every room regardless of condition',
        sectionLetter: 'Rooms',
        repeat: {
          // Numbered checklist + progress rather than a tab strip: 11 room
          // types don't fit a horizontal scroller, and the inspector needs to
          // see at a glance which rooms are still outstanding.
          presentation: 'fixed-tabs', addable: true, addButtonLabel: 'Add room',
          collapsible: true, itemNoun: 'room', titleFieldKey: 'roomName',
          // The inspector's preferred room set, and the original v1 instance
          // keys -- so answers already recorded against them still line up.
          // The PDF's extra rooms (Bedrooms 2-4, WC/Powder, Balcony/Terrace)
          // are reached through "Add room" rather than being fixed entries.
          fixedInstances: [
            { key: 'front_entry_hallway', label: 'Front Entry & Hallway' },
            { key: 'living_room', label: 'Living Room' },
            { key: 'dining_area', label: 'Dining Area' },
            { key: 'kitchen', label: 'Kitchen' },
            { key: 'bedroom', label: 'Bedroom' },
            { key: 'bathroom', label: 'Bathroom' },
            { key: 'laundry', label: 'Laundry' },
            { key: 'toilet', label: 'Toilet' },
            { key: 'stairwell', label: 'Stairwell' },
            { key: 'other', label: 'Other Internal Area' },
          ],
        },
        itemFields: numbered([
          // Renames the room everywhere -- the list row, this form's header and
          // the report (damage locations included). Blank keeps the standard
          // name, so "Bedroom" stays "Bedroom" until someone calls it
          // "Bedroom 2 — rear".
          { key: 'roomName', type: 'text', label: 'Room name (leave blank to keep the standard name)' },
          { key: 'present', type: 'yesno', label: 'Present / inspected?' },
          { key: 'floorLevel', type: 'pill-select', label: 'Floor level', options: opts('Ground floor', '1st floor', '2nd floor'), gate: YES },
          { key: 'withEnsuite', type: 'yesno', label: 'With ensuite? (bedrooms only)', gate: YES },
          { key: 'obscuredBy', type: 'chip-multiselect', label: 'Sections obscured by', options: opts('Furniture', 'Stored goods', 'Other'), gate: YES },
          { key: 'generalCondition', type: 'chip-multiselect', label: 'General condition', options: opts('Satisfactory and in typical condition', 'Fair', 'Poor', 'New', 'Other'), gate: YES },
          { key: 'damageSummary', type: 'pill-select', label: 'Damage overview', options: opts('No visible significant damage', 'Several minor gaps and cracks', 'Multiple items of damage throughout'), gate: YES },
          { key: 'photos', type: 'photos', label: 'Pics (typically 8–12: walls, windows, ceiling & cornices, floor coverings, skirts, doors & architraves)', gate: YES },
          { ...internalDamages(), gate: YES },
          { key: 'notes', type: 'textarea', label: 'Notes', gate: YES },
        ]),
      },
    ],
  },

  // PDF page 13 — Notes. The PDF prints POST PROJECT in its page-1 header, but
  // it stays here: Job Information is a hand-built screen that renders each
  // yes/no as its own titled card, which made it read as a second, unrelated
  // question rather than a job attribute.
  notes: {
    name: 'Notes / Post Project / Defects',
    fields: [
      { key: 'postProject', type: 'yesno', label: 'Post project? (if yes, use the previous report and update every item with new pics)' },
      {
        key: 'movement', type: 'repeating-group', label: 'Movement / safety checklist',
        repeat: {
          presentation: 'checklist',
          fixedInstances: [
            { key: 'bouncy_floors', label: 'Floors are bouncy / squeaking at…' },
            { key: 'floors_out_of_level', label: 'Floors are out of level, there is subsidence to the house at…' },
            { key: 'doors_binding', label: 'Doors are binding indicating subsidence at…' },
            { key: 'loose_bricks', label: 'Loose bricks that could fall due to excavations / vibrations. Where?' },
            { key: 'leaning_fences', label: 'Leaning fences that could fall over and be blamed on project works. Where?' },
            { key: 'balcony_unstable', label: 'Balcony is in poor condition and may not be stable…' },
          ],
        },
        itemFields: numbered([
          { key: 'value', type: 'yesno', label: 'Observed?' },
          { key: 'note', type: 'textarea', label: 'Describe location and details', gate: { fieldKey: 'value', equals: 'yes' } },
        ]),
      },
      {
        key: 'noAccess', type: 'repeating-group', label: 'No access to…',
        repeat: { presentation: 'strip', addable: true, addButtonLabel: 'Add area', titleFieldKey: 'area' },
        itemFields: numbered([
          { key: 'area', type: 'text', label: 'Area' },
          { key: 'reason', type: 'text', label: 'Reason' },
        ]),
      },
      externalDamages('Additional damage records'),
      { key: 'additionalNotes', type: 'textarea', label: 'Additional notes' },
    ],
  },
};

/** `--dry-run` validates every section against the live zod schema without writing. */
async function dryRun() {
  const { templateFieldSchema } = await import('../modules/templates/templates.schemas');
  let failures = 0;
  for (const [sectionKey, def] of Object.entries(SECTIONS)) {
    const built = numbered(def.fields);
    for (const field of built) {
      const parsed = templateFieldSchema.safeParse(field);
      if (!parsed.success) {
        failures += 1;
        // eslint-disable-next-line no-console
        console.error(`[INVALID] ${sectionKey}.${field.key}: ${JSON.stringify(parsed.error.issues)}`);
      }
    }
    const keys = built.map((f) => f.key);
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    if (dupes.length) { failures += 1; console.error(`[DUPE KEYS] ${sectionKey}: ${dupes.join(', ')}`); }
    for (const f of built) {
      const ik = (f.itemFields ?? []).map((x) => x.key);
      const idupes = ik.filter((k, i) => ik.indexOf(k) !== i);
      if (idupes.length) { failures += 1; console.error(`[DUPE ITEM KEYS] ${sectionKey}.${f.key}: ${idupes.join(', ')}`); }
    }
    // eslint-disable-next-line no-console
    console.log(`[ok] ${sectionKey}: ${built.length} top-level, ${built.reduce((n, f) => n + (f.itemFields?.length ?? 0), 0)} item fields`);
  }
  // eslint-disable-next-line no-console
  console.log(failures ? `\n${failures} PROBLEM(S) -- nothing written.` : '\nAll sections valid.');
  await prisma.$disconnect();
}

async function main() {
  if (process.argv.includes('--dry-run')) return dryRun();

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  for (const [sectionKey, def] of Object.entries(SECTIONS)) {
    const latest = await prisma.inspectionTemplate.findFirst({
      where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey,
        name: def.name,
        version: (latest?.version ?? 0) + 1,
        status: 'DRAFT',
        fields: numbered(def.fields) as unknown as object,
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
    console.log(`[residential-pdf] ${sectionKey} -> v${draft.version} (${def.fields.length} top-level fields)`);
  }

  await prisma.$disconnect();
}

void main();
