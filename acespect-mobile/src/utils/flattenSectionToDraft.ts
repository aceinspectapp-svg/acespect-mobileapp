import type { TemplateField } from '../services/templateApi';
import type { DraftDamage } from '../context/InspectionDraftContext';
import type { AnswerTree, AnswerValue } from '../components/inspection/fieldRenderers/types';
import { isGateSatisfied, isRepeatRequirementMet } from '../components/inspection/fieldRenderers/types';

interface FlattenResult {
  fields: Record<string, unknown>;
  damages: DraftDamage[];
  reportText: string;
}

function asAnswerTree(v: AnswerValue): AnswerTree {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as AnswerTree) : {};
}
function asStringArray(v: AnswerValue): string[] {
  return Array.isArray(v) && (v.length === 0 || typeof v[0] === 'string') ? (v as string[]) : [];
}
function asString(v: AnswerValue): string {
  return typeof v === 'string' ? v : '';
}

function resolveInstances(field: TemplateField, value: AnswerValue): { label: string; scope: AnswerTree }[] {
  const repeat = field.repeat ?? { presentation: 'strip' as const };
  // An instance the inspector named (a renamed room, a "Part A") reports under
  // that name rather than "<Label> 3" -- this is what carries the name into
  // damage locations and the report prose.
  const titleKey = repeat.titleFieldKey;
  const named = (scope: AnswerTree, fallback: string): string => {
    const v = titleKey ? scope[titleKey] : undefined;
    return typeof v === 'string' && v.trim() ? v.trim() : fallback;
  };

  if (repeat.presentation === 'strip' || field.type === 'damage-list') {
    const list = Array.isArray(value) ? (value as AnswerTree[]) : [];
    return list.map((scope, i) => ({ label: named(scope, `${field.label} ${i + 1}`), scope }));
  }
  // fixed-tabs / nested / checklist: Record<instanceKey, AnswerTree>
  const record = asAnswerTree(value) as unknown as Record<string, AnswerTree>;
  const fixed = repeat.fixedInstances ?? [];
  const seen = new Set(fixed.map((f) => f.key));
  const out = fixed.map((f) => ({ label: named(record[f.key] ?? {}, f.label), scope: record[f.key] ?? {} }));
  let extra = 0;
  for (const [key, scope] of Object.entries(record)) {
    if (seen.has(key)) continue;
    extra += 1;
    out.push({ label: named(scope, `${field.label} ${fixed.length + extra}`), scope });
  }
  return out;
}

/**
 * Walks a template + its answer tree exactly the way the old hand-written
 * `saveToDraft` handlers did per-section, generically: leaf answers fold
 * into `fields[key]`; damage-list instances (at any nesting depth) flatten
 * into the flat `damages[]` array with `location` prefixed by the chain of
 * ancestor instance labels; a generic per-instance sentence summary stands
 * in for the old hand-tuned report prose. Plugs into the unchanged
 * `draft.setSection({ fields, damages, reportText })` contract.
 */
export function flattenSectionToDraft(templateFields: TemplateField[], answers: AnswerTree): FlattenResult {
  return walk(templateFields, answers, []);
}

