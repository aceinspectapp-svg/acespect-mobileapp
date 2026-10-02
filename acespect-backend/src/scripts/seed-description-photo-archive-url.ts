// Adds one new field ("photoArchiveUrl", a plain text URL field) to the
// Dilapidation x Residential House "Description & Overview" template, so the
// full-photo-archive link can be captured as ordinary template data --
// stored in the section's existing `answers`/`fields` JSON columns, exactly
// like every other description field -- rather than a new database column.
// Reads the current published template's own fields programmatically
// (rather than hardcoding the other ~31 fields from memory) and appends one,
// so nothing else about the template can drift from what's actually live.
//
// Because this is a plain "text" field (the most basic type, already used
// for several other fields on this exact template, e.g. "Project site
// address"), both the web reviewer's generic Field Data editor and the
// mobile inspector app's own generic template-driven form renderer pick it
// up automatically -- no app code change needed on either side for the
// input field itself to appear.
import { prisma } from '../lib/prisma';

const INSPECTION_TYPE = 'dilapidation';
const PROPERTY_TYPE = 'residential_house';
const SECTION_KEY = 'description';
const FIELD_KEY = 'photoArchiveUrl';

async function main() {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error('No published residential description template found');

  const existingFields = published.fields as Array<Record<string, unknown>>;
  if (existingFields.some((f) => f.key === FIELD_KEY)) {
    // eslint-disable-next-line no-console
    console.log(`[description-photo-archive-url] v${published.version} already has "${FIELD_KEY}" -- nothing to do`);
    await prisma.$disconnect();
    return;
  }

  const newField = {
    key: FIELD_KEY,
    type: 'text',
    label: 'Photo Archive Link (full-download URL, e.g. Dropbox/Drive folder)',
    order: existingFields.length,
    sectionLetter: 'Property & Project Site Overview',
  };
  const fields = [...existingFields, newField];

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: INSPECTION_TYPE,
      propertyType: PROPERTY_TYPE,
      sectionKey: SECTION_KEY,
      name: published.name,
      version: published.version + 1,
      status: 'DRAFT',
      fields: fields as unknown as object,
      layout: (published.layout ?? null) as unknown as object,
      createdById: admin.id,
    },
  });

  await prisma.$transaction([
    prisma.inspectionTemplate.updateMany({
      where: { inspectionType: INSPECTION_TYPE, propertyType: PROPERTY_TYPE, sectionKey: SECTION_KEY, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    }),
    prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
  ]);

  // eslint-disable-next-line no-console
  console.log(`[description-photo-archive-url] published v${draft.version} (${fields.length} fields, added "${FIELD_KEY}")`);
  await prisma.$disconnect();
}

void main();
