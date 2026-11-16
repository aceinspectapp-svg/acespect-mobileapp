-- Reviewer photo tools: rotated / cropped copies remember their original, reviewer-added photos are marked, and a section remembers how each photo prints.
ALTER TABLE "photos" ADD COLUMN "editedFromId" TEXT;
ALTER TABLE "photos" ADD COLUMN "edit" JSONB;
ALTER TABLE "photos" ADD COLUMN "addedById" TEXT;
ALTER TABLE "sections" ADD COLUMN "photoMeta" JSONB NOT NULL DEFAULT '{}';
