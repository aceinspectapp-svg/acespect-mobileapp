// Condition tags and Condition Summary pills must be readable: the text on every grade's tag clears WCAG AA (4.5:1) for small text, and the Construction report keeps its own colours.
//
// Run with: npm test
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({ root: webRoot, server: { middlewareMode: true }, logLevel: "error" });
after(() => server.close());
const { GRADE_LEGEND, conditionTagColors, contrastRatio } = await server.ssrLoadModule("/src/web/conditionGrades.ts");

describe("condition tag contrast", () => {
  for (const g of GRADE_LEGEND) {
    it(`${g.label}: tag text is at least 4.5:1 on its fill`, () => {
      const c = conditionTagColors(g.color);
      assert.ok(contrastRatio(c.text, c.fill) >= 4.5, `${g.label} ${contrastRatio(c.text, c.fill).toFixed(2)}:1`);
      assert.equal(c.bar, g.color);
    });
  }

  it("a template-supplied colour is darkened until it reads", () => {
    for (const color of ["#facc15", "#ffff00", "#22d3ee"]) {
      const c = conditionTagColors(color);
      assert.ok(contrastRatio(c.text, c.fill) >= 4.5, color);
    }
  });
});

describe("brand colours stay on the Dilapidation report", () => {
  const view = readFileSync(resolve(webRoot, "src/web/pages/ReportView.tsx"), "utf8");
  it("the brand variables are applied only when the report is not a Construction one", () => {
    assert.match(view, /\.\.\.\(construction \? \{\} : DILAPIDATION_BRAND\)/);
  });
  it("the Construction report sets no brand colours of its own", () => {
    const src = readFileSync(resolve(webRoot, "src/web/construction/ConstructionReport.tsx"), "utf8");
    assert.doesNotMatch(src, /DILAPIDATION_BRAND|--report-accent/);
  });
});
