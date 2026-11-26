// pre_purchase / apartment -- this report type's wording.
// The office template is "ACESPECT Building (Pre-Purchase)_Apartment Nov 2026". Until each element's sentences are written from it,
// the sections keep the provisional sentences (provisional.ts), with this report type's own fixes on top:
//   - a list of sentences ("General Comments") prints one bullet per sentence, never joined with ".,";
//   - a room's moisture observations: "None observed" says so in the template's words, and findings are listed ("Staining noted.");
//   - no full stop is added after text that already ends with ".", "!" or "?".
import type { Composer } from "./shared";
import type { TemplateField } from "../templateFields";
import { asStringArray, otherAnswerText } from "../templateFields";
import { provisionalWording } from "./provisional";
import type { ReportWording } from "./types";

const base = provisionalWording({ inspectionType: "pre_purchase", propertyType: "apartment" });

/** What the template says when no moisture was found in a room. */
export const NO_MOISTURE = "No signs of moisture or musty odour were observed at the time of inspection.";

/** A typed "Other" moisture answer that means nothing was found ("None observed", "Nil", "No moisture", "N/A"). */
const NOTHING_FOUND = /^\s*(none\b|nil\b|no\b|not observed\b|n\/?a\b)/i;

/** A mark the room composer is given in place of the moisture answers, so this report type can put its own sentence where that one was. */
const MOISTURE_MARK = "\u0001";

/** The moisture observations of one room, as this report type words them ("" when none were recorded). */
export function moistureSentence(raw: unknown, field: TemplateField | undefined): string {
  const found: string[] = [];
  let nothing = false;
  for (const v of asStringArray(raw as never)) {
    const typed = otherAnswerText(v);
    if (typed !== undefined) {
      if (NOTHING_FOUND.test(typed)) nothing = true;
      else if (typed) found.push(typed);
      continue;
    }
    if (v === "other") continue; // the bare "Other" choice: its typed words carry the answer
    found.push(field?.options?.find((o) => o.value === v)?.label ?? v);
  }
  if (found.length > 0) {
    const words = found.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()));
    const list = words.length === 1 ? words[0]! : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
    return `${list} noted.`;
  }
  return nothing ? NO_MOISTURE : "";
}

/** A room composer with the moisture observations worded as above (also used by Pre-Purchase / Commercial). */
export function withMoistureWording(room: Composer): Composer {
  return (inst, itemFields, label) => {
    if (asStringArray(inst.moistureObservations).length === 0) return room(inst, itemFields, label);
    const sentence = moistureSentence(inst.moistureObservations, itemFields.find((f) => f.key === "moistureObservations"));
    // The room composer writes "<observations> noted." at the end of the room's paragraph: given the mark, it writes "<mark> noted.".
    const text = room({ ...inst, moistureObservations: [`__other__:${MOISTURE_MARK}`] }, itemFields, label);
    return text
      .replace(new RegExp(`[ ]*${MOISTURE_MARK} noted\\.`, "g"), sentence ? ` ${sentence}` : "")
      .split("\n\n")
      .map((p) => p.trim())
      .filter(Boolean)
      .join("\n\n");
  };
}

/** The rooms: the provisional sentences, with the moisture observations worded as above. */
const internalAreas: Composer = withMoistureWording(base.composers.internal_areas!);

/** "A., B." -> one bullet per sentence, when every chosen answer is a sentence of its own. */
export function listLine(_sectionKey: string, _field: TemplateField, labels: string[]): string | undefined {
  if (labels.length === 0 || !labels.every((l) => /[.!?]$/.test(l.trim()))) return undefined;
  return labels.map((l) => `BULLET::${l.trim()}`).join("\n\n");
}

/** No full stop after a sentence that already ends with ".", "!" or "?" ("... owners corporation).." -> "... owners corporation)."). */
export function tidyFullStops(text: string): string {
  return text.replace(/([.!?])\.(?=\s|$)/g, "$1");
}

export const prePurchaseApartment: ReportWording = {
  ...base,
  composers: { ...base.composers, internal_areas: internalAreas },
  listLine,
  finish: (_sectionKey, text) => tidyFullStops(text),
};
