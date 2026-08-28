// Rebuilds the Dilapidation × Apartment section templates from the apartment
// inspection content set (job info, building description, scope, external,
// roof, internal unit, common areas, structural & safety).
//
// Shape, not just content: an apartment section carries 5-13 sub-areas, so
// each sub-area becomes a `sectionLetter` group and the section is published
// with `layout.mode = 'section-nav'`. The mobile renderer turns that into a
// tap-through list of sub-areas -- icon, title, hint, completion tick -- each
// opening in its own full-screen form, rather than one endless scroll.
// Colours/typography are NOT specified here on purpose: the field renderers
// already draw from the app theme, so these sections match every other
// section automatically.
//
// Sub-areas that can be skipped ask "Applicable / accessible?" first and gate
// their fields on `yes`, with the reason captured on `no` -- the field gate
// supports equality only, so a positive question is what makes "hide when not
// applicable" expressible.
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'apartment';

type Field = Omit<TemplateField, 'order'>;
type FType = 'chips' | 'yesno' | 'text';
interface SubField { key: string; label: string; type: FType; options?: string[] }
interface CheckGroup { heading?: string; items: string[] }
interface SubArea {
  id: string; title: string; icon: string; hint: string;
  naOptions?: string[];
  fields?: SubField[];
  checkGroups?: CheckGroup[];
  postCheckFields?: SubField[];
  /** Extra free-text prompt shown after the fields (e.g. "describe the defect"). */
  describe?: { label: string; gate?: TemplateField['gate'] };
}

/** Label-derived option values so flattened report text reads as words, not "item3". */
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

function numbered(fields: Field[]): TemplateField[] {
  return fields.map((f, i) => ({
    ...f,
    order: i,
    itemFields: f.itemFields ? numbered(f.itemFields as Field[]) : undefined,
  }));
}

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
    type: f.type === 'chips' ? 'pill-select' : f.type === 'yesno' ? 'yesno' : 'text',
    options: f.type === 'chips' ? mkOpts(f.options ?? []) : undefined,
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

  if (area.describe) {
    out.push({ key: `${p}describe`, type: 'textarea', label: area.describe.label, gate: area.describe.gate ?? gate, sectionLetter: L });
  }

  // Comments and pics stay ungated -- an inspector still needs to say why
  // something was not applicable, and photograph the fact.
  out.push({ key: `${p}comments`, type: 'textarea', label: 'Comments', sectionLetter: L });
  out.push({ key: `${p}photos`, type: 'photos', label: 'Pics', sectionLetter: L });
  return out;
}

const COND = ['Good', 'Satisfactory', 'Fair', 'Average', 'Poor'];
const COND_V = [...COND, 'Varying'];

