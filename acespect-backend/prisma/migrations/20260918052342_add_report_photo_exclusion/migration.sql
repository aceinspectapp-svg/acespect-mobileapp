-- AlterTable
ALTER TABLE "damages" ADD COLUMN     "excludedPhotoUrls" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "sections" ADD COLUMN     "excludedPhotoUrls" JSONB NOT NULL DEFAULT '[]';
