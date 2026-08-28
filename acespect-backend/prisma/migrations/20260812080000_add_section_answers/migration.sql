-- AlterTable: raw answer tree per section, so a submitted inspection can be
-- reopened for editing without the lossy flattened `fields` view.
ALTER TABLE "sections" ADD COLUMN "answers" JSONB;