// ── EXTERNAL ────────────────────────────────────────────────────────────────
const EXTERNAL: SubArea[] = [
  {
    id: 'elev-overview', title: 'Elevation Overview', icon: '🧭', hint: 'Faces inspected, party wall, access limits',
    fields: [
      { key: 'elevations', label: 'Elevations inspected', type: 'chips', options: ['Front', 'Left', 'Rear', 'Right', 'All accessible faces'] },
      { key: 'partyWall', label: 'Party wall / limited access', type: 'yesno' },
      { key: 'claddingCond', label: 'Cladding condition', type: 'chips', options: ['Satisfactory', 'Fair', 'Average', 'Poor', 'Damage recorded'] },
      { key: 'openings', label: 'Windows & doors', type: 'chips', options: ['Satisfactory', 'Fair', 'Deterioration noted', 'Damage recorded'] },
      { key: 'guttersCond', label: 'Gutters & downpipes', type: 'chips', options: ['Satisfactory', 'Rusting', 'Sagging / loose', 'Disconnected', 'Damage recorded'] },
    ],
  },
  {
    id: 'ext-walls', title: 'External Walls', icon: '🧱', hint: 'Material, condition, cracking, weathering',
    fields: [
      { key: 'material', label: 'External walls constructed of', type: 'text' },
      { key: 'rendered', label: 'Rendered', type: 'yesno' },
      { key: 'condition', label: 'Condition (in relation to age)', type: 'chips', options: ['Satisfactory', 'Fair', 'Average', 'Poor', 'Average to poor'] },
      { key: 'majorCracking', label: 'Signs of major cracking', type: 'yesno' },
      { key: 'sigWeathering', label: 'Signs of significant weathering', type: 'yesno' },
      { key: 'generallyStable', label: 'Walls generally stable', type: 'yesno' },
    ],
    checkGroups: [
      {
        heading: 'Cracking assessment',
        items: [
          'Minor cracking visible consistent with age – not structural',
          'Cracking over window/door heads – typical, not structural unless bricks loose',
          'Major cracking requiring repairs – not yet structural but attend soon',
          'Immediate repairs required – consider consulting structural engineer',
        ],
      },
      {
        heading: 'Defect items',
        items: [
          'Loose bricks',
          'Drummy render',
          'Fretting mortar requires repointing',
          'Evidence of rising damp',
          'Patching and re-pointing where appliances/fittings removed',
          'Mortar out of joints at lower courses – needs repointing',
          'Spalling to some bricks',
          'Weep holes not visible',
          'Weep holes covered or partly covered – keep clear',
          'Sub-floor vents covered or partly covered – keep clear',
        ],
      },
    ],
  },
  {
    id: 'cladding', title: 'Cladding', icon: '🪟', hint: 'Material, condition, weathering, asbestos',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'material', label: 'Cladding constructed of', type: 'text' },
      { key: 'rendered', label: 'Rendered', type: 'yesno' },
      { key: 'condition', label: 'Condition (in relation to age)', type: 'chips', options: ['Satisfactory', 'Fair', 'Average', 'Poor', 'Average to poor'] },
      { key: 'sigCracking', label: 'Signs of significant cracking', type: 'yesno' },
      { key: 'sigWeathering', label: 'Signs of significant weathering', type: 'yesno' },
      { key: 'requires', label: 'Cladding requires', type: 'chips', options: ['No repairs', 'Normal maintenance', 'Completion of render', 'Re-painting'] },
    ],
    checkGroups: [{
      items: [
        'Some weathering visible – requires maintenance or replacement',
        'Breakage visible to cement sheet wall cladding',
        'Cladding may contain asbestos',
      ],
    }],
  },
  {
    id: 'subfloor', title: 'Sub-Floor', icon: '🏗️', hint: 'Concrete slab / not assessable for apartments',
    naOptions: ['Not applicable – constructed on concrete slab', 'Apartment complex – not assessable'],
  },
  {
    id: 'garage', title: 'Garage / Car Space', icon: '🚗', hint: 'Basement garage, car bay, storage cage',
    fields: [
      { key: 'type', label: 'Car space type', type: 'chips', options: ['Garage in basement', 'Car bay in basement', 'No car space allocated to this apartment'] },
      { key: 'condition', label: 'General condition', type: 'chips', options: COND },
      { key: 'reqAttention', label: 'Requires attention', type: 'yesno' },
    ],
    checkGroups: [{
      items: [
        'Cracking to walls',
        'Repairs required',
        'Damp visible to external walls',
        'Minor cracking to hardstand – monitor from time to time',
        'Storage cage in basement',
      ],
    }],
  },
  {
    id: 'windows-ext', title: 'Windows / Window Frames', icon: '🪟', hint: 'Material, condition, glazing, screens',
    fields: [
      { key: 'material', label: 'Windows and frames constructed of', type: 'chips', options: ['Timber', 'Aluminium', 'Anodized', 'Timber and aluminium', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: ['Varying', 'Satisfactory', 'Fair', 'Average', 'Poor'] },
      { key: 'requires', label: 'Require', type: 'chips', options: ['Normal maintenance', 'Repairs', 'No attention'] },
      { key: 'glazingBeads', label: 'Glazing beads appear', type: 'chips', options: ['Sound', 'Serviceable', 'Poor'] },
      { key: 'securityScreens', label: 'Security screens installed', type: 'yesno' },
      { key: 'rollerShutters', label: 'Roller shutters installed', type: 'yesno' },
    ],
    checkGroups: [{
      items: [
        'Aluminium frame edge has come away from rubber seal and glazing',
        'Broken glazed pane',
        'Water ingress to glazing frame – replace putty and seal',
        'Weathering surface damage to timber frames – requires painting',
        'Some wood decay needs repair',
        'Non-timber windows: confirm glazing beads to be replaced by Neoprene glazing rubber',
      ],
    }],
  },
  {
    id: 'front-door', title: 'Front Door & Frame', icon: '🚪', hint: 'Material, condition, security, deadlocks',
    fields: [
      { key: 'material', label: 'Constructed of', type: 'chips', options: ['Timber', 'Aluminium', 'Pressed metal', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: COND },
      { key: 'requires', label: 'Require', type: 'chips', options: ['No repairs', 'Normal maintenance', 'Re-painting'] },
      { key: 'secScreen', label: 'Front door security screen', type: 'yesno' },
      { key: 'deadlocks', label: 'Deadlocks fitted', type: 'yesno' },
      { key: 'doorCloser', label: 'Door closer working', type: 'chips', options: ['Not applicable', 'Yes', 'No'] },
    ],
  },
  {
    id: 'other-doors-ext', title: 'Other External Doors', icon: '🚪', hint: 'Style, condition, delaminating, binding',
    fields: [
      { key: 'style', label: 'Doors are', type: 'chips', options: ['Solid-core', 'Hollow-core', 'Glazed', 'Paneled', 'Aluminium sliding', 'Variety of styles'] },
      { key: 'condition', label: 'Condition generally', type: 'chips', options: ['Varying', 'Satisfactory', 'Fair', 'Average', 'Poor'] },
      { key: 'requires', label: 'Generally require', type: 'chips', options: ['No repairs', 'Normal maintenance', 'Re-painting'] },
    ],
    checkGroups: [{
      items: [
        'Doors are delaminating',
        'Doors are binding – require 2mm clearance',
        'Edges of door require sealing to avoid water damage',
        'Door latch not engaging',
      ],
    }],
  },
  {
    id: 'balconies', title: 'Balconies', icon: '🏙️', hint: 'Material, condition, handrails, compliance',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'material', label: 'Balconies constructed of', type: 'chips', options: ['Steel', 'Timber', 'Concrete', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: ['Varying', 'Satisfactory', 'Fair', 'Average', 'Poor'] },
      { key: 'adequatelyFixed', label: 'Appear adequately fixed to building', type: 'yesno' },
      { key: 'handRails', label: 'Hand rails', type: 'chips', options: ['Not required', 'Adequate – Yes', 'Adequate – No'] },
      { key: 'handRailCond', label: 'Condition of hand rails', type: 'chips', options: COND },
    ],
    checkGroups: [{
      heading: 'Handrail / balustrade defects',
      items: [
        'There is decay to hand rails',
        'Hand rails do not comply with current Australian Standards',
        'Balustrade is loose and requires maintenance',
        'Handrail/balustrade height is less than 1000mm – non-compliant',
        'Balustrade spacing between railings more than 125mm – non-compliant',
        'Water appears to pond on balcony floor – floor falls not channelling to drain',
        'Balcony floor drainage may be blocked – recommend cleaning as maintenance',
      ],
    }],
  },
];

