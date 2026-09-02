// Two fixes to apartment's section-nav sections (Elevations, Paving/Common
// Areas, Roof, Internal Areas), both direct inspector feedback:
//
// 1. The 21 `<prefix>_damages` fields just added (add-apartment-block-
//    defects.ts) never got their own `sectionLetter`. SectionNavRenderer
//    groups fields by `sectionLetter`, and buckets anything without one into
//    a fallback "General" tab -- so every new defect box got silently
//    pulled OUT of its own block (e.g. "External Walls") and dumped into a
//    stray "General" tab nobody was looking at. This -- not caching -- is
//    the actual reason "the defect specification box does not come" on
//    apartment kept reproducing even on a genuinely fresh inspection.
//    Fixed by copying each block's own sectionLetter onto its damages field.
//
// 2. Drops the Sub-Floor block (applicable/reason/comments/photos, no
//    condition of its own) from Elevations entirely, per direct request --
//    residential has no equivalent, and apartments are built on a slab.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const SECTIONS = ['elevations', 'paving_paths', 'roof_chimneys', 'internal_areas'];

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  for (const sectionKey of SECTIONS) {
    const published = await prisma.inspectionTemplate.findFirst({
      where: { status: 'PUBLISHED', inspectionType: 'dilapidation', propertyType: 'apartment', sectionKey },
      orderBy: { version: 'desc' },
    });
    if (!published) throw new Error(`apartment/${sectionKey} not found`);

    let fields = [...(published.fields as unknown as TemplateField[])];
    let changed = false;

    // Fix 1: give every damage-list its block's own sectionLetter.
    fields = fields.map((f) => {
      if (f.type !== 'damage-list' || f.sectionLetter) return f;
      const prefix = f.key.replace(/_damages$/, '');
      const sibling = fields.find((s) => s.key.startsWith(`${prefix}_`) && s.key !== f.key && s.sectionLetter);
      if (!sibling) throw new Error(`apartment/${sectionKey}: no sectionLetter sibling found for ${f.key}`);
      changed = true;
      return { ...f, sectionLetter: sibling.sectionLetter };
    });

    // Fix 2: drop the Sub-Floor block, Elevations only.
    if (sectionKey === 'elevations') {
      const before = fields.length;
      fields = fields.filter((f) => f.sectionLetter !== 'Sub-Floor');
      if (fields.length !== before) changed = true;
    }

    if (!changed) {
      // eslint-disable-next-line no-console
      console.log(`apartment/${sectionKey}: nothing to change`);
      continue;
    }

    const numbered = fields.map((f, i) => ({ ...f, order: i }));
    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType: 'dilapidation', propertyType: 'apartment', sectionKey,
        name: published.name,
        version: published.version + 1,
        status: 'DRAFT',
        fields: numbered as unknown as object,
        layout: (published.layout ?? null) as unknown as object,
        createdById: admin.id,
      },
    });
    await prisma.$transaction([
      prisma.inspectionTemplate.update({ where: { id: published.id }, data: { status: 'ARCHIVED' } }),
      prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
    ]);
    // eslint-disable-next-line no-console
    console.log(`apartment/${sectionKey} -> v${draft.version}`);
  }

  await prisma.$disconnect();
}

void main();
