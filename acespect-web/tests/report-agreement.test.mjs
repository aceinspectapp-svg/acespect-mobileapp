// Dilapidation / Residential House prints Houspect's Nov 2026 office-template wording: the Agreement ("Conditions for the
// Provision of the Report and Scope", clauses 1-19 with the template's own numbers) instead of the older SCOPE and 21 conditions,
// and the template's pool disclaimer, methodology paragraph and grade meanings. Other report types keep their own.
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
const { AGREEMENT_BLOCKS, AGREEMENT_TITLE, GRADE_MEANINGS_NOV2026, POOL_SPA_DISCLAIMER_NOV2026, DILAPIDATION_METHOD_NOV2026, printsAgreement } =
  await server.ssrLoadModule("/src/web/reportAgreement.ts");
const { reportProfileOf } = await server.ssrLoadModule("/src/web/wording/profile.ts");

const sections = AGREEMENT_BLOCKS.filter((b) => b.kind === "section");
const clause = (n) => AGREEMENT_BLOCKS.find((b) => b.kind === "clause" && b.n === n)?.text ?? "";

describe("Dilapidation / Residential House Agreement (Nov 2026 template)", () => {
  it("has the template's 19 numbered clauses, in order", () => {
    assert.equal(AGREEMENT_TITLE, "CONDITIONS FOR THE PROVISION OF THE REPORT AND SCOPE");
    assert.deepEqual(
      sections.map((s) => `${s.n} ${s.title}`),
      [
        "1 DEFINITIONS & INTERPRETATION", "2 HOUSPECT'S OBLIGATIONS", "3 CLIENT'S OBLIGATIONS", "4 SCOPE OF INSPECTION", "5 REPORT",
        "6 COMMON PROPERTY", "7 COPYRIGHT", "8 WHS AND ENVIRONMENT COMPLIANCE", "9 ACCURACY OF INFORMATION", "10 LIABILITY",
        "11 PAYMENT", "12 REFERRALS", "13 REPORT VARIATIONS", "14 DISPUTES", "15 DEFAULTS AND TERMINATION", "16 GST",
        "17 QUOTATION, ACCEPTANCE AND VALIDITY", "18 CONSUMER LAW AND VICTORIAN LEGISLATION", "19 PRIVACY",
      ],
    );
  });

  it("keeps the clause numbers the clauses refer to", () => {
    assert.match(clause("4.2"), /^The Inspection will be undertaken generally in accordance with AS 4349\.0/);
    assert.equal(clause("5.7"), "The Guide:");
    assert.match(clause("6.2"), /subject to Clause 6\.3/);
    assert.match(clause("10.3"), /^To the extent permitted by law, liability under any condition or warranty/);
    assert.match(clause("11.6"), /preferred client of Houspect, payment of the Price is due within 7 days/);
    assert.match(clause("14.3"), /within 21 days after the notice in Clause 14\.1/);
    assert.match(clause("19.6"), /info@houspectvic\.com\.au\.$/);
    assert.equal(AGREEMENT_BLOCKS.filter((b) => b.kind === "clause").length, 110);
  });

  it("has the template's subheadings, definitions and grade list", () => {
    assert.deepEqual(
      AGREEMENT_BLOCKS.filter((b) => b.kind === "subheading").map((b) => b.text),
      ["Standards and Guide", "Dilapidation Inspection", "Building Act 1993 (Vic) – Section 94", "Access and Site Conditions", "Inspection Limits and Exclusions"],
    );
    assert.ok(AGREEMENT_BLOCKS.some((b) => b.kind === "definition" && b.text.startsWith("“Houspect” means Acespect Pty Ltd trading as Houspect Victoria ABN 24 237 148 557")));
    // The template offers "Self-explanatory/newly built ..." as a choice; the report uses one meaning.
    assert.equal(GRADE_MEANINGS_NOV2026.New, "Newly built or constructed with none to minimal use.");
    assert.equal(GRADE_MEANINGS_NOV2026.Average, "Working but needs maintenance within 6 months.");
  });

  it("prints for Dilapidation / Residential House and Apartment only", () => {
    assert.equal(printsAgreement(reportProfileOf("Dilapidation", "Residential House")), true);
    // Apartment follows the Nov 2026 Multi Level Office Building template, whose terms are the same Agreement.
    assert.equal(printsAgreement(reportProfileOf("Dilapidation", "Apartment")), true);
    for (const [type, property] of [["Dilapidation", "Commercial Properties"], ["Dilapidation", "Public Assets"], ["Pre-Purchase", "Residential House"]]) {
      assert.equal(printsAgreement(reportProfileOf(type, property)), false, `${type} / ${property}`);
    }
  });

  it("words the pool disclaimer and the methodology paragraph as the template does", () => {
    assert.match(POOL_SPA_DISCLAIMER_NOV2026, /^The Houspect building inspector’s comments are observations only/);
    assert.match(POOL_SPA_DISCLAIMER_NOV2026, /\(licensed by the VBA\)\. Pool safety is important and requirements vary\. Please seek advice from your local council\. Houspect does not inspect pool pumps/);
    assert.match(DILAPIDATION_METHOD_NOV2026, /^This dilapidation report is the result of a visual inspection on the date noted on the report/);
  });
});
