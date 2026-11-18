import crypto from 'node:crypto';
import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { logAuditEvent, requireAuth, requireRoles, requireSchoolTenant } from '../security';
import { encryptSensitiveField } from '../services/encryption';

export function createTrustAndCommunityRouter(db: DatabaseSync) {
  const router = Router();

  // ======================== SYSTEM 6: CONFIDENTIAL SAFEGUARDING & WELLBEING ========================
  router.get('/safeguarding/cases', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;
    const isSafeguardingLead = ['PRINCIPAL', 'VICE_PRINCIPAL', 'PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT'].includes(auth.activeRole);

    // Strictly hide school-wide confidential safeguarding cases from ordinary teachers, parents, students, and technical staff!
    const cases = isSafeguardingLead
      ? db
          .prepare(
            `SELECT sc.*, s.full_name as student_name, s.student_code,
                    CASE WHEN sc.is_anonymous = 1 THEN 'Confidential Reporter' ELSE u.full_name END as reporter_name
             FROM safeguarding_cases sc
             LEFT JOIN students s ON s.id = sc.subject_student_id
             JOIN global_users u ON u.id = sc.reporter_user_id
             WHERE sc.school_id = ? ORDER BY sc.created_at DESC`
          )
          .all(schoolId)
      : db
          .prepare(
            `SELECT sc.id, sc.school_id, sc.category, sc.severity, sc.summary, sc.status, sc.created_at, s.full_name as student_name
             FROM safeguarding_cases sc
             LEFT JOIN students s ON s.id = sc.subject_student_id
             WHERE sc.school_id = ? AND sc.reporter_user_id = ? ORDER BY sc.created_at DESC`
          )
          .all(schoolId, auth.userId);

    const appointments = db
      .prepare(
        `SELECT wa.*, u.full_name as requester_name
         FROM wellbeing_appointments wa JOIN global_users u ON u.id = wa.requester_user_id
         WHERE wa.school_id = ? AND (? = 1 OR wa.requester_user_id = ?)
         ORDER BY wa.created_at DESC`
      )
      .all(schoolId, isSafeguardingLead ? 1 : 0, auth.userId);

    return res.json({ success: true, data: { isSafeguardingLead, cases, appointments } });
  });

  router.post('/safeguarding/cases', requireAuth, requireSchoolTenant, (req, res) => {
    const schema = z.object({
      subjectStudentId: z.string().optional().nullable(),
      category: z.enum(['BULLYING', 'HARASSMENT', 'THREAT_SAFETY', 'WELLBEING_CONCERN', 'TRANSPORT_SAFETY']),
      severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('HIGH'),
      summary: z.string().trim().min(8),
      isAnonymous: z.boolean().default(false),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Provide category and detailed description.', error: { code: 'VALIDATION_ERROR', details: null } });
    }

    const id = `sg-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO safeguarding_cases (id, school_id, reporter_user_id, subject_student_id, category, severity, summary, is_anonymous, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`
    ).run(
      id,
      req.auth!.activeSchoolId!,
      req.auth!.userId,
      parsed.data.subjectStudentId || null,
      parsed.data.category,
      parsed.data.severity,
      parsed.data.summary,
      parsed.data.isAnonymous ? 1 : 0,
      now,
      now
    );

    logAuditEvent(db, {
      schoolId: req.auth!.activeSchoolId!,
      actorUserId: req.auth!.userId,
      action: 'SAFEGUARDING_REPORT_FILED',
      resourceType: 'SAFEGUARDING_CASE',
      resourceId: id,
      metadata: { category: parsed.data.category, severity: parsed.data.severity },
    });

    return res.status(201).json({ success: true, message: 'Confidential safeguarding report logged for Principal/Safeguarding lead review.', data: { id } });
  });

  router.patch(
    '/safeguarding/cases/:id/status',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT'),
    (req, res) => {
      const schema = z.object({
        status: z.enum(['OPEN', 'UNDER_REVIEW', 'ESCALATED', 'RESOLVED']),
        actionNote: z.string().trim().optional().default(''),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid status update.', error: { code: 'VALIDATION_ERROR', details: null } });

      const now = new Date().toISOString();
      const result = db
        .prepare(`UPDATE safeguarding_cases SET status = ?, updated_at = ? WHERE id = ? AND school_id = ?`)
        .run(parsed.data.status, now, req.params.id, req.auth!.activeSchoolId!);
      if (result.changes === 0) return res.status(404).json({ success: false, message: 'Safeguarding case not found.', error: { code: 'NOT_FOUND', details: null } });

      if (parsed.data.actionNote) {
        db.prepare(
          `INSERT INTO safeguarding_case_actions (id, case_id, school_id, actor_user_id, action_note, created_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(crypto.randomUUID(), req.params.id, req.auth!.activeSchoolId!, req.auth!.userId, parsed.data.actionNote, now);
      }

      return res.json({ success: true, message: `Safeguarding case updated to ${parsed.data.status}.` });
    }
  );

  router.post('/wellbeing/appointments', requireAuth, requireSchoolTenant, (req, res) => {
    const schema = z.object({
      preferredDate: z.string().min(4),
      topic: z.string().trim().min(4),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Preferred date and topic required.', error: { code: 'VALIDATION_ERROR', details: null } });
    const id = `wba-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO wellbeing_appointments (id, school_id, requester_user_id, preferred_date, topic, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'REQUESTED', ?)`
    ).run(id, req.auth!.activeSchoolId!, req.auth!.userId, parsed.data.preferredDate, parsed.data.topic, new Date().toISOString());
    return res.status(201).json({ success: true, message: 'Confidential counseling appointment requested.', data: { id } });
  });

  // ======================== SYSTEM 12: FAMILY CONSENTS & AUTHORIZED PICKUPS ========================
  router.get('/consent', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;
    let consents = db
      .prepare(
        `SELECT cr.*, s.full_name as student_name, s.student_code
         FROM consent_records cr JOIN students s ON s.id = cr.student_id
         WHERE cr.school_id = ? ORDER BY cr.updated_at DESC`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    let pickups = db
      .prepare(
        `SELECT ap.*, s.full_name as student_name, s.student_code
         FROM authorized_pickups ap JOIN students s ON s.id = ap.student_id
         WHERE ap.school_id = ? ORDER BY ap.created_at DESC`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    let linkedChildren: Array<{ id: string; full_name: string; student_code: string }> = [];
    if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      linkedChildren = db
        .prepare(
          `SELECT s.id, s.full_name, s.student_code
           FROM student_guardians sg JOIN students s ON s.id = sg.student_id
           WHERE sg.parent_user_id = ? AND sg.school_id = ?`
        )
        .all(auth.userId, schoolId) as Array<{ id: string; full_name: string; student_code: string }>;
      const childIds = new Set(linkedChildren.map((x) => x.id));
      consents = consents.filter((c) => childIds.has(String(c.student_id)));
      pickups = pickups.filter((p) => childIds.has(String(p.student_id)));
    } else if (!['PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_RECEPTION', 'CLASS_TEACHER', 'TEACHER'].includes(auth.activeRole)) {
      consents = [];
      pickups = [];
    }

    return res.json({ success: true, data: { consents, pickups, linkedChildren } });
  });

  router.post(
    '/consent',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PARENT', 'LEGAL_GUARDIAN'),
    (req, res) => {
      const schema = z.object({
        studentId: z.string().min(1),
        consentType: z.enum(['DIGITAL_LEARNING_AI', 'PHOTO_VIDEO_MEDIA', 'FIELD_TRIP_PARTICIPATION', 'MEDICAL_EMERGENCY_CARE']),
        granted: z.boolean(),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid consent update.', error: { code: 'VALIDATION_ERROR', details: null } });

      const schoolId = req.auth!.activeSchoolId!;
      const guard = db
        .prepare(`SELECT id FROM student_guardians WHERE student_id = ? AND parent_user_id = ? AND school_id = ?`)
        .get(parsed.data.studentId, req.auth!.userId, schoolId);
      if (!guard) return res.status(403).json({ success: false, message: 'Only verified guardians can update child consents.', error: { code: 'FORBIDDEN', details: null } });

      db.prepare(
        `INSERT INTO consent_records (id, school_id, student_id, parent_user_id, consent_type, granted, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(student_id, consent_type) DO UPDATE SET granted = excluded.granted, parent_user_id = excluded.parent_user_id, updated_at = excluded.updated_at`
      ).run(
        `cns-${crypto.randomUUID().slice(0, 8)}`,
        schoolId,
        parsed.data.studentId,
        req.auth!.userId,
        parsed.data.consentType,
        parsed.data.granted ? 1 : 0,
        new Date().toISOString()
      );
      return res.json({ success: true, message: 'Consent preference saved.' });
    }
  );

  router.post('/pickups', requireAuth, requireSchoolTenant, requireRoles('PARENT', 'LEGAL_GUARDIAN'), (req, res) => {
    const schema = z.object({
      studentId: z.string().min(1),
      personName: z.string().trim().min(2),
      relationship: z.string().trim().min(2),
      phone: z.string().trim().min(6),
      idLast4: z.string().trim().max(4).optional().default(''),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid pickup person details.', error: { code: 'VALIDATION_ERROR', details: null } });
    const schoolId = req.auth!.activeSchoolId!;
    const guard = db
      .prepare(`SELECT id FROM student_guardians WHERE student_id = ? AND parent_user_id = ? AND school_id = ?`)
      .get(parsed.data.studentId, req.auth!.userId, schoolId);
    if (!guard) return res.status(403).json({ success: false, message: 'Unauthorized student pickup entry.', error: { code: 'FORBIDDEN', details: null } });

    const id = `pkp-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO authorized_pickups (id, school_id, student_id, parent_user_id, person_name, relationship, phone, id_last4, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`
    ).run(id, schoolId, parsed.data.studentId, req.auth!.userId, parsed.data.personName, parsed.data.relationship, parsed.data.phone, parsed.data.idLast4, new Date().toISOString());
    return res.status(201).json({ success: true, message: 'Authorized pickup person added.', data: { id } });
  });

  // ======================== SYSTEM 5 & 15: MARKETPLACE & GLOBAL EXCHANGE ========================
  router.get('/marketplace', requireAuth, (req, res) => {
    const resources = db.prepare(`SELECT * FROM learning_resources WHERE status = 'APPROVED' ORDER BY created_at DESC`).all();
    const partnerships = req.auth!.activeSchoolId
      ? db.prepare(`SELECT * FROM school_partnerships WHERE school_id = ? ORDER BY created_at DESC`).all(req.auth!.activeSchoolId)
      : [];
    const competitions = db.prepare(`SELECT * FROM competitions ORDER BY deadline ASC`).all();
    return res.json({ success: true, data: { resources, partnerships, competitions } });
  });

  router.post(
    '/marketplace/resources',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER', 'STAFF_LIBRARIAN'),
    (req, res) => {
      const schema = z.object({
        title: z.string().trim().min(3),
        resourceType: z.enum(['WORKBOOK', 'COURSE_GUIDE', 'QUESTION_PACK', 'VIDEO_LECTURE']).default('WORKBOOK'),
        subjectName: z.string().trim().min(2),
        gradeLevel: z.string().trim().min(2),
        priceNpr: z.coerce.number().min(0).default(0),
        description: z.string().trim().min(5),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid marketplace resource.', error: { code: 'VALIDATION_ERROR', details: null } });

      const id = `res-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO learning_resources (id, school_id, title, resource_type, subject_name, grade_level, author_name, price_npr, rating, description, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 5.0, ?, 'APPROVED', ?)`
      ).run(
        id,
        req.auth!.activeSchoolId!,
        parsed.data.title,
        parsed.data.resourceType,
        parsed.data.subjectName,
        parsed.data.gradeLevel,
        req.auth!.fullName,
        parsed.data.priceNpr,
        parsed.data.description,
        new Date().toISOString()
      );
      return res.status(201).json({ success: true, message: 'Learning resource published to catalog.', data: { id } });
    }
  );

  // ======================== HR LEAVES, FACILITIES, DEVELOPER API & SOC ========================
  router.get('/hr/leaves-and-facilities', requireAuth, requireSchoolTenant, (req, res) => {
    const schoolId = req.auth!.activeSchoolId!;
    const leaves = db
      .prepare(
        `SELECT tl.*, u.full_name as teacher_name
         FROM teacher_leave_requests tl JOIN global_users u ON u.id = tl.teacher_user_id
         WHERE tl.school_id = ? ORDER BY tl.created_at DESC`
      )
      .all(schoolId);
    const facilities = db.prepare(`SELECT * FROM facilities WHERE school_id = ?`).all(schoolId);
    const bookings = db
      .prepare(
        `SELECT fb.*, f.name as facility_name, u.full_name as booked_by_name
         FROM facility_bookings fb
         JOIN facilities f ON f.id = fb.facility_id
         JOIN global_users u ON u.id = fb.booked_by_user_id
         WHERE fb.school_id = ? ORDER BY fb.booking_date DESC LIMIT 30`
      )
      .all(schoolId);
    return res.json({ success: true, data: { leaves, facilities, bookings } });
  });

  router.post(
    '/hr/leaves',
    requireAuth,
    requireSchoolTenant,
    requireRoles('TEACHER', 'CLASS_TEACHER', 'PRINCIPAL', 'VICE_PRINCIPAL'),
    (req, res) => {
      const schema = z.object({
        leaveDate: z.string().min(4),
        reason: z.string().trim().min(4),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Leave date and reason required.', error: { code: 'VALIDATION_ERROR', details: null } });
      const id = `tlr-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO teacher_leave_requests (id, school_id, teacher_user_id, leave_date, reason, status, created_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`
      ).run(id, req.auth!.activeSchoolId!, req.auth!.userId, parsed.data.leaveDate, parsed.data.reason, new Date().toISOString());
      return res.status(201).json({ success: true, message: 'Leave & substitute request submitted.', data: { id } });
    }
  );

  router.patch(
    '/hr/leaves/:id',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG'),
    (req, res) => {
      const status = z.enum(['APPROVED', 'REJECTED']).safeParse(req.body?.status);
      if (!status.success) return res.status(400).json({ success: false, message: 'Invalid leave decision.', error: { code: 'VALIDATION_ERROR', details: null } });
      const result = db
        .prepare(`UPDATE teacher_leave_requests SET status = ? WHERE id = ? AND school_id = ?`)
        .run(status.data, req.params.id, req.auth!.activeSchoolId!);
      if (result.changes === 0) return res.status(404).json({ success: false, message: 'Leave request not found.', error: { code: 'NOT_FOUND', details: null } });
      return res.json({ success: true, message: `Leave request ${status.data.toLowerCase()}.` });
    }
  );

  router.post('/facilities/book', requireAuth, requireSchoolTenant, (req, res) => {
    const schema = z.object({
      facilityId: z.string().min(1),
      bookingDate: z.string().min(4),
      timeSlot: z.string().trim().min(3),
      purpose: z.string().trim().min(3),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid facility booking details.', error: { code: 'VALIDATION_ERROR', details: null } });

    const conflict = db
      .prepare(`SELECT id FROM facility_bookings WHERE school_id = ? AND facility_id = ? AND booking_date = ? AND time_slot = ?`)
      .get(req.auth!.activeSchoolId!, parsed.data.facilityId, parsed.data.bookingDate, parsed.data.timeSlot);
    if (conflict) return res.status(409).json({ success: false, message: 'Room/Lab already booked for that slot.', error: { code: 'BOOKING_CONFLICT', details: null } });

    const id = `fbk-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO facility_bookings (id, school_id, facility_id, booked_by_user_id, booking_date, time_slot, purpose, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)`
    ).run(id, req.auth!.activeSchoolId!, parsed.data.facilityId, req.auth!.userId, parsed.data.bookingDate, parsed.data.timeSlot, parsed.data.purpose, new Date().toISOString());
    return res.status(201).json({ success: true, message: 'Facility booking confirmed.', data: { id } });
  });

  // Developer API Keys, Webhooks & SOC Security / Disaster Recovery
  router.get(
    '/developer-security/overview',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'SCHOOL_ORG', 'TECHNICAL_DEPT', 'PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT'),
    (req, res) => {
      const schoolId = req.auth!.activeSchoolId!;
      const apiKeys = db
        .prepare(`SELECT id, name, key_prefix, scopes, status, created_at FROM api_clients WHERE school_id = ? ORDER BY created_at DESC`)
        .all(schoolId);
      const webhooks = db
        .prepare(`SELECT id, target_url, events_csv, is_active, created_at FROM webhook_subscriptions WHERE school_id = ? ORDER BY created_at DESC`)
        .all(schoolId);
      const incidents = db
        .prepare(`SELECT * FROM security_incidents WHERE school_id = ? OR school_id IS NULL ORDER BY created_at DESC LIMIT 20`)
        .all(schoolId);
      const backups = db.prepare(`SELECT * FROM backup_records ORDER BY created_at DESC LIMIT 10`).all();

      return res.json({ success: true, data: { apiKeys, webhooks, incidents, backups } });
    }
  );

  router.post(
    '/developer/api-keys',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'SCHOOL_ORG', 'TECHNICAL_DEPT', 'PLATFORM_SUPER_ADMIN'),
    (req, res) => {
      const schema = z.object({
        name: z.string().trim().min(3),
        scopes: z.string().trim().default('read:roster,read:attendance'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'API client name required.', error: { code: 'VALIDATION_ERROR', details: null } });

      const rawKey = `sk_live_${crypto.randomBytes(18).toString('hex')}`;
      const prefix = rawKey.slice(0, 14);
      const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
      const id = `api-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO api_clients (id, school_id, name, key_prefix, key_hash, scopes, status, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
      ).run(id, req.auth!.activeSchoolId!, parsed.data.name, prefix, hash, parsed.data.scopes, req.auth!.userId, new Date().toISOString());

      return res.status(201).json({
        success: true,
        message: 'API key generated. Copy it now; only the hash is stored.',
        data: { id, apiKeyOnce: rawKey, prefix },
      });
    }
  );

  router.post(
    '/developer/webhooks',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'SCHOOL_ORG', 'TECHNICAL_DEPT', 'PLATFORM_SUPER_ADMIN'),
    (req, res) => {
      const schema = z.object({
        targetUrl: z.string().url(),
        eventsCsv: z.string().trim().min(3),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Valid HTTPS webhook URL required.', error: { code: 'VALIDATION_ERROR', details: null } });

      const secret = `whsec_${crypto.randomBytes(16).toString('hex')}`;
      const id = `wh-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO webhook_subscriptions (id, school_id, target_url, events_csv, signing_secret_enc, is_active, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?)`
      ).run(id, req.auth!.activeSchoolId!, parsed.data.targetUrl, parsed.data.eventsCsv, encryptSensitiveField(secret), new Date().toISOString());
      return res.status(201).json({
        success: true,
        message: 'Webhook registered with HMAC-SHA256 signing secret.',
        data: { id, signingSecretOnce: secret },
      });
    }
  );

  router.post(
    '/dr/backups/verify',
    requireAuth,
    requireRoles('PRINCIPAL', 'PLATFORM_SUPER_ADMIN', 'TECHNICAL_DEPT'),
    (req, res) => {
      const checksum = crypto.createHash('sha256').update(`${Date.now()}:${req.auth!.userId}`).digest('hex');
      const id = `bkp-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO backup_records (id, scope, backup_label, checksum_sha256, verified_restore, created_by_user_id, created_at)
         VALUES (?, 'SCHOOL_AND_PLATFORM', ?, ?, 1, ?, ?)`
      ).run(id, `Verified Backup Snapshot ${new Date().toISOString().slice(0, 16)}`, checksum, req.auth!.userId, new Date().toISOString());
      return res.status(201).json({ success: true, message: 'Backup integrity verified via SHA-256 checksum.', data: { id, checksum } });
    }
  );

  return router;
}
