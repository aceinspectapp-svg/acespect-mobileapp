// Seeds a realistic structured inspection (sections + damages + public photo
// URLs) assigned to the seeded reviewer, so the web app shows real data before
// the mobile submit path is wired. Run: npx tsx scripts/seedInspection.ts
import { prisma } from '../src/lib/prisma';
import { hashPassword } from '../src/utils/password';

const PHOTO = (id: string) => `https://images.unsplash.com/${id}?w=600&q=80`;
const HOUSE = PHOTO('photo-1568605114967-8130f3a36994');
const HOUSE2 = PHOTO('photo-1570129477492-45c003edd2be');
const CRACK = PHOTO('photo-1564558396203-c6bfb71b73e7');
const DRIVE = PHOTO('photo-1558618666-fcd25c85cd64');

async function upsertUser(
  email: string,
  name: string,
  role: 'INSPECTOR' | 'REVIEWER' | 'ADMIN',
  avatar: string,
  password: string,
) {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    update: { role, isActive: true },
    create: { email, name, passwordHash, role, avatar, region: 'VIC' },
  });
}

async function main() {
  const reviewer = await upsertUser('reviewer@acespect.app', 'Sarah Chen', 'REVIEWER', 'SC', 'Review123');
  const inspector = await upsertUser('jane@acespect.app', 'James Thompson', 'INSPECTOR', 'JT', 'Inspect123');
  await upsertUser('admin@acespect.app', 'Admin User', 'ADMIN', 'AU', 'Admin123');

  // Idempotent: drop any prior seed of this job (cascades to sections/damages).
  await prisma.inspection.deleteMany({ where: { jobNo: 'HV-24-0891' } });

  const inspection = await prisma.inspection.create({
    data: {
      jobNo: 'HV-24-0891',
      inspectorId: inspector.id,
      reviewerId: reviewer.id,
      address: '24 Smith Street',
      suburb: 'Fitzroy VIC 3065',
      client: 'BuildRight Construction Pty Ltd',
      inspectionType: 'Dilapidation',
      propertyType: 'Residential House',
      status: 'IN_REVIEW',
      overallProgress: 100,
      notes: 'Adjacent construction — 3-storey residential development.',
      date: new Date('2024-06-15'),
      submittedAt: new Date('2024-06-15T16:42:00'),
      sections: {
        create: [
          {
            key: 'job-info',
            name: 'Job Information',
            icon: '📋',
            order: 0,
            status: 'COMPLETE',
            reviewStatus: 'APPROVED',
            reportText:
              'Pre-construction dilapidation survey conducted at 24 Smith Street, Fitzroy on 15 June 2024 for BuildRight Construction Pty Ltd (Job No. HV-24-0891). Weather fine. Inspector: James Thompson.',
            fields: {
              clientName: 'BuildRight Construction Pty Ltd',
              jobNo: 'HV-24-0891',
              date: '2024-06-15',
              weather: 'Fine',
              inspector: 'James Thompson',
              address: '24 Smith Street, Fitzroy VIC 3065',
            },
            photos: [],
          },
          {
            key: 'description',
            name: 'Description & Overview',
            icon: '🏠',
            order: 1,
            status: 'COMPLETE',
            reviewStatus: 'APPROVED',
            reportText:
              'The subject property is a double-storey brick veneer residential dwelling estimated to be constructed circa 1985. Hipped tile roof, aluminium windows, timber fencing. The property appears to be in fair to average condition overall.',
            fields: { constructionType: 'House', constructedYear: 'circa 1985', roofDesign: 'Hipped' },
            photos: [HOUSE, HOUSE2],
          },
          {
            key: 'driveway',
            name: 'Driveway',
            icon: '🚗',
            order: 2,
            status: 'COMPLETE',
            reviewStatus: 'PENDING',
            reportText:
              'The driveway is constructed of exposed aggregate concrete and is in generally fair condition. One diagonal crack was observed measuring approximately 2mm wide × 450mm long, 2.1m from the garage door.',
            fields: { material: 'Exposed aggregate concrete', condition: 'Fair', drainage: 'Adequate' },
            // Raw answer tree matching the published "driveway" template (see
            // seed-templates.ts) -- without this, the template-driven web/
            // mobile field editor has nothing to walk and falls back to the
            // flat `fields` summary above, which only ever had 3 of the
            // template's 8 fields.
            answers: {
              items: [
                {
                  location: 'front',
                  material: 'exposed_aggregate',
                  condition: 'fair',
                  obstructions: [],
                  notableDamage: 'yes',
                  safetyHazard: 'no',
                  damages: [
                    {
                      damageType: 'crack',
                      location: '2.1m from garage door, centre of driveway',
                      direction: 'diagonal',
                      widthMm: '2',
                      lengthMm: '450',
                      notes: 'Consistent with thermal movement. No structural concern noted.',
                      photos: [CRACK],
                    },
                  ],
                  notes: '',
                  photos: [DRIVE],
                },
              ],
            },
            photos: [DRIVE],
            damages: {
              create: [
                {
                  type: 'Crack',
                  location: '2.1m from garage door, centre of driveway',
                  direction: 'Diagonal',
                  widthMm: 2,
                  lengthMm: 450,
                  notes: 'Consistent with thermal movement. No structural concern noted.',
                  photos: [CRACK],
                  order: 0,
                },
              ],
            },
          },
          {
            key: 'fences',
            name: 'Fences',
            icon: '🪵',
            order: 3,
            status: 'COMPLETE',
            reviewStatus: 'PENDING',
            reportText:
              'The front boundary is a 1.2m high painted timber paling fence in fair condition. Side boundaries are 1.8m timber paling. One section of the left boundary fence has a leaning post that requires monitoring.',
            fields: { frontFenceMaterial: 'Timber paling', frontFenceHeight: '1.2m' },
            photos: [],
            damages: {
              create: [
                {
                  type: 'Leaning',
                  location: 'Left boundary fence — 4m from front corner',
                  direction: 'Horizontal',
                  widthMm: 0,
                  lengthMm: 1200,
                  notes: 'One fence post is leaning outward (~1.2m section). Monitor post construction.',
                  photos: [],
                  order: 0,
                },
              ],
            },
          },
          {
            key: 'internal',
            name: 'Internal Areas',
            icon: '🛋️',
            order: 4,
            status: 'COMPLETE',
            reviewStatus: 'PENDING',
            reportText:
              'Internal areas inspected throughout. Entry, hallway, living and dining in satisfactory condition with minor surface cracking to the cornice junction. Kitchen, bathroom and laundry show minor grout deterioration typical of age.',
            fields: { generalCondition: 'Satisfactory to fair' },
            photos: [],
            damages: {
              create: [
                {
                  type: 'Crack',
                  location: 'Living room — cornice junction, north wall',
                  direction: 'Horizontal',
                  widthMm: 0.5,
                  lengthMm: 350,
                  notes: 'Minor surface crack, consistent with normal building movement.',
                  photos: [],
                  order: 0,
                },
              ],
            },
          },
          {
            key: 'notes',
            name: 'Notes & Post Project',
            icon: '📝',
            order: 5,
            status: 'COMPLETE',
            reviewStatus: 'PENDING',
            reportText:
              'Access to the rear yard was limited by stored construction materials from the adjacent site — photographed and noted as a limitation. No significant safety matters noted.',
            fields: { safetyMatters: 'No', postProject: 'No' },
            photos: [],
          },
        ],
      },
    },
    include: { sections: true },
  });

  // eslint-disable-next-line no-console
  console.log(
    `✅ seeded inspection ${inspection.id} (${inspection.jobNo}) with ${inspection.sections.length} sections\n` +
      `   inspector: jane@acespect.app / Inspect123\n` +
      `   reviewer:  reviewer@acespect.app / Review123`,
  );
  await prisma.$disconnect();
}

void main();
