import crypto from 'node:crypto';
import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { calculateGradeAndGpa, parseQrStudentPayload } from '../../src/lib/domainRules';
import { logAuditEvent, requireAuth, requireRoles, requireSchoolTenant } from '../security';
import { triggerWorkflows } from '../services/automationEngine';

export function createAcademicsRouter(db: DatabaseSync) {
  const router = Router();

  // Classes & Subjects
  router.get('/classes', requireAuth, requireSchoolTenant, (req, res) => {
    const classes = db
      .prepare(
        `SELECT c.*, u.full_name as class_teacher_name,
                (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id) as student_count
         FROM classes c
         LEFT JOIN global_users u ON u.id = c.class_teacher_user_id
         WHERE c.school_id = ?
         ORDER BY c.name, c.section`
      )
      .all(req.auth!.activeSchoolId!);
    const subjects = db
      .prepare(`SELECT * FROM subjects WHERE school_id = ? ORDER BY name`)
      .all(req.auth!.activeSchoolId!);
    return res.json({ success: true, data: { classes, subjects } });
  });

  router.post(
    '/classes',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG'),
    (req, res) => {
      const schema = z.object({
        name: z.string().trim().min(2),
        section: z.string().trim().min(1),
        room: z.string().trim().min(1),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid class details.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      const id = `cls-${crypto.randomUUID().slice(0, 8)}`;
      try {
        db.prepare(`INSERT INTO classes (id, school_id, name, section, room) VALUES (?, ?, ?, ?, ?)`).run(
          id,
          req.auth!.activeSchoolId!,
          parsed.data.name,
          parsed.data.section,
          parsed.data.room
        );
      } catch {
        return res.status(409).json({ success: false, message: 'Class & section already exists.', error: { code: 'DUPLICATE_CLASS', details: null } });
      }
      return res.status(201).json({ success: true, message: 'Class created.', data: { id } });
    }
  );

  // Homework
  router.get('/homework', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;

    let items = db
      .prepare(
        `SELECT h.*, c.name as class_name, c.section, u.full_name as teacher_name
         FROM homework h
         JOIN classes c ON c.id = h.class_id
         JOIN global_users u ON u.id = h.teacher_user_id
         WHERE h.school_id = ?
         ORDER BY h.created_at DESC`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    // Filter for Student or Parent to only their class/children
    if (auth.activeRole === 'STUDENT') {
      const stu = db.prepare(`SELECT id, class_id FROM students WHERE user_id = ? AND school_id = ?`).get(auth.userId, schoolId) as { id: string; class_id: string } | undefined;
      items = stu ? items.filter((i) => String(i.class_id) === stu.class_id) : [];
      const subs = stu
        ? (db.prepare(`SELECT * FROM homework_submissions WHERE student_id = ? AND school_id = ?`).all(stu.id, schoolId) as Array<Record<string, unknown>>)
        : [];
      const subMap = new Map(subs.map((s) => [String(s.homework_id), s]));
      items = items.map((i) => ({ ...i, mySubmission: subMap.get(String(i.id)) ?? null }));
    } else if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      const children = db
        .prepare(
          `SELECT s.id, s.class_id, s.full_name FROM student_guardians sg
           JOIN students s ON s.id = sg.student_id
           WHERE sg.parent_user_id = ? AND s.school_id = ?`
        )
        .all(auth.userId, schoolId) as Array<{ id: string; class_id: string; full_name: string }>;
      const classIds = new Set(children.map((c) => c.class_id));
      items = items.filter((i) => classIds.has(String(i.class_id)));
    } else {
      // Teacher / Principal see submissions summary
      const submissions = db
        .prepare(
          `SELECT hs.*, s.full_name as student_name, s.student_code
           FROM homework_submissions hs
           JOIN students s ON s.id = hs.student_id
           WHERE hs.school_id = ?`
        )
        .all(schoolId) as Array<Record<string, unknown>>;
      items = items.map((i) => ({
        ...i,
        submissions: submissions.filter((s) => String(s.homework_id) === String(i.id)),
      }));
    }

    return res.json({ success: true, data: { homework: items } });
  });

  router.post(
    '/homework',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER'),
    (req, res) => {
      const schema = z.object({
        classId: z.string().min(1),
        subjectName: z.string().trim().min(2),
        title: z.string().trim().min(3),
        instructions: z.string().trim().min(5),
        dueDate: z.string().min(4),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid homework fields.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      const schoolId = req.auth!.activeSchoolId!;
      const cls = db.prepare(`SELECT id FROM classes WHERE id = ? AND school_id = ?`).get(parsed.data.classId, schoolId);
      if (!cls) {
        return res.status(403).json({ success: false, message: 'Class does not belong to your school.', error: { code: 'FORBIDDEN', details: null } });
      }
      const id = `hw-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO homework (id, school_id, class_id, subject_name, teacher_user_id, title, instructions, due_date, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PUBLISHED', ?)`
      ).run(id, schoolId, parsed.data.classId, parsed.data.subjectName, req.auth!.userId, parsed.data.title, parsed.data.instructions, parsed.data.dueDate, now);

      // Notify students in class
      const classStudents = db.prepare(`SELECT user_id FROM students WHERE class_id = ? AND school_id = ? AND user_id IS NOT NULL`).all(parsed.data.classId, schoolId) as Array<{ user_id: string }>;
      for (const st of classStudents) {
        db.prepare(`INSERT INTO notifications (id, school_id, user_id, category, title, body, created_at) VALUES (?, ?, ?, 'HOMEWORK', ?, ?, ?)`).run(
          crypto.randomUUID(),
          schoolId,
          st.user_id,
          `New Homework: ${parsed.data.subjectName}`,
          `${parsed.data.title} (Due ${parsed.data.dueDate})`,
          now
        );
      }

      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: 'HOMEWORK_CREATED',
        resourceType: 'HOMEWORK',
        resourceId: id,
      });
      return res.status(201).json({ success: true, message: 'Homework published to class.', data: { id } });
    }
  );

  router.post('/homework/:id/submit', requireAuth, requireSchoolTenant, requireRoles('STUDENT'), (req, res) => {
    const schema = z.object({
      submissionText: z.string().trim().min(3),
      attachmentPath: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Please enter your homework answer or attach work.', error: { code: 'VALIDATION_ERROR', details: null } });
    }
    const schoolId = req.auth!.activeSchoolId!;
    const stu = db.prepare(`SELECT id, class_id FROM students WHERE user_id = ? AND school_id = ?`).get(req.auth!.userId, schoolId) as { id: string; class_id: string } | undefined;
    const hw = db.prepare(`SELECT id, class_id, due_date FROM homework WHERE id = ? AND school_id = ?`).get(req.params.id, schoolId) as { id: string; class_id: string; due_date: string } | undefined;
    if (!stu || !hw || stu.class_id !== hw.class_id) {
      return res.status(403).json({ success: false, message: 'You are not assigned to this homework.', error: { code: 'FORBIDDEN', details: null } });
    }
    const isLate = new Date().toISOString().slice(0, 10) > hw.due_date;
    const status = isLate ? 'LATE' : 'SUBMITTED';
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO homework_submissions (id, school_id, homework_id, student_id, submission_text, attachment_path, status, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(homework_id, student_id) DO UPDATE SET submission_text = excluded.submission_text, attachment_path = excluded.attachment_path, status = excluded.status, submitted_at = excluded.submitted_at`
    ).run(crypto.randomUUID(), schoolId, hw.id, stu.id, parsed.data.submissionText, parsed.data.attachmentPath ?? null, status, now);

    return res.json({ success: true, message: `Homework submitted (${status}).` });
  });

  router.post(
    '/homework/submissions/:subId/review',
    requireAuth,
    requireSchoolTenant,
    requireRoles('TEACHER', 'CLASS_TEACHER', 'PRINCIPAL'),
    (req, res) => {
      const schema = z.object({
        marks: z.coerce.number().min(0).max(100),
        feedback: z.string().trim().min(2),
        status: z.enum(['REVIEWED', 'RESUBMISSION_REQUESTED', 'ACCEPTED']).default('REVIEWED'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid review data.', error: { code: 'VALIDATION_ERROR', details: null } });

      const result = db
        .prepare(
          `UPDATE homework_submissions SET marks = ?, feedback = ?, status = ?, reviewed_at = ? WHERE id = ? AND school_id = ?`
        )
        .run(parsed.data.marks, parsed.data.feedback, parsed.data.status, new Date().toISOString(), req.params.subId, req.auth!.activeSchoolId!);
      if (result.changes === 0) {
        return res.status(404).json({ success: false, message: 'Submission not found.', error: { code: 'NOT_FOUND', details: null } });
      }
      return res.json({ success: true, message: 'Submission graded and feedback sent.' });
    }
  );

  // Attendance
  router.get('/attendance', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;
    const dateFilter = String(req.query.date || '');

    let records = db
      .prepare(
        `SELECT ar.*, ats.session_date, ats.class_id, s.full_name as student_name, s.student_code, s.roll_number, c.name as class_name, c.section
         FROM attendance_records ar
         JOIN attendance_sessions ats ON ats.id = ar.session_id
         JOIN students s ON s.id = ar.student_id
         JOIN classes c ON c.id = ats.class_id
         WHERE ar.school_id = ?
         ORDER BY ats.session_date DESC, s.roll_number ASC`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    if (dateFilter) {
      records = records.filter((r) => String(r.session_date) === dateFilter);
    }
    if (auth.activeRole === 'STUDENT') {
      const stu = db.prepare(`SELECT id FROM students WHERE user_id = ? AND school_id = ?`).get(auth.userId, schoolId) as { id: string } | undefined;
      records = stu ? records.filter((r) => String(r.student_id) === stu.id) : [];
    } else if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      const childIds = new Set(
        (db.prepare(`SELECT student_id FROM student_guardians WHERE parent_user_id = ? AND school_id = ?`).all(auth.userId, schoolId) as Array<{ student_id: string }>).map(
          (x) => x.student_id
        )
      );
      records = records.filter((r) => childIds.has(String(r.student_id)));
    }

    return res.json({ success: true, data: { records } });
  });

  router.post(
    '/attendance',
    requireAuth,
    requireSchoolTenant,
    requireRoles('TEACHER', 'CLASS_TEACHER', 'PRINCIPAL', 'VICE_PRINCIPAL'),
    (req, res) => {
      const schema = z.object({
        classId: z.string().min(1),
        sessionDate: z.string().min(4),
        entries: z.array(
          z.object({
            studentId: z.string().min(1),
            status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']),
            remarks: z.string().optional().default(''),
          })
        ),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid attendance payload.', error: { code: 'VALIDATION_ERROR', details: null } });

      const schoolId = req.auth!.activeSchoolId!;
      const cls = db.prepare(`SELECT id FROM classes WHERE id = ? AND school_id = ?`).get(parsed.data.classId, schoolId);
      if (!cls) return res.status(403).json({ success: false, message: 'Class does not belong to your school.', error: { code: 'FORBIDDEN', details: null } });

      const now = new Date().toISOString();
      let session = db
        .prepare(`SELECT id FROM attendance_sessions WHERE school_id = ? AND class_id = ? AND session_date = ?`)
        .get(schoolId, parsed.data.classId, parsed.data.sessionDate) as { id: string } | undefined;

      db.exec('BEGIN');
      try {
        if (!session) {
          const sid = `att-${crypto.randomUUID().slice(0, 8)}`;
          db.prepare(
            `INSERT INTO attendance_sessions (id, school_id, class_id, session_date, marked_by_user_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(sid, schoolId, parsed.data.classId, parsed.data.sessionDate, req.auth!.userId, now);
          session = { id: sid };
        }
        for (const e of parsed.data.entries) {
          db.prepare(
            `INSERT INTO attendance_records (id, school_id, session_id, student_id, status, remarks)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status, remarks = excluded.remarks`
          ).run(crypto.randomUUID(), schoolId, session.id, e.studentId, e.status, e.remarks);
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: 'ATTENDANCE_RECORDED',
        resourceType: 'ATTENDANCE',
        resourceId: session.id,
        metadata: { date: parsed.data.sessionDate, count: parsed.data.entries.length },
      });
      const absentees = parsed.data.entries.filter((e) => e.status === 'ABSENT');
      if (absentees.length > 0) {
        triggerWorkflows(db, {
          schoolId,
          triggerType: 'ATTENDANCE_ABSENT',
          actorUserId: req.auth!.userId,
          sourceEventId: `att-${session.id}-${parsed.data.sessionDate}-${absentees.length}`,
          payload: { summary: `${absentees.length} student(s) marked ABSENT on ${parsed.data.sessionDate}` },
        });
      }
      return res.json({ success: true, message: `Attendance saved for ${parsed.data.entries.length} students.` });
    }
  );

  // Instant QR Student Attendance Check-In
  router.post(
    '/attendance/qr-checkin',
    requireAuth,
    requireSchoolTenant,
    requireRoles('TEACHER', 'CLASS_TEACHER', 'PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_RECEPTION'),
    (req, res) => {
      const schema = z.object({
        qrPayload: z.string().trim().min(3),
        sessionDate: z.string().optional(),
        status: z.enum(['PRESENT', 'LATE']).default('PRESENT'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Valid QR payload or Student ID is required.', error: { code: 'VALIDATION_ERROR', details: null } });
      }

      const qr = parseQrStudentPayload(parsed.data.qrPayload);
      if (!qr) {
        return res.status(400).json({ success: false, message: 'Unrecognized QR format. Scan a ShikshyaPlus Student ID card or enter STU-XXX.', error: { code: 'INVALID_QR', details: null } });
      }

      const schoolId = req.auth!.activeSchoolId!;
      if (qr.schoolCode && req.auth!.activeSchoolCode && qr.schoolCode !== req.auth!.activeSchoolCode.toUpperCase()) {
        return res.status(403).json({
          success: false,
          message: `Cross-school ID rejected: Card belongs to ${qr.schoolCode}, active school is ${req.auth!.activeSchoolCode}.`,
          error: { code: 'CROSS_TENANT_QR', details: null },
        });
      }

      const student = db
        .prepare(
          `SELECT s.id, s.full_name, s.student_code, s.class_id, s.roll_number, c.name as class_name, c.section
           FROM students s
           JOIN classes c ON c.id = s.class_id
           WHERE s.school_id = ? AND UPPER(s.student_code) = UPPER(?)`
        )
        .get(schoolId, qr.studentCode) as
        | { id: string; full_name: string; student_code: string; class_id: string; roll_number: number; class_name: string; section: string }
        | undefined;

      if (!student) {
        return res.status(404).json({ success: false, message: `Student ${qr.studentCode} not found in this school.`, error: { code: 'NOT_FOUND', details: null } });
      }

      const sessionDate = parsed.data.sessionDate || new Date().toISOString().slice(0, 10);
      const now = new Date().toISOString();
      let session = db
        .prepare(`SELECT id FROM attendance_sessions WHERE school_id = ? AND class_id = ? AND session_date = ?`)
        .get(schoolId, student.class_id, sessionDate) as { id: string } | undefined;

      db.exec('BEGIN');
      try {
        if (!session) {
          const sid = `att-${crypto.randomUUID().slice(0, 8)}`;
          db.prepare(
            `INSERT INTO attendance_sessions (id, school_id, class_id, session_date, marked_by_user_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(sid, schoolId, student.class_id, sessionDate, req.auth!.userId, now);
          session = { id: sid };
        }
        db.prepare(
          `INSERT INTO attendance_records (id, school_id, session_id, student_id, status, remarks)
           VALUES (?, ?, ?, ?, ?, 'QR Check-In')
           ON CONFLICT(session_id, student_id) DO UPDATE SET status = excluded.status, remarks = excluded.remarks`
        ).run(crypto.randomUUID(), schoolId, session.id, student.id, parsed.data.status);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: 'ATTENDANCE_QR_CHECKIN',
        resourceType: 'ATTENDANCE',
        resourceId: session.id,
        metadata: { studentCode: student.student_code, sessionDate, status: parsed.data.status },
      });

      return res.json({
        success: true,
        message: `${student.full_name} (${student.student_code}) marked ${parsed.data.status} for ${student.class_name}-${student.section}.`,
        data: { student, sessionDate, status: parsed.data.status },
      });
    }
  );

  // Daily Diary
  router.get('/diary', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;
    let entries = db
      .prepare(
        `SELECT d.*, c.name as class_name, c.section, u.full_name as teacher_name
         FROM daily_diary_entries d
         JOIN classes c ON c.id = d.class_id
         JOIN global_users u ON u.id = d.teacher_user_id
         WHERE d.school_id = ?
         ORDER BY d.entry_date DESC, d.created_at DESC`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    if (auth.activeRole === 'STUDENT') {
      const stu = db.prepare(`SELECT class_id FROM students WHERE user_id = ? AND school_id = ?`).get(auth.userId, schoolId) as { class_id: string } | undefined;
      entries = stu ? entries.filter((e) => String(e.class_id) === stu.class_id) : [];
    } else if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      const classIds = new Set(
        (
          db
            .prepare(`SELECT s.class_id FROM student_guardians sg JOIN students s ON s.id = sg.student_id WHERE sg.parent_user_id = ? AND s.school_id = ?`)
            .all(auth.userId, schoolId) as Array<{ class_id: string }>
        ).map((c) => c.class_id)
      );
      entries = entries.filter((e) => classIds.has(String(e.class_id)));
    }
    return res.json({ success: true, data: { entries } });
  });

  router.post(
    '/diary',
    requireAuth,
    requireSchoolTenant,
    requireRoles('TEACHER', 'CLASS_TEACHER', 'PRINCIPAL'),
    (req, res) => {
      const schema = z.object({
        classId: z.string().min(1),
        entryDate: z.string().min(4),
        subjectName: z.string().trim().min(2),
        topic: z.string().trim().min(2),
        classwork: z.string().trim().min(2),
        homeworkSummary: z.string().trim().min(2),
        nextDayPrep: z.string().optional().default(''),
        remarks: z.string().optional().default(''),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid diary entry.', error: { code: 'VALIDATION_ERROR', details: null } });
      const schoolId = req.auth!.activeSchoolId!;
      const cls = db.prepare(`SELECT id FROM classes WHERE id = ? AND school_id = ?`).get(parsed.data.classId, schoolId);
      if (!cls) return res.status(403).json({ success: false, message: 'Class does not belong to your school.', error: { code: 'FORBIDDEN', details: null } });

      const id = `dry-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO daily_diary_entries (id, school_id, class_id, entry_date, subject_name, topic, classwork, homework_summary, next_day_prep, remarks, teacher_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        schoolId,
        parsed.data.classId,
        parsed.data.entryDate,
        parsed.data.subjectName,
        parsed.data.topic,
        parsed.data.classwork,
        parsed.data.homeworkSummary,
        parsed.data.nextDayPrep,
        parsed.data.remarks,
        req.auth!.userId,
        new Date().toISOString()
      );
      return res.status(201).json({ success: true, message: 'Daily diary entry published.' });
    }
  );

  // Timetable with Room & Teacher double-booking protection
  router.get('/timetable', requireAuth, requireSchoolTenant, (req, res) => {
    const rows = db
      .prepare(
        `SELECT t.*, c.name as class_name, c.section, u.full_name as teacher_name
         FROM timetables t
         JOIN classes c ON c.id = t.class_id
         JOIN global_users u ON u.id = t.teacher_user_id
         WHERE t.school_id = ?
         ORDER BY t.day_of_week, t.period_number`
      )
      .all(req.auth!.activeSchoolId!);
    return res.json({ success: true, data: { timetable: rows } });
  });

  router.post(
    '/timetable',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG'),
    (req, res) => {
      const schema = z.object({
        classId: z.string().min(1),
        dayOfWeek: z.enum(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']),
        periodNumber: z.coerce.number().int().min(1).max(10),
        timeSlot: z.string().trim().min(3),
        subjectName: z.string().trim().min(2),
        teacherUserId: z.string().min(1),
        room: z.string().trim().min(1),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid timetable slot.', error: { code: 'VALIDATION_ERROR', details: null } });

      const d = parsed.data;
      const schoolId = req.auth!.activeSchoolId!;
      const conflict = db
        .prepare(
          `SELECT id FROM timetables WHERE school_id = ? AND day_of_week = ? AND period_number = ? AND (room = ? OR teacher_user_id = ? OR class_id = ?)`
        )
        .get(schoolId, d.dayOfWeek, d.periodNumber, d.room, d.teacherUserId, d.classId);

      if (conflict) {
        return res.status(409).json({
          success: false,
          message: 'Double-booking prevented: This teacher, room, or class already has a scheduled period at that time.',
          error: { code: 'TIMETABLE_CONFLICT', details: null },
        });
      }

      db.prepare(
        `INSERT INTO timetables (id, school_id, class_id, day_of_week, period_number, time_slot, subject_name, teacher_user_id, room)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), schoolId, d.classId, d.dayOfWeek, d.periodNumber, d.timeSlot, d.subjectName, d.teacherUserId, d.room);

      return res.status(201).json({ success: true, message: 'Timetable period scheduled.' });
    }
  );

  // Examinations & Results (Approval workflow + student/parent sees PUBLISHED only!)
  router.get('/exams', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;

    let exams = db
      .prepare(
        `SELECT e.*, c.name as class_name, c.section
         FROM examinations e
         JOIN classes c ON c.id = e.class_id
         WHERE e.school_id = ?
         ORDER BY e.exam_date DESC`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    if (auth.activeRole === 'STUDENT' || auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      exams = exams.filter((e) => String(e.status) === 'PUBLISHED');
    }

    let marks = db
      .prepare(
        `SELECT m.*, s.full_name as student_name, s.student_code, s.roll_number
         FROM student_marks m
         JOIN students s ON s.id = m.student_id
         WHERE m.school_id = ?`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    if (auth.activeRole === 'STUDENT') {
      const stu = db.prepare(`SELECT id FROM students WHERE user_id = ? AND school_id = ?`).get(auth.userId, schoolId) as { id: string } | undefined;
      marks = stu ? marks.filter((m) => String(m.student_id) === stu.id) : [];
    } else if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      const childIds = new Set(
        (db.prepare(`SELECT student_id FROM student_guardians WHERE parent_user_id = ? AND school_id = ?`).all(auth.userId, schoolId) as Array<{ student_id: string }>).map(
          (x) => x.student_id
        )
      );
      marks = marks.filter((m) => childIds.has(String(m.student_id)));
    }

    return res.json({
      success: true,
      data: {
        exams: exams.map((e) => ({
          ...e,
          marks: marks.filter((m) => String(m.exam_id) === String(e.id)),
        })),
      },
    });
  });

  router.post(
    '/exams',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'EXAM_OFFICER', 'TEACHER', 'CLASS_TEACHER'),
    (req, res) => {
      const schema = z.object({
        name: z.string().trim().min(3),
        classId: z.string().min(1),
        examDate: z.string().min(4),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid exam details.', error: { code: 'VALIDATION_ERROR', details: null } });

      const schoolId = req.auth!.activeSchoolId!;
      const cls = db.prepare(`SELECT id FROM classes WHERE id = ? AND school_id = ?`).get(parsed.data.classId, schoolId);
      if (!cls) return res.status(403).json({ success: false, message: 'Class does not belong to your school.', error: { code: 'FORBIDDEN', details: null } });

      const id = `exm-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO examinations (id, school_id, name, class_id, exam_date, status, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?)`
      ).run(id, schoolId, parsed.data.name, parsed.data.classId, parsed.data.examDate, req.auth!.userId, new Date().toISOString());

      return res.status(201).json({ success: true, message: 'Examination created in DRAFT state.', data: { id } });
    }
  );

  router.post(
    '/exams/:examId/marks',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'EXAM_OFFICER', 'TEACHER', 'CLASS_TEACHER'),
    (req, res) => {
      const schema = z.object({
        studentId: z.string().min(1),
        subjectName: z.string().trim().min(2),
        theoryMarks: z.coerce.number().min(0).max(100),
        practicalMarks: z.coerce.number().min(0).max(50).default(0),
        fullMarks: z.coerce.number().min(10).max(200).default(100),
        passMarks: z.coerce.number().min(5).max(100).default(40),
        remarks: z.string().optional().default(''),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid marks entry.', error: { code: 'VALIDATION_ERROR', details: null } });

      const schoolId = req.auth!.activeSchoolId!;
      const exam = db.prepare(`SELECT id, status FROM examinations WHERE id = ? AND school_id = ?`).get(req.params.examId, schoolId) as { id: string; status: string } | undefined;
      if (!exam) return res.status(404).json({ success: false, message: 'Examination not found.', error: { code: 'NOT_FOUND', details: null } });
      if (exam.status === 'PUBLISHED' && req.auth!.activeRole !== 'PRINCIPAL') {
        return res.status(403).json({ success: false, message: 'Published marks require Principal override to modify.', error: { code: 'FORBIDDEN', details: null } });
      }

      const d = parsed.data;
      const total = d.theoryMarks + d.practicalMarks;
      const calc = calculateGradeAndGpa(total, d.fullMarks, d.passMarks);

      db.prepare(
        `INSERT INTO student_marks (id, school_id, exam_id, student_id, subject_name, theory_marks, practical_marks, full_marks, pass_marks, grade, gpa, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(exam_id, student_id, subject_name) DO UPDATE SET theory_marks = excluded.theory_marks, practical_marks = excluded.practical_marks, grade = excluded.grade, gpa = excluded.gpa, remarks = excluded.remarks`
      ).run(crypto.randomUUID(), schoolId, exam.id, d.studentId, d.subjectName, d.theoryMarks, d.practicalMarks, d.fullMarks, d.passMarks, calc.grade, calc.gpa, d.remarks);

      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: 'EXAM_MARKS_UPDATED',
        resourceType: 'EXAMINATION',
        resourceId: exam.id,
        metadata: { studentId: d.studentId, subject: d.subjectName, total, grade: calc.grade },
      });

      return res.json({ success: true, message: `Marks saved (${total}/${d.fullMarks} · Grade ${calc.grade}).` });
    }
  );

  router.post(
    '/exams/:examId/status',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'EXAM_OFFICER', 'TEACHER', 'CLASS_TEACHER'),
    (req, res) => {
      const nextStatus = z.enum(['SUBMITTED', 'APPROVED', 'PUBLISHED']).parse(req.body?.status);
      if ((nextStatus === 'APPROVED' || nextStatus === 'PUBLISHED') && req.auth!.activeRole !== 'PRINCIPAL' && req.auth!.activeRole !== 'EXAM_OFFICER') {
        return res.status(403).json({ success: false, message: 'Only Principal or Examination Officer can approve and publish results.', error: { code: 'FORBIDDEN', details: null } });
      }
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE examinations SET status = ?, approved_by_user_id = ?, published_at = ? WHERE id = ? AND school_id = ?`
      ).run(
        nextStatus,
        nextStatus === 'APPROVED' || nextStatus === 'PUBLISHED' ? req.auth!.userId : null,
        nextStatus === 'PUBLISHED' ? now : null,
        req.params.examId,
        req.auth!.activeSchoolId!
      );

      logAuditEvent(db, {
        schoolId: req.auth!.activeSchoolId!,
        actorUserId: req.auth!.userId,
        action: `EXAM_STATUS_${nextStatus}`,
        resourceType: 'EXAMINATION',
        resourceId: req.params.examId,
      });

      if (nextStatus === 'PUBLISHED') {
        triggerWorkflows(db, {
          schoolId: req.auth!.activeSchoolId!,
          triggerType: 'EXAM_PUBLISHED',
          actorUserId: req.auth!.userId,
          sourceEventId: `exam-pub-${req.params.examId}`,
          payload: { examId: req.params.examId, summary: `Exam ${req.params.examId} published` },
        });
      }

      return res.json({ success: true, message: `Examination status updated to ${nextStatus}.` });
    }
  );

  return router;
}
