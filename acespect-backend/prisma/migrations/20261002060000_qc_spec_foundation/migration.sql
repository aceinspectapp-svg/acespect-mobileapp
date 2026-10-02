-- CreateEnum
CREATE TYPE "QcMemberRole" AS ENUM ('CLIENT_ADMIN', 'CLIENT_USER', 'MC_MANAGER', 'MC_SITE_SUPERVISOR', 'MC_PROJECT_MANAGER', 'TRADE_USER', 'PRIVATE_INSPECTOR');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "position" TEXT,
ADD COLUMN     "whiteCardNumber" TEXT,
ADD COLUMN     "whiteCardState" TEXT;

-- AlterTable
ALTER TABLE "qc_clients" ADD COLUMN     "clientCode" TEXT,
ADD COLUMN     "data" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "qc_projects" ADD COLUMN     "builderId" TEXT,
ADD COLUMN     "closurePolicy" TEXT NOT NULL DEFAULT 'DEVELOPER_SIGNOFF',
ADD COLUMN     "data" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "defectSeq" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deskReviewAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "jobNumber" TEXT,
ADD COLUMN     "projectRef" TEXT,
ADD COLUMN     "safetyAutoRelease" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'SETUP';

-- AlterTable
ALTER TABLE "qc_properties" ADD COLUMN     "data" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "lotStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "qc_severities" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "qc_statuses" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "terminal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "qc_defects" ADD COLUMN     "allocatedTradeCompanyId" TEXT,
ADD COLUMN     "allocatedTradeUserId" TEXT,
ADD COLUMN     "builderContactId" TEXT,
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "codeRef" TEXT,
ADD COLUMN     "defectRef" TEXT,
ADD COLUMN     "disputeBy" TEXT,
ADD COLUMN     "disputePrevStatusId" TEXT,
ADD COLUMN     "disputeReviewRequested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "element" TEXT,
ADD COLUMN     "escalationLevel" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "exceptionReason" TEXT,
ADD COLUMN     "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "guideValue" TEXT,
ADD COLUMN     "holdPrevStatusId" TEXT,
ADD COLUMN     "holdReason" TEXT,
ADD COLUMN     "holdReviewDate" TIMESTAMP(3),
ADD COLUMN     "isDraft" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "linkedDefectId" TEXT,
ADD COLUMN     "measuredValue" TEXT,
ADD COLUMN     "nature" TEXT,
ADD COLUMN     "photoUrls" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "releasedAt" TIMESTAMP(3),
ADD COLUMN     "reworkCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "roomArea" TEXT,
ADD COLUMN     "scheduledAttendanceDate" TIMESTAMP(3),
ADD COLUMN     "targetRectificationDate" TIMESTAMP(3),
ADD COLUMN     "title" TEXT,
ADD COLUMN     "tradeCategoryId" TEXT,
ADD COLUMN     "withdrawnReason" TEXT;

-- CreateTable
CREATE TABLE "qc_master_contractors" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abn" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_master_contractors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_trade_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "licenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "licenceHint" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "qc_trade_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_trade_companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "abn" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_trade_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "role" "QcMemberRole" NOT NULL,
    "masterContractorId" TEXT,
    "tradeCompanyId" TEXT,
    "optionalPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "deactivationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_inspector_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_inspector_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_sites" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_project_members" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assigneeType" TEXT NOT NULL,
    "userId" TEXT,
    "tradeCompanyId" TEXT,
    "masterContractorId" TEXT,
    "projectRole" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_defect_events" (
    "id" TEXT NOT NULL,
    "defectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatusId" TEXT,
    "toStatusId" TEXT,
    "actorId" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "onBehalf" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "reworkCount" INTEGER NOT NULL DEFAULT 0,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_defect_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_defect_comments" (
    "id" TEXT NOT NULL,
    "defectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "visibleTo" TEXT NOT NULL DEFAULT 'ALL',
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "correctionOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_defect_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_QcClientToQcInspectorCredential" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_QcClientToQcInspectorCredential_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_QcMasterContractorToQcTradeCompany" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_QcMasterContractorToQcTradeCompany_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_QcTradeCategoryToQcTradeCompany" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_QcTradeCategoryToQcTradeCompany_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_QcMembershipToQcTradeCategory" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_QcMembershipToQcTradeCategory_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_QcMembershipToQcProject" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_QcMembershipToQcProject_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "qc_master_contractors_clientId_idx" ON "qc_master_contractors"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_trade_categories_code_key" ON "qc_trade_categories"("code");

