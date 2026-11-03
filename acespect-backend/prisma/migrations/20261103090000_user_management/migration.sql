-- Houspect user management: who switched an account off and why, and who added it. Additive only; nothing existing changes.
ALTER TABLE "users" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "deactivatedById" TEXT;
ALTER TABLE "users" ADD COLUMN "deactivationReason" TEXT;
ALTER TABLE "users" ADD COLUMN "createdById" TEXT;
