/**
 * The Construction Stage wording: turns one section's answers into the section's report text (and the defects it records).
 * This is what the web reviewer portal shows for a section and what the printed report is made from, so the two always agree.
 *
 * The text is lines, in the same plain format every report type uses, with these tags:
 *   ROOMHEAD::<heading>        a sub-heading (a group of checks, "Roof", "Walls" ...)
 *   ITEM::<heading>::<text>    one checklist row: its short name in bold, then its sentence
 *   NOTE::<text>               a sentence that belongs under the report's Notes (printed there, and shown in the section for the reviewer)
 *   DEFECT::<n>::<text>        defect n of this section (its photos are the section's n-th damage record)
 * and plain paragraphs for everything else.
 */
import type { AnswerTree, TemplateField } from "../templateFields";
import { asAnswerTree, asString, asStringArray, isGateSatisfied } from "../templateFields";
import { EXTERNAL_WORDS, STAGES, areaOfSection, kindOfKey, stageOfKey, type StageId } from "./stages";
import {
  CATEGORY_LABELS, NOT_APPLICABLE, SATISFACTORY, SEVERITY_LABELS, asList, cap, chosen, headingMap, headingOf, joinList, labelsOf, lower, mapLabels, photosIn, sentence, toneOfOption,
} from "./words";

export interface ComposedDamage {
  /** The group the defect sits under ("Roof", "Walls" ...). */
  type: string;
  location: string;
  /** EXTERNAL or INTERNAL. */
  direction: string;
  widthMm: number;
  lengthMm: number;
  notes: string;
  photos: string[];
}
export interface Composed { text: string; damages: ComposedDamage[] }

export const TAGS = { room: "ROOMHEAD::", item: "ITEM::", note: "NOTE::", defect: "DEFECT::" };
const DEFECT_SUFFIX = "__defect";

// ───────────────────────── Description ─────────────────────────

function describe(stage: StageId, fields: TemplateField[], a: AnswerTree, apartment: boolean): string[] {
  const f = (k: string) => fields.find((x) => x.key === k);
  const one = (k: string) => lower(labelsOf(f(k), a[k])[0] ?? "");
  const all = (k: string) => labelsOf(f(k), a[k]).map(lower);
  const out: string[] = [];

  const by = labelsOf(f("constructedBy"), a.constructedBy)[0];
  if (by) out.push(`The property is being constructed by ${by}.`);

  const kind = one("constructionIs") || one("design");
  const foundations = one("foundations");
  if (kind) out.push(`The construction is a ${kind} ${apartment ? "apartment" : "house"}.`);
  if (foundations) out.push(`Foundations are ${foundations}.`);

  const ground = all("groundCladding");
  const first = all("firstCladding").filter((x) => x !== "not applicable");
  const groundCombo = asString(a.groundCladdingCombo).trim();
  const firstCombo = asString(a.firstCladdingCombo).trim();
  if (ground.length || first.length) {
    const g = ground.map((x) => (x === "combination of" ? groundCombo || x : x));
    const firstOther = asString(a.firstCladdingOther).trim();
    const fl = first.map((x) => (x === "combination of" ? firstCombo || x : x === "other" ? firstOther || x : x));
    out.push(`Wall cladding is constructed of ${joinList(g)}${fl.length ? ` to the ground floor and ${joinList(fl)} to the first floor` : ""}.`);
  }

  const windows = one("windowsAre");
  if (windows) out.push(`Windows are constructed of ${windows}.`);
  const roofDesign = one("roofDesign");
  const roofCover = one("roofCoveringIs");
  if (roofDesign || roofCover) out.push(`The roof design is ${roofDesign || "—"}${roofCover ? ` and the covering is constructed of ${roofCover}` : ""}.`);
  const frontage = one("frontage");
  if (frontage) out.push(`The street frontage is to the ${frontage}.`);
  const block = one("blockSlope");
  if (block) out.push(`The block is ${block}.`);
  if (a.supervisorOnSite === "yes" || a.supervisorOnSite === "no") out.push(`The site supervisor was${a.supervisorOnSite === "no" ? " not" : ""} onsite at the time of inspection.`);
  if (a.ownersOnSite === "yes" || a.ownersOnSite === "no") out.push(`The owners were${a.ownersOnSite === "no" ? " not" : ""} present for the inspection.`);
  if (a.safetyIssues === "yes") {
    const d = asString(a.safetyDescribe).trim();
    out.push(d ? `Safety issues were noted: ${sentence(d)}` : "Safety issues were noted on site.");
  }
  const plans = labelsOf(f("plansSpecs"), a.plansSpecs).map(lower);
  const plansOther = asString(a.plansSpecsOther).trim();
  if (plans.length) out.push(`Plans and specifications provided: ${joinList(plans.map((x) => (x === "other" && plansOther ? plansOther : x)))}.`);
  if (asString(a.previousDefectsList) === "yes") out.push("A defects list from the previous report is attached, with its status updated.");
  const clientList = asString(a.clientIssuesList);
  if (clientList === "yes" || clientList === "yes_attached") out.push("The client has supplied a list of issues, which is attached with the inspector's comments.");
  out.push(STAGES[stage].progress);
  return out;
}

