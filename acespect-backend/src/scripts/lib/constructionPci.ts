/**
 * Stage 5 -- PCI / Handover. Built from two forms that differ:
 *   "Stage 5 PCI-Handover Inspector Template, House, 4 Aug 2023"      (house / townhouse / unit on ground)
 *   "Stage 5 PCI-Handover Inspector Template, Apartment, 4 Aug 2023"  (multi-level buildings only)
 * so, unlike the earlier stages, Residential House and Apartment get different templates under the same section keys
 * ("pci_*"). The Apartment form has no Site and Facilities part; the app leaves that section out for apartments.
 *
 * Each form is a long checklist: every row is OK / N/A / Defect. Part 2 is a list of typical defects to tick, each with
 * its own photos, then the defects table, the workmanship statement, notes, previous defects and the client list.
 */
import {
  COLOR, Draft, SectionDef, attachedListFields, bad, check, clientIssuesFields, defectsFields, na, numbered, ok, opts, slug, warn,
} from './constructionTemplates';

type Property = 'residential_house' | 'apartment';
const STATUS = [ok('OK'), na('N/A'), bad('Defect')];

// ───────────────────────── Checklist rows ─────────────────────────

/** A checklist row: the PDF's wording as the label, OK / N/A / Defect to tap. `material` adds the "circle the material" choice. */
interface Row { label: string; material?: string[] }
const r = (label: string, material?: string[]): Row => ({ label, material });

function checklist(prefix: string, group: string, list: Row[]): Draft[] {
  const seen = new Set<string>();
  const out: Draft[] = [];
  for (const row of list) {
    let key = `${prefix}_${slug(row.label).slice(0, 38)}`;
    let n = 2;
    while (seen.has(key)) key = `${key.slice(0, 36)}_${n++}`;
    seen.add(key);
    out.push(...check(key, row.label, STATUS, group));
    if (row.material) {
      out.push({ key: `${key}_material`, type: 'pill-select', label: `${row.label} — material`, options: opts(...row.material), allowOther: true, sectionLetter: group });
    }
  }
  return out;
}

/** The form's "Other" and blank rows: tick a result and say what it is. */
function otherRows(prefix: string, group: string): Draft[] {
  return [
    { key: `${prefix}_other`, type: 'pill-select', label: 'Other', options: STATUS.map((c) => ({ value: slug(c.label), label: c.label, color: COLOR[c.tone] })), sectionLetter: group },
    { key: `${prefix}_other_note`, type: 'textarea', label: 'Other — describe', placeholder: 'What did you check?', sectionLetter: group },
  ];
}

const COLORBOND_ZINC = ['Colorbond', 'Zincalume'];
const COLORBOND_TIMBER = ['Colorbond', 'Timber'];

// ───────────────────────── House ─────────────────────────

const houseRoof: Draft[] = [
  ...checklist('roof', 'Roof', [
    r('Covering; cracked tiles, seated, clipped, metal screwed, straight'),
    r('Covering; swarth, dents, scratches'),
    r('Roof line; straight, sags'),
    r('Skylights; damaged, flashed'),
    r('Valley tile edges; tiles cut straight, dry or pointing ok'),
    r('Valleys irons; correct, length ok, cut straight'),
    r('Gutters', COLORBOND_ZINC),
    r('Gutters; debris, lack of fall, ponding (max 10mm water), scratched'),
    r('Box Gutters; sufficient capacity, falls, flashed, overflow outlets'),
    r('Rainheads; overflows'),
    r('Downpipes', COLORBOND_ZINC),
    r('Downpipes; straight, connected, PVC connectors painted to ground level, scratched, dented, firmly fixed (brackets not screwed into place)'),
    r('Downpipes; as per plan, max 12 metre spacings'),
    r('Flashings; at pipe penetrations, parapets, capping to parapets'),
    r('Ventilators; mountings and fit offs sealed'),
    r('Chimney, Flue'),
    r('Solar panels; correct elevation, mountings and fit offs sealed'),
    r('Fascias; straight, fixed', COLORBOND_TIMBER),
    r('Eave linings / sofitt; holes filled, painted'),
    r('Roof Terrace? If so, provide details.'),
  ]),
  ...otherRows('roof', 'Roof'),
];

