// Builds every Pre-Purchase × Residential House section template from the
// "Houspect Building (Pre-Purchase) Inspector Template. House & Commercial,
// March 2025" source PDF.
//
// A pre-purchase inspection is an element-by-element condition survey, not a
// damage log, so it is organised very differently to Dilapidation: the whole
// roof, then everything external, then everything internal, then the
// structural / major-defect / safety determinations the report turns on.
// Roughly 50 sub-areas in total.
//
// Navigation over scrolling: every long section is published with
// `layout.mode = 'section-nav'`, which the mobile renderer turns into a
// tap-through list of sub-areas (icon, title, hint, completion tick), each
// opening in its own full-screen form.
//
// Sub-areas that can be skipped ask "Applicable / accessible?" first and gate
// their fields on `yes`, capturing the reason on `no` -- the field gate
// supports equality only, so a positive question is what makes "hide when not
// applicable" expressible.
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'pre_purchase';
const PROPERTY_TYPE = 'residential_house';

type Field = Omit<TemplateField, 'order'>;
type FType = 'chips' | 'multi' | 'yesno' | 'text' | 'textarea';
interface SubField { key: string; label: string; type: FType; options?: string[] }
interface CheckGroup { heading?: string; items: string[] }
interface SubArea {
  id: string; title: string; icon: string; hint: string;
  naOptions?: string[];
  fields?: SubField[];
  checkGroups?: CheckGroup[];
  postCheckFields?: SubField[];
}

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
const opts = (...l: string[]) => mkOpts(l);

function numbered(fields: Field[]): TemplateField[] {
  return fields.map((f, i) => ({
    ...f,
    order: i,
    itemFields: f.itemFields ? numbered(f.itemFields as Field[]) : undefined,
  }));
}

const TYPE_MAP: Record<FType, TemplateField['type']> = {
  chips: 'pill-select', multi: 'chip-multiselect', yesno: 'yesno', text: 'text', textarea: 'textarea',
};

/** Expands one sub-area into flat, uniquely-keyed fields all tagged with its title. */
function compile(area: SubArea): Field[] {
  const p = `${area.id.replace(/-/g, '_')}_`;
  const L = area.title;
  const out: Field[] = [];
  const gate = area.naOptions ? { fieldKey: `${p}applicable`, equals: 'yes' } : undefined;

  if (area.naOptions) {
    out.push({ key: `${p}applicable`, type: 'yesno', label: 'Applicable / accessible?', sectionLetter: L });
    out.push({
      key: `${p}naReason`, type: 'pill-select', label: 'Reason', options: mkOpts(area.naOptions),
      gate: { fieldKey: `${p}applicable`, equals: 'no' }, sectionLetter: L,
    });
  }

  const asField = (f: SubField): Field => ({
    key: `${p}${f.key}`,
    label: f.label,
    type: TYPE_MAP[f.type],
    options: f.type === 'chips' || f.type === 'multi' ? mkOpts(f.options ?? []) : undefined,
    gate,
    sectionLetter: L,
  });

  for (const f of area.fields ?? []) out.push(asField(f));

  (area.checkGroups ?? []).forEach((grp, i) => {
    out.push({
      key: `${p}checks${i || ''}`,
      type: 'chip-multiselect',
      label: grp.heading ?? 'Observations & defects (select all that apply)',
      options: mkOpts(grp.items),
      gate,
      sectionLetter: L,
    });
  });

  for (const f of area.postCheckFields ?? []) out.push(asField(f));

  // Comments and pics stay ungated -- an inspector still needs to record why
  // something was not applicable, and photograph the fact.
  out.push({ key: `${p}comments`, type: 'textarea', label: 'Comments', sectionLetter: L });
  out.push({ key: `${p}photos`, type: 'photos', label: 'Photo Nos', sectionLetter: L });
  return out;
}

const COND5 = ['Good', 'Satisfactory', 'Fair', 'Average', 'Poor'];
const COND_V = [...COND5, 'Varying'];
const COND_AGE = ['Satisfactory', 'Fair', 'Average', 'Poor', 'Good in relation to its age'];
const STAIR_CHECKS = [
  'Handrail / balustrade height is less than 1000mm and does not comply with Aust Standards',
  'Balustrade spacing between railings is more than 125mm and does not comply with Aust Standards',
  'Stair treads / risers are not equal and do not comply with current Aust Standards',
  'Stair risers are higher than the maximum 190mm and do not comply with current Aust Standards',
  'Stair treads are less than the minimum 240mm and do not comply with current Aust Standards',
];