-- CreateIndex
CREATE INDEX "qc_memberships_clientId_idx" ON "qc_memberships"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_memberships_userId_clientId_key" ON "qc_memberships"("userId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_inspector_credentials_userId_key" ON "qc_inspector_credentials"("userId");

-- CreateIndex
CREATE INDEX "qc_sites_projectId_idx" ON "qc_sites"("projectId");

-- CreateIndex
CREATE INDEX "qc_project_members_projectId_idx" ON "qc_project_members"("projectId");

-- CreateIndex
CREATE INDEX "qc_defect_events_defectId_createdAt_idx" ON "qc_defect_events"("defectId", "createdAt");

-- CreateIndex
CREATE INDEX "qc_defect_comments_defectId_createdAt_idx" ON "qc_defect_comments"("defectId", "createdAt");

-- CreateIndex
CREATE INDEX "_QcClientToQcInspectorCredential_B_index" ON "_QcClientToQcInspectorCredential"("B");

-- CreateIndex
CREATE INDEX "_QcMasterContractorToQcTradeCompany_B_index" ON "_QcMasterContractorToQcTradeCompany"("B");

-- CreateIndex
CREATE INDEX "_QcTradeCategoryToQcTradeCompany_B_index" ON "_QcTradeCategoryToQcTradeCompany"("B");

-- CreateIndex
CREATE INDEX "_QcMembershipToQcTradeCategory_B_index" ON "_QcMembershipToQcTradeCategory"("B");

-- CreateIndex
CREATE INDEX "_QcMembershipToQcProject_B_index" ON "_QcMembershipToQcProject"("B");

-- CreateIndex
CREATE UNIQUE INDEX "qc_clients_clientCode_key" ON "qc_clients"("clientCode");

-- CreateIndex
CREATE UNIQUE INDEX "qc_projects_clientId_jobNumber_key" ON "qc_projects"("clientId", "jobNumber");

-- CreateIndex
CREATE INDEX "qc_properties_siteId_idx" ON "qc_properties"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_defects_defectRef_key" ON "qc_defects"("defectRef");

-- CreateIndex
CREATE INDEX "qc_defects_tradeCategoryId_idx" ON "qc_defects"("tradeCategoryId");

