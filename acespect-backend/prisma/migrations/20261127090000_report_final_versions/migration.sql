-- Final Report Versions: hand-edited Word reports uploaded per inspection (web, ADMIN / REVIEWER only).
-- Additive only: one new table with its own indexes and foreign keys. No existing table, column or row is changed.

-- CreateTable
CREATE TABLE "report_final_versions" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "blobPath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "note" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "replacedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "replacedByUploadId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,

    CONSTRAINT "report_final_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_final_versions_blobPath_key" ON "report_final_versions"("blobPath");

-- CreateIndex
CREATE INDEX "report_final_versions_inspectionId_versionNumber_idx" ON "report_final_versions"("inspectionId", "versionNumber");

-- One listed (not replaced) row per inspection and version number. A replaced row keeps its number, so the rule applies only while
-- "replacedAt" is null (Prisma's schema cannot express a partial index, so it is written here by hand).
CREATE UNIQUE INDEX "report_final_versions_current_key" ON "report_final_versions"("inspectionId", "versionNumber") WHERE "replacedAt" IS NULL;

-- AddForeignKey
ALTER TABLE "report_final_versions" ADD CONSTRAINT "report_final_versions_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_final_versions" ADD CONSTRAINT "report_final_versions_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_final_versions" ADD CONSTRAINT "report_final_versions_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_final_versions" ADD CONSTRAINT "report_final_versions_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