// ───────────────────────── Defects ─────────────────────────

interface Defect { sub: string; area: "EXTERNAL" | "INTERNAL"; location: string; text: string; photos: string[] }

function defectText(heading: string, location: string, comments: string, severities: string[], categories: string[], code: string): string {
  const head = heading ? cap(heading) : "";
  const where = location && heading ? ` — ${location}` : location;
  const lead = head || where ? `${head}${where}.` : "";
  const parts = [
    lead,
    comments ? sentence(comments) : "",
    severities.length ? `Severity: ${severities.join(", ")}.` : "",
    categories.length ? `Category: ${categories.join(", ")}.` : "",
    code ? `Construction code: ${code}.` : "",
  ].filter(Boolean);
  return parts.join(" ") || "Defect noted.";
}

function tableDefects(a: AnswerTree): Defect[] {
  const rows = Array.isArray(a.defects) ? (a.defects as AnswerTree[]) : [];
  const out: Defect[] = [];
  for (const row of rows) {
    const location = asString(row.location).trim();
    const description = asString(row.description).trim();
    const photos = photosIn(row.photos);
    if (!location && !description && photos.length === 0) continue;
    out.push({ sub: "General", area: EXTERNAL_WORDS.test(`${location} ${description}`) ? "EXTERNAL" : "INTERNAL", location, text: defectText("", location, description, [], [], ""), photos });
  }
  return out;
}

function typicalDefects(fields: TemplateField[], a: AnswerTree): Defect[] {
  const out: Defect[] = [];
  for (const f of fields) {
    if (f.type !== "chip-multiselect" || !isGateSatisfied(f, a)) continue;
    for (const optKey of asList(a[f.key])) {
      const opt = f.options?.find((o) => o.value === optKey);
      if (!opt) continue;
      const at = asString(a[`${optKey}_at`]).trim();
      out.push({ sub: "General", area: f.sectionLetter === "External" ? "EXTERNAL" : "INTERNAL", location: "", text: defectText("", "", at ? `${opt.label} ${at}` : opt.label, [], [], ""), photos: photosIn(a[`${optKey}_pics`]) });
    }
  }
  return out;
}

// ───────────────────────── Checklist rows ─────────────────────────

const toMm = (n: string) => (n ? `${n} millimetres` : "—");

interface Row { group?: string; heading: string; text: string }

