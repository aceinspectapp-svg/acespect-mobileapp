/**
 * Checks the audit trail core against a LOCAL scratch database: chaining, tamper detection, the database's refusal to edit or delete,
 * concurrent writers, redaction, duplicate phone uploads, anchors and retention.
 * Run: DATABASE_URL=postgresql://...localhost... npm run check:audit
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) { console.error('Refusing to run: DATABASE_URL is not a local database.'); process.exit(1); }

async function main() {
  const { prisma } = await import('../lib/prisma');
  const t = await import('../lib/auditTrail');
  let passed = 0;
  const check = async (name: string, fn: () => Promise<void>) => { await fn(); passed++; console.log(`  ok  ${name}`); };
  const asSuperuser = async (sql: string) => prisma.$executeRawUnsafe(sql);
  const insp = () => randomUUID();

  // The scratch database keeps what earlier runs deliberately damaged: start from empty audit tables (only possible by switching the guard off).
  for (const tbl of ['audit_events', 'audit_anchors']) {
    await asSuperuser(`ALTER TABLE ${tbl} DISABLE TRIGGER USER`);
    await asSuperuser(`TRUNCATE ${tbl}`);
    await asSuperuser(`ALTER TABLE ${tbl} ENABLE TRIGGER USER`);
  }

  await check('an event is stored with who/what/where and chained to the one before', async () => {
    const id = insp();
    assert.equal(await t.audit({ category: 'web', action: 'section.approve', actor: { id: null, name: 'Rae Reviewer', role: 'REVIEWER' }, source: 'web', ip: '203.0.113.9', inspectionId: id, jobNo: 'V260001', target: { type: 'Section', id: 's1', label: 'Driveway' }, before: { reviewStatus: 'pending' }, after: { reviewStatus: 'approved' } }), true);
    await t.audit({ category: 'web', action: 'inspection.finalize', actor: { id: null, name: 'Rae Reviewer', role: 'REVIEWER' }, source: 'web', inspectionId: id });
    const rows = await prisma.auditEvent.findMany({ where: { stream: `insp:${id}` }, orderBy: { seq: 'asc' } });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.prevHash, null);
    assert.equal(rows[1]!.prevHash, rows[0]!.hash);
    assert.equal(rows[0]!.actorName, 'Rae Reviewer');
    assert.deepEqual(rows[0]!.after, { reviewStatus: 'approved' });
    assert.equal(rows[0]!.ip, '203.0.113.9');
    assert.equal((await t.verifyAudit({ inspectionId: id })).ok, true);
  });

  await check('the database refuses to change, delete or truncate an audit row', async () => {
    const id = insp();
    await t.audit({ category: 'system', action: 'check.immutable', inspectionId: id });
    await assert.rejects(prisma.auditEvent.updateMany({ where: { stream: `insp:${id}` }, data: { message: 'edited' } }), /cannot be changed or deleted/);
    await assert.rejects(prisma.auditEvent.deleteMany({ where: { stream: `insp:${id}` } }), /cannot be changed or deleted/);
    await assert.rejects(asSuperuser('TRUNCATE audit_events'), /cannot be changed or deleted/);
    await assert.rejects(asSuperuser('TRUNCATE audit_anchors'), /cannot be changed or deleted/);
  });

  await check('a row changed behind the application\'s back is caught by verification', async () => {
    const id = insp();
    for (let i = 0; i < 3; i++) await t.audit({ category: 'web', action: `check.tamper.${i}`, inspectionId: id, message: `step ${i}` });
    assert.equal((await t.verifyAudit({ inspectionId: id })).ok, true);
    await asSuperuser('ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable'); // what an attacker with database access would have to do
    try {
      await asSuperuser(`UPDATE audit_events SET message = 'rewritten' WHERE stream = 'insp:${id}' AND action = 'check.tamper.1'`);
      const r = await t.verifyAudit({ inspectionId: id });
      assert.equal(r.ok, false);
      assert.ok(r.problems.some((p) => p.kind === 'hash'), 'hash mismatch reported');
      // deleting a row breaks the link after it
      await asSuperuser(`DELETE FROM audit_events WHERE stream = 'insp:${id}' AND action = 'check.tamper.1'`);
      const r2 = await t.verifyAudit({ inspectionId: id });
      assert.ok(r2.problems.some((p) => p.kind === 'link'), 'broken link reported');
    } finally {
      await asSuperuser('ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable');
    }
  });

  await check('50 events written at once to one inspection form one unbroken chain', async () => {
    const id = insp();
    await Promise.all(Array.from({ length: 50 }, (_, i) => t.audit({ category: 'mobile', action: 'check.concurrent', inspectionId: id, message: String(i) })));
    const rows = await prisma.auditEvent.findMany({ where: { stream: `insp:${id}` }, orderBy: { seq: 'asc' } });
    assert.equal(rows.length, 50);
    assert.equal(rows.filter((r) => r.prevHash === null).length, 1);
    const r = await t.verifyAudit({ inspectionId: id });
    assert.equal(r.ok, true, JSON.stringify(r.problems));
  });

  await check('secrets are redacted, long values and big lists are cut down', async () => {
    const id = insp();
    await t.audit({ category: 'admin', action: 'check.redact', inspectionId: id, before: { password: 'hunter2', name: 'x', nested: { refreshToken: 'abc', ok: 1 } }, after: { photos: Array.from({ length: 500 }, (_, i) => `/api/v1/media/${i}`), note: 'y'.repeat(5000) } });
    const row = await prisma.auditEvent.findFirstOrThrow({ where: { stream: `insp:${id}` } });
    const text = JSON.stringify(row, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    assert.ok(!text.includes('hunter2') && !text.includes('"abc"'));
    assert.deepEqual((row.before as { password: string }).password, '[redacted]');
    assert.ok(text.length < 12000, `stored ${text.length} bytes`);
  });

  await check('the same phone event uploaded twice is stored once', async () => {
    const id = insp(); const ev = randomUUID();
    assert.equal(await t.audit({ category: 'mobile', action: 'app.start', inspectionId: id, clientEventId: ev, actor: { type: 'device' } }), true);
    assert.equal(await t.audit({ category: 'mobile', action: 'app.start', inspectionId: id, clientEventId: ev, actor: { type: 'device' } }), false);
    assert.equal(await prisma.auditEvent.count({ where: { clientEventId: ev } }), 1);
  });

  await check('photo uploads are summarised into one entry per batch', async () => {
    const id = insp();
    for (let n = 1; n <= 120; n++) t.notePhotoUpload({ inspectionId: id, jobNo: 'V260002', photoId: randomUUID(), photoNumber: n, sectionKey: `driveway:street`, bytes: 250_000 });
    await t.flushPhotoBatches(id);
    const rows = await prisma.auditEvent.findMany({ where: { inspectionId: id, action: 'photos.upload' } });
    assert.equal(rows.length, 1);
    const m = rows[0]!.metadata as { count: number; photoNumbers: { from: number; to: number }; bytes: number; idsDigest: string };
    assert.equal(m.count, 120); assert.equal(m.photoNumbers.from, 1); assert.equal(m.photoNumbers.to, 120); assert.equal(m.bytes, 30_000_000); assert.equal(m.idsDigest.length, 64);
  });

  await check('anchors seal the events, and removing a whole inspection\'s history is detected', async () => {
    // make every existing event "old enough" to be sealed by moving the clock check: seal what is older than the grace period by back-dating nothing,
    // so write an event, then seal with a zero grace via direct anchoring of an old row
    const id = insp();
    await t.audit({ category: 'system', action: 'check.anchor', inspectionId: id, occurredAt: new Date(Date.now() - 10 * 60_000) });
    const a = await t.anchorAudit();
    assert.ok(a && a.eventCount >= 1, 'an anchor was written');
    const ok = await t.verifyAudit();
    // (the earlier tamper test left one damaged chain behind on purpose, so only the anchors are judged here)
    assert.deepEqual(ok.problems.filter((p) => p.kind === 'anchor'), []);
    assert.ok(ok.anchorsChecked >= 1);
    await asSuperuser('ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable');
    try {
      await asSuperuser(`DELETE FROM audit_events WHERE stream = 'insp:${id}'`); // the stream's only row: no chain link left to betray it
      const r = await t.verifyAudit();
      assert.equal(r.ok, false);
      assert.ok(r.problems.some((p) => p.kind === 'anchor'), 'the anchor notices the missing event');
    } finally {
      await asSuperuser('ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable');
    }
  });

  await check('the retention job removes only entries past the period and leaves a record', async () => {
    const id = insp();
    await t.audit({ category: 'system', action: 'check.old', inspectionId: id, occurredAt: new Date(Date.now() - 3000 * 24 * 3600 * 1000) });
    await t.audit({ category: 'system', action: 'check.recent', inspectionId: id });
    const removed = await t.purgeExpiredAudit(2557);
    assert.ok(removed >= 1);
    assert.equal(await prisma.auditEvent.count({ where: { inspectionId: id, action: 'check.old' } }), 0);
    assert.equal(await prisma.auditEvent.count({ where: { inspectionId: id, action: 'check.recent' } }), 1);
    assert.ok(await prisma.auditEvent.count({ where: { action: 'audit.purge' } }) >= 1);
    assert.equal(await t.purgeExpiredAudit(30), 0, 'a nonsense short period purges nothing');
  });

  await check('the monitor flags repeated failed sign-ins and repeated refusals, and the alert is recorded', async () => {
    const { scanAuditAnomalies } = await import('../lib/auditMonitor');
    const person = randomUUID();
    for (let i = 0; i < 9; i++) await t.audit({ category: 'security', action: 'security.login_failed', outcome: 'denied', ip: '203.0.113.77', actor: { id: null, type: 'user', name: 'Not signed in' } });
    for (let i = 0; i < 6; i++) await t.audit({ category: 'web', action: 'request.rejected', outcome: 'denied', actor: { id: person, name: 'Pat Probe', role: 'INSPECTOR' } });
    const found = await scanAuditAnomalies();
    assert.ok(found.includes('logins:203.0.113.77'), found.join(','));
    assert.ok(found.includes(`refused:${person}`), found.join(','));
    const alerts = await prisma.submissionLogEntry.count({ where: { event: 'warning', message: { in: ['Repeated failed sign-ins', 'Repeated refused requests'] } } });
    assert.ok(alerts >= 2, `alerts recorded: ${alerts}`);
  });

  void Prisma;
  console.log(`${passed} checks passed`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