// ── ROOF ────────────────────────────────────────────────────────────────────
const ROOF: SubArea[] = [
  {
    id: 'roof-covering', title: 'Roof Covering', icon: '🏠', hint: 'Type, covering, condition, defects',
    naOptions: [
      'Apartment complex — stop and use the Apartment template',
      'No safe access (OH&S) — flat/low pitch roof could not be observed from the ground',
      'No safe access (OH&S) — limited observations only',
    ],
    fields: [
      { key: 'roofIs', label: 'The roof is', type: 'chips', options: ['Pitched', 'Flat', 'Combination of pitched and flat', 'Other'] },
      { key: 'covering', label: 'The covering and capping / ridges are', type: 'chips', options: ['Concrete tiles', 'Terracotta tiles', 'Colorbond', 'Zincalume', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: COND_AGE },
      { key: 'requires', label: 'Generally requires', type: 'chips', options: ['No repairs', 'Normal maintenance', 'Re-pointing'] },
    ],
    checkGroups: [{
      items: [
        'Minimal fall to the metal roof sheeting less than the required pitch — overflows may occur during heavy rains',
        'Rusted roof sheeting needs replacing',
        'Broken tiles were observed',
        'The cement tiles have lost their protective coating and require recoating',
      ],
    }],
    postCheckFields: [
      { key: 'recoatWithin', label: 'If recoating required, within', type: 'chips', options: ['1 to 2 years', '3 to 5 years'] },
    ],
  },
  {
    id: 'eaves', title: 'Eaves / Soffits', icon: '🏗️', hint: 'Construction, condition, water staining',
    naOptions: ['There are no eaves nor soffits'],
    fields: [
      { key: 'construction', label: 'Eaves / soffits are', type: 'chips', options: ['Boxed with painted fibre cement', 'Painted timber lining boards', 'Lined on the rake and exposed rafters', 'Exposed rafters', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: COND5 },
      { key: 'requires', label: 'Require', type: 'chips', options: ['Maintenance', 'Repairs', 'Painting', 'No attention'] },
    ],
    checkGroups: [{ items: ['Water stains indicating regularly overflowing gutters', 'Linings are bowed', 'Linings are cracked'] }],
  },
  {
    id: 'fascia', title: 'Fascia', icon: '🪵', hint: 'Material, finish, condition',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'construction', label: 'Fascias constructed of', type: 'chips', options: ['Timber', 'Colorbond steel', 'Timber and rolled sheet metal'] },
      { key: 'finish', label: 'And are', type: 'chips', options: ['Painted', 'Unpainted', 'Weathered'] },
      { key: 'condition', label: 'Condition is', type: 'chips', options: COND5 },
      { key: 'requireAttention', label: 'They require attention?', type: 'yesno' },
    ],
    checkGroups: [{
      items: ['Timber is weathered requiring maintenance', 'Timber is decayed requiring maintenance', 'Metal is rusted requiring maintenance'],
    }],
  },
  {
    id: 'gables', title: 'Gables', icon: '🔺', hint: 'Construction, paint, cracking',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'construction', label: 'Gables are constructed of', type: 'text' },
      { key: 'painted', label: 'Painted?', type: 'yesno' },
      { key: 'condition', label: 'Condition is', type: 'chips', options: COND_V },
    ],
    checkGroups: [{
      items: [
        'Timber is weathered requiring maintenance',
        'Timber is decayed requiring maintenance',
        'Brickwork is cracking — refer to Walls section',
        'Cement sheet is cracked / damaged',
      ],
    }],
  },
  {
    id: 'flashings', title: 'Flashings', icon: '📐', hint: 'Material, sealant, chimney flashings',
    naOptions: ['Apartment complex — not visible', 'Roof not accessible'],
    fields: [
      { key: 'construction', label: 'Flashings are constructed of', type: 'chips', options: ['Colorbond', 'Sheet metal', 'Lead and sheet metal', 'Lead'] },
      { key: 'painted', label: 'They are painted?', type: 'yesno' },
      { key: 'condition', label: 'Condition is', type: 'chips', options: COND_V },
    ],
    checkGroups: [{
      items: [
        'Gaps seen between walls and flashing requires sealant',
        'The lead flashings need to be painted',
        'The chimney flashings are rusted and need to be replaced',
      ],
    }],
  },
  {
    id: 'gutters', title: 'Gutters & Valleys', icon: '💧', hint: 'Gutters, falls, valleys, cleaning',
    naOptions: ['Apartment complex — not visible', 'Roof could not be safely accessed'],
    fields: [
      { key: 'gutterTypes', label: 'There are', type: 'multi', options: ['Perimeter gutters', 'Boxed gutters'] },
      { key: 'gutterMaterial', label: 'Gutters are constructed of', type: 'chips', options: ['Colorbond', 'Zincalume', 'Other'] },
      { key: 'gutterCondition', label: 'Condition in relation to their age is', type: 'chips', options: COND_V },
      { key: 'gutterRequires', label: 'Require', type: 'chips', options: ['Repair', 'Replacement', 'Normal maintenance', 'No attention'] },
      { key: 'needCleaning', label: 'Gutters need to be cleaned?', type: 'yesno' },
    ],
    checkGroups: [{
      heading: 'Gutter defects',
      items: [
        'Gutters are holding water and have inadequate falls to downpipes — consult a licensed plumber',
        'Gutters are rusting and require maintenance or replacement — consult a licensed plumber',
        'Evidence of overflowing gutters — engage a licensed plumber to assess and rectify',
        'Gutters require replacement to several sections — engage a licensed plumber',
      ],
    }],
    postCheckFields: [
      { key: 'valleysPresent', label: 'Are there valleys?', type: 'yesno' },
      { key: 'valleyMaterial', label: 'Valleys fabricated of', type: 'chips', options: ['Galvanised iron', 'Zincalume', 'Colorbond steel'] },
      { key: 'valleyCondition', label: 'Valleys — general condition', type: 'chips', options: COND5 },
      { key: 'valleysNeedCleaning', label: 'Valleys need to be cleaned?', type: 'yesno' },
      { key: 'valleyDefect', label: 'The valley irons are rusted and need', type: 'chips', options: ['No attention', 'Maintenance', 'To be replaced'] },
    ],
  },
  {
    id: 'downpipes', title: 'Downpipes', icon: '🔩', hint: 'Material, condition, leaks',
    fields: [
      { key: 'material', label: 'Fabricated of', type: 'chips', options: ['Colorbond', 'Zincalume', 'PVC', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: COND_V },
      { key: 'requires', label: 'They require', type: 'chips', options: ['Repairs', 'Replacement', 'Maintenance on the joints', 'Normal maintenance', 'No attention'] },
    ],
    checkGroups: [{
      items: [
        'The downpipes are leaking — engage a licensed plumber to assess and rectify',
        'The downpipes are rusted requiring repair',
        'The downpipes are rusted requiring replacement',
      ],
    }],
  },
  {
    id: 'chimneys', title: 'Chimneys / Flue', icon: '🧱', hint: 'Material, condition, flashing',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'metalFlueOkay', label: 'Metal flue and okay?', type: 'yesno' },
      { key: 'chimneyMaterial', label: 'Chimney is', type: 'chips', options: ['Brick', 'Rendered brick', 'Bluestone'] },
      { key: 'condition', label: 'Condition is', type: 'chips', options: ['Weathered', 'Satisfactory', 'Unsafe structurally', 'Poor'] },
      { key: 'operating', label: 'Operating at time of inspection?', type: 'yesno' },
    ],
    checkGroups: [{
      items: ['Flashing around chimney needs attention — consult a plumber', 'Brick work is fretting and needs repointing'],
    }],
  },
];