// ── ROOF ────────────────────────────────────────────────────────────────────
const ROOF: SubArea[] = [
  {
    id: 'roof-covering', title: 'Roof Covering', icon: '🏠', hint: 'Apartment complex – typically not applicable',
    naOptions: ['Apartment complex – Not applicable'],
    checkGroups: [{ items: ['Visible damage to roof covering', 'Refer to strata/body corporate for roof maintenance'] }],
  },
  {
    id: 'eaves', title: 'Eaves / Soffits', icon: '🏗️', hint: 'Material, condition, damage',
    naOptions: ['Apartment complex – Not applicable', 'There are no eaves nor soffits'],
    fields: [
      { key: 'material', label: 'Constructed of', type: 'chips', options: ['Plasterboard', 'Fibrous cement', 'Timber', 'Aluminium', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: COND_V },
    ],
  },
  {
    id: 'fascia', title: 'Fascia', icon: '🪵', hint: 'Material, condition, maintenance needed',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'material', label: 'Constructed of', type: 'chips', options: ['Timber', 'Colorbond steel', 'Timber and rolled sheet metal', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: COND },
    ],
    checkGroups: [{ items: ['Need normal maintenance', 'Decayed and need repair'] }],
  },
  {
    id: 'gutters', title: 'Gutters', icon: '💧', hint: 'Material, condition, overflow evidence',
    naOptions: ['Apartment complex – Not visible'],
    fields: [
      { key: 'gutterType', label: 'Gutter type', type: 'chips', options: ['Perimeter gutters', 'Boxed gutters', 'Both'] },
      { key: 'material', label: 'Constructed of', type: 'chips', options: ['Colorbond', 'Zincalume', 'PVC', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: COND },
    ],
    checkGroups: [{
      items: [
        'Need normal maintenance',
        'Require repair',
        'Require replacement',
        'Require partial replacement',
        'Evidence of overflowing gutters – engage a licensed plumber',
      ],
    }],
  },
  {
    id: 'downpipes', title: 'Downpipes', icon: '🔩', hint: 'Material, condition, leaks',
    naOptions: ['Apartment complex – Not visible'],
    fields: [
      { key: 'material', label: 'Fabricated of', type: 'chips', options: ['PVC', 'Colorbond', 'Zincalume', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: COND_V },
    ],
    checkGroups: [{
      items: [
        'Require maintenance to the joints',
        'Require normal maintenance',
        'No attention required',
        'The downpipes are leaking – engage a licensed plumber',
      ],
    }],
  },
];

// ── INTERNAL — UNIT AREAS ───────────────────────────────────────────────────
const INTERNAL: SubArea[] = [
  {
    id: 'int-roof', title: 'Roof Covering (Internal)', icon: '🏠', hint: 'Roof cavity access',
    naOptions: ['Apartment complex – Not applicable', 'Roof cavity not accessible – no manhole', 'No safe access to manhole'],
  },
  {
    id: 'party-walls', title: 'Party Walls', icon: '🧱', hint: 'Fire barrier, roof timbers',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'location', label: 'Party wall/s location', type: 'text' },
      { key: 'extendsToRoof', label: 'Party wall extends to underside of roof cover', type: 'yesno' },
      { key: 'fireBarrier', label: 'Appropriately constructed as fire barrier', type: 'yesno' },
    ],
    checkGroups: [{ items: ['Roof timbers passing through party wall – brickwork does not go to underside of roof covering'] }],
  },
  {
    id: 'ceilings', title: 'Ceilings', icon: '⬆️', hint: 'Material, cornices, condition, defects',
    fields: [
      { key: 'material', label: 'Ceiling material', type: 'chips', options: ['Plasterboard', 'Lathe and plaster', 'Exposed concrete', 'Other'] },
      { key: 'cornices', label: 'Cornices are', type: 'chips', options: ['Cove', 'Ornate', 'Traditional', 'Varying', 'Timber moulding', 'Shadowline', 'Square set'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: ['Good', 'Satisfactory', 'Average', 'Poor', 'Varying'] },
      { key: 'adequatelyFixed', label: 'Adequately fixed', type: 'yesno' },
    ],
    checkGroups: [{
      items: [
        'Ceiling not adequately attached to ceiling frame – has deflected significantly',
        'Minor imperfections / hairline cracks consistent with age – not a significant defect',
        'Flaking / mould / mildew to paintwork from excessive moisture in wet areas – install mechanical ventilation',
        'Minor paint flaking',
        'Watermarks and staining visible due to a water leak',
      ],
    }],
  },
  {
    id: 'int-walls', title: 'Internal Walls', icon: '🧱', hint: 'Material, condition, cracking, damp',
    fields: [
      { key: 'material', label: 'Constructed of', type: 'chips', options: ['Plasterboard', 'Lathe and plaster', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: ['Good', 'Satisfactory', 'Average', 'Poor', 'Varying'] },
    ],
    checkGroups: [{
      items: [
        'There is no major cracking nor other signs of significant movement',
        'Minor cracking over doorways and/or windows consistent with age – not a structural concern',
        'Minor cracking consistent with age, due to normal settlement/movement',
        'There is major cracking requiring attention',
        'Structural cracks requiring investigation by a structural engineer',
        'Drummy / loose / flaking plaster',
        'Damp from shower/bath in adjacent room to the base of the wall',
      ],
    }],
  },
  {
    id: 'floors', title: 'Floors', icon: '⬇️', hint: 'Material, floor coverings, cracking, bouncy',
    fields: [
      { key: 'material', label: 'Generally constructed of', type: 'chips', options: ['Concrete', 'Polished concrete', 'Timber', 'Other'] },
      { key: 'coverings', label: 'Floor coverings', type: 'chips', options: ['Floating timber', 'Tiles', 'Laminate flooring', 'Vinyl', 'Carpet', 'Other'] },
    ],
    checkGroups: [{
      items: [
        'The tiled areas do not require attention',
        'No significant cracks were seen',
        'Floor tiling drummy',
        'Concrete floor has minor cracking caused by rate of drying – not of a structural nature',
        'Timber floors are creaking / bouncy and require refixing',
        'Floors unlevel',
      ],
    }],
  },
  {
    id: 'int-stairs', title: 'Internal Stairs', icon: '🪜', hint: 'Material, condition, handrails, compliance',
    naOptions: ['Property is single level – no internal stairs'],
    fields: [
      { key: 'material', label: 'Constructed of', type: 'chips', options: ['Steel', 'Concrete', 'Timber', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: COND },
      { key: 'handrails', label: 'Hand rails', type: 'chips', options: ['Not required', 'Adequate – Yes', 'Adequate – No'] },
    ],
    checkGroups: [{
      heading: 'Compliance & safety',
      items: [
        'Handrail/balustrade height is less than 1000mm – does not comply with Aust Standards',
        'Balustrade spacing between railings is more than 125mm – does not comply with Aust Standards',
        'Balustrade has horizontal rails that may be climbable by a child – add to Safety Matters',
        'Stair treads / risers are not equal – do not comply with current Aust Standards',
        'Stair risers are higher than the maximum 190mm – do not comply with current Aust Standards',
        'Stair treads are less than the minimum 240mm – do not comply with current Aust Standards',
      ],
    }],
  },
  {
    id: 'int-windows', title: 'Windows (Internal)', icon: '🪟', hint: 'Operation, restrictors, flywire',
    fields: [{ key: 'condition', label: 'Internal condition', type: 'chips', options: COND }],
    checkGroups: [{
      items: [
        'Windows are difficult to open and need servicing and maintenance',
        'At upper windows, restrictors need to be fitted to maximum opening of 125mm – safety concern',
        'Windows were locked and could not be opened to check operation',
      ],
    }],
    postCheckFields: [
      { key: 'locksGeneral', label: 'Locks are generally fitted', type: 'yesno' },
      { key: 'flywire', label: 'Flywire screens fitted to', type: 'chips', options: ['Some windows', 'Most windows', 'All windows', 'None'] },
      { key: 'flywireCondition', label: 'Flywire condition', type: 'chips', options: COND },
    ],
  },
  {
    id: 'int-doors', title: 'Internal Doors', icon: '🚪', hint: 'Style, condition, binding, furniture',
    fields: [
      { key: 'style', label: 'Generally', type: 'chips', options: ['Panelled', 'Flush style', 'Several styles'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: ['Good', 'Satisfactory', 'Average', 'Poor', 'Varying'] },
    ],
    checkGroups: [{ items: ['Doors binding and need maintenance', 'Door furniture is loose / not latching'] }],
  },
  {
    id: 'cabinets', title: 'Cabinets', icon: '🗄️', hint: 'Drawers, doors, water damage',
    fields: [{ key: 'condition', label: 'General condition', type: 'chips', options: [...COND, 'Consistent with age'] }],
    checkGroups: [{
      items: [
        'Cabinet drawers are binding and need adjustment',
        'Cabinet / robe doors are binding and need adjustment',
        'Cabinet / robe doors do not close properly – need adjustment',
        'Water damage / swelling to cabinet',
      ],
    }],
  },
  {
    id: 'plumbing', title: 'Plumbing', icon: '💧', hint: 'Taps, drains, leaks',
    fields: [
      { key: 'waterSupplyOn', label: 'Water supply on', type: 'yesno' },
      { key: 'tapsNormal', label: 'All taps, showers, toilets operated normally', type: 'yesno' },
      { key: 'waterHammer', label: 'Water hammer present', type: 'yesno' },
      { key: 'drainsNormal', label: 'All sinks, vanities and showers drained normally', type: 'yesno' },
      { key: 'waterLeaks', label: 'Water leaks to taps / waste pipes / showers', type: 'yesno' },
    ],
  },
  {
    id: 'gas', title: 'Gas', icon: '🔥', hint: 'Supply type, leaks, appliances',
    naOptions: ['Not applicable – no gas supply'],
    fields: [
      { key: 'supplyType', label: 'Gas supply', type: 'chips', options: ['Mains', 'LPG (cylinders)'] },
      { key: 'gasSupplyOn', label: 'Gas supply on', type: 'yesno' },
      { key: 'detectedLeaks', label: 'Detectable leaks', type: 'yesno' },
      { key: 'appliancesOperated', label: 'Appliances operated correctly', type: 'yesno' },
    ],
    checkGroups: [{ items: ['Consult a licensed gas fitter', 'Add to Safety Matters'] }],
  },
  {
    id: 'electrical', title: 'Electrical', icon: '⚡', hint: 'Power, RCDs, smoke alarms',
    fields: [
      { key: 'powerOn', label: 'Power supply on', type: 'yesno' },
      { key: 'appliancesOperated', label: 'Lights, fans, appliances operated correctly', type: 'yesno' },
      { key: 'rcdCount', label: 'Number of RCDs', type: 'chips', options: ['Nil', '1', '2', '3', '4', '5', 'Other'] },
      { key: 'batteryAlarms', label: 'Battery smoke alarms installed', type: 'yesno' },
      { key: 'batteryAlarmsCount', label: 'Battery smoke alarm count', type: 'chips', options: ['1', '2', '3', 'Other'] },
      { key: 'hardwiredAlarms', label: 'Hardwired smoke alarms installed', type: 'yesno' },
      { key: 'hardwiredCount', label: 'Hardwired smoke alarm count', type: 'chips', options: ['1', '2', '3', 'Other'] },
      { key: 'alarmsLocated', label: 'Smoke alarms within 1.5m of each sleeping area', type: 'yesno' },
    ],
    checkGroups: [{ items: ['Nil RCDs installed – add to Safety Matters', 'Smoke alarms not correctly located – refer to Safety Matters'] }],
  },
  {
    id: 'fireplace', title: 'Fireplace / Heater Insert', icon: '🔥', hint: 'Type, operation, servicing',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'type', label: 'Type', type: 'chips', options: ['Gas heater inserted', 'Electric heater inserted'] },
      { key: 'count', label: 'Count', type: 'chips', options: ['1', '2', '3'] },
      { key: 'operating', label: 'Operating at time of inspection', type: 'yesno' },
    ],
    checkGroups: [{ items: ['Requires normal maintenance', 'Recommend urgent servicing'] }],
  },
];

// ── COMMON AREAS ────────────────────────────────────────────────────────────
const WEAR = { items: ['Typical wear and tear'] };
const COMMON: SubArea[] = [
  {
    id: 'foyer', title: 'Foyer / Reception', icon: '🏢', hint: 'Condition, typical wear',
    naOptions: ['Not applicable'],
    fields: [{ key: 'condition', label: 'Condition', type: 'chips', options: ['Good', 'Satisfactory', 'Average', 'Poor', 'Varying'] }],
    checkGroups: [WEAR],
  },
  {
    id: 'lifts', title: 'Letterboxes / Lift Areas', icon: '🛗', hint: 'Condition, typical wear',
    naOptions: ['Not applicable'],
    fields: [{ key: 'condition', label: 'Condition', type: 'chips', options: ['Good', 'Satisfactory', 'Average', 'Poor', 'Varying'] }],
    checkGroups: [WEAR],
  },
  {
    id: 'driveway-common', title: 'Driveway', icon: '🚗', hint: 'Material, condition, cracking, trip hazard',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'material', label: 'Constructed of', type: 'chips', options: ['Concrete', 'Asphalt', 'Other'] },
      { key: 'condition', label: 'Condition', type: 'chips', options: ['Good', 'Satisfactory', 'Average', 'Poor', 'Varying'] },
    ],
    checkGroups: [{
      items: ['Minor cracking', 'Typical wear and tear', 'Major cracking or subsidence – may cause tripping hazard', 'Add to Safety Matters'],
    }],
  },
  {
    id: 'ext-paving', title: 'External Paving', icon: '🛤️', hint: 'Material, condition, cracking, trip hazard',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'material', label: 'Constructed of', type: 'text' },
      { key: 'condition', label: 'Condition', type: 'chips', options: ['Good', 'Satisfactory', 'Average', 'Poor', 'Varying'] },
    ],
    checkGroups: [{
      items: ['Minor cracking', 'Typical wear and tear', 'Significant cracking or subsidence – may cause tripping hazard', 'Add to Safety Matters'],
    }],
  },
  {
    id: 'pool', title: 'Pool / Spa', icon: '🏊', hint: 'Fencing, gate compliance',
    naOptions: ['Not applicable'],
    fields: [
      { key: 'type', label: 'There is a', type: 'chips', options: ['Pool', 'Spa', 'Pool and Spa'] },
      { key: 'material', label: 'Constructed of', type: 'chips', options: ['Concrete', 'Fiberglass', 'Vinyl', 'Other'] },
      { key: 'fencingAdequate', label: 'Pool/spa fencing appears adequate', type: 'yesno' },
    ],
    checkGroups: [{
      items: [
        'Pool safety barrier is compromised',
        'Pool gates are not self-latching – do not meet pool regulations',
        'Pool gate does not swing in the correct direction',
        'Latch height of pool gate is too low',
      ],
    }],
  },
  { id: 'meeting-room', title: 'Meeting Rooms / Wine Room', icon: '🍷', hint: 'General condition', naOptions: ['Not applicable'] },
  { id: 'gym', title: 'Gymnasium', icon: '🏋️', hint: 'General condition', naOptions: ['Not applicable'] },
  { id: 'roof-terrace', title: 'Roof Terrace / BBQ', icon: '🌤️', hint: 'General condition', naOptions: ['Not applicable'] },
  { id: 'fences-common', title: 'Fences', icon: '🪵', hint: 'Condition, comments', naOptions: ['Not applicable'] },
];

