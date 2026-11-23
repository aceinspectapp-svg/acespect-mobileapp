import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reportFileNameFor, reportKind, reportKindTitle } from './reportKind';

describe('report kind and file name', () => {
  it('Pre-Purchase / Apartment is a pre-purchase report', () => {
    assert.equal(reportKind('Pre-Purchase', 'Apartment'), 'pre-purchase');
    assert.equal(reportKind('pre_purchase', 'apartment'), 'pre-purchase');
    assert.equal(reportFileNameFor('Yasiru-Test-8-PPI-AP', 'pre-purchase', 'pdf'), 'Yasiru-Test-8-PPI-AP-pre-purchase-report.pdf');
    assert.equal(reportFileNameFor('Yasiru-Test-8-PPI-AP', 'pre-purchase', 'docx'), 'Yasiru-Test-8-PPI-AP-pre-purchase-report.docx');
    assert.equal(reportKindTitle('pre-purchase'), 'Pre-Purchase');
  });
  it('every other report type is named as before', () => {
    assert.equal(reportKind('Construction Stage', 'Apartment'), 'construction');
    assert.equal(reportKind('Dilapidation', 'Apartment'), 'dilapidation');
    assert.equal(reportKind('Pre-Purchase', 'Residential House'), 'dilapidation');
    assert.equal(reportKind('Pre-Purchase', 'Commercial Properties'), 'dilapidation');
    assert.equal(reportKind('Investigations', 'Apartment'), 'dilapidation');
    assert.equal(reportFileNameFor('V 1', 'dilapidation', 'pdf'), 'V-1-dilapidation-report.pdf');
  });
});
