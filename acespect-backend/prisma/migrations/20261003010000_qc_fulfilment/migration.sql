-- AlterTable
ALTER TABLE "qc_projects" ADD COLUMN     "dlpEndDate" TIMESTAMP(3),
ADD COLUMN     "dlpEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "dlpLengthMonths" INTEGER,
ADD COLUMN     "dlpSignedOffAt" TIMESTAMP(3),
ADD COLUMN     "dlpStartDate" TIMESTAMP(3),
ADD COLUMN     "practicalCompletionDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "qc_defects" ADD COLUMN     "ackDueAt" TIMESTAMP(3),
ADD COLUMN     "acknowledgedAt" TIMESTAMP(3),
ADD COLUMN     "dlpDefect" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "foundAtStage" TEXT,
ADD COLUMN     "lastEscalatedAt" TIMESTAMP(3),
ADD COLUMN     "rectifiedAt" TIMESTAMP(3),
ADD COLUMN     "rectifyDueAt" TIMESTAMP(3),
ADD COLUMN     "reinspectDueAt" TIMESTAMP(3),
ADD COLUMN     "sourceInspectionId" TEXT,
ADD COLUMN     "sourceItemNumber" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "qc_records" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "clientId" TEXT,
    "projectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "title" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_templates" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'BASE',
    "clientId" TEXT,
    "projectId" TEXT,
    "parentId" TEXT,
    "parentVersion" INTEGER,
    "stageKey" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "versionStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "changeSummary" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "section" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "itemType" TEXT NOT NULL DEFAULT 'PASS_FAIL',
    "data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "qc_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_inspections" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "siteId" TEXT,
    "propertyId" TEXT,
    "stageKey" TEXT,
    "templateId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'STAGE',
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "inspectorId" TEXT,
    "plannedFrom" TIMESTAMP(3),
    "plannedTo" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "signedById" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "holdPoint" BOOLEAN NOT NULL DEFAULT false,
    "requestedById" TEXT,
    "requestedAt" TIMESTAMP(3),
    "requestData" JSONB NOT NULL DEFAULT '{}',
    "headerData" JSONB NOT NULL DEFAULT '{}',
    "summaryData" JSONB NOT NULL DEFAULT '{}',
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_inspection_results" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "itemNumber" TEXT NOT NULL,
    "itemSnapshot" JSONB NOT NULL DEFAULT '{}',
    "resultCode" TEXT,
    "comments" TEXT,
    "locationDetail" TEXT,
    "measurement" JSONB,
    "photoUrls" JSONB NOT NULL DEFAULT '[]',
    "reason" TEXT,
    "defectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "carriedFromId" TEXT,
    "previousValues" JSONB NOT NULL DEFAULT '[]',
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_inspection_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_evidence" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "projectId" TEXT,
    "linkedType" TEXT NOT NULL,
    "linkedId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PHOTO',
    "phase" TEXT,
    "caption" TEXT,
    "url" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileName" TEXT,
    "mime" TEXT,
    "sizeBytes" INTEGER,
    "capturedAt" TIMESTAMP(3),
    "capturedVia" TEXT,
    "peopleShown" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_escalations" (
    "id" TEXT NOT NULL,
    "defectId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "rule" JSONB NOT NULL DEFAULT '{}',
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "raisedById" TEXT,
    "reason" TEXT,
    "recipients" JSONB NOT NULL DEFAULT '[]',
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ackById" TEXT,
    "ackAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolveNote" TEXT,
    "referralType" TEXT,
    "referralDate" TIMESTAMP(3),
    "referralRef" TEXT,
    "outcome" TEXT,

    CONSTRAINT "qc_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qc_records_kind_clientId_idx" ON "qc_records"("kind", "clientId");

-- CreateIndex
CREATE INDEX "qc_records_kind_projectId_idx" ON "qc_records"("kind", "projectId");

-- CreateIndex
CREATE INDEX "qc_templates_code_version_idx" ON "qc_templates"("code", "version");

-- CreateIndex
CREATE INDEX "qc_templates_clientId_idx" ON "qc_templates"("clientId");

-- CreateIndex
CREATE INDEX "qc_templates_projectId_idx" ON "qc_templates"("projectId");

-- CreateIndex
CREATE INDEX "qc_template_items_templateId_sortOrder_idx" ON "qc_template_items"("templateId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "qc_inspections_ref_key" ON "qc_inspections"("ref");

-- CreateIndex
CREATE INDEX "qc_inspections_clientId_projectId_idx" ON "qc_inspections"("clientId", "projectId");

-- CreateIndex
CREATE INDEX "qc_inspections_inspectorId_status_idx" ON "qc_inspections"("inspectorId", "status");

-- CreateIndex
CREATE INDEX "qc_inspections_propertyId_idx" ON "qc_inspections"("propertyId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_inspection_results_inspectionId_itemNumber_key" ON "qc_inspection_results"("inspectionId", "itemNumber");

-- CreateIndex
CREATE INDEX "qc_evidence_linkedType_linkedId_idx" ON "qc_evidence"("linkedType", "linkedId");

-- CreateIndex
CREATE INDEX "qc_evidence_clientId_projectId_idx" ON "qc_evidence"("clientId", "projectId");

-- CreateIndex
CREATE INDEX "qc_escalations_defectId_idx" ON "qc_escalations"("defectId");

-- CreateIndex
CREATE INDEX "qc_defects_rectifyDueAt_idx" ON "qc_defects"("rectifyDueAt");

-- CreateIndex
CREATE INDEX "qc_defects_sourceInspectionId_idx" ON "qc_defects"("sourceInspectionId");

-- AddForeignKey
ALTER TABLE "qc_template_items" ADD CONSTRAINT "qc_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "qc_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_inspection_results" ADD CONSTRAINT "qc_inspection_results_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "qc_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_escalations" ADD CONSTRAINT "qc_escalations_defectId_fkey" FOREIGN KEY ("defectId") REFERENCES "qc_defects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

