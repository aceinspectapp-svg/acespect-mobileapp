export type Role = "inspector" | "reviewer" | "admin";
export type InspectionStatus = "draft" | "submitted" | "in-review" | "approved" | "rejected";
export type SectionReviewStatus = "pending" | "approved" | "revision-requested";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar: string;
  phone?: string;
  region?: string;
}

export interface DamageRecord {
  id: string;
  type: string;
  location: string;
  direction: string;
  widthMm: number;
  lengthMm: number;
  notes: string;
  photos: string[];
}

export interface FormSection {
  id: string;
  key?: string; // stable slug from backend ("driveway", …); mock uses `id` as the slug
  name: string;
  icon: string;
  status: "complete" | "partial" | "pending";
  reviewStatus: SectionReviewStatus;
  reviewComment: string;
  reportText: string;
  fields: Record<string, string | string[] | number | boolean>;
  damages: DamageRecord[];
  photos: string[];
}

export interface Inspection {
  id: string;
  jobNo: string;
  address: string;
  suburb: string;
  client: string;
  inspectorId: string;
  reviewerId: string | null;
  date: string;
  submittedAt: string | null;
  type: string;
  propertyType: string;
  status: InspectionStatus;
  overallProgress: number;
  sections: FormSection[];
  notes: string;
}

/* ─── Inspection templates (admin-defined form structure) ──────────── */
export type TemplateStatus = "draft" | "published" | "archived";
export type TemplateFieldType =
  | "text" | "textarea" | "numeric" | "date"
  | "yesno"
  | "pill-select"
  | "select-tiles"
  | "color-select"
  | "chip-multiselect"
  | "photos"
  | "repeating-group"
  | "damage-list";

export interface TemplateFieldOption {
  value: string;
  label: string;
  icon?: string;
  color?: string;
}

/** Generalizes "hasDamage === 'yes' reveals the damages list" to any field. */
export interface FieldGate {
  fieldKey: string;
  equals: string;
}

export interface RepeatConfig {
  presentation: "strip" | "fixed-tabs" | "nested" | "checklist";
  fixedInstances?: { key: string; label: string }[];
  addable?: boolean;
  addButtonLabel?: string;
  minInstances?: number;
  maxInstances?: number;
  /** When set, an addable instance's card title uses that instance's answer for this itemField key instead of generic numbering. */
  titleFieldKey?: string;
}

export interface TemplateField {
  key: string;
  label: string;
  type: TemplateFieldType;
  order: number;
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  maxLength?: number;
  unit?: string;
  options?: TemplateFieldOption[];
  allowOther?: boolean;
  gate?: FieldGate;
  repeat?: RepeatConfig; // present only when type is repeating-group | damage-list
  itemFields?: TemplateField[]; // recursive sub-schema for one repeating instance
  sectionLetter?: string;
}

