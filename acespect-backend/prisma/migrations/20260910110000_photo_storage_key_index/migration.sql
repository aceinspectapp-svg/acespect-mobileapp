-- Photo storage moved back to Egnyte; this table is now just an id -> Egnyte
-- path index rather than holding bytes.
ALTER TABLE "photos" ADD COLUMN "storageKey" TEXT;
ALTER TABLE "photos" ALTER COLUMN "data" DROP NOT NULL;
