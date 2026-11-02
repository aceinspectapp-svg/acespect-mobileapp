-- A reviewer's request to take over an inspection assigned to another reviewer, which the current assignee must agree to.
-- Additive only: a new enum and a new table; no existing table or column changes.

CREATE TYPE "TransferRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED', 'CANCELLED');

CREATE TABLE "inspection_transfer_requests" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "fromReviewerId" TEXT NOT NULL,
    "toReviewerId" TEXT NOT NULL,
    "status" "TransferRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "inspection_transfer_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inspection_transfer_requests_inspectionId_status_idx" ON "inspection_transfer_requests"("inspectionId", "status");
CREATE INDEX "inspection_transfer_requests_fromReviewerId_status_idx" ON "inspection_transfer_requests"("fromReviewerId", "status");
CREATE INDEX "inspection_transfer_requests_toReviewerId_status_idx" ON "inspection_transfer_requests"("toReviewerId", "status");

ALTER TABLE "inspection_transfer_requests" ADD CONSTRAINT "inspection_transfer_requests_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
