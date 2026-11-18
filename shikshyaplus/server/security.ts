import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { AccountRole, AccountStatus, SchoolStatus } from '../src/lib/domainRules';

const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update(process.env.GEMINI_API_KEY || 'shikshyaplus-dev-secret-2026').digest('hex');

export const SESSION_COOKIE_NAME = 'sp_session';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, originalHex] = parts;
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  const originalBuf = Buffer.from(originalHex, 'hex');
  if (derivedBuf.length !== originalBuf.length) return false;
  return crypto.timingSafeEqual(derivedBuf, originalBuf);
}

export function generateTemporaryPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

export function signToken(payload: string): string {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifySignedToken(signed: string): string | null {
  const idx = signed.lastIndexOf('.');
  if (idx <= 0) return null;
  const payload = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? payload : null;
}

export interface AuthSessionContext {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  username: string;
  avatarUrl: string | null;
  accountStatus: AccountStatus;
  strikeCount: number;
  mustChangePassword: boolean;
  activeMembershipId: string | null;
  activeSchoolId: string | null;
  activeSchoolCode: string | null;
  activeSchoolName: string | null;
  activeSchoolStatus: SchoolStatus | null;
  activeRole: AccountRole;
  userCode: string | null;
  memberships: Array<{
    membershipId: string;
    schoolId: string;
    schoolCode: string;
    schoolName: string;
    schoolLogo: string | null;
    schoolStatus: SchoolStatus;
    role: AccountRole;
    userCode: string;
    department: string | null;
    status: AccountStatus;
  }>;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthSessionContext;
    }
  }
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(keyPrefix: string, maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (bucket.count >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: 'Too many requests. Please wait a moment before trying again.',
        error: { code: 'RATE_LIMITED', details: null },
      });
    }
    bucket.count += 1;
    return next();
  };
}

