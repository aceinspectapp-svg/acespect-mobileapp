import test from 'node:test';
import assert from 'node:assert/strict';
import { assignDenial, canEdit, canRespondToTransfer, canViewDetail, transferRequestDenial } from './assignment.rules';

const admin = { id: 'a', role: 'ADMIN' };
const rev1 = { id: 'r1', role: 'REVIEWER' };
const rev2 = { id: 'r2', role: 'REVIEWER' };
const inspector = { id: 'i', role: 'INSPECTOR' };
const unassigned = { reviewerId: null, status: 'SUBMITTED' };
const mine = { reviewerId: 'r1', status: 'IN_REVIEW' };

test('view: own and unassigned are open to a reviewer, another reviewer\'s is not', () => {
  assert.equal(canViewDetail(rev1, mine), true);
  assert.equal(canViewDetail(rev1, unassigned), true);
  assert.equal(canViewDetail(rev2, mine), false);
  assert.equal(canViewDetail(admin, mine), true);
  assert.equal(canViewDetail(inspector, unassigned), false);
});

test('edit: only the assignee or an admin; unassigned is read-only until taken', () => {
  assert.equal(canEdit(rev1, mine), true);
  assert.equal(canEdit(rev2, mine), false);
  assert.equal(canEdit(rev1, unassigned), false);
  assert.equal(canEdit(admin, unassigned), true);
  assert.equal(canEdit(inspector, mine), false);
});

test('assign: a reviewer takes an unassigned inspection, but not one held by someone else', () => {
  assert.equal(assignDenial(rev2, unassigned, 'r2'), null);
  assert.equal(assignDenial(rev2, mine, 'r2'), 'ASSIGNED_TO_OTHER');
  assert.equal(assignDenial(rev2, mine, 'r3'), 'ASSIGNED_TO_OTHER');
});

test('assign: the holder may hand over; an admin may always reassign; no-ops and drafts are refused', () => {
  assert.equal(assignDenial(rev1, mine, 'r2'), null);
  assert.equal(assignDenial(admin, mine, 'r2'), null);
  assert.equal(assignDenial(rev1, mine, 'r1'), 'SAME_ASSIGNEE');
  assert.equal(assignDenial(rev1, { reviewerId: null, status: 'DRAFT' }, 'r1'), 'NOT_SUBMITTED');
  assert.equal(assignDenial(inspector, unassigned, 'r1'), 'NOT_REVIEWER');
});

test('transfer request: only for an inspection another reviewer holds', () => {
  assert.equal(transferRequestDenial(rev2, mine), null);
  assert.equal(transferRequestDenial(rev1, mine), 'ALREADY_YOURS');
  assert.equal(transferRequestDenial(rev2, unassigned), 'UNASSIGNED');
  assert.equal(transferRequestDenial(admin, mine), 'NOT_REVIEWER');
  assert.equal(transferRequestDenial(rev2, { reviewerId: 'r1', status: 'DRAFT' }), 'NOT_SUBMITTED');
});

test('responding: only the holder named on the request, or an admin', () => {
  const req = { fromReviewerId: 'r1' };
  assert.equal(canRespondToTransfer(rev1, req), true);
  assert.equal(canRespondToTransfer(rev2, req), false);
  assert.equal(canRespondToTransfer(admin, req), true);
});
