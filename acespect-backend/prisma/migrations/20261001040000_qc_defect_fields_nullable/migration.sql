-- AlterTable
ALTER TABLE "qc_defects" ALTER COLUMN "location" DROP NOT NULL;
ALTER TABLE "qc_defects" ALTER COLUMN "summary" DROP NOT NULL;
ALTER TABLE "qc_defects" ALTER COLUMN "severityId" DROP NOT NULL;