function walk(templateFields: TemplateField[], scope: AnswerTree, ancestorLabels: string[]): FlattenResult {
  const fields: Record<string, unknown> = {};
  const damages: DraftDamage[] = [];
  const textParts: string[] = [];

  for (const field of templateFields) {
    if (!isGateSatisfied(field, scope)) continue;
    const value = scope[field.key];

    if (field.type === 'damage-list') {
      // `damageType` and, where the entry has one, its gated sub-type field
      // (e.g. "Cracking" -> sub_cracking = "Fine (<=1.0mm ...)") both carry
      // proper display labels on the template itself -- resolved generically
      // from the template's own options/gate metadata rather than a
      // hardcoded type->subtype map, so this keeps working for any future
      // damage-list built the same way. Falls back to the raw stored value
      // if a template doesn't define that option (shouldn't happen, but
      // keeps old data readable rather than blank).
      const itemFields = field.itemFields ?? [];
      const damageTypeField = itemFields.find((f) => f.key === 'damageType');
      for (const { scope: inst } of resolveInstances(field, value)) {
        const typeRaw = asString(inst.damageType);
        const typeLabel = damageTypeField?.options?.find((o) => o.value === typeRaw)?.label || typeRaw;
        const subField = itemFields.find((f) => f.gate?.fieldKey === 'damageType' && f.gate.equals === typeRaw);
        const subRaw = subField ? asString(inst[subField.key]) : '';
        const subLabel = subField?.options?.find((o) => o.value === subRaw)?.label || subRaw;

        const locationParts = [asString(inst.location), asString(inst.element), asString(inst.crackStartLocation)];
        damages.push({
          type: [typeLabel, subLabel].filter(Boolean).join(' — ') || 'Damage',
          location: [...ancestorLabels, ...locationParts.filter(Boolean)].join(' — '),
          direction: asString(inst.direction),
          widthMm: Number(inst.widthMm) || 0,
          lengthMm: Number(inst.lengthMm) || 0,
          notes: asString(inst.notes),
          photos: asStringArray(inst.photos),
        });
      }
      continue;
    }

    if (field.type === 'repeating-group') {
      const instances = resolveInstances(field, value);
      const labels: string[] = [];
      for (const { label, scope: inst } of instances) {
        const sub = walk(field.itemFields ?? [], inst, [...ancestorLabels, label]);
        damages.push(...sub.damages);
        labels.push(label);
        if (sub.reportText) textParts.push(`${label}: ${sub.reportText}`.trim());
      }
      fields[field.key] = labels.join(', ');
      continue;
    }

    if (field.type === 'photos') {
      // Not folded into `fields` (photo capture is a capability, not a
      // display value) -- the mobile PhotosFieldRenderer already registers
      // captures with usePhotoCapture(), which the existing
      // draft.collectPhotoUris()/photosForSection() mechanism already
      // sweeps up by sectionKey prefix, so nothing to do here.
      continue;
    }

    if (value === undefined || value === '') continue;
    const strValue = Array.isArray(value) ? value.filter((v) => typeof v === 'string').join(', ') : String(value);
    fields[field.key] = strValue;
    textParts.push(`${field.label}: ${strValue}.`);
  }

  return { fields, damages, reportText: textParts.join(' ') };
}

/**
 * True when every `repeat.requireWhen` constraint in this template is
 * satisfied, at every nesting depth (a Part's own damage-list, a room inside
 * a repeating group, etc.) -- the section-level equivalent of a flat
 * `required` field check, reusing the exact same instance-walking as
 * flattening so nested scopes line up identically.
 */
export function meetsAllRequireWhen(templateFields: TemplateField[], scope: AnswerTree): boolean {
  for (const field of templateFields) {
    if (!isGateSatisfied(field, scope)) continue;
    const value = scope[field.key];

    if (field.repeat?.requireWhen && !isRepeatRequirementMet(field, value, scope)) return false;

    if (field.type === 'repeating-group') {
      for (const { scope: inst } of resolveInstances(field, value)) {
        if (!meetsAllRequireWhen(field.itemFields ?? [], inst)) return false;
      }
    }
  }
  return true;
}

function isFilled(v: AnswerValue): boolean {
  return Array.isArray(v) ? v.length > 0 : !!v;
}

/**
 * True when every `required` field is satisfied, at this level AND inside
 * every instance of every repeating-group (fixed-tabs, strip, nested --
 * `resolveInstances` handles all three the same way `meetsAllRequireWhen`
 * and the flattener already do). Two things a flat `.every(f =>
 * !!answers[f.key])` gets wrong, both needed once a section has conditional
 * fields: a required field that's currently hidden by its own `gate` (e.g.
 * "specify the material" only shown once "Other" is picked) must NOT block
 * completion while it's invisible; and fields sharing a `requiredGroup` are
 * "either/or" -- satisfied once ANY one of them has an answer (e.g.
 * "Constructed year" OR "Under construction at stage").
 *
 * A fixed-tabs instance the inspector never opened still gets an (empty)
 * scope from `resolveInstances`, so a required field inside it correctly
 * fails this check -- e.g. marking a per-side "condition" required is
 * exactly what makes "Paving" only complete once all four sides have been
 * visited, not just one.
 */
export function meetsAllRequiredFields(templateFields: TemplateField[], scope: AnswerTree): boolean {
  const required = templateFields.filter((f) => f.required && isGateSatisfied(f, scope));
  const grouped = new Map<string, TemplateField[]>();
  const ungrouped: TemplateField[] = [];
  for (const f of required) {
    if (f.requiredGroup) {
      const arr = grouped.get(f.requiredGroup) ?? [];
      arr.push(f);
      grouped.set(f.requiredGroup, arr);
    } else {
      ungrouped.push(f);
    }
  }
  if (!ungrouped.every((f) => isFilled(scope[f.key]))) return false;
  for (const fields of grouped.values()) {
    if (!fields.some((f) => isFilled(scope[f.key]))) return false;
  }

  for (const field of templateFields) {
    if (field.type !== 'repeating-group') continue;
    if (!isGateSatisfied(field, scope)) continue;
    for (const { scope: inst } of resolveInstances(field, scope[field.key])) {
      if (!meetsAllRequiredFields(field.itemFields ?? [], inst)) return false;
    }
  }
  return true;
}
