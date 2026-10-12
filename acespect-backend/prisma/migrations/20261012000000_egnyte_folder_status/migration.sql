-- Where an inspection's photos were placed in Egnyte ({root}/{batch}/{job}), and whether the office needs to look at it.
ALTER TABLE "inspections" ADD COLUMN "egnytePath" TEXT,
ADD COLUMN "egnyteStatus" TEXT,
ADD COLUMN "egnyteMessage" TEXT,
ADD COLUMN "egnyteCheckedAt" TIMESTAMP(3);