export function logAuditEvent(
  db: DatabaseSync,
  params: {
    schoolId?: string | null;
    actorUserId?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  try {
    db.prepare(
      `INSERT INTO audit_logs (id, school_id, actor_user_id, action, resource_type, resource_id, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      params.schoolId ?? null,
      params.actorUserId ?? null,
      params.action,
      params.resourceType,
      params.resourceId ?? null,
      JSON.stringify(params.metadata ?? {}),
      new Date().toISOString()
    );
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

export function resolveSessionFromToken(db: DatabaseSync, signedCookie: string | undefined): AuthSessionContext | null {
  if (!signedCookie) return null;
  const sessionId = verifySignedToken(signedCookie);
  if (!sessionId) return null;

  const session = db
    .prepare(
      `SELECT s.id, s.user_id, s.active_membership_id, s.expires_at, s.revoked_at,
              u.email, u.full_name, u.username, u.avatar_url, u.account_status, u.strike_count, u.must_change_password, u.global_role
       FROM user_sessions s
       JOIN global_users u ON u.id = s.user_id
       WHERE s.id = ?`
    )
    .get(sessionId) as Record<string, unknown> | undefined;

  if (!session || session.revoked_at) return null;
  if (new Date(String(session.expires_at)).getTime() < Date.now()) return null;

  const membershipsRaw = db
    .prepare(
      `SELECT m.id as membership_id, m.school_id, m.role, m.user_code, m.department, m.status,
              sc.school_code, sc.name as school_name, sc.logo_url as school_logo, sc.status as school_status
       FROM school_memberships m
       JOIN schools sc ON sc.id = m.school_id
       WHERE m.user_id = ? AND m.status != 'ARCHIVED'`
    )
    .all(String(session.user_id)) as Array<Record<string, unknown>>;

  const memberships = membershipsRaw.map((m) => ({
    membershipId: String(m.membership_id),
    schoolId: String(m.school_id),
    schoolCode: String(m.school_code),
    schoolName: String(m.school_name),
    schoolLogo: m.school_logo ? String(m.school_logo) : null,
    schoolStatus: String(m.school_status) as SchoolStatus,
    role: String(m.role) as AccountRole,
    userCode: String(m.user_code),
    department: m.department ? String(m.department) : null,
    status: String(m.status) as AccountStatus,
  }));

  const active =
    memberships.find((m) => m.membershipId === String(session.active_membership_id)) ??
    memberships[0] ??
    null;

  const globalRole = session.global_role ? (String(session.global_role) as AccountRole) : null;
  const activeRole: AccountRole =
    globalRole === 'PLATFORM_SUPER_ADMIN' || globalRole === 'PLATFORM_SUPPORT'
      ? active?.role ?? globalRole
      : active?.role ?? globalRole ?? 'PARENT';

  return {
    sessionId: String(session.id),
    userId: String(session.user_id),
    email: String(session.email),
    fullName: String(session.full_name),
    username: String(session.username),
    avatarUrl: session.avatar_url ? String(session.avatar_url) : null,
    accountStatus: String(session.account_status) as AccountStatus,
    strikeCount: Number(session.strike_count ?? 0),
    mustChangePassword: Boolean(session.must_change_password),
    activeMembershipId: active ? active.membershipId : null,
    activeSchoolId: active ? active.schoolId : null,
    activeSchoolCode: active ? active.schoolCode : null,
    activeSchoolName: active ? active.schoolName : null,
    activeSchoolStatus: active ? active.schoolStatus : null,
    activeRole,
    userCode: active ? active.userCode : null,
    memberships,
  };
}

export function attachAuthMiddleware(db: DatabaseSync) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const cookie = req.cookies?.[SESSION_COOKIE_NAME];
    if (cookie) {
      const ctx = resolveSessionFromToken(db, cookie);
      if (ctx) req.auth = ctx;
    }
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please sign in.',
      error: { code: 'UNAUTHORIZED', details: null },
    });
  }
  if (req.auth.accountStatus === 'BANNED' || req.auth.accountStatus === 'SUSPENDED' || req.auth.accountStatus === 'DEACTIVATED') {
    return res.status(403).json({
      success: false,
      message: `Account is currently ${req.auth.accountStatus.toLowerCase().replace(/_/g, ' ')}. Submit an appeal or contact support.`,
      error: { code: 'ACCOUNT_RESTRICTED', details: { status: req.auth.accountStatus } },
    });
  }
  return next();
}

export function requireSchoolTenant(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
      error: { code: 'UNAUTHORIZED', details: null },
    });
  }
  if (!req.auth.activeSchoolId) {
    return res.status(403).json({
      success: false,
      message: 'No active verified school membership selected.',
      error: { code: 'NO_ACTIVE_SCHOOL', details: null },
    });
  }
  // If route has :schoolId param, validate tenant isolation strictly unless Super Admin
  const paramSchoolId = req.params.schoolId;
  if (
    paramSchoolId &&
    paramSchoolId !== req.auth.activeSchoolId &&
    req.auth.activeRole !== 'PLATFORM_SUPER_ADMIN' &&
    req.auth.activeRole !== 'PLATFORM_SUPPORT'
  ) {
    const hasMember = req.auth.memberships.some((m) => m.schoolId === paramSchoolId && m.status === 'ACTIVE');
    if (!hasMember) {
      return res.status(403).json({
        success: false,
        message: 'Cross-tenant access denied. You do not belong to this school.',
        error: { code: 'TENANT_ISOLATION_VIOLATION', details: null },
      });
    }
  }
  return next();
}

export function requireRoles(...roles: AccountRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
        error: { code: 'UNAUTHORIZED', details: null },
      });
    }
    if (!roles.includes(req.auth.activeRole)) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to perform this action.',
        error: { code: 'FORBIDDEN', details: { requiredRoles: roles, activeRole: req.auth.activeRole } },
      });
    }
    return next();
  };
}