// ── EXTERNAL — BUILDING ─────────────────────────────────────────────────────
const EXTERNAL: SubArea[] = [
  {
    id: 'walls', title: 'Walls', icon: '🧱', hint: 'Construction, cracking, weathering, damp',
    fields: [
      { key: 'construction', label: 'External walls constructed of', type: 'text' },
      { key: 'rendered', label: 'Rendered', type: 'yesno' },
      { key: 'condition', label: 'Condition in relation to its age is', type: 'chips', options: ['Satisfactory', 'Fair', 'Average', 'Poor', 'Average to poor'] },
      { key: 'majorCracking', label: 'There are signs of major cracking', type: 'yesno' },
      { key: 'significantWeathering', label: 'There are signs of significant weathering', type: 'yesno' },
      { key: 'generallyStable', label: 'Walls are generally stable', type: 'yesno' },
    ],
    checkGroups: [
      {
        heading: 'Cracking assessment',
        items: [
          'Minor cracking visible consistent with age, not of a structural nature',
          'Cracking over window / door heads is typical and not a structural defect unless bricks are loose',
          'Major cracking requiring repairs — not currently affecting the structure but could if not attended to soon',
          'Immediate repairs required to arrest movement and collapse — consider consulting a structural engineer',
        ],
      },
      {
        heading: 'Defect items',
        items: [
          'Loose bricks',
          'Drummy render',
          'Fretting of mortar requires repointing',
          'Evidence of rising damp',
          'Patching and re-pointing to brickwork where appliances / fittings have been removed',
          'Mortar has come out of joints at lower courses and needs repointing',
          'There is spalling to some bricks',
          'Weep holes not visible',
          'Weep holes covered or partly covered and need to be kept clear',
          'Sub floor vents covered or partly covered and need to be kept clear',
        ],
      },
    ],
  },
  {
    id: 'cladding', title: 'Cladding', icon: '🪟', hint: 'Material, weathering, asbestos',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'construction', label: 'Cladding constructed of', type: 'text' },
      { key: 'rendered', label: 'Rendered', type: 'yesno' },
      { key: 'condition', label: 'Condition in relation to age is', type: 'chips', options: ['Satisfactory', 'Fair', 'Average', 'Poor', 'Average to poor'] },
      { key: 'significantWeathering', label: 'There are signs of significant weathering', type: 'yesno' },
      { key: 'requires', label: 'Cladding requires', type: 'chips', options: ['Normal maintenance', 'Completion of render', 'Re-painting'] },
    ],
    checkGroups: [{
      items: [
        'Some weathering visible, requires maintenance or replacement',
        'Breakage visible to cement sheet wall cladding',
        'Cladding may contain asbestos',
      ],
    }],
  },
  {
    id: 'subfloor', title: 'Sub-Floor', icon: '🏚️', hint: 'Access, stumps, damp, support',
    naOptions: ['Not applicable as constructed on concrete slab', 'No access to subfloor'],
    fields: [
      { key: 'access', label: 'Sub-floor inspected from', type: 'chips', options: ['Manhole at side', 'Rear access', 'Limited access to subfloor', 'Limited views through plinth boards', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: ['Varying', 'Satisfactory', 'Fair', 'Average', 'Poor structurally'] },
      { key: 'adequateSupport', label: 'It provides adequate support?', type: 'yesno' },
    ],
    checkGroups: [{
      items: [
        'Stumps have subsided',
        'There is some decay to several stumps',
        'Requires re-stumping',
        'Packing required to stumps / bearers',
        'The sub-floor is damp',
        'Stored items and debris to be cleared from sub floor to improve access and airflow',
        'Floors are bouncy / squeaking due to movement as there appears to be some subsidence',
      ],
    }],
  },
  {
    id: 'lintels', title: 'Lintels', icon: '📏', hint: 'Material, rust, failure',
    fields: [
      { key: 'material', label: 'Lintels', type: 'chips', options: ['Steel', 'Concrete', 'Limestone', 'Timber'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: ['Satisfactory', 'Fair', 'Average', 'Poor'] },
      { key: 'signsOfFailure', label: 'Any signs of failure?', type: 'chips', options: ['No and okay', 'No obvious signs', 'Some minor', 'Some major', 'Yes failing & need repairs'] },
    ],
    checkGroups: [{
      items: [
        'The lintel/s require replacement and the brick work above should be repaired',
        'Severe rusting is causing the lintel to expand and crack the surrounding brickwork',
        'Surface rust and needs maintenance',
      ],
    }],
  },
  {
    id: 'windows-ext', title: 'Windows / Window Frames', icon: '🪟', hint: 'Material, glazing, screens',
    fields: [
      { key: 'construction', label: 'Windows and frames are constructed generally of', type: 'chips', options: ['Timber and aluminium', 'Timber', 'Aluminium', 'Timber and powder-coated', 'Anodized', 'Painted'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: ['Varying', 'Satisfactory', 'Fair', 'Average', 'Poor'] },
      { key: 'requires', label: 'Require', type: 'chips', options: ['Normal maintenance', 'Repairs', 'No attention'] },
      { key: 'glazingBeads', label: 'Glazing beads appear', type: 'chips', options: ['Sound', 'Serviceable', 'Poor'] },
      { key: 'securityScreens', label: 'Security screens installed?', type: 'yesno' },
      { key: 'rollerShutters', label: 'Roller shutters installed?', type: 'yesno' },
    ],
    checkGroups: [{
      items: [
        'Broken glazed pane',
        'The aluminium frame edge has come away from the rubber seal and glazing',
        'Water ingress visible to glazing frame requires replacement of putty and sealing',
        'Weathering surface damage to timber frames, requires painting',
        'Some wood decay requiring attention',
        'Non-timber windows: confirm glazing beads to be replaced by Neoprene glazing rubber',
      ],
    }],
  },
  {
    id: 'front-door', title: 'Front Door/s & Frames', icon: '🚪', hint: 'Material, security, deadlocks',
    fields: [
      { key: 'construction', label: 'Constructed of', type: 'chips', options: ['Timber', 'Aluminium', 'Pressed metal', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: COND5 },
      { key: 'requires', label: 'Require', type: 'chips', options: ['No repairs', 'Normal maintenance', 'Re-painting'] },
      { key: 'securityScreen', label: 'Front door security screen', type: 'yesno' },
      { key: 'deadlocks', label: 'Deadlocks fitted', type: 'yesno' },
      { key: 'doorCloser', label: 'Door closer working', type: 'chips', options: ['Not applicable', 'Yes', 'No'] },
    ],
  },
  {
    id: 'other-doors-ext', title: 'Other External Doors', icon: '🚪', hint: 'Style, binding, delaminating',
    fields: [
      { key: 'style', label: 'Doors are', type: 'chips', options: ['Solid-core', 'Hollow-core', 'Glazed', 'Paneled', 'Aluminium sliding', 'A variety of styles'] },
      { key: 'condition', label: 'Condition is generally', type: 'chips', options: ['Varying', 'Satisfactory', 'Fair', 'Average', 'Poor'] },
      { key: 'requires', label: 'Generally require', type: 'chips', options: ['No repairs', 'Normal maintenance', 'Re-painting'] },
    ],
    checkGroups: [{
      items: [
        'Doors are delaminating',
        'Doors are binding — they require a 2mm clearance',
        'Edges of door require sealing to avoid water damage',
        'Door latch not engaging',
      ],
    }],
    postCheckFields: [{ key: 'whichDoors', label: 'Which doors?', type: 'text' }],
  },
  {
    id: 'ext-stairs', title: 'External Stairs', icon: '🪜', hint: 'Material, handrails, compliance',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'construction', label: 'Constructed of', type: 'chips', options: ['Brick', 'Steel', 'Concrete', 'Timber', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: COND5 },
      { key: 'handRailsRequired', label: 'Hand rails required?', type: 'yesno' },
      { key: 'handRailsAdequate', label: 'Hand rails adequate? (measure the heights)', type: 'yesno' },
      { key: 'riseTreadAdequate', label: 'The rise and tread are adequate? (show measurements)', type: 'yesno' },
    ],
    checkGroups: [{ heading: 'Compliance & safety', items: STAIR_CHECKS }],
  },
  {
    id: 'balconies', title: 'Balconies', icon: '🏙️', hint: 'Fixing, handrails, drainage',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'construction', label: 'Balconies constructed of', type: 'chips', options: ['Steel', 'Timber', 'Concrete', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: ['Varying', 'Satisfactory', 'Fair', 'Average', 'Poor'] },
      { key: 'adequatelyFixed', label: 'Appear to be adequately fixed to building?', type: 'yesno' },
      { key: 'handRailsRequired', label: 'Hand rails required?', type: 'yesno' },
      { key: 'handRailsAdequate', label: 'Hand rails adequate? (measure the heights)', type: 'yesno' },
      { key: 'handRailCondition', label: 'Condition of hand rails', type: 'chips', options: COND5 },
    ],
    checkGroups: [{
      items: [
        'There is decay',
        'Hand rails do not comply with current Aust Standards',
        'The balustrade is loose and requires maintenance',
        'The handrails / balustrade height is less than 1000mm and does not comply with Aust Standards',
        'The balustrade spacing between railings is more than 125mm and does not comply with Aust Standards',
        'Water appears to pond on the balcony floor — floor falls may not be channelling water to the drain',
        'The balcony floor drainage may be blocked — recommend all drains be cleaned out as part of maintenance',
      ],
    }],
  },
  {
    id: 'verandah', title: 'Verandah / Front Porch / Decking', icon: '🏡', hint: 'Fixing, handrails, decay',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'construction', label: 'Constructed of', type: 'chips', options: ['Steel', 'Timber', 'Concrete', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: ['Varying', 'Satisfactory', 'Fair', 'Average', 'Poor'] },
      { key: 'adequatelyFixed', label: 'Appears adequately fixed to the building?', type: 'yesno' },
      { key: 'handRailsRequired', label: 'Hand rails required?', type: 'yesno' },
      { key: 'handRailsAdequate', label: 'Hand rails adequate? (measure the heights)', type: 'yesno' },
      { key: 'handRailCondition', label: 'Condition of hand rails', type: 'chips', options: COND5 },
    ],
    checkGroups: [{
      items: [
        'There is decay',
        'The handrails / balustrade height is less than 1000mm and does not comply with Aust Standards',
        'The balustrade spacing between railings is more than 125mm and does not comply with Aust Standards',
      ],
    }],
  },
  {
    id: 'alfresco', title: 'Alfresco / Pergola', icon: '⛱️', hint: 'Fixing, covering, support',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'type', label: 'This is a', type: 'chips', options: ['Alfresco', 'Pergola'] },
      { key: 'construction', label: 'Constructed of', type: 'text' },
      { key: 'freestanding', label: 'Freestanding?', type: 'yesno' },
      { key: 'fixedToHouse', label: 'Adequately fixed to the house?', type: 'chips', options: ['Not applicable', 'Yes', 'No'] },
      { key: 'covered', label: 'It is covered?', type: 'yesno' },
      { key: 'covering', label: 'The covering is', type: 'chips', options: ['Colorbond', 'Laserlite', 'Other'] },
      { key: 'adequatelySupported', label: 'Adequately supported?', type: 'yesno' },
      { key: 'saggingMovement', label: 'There are signs of sagging and movement?', type: 'yesno' },
    ],
    checkGroups: [{
      items: [
        'Signs of rust to metal stirrups require maintenance',
        'Exposed timber requires maintenance',
        'There is decay',
        'Weathering to timber battens, requiring replacement',
        'Rafter bolts required to fix the support to the house',
      ],
    }],
  },
];