const houseWallsDoors: Draft[] = [
  ...checklist('walls', 'Walls', [
    r('Cladding; hebel, concrete panels, cement sheet, timber boards. Clean, straight'),
    r('Brick work; straight, bowed, levels, bonding, clean, voids'),
    r('Mortar; perps, beds (too wide / narrow) cracks, voids, discolouration, variations'),
    r('Articulation joints; as per plan, max 6m spacings, straight, width okay, caulking blends'),
    r('Weep holes; correct positions, 1200mm spacings, sufficient'),
    r('Damp proof course evident (check at each elevation 4 to 6 weepholes)'),
    r('Lintels; straight, painted, gaps & voids'),
    r('Sills; straight, sloped out to shed water, cracks'),
    r('Render; coverage, blends, sheet joins'),
    r('Concrete slab; rough edges, exposed reo,'),
    r('Polyethylene turned up to slab edge. Trimmed'),
    r('Sub-floor; stumps, piers, joists, bearers, ant caps, other'),
    r('Cement sheet joins, fixings, painted, rendered'),
    r('Timber, fixings, overlap, painted/sealed'),
  ]),
  ...otherRows('walls', 'Walls'),
  ...checklist('doors', 'Doors, etc', [
    r('Windows; Timber / Aluminium. Sealed, gaps, infills'),
    r('Windows; double glazed, opaque required due to overlooking'),
    r('Doors; sealed (all edges painted), gaps, infills, weather seals'),
    r('Doors; correct materials, furniture fit off, locks, latches, sliders'),
    r('Flyscreens; specified for windows & doors, fitted'),
    r('Sliding doors/Bi-fold; tracks clean, locks & hinges'),
  ]),
  ...otherRows('doors', 'Doors, etc'),
];

const houseGarageSite: Draft[] = [
  ...checklist('garage', 'Garage', [
    r('Garage vehicle doors; roller door and motor fitted'),
    r('Garage pedestrian doors; to yard-weatherproofed. To House, sealed'),
    r('Carport; hardstand cracking, scraped clean, fit out'),
    r('Basement car bay & storage cage; hardstand cracking, scraped clean, fit out'),
    r('Car stacker'),
    r('Driveway; concrete ok, drains correct'),
    r('Paving; finishes, levels – falls are away from house walls'),
  ]),
  ...otherRows('garage', 'Garage'),
  ...checklist('balconies', 'Balconies', [
    r('Balcony 1; handrail height, balusters correct spacing'),
    r('Balcony 1; tiles, grout, floor falls, drain outlet, waterproofed'),
    r('Balcony 2; handrail height, balusters correct spacing'),
    r('Balcony 2; tiles, grout, floor falls, drain outlet, waterproofed'),
    r('Private Terrace / Courtyard'),
    r('Alfresco / Outdoor room'),
    r('Decking; handrail height, balusters correct spacing'),
    r('External Stairs; riser height, treads, stringers, handrail height & continuous, balusters'),
  ]),
  ...otherRows('balconies', 'Balconies'),
  ...checklist('site', 'Site', [
    r('Fences; as per plan, clean, letterbox'),
    r('Sheds'),
    r('Water storage tanks; stable, plumbing, overflow'),
    r('Landscaping'),
    r('Ground falls; Need to be graded away from footings 1m'),
    r('Drainage; cut off drain at garage, agi drains'),
    r('Retaining Walls; recommend to …..'),
    r('Termite system required / installed & okay'),
    r('Pool / Spa; pavers, finishes'),
    r('Pool safety; fencing, self-locking gates & doors, windows restricted openings'),
    r('Crossover / public assets to be repaired or cleaned'),
    r('Site; needs clean'),
  ]),
  ...otherRows('site', 'Site'),
  ...checklist('common', 'Common areas', [r('Driveway, carpark'), r('Entry doors, foyer, letterboxes')]),
  ...otherRows('common', 'Common areas'),
];

