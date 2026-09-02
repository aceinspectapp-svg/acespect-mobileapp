// Three independent fixes, all direct inspector feedback:
//
// Internal Areas / Rooms (residential house):
//   - "Sections obscured by" gains the same Other-needs-comment treatment as
//     every other section's obscuredBy field.
//   - Damages become mandatory once General condition includes Fair or Poor
//     (this field has no "Average" option, unlike the exterior sections --
//     its own scale is Satisfactory / Fair / Poor / New / Other). This is
//     also what exercises the `isRepeatRequirementMet` fix that lets a
//     requireWhen trigger read a chip-multiselect (General condition is
//     multi-select, e.g. "Fair" + "Other" both ticked at once), not just a
//     single-select like Condition elsewhere.
//   - The general-condition comments box added last turn (free-text) becomes
//     a tap-to-pick list of standard phrasing instead, since inspectors
//     would rather select than type on site -- plus its own Other-with-detail
//     box for anything not covered.
//
// Notes / Post Project / Defects:
//   - Drops the ad-hoc "Post project?" Yes/No from Residential House and the
//     equivalent "Post project inspection" toggle from Apartment. This was a
//     single checkbox standing in for what needs to be a proper inspection-
//     level mode (the "Post-Dilapidation" baseline-comparison feature) --
//     dropped here rather than left as a dead-end control. Apartment's other
//     three fields in that group (additional notes / comments / photos)
//     are generically useful on their own and are kept, just re-labelled
//     off "Post Project & Notes" since they're no longer post-project-only.
import { prisma } from '../lib/prisma';
import { TemplateField, TemplateFieldOption } from '../modules/templates/templates.schemas';

const INSPECTION_TYPE = 'dilapidation';

function mkOpts(labels: string[]): TemplateFieldOption[] {
  const seen = new Set<string>();
  return labels.map((label) => {
    let value = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'opt';
    let n = 2;
    while (seen.has(value)) value = `${value.slice(0, 57)}_${n++}`;
    seen.add(value);
    return { value, label };
  });
}
const opts = (...labels: string[]) => mkOpts(labels);

async function republish(propertyType: string, sectionKey: string, mutate: (fields: TemplateField[]) => TemplateField[]) {
  const published = await prisma.inspectionTemplate.findFirst({
    where: { inspectionType: INSPECTION_TYPE, propertyType, sectionKey, status: 'PUBLISHED' },
    orderBy: { version: 'desc' },
  });
  if (!published) throw new Error(`No published ${propertyType}/${sectionKey} template found`);

  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('no ADMIN user found');

  const fields = mutate(published.fields as unknown as TemplateField[]);

  const draft = await prisma.inspectionTemplate.create({
    data: {
      inspectionType: INSPECTION_TYPE, propertyType, sectionKey,
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
      where: { inspectionType: INSPECTION_TYPE, propertyType, sectionKey, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    }),
    prisma.inspectionTemplate.update({ where: { id: draft.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
  ]);

  // eslint-disable-next-line no-console
  console.log(`[rooms-notes-fixes] ${propertyType}/${sectionKey} -> v${draft.version}`);
}

async function main() {
  await republish('residential_house', 'internal_areas', (fields) => {
    const rooms = fields.find((f) => f.key === 'rooms');
    if (!rooms?.itemFields) throw new Error('internal_areas.rooms.itemFields not found -- shape changed');

    const obscuredByIdx = rooms.itemFields.findIndex((f) => f.key === 'obscuredBy');
    if (obscuredByIdx === -1) throw new Error('rooms.obscuredBy not found');
    rooms.itemFields.splice(obscuredByIdx + 1, 0, {
      key: 'obscuredByOther',
      type: 'textarea',
      label: 'If Other — specify',
      required: true,
      gate: { fieldKey: 'obscuredBy', equalsAny: ['other'] },
      order: 0,
    });

    const damages = rooms.itemFields.find((f) => f.key === 'damages');
    if (!damages) throw new Error('rooms.damages not found');
    damages.repeat = { ...(damages.repeat ?? { presentation: 'strip' }), requireWhen: { fieldKey: 'generalCondition', equals: ['fair', 'poor'] } };

    const commentsIdx = fields.findIndex((f) => f.key === 'generalConditionComments');
    if (commentsIdx === -1) throw new Error('generalConditionComments not found');
    fields[commentsIdx] = {
      key: 'generalConditionComments',
      type: 'chip-multiselect',
      label: 'Other general condition issues — note the areas affected',
      order: 0,
      sectionLetter: 'General',
      options: opts(
        'Bouncy / springy floor',
        'Sloping / uneven floor',
        'Binding doors',
        'Binding windows',
        'Cracking to walls',
        'Cracking to ceiling',
        'Water staining',
        'Mould / mildew',
        'Musty odour',
        'Other',
      ),
    };
    fields.splice(commentsIdx + 1, 0, {
      key: 'generalConditionCommentsOther',
      type: 'textarea',
      label: 'If Other — describe',
      required: true,
      gate: { fieldKey: 'generalConditionComments', equalsAny: ['other'] },
      sectionLetter: 'General',
      order: 0,
    });

    rooms.itemFields = rooms.itemFields.map((f, i) => ({ ...f, order: i }));
    return fields.map((f, i) => ({ ...f, order: i }));
  });

  await republish('residential_house', 'notes', (fields) => fields.filter((f) => f.key !== 'postProject').map((f, i) => ({ ...f, order: i })));

  await republish('apartment', 'notes', (fields) =>
    fields
      .filter((f) => f.key !== 'post_project_postProject')
      .map((f) => (f.sectionLetter === 'Post Project & Notes' ? { ...f, sectionLetter: 'Notes' } : f))
      .map((f, i) => ({ ...f, order: i })),
  );

  await prisma.$disconnect();
}

void main();