// ── OUTBUILDINGS ────────────────────────────────────────────────────────────
const OUTBUILDINGS: SubArea[] = [
  {
    id: 'garage', title: 'Garage', icon: '🚗', hint: 'Location, walls, roof, hardstand',
    naOptions: ['There is no garage'],
    fields: [
      { key: 'location', label: 'Garage is', type: 'chips', options: ['In basement', 'Freestanding', 'Attached to house', 'Car bay in basement of apartment complex', 'There is a car bay'] },
      { key: 'side', label: 'Located at', type: 'chips', options: ['Front', 'Left side', 'Rear', 'Right side'] },
      { key: 'walls', label: 'Walls constructed of', type: 'multi', options: ['Brick', 'Metal sheets', 'Fibre cement sheets', 'Other'] },
      { key: 'hardstand', label: 'Concrete slab hardstand', type: 'yesno' },
      { key: 'roofCovering', label: 'Roof covering', type: 'chips', options: ['Colorbond', 'Tiles', 'Fibre cement', 'Other'] },
      { key: 'condition', label: 'General condition', type: 'chips', options: COND5 },
      { key: 'requiresAttention', label: 'Requires attention?', type: 'yesno' },
    ],
    checkGroups: [{
      items: [
        'Cracking to walls',
        'Repairs required',
        'Damp visible to walls',
        'Roof is leaking',
        'Replace roof',
        'Consult plumber',
        'Rust to lintels',
        'Minor cracking to hardstand but not of concern — monitor from time to time',
        'There is decay',
      ],
    }],
  },
  {
    id: 'carport', title: 'Carport', icon: '🅿️', hint: 'Location, frame, roof',
    naOptions: ['There is no carport'],
    fields: [
      { key: 'side', label: 'Carport is at', type: 'chips', options: ['Front', 'Left side', 'Rear', 'Right side'] },
      { key: 'attachedTo', label: 'Attached to', type: 'chips', options: ['Garage', 'House', 'Freestanding'] },
      { key: 'frame', label: 'Frame / support constructed of', type: 'chips', options: ['Timber', 'Steel', 'Other'] },
      { key: 'hardstand', label: 'Concrete slab hardstand', type: 'yesno' },
      { key: 'roofCovering', label: 'Roof covering', type: 'chips', options: ['Colorbond', 'Other'] },
      { key: 'condition', label: 'General condition', type: 'chips', options: COND5 },
    ],
    checkGroups: [{ items: ['Roof is leaking', 'Replace roof', 'Consult plumber', 'There is decay'] }],
  },
  {
    id: 'sheds', title: 'Sheds', icon: '🏚️', hint: 'Count, construction, condition',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'count', label: 'Count', type: 'chips', options: ['1', '2', '3', 'Other'] },
      { key: 'construction', label: 'Constructed of', type: 'text' },
      { key: 'condition', label: 'Condition', type: 'chips', options: COND5 },
      { key: 'requireAttention', label: 'Require attention?', type: 'yesno' },
    ],
  },
  {
    id: 'studio', title: 'Studio', icon: '🎨', hint: 'Location, condition',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'location', label: 'Studio located at', type: 'text' },
      { key: 'condition', label: 'General condition', type: 'chips', options: COND5 },
      { key: 'requiresAttention', label: 'It requires attention?', type: 'yesno' },
    ],
  },
  {
    id: 'granny-flat', title: 'Granny Flat', icon: '🏘️', hint: 'Location, construction, condition',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'location', label: 'Granny flat located at', type: 'text' },
      { key: 'construction', label: 'Constructed of', type: 'text' },
      { key: 'roofCovering', label: 'Roof covering is', type: 'text' },
      { key: 'condition', label: 'General condition', type: 'chips', options: COND5 },
      { key: 'requiresAttention', label: 'It requires attention?', type: 'yesno' },
    ],
  },
];

