import crypto from 'node:crypto';
import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { runRoleScopedAIAgent, type AIAgentType } from '../aiGateway';
import { logAuditEvent, requireAuth, requireRoles, requireSchoolTenant } from '../security';
import { triggerWorkflows } from '../services/automationEngine';

export function createAutomationAndAiRouter(db: DatabaseSync) {
  const router = Router();

  // ======================== SYSTEM 1: WORKFLOW AUTOMATION ========================
  router.get('/workflows', requireAuth, requireSchoolTenant, (req, res) => {
    const schoolId = req.auth!.activeSchoolId!;
    const workflows = db
      .prepare(`SELECT * FROM workflow_definitions WHERE school_id = ? ORDER BY created_at DESC`)
      .all(schoolId);
    const executions = db
      .prepare(
        `SELECT we.*, wd.name as workflow_name
         FROM workflow_executions we
         JOIN workflow_definitions wd ON wd.id = we.workflow_id
         WHERE we.school_id = ? ORDER BY we.executed_at DESC LIMIT 40`
      )
      .all(schoolId);
    const approvals = db
      .prepare(
        `SELECT ar.*, u.full_name as requester_name
         FROM approval_requests ar
         JOIN global_users u ON u.id = ar.requested_by_user_id
         WHERE ar.school_id = ? ORDER BY ar.created_at DESC LIMIT 30`
      )
      .all(schoolId);

    return res.json({ success: true, data: { workflows, executions, approvals } });
  });

  router.post(
    '/workflows',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'TECHNICAL_DEPT'),
    (req, res) => {
      const schema = z.object({
        name: z.string().trim().min(3),
        description: z.string().trim().optional().default(''),
        triggerType: z.enum([
          'ATTENDANCE_ABSENT',
          'HOMEWORK_DUE_SOON',
          'EXAM_PUBLISHED',
          'TEACHER_LEAVE_REQUESTED',
          'FEE_OVERDUE',
          'MANUAL_TEST',
        ]),
        actionType: z.enum([
          'SEND_NOTIFICATION',
          'CREATE_SUPPORT_TICKET',
          'PUBLISH_OFFICIAL_GRADES',
          'MODIFY_ATTENDANCE_RECORD',
          'BAN_USER_ACCOUNT',
        ]),
        targetRole: z.string().trim().min(2).default('PARENT'),
        actionTemplate: z.string().trim().optional().default(''),
        requiresHumanApproval: z.boolean().default(false),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid workflow definition.', error: { code: 'VALIDATION_ERROR', details: null } });
      }

      const id = `wf-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO workflow_definitions (id, school_id, name, description, trigger_type, condition_json, action_type, target_role, action_template, requires_human_approval, status, created_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`
      ).run(
        id,
        req.auth!.activeSchoolId!,
        parsed.data.name,
        parsed.data.description,
        parsed.data.triggerType,
        parsed.data.actionType,
        parsed.data.targetRole,
        parsed.data.actionTemplate,
        parsed.data.requiresHumanApproval ? 1 : 0,
        req.auth!.userId,
        now,
        now
      );

      logAuditEvent(db, {
        schoolId: req.auth!.activeSchoolId!,
        actorUserId: req.auth!.userId,
        action: 'WORKFLOW_CREATED',
        resourceType: 'WORKFLOW',
        resourceId: id,
      });

      return res.status(201).json({ success: true, message: 'Automation workflow saved.', data: { id } });
    }
  );

  router.patch(
    '/workflows/:id/status',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'TECHNICAL_DEPT'),
    (req, res) => {
      const status = z.enum(['ACTIVE', 'PAUSED', 'DISABLED']).parse(req.body?.status);
      const result = db
        .prepare(`UPDATE workflow_definitions SET status = ?, updated_at = ? WHERE id = ? AND school_id = ?`)
        .run(status, new Date().toISOString(), req.params.id, req.auth!.activeSchoolId!);
      if (result.changes === 0) {
        return res.status(404).json({ success: false, message: 'Workflow not found.', error: { code: 'NOT_FOUND', details: null } });
      }
      return res.json({ success: true, message: `Workflow set to ${status}.` });
    }
  );

  router.post(
    '/workflows/:id/test',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'TECHNICAL_DEPT'),
    (req, res) => {
      const wf = db
        .prepare(`SELECT * FROM workflow_definitions WHERE id = ? AND school_id = ?`)
        .get(req.params.id, req.auth!.activeSchoolId!) as Record<string, unknown> | undefined;
      if (!wf) {
        return res.status(404).json({ success: false, message: 'Workflow not found.', error: { code: 'NOT_FOUND', details: null } });
      }
      const depth = Number(req.body?.depth ?? 1);
      const runs = triggerWorkflows(db, {
        schoolId: req.auth!.activeSchoolId!,
        triggerType: String(wf.trigger_type) as Parameters<typeof triggerWorkflows>[1]['triggerType'],
        actorUserId: req.auth!.userId,
        sourceEventId: String(req.body?.eventId || `test-${crypto.randomUUID().slice(0, 8)}`),
        payload: { testRun: true, summary: `Test execution of ${wf.name}` },
        depth,
      });
      return res.json({ success: true, message: 'Workflow test executed.', data: { runs } });
    }
  );

  router.post(
    '/approvals/:id/review',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG'),
    (req, res) => {
      const schema = z.object({
        decision: z.enum(['APPROVED', 'REJECTED']),
        note: z.string().trim().optional().default(''),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid approval decision.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      const now = new Date().toISOString();
      const result = db
        .prepare(
          `UPDATE approval_requests SET status = ?, reviewed_by_user_id = ?, review_note = ?, reviewed_at = ?
           WHERE id = ? AND school_id = ? AND status = 'PENDING'`
        )
        .run(parsed.data.decision, req.auth!.userId, parsed.data.note, now, req.params.id, req.auth!.activeSchoolId!);
      if (result.changes === 0) {
        return res.status(404).json({ success: false, message: 'Pending approval request not found.', error: { code: 'NOT_FOUND', details: null } });
      }
      logAuditEvent(db, {
        schoolId: req.auth!.activeSchoolId!,
        actorUserId: req.auth!.userId,
        action: `APPROVAL_${parsed.data.decision}`,
        resourceType: 'APPROVAL_REQUEST',
        resourceId: req.params.id,
      });
      return res.json({ success: true, message: `Request ${parsed.data.decision.toLowerCase()}.` });
    }
  );

  // ======================== SYSTEM 2 & 21: ROLE AI AGENTS & GOVERNANCE ========================
  router.get('/ai/governance', requireAuth, requireSchoolTenant, (req, res) => {
    const schoolId = req.auth!.activeSchoolId!;
    let policy = db.prepare(`SELECT * FROM ai_governance_policies WHERE school_id = ?`).get(schoolId) as Record<string, unknown> | undefined;
    if (!policy) {
      const now = new Date().toISOString();
      db.prepare(
        `INSERT OR IGNORE INTO ai_governance_policies (school_id, updated_at) VALUES (?, ?)`
      ).run(schoolId, now);
      policy = db.prepare(`SELECT * FROM ai_governance_policies WHERE school_id = ?`).get(schoolId) as Record<string, unknown>;
    }
    const runs = db
      .prepare(
        `SELECT r.*, u.full_name as user_name
         FROM ai_agent_runs r JOIN global_users u ON u.id = r.user_id
         WHERE r.school_id = ? AND (r.user_id = ? OR ? IN ('PRINCIPAL', 'PLATFORM_SUPER_ADMIN'))
         ORDER BY r.created_at DESC LIMIT 25`
      )
      .all(schoolId, req.auth!.userId, req.auth!.activeRole);

    return res.json({ success: true, data: { policy, runs } });
  });

  router.patch(
    '/ai/governance',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'SCHOOL_ORG', 'PLATFORM_SUPER_ADMIN'),
    (req, res) => {
      const schema = z.object({
        dailySchoolLimit: z.coerce.number().int().min(10).max(10000),
        studentDailyLimit: z.coerce.number().int().min(1).max(200),
        requireHumanReviewForActions: z.boolean(),
        allowGemini: z.boolean(),
        allowOpenai: z.boolean(),
        promptVersion: z.string().trim().min(2),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid AI governance settings.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      db.prepare(
        `INSERT INTO ai_governance_policies (school_id, daily_school_limit, student_daily_limit, require_human_review_for_actions, allow_gemini, allow_openai, prompt_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(school_id) DO UPDATE SET
           daily_school_limit = excluded.daily_school_limit,
           student_daily_limit = excluded.student_daily_limit,
           require_human_review_for_actions = excluded.require_human_review_for_actions,
           allow_gemini = excluded.allow_gemini,
           allow_openai = excluded.allow_openai,
           prompt_version = excluded.prompt_version,
           updated_at = excluded.updated_at`
      ).run(
        req.auth!.activeSchoolId!,
        parsed.data.dailySchoolLimit,
        parsed.data.studentDailyLimit,
        parsed.data.requireHumanReviewForActions ? 1 : 0,
        parsed.data.allowGemini ? 1 : 0,
        parsed.data.allowOpenai ? 1 : 0,
        parsed.data.promptVersion,
        new Date().toISOString()
      );
      return res.json({ success: true, message: 'AI Governance policy updated.' });
    }
  );

  router.post('/ai/agents/run', requireAuth, requireSchoolTenant, async (req, res) => {
    const schema = z.object({
      agentType: z.enum(['PRINCIPAL_OPS', 'TEACHER_PEDAGOGY', 'STUDENT_TUTOR', 'PARENT_GUIDE', 'TECH_SUPPORT']),
      prompt: z.string().trim().min(3).max(2000),
      studentId: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Prompt and valid agent type required.', error: { code: 'VALIDATION_ERROR', details: null } });
    }

    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;
    const roleAllowedAgents: Record<AIAgentType, string[]> = {
      PRINCIPAL_OPS: ['PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'PLATFORM_SUPER_ADMIN'],
      TEACHER_PEDAGOGY: ['TEACHER', 'CLASS_TEACHER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'EXAM_OFFICER'],
      STUDENT_TUTOR: ['STUDENT', 'TEACHER', 'CLASS_TEACHER', 'PRINCIPAL'],
      PARENT_GUIDE: ['PARENT', 'LEGAL_GUARDIAN', 'PRINCIPAL'],
      TECH_SUPPORT: ['TECHNICAL_DEPT', 'TECHNICAL_OPERATOR', 'PRINCIPAL', 'PLATFORM_SUPER_ADMIN'],
    };

    if (!roleAllowedAgents[parsed.data.agentType].includes(auth.activeRole)) {
      return res.status(403).json({
        success: false,
        message: `Role ${auth.activeRole} is not authorized for ${parsed.data.agentType}.`,
        error: { code: 'AGENT_ROLE_FORBIDDEN', details: null },
      });
    }

    // Build strictly scoped authorized context (never expose other tenants or restricted safeguarding data)
    const scopedContext: Record<string, unknown> = {
      schoolName: auth.activeSchoolName,
      schoolCode: auth.activeSchoolCode,
      actorRole: auth.activeRole,
    };

    if (parsed.data.agentType === 'PRINCIPAL_OPS') {
      const stuCount = (db.prepare(`SELECT COUNT(*) as c FROM students WHERE school_id = ?`).get(schoolId) as { c: number }).c;
      const unpaidCount = (db.prepare(`SELECT COUNT(*) as c FROM fee_invoices WHERE school_id = ? AND status != 'PAID'`).get(schoolId) as { c: number }).c;
      scopedContext.metrics = { studentsCount: stuCount, unpaidInvoicesCount: unpaidCount };
    } else if (parsed.data.agentType === 'PARENT_GUIDE') {
      const children = db
        .prepare(
          `SELECT s.full_name, s.student_code, c.name as class_name
           FROM student_guardians sg
           JOIN students s ON s.id = sg.student_id
           JOIN classes c ON c.id = s.class_id
           WHERE sg.parent_user_id = ? AND s.school_id = ?`
        )
        .all(auth.userId, schoolId);
      scopedContext.linkedChildren = children;
    }

    const policy = db.prepare(`SELECT prompt_version FROM ai_governance_policies WHERE school_id = ?`).get(schoolId) as
      | { prompt_version: string }
      | undefined;

    try {
      const result = await runRoleScopedAIAgent({
        agentType: parsed.data.agentType,
        prompt: parsed.data.prompt,
        scopedContext,
        promptVersion: policy?.prompt_version || 'v4.0-safe-pedagogy',
      });

      const runId = `air-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO ai_agent_runs (id, school_id, user_id, agent_type, prompt_version, provider, prompt_excerpt, response_summary, proposed_action, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?)`
      ).run(
        runId,
        schoolId,
        auth.userId,
        parsed.data.agentType,
        policy?.prompt_version || 'v4.0-safe-pedagogy',
        result.provider,
        parsed.data.prompt.slice(0, 180),
        result.summary,
        result.proposedAction ? result.proposedAction.title : null,
        new Date().toISOString()
      );

      return res.json({ success: true, data: { runId, result } });
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode || 500;
      const code = (err as { code?: string }).code || 'AI_AGENT_ERROR';
      return res.status(status).json({
        success: false,
        message: err instanceof Error ? err.message : 'AI agent invocation failed.',
        error: { code, details: null },
      });
    }
  });

  return router;
}
