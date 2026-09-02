// Shared "defect type" taxonomy for the redesigned damage-list entry shape,
// built around AS 4349.1's damage categories. Each of the 8 top-level types
// gates its own sub-type pill-select (key `sub_<type>`) purely through the
// existing `gate` mechanism -- no new field type or engine capability needed,
// it's the same pattern CategoryNavForm already uses for "which items are
// present here?" checklists.
//
// A section rarely needs all 8 -- "Operational Defects" (doors/windows/gates)
// doesn't belong on a driveway, "Moisture-Related Evidence" doesn't belong on
// a roof covering summary, etc. `defectItemFields({ include })` builds the
// itemFields array for just the subset a given section actually needs.
import { TemplateField, TemplateFieldOption } from '../../modules/templates/templates.schemas';

type Field = Omit<TemplateField, 'order'>;

const opt = (label: string, value?: string): TemplateFieldOption => ({
  value: value ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60),
  label,
});

export interface DefectTypeDef {
  value: string;
  label: string;
  subFieldKey: string;
  subLabel: string;
  subOptions: TemplateFieldOption[];
}

export const DEFECT_TYPES: DefectTypeDef[] = [
  {
    value: 'cracking', label: 'Cracking', subFieldKey: 'sub_cracking', subLabel: 'Cracking severity',
    subOptions: [
      opt('Hairline (≤0.1mm — Damage Category 0)', 'hairline'),
      opt('Fine (≤1.0mm — Damage Category 1)', 'fine'),
      opt('Moderate (≤5.0mm — Defect Category 2)', 'moderate'),
      opt('Major (>5.0mm and ≤15mm — Defect Category 3)', 'major'),
      opt('Significant (>15mm — Defect Category 4)', 'significant'),
    ],
  },
  {
    value: 'surface_damage', label: 'Surface Damage', subFieldKey: 'sub_surface', subLabel: 'Surface damage type',
    subOptions: [opt('Chips'), opt('Scratches'), opt('Impact damage'), opt('Abrasion')],
  },
  {
    value: 'material_deterioration', label: 'Material Deterioration', subFieldKey: 'sub_material', subLabel: 'Deterioration type',
    subOptions: [opt('Corrosion/Rust'), opt('Rot'), opt('Spalling'), opt('Concrete cancer'), opt('Decay'), opt('Weathering')],
  },
  {
    value: 'movement_displacement', label: 'Movement / Displacement', subFieldKey: 'sub_movement', subLabel: 'Movement type',
    subOptions: [opt('Leaning'), opt('Settlement indicators'), opt('Separation'), opt('Bulging'), opt('Misalignment')],
  },
  {
    value: 'moisture_evidence', label: 'Moisture-Related Evidence', subFieldKey: 'sub_moisture', subLabel: 'Moisture evidence',
    subOptions: [opt('Water staining'), opt('Dampness'), opt('Efflorescence'), opt('Mould')],
  },
  {
    value: 'operational_defects', label: 'Operational Defects', subFieldKey: 'sub_operational', subLabel: 'Operational defect',
    subOptions: [
      opt('Doors tight/not closing'), opt('Windows tight/not closing'), opt('Gates sagging'),
      opt('Garage doors out of alignment/not closing'), opt('Other movable elements'),
    ],
  },
  {
    value: 'previous_repairs', label: 'Previous Repairs', subFieldKey: 'sub_repairs', subLabel: 'Repair type',
    subOptions: [opt('Crack patching'), opt('Repainting'), opt('Replacement materials'), opt('Structural repairs')],
  },
  {
    value: 'safety_issues', label: 'Safety Issues', subFieldKey: 'sub_safety', subLabel: 'Safety issue',
    subOptions: [opt('Tripping hazard'), opt('Leaning wall'), opt('Unsafe pool safety barrier'), opt('Missing balustrades/rails')],
  },
];

function numbered(fields: Field[]): TemplateField[] {
  return fields.map((f, i) => ({ ...f, order: i }));
}

/**
 * Builds the itemFields for one redesigned damage-list entry:
 * Location -> Element -> Defect Type (the given subset) -> that type's own
 * sub-type (gated) -> crack dimensions (gated on Cracking specifically,
 * since only a crack has a width/length/direction to record) -> Notes ->
 * Photographs.
 */
export function defectItemFields(opts: { include: string[] }): TemplateField[] {
  const types = DEFECT_TYPES.filter((t) => opts.include.includes(t.value));
  const fields: Field[] = [
    { key: 'location', type: 'text', label: 'Location' },
    { key: 'element', type: 'text', label: 'Element (which part of the location, e.g. walls, kerb, slab)' },
    { key: 'damageType', type: 'pill-select', label: 'Defect Type', options: types.map((t) => ({ value: t.value, label: t.label })) },
    ...types.map((t): Field => ({
      key: t.subFieldKey, type: 'pill-select', label: t.subLabel, options: t.subOptions,
      gate: { fieldKey: 'damageType', equals: t.value },
    })),
  ];

  if (types.some((t) => t.value === 'cracking')) {
    const crackGate = { fieldKey: 'damageType', equals: 'cracking' };
    fields.push(
      { key: 'crackStartLocation', type: 'text', label: 'Starting from location', gate: crackGate },
      { key: 'direction', type: 'pill-select', label: 'Running', options: [opt('Vertical'), opt('Diagonal'), opt('Horizontal')], gate: crackGate },
      { key: 'widthMm', type: 'numeric', label: 'Width', unit: 'mm', gate: crackGate },
      { key: 'lengthMm', type: 'numeric', label: 'Length', unit: 'mm', gate: crackGate },
    );
  }

  fields.push(
    { key: 'notes', type: 'textarea', label: 'Notes' },
    { key: 'photos', type: 'photos', label: 'Photographs' },
  );

  return numbered(fields);
}