// ── INTERNAL ────────────────────────────────────────────────────────────────
const INTERNAL: SubArea[] = [
  {
    id: 'roof-cavity', title: 'Roof Cavity', icon: '🔺', hint: 'Access, covering underside, staining',
    naOptions: ['Flat roof design with no cavity', 'No manhole', 'No safe access to manhole'],
    fields: [
      { key: 'accessedFrom', label: 'Accessed from manhole at', type: 'text' },
      { key: 'obscuredBySarking', label: 'Underside of roof obscured by sarking?', type: 'yesno' },
      { key: 'undersideCondition', label: 'Condition of roof covering underside', type: 'chips', options: ['Good', 'Satisfactory', 'Average', 'Poor', 'Varying'] },
      { key: 'failureIndications', label: 'Indications of failure of roof covering?', type: 'yesno' },
    ],
    checkGroups: [{
      items: [
        'Evidence of staining',
        'Evidence of efflorescence (salting)',
        'Build-up of salt deposits under tiles indicates breakdown of protective coating — resealing may be required',
        'Underside of tiles are fretting',
        'The metal roofing has pinholes due to rusting',
      ],
    }],
    postCheckFields: [
      { key: 'recoatWithin', label: 'Re-coating of roof tiles may need to be considered in the next', type: 'chips', options: ['1 to 2 years', 'Next 3 to 5 years'] },
    ],
  },
  {
    id: 'sarking', title: 'Sarking', icon: '📄', hint: 'Presence and effectiveness',
    naOptions: ['No access to roof cavity', 'Not applicable — there is no sarking'],
    fields: [{ key: 'effective', label: 'Sarking is in place and is considered effective?', type: 'yesno' }],
  },
  {
    id: 'roof-frame', title: 'Roof Frame', icon: '🪵', hint: 'Frame type, support, tie-downs',
    naOptions: ['No access'],
    fields: [
      { key: 'construction', label: 'Roof frame is constructed of', type: 'chips', options: ['Timber', 'Steel'] },
      { key: 'frameType', label: 'Frame is', type: 'chips', options: ['Conventional stick frame', 'Truss', 'Engineered steel girders', 'Structural steel frame', 'Combination of conventional stick frame and truss', 'Exposed rafters beams'] },
      { key: 'supportAdequate', label: 'The support system is adequate?', type: 'yesno' },
    ],
    checkGroups: [{
      items: [
        'A frame member is broken requiring repair',
        'The supporting timbers are over-spanned',
        'The supporting timbers are undersized',
        'The rafters / tile batons have warped but are still structurally sound',
        'The metal roof is not adequately held down — tie down straps required as per the Building Code of Australia',
        'Roof frame is considered not structurally sound (major defects)',
      ],
    }],
    postCheckFields: [{ key: 'notSoundReasons', label: 'If not structurally sound, reasons', type: 'textarea' }],
  },
  {
    id: 'insulation', title: 'Insulation', icon: '🧊', hint: 'Coverage, effectiveness, fire hazard',
    naOptions: ['No access to roof cavity'],
    fields: [
      { key: 'state', label: 'Insulation is', type: 'chips', options: ['Partially visible', 'Not visible', 'In place'] },
      { key: 'effective', label: 'Effective?', type: 'yesno' },
    ],
    checkGroups: [{
      items: [
        'Some insulation is not in place and needs to be re-positioned to be more effective',
        'Old insulation may not be effective and needs top up or new insulation batts installed',
        'Safety matter: insulation touching and covering recessed light fittings and transformers — fire hazard',
      ],
    }],
  },
  {
    id: 'party-walls', title: 'Party Walls', icon: '🧱', hint: 'Fire barrier, roof timbers',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'location', label: 'Party wall/s to', type: 'text' },
      { key: 'extendsToUnderside', label: 'The party wall/s extend to the underside of the roof cover as required?', type: 'yesno' },
      { key: 'fireBarrier', label: 'Appropriately constructed as a fire barrier per current regulations?', type: 'yesno' },
    ],
    checkGroups: [{
      items: ['There are roof timbers passing through the party wall and brickwork does not go to underside of roof covering'],
    }],
  },
  {
    id: 'ceilings', title: 'Ceilings', icon: '⬆️', hint: 'Material, cornices, cracking, staining',
    fields: [
      { key: 'material', label: 'Ceiling material is generally made of', type: 'chips', options: ['Plasterboard', 'Lathe and plaster', 'Other'] },
      { key: 'cornices', label: 'Cornices are', type: 'chips', options: ['Cove', 'Ornate', 'Traditional', 'Varying', 'Timber moulding', 'Shadowline', 'Square set'] },
      { key: 'condition', label: 'Condition is', type: 'chips', options: ['Good', 'Satisfactory', 'Average', 'Poor', 'Varying'] },
      { key: 'adequatelyFixed', label: 'Generally, adequately fixed?', type: 'yesno' },
    ],
    checkGroups: [{
      items: [
        'Ceiling is not adequately attached to ceiling frame and has deflected significantly',
        'Minor imperfections i.e. hairline cracks consistent with age and not considered a significant defect',
        'Cornice cracking due to contraction and expansion of supporting timbers and is not a structural issue',
        'Presence of flaking / mould / mildew to paintwork due to excessive moisture in wet areas — install mechanical ventilation',
        'Minor paint flaking',
        'Watermarks and staining visible due to a water leak',
      ],
    }],
  },
  {
    id: 'int-walls', title: 'Walls', icon: '🧱', hint: 'Construction, cracking, damp',
    fields: [
      { key: 'construction', label: 'Constructed of', type: 'chips', options: ['Plasterboard on timber studs', 'Lathe and plaster', 'Plasterboard on brick walls', 'Concrete'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: ['Good', 'Satisfactory', 'Average', 'Poor', 'Varying'] },
    ],
    checkGroups: [{
      items: [
        'There is no major cracking nor other signs of significant movement',
        'Minor cracking over doorways and/or windows consistent with age and not a structural concern',
        'Minor cracking consistent with age, due to normal settlement / movement',
        'There is major cracking requiring attention',
        'Structural cracks requiring investigation by a structural engineer',
        'Drummy / loose / flaking plaster',
        'Walls have been recently painted',
        'Damp from shower / bath in adjacent room to the base of the wall',
      ],
    }],
  },
  {
    id: 'floors', title: 'Floors', icon: '⬇️', hint: 'Construction, coverings, level, squeaking',
    fields: [
      { key: 'construction', label: 'Generally constructed of', type: 'chips', options: ['Concrete and timber', 'Polished concrete', 'Timber floorboards', 'Other'] },
      { key: 'coverings', label: 'Covered in', type: 'multi', options: ['Floating timber', 'Tiles', 'Laminate flooring', 'Vinyl', 'Carpet'] },
    ],
    checkGroups: [{
      items: [
        'The tiled areas do not require attention',
        'No significant cracks were seen',
        'Floor tiling drummy',
        'Concrete floor has minor cracking caused by rate of drying and is not of a structural nature',
        'Timber floors are squeaking and require refixing',
        'Floors unlevel — packing to stumps / bearers may be required',
        'Flooring is poorly supported',
        'Subsidence of the floor evident',
      ],
    }],
  },
  {
    id: 'int-stairs', title: 'Internal Stairs', icon: '🪜', hint: 'Material, handrails, compliance',
    naOptions: ['The property is single level and there are no internal stairs'],
    fields: [
      { key: 'construction', label: 'Constructed of', type: 'chips', options: ['Steel', 'Concrete', 'Timber', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: COND5 },
      { key: 'handRailsRequired', label: 'Hand rails required?', type: 'yesno' },
      { key: 'handRailsAdequate', label: 'Hand rails adequate? (measure the heights)', type: 'yesno' },
    ],
    checkGroups: [{
      heading: 'Compliance & safety',
      items: [
        ...STAIR_CHECKS.slice(0, 2),
        'The balustrade has horizontal rails that may be climbable by a child — safety concern, add to safety matters',
        ...STAIR_CHECKS.slice(2),
      ],
    }],
  },
  {
    id: 'int-windows', title: 'Windows', icon: '🪟', hint: 'Operation, restrictors, flywire',
    fields: [
      { key: 'condition', label: 'Internal condition', type: 'chips', options: COND5 },
      { key: 'locksFitted', label: 'Generally locks are fitted?', type: 'yesno' },
      { key: 'flywireFitted', label: 'Flywire screens are fitted to', type: 'chips', options: ['Some windows', 'Most windows', 'All windows', 'None'] },
      { key: 'flywireCondition', label: 'Flywire condition', type: 'chips', options: COND5 },
    ],
    checkGroups: [{
      items: [
        'Windows are difficult to open and need servicing and maintenance',
        'At upper windows, restrictors need to be fitted to maximum opening of 125mm — safety concern',
        'Windows were locked and could not be opened to check operation',
      ],
    }],
  },
  {
    id: 'int-doors', title: 'Internal Doors', icon: '🚪', hint: 'Style, binding, furniture',
    fields: [
      { key: 'style', label: 'Internal doors are generally', type: 'chips', options: ['Panelled', 'Flush style', 'Several styles'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: ['Good', 'Satisfactory', 'Average', 'Poor', 'Varying'] },
    ],
    checkGroups: [{ items: ['Doors are binding and need maintenance', 'Door furniture is loose / not latching'] }],
    postCheckFields: [{ key: 'whereBinding', label: 'Where?', type: 'text' }],
  },
  {
    id: 'cabinets', title: 'Cabinets', icon: '🗄️', hint: 'Drawers, doors, water damage',
    fields: [{ key: 'condition', label: 'General condition', type: 'chips', options: [...COND5, 'Consistent with age'] }],
    checkGroups: [{
      items: [
        'Cabinet drawers are binding and need adjustment',
        'Cabinet / robe doors are binding and need adjustment',
        'Cabinet / robe doors do not close properly and need adjustment',
        'There is water damage / swelling to cabinet',
      ],
    }],
    postCheckFields: [{ key: 'whereDamage', label: 'Where?', type: 'text' }],
  },
  {
    id: 'plumbing', title: 'Plumbing', icon: '💧', hint: 'Taps, drains, water hammer, leaks',
    fields: [
      { key: 'waterSupplyOn', label: 'Water supply on?', type: 'yesno' },
      { key: 'allOperated', label: 'Did all taps, showers and toilets operate normally?', type: 'yesno' },
      { key: 'whichFailed', label: 'If no, which failed?', type: 'text' },
      { key: 'waterHammer', label: 'Any water hammer?', type: 'yesno' },
      { key: 'whichTaps', label: 'If yes, which taps?', type: 'text' },
      { key: 'allDrained', label: 'Did all sinks, vanities and showers drain normally?', type: 'yesno' },
      { key: 'whichDrainFailed', label: 'If no, which failed?', type: 'text' },
      { key: 'waterLeaks', label: 'Any water leaks to taps / waste pipes / showers?', type: 'yesno' },
      { key: 'leakWhere', label: 'If yes, where?', type: 'text' },
    ],
  },
  {
    id: 'gas', title: 'Gas', icon: '🔥', hint: 'Supply, leaks, appliances',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'supply', label: 'Gas supply is', type: 'chips', options: ['Mains', 'LPG (cylinders)'] },
      { key: 'supplyOn', label: 'Gas supply on?', type: 'yesno' },
      { key: 'detectableLeaks', label: 'Any detectable leaks?', type: 'yesno' },
      { key: 'leakLocation', label: 'If yes, specify appliance / location', type: 'text' },
      { key: 'appliancesOperate', label: 'Did appliances operate?', type: 'yesno' },
      { key: 'whichFailed', label: 'If no, which failed?', type: 'text' },
    ],
    checkGroups: [{ items: ['Consult a licensed gas fitter', 'Add to safety matters'] }],
  },
  {
    id: 'electrical', title: 'Electrical', icon: '⚡', hint: 'Power, RCDs, smoke alarms',
    fields: [
      { key: 'powerOn', label: 'Power supply on?', type: 'yesno' },
      { key: 'appliancesOperate', label: 'Did lights, fans, rangehood, cooktop, air con and heater operate?', type: 'yesno' },
      { key: 'whichFailed', label: 'If no, which ones failed?', type: 'text' },
      { key: 'rcdCount', label: 'The number of RCDs is', type: 'chips', options: ['Nil', '1', '2', '3', '4', '5', 'Other'] },
      { key: 'batteryAlarms', label: 'Battery smoke alarm/s installed?', type: 'yesno' },
      { key: 'batteryCount', label: 'Battery smoke alarm count', type: 'chips', options: ['1', '2', '3', 'Other'] },
      { key: 'hardwiredAlarms', label: 'Hardwired smoke alarm/s installed?', type: 'yesno' },
      { key: 'hardwiredCount', label: 'Hardwired smoke alarm count', type: 'chips', options: ['1', '2', '3', 'Other'] },
      { key: 'alarmsLocated', label: 'Are smoke alarm/s located within 1.5 metres of each sleeping area?', type: 'yesno' },
    ],
    checkGroups: [{ items: ['Nil RCDs installed — add to safety matters', 'Smoke alarms not correctly located — refer to Safety Matters'] }],
  },
  {
    id: 'fireplace', title: 'Fireplace / Heater Insert', icon: '🔥', hint: 'Type, operation, servicing',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'type', label: 'Type', type: 'chips', options: ['Gas heater inserted', 'Electric heater inserted'] },
      { key: 'count', label: 'Count', type: 'chips', options: ['1', '2', '3'] },
      { key: 'operating', label: 'Operating at time of inspection?', type: 'yesno' },
    ],
    checkGroups: [{ items: ['Requires normal maintenance', 'Recommend urgent servicing'] }],
  },
];

