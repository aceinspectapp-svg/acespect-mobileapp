-- Audit trail: append-only events + anchors. Additive; nothing existing is changed.
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientTime" TIMESTAMP(3),
    "clientSkewMs" INTEGER,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'success',
    "severity" TEXT NOT NULL DEFAULT 'info',
    "actorId" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "actorType" TEXT NOT NULL DEFAULT 'user',
    "source" TEXT NOT NULL DEFAULT 'api',
    "appName" TEXT,
    "appVersion" TEXT,
    "updateId" TEXT,
    "platform" TEXT,
    "osVersion" TEXT,
    "deviceModel" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "targetType" TEXT,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "inspectionId" TEXT,
    "jobNo" TEXT,
    "correlationId" TEXT,
    "requestId" TEXT,
    "clientEventId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "message" TEXT,
    "metadata" JSONB,
    "stream" TEXT NOT NULL,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "audit_events_seq_key" ON "audit_events"("seq");
CREATE UNIQUE INDEX "audit_events_clientEventId_key" ON "audit_events"("clientEventId");
CREATE INDEX "audit_events_occurredAt_idx" ON "audit_events"("occurredAt");
CREATE INDEX "audit_events_inspectionId_seq_idx" ON "audit_events"("inspectionId", "seq");
CREATE INDEX "audit_events_actorId_occurredAt_idx" ON "audit_events"("actorId", "occurredAt");
CREATE INDEX "audit_events_action_occurredAt_idx" ON "audit_events"("action", "occurredAt");
CREATE INDEX "audit_events_category_occurredAt_idx" ON "audit_events"("category", "occurredAt");
CREATE INDEX "audit_events_correlationId_idx" ON "audit_events"("correlationId");
CREATE INDEX "audit_events_stream_seq_idx" ON "audit_events"("stream", "seq");
CREATE INDEX "audit_events_jobNo_idx" ON "audit_events"("jobNo");
CREATE INDEX "audit_events_outcome_occurredAt_idx" ON "audit_events"("outcome", "occurredAt");

CREATE TABLE "audit_anchors" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "upToSeq" BIGINT NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "digest" TEXT NOT NULL,
    "prevDigest" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_anchors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "audit_anchors_seq_key" ON "audit_anchors"("seq");

-- Append-only: the database itself refuses to change or remove an audit row. The only exception is the retention job, which deletes rows past
-- the retention period inside a transaction that sets app.audit_purge = 'on' (DELETE only; an UPDATE is never allowed).
CREATE OR REPLACE FUNCTION audit_block_changes() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('app.audit_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit records cannot be changed or deleted (% on %)', TG_OP, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON "audit_events" FOR EACH ROW EXECUTE FUNCTION audit_block_changes();
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON "audit_events" FOR EACH STATEMENT EXECUTE FUNCTION audit_block_changes();
CREATE TRIGGER audit_anchors_immutable BEFORE UPDATE OR DELETE ON "audit_anchors" FOR EACH ROW EXECUTE FUNCTION audit_block_changes();
CREATE TRIGGER audit_anchors_no_truncate BEFORE TRUNCATE ON "audit_anchors" FOR EACH STATEMENT EXECUTE FUNCTION audit_block_changes();
