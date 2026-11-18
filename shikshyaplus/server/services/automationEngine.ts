import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { evaluateWorkflowExecutionGuard } from '../../src/lib/v4Rules';
import { emitToSchool } from '../realtime';
import { logAuditEvent } from '../security';

export interface WorkflowTriggerParams {
  schoolId: string;
  triggerType: 'ATTENDANCE_ABSENT' | 'HOMEWORK_DUE_SOON' | 'EXAM_PUBLISHED' | 'TEACHER_LEAVE_REQUESTED' | 'FEE_OVERDUE' | 'MANUAL_TEST';
  actorUserId: string;
  sourceEventId: string;
  payload: Record<string, unknown>;
  depth?: number;
}

export function triggerWorkflows(db: DatabaseSync, params: WorkflowTriggerParams) {
  const depth = params.depth ?? 1;
  const workflows = db
    .prepare(
      `SELECT * FROM workflow_definitions WHERE school_id = ? AND trigger_type = ? AND status = 'ACTIVE'`
    )
    .all(params.schoolId, params.triggerType) as Array<Record<string, unknown>>;

  const results: Array<{ workflowId: string; status: string; message: string }> = [];
  const now = new Date().toISOString();

  for (const wf of workflows) {
    const workflowId = String(wf.id);
    const idempotencyKey = `${workflowId}:${params.sourceEventId}`;

    const alreadyRan = db
      .prepare(`SELECT id FROM workflow_executions WHERE idempotency_key = ?`)
      .get(idempotencyKey);
    if (alreadyRan) {
      results.push({ workflowId, status: 'SKIPPED_IDEMPOTENT', message: 'Duplicate event suppressed.' });
      continue;
    }

    const actionType = String(wf.action_type);
    const guard = evaluateWorkflowExecutionGuard({
      workflowSchoolId: String(wf.school_id),
      eventSchoolId: params.schoolId,
      actionType,
      requiresHumanApproval: Boolean(wf.requires_human_approval),
      depth,
    });

    const execId = `wfx-${crypto.randomUUID().slice(0, 8)}`;

    if (!guard.allowed || guard.mode === 'BLOCKED') {
      db.prepare(
        `INSERT INTO workflow_executions (id, school_id, workflow_id, trigger_type, idempotency_key, status, result_summary, payload_json, depth, executed_at)
         VALUES (?, ?, ?, ?, ?, 'BLOCKED', ?, ?, ?, ?)`
      ).run(execId, params.schoolId, workflowId, params.triggerType, idempotencyKey, guard.reason || 'Blocked by safety guard', JSON.stringify(params.payload), depth, now);
      results.push({ workflowId, status: 'BLOCKED', message: guard.reason || 'Blocked by safety guard' });
      continue;
    }

    if (guard.mode === 'QUEUE_APPROVAL') {
      const apprId = `apr-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO approval_requests (id, school_id, workflow_id, requested_by_user_id, action_type, summary, payload_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`
      ).run(
        apprId,
        params.schoolId,
        workflowId,
        params.actorUserId,
        actionType,
        `${wf.name}: Pending review for ${actionType}`,
        JSON.stringify(params.payload),
        now
      );
      db.prepare(
        `INSERT INTO workflow_executions (id, school_id, workflow_id, trigger_type, idempotency_key, status, result_summary, payload_json, depth, executed_at)
         VALUES (?, ?, ?, ?, ?, 'AWAITING_APPROVAL', ?, ?, ?, ?)`
      ).run(execId, params.schoolId, workflowId, params.triggerType, idempotencyKey, `Approval request ${apprId} created.`, JSON.stringify(params.payload), depth, now);
      results.push({ workflowId, status: 'AWAITING_APPROVAL', message: `Approval ${apprId} queued.` });
      continue;
    }

    // Safe automated execution
    let summary = `Executed ${actionType}`;
    if (actionType === 'SEND_NOTIFICATION') {
      const targetRole = String(wf.target_role || 'PARENT');
      const recipients = db
        .prepare(`SELECT user_id FROM school_memberships WHERE school_id = ? AND role = ? AND status = 'ACTIVE' LIMIT 20`)
        .all(params.schoolId, targetRole) as Array<{ user_id: string }>;
      for (const r of recipients) {
        db.prepare(
          `INSERT INTO notifications (id, school_id, user_id, category, title, body, created_at) VALUES (?, ?, ?, 'AUTOMATION', ?, ?, ?)`
        ).run(
          crypto.randomUUID(),
          params.schoolId,
          r.user_id,
          `Workflow Alert: ${wf.name}`,
          String(wf.action_template || params.payload.summary || 'Automated school update triggered.'),
          now
        );
      }
      summary = `Dispatched ${recipients.length} notification(s) to ${targetRole}.`;
      emitToSchool(params.schoolId, 'workflow:executed', { workflowId, name: wf.name, summary });
    } else if (actionType === 'CREATE_SUPPORT_TICKET') {
      db.prepare(
        `INSERT INTO support_tickets (id, school_id, user_id, category, subject, description, status, created_at)
         VALUES (?, ?, ?, 'WORKFLOW_AUTOMATION', ?, ?, 'OPEN', ?)`
      ).run(
        `tkt-${crypto.randomUUID().slice(0, 8)}`,
        params.schoolId,
        params.actorUserId,
        `Automated Follow-up: ${wf.name}`,
        JSON.stringify(params.payload),
        now
      );
      summary = 'Automated follow-up ticket created for staff queue.';
    }

    db.prepare(
      `INSERT INTO workflow_executions (id, school_id, workflow_id, trigger_type, idempotency_key, status, result_summary, payload_json, depth, executed_at)
       VALUES (?, ?, ?, ?, ?, 'SUCCEEDED', ?, ?, ?, ?)`
    ).run(execId, params.schoolId, workflowId, params.triggerType, idempotencyKey, summary, JSON.stringify(params.payload), depth, now);

    logAuditEvent(db, {
      schoolId: params.schoolId,
      actorUserId: params.actorUserId,
      action: 'WORKFLOW_EXECUTED',
      resourceType: 'WORKFLOW',
      resourceId: workflowId,
      metadata: { triggerType: params.triggerType, summary },
    });

    results.push({ workflowId, status: 'SUCCEEDED', message: summary });
  }

  return results;
}