// ── STRUCTURAL & SAFETY ─────────────────────────────────────────────────────
const STRUCTURAL: SubArea[] = [
  {
    id: 'structural', title: 'Structural Defects', icon: '🏗️', hint: 'Overall structural soundness',
    fields: [{ key: 'structurallySound', label: 'The unit is considered structurally sound', type: 'yesno' }],
    describe: { label: 'Describe the structural defects identified', gate: { fieldKey: 'structural_structurallySound', equals: 'no' } },
  },
  {
    id: 'major-defects', title: 'Major Defects', icon: '⚠️', hint: 'Free of major defects',
    fields: [{
      key: 'freeOfMajorDefects',
      label: 'Free of major defects in relation to its age (major = renders the building uninhabitable or likely to collapse, prevents practical use, or poses a health/safety risk)',
      type: 'yesno',
    }],
    describe: { label: 'Describe the major defect(s)', gate: { fieldKey: 'major_defects_freeOfMajorDefects', equals: 'no' } },
  },
  {
    id: 'safety', title: 'Safety Matters', icon: '🚨', hint: 'Safety issues and advisories',
    fields: [{ key: 'safetyMatters', label: 'Safety matters are evident', type: 'yesno' }],
    checkGroups: [{
      heading: 'Safety items',
      items: [
        'Smoke alarms not installed in required locations per AS 3.7.2.3',
        'Insulation touching/covering recessed light fittings – fire hazard',
        'Fibre cement sheeting that may contain asbestos (construction 1930s–mid 1980s)',
        'Refer to Pool safety concerns',
        'Refer to Stairs safety concerns',
        'Refer to Trip hazard concerns',
      ],
    }],
  },
  {
    id: 'post-project', title: 'Post Project & Notes', icon: '📝', hint: 'Post-project flag, no-access areas, notes',
    fields: [{ key: 'postProject', label: 'Post project inspection', type: 'yesno' }],
    describe: { label: 'No access to… / additional notes', gate: undefined },
  },
];

