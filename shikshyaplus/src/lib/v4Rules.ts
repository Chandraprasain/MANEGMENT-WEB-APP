export function maskBankAccountNumber(accountNumber: string): string {
  const cleaned = accountNumber.replace(/\s+/g, '');
  if (!cleaned) return '••••';
  if (cleaned.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(10, cleaned.length - 4))}${cleaned.slice(-4)}`;
}

export interface JournalLineInput {
  accountId: string;
  debit: number;
  credit: number;
  memo?: string;
}

export function validateDoubleEntryJournal(lines: JournalLineInput[]): {
  valid: boolean;
  totalDebit: number;
  totalCredit: number;
  error?: string;
} {
  if (!Array.isArray(lines) || lines.length < 2) {
    return { valid: false, totalDebit: 0, totalCredit: 0, error: 'A journal entry requires at least two balanced lines.' };
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    const d = Number(line.debit || 0);
    const c = Number(line.credit || 0);
    if (d < 0 || c < 0) {
      return { valid: false, totalDebit: 0, totalCredit: 0, error: 'Debit and credit amounts cannot be negative.' };
    }
    if (d > 0 && c > 0) {
      return { valid: false, totalDebit: 0, totalCredit: 0, error: 'A single journal line cannot carry both debit and credit.' };
    }
    if (d === 0 && c === 0) {
      return { valid: false, totalDebit: 0, totalCredit: 0, error: 'Each journal line must have a non-zero debit or credit.' };
    }
    totalDebit += d;
    totalCredit += c;
  }
  totalDebit = Math.round(totalDebit * 100) / 100;
  totalCredit = Math.round(totalCredit * 100) / 100;
  if (totalDebit <= 0 || Math.abs(totalDebit - totalCredit) >= 0.005) {
    return {
      valid: false,
      totalDebit,
      totalCredit,
      error: `Journal is out of balance: Debit (${totalDebit.toFixed(2)}) must equal Credit (${totalCredit.toFixed(2)}).`,
    };
  }
  return { valid: true, totalDebit, totalCredit };
}

export function validateRefundAmount(params: {
  settledAmount: number;
  alreadyRefunded: number;
  requestedRefund: number;
}): { allowed: boolean; remainingRefundable: number; reason?: string } {
  const remaining = Math.round((params.settledAmount - params.alreadyRefunded) * 100) / 100;
  if (params.requestedRefund <= 0) {
    return { allowed: false, remainingRefundable: remaining, reason: 'Refund amount must be greater than zero.' };
  }
  if (params.requestedRefund > remaining + 0.001) {
    return {
      allowed: false,
      remainingRefundable: remaining,
      reason: `Requested refund (${params.requestedRefund.toFixed(2)}) exceeds remaining settled balance (${remaining.toFixed(2)}).`,
    };
  }
  return { allowed: true, remainingRefundable: remaining };
}

export const WORKFLOW_SENSITIVE_ACTIONS = new Set([
  'PUBLISH_OFFICIAL_GRADES',
  'MODIFY_ATTENDANCE_RECORD',
  'BAN_USER_ACCOUNT',
  'ISSUE_REFUND',
  'DELETE_STUDENT_RECORD',
]);

export function evaluateWorkflowExecutionGuard(params: {
  workflowSchoolId: string;
  eventSchoolId: string;
  actionType: string;
  requiresHumanApproval: boolean;
  depth: number;
  maxDepth?: number;
}): { allowed: boolean; mode: 'EXECUTE' | 'QUEUE_APPROVAL' | 'BLOCKED'; reason?: string } {
  const maxDepth = params.maxDepth ?? 3;
  if (params.depth > maxDepth) {
    return { allowed: false, mode: 'BLOCKED', reason: `Loop guard stopped execution at depth ${params.depth} (max ${maxDepth}).` };
  }
  if (params.workflowSchoolId !== params.eventSchoolId) {
    return { allowed: false, mode: 'BLOCKED', reason: 'Tenant boundary violation: workflow school_id mismatch.' };
  }
  if (WORKFLOW_SENSITIVE_ACTIONS.has(params.actionType) || params.requiresHumanApproval) {
    return { allowed: true, mode: 'QUEUE_APPROVAL', reason: 'Queued for human approval before final commit.' };
  }
  return { allowed: true, mode: 'EXECUTE' };
}

export function buildOneRosterCsv(
  members: Array<{
    sourcedId: string;
    role: string;
    username: string;
    givenName: string;
    familyName: string;
    email: string;
    identifier: string;
  }>
): string {
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['sourcedId', 'status', 'dateLastModified', 'enabledUser', 'role', 'username', 'givenName', 'familyName', 'email', 'identifier'].join(',');
  const now = new Date().toISOString();
  const rows = members.map((m) =>
    [m.sourcedId, 'active', now, 'true', m.role, m.username, m.givenName, m.familyName, m.email, m.identifier].map(esc).join(',')
  );
  return [header, ...rows].join('\n');
}

export function buildQtiAssessmentXml(params: {
  identifier: string;
  title: string;
  items: Array<{ id: string; prompt: string; options: string[]; correctAnswer: string }>;
}): string {
  const escXml = (s: string) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const itemsXml = params.items
    .map(
      (item, idx) => `  <qti-assessment-item identifier="${escXml(item.id || `item-${idx + 1}`)}" title="${escXml(item.prompt.slice(0, 48))}">
    <qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier">
      <qti-correct-response><qti-value>${escXml(item.correctAnswer)}</qti-value></qti-correct-response>
    </qti-response-declaration>
    <qti-item-body>
      <p>${escXml(item.prompt)}</p>
      <qti-choice-interaction response-identifier="RESPONSE" max-choices="1">
        ${item.options.map((opt, i) => `<qti-simple-choice identifier="OPT_${i + 1}">${escXml(opt)}</qti-simple-choice>`).join('\n        ')}
      </qti-choice-interaction>
    </qti-item-body>
  </qti-assessment-item>`
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<qti-assessment-test xmlns="http://www.imsglobal.org/xsd/imsqtiasi_v3p0" identifier="${escXml(params.identifier)}" title="${escXml(params.title)}">
${itemsXml}
</qti-assessment-test>`;
}