/** One checklist section -> its rows (heading + sentence) and the defects raised in it. */
function checklistRows(key: string, fields: TemplateField[], a: AnswerTree, kind: "site" | "stage"): { rows: Row[]; defects: Defect[] } {
  const rows: Row[] = [];
  const defects: Defect[] = [];
  const used = new Set<string>();
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  const visible = [...fields].filter((f) => isGateSatisfied(f, a)).sort((x, y) => x.order - y.order);
  const headings = headingMap(fields);
  const area = kind === "site" ? "EXTERNAL" : areaOfSection(key);
  const add = (f: TemplateField, heading: string, text: string) => {
    if (text) rows.push({ group: f.sectionLetter ? headingOf(f.sectionLetter) : undefined, heading, text });
  };

  // Items worked out from several rows at once are printed where their first row sits.
  const emitAt = new Map<string, () => void>();
  const anchorOf = (...fs: (TemplateField | undefined)[]) => visible.find((v) => fs.some((x) => x && x.key === v.key))!.key;

  // Measurements that sit in plan / site / result triples: "As estimated using …. Setbacks on plan are … millimetres and on site are approximately … millimetres."
  for (const f of visible) {
    const m = /^(.*)Plan$/.exec(f.key);
    if (!m || used.has(f.key)) continue;
    const base = m[1]!;
    const site = fieldByKey.get(`${base}Site`);
    if (!site) continue;
    const datum = fieldByKey.get(`${base}Datum`);
    const result = fieldByKey.get(`${base}Result`) ?? fieldByKey.get(`${base}StepResult`);
    const group = f.sectionLetter ? headingOf(f.sectionLetter) : "";
    const baseName = f.label.replace(/\s+on plan( is)?$/i, "").replace(/ \(approx\)$/i, "");
    const name = group && !baseName.toLowerCase().startsWith(group.toLowerCase().split(" ")[0]!) ? `${group} — ${lower(baseName)}` : baseName;
    const plan = asString(a[f.key]);
    const onSite = asString(a[site.key]);
    if (!plan && !onSite) continue;
    const parts: string[] = [];
    if (datum && a[datum.key]) {
      const d = chosen(datum, asString(a[datum.key])).label;
      parts.push(/^estimated (from|using) /i.test(d) ? `As ${lower(d)}.` : `As estimated using the ${lower(d)}.`);
    }
    parts.push(
      f.type === "numeric"
        ? `${/step/i.test(base) ? "On plan is" : "Setbacks on plan are"} ${toMm(plan)} and on site ${/step/i.test(base) ? "is" : "are approximately"} ${toMm(onSite)}.`
        : `On plan is ${plan || "—"} and on site is approximately ${onSite || "—"}.`,
    );
    const resRaw = result ? asString(a[result.key]) : "";
    if (result && resRaw) {
      const r = chosen(result, resRaw);
      if (r.label) parts.push(r.tone === "ok" && SATISFACTORY.test(r.label) ? "Checked and satisfactory." : sentence(r.label));
    }
    used.add(f.key); used.add(site.key); if (datum) used.add(datum.key); if (result) used.add(result.key);
    const text = parts.join(" ");
    emitAt.set(anchorOf(datum, f, site, result), () => add(f, name, text));
  }

  // The upper-roof rows carry a limitation sentence in the office template.
  const roofFrom = fieldByKey.get("upperRoofFrom");
  if (roofFrom && a.upperRoofFrom && !used.has("upperRoofFrom")) {
    const from = chosen(roofFrom, asString(a.upperRoofFrom)).label;
    const appears = fieldByKey.get("upperRoofAppears");
    const lowerRoof = fieldByKey.get("lowerRoofLadder");
    const up = appears && a.upperRoofAppears ? lower(chosen(appears, asString(a.upperRoofAppears)).label) : "";
    const low = lowerRoof && a.lowerRoofLadder ? lower(chosen(lowerRoof, asString(a.lowerRoofLadder)).label) : "";
    const ground = /ground/i.test(from);
    const parts = [
      ground ? "Due to OH&S constraints the upper roof could not be safely accessed." : /scaffold/i.test(from) ? "The upper roof covering was inspected from the scaffold." : "",
      up ? `${ground ? "Observations from the ground indicate that the roof covering is" : "The upper roof covering is"} ${up}.` : "",
      low ? `Lower level roofing was checked from the ladder and is ${low}.` : "",
    ].filter(Boolean);
    used.add("upperRoofFrom"); used.add("upperRoofAppears"); used.add("lowerRoofLadder");
    if (parts.length) { const text = parts.join(" "); emitAt.set("upperRoofFrom", () => add(roofFrom, "Roof covering", text)); }
  }
  const gutterAccess = fieldByKey.get("safeAccessGuttering");
  if (gutterAccess && a.safeAccessGuttering && !used.has("safeAccessGuttering")) {
    const noAccess = /no/i.test(chosen(gutterAccess, asString(a.safeAccessGuttering)).label);
    const g = fieldByKey.get("upperGutteringGround");
    const l = fieldByKey.get("lowerGutteringLadder");
    const up = g && a.upperGutteringGround ? lower(chosen(g, asString(a.upperGutteringGround)).label) : "";
    const low = l && a.lowerGutteringLadder ? lower(chosen(l, asString(a.lowerGutteringLadder)).label) : "";
    const parts = [
      noAccess ? "Due to OH&S constraints the upper guttering could not be safely accessed." : "",
      up ? `Observations from the ground indicate that the guttering is ${up}.` : "",
      low ? `Lower level guttering was checked and is ${low}.` : "",
    ].filter(Boolean);
    used.add("safeAccessGuttering"); used.add("upperGutteringGround"); used.add("lowerGutteringLadder");
    if (parts.length) { const text = parts.join(" "); emitAt.set("safeAccessGuttering", () => add(gutterAccess, "Roof gutters", text)); }
  }

  const rowByKey = new Map<string, Row>();
  for (const f of visible) {
    emitAt.get(f.key)?.();
    if (used.has(f.key)) continue;
    const v = a[f.key];
    const heading = headings.get(f.key) ?? headingOf(f.label);

    if (/_other_note$/.test(f.key)) continue; // printed with its "Other" row below
    if (f.type === "photos" || f.type === "repeating-group" || f.type === "damage-list") continue;
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;

    if (f.type === "pill-select" && typeof v === "string") {
      const c = chosen(f, v);
      if (/^(applicable|not applicable)$/i.test(c.label) && /^(truss|non-truss|hebel|masonry|blueboard|stairwell|balcony)/i.test(heading)) continue; // only switches a group of checks on or off
      if (c.other && !c.label) continue; // a typed "Other" with nothing typed says nothing
      if (f.key.endsWith("_material")) {
        // "Colorbond" belongs to the row above it; if that row was left out (N/A), it stands on its own.
        const baseKey = f.key.replace(/_material$/, "");
        const baseRow = rowByKey.get(baseKey);
        if (baseRow) baseRow.text = `${c.label}. ${baseRow.text}`.trim();
        else add(f, heading, sentence(c.label));
        continue;
      }
      const isOtherRow = /_other$/.test(f.key);
      if (c.tone === "na" && NOT_APPLICABLE.test(c.label) && !(isOtherRow && asString(a[`${f.key}_note`]).trim())) continue;
      const isDefect = f.defectOn ? f.defectOn.includes(v) : c.tone === "bad";
      let text: string;
      if (isDefect) text = "Refer to Defects.";
      else if (c.tone === "ok" && (SATISFACTORY.test(c.label) || f.options?.some((x) => toneOfOption(x.color) === "bad"))) text = "Checked and satisfactory.";
      else if (/note/i.test(c.label)) text = "Refer to Notes.";
      else text = sentence(c.label);
      if (/_other$/.test(f.key)) {
        // "Other": printed only when the inspector said what it was (or it is a defect).
        const note = asString(a[`${f.key}_note`]).trim();
        if (!note && !isDefect) continue;
        text = note ? (isDefect ? `${text} ${sentence(note)}` : sentence(note)) : text;
      }
      const row: Row = { group: f.sectionLetter ? headingOf(f.sectionLetter) : undefined, heading, text };
      rows.push(row);
      rowByKey.set(f.key, row);
      if (isDefect) {
        const d = asAnswerTree(a[`${f.key}${DEFECT_SUFFIX}`]);
        defects.push({
          sub: row.group ?? "General", area, location: asString(d.location).trim(),
          text: defectText(heading, asString(d.location).trim(), asString(d.comments).trim(), mapLabels(d.severity, SEVERITY_LABELS), mapLabels(d.category, CATEGORY_LABELS), asString(d.constructionCode).trim()),
          photos: photosIn(d.photos),
        });
      }
      continue;
    }

    if (f.type === "yesno") { add(f, heading, v === "yes" ? "Yes." : v === "no" ? "No." : ""); continue; }
    if (f.type === "chip-multiselect" || f.type === "tile-multiselect") {
      const list = labelsOf(f, v);
      if (!list.length) continue;
      if (/visible at$/i.test(heading)) add(f, heading.replace(/\s+(are\s+)?visible at$/i, ""), /none/i.test(list[0]!) ? "None visible." : `Visible at ${joinList(list.map(lower))}.`);
      else add(f, heading, sentence(joinList(list)));
      continue;
    }
    if (f.type === "numeric") { add(f, heading, `${asString(v) || String(v)}${f.unit ? ` ${f.unit}` : ""}.`); continue; }
    if (f.type === "text" || f.type === "textarea" || f.type === "date") {
      const t = asString(v).trim();
      if (t) add(f, heading, sentence(t));
    }
  }
  return { rows, defects };
}