const houseInternal: Draft[] = [
  ...checklist('internal', 'Internal', [
    r('Front Door'),
    r('Hallway and entry'),
    r('Kitchen & pantry'),
    r('Living area / family'),
    r('Dining'),
    r('Lounge / Theatre Room'),
    r('Bedroom 1 and Ensuite'),
    r('Bedroom 2 (is there an Ensuite?)'),
    r('Bedroom 3'),
    r('Bedroom 4'),
    r('Study'),
    r('Internal Stairs; riser height, treads, handrail height & continuous, balusters'),
    r('Bathroom Water drains from vanities & shower'),
    r('Powder room; removable door required'),
    r('Toilet; removable door required'),
    r('Exhaust fans; sanitary room venting'),
    r('Shower falls;'),
    r('Bath spouts clearance. Water drains from vanities & shower'),
    r('Laundry'),
  ]),
  ...otherRows('internal', 'Internal'),
];

const FINISHES: Row[] = [
  r('Flooring; level, movement-squeaking. Inspector check all levels'),
  r('Floor coverings; floating timber, gaps, joints in large areas about 6m spacings'),
  r('Carpets; stretched & fitted'),
  r('Ceramic Tiling; joints in large areas at approx 6m spacings, tiles uneven/level, grouting straight, even max 5mm width.'),
  r('Plasterwork walls and ceilings; visible joins, level, gaps, level 4 finish'),
  r('Plasterwork cornices, straight, gaps'),
  r('Paintwork; level 4 finish for domestic'),
  r('Cabinetry; bench tops, doors, hinges, drawers & margins'),
  r('Vanities; level, caulked, clean'),
  r('Internal Doors; Door clearances and margins, furniture & finsishes'),
  r('Internal Windows; Flyscreens – specified. Window locks'),
];
const SERVICES: Row[] = [
  r('Water supply on?'),
  r('Plumbing; Fit offs, gaps are sealed'),
  r('Plumbing; Test all toilets, showers and taps for water pressure, hammer, leaks'),
  r('Plumbing; Internal drains clear'),
  r('Electrical supply on?'),
  r('Electrical; fit offs, double/single GPO’s as per plan'),
  r('Electrical; Test all fans, lights, appliances'),
  r('Gas supply on?'),
  r('Gas appliances Inspector to test all appliances operate'),
  r('Smoke Detectors installed and correctly located within 1.5 metres of bedrooms'),
];

const houseFinishes: Draft[] = [...checklist('finishes', 'Finishes', FINISHES), ...otherRows('finishes', 'Finishes')];
const houseServices: Draft[] = [
  ...checklist('services', 'Utilities - Services', SERVICES),
  ...checklist('other', 'Other', [
    r('Manhole; fitted, access okay or is it obstructed'),
    r('Ceiling Insulation; installed correctly'),
    r('Light fittings OK/clear re fire risk (eg; 200mm clearance for halogen globes)'),
    r('Ventilation; Are fans installed as per plan'),
    r('Ventilation; If roof is sarked are fans vented externally (ie; not into roof cavity)'),
    r('Sarking: required and installed, torn/gaps'),
    r('Services light switch to within in reach of manhole'),
    r('Heat/Cool Unit installed; commissioned. Platform access/walkway correct'),
    r('Frame/trusses'),
    r('Roof Covering (underside); covered by sarking?'),
    r('Party Walls'),
    r('Energy ratings; specific requirements installed'),
    r('Proximity to salt water. Surf locality requirements. Galvanised. Painting to lintels, etc'),
    r('Bushfire; (BAL) requirements correct?'),
  ]),
  ...otherRows('other', 'Other'),
];

