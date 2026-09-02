ALTER TABLE "inspections" ADD COLUMN "baselineInspectionId" TEXT;
CREATE INDEX "inspections_baselineInspectionId_idx" ON "inspections"("baselineInspectionId");
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_baselineInspectionId_fkey"
  FOREIGN KEY ("baselineInspectionId") REFERENCES "inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