/** Sentences the Site & Facilities answers add to the report's Notes. */
function siteNotes(stage: StageId, fields: TemplateField[], a: AnswerTree): string[] {
  const pick = (key: string) => {
    const f = fields.find((x) => x.key === key);
    const v = a[key];
    return f && typeof v === "string" ? chosen(f, v) : null;
  };
  const notes: string[] = [];
  const fence = pick("securityFencing");
  if (fence && (fence.tone === "warn" || fence.tone === "bad")) notes.push("Sections of the security fence are not in position and need to be re-instated.");
  const rubbish = pick("rubbishDangerous");
  const managed = pick("siteManaged");
  const finalClean = pick("finalSiteClean");
  if ((rubbish && rubbish.tone === "bad") || (managed && managed.tone !== "ok") || (finalClean && /required/i.test(finalClean.label))) {
    notes.push(stage === "pci" ? "Final builder's clean to be completed." : "Site needs a clean-up of rubbish/debris to improve access and safety.");
  }
  const kerb = pick("kerbDamage");
  if (kerb && kerb.tone !== "ok") notes.push("Damage was noted to the footpath/kerbs/nature strip/vehicle crossover. Usually, such items are attended to at the end of the project and arranged between the construction company and the local authority.");
  return notes;
}

// ───────────────────────── Statement and notes ─────────────────────────