// ───────────────────────── Apartment ─────────────────────────

const apartmentRoof: Draft[] = checklist('roof', 'Roof', [
  r('Multi-level complex: could you access roof for inspection? If not, put NA'),
  r('If accessible is Roof covering OK? If limited views put OK & details to NOTES'),
  r('Box gutters, rainheads; overflows'),
  r('Downpipes', COLORBOND_ZINC),
  r('Flashings; at pipe penetrations, parapets, capping to parapets'),
  r('Fascias', COLORBOND_TIMBER),
  r('Eave linings / sofitt'),
  r('Private Roof Terrace? If so, provide details.'),
  r('If terrace is Common, adds notes and photos to Common Area section'),
]);

const apartmentWallsDoors: Draft[] = [
  ...checklist('walls', 'Walls', [
    r('Cladding straight, bowed, level, bonding, clean, voids'),
    r('Articulation joints; straight, width okay, caulked'),
    r('Lintels; straight, painted, gaps & voids'),
    r('Sills; straight, sloped out to shed water, gaps for movement, cracks'),
    r('Render; coverage, blends, sheet joins'),
  ]),
  ...otherRows('walls', 'Walls'),
  ...checklist('doors', 'Windows and doors', [
    r('Windows; Timber / Aluminium. Sealed, gaps, infills'),
    r('Windows; double glazed, opaque required due to overlooking'),
    r('Doors; sealed (all edges painted), gaps, weather sealed'),
    r('Doors; correct materials, furniture fit off, locks, latches, sliders'),
    r('Sliding doors/Bi-fold; tracks clean, locks & hinges'),
  ]),
  ...checklist('carbay', 'Flyscreens and car bay', [
    r('Flyscreens; required? windows & doors'),
    r('Basement car bay & storage cage; hardstand cracking, scraped clean, fit out'),
    r('Car stacker'),
    r('Garage vehicle doors; roller door and motor fitted'),
  ]),
];

const apartmentBalconiesCommon: Draft[] = [
  ...checklist('balconies', 'Balconies / Private terrace', [
    r('Balcony 1; handrail height, balusters correct spacing'),
    r('Balcony 1; tiles, grout, floor falls, drain outlet, waterproofed'),
    r('Balcony 2; handrail height, balusters correct spacing'),
    r('Balcony 2; tiles, grout, floor falls, drain outlet, waterproofed'),
    r('Private Terrace / Courtyard'),
  ]),
  ...checklist('common', 'Common areas', [
    r('Common entry, foyer, letterboxes, lounge'),
    r('Driveway; Entry to basement car park'),
    r('Site; work in progress'),
    r('Pool / Spa; pavers, finishes'),
    r('Pool safety; fencing, self-locking gates & doors'),
    r('Gym / Sauna'),
    r('Common roof top / terrace / BBQ'),
  ]),
];

const apartmentInternal: Draft[] = [
  ...checklist('internal', 'Internal', [
    r('Apartment Front Door Fire safety rated?'),
    r('Hallway and entry'),
    r('Kitchen & pantry'),
    r('Living area / family'),
    r('Lounge / Theatre Room'),
    r('Bedroom 1 and Ensuite'),
    r('Bedroom 2 (is there an Ensuite?)'),
    r('Bedroom 3'),
    r('Study'),
    r('Internal Stairs; riser height, treads, handrail height & continuous, balusters'),
    r('Bathroom Water drains from vanities & shower'),
    r('Powder room; removable door required'),
    r('Toilet; removable door required'),
    r('Exhaust fans; sanitary room venting'),
    r('Shower falls;'),
    r('Bath spouts clearance. Water drains from vanities & shower'),
    r('Laundry'),
    r('Ventilation; Are fans installed as per plan'),
  ]),
  ...otherRows('internal', 'Internal'),
];

