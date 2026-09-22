-- CreateTable
CREATE TABLE "template_acceptances" (
    "id" TEXT NOT NULL,
    "inspectorId" TEXT NOT NULL,
    "inspectionType" TEXT NOT NULL,
    "propertyType" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,
    "acceptedTemplateId" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "template_acceptances_inspectorId_idx" ON "template_acceptances"("inspectorId");

-- CreateIndex
CREATE UNIQUE INDEX "template_acceptances_inspectorId_inspectionType_propertyTyp_key" ON "template_acceptances"("inspectorId", "inspectionType", "propertyType", "sectionKey");

-- AddForeignKey
ALTER TABLE "template_acceptances" ADD CONSTRAINT "template_acceptances_inspectorId_fkey" FOREIGN KEY ("inspectorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_acceptances" ADD CONSTRAINT "template_acceptances_acceptedTemplateId_fkey" FOREIGN KEY ("acceptedTemplateId") REFERENCES "inspection_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
