/**
 * A Construction Stage section as the reviewer portal and the printed report both show it: its report text and defect
 * records come from the Construction Stage wording applied to the section's answers -- unless the reviewer has typed over
 * the text, in which case their text is kept (the defects still come from the answers, so their photos stay attached).
 */
import type { FormSection, DamageRecord } from "../mockData";
import type { AnswerTree, TemplateField } from "../templateFields";
import { flattenSectionToDraft } from "../templateFields";
import type { ReportProfile } from "../wording/profile";

export const isConstructionKey = (key: string) => /^(pp|sd|fr|lu|fx|pci|sf|lf)_/.test(key);

export function constructionSectionText(section: FormSection, fields: TemplateField[] | undefined, profile: ReportProfile): { reportText: string; damages: DamageRecord[] } {
  const key = section.key ?? section.id;
  const answers = (section.answers as AnswerTree | null | undefined) ?? null;
  if (!fields || !answers) return { reportText: section.reportText, damages: section.damages };
  const derived = flattenSectionToDraft(fields, answers, key, profile);
  const overridden = (section.fields as Record<string, unknown> | undefined)?.reportTextOverride === true;
  // A reviewer typing over the rows keeps the section's defects (and their photos) unless they edited the defect lines themselves.
  const defectTail = derived.reportText.includes("ROOMHEAD::Defects") ? derived.reportText.slice(derived.reportText.indexOf("ROOMHEAD::Defects")) : "";
  const typedOver = section.reportText.includes("DEFECT::") || !defectTail ? section.reportText : `${section.reportText}

${defectTail}`;
  return {
    reportText: overridden ? typedOver : derived.reportText,
    damages: derived.damages.map((d, i): DamageRecord => ({
      id: `${section.id}-defect-${i}`, type: d.type, location: d.location, direction: d.direction, widthMm: d.widthMm, lengthMm: d.lengthMm, notes: d.notes, photos: d.photos,
    })),
  };
}
