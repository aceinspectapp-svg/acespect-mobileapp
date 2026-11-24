// Dilapidation / Commercial Properties form changes for the Nov 2026 office template's wording
// ("ACESPECT Dilapidation Industrial-Commercial Generic_Office Template Nov 2026.dotm"):
//   - The "Rename this ... (optional)" boxes are optional again (they were required, so inspectors typed the standard name and
//     it replaced the template's wording: "Front (east)" instead of "Front Elevation (east)").
//   - Description asks the building's design ("It is of a two storey design ...") and the extension ("There is an extension to
//     the rear built around 2010. It is constructed of ...").
//   - Elevations: a party wall can be at the rear too, and asks what the party wall is constructed of ("It is constructed of brick
//     which is in fair condition.").
//   - Warehouse & Production asks the production area's floors separately from the warehouse's (the template's FLOORS heading
//     has a Warehouse and a Production Area part).
//
// Idempotent: run it twice and the second run changes nothing. No field key is renamed or removed.
//
//   npx tsx src/scripts/align-commercial-form-nov2026.ts --snapshot   # rewrite prisma/templates-snapshot.json
//   npx tsx src/scripts/align-commercial-form-nov2026.ts              # dry run against the database
//   npx tsx src/scripts/align-commercial-form-nov2026.ts --apply      # publish new template versions
//
// Inspectors see the change after they accept the template update in the app.
import { addFieldAfter, find, renumber, runAlignment, type Field } from './lib/align-helpers';

const PROFILE = { inspectionType: 'dilapidation', propertyType: 'commercial_properties' };
const SECTIONS = ['description', 'paving_paths', 'fences', 'retaining_walls', 'garage_carport_sheds', 'elevations', 'internal_areas', 'pool_spa'] as const;

/** The rename box of each section. */
const RENAME: Record<string, string> = {
  paving_paths: 'areaName',
  fences: 'fenceName',
  retaining_walls: 'wallName',
  garage_carport_sheds: 'structureName',
  elevations: 'elevationName',
  pool_spa: 'areaName',
};

const optional = (field: Field | undefined): boolean => {
  if (!field || field.required === false) return false;
  field.required = false;
  return true;
};

/** A deep copy of a field with every `hard_` key (its own, its gate's, its requireWhen's) moved to `pfl_`. */
function asProductionFloor(f: Field): Field {
  const json = JSON.stringify(f).replace(/"hard_/g, '"pfl_');
  const copy = JSON.parse(json) as Field;
  if (copy.sectionLetter) copy.sectionLetter = 'Production Area Floors';
  return copy;
}

export function alignSection(sectionKey: string, fields: Field[]): boolean {
  let changed = false;
  if (RENAME[sectionKey]) changed = optional(find(fields, RENAME[sectionKey]!)) || changed;
  switch (sectionKey) {
    case 'description': {
      const walls = find(fields, 'wallCladdingGround')?.options;
      const roofDesign = find(fields, 'roofDesign')?.options;
      const covering = find(fields, 'roofCovering')?.options;
      const foundations = find(fields, 'foundations')?.options;
      const letter = { sectionLetter: 'Property Description' };
      changed =
        addFieldAfter(fields, 'underConstructionStage', {
          key: 'buildingDesign',
          type: 'pill-select',
          label: 'Design',
          required: false,
          allowOther: true,
          options: [
            { label: 'Single storey', value: 'single_storey' },
            { label: 'Two storey', value: 'two_storey' },
            { label: 'Multi-level', value: 'multi_level' },
            { label: 'Split level', value: 'split_level' },
          ],
          ...letter,
        }) || changed;
      const gate = { fieldKey: 'extensionPresent', equals: 'yes' };
      changed = addFieldAfter(fields, 'windowsOther', { key: 'extensionPresent', type: 'yesno', label: 'Is there an extension?', required: false, ...letter }) || changed;
      changed =
        addFieldAfter(fields, 'extensionPresent', {
          key: 'extensionLocation',
          type: 'pill-select',
          label: 'Extension is to the',
          required: false,
          gate,
          options: [
            { label: 'Front', value: 'front' },
            { label: 'Rear', value: 'rear' },
            { label: 'Left-hand side', value: 'left_hand_side' },
            { label: 'Right-hand side', value: 'right_hand_side' },
          ],
          ...letter,
        }) || changed;
      changed = addFieldAfter(fields, 'extensionLocation', { key: 'extensionYear', type: 'text', label: 'Extension built — year or decade', required: false, gate, ...letter }) || changed;
      if (walls) changed = addFieldAfter(fields, 'extensionYear', { key: 'extensionWalls', type: 'chip-multiselect', label: 'Extension walls', required: false, gate, options: walls.map((o) => ({ ...o })), ...letter }) || changed;
      if (foundations)
        changed = addFieldAfter(fields, 'extensionWalls', { key: 'extensionFoundations', type: 'pill-select', label: 'Extension foundations', required: false, gate, options: foundations.map((o) => ({ ...o })), ...letter }) || changed;
      if (roofDesign)
        changed = addFieldAfter(fields, 'extensionFoundations', { key: 'extensionRoofDesign', type: 'pill-select', label: 'Extension roof design', required: false, gate, options: roofDesign.map((o) => ({ ...o })), ...letter }) || changed;
      if (covering)
        changed =
          addFieldAfter(fields, 'extensionRoofDesign', { key: 'extensionRoofCovering', type: 'chip-multiselect', label: 'Extension roof covering', required: false, gate, options: covering.map((o) => ({ ...o })), ...letter }) ||
          changed;
      break;
    }
    case 'elevations': {
      const inner = find(fields, 'sides')?.itemFields;
      if (!inner) break;
      const partyWall = inner.find((f) => f.key === 'partyWall');
      const g = partyWall?.gate as { fieldKey?: string; equalsAny?: string[] } | undefined;
      if (g?.equalsAny && !g.equalsAny.includes('rear')) {
        g.equalsAny = ['left', 'rear', 'right'];
        changed = true;
      }
      changed =
        addFieldAfter(inner, 'partyWallNumber', {
          key: 'partyWallConstruction',
          type: 'chip-multiselect',
          label: 'Party wall constructed of',
          required: false,
          allowOther: true,
          gate: { fieldKey: 'partyWall', equals: 'yes' },
          options: [
            { label: 'Brick', value: 'brick' },
            { label: 'Concrete panels', value: 'concrete_panels' },
            { label: 'Hebel', value: 'hebel' },
            { label: 'Metal', value: 'metal' },
          ],
        }) || changed;
      break;
    }
    case 'internal_areas': {
      if (fields.some((f) => f.key.startsWith('pfl_'))) break;
      const hard = fields.filter((f) => f.key.startsWith('hard_'));
      if (!hard.length) break;
      // The warehouse's floors keep their keys (answers already given stay), under the template's name for them.
      for (const f of hard) if (f.sectionLetter) f.sectionLetter = 'Warehouse Floors';
      const at = fields.indexOf(hard[hard.length - 1]!) + 1;
      fields.splice(at, 0, ...hard.map(asProductionFloor));
      renumber(fields);
      changed = true;
      break;
    }
  }
  return changed;
}

if (require.main === module) {
  runAlignment(PROFILE, SECTIONS, alignSection).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