const apartmentFinishes: Draft[] = houseFinishes;
const apartmentServices: Draft[] = [
  ...checklist('services', 'Utilities - Services', SERVICES),
  ...checklist('other', 'Other', [
    r('Manhole; fitted, access okay or is it obstructed'),
    r('Ceiling Insulation; installed correctly'),
    r('Party Walls'),
    r('Energy ratings; specific requirements installed'),
    r('Proximity to salt water. Surf locality requirements. Galvanised. Painting to lintels, etc'),
  ]),
];

// ───────────────────────── Description and overview ─────────────────────────

const CLADDING_HOUSE = ['Brick veneer', 'Rendered brick', 'Cement sheet', 'Concrete panels', 'Hebel', 'Weatherboards', 'Styrene foam'];
const CLADDING_APARTMENT = ['Concrete panels', 'Hebel', 'Brick veneer', 'Rendered brick', 'Cement sheet'];

const PHOTOS: Draft[] = [
  { key: 'streetPhotos', type: 'photos', label: 'Site from the street — take 4 to 6 photos', required: true },
  { key: 'elevationPhotos', type: 'photos', label: 'Sides and rear elevations' },
  { key: 'neighbourPhotos', type: 'photos', label: 'The location of the property in relation to neighbouring properties / structures / streetscape' },
];
const SAFETY: Draft[] = [
  { key: 'supervisorOnSite', type: 'yesno', label: 'Supervisor on site', required: true },
  { key: 'ownersOnSite', type: 'yesno', label: 'Owners on site', required: true },
  { key: 'safetyIssues', type: 'yesno', label: 'Safety issues', required: true },
  { key: 'safetyDescribe', type: 'textarea', label: 'Describe safety matters', required: true, gate: { fieldKey: 'safetyIssues', equals: 'yes' } },
];
const PLANS: Draft[] = [
  {
    key: 'plansSpecs', type: 'chip-multiselect', label: 'Plans & specifications', required: true,
    options: [...opts('Full set of drawings', 'Working drawings', 'Schematics (Off the Plan)', 'List of specifications', 'Limited documents'), { value: 'other', label: 'Other' }],
  },
  { key: 'plansSpecsOther', type: 'textarea', label: 'Other plans or documents — specify', gate: { fieldKey: 'plansSpecs', equalsAny: ['other'] } },
  { key: 'previousDefectsList', type: 'pill-select', label: 'Previous defects list attached (print or refer to it and answer every item)', required: true, options: opts('Yes', 'N/A') },
  { key: 'clientIssuesList', type: 'pill-select', label: 'Client list of issues (print or refer to it and answer every item)', required: true, options: opts('Yes', 'N/A') },
];

