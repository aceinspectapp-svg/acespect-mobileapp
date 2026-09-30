-- CreateTable
CREATE TABLE "submission_log_entries" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "inspectorId" TEXT,
    "inspectionId" TEXT,
    "jobNo" TEXT,
    "statusCode" INTEGER,
    "message" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_log_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "submission_log_entries_inspectorId_idx" ON "submission_log_entries"("inspectorId");

-- CreateIndex
CREATE INDEX "submission_log_entries_inspectionId_idx" ON "submission_log_entries"("inspectionId");

-- CreateIndex
CREATE INDEX "submission_log_entries_createdAt_idx" ON "submission_log_entries"("createdAt");

-- AddForeignKey
ALTER TABLE "submission_log_entries" ADD CONSTRAINT "submission_log_entries_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
