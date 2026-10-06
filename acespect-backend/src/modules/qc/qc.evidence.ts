/**
 * Evidence files (E23): every photo and document is stored once, hashed with
 * SHA-256 when it is first received so it can later be proven unchanged, and
 * linked to the record it supports. Files that belong to a tenant are served
 * only through short-lived signed links (lib/mediaLinks.ts).
 */
import { createHash } from 'crypto';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { fetchPhotoStream, qcJobFolder, uploadDocument, uploadPhoto } from '../../lib/storage';
import { signMediaUrl } from '../../lib/mediaLinks';
import { recordAudit } from '../../lib/audit';
import { QcContext } from './qc.context';
import { assertWithinPlan } from './qc.master.service';

const IMAGE = /^image\/(jpeg|png|heic|heif|webp)$/i;
const OTHER = /^(application\/pdf|video\/mp4)$/i;
export const MAX_EVIDENCE_BYTES = 50 * 1024 * 1024;
export const PHASES = ['Identification', 'Progress', 'Before rectification', 'After rectification', 'Re-inspection'];

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const kindOf = (mime: string) => (IMAGE.test(mime) ? 'PHOTO' : mime === 'application/pdf' ? 'PDF' : 'VIDEO');

/** Where a defect's or inspection's files go: its project's job-number folder and a readable label (its reference). */
async function placementFor(linkedType: string, linkedId: string, fallbackProjectId: string | null): Promise<{ job: string | null; label: string }> {
  let projectId = fallbackProjectId;
  let label = linkedId;
  if (linkedType === 'Defect') {
    const d = await prisma.qcDefect.findUnique({ where: { id: linkedId }, select: { defectRef: true, property: { select: { projectId: true } } } });
    if (d) { projectId = d.property.projectId; label = d.defectRef ?? linkedId; }
  } else if (linkedType === 'Inspection') {
    const i = await prisma.qcInspection.findUnique({ where: { id: linkedId }, select: { ref: true, projectId: true } });
    if (i) { projectId = i.projectId; label = i.ref ?? linkedId; }
  }
  return { job: projectId ? await qcJobFolder(projectId) : null, label };
}

/** Folder for a defect's photos taken outside the evidence screen (actions, comments, task updates). */
export async function defectPlacement(defectId: string) {
  return placementFor('Defect', defectId, null);
}

export interface EvidenceMeta {
  linkedType: string;
  linkedId: string;
  clientId: string | null;
  projectId: string | null;
  phase?: string;
  caption?: string | null;
  capturedAt?: Date | null;
  capturedVia?: 'In-app camera' | 'Device library';
  peopleShown?: boolean;
}