-- AddForeignKey
ALTER TABLE "qc_master_contractors" ADD CONSTRAINT "qc_master_contractors_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "qc_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_memberships" ADD CONSTRAINT "qc_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_memberships" ADD CONSTRAINT "qc_memberships_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "qc_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_memberships" ADD CONSTRAINT "qc_memberships_masterContractorId_fkey" FOREIGN KEY ("masterContractorId") REFERENCES "qc_master_contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_memberships" ADD CONSTRAINT "qc_memberships_tradeCompanyId_fkey" FOREIGN KEY ("tradeCompanyId") REFERENCES "qc_trade_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_inspector_credentials" ADD CONSTRAINT "qc_inspector_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_projects" ADD CONSTRAINT "qc_projects_builderId_fkey" FOREIGN KEY ("builderId") REFERENCES "qc_master_contractors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_sites" ADD CONSTRAINT "qc_sites_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "qc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_project_members" ADD CONSTRAINT "qc_project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "qc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_project_members" ADD CONSTRAINT "qc_project_members_tradeCompanyId_fkey" FOREIGN KEY ("tradeCompanyId") REFERENCES "qc_trade_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_properties" ADD CONSTRAINT "qc_properties_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "qc_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defects" ADD CONSTRAINT "qc_defects_tradeCategoryId_fkey" FOREIGN KEY ("tradeCategoryId") REFERENCES "qc_trade_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defects" ADD CONSTRAINT "qc_defects_builderContactId_fkey" FOREIGN KEY ("builderContactId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defects" ADD CONSTRAINT "qc_defects_allocatedTradeCompanyId_fkey" FOREIGN KEY ("allocatedTradeCompanyId") REFERENCES "qc_trade_companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defects" ADD CONSTRAINT "qc_defects_allocatedTradeUserId_fkey" FOREIGN KEY ("allocatedTradeUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defects" ADD CONSTRAINT "qc_defects_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defect_events" ADD CONSTRAINT "qc_defect_events_defectId_fkey" FOREIGN KEY ("defectId") REFERENCES "qc_defects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defect_events" ADD CONSTRAINT "qc_defect_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defect_comments" ADD CONSTRAINT "qc_defect_comments_defectId_fkey" FOREIGN KEY ("defectId") REFERENCES "qc_defects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defect_comments" ADD CONSTRAINT "qc_defect_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QcClientToQcInspectorCredential" ADD CONSTRAINT "_QcClientToQcInspectorCredential_A_fkey" FOREIGN KEY ("A") REFERENCES "qc_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QcClientToQcInspectorCredential" ADD CONSTRAINT "_QcClientToQcInspectorCredential_B_fkey" FOREIGN KEY ("B") REFERENCES "qc_inspector_credentials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QcMasterContractorToQcTradeCompany" ADD CONSTRAINT "_QcMasterContractorToQcTradeCompany_A_fkey" FOREIGN KEY ("A") REFERENCES "qc_master_contractors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QcMasterContractorToQcTradeCompany" ADD CONSTRAINT "_QcMasterContractorToQcTradeCompany_B_fkey" FOREIGN KEY ("B") REFERENCES "qc_trade_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QcTradeCategoryToQcTradeCompany" ADD CONSTRAINT "_QcTradeCategoryToQcTradeCompany_A_fkey" FOREIGN KEY ("A") REFERENCES "qc_trade_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QcTradeCategoryToQcTradeCompany" ADD CONSTRAINT "_QcTradeCategoryToQcTradeCompany_B_fkey" FOREIGN KEY ("B") REFERENCES "qc_trade_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QcMembershipToQcTradeCategory" ADD CONSTRAINT "_QcMembershipToQcTradeCategory_A_fkey" FOREIGN KEY ("A") REFERENCES "qc_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QcMembershipToQcTradeCategory" ADD CONSTRAINT "_QcMembershipToQcTradeCategory_B_fkey" FOREIGN KEY ("B") REFERENCES "qc_trade_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QcMembershipToQcProject" ADD CONSTRAINT "_QcMembershipToQcProject_A_fkey" FOREIGN KEY ("A") REFERENCES "qc_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_QcMembershipToQcProject" ADD CONSTRAINT "_QcMembershipToQcProject_B_fkey" FOREIGN KEY ("B") REFERENCES "qc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ───────────────────────── Data: spec lifecycle statuses, severities, trade categories ──────────────────────────
-- Statuses (E24): 14 values. Overdue and Escalated are flags now, not statuses.
INSERT INTO "qc_statuses" ("id","key","label","color","meaning","order","active","terminal") VALUES
  (gen_random_uuid()::text,'open','Open','#2563EB','Logged by the Private Inspector; not yet released to the Builder',0,true,false),
  (gen_random_uuid()::text,'assigned','Assigned','#EA580C','Released to the Builder, awaiting allocation to a trade',1,true,false),
  (gen_random_uuid()::text,'allocated','Allocated','#D97706','Builder has allocated a trade company or user',2,true,false),
  (gen_random_uuid()::text,'acknowledged','Acknowledged','#0891B2','Trade has confirmed receipt and a scheduled date',3,true,false),
  (gen_random_uuid()::text,'in_progress','In Progress','#059669','Rectification work underway',4,true,false),
  (gen_random_uuid()::text,'rectified','Rectified','#0D9488','Trade declares the work finished; Builder to check it',5,true,false),
  (gen_random_uuid()::text,'pending_re_inspection','Pending Re-inspection','#7C3AED','Builder submitted the work; awaiting Inspector verification',6,true,false),
  (gen_random_uuid()::text,'verified','Verified','#16A34A','Inspector confirmed the fix meets the standard',7,true,false),
  (gen_random_uuid()::text,'reopened','Reopened','#DC2626','Verification failed; the defect returns to allocation',8,true,false),
  (gen_random_uuid()::text,'closed','Closed','#065F46','Final closure; the record is locked',9,true,true),
  (gen_random_uuid()::text,'disputed','Disputed','#C2410C','Responsibility or the defect itself is contested',10,true,false),
  (gen_random_uuid()::text,'on_hold','On Hold','#475569','Paused with a reason; SLA clocks stopped',11,true,false),
  (gen_random_uuid()::text,'accepted_exception','Accepted (Exception)','#6B7280','Developer accepted the defect without rectification',12,true,true),
  (gen_random_uuid()::text,'withdrawn','Withdrawn','#9CA3AF','Raised in error or disallowed after dispute review',13,true,true)
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label", "color" = EXCLUDED."color", "meaning" = EXCLUDED."meaning",
  "order" = EXCLUDED."order", "active" = true, "terminal" = EXCLUDED."terminal";

-- Move existing defects off the retired statuses before retiring them.
UPDATE "qc_defects" SET "statusId" = (SELECT "id" FROM "qc_statuses" WHERE "key" = 'verified')
  WHERE "statusId" IN (SELECT "id" FROM "qc_statuses" WHERE "key" = 'verified_closed');
