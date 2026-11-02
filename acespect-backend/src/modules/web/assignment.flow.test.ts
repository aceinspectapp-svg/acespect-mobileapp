/**
 * End-to-end check of the assignment workflow against a real PostgreSQL database. Skipped unless TEST_DATABASE_URL points at a
 * scratch database that has had `prisma migrate deploy` run on it (it creates and removes its own rows, tagged by a unique suffix).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const url = process.env.TEST_DATABASE_URL;

test('assignment workflow', { skip: url ? false : 'set TEST_DATABASE_URL to run' }, async () => {
  process.env.DATABASE_URL = url;
  process.env.JWT_ACCESS_SECRET ||= 'x'.repeat(32);
  process.env.JWT_REFRESH_SECRET ||= 'y'.repeat(32);
  const { prisma } = await import('../../lib/prisma');
  const { outbox } = await import('../../lib/mailer');
  const { assignmentService } = await import('./assignment.service');
  const { webService } = await import('./web.service');

  const tag = `t${Date.now()}`;
  const mk = (role: 'ADMIN' | 'REVIEWER' | 'INSPECTOR', n: string) =>
    prisma.user.create({ data: { email: `${tag}-${n}@example.test`, name: `${tag} ${n}`, role, passwordHash: 'x' } as never });
  const [admin, r1, r2, insp] = [await mk('ADMIN', 'admin'), await mk('REVIEWER', 'r1'), await mk('REVIEWER', 'r2'), await mk('INSPECTOR', 'insp')];
  const inspection = await prisma.inspection.create({ data: { inspectorId: insp.id, inspectionType: 'Dilapidation', propertyType: 'Residential', jobNo: `${tag}`, address: '1 Test St', client: 'Secret Client', notes: 'private', status: 'SUBMITTED', submittedAt: new Date() } as never });
  const id = inspection.id;
  try {
    // unassigned: both reviewers see everything, neither can edit yet
    assert.equal((await webService.getInspection(id, r2)).client, 'Secret Client');
    await assert.rejects(webService.approveAllSections(id, r1), /Assign this inspection/);

    // r1 takes it (no email to themselves)
    outbox.length = 0;
    await assignmentService.assign(id, r1.id, r1);
    assert.equal(outbox.length, 0);
    await webService.approveAllSections(id, r1);

    // r2 now sees it withheld, cannot open, edit, or take it
    const list = await webService.listInspections(r2, { view: 'summary' });
    const row = list.inspections.find((x) => x.id === id)! as { restricted?: boolean; client: string; reviewerId: string | null };
    assert.equal(row.restricted, true);
    assert.equal(row.client, '');
    assert.equal(row.reviewerId, r1.id);
    await assert.rejects(webService.getInspection(id, r2), /assigned to another reviewer/);
    await assert.rejects(webService.approveAllSections(id, r2), /another reviewer/);
    await assert.rejects(assignmentService.assign(id, r2.id, r2), (e: { code?: string }) => e.code === 'ASSIGNED_TO_OTHER');
    await assert.rejects(webService.updateInspection(id, { reviewerId: r2.id }, r1), /Use the assign/);

    // r2 asks; r1 declines; nothing moves
    const q1 = await assignmentService.requestTransfer(id, r2);
    await assert.rejects(assignmentService.respondToTransfer(q1.id, true, r2), /Only the reviewer who holds/);
    await assignmentService.respondToTransfer(q1.id, false, r1);
    assert.equal((await prisma.inspection.findUniqueOrThrow({ where: { id } })).reviewerId, r1.id);

    // asks again; r1 agrees; r2 is emailed and now holds it; r1 loses edit rights
    const q2 = await assignmentService.requestTransfer(id, r2);
    outbox.length = 0;
    await assignmentService.respondToTransfer(q2.id, true, r1);
    assert.equal((await prisma.inspection.findUniqueOrThrow({ where: { id } })).reviewerId, r2.id);
    assert.ok(outbox.some((m) => m.to === r2.email));
    await assert.rejects(webService.approveAllSections(id, r1), /another reviewer/);
    await assert.rejects(assignmentService.respondToTransfer(q2.id, true, r1), /Only the reviewer who holds|already been answered/);

    // admin reassigns directly and the new assignee is emailed; counts reflect it
    outbox.length = 0;
    await webService.updateInspection(id, { reviewerId: r1.id }, admin);
    assert.ok(outbox.some((m) => m.to === r1.email));
    const ov = await assignmentService.overview(admin);
    assert.equal(ov.reviewers.find((r) => r.id === r1.id)?.assigned, 1);
    assert.equal(ov.reviewers.find((r) => r.id === r2.id)?.assigned, 0);

    // a plain reviewer cannot reassign through the generic PATCH
    await assert.rejects(webService.updateInspection(id, { reviewerId: r2.id }, r2), /another reviewer/);
    // a racing double-claim of an unassigned one has exactly one winner
    await prisma.inspection.update({ where: { id }, data: { reviewerId: null } });
    const results = await Promise.allSettled([assignmentService.assign(id, r1.id, r1), assignmentService.assign(id, r2.id, r2)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  } finally {
    await prisma.inspection.delete({ where: { id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [admin.id, r1.id, r2.id, insp.id] } } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
