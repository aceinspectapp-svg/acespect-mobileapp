/**
 * HTTP layer for templates, project set-up, inspections, evidence and reports.
 * Capability checks sit in the routes; tenant and project scope sit here.
 */
import { Request } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { ApiError } from '../../utils/ApiError';
import { prisma } from '../../lib/prisma';
import { ctxOf, requireTenant, QcContext } from './qc.context';
import { guardEntity } from './qc.guard';
import { payloadOf } from './qc.admin.controller';
import * as tpl from './qc.templates.service';
import * as proj from './qc.projects.service';
import * as insp from './qc.inspections.service';
import * as ev from './qc.evidence';
import * as rep from './qc.reports.service';
import { uploadDocument } from '../../lib/storage';

const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const id = (req: Request) => String(req.params.id ?? '');
const scopeOf = (ctx: QcContext): tpl.TemplateScope => ({ isSA: ctx.isSA, clientId: ctx.clientId, projectIds: ctx.projectIds });
const files = (req: Request) => (req.files as Express.Multer.File[] | undefined) ?? [];

export const qcWorkflowController = {
  // ─── Stage definitions (E15) and result codes (E18) ───
  listStages: asyncHandler(async (_req, res) => {
    res.status(200).json({ stages: await tpl.listStages() });
  }),
  saveStage: asyncHandler(async (req, res) => {
    res.status(req.params.id ? 200 : 201).json({ stage: await tpl.saveStage(ctxOf(req), req.params.id ?? null, payloadOf(req)) });
  }),
  listResultCodes: asyncHandler(async (req, res) => {
    res.status(200).json({ resultCodes: await tpl.listResultCodes(ctxOf(req).clientId) });
  }),
  saveResultCode: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    // The Super Admin edits the platform definitions; a client renames its own labels.
    const clientId = ctx.isSA && !ctx.clientId ? null : requireTenant(ctx);
    res.status(200).json({ resultCode: await tpl.saveResultCode(ctx, clientId, String(req.params.code), payloadOf(req)) });
  }),

  // ─── Templates (E16/E17) ───
  listTemplates: asyncHandler(async (req, res) => {
    res.status(200).json({ templates: await tpl.listTemplates(scopeOf(ctxOf(req)), { level: q(req.query.level), stageKey: q(req.query.stageKey), status: q(req.query.status), code: q(req.query.code) }) });
  }),
  getTemplate: asyncHandler(async (req, res) => {
    res.status(200).json({ template: await tpl.getTemplate(scopeOf(ctxOf(req)), id(req)) });
  }),
  createTemplate: asyncHandler(async (req, res) => {
    res.status(201).json({ template: await tpl.createBaseTemplate(ctxOf(req), payloadOf(req)) });
  }),
  updateTemplate: asyncHandler(async (req, res) => {
    res.status(200).json({ template: await tpl.updateTemplateHeader(ctxOf(req), id(req), payloadOf(req)) });
  }),
  addItem: asyncHandler(async (req, res) => {
    res.status(201).json({ item: await tpl.addItem(ctxOf(req), id(req), payloadOf(req)) });
  }),
  updateItem: asyncHandler(async (req, res) => {
    res.status(200).json({ item: await tpl.updateItem(ctxOf(req), id(req), payloadOf(req)) });
  }),
  removeItem: asyncHandler(async (req, res) => {
    await tpl.removeItem(ctxOf(req), id(req));
    res.status(204).send();
  }),
  newDraft: asyncHandler(async (req, res) => {
    res.status(201).json({ template: await tpl.newDraftVersion(ctxOf(req), id(req)) });
  }),
  publish: asyncHandler(async (req, res) => {
    res.status(200).json({ template: await tpl.publishTemplate(ctxOf(req), id(req), payloadOf(req)) });
  }),
  adopt: asyncHandler(async (req, res) => {
    const body = payloadOf(req);
    res.status(200).json(await tpl.adoptVersion(ctxOf(req), id(req), Array.isArray(body.projectIds) ? (body.projectIds as string[]) : []));
  }),
  clone: asyncHandler(async (req, res) => {
    res.status(201).json({ template: await tpl.cloneTemplate(ctxOf(req), id(req), payloadOf(req)) });
  }),
  diff: asyncHandler(async (req, res) => {
    res.status(200).json(await tpl.diffWithParent(ctxOf(req), id(req)));
  }),
  merge: asyncHandler(async (req, res) => {
    const body = payloadOf(req);
    res.status(200).json(await tpl.mergeFromParent(ctxOf(req), id(req), { itemNumbers: Array.isArray(body.itemNumbers) ? (body.itemNumbers as string[]) : [], overwriteLocal: body.overwriteLocal === true }));
  }),
  exportTemplate: asyncHandler(async (req, res) => {
    const buf = await tpl.exportTemplateXlsx(scopeOf(ctxOf(req)), id(req));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="checklist.xlsx"');
    res.status(200).send(buf);
  }),
  importTemplate: asyncHandler(async (req, res) => {
    const f = files(req)[0];
    if (!f) throw ApiError.badRequest('Attach an Excel workbook');
    const body = payloadOf(req);
    res.status(200).json({ report: await tpl.importTemplateXlsx(ctxOf(req), id(req), f.buffer, { partial: body.partial === true || body.partial === 'true' }) });
  }),

  // ─── Project documents, plan, lots, status ───
  listDocuments: asyncHandler(async (req, res) => {
    await guardEntity(req, 'project', id(req));
    res.status(200).json({ documents: await proj.listDocuments(ctxOf(req), id(req)) });
  }),
  addDocument: asyncHandler(async (req, res) => {
    await guardEntity(req, 'project', id(req));
    const f = files(req)[0];
    if (!f) throw ApiError.badRequest('Attach the document file');
    const ext = (f.originalname.split('.').pop() || 'pdf').toLowerCase();
    const stored = await uploadDocument(f.buffer, f.mimetype, ext, `projects/${id(req)}`);
    res.status(201).json({ document: await proj.addDocument(ctxOf(req), id(req), payloadOf(req), { url: stored.url, name: f.originalname, size: f.size, mime: f.mimetype }) });
  }),
  getPlan: asyncHandler(async (req, res) => {
    await guardEntity(req, 'project', id(req));
    res.status(200).json({ plan: await proj.getPlan(id(req)) });
  }),
  seedPlan: asyncHandler(async (req, res) => {
    await guardEntity(req, 'project', id(req));
    res.status(200).json({ plan: await proj.seedPlan(ctxOf(req), id(req)) });
  }),
  updatePlanStage: asyncHandler(async (req, res) => {
    await guardEntity(req, 'project', id(req));
    res.status(200).json({ plan: await proj.updatePlanStage(ctxOf(req), id(req), String(req.params.stageRowId), payloadOf(req)) });
  }),
  planMatrix: asyncHandler(async (req, res) => {
    await guardEntity(req, 'project', id(req));
    res.status(200).json(await proj.planMatrix(id(req), q(req.query.siteId)));
  }),
  importLots: asyncHandler(async (req, res) => {
    await guardEntity(req, 'site', id(req));
    const f = files(req)[0];
    const body = payloadOf(req);
    const csv = f ? f.buffer.toString('utf8') : String(body.csv ?? '');
    if (!csv.trim()) throw ApiError.badRequest('Attach a CSV file');
    res.status(200).json({ report: await proj.importLots(ctxOf(req), id(req), csv, { mode: body.mode === 'update' || body.import_mode === 'Add and update existing' ? 'update' : 'add', partial: body.partial === true || body.partial === 'true' }) });
  }),
  lotCsvTemplate: asyncHandler(async (_req, res) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="lots-template.csv"');
    res.status(200).send(proj.csvTemplate());
  }),
  transitionProject: asyncHandler(async (req, res) => {
    await guardEntity(req, 'project', id(req));
    const body = payloadOf(req);
    res.status(200).json({ project: await proj.transitionProject(ctxOf(req), id(req), String(body.status ?? ''), q(body.reason)) });
  }),

  // ─── Inspections ───
  listInspections: asyncHandler(async (req, res) => {
    const projectId = q(req.query.projectId);
    if (projectId) await guardEntity(req, 'project', projectId);
    res.status(200).json({
      inspections: await insp.listInspections(ctxOf(req), { projectId, propertyId: q(req.query.propertyId), status: q(req.query.status), stageKey: q(req.query.stageKey), inspectorId: q(req.query.inspectorId), mine: req.query.mine === 'true', from: q(req.query.from), to: q(req.query.to) }),
    });
  }),
  getInspection: asyncHandler(async (req, res) => {
    res.status(200).json(await insp.getInspection(ctxOf(req), id(req)));
  }),
  requestInspection: asyncHandler(async (req, res) => {
    res.status(201).json({ inspections: await insp.requestInspection(ctxOf(req), payloadOf(req)) });
  }),
  planInspections: asyncHandler(async (req, res) => {
    res.status(200).json(await insp.planInspections(ctxOf(req), payloadOf(req)));
  }),
  changeInspection: asyncHandler(async (req, res) => {
    res.status(200).json({ inspection: await insp.changeInspection(ctxOf(req), id(req), payloadOf(req)) });
  }),
  adHoc: asyncHandler(async (req, res) => {
    res.status(201).json({ inspection: await insp.createAdHoc(ctxOf(req), payloadOf(req)) });
  }),
  start: asyncHandler(async (req, res) => {
    res.status(200).json(await insp.startInspection(ctxOf(req), id(req), payloadOf(req)));
  }),
  saveResult: asyncHandler(async (req, res) => {
    res.status(200).json(await insp.saveResult(ctxOf(req), id(req), String(req.params.itemNumber), payloadOf(req)));
  }),
  raiseDefect: asyncHandler(async (req, res) => {
    res.status(201).json(await insp.raiseAnotherDefect(ctxOf(req), id(req), String(req.params.itemNumber)));
  }),
  completionCheck: asyncHandler(async (req, res) => {
    res.status(200).json(await insp.completionCheck(ctxOf(req), id(req)));
  }),
  complete: asyncHandler(async (req, res) => {
    res.status(200).json({ inspection: await insp.completeInspection(ctxOf(req), id(req), payloadOf(req)) });
  }),
  addendum: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const row = await prisma.qcInspection.findUnique({ where: { id: id(req) }, select: { clientId: true, projectId: true } });
    const urls: string[] = [];
    if (row && files(req).length) {
      for (const e of await ev.uploadEvidence(ctx, files(req), { linkedType: 'Inspection', linkedId: id(req), clientId: row.clientId, projectId: row.projectId, phase: 'Progress' })) urls.push(e.rawUrl);
    }
    res.status(201).json({ addenda: await insp.addAddendum(ctx, id(req), payloadOf(req), urls) });
  }),
  inspectionReport: asyncHandler(async (req, res) => {
    res.status(201).json({ report: await rep.stageInspectionReport(ctxOf(req), id(req), req.query.photos !== 'false') });
  }),

  // ─── Evidence ───
  uploadEvidence: asyncHandler(async (req, res) => {
    const ctx = ctxOf(req);
    const body = payloadOf(req);
    const linkedType = String(body.linkedType ?? '');
    const linkedId = String(body.linkedId ?? '');
    if (!['Inspection', 'Defect'].includes(linkedType)) throw ApiError.badRequest('Evidence links to an inspection or a defect');
    let clientId: string | null = null;
    let projectId: string | null = null;
    if (linkedType === 'Inspection') {
      const i = await prisma.qcInspection.findFirst({ where: { id: linkedId, clientId: ctx.clientId ?? undefined } });
      if (!i) throw ApiError.notFound('Inspection not found');
      if (!ctx.isSA && ctx.role === 'PRIVATE_INSPECTOR' && i.inspectorId !== ctx.userId) throw ApiError.notFound('Inspection not found');
      clientId = i.clientId; projectId = i.projectId;
    } else {
      const o = await guardEntity(req, 'defect', linkedId);
      clientId = o.clientId; projectId = o.projectId ?? null;
    }
    const rows = await ev.uploadEvidence(ctx, files(req), {
      linkedType, linkedId, clientId, projectId, phase: q(body.phase), caption: q(body.caption) ?? null, capturedAt: body.capturedAt ? new Date(String(body.capturedAt)) : null,
      capturedVia: body.capturedVia === 'In-app camera' ? 'In-app camera' : 'Device library', peopleShown: body.peopleShown === true || body.peopleShown === 'true',
    });
    res.status(201).json({ evidence: rows });
  }),
  listEvidence: asyncHandler(async (req, res) => {
    const linkedType = String(req.query.linkedType ?? '');
    const linkedId = String(req.query.linkedId ?? '');
    if (linkedType === 'Defect') await guardEntity(req, 'defect', linkedId);
    else if (linkedType === 'Inspection') await insp.getInspection(ctxOf(req), linkedId);
    else throw ApiError.badRequest('Choose an inspection or a defect');
    res.status(200).json({ evidence: await ev.listEvidence(linkedType, linkedId) });
  }),
  verifyEvidence: asyncHandler(async (req, res) => {
    const e = await prisma.qcEvidence.findUnique({ where: { id: id(req) }, select: { clientId: true } });
    if (!e || e.clientId !== ctxOf(req).clientId) throw ApiError.notFound('Evidence not found');
    res.status(200).json(await ev.verifyEvidence(id(req)));
  }),

  // ─── Dashboard and reports ───
  dashboard: asyncHandler(async (req, res) => {
    const f = rep.filtersFrom(req.query as Record<string, unknown>);
    if (f.projectId) await guardEntity(req, 'project', f.projectId);
    res.status(200).json(await rep.dashboard(ctxOf(req), f));
  }),
  portfolio: asyncHandler(async (req, res) => {
    res.status(200).json(await rep.portfolio(ctxOf(req)));
  }),
  portfolioXlsx: asyncHandler(async (req, res) => {
    res.status(201).json({ report: await rep.portfolioXlsx(ctxOf(req)) });
  }),
  listReports: asyncHandler(async (req, res) => {
    res.status(200).json({ reports: await rep.listReports(ctxOf(req), q(req.query.projectId)) });
  }),
  downloadReport: asyncHandler(async (req, res) => {
    res.status(200).json(await rep.downloadLink(ctxOf(req), id(req)));
  }),
  openItems: asyncHandler(async (req, res) => {
    const f = rep.filtersFrom({ ...req.query, ...(req.body ?? {}) } as Record<string, unknown>);
    if (f.projectId) await guardEntity(req, 'project', f.projectId);
    res.status(201).json({ report: await rep.openItemsRegister(ctxOf(req), f, req.query.format === 'xlsx' ? 'xlsx' : 'pdf') });
  }),
  dlpReport: asyncHandler(async (req, res) => {
    await guardEntity(req, 'project', id(req));
    res.status(201).json({ report: await rep.dlpCloseOutReport(ctxOf(req), id(req)) });
  }),
  escalationReport: asyncHandler(async (req, res) => {
    const f = rep.filtersFrom(req.query as Record<string, unknown>);
    if (f.projectId) await guardEntity(req, 'project', f.projectId);
    res.status(201).json({ report: await rep.escalationLogReport(ctxOf(req), f, req.query.format === 'xlsx' ? 'xlsx' : 'pdf') });
  }),
  evidencePack: asyncHandler(async (req, res) => {
    await guardEntity(req, 'defect', id(req));
    res.status(201).json({ report: await rep.defectEvidencePack(ctxOf(req), id(req)) });
  }),
};