UPDATE "qc_defects" SET "statusId" = (SELECT "id" FROM "qc_statuses" WHERE "key" = 'reopened')
  WHERE "statusId" IN (SELECT "id" FROM "qc_statuses" WHERE "key" = 'rejected_reopened');
UPDATE "qc_defects" SET "statusId" = (SELECT "id" FROM "qc_statuses" WHERE "key" = 'in_progress'),
  "flags" = array_append("flags", 'overdue')
  WHERE "statusId" IN (SELECT "id" FROM "qc_statuses" WHERE "key" = 'overdue');
UPDATE "qc_defects" SET "statusId" = (SELECT "id" FROM "qc_statuses" WHERE "key" = 'assigned'),
  "flags" = array_append("flags", 'escalated')
  WHERE "statusId" IN (SELECT "id" FROM "qc_statuses" WHERE "key" = 'escalated');
UPDATE "qc_defects" SET "statusId" = (SELECT "id" FROM "qc_statuses" WHERE "key" = 'on_hold')
  WHERE "statusId" IN (SELECT "id" FROM "qc_statuses" WHERE "key" = 'on_hold_disputed');
UPDATE "qc_statuses" SET "active" = false
  WHERE "key" IN ('verified_closed','rejected_reopened','overdue','escalated','on_hold_disputed');

-- Any other status someone created through the old admin screen is unknown to the lifecycle. Retire it and
-- move its defects to Assigned (visible to the Builder, who can allocate it) rather than leave them stuck.
UPDATE "qc_defects" SET "statusId" = (SELECT "id" FROM "qc_statuses" WHERE "key" = 'assigned')
  WHERE "statusId" IN (
    SELECT "id" FROM "qc_statuses" WHERE "key" NOT IN (
      'open','assigned','allocated','acknowledged','in_progress','rectified','pending_re_inspection','verified','reopened',
      'closed','disputed','on_hold','accepted_exception','withdrawn'
    )
  );
UPDATE "qc_statuses" SET "active" = false WHERE "key" NOT IN (
  'open','assigned','allocated','acknowledged','in_progress','rectified','pending_re_inspection','verified','reopened',
  'closed','disputed','on_hold','accepted_exception','withdrawn'
);

-- Severities (AS 4349.1 framing + Monitor / Serviceability).
INSERT INTO "qc_severities" ("id","key","label","color","order","active") VALUES
  (gen_random_uuid()::text,'safety_hazard','Safety Hazard','#B91C1C',0,true),
  (gen_random_uuid()::text,'major','Major Defect','#DC2626',1,true),
  (gen_random_uuid()::text,'minor','Minor Defect','#D97706',2,true),
  (gen_random_uuid()::text,'monitor','Monitor / Serviceability','#2563EB',3,true)
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label", "color" = EXCLUDED."color", "order" = EXCLUDED."order", "active" = true;
UPDATE "qc_defects" SET "severityId" = (SELECT "id" FROM "qc_severities" WHERE "key" = 'minor')
  WHERE "severityId" IN (SELECT "id" FROM "qc_severities" WHERE "key" = 'moderate');
UPDATE "qc_defects" SET "severityId" = (SELECT "id" FROM "qc_severities" WHERE "key" = 'monitor')
  WHERE "severityId" IN (SELECT "id" FROM "qc_severities" WHERE "key" = 'observation');
UPDATE "qc_severities" SET "active" = false WHERE "key" IN ('moderate','observation');
-- Custom severities likewise: fold them into Minor and retire them.
UPDATE "qc_defects" SET "severityId" = (SELECT "id" FROM "qc_severities" WHERE "key" = 'minor')
  WHERE "severityId" IN (SELECT "id" FROM "qc_severities" WHERE "key" NOT IN ('safety_hazard','major','minor','monitor'));
UPDATE "qc_severities" SET "active" = false WHERE "key" NOT IN ('safety_hazard','major','minor','monitor');

-- Property types back the lot dwelling types (E09); make sure all four exist.
INSERT INTO "qc_property_types" ("id","key","label","icon","order") VALUES
  (gen_random_uuid()::text,'house','House','home-outline',0),
  (gen_random_uuid()::text,'apartment','Apartment','business-outline',1),
  (gen_random_uuid()::text,'townhouse','Townhouse','grid-outline',2),
  (gen_random_uuid()::text,'duplex','Duplex','copy-outline',3)
ON CONFLICT ("key") DO NOTHING;

