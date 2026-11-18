import crypto from 'node:crypto';
import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  generateTemporaryPassword,
  hashPassword,
  logAuditEvent,
  requireAuth,
  requireRoles,
  requireSchoolTenant,
} from '../security';
import { calculateStudentOverallGpa, getPermittedAddActions, isPrincipalOrAdminRole } from '../../src/lib/domainRules';

export function createSchoolAdminRouter(db: DatabaseSync) {
  const router = Router();

  // Dashboard analytics strictly scoped to active school & role
  router.get('/dashboard', requireAuth, (req, res) => {
    const auth = req.auth!;
    const permittedAddActions = getPermittedAddActions(
      auth.activeRole,
      auth.accountStatus,
      auth.activeSchoolStatus
    );

    if (auth.activeRole === 'PLATFORM_SUPER_ADMIN' || auth.activeRole === 'PLATFORM_SUPPORT') {
      const stats = {
        totalSchools: (db.prepare(`SELECT COUNT(*) as c FROM schools`).get() as { c: number }).c,
        pendingSchools: (db.prepare(`SELECT COUNT(*) as c FROM schools WHERE status = 'PENDING'`).get() as { c: number }).c,
        verifiedSchools: (db.prepare(`SELECT COUNT(*) as c FROM schools WHERE status = 'APPROVED'`).get() as { c: number }).c,
        totalUsers: (db.prepare(`SELECT COUNT(*) as c FROM global_users`).get() as { c: number }).c,
        totalGlobalPosts: (db.prepare(`SELECT COUNT(*) as c FROM social_posts WHERE audience IN ('PUBLIC', 'GLOBAL_COMMUNITY')`).get() as { c: number }).c,
        openModerationCases: (db.prepare(`SELECT COUNT(*) as c FROM moderation_cases WHERE status = 'OPEN'`).get() as { c: number }).c,
        pendingAppeals: (db.prepare(`SELECT COUNT(*) as c FROM moderation_appeals WHERE status = 'PENDING'`).get() as { c: number }).c,
      };
      const pendingSchoolsList = db.prepare(`SELECT * FROM schools ORDER BY created_at DESC LIMIT 20`).all();
      return res.json({ success: true, data: { stats, pendingSchoolsList, permittedAddActions } });
    }

    const schoolId = auth.activeSchoolId;
    if (!schoolId) {
      return res.json({
        success: true,
        data: {
          stats: { linkedChildren: 0, unreadNotifications: 0 },
          recentNotices: [],
          permittedAddActions,
        },
      });
    }

    const totalStudents = (db.prepare(`SELECT COUNT(*) as c FROM students WHERE school_id = ?`).get(schoolId) as { c: number }).c;
    const totalTeachers = (
      db.prepare(`SELECT COUNT(*) as c FROM school_memberships WHERE school_id = ? AND role IN ('TEACHER', 'CLASS_TEACHER') AND status = 'ACTIVE'`).get(schoolId) as { c: number }
    ).c;
    const totalStaff = (
      db.prepare(`SELECT COUNT(*) as c FROM school_memberships WHERE school_id = ? AND (role LIKE 'STAFF_%' OR role LIKE 'TECHNICAL_%' OR role = 'EXAM_OFFICER') AND status = 'ACTIVE'`).get(schoolId) as { c: number }
    ).c;
    const totalParents = (
      db.prepare(`SELECT COUNT(*) as c FROM school_memberships WHERE school_id = ? AND role IN ('PARENT', 'LEGAL_GUARDIAN') AND status = 'ACTIVE'`).get(schoolId) as { c: number }
    ).c;
    const presentToday = (
      db.prepare(`SELECT COUNT(*) as c FROM attendance_records WHERE school_id = ? AND status = 'PRESENT'`).get(schoolId) as { c: number }
    ).c;
    const absentToday = (
      db.prepare(`SELECT COUNT(*) as c FROM attendance_records WHERE school_id = ? AND status = 'ABSENT'`).get(schoolId) as { c: number }
    ).c;
    const pendingHomework = (
      db.prepare(`SELECT COUNT(*) as c FROM homework WHERE school_id = ? AND status = 'PUBLISHED'`).get(schoolId) as { c: number }
    ).c;
    const upcomingExams = (
      db.prepare(`SELECT COUNT(*) as c FROM examinations WHERE school_id = ?`).get(schoolId) as { c: number }
    ).c;
    const collectedFees = (
      db.prepare(`SELECT COALESCE(SUM(amount - discount), 0) as s FROM fee_invoices WHERE school_id = ? AND status = 'PAID'`).get(schoolId) as { s: number }
    ).s;
    const outstandingFees = (
      db.prepare(`SELECT COALESCE(SUM(amount - discount), 0) as s FROM fee_invoices WHERE school_id = ? AND status != 'PAID'`).get(schoolId) as { s: number }
    ).s;
    const pendingAdmissions = (
      db.prepare(`SELECT COUNT(*) as c FROM admissions WHERE school_id = ? AND status = 'PENDING'`).get(schoolId) as { c: number }
    ).c;
    const unreadNotifications = (
      db.prepare(`SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0`).get(auth.userId) as { c: number }
    ).c;

    const recentNotices = db
      .prepare(`SELECT id, title, notice_type, priority, created_at FROM school_notices WHERE school_id = ? ORDER BY created_at DESC LIMIT 5`)
      .all(schoolId);

    const upcomingEvents = db
      .prepare(`SELECT id, title, category, event_date, location FROM school_events WHERE school_id = ? ORDER BY event_date ASC LIMIT 4`)
      .all(schoolId);

    const schoolInfo = db
      .prepare(`SELECT id, school_code, name, school_type, district, province, country, logo_url, cover_url, status, principal_name, telephone, official_email FROM schools WHERE id = ?`)
      .get(schoolId);

    let linkedChildren = 0;
    let scopedOutstandingFees = outstandingFees;
    let openParentRequests = 0;

    if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      const childIds = (
        db.prepare(`SELECT student_id FROM student_guardians WHERE parent_user_id = ? AND school_id = ?`).all(auth.userId, schoolId) as Array<{
          student_id: string;
        }>
      ).map((r) => r.student_id);
      linkedChildren = childIds.length;
      scopedOutstandingFees = childIds.length
        ? (
            db
              .prepare(
                `SELECT COALESCE(SUM(amount - discount), 0) as s FROM fee_invoices WHERE school_id = ? AND status != 'PAID' AND student_id IN (${childIds
                  .map(() => '?')
                  .join(',')})`
              )
              .get(schoolId, ...childIds) as { s: number }
          ).s
        : 0;
      openParentRequests = (
        db.prepare(`SELECT COUNT(*) as c FROM parent_requests WHERE school_id = ? AND parent_user_id = ? AND status = 'PENDING'`).get(schoolId, auth.userId) as {
          c: number;
        }
      ).c;
    } else if (auth.activeRole === 'STUDENT') {
      const stu = db.prepare(`SELECT id FROM students WHERE user_id = ? AND school_id = ?`).get(auth.userId, schoolId) as { id: string } | undefined;
      scopedOutstandingFees = stu
        ? (
            db
              .prepare(`SELECT COALESCE(SUM(amount - discount), 0) as s FROM fee_invoices WHERE school_id = ? AND student_id = ? AND status != 'PAID'`)
              .get(schoolId, stu.id) as { s: number }
          ).s
        : 0;
    }

    const totalExpenses = (
      db.prepare(`SELECT COALESCE(SUM(amount), 0) as s FROM school_expenses WHERE school_id = ?`).get(schoolId) as { s: number }
    ).s;
    const totalAttendanceRecords = presentToday + absentToday;
    const attendanceRate = totalAttendanceRecords > 0 ? Math.round((presentToday / totalAttendanceRecords) * 100) : 100;
    const totalFeeBilled = collectedFees + scopedOutstandingFees;
    const feeCollectionRate = totalFeeBilled > 0 ? Math.round((collectedFees / totalFeeBilled) * 100) : 100;

    return res.json({
      success: true,
      data: {
        schoolInfo,
        stats: {
          totalStudents,
          totalTeachers,
          totalStaff,
          totalParents,
          presentToday,
          absentToday,
          pendingHomework,
          upcomingExams,
          collectedFees,
          outstandingFees: scopedOutstandingFees,
          totalExpenses,
          attendanceRate,
          feeCollectionRate,
          linkedChildren,
          openParentRequests,
          pendingAdmissions,
          unreadNotifications,
        },
        recentNotices,
        upcomingEvents,
        permittedAddActions,
      },
    });
  });

  // Public School Directory
  router.get('/schools/discover', (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const district = String(req.query.district || '').trim().toLowerCase();
    const province = String(req.query.province || '').trim().toLowerCase();
    const country = String(req.query.country || '').trim().toLowerCase();
    const schoolType = String(req.query.type || '').trim().toLowerCase();

    const rows = db
      .prepare(
        `SELECT s.id, s.school_code, s.name, s.school_type, s.category, s.country, s.province, s.district, s.municipality,
                s.address, s.telephone, s.official_email, s.website, s.established_year, s.education_board, s.principal_name,
                s.logo_url, s.cover_url, s.about, s.status,
                (SELECT COUNT(*) FROM school_follows f WHERE f.school_id = s.id) as followers_count,
                (SELECT COUNT(*) FROM social_posts p WHERE p.school_id = s.id AND p.audience IN ('PUBLIC', 'GLOBAL_COMMUNITY')) as public_posts_count
         FROM schools s
         WHERE s.status = 'APPROVED'
         ORDER BY s.name ASC`
      )
      .all() as Array<Record<string, unknown>>;

    const filtered = rows.filter((r) => {
      if (q && !`${r.name} ${r.school_code} ${r.district} ${r.municipality} ${r.province}`.toLowerCase().includes(q)) return false;
      if (district && !String(r.district).toLowerCase().includes(district)) return false;
      if (province && !String(r.province).toLowerCase().includes(province)) return false;
      if (country && !String(r.country).toLowerCase().includes(country)) return false;
      if (schoolType && !String(r.school_type).toLowerCase().includes(schoolType)) return false;
      return true;
    });

    const userId = req.auth?.userId;
    const followedSet = new Set(
      userId
        ? (db.prepare(`SELECT school_id FROM school_follows WHERE user_id = ?`).all(userId) as Array<{ school_id: string }>).map(
            (x) => x.school_id
          )
        : []
    );

    return res.json({
      success: true,
      data: {
        schools: filtered.map((s) => ({ ...s, isFollowing: followedSet.has(String(s.id)) })),
      },
    });
  });

  // Public School Profile (NEVER leaks private student records!)
  router.get('/schools/:schoolId/public', (req, res) => {
    const school = db
      .prepare(
        `SELECT id, school_code, name, school_type, category, country, province, district, municipality, address, telephone, official_email, website, established_year, education_board, principal_name, logo_url, cover_url, about, status
         FROM schools WHERE id = ?`
      )
      .get(req.params.schoolId);
    if (!school) {
      return res.status(404).json({ success: false, message: 'School not found.', error: { code: 'NOT_FOUND', details: null } });
    }
    const posts = db
      .prepare(
        `SELECT p.*, u.full_name as author_name
         FROM social_posts p
         JOIN global_users u ON u.id = p.author_user_id
         WHERE p.school_id = ? AND p.audience IN ('PUBLIC', 'GLOBAL_COMMUNITY') AND p.moderation_status = 'APPROVED'
         ORDER BY p.created_at DESC LIMIT 20`
      )
      .all(req.params.schoolId);
    const events = db
      .prepare(`SELECT id, title, description, category, event_date, location FROM school_events WHERE school_id = ? AND is_public = 1 ORDER BY event_date ASC LIMIT 10`)
      .all(req.params.schoolId);
    return res.json({ success: true, data: { school, posts, events } });
  });

  router.post('/schools/:schoolId/follow', requireAuth, (req, res) => {
    const existing = db
      .prepare(`SELECT id FROM school_follows WHERE school_id = ? AND user_id = ?`)
      .get(req.params.schoolId, req.auth!.userId) as { id: string } | undefined;
    if (existing) {
      db.prepare(`DELETE FROM school_follows WHERE id = ?`).run(existing.id);
      return res.json({ success: true, data: { following: false } });
    }
    db.prepare(`INSERT INTO school_follows (id, school_id, user_id, created_at) VALUES (?, ?, ?, ?)`).run(
      crypto.randomUUID(),
      req.params.schoolId,
      req.auth!.userId,
      new Date().toISOString()
    );
    return res.json({ success: true, data: { following: true } });
  });

  // Super Admin: Approve / Reject / Suspend school
  router.post('/schools/:schoolId/verify', requireAuth, requireRoles('PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT'), (req, res) => {
    const schema = z.object({
      status: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']),
      reason: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Invalid verification decision.', error: { code: 'VALIDATION_ERROR', details: null } });
    }
    const now = new Date().toISOString();
    db.prepare(`UPDATE schools SET status = ?, rejection_reason = ?, updated_at = ? WHERE id = ?`).run(
      parsed.data.status,
      parsed.data.reason ?? null,
      now,
      req.params.schoolId
    );
    logAuditEvent(db, {
      schoolId: req.params.schoolId,
      actorUserId: req.auth!.userId,
      action: `SCHOOL_${parsed.data.status}`,
      resourceType: 'SCHOOL',
      resourceId: req.params.schoolId,
      metadata: { reason: parsed.data.reason },
    });
    return res.json({ success: true, message: `School status updated to ${parsed.data.status}.` });
  });

  // School Members & Staff Management (Principal only)
  router.get('/schools/:schoolId/members', requireAuth, requireSchoolTenant, (req, res) => {
    if (!isPrincipalOrAdminRole(req.auth!.activeRole) && req.auth!.activeRole !== 'TECHNICAL_DEPT' && req.auth!.activeRole !== 'PLATFORM_SUPER_ADMIN') {
      return res.status(403).json({ success: false, message: 'Only school leadership or Technical Dept can list members.', error: { code: 'FORBIDDEN', details: null } });
    }
    const members = db
      .prepare(
        `SELECT m.id, m.user_id, m.role, m.user_code, m.department, m.designation, m.status, m.created_at,
                u.full_name, u.email, u.phone, u.account_status
         FROM school_memberships m
         JOIN global_users u ON u.id = m.user_id
         WHERE m.school_id = ?
         ORDER BY m.role, m.user_code`
      )
      .all(req.params.schoolId);
    return res.json({ success: true, data: { members } });
  });

  router.post('/schools/:schoolId/staff', requireAuth, requireSchoolTenant, requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'PLATFORM_SUPER_ADMIN'), (req, res) => {
    const schema = z.object({
      fullName: z.string().trim().min(2),
      email: z.string().trim().email(),
      phone: z.string().trim().min(7),
      role: z.enum([
        'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER', 'EXAM_OFFICER',
        'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR', 'STAFF_ADMIN', 'STAFF_ACCOUNTANT',
        'STAFF_LIBRARIAN', 'STAFF_TRANSPORT', 'STAFF_RECEPTION', 'STAFF_SUPPORT',
      ]),
      department: z.string().trim().min(2),
      designation: z.string().trim().min(2),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Invalid staff account fields.', error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
    }
    const d = parsed.data;
    const schoolId = req.params.schoolId;
    const prefix = d.role.includes('TEACHER') ? 'TCH' : d.role.includes('TECH') ? 'TEC' : 'STF';
    const countRow = db.prepare(`SELECT COUNT(*) as c FROM school_memberships WHERE school_id = ?`).get(schoolId) as { c: number };
    const userCode = `${prefix}-${String(countRow.c + 101).padStart(3, '0')}`;
    const tempPassword = generateTemporaryPassword();
    const now = new Date().toISOString();

    let user = db.prepare(`SELECT id FROM global_users WHERE LOWER(email) = LOWER(?)`).get(d.email) as { id: string } | undefined;
    let userId = user?.id;

    db.exec('BEGIN');
    try {
      if (!userId) {
        userId = `usr-${crypto.randomUUID().slice(0, 8)}`;
        const username = `${prefix.toLowerCase()}_${Math.floor(1000 + Math.random() * 8999)}`;
        db.prepare(
          `INSERT INTO global_users (id, email, phone, full_name, username, password_hash, must_change_password, account_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 'ACTIVE', ?, ?)`
        ).run(userId, d.email, d.phone, d.fullName, username, hashPassword(tempPassword), now, now);
      }
      db.prepare(
        `INSERT INTO school_memberships (id, user_id, school_id, role, user_code, department, designation, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`
      ).run(crypto.randomUUID(), userId, schoolId, d.role, userCode, d.department, d.designation, now);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    logAuditEvent(db, {
      schoolId,
      actorUserId: req.auth!.userId,
      action: 'STAFF_ACCOUNT_CREATED',
      resourceType: 'MEMBERSHIP',
      resourceId: userCode,
      metadata: { role: d.role, department: d.department },
    });

    return res.status(201).json({
      success: true,
      message: `${d.designation} account created (${userCode}).`,
      data: { userCode, temporaryPassword: user ? undefined : tempPassword },
    });
  });

  router.patch('/schools/:schoolId/members/:membershipId', requireAuth, requireSchoolTenant, requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'PLATFORM_SUPER_ADMIN'), (req, res) => {
    const status = z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).parse(req.body?.status);
    db.prepare(`UPDATE school_memberships SET status = ? WHERE id = ? AND school_id = ?`).run(
      status,
      req.params.membershipId,
      req.params.schoolId
    );
    logAuditEvent(db, {
      schoolId: req.params.schoolId,
      actorUserId: req.auth!.userId,
      action: 'MEMBERSHIP_STATUS_UPDATED',
      resourceType: 'MEMBERSHIP',
      resourceId: req.params.membershipId,
      metadata: { status },
    });
    return res.json({ success: true, message: `Membership updated to ${status}.` });
  });

  // Student Management (strictly tenant-isolated!)
  router.get('/students', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;

    if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      const children = db
        .prepare(
          `SELECT s.*, c.name as class_name, c.section, sg.relationship, sg.guardian_type
           FROM student_guardians sg
           JOIN students s ON s.id = sg.student_id
           JOIN classes c ON c.id = s.class_id
           WHERE sg.parent_user_id = ? AND s.school_id = ?`
        )
        .all(auth.userId, schoolId);
      return res.json({ success: true, data: { students: children } });
    }

    if (auth.activeRole === 'STUDENT') {
      const own = db
        .prepare(
          `SELECT s.*, c.name as class_name, c.section
           FROM students s JOIN classes c ON c.id = s.class_id
           WHERE s.user_id = ? AND s.school_id = ?`
        )
        .all(auth.userId, schoolId);
      return res.json({ success: true, data: { students: own } });
    }

    const students = db
      .prepare(
        `SELECT s.*, c.name as class_name, c.section, u.must_change_password, u.account_status as login_status,
                (SELECT COUNT(*) FROM student_guardians sg WHERE sg.student_id = s.id) as linked_guardians
         FROM students s
         JOIN classes c ON c.id = s.class_id
         LEFT JOIN global_users u ON u.id = s.user_id
         WHERE s.school_id = ?
         ORDER BY c.name, c.section, s.roll_number`
      )
      .all(schoolId);
    return res.json({ success: true, data: { students } });
  });

  // Role-restricted Student Roster CSV Export (tenant-isolated + audit logged)
  router.get(
    '/students/export',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'TEACHER', 'CLASS_TEACHER', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR'),
    (req, res) => {
      const schoolId = req.auth!.activeSchoolId!;
      const rows = db
        .prepare(
          `SELECT s.student_code, s.admission_number, s.full_name, c.name as class_name, c.section, s.roll_number,
                  s.guardian_name, s.guardian_phone, s.enrollment_status
           FROM students s
           JOIN classes c ON c.id = s.class_id
           WHERE s.school_id = ?
           ORDER BY c.name, c.section, s.roll_number`
        )
        .all(schoolId) as Array<Record<string, unknown>>;

      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = ['Student ID', 'Admission Number', 'Full Name', 'Class', 'Section', 'Roll Number', 'Guardian Name', 'Guardian Phone', 'Status'];
      const lines = [
        header.join(','),
        ...rows.map((r) =>
          [
            r.student_code,
            r.admission_number,
            r.full_name,
            r.class_name,
            r.section,
            r.roll_number,
            r.guardian_name,
            r.guardian_phone,
            r.enrollment_status,
          ]
            .map(esc)
            .join(',')
        ),
      ];

      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: 'STUDENTS_CSV_EXPORTED',
        resourceType: 'STUDENT',
        metadata: { count: rows.length },
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="students-${req.auth!.activeSchoolCode || 'school'}.csv"`);
      return res.send(lines.join('\n'));
    }
  );

  // Student 360-Degree Profile (attendance, marks/GPA, fees, library, certificates, guardians)
  router.get('/students/:studentId/profile', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;
    const studentId = req.params.studentId;

    const student = db
      .prepare(
        `SELECT s.*, c.name as class_name, c.section, sc.name as school_name, sc.school_code, sc.district as school_district
         FROM students s
         JOIN classes c ON c.id = s.class_id
         JOIN schools sc ON sc.id = s.school_id
         WHERE s.id = ? AND s.school_id = ?`
      )
      .get(studentId, schoolId) as Record<string, unknown> | undefined;

    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found in your active school.', error: { code: 'NOT_FOUND', details: null } });
    }

    if (auth.activeRole === 'STUDENT' && String(student.user_id) !== auth.userId) {
      return res.status(403).json({ success: false, message: 'Students can only view their own 360 profile.', error: { code: 'FORBIDDEN', details: null } });
    }
    if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      const linked = db
        .prepare(`SELECT id FROM student_guardians WHERE student_id = ? AND parent_user_id = ? AND school_id = ?`)
        .get(studentId, auth.userId, schoolId);
      if (!linked) {
        return res.status(403).json({ success: false, message: 'Guardians can only view verified linked children.', error: { code: 'FORBIDDEN', details: null } });
      }
    }

    const recentAttendance = db
      .prepare(
        `SELECT ar.id, ar.status, ar.remarks, ats.session_date
         FROM attendance_records ar
         JOIN attendance_sessions ats ON ats.id = ar.session_id
         WHERE ar.student_id = ? AND ar.school_id = ?
         ORDER BY ats.session_date DESC LIMIT 20`
      )
      .all(studentId, schoolId) as Array<Record<string, unknown>>;

    const presentCount = recentAttendance.filter((a) => String(a.status) === 'PRESENT' || String(a.status) === 'LATE').length;
    const totalAttendance = recentAttendance.length;
    const attendanceSummary = {
      present: presentCount,
      absent: recentAttendance.filter((a) => String(a.status) === 'ABSENT').length,
      total: totalAttendance,
      rate: totalAttendance > 0 ? Math.round((presentCount / totalAttendance) * 100) : 100,
    };

    const examMarks = db
      .prepare(
        `SELECT m.*, e.name as exam_name, e.exam_date, e.status as exam_status
         FROM student_marks m
         JOIN examinations e ON e.id = m.exam_id
         WHERE m.student_id = ? AND m.school_id = ?
         ORDER BY e.exam_date DESC, m.subject_name ASC`
      )
      .all(studentId, schoolId) as Array<Record<string, unknown>>;

    const visibleMarks =
      auth.activeRole === 'STUDENT' || auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN'
        ? examMarks.filter((m) => String(m.exam_status) === 'PUBLISHED')
        : examMarks;

    const overallGpa = calculateStudentOverallGpa(
      visibleMarks.map((m) => ({ gpa: Number(m.gpa || 0), grade: String(m.grade || 'NG') }))
    );

    const invoices = db
      .prepare(`SELECT * FROM fee_invoices WHERE student_id = ? AND school_id = ? ORDER BY created_at DESC`)
      .all(studentId, schoolId);

    const libraryIssues = db
      .prepare(
        `SELECT bi.*, lb.title as book_title, lb.author as book_author
         FROM book_issues bi
         JOIN library_books lb ON lb.id = bi.book_id
         WHERE bi.student_id = ? AND bi.school_id = ?
         ORDER BY bi.issued_at DESC`
      )
      .all(studentId, schoolId);

    const certificates = db
      .prepare(`SELECT * FROM student_certificates WHERE student_id = ? AND school_id = ? ORDER BY issued_at DESC`)
      .all(studentId, schoolId);

    const guardians = db
      .prepare(
        `SELECT sg.relationship, sg.guardian_type, u.full_name, u.email, u.phone
         FROM student_guardians sg
         JOIN global_users u ON u.id = sg.parent_user_id
         WHERE sg.student_id = ? AND sg.school_id = ?`
      )
      .all(studentId, schoolId);

    return res.json({
      success: true,
      data: {
        student,
        attendanceSummary,
        recentAttendance,
        examMarks: visibleMarks,
        overallGpa,
        invoices,
        libraryIssues,
        certificates,
        guardians,
      },
    });
  });

  // Teacher / Tech / Principal creates student + login credentials
  router.post(
    '/students',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'TEACHER', 'CLASS_TEACHER', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR'),
    (req, res) => {
      const schema = z.object({
        fullName: z.string().trim().min(2),
        classId: z.string().min(1),
        rollNumber: z.coerce.number().int().min(1),
        admissionNumber: z.string().trim().min(2),
        joiningYear: z.coerce.number().int().default(2026),
        guardianName: z.string().trim().min(2),
        guardianPhone: z.string().trim().min(7),
        guardianEmail: z.string().trim().optional().default(''),
        address: z.string().trim().optional().default(''),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid student record fields.', error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() } });
      }
      const d = parsed.data;
      const schoolId = req.auth!.activeSchoolId!;

      // Verify class belongs to active school!
      const cls = db.prepare(`SELECT id, name, section FROM classes WHERE id = ? AND school_id = ?`).get(d.classId, schoolId) as Record<string, unknown> | undefined;
      if (!cls) {
        return res.status(403).json({ success: false, message: 'Class does not belong to your active school.', error: { code: 'FORBIDDEN', details: null } });
      }

      const dup = db
        .prepare(`SELECT id FROM students WHERE school_id = ? AND (LOWER(admission_number) = LOWER(?) OR (class_id = ? AND roll_number = ?))`)
        .get(schoolId, d.admissionNumber, d.classId, d.rollNumber);
      if (dup) {
        return res.status(409).json({
          success: false,
          message: 'Duplicate admission number or roll number already exists in this class.',
          error: { code: 'DUPLICATE_STUDENT', details: null },
        });
      }

      const now = new Date().toISOString();
      const countRow = db.prepare(`SELECT COUNT(*) as c FROM students WHERE school_id = ?`).get(schoolId) as { c: number };
      const studentCode = `STU-${String(countRow.c + 101).padStart(3, '0')}`;
      const tempPassword = generateTemporaryPassword();
      const userId = `usr-${crypto.randomUUID().slice(0, 8)}`;
      const studentId = `stu-${crypto.randomUUID().slice(0, 8)}`;
      const inviteCode = `INV-${req.auth!.activeSchoolCode?.slice(0, 3) || 'SCH'}-${Math.floor(1000 + Math.random() * 8999)}`;
      const isProvisional = req.auth!.activeRole === 'TEACHER' || req.auth!.activeRole === 'CLASS_TEACHER' ? 1 : 0;
      const email = d.guardianEmail || `${studentCode.toLowerCase()}.${schoolId.slice(-4)}@student.shikshyaplus.edu`;
      const username = `${studentCode.toLowerCase()}_${Math.floor(1000 + Math.random() * 8999)}`;

      db.exec('BEGIN');
      try {
        db.prepare(
          `INSERT INTO global_users (id, email, phone, full_name, username, password_hash, address, must_change_password, account_status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', ?, ?)`
        ).run(userId, email, d.guardianPhone, d.fullName, username, hashPassword(tempPassword), d.address, now, now);

        db.prepare(
          `INSERT INTO school_memberships (id, user_id, school_id, role, user_code, department, designation, status, created_at)
           VALUES (?, ?, ?, 'STUDENT', ?, ?, 'Student', 'ACTIVE', ?)`
        ).run(crypto.randomUUID(), userId, schoolId, studentCode, `${String(cls.name)}-${String(cls.section)}`, now);

        db.prepare(
          `INSERT INTO students (id, school_id, user_id, student_code, admission_number, full_name, class_id, roll_number, joining_year, guardian_name, guardian_phone, guardian_email, address, enrollment_status, provisional, created_by_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          studentId,
          schoolId,
          userId,
          studentCode,
          d.admissionNumber,
          d.fullName,
          d.classId,
          d.rollNumber,
          d.joiningYear,
          d.guardianName,
          d.guardianPhone,
          d.guardianEmail,
          d.address,
          isProvisional ? 'PROVISIONAL' : 'VERIFIED',
          isProvisional,
          req.auth!.userId,
          now
        );

        db.prepare(
          `INSERT INTO parent_invitations (id, school_id, student_id, invitation_code, created_by_user_id, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(crypto.randomUUID(), schoolId, studentId, inviteCode, req.auth!.userId, new Date(Date.now() + 30 * 86400000).toISOString(), now);

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: 'STUDENT_ACCOUNT_CREATED',
        resourceType: 'STUDENT',
        resourceId: studentId,
        metadata: { studentCode, provisional: Boolean(isProvisional) },
      });

      return res.status(201).json({
        success: true,
        message: `Student account ${studentCode} created with one-time login credentials.`,
        data: {
          loginCard: {
            schoolName: req.auth!.activeSchoolName,
            schoolCode: req.auth!.activeSchoolCode,
            studentId,
            studentCode,
            studentName: d.fullName,
            className: `${String(cls.name)}-${String(cls.section)}`,
            temporaryPassword: tempPassword,
            parentInvitationCode: inviteCode,
          },
        },
      });
    }
  );

  // Bulk CSV Import Preview & Confirm
  router.post(
    '/students/import/preview',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR'),
    (req, res) => {
      const csvText = String(req.body?.csvText || '').trim();
      const defaultClassId = String(req.body?.classId || '');
      if (!csvText) {
        return res.status(400).json({ success: false, message: 'CSV text is empty.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      const schoolId = req.auth!.activeSchoolId!;
      const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const rows = lines.map((line, idx) => {
        const cols = line.split(',').map((c) => c.trim());
        const [fullName, admissionNumber, rollStr, guardianName, guardianPhone] = cols;
        const rollNumber = Number(rollStr);
        const errors: string[] = [];
        if (!fullName || fullName.toLowerCase() === 'fullname') errors.push('Header or missing name');
        if (!admissionNumber) errors.push('Missing admission number');
        if (!Number.isInteger(rollNumber) || rollNumber < 1) errors.push('Invalid roll number');
        if (!guardianName) errors.push('Missing guardian name');
        if (!guardianPhone) errors.push('Missing guardian phone');

        const dup = admissionNumber
          ? db.prepare(`SELECT id FROM students WHERE school_id = ? AND LOWER(admission_number) = LOWER(?)`).get(schoolId, admissionNumber)
          : null;
        if (dup) errors.push('Duplicate admission number in school');

        return {
          rowNumber: idx + 1,
          fullName: fullName || '',
          admissionNumber: admissionNumber || '',
          rollNumber: Number.isFinite(rollNumber) ? rollNumber : 0,
          guardianName: guardianName || '',
          guardianPhone: guardianPhone || '',
          classId: defaultClassId,
          valid: errors.length === 0,
          errors,
        };
      });
      return res.json({ success: true, data: { preview: rows.filter((r) => r.fullName.toLowerCase() !== 'fullname') } });
    }
  );

  router.post(
    '/students/import/confirm',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR'),
    (req, res) => {
      const schema = z.object({
        classId: z.string().min(1),
        rows: z.array(
          z.object({
            fullName: z.string().min(2),
            admissionNumber: z.string().min(2),
            rollNumber: z.number().int().min(1),
            guardianName: z.string().min(2),
            guardianPhone: z.string().min(6),
          })
        ),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid import payload.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      const schoolId = req.auth!.activeSchoolId!;
      const cls = db.prepare(`SELECT id, name, section FROM classes WHERE id = ? AND school_id = ?`).get(parsed.data.classId, schoolId) as Record<string, unknown> | undefined;
      if (!cls) {
        return res.status(403).json({ success: false, message: 'Target class does not belong to your school.', error: { code: 'FORBIDDEN', details: null } });
      }

      const now = new Date().toISOString();
      const createdCards: Array<Record<string, unknown>> = [];
      let skipped = 0;

      db.exec('BEGIN');
      try {
        for (const r of parsed.data.rows) {
          const dup = db
            .prepare(`SELECT id FROM students WHERE school_id = ? AND (LOWER(admission_number) = LOWER(?) OR (class_id = ? AND roll_number = ?))`)
            .get(schoolId, r.admissionNumber, parsed.data.classId, r.rollNumber);
          if (dup) {
            skipped += 1;
            continue;
          }
          const countRow = db.prepare(`SELECT COUNT(*) as c FROM students WHERE school_id = ?`).get(schoolId) as { c: number };
          const studentCode = `STU-${String(countRow.c + 101).padStart(3, '0')}`;
          const tempPassword = generateTemporaryPassword();
          const userId = `usr-${crypto.randomUUID().slice(0, 8)}`;
          const studentId = `stu-${crypto.randomUUID().slice(0, 8)}`;

          db.prepare(
            `INSERT INTO global_users (id, email, phone, full_name, username, password_hash, must_change_password, account_status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, 'ACTIVE', ?, ?)`
          ).run(
            userId,
            `${studentCode.toLowerCase()}.${schoolId.slice(-4)}@student.shikshyaplus.edu`,
            r.guardianPhone,
            r.fullName,
            `${studentCode.toLowerCase()}_${Math.floor(1000 + Math.random() * 8999)}`,
            hashPassword(tempPassword),
            now,
            now
          );

          db.prepare(
            `INSERT INTO school_memberships (id, user_id, school_id, role, user_code, department, designation, status, created_at)
             VALUES (?, ?, ?, 'STUDENT', ?, ?, 'Student', 'ACTIVE', ?)`
          ).run(crypto.randomUUID(), userId, schoolId, studentCode, `${String(cls.name)}-${String(cls.section)}`, now);

          db.prepare(
            `INSERT INTO students (id, school_id, user_id, student_code, admission_number, full_name, class_id, roll_number, guardian_name, guardian_phone, enrollment_status, created_by_user_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED', ?, ?)`
          ).run(studentId, schoolId, userId, studentCode, r.admissionNumber, r.fullName, parsed.data.classId, r.rollNumber, r.guardianName, r.guardianPhone, req.auth!.userId, now);

          createdCards.push({ studentCode, studentName: r.fullName, temporaryPassword: tempPassword });
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: 'STUDENTS_BULK_IMPORTED',
        resourceType: 'STUDENT',
        metadata: { imported: createdCards.length, skipped },
      });

      return res.status(201).json({
        success: true,
        message: `Imported ${createdCards.length} students (${skipped} skipped as duplicates).`,
        data: { createdCards, skipped },
      });
    }
  );

  // Verify/Reconcile provisional student (Technical Dept / Principal)
  router.patch('/students/:studentId', requireAuth, requireSchoolTenant, requireRoles('PRINCIPAL', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR'), (req, res) => {
    const schema = z.object({
      fullName: z.string().min(2).optional(),
      enrollmentStatus: z.enum(['VERIFIED', 'PROVISIONAL', 'ARCHIVED']).optional(),
      guardianName: z.string().optional(),
      guardianPhone: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid update.', error: { code: 'VALIDATION_ERROR', details: null } });

    const existing = db.prepare(`SELECT * FROM students WHERE id = ? AND school_id = ?`).get(req.params.studentId, req.auth!.activeSchoolId!) as Record<string, unknown> | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Student not found in your school.', error: { code: 'NOT_FOUND', details: null } });
    }
    db.prepare(
      `UPDATE students SET full_name = ?, enrollment_status = ?, provisional = ?, guardian_name = ?, guardian_phone = ? WHERE id = ? AND school_id = ?`
    ).run(
      parsed.data.fullName ?? existing.full_name,
      parsed.data.enrollmentStatus ?? existing.enrollment_status,
      parsed.data.enrollmentStatus === 'VERIFIED' ? 0 : existing.provisional,
      parsed.data.guardianName ?? existing.guardian_name,
      parsed.data.guardianPhone ?? existing.guardian_phone,
      req.params.studentId,
      req.auth!.activeSchoolId!
    );
    return res.json({ success: true, message: 'Student record updated.' });
  });

  // Generate Parent Invitation Code for Student
  router.post(
    '/students/:studentId/parent-invitation',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'TEACHER', 'CLASS_TEACHER', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR'),
    (req, res) => {
      const student = db.prepare(`SELECT id, full_name FROM students WHERE id = ? AND school_id = ?`).get(req.params.studentId, req.auth!.activeSchoolId!) as Record<string, unknown> | undefined;
      if (!student) {
        return res.status(404).json({ success: false, message: 'Student not found in your school.', error: { code: 'NOT_FOUND', details: null } });
      }
      const code = `INV-${req.auth!.activeSchoolCode?.slice(0, 3) || 'SCH'}-${Math.floor(1000 + Math.random() * 8999)}`;
      db.prepare(
        `INSERT INTO parent_invitations (id, school_id, student_id, invitation_code, created_by_user_id, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), req.auth!.activeSchoolId!, req.params.studentId, code, req.auth!.userId, new Date(Date.now() + 30 * 86400000).toISOString(), new Date().toISOString());

      return res.status(201).json({
        success: true,
        message: `One-time parent invitation code generated for ${String(student.full_name)}.`,
        data: { invitationCode: code },
      });
    }
  );

  // Parent Child Linking & Children View
  router.get('/parents/children', requireAuth, (req, res) => {
    const children = db
      .prepare(
        `SELECT s.*, sc.name as school_name, sc.school_code, c.name as class_name, c.section, sg.relationship, sg.guardian_type
         FROM student_guardians sg
         JOIN students s ON s.id = sg.student_id
         JOIN schools sc ON sc.id = s.school_id
         JOIN classes c ON c.id = s.class_id
         WHERE sg.parent_user_id = ?`
      )
      .all(req.auth!.userId);
    return res.json({ success: true, data: { children } });
  });

  router.post('/parents/link-child', requireAuth, (req, res) => {
    const schema = z.object({
      invitationCode: z.string().trim().min(4),
      relationship: z.string().trim().min(2).default('Parent'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Valid invitation code is required.', error: { code: 'VALIDATION_ERROR', details: null } });
    }
    const invite = db
      .prepare(`SELECT * FROM parent_invitations WHERE UPPER(invitation_code) = UPPER(?) AND used_at IS NULL`)
      .get(parsed.data.invitationCode) as Record<string, unknown> | undefined;
    if (!invite || new Date(String(invite.expires_at)).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'Invitation code is invalid or expired. Guardianship requires an official school invitation code.',
        error: { code: 'INVALID_INVITATION', details: null },
      });
    }
    const now = new Date().toISOString();
    const schoolId = String(invite.school_id);
    const studentId = String(invite.student_id);

    db.exec('BEGIN');
    try {
      const hasMem = db
        .prepare(`SELECT id FROM school_memberships WHERE user_id = ? AND school_id = ? AND role = 'PARENT'`)
        .get(req.auth!.userId, schoolId);
      if (!hasMem) {
        db.prepare(
          `INSERT INTO school_memberships (id, user_id, school_id, role, user_code, department, designation, status, created_at)
           VALUES (?, ?, ?, 'PARENT', ?, 'Guardians', 'Verified Parent', 'ACTIVE', ?)`
        ).run(crypto.randomUUID(), req.auth!.userId, schoolId, `PAR-${Math.floor(100 + Math.random() * 899)}`, now);
      }

      db.prepare(
        `INSERT OR IGNORE INTO student_guardians (id, school_id, student_id, parent_user_id, relationship, guardian_type, verified_at)
         VALUES (?, ?, ?, ?, ?, 'PRIMARY', ?)`
      ).run(crypto.randomUUID(), schoolId, studentId, req.auth!.userId, parsed.data.relationship, now);

      db.prepare(`UPDATE parent_invitations SET used_by_user_id = ?, used_at = ? WHERE id = ?`).run(
        req.auth!.userId,
        now,
        String(invite.id)
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    logAuditEvent(db, {
      schoolId,
      actorUserId: req.auth!.userId,
      action: 'PARENT_CHILD_LINKED',
      resourceType: 'STUDENT_GUARDIAN',
      resourceId: studentId,
    });

    return res.json({ success: true, message: 'Verified child linked to your guardian profile!' });
  });

  router.get('/parents/requests', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const rows =
      auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN'
        ? db
            .prepare(
              `SELECT r.*, s.full_name as student_name FROM parent_requests r
               JOIN students s ON s.id = r.student_id
               WHERE r.school_id = ? AND r.parent_user_id = ? ORDER BY r.created_at DESC`
            )
            .all(auth.activeSchoolId!, auth.userId)
        : db
            .prepare(
              `SELECT r.*, s.full_name as student_name, u.full_name as parent_name FROM parent_requests r
               JOIN students s ON s.id = r.student_id
               JOIN global_users u ON u.id = r.parent_user_id
               WHERE r.school_id = ? ORDER BY r.created_at DESC`
            )
            .all(auth.activeSchoolId!);
    return res.json({ success: true, data: { requests: rows } });
  });

  router.post('/parents/requests', requireAuth, requireSchoolTenant, (req, res) => {
    const schema = z.object({
      studentId: z.string().min(1),
      requestType: z.enum(['LEAVE', 'MEETING', 'CORRECTION']),
      subject: z.string().trim().min(3),
      details: z.string().trim().min(5),
      requestedDate: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid request fields.', error: { code: 'VALIDATION_ERROR', details: null } });

    // Verify parent actually owns guardianship of studentId
    const guardian = db
      .prepare(`SELECT id FROM student_guardians WHERE school_id = ? AND student_id = ? AND parent_user_id = ?`)
      .get(req.auth!.activeSchoolId!, parsed.data.studentId, req.auth!.userId);
    if (!guardian) {
      return res.status(403).json({ success: false, message: 'You can only submit requests for your verified children.', error: { code: 'FORBIDDEN', details: null } });
    }
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO parent_requests (id, school_id, parent_user_id, student_id, request_type, subject, details, requested_date, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`
    ).run(id, req.auth!.activeSchoolId!, req.auth!.userId, parsed.data.studentId, parsed.data.requestType, parsed.data.subject, parsed.data.details, parsed.data.requestedDate ?? null, new Date().toISOString());

    return res.status(201).json({ success: true, message: 'Request submitted to school administration.' });
  });

  router.patch(
    '/parents/requests/:id',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'TEACHER', 'CLASS_TEACHER'),
    (req, res) => {
      const status = z.enum(['APPROVED', 'DECLINED']).parse(req.body?.status);
      const existing = db
        .prepare(`SELECT id FROM parent_requests WHERE id = ? AND school_id = ?`)
        .get(req.params.id, req.auth!.activeSchoolId!);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Parent request not found.', error: { code: 'NOT_FOUND', details: null } });
      }
      db.prepare(`UPDATE parent_requests SET status = ? WHERE id = ? AND school_id = ?`).run(
        status,
        req.params.id,
        req.auth!.activeSchoolId!
      );
      logAuditEvent(db, {
        schoolId: req.auth!.activeSchoolId!,
        actorUserId: req.auth!.userId,
        action: `PARENT_REQUEST_${status}`,
        resourceType: 'PARENT_REQUEST',
        resourceId: req.params.id,
      });
      return res.json({ success: true, message: `Parent request marked ${status.toLowerCase()}.` });
    }
  );

  return router;
}
