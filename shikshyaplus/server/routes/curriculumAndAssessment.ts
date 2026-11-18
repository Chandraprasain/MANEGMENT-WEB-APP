import crypto from 'node:crypto';
import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { buildOneRosterCsv, buildQtiAssessmentXml } from '../../src/lib/v4Rules';
import { logAuditEvent, requireAuth, requireRoles, requireSchoolTenant } from '../security';
import { signOpenBadgePayload, verifyOpenBadgeSignature } from '../services/encryption';

export function createCurriculumAndAssessmentRouter(db: DatabaseSync) {
  const router = Router();

  // ======================== SYSTEM 3: CURRICULUM, COMPETENCY & ILPs ========================
  router.get('/curriculum', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;

    const frameworks = db
      .prepare(`SELECT * FROM curriculum_frameworks WHERE school_id = ? ORDER BY created_at DESC`)
      .all(schoolId);
    const objectives = db
      .prepare(`SELECT * FROM learning_objectives WHERE school_id = ? ORDER BY objective_code`)
      .all(schoolId);

    let progress = db
      .prepare(
        `SELECT cp.*, lo.objective_code, lo.description as objective_desc, s.full_name as student_name, s.student_code
         FROM competency_progress cp
         JOIN learning_objectives lo ON lo.id = cp.objective_id
         JOIN students s ON s.id = cp.student_id
         WHERE cp.school_id = ? ORDER BY cp.updated_at DESC`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    let ilps = [] as Array<Record<string, unknown>>;
    if (['PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER'].includes(auth.activeRole)) {
      ilps = db
        .prepare(
          `SELECT i.*, s.full_name as student_name, s.student_code
           FROM individual_learning_plans i JOIN students s ON s.id = i.student_id
           WHERE i.school_id = ? ORDER BY i.created_at DESC`
        )
        .all(schoolId) as Array<Record<string, unknown>>;
    } else if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      const childIds = new Set(
        (db.prepare(`SELECT student_id FROM student_guardians WHERE parent_user_id = ? AND school_id = ?`).all(auth.userId, schoolId) as Array<{ student_id: string }>).map(
          (c) => c.student_id
        )
      );
      progress = progress.filter((p) => childIds.has(String(p.student_id)));
      ilps = (
        db
          .prepare(
            `SELECT i.*, s.full_name as student_name, s.student_code
             FROM individual_learning_plans i JOIN students s ON s.id = i.student_id
             WHERE i.school_id = ?`
          )
          .all(schoolId) as Array<Record<string, unknown>>
      ).filter((i) => childIds.has(String(i.student_id)));
    } else if (auth.activeRole === 'STUDENT') {
      const stu = db.prepare(`SELECT id FROM students WHERE user_id = ? AND school_id = ?`).get(auth.userId, schoolId) as { id: string } | undefined;
      progress = stu ? progress.filter((p) => String(p.student_id) === stu.id) : [];
    }

    return res.json({ success: true, data: { frameworks, objectives, progress, ilps } });
  });

  router.post(
    '/curriculum/frameworks',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER'),
    (req, res) => {
      const schema = z.object({
        name: z.string().trim().min(3),
        board: z.string().trim().min(2),
        gradeLevel: z.string().trim().min(2),
        subjectName: z.string().trim().min(2),
        version: z.string().trim().default('1.0'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid curriculum framework.', error: { code: 'VALIDATION_ERROR', details: null } });

      const id = `cur-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO curriculum_frameworks (id, school_id, name, board, grade_level, subject_name, version, status, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', ?, ?)`
      ).run(
        id,
        req.auth!.activeSchoolId!,
        parsed.data.name,
        parsed.data.board,
        parsed.data.gradeLevel,
        parsed.data.subjectName,
        parsed.data.version,
        req.auth!.userId,
        new Date().toISOString()
      );
      return res.status(201).json({ success: true, message: 'Curriculum framework created.', data: { id } });
    }
  );

  router.post(
    '/curriculum/objectives',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER'),
    (req, res) => {
      const schema = z.object({
        frameworkId: z.string().min(1),
        unitTitle: z.string().trim().min(2),
        objectiveCode: z.string().trim().min(2),
        description: z.string().trim().min(5),
        competencyTag: z.string().trim().default('CORE'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid learning objective.', error: { code: 'VALIDATION_ERROR', details: null } });
      const schoolId = req.auth!.activeSchoolId!;
      const fw = db.prepare(`SELECT id FROM curriculum_frameworks WHERE id = ? AND school_id = ?`).get(parsed.data.frameworkId, schoolId);
      if (!fw) return res.status(404).json({ success: false, message: 'Curriculum framework not found.', error: { code: 'NOT_FOUND', details: null } });

      const id = `obj-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO learning_objectives (id, school_id, framework_id, unit_title, objective_code, description, competency_tag)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(id, schoolId, parsed.data.frameworkId, parsed.data.unitTitle, parsed.data.objectiveCode, parsed.data.description, parsed.data.competencyTag);
      return res.status(201).json({ success: true, message: 'Learning objective added.', data: { id } });
    }
  );

  router.post(
    '/curriculum/mastery',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER'),
    (req, res) => {
      const schema = z.object({
        studentId: z.string().min(1),
        objectiveId: z.string().min(1),
        masteryLevel: z.enum(['NOT_STARTED', 'DEVELOPING', 'PROFICIENT', 'MASTERED']),
        evidenceNote: z.string().trim().optional().default(''),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid mastery rating.', error: { code: 'VALIDATION_ERROR', details: null } });

      const schoolId = req.auth!.activeSchoolId!;
      db.prepare(
        `INSERT INTO competency_progress (id, school_id, student_id, objective_id, mastery_level, assessed_by_user_id, evidence_note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(student_id, objective_id) DO UPDATE SET mastery_level = excluded.mastery_level, evidence_note = excluded.evidence_note, assessed_by_user_id = excluded.assessed_by_user_id, updated_at = excluded.updated_at`
      ).run(
        `cmp-${crypto.randomUUID().slice(0, 8)}`,
        schoolId,
        parsed.data.studentId,
        parsed.data.objectiveId,
        parsed.data.masteryLevel,
        req.auth!.userId,
        parsed.data.evidenceNote,
        new Date().toISOString()
      );
      return res.json({ success: true, message: `Competency mastery updated to ${parsed.data.masteryLevel}.` });
    }
  );

  router.post(
    '/curriculum/ilps',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER'),
    (req, res) => {
      const schema = z.object({
        studentId: z.string().min(1),
        goalTitle: z.string().trim().min(3),
        accommodations: z.string().trim().min(5),
        targetDate: z.string().min(4),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid ILP details.', error: { code: 'VALIDATION_ERROR', details: null } });
      const id = `ilp-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO individual_learning_plans (id, school_id, student_id, goal_title, accommodations, target_date, status, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
      ).run(id, req.auth!.activeSchoolId!, parsed.data.studentId, parsed.data.goalTitle, parsed.data.accommodations, parsed.data.targetDate, req.auth!.userId, new Date().toISOString());
      return res.status(201).json({ success: true, message: 'Individual Learning Plan saved.', data: { id } });
    }
  );

  // ======================== SYSTEM 4: QUESTION BANK & CBT EXAMS ========================
  router.get('/question-bank', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    if (auth.activeRole === 'STUDENT' || auth.activeRole === 'PARENT') {
      // Never leak answer keys to students
      return res.status(403).json({ success: false, message: 'Question bank repository is restricted to educators.', error: { code: 'FORBIDDEN', details: null } });
    }
    const questions = db
      .prepare(`SELECT * FROM question_items WHERE school_id = ? ORDER BY created_at DESC`)
      .all(auth.activeSchoolId!);
    return res.json({ success: true, data: { questions } });
  });

  router.post(
    '/question-bank',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER', 'EXAM_OFFICER'),
    (req, res) => {
      const schema = z.object({
        subjectName: z.string().trim().min(2),
        gradeLevel: z.string().trim().min(2),
        questionType: z.enum(['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER', 'NUMERICAL']).default('MCQ'),
        difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
        prompt: z.string().trim().min(4),
        options: z.array(z.string()).default([]),
        correctAnswer: z.string().trim().min(1),
        explanation: z.string().trim().optional().default(''),
        marks: z.coerce.number().positive().default(2),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid question item.', error: { code: 'VALIDATION_ERROR', details: null } });
      const id = `qst-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO question_items (id, school_id, subject_name, grade_level, question_type, difficulty, prompt, options_json, correct_answer, explanation, marks, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        req.auth!.activeSchoolId!,
        parsed.data.subjectName,
        parsed.data.gradeLevel,
        parsed.data.questionType,
        parsed.data.difficulty,
        parsed.data.prompt,
        JSON.stringify(parsed.data.options),
        parsed.data.correctAnswer,
        parsed.data.explanation,
        parsed.data.marks,
        req.auth!.userId,
        new Date().toISOString()
      );
      return res.status(201).json({ success: true, message: 'Question added to school bank.', data: { id } });
    }
  );

  router.get('/assessments', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;
    const assessments = db
      .prepare(
        `SELECT a.*, c.name as class_name, c.section
         FROM assessments a JOIN classes c ON c.id = a.class_id
         WHERE a.school_id = ? ORDER BY a.created_at DESC`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    const allQuestions = db
      .prepare(`SELECT id, subject_name, question_type, difficulty, prompt, options_json, marks FROM question_items WHERE school_id = ?`)
      .all(schoolId) as Array<Record<string, unknown>>;
    const qMap = new Map(allQuestions.map((q) => [String(q.id), q]));

    let attempts = db
      .prepare(
        `SELECT aa.*, s.full_name as student_name, s.student_code
         FROM assessment_attempts aa JOIN students s ON s.id = aa.student_id
         WHERE aa.school_id = ? ORDER BY aa.started_at DESC`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    if (auth.activeRole === 'STUDENT') {
      const stu = db.prepare(`SELECT id FROM students WHERE user_id = ? AND school_id = ?`).get(auth.userId, schoolId) as { id: string } | undefined;
      attempts = stu ? attempts.filter((a) => String(a.student_id) === stu.id) : [];
    } else if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      const childIds = new Set(
        (db.prepare(`SELECT student_id FROM student_guardians WHERE parent_user_id = ? AND school_id = ?`).all(auth.userId, schoolId) as Array<{ student_id: string }>).map(
          (x) => x.student_id
        )
      );
      attempts = attempts.filter((a) => childIds.has(String(a.student_id)));
    }

    const hydrated = assessments.map((a) => {
      let qIds: string[] = [];
      try {
        qIds = JSON.parse(String(a.question_ids_json || '[]'));
      } catch {
        qIds = [];
      }
      return {
        ...a,
        questions: qIds.map((id) => qMap.get(id)).filter(Boolean),
      };
    });

    return res.json({ success: true, data: { assessments: hydrated, attempts } });
  });

  router.post(
    '/assessments',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER', 'EXAM_OFFICER'),
    (req, res) => {
      const schema = z.object({
        classId: z.string().min(1),
        title: z.string().trim().min(3),
        subjectName: z.string().trim().min(2),
        durationMinutes: z.coerce.number().int().min(5).max(240).default(20),
        maxAttempts: z.coerce.number().int().min(1).max(10).default(2),
        questionIds: z.array(z.string()).min(1),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Select at least one question and valid assessment metadata.', error: { code: 'VALIDATION_ERROR', details: null } });

      const schoolId = req.auth!.activeSchoolId!;
      const totalMarks = parsed.data.questionIds.reduce((sum, qid) => {
        const q = db.prepare(`SELECT marks FROM question_items WHERE id = ? AND school_id = ?`).get(qid, schoolId) as { marks: number } | undefined;
        return sum + Number(q?.marks || 0);
      }, 0);

      const id = `asmt-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO assessments (id, school_id, class_id, title, subject_name, duration_minutes, max_attempts, question_ids_json, total_marks, status, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', ?, ?)`
      ).run(
        id,
        schoolId,
        parsed.data.classId,
        parsed.data.title,
        parsed.data.subjectName,
        parsed.data.durationMinutes,
        parsed.data.maxAttempts,
        JSON.stringify(parsed.data.questionIds),
        totalMarks,
        req.auth!.userId,
        new Date().toISOString()
      );
      return res.status(201).json({ success: true, message: 'CBT assessment published.', data: { id } });
    }
  );

  router.post('/assessments/:id/submit', requireAuth, requireSchoolTenant, requireRoles('STUDENT'), (req, res) => {
    const schema = z.object({
      answers: z.record(z.string(), z.string()),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Answers map required.', error: { code: 'VALIDATION_ERROR', details: null } });

    const schoolId = req.auth!.activeSchoolId!;
    const stu = db.prepare(`SELECT id FROM students WHERE user_id = ? AND school_id = ?`).get(req.auth!.userId, schoolId) as { id: string } | undefined;
    const asmt = db.prepare(`SELECT * FROM assessments WHERE id = ? AND school_id = ?`).get(req.params.id, schoolId) as Record<string, unknown> | undefined;
    if (!stu || !asmt) {
      return res.status(404).json({ success: false, message: 'Student profile or assessment not found.', error: { code: 'NOT_FOUND', details: null } });
    }

    const priorCount = (
      db
        .prepare(`SELECT COUNT(*) as c FROM assessment_attempts WHERE assessment_id = ? AND student_id = ?`)
        .get(req.params.id, stu.id) as { c: number }
    ).c;
    if (priorCount >= Number(asmt.max_attempts || 2)) {
      return res.status(403).json({ success: false, message: 'Maximum assessment attempts reached.', error: { code: 'ATTEMPT_LIMIT_REACHED', details: null } });
    }

    const qIds = JSON.parse(String(asmt.question_ids_json || '[]')) as string[];
    let objectiveScore = 0;
    let maxScore = 0;
    for (const qid of qIds) {
      const q = db.prepare(`SELECT correct_answer, marks FROM question_items WHERE id = ? AND school_id = ?`).get(qid, schoolId) as
        | { correct_answer: string; marks: number }
        | undefined;
      if (!q) continue;
      maxScore += Number(q.marks);
      const given = (parsed.data.answers[qid] || '').trim().toLowerCase();
      if (given && given === q.correct_answer.trim().toLowerCase()) {
        objectiveScore += Number(q.marks);
      }
    }

    const attemptId = `attp-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO assessment_attempts (id, school_id, assessment_id, student_id, answers_json, objective_score, max_score, status, started_at, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'GRADED', ?, ?)`
    ).run(attemptId, schoolId, req.params.id, stu.id, JSON.stringify(parsed.data.answers), objectiveScore, maxScore, now, now);

    return res.status(201).json({
      success: true,
      message: `Assessment graded: ${objectiveScore}/${maxScore}`,
      data: { attemptId, objectiveScore, maxScore },
    });
  });

  // ======================== SYSTEM 7 & 24: INTEROPERABILITY & OPEN BADGES 3.0 ========================
  router.get(
    '/interoperability/oneroster/users',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'TECHNICAL_DEPT', 'PLATFORM_SUPER_ADMIN'),
    (req, res) => {
      const schoolId = req.auth!.activeSchoolId!;
      const rows = db
        .prepare(
          `SELECT m.user_id, m.role, m.user_code, u.username, u.full_name, u.email
           FROM school_memberships m JOIN global_users u ON u.id = m.user_id
           WHERE m.school_id = ? AND m.status = 'ACTIVE'`
        )
        .all(schoolId) as Array<Record<string, unknown>>;

      const mapped = rows.map((r) => {
        const parts = String(r.full_name || '').split(' ');
        const givenName = parts[0] || 'User';
        const familyName = parts.slice(1).join(' ') || 'Member';
        return {
          sourcedId: String(r.user_id),
          role: String(r.role).toLowerCase(),
          username: String(r.username),
          givenName,
          familyName,
          email: String(r.email),
          identifier: String(r.user_code),
        };
      });

      const csv = buildOneRosterCsv(mapped);
      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: 'ONEROSTER_EXPORTED',
        resourceType: 'INTEROPERABILITY',
        metadata: { format: 'OneRoster 1.2 CSV', count: mapped.length },
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="oneroster-1.2-users-${req.auth!.activeSchoolCode || 'school'}.csv"`);
      return res.send(csv);
    }
  );

  router.get(
    '/interoperability/qti/:assessmentId',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER', 'EXAM_OFFICER', 'TECHNICAL_DEPT'),
    (req, res) => {
      const schoolId = req.auth!.activeSchoolId!;
      const asmt = db.prepare(`SELECT * FROM assessments WHERE id = ? AND school_id = ?`).get(req.params.assessmentId, schoolId) as Record<string, unknown> | undefined;
      if (!asmt) return res.status(404).json({ success: false, message: 'Assessment not found.', error: { code: 'NOT_FOUND', details: null } });

      const qIds = JSON.parse(String(asmt.question_ids_json || '[]')) as string[];
      const items = qIds
        .map((id) => db.prepare(`SELECT * FROM question_items WHERE id = ? AND school_id = ?`).get(id, schoolId) as Record<string, unknown> | undefined)
        .filter((x): x is Record<string, unknown> => Boolean(x))
        .map((q) => ({
          id: String(q.id),
          prompt: String(q.prompt),
          options: JSON.parse(String(q.options_json || '[]')) as string[],
          correctAnswer: String(q.correct_answer),
        }));

      const xml = buildQtiAssessmentXml({
        identifier: String(asmt.id),
        title: String(asmt.title),
        items,
      });
      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      return res.send(xml);
    }
  );

  router.get('/interoperability/badges', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;
    let badges = db
      .prepare(
        `SELECT b.*, s.full_name as student_name, s.student_code
         FROM open_badges b JOIN students s ON s.id = b.student_id
         WHERE b.school_id = ? ORDER BY b.issued_at DESC`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    if (auth.activeRole === 'STUDENT') {
      const stu = db.prepare(`SELECT id FROM students WHERE user_id = ? AND school_id = ?`).get(auth.userId, schoolId) as { id: string } | undefined;
      badges = stu ? badges.filter((b) => String(b.student_id) === stu.id) : [];
    } else if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      const childIds = new Set(
        (db.prepare(`SELECT student_id FROM student_guardians WHERE parent_user_id = ? AND school_id = ?`).all(auth.userId, schoolId) as Array<{ student_id: string }>).map(
          (c) => c.student_id
        )
      );
      badges = badges.filter((b) => childIds.has(String(b.student_id)));
    }
    return res.json({ success: true, data: { badges } });
  });

  router.post(
    '/interoperability/badges',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER'),
    (req, res) => {
      const schema = z.object({
        studentId: z.string().min(1),
        badgeName: z.string().trim().min(3),
        criteria: z.string().trim().min(5),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid badge details.', error: { code: 'VALIDATION_ERROR', details: null } });

      const schoolId = req.auth!.activeSchoolId!;
      const stu = db.prepare(`SELECT id, full_name, student_code FROM students WHERE id = ? AND school_id = ?`).get(parsed.data.studentId, schoolId) as
        | { id: string; full_name: string; student_code: string }
        | undefined;
      if (!stu) return res.status(404).json({ success: false, message: 'Student not found in school.', error: { code: 'NOT_FOUND', details: null } });

      const signed = signOpenBadgePayload({
        studentCode: stu.student_code,
        studentName: stu.full_name,
        schoolCode: req.auth!.activeSchoolCode || schoolId,
        badgeName: parsed.data.badgeName,
        criteria: parsed.data.criteria,
      });

      const id = `bdg-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO open_badges (id, school_id, student_id, badge_name, criteria, credential_json, signature_hex, verification_code, issued_by_user_id, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, schoolId, stu.id, parsed.data.badgeName, parsed.data.criteria, signed.credentialJson, signed.signatureHex, signed.verificationHash, req.auth!.userId, new Date().toISOString());

      return res.status(201).json({
        success: true,
        message: 'Open Badge 3.0 credential signed and issued.',
        data: { id, verificationCode: signed.verificationHash },
      });
    }
  );

  router.get('/interoperability/badges/verify/:code', (req, res) => {
    const badge = db
      .prepare(
        `SELECT b.*, s.full_name as student_name, s.student_code, sc.name as school_name, sc.school_code
         FROM open_badges b
         JOIN students s ON s.id = b.student_id
         JOIN schools sc ON sc.id = b.school_id
         WHERE UPPER(b.verification_code) = UPPER(?)`
      )
      .get(req.params.code) as Record<string, unknown> | undefined;

    if (!badge) {
      return res.status(404).json({ success: false, message: 'No Open Badge matching that verification code.', error: { code: 'NOT_FOUND', details: null } });
    }
    const validSignature = verifyOpenBadgeSignature(String(badge.credential_json), String(badge.signature_hex));
    return res.json({
      success: true,
      data: {
        verified: validSignature,
        algorithm: 'HMAC-SHA256-OB3-JSONLD',
        badgeName: badge.badge_name,
        studentName: badge.student_name,
        schoolName: badge.school_name,
        issuedAt: badge.issued_at,
        verificationCode: badge.verification_code,
      },
    });
  });

  return router;
}
