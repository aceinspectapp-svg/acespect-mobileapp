import { api } from "./api";
import type { FormSection, Inspection } from "./mockData";
import { looksLikePhoneWording } from "./phoneWording";
import { fetchActiveTemplate, flattenSectionToDraft, type AnswerTree } from "./templateFields";
import { reportProfileOf } from "./wording/profile";

/**
 * Sentences for the sections that came from the phone. The phone's own report text is a raw list of "Question?: answer" pairs with option
 * names as stored ("separate_to_house"); the sentences a report needs are composed on the website (templateFields.ts + wording/), the
 * same way they are when a section is edited on the web. So a section from the phone is composed from its saved answers the first time
 * the inspection is opened, and the result is saved so it is only done once.
 *
 * Only a section whose text still looks like the phone's is touched (see phoneWording.ts), so text a reviewer has since edited stays.
 */
function needsComposing(section: FormSection): boolean {
  return !!section.answers && Object.keys(section.answers).length > 0 && looksLikePhoneWording(section.reportText);
}

/**
 * The inspection with every phone-worded section composed into sentences, and the sections that changed (to be saved).
 * Nothing is thrown: a section that cannot be composed (no template for it) simply keeps its text.
 */
export async function composePhoneSections(inspection: Inspection): Promise<{ inspection: Inspection; changed: FormSection[] }> {
  const profile = reportProfileOf(inspection.type, inspection.propertyType);
  const changed: FormSection[] = [];
  const sections: FormSection[] = [];
  for (const section of inspection.sections) {
    if (!needsComposing(section)) {
      sections.push(section);
      continue;
    }
    try {
      const key = section.key ?? section.id;
      const template = await fetchActiveTemplate(inspection.type, inspection.propertyType, key);
      if (!template) {
        sections.push(section);
        continue;
      }
      const derived = flattenSectionToDraft(template.fields, section.answers as AnswerTree, key, profile);
      if (!derived.reportText.trim() || derived.reportText === section.reportText) {
        sections.push(section);
        continue;
      }
      const next: FormSection = { ...section, reportText: derived.reportText, fields: { ...section.fields, ...(derived.fields as FormSection["fields"]) } };
      sections.push(next);
      changed.push(next);
    } catch {
      sections.push(section);
    }
  }
  return { inspection: changed.length ? { ...inspection, sections } : inspection, changed };
}

/** Saves the composed text. Best effort: a person who may not edit sections (or a dropped connection) just sees it composed on screen. */
export async function saveComposedSections(inspection: Inspection, changed: FormSection[]): Promise<boolean> {
  try {
    const profile = reportProfileOf(inspection.type, inspection.propertyType);
    for (const s of changed) {
      const key = s.key ?? s.id;
      const template = await fetchActiveTemplate(inspection.type, inspection.propertyType, key);
      if (!template) continue;
      const derived = flattenSectionToDraft(template.fields, s.answers as AnswerTree, key, profile);
      await api.updateSection(s.id, {
        answers: s.answers as Record<string, unknown>,
        fields: derived.fields,
        reportText: derived.reportText,
        damages: derived.damages.map((d) => ({ type: d.type, location: d.location, direction: d.direction, widthMm: d.widthMm, lengthMm: d.lengthMm, notes: d.notes, photos: d.photos })),
      });
    }
    return true;
  } catch {
    return false;
  }
}
