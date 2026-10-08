/**
 * Construction Stage inspections: publishes the form of every stage that has been built, for Residential House and
 * Apartment (the same form for both). One Construction Stage profile carries all stages; each stage's sections have their
 * own key prefix (see templates.sections.ts), and Job Information ("job-info") is shared by every stage.
 *
 *   Stage A1 Pre-Pour   pp_*   -- lib/constructionPrePour.ts
 *   Stage 1  Slab Down  sd_*   -- lib/constructionSlabDown.ts
 *   Stage 2  Framework  fr_*   -- lib/constructionFrame.ts
 *   Stage 3  Lock Up    lu_*   -- lib/constructionLockUp.ts
 *   Stage 4  Fixing     fx_*   -- lib/constructionFixing.ts
 *   Combo    Slab & Frame       sf_*  -- lib/constructionCombos.ts
 *   Combo    Lock Up & Fixing   lf_*  -- lib/constructionCombos.ts
 *   Stage 5  PCI        pci_*  -- lib/constructionPci.ts (the House and Apartment forms differ, so each gets its own content)
 *
 *   npx tsx src/scripts/seed-construction-stages.ts     (idempotent: unchanged templates are skipped; also runs on every server start)
 */
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';
import { INSPECTION_TYPE, PROPERTY_TYPES, SectionDef, jobInfoFields, publish } from './lib/constructionTemplates';
import { PRE_POUR_SECTIONS } from './lib/constructionPrePour';
import { SLAB_DOWN_SECTIONS } from './lib/constructionSlabDown';
import { FRAME_SECTIONS } from './lib/constructionFrame';
import { LOCK_UP_SECTIONS } from './lib/constructionLockUp';
import { FIXING_SECTIONS } from './lib/constructionFixing';
import { pciSections } from './lib/constructionPci';
import { LOCK_FIX_SECTIONS, SLAB_FRAME_SECTIONS } from './lib/constructionCombos';

const STAGES: SectionDef[] = [...PRE_POUR_SECTIONS, ...SLAB_DOWN_SECTIONS, ...FRAME_SECTIONS, ...LOCK_UP_SECTIONS, ...FIXING_SECTIONS, ...SLAB_FRAME_SECTIONS, ...LOCK_FIX_SECTIONS];

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');
  for (const propertyType of PROPERTY_TYPES) {
    const existing = await prisma.inspectionTemplate.findFirst({ where: { inspectionType: INSPECTION_TYPE, propertyType, sectionKey: 'job-info', status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
    if (!existing) throw new Error(`no published Job Information template for ${INSPECTION_TYPE}/${propertyType} to build on`);
    await publish(admin.id, propertyType, 'job-info', existing.name, jobInfoFields(existing.fields as unknown as TemplateField[]));
    for (const s of [...STAGES, ...pciSections(propertyType as 'residential_house' | 'apartment')]) await publish(admin.id, propertyType, s.key, s.name, s.fields);
  }
  await prisma.$disconnect();
}

// Runs at every server start, so a failure must never keep the server from booting: log it and carry on.
void main().catch(async (e) => {
  console.error('⚠️  Could not seed the Construction Stage templates.', e);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(0);
});
