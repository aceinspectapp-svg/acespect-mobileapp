// Shared by the align-*-form-to-inspector-template scripts: additive, idempotent edits to a published template's fields,
// and the three ways to run them (rewrite the snapshot, dry-run against the database, publish).
//
//   npx tsx src/scripts/<script>.ts --snapshot   # rewrite prisma/templates-snapshot.json
//   npx tsx src/scripts/<script>.ts              # dry run against the database
//   npx tsx src/scripts/<script>.ts --apply      # publish new template versions
//
// Nothing here renames or removes a field key, so inspections already in progress keep their answers.
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export type Option = { label: string; value: string; [k: string]: unknown };
export type Field = {
  key: string;
  type: string;
  label: string;
  order: number;
  required?: boolean;
  options?: Option[];
  allowOther?: boolean;
  gate?: unknown;
  repeat?: { fixedInstances?: { key: string; label: string }[]; [k: string]: unknown };
  itemFields?: Field[];
  [k: string]: unknown;
};

export const slug = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** A field by key, searching nested item fields too. */
export const find = (fields: Field[], key: string): Field | undefined => {
  for (const f of fields) {
    if (f.key === key) return f;
    const inner = f.itemFields ? find(f.itemFields, key) : undefined;
    if (inner) return inner;
  }
  return undefined;
};

/** Renumber `order` to the array position, so a field inserted in the middle sorts there. */
export const renumber = (fields: Field[]): void => fields.forEach((f, i) => (f.order = i));

/** Adds the options a field lacks (matched by label), before `before` when given. True if any were added. */
export function addOptions(field: Field | undefined, labels: string[], before?: string): boolean {
  if (!field?.options) return false;
  let changed = false;
  for (const label of labels) {
    if (field.options.some((o) => o.label === label)) continue;
    const option = { label, value: slug(label) };
    const at = before ? field.options.findIndex((o) => o.label === before) : -1;
    if (at >= 0) field.options.splice(at, 0, option);
    else field.options.push(option);
    changed = true;
  }
  return changed;
}

/** Inserts a field after `afterKey` (at the top when null), unless a field with that key is already in the list. */
export function addFieldAfter(fields: Field[], afterKey: string | null, def: { key: string; type: string; label: string; [k: string]: unknown }): boolean {
  if (fields.some((f) => f.key === def.key)) return false;
  const at = afterKey === null ? 0 : fields.findIndex((f) => f.key === afterKey) + 1;
  fields.splice(at <= 0 && afterKey !== null ? fields.length : at, 0, { ...def, order: 0 } as Field);
  renumber(fields);
  return true;
}

/** Sets the labels / order of a group's fixed instances; an instance the inspector already has under another key stays, after the wanted ones. */
export function relabelFixed(group: Field, wanted: { key: string; label: string }[]): boolean {
  const current = group.repeat?.fixedInstances ?? [];
  const next = wanted.map((w) => ({ key: w.key, label: w.label }));
  for (const i of current) if (!wanted.some((w) => w.key === i.key)) next.push(i);
  if (JSON.stringify(next) === JSON.stringify(current)) return false;
  group.repeat = { ...(group.repeat ?? {}), fixedInstances: next };
  return true;
}

interface SnapshotRow {
  inspectionType: string;
  propertyType: string;
  sectionKey: string;
  name: string;
  version: number;
  fields: Field[];
}

/** Runs `alignSection` over one profile's sections in the snapshot file or the database, per the command-line flag. */
export async function runAlignment(
  profile: { inspectionType: string; propertyType: string },
  sections: readonly string[],
  alignSection: (sectionKey: string, fields: Field[]) => boolean,
): Promise<void> {
  const mode = process.argv.includes('--snapshot') ? 'snapshot' : process.argv.includes('--apply') ? 'apply' : 'dry-run';

  if (mode === 'snapshot') {
    const path = join(__dirname, '..', '..', '..', 'prisma', 'templates-snapshot.json');
    const rows: SnapshotRow[] = JSON.parse(readFileSync(path, 'utf-8'));
    let n = 0;
    for (const row of rows) {
      if (row.inspectionType !== profile.inspectionType || row.propertyType !== profile.propertyType) continue;
      if (!sections.includes(row.sectionKey)) continue;
      if (alignSection(row.sectionKey, row.fields)) {
        row.version += 1;
        n += 1;
        console.log(`  changed ${row.sectionKey} -> v${row.version}`);
      }
    }
    if (n > 0) writeFileSync(path, JSON.stringify(rows, null, 2) + '\n');
    console.log(`${n} section(s) updated in ${path}`);
    return;
  }

  // database: work on whatever is PUBLISHED now, so later admin edits are kept
  const { prisma } = await import('../../lib/prisma');
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');
  let changedCount = 0;
  for (const sectionKey of sections) {
    const published = await prisma.inspectionTemplate.findFirst({ where: { ...profile, sectionKey, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
    if (!published) {
      console.log(`  ${sectionKey}: nothing published, skipped`);
      continue;
    }
    const fields = JSON.parse(JSON.stringify(published.fields)) as Field[];
    if (!alignSection(sectionKey, fields)) {
      console.log(`  ${sectionKey}: already aligned`);
      continue;
    }
    changedCount += 1;
    console.log(`  ${sectionKey}: ${mode === 'apply' ? 'publishing' : 'would publish'} v${published.version + 1}`);
    if (mode !== 'apply') continue;
    await prisma.$transaction(async (tx) => {
      await tx.inspectionTemplate.updateMany({ where: { ...profile, sectionKey, status: 'PUBLISHED' }, data: { status: 'ARCHIVED' } });
      await tx.inspectionTemplate.create({
        data: { ...profile, sectionKey, name: published.name, version: published.version + 1, status: 'PUBLISHED', publishedAt: new Date(), fields: fields as object, createdById: admin.id },
      });
    });
  }
  console.log(`${changedCount} section(s) ${mode === 'apply' ? 'published' : 'would change (dry run - add --apply)'}.`);
  await prisma.$disconnect();
}
