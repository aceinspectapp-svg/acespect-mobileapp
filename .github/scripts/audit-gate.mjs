#!/usr/bin/env node
// CI security gate: `npm audit --omit=dev`, failing on any high or critical advisory, except the ones listed in ALLOWED below.
//
// An advisory goes on the list only when no fixed version of the package exists yet AND the package does not run in what we ship.
// Each entry has a date: after it the advisory fails the build again, so it is looked at again. If npm reports that an update
// now fixes an allowed advisory, the build fails too (update the lockfile and remove the entry).
//
//   node .github/scripts/audit-gate.mjs                 run in a package folder (uses its package-lock.json)
//   node .github/scripts/audit-gate.mjs --from a.json   check a saved `npm audit --json` report instead (for testing the gate)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ALLOWED = {
  'GHSA-fc5q-39xc-vjpf': {
    package: 'picomatch',
    until: '2027-01-31',
    why: 'ReDoS through crafted glob patterns; every picomatch release (<= 4.0.7) is affected and there is no fixed version yet. In the '
      + 'Android app it is only used by build tools (Expo CLI, Metro bundler config, React Native codegen via tinyglobby, jest-util '
      + 'via micromatch), with glob patterns from our own config; none of it is bundled into the app or runs on the phone.',
  },
};
const FAILING = new Set(['high', 'critical']);

const from = process.argv.indexOf('--from');
let raw;
if (from > 0) raw = readFileSync(process.argv[from + 1], 'utf8');
else {
  try { raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); }
  catch (e) { raw = e.stdout; } // npm audit exits 1 whenever it finds anything; the report is still on stdout
}
let report;
try { report = JSON.parse(raw); } catch { console.error('audit gate: npm audit did not return a report'); process.exit(1); }
if (report.error) { console.error(`audit gate: npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`); process.exit(1); }

const today = new Date().toISOString().slice(0, 10);
const vulns = report.vulnerabilities ?? {};
// The advisories themselves (a package that is "high" only because it depends on a vulnerable package is not one of these).
const advisories = new Map();
for (const v of Object.values(vulns)) {
  for (const via of v.via ?? []) {
    if (typeof via !== 'object') continue;
    const id = String(via.url ?? '').match(/GHSA-[\w-]+/)?.[0] ?? `npm-${via.source}`;
    if (!advisories.has(id)) advisories.set(id, { id, name: via.name, title: via.title, severity: via.severity, range: via.range, url: via.url });
  }
}

const failures = [], allowed = [];
for (const a of advisories.values()) {
  if (!FAILING.has(a.severity)) continue;
  const rule = ALLOWED[a.id];
  if (!rule || rule.package !== a.name) { failures.push(`${a.severity}: ${a.name} ${a.range} — ${a.title} (${a.url})`); continue; }
  if (today > rule.until) { failures.push(`${a.severity}: ${a.name} — ${a.id} was allowed until ${rule.until}; check it again (${a.url})`); continue; }
  if (vulns[a.name]?.fixAvailable === true) { failures.push(`${a.severity}: ${a.name} — ${a.id} now has a fix: update the lockfile and remove it from ALLOWED`); continue; }
  allowed.push(a);
}

const counts = report.metadata?.vulnerabilities ?? {};
console.log(`npm audit (shipped dependencies): ${Object.entries(counts).filter(([k, n]) => k !== 'total' && n).map(([k, n]) => `${n} ${k}`).join(', ') || 'none'}`);
for (const a of allowed) {
  const rule = ALLOWED[a.id];
  console.log(`::warning title=Allowed advisory ${a.id}::${a.name} ${a.range} — ${a.title}. Allowed until ${rule.until}: ${rule.why}`);
}
if (failures.length) {
  console.error(`\n${failures.length} high/critical advisor${failures.length === 1 ? 'y' : 'ies'} not allowed:`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`audit gate passed: no high or critical advisories${allowed.length ? ` other than ${allowed.map((a) => a.id).join(', ')} (see the warning)` : ''}.`);