const GROUND_FALLS =
  "Due to ground falls towards the slab stormwater may pond and affect the footings. Stormwater needs to be controlled on site by the construction company to protect the foundations and surface to be graded to fall away from the building/s – refer to Codes 2. Footings and to Site Drainage requirements. Soil may erode and potentially block stormwater pipes – some protection may be advisable until landscaping/retaining works are done.";

function summaryLines(stage: StageId, fields: TemplateField[], a: AnswerTree): string[] {
  const meta = STAGES[stage];
  const lines: string[] = [];
  if (a.workmanshipSatisfactory === "yes") lines.push(`${meta.workmanshipLead} is generally to a satisfactory industry standard, except for the defects noted above.`);
  else if (a.workmanshipSatisfactory === "no") lines.push(`${meta.workmanshipLead} is not generally to a satisfactory industry standard. Refer to the defects noted above.`);
  if (stage === "pre_pour") {
    const works = fields.find((f) => f.key === "worksStatus");
    const w = works && typeof a.worksStatus === "string" && a.worksStatus ? chosen(works, a.worksStatus).label : "";
    if (w) lines.push(`The works are ${lower(w)}.`);
    if (a.contactedSupervisor === "yes") lines.push("The inspector contacted the slab/site supervisor regarding defects/concerns, and they are to be attended to prior to the concrete pour.");
  }
  lines.push(...meta.standingNotes);

  const ticks = asList(a.notesToInclude);
  const fenceDetail = asString(a.securityFencingDetail).trim();
  if (ticks.includes("security_fencing")) lines.push(fenceDetail ? `Security fencing is ${fenceDetail.replace(/[.\s]+$/, "")} and needs to be reinstated.` : "Sections of the security fence are not in position and need to be re-instated.");
  if (ticks.includes("ground_falls")) lines.push(GROUND_FALLS);
  const g = asString(a.groundFallsDetail).trim();
  if (g) lines.push(sentence(g));
  const r = asString(a.retainingWallsDetail).trim();
  if (ticks.includes("retaining_walls")) lines.push(r ? sentence(`Retaining walls are advised: ${r}`) : "Retaining walls are advised.");
  const agi = asString(a.agiDrainsDetail).trim();
  if (ticks.includes("agi_drains")) lines.push(agi ? sentence(`Agi drains are advised: ${agi}`) : "Agi drains are advised.");
  const roof = asString(a.roofAccessDetail).trim();
  if (ticks.includes("roof_access")) lines.push(roof ? sentence(`Roof access was limited: ${roof}`) : "Roof access was limited.");
  const other = asString(a.otherConcerns).trim();
  if (other) lines.push(sentence(other));
  return lines;
}

