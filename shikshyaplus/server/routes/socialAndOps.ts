import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  applyAppealRestoration,
  canInitiateConversation,
  canPublishToAudience,
  evaluateModerationStrike,
  type AccountRole,
  type PostAudience,
} from '../../src/lib/domainRules';
import { getAIProviderStatus, runHomeworkScan, scanContentForModeration } from '../aiGateway';
import { emitToSchool, emitToUser } from '../realtime';
import { logAuditEvent, rateLimit, requireAuth, requireRoles, requireSchoolTenant } from '../security';

const uploadDir = path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 10);
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Unsupported file type. Only JPEG, PNG, WebP, and PDF are permitted.'));
    }
    cb(null, true);
  },
});

export function createSocialAndOpsRouter(db: DatabaseSync) {
  const router = Router();

  // ======================== SOCIAL: GLOBAL FEED & MY SCHOOL ========================
  router.get('/social/global-feed', (req, res) => {
    const filter = String(req.query.filter || 'ALL');
    const q = String(req.query.q || '').trim().toLowerCase();
    const userId = req.auth?.userId ?? null;

    let posts = db
      .prepare(
        `SELECT p.*, u.full_name as author_name, u.username as author_username, u.avatar_url as author_avatar,
                sc.name as school_name, sc.school_code, sc.logo_url as school_logo, sc.status as school_status
         FROM social_posts p
         JOIN global_users u ON u.id = p.author_user_id
         LEFT JOIN schools sc ON sc.id = p.school_id
         WHERE p.audience IN ('PUBLIC', 'GLOBAL_COMMUNITY') AND p.moderation_status = 'APPROVED'
         ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT 60`
      )
      .all() as Array<Record<string, unknown>>;

    if (filter === 'FOLLOWING' && userId) {
      const followed = new Set(
        (db.prepare(`SELECT school_id FROM school_follows WHERE user_id = ?`).all(userId) as Array<{ school_id: string }>).map((f) => f.school_id)
      );
      posts = posts.filter((p) => p.school_id && followed.has(String(p.school_id)));
    } else if (filter === 'PROJECTS') {
      posts = posts.filter((p) => String(p.post_type) === 'PROJECT' || String(p.post_type) === 'ACHIEVEMENT');
    }

    if (q) {
      posts = posts.filter((p) => `${p.content} ${p.author_name} ${p.school_name ?? ''}`.toLowerCase().includes(q));
    }

    const likedIds = new Set(
      userId ? (db.prepare(`SELECT post_id FROM post_reactions WHERE user_id = ?`).all(userId) as Array<{ post_id: string }>).map((r) => r.post_id) : []
    );
    const savedIds = new Set(
      userId ? (db.prepare(`SELECT post_id FROM post_saves WHERE user_id = ?`).all(userId) as Array<{ post_id: string }>).map((s) => s.post_id) : []
    );
    const blockedIds = new Set(
      userId ? (db.prepare(`SELECT blocked_user_id FROM user_blocks WHERE blocker_user_id = ?`).all(userId) as Array<{ blocked_user_id: string }>).map((b) => b.blocked_user_id) : []
    );

    return res.json({
      success: true,
      data: {
        posts: posts
          .filter((p) => !blockedIds.has(String(p.author_user_id)))
          .map((p) => ({
            ...p,
            likedByMe: likedIds.has(String(p.id)),
            savedByMe: savedIds.has(String(p.id)),
          })),
      },
    });
  });

  router.get('/social/my-school-feed', requireAuth, requireSchoolTenant, (req, res) => {
    const schoolId = req.auth!.activeSchoolId!;
    const userId = req.auth!.userId;

    const posts = db
      .prepare(
        `SELECT p.*, u.full_name as author_name, u.username as author_username, sc.name as school_name, sc.logo_url as school_logo
         FROM social_posts p
         JOIN global_users u ON u.id = p.author_user_id
         LEFT JOIN schools sc ON sc.id = p.school_id
         WHERE p.school_id = ? AND p.moderation_status = 'APPROVED'
         ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT 60`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    const likedIds = new Set(
      (db.prepare(`SELECT post_id FROM post_reactions WHERE user_id = ?`).all(userId) as Array<{ post_id: string }>).map((r) => r.post_id)
    );
    const savedIds = new Set(
      (db.prepare(`SELECT post_id FROM post_saves WHERE user_id = ?`).all(userId) as Array<{ post_id: string }>).map((s) => s.post_id)
    );

    const blockedIds = new Set(
      (db.prepare(`SELECT blocked_user_id FROM user_blocks WHERE blocker_user_id = ?`).all(userId) as Array<{ blocked_user_id: string }>).map((b) => b.blocked_user_id)
    );

    return res.json({
      success: true,
      data: {
        posts: posts
          .filter((p) => !blockedIds.has(String(p.author_user_id)))
          .map((p) => ({
            ...p,
            likedByMe: likedIds.has(String(p.id)),
            savedByMe: savedIds.has(String(p.id)),
          })),
      },
    });
  });

  router.post('/social/posts', requireAuth, async (req, res) => {
    const schema = z.object({
      content: z.string().trim().min(2).max(2000),
      postType: z.enum(['UPDATE', 'PROJECT', 'ACHIEVEMENT', 'ANNOUNCEMENT', 'RESOURCE']).default('UPDATE'),
      audience: z.enum(['PUBLIC', 'GLOBAL_COMMUNITY', 'CONNECTIONS', 'MY_SCHOOL', 'CLASS_COMMUNITY', 'PRIVATE']),
      mediaUrl: z.string().optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Post content is required.', error: { code: 'VALIDATION_ERROR', details: null } });
    }
    const auth = req.auth!;
    if (!canPublishToAudience(auth.activeRole, auth.accountStatus, auth.activeSchoolStatus, parsed.data.audience as PostAudience)) {
      return res.status(403).json({
        success: false,
        message: `Your role (${auth.activeRole}) or account status (${auth.accountStatus}) cannot publish to ${parsed.data.audience}.`,
        error: { code: 'AUDIENCE_FORBIDDEN', details: null },
      });
    }

    // Automated AI Moderation Check
    const modScan = await scanContentForModeration(parsed.data.content);
    const now = new Date().toISOString();
    const postId = `pst-${crypto.randomUUID().slice(0, 8)}`;

    if (modScan.riskLevel === 'HIGH_PROHIBITED' || modScan.riskLevel === 'CRITICAL_CHILD_SAFETY') {
      const severity = modScan.riskLevel === 'CRITICAL_CHILD_SAFETY' ? 'CRITICAL_CHILD_SAFETY' : 'STANDARD';
      const caseId = `mod-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO moderation_cases (id, school_id, target_user_id, content_type, content_id, content_excerpt, reason, severity, status, created_at)
         VALUES (?, ?, ?, 'POST', ?, ?, ?, ?, 'OPEN', ?)`
      ).run(caseId, auth.activeSchoolId, auth.userId, postId, parsed.data.content.slice(0, 200), modScan.reason, severity, now);

      if (severity === 'CRITICAL_CHILD_SAFETY') {
        const evalRes = evaluateModerationStrike({ currentStrikes: auth.strikeCount, severity });
        db.prepare(`UPDATE global_users SET strike_count = ?, account_status = ? WHERE id = ?`).run(
          evalRes.newStrikeCount,
          evalRes.resultingStatus,
          auth.userId
        );
      }

      return res.status(400).json({
        success: false,
        message: `Post blocked by safety moderation: ${modScan.reason}`,
        error: { code: 'MODERATION_BLOCKED', details: { caseId, riskLevel: modScan.riskLevel } },
      });
    }

    const moderationStatus = modScan.riskLevel === 'UNCERTAIN' ? 'HOLD_REVIEW' : 'APPROVED';
    db.prepare(
      `INSERT INTO social_posts (id, school_id, author_user_id, content, post_type, audience, media_url, moderation_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(postId, auth.activeSchoolId, auth.userId, parsed.data.content, parsed.data.postType, parsed.data.audience, parsed.data.mediaUrl ?? null, moderationStatus, now);

    if (auth.activeSchoolId && (parsed.data.audience === 'MY_SCHOOL' || parsed.data.audience === 'CLASS_COMMUNITY')) {
      emitToSchool(auth.activeSchoolId, 'feed:new_post', { postId, authorName: auth.fullName });
    }

    return res.status(201).json({
      success: true,
      message: moderationStatus === 'APPROVED' ? 'Post published.' : 'Post held for safety review before publication.',
      data: { id: postId, moderationStatus },
    });
  });

  router.patch('/social/posts/:id', requireAuth, async (req, res) => {
    const schema = z.object({ content: z.string().trim().min(2).max(2000) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Updated post content is required.', error: { code: 'VALIDATION_ERROR', details: null } });
    }
    const existing = db.prepare(`SELECT id, author_user_id FROM social_posts WHERE id = ?`).get(req.params.id) as
      | { id: string; author_user_id: string }
      | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Post not found.', error: { code: 'NOT_FOUND', details: null } });
    }
    if (existing.author_user_id !== req.auth!.userId) {
      return res.status(403).json({ success: false, message: 'Only the post author can edit this post.', error: { code: 'FORBIDDEN', details: null } });
    }
    const modScan = await scanContentForModeration(parsed.data.content);
    if (modScan.riskLevel === 'HIGH_PROHIBITED' || modScan.riskLevel === 'CRITICAL_CHILD_SAFETY') {
      return res.status(400).json({ success: false, message: `Edit blocked by safety moderation: ${modScan.reason}`, error: { code: 'MODERATION_BLOCKED', details: null } });
    }
    db.prepare(`UPDATE social_posts SET content = ? WHERE id = ?`).run(parsed.data.content, existing.id);
    return res.json({ success: true, message: 'Post updated.' });
  });

  router.delete('/social/posts/:id', requireAuth, (req, res) => {
    const existing = db.prepare(`SELECT id, author_user_id, school_id FROM social_posts WHERE id = ?`).get(req.params.id) as
      | { id: string; author_user_id: string; school_id: string | null }
      | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Post not found.', error: { code: 'NOT_FOUND', details: null } });
    }
    const isAuthor = existing.author_user_id === req.auth!.userId;
    const isSuper = req.auth!.activeRole === 'PLATFORM_SUPER_ADMIN' || req.auth!.activeRole === 'PLATFORM_SUPPORT';
    const isSchoolMod = req.auth!.activeRole === 'PRINCIPAL' && existing.school_id === req.auth!.activeSchoolId;
    if (!isAuthor && !isSuper && !isSchoolMod) {
      return res.status(403).json({ success: false, message: 'Not authorized to remove this post.', error: { code: 'FORBIDDEN', details: null } });
    }
    db.prepare(`DELETE FROM social_posts WHERE id = ?`).run(existing.id);
    return res.json({ success: true, message: 'Post deleted.' });
  });

  router.patch(
    '/social/posts/:id/pin',
    requireAuth,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'PLATFORM_SUPER_ADMIN'),
    (req, res) => {
      const existing = db.prepare(`SELECT id, school_id, is_pinned FROM social_posts WHERE id = ?`).get(req.params.id) as
        | { id: string; school_id: string | null; is_pinned: number }
        | undefined;
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Post not found.', error: { code: 'NOT_FOUND', details: null } });
      }
      if (
        req.auth!.activeRole !== 'PLATFORM_SUPER_ADMIN' &&
        existing.school_id &&
        existing.school_id !== req.auth!.activeSchoolId
      ) {
        return res.status(403).json({ success: false, message: 'Cannot pin posts from another school.', error: { code: 'FORBIDDEN', details: null } });
      }
      const nextPinned = existing.is_pinned ? 0 : 1;
      db.prepare(`UPDATE social_posts SET is_pinned = ? WHERE id = ?`).run(nextPinned, existing.id);
      return res.json({
        success: true,
        message: nextPinned ? 'Post pinned to top of feed.' : 'Post unpinned.',
        data: { isPinned: Boolean(nextPinned) },
      });
    }
  );

  router.post('/social/posts/:id/react', requireAuth, (req, res) => {
    const postId = req.params.id;
    const existing = db.prepare(`SELECT id FROM post_reactions WHERE post_id = ? AND user_id = ?`).get(postId, req.auth!.userId) as { id: string } | undefined;
    if (existing) {
      db.prepare(`DELETE FROM post_reactions WHERE id = ?`).run(existing.id);
      db.prepare(`UPDATE social_posts SET likes_count = MAX(0, likes_count - 1) WHERE id = ?`).run(postId);
      return res.json({ success: true, data: { liked: false } });
    }
    db.prepare(`INSERT INTO post_reactions (id, post_id, user_id, reaction_type, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(),
      postId,
      req.auth!.userId,
      String(req.body?.type || 'LIKE'),
      new Date().toISOString()
    );
    db.prepare(`UPDATE social_posts SET likes_count = likes_count + 1 WHERE id = ?`).run(postId);
    return res.json({ success: true, data: { liked: true } });
  });

  router.get('/social/posts/:id/comments', (req, res) => {
    const comments = db
      .prepare(
        `SELECT c.*, u.full_name as author_name, u.username as author_username
         FROM post_comments c JOIN global_users u ON u.id = c.user_id
         WHERE c.post_id = ? ORDER BY c.created_at ASC`
      )
      .all(req.params.id);
    return res.json({ success: true, data: { comments } });
  });

  router.post('/social/posts/:id/comment', requireAuth, async (req, res) => {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ success: false, message: 'Comment text required.', error: { code: 'VALIDATION_ERROR', details: null } });

    const scan = await scanContentForModeration(body);
    if (scan.riskLevel === 'HIGH_PROHIBITED' || scan.riskLevel === 'CRITICAL_CHILD_SAFETY') {
      return res.status(400).json({ success: false, message: `Comment blocked: ${scan.reason}`, error: { code: 'MODERATION_BLOCKED', details: null } });
    }

    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO post_comments (id, post_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)`).run(
      id,
      req.params.id,
      req.auth!.userId,
      body,
      new Date().toISOString()
    );
    db.prepare(`UPDATE social_posts SET comments_count = comments_count + 1 WHERE id = ?`).run(req.params.id);
    return res.status(201).json({ success: true, message: 'Comment added.', data: { id } });
  });

  router.post('/social/posts/:id/save', requireAuth, (req, res) => {
    const existing = db.prepare(`SELECT id FROM post_saves WHERE post_id = ? AND user_id = ?`).get(req.params.id, req.auth!.userId) as { id: string } | undefined;
    if (existing) {
      db.prepare(`DELETE FROM post_saves WHERE id = ?`).run(existing.id);
      return res.json({ success: true, data: { saved: false } });
    }
    db.prepare(`INSERT INTO post_saves (id, post_id, user_id, created_at) VALUES (?, ?, ?, ?)`).run(
      crypto.randomUUID(),
      req.params.id,
      req.auth!.userId,
      new Date().toISOString()
    );
    return res.json({ success: true, data: { saved: true } });
  });

  router.get('/social/saved', requireAuth, (req, res) => {
    const posts = db
      .prepare(
        `SELECT p.*, u.full_name as author_name, sc.name as school_name
         FROM post_saves s
         JOIN social_posts p ON p.id = s.post_id
         JOIN global_users u ON u.id = p.author_user_id
         LEFT JOIN schools sc ON sc.id = p.school_id
         WHERE s.user_id = ? ORDER BY s.created_at DESC`
      )
      .all(req.auth!.userId);
    return res.json({ success: true, data: { posts } });
  });

  // Groups
  router.get('/social/groups', requireAuth, (req, res) => {
    const groups = db
      .prepare(
        `SELECT g.*, u.full_name as moderator_name,
                (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as members_count,
                EXISTS(SELECT 1 FROM group_members gm2 WHERE gm2.group_id = g.id AND gm2.user_id = ?) as is_member
         FROM global_groups g
         JOIN global_users u ON u.id = g.moderator_user_id
         WHERE g.is_public = 1 OR g.school_id = ?
         ORDER BY g.created_at DESC`
      )
      .all(req.auth!.userId, req.auth!.activeSchoolId ?? '');
    return res.json({ success: true, data: { groups } });
  });

  router.post('/social/groups', requireAuth, (req, res) => {
    const schema = z.object({
      name: z.string().trim().min(3),
      category: z.string().trim().min(2),
      description: z.string().trim().min(5),
      isPublic: z.boolean().default(true),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Invalid group details.', error: { code: 'VALIDATION_ERROR', details: null } });
    }
    const id = `grp-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      db.prepare(
        `INSERT INTO global_groups (id, school_id, name, category, description, is_public, moderator_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        req.auth!.activeSchoolId,
        parsed.data.name,
        parsed.data.category,
        parsed.data.description,
        parsed.data.isPublic ? 1 : 0,
        req.auth!.userId,
        now
      );
      db.prepare(`INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)`).run(
        crypto.randomUUID(),
        id,
        req.auth!.userId,
        now
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return res.status(201).json({ success: true, message: 'Educational group created.', data: { id } });
  });

  router.post('/social/groups/:id/join', requireAuth, (req, res) => {
    const existing = db.prepare(`SELECT id FROM group_members WHERE group_id = ? AND user_id = ?`).get(req.params.id, req.auth!.userId) as { id: string } | undefined;
    if (existing) {
      db.prepare(`DELETE FROM group_members WHERE id = ?`).run(existing.id);
      return res.json({ success: true, data: { joined: false } });
    }
    db.prepare(`INSERT INTO group_members (id, group_id, user_id, joined_at) VALUES (?, ?, ?, ?)`).run(
      crypto.randomUUID(),
      req.params.id,
      req.auth!.userId,
      new Date().toISOString()
    );
    return res.json({ success: true, data: { joined: true } });
  });

  // Connections
  router.get('/social/connections', requireAuth, (req, res) => {
    const userId = req.auth!.userId;
    const connections = db
      .prepare(
        `SELECT sc.*, u1.full_name as requester_name, u2.full_name as recipient_name
         FROM social_connections sc
         JOIN global_users u1 ON u1.id = sc.requester_user_id
         JOIN global_users u2 ON u2.id = sc.recipient_user_id
         WHERE sc.requester_user_id = ? OR sc.recipient_user_id = ?`
      )
      .all(userId, userId);
    return res.json({ success: true, data: { connections } });
  });

  router.post('/social/connections/request', requireAuth, (req, res) => {
    const recipientUserId = String(req.body?.recipientUserId || '');
    if (!recipientUserId || recipientUserId === req.auth!.userId) {
      return res.status(400).json({ success: false, message: 'Valid target user required.', error: { code: 'VALIDATION_ERROR', details: null } });
    }
    const existing = db
      .prepare(`SELECT id FROM social_connections WHERE (requester_user_id = ? AND recipient_user_id = ?) OR (requester_user_id = ? AND recipient_user_id = ?)`)
      .get(req.auth!.userId, recipientUserId, recipientUserId, req.auth!.userId);
    if (existing) return res.json({ success: true, message: 'Connection request already exists.' });

    db.prepare(`INSERT INTO social_connections (id, requester_user_id, recipient_user_id, status, created_at) VALUES (?, ?, ?, 'PENDING', ?)`).run(
      crypto.randomUUID(),
      req.auth!.userId,
      recipientUserId,
      new Date().toISOString()
    );
    return res.status(201).json({ success: true, message: 'Connection request sent.' });
  });

  router.patch('/social/connections/:id', requireAuth, (req, res) => {
    const parsed = z.object({ status: z.enum(['ACCEPTED', 'DECLINED']) }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Invalid connection status.', error: { code: 'VALIDATION_ERROR', details: null } });
    }
    const existing = db
      .prepare(`SELECT id, recipient_user_id FROM social_connections WHERE id = ?`)
      .get(req.params.id) as { id: string; recipient_user_id: string } | undefined;
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Connection request not found.', error: { code: 'NOT_FOUND', details: null } });
    }
    if (existing.recipient_user_id !== req.auth!.userId) {
      return res.status(403).json({ success: false, message: 'Only the recipient can respond to this request.', error: { code: 'FORBIDDEN', details: null } });
    }
    db.prepare(`UPDATE social_connections SET status = ? WHERE id = ?`).run(parsed.data.status, req.params.id);
    return res.json({ success: true, message: `Connection request ${parsed.data.status.toLowerCase()}.` });
  });

  // User Blocks (Safeguarding & Peer Muting)
  router.get('/social/blocks', requireAuth, (req, res) => {
    const blocks = db
      .prepare(
        `SELECT b.*, u.full_name as blocked_name, u.username as blocked_username
         FROM user_blocks b JOIN global_users u ON u.id = b.blocked_user_id
         WHERE b.blocker_user_id = ? ORDER BY b.created_at DESC`
      )
      .all(req.auth!.userId);
    return res.json({ success: true, data: { blocks } });
  });

  router.post('/social/blocks', requireAuth, (req, res) => {
    const blockedUserId = String(req.body?.blockedUserId || '');
    if (!blockedUserId || blockedUserId === req.auth!.userId) {
      return res.status(400).json({ success: false, message: 'Valid target user required.', error: { code: 'VALIDATION_ERROR', details: null } });
    }
    const targetExists = db.prepare(`SELECT id FROM global_users WHERE id = ?`).get(blockedUserId) as { id: string } | undefined;
    if (!targetExists) {
      return res.status(404).json({ success: false, message: 'Target user not found.', error: { code: 'NOT_FOUND', details: null } });
    }
    db.prepare(`INSERT OR IGNORE INTO user_blocks (id, blocker_user_id, blocked_user_id, created_at) VALUES (?, ?, ?, ?)`).run(
      crypto.randomUUID(),
      req.auth!.userId,
      blockedUserId,
      new Date().toISOString()
    );
    return res.status(201).json({ success: true, message: 'User blocked. Their posts and direct messages are hidden.' });
  });

  router.delete('/social/blocks/:blockedUserId', requireAuth, (req, res) => {
    db.prepare(`DELETE FROM user_blocks WHERE blocker_user_id = ? AND blocked_user_id = ?`).run(req.auth!.userId, req.params.blockedUserId);
    return res.json({ success: true, message: 'User unblocked.' });
  });

  // ======================== MESSAGING & NOTIFICATIONS ========================
  router.get('/communications/contacts', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;
    const members = db
      .prepare(
        `SELECT m.user_id, m.role, m.user_code, m.department, u.full_name, u.email
         FROM school_memberships m
         JOIN global_users u ON u.id = m.user_id
         WHERE m.school_id = ? AND m.status = 'ACTIVE' AND m.user_id != ?`
      )
      .all(schoolId, auth.userId) as Array<Record<string, unknown>>;

    // Filter contacts by child safeguarding rules
    const filtered = members.filter((m) => {
      const check = canInitiateConversation({
        senderRole: auth.activeRole,
        senderSchoolId: schoolId,
        recipientRole: String(m.role) as AccountRole,
        recipientSchoolId: schoolId,
        isVerifiedGuardianOfStudent: auth.activeRole === 'PARENT',
        isTeacherOfStudent: auth.activeRole === 'TEACHER' || auth.activeRole === 'CLASS_TEACHER' || auth.activeRole === 'PRINCIPAL',
      });
      return check.allowed;
    });

    return res.json({ success: true, data: { contacts: filtered } });
  });

  router.get('/communications/conversations', requireAuth, requireSchoolTenant, (req, res) => {
    const schoolId = req.auth!.activeSchoolId!;
    const userId = req.auth!.userId;
    const convs = db
      .prepare(
        `SELECT c.*,
                CASE WHEN c.is_group = 0 THEN (SELECT cm2.user_id FROM conversation_members cm2 WHERE cm2.conversation_id = c.id AND cm2.user_id != ? LIMIT 1) ELSE NULL END as peer_user_id,
                (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
                (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_at
         FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id
         WHERE cm.user_id = ? AND c.school_id = ?
         ORDER BY COALESCE(last_message_at, c.created_at) DESC`
      )
      .all(userId, userId, schoolId);
    return res.json({ success: true, data: { conversations: convs } });
  });

  router.post('/communications/conversations', requireAuth, requireSchoolTenant, (req, res) => {
    const recipientUserId = String(req.body?.recipientUserId || '');
    const schoolId = req.auth!.activeSchoolId!;
    const recipientMem = db
      .prepare(`SELECT m.role, u.full_name FROM school_memberships m JOIN global_users u ON u.id = m.user_id WHERE m.user_id = ? AND m.school_id = ? AND m.status = 'ACTIVE' LIMIT 1`)
      .get(recipientUserId, schoolId) as { role: AccountRole; full_name: string } | undefined;

    if (!recipientMem) {
      return res.status(403).json({ success: false, message: 'Recipient is not an active member of your school.', error: { code: 'FORBIDDEN', details: null } });
    }

    const blocked = db
      .prepare(
        `SELECT id FROM user_blocks WHERE (blocker_user_id = ? AND blocked_user_id = ?) OR (blocker_user_id = ? AND blocked_user_id = ?)`
      )
      .get(req.auth!.userId, recipientUserId, recipientUserId, req.auth!.userId);

    const check = canInitiateConversation({
      senderRole: req.auth!.activeRole,
      senderSchoolId: schoolId,
      recipientRole: recipientMem.role,
      recipientSchoolId: schoolId,
      isVerifiedGuardianOfStudent: req.auth!.activeRole === 'PARENT',
      isTeacherOfStudent: req.auth!.activeRole === 'TEACHER' || req.auth!.activeRole === 'CLASS_TEACHER' || req.auth!.activeRole === 'PRINCIPAL',
      isBlocked: Boolean(blocked),
    });
    if (!check.allowed) {
      return res.status(403).json({ success: false, message: check.reason || 'Messaging restricted.', error: { code: 'SAFEGUARDING_RESTRICTED', details: null } });
    }

    // Return existing 1:1 if present
    const existing = db
      .prepare(
        `SELECT c.id FROM conversations c
         JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
         JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
         WHERE c.school_id = ? AND c.is_group = 0 LIMIT 1`
      )
      .get(req.auth!.userId, recipientUserId, schoolId) as { id: string } | undefined;

    if (existing) {
      return res.json({ success: true, data: { id: existing.id } });
    }

    const convId = `conv-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(`INSERT INTO conversations (id, school_id, title, is_group, created_at) VALUES (?, ?, ?, 0, ?)`).run(
      convId,
      schoolId,
      `${req.auth!.fullName} & ${recipientMem.full_name}`,
      new Date().toISOString()
    );
    db.prepare(`INSERT INTO conversation_members (id, conversation_id, user_id) VALUES (?, ?, ?)`).run(crypto.randomUUID(), convId, req.auth!.userId);
    db.prepare(`INSERT INTO conversation_members (id, conversation_id, user_id) VALUES (?, ?, ?)`).run(crypto.randomUUID(), convId, recipientUserId);

    return res.status(201).json({ success: true, data: { id: convId } });
  });

  router.get('/communications/conversations/:id/messages', requireAuth, requireSchoolTenant, (req, res) => {
    const member = db
      .prepare(`SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
      .get(req.params.id, req.auth!.userId);
    if (!member) {
      return res.status(403).json({ success: false, message: 'You are not a participant in this conversation.', error: { code: 'FORBIDDEN', details: null } });
    }
    const readAt = new Date().toISOString();
    const updated = db
      .prepare(`UPDATE messages SET read_at = ? WHERE conversation_id = ? AND school_id = ? AND sender_user_id != ? AND read_at IS NULL`)
      .run(readAt, req.params.id, req.auth!.activeSchoolId!, req.auth!.userId);

    if (updated.changes > 0) {
      const others = db
        .prepare(`SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?`)
        .all(req.params.id, req.auth!.userId) as Array<{ user_id: string }>;
      for (const o of others) {
        emitToUser(o.user_id, 'message:read', {
          conversation_id: req.params.id,
          reader_user_id: req.auth!.userId,
          read_at: readAt,
        });
      }
    }

    const messages = db
      .prepare(
        `SELECT m.*, u.full_name as sender_name
         FROM messages m JOIN global_users u ON u.id = m.sender_user_id
         WHERE m.conversation_id = ? AND m.school_id = ?
         ORDER BY m.created_at ASC`
      )
      .all(req.params.id, req.auth!.activeSchoolId!);
    return res.json({ success: true, data: { messages } });
  });

  router.post('/communications/conversations/:id/messages', requireAuth, requireSchoolTenant, (req, res) => {
    const rawBody = String(req.body?.body || '').trim();
    const attachmentPath = req.body?.attachmentPath ? String(req.body.attachmentPath).trim() : null;
    const body = rawBody || (attachmentPath ? 'Sent an attachment' : '');
    if (!body) return res.status(400).json({ success: false, message: 'Message or attachment is required.', error: { code: 'VALIDATION_ERROR', details: null } });

    const member = db
      .prepare(`SELECT id FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
      .get(req.params.id, req.auth!.userId);
    if (!member) {
      return res.status(403).json({ success: false, message: 'Unauthorized conversation access.', error: { code: 'FORBIDDEN', details: null } });
    }

    const now = new Date().toISOString();
    const msgId = `msg-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO messages (id, school_id, conversation_id, sender_user_id, body, attachment_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(msgId, req.auth!.activeSchoolId!, req.params.id, req.auth!.userId, body, attachmentPath, now);

    const payload = {
      id: msgId,
      conversation_id: req.params.id,
      sender_user_id: req.auth!.userId,
      sender_name: req.auth!.fullName,
      body,
      attachment_path: attachmentPath,
      read_at: null,
      created_at: now,
    };

    const recipients = db
      .prepare(`SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id != ?`)
      .all(req.params.id, req.auth!.userId) as Array<{ user_id: string }>;

    for (const r of recipients) {
      emitToUser(r.user_id, 'message:new', payload);
      const notifId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO notifications (id, school_id, user_id, category, title, body, created_at) VALUES (?, ?, ?, 'MESSAGE', ?, ?, ?)`
      ).run(notifId, req.auth!.activeSchoolId!, r.user_id, `Message from ${req.auth!.fullName}`, body.slice(0, 100), now);
      emitToUser(r.user_id, 'notification:new', { id: notifId, title: `Message from ${req.auth!.fullName}`, body: body.slice(0, 100) });
    }

    return res.status(201).json({ success: true, data: { message: payload } });
  });

  router.get('/communications/notifications', requireAuth, (req, res) => {
    const notifications = db
      .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30`)
      .all(req.auth!.userId);
    return res.json({ success: true, data: { notifications } });
  });

  router.post('/communications/notifications/read-all', requireAuth, (req, res) => {
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(req.auth!.userId);
    return res.json({ success: true, message: 'All notifications marked read.' });
  });

  // ======================== OPERATIONS (NOTICES, FEES, LIBRARY, TRANSPORT, ADMISSIONS, AUDIT) ========================
  router.get('/operations/notices', requireAuth, requireSchoolTenant, (req, res) => {
    const notices = db
      .prepare(
        `SELECT n.*, u.full_name as author_name
         FROM school_notices n JOIN global_users u ON u.id = n.author_user_id
         WHERE n.school_id = ? ORDER BY n.created_at DESC`
      )
      .all(req.auth!.activeSchoolId!);
    return res.json({ success: true, data: { notices } });
  });

  router.post(
    '/operations/notices',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'STAFF_ADMIN'),
    (req, res) => {
      const schema = z.object({
        title: z.string().trim().min(3),
        body: z.string().trim().min(5),
        noticeType: z.enum(['GENERAL', 'HOLIDAY', 'EXAMINATION', 'FEE', 'ADMISSION', 'EMERGENCY', 'MEETING', 'EVENT']).default('GENERAL'),
        audience: z.enum(['ALL', 'TEACHERS', 'PARENTS', 'STUDENTS', 'STAFF']).default('ALL'),
        priority: z.enum(['NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid notice.', error: { code: 'VALIDATION_ERROR', details: null } });

      const id = `ntc-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO school_notices (id, school_id, title, body, notice_type, audience, priority, author_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, req.auth!.activeSchoolId!, parsed.data.title, parsed.data.body, parsed.data.noticeType, parsed.data.audience, parsed.data.priority, req.auth!.userId, now);

      logAuditEvent(db, {
        schoolId: req.auth!.activeSchoolId!,
        actorUserId: req.auth!.userId,
        action: 'NOTICE_PUBLISHED',
        resourceType: 'NOTICE',
        resourceId: id,
      });
      return res.status(201).json({ success: true, message: 'Notice published.' });
    }
  );

  router.get('/operations/events', requireAuth, requireSchoolTenant, (req, res) => {
    const events = db
      .prepare(`SELECT * FROM school_events WHERE school_id = ? ORDER BY event_date ASC`)
      .all(req.auth!.activeSchoolId!);
    return res.json({ success: true, data: { events } });
  });

  router.post(
    '/operations/events',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'TEACHER', 'CLASS_TEACHER', 'STAFF_ADMIN'),
    (req, res) => {
      const schema = z.object({
        title: z.string().trim().min(3),
        description: z.string().trim().min(5),
        category: z.string().trim().min(2),
        eventDate: z.string().min(4),
        location: z.string().trim().min(2),
        isPublic: z.boolean().default(true),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid event.', error: { code: 'VALIDATION_ERROR', details: null } });

      db.prepare(
        `INSERT INTO school_events (id, school_id, title, description, category, event_date, location, is_public, author_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `evt-${crypto.randomUUID().slice(0, 8)}`,
        req.auth!.activeSchoolId!,
        parsed.data.title,
        parsed.data.description,
        parsed.data.category,
        parsed.data.eventDate,
        parsed.data.location,
        parsed.data.isPublic ? 1 : 0,
        req.auth!.userId,
        new Date().toISOString()
      );
      return res.status(201).json({ success: true, message: 'School event scheduled.' });
    }
  );

  // Fees & Payments (honest Nepal eSewa/Khalti gateway adapter boundary)
  router.get('/operations/fees', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;
    let invoices = db
      .prepare(
        `SELECT f.*, s.full_name as student_name, s.student_code
         FROM fee_invoices f JOIN students s ON s.id = f.student_id
         WHERE f.school_id = ? ORDER BY f.created_at DESC`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      const childIds = new Set(
        (db.prepare(`SELECT student_id FROM student_guardians WHERE parent_user_id = ? AND school_id = ?`).all(auth.userId, schoolId) as Array<{ student_id: string }>).map(
          (x) => x.student_id
        )
      );
      invoices = invoices.filter((i) => childIds.has(String(i.student_id)));
    } else if (auth.activeRole === 'STUDENT') {
      const stu = db.prepare(`SELECT id FROM students WHERE user_id = ? AND school_id = ?`).get(auth.userId, schoolId) as { id: string } | undefined;
      invoices = stu ? invoices.filter((i) => String(i.student_id) === stu.id) : [];
    }

    return res.json({
      success: true,
      data: {
        invoices,
        gatewaysConfigured: {
          esewa: Boolean(process.env.ESEWA_MERCHANT_CODE),
          khalti: Boolean(process.env.KHALTI_SECRET_KEY),
        },
      },
    });
  });

  router.post(
    '/operations/fees',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'STAFF_ACCOUNTANT', 'STAFF_ADMIN'),
    (req, res) => {
      const schema = z.object({
        studentId: z.string().min(1),
        title: z.string().trim().min(3),
        feeType: z.enum(['TUITION', 'ADMISSION', 'EXAMINATION', 'TRANSPORT']).default('TUITION'),
        amount: z.coerce.number().positive(),
        discount: z.coerce.number().min(0).default(0),
        dueDate: z.string().min(4),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid invoice fields.', error: { code: 'VALIDATION_ERROR', details: null } });

      db.prepare(
        `INSERT INTO fee_invoices (id, school_id, student_id, title, fee_type, amount, discount, due_date, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID', ?)`
      ).run(
        `inv-${crypto.randomUUID().slice(0, 8)}`,
        req.auth!.activeSchoolId!,
        parsed.data.studentId,
        parsed.data.title,
        parsed.data.feeType,
        parsed.data.amount,
        parsed.data.discount,
        parsed.data.dueDate,
        new Date().toISOString()
      );
      return res.status(201).json({ success: true, message: 'Fee invoice generated.' });
    }
  );

  router.post('/operations/fees/:id/pay', requireAuth, requireSchoolTenant, (req, res) => {
    const gateway = z.enum(['ESEWA', 'KHALTI', 'BANK_CASH_OFFICE']).parse(req.body?.gateway || 'ESEWA');
    // Never fake online gateway success when merchant credentials are unconfigured!
    if (gateway === 'ESEWA' && !process.env.ESEWA_MERCHANT_CODE) {
      return res.status(503).json({
        success: false,
        message: 'eSewa merchant credentials (ESEWA_MERCHANT_CODE) are not configured on the server. Accounts staff can record verified cash/bank receipts directly.',
        error: { code: 'GATEWAY_NOT_CONFIGURED', details: { gateway: 'ESEWA' } },
      });
    }
    if (gateway === 'KHALTI' && !process.env.KHALTI_SECRET_KEY) {
      return res.status(503).json({
        success: false,
        message: 'Khalti secret key (KHALTI_SECRET_KEY) is not configured on the server. Accounts staff can record verified cash/bank receipts directly.',
        error: { code: 'GATEWAY_NOT_CONFIGURED', details: { gateway: 'KHALTI' } },
      });
    }
    if (gateway === 'BANK_CASH_OFFICE' && !['PRINCIPAL', 'STAFF_ACCOUNTANT', 'STAFF_ADMIN'].includes(req.auth!.activeRole)) {
      return res.status(403).json({
        success: false,
        message: 'Only school Accounts Staff or Principal can mark offline bank/cash receipts as paid.',
        error: { code: 'FORBIDDEN', details: null },
      });
    }
    const receipt = `RCP-${Date.now().toString().slice(-6)}`;
    db.prepare(
      `UPDATE fee_invoices SET status = 'PAID', gateway = ?, receipt_number = ?, paid_at = ? WHERE id = ? AND school_id = ?`
    ).run(gateway, receipt, new Date().toISOString(), req.params.id, req.auth!.activeSchoolId!);
    return res.json({ success: true, message: `Payment verified and receipt ${receipt} issued.`, data: { receiptNumber: receipt } });
  });

  // Fee Ledger CSV Export
  router.get(
    '/operations/fees/export',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'STAFF_ACCOUNTANT', 'STAFF_ADMIN'),
    (req, res) => {
      const schoolId = req.auth!.activeSchoolId!;
      const rows = db
        .prepare(
          `SELECT f.id, s.student_code, s.full_name as student_name, f.title, f.fee_type, f.amount, f.discount, f.due_date, f.status, f.gateway, f.receipt_number
           FROM fee_invoices f JOIN students s ON s.id = f.student_id
           WHERE f.school_id = ? ORDER BY f.created_at DESC`
        )
        .all(schoolId) as Array<Record<string, unknown>>;

      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = ['Invoice ID', 'Student ID', 'Student Name', 'Title', 'Type', 'Amount NPR', 'Discount NPR', 'Due Date', 'Status', 'Gateway', 'Receipt'];
      const lines = [
        header.join(','),
        ...rows.map((r) =>
          [r.id, r.student_code, r.student_name, r.title, r.fee_type, r.amount, r.discount, r.due_date, r.status, r.gateway, r.receipt_number]
            .map(esc)
            .join(',')
        ),
      ];
      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: 'FEES_CSV_EXPORTED',
        resourceType: 'FEE_INVOICE',
        metadata: { count: rows.length },
      });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="fees-${req.auth!.activeSchoolCode || 'school'}.csv"`);
      return res.send(lines.join('\n'));
    }
  );

  // School Expenses Ledger
  router.get(
    '/operations/expenses',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_ACCOUNTANT', 'STAFF_ADMIN', 'SCHOOL_ORG'),
    (req, res) => {
      const expenses = db
        .prepare(
          `SELECT e.*, u.full_name as recorded_by_name
           FROM school_expenses e JOIN global_users u ON u.id = e.recorded_by_user_id
           WHERE e.school_id = ? ORDER BY e.expense_date DESC, e.created_at DESC`
        )
        .all(req.auth!.activeSchoolId!);
      return res.json({ success: true, data: { expenses } });
    }
  );

  router.post(
    '/operations/expenses',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'STAFF_ACCOUNTANT', 'STAFF_ADMIN'),
    (req, res) => {
      const schema = z.object({
        title: z.string().trim().min(2),
        category: z.string().trim().min(2),
        amount: z.coerce.number().positive(),
        expenseDate: z.string().min(4),
        paidTo: z.string().trim().min(2),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid expense fields.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      const id = `exp-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO school_expenses (id, school_id, title, category, amount, expense_date, paid_to, recorded_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        req.auth!.activeSchoolId!,
        parsed.data.title,
        parsed.data.category,
        parsed.data.amount,
        parsed.data.expenseDate,
        parsed.data.paidTo,
        req.auth!.userId,
        new Date().toISOString()
      );
      logAuditEvent(db, {
        schoolId: req.auth!.activeSchoolId!,
        actorUserId: req.auth!.userId,
        action: 'EXPENSE_RECORDED',
        resourceType: 'EXPENSE',
        resourceId: id,
        metadata: { amount: parsed.data.amount, category: parsed.data.category },
      });
      return res.status(201).json({ success: true, message: 'School expense recorded.', data: { id } });
    }
  );

  // Inventory & Campus Assets
  router.get('/operations/inventory', requireAuth, requireSchoolTenant, (req, res) => {
    const items = db
      .prepare(`SELECT * FROM inventory_assets WHERE school_id = ? ORDER BY category, item_name`)
      .all(req.auth!.activeSchoolId!);
    return res.json({ success: true, data: { items } });
  });

  router.post(
    '/operations/inventory',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_ADMIN', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR', 'SCHOOL_ORG'),
    (req, res) => {
      const schema = z.object({
        itemName: z.string().trim().min(2),
        category: z.string().trim().min(2),
        quantity: z.coerce.number().int().min(1),
        conditionStatus: z.enum(['GOOD', 'FAIR', 'MAINTENANCE', 'RETIRED']).default('GOOD'),
        location: z.string().trim().min(2),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid inventory asset details.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      const id = `invt-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO inventory_assets (id, school_id, item_name, category, quantity, condition_status, location, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        req.auth!.activeSchoolId!,
        parsed.data.itemName,
        parsed.data.category,
        parsed.data.quantity,
        parsed.data.conditionStatus,
        parsed.data.location,
        new Date().toISOString()
      );
      return res.status(201).json({ success: true, message: 'Asset registered in school inventory.', data: { id } });
    }
  );

  router.patch(
    '/operations/inventory/:id',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_ADMIN', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR', 'SCHOOL_ORG'),
    (req, res) => {
      const parsed = z.object({ conditionStatus: z.enum(['GOOD', 'FAIR', 'MAINTENANCE', 'RETIRED']) }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid asset condition.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      const r = db
        .prepare(`UPDATE inventory_assets SET condition_status = ?, updated_at = ? WHERE id = ? AND school_id = ?`)
        .run(parsed.data.conditionStatus, new Date().toISOString(), req.params.id, req.auth!.activeSchoolId!);
      if (r.changes === 0) {
        return res.status(404).json({ success: false, message: 'Inventory item not found.', error: { code: 'NOT_FOUND', details: null } });
      }
      return res.json({ success: true, message: `Asset condition updated to ${parsed.data.conditionStatus}.` });
    }
  );

  // Reception Visitor Logs
  router.get(
    '/operations/visitors',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_RECEPTION', 'STAFF_ADMIN', 'SCHOOL_ORG'),
    (req, res) => {
      const visitors = db
        .prepare(`SELECT * FROM visitor_logs WHERE school_id = ? ORDER BY check_in_at DESC LIMIT 80`)
        .all(req.auth!.activeSchoolId!);
      return res.json({ success: true, data: { visitors } });
    }
  );

  router.post(
    '/operations/visitors',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_RECEPTION', 'STAFF_ADMIN', 'SCHOOL_ORG'),
    (req, res) => {
      const schema = z.object({
        visitorName: z.string().trim().min(2),
        visitorPhone: z.string().trim().min(7),
        purpose: z.string().trim().min(3),
        visitingPerson: z.string().trim().min(2),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid visitor fields.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      const id = `vis-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO visitor_logs (id, school_id, visitor_name, visitor_phone, purpose, visiting_person, check_in_at, recorded_by_user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        req.auth!.activeSchoolId!,
        parsed.data.visitorName,
        parsed.data.visitorPhone,
        parsed.data.purpose,
        parsed.data.visitingPerson,
        new Date().toISOString(),
        req.auth!.userId
      );
      return res.status(201).json({ success: true, message: 'Visitor checked in.', data: { id } });
    }
  );

  router.patch(
    '/operations/visitors/:id/checkout',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_RECEPTION', 'STAFF_ADMIN', 'SCHOOL_ORG'),
    (req, res) => {
      const r = db
        .prepare(`UPDATE visitor_logs SET check_out_at = ? WHERE id = ? AND school_id = ? AND check_out_at IS NULL`)
        .run(new Date().toISOString(), req.params.id, req.auth!.activeSchoolId!);
      if (r.changes === 0) {
        return res.status(404).json({ success: false, message: 'Active visitor entry not found.', error: { code: 'NOT_FOUND', details: null } });
      }
      return res.json({ success: true, message: 'Visitor check-out recorded.' });
    }
  );

  // Student Certificates (Character, Transfer, Merit)
  router.get('/operations/certificates', requireAuth, requireSchoolTenant, (req, res) => {
    const auth = req.auth!;
    const schoolId = auth.activeSchoolId!;
    let certificates = db
      .prepare(
        `SELECT c.*, s.full_name as student_name, s.student_code, cl.name as class_name, cl.section
         FROM student_certificates c
         JOIN students s ON s.id = c.student_id
         JOIN classes cl ON cl.id = s.class_id
         WHERE c.school_id = ?
         ORDER BY c.issued_at DESC`
      )
      .all(schoolId) as Array<Record<string, unknown>>;

    if (auth.activeRole === 'PARENT' || auth.activeRole === 'LEGAL_GUARDIAN') {
      const childIds = new Set(
        (db.prepare(`SELECT student_id FROM student_guardians WHERE parent_user_id = ? AND school_id = ?`).all(auth.userId, schoolId) as Array<{ student_id: string }>).map(
          (x) => x.student_id
        )
      );
      certificates = certificates.filter((c) => childIds.has(String(c.student_id)));
    } else if (auth.activeRole === 'STUDENT') {
      const stu = db.prepare(`SELECT id FROM students WHERE user_id = ? AND school_id = ?`).get(auth.userId, schoolId) as { id: string } | undefined;
      certificates = stu ? certificates.filter((c) => String(c.student_id) === stu.id) : [];
    }

    return res.json({ success: true, data: { certificates } });
  });

  router.post(
    '/operations/certificates',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_ADMIN', 'TECHNICAL_DEPT', 'SCHOOL_ORG'),
    (req, res) => {
      const schema = z.object({
        studentId: z.string().min(1),
        certificateType: z.enum(['CHARACTER', 'TRANSFER', 'STEM_MERIT', 'ATTENDANCE_HONOR']),
        remarks: z.string().trim().min(3),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid certificate details.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      const schoolId = req.auth!.activeSchoolId!;
      const stu = db.prepare(`SELECT id, full_name FROM students WHERE id = ? AND school_id = ?`).get(parsed.data.studentId, schoolId) as
        | { id: string; full_name: string }
        | undefined;
      if (!stu) {
        return res.status(403).json({ success: false, message: 'Student does not belong to your active school.', error: { code: 'FORBIDDEN', details: null } });
      }
      const id = `cert-${crypto.randomUUID().slice(0, 8)}`;
      const certNo = `CERT-${req.auth!.activeSchoolCode?.slice(0, 3) || 'SCH'}-${Date.now().toString().slice(-6)}`;
      db.prepare(
        `INSERT INTO student_certificates (id, school_id, student_id, certificate_type, certificate_number, remarks, issued_by_user_id, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, schoolId, stu.id, parsed.data.certificateType, certNo, parsed.data.remarks, req.auth!.userId, new Date().toISOString());

      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: 'CERTIFICATE_ISSUED',
        resourceType: 'CERTIFICATE',
        resourceId: certNo,
        metadata: { studentId: stu.id, certificateType: parsed.data.certificateType },
      });
      return res.status(201).json({ success: true, message: `Certificate ${certNo} issued for ${stu.full_name}.`, data: { id, certificateNumber: certNo } });
    }
  );

  // Library, Transport, Admissions, Tickets, Contacts, Audit Logs
  router.get('/operations/library', requireAuth, requireSchoolTenant, (req, res) => {
    const books = db.prepare(`SELECT * FROM library_books WHERE school_id = ? ORDER BY title`).all(req.auth!.activeSchoolId!);
    const issues = db
      .prepare(
        `SELECT bi.*, b.title as book_title, s.full_name as student_name
         FROM book_issues bi JOIN library_books b ON b.id = bi.book_id JOIN students s ON s.id = bi.student_id
         WHERE bi.school_id = ? ORDER BY bi.issued_at DESC`
      )
      .all(req.auth!.activeSchoolId!);
    return res.json({ success: true, data: { books, issues } });
  });

  router.post(
    '/operations/library',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'STAFF_LIBRARIAN'),
    (req, res) => {
      const schema = z.object({
        title: z.string().trim().min(2),
        author: z.string().trim().min(2),
        category: z.string().trim().min(2),
        isbn: z.string().trim().min(3),
        totalCopies: z.coerce.number().int().min(1),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid book details.', error: { code: 'VALIDATION_ERROR', details: null } });

      db.prepare(
        `INSERT INTO library_books (id, school_id, title, author, category, isbn, total_copies, available_copies) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(crypto.randomUUID(), req.auth!.activeSchoolId!, parsed.data.title, parsed.data.author, parsed.data.category, parsed.data.isbn, parsed.data.totalCopies, parsed.data.totalCopies);
      return res.status(201).json({ success: true, message: 'Book added to library catalog.' });
    }
  );

  router.post(
    '/operations/library/issue',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'STAFF_LIBRARIAN'),
    (req, res) => {
      const schema = z.object({
        bookId: z.string().min(1),
        studentId: z.string().min(1),
        dueDate: z.string().min(4),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid library issue fields.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      const schoolId = req.auth!.activeSchoolId!;
      const book = db
        .prepare(`SELECT id, title, available_copies FROM library_books WHERE id = ? AND school_id = ?`)
        .get(parsed.data.bookId, schoolId) as { id: string; title: string; available_copies: number } | undefined;
      if (!book) {
        return res.status(404).json({ success: false, message: 'Book not found in school catalog.', error: { code: 'NOT_FOUND', details: null } });
      }
      if (book.available_copies < 1) {
        return res.status(409).json({ success: false, message: 'No copies currently available for issue.', error: { code: 'OUT_OF_STOCK', details: null } });
      }
      const student = db
        .prepare(`SELECT id, full_name FROM students WHERE id = ? AND school_id = ?`)
        .get(parsed.data.studentId, schoolId) as { id: string; full_name: string } | undefined;
      if (!student) {
        return res.status(403).json({ success: false, message: 'Student does not belong to your active school.', error: { code: 'FORBIDDEN', details: null } });
      }

      const issueId = `iss-${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      db.exec('BEGIN');
      try {
        db.prepare(`UPDATE library_books SET available_copies = available_copies - 1 WHERE id = ? AND school_id = ?`).run(book.id, schoolId);
        db.prepare(
          `INSERT INTO book_issues (id, school_id, book_id, student_id, issued_at, due_date) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(issueId, schoolId, book.id, student.id, now, parsed.data.dueDate);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      logAuditEvent(db, {
        schoolId,
        actorUserId: req.auth!.userId,
        action: 'LIBRARY_BOOK_ISSUED',
        resourceType: 'BOOK_ISSUE',
        resourceId: issueId,
        metadata: { bookTitle: book.title, studentName: student.full_name },
      });
      return res.status(201).json({ success: true, message: `Issued "${book.title}" to ${student.full_name}.`, data: { id: issueId } });
    }
  );

  router.post(
    '/operations/library/issues/:id/return',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'STAFF_LIBRARIAN'),
    (req, res) => {
      const schoolId = req.auth!.activeSchoolId!;
      const issue = db
        .prepare(`SELECT id, book_id, returned_at FROM book_issues WHERE id = ? AND school_id = ?`)
        .get(req.params.id, schoolId) as { id: string; book_id: string; returned_at: string | null } | undefined;
      if (!issue) {
        return res.status(404).json({ success: false, message: 'Book issue record not found.', error: { code: 'NOT_FOUND', details: null } });
      }
      if (issue.returned_at) {
        return res.status(400).json({ success: false, message: 'Book has already been returned.', error: { code: 'ALREADY_RETURNED', details: null } });
      }

      const now = new Date().toISOString();
      db.exec('BEGIN');
      try {
        db.prepare(`UPDATE book_issues SET returned_at = ? WHERE id = ? AND school_id = ?`).run(now, issue.id, schoolId);
        db.prepare(
          `UPDATE library_books SET available_copies = MIN(total_copies, available_copies + 1) WHERE id = ? AND school_id = ?`
        ).run(issue.book_id, schoolId);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      return res.json({ success: true, message: 'Book return recorded and catalog inventory updated.' });
    }
  );

  router.get('/operations/transport', requireAuth, requireSchoolTenant, (req, res) => {
    const routes = db.prepare(`SELECT * FROM transport_routes WHERE school_id = ?`).all(req.auth!.activeSchoolId!);
    return res.json({ success: true, data: { routes } });
  });

  router.post(
    '/operations/transport',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_TRANSPORT', 'STAFF_ADMIN', 'SCHOOL_ORG'),
    (req, res) => {
      const schema = z.object({
        routeName: z.string().trim().min(2),
        vehicleNumber: z.string().trim().min(3),
        driverName: z.string().trim().min(2),
        driverPhone: z.string().trim().min(7),
        stops: z.string().trim().min(3),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid transport route fields.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      const id = `trn-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(
        `INSERT INTO transport_routes (id, school_id, route_name, vehicle_number, driver_name, driver_phone, stops)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        req.auth!.activeSchoolId!,
        parsed.data.routeName,
        parsed.data.vehicleNumber,
        parsed.data.driverName,
        parsed.data.driverPhone,
        parsed.data.stops
      );
      return res.status(201).json({ success: true, message: 'Transport route added.', data: { id } });
    }
  );

  router.get('/operations/admissions', requireAuth, requireSchoolTenant, (req, res) => {
    const admissions = db.prepare(`SELECT * FROM admissions WHERE school_id = ? ORDER BY created_at DESC`).all(req.auth!.activeSchoolId!);
    return res.json({ success: true, data: { admissions } });
  });

  router.post('/operations/admissions', requireAuth, requireSchoolTenant, (req, res) => {
    const schema = z.object({
      applicantName: z.string().trim().min(2),
      applyingClass: z.string().trim().min(2),
      guardianName: z.string().trim().min(2),
      guardianPhone: z.string().trim().min(7),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid admission inquiry.', error: { code: 'VALIDATION_ERROR', details: null } });
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO admissions (id, school_id, applicant_name, applying_class, guardian_name, guardian_phone, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?)`
    ).run(id, req.auth!.activeSchoolId!, parsed.data.applicantName, parsed.data.applyingClass, parsed.data.guardianName, parsed.data.guardianPhone, new Date().toISOString());
    return res.status(201).json({ success: true, message: 'Admission application submitted.', data: { id } });
  });

  router.patch(
    '/operations/admissions/:id',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_ADMIN', 'SCHOOL_ORG'),
    (req, res) => {
      const parsed = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'PENDING']) }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid admission status.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      const result = db
        .prepare(`UPDATE admissions SET status = ? WHERE id = ? AND school_id = ?`)
        .run(parsed.data.status, req.params.id, req.auth!.activeSchoolId!);
      if (result.changes === 0) {
        return res.status(404).json({ success: false, message: 'Admission application not found.', error: { code: 'NOT_FOUND', details: null } });
      }
      logAuditEvent(db, {
        schoolId: req.auth!.activeSchoolId!,
        actorUserId: req.auth!.userId,
        action: `ADMISSION_${parsed.data.status}`,
        resourceType: 'ADMISSION',
        resourceId: req.params.id,
      });
      return res.json({ success: true, message: `Admission application marked ${parsed.data.status.toLowerCase()}.` });
    }
  );

  router.get('/operations/tickets', requireAuth, requireSchoolTenant, (req, res) => {
    const tickets = db
      .prepare(
        `SELECT t.*, u.full_name as reporter_name FROM support_tickets t JOIN global_users u ON u.id = t.user_id
         WHERE t.school_id = ? ORDER BY t.created_at DESC`
      )
      .all(req.auth!.activeSchoolId!);
    return res.json({ success: true, data: { tickets } });
  });

  router.post('/operations/tickets', requireAuth, requireSchoolTenant, (req, res) => {
    const schema = z.object({
      category: z.string().trim().min(2),
      subject: z.string().trim().min(3),
      description: z.string().trim().min(5),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid support ticket.', error: { code: 'VALIDATION_ERROR', details: null } });
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO support_tickets (id, school_id, user_id, category, subject, description, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?)`
    ).run(id, req.auth!.activeSchoolId!, req.auth!.userId, parsed.data.category, parsed.data.subject, parsed.data.description, new Date().toISOString());
    return res.status(201).json({ success: true, message: 'Support ticket submitted.', data: { id } });
  });

  router.patch(
    '/operations/tickets/:id',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'VICE_PRINCIPAL', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR', 'STAFF_ADMIN', 'PLATFORM_SUPER_ADMIN'),
    (req, res) => {
      const parsed = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Invalid ticket status.', error: { code: 'VALIDATION_ERROR', details: null } });
      }
      const result = db
        .prepare(`UPDATE support_tickets SET status = ? WHERE id = ? AND school_id = ?`)
        .run(parsed.data.status, req.params.id, req.auth!.activeSchoolId!);
      if (result.changes === 0) {
        return res.status(404).json({ success: false, message: 'Support ticket not found.', error: { code: 'NOT_FOUND', details: null } });
      }
      logAuditEvent(db, {
        schoolId: req.auth!.activeSchoolId!,
        actorUserId: req.auth!.userId,
        action: `TICKET_${parsed.data.status}`,
        resourceType: 'SUPPORT_TICKET',
        resourceId: req.params.id,
      });
      return res.json({ success: true, message: `Support ticket updated to ${parsed.data.status}.` });
    }
  );

  router.get('/operations/school-contacts', requireAuth, requireSchoolTenant, (req, res) => {
    const contacts = db.prepare(`SELECT * FROM school_contacts WHERE school_id = ?`).all(req.auth!.activeSchoolId!);
    return res.json({ success: true, data: { contacts } });
  });

  router.get(
    '/operations/audit-logs',
    requireAuth,
    requireSchoolTenant,
    requireRoles('PRINCIPAL', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR', 'PLATFORM_SUPER_ADMIN'),
    (req, res) => {
      const logs = db
        .prepare(
          `SELECT a.*, u.full_name as actor_name
           FROM audit_logs a LEFT JOIN global_users u ON u.id = a.actor_user_id
           WHERE a.school_id = ? OR ? = 'PLATFORM_SUPER_ADMIN'
           ORDER BY a.created_at DESC LIMIT 80`
        )
        .all(req.auth!.activeSchoolId!, req.auth!.activeRole);
      return res.json({ success: true, data: { logs } });
    }
  );

  // ======================== AI HOMEWORK SCANNER ========================
  router.get('/ai/status', requireAuth, (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const usedToday = (
      db
        .prepare(`SELECT COUNT(*) as c FROM ai_requests WHERE user_id = ? AND created_at LIKE ?`)
        .get(req.auth!.userId, `${today}%`) as { c: number }
    ).c;
    return res.json({
      success: true,
      data: {
        providers: getAIProviderStatus(),
        dailyQuota: 25,
        usedToday,
      },
    });
  });

  router.post('/ai/homework-scan', requireAuth, rateLimit('ai-scan', 20, 60_000), async (req, res) => {
    const schema = z.object({
      questionText: z.string().trim().optional(),
      imageBase64: z.string().optional(),
      imageMimeType: z.string().optional(),
      subject: z.string().trim().min(2),
      learningMode: z.enum(['EXPLAIN', 'STEP_BY_STEP', 'HINT', 'PRACTICE', 'CHECK_ANSWER', 'EXAM_PREP', 'NEPALI', 'ENGLISH']),
      studentAnswer: z.string().optional(),
      provider: z.enum(['GEMINI', 'OPENAI']).default('GEMINI'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || (!parsed.data.questionText && !parsed.data.imageBase64)) {
      return res.status(400).json({
        success: false,
        message: 'Provide either a homework question or upload a photo/document.',
        error: { code: 'VALIDATION_ERROR', details: null },
      });
    }

    const now = new Date().toISOString();
    try {
      const result = await runHomeworkScan(parsed.data);
      db.prepare(
        `INSERT INTO ai_requests (id, school_id, user_id, provider, subject, learning_mode, prompt_summary, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'SUCCESS', ?)`
      ).run(
        crypto.randomUUID(),
        req.auth!.activeSchoolId,
        req.auth!.userId,
        parsed.data.provider,
        parsed.data.subject,
        parsed.data.learningMode,
        (parsed.data.questionText || 'Image upload').slice(0, 120),
        now
      );
      return res.json({ success: true, data: { result } });
    } catch (err: unknown) {
      const errorObj = err as { statusCode?: number; code?: string; message?: string };
      db.prepare(
        `INSERT INTO ai_requests (id, school_id, user_id, provider, subject, learning_mode, prompt_summary, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'FAILED', ?)`
      ).run(
        crypto.randomUUID(),
        req.auth!.activeSchoolId,
        req.auth!.userId,
        parsed.data.provider,
        parsed.data.subject,
        parsed.data.learningMode,
        (parsed.data.questionText || 'Image upload').slice(0, 120),
        now
      );
      return res.status(errorObj.statusCode || 502).json({
        success: false,
        message: errorObj.message || 'AI provider failed to process request.',
        error: { code: errorObj.code || 'AI_PROVIDER_ERROR', details: null },
      });
    }
  });

  // ======================== MODERATION, 3-STRIKE & APPEALS ========================
  router.get('/moderation/cases', requireAuth, (req, res) => {
    const auth = req.auth!;
    const canViewAll = auth.activeRole === 'PLATFORM_SUPER_ADMIN' || auth.activeRole === 'PLATFORM_SUPPORT' || auth.activeRole === 'PRINCIPAL';
    const cases = canViewAll
      ? db
          .prepare(
            `SELECT mc.*, u.full_name as target_name, u.strike_count as target_strikes, u.account_status as target_status
             FROM moderation_cases mc JOIN global_users u ON u.id = mc.target_user_id
             ORDER BY mc.created_at DESC`
          )
          .all()
      : db
          .prepare(
            `SELECT mc.*, u.full_name as target_name, u.strike_count as target_strikes, u.account_status as target_status
             FROM moderation_cases mc JOIN global_users u ON u.id = mc.target_user_id
             WHERE mc.target_user_id = ? OR mc.reporter_user_id = ?
             ORDER BY mc.created_at DESC`
          )
          .all(auth.userId, auth.userId);

    const appeals = canViewAll
      ? db
          .prepare(
            `SELECT ma.*, u.full_name as appellant_name, mc.content_excerpt
             FROM moderation_appeals ma
             JOIN global_users u ON u.id = ma.user_id
             JOIN moderation_cases mc ON mc.id = ma.case_id
             ORDER BY ma.created_at DESC`
          )
          .all()
      : db
          .prepare(
            `SELECT ma.*, mc.content_excerpt FROM moderation_appeals ma JOIN moderation_cases mc ON mc.id = ma.case_id WHERE ma.user_id = ? ORDER BY ma.created_at DESC`
          )
          .all(auth.userId);

    return res.json({ success: true, data: { cases, appeals } });
  });

  router.post('/moderation/report', requireAuth, (req, res) => {
    const schema = z.object({
      targetUserId: z.string().min(1),
      contentType: z.enum(['POST', 'COMMENT', 'MESSAGE', 'PROFILE']),
      contentId: z.string().optional(),
      contentExcerpt: z.string().trim().min(2),
      reason: z.string().trim().min(3),
      severity: z.enum(['STANDARD', 'CRITICAL_CHILD_SAFETY']).default('STANDARD'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid report fields.', error: { code: 'VALIDATION_ERROR', details: null } });

    const caseId = `mod-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO moderation_cases (id, school_id, target_user_id, reporter_user_id, content_type, content_id, content_excerpt, reason, severity, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`
    ).run(
      caseId,
      req.auth!.activeSchoolId,
      parsed.data.targetUserId,
      req.auth!.userId,
      parsed.data.contentType,
      parsed.data.contentId ?? null,
      parsed.data.contentExcerpt,
      parsed.data.reason,
      parsed.data.severity,
      new Date().toISOString()
    );
    return res.status(201).json({ success: true, message: 'Safety report filed for moderator review.', data: { caseId } });
  });

  router.post(
    '/moderation/cases/:id/decision',
    requireAuth,
    requireRoles('PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT', 'PRINCIPAL'),
    (req, res) => {
      const schema = z.object({
        decision: z.enum(['CONFIRM_VIOLATION', 'DISMISS']),
        note: z.string().trim().min(2),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid moderation decision.', error: { code: 'VALIDATION_ERROR', details: null } });

      const modCase = db.prepare(`SELECT * FROM moderation_cases WHERE id = ?`).get(req.params.id) as Record<string, unknown> | undefined;
      if (!modCase) return res.status(404).json({ success: false, message: 'Case not found.', error: { code: 'NOT_FOUND', details: null } });

      const now = new Date().toISOString();
      if (parsed.data.decision === 'DISMISS') {
        db.prepare(`UPDATE moderation_cases SET status = 'DISMISSED', decision_note = ? WHERE id = ?`).run(parsed.data.note, req.params.id);
        return res.json({ success: true, message: 'Case dismissed with no strike recorded.' });
      }

      const targetUser = db.prepare(`SELECT strike_count FROM global_users WHERE id = ?`).get(String(modCase.target_user_id)) as { strike_count: number };
      const evalResult = evaluateModerationStrike({
        currentStrikes: targetUser.strike_count,
        severity: String(modCase.severity) === 'CRITICAL_CHILD_SAFETY' ? 'CRITICAL_CHILD_SAFETY' : 'STANDARD',
      });

      const restrictionUntil =
        evalResult.restrictionDays > 0 ? new Date(Date.now() + evalResult.restrictionDays * 86400000).toISOString() : null;

      db.exec('BEGIN');
      try {
        db.prepare(`UPDATE moderation_cases SET status = 'CONFIRMED', decision_note = ? WHERE id = ?`).run(parsed.data.note, req.params.id);
        db.prepare(`UPDATE global_users SET strike_count = ?, account_status = ?, restriction_until = ? WHERE id = ?`).run(
          evalResult.newStrikeCount,
          evalResult.resultingStatus,
          restrictionUntil,
          String(modCase.target_user_id)
        );
        db.prepare(
          `INSERT INTO moderation_strikes (id, user_id, case_id, strike_number, action_taken, created_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(crypto.randomUUID(), String(modCase.target_user_id), req.params.id, evalResult.newStrikeCount, evalResult.actionTaken, now);

        if (modCase.content_type === 'POST' && modCase.content_id) {
          db.prepare(`UPDATE social_posts SET moderation_status = 'REMOVED' WHERE id = ?`).run(String(modCase.content_id));
        }

        if (evalResult.resultingStatus === 'BANNED') {
          db.prepare(`UPDATE user_sessions SET revoked_at = ? WHERE user_id = ?`).run(now, String(modCase.target_user_id));
        }

        db.prepare(`INSERT INTO notifications (id, user_id, category, title, body, created_at) VALUES (?, ?, 'MODERATION', ?, ?, ?)`).run(
          crypto.randomUUID(),
          String(modCase.target_user_id),
          `Safety Notice: Strike ${evalResult.newStrikeCount}`,
          `Action: ${evalResult.actionTaken}. ${parsed.data.note}`,
          now
        );
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      return res.json({
        success: true,
        message: `Violation confirmed (Strike ${evalResult.newStrikeCount} · ${evalResult.actionTaken}).`,
        data: evalResult,
      });
    }
  );

  router.post('/moderation/appeals', requireAuth, (req, res) => {
    const schema = z.object({
      caseId: z.string().min(1),
      explanation: z.string().trim().min(5),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Provide an explanation for your appeal.', error: { code: 'VALIDATION_ERROR', details: null } });

    db.prepare(
      `INSERT INTO moderation_appeals (id, user_id, case_id, explanation, status, created_at) VALUES (?, ?, ?, ?, 'PENDING', ?)`
    ).run(crypto.randomUUID(), req.auth!.userId, parsed.data.caseId, parsed.data.explanation, new Date().toISOString());

    return res.status(201).json({ success: true, message: 'Appeal submitted for review.' });
  });

  router.post(
    '/moderation/appeals/:id/review',
    requireAuth,
    requireRoles('PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT', 'PRINCIPAL'),
    (req, res) => {
      const schema = z.object({
        decision: z.enum(['APPROVE_RESTORE', 'UPHOLD']),
        note: z.string().trim().min(2),
      });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, message: 'Invalid appeal decision.', error: { code: 'VALIDATION_ERROR', details: null } });

      const appeal = db.prepare(`SELECT * FROM moderation_appeals WHERE id = ?`).get(req.params.id) as Record<string, unknown> | undefined;
      if (!appeal) return res.status(404).json({ success: false, message: 'Appeal not found.', error: { code: 'NOT_FOUND', details: null } });

      const now = new Date().toISOString();
      if (parsed.data.decision === 'UPHOLD') {
        db.prepare(`UPDATE moderation_appeals SET status = 'REJECTED', reviewer_note = ?, reviewed_at = ? WHERE id = ?`).run(parsed.data.note, now, req.params.id);
        return res.json({ success: true, message: 'Appeal reviewed and original moderation upheld.' });
      }

      const user = db.prepare(`SELECT strike_count FROM global_users WHERE id = ?`).get(String(appeal.user_id)) as { strike_count: number };
      const restored = applyAppealRestoration(user.strike_count);

      db.exec('BEGIN');
      try {
        db.prepare(`UPDATE moderation_appeals SET status = 'APPROVED', reviewer_note = ?, reviewed_at = ? WHERE id = ?`).run(parsed.data.note, now, req.params.id);
        db.prepare(`UPDATE global_users SET strike_count = ?, account_status = ?, restriction_until = NULL WHERE id = ?`).run(
          restored.newStrikeCount,
          restored.restoredStatus,
          String(appeal.user_id)
        );
        db.prepare(`UPDATE moderation_cases SET status = 'OVERTURNED' WHERE id = ?`).run(String(appeal.case_id));
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      return res.json({ success: true, message: `Appeal approved. Account status restored to ${restored.restoredStatus}.` });
    }
  );

  // ======================== SECURE PRIVATE FILE UPLOADS ========================
  router.post('/files/upload', requireAuth, upload.single('file'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded.', error: { code: 'VALIDATION_ERROR', details: null } });
    }
    const visibility = req.body?.visibility === 'PUBLIC' ? 'PUBLIC' : 'SCHOOL_PRIVATE';
    const fileId = `fil-${crypto.randomUUID().slice(0, 8)}`;
    db.prepare(
      `INSERT INTO uploaded_files (id, school_id, uploader_user_id, original_name, stored_filename, mime_type, size_bytes, visibility, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      fileId,
      req.auth!.activeSchoolId,
      req.auth!.userId,
      req.file.originalname,
      req.file.filename,
      req.file.mimetype,
      req.file.size,
      visibility,
      new Date().toISOString()
    );

    return res.status(201).json({
      success: true,
      message: 'File uploaded securely.',
      data: {
        fileId,
        url: `/api/v1/files/${fileId}`,
        originalName: req.file.originalname,
      },
    });
  });

  router.get('/files/:fileId', (req, res) => {
    const file = db.prepare(`SELECT * FROM uploaded_files WHERE id = ?`).get(req.params.fileId) as Record<string, unknown> | undefined;
    if (!file) {
      return res.status(404).json({ success: false, message: 'File not found.', error: { code: 'NOT_FOUND', details: null } });
    }
    if (String(file.visibility) !== 'PUBLIC') {
      if (!req.auth) {
        return res.status(401).json({ success: false, message: 'Sign in required to access private school file.', error: { code: 'UNAUTHORIZED', details: null } });
      }
      if (
        file.school_id &&
        String(file.school_id) !== req.auth.activeSchoolId &&
        req.auth.activeRole !== 'PLATFORM_SUPER_ADMIN'
      ) {
        return res.status(403).json({ success: false, message: 'Cross-tenant file access denied.', error: { code: 'FORBIDDEN', details: null } });
      }
    }
    const diskPath = path.join(uploadDir, String(file.stored_filename));
    if (!fs.existsSync(diskPath)) {
      return res.status(404).json({ success: false, message: 'File missing on storage.', error: { code: 'NOT_FOUND', details: null } });
    }
    res.setHeader('Content-Type', String(file.mime_type));
    return res.sendFile(diskPath);
  });

  return router;
}
