// Read-only: for apartment's section-nav sections, every field without its
// own `sectionLetter` falls into SectionNavRenderer's fallback "General"
// bucket -- lists every such field, grouped by section.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const SECTIONS = ['elevations', 'paving_paths', 'roof_chimneys', 'internal_areas'];

async function main() {
  for (const sectionKey of SECTIONS) {
    const t = await prisma.inspectionTemplate.findFirst({
      where: { status: 'PUBLISHED', inspectionType: 'dilapidation', propertyType: 'apartment', sectionKey },
      orderBy: { version: 'desc' },
    });
    if (!t) continue;
    const fields = t.fields as unknown as TemplateField[];
    const missing = fields.filter((f) => !f.sectionLetter);
    console.log(`${sectionKey} v${t.version}: ${missing.length} field(s) without sectionLetter`);
    missing.forEach((f) => console.log(`   ${f.key} (${f.type})`));
  }
  await prisma.$disconnect();
}
void main();