function navSection(name: string, areas: SubArea[]) {
  return {
    name,
    fields: areas.flatMap(compile),
    layout: {
      mode: 'section-nav',
      groups: areas.map((a) => ({ letter: a.title, icon: a.icon, hint: a.hint })),
    },
  };
}

const SECTIONS: Record<string, { name: string; fields: Field[]; layout?: object }> = {
  'job-info': {
    name: 'Job Information',
    fields: [
      { key: 'jobNumber', type: 'text', label: 'Job No' },
      { key: 'inspectionDate', type: 'date', label: 'Inspection Date' },
      { key: 'assignedInspector', type: 'text', label: 'Inspector name' },
      { key: 'clientName', type: 'text', label: 'Client name' },
      { key: 'inspectionAddress', type: 'text', label: 'Inspection Address' },
      { key: 'unitNumber', type: 'text', label: 'Unit number' },
      { key: 'buildingName', type: 'text', label: 'Building name' },
      {
        key: 'weather', type: 'select-tiles', label: 'Weather',
        options: [
          { value: 'fine', label: 'Fine', icon: 'sunny-outline' },
          { value: 'partly_cloudy', label: 'Partly Cloudy', icon: 'partly-sunny-outline' },
          { value: 'overcast', label: 'Overcast', icon: 'cloudy-outline' },
          { value: 'light_rain', label: 'Light Rain', icon: 'rainy-outline' },
          { value: 'rain', label: 'Rain', icon: 'thunderstorm-outline' },
          { value: 'windy', label: 'Windy', icon: 'flag-outline' },
        ],
      },
    ],
  },

  description: {
    name: 'Description & Overview',
    fields: [
      { key: 'buildingType', type: 'pill-select', label: 'Building type', options: mkOpts(['Apartment Block', 'Walk-up Apartments', 'High-rise Apartments', 'Mixed-use Residential', 'Townhouse Complex', 'Serviced Apartments', 'Other']), sectionLetter: 'Building Description' },
      { key: 'constructedYear', type: 'text', label: 'Constructed year / decade', sectionLetter: 'Building Description' },
      { key: 'storeys', type: 'pill-select', label: 'Number of storeys', options: mkOpts(['2', '3', '4', '5', '6–10', '11–20', '20+']), sectionLetter: 'Building Description' },
      { key: 'streetFrontage', type: 'text', label: 'Street frontage (m)', sectionLetter: 'Building Description' },
      { key: 'slope', type: 'pill-select', label: 'Block slope', options: mkOpts(['Flat', 'Slight fall', 'Moderate fall', 'Steep fall']), sectionLetter: 'Building Description' },
      { key: 'cladding', type: 'pill-select', label: 'Wall cladding', options: mkOpts(['Brick', 'Brick veneer', 'Concrete panels', 'Render', 'Metal cladding', 'Timber', 'Glass curtain wall', 'Other']), sectionLetter: 'Building Description' },
      { key: 'foundations', type: 'pill-select', label: 'Foundations', options: mkOpts(['Concrete slab', 'Pier and beam', 'Raft slab', 'Other']), sectionLetter: 'Building Description' },
      { key: 'roofDesign', type: 'pill-select', label: 'Roof design', options: mkOpts(['Flat', 'Skillion', 'Gable', 'Hip', 'Other']), sectionLetter: 'Building Description' },
      { key: 'roofCovering', type: 'pill-select', label: 'Roof covering', options: mkOpts(['Colorbond / metal', 'Tiles', 'Membrane', 'Other']), sectionLetter: 'Building Description' },
      { key: 'windows', type: 'pill-select', label: 'Windows', options: mkOpts(['Aluminium frame', 'Timber frame', 'Double glazed', 'Louvre', 'Other']), sectionLetter: 'Building Description' },
      { key: 'overviewPhotos', type: 'photos', label: 'Building & street overview pics', sectionLetter: 'Building Description' },

      { key: 'worksType', type: 'pill-select', label: 'Proposed works type', options: mkOpts(['Demolition', 'Excavation', 'New construction', 'Renovation', 'Infrastructure works', 'Other']), sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'projectAddr', type: 'text', label: 'Project site address', sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'direction', type: 'pill-select', label: 'Project direction from property', options: mkOpts(['Front', 'Left', 'Rear', 'Right', 'Adjacent', 'Multiple sides']), sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'scopeType', type: 'pill-select', label: 'Inspection scope', options: mkOpts(['External only', 'Internal only', 'External & Internal (full)', 'Partial']), sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'limitations', type: 'yesno', label: 'Limitations to scope', sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'limitationsNotes', type: 'textarea', label: 'If yes, describe', gate: { fieldKey: 'limitations', equals: 'yes' }, sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'safetyIssues', type: 'yesno', label: 'Safety issues', sectionLetter: 'Scope, Safety and Limitations' },
      { key: 'safetyIssuesNotes', type: 'textarea', label: 'If yes, describe', gate: { fieldKey: 'safetyIssues', equals: 'yes' }, sectionLetter: 'Scope, Safety and Limitations' },
    ],
  },

  elevations: navSection('External', EXTERNAL),
  roof_chimneys: navSection('Roof', ROOF),
  internal_areas: navSection('Internal – Unit Areas', INTERNAL),
  paving_paths: navSection('Common Areas', COMMON),
  notes: navSection('Structural & Safety', STRUCTURAL),
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
    console.log(`[apartment] ${sectionKey} -> v${draft.version} (${def.fields.length} fields${def.layout ? ', section-nav' : ''})`);
  }

  await prisma.$disconnect();
}

void main();
