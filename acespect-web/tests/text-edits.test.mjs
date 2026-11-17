// The reviewer's own wording of report text: remembered apart from the generated text, put back after a re-compose, and formatting.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const T = await server.ssrLoadModule("/src/web/textEdits.ts");

const gen = ["The driveway is concrete.", "PHOTOS::/api/v1/media/a", "There is minor cracking.", "COND::#16a34a::Satisfactory", "No defects were seen."].join("\n\n");

describe("remembering what the reviewer changed", () => {
  it("records a retyped, a removed and an added paragraph, and nothing for untouched ones", () => {
    const edited = ["The driveway is **broom-finished** concrete.", "PHOTOS::/api/v1/media/a", "COND::#16a34a::Satisfactory", "No defects were seen.", "Reviewer note: checked twice."].join("\n\n");
    const e = T.diffEdits(gen, edited);
    assert.deepEqual(e.lines, [
      { from: "The driveway is concrete.", to: "The driveway is **broom-finished** concrete." },
      { from: "There is minor cracking.", to: "" },
    ]);
    assert.deepEqual(e.added, [{ after: "No defects were seen.", text: "Reviewer note: checked twice." }]);
  });

  it("puts the edits back into the same text exactly", () => {
    const edited = ["Intro of my own.", "The driveway is concrete, sealed.", "PHOTOS::/api/v1/media/a", "There is minor cracking.", "COND::#16a34a::Satisfactory", "No defects were seen."].join("\n\n");
    const e = T.diffEdits(gen, edited);
    assert.equal(T.applyEdits(gen, e).text, edited);
  });

  it("keeps the reviewer's wording after the text is written again with other sentences changed", () => {
    const e = T.diffEdits(gen, gen.replace("There is minor cracking.", "There is minor cracking near the kerb."));
    const regenerated = gen.replace("No defects were seen.", "One defect was seen.");
    const out = T.applyEdits(regenerated, e);
    assert.ok(out.text.includes("There is minor cracking near the kerb."));
    assert.ok(out.text.includes("One defect was seen."));
    assert.equal(out.staleNow.length, 0);
  });

  it("keeps an edit aside as stale when the sentence it was made to has changed, never losing it", () => {
    const e = T.diffEdits(gen, gen.replace("There is minor cracking.", "There is minor cracking (reviewer wording)."));
    const regenerated = gen.replace("There is minor cracking.", "There is severe cracking.");
    const out = T.applyEdits(regenerated, e);
    assert.ok(out.text.includes("There is severe cracking."));
    assert.deepEqual(out.staleNow, [{ from: "There is minor cracking.", to: "There is minor cracking (reviewer wording)." }]);
    assert.deepEqual(out.edits.stale, out.staleNow);
    assert.equal(out.edits.lines, undefined);
  });

  it("tells repeated sentences apart", () => {
    const g = ["Room A.", "No defects were seen.", "Room B.", "No defects were seen."].join("\n\n");
    const edited = ["Room A.", "No defects were seen.", "Room B.", "A small chip was seen."].join("\n\n");
    const e = T.diffEdits(g, edited);
    assert.deepEqual(e.lines, [{ from: "No defects were seen.", to: "A small chip was seen.", n: 1 }]);
    assert.equal(T.applyEdits(g, e).text, edited);
  });

  it("keeps the Description sentences and stale edits it already had", () => {
    const e = T.diffEdits(gen, gen, { blocks: { works: "My works sentence." }, stale: [{ from: "x", to: "y" }] });
    assert.deepEqual(e, { blocks: { works: "My works sentence." }, stale: [{ from: "x", to: "y" }] });
    assert.equal(T.hasEdits({}), false);
    assert.equal(T.hasEdits(e), true);
  });
});

describe("what a line is", () => {
  it("keeps markers fixed and lets the words around them be retyped", () => {
    assert.deepEqual(T.anatomy("DEFECT::2::A crack in the slab."), { kind: "defect", prefix: "DEFECT::2::", text: "A crack in the slab.", editable: true });
    assert.equal(T.anatomy("PHOTOS::/a,/b").label, "2 photos print here");
    assert.equal(T.anatomy("PART::Driveway").editable, false);
    assert.equal(T.anatomy("COND::#16a34a::Fair").label, "Condition: Fair");
    assert.equal(T.anatomy("LEVEL 7").kind, "floor");
    assert.equal(T.anatomy("Plain words.").kind, "para");
  });
});

describe("formatting", () => {
  it("reads bold, italic, underline (nested) and the link slot", () => {
    assert.deepEqual(T.parseInline("a **b** *c* __d__ **__e__** [Click here] f"), [
      { text: "a " }, { text: "b", bold: true }, { text: " " }, { text: "c", italic: true }, { text: " " }, { text: "d", underline: true }, { text: " " },
      { text: "e", bold: true, underline: true }, { text: " " }, { text: "Click here", link: true }, { text: " f" },
    ]);
  });

  it("leaves ordinary text alone (a lone star, a multiplication, snake_case)", () => {
    assert.equal(T.hasInline("2 * 3 = 6 and file_name_here"), false);
    assert.equal(T.plainText("The **slab** is *fine*."), "The slab is fine.");
  });

  it("turns the editor's HTML back into marks, spaces outside the marks", () => {
    const el = (html) => ({ childNodes: parse(html) });
    assert.equal(T.htmlToMarkup(el("The <b>slab </b>is <i>fine</i>.")), "The **slab** is *fine*.");
    assert.equal(T.htmlToMarkup(el("<b><u>Both</u></b> and&nbsp;more")), "**__Both__** and more");
    assert.equal(T.markupToHtml("a **b** & <c>"), "a <b>b</b> &amp; &lt;c&gt;");
  });
});

// A tiny HTML reader for the test (b / i / u / text only), standing in for the browser's DOM.
function parse(html) {
  const root = { childNodes: [] };
  const stack = [root];
  for (const m of html.replace(/&nbsp;/g, " ").matchAll(/<(\/?)(\w+)>|([^<]+)/g)) {
    const top = stack[stack.length - 1];
    if (m[3]) top.childNodes.push({ nodeType: 3, textContent: m[3] });
    else if (!m[1]) {
      const node = { nodeType: 1, tagName: m[2].toUpperCase(), childNodes: [], style: {}, hasAttribute: () => false };
      top.childNodes.push(node);
      stack.push(node);
    } else stack.pop();
  }
  return root.childNodes;
}
