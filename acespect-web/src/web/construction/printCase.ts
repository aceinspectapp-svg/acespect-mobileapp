/**
 * How the Construction Stage report prints names and chosen options, so their capitals match Houspect's office templates
 * ("ACESPECT Pre-pour_Office Template Nov 2026.dotm": "Water Supply to Site", "Reinforcing in Position"; Weather "Dry", "Sunny",
 * "Intermittent Showers", "Rain"). The one place this is decided.
 *
 * Print only: nothing here changes a stored answer, an option value or the section's report text. The report applies it as it prints
 * (ConstructionReport.tsx), so the web page, the PDF and the Word report -- all made from that page -- print the same text, and code
 * that compares answers ("sunny", "no") is untouched. Only capitals change, never the words.
 */

/** Words the templates keep in lower case inside a name ("Site Toilet in Position", "Retaining Walls as per Plan", "Formwork Pegged and Secure"). */
const SMALL = new Set(["a", "an", "the", "and", "or", "and/or", "nor", "but", "to", "in", "of", "on", "at", "by", "for", "as", "per", "via", "with", "from", "into", "onto", "re", "vs", "x", "eg", "ie", "etc"]);
/** Units stay as written after a number ("> 25 mm", "12 metre spacings", "22.5 degrees"). */
const UNITS = new Set(["mm", "cm", "m", "metre", "metres", "degrees"]);

const hasLetter = (s: string) => /[a-z]/i.test(s);

/** One word, capitalised unless it is a small word: "supply" -> "Supply", "AS1684"/"WP"/"OK" kept, "wall/s" -> "Wall/s", "set-downs" -> "Set-downs". */
function titleWord(word: string, first: boolean, afterNumber: boolean, last = false): string {
  const m = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9]*)$/.exec(word)!;
  const [, lead, core, tail] = m;
  if (!core || !hasLetter(core)) return word;
  const bare = core.toLowerCase();
  if (afterNumber && UNITS.has(bare)) return word;
  if (!first && !last && SMALL.has(bare)) return word;
  // Each part between slashes is its own word ("Heat/Cool", "OK/Clear", "Double/Single"); a one-letter plural ending ("wall/s") is not.
  const parts = core.split("/").map((p, i) => (i > 0 && p.length < 2 ? p : capFirst(p)));
  return `${lead}${parts.join("/")}${tail}`;
}

/** Capital first letter; the rest as written (keeps "AS1684", "GPO’s", "Part A", "Set-downs"). A word that starts with a number is left alone. */
const capFirst = (w: string) => (/^[a-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w);

/**
 * A checklist item's name in the templates' Title Case: "Water supply to site" -> "Water Supply to Site", "Termite Part A (collars at
 * penetrations)" -> "Termite Part A (Collars at Penetrations)". The first word, and the first word after " — ", ". ", "? ", ": " or "(",
 * is always capitalised, and so is the last word ("Gas Supply On"); inside brackets a small word stays small ("(eg; 200mm clearance …)").
 */
export function itemName(name: string): string {
  if (!name) return name;
  const words = name.split(/(\s+)/);
  const lastAt = words.map((w) => /\S/.test(w)).lastIndexOf(true);
  let first = true;
  let prev = "";
  return words
    .map((w, i) => {
      if (/^\s+$/.test(w) || w === "") return w;
      const out = titleWord(w, first, /^[~<>]?\d/.test(prev), i === lastAt);
      first = w === "—" || w === "–" || w === "-" || /[.?:]$/.test(w);
      prev = w;
      return out;
    })
    .join("");
}

/** A line that opens with the item's name ("Slab formwork dimensions. Please refer …") with that name printed in Title Case; any other line as it is. */
export function withItemName(line: string, item: string): string {
  return item && line.startsWith(item) ? `${itemName(item)}${line.slice(item.length)}` : line;
}

/** The office templates' wording of each choice, by field: the forms store "sunny"; the template prints "Sunny". */
const TEMPLATE_OPTION_TEXT: Record<string, Record<string, string>> = {
  // Template: "Dry / Sunny / Intermittent showers / Rain"; "Intermittent Showers" as the form's own label words it. "Overcast" is the form's own extra choice.
  weather: { sunny: "Sunny", dry: "Dry", intermittent_showers: "Intermittent Showers", rain: "Rain", overcast: "Overcast" },
};

/**
 * A chosen option as the template prints it, whether the stored value ("sunny", "intermittent_showers") or a label in any case
 * ("Intermittent Showers") is given. A typed "Other" answer prints exactly as typed; anything unknown is left as it is.
 */
export function optionText(field: keyof typeof TEMPLATE_OPTION_TEXT | string, raw: string): string {
  const text = raw ?? "";
  if (text.startsWith("__other__:")) return text.slice("__other__:".length).trim();
  const map = TEMPLATE_OPTION_TEXT[field];
  if (!map) return text;
  const key = text.trim().toLowerCase().replace(/\s+/g, "_");
  return map[key] ?? text;
}
