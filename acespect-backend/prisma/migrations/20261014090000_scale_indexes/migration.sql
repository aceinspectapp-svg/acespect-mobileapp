-- Indexes for the queries that grow with the data (all additive; nothing is changed or removed).
CREATE INDEX IF NOT EXISTS "photos_storageKey_idx" ON "photos"("storageKey");
CREATE INDEX IF NOT EXISTS "inspections_status_idx" ON "inspections"("status");
CREATE INDEX IF NOT EXISTS "inspections_date_idx" ON "inspections"("date");
CREATE INDEX IF NOT EXISTS "inspections_updatedAt_idx" ON "inspections"("updatedAt");
CREATE INDEX IF NOT EXISTS "sections_updatedAt_idx" ON "sections"("updatedAt");
CREATE INDEX IF NOT EXISTS "submission_log_entries_event_createdAt_idx" ON "submission_log_entries"("event", "createdAt");
