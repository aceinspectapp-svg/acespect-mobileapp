// The reviewer's Job Information form offers the fields of the report being reviewed: a Construction report gets the fields its own cover
// prints, a Dilapidation report (any property type) gets the Dilapidation cover's. Nothing from the other report type appears.
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
const { jobInfoFieldsFor } = await server.ssrLoadModule("/src/web/pages/reviewer/jobInfoFields.ts");
const { buildReportHeader } = await server.ssrLoadModule("/src/web/report.ts");

const keys = (type) => jobInfoFieldsFor({ type }).map((f) => f.key);
const DILAPIDATION_ONLY = ["yourReference", "propertyOwner", "propertyOwnerEmail", "purpose"];

describe("the reviewer's Job Information fields", () => {
  it("are the Construction cover's own for a Construction report, with nothing Dilapidation-only", () => {
    const got = keys("Construction Stage");
    assert.deepEqual(got, ["date", "clientName", "clientEmail", "jobNo", "address", "weather", "inspector", "inspectorRegistration"]);
    for (const k of DILAPIDATION_ONLY) assert.ok(!got.includes(k), `${k} is not on a Construction report`);
  });

  it("are the full Dilapidation set for a Dilapidation report", () => {
    const got = keys("Dilapidation");
    for (const k of DILAPIDATION_ONLY) assert.ok(got.includes(k), k);
    assert.equal(got.length, 12);
  });

  it("each is read by the report header (so an edit lands on the cover)", () => {
    const sections = [{ id: "s", key: "job-info", fields: { date: "2026-10-01", clientName: "C", clientEmail: "c@x.com", address: "1 A St", weather: "Dry", inspector: "I", inspectorRegistration: "R1" } }];
    const h = buildReportHeader({ type: "Construction Stage", propertyType: "Residential House", client: "x", jobNo: "J1", address: "a", suburb: "b", date: "2026-01-01", sections });
    assert.equal(h.clientName, "C");
    assert.equal(h.clientEmail, "c@x.com");
    assert.equal(h.property, "1 A St");
    assert.equal(h.weather, "Dry");
    assert.equal(h.inspector, "I");
    assert.equal(h.inspectorRegistration, "R1");
  });

  it("a Job Number the reviewer corrected is the report's Our Reference; left alone (or cleared), the inspection's own is", () => {
    const base = { type: "Construction Stage", propertyType: "Residential House", client: "x", jobNo: "J1", address: "a", suburb: "b", date: "2026-01-01" };
    const ref = (fields) => buildReportHeader({ ...base, sections: [{ id: "s", key: "job-info", fields }] }).ourReference;
    assert.equal(ref({ jobNo: "J1-CORRECTED" }), "J1-CORRECTED");
    assert.equal(ref({ jobNo: " J2 " }), "J2");
    assert.equal(ref({ jobNo: "" }), "J1");
    assert.equal(ref({}), "J1");
  });
});
