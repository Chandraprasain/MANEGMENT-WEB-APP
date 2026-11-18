import crypto from 'node:crypto';
import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  hashPassword,
  logAuditEvent,
  rateLimit,
  requireAuth,
  resolveSessionFromToken,
  SESSION_COOKIE_NAME,
  signToken,
  verifyPassword,
} from '../security';
import { isValidNepalOrIntlPhone } from '../../src/lib/domainRules';

const loginSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('SCHOOL_ID'),
    schoolCode: z.string().trim().min(3),
    userCode: z.string().trim().min(3),
    password: z.string().min(4),
  }),
  z.object({
    mode: z.literal('GLOBAL'),
    email: z.string().trim().email(),
    password: z.string().min(4),
  }),
]);

const registerSchoolSchema = z.object({
  schoolName: z.string().trim().min(3),
  schoolType: z.string().trim().min(2),
  category: z.string().trim().min(2),
  country: z.string().trim().default('Nepal'),
  province: z.string().trim().min(2),
  district: z.string().trim().min(2),
  municipality: z.string().trim().min(2),
  ward: z.string().trim().default('1'),
  address: z.string().trim().min(3),
  telephone: z.string().trim().min(6),
  officialEmail: z.string().trim().email(),
  website: z.string().trim().optional().default(''),
  establishedYear: z.coerce.number().int().min(1900).max(2027),
  registrationNumber: z.string().trim().min(3),
  educationBoard: z.string().trim().min(2),
  principalName: z.string().trim().min(2),
  principalEmail: z.string().trim().email(),
  principalPhone: z.string().trim().min(7),
  password: z.string().min(8),
});

const registerParentSchema = z.object({
  fullName: z.string().trim().min(2),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7),
  address: z.string().trim().min(2),
  relationship: z.string().trim().min(2),
  password: z.string().min(8),
  invitationCode: z.string().trim().optional(),
});

const registerStudentSchema = z.object({
  fullName: z.string().trim().min(2),
  schoolCode: z.string().trim().min(3),
  admissionNumber: z.string().trim().min(3),
  className: z.string().trim().min(2),
  section: z.string().trim().min(1),
  guardianPhone: z.string().trim().min(7),
  email: z.string().trim().email().optional().or(z.literal('')),
  password: z.string().min(8),
});