function attachedList(a: AnswerTree, prefix: "clientList" | "previousDefects"): string[] {
  if (asString(a[`${prefix}Status`]) !== "attached") return [];
  const updates = asString(a[`${prefix}Updates`]).trim();
  const intro = prefix === "clientList" ? "The client's list of issues is attached, with the inspector's comments." : "The previous report's defects list is attached, with the updates shown.";
  return [intro, ...(updates ? [updates] : [])];
}

// ───────────────────────── One section ─────────────────────────

/** The report text and recorded defects for one Construction Stage section. */
export function composeConstructionSection(key: string, fields: TemplateField[], a: AnswerTree, apartment: boolean): Composed {
  const stage = stageOfKey(key);
  if (!stage) return { text: "", damages: [] };
  const kind = kindOfKey(key);
  const lines: string[] = [];
  const defects: Defect[] = [];

  if (kind === "description") lines.push(...describe(stage, fields, a, apartment));
  else if (kind === "summary") lines.push(...summaryLines(stage, fields, a));
  else if (kind === "client") lines.push(...attachedList(a, "clientList"));
  else if (kind === "previous") lines.push(...attachedList(a, "previousDefects"));
  else if (kind === "defects") defects.push(...tableDefects(a));
  else if (kind === "typical") defects.push(...typicalDefects(fields, a));
  else {
    const { rows, defects: raised } = checklistRows(key, fields, a, kind === "site" ? "site" : "stage");
    let group: string | undefined;
    for (const r of rows) {
      if (r.group !== group) {
        group = r.group;
        if (group) lines.push(`${TAGS.room}${group}`);
      }
      lines.push(`${TAGS.item}${r.heading}::${r.text}`);
    }
    defects.push(...raised);
    if (kind === "site") for (const n of siteNotes(stage, fields, a)) lines.push(`${TAGS.note}${n}`);
  }

  if (defects.length > 0) {
    lines.push(`${TAGS.room}Defects`);
    defects.forEach((d, i) => lines.push(`${TAGS.defect}${i}::${d.text}`));
  }
  return {
    text: lines.join("\n\n"),
    damages: defects.map((d) => ({ type: d.sub, location: d.location, direction: d.area, widthMm: 0, lengthMm: 0, notes: "", photos: d.photos })),
  };
}
