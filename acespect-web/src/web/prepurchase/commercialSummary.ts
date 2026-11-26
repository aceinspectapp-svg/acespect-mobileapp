/**
 * Pre-Purchase / Commercial: the Condition Summary rows of the graded elements a section asks about outside any list (Roof covering,
 * Gutters, Lintels, Fences, Ceilings ...): one row per graded element, named as the template's sub-heading names it, with the defects of
 * that element's own damage list. The form's lists (each elevation, each room) already have their rows; these come after them.
 * An element answered "Not applicable" (its grade is behind a closed gate) has no row.
 */
import { buildDefectNote, isGateSatisfied, type AnswerTree, type ConditionSummaryRow, type TemplateField } from "../templateFields";
import { gradeOf } from "../conditionGrades";

/** The element a grade belongs to, by its question's key, as the template names it. */
export const COMMERCIAL_ELEMENT_NAMES: Record<string, string> = {
  roofcov_condition: "Roof Covering",
  eaves_condition: "Eaves",
  fascia_condition: "Fascias",
  gables_condition: "Gables",
  flashings_condition: "Flashings",
  guttersvalleys_condition: "Gutters",
  guttersvalleys_valleysCondition: "Valleys",
  downpipes_condition: "Downpipes",
  chimneys_condition: "Chimney",
  roofcavity_condition: "Roof Covering (underside)",
  extwalls_condition: "Walls",
  cladding_condition: "Cladding",
  lintels_condition: "Lintels",
  windowsext_condition: "Windows/Window Frames",
  frontdoor_condition: "Front Door / Door Frames",
  otherdoors_condition: "Other External Doors",
  extstairs_condition: "Stairs",
  balconies_condition: "Balconies",
  verandah_condition: "Verandah",
  sheds_condition: "Sheds",
  garage_condition: "Garage",
  carport_condition: "Carport",
  studio_condition: "Studio",
  grannyflat_condition: "Granny Flat",
  pp_fences_condition: "Fences",
  ceilings_condition: "Ceilings",
  walls_condition: "Walls",
  intstairs_condition: "Stairs",
  intwindows_condition: "Windows",
  intwindows_flywireCondition: "Flywire Screens",
  intdoors_condition: "Doors",
  cabinets_condition: "Cabinets",
};

/** "roofcov_condition" -> "Roofcov" for a grade this list does not name yet (a question added to the form later). */
const fallbackName = (key: string) => {
  const p = key.replace(/_?[Cc]ondition$/, "").replace(/^pp_/, "").replace(/_/g, " ");
  return p.charAt(0).toUpperCase() + p.slice(1);
};

export function commercialElementRows(fields: TemplateField[], answers: AnswerTree): ConditionSummaryRow[] {
  const rows: ConditionSummaryRow[] = [];
  for (const f of fields) {
    if (f.type !== "color-select" || !isGateSatisfied(f, answers)) continue;
    const grade = gradeOf(f.options?.find((o) => o.value === answers[f.key]));
    if (!grade) continue;
    const damages = fields.find((d) => d.type === "damage-list" && (d.repeat as { requireWhen?: { fieldKey?: string } } | undefined)?.requireWhen?.fieldKey === f.key);
    rows.push({ subLabel: COMMERCIAL_ELEMENT_NAMES[f.key] ?? fallbackName(f.key), conditionLabel: grade.label, conditionColor: grade.color, defectNote: damages ? buildDefectNote(damages, answers) : undefined });
  }
  return rows;
}
