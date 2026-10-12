import { readFileSync } from 'fs';
import { prisma } from '../lib/prisma';
import { templateFieldSchema } from '../modules/templates/templates.schemas';
import { templatableKeysFor } from '../modules/templates/templates.sections';

const PALETTE = new Set(['#1FA463', '#E63329', '#E8A33D', '#94A1B2']);
const problems: string[] = [];
const bad = (m: string) => problems.push(m);

function walk(fields: any[], where: string) {
  const keys = new Set<string>();
  for (const f of fields) {
    const parsed = templateFieldSchema.safeParse(f);
    if (!parsed.success) bad(`${where}.${f.key}: schema: ${parsed.error.issues[0]?.message}`);
    if (keys.has(f.key)) bad(`${where}: duplicate key ${f.key}`);
    keys.add(f.key);
    if (f.sectionLetter && f.sectionLetter.length > 100) bad(`${where}.${f.key}: sectionLetter too long`);
    if (f.options) {
      const vals = new Set<string>();
      for (const o of f.options) {
        if (vals.has(o.value)) bad(`${where}.${f.key}: duplicate option value ${o.value}`);
        vals.add(o.value);
        if (o.color && !PALETTE.has(o.color) && f.type === 'pill-select' && f.defectOn) bad(`${where}.${f.key}: unknown colour ${o.color}`);
      }
      if (f.defectOn) for (const v of f.defectOn) if (!vals.has(v)) bad(`${where}.${f.key}: defectOn "${v}" is not an option`);
    }
    if (f.defectOn && f.type !== 'pill-select') bad(`${where}.${f.key}: defectOn on a ${f.type}`);
    if (f.type === 'pill-select' && f.options?.some((o: any) => o.color === '#E63329') && !f.defectOn && f.sectionLetter !== undefined && !/result/i.test(f.label)) bad(`${where}.${f.key}: has a red choice but no defectOn`);
    if (f.itemFields) walk(f.itemFields, `${where}.${f.key}`);
  }
  for (const f of fields) if (f.gate && f.gate.fieldKey !== 'constructionStage' && !keys.has(f.gate.fieldKey)) bad(`${where}.${f.key}: gate on missing field ${f.gate.fieldKey}`);
}

(async () => {
  const mobile = readFileSync('../acespect-mobile/src/constants/constructionStages.ts', 'utf8');
  const stages = [...mobile.matchAll(/id: '(pre_pour|slab|framework|lock_up|fixing|pci|slab_frame|lock_fix)',\s*\n\s*title/g)].map((m) => m[1]!);
  const stageBlocks = mobile.split(/\n  \{\n    id: '/).slice(1);
  const hub: Record<string, { id: string; props?: string[] }[]> = {};
  for (const b of stageBlocks) {
    const id = b.slice(0, b.indexOf("'"));
    hub[id] = [...b.matchAll(/\{ id: '([a-z_]+)', title: '[^']*', group: '[^']*', icon: '[^']*'(?:, propertyTypes: \[([^\]]*)\])? \}/g)].map((m) => ({ id: m[1]!, props: m[2] ? [...m[2].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!) : undefined }));
  }
  console.log('mobile stages:', Object.keys(hub).join(', '), '| sections per stage:', Object.entries(hub).map(([k, v]) => `${k}=${v.length}`).join(' '));
  const registry = new Set(templatableKeysFor('construction_stage'));

  for (const prop of ['residential_house', 'apartment']) {
    const rows = await prisma.inspectionTemplate.findMany({ where: { inspectionType: 'construction_stage', propertyType: prop, status: 'PUBLISHED' } });
    const byKey = new Map<string, number>();
    for (const r of rows) byKey.set(r.sectionKey, (byKey.get(r.sectionKey) ?? 0) + 1);
    for (const [k, n] of byKey) if (n > 1) bad(`${prop}/${k}: ${n} published versions`);
    const published = new Set(rows.filter((r) => /^(pp|sd|fr|lu|fx|pci|sf|lf)_/.test(r.sectionKey) || r.sectionKey === 'job-info').map((r) => r.sectionKey));
    // every published stage template is in the server's section list, and the other way round
    for (const k of published) if (k !== 'job-info' && !registry.has(k)) bad(`${prop}/${k}: published but not in the admin section list`);
    for (const k of registry) if (!published.has(k)) { if (!(prop === 'apartment' && k === 'pci_site_facilities')) bad(`${prop}/${k}: in the admin section list but not published`); }
    // mobile hub == published templates, per stage
    const hubKeys = new Set<string>();
    for (const [stage, secs] of Object.entries(hub)) {
      const want = secs.filter((s) => !s.props || s.props.includes(prop)).map((s) => s.id);
      for (const id of want) { hubKeys.add(id); if (!published.has(id)) bad(`${prop}/${stage}: the app lists ${id} but no template is published`); }
    }
    for (const k of published) if (k !== 'job-info' && !hubKeys.has(k)) bad(`${prop}/${k}: published but no app stage lists it`);
    for (const r of rows) walk(r.fields as any[], `${prop}/${r.sectionKey}`);
    const ji = rows.find((r) => r.sectionKey === 'job-info');
    const jf = (ji?.fields as any[]) ?? [];
    const gates = jf.filter((f) => f.key.startsWith('stageOption')).map((f) => `${f.key}[${f.gate?.equals}]`).join(' ');
    console.log(`${prop}: ${rows.length} templates; job-info v${ji?.version} fields=${jf.length}; ${gates}`);
    for (const gone of ['reportEmailed', 'photosInEgnyte', 'photosTotal']) if (jf.some((f) => f.key === gone)) bad(`${prop}/job-info still has ${gone}`);
    const comments = jf.find((f) => f.key === 'comments');
    const cg = (comments?.gate?.equalsAny ?? []).join(',');
    if (cg !== 'pre_pour,slab,framework,slab_frame') bad(`${prop}/job-info comments gate is ${cg}`);
    const defectRows = rows.reduce((n, r) => n + ((r.fields as any[]).filter((f) => f.defectOn?.length).length), 0);
    console.log(`  rows that open the defect form: ${defectRows}`);
  }
  console.log(problems.length ? `PROBLEMS (${problems.length}):\n  ${problems.slice(0, 60).join('\n  ')}` : 'AUDIT CLEAN');
  await prisma.$disconnect();
})();
