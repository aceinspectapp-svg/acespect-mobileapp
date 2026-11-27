import { createReadStream, createWriteStream } from 'fs';
import { mkdir, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { pipeline } from 'stream/promises';
import { isProd } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { azureConfigured, deleteBlob, getBlob, putBlobFile } from '../../lib/blobStorage';
import { ApiError } from '../../utils/ApiError';
import { planUpload, samePlan, type CurrentVersion, type UploadMode, type UploadPlan } from './finalReports.rules';

/** One listed version (or, with replacedAt set, a replaced one kept for the record). */
export interface FinalVersionRow {
  id: string;
  inspectionId: string;
  versionNumber: number;
  blobPath: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  note: string | null;
  uploadedAt: Date;
  replacedAt: Date | null;
  uploadedBy: { id: string; name: string | null; email: string };
}

export interface NewVersion {
  id: string;
  inspectionId: string;
  blobPath: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
  note: string | null;
  uploadedById: string;
}

export interface CommitInput {
  plan: UploadPlan;
  mode: UploadMode | undefined;
  /** The latest version number when the plan was made (0 = none). */
  seenLatest: number;
  row: NewVersion;
}

/** The database side, so a test can stand in for it. */
export interface FinalReportRepo {
  /** Throws 404 when the inspection does not exist, 403 when this reviewer may not open it (the same rule as the review page). */
  assertCanView(inspectionId: string, user: { id: string; role: string }): Promise<{ jobNo: string | null }>;
  /** The versions not replaced, newest first. */
  listCurrent(inspectionId: string): Promise<FinalVersionRow[]>;
  findVersion(inspectionId: string, versionId: string): Promise<FinalVersionRow | null>;
  /**
   * Saves the upload as planned, under a lock per inspection. The plan is worked out again inside the lock; if it is not the one the file was
   * stored for (someone else uploaded in the meantime) nothing is saved and VERSIONS_CHANGED is thrown. A replace marks the replaced row
   * (replacedAt / replacedById / replacedByUploadId) and never touches any other row.
   */
  commit(input: CommitInput): Promise<{ saved: FinalVersionRow; replaced: FinalVersionRow | null }>;
}

/** Where the files are kept, so a test can stand in for it. */
export interface FinalReportStore {
  put(path: string, filePath: string, contentType: string): Promise<void>;
  get(path: string): Promise<{ stream: NodeJS.ReadableStream; length: number } | null>;
  /** Only for a file stored for an upload that was then not saved (never for a saved or replaced version). */
  discard(path: string): Promise<void>;
}

const select = {
  id: true, inspectionId: true, versionNumber: true, blobPath: true, fileName: true, sizeBytes: true, contentType: true, note: true,
  uploadedAt: true, replacedAt: true, uploadedBy: { select: { id: true, name: true, email: true } },
} as const;

export function prismaRepo(assertCanViewInspection: (id: string, user: { id: string; role: string }) => Promise<void>): FinalReportRepo {
  return {
    async assertCanView(inspectionId, user) {
      await assertCanViewInspection(inspectionId, user);
      const row = await prisma.inspection.findUnique({ where: { id: inspectionId }, select: { jobNo: true } });
      if (!row) throw ApiError.notFound('Inspection not found');
      return row;
    },
    listCurrent: (inspectionId) =>
      prisma.reportFinalVersion.findMany({ where: { inspectionId, replacedAt: null }, orderBy: { versionNumber: 'desc' }, select }),
    findVersion: (inspectionId, versionId) =>
      prisma.reportFinalVersion.findFirst({ where: { id: versionId, inspectionId, replacedAt: null }, select }),
    commit: ({ plan, mode, seenLatest, row }) =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'final-report:' + row.inspectionId}))`;
        const current: CurrentVersion[] = await tx.reportFinalVersion.findMany({ where: { inspectionId: row.inspectionId, replacedAt: null }, select: { id: true, versionNumber: true } });
        if (!samePlan(plan, planUpload(current, mode, seenLatest))) throw new ApiError(409, 'The versions changed while you were uploading. Reload the list and upload again.', 'VERSIONS_CHANGED');
        let replaced: FinalVersionRow | null = null;
        if (plan.kind === 'replace') {
          // Only the latest listed row, and only if it is still not replaced (the update matches nothing otherwise).
          const marked = await tx.reportFinalVersion.updateMany({
            where: { id: plan.replaces.id, inspectionId: row.inspectionId, replacedAt: null },
            data: { replacedAt: new Date(), replacedById: row.uploadedById, replacedByUploadId: row.id },
          });
          if (marked.count !== 1) throw new ApiError(409, 'The versions changed while you were uploading. Reload the list and upload again.', 'VERSIONS_CHANGED');
          replaced = await tx.reportFinalVersion.findUnique({ where: { id: plan.replaces.id }, select });
        }
        const saved = await tx.reportFinalVersion.create({ data: { ...row, versionNumber: plan.versionNumber }, select });
        return { saved, replaced };
      }),
  };
}

/**
 * The private Azure container (lib/blobStorage.ts, managed identity; nothing public, no SAS, no shared key). Files are only ever read back
 * through the API. Local development without Azure keeps them in a folder on this machine instead; production without Azure refuses.
 */
export function defaultStore(): FinalReportStore {
  if (azureConfigured()) {
    return {
      put: (path, filePath, contentType) => putBlobFile(path, filePath, contentType),
      get: async (path) => {
        const b = await getBlob(path);
        return b ? { stream: b.stream, length: b.length } : null;
      },
      discard: (path) => deleteBlob(path),
    };
  }
  const root = join(tmpdir(), 'acespect-final-reports');
  const local = (path: string) => join(root, path.replace(/\.\./g, ''));
  const unavailable = () => new ApiError(503, 'File storage is not configured, so final reports cannot be stored.', 'STORAGE_UNAVAILABLE');
  return {
    put: async (path, filePath) => {
      if (isProd) throw unavailable();
      await mkdir(dirname(local(path)), { recursive: true });
      await pipeline(createReadStream(filePath), createWriteStream(local(path)));
    },
    get: async (path) => {
      if (isProd) throw unavailable();
      const s = await stat(local(path)).catch(() => null);
      return s ? { stream: createReadStream(local(path)), length: s.size } : null;
    },
    discard: async () => undefined,
  };
}