const houseDescription: Draft[] = [
  ...PHOTOS,
  { key: 'constructedBy', type: 'pill-select', label: 'Constructed by', options: opts('Metricon', 'Carlisle', 'Simonds'), allowOther: true, required: true },
  { key: 'design', type: 'pill-select', label: 'Design', options: opts('Single storey', 'Double storey', 'Split level', 'Duplex'), allowOther: true, required: true },
  { key: 'foundations', type: 'pill-select', label: 'Foundations are', options: opts('Concrete slab', 'Timber stumps', 'Concrete stumps', 'Brick piers'), allowOther: true, required: true },
  { key: 'groundCladding', type: 'chip-multiselect', label: 'Wall cladding — Ground floor', required: true, options: [...opts(...CLADDING_HOUSE), { value: 'combination_of', label: 'Combination of' }] },
  { key: 'groundCladdingCombo', type: 'textarea', label: 'Ground floor — combination of …', gate: { fieldKey: 'groundCladding', equalsAny: ['combination_of'] } },
  { key: 'firstCladding', type: 'chip-multiselect', label: 'Wall cladding — First floor', required: true, options: [{ value: 'not_applicable', label: 'Not applicable', exclusive: true }, ...opts(...CLADDING_HOUSE), { value: 'combination_of', label: 'Combination of' }] },
  { key: 'firstCladdingCombo', type: 'textarea', label: 'First floor — combination of …', gate: { fieldKey: 'firstCladding', equalsAny: ['combination_of'] } },
  { key: 'windowsAre', type: 'pill-select', label: 'Windows are', options: opts('Aluminium', 'Timber', 'Mix of aluminium and timber'), allowOther: true, required: true },
  { key: 'roofDesign', type: 'pill-select', label: 'Roof design is', options: opts('Pitched', 'Flat', 'Combination of pitched and flat'), allowOther: true, required: true },
  { key: 'roofCoveringIs', type: 'pill-select', label: 'Roof covering', options: opts('Concrete tile', 'Terracotta tile', 'Colorbond', 'Zincalume', 'Kliplock decking'), allowOther: true, required: true },
  { key: 'frontage', type: 'pill-select', label: 'Street frontage is', options: opts('North', 'South', 'East', 'West'), required: true },
  { key: 'blockSlope', type: 'pill-select', label: 'The block is', options: opts('Steep sloping', 'Gently sloping', 'Mostly flat'), required: true },
  ...SAFETY,
  ...PLANS,
];

const apartmentDescription: Draft[] = [
  ...PHOTOS,
  { key: 'constructedBy', type: 'pill-select', label: 'Constructed by', options: opts('Hacer', 'Mirvac'), allowOther: true, required: true },
  { key: 'design', type: 'pill-select', label: 'Design', options: opts('Single storey', 'Double storey', 'Split level'), allowOther: true, required: true },
  { key: 'foundations', type: 'pill-select', label: 'Foundations are', options: opts('Concrete slab'), allowOther: true, required: true },
  { key: 'groundCladding', type: 'chip-multiselect', label: 'Wall cladding — Ground floor', required: true, options: opts(...CLADDING_APARTMENT) },
  { key: 'firstCladding', type: 'chip-multiselect', label: 'Wall cladding — First floor', required: true, options: [{ value: 'not_applicable', label: 'Not applicable', exclusive: true }, ...opts(...CLADDING_APARTMENT), { value: 'other', label: 'Other' }] },
  { key: 'firstCladdingOther', type: 'textarea', label: 'First floor — other …', gate: { fieldKey: 'firstCladding', equalsAny: ['other'] } },
  { key: 'windowsAre', type: 'pill-select', label: 'Windows are', options: opts('Aluminium', 'Timber'), allowOther: true, required: true },
  { key: 'frontage', type: 'pill-select', label: 'Street frontage is', options: opts('North', 'South', 'East', 'West'), required: true },
  ...SAFETY,
  ...PLANS,
];

// ───────────────────────── Site and facilities (house form only) ─────────────────────────

const houseSite: Draft[] = [
  ...check('builderSign', "Builder's sign displayed", [ok('Yes — OK'), bad('No — defect')], 'Site and facilities'),
  ...check('finalSiteClean', 'Final site clean', [ok('Yes — required'), ok('No — OK')], 'Site and facilities'),
  ...check('kerbDamage', 'Damage to kerb / path / crossover', [ok('OK'), warn('See notes')], 'Site and facilities'),
  { key: 'kerbOther', type: 'textarea', label: 'Other', sectionLetter: 'Site and facilities' },
];

// ───────────────────────── Part 2: identified defects ─────────────────────────

/** A typical defect to tick, with photos ("Pics…") and, where the form leaves a blank, a place to say where. */
interface Typical { key: string; label: string; pics?: boolean; at?: string }
const t = (key: string, label: string, pics = true, at?: string): Typical => ({ key, label, pics, at });