-- Trade categories (E19 seed list).
INSERT INTO "qc_trade_categories" ("id","name","code","licenceRequired","licenceHint","active") VALUES
  (gen_random_uuid()::text,'Concreter','CONC',false,NULL,true),
  (gen_random_uuid()::text,'Excavator or earthworks','EXCV',false,NULL,true),
  (gen_random_uuid()::text,'Plumber','PLMB',true,'VBA (plumbing licence in Victoria); other states use their own regulator',true),
  (gen_random_uuid()::text,'Drainer','DRAN',true,'VBA (drainage licence in Victoria)',true),
  (gen_random_uuid()::text,'Gasfitter','GASF',true,'VBA (gasfitting licence in Victoria)',true),
  (gen_random_uuid()::text,'Electrician','ELEC',true,'Energy Safe Victoria (Registered Electrical Contractor)',true),
  (gen_random_uuid()::text,'Carpenter or framer','CARP',false,NULL,true),
  (gen_random_uuid()::text,'Bricklayer or blocklayer','BRCK',false,NULL,true),
  (gen_random_uuid()::text,'Roof plumber','RPLM',true,'VBA (roof plumbing licence in Victoria)',true),
  (gen_random_uuid()::text,'Roof tiler','RTIL',false,NULL,true),
  (gen_random_uuid()::text,'Metal roofer','MROF',false,NULL,true),
  (gen_random_uuid()::text,'Plasterer','PLST',false,NULL,true),
  (gen_random_uuid()::text,'Renderer','REND',false,NULL,true),
  (gen_random_uuid()::text,'Waterproofer','WPRF',false,NULL,true),
  (gen_random_uuid()::text,'Tiler','TILR',false,NULL,true),
  (gen_random_uuid()::text,'Painter','PAIN',false,NULL,true),
  (gen_random_uuid()::text,'Cabinet maker or joiner','JOIN',false,NULL,true),
  (gen_random_uuid()::text,'Glazier','GLAZ',false,NULL,true),
  (gen_random_uuid()::text,'Floor layer','FLOR',false,NULL,true),
  (gen_random_uuid()::text,'Insulation installer','INSL',false,NULL,true),
  (gen_random_uuid()::text,'Landscaper','LAND',false,NULL,true),
  (gen_random_uuid()::text,'Fencer','FENC',false,NULL,true),
  (gen_random_uuid()::text,'Concrete finisher','CFIN',false,NULL,true),
  (gen_random_uuid()::text,'Cleaner','CLEN',false,NULL,true),
  (gen_random_uuid()::text,'Air-conditioning (HVAC)','HVAC',false,NULL,true),
  (gen_random_uuid()::text,'Other','OTHR',false,NULL,true)
ON CONFLICT ("code") DO NOTHING;

-- ───────────────────────── Backfill for rows created before this migration ─────────────────────────
UPDATE "qc_clients" c SET "clientCode" = 'CLI-' || lpad(x.rn::text, 4, '0')
  FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "qc_clients") x
  WHERE c."id" = x."id" AND c."clientCode" IS NULL;

UPDATE "qc_projects" p SET "projectRef" = 'PRJ-' || lpad(x.rn::text, 4, '0')
  FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn FROM "qc_projects") x
  WHERE p."id" = x."id" AND p."projectRef" IS NULL;

-- Defect references: <job number or project ref>-D<4 digits>, numbered per project.
UPDATE "qc_defects" d SET "defectRef" = x.ref
  FROM (
    SELECT d2."id",
           COALESCE(p."jobNumber", p."projectRef") || '-D' || lpad((row_number() OVER (PARTITION BY p."id" ORDER BY d2."createdAt", d2."id"))::text, 4, '0') AS ref
    FROM "qc_defects" d2
    JOIN "qc_properties" pr ON pr."id" = d2."propertyId"
    JOIN "qc_projects" p ON p."id" = pr."projectId"
  ) x
  WHERE d."id" = x."id" AND d."defectRef" IS NULL;
UPDATE "qc_projects" p SET "defectSeq" = COALESCE((
  SELECT count(*) FROM "qc_defects" d JOIN "qc_properties" pr ON pr."id" = d."propertyId" WHERE pr."projectId" = p."id"
), 0);

-- Defects that never got their descriptive fields are drafts until confirmed.
UPDATE "qc_defects" SET "isDraft" = true
  WHERE "summary" IS NULL OR "location" IS NULL OR "severityId" IS NULL;
-- Existing defects that already have a summary keep it as their title too.
UPDATE "qc_defects" SET "title" = left("summary", 100) WHERE "title" IS NULL AND "summary" IS NOT NULL;
