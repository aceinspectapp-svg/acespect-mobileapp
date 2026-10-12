// The defect sentences of Houspect's Public Assets and Industrial / Commercial Word templates:
//
//   "At the {location}, there is a crack starting at {start} and running to the {direction}. The crack is {width} millimetres wide
//   and {length} millimetres long."   /   "A gap at {location}."   /   "There are loose palings at {location}."
//
// External items state the size plainly; internal ones say "approximately" (the template tells the inspector to take that word out
// when a crack card shows the size in a photo). Every defect carries `DEFECT::<n>::` so its photos print under it.
import type { AnswerTree, TemplateField } from "../templateFields";
import { asString, otherAnswerText, withPeriod } from "../templateFields";
import { LOCATION_STARTS_WITH_PREPOSITION_RE, article, capitalize, lower, typedCase } from "./shared";
import { houseDamageSentences } from "./dilapidation.residential_house";

const num = (n: number): string => String(Number(n.toFixed(2)));

/** `damageSentences` for a report type whose template words defects this way. */
export function templateDamageSentences(config: { approximately: boolean }) {
  return (inst: AnswerTree, itemFields: TemplateField[], options: { key?: string; indexOffset?: number } = {}): string => {
    const key = options.key;
    if (!key) return houseDamageSentences(inst, itemFields, options);
    const field = itemFields.find((f) => f.key === key);
    const list = Array.isArray(inst[key]) ? (inst[key] as AnswerTree[]) : [];
    if (!field || list.length === 0) return "";
    const subFields = field.itemFields ?? [];
    const approx = config.approximately ? "approximately " : "";
    return list
      .map((d, i) => {
        const n = (options.indexOffset ?? 0) + i;
        const raw = asString(d.damageType);
        const loc = asString(d.location).trim();
        const notes = asString(d.notes).replace(/\s*\n+\s*/g, " ").trim();
        const tail = notes ? ` ${withPeriod(notes)}` : "";
        if (raw === "loose_palings") return `DEFECT::${n}::There are loose palings${loc ? ` at ${loc}` : ""}.${tail}`;
        if (raw === "loose_paling") return `DEFECT::${n}::A loose paling${loc ? ` at ${loc}` : ""}.${tail}`;
        if (raw === "gap") return `DEFECT::${n}::A gap${loc ? ` at ${loc}` : ""}.${tail}`;
        if (raw === "graffiti") return `DEFECT::${n}::There is graffiti${loc ? ` at ${loc}` : ""}.${tail}`;
        const isCrack = otherAnswerText(raw) === undefined && (!raw || raw === "cracking");
        if (!isCrack) {
          // The House sentence ("At the porch there is a chip to the rendered pier."), with the template's comma after the location.
          const text = houseDamageSentences({ ...inst, [key]: [d] }, itemFields, { key, indexOffset: n });
          return text.replace(/^(DEFECT::\d+::)(.+?) (there (?:is|are)) /, "$1$2, $3 ");
        }
        const before = !loc ? "There" : LOCATION_STARTS_WITH_PREPOSITION_RE.test(loc) ? `${capitalize(loc)}, there` : /^the\s/i.test(loc) ? `At ${loc}, there` : `At the ${loc}, there`;
        const subField = subFields.find((f) => f.gate?.fieldKey === "damageType" && f.gate.equals === "cracking");
        const subRaw = subField ? asString(d[subField.key]) : "";
        const subTyped = otherAnswerText(subRaw);
        const severity = subTyped !== undefined ? lower(typedCase(subTyped)) : subRaw ? lower((subField?.options?.find((o) => o.value === subRaw)?.label ?? subRaw).split(" (")[0]) : "";
        const element = asString(d.element).trim();
        const start = asString(d.crackStartLocation).trim();
        const end = asString(d.crackEndLocation).trim();
        // "vertical" / "diagonal" / "horizontal" sit before the noun ("a horizontal fine crack"); where it runs to is the template's "running to the {direction}".
        const dirRaw = asString(d.direction);
        const run = ["vertical", "diagonal", "horizontal"].includes(dirRaw) ? dirRaw : "";
        const running = end ? ` and running to the ${end}` : "";
        const w = Number(d.widthMm) || 0;
        const l = Number(d.lengthMm) || 0;
        const named = /\bcrack(s|ing)?$/i.test(severity);
        const noun = [run, severity ? (named ? severity : `${severity} crack`) : "crack"].filter(Boolean).join(" ");
        const size = [w > 0 ? `${approx}${num(w)} millimetres wide` : "", l > 0 ? `${approx}${num(l)} millimetres long` : ""].filter(Boolean).join(" and ");
        const sentence = `${before} is ${article(noun)} ${noun}${element ? ` to the ${element}` : ""}${start ? ` starting at ${start}` : ""}${running}.${size ? ` The crack is ${size}.` : ""}`;
        return `DEFECT::${n}::${sentence}${tail}`;
      })
      .join("\n\n");
  };
}
