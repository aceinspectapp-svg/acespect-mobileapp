// The office templates offer choices that follow the inspector's registration: the cover's "(Builder / Architect / Inspection
// Registration No ...)" and the purpose's "a licensed builder / building consultant / building practitioner". Each report prints one.
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
const { registrationLabel, defaultPurposeFor } = await server.ssrLoadModule("/src/web/report.ts");

const HOUSE = { type: "Dilapidation", propertyType: "Residential House" };
const APT = { type: "Dilapidation", propertyType: "Apartment" };

describe("choices that follow the inspector's registration", () => {
  it("labels the registration on the cover as the template does", () => {
    assert.equal(registrationLabel("DBU 42135"), "(Builder Registration No DBU 42135)");
    assert.equal(registrationLabel("ARBV 13238"), "(Architect Registration No ARBV 13238)");
    assert.equal(registrationLabel("INL 41888"), "(Inspection Registration No. INL 41888)");
    assert.equal(registrationLabel(""), "");
  });

  it("picks one of builder / building consultant / building practitioner for the purpose", () => {
    assert.match(defaultPurposeFor(HOUSE, "Con Efremidis", "DBU 42135"), /insofar as a licensed builder can reasonably identify/);
    assert.match(defaultPurposeFor(HOUSE, "Trevor Scott", "ARBV 13238"), /insofar as a licensed building consultant can reasonably identify/);
    assert.match(defaultPurposeFor(APT, "Peter Shearer", "INL 41888"), /insofar as a licensed building practitioner can reasonably identify/);
    // no registration on file: Trevor Scott is still a building consultant, anyone else a builder
    assert.match(defaultPurposeFor(HOUSE, "Trevor Scott"), /a licensed building consultant/);
    assert.match(defaultPurposeFor(HOUSE, "James Thompson"), /a licensed builder can/);
    for (const p of [defaultPurposeFor(HOUSE, "x", "DBU 1"), defaultPurposeFor(APT, "x", "DBU 1")]) assert.ok(!p.includes("/"), "never prints the list of choices");
  });

  it("keeps each template's own purpose wording", () => {
    assert.match(defaultPurposeFor(HOUSE, "x", "DBU 1"), /in relation to project works nearby/);
    assert.match(defaultPurposeFor(APT, "x", "DBU 1"), /in relation to the project works nearby/);
  });
});
