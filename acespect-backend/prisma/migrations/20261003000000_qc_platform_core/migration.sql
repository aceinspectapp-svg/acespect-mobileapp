-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastFailedAt" TIMESTAMP(3),
ADD COLUMN     "lastSignInAt" TIMESTAMP(3),
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "mfaBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfaSecret" TEXT,
ADD COLUMN     "microsoftId" TEXT,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "privacyAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "privacyVersion" TEXT,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsVersion" TEXT,
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "qc_invitations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "qc_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_password_resets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_support_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ticketRef" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "qc_support_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_security_events" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_audit_entries" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT NOT NULL,
    "supportSessionId" TEXT,
    "reason" TEXT,
    "before" JSONB,
    "after" JSONB,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "mandatory" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "ackedAt" TIMESTAMP(3),
    "emailStatus" TEXT NOT NULL DEFAULT 'NONE',
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_notification_prefs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" TEXT NOT NULL DEFAULT 'IMMEDIATE',

    CONSTRAINT "qc_notification_prefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_push_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_job_leases" (
    "name" TEXT NOT NULL,
    "leasedUntil" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,

    CONSTRAINT "qc_job_leases_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE UNIQUE INDEX "qc_invitations_tokenHash_key" ON "qc_invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "qc_invitations_userId_idx" ON "qc_invitations"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_password_resets_tokenHash_key" ON "qc_password_resets"("tokenHash");

-- CreateIndex
CREATE INDEX "qc_password_resets_userId_idx" ON "qc_password_resets"("userId");

-- CreateIndex
CREATE INDEX "qc_support_sessions_userId_endedAt_idx" ON "qc_support_sessions"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "qc_support_sessions_clientId_startedAt_idx" ON "qc_support_sessions"("clientId", "startedAt");

-- CreateIndex
CREATE INDEX "qc_security_events_clientId_createdAt_idx" ON "qc_security_events"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "qc_security_events_userId_createdAt_idx" ON "qc_security_events"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "qc_security_events_type_createdAt_idx" ON "qc_security_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "qc_audit_entries_clientId_createdAt_idx" ON "qc_audit_entries"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "qc_audit_entries_entityType_entityId_idx" ON "qc_audit_entries"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "qc_notifications_userId_readAt_createdAt_idx" ON "qc_notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "qc_notifications_emailStatus_idx" ON "qc_notifications"("emailStatus");

-- CreateIndex
CREATE UNIQUE INDEX "qc_notification_prefs_userId_eventType_key" ON "qc_notification_prefs"("userId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "qc_push_tokens_token_key" ON "qc_push_tokens"("token");

-- CreateIndex
CREATE INDEX "qc_push_tokens_userId_idx" ON "qc_push_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "users_microsoftId_key" ON "users"("microsoftId");

-- AddForeignKey
ALTER TABLE "qc_invitations" ADD CONSTRAINT "qc_invitations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_password_resets" ADD CONSTRAINT "qc_password_resets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_support_sessions" ADD CONSTRAINT "qc_support_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_notifications" ADD CONSTRAINT "qc_notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_notification_prefs" ADD CONSTRAINT "qc_notification_prefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_push_tokens" ADD CONSTRAINT "qc_push_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