// ── STRUCTURAL, DEFECTS & SAFETY ────────────────────────────────────────────
const ASSESSMENT: SubArea[] = [
  {
    id: 'structural', title: 'Structural Defects', icon: '🏗️', hint: 'Overall structural soundness',
    fields: [
      { key: 'structurallySound', label: 'The property is considered structurally sound', type: 'yesno' },
      { key: 'describe', label: 'If unsound, confirm the defects as identified in the body of your report', type: 'textarea' },
    ],
  },
  {
    id: 'major-defects', title: 'Major Defects', icon: '⚠️', hint: 'Free of major defects, in relation to age',
    fields: [
      { key: 'freeOfMajorDefects', label: 'In relation to its age, is the property free of major defects?', type: 'yesno' },
      { key: 'describe', label: 'If major defects, confirm the issues as identified in the body of your report', type: 'textarea' },
      {
        key: 'definitionAck', label: 'Major defect = defect in a major structural element making the building uninhabitable or likely to collapse, preventing practical use, or posing a health/safety risk',
        type: 'yesno',
      },
    ],
  },
  {
    id: 'safety', title: 'Safety Matters', icon: '🚨', hint: 'Smoke alarms, asbestos, pool, stairs',
    fields: [{ key: 'safetyMattersEvident', label: 'Are there Safety Matters evident?', type: 'yesno' }],
    checkGroups: [{
      heading: 'Safety items',
      items: [
        'Smoke alarms must be installed per AS 3.7.2.3 in Class 1a buildings — on or near the ceiling in any storey containing bedrooms',
        'Where bedrooms are served by a hallway, an alarm is required in that hallway',
        'An alarm is required in any other storey not containing bedrooms',
        'Insulation is touching and covering recessed light fittings and transformers — fire hazard',
        'There is fibre cement sheeting that may contain asbestos (used in construction 1930s to mid-1980s)',
        'Refer to Pool concerns',
        'Refer to stairs concerns',
        'Refer to trip hazard concerns',
      ],
    }],
  },
  {
    id: 'notes', title: 'Notes & Client List', icon: '📝', hint: 'Free notes and the client issue list',
    fields: [
      { key: 'notes', label: 'Notes', type: 'textarea' },
      { key: 'clientList', label: 'Client list of issues', type: 'chips', options: ['Not applicable', 'Attached — responses provided next to each client item'] },
    ],
  },
];