function typicalDefects(groups: { heading: string; field: string; items: Typical[] }[]): Draft[] {
  const out: Draft[] = [];
  for (const g of groups) {
    out.push({ key: g.field, type: 'chip-multiselect', label: `Typical defects — ${g.heading} (tick any that apply)`, sectionLetter: g.heading, options: g.items.map((i) => ({ value: i.key, label: i.label })) });
    for (const i of g.items) {
      if (i.at) out.push({ key: `${i.key}_at`, type: 'text', label: `${i.at} …`, gate: { fieldKey: g.field, equalsAny: [i.key] }, sectionLetter: g.heading });
      if (i.pics) out.push({ key: `${i.key}_pics`, type: 'photos', label: `Pics — ${i.label}`.slice(0, 190), gate: { fieldKey: g.field, equalsAny: [i.key] }, sectionLetter: g.heading });
    }
  }
  return out;
}

const INSIDE_ENTRY: Typical[] = [
  t('front_door_latching', 'Front door not latching'),
  t('excess_paint_door', 'Excess paint to be cleaned from front door or frame'),
  t('screws_door_hinges', 'Screws missing from Front door hinges'),
  t('hallway_marks', 'Marks and blemishes to hallway walls need clean and paint touch ups'),
  t('kitchen_cabinet_doors', 'Kitchen cabinet doors out of alignment and need adjustment'),
  t('cabinets_chipped', 'Cabinets / benches chipped'),
  t('kitchen_family_marks', 'Marks and blemishes to kitchen and family need clean and paint touch ups'),
  t('sliding_door_tracks', 'Sliding doors tracks need clean'),
  t('kitchen_caulking', 'Caulking to be completed at kitchen benches'),
  t('grouting_poor', 'Grouting is poorly finished'),
];
const INSIDE_BEDS: Typical[] = [
  t('bed1_marks', 'Bed 1 marks and blemishes need clean and paint touch ups'),
  t('ensuite1_caulking', 'Ensuite vanity tiles need caulking (Bed 1)'),
  t('bed2_marks', 'Bed 2 marks and blemishes need clean and paint touch ups'),
  t('ensuite2_caulking', 'Ensuite vanity tiles need caulking (Bed 2)'),
  t('bed3_marks', 'Bed 3 marks and blemishes need clean and paint touch ups'),
  t('floor_coverings_marked', 'Floor coverings are marked and need cleaning'),
  t('balcony_fall', 'Balcony floor does not have sufficient fall to drain'),
  t('cladding_cleaned_at', 'Sections of wall cladding / brickwork to be cleaned', true, 'Cleaned at'),
  t('pipe_penetrations', 'Gaps at pipe penetrations need to be sealed / caulked'),
  t('window_seals_at', 'Gaps at window seals', true, 'Gaps at'),
  t('windows_doors_cleaned', 'All windows and doors to be cleaned and detailed', false),
  t('windows_floor_cleaned', 'All windows and floor tile and coverings to be cleaned', false),
  t('benchtops_cleaned', 'All bench tops and vanities to be cleaned and detailed', false),
];
const houseTypical: Draft[] = typicalDefects([
  {
    heading: 'External', field: 'typicalExternal', items: [
      t('roof_tiles', 'Roof tiles cracked / chipped'),
      t('gutter_debris', 'Building debris to be cleaned from gutter'),
      t('gutter_water', 'Gutters are holding excessive water (> 10mm deep)'),
      t('downpipe_connectors', 'Downpipe connectors to be painted matching colour down to ground level'),
      t('mortar_voids', 'Mortar voids'),
      t('brickwork_cleaned_at', 'Sections of brickwork to be cleaned', true, 'Cleaned at'),
      t('porch_slab', 'Porch slab to be scraped and cleaned'),
      t('alfresco_slab', 'Alfresco slab to be scraped and cleaned'),
      t('garage_slab', 'Garage slab to be scraped and cleaned'),
      t('ground_falls', 'The ground falls around the perimeter are sloping towards the slab / subfloor and need to be graded to fall away from the foundations'),
    ],
  },
  { heading: 'Entry, kitchen and living', field: 'typicalEntry', items: INSIDE_ENTRY },
  { heading: 'Bedrooms, floors and general', field: 'typicalBeds', items: INSIDE_BEDS },
]);
const apartmentTypical: Draft[] = typicalDefects([
  { heading: 'Entry, kitchen and living', field: 'typicalEntry', items: [t('front_door_fire', 'Front door is not fire rated'), ...INSIDE_ENTRY] },
  { heading: 'Bedrooms, floors and general', field: 'typicalBeds', items: INSIDE_BEDS },
]);

