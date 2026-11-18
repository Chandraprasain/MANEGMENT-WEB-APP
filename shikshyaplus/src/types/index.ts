import type { AccountRole, AccountStatus, AddActionSpec, SchoolStatus } from '../lib/domainRules';

export interface SchoolMembership {
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
}

export interface AuthUser {
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
  memberships: SchoolMembership[];
}

export interface UserProfileMeta {
  bio?: string;
  address?: string;
  phone?: string;
  cover_url?: string | null;
  privacy_profile_visibility?: 'PUBLIC' | 'SCHOOL_ONLY' | 'PRIVATE';
  privacy_message_policy?: 'SCHOOL_ONLY' | 'CONNECTIONS' | 'RESTRICTED';
  preferred_language?: 'en' | 'ne';
  preferred_calendar?: 'AD' | 'BS';
}

export interface DashboardData {
  schoolInfo?: {
    id: string;
    school_code: string;
    name: string;
    school_type: string;
    district: string;
    province: string;
    country: string;
    logo_url: string | null;
    cover_url: string | null;
    status: SchoolStatus;
    principal_name: string;
    telephone: string;
    official_email: string;
  };
  stats: Record<string, number>;
  recentNotices?: Array<{
    id: string;
    title: string;
    notice_type: string;
    priority: string;
    created_at: string;
  }>;
  upcomingEvents?: Array<{
    id: string;
    title: string;
    category: string;
    event_date: string;
    location: string;
  }>;
  pendingSchoolsList?: Array<Record<string, unknown>>;
  permittedAddActions: AddActionSpec[];
}

export type AppTab =
  | 'overview'
  | 'global_feed'
  | 'my_school'
  | 'directory'
  | 'profile'
  | 'students'
  | 'staff_accounts'
  | 'academics'
  | 'learning_hub'
  | 'payments'
  | 'automation_ai'
  | 'trust_hub'
  | 'ai_scanner'
  | 'messaging'
  | 'operations'
  | 'moderation'
  | 'schools_admin';
