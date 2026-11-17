-- The reviewer's own wording of a section's report text (additive; existing rows get an empty object).
ALTER TABLE "sections" ADD COLUMN "textEdits" JSONB NOT NULL DEFAULT '{}';