// ───────────────────────── Statement, notes, previous defects ─────────────────────────

const summary: Draft[] = [
  { key: 'workmanshipSatisfactory', type: 'yesno', label: 'The workmanship of the PCI/Handover stage is generally to a satisfactory industry standard, except for the defects noted above', required: true, sectionLetter: 'Statement' },
  { key: 'notesToInclude', type: 'chip-multiselect', label: 'Notes — tick any you want to add', sectionLetter: 'Notes', options: [{ value: 'roof_access', label: 'Roof access limited' }] },
  { key: 'roofAccessDetail', type: 'textarea', label: 'Roof access limited …', gate: { fieldKey: 'notesToInclude', equalsAny: ['roof_access'] }, sectionLetter: 'Notes' },
  { key: 'otherConcerns', type: 'textarea', label: 'Any other concerns', sectionLetter: 'Notes' },
];

const previousDefects: Draft[] = attachedListFields({
  key: 'previousDefects',
  label: 'Attach the previous stage Defects list with updates',
  updatesLabel: 'Status next to each previous report defect — "Done and satisfactory", "Not done" or "Could not inspect due to …"',
  photosLabel: 'The previous stage Defects list (photos)',
});

// ───────────────────────── The two forms ─────────────────────────

export function pciSections(property: Property): SectionDef[] {
  const house = property === 'residential_house';
  return [
    { key: 'pci_description', name: 'Description & Overview', fields: numbered(house ? houseDescription : apartmentDescription) },
    ...(house ? [{ key: 'pci_site_facilities', name: 'Site & Facilities', fields: numbered(houseSite) }] : []),
    { key: 'pci_roof', name: 'PCI Checklist: External — Roof', fields: numbered(house ? houseRoof : apartmentRoof) },
    { key: 'pci_walls_doors', name: house ? 'PCI Checklist: External — Walls, Doors & Windows' : 'PCI Checklist: External — Walls, Windows, Doors & Car Bay', fields: numbered(house ? houseWallsDoors : apartmentWallsDoors) },
    { key: 'pci_garage_site', name: house ? 'PCI Checklist: External — Garage, Balconies & Site' : 'PCI Checklist: External — Balconies & Common Areas', fields: numbered(house ? houseGarageSite : apartmentBalconiesCommon) },
    { key: 'pci_internal', name: 'PCI Checklist: Internal — Rooms', fields: numbered(house ? houseInternal : apartmentInternal) },
    { key: 'pci_finishes', name: 'PCI Checklist: Internal — Finishes', fields: numbered(house ? houseFinishes : apartmentFinishes) },
    { key: 'pci_services', name: 'PCI Checklist: Internal — Services & Other', fields: numbered(house ? houseServices : apartmentServices) },
    { key: 'pci_typical_defects', name: 'Part 2: Identified Defects', fields: numbered(house ? houseTypical : apartmentTypical) },
    { key: 'pci_defects', name: 'Defects', fields: numbered(defectsFields) },
    { key: 'pci_summary', name: 'Statement & Notes', fields: numbered(summary) },
    { key: 'pci_previous_defects', name: 'Previous Defects', fields: numbered(previousDefects) },
    { key: 'pci_client_issues', name: 'Client List of Issues', fields: numbered(clientIssuesFields) },
  ];
}

