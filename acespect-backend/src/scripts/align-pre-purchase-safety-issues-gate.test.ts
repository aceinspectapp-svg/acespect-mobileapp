import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { alignSection } from './align-pre-purchase-safety-issues-gate';
import type { Field } from './lib/align-helpers';

const fields = (): Field[] => [
  { key: 'safetyIssues', type: 'yesno', label: 'Safety issues?', order: 0, required: true, options: [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }] },
  { key: 'safetyIssuesDescribe', type: 'textarea', label: 'Describe safety issues', order: 1, required: true },
];

describe('align-pre-purchase-safety-issues-gate', () => {
  it('opens "Describe safety issues" only on Yes, still required', () => {
    const f = fields();
    assert.equal(alignSection('job-info', f), true);
    assert.deepEqual(f[1]!.gate, { fieldKey: 'safetyIssues', equals: 'yes' });
    assert.equal(f[1]!.required, true);
  });
  it('a second run changes nothing', () => {
    const f = fields();
    alignSection('job-info', f);
    const before = JSON.stringify(f);
    assert.equal(alignSection('job-info', f), false);
    assert.equal(JSON.stringify(f), before);
  });
  it('leaves a form without the two questions alone', () => {
    const f: Field[] = [{ key: 'other', type: 'text', label: 'Other', order: 0 }];
    assert.equal(alignSection('job-info', f), false);
  });
});
