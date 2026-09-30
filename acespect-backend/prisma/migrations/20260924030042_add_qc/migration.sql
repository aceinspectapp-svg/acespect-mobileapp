-- CreateEnum
CREATE TYPE "QcTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "QcTaskPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'FIELD_USER';

-- CreateTable
CREATE TABLE "qc_clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_property_types" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT 'home-outline',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "qc_property_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_properties" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "propertyTypeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_severities" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "qc_severities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_statuses" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "meaning" TEXT NOT NULL DEFAULT '',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "qc_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_defects" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "locationDetails" TEXT,
    "summary" TEXT NOT NULL,
    "severityId" TEXT NOT NULL,
    "statusId" TEXT NOT NULL,
    "assignedToId" TEXT,
    "dueDate" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_defects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_tasks" (
    "id" TEXT NOT NULL,
    "defectId" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "priority" "QcTaskPriority" NOT NULL DEFAULT 'LOW',
    "status" "QcTaskStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qc_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qc_task_updates" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "photoUrls" JSONB NOT NULL DEFAULT '[]',
    "statusAfter" "QcTaskStatus" NOT NULL,
    "statusChanged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qc_task_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "qc_projects_clientId_idx" ON "qc_projects"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_property_types_key_key" ON "qc_property_types"("key");

-- CreateIndex
CREATE INDEX "qc_properties_projectId_idx" ON "qc_properties"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "qc_severities_key_key" ON "qc_severities"("key");

-- CreateIndex
CREATE UNIQUE INDEX "qc_statuses_key_key" ON "qc_statuses"("key");

-- CreateIndex
CREATE INDEX "qc_defects_propertyId_idx" ON "qc_defects"("propertyId");

-- CreateIndex
CREATE INDEX "qc_defects_assignedToId_idx" ON "qc_defects"("assignedToId");

-- CreateIndex
CREATE INDEX "qc_defects_statusId_idx" ON "qc_defects"("statusId");

-- CreateIndex
CREATE INDEX "qc_tasks_defectId_idx" ON "qc_tasks"("defectId");

-- CreateIndex
CREATE INDEX "qc_tasks_assignedToId_idx" ON "qc_tasks"("assignedToId");

-- CreateIndex
CREATE INDEX "qc_task_updates_taskId_idx" ON "qc_task_updates"("taskId");

-- AddForeignKey
ALTER TABLE "qc_projects" ADD CONSTRAINT "qc_projects_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "qc_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_properties" ADD CONSTRAINT "qc_properties_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "qc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_properties" ADD CONSTRAINT "qc_properties_propertyTypeId_fkey" FOREIGN KEY ("propertyTypeId") REFERENCES "qc_property_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defects" ADD CONSTRAINT "qc_defects_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "qc_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defects" ADD CONSTRAINT "qc_defects_severityId_fkey" FOREIGN KEY ("severityId") REFERENCES "qc_severities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defects" ADD CONSTRAINT "qc_defects_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "qc_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defects" ADD CONSTRAINT "qc_defects_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_defects" ADD CONSTRAINT "qc_defects_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_tasks" ADD CONSTRAINT "qc_tasks_defectId_fkey" FOREIGN KEY ("defectId") REFERENCES "qc_defects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_tasks" ADD CONSTRAINT "qc_tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_updates" ADD CONSTRAINT "qc_task_updates_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "qc_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qc_task_updates" ADD CONSTRAINT "qc_task_updates_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