function createCookieSession(
  db: DatabaseSync,
  res: import('express').Response,
  req: import('express').Request,
  userId: string,
  activeMembershipId: string | null
) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const deviceLabel = String(req.headers['user-agent'] || 'Web Browser').slice(0, 120);
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';

  db.prepare(
    `INSERT INTO user_sessions (id, user_id, active_membership_id, device_label, ip_address, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(sessionId, userId, activeMembershipId, deviceLabel, ip, expiresAt, new Date().toISOString());

  const signed = signToken(sessionId);
  res.cookie(SESSION_COOKIE_NAME, signed, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
  return signed;
}

export function createAuthRouter(db: DatabaseSync) {
  const router = Router();

  router.post('/login', rateLimit('auth-login', 40, 60_000), (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid login credentials format.',
        error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      });
    }

    let user: Record<string, unknown> | undefined;
    let membershipId: string | null = null;
    let schoolId: string | null = null;

    if (parsed.data.mode === 'SCHOOL_ID') {
      const row = db
        .prepare(
          `SELECT u.*, m.id as membership_id, m.school_id, m.status as membership_status, sc.status as school_status
           FROM school_memberships m
           JOIN schools sc ON sc.id = m.school_id
           JOIN global_users u ON u.id = m.user_id
           WHERE UPPER(sc.school_code) = UPPER(?) AND UPPER(m.user_code) = UPPER(?)`
        )
        .get(parsed.data.schoolCode, parsed.data.userCode) as Record<string, unknown> | undefined;

      if (!row) {
        logAuditEvent(db, {
          action: 'LOGIN_FAILED',
          resourceType: 'AUTH',
          metadata: { mode: 'SCHOOL_ID', schoolCode: parsed.data.schoolCode, userCode: parsed.data.userCode },
        });
        return res.status(401).json({
          success: false,
          message: 'Invalid School ID, User ID, or password.',
          error: { code: 'INVALID_CREDENTIALS', details: null },
        });
      }
      user = row;
      membershipId = String(row.membership_id);
      schoolId = String(row.school_id);
    } else {
      const row = db
        .prepare(`SELECT * FROM global_users WHERE LOWER(email) = LOWER(?)`)
        .get(parsed.data.email) as Record<string, unknown> | undefined;

      if (!row) {
        logAuditEvent(db, {
          action: 'LOGIN_FAILED',
          resourceType: 'AUTH',
          metadata: { mode: 'GLOBAL', email: parsed.data.email },
        });
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password.',
          error: { code: 'INVALID_CREDENTIALS', details: null },
        });
      }
      user = row;
      const firstMem = db
        .prepare(`SELECT id, school_id FROM school_memberships WHERE user_id = ? AND status = 'ACTIVE' LIMIT 1`)
        .get(String(row.id)) as Record<string, unknown> | undefined;
      if (firstMem) {
        membershipId = String(firstMem.id);
        schoolId = String(firstMem.school_id);
      }
    }

    if (!verifyPassword(parsed.data.password, String(user.password_hash))) {
      logAuditEvent(db, {
        schoolId,
        actorUserId: String(user.id),
        action: 'LOGIN_FAILED_BAD_PASSWORD',
        resourceType: 'AUTH',
      });
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials. Please verify your password.',
        error: { code: 'INVALID_CREDENTIALS', details: null },
      });
    }

    const status = String(user.account_status);
    if (status === 'BANNED' || status === 'SUSPENDED' || status === 'DEACTIVATED') {
      return res.status(403).json({
        success: false,
        message: `Account access is ${status.toLowerCase()}. Please contact your school or submit an appeal.`,
        error: { code: 'ACCOUNT_RESTRICTED', details: { status } },
      });
    }

    const signed = createCookieSession(db, res, req, String(user.id), membershipId);
    const context = resolveSessionFromToken(db, signed);

    logAuditEvent(db, {
      schoolId,
      actorUserId: String(user.id),
      action: 'LOGIN_SUCCESS',
      resourceType: 'AUTH',
      metadata: { mode: parsed.data.mode },
    });

    return res.json({
      success: true,
      message: 'Signed in successfully.',
      data: { user: context },
    });
  });

  router.get('/me', (req, res) => {
    if (!req.auth) {
      return res.json({ success: true, data: { user: null } });
    }
    const profile = db
      .prepare(
        `SELECT bio, address, phone, cover_url, privacy_profile_visibility, privacy_message_policy, preferred_language, preferred_calendar
         FROM global_users WHERE id = ?`
      )
      .get(req.auth.userId);
    return res.json({
      success: true,
      data: {
        user: req.auth,
        profile,
      },
    });
  });

  router.post('/logout', (req, res) => {
    if (req.auth) {
      db.prepare(`UPDATE user_sessions SET revoked_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        req.auth.sessionId
      );
      logAuditEvent(db, {
        schoolId: req.auth.activeSchoolId,
        actorUserId: req.auth.userId,
        action: 'LOGOUT',
        resourceType: 'AUTH',
      });
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return res.json({ success: true, message: 'Signed out.' });
  });

  router.post('/switch-membership', requireAuth, (req, res) => {
    const membershipId = String(req.body?.membershipId || '');
    const match = req.auth!.memberships.find((m) => m.membershipId === membershipId);
    if (!match) {
      return res.status(403).json({
        success: false,
        message: 'Cannot switch to an unverified or unauthorized school membership.',
        error: { code: 'FORBIDDEN', details: null },
      });
    }
    db.prepare(`UPDATE user_sessions SET active_membership_id = ? WHERE id = ?`).run(
      match.membershipId,
      req.auth!.sessionId
    );
    const updated = resolveSessionFromToken(db, req.cookies?.[SESSION_COOKIE_NAME]);
    logAuditEvent(db, {
      schoolId: match.schoolId,
      actorUserId: req.auth!.userId,
      action: 'SWITCH_SCHOOL_MEMBERSHIP',
      resourceType: 'AUTH',
      metadata: { membershipId: match.membershipId, role: match.role },
    });
    return res.json({ success: true, message: `Switched to ${match.schoolName}`, data: { user: updated } });
  });

  router.post('/register-school', rateLimit('auth-reg', 10, 60_000), (req, res) => {
    const parsed = registerSchoolSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Please complete all required school registration fields accurately.',
        error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      });
    }
    const d = parsed.data;
    if (!isValidNepalOrIntlPhone(d.principalPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid Nepal (+97798...) or international phone number.',
        error: { code: 'INVALID_PHONE', details: null },
      });
    }
    const dupReg = db
      .prepare(`SELECT id FROM schools WHERE LOWER(registration_number) = LOWER(?)`)
      .get(d.registrationNumber);
    if (dupReg) {
      return res.status(409).json({
        success: false,
        message: 'A school with this government registration number is already registered.',
        error: { code: 'DUPLICATE_REGISTRATION', details: null },
      });
    }
    const dupEmail = db.prepare(`SELECT id FROM global_users WHERE LOWER(email) = LOWER(?)`).get(d.principalEmail);
    if (dupEmail) {
      return res.status(409).json({
        success: false,
        message: 'Principal email is already associated with an account. Sign in to manage memberships.',
        error: { code: 'DUPLICATE_EMAIL', details: null },
      });
    }

    const now = new Date().toISOString();
    const schoolId = `sch-${crypto.randomUUID().slice(0, 8)}`;
    const codePrefix = d.schoolName.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 7) || 'SCHOOL';
    const schoolCode = `${codePrefix}-${new Date().getFullYear()}-${Math.floor(10 + Math.random() * 89)}`;
    const userId = `usr-${crypto.randomUUID().slice(0, 8)}`;
    const memId = `mem-${crypto.randomUUID().slice(0, 8)}`;
    const username = `${codePrefix.toLowerCase()}_pri_${Math.floor(100 + Math.random() * 899)}`;

    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT INTO schools (id, school_code, name, school_type, category, country, province, district, municipality, ward, address, telephone, official_email, website, established_year, registration_number, education_board, principal_name, principal_email, principal_phone, logo_url, cover_url, about, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`
      ).run(
        schoolId,
        schoolCode,
        d.schoolName,
        d.schoolType,
        d.category,
        d.country,
        d.province,
        d.district,
        d.municipality,
        d.ward,
        d.address,
        d.telephone,
        d.officialEmail,
        d.website,
        d.establishedYear,
        d.registrationNumber,
        d.educationBoard,
        d.principalName,
        d.principalEmail,
        d.principalPhone,
        '/src/assets/images/school_logo_sunrise_1794923107163.jpg',
        '/src/assets/images/school_hero_campus_1794923107830.jpg',
        `${d.schoolName} — ${d.schoolType} registered for verification.`,
        now,
        now
      );

      db.prepare(
        `INSERT INTO global_users (id, email, phone, full_name, username, password_hash, account_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
      ).run(userId, d.principalEmail, d.principalPhone, d.principalName, username, hashPassword(d.password), now, now);

      db.prepare(
        `INSERT INTO school_memberships (id, user_id, school_id, role, user_code, department, designation, status, created_at)
         VALUES (?, ?, ?, 'PRINCIPAL', 'PRI-001', 'Administration', 'Principal', 'ACTIVE', ?)`
      ).run(memId, userId, schoolId, now);

      db.prepare(
        `INSERT INTO notifications (id, user_id, category, title, body, created_at)
         SELECT ?, id, 'VERIFICATION', 'New School Registration Pending', ?, ?
         FROM global_users WHERE global_role = 'PLATFORM_SUPER_ADMIN'`
      ).run(crypto.randomUUID(), `${d.schoolName} (${schoolCode}) submitted registration documents for review.`, now);

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    logAuditEvent(db, {
      schoolId,
      actorUserId: userId,
      action: 'SCHOOL_REGISTERED',
      resourceType: 'SCHOOL',
      resourceId: schoolId,
      metadata: { schoolCode, status: 'PENDING' },
    });

    const signed = createCookieSession(db, res, req, userId, memId);
    const context = resolveSessionFromToken(db, signed);

    return res.status(201).json({
      success: true,
      message: `School submitted for verification! Generated School ID: ${schoolCode} · Principal ID: PRI-001`,
      data: { schoolCode, userCode: 'PRI-001', user: context },
    });
  });

  router.post('/register-parent', rateLimit('auth-reg', 15, 60_000), (req, res) => {
    const parsed = registerParentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid parent registration fields.',
        error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      });
    }
    const d = parsed.data;
    if (!isValidNepalOrIntlPhone(d.phone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format.',
        error: { code: 'INVALID_PHONE', details: null },
      });
    }
    const existing = db.prepare(`SELECT id FROM global_users WHERE LOWER(email) = LOWER(?)`).get(d.email);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists.',
        error: { code: 'DUPLICATE_EMAIL', details: null },
      });
    }

    let invite: Record<string, unknown> | undefined;
    if (d.invitationCode && d.invitationCode.trim()) {
      invite = db
        .prepare(
          `SELECT * FROM parent_invitations WHERE UPPER(invitation_code) = UPPER(?) AND used_at IS NULL`
        )
        .get(d.invitationCode.trim()) as Record<string, unknown> | undefined;
      if (!invite || new Date(String(invite.expires_at)).getTime() < Date.now()) {
        return res.status(400).json({
          success: false,
          message: 'Parent invitation code is invalid or expired. Ask your child’s school for a valid code.',
          error: { code: 'INVALID_INVITATION', details: null },
        });
      }
    }

    const now = new Date().toISOString();
    const userId = `usr-${crypto.randomUUID().slice(0, 8)}`;
    const username = `par_${d.fullName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10)}_${Math.floor(100 + Math.random() * 899)}`;
    let memId: string | null = null;

    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT INTO global_users (id, email, phone, full_name, username, password_hash, address, account_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
      ).run(userId, d.email, d.phone, d.fullName, username, hashPassword(d.password), d.address, now, now);

      if (invite) {
        memId = `mem-${crypto.randomUUID().slice(0, 8)}`;
        const parCode = `PAR-${Math.floor(100 + Math.random() * 899)}`;
        db.prepare(
          `INSERT INTO school_memberships (id, user_id, school_id, role, user_code, department, designation, status, created_at)
           VALUES (?, ?, ?, 'PARENT', ?, 'Guardians', 'Verified Parent', 'ACTIVE', ?)`
        ).run(memId, userId, String(invite.school_id), parCode, now);

        db.prepare(
          `INSERT INTO student_guardians (id, school_id, student_id, parent_user_id, relationship, guardian_type, verified_at)
           VALUES (?, ?, ?, ?, ?, 'PRIMARY', ?)`
        ).run(crypto.randomUUID(), String(invite.school_id), String(invite.student_id), userId, d.relationship, now);

        db.prepare(`UPDATE parent_invitations SET used_by_user_id = ?, used_at = ? WHERE id = ?`).run(
          userId,
          now,
          String(invite.id)
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const signed = createCookieSession(db, res, req, userId, memId);
    const context = resolveSessionFromToken(db, signed);
    return res.status(201).json({
      success: true,
      message: invite
        ? 'Parent account created and verified child linked successfully!'
        : 'Parent account created. Enter a school invitation code inside your dashboard to link your child.',
      data: { user: context },
    });
  });

  router.post('/register-student', rateLimit('auth-reg', 15, 60_000), (req, res) => {
    const parsed = registerStudentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid student registration details.',
        error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      });
    }
    const d = parsed.data;
    const school = db
      .prepare(`SELECT id, name, status FROM schools WHERE UPPER(school_code) = UPPER(?)`)
      .get(d.schoolCode) as Record<string, unknown> | undefined;

    if (!school || String(school.status) !== 'APPROVED') {
      return res.status(404).json({
        success: false,
        message: 'School ID not found or school is not yet approved.',
        error: { code: 'SCHOOL_NOT_FOUND', details: null },
      });
    }

    const cls = db
      .prepare(`SELECT id FROM classes WHERE school_id = ? AND LOWER(name) = LOWER(?) AND LOWER(section) = LOWER(?) LIMIT 1`)
      .get(String(school.id), d.className, d.section) as Record<string, unknown> | undefined;

    const classId = cls
      ? String(cls.id)
      : (() => {
          const fallback = db.prepare(`SELECT id FROM classes WHERE school_id = ? LIMIT 1`).get(String(school.id)) as Record<string, unknown> | undefined;
          return fallback ? String(fallback.id) : '';
        })();

    if (!classId) {
      return res.status(400).json({
        success: false,
        message: 'Selected school has no configured classes yet. Contact school administration.',
        error: { code: 'CLASS_NOT_FOUND', details: null },
      });
    }

    const dupAdm = db
      .prepare(`SELECT id FROM students WHERE school_id = ? AND LOWER(admission_number) = LOWER(?)`)
      .get(String(school.id), d.admissionNumber);
    if (dupAdm) {
      return res.status(409).json({
        success: false,
        message: 'Admission number already exists in this school. Request your login credentials from your teacher.',
        error: { code: 'DUPLICATE_ADMISSION', details: null },
      });
    }

    const now = new Date().toISOString();
    const userId = `usr-${crypto.randomUUID().slice(0, 8)}`;
    const memId = `mem-${crypto.randomUUID().slice(0, 8)}`;
    const studentId = `stu-${crypto.randomUUID().slice(0, 8)}`;
    const countRow = db.prepare(`SELECT COUNT(*) as c FROM students WHERE school_id = ?`).get(String(school.id)) as { c: number };
    const studentCode = `STU-${String(countRow.c + 101).padStart(3, '0')}`;
    const rollRow = db.prepare(`SELECT COALESCE(MAX(roll_number), 0) as m FROM students WHERE school_id = ? AND class_id = ?`).get(String(school.id), classId) as { m: number };
    const email = d.email || `${studentCode.toLowerCase()}@${String(d.schoolCode).toLowerCase()}.student.edu`;
    const username = `${studentCode.toLowerCase()}_${Math.floor(100 + Math.random() * 899)}`;

    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT INTO global_users (id, email, phone, full_name, username, password_hash, account_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
      ).run(userId, email, d.guardianPhone, d.fullName, username, hashPassword(d.password), now, now);

      db.prepare(
        `INSERT INTO school_memberships (id, user_id, school_id, role, user_code, department, designation, status, created_at)
         VALUES (?, ?, ?, 'STUDENT', ?, ?, 'Student (Pending Technical Verification)', 'ACTIVE', ?)`
      ).run(memId, userId, String(school.id), studentCode, `${d.className}-${d.section}`, now);

      db.prepare(
        `INSERT INTO students (id, school_id, user_id, student_code, admission_number, full_name, class_id, roll_number, guardian_name, guardian_phone, enrollment_status, provisional, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Guardian Verification Pending', ?, 'PROVISIONAL', 1, ?, ?)`
      ).run(studentId, String(school.id), userId, studentCode, d.admissionNumber, d.fullName, classId, rollRow.m + 1, d.guardianPhone, userId, now);

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const signed = createCookieSession(db, res, req, userId, memId);
    const context = resolveSessionFromToken(db, signed);
    return res.status(201).json({
      success: true,
      message: `Student account created! Your Student ID is ${studentCode} at ${String(school.name)}.`,
      data: { studentCode, user: context },
    });
  });

  router.post('/change-password', requireAuth, (req, res) => {
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters.',
        error: { code: 'VALIDATION_ERROR', details: parsed.error.flatten() },
      });
    }
    const user = db.prepare(`SELECT password_hash FROM global_users WHERE id = ?`).get(req.auth!.userId) as { password_hash: string } | undefined;
    if (!user || !verifyPassword(parsed.data.currentPassword, user.password_hash)) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect.',
        error: { code: 'INVALID_PASSWORD', details: null },
      });
    }
    db.prepare(`UPDATE global_users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`).run(
      hashPassword(parsed.data.newPassword),
      new Date().toISOString(),
      req.auth!.userId
    );
    logAuditEvent(db, {
      schoolId: req.auth!.activeSchoolId,
      actorUserId: req.auth!.userId,
      action: 'PASSWORD_CHANGED',
      resourceType: 'USER',
      resourceId: req.auth!.userId,
    });
    const updated = resolveSessionFromToken(db, req.cookies?.[SESSION_COOKIE_NAME]);
    return res.json({ success: true, message: 'Password updated securely.', data: { user: updated } });
  });

  router.post('/forgot-password', rateLimit('auth-reset', 10, 60_000), (req, res) => {
    const email = String(req.body?.email || '').trim();
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.', error: { code: 'VALIDATION_ERROR', details: null } });
    }
    const user = db.prepare(`SELECT id FROM global_users WHERE LOWER(email) = LOWER(?)`).get(email) as { id: string } | undefined;
    if (!user) {
      return res.json({
        success: true,
        message: 'If an account matches that email, a password reset code has been generated.',
        data: { deliveryConfigured: Boolean(process.env.EMAIL_PROVIDER_API_KEY) },
      });
    }
    const tokenCode = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO password_reset_tokens (id, user_id, token_code, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), user.id, tokenCode, expiresAt, new Date().toISOString());

    const emailConfigured = Boolean(process.env.EMAIL_PROVIDER_API_KEY);
    return res.json({
      success: true,
      message: emailConfigured
        ? 'Password reset code sent to your email.'
        : 'Reset code generated (email provider key not configured; enter your code below to verify in this environment).',
      data: {
        deliveryConfigured: emailConfigured,
        devResetCodePreview: emailConfigured ? undefined : tokenCode,
      },
    });
  });

  router.post('/reset-password', (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      tokenCode: z.string().min(6),
      newPassword: z.string().min(8),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Invalid reset request.', error: { code: 'VALIDATION_ERROR', details: null } });
    }
    const row = db
      .prepare(
        `SELECT t.id, t.user_id, t.expires_at, t.used_at
         FROM password_reset_tokens t
         JOIN global_users u ON u.id = t.user_id
         WHERE LOWER(u.email) = LOWER(?) AND t.token_code = ?
         ORDER BY t.created_at DESC LIMIT 1`
      )
      .get(parsed.data.email, parsed.data.tokenCode) as Record<string, unknown> | undefined;

    if (!row || row.used_at || new Date(String(row.expires_at)).getTime() < Date.now()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired password reset code.',
        error: { code: 'INVALID_RESET_TOKEN', details: null },
      });
    }
    const now = new Date().toISOString();
    db.prepare(`UPDATE global_users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`).run(
      hashPassword(parsed.data.newPassword),
      now,
      String(row.user_id)
    );
    db.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`).run(now, String(row.id));
    return res.json({ success: true, message: 'Password reset complete. You can now sign in.' });
  });

  router.get('/sessions', requireAuth, (req, res) => {
    const rows = db
      .prepare(
        `SELECT id, device_label, ip_address, expires_at, revoked_at, created_at
         FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`
      )
      .all(req.auth!.userId);
    return res.json({ success: true, data: { sessions: rows, currentSessionId: req.auth!.sessionId } });
  });

  router.delete('/sessions/:sessionId', requireAuth, (req, res) => {
    db.prepare(`UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND user_id = ?`).run(
      new Date().toISOString(),
      req.params.sessionId,
      req.auth!.userId
    );
    return res.json({ success: true, message: 'Session revoked.' });
  });

  router.post('/logout-all', requireAuth, (req, res) => {
    db.prepare(`UPDATE user_sessions SET revoked_at = ? WHERE user_id = ?`).run(
      new Date().toISOString(),
      req.auth!.userId
    );
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return res.json({ success: true, message: 'Signed out from all devices.' });
  });

  router.patch('/profile', requireAuth, (req, res) => {
    const schema = z.object({
      fullName: z.string().trim().min(2).optional(),
      bio: z.string().trim().max(400).optional(),
      address: z.string().trim().max(200).optional(),
      phone: z.string().trim().max(30).optional(),
      privacyProfileVisibility: z.enum(['PUBLIC', 'SCHOOL_ONLY', 'PRIVATE']).optional(),
      privacyMessagePolicy: z.enum(['SCHOOL_ONLY', 'CONNECTIONS', 'RESTRICTED']).optional(),
      preferredLanguage: z.enum(['en', 'ne']).optional(),
      preferredCalendar: z.enum(['AD', 'BS']).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Invalid profile settings.', error: { code: 'VALIDATION_ERROR', details: null } });
    }
    const d = parsed.data;
    const current = db.prepare(`SELECT * FROM global_users WHERE id = ?`).get(req.auth!.userId) as Record<string, unknown>;
    db.prepare(
      `UPDATE global_users
       SET full_name = ?, bio = ?, address = ?, phone = ?, privacy_profile_visibility = ?, privacy_message_policy = ?, preferred_language = ?, preferred_calendar = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      d.fullName ?? current.full_name,
      d.bio ?? current.bio,
      d.address ?? current.address,
      d.phone ?? current.phone,
      d.privacyProfileVisibility ?? current.privacy_profile_visibility,
      d.privacyMessagePolicy ?? current.privacy_message_policy,
      d.preferredLanguage ?? current.preferred_language,
      d.preferredCalendar ?? current.preferred_calendar,
      new Date().toISOString(),
      req.auth!.userId
    );
    const updated = resolveSessionFromToken(db, req.cookies?.[SESSION_COOKIE_NAME]);
    return res.json({ success: true, message: 'Profile & privacy settings updated.', data: { user: updated } });
  });

  router.get('/export-data', requireAuth, (req, res) => {
    const user = db
      .prepare(`SELECT id, email, phone, full_name, username, bio, address, account_status, created_at FROM global_users WHERE id = ?`)
      .get(req.auth!.userId);
    const memberships = req.auth!.memberships;
    const posts = db.prepare(`SELECT id, content, post_type, audience, created_at FROM social_posts WHERE author_user_id = ?`).all(req.auth!.userId);
    logAuditEvent(db, {
      schoolId: req.auth!.activeSchoolId,
      actorUserId: req.auth!.userId,
      action: 'PERSONAL_DATA_EXPORTED',
      resourceType: 'USER',
      resourceId: req.auth!.userId,
    });
    return res.json({
      success: true,
      data: { exportedAt: new Date().toISOString(), user, memberships, posts },
    });
  });

  return router;
}