/** Store, hash and register uploaded files. Returns the rows with signed links. */
export async function uploadEvidence(ctx: QcContext, files: Express.Multer.File[], meta: EvidenceMeta) {
  if (files.length === 0) throw ApiError.badRequest('Attach at least one file');
  if (meta.phase && !PHASES.includes(meta.phase)) throw ApiError.badRequest('Choose the phase this evidence belongs to');
  const out = [];
  const place = await placementFor(meta.linkedType, meta.linkedId, meta.projectId);
  if (meta.clientId) await assertWithinPlan(meta.clientId, 'storage', files.reduce((a, f) => a + f.size, 0));
  for (const file of files) {
    const mime = file.mimetype || 'application/octet-stream';
    if (!IMAGE.test(mime) && !OTHER.test(mime)) throw ApiError.badRequest(`${file.originalname}: only JPEG, PNG, HEIC, MP4 and PDF files are accepted`);
    if (file.size > MAX_EVIDENCE_BYTES) throw ApiError.badRequest(`${file.originalname} is larger than 50 MB`);
    const ext = (file.originalname.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const stored = IMAGE.test(mime)
      ? await uploadPhoto(file.buffer, mime, ext, meta.linkedType === 'Defect' ? 'Defects' : meta.linkedType === 'Inspection' ? 'Inspections' : 'Evidence', place.label, meta.clientId ?? undefined, place.job ?? undefined)
      : await uploadDocument(file.buffer, mime, ext, `Evidence/${place.label}`, meta.clientId ?? undefined, place.job ?? undefined);
    const row = await prisma.qcEvidence.create({
      data: {
        clientId: meta.clientId, projectId: meta.projectId, linkedType: meta.linkedType, linkedId: meta.linkedId, kind: kindOf(mime), phase: meta.phase ?? 'Identification',
        caption: meta.caption ?? null, url: stored.url, fileHash: stored.storedHash ?? sha256(file.buffer), fileName: file.originalname, mime, sizeBytes: file.size,
        capturedAt: meta.capturedAt ?? null, capturedVia: meta.capturedVia ?? 'Device library', peopleShown: meta.peopleShown ?? false, uploadedById: ctx.userId,
      },
    });
    out.push(serializeEvidence(row));
  }
  await recordAudit({ clientId: meta.clientId, entityType: meta.linkedType, entityId: meta.linkedId, action: 'evidence.upload', actor: { id: ctx.userId, role: ctx.role }, after: { files: out.length } });
  return out;
}

/** Register photos that were just uploaded against a defect (action, comment, task update) so they are hashed and served only through signed links. */
export async function registerDefectUploads(uploads: Array<{ url: string; hash?: string; name?: string; mime?: string; size?: number }>, defectId: string, userId: string, phase = 'Progress'): Promise<void> {
  if (uploads.length === 0) return;
  const d = await prisma.qcDefect.findUnique({ where: { id: defectId }, select: { property: { select: { projectId: true, project: { select: { clientId: true } } } } } });
  if (!d) return;
  for (const u of uploads) {
    await prisma.qcEvidence.create({
      data: { clientId: d.property.project.clientId, projectId: d.property.projectId, linkedType: 'Defect', linkedId: defectId, kind: 'PHOTO', phase, url: u.url, fileHash: u.hash ?? 'unavailable', fileName: u.name ?? null, mime: u.mime ?? 'image/jpeg', sizeBytes: u.size ?? null, capturedVia: 'In-app camera', uploadedById: userId },
    });
  }
}

export function serializeEvidence(e: { id: string; url: string; kind: string; phase: string | null; caption: string | null; fileHash: string; fileName: string | null; mime: string | null; sizeBytes: number | null; capturedAt: Date | null; capturedVia: string | null; peopleShown: boolean; uploadedAt: Date; uploadedById: string | null; linkedType: string; linkedId: string }) {
  return { id: e.id, url: signMediaUrl(e.url), rawUrl: e.url, kind: e.kind, phase: e.phase, caption: e.caption, fileHash: e.fileHash, fileName: e.fileName, mime: e.mime, sizeBytes: e.sizeBytes, capturedAt: e.capturedAt, capturedVia: e.capturedVia, peopleShown: e.peopleShown, uploadedAt: e.uploadedAt, uploadedById: e.uploadedById, linkedType: e.linkedType, linkedId: e.linkedId };
}

/**
 * Link a file that was uploaded earlier (a photo already on a defect, say) to
 * a record. If it was never registered, it is fetched once and hashed.
 */
export async function hashStoredFile(args: { url: string; linkedType: string; linkedId: string; clientId: string | null; projectId: string | null; userId: string; phase?: string; caption?: string | null }): Promise<void> {
  const url = args.url.split('?')[0]!;
  const existing = await prisma.qcEvidence.findFirst({ where: { url } });
  if (existing) {
    if (existing.linkedId !== args.linkedId) {
      // The same file may support more than one record; keep the first link and add a reference row sharing the hash.
      await prisma.qcEvidence.create({ data: { clientId: args.clientId, projectId: args.projectId, linkedType: args.linkedType, linkedId: args.linkedId, kind: existing.kind, phase: args.phase ?? existing.phase, caption: args.caption ?? existing.caption, url, fileHash: existing.fileHash, fileName: existing.fileName, mime: existing.mime, sizeBytes: existing.sizeBytes, uploadedById: args.userId } });
    }
    return;
  }
  const id = /\/media\/([0-9a-f-]{36})/i.exec(url)?.[1];
  let hash = 'unavailable';
  let mime: string | undefined;
  if (id) {
    try {
      const f = await fetchPhotoStream(id);
      if (f) {
        const chunks: Buffer[] = [];
        for await (const c of f.body as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
        hash = sha256(Buffer.concat(chunks));
        mime = f.contentType;
      }
    } catch {
      /* the file stays registered with an unavailable hash rather than blocking the inspector */
    }
  }
  await prisma.qcEvidence.create({ data: { clientId: args.clientId, projectId: args.projectId, linkedType: args.linkedType, linkedId: args.linkedId, kind: 'PHOTO', phase: args.phase ?? 'Identification', caption: args.caption ?? null, url, fileHash: hash, mime: mime ?? 'image/jpeg', uploadedById: args.userId } });
}

export async function listEvidence(linkedType: string, linkedId: string) {
  const rows = await prisma.qcEvidence.findMany({ where: { linkedType, linkedId }, orderBy: { uploadedAt: 'asc' } });
  return rows.map((r, i) => ({ ...serializeEvidence(r), photoNumber: i + 1 }));
}

/** Prove a stored file is unchanged by hashing it again and comparing with the hash taken at upload. */
export async function verifyEvidence(id: string): Promise<{ ok: boolean; stored: string; current: string | null }> {
  const e = await prisma.qcEvidence.findUnique({ where: { id } });
  if (!e) throw ApiError.notFound('Evidence not found');
  const mid = /\/media\/([0-9a-f-]{36})/i.exec(e.url)?.[1];
  const f = mid ? await fetchPhotoStream(mid) : null;
  if (!f) return { ok: false, stored: e.fileHash, current: null };
  const chunks: Buffer[] = [];
  for await (const c of f.body as unknown as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(c));
  const current = sha256(Buffer.concat(chunks));
  return { ok: current === e.fileHash, stored: e.fileHash, current };
}
