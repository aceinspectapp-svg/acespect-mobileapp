import type { TemplateField } from '../services/templateApi';
import type { DraftDamage } from '../context/InspectionDraftContext';
import type { AnswerTree, AnswerValue } from '../components/inspection/fieldRenderers/types';
import { isGateSatisfied } from '../components/inspection/fieldRenderers/types';

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
      for (const { scope: inst } of resolveInstances(field, value)) {
        damages.push({
          type: asString(inst.damageType) || 'Damage',
          location: [...ancestorLabels, asString(inst.location)].filter(Boolean).join(' — '),
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