export interface Template {
  id: string;
  inspectionType: string;
  propertyType: string;
  sectionKey: string;
  name: string;
  version: number;
  status: TemplateStatus;
  fields: TemplateField[];
  createdById: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateSummaryRow {
  sectionKey: string;
  publishedVersion: number | null;
  publishedAt: string | null;
  hasDraft: boolean;
  draftId: string | null;
}

export const TEMPLATE_STATUS_CONFIG: Record<TemplateStatus, { label: string; color: string; bg: string }> = {
  draft:     { label: "Draft",     color: "#64748b", bg: "#f1f5f9" },
  published: { label: "Published", color: "#16a34a", bg: "#dcfce7" },
  archived:  { label: "Archived",  color: "#94a3b8", bg: "#f8fafc" },
};

/* ─── Users ─────────────────────────────────────────────────────── */
export const USERS: User[] = [
  { id: "u1", name: "Admin User",       email: "admin@acespect.com.au",    role: "admin",     avatar: "AU", region: "VIC" },
  { id: "u2", name: "James Thompson",   email: "james@acespect.com.au",    role: "inspector", avatar: "JT", phone: "0412 345 678", region: "VIC" },
  { id: "u3", name: "Priya Nair",       email: "priya@acespect.com.au",    role: "inspector", avatar: "PN", phone: "0423 456 789", region: "VIC" },
  { id: "u4", name: "Sarah Chen",       email: "sarah@acespect.com.au",    role: "reviewer",  avatar: "SC", region: "VIC" },
  { id: "u5", name: "Michael Torres",   email: "michael@acespect.com.au",  role: "reviewer",  avatar: "MT", region: "VIC" },
  { id: "u6", name: "Emma Wilson",      email: "emma@acespect.com.au",     role: "inspector", avatar: "EW", phone: "0434 567 890", region: "NSW" },
];

/* ─── Inspections ────────────────────────────────────────────────── */
export const INSPECTIONS: Inspection[] = [
  {
    id: "INS-001",
    jobNo: "HV-24-0891",
    address: "24 Smith Street",
    suburb: "Fitzroy VIC 3065",
    client: "BuildRight Construction Pty Ltd",
    inspectorId: "u2",
    reviewerId: "u4",
    date: "2024-06-15",
    submittedAt: "2024-06-15T16:42:00",
    type: "Dilapidation",
    propertyType: "Residential House",
    status: "in-review",
    overallProgress: 100,
    notes: "Adjacent construction works — 3-storey residential development. Access to rear yard limited by stored materials.",
    sections: [
      {
        id: "job-info",
        name: "Job Information",
        icon: "📋",
        status: "complete",
        reviewStatus: "approved",
        reviewComment: "",
        reportText: "Pre-construction dilapidation survey conducted at 24 Smith Street, Fitzroy VIC 3065 on 15 June 2024. Inspection commissioned by BuildRight Construction Pty Ltd (Job No. HV-24-0891). Weather conditions were fine at the time of inspection. Inspector: James Thompson.",
        fields: {
          clientName: "BuildRight Construction Pty Ltd",
          clientAttn: "Sarah Mitchell",
          clientEmail: "accounts@buildright.com.au",
          yourReference: "BR-2024-118",
          ourReference: "HV-24-0891",
          jobNo: "HV-24-0891",
          date: "2024-06-15",
          weather: "Fine",
          inspector: "James Thompson",
          inspectorRegistration: "DBU 42135",
          address: "24 Smith Street, Fitzroy VIC 3065",
          propertyOwner: "Margaret & David Wilson",
          propertyOwnerEmail: "mdwilson@bigpond.com",
          firstPhotoNo: "1",
          lastPhotoNo: "87",
          postProject: "No",
        },
        damages: [],
        photos: [],
      },
      {
        id: "description",
        name: "Description & Overview",
        icon: "🏠",
        status: "complete",
        reviewStatus: "approved",
        reviewComment: "",
        reportText: "The subject property is a double-storey brick veneer residential dwelling estimated to be constructed circa 1985. The property has a hipped tile roof, aluminium windows, and timber fencing to the boundaries. Street frontage is approximately 8.5 metres. The block is generally flat. The property appears to be in fair to average condition overall at the time of inspection.",
        fields: {
          constructionType: "House",
          constructedYear: "circa 1985",
          streetFrontage: "8.5m",
          blockSlope: "Flat",
          wallCladding: ["Brick veneer"],
          foundations: ["Concrete slab"],
          roofDesign: "Hipped",
          roofCovering: "Tiles",
          windows: ["Aluminium"],
          overview: "Double-storey brick veneer dwelling in fair to average condition.",
        },
        damages: [],
        photos: ["https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=400&q=80", "https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&q=80"],
      },
      {
        id: "driveway",
        name: "Driveway",
        icon: "🚗",
        status: "complete",
        reviewStatus: "pending",
        reviewComment: "",
        reportText: "The driveway is constructed of exposed aggregate concrete and is in generally fair condition. One diagonal crack was observed measuring approximately 2mm wide × 450mm long, located 2.1m from the garage door. The crack is consistent with normal thermal movement and does not indicate structural concern at the time of inspection.",
        fields: {
          material: "Exposed aggregate concrete",
          condition: "Fair",
          drainage: "Adequate",
          notableCracking: "Yes",
          firstPhoto: "3",
          lastPhoto: "11",
        },
        damages: [
          {
            id: "d1",
            type: "Crack",
            location: "2.1m from garage door, centre of driveway",
            direction: "Diagonal",
            widthMm: 2,
            lengthMm: 450,
            notes: "Consistent with thermal movement. No structural concern noted.",
            photos: ["https://images.unsplash.com/photo-1564558396203-c6bfb71b73e7?w=400&q=80"],
          },
        ],
        photos: ["https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80"],
      },
      {
        id: "paving",
        name: "Paving & Paths",
        icon: "🛤️",
        status: "complete",
        reviewStatus: "pending",
        reviewComment: "",
        reportText: "The front paving is constructed of clay pavers in satisfactory condition with typical wear. The side path is concrete in fair condition. No significant cracking or subsidence was observed to the paving at the time of inspection.",
        fields: {
          frontMaterial: "Clay pavers",
          frontCondition: "Satisfactory",
          sideMaterial: "Concrete",
          sideCondition: "Fair",
          notableCracking: "No",
          firstPhoto: "12",
          lastPhoto: "19",
        },
        damages: [],
        photos: [],
      },
      {
        id: "fences",
        name: "Fences",
        icon: "🪵",
        status: "complete",
        reviewStatus: "revision-requested",
        reviewComment: "Please clarify the height of the timber paling fence and confirm whether it is shared with the neighbouring property.",
        reportText: "The front boundary is defined by a 1.2m high painted timber paling fence in fair condition with minor weathering observed. The side boundaries are defined by 1.8m high timber paling fences. One section of the left boundary fence (approx. 1.2m long) has a leaning post that requires monitoring.",
        fields: {
          frontFenceMaterial: "Timber paling",
          frontFenceHeight: "1.2m",
          frontFenceCondition: "Fair",
          sideFenceMaterial: "Timber paling",
          sideFenceHeight: "1.8m",
          sideFenceCondition: "Fair",
          notableDamage: "Leaning post — left boundary",
          firstPhoto: "20",
          lastPhoto: "31",
        },
        damages: [
          {
            id: "d2",
            type: "Leaning",
            location: "Left boundary fence — 4m from front corner",
            direction: "Horizontal",
            widthMm: 0,
            lengthMm: 1200,
            notes: "One fence post is leaning outward. Section approximately 1.2m. Monitor post construction.",
            photos: [],
          },
        ],
        photos: [],
      },
      {
        id: "elevations",
        name: "Elevations",
        icon: "🧱",
        status: "complete",
        reviewStatus: "pending",
        reviewComment: "",
        reportText: "Front elevation: The brick veneer cladding is in generally satisfactory condition. Two hairline diagonal cracks were observed above the garage window opening — crack 1 measures 0.5mm × 120mm and crack 2 measures 0.3mm × 90mm. These are consistent with typical brick veneer shrinkage. The window frames and eaves appear in satisfactory condition.\n\nLeft side elevation: Brick veneer in fair condition. No significant cracking observed. One downpipe connection appears loose at the base.\n\nRear elevation: Access was limited by stored construction materials. The visible brickwork appears in satisfactory condition.\n\nRight side elevation: Brick veneer in satisfactory condition. Eaves linings show minor weathering.",
        fields: {
          frontCondition: "Satisfactory",
          frontObstruction: "None",
          leftCondition: "Fair",
          leftObstruction: "None",
          rearCondition: "Satisfactory",
          rearObstruction: "Stored construction materials",
          rightCondition: "Satisfactory",
          firstPhoto: "32",
          lastPhoto: "58",
        },
        damages: [
          {
            id: "d3",
            type: "Crack",
            location: "Front elevation — above garage window, left side",
            direction: "Diagonal",
            widthMm: 0.5,
            lengthMm: 120,
            notes: "Hairline diagonal crack consistent with brick veneer shrinkage.",
            photos: [],
          },
          {
            id: "d4",
            type: "Crack",
            location: "Front elevation — above garage window, right side",
            direction: "Diagonal",
            widthMm: 0.3,
            lengthMm: 90,
            notes: "Hairline diagonal crack consistent with brick veneer shrinkage.",
            photos: [],
          },
        ],
        photos: [],
      },
      {
        id: "roof",
        name: "Roof Covering & Chimneys",
        icon: "🏗️",
        status: "complete",
        reviewStatus: "pending",
        reviewComment: "",
        reportText: "The roof covering is concrete tiles in generally satisfactory condition. The roof was inspected from ground level and from an upstairs window. No cracked or missing tiles were observed. The gutters and downpipes appear to be in serviceable condition. There are no chimneys present.",
        fields: {
          upperRoofVisibility: "Observed from upstairs window",
          roofMaterial: "Concrete tiles",
          generalCondition: "Satisfactory",
          chimneyPresent: "No",
          moistureObservations: "No issues observed",
          firstPhoto: "59",
          lastPhoto: "67",
        },
        damages: [],
        photos: [],
      },
      {
        id: "internal",
        name: "Internal Areas",
        icon: "🛋️",
        status: "complete",
        reviewStatus: "pending",
        reviewComment: "",
        reportText: "The internal areas of the dwelling were inspected throughout. The entry and hallway are in satisfactory condition. The living and dining areas present with minor surface cracking to the cornice junction, consistent with normal building movement. The kitchen is in fair condition. Bedrooms 1 and 2 are in satisfactory condition. The bathroom and laundry show minor grout deterioration typical of age. No significant structural defects were observed to the internal areas at the time of inspection.",
        fields: {
          generalCondition: "Satisfactory to fair",
          renovationsPresent: "No",
          safetyAdvisories: "No",
          roomsNotAccessed: "No",
          bouncyFloors: "No",
          bindingDoors: "No",
        },
        damages: [
          {
            id: "d5",
            type: "Crack",
            location: "Living room — cornice junction, north wall",
            direction: "Horizontal",
            widthMm: 0.5,
            lengthMm: 350,
            notes: "Minor surface crack at cornice junction, consistent with normal building movement.",
            photos: [],
          },
        ],
        photos: [],
      },
      {
        id: "notes",
        name: "Notes & Post Project",
        icon: "📝",
        status: "complete",
        reviewStatus: "pending",
        reviewComment: "",
        reportText: "No post-project updates are applicable at this time. No significant safety matters were noted during the inspection. Access to the rear yard was limited by stored construction materials from the adjacent site — this area was photographed and noted as a limitation. The inspection was conducted in accordance with standard dilapidation survey methodology.",
        fields: {
          safetyMatters: "No",
          postProject: "No",
          additionalNotes: "Access to rear yard limited by stored construction materials from adjacent site.",
        },
        damages: [],
        photos: [],
      },
    ],
  },
  {
    id: "INS-002",
    jobNo: "HV-24-0902",
    address: "87 Wellington Road",
    suburb: "Collingwood VIC 3066",
    client: "Apex Developments Pty Ltd",
    inspectorId: "u3",
    reviewerId: "u4",
    date: "2024-06-18",
    submittedAt: "2024-06-18T14:30:00",
    type: "Dilapidation",
    propertyType: "Residential House",
    status: "submitted",
    overallProgress: 100,
    notes: "New 4-storey apartment development adjacent. Both pre and post inspection required.",
    sections: [
      {
        id: "job-info-2",
        name: "Job Information",
        icon: "📋",
        status: "complete",
        reviewStatus: "pending",
        reviewComment: "",
        reportText: "Pre-construction dilapidation survey conducted at 87 Wellington Road, Collingwood VIC 3066 on 18 June 2024. Inspection commissioned by Apex Developments Pty Ltd (Job No. HV-24-0902). Weather: Fine. Inspector: Priya Nair.",
        fields: {
          clientName: "Apex Developments Pty Ltd",
          jobNo: "HV-24-0902",
          date: "2024-06-18",
          weather: "Fine",
          inspector: "Priya Nair",
          address: "87 Wellington Road, Collingwood VIC 3066",
          firstPhotoNo: "1",
          lastPhotoNo: "62",
        },
        damages: [],
        photos: [],
      },
      {
        id: "description-2",
        name: "Description & Overview",
        icon: "🏠",
        status: "complete",
        reviewStatus: "pending",
        reviewComment: "",
        reportText: "The subject property is a single-storey brick veneer dwelling estimated circa 1972. Hipped tile roof, timber windows, colorbond fencing. Street frontage approximately 9.0 metres. Block is flat.",
        fields: {
          constructionType: "House",
          constructedYear: "circa 1972",
          streetFrontage: "9.0m",
          blockSlope: "Flat",
          wallCladding: ["Brick veneer"],
          foundations: ["Timber stumps"],
          roofDesign: "Hipped",
          roofCovering: "Tiles",
          windows: ["Timber"],
        },
        damages: [],
        photos: ["https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=400&q=80"],
      },
      {
        id: "driveway-2",
        name: "Driveway",
        icon: "🚗",
        status: "complete",
        reviewStatus: "pending",
        reviewComment: "",
        reportText: "The driveway is constructed of concrete in generally satisfactory condition. A longitudinal crack was observed measuring 3mm wide × 600mm long near the street kerb. Consistent with normal ground movement.",
        fields: {
          material: "Concrete",
          condition: "Satisfactory",
          drainage: "Adequate",
          notableCracking: "Yes",
          firstPhoto: "4",
          lastPhoto: "12",
        },
        damages: [
          {
            id: "d-w2-1",
            type: "Crack",
            location: "Near street kerb, left side",
            direction: "Longitudinal",
            widthMm: 3,
            lengthMm: 600,
            notes: "Normal ground movement crack.",
            photos: [],
          },
        ],
        photos: [],
      },
      {
        id: "fences-2",
        name: "Fences",
        icon: "🪵",
        status: "complete",
        reviewStatus: "revision-requested",
        reviewComment: "Please confirm the material of the rear boundary fence and whether it is within the property boundary.",
        reportText: "The front boundary is defined by a 1.0m high colorbond fence in satisfactory condition. Side boundaries are 1.8m colorbond in fair condition. No significant damage or movement observed.",
        fields: {
          frontFenceMaterial: "Colorbond",
          frontFenceHeight: "1.0m",
          frontFenceCondition: "Satisfactory",
          sideFenceMaterial: "Colorbond",
          sideFenceHeight: "1.8m",
          sideFenceCondition: "Fair",
        },
        damages: [],
        photos: [],
      },
    ],
  },
  {
    id: "INS-003",
    jobNo: "HV-24-0915",
    address: "12 Chapel Lane",
    suburb: "Richmond VIC 3121",
    client: "Richmond Council",
    inspectorId: "u2",
    reviewerId: null,
    date: "2024-06-20",
    submittedAt: null,
    type: "Dilapidation",
    propertyType: "Residential House",
    status: "draft",
    overallProgress: 65,
    notes: "",
    sections: [],
  },
  {
    id: "INS-004",
    jobNo: "HV-24-0876",
    address: "55 Collins Street",
    suburb: "Melbourne VIC 3000",
    client: "Metro Rail Authority",
    inspectorId: "u6",
    reviewerId: "u5",
    date: "2024-06-10",
    submittedAt: "2024-06-10T17:00:00",
    type: "Dilapidation",
    propertyType: "Commercial Properties",
    status: "approved",
    overallProgress: 100,
    notes: "",
    sections: [],
  },
  {
    id: "INS-005",
    jobNo: "HV-24-0923",
    address: "3 Park Avenue",
    suburb: "Hawthorn VIC 3122",
    client: "GreenBuild Pty Ltd",
    inspectorId: "u3",
    reviewerId: "u5",
    date: "2024-06-22",
    submittedAt: "2024-06-22T15:15:00",
    type: "Pre-Purchase",
    propertyType: "Residential House",
    status: "in-review",
    overallProgress: 100,
    notes: "",
    sections: [],
  },
];

/* ─── Helpers ────────────────────────────────────────────────────── */
export function getUser(id: string): User | undefined {
  return USERS.find(u => u.id === id);
}

export function getInspectionsByInspector(inspectorId: string): Inspection[] {
  return INSPECTIONS.filter(i => i.inspectorId === inspectorId);
}

export function getInspectionsForReviewer(reviewerId: string): Inspection[] {
  return INSPECTIONS.filter(i => i.reviewerId === reviewerId && i.status !== "draft");
}

export function getInspectionById(id: string): Inspection | undefined {
  return INSPECTIONS.find(i => i.id === id);
}

export const STATUS_CONFIG: Record<InspectionStatus, { label: string; color: string; bg: string }> = {
  draft:      { label: "Draft",      color: "#64748b", bg: "#f1f5f9" },
  submitted:  { label: "Submitted",  color: "#d97706", bg: "#fef3c7" },
  "in-review":{ label: "In Review",  color: "#2563eb", bg: "#eff6ff" },
  approved:   { label: "Approved",   color: "#16a34a", bg: "#dcfce7" },
  rejected:   { label: "Rejected",   color: "#dc2626", bg: "#fee2e2" },
};

export const REVIEW_STATUS_CONFIG: Record<SectionReviewStatus, { label: string; color: string; bg: string }> = {
  pending:             { label: "Pending",          color: "#64748b", bg: "#f1f5f9" },
  approved:            { label: "Approved",         color: "#16a34a", bg: "#dcfce7" },
  "revision-requested":{ label: "Needs Revision",   color: "#d97706", bg: "#fef3c7" },
};
