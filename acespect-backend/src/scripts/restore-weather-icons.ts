// Restores weather-tile icons lost when Weather was converted from
// single-select (select-tiles, which always rendered an icon -- falling
// back to a "?" glyph if one wasn't set) to chip-multiselect across every
// job-info template. The scripts that did that conversion
// (weather-multiselect-everywhere.ts, prepurchase-weather-general-
// comments.ts) rebuilt each option as a bare { value, label } pair and
// never carried the icon across -- a real bug in those scripts, not
// something specific to the 2026-09-18 reset (it would have dropped the
// icons in the live pre-reset DB too, the moment those scripts ran).
//
// The 6 icons for the original select-tiles options are recovered from
// seed-public-assets-job-info-optional.ts's own WEATHER_ICONS map (it
// added them to Public Assets "to match what the other profiles already
// carry" -- i.e. they're the same set every profile used before the
// multiselect conversion). Cloudy/Windy/Humid/Wet Conditions never had
// select-tiles icons (introduced alongside the multiselect conversion
// itself), so these are new, reasonable choices, not a restoration of
// something that existed before.
import { prisma } from '../lib/prisma';
import { TemplateField } from '../modules/templates/templates.schemas';

const WEATHER_ICONS: Record<string, string> = {
  overcast: 'cloudy-outline',
  dry: 'thermometer-outline',
  sunny: 'sunny-outline',
  intermittent_showers: 'partly-sunny-outline',
  rain: 'rainy-outline',
  other: 'ellipsis-horizontal-circle-outline',
  cloudy: 'cloud-outline',
  windy: 'flag-outline',
  humid: 'water-outline',
  wet_conditions: 'thunderstorm-outline',
};

async function main() {
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const templates = await prisma.inspectionTemplate.findMany({ where: { status: 'PUBLISHED', sectionKey: 'job-info' } });
  let touched = 0;

  for (const t of templates) {
    const fields = t.fields as unknown as TemplateField[];
    const idx = fields.findIndex((f) => f.key === 'weather');
    if (idx === -1) {
      console.log(`${t.inspectionType}/${t.propertyType}: no weather field -- skipped`);
      continue;
    }

    const options = fields[idx]!.options ?? [];
    let changed = false;
    const nextOptions = options.map((o) => {
      const icon = WEATHER_ICONS[o.value];
      if (!icon || o.icon === icon) return o;
      changed = true;
      return { ...o, icon };
    });
    if (!changed) {
      console.log(`${t.inspectionType}/${t.propertyType}: icons already set -- skipped`);
      continue;
    }

    const next = fields.map((f, i) => (i === idx ? { ...f, options: nextOptions } : f));
    touched += 1;
    const draft = await prisma.inspectionTemplate.create({
      data: {
        inspectionType: t.inspectionType, propertyType: t.propertyType, sectionKey: t.sectionKey,
        name: t.name,
        version: t.version + 1,
        status: 'DRAFT',
        fields: next as unknown as object,
        layout: (t.layout ?? null) as unknown as object,
        createdById: admin.id,
      },
    });
    await prisma.$transaction([
      prisma.inspectionTemplate.update({ where: { id: t.id }, data: { status: 'ARCHIVED' } }),
      prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
    ]);
    console.log(`${t.inspectionType}/${t.propertyType}/job-info -> v${draft.version}`);
  }

  console.log(`\nDONE -- ${touched} template(s) updated.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
