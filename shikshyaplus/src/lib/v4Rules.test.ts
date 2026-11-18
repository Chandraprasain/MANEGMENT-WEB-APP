import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOneRosterCsv,
  buildQtiAssessmentXml,
  evaluateWorkflowExecutionGuard,
  maskBankAccountNumber,
  validateDoubleEntryJournal,
  validateRefundAmount,
} from './v4Rules';

test('bank account masking hides leading account digits safely', () => {
  assert.equal(maskBankAccountNumber('01401017504821'), '••••••••••4821');
  assert.equal(maskBankAccountNumber('1234'), '••••');
  assert.equal(maskBankAccountNumber(''), '••••');
});

test('double-entry accounting validator enforces balanced debits and credits', () => {
  const valid = validateDoubleEntryJournal([
    { accountId: 'coa-1010', debit: 8000, credit: 0 },
    { accountId: 'coa-4010', debit: 0, credit: 8000 },
  ]);
  assert.equal(valid.valid, true);
  assert.equal(valid.totalDebit, 8000);

  const unbalanced = validateDoubleEntryJournal([
    { accountId: 'coa-1010', debit: 8000, credit: 0 },
    { accountId: 'coa-4010', debit: 0, credit: 7500 },
  ]);
  assert.equal(unbalanced.valid, false);
  assert.ok(unbalanced.error?.includes('out of balance'));
});

test('refund validation rejects amounts exceeding remaining settled balance', () => {
  const ok = validateRefundAmount({ settledAmount: 8000, alreadyRefunded: 2000, requestedRefund: 6000 });
  assert.equal(ok.allowed, true);

  const over = validateRefundAmount({ settledAmount: 8000, alreadyRefunded: 2000, requestedRefund: 6500 });
  assert.equal(over.allowed, false);
  assert.equal(over.remainingRefundable, 6000);
});

test('workflow execution guard enforces loop depth limit, tenant match, and approval gates', () => {
  const loopBlocked = evaluateWorkflowExecutionGuard({
    workflowSchoolId: 'sch-a',
    eventSchoolId: 'sch-a',
    actionType: 'SEND_NOTIFICATION',
    requiresHumanApproval: false,
    depth: 4,
  });
  assert.equal(loopBlocked.allowed, false);
  assert.equal(loopBlocked.mode, 'BLOCKED');

  const crossTenantBlocked = evaluateWorkflowExecutionGuard({
    workflowSchoolId: 'sch-a',
    eventSchoolId: 'sch-b',
    actionType: 'SEND_NOTIFICATION',
    requiresHumanApproval: false,
    depth: 1,
  });
  assert.equal(crossTenantBlocked.allowed, false);

  const sensitiveGated = evaluateWorkflowExecutionGuard({
    workflowSchoolId: 'sch-a',
    eventSchoolId: 'sch-a',
    actionType: 'PUBLISH_OFFICIAL_GRADES',
    requiresHumanApproval: false,
    depth: 1,
  });
  assert.equal(sensitiveGated.allowed, true);
  assert.equal(sensitiveGated.mode, 'QUEUE_APPROVAL');
});

test('OneRoster 1.2 CSV and QTI 3.0 XML formatters produce valid standard output', () => {
  const csv = buildOneRosterCsv([
    {
      sourcedId: 'u1',
      role: 'student',
      username: 'aarav_10a',
      givenName: 'Aarav',
      familyName: 'Sharma',
      email: 'aarav@sunrise.edu.np',
      identifier: 'STU-001',
    },
  ]);
  assert.ok(csv.includes('sourcedId,status,dateLastModified'));
  assert.ok(csv.includes('"STU-001"'));

  const xml = buildQtiAssessmentXml({
    identifier: 'asmt-1',
    title: 'Algebra Quiz',
    items: [{ id: 'q1', prompt: 'Solve 2+2', options: ['3', '4'], correctAnswer: '4' }],
  });
  assert.ok(xml.includes('imsqtiasi_v3p0'));
  assert.ok(xml.includes('<qti-value>4</qti-value>'));
});