function navSection(name: string, areas: SubArea[]) {
  return {
    name,
    fields: areas.flatMap(compile),
    layout: { mode: 'section-nav', groups: areas.map((a) => ({ letter: a.title, icon: a.icon, hint: a.hint })) },
  };
}

/** Short, flat sections that don't warrant a drill-down. */
function flatSection(name: string, fields: Field[]) {
  return { name, fields };
}

const YES = { fieldKey: 'present', equals: 'yes' };

const SECTIONS: Record<string, { name: string; fields: Field[]; layout?: object }> = {
  'job-info': flatSection('Job Information', [
    { key: 'jobNumber', type: 'text', label: 'Job No' },
    { key: 'inspectionDate', type: 'date', label: 'Inspection Date' },
    { key: 'assignedInspector', type: 'text', label: 'Inspector initials' },
    { key: 'clientName', type: 'text', label: 'Client name' },
    { key: 'inspectionAddress', type: 'text', label: 'Inspection Address' },
    { key: 'occupied', type: 'yesno', label: 'Occupied?' },
    {
      key: 'weather', type: 'select-tiles', label: 'Weather',
      options: [
        { value: 'dry', label: 'Dry', icon: 'thermometer-outline' },
        { value: 'sunny', label: 'Sunny', icon: 'sunny-outline' },
        { value: 'overcast', label: 'Overcast', icon: 'cloudy-outline' },
        { value: 'intermittent_showers', label: 'Intermittent showers', icon: 'partly-sunny-outline' },
        { value: 'rain', label: 'Rain', icon: 'rainy-outline' },
      ],
    },
  ]),

  description: flatSection('Description & Overview', [
    { key: 'streetViews', type: 'photos', label: 'Street views', sectionLetter: 'Property & Site Overview' },
    { key: 'streetFrontage', type: 'pill-select', label: 'Street frontage', options: opts('North', 'South', 'East', 'West', 'Other'), sectionLetter: 'Property & Site Overview' },

    { key: 'residentialType', type: 'pill-select', label: 'Residential', options: opts('Not applicable', 'Residential house', 'Duplex', 'Townhouse', 'Apartment in a multi-level complex — stop and use the Apartment template'), sectionLetter: 'Property Description' },
    { key: 'commercialType', type: 'pill-select', label: 'Commercial', options: opts('Not applicable', 'Retail shop', 'Offices', 'Warehouse', 'Factory', 'Other'), sectionLetter: 'Property Description' },
    { key: 'design', type: 'pill-select', label: 'Design', options: opts('Single storey', 'Double storey', 'Triple storey', 'Split level', 'With mezzanine floor'), sectionLetter: 'Property Description' },
    { key: 'builtAround', type: 'text', label: 'Built around — year or decade', sectionLetter: 'Property Description' },
    { key: 'additions', type: 'yesno', label: 'Additions / extensions?', sectionLetter: 'Property Description' },
    { key: 'additionsBuilt', type: 'text', label: 'Additions built — year or decade', gate: { fieldKey: 'additions', equals: 'yes' }, sectionLetter: 'Property Description' },
    { key: 'additionsAt', type: 'pill-select', label: 'Additions at', options: opts('Rear', 'Side', 'First floor', 'Other'), gate: { fieldKey: 'additions', equals: 'yes' }, sectionLetter: 'Property Description' },
    { key: 'blockSlope', type: 'pill-select', label: 'The block is', options: opts('Steep sloping', 'Gently sloping', 'Mostly flat'), sectionLetter: 'Property Description' },

    { key: 'agentOnSite', type: 'yesno', label: 'Agent on site?', sectionLetter: 'Attendance & Safety' },
    { key: 'clientOnSite', type: 'yesno', label: 'Client on site?', sectionLetter: 'Attendance & Safety' },
    { key: 'safetyIssues', type: 'yesno', label: 'Safety issues?', sectionLetter: 'Attendance & Safety' },
    { key: 'safetyIssuesDescribe', type: 'textarea', label: 'Describe safety issues', gate: { fieldKey: 'safetyIssues', equals: 'yes' }, sectionLetter: 'Attendance & Safety' },
    { key: 'clientListOfIssues', type: 'pill-select', label: 'Client list of issues', options: opts('Yes — answer every item', 'Not applicable'), sectionLetter: 'Attendance & Safety' },
  ]),

  roof_chimneys: navSection('Roof', ROOF),
  elevations: navSection('External — Building', EXTERNAL),
  garage_carport_sheds: navSection('Outbuildings', OUTBUILDINGS),

  driveway: flatSection('Driveway', [
    { key: 'present', type: 'yesno', label: 'Is there a driveway?' },
    { key: 'construction', type: 'text', label: 'Driveway constructed of', gate: YES },
    { key: 'condition', type: 'pill-select', label: 'Condition', options: opts('Good', 'Satisfactory', 'Average', 'Poor', 'Varying'), gate: YES },
    { key: 'checks', type: 'chip-multiselect', label: 'Observations', options: opts('Minor cracking', 'Typical wear and tear', 'Major cracking or subsidence that may cause a tripping hazard', 'Add to Safety matters'), gate: YES },
    { key: 'photos', type: 'photos', label: 'Photo Nos' },
    { key: 'comments', type: 'textarea', label: 'Comments' },
  ]),

  paving_paths: flatSection('External Paving', [
    { key: 'present', type: 'yesno', label: 'Is there external paving?' },
    { key: 'construction', type: 'text', label: 'Paving constructed of', gate: YES },
    { key: 'condition', type: 'pill-select', label: 'Condition', options: opts('Good', 'Satisfactory', 'Average', 'Poor', 'Varying'), gate: YES },
    { key: 'checks', type: 'chip-multiselect', label: 'Observations', options: opts('Minor cracking', 'Typical wear and tear', 'Significant cracking or subsidence that may cause a tripping hazard', 'Add to Safety matters', 'Excessive settlement requiring lifting, leveling and re-laying'), gate: YES },
    { key: 'settlementWhere', type: 'text', label: 'If settlement, where?', gate: YES },
    { key: 'photos', type: 'photos', label: 'Photo Nos' },
    { key: 'comments', type: 'textarea', label: 'Comments' },
  ]),

  fences: flatSection('Fences', [
    { key: 'present', type: 'yesno', label: 'Are there fences?' },
    { key: 'construction', type: 'chip-multiselect', label: 'Constructed of', options: opts('Brick', 'Pickets', 'Timber palings', 'Colourbond sheets', 'Combo of', 'Other'), gate: YES },
    { key: 'condition', type: 'pill-select', label: 'Condition', options: opts('Good', 'Satisfactory', 'Average', 'Poor', 'Varying'), gate: YES },
    { key: 'requires', type: 'pill-select', label: 'Require', options: opts('Repairs', 'Normal maintenance', 'No attention'), gate: YES },
    {
      key: 'checks', type: 'chip-multiselect', label: 'Observations & defects', gate: YES,
      options: opts('Timbers are loose requiring attention', 'Timbers are broken / decayed requiring replacement', 'Broken panels', 'Fencing is leaning', 'Fence leaning due to a build-up of soil on one side', 'Brickwork fences cracking', 'Unstable and may be structurally unsound'),
    },
    { key: 'photos', type: 'photos', label: 'Photo Nos' },
    { key: 'comments', type: 'textarea', label: 'Comments' },
  ]),

  retaining_walls: flatSection('Retaining Walls & Trees', [
    { key: 'rwPresent', type: 'yesno', label: 'Are there retaining walls?', sectionLetter: 'Retaining Walls' },
    { key: 'rwLocation', type: 'text', label: 'There are retaining walls at', gate: { fieldKey: 'rwPresent', equals: 'yes' }, sectionLetter: 'Retaining Walls' },
    { key: 'rwConstruction', type: 'text', label: 'Constructed of', gate: { fieldKey: 'rwPresent', equals: 'yes' }, sectionLetter: 'Retaining Walls' },
    { key: 'rwMajorCracking', type: 'yesno', label: 'There are signs of major cracking?', gate: { fieldKey: 'rwPresent', equals: 'yes' }, sectionLetter: 'Retaining Walls' },
    {
      key: 'rwChecks', type: 'chip-multiselect', label: 'Observations & defects', gate: { fieldKey: 'rwPresent', equals: 'yes' }, sectionLetter: 'Retaining Walls',
      options: opts('Minor cracking not of a structural nature', 'Wall/s not coping with the loads', 'Cracking requires attention', 'Cracking needs to be investigated by a structural engineer', 'Wood decay'),
    },
    { key: 'rwPhotos', type: 'photos', label: 'Photo Nos', sectionLetter: 'Retaining Walls' },
    { key: 'rwComments', type: 'textarea', label: 'Comments', sectionLetter: 'Retaining Walls' },

    { key: 'treesPresent', type: 'yesno', label: 'Are there trees and/or vegetation?', sectionLetter: 'Trees' },
    { key: 'treesAffectFoundations', type: 'yesno', label: 'Do they currently affect the foundations?', gate: { fieldKey: 'treesPresent', equals: 'yes' }, sectionLetter: 'Trees' },
    { key: 'treesDescribe', type: 'textarea', label: 'If yes, describe location and concerns', gate: { fieldKey: 'treesPresent', equals: 'yes' }, sectionLetter: 'Trees' },
    {
      key: 'treesChecks', type: 'chip-multiselect', label: 'Observations', gate: { fieldKey: 'treesPresent', equals: 'yes' }, sectionLetter: 'Trees',
      options: opts('Trees / shrubs close to the main structure may affect foundations in future — suggest cut back or removed', 'Trees / shrubs overhanging the roof or in contact with the main structure — suggest cut back or removal'),
    },
    { key: 'treesPhotos', type: 'photos', label: 'Photo Nos', sectionLetter: 'Trees' },
    { key: 'treesComments', type: 'textarea', label: 'Comments', sectionLetter: 'Trees' },
  ]),

  pool_spa: flatSection('Pool / Spa', [
    { key: 'present', type: 'yesno', label: 'Is there a pool or spa?' },
    { key: 'type', type: 'chip-multiselect', label: 'There is a', options: opts('Pool', 'Spa'), gate: YES },
    { key: 'construction', type: 'pill-select', label: 'Constructed of', options: opts('Concrete', 'Fiberglass', 'Vinyl'), gate: YES },
    { key: 'position', type: 'pill-select', label: 'It is', options: opts('Above ground', 'In ground', 'Recessed into timber deck'), gate: YES },
    { key: 'subsidence', type: 'yesno', label: 'There are signs of subsidence?', gate: YES },
    { key: 'fencingAdequate', type: 'yesno', label: 'The pool / spa fencing appears to be adequate?', gate: YES },
    {
      key: 'checks', type: 'chip-multiselect', label: 'Pool safety concerns', gate: YES,
      options: opts('The pool is not adequately fenced from the house', 'The pool fence height is compromised in places', 'The house windows / doors are not self-latching and do not appear to meet pool regulations', 'Windows open more than 100mm requiring a permanent restriction', 'Pool gate/s are not self-latching and do not appear to meet pool regulations'),
    },
    { key: 'areasOfConcern', type: 'text', label: 'The areas of concern are', gate: YES },
    { key: 'photos', type: 'photos', label: 'Photo Nos' },
    { key: 'comments', type: 'textarea', label: 'Comments' },
  ]),

  internal_areas: navSection('Internal', INTERNAL),
  notes: navSection('Structural, Defects & Safety', ASSESSMENT),
};

async function main() {
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
        layout: (def.layout ?? null) as unknown as object,
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
    console.log(`[pre-purchase house] ${sectionKey} -> v${draft.version} (${def.fields.length} fields${def.layout ? ', section-nav' : ''})`);
  }

  await prisma.$disconnect();
}

void main();
