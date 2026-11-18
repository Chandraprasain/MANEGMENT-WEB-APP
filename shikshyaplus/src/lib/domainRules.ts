export type AccountRole =
  | 'PLATFORM_SUPER_ADMIN'
  | 'PLATFORM_SUPPORT'
  | 'SCHOOL_ORG'
  | 'PRINCIPAL'
  | 'VICE_PRINCIPAL'
  | 'TEACHER'
  | 'CLASS_TEACHER'
  | 'EXAM_OFFICER'
  | 'TECHNICAL_DEPT'
  | 'TECHNICAL_OPERATOR'
  | 'STAFF_ADMIN'
  | 'STAFF_ACCOUNTANT'
  | 'STAFF_LIBRARIAN'
  | 'STAFF_TRANSPORT'
  | 'STAFF_RECEPTION'
  | 'STAFF_SUPPORT'
  | 'STUDENT'
  | 'PARENT'
  | 'LEGAL_GUARDIAN';

export type AccountStatus =
  | 'PENDING_VERIFICATION'
  | 'INVITATION_SENT'
  | 'VERIFICATION_REQUIRED'
  | 'ACTIVE'
  | 'TEMPORARILY_RESTRICTED'
  | 'SUSPENDED'
  | 'BANNED'
  | 'ARCHIVED'
  | 'DEACTIVATED';

export type SchoolStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'SUSPENDED'
  | 'DEACTIVATED';

export type PostAudience =
  | 'PUBLIC'
  | 'GLOBAL_COMMUNITY'
  | 'CONNECTIONS'
  | 'MY_SCHOOL'
  | 'CLASS_COMMUNITY'
  | 'PRIVATE';

export interface AddActionSpec {
  id: string;
  label: string;
  description: string;
  category: 'academic' | 'accounts' | 'social' | 'operations' | 'platform';
  targetTab: string;
  modalAction: string;
}

const ALL_ADD_ACTIONS: Record<string, AddActionSpec & { roles: AccountRole[] }> = {
  add_school_admin: {
    id: 'add_school_admin',
    label: 'Verify / Add School',
    description: 'Approve pending schools or register a new institution',
    category: 'platform',
    targetTab: 'schools_admin',
    modalAction: 'add_school',
    roles: ['PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT'],
  },
  add_teacher: {
    id: 'add_teacher',
    label: 'Invite Teacher',
    description: 'Create teacher credentials and assign classes',
    category: 'accounts',
    targetTab: 'staff_accounts',
    modalAction: 'add_teacher',
    roles: ['SCHOOL_ORG', 'PRINCIPAL', 'VICE_PRINCIPAL'],
  },
  add_staff: {
    id: 'add_staff',
    label: 'Add Staff Account',
    description: 'Create departmental staff (Accounts, Library, Transport, Tech)',
    category: 'accounts',
    targetTab: 'staff_accounts',
    modalAction: 'add_staff',
    roles: ['SCHOOL_ORG', 'PRINCIPAL', 'VICE_PRINCIPAL'],
  },
  add_student: {
    id: 'add_student',
    label: 'Create Student Account',
    description: 'Enroll student and generate one-time login credentials',
    category: 'accounts',
    targetTab: 'students',
    modalAction: 'add_student',
    roles: ['SCHOOL_ORG', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR'],
  },
  import_students: {
    id: 'import_students',
    label: 'Bulk Import Students (CSV)',
    description: 'Preview, detect duplicates, and import student roster',
    category: 'accounts',
    targetTab: 'students',
    modalAction: 'import_students',
    roles: ['TECHNICAL_DEPT', 'TECHNICAL_OPERATOR', 'PRINCIPAL', 'TEACHER', 'CLASS_TEACHER'],
  },
  add_class: {
    id: 'add_class',
    label: 'Add Class / Section',
    description: 'Configure class, section, and room assignment',
    category: 'academic',
    targetTab: 'academics',
    modalAction: 'add_class',
    roles: ['SCHOOL_ORG', 'PRINCIPAL', 'VICE_PRINCIPAL'],
  },
  add_homework: {
    id: 'add_homework',
    label: 'Assign Homework',
    description: 'Publish homework with instructions and due date',
    category: 'academic',
    targetTab: 'academics',
    modalAction: 'add_homework',
    roles: ['TEACHER', 'CLASS_TEACHER', 'PRINCIPAL'],
  },
  mark_attendance: {
    id: 'mark_attendance',
    label: 'Mark Attendance',
    description: 'Record daily present, absent, late, or excused status',
    category: 'academic',
    targetTab: 'academics',
    modalAction: 'mark_attendance',
    roles: ['TEACHER', 'CLASS_TEACHER', 'PRINCIPAL'],
  },
  add_diary: {
    id: 'add_diary',
    label: 'Add Daily Diary Entry',
    description: 'Publish classwork, homework summary, and next-day notes',
    category: 'academic',
    targetTab: 'academics',
    modalAction: 'add_diary',
    roles: ['TEACHER', 'CLASS_TEACHER', 'PRINCIPAL'],
  },
  add_exam: {
    id: 'add_exam',
    label: 'Create Examination',
    description: 'Schedule examination subjects, full marks, and pass marks',
    category: 'academic',
    targetTab: 'academics',
    modalAction: 'add_exam',
    roles: ['PRINCIPAL', 'EXAM_OFFICER', 'TEACHER', 'CLASS_TEACHER'],
  },
  add_notice: {
    id: 'add_notice',
    label: 'Publish Notice',
    description: 'Send school-wide, parent, teacher, or class notice',
    category: 'operations',
    targetTab: 'operations',
    modalAction: 'add_notice',
    roles: ['SCHOOL_ORG', 'PRINCIPAL', 'VICE_PRINCIPAL', 'STAFF_ADMIN'],
  },
  add_event: {
    id: 'add_event',
    label: 'Schedule Event',
    description: 'Publish school event, exhibition, or parent meeting',
    category: 'operations',
    targetTab: 'operations',
    modalAction: 'add_event',
    roles: ['SCHOOL_ORG', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER', 'STAFF_ADMIN'],
  },
  add_invoice: {
    id: 'add_invoice',
    label: 'Create Fee Invoice',
    description: 'Generate student tuition, exam, or transport fee invoice',
    category: 'operations',
    targetTab: 'operations',
    modalAction: 'add_invoice',
    roles: ['PRINCIPAL', 'STAFF_ACCOUNTANT', 'STAFF_ADMIN'],
  },
  add_book: {
    id: 'add_book',
    label: 'Add Library Book',
    description: 'Register book in school library catalog',
    category: 'operations',
    targetTab: 'operations',
    modalAction: 'add_book',
    roles: ['STAFF_LIBRARIAN', 'PRINCIPAL'],
  },
  add_ticket: {
    id: 'add_ticket',
    label: 'Create Support Ticket',
    description: 'Log technical or administrative assistance request',
    category: 'operations',
    targetTab: 'operations',
    modalAction: 'add_ticket',
    roles: ['STAFF_SUPPORT', 'STAFF_RECEPTION', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR', 'TEACHER', 'CLASS_TEACHER', 'PRINCIPAL'],
  },
  link_child: {
    id: 'link_child',
    label: 'Link Another Child',
    description: 'Verify guardian relationship via school invitation code',
    category: 'accounts',
    targetTab: 'overview',
    modalAction: 'link_child',
    roles: ['PARENT', 'LEGAL_GUARDIAN'],
  },
  parent_request: {
    id: 'parent_request',
    label: 'Request Meeting / Leave',
    description: 'Send leave application or teacher meeting request',
    category: 'operations',
    targetTab: 'messaging',
    modalAction: 'parent_request',
    roles: ['PARENT', 'LEGAL_GUARDIAN'],
  },
  ask_ai: {
    id: 'ask_ai',
    label: 'Scan Homework with AI',
    description: 'Upload homework photo or question for guided explanation',
    category: 'academic',
    targetTab: 'ai_scanner',
    modalAction: 'ask_ai',
    roles: ['STUDENT', 'TEACHER', 'CLASS_TEACHER', 'PARENT'],
  },
  create_post: {
    id: 'create_post',
    label: 'Create Community Post',
    description: 'Share project, achievement, photo, or educational update',
    category: 'social',
    targetTab: 'my_school',
    modalAction: 'create_post',
    roles: [
      'SCHOOL_ORG', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER',
      'EXAM_OFFICER', 'STAFF_ADMIN', 'STAFF_ACCOUNTANT', 'STAFF_LIBRARIAN',
      'STUDENT', 'PARENT', 'LEGAL_GUARDIAN', 'PLATFORM_SUPER_ADMIN',
    ],
  },
  add_bank_account: {
    id: 'add_bank_account',
    label: 'Add School Bank Account',
    description: 'Register official bank account for fee settlements',
    category: 'operations',
    targetTab: 'payments',
    modalAction: 'add_bank_account',
    roles: ['SCHOOL_ORG', 'PRINCIPAL', 'STAFF_ACCOUNTANT'],
  },
  add_assessment: {
    id: 'add_assessment',
    label: 'Create CBT / Quiz Assessment',
    description: 'Build online timed exam or question bank paper',
    category: 'academic',
    targetTab: 'learning_hub',
    modalAction: 'add_assessment',
    roles: ['PRINCIPAL', 'EXAM_OFFICER', 'TEACHER', 'CLASS_TEACHER'],
  },
  add_workflow: {
    id: 'add_workflow',
    label: 'Build Automation Workflow',
    description: 'Automate alerts and follow-ups with human approval gates',
    category: 'operations',
    targetTab: 'automation_ai',
    modalAction: 'add_workflow',
    roles: ['SCHOOL_ORG', 'PRINCIPAL', 'VICE_PRINCIPAL', 'TECHNICAL_DEPT'],
  },
  add_safeguarding: {
    id: 'add_safeguarding',
    label: 'Confidential Safety Report',
    description: 'Report bullying, wellbeing, or safeguarding concern privately',
    category: 'operations',
    targetTab: 'trust_hub',
    modalAction: 'add_safeguarding',
    roles: [
      'PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER',
      'STUDENT', 'PARENT', 'LEGAL_GUARDIAN', 'STAFF_SUPPORT',
    ],
  },
};

export function getPermittedAddActions(
  role: AccountRole,
  accountStatus: AccountStatus,
  schoolStatus?: SchoolStatus | null
): AddActionSpec[] {
  if (accountStatus === 'BANNED' || accountStatus === 'SUSPENDED' || accountStatus === 'DEACTIVATED' || accountStatus === 'ARCHIVED') {
    return [];
  }
  const restrictedSocialOnly = accountStatus === 'TEMPORARILY_RESTRICTED';
  const schoolBlocked = schoolStatus === 'SUSPENDED' || schoolStatus === 'REJECTED' || schoolStatus === 'DEACTIVATED';

  return Object.values(ALL_ADD_ACTIONS)
    .filter((spec) => {
      if (!spec.roles.includes(role)) return false;
      if (restrictedSocialOnly && spec.category === 'social') return false;
      if (schoolBlocked && spec.category !== 'platform') return false;
      return true;
    })
    .map(({ roles: _roles, ...rest }) => rest);
}

export function canAccessSchoolResource(params: {
  actorRole: AccountRole;
  actorAccountStatus: AccountStatus;
  actorSchoolIds: string[];
  targetSchoolId: string;
}): boolean {
  const { actorRole, actorAccountStatus, actorSchoolIds, targetSchoolId } = params;
  if (actorAccountStatus === 'BANNED' || actorAccountStatus === 'SUSPENDED' || actorAccountStatus === 'DEACTIVATED') {
    return false;
  }
  if (actorRole === 'PLATFORM_SUPER_ADMIN' || actorRole === 'PLATFORM_SUPPORT') {
    return true;
  }
  return actorSchoolIds.includes(targetSchoolId);
}

export function getAllowedAudiencesForRole(role: AccountRole): PostAudience[] {
  switch (role) {
    case 'PLATFORM_SUPER_ADMIN':
    case 'SCHOOL_ORG':
    case 'PRINCIPAL':
    case 'VICE_PRINCIPAL':
    case 'TEACHER':
    case 'CLASS_TEACHER':
      return ['MY_SCHOOL', 'CLASS_COMMUNITY', 'GLOBAL_COMMUNITY', 'PUBLIC', 'CONNECTIONS', 'PRIVATE'];
    case 'PARENT':
    case 'LEGAL_GUARDIAN':
    case 'STAFF_ADMIN':
    case 'STAFF_ACCOUNTANT':
    case 'STAFF_LIBRARIAN':
    case 'STAFF_TRANSPORT':
    case 'STAFF_RECEPTION':
    case 'STAFF_SUPPORT':
      return ['MY_SCHOOL', 'CONNECTIONS', 'GLOBAL_COMMUNITY', 'PRIVATE'];
    case 'STUDENT':
      // Child safeguarding: students publish inside moderated school/class or supervised global educational projects
      return ['CLASS_COMMUNITY', 'MY_SCHOOL', 'GLOBAL_COMMUNITY'];
    default:
      return ['MY_SCHOOL'];
  }
}

export function canPublishToAudience(
  role: AccountRole,
  accountStatus: AccountStatus,
  schoolStatus: SchoolStatus | null,
  audience: PostAudience
): boolean {
  if (accountStatus !== 'ACTIVE') return false;
  if (schoolStatus && schoolStatus !== 'APPROVED' && role !== 'PLATFORM_SUPER_ADMIN') return false;
  return getAllowedAudiencesForRole(role).includes(audience);
}

export function canInitiateConversation(params: {
  senderRole: AccountRole;
  senderSchoolId: string | null;
  recipientRole: AccountRole;
  recipientSchoolId: string | null;
  isVerifiedGuardianOfStudent?: boolean;
  isTeacherOfStudent?: boolean;
  isBlocked?: boolean;
}): { allowed: boolean; reason?: string } {
  const {
    senderRole,
    senderSchoolId,
    recipientRole,
    recipientSchoolId,
    isVerifiedGuardianOfStudent,
    isTeacherOfStudent,
    isBlocked,
  } = params;

  if (isBlocked) {
    return { allowed: false, reason: 'Communication blocked by user safety settings.' };
  }

  // Child safeguarding: adults outside a student's school or unrelated adults cannot DM students directly
  if (recipientRole === 'STUDENT' || senderRole === 'STUDENT') {
    if (!senderSchoolId || senderSchoolId !== recipientSchoolId) {
      return { allowed: false, reason: 'Cross-school direct messaging with students is prohibited for safeguarding.' };
    }
    const otherRole = recipientRole === 'STUDENT' ? senderRole : recipientRole;
    if (otherRole === 'PARENT' || otherRole === 'LEGAL_GUARDIAN') {
      if (!isVerifiedGuardianOfStudent) {
        return { allowed: false, reason: 'Only verified guardians can message their linked student.' };
      }
    } else if (otherRole === 'TEACHER' || otherRole === 'CLASS_TEACHER' || otherRole === 'PRINCIPAL') {
      if (otherRole !== 'PRINCIPAL' && !isTeacherOfStudent) {
        return { allowed: false, reason: 'Teachers may only message students in their assigned classes.' };
      }
    } else if (otherRole !== 'STUDENT') {
      return { allowed: false, reason: 'Restricted staff role cannot initiate direct messages with students.' };
    }
  }

  // School internal / parent-teacher messaging requires matching school or verified connection
  if (senderSchoolId && recipientSchoolId && senderSchoolId === recipientSchoolId) {
    return { allowed: true };
  }

  if (senderRole === 'PLATFORM_SUPER_ADMIN' || senderRole === 'PLATFORM_SUPPORT') {
    return { allowed: true };
  }

  return { allowed: false, reason: 'Direct messaging across schools requires an approved educational collaboration.' };
}

export interface GradeResult {
  percentage: number;
  grade: string;
  gpa: number;
  passed: boolean;
}

export function calculateGradeAndGpa(
  obtainedMarks: number,
  fullMarks: number,
  passMarks: number
): GradeResult {
  if (fullMarks <= 0) {
    return { percentage: 0, grade: 'NG', gpa: 0, passed: false };
  }
  const percentage = Math.round((obtainedMarks / fullMarks) * 10000) / 100;
  const passed = obtainedMarks >= passMarks;
  if (!passed) {
    return { percentage, grade: 'NG', gpa: 0, passed: false };
  }
  if (percentage >= 90) return { percentage, grade: 'A+', gpa: 4.0, passed: true };
  if (percentage >= 80) return { percentage, grade: 'A', gpa: 3.6, passed: true };
  if (percentage >= 70) return { percentage, grade: 'B+', gpa: 3.2, passed: true };
  if (percentage >= 60) return { percentage, grade: 'B', gpa: 2.8, passed: true };
  if (percentage >= 50) return { percentage, grade: 'C+', gpa: 2.4, passed: true };
  if (percentage >= 40) return { percentage, grade: 'C', gpa: 2.0, passed: true };
  return { percentage, grade: 'D', gpa: 1.6, passed: true };
}

export interface ModerationEvaluation {
  newStrikeCount: number;
  resultingStatus: AccountStatus;
  actionTaken: 'WARNING' | 'TEMP_RESTRICT_7D' | 'BANNED' | 'IMMEDIATE_ESCALATION_BAN';
  restrictionDays: number;
}

export function evaluateModerationStrike(params: {
  currentStrikes: number;
  severity: 'STANDARD' | 'CRITICAL_CHILD_SAFETY';
}): ModerationEvaluation {
  if (params.severity === 'CRITICAL_CHILD_SAFETY') {
    return {
      newStrikeCount: 3,
      resultingStatus: 'BANNED',
      actionTaken: 'IMMEDIATE_ESCALATION_BAN',
      restrictionDays: 0,
    };
  }
  const next = params.currentStrikes + 1;
  if (next === 1) {
    return {
      newStrikeCount: 1,
      resultingStatus: 'ACTIVE',
      actionTaken: 'WARNING',
      restrictionDays: 0,
    };
  }
  if (next === 2) {
    return {
      newStrikeCount: 2,
      resultingStatus: 'TEMPORARILY_RESTRICTED',
      actionTaken: 'TEMP_RESTRICT_7D',
      restrictionDays: 7,
    };
  }
  return {
    newStrikeCount: Math.max(3, next),
    resultingStatus: 'BANNED',
    actionTaken: 'BANNED',
    restrictionDays: 0,
  };
}

export function applyAppealRestoration(currentStrikes: number): {
  newStrikeCount: number;
  restoredStatus: AccountStatus;
} {
  const next = Math.max(0, currentStrikes - 1);
  if (next >= 3) {
    return { newStrikeCount: next, restoredStatus: 'BANNED' };
  }
  if (next === 2) {
    return { newStrikeCount: next, restoredStatus: 'TEMPORARILY_RESTRICTED' };
  }
  return { newStrikeCount: next, restoredStatus: 'ACTIVE' };
}

// Accurate approximate AD -> BS conversion for modern academic years (2024-2027)
const BS_MONTH_NAMES = [
  'Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
];

export function formatDateByCalendar(isoDate: string, calendar: 'AD' | 'BS'): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  if (calendar === 'AD') {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
  // Offset from April 14 (approx Baisakh 1) -> BS year = AD + 56 or 57
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-11
  const day = d.getUTCDate();
  const afterMidApril = month > 3 || (month === 3 && day >= 14);
  const bsYear = afterMidApril ? year + 57 : year + 56;
  const bsMonthIdx = (month + 8 + (day >= 15 ? 1 : 0)) % 12;
  const bsDay = ((day + 16) % 30) + 1;
  return `${bsYear} ${BS_MONTH_NAMES[bsMonthIdx]} ${bsDay}`;
}

export function formatCurrency(amount: number, currency: 'NPR' | 'USD' = 'NPR'): string {
  if (currency === 'USD') {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `NPR ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function isValidNepalOrIntlPhone(phone: string): boolean {
  const cleaned = phone.replace(/[\s-]/g, '');
  // Nepal mobile (+97798XXXXXXXX or 98XXXXXXXX or 97XXXXXXXX) or international E.164
  return /^(\+977)?9[78]\d{8}$/.test(cleaned) || /^\+[1-9]\d{7,14}$/.test(cleaned);
}

export function isTeacherRole(role: AccountRole): boolean {
  return role === 'TEACHER' || role === 'CLASS_TEACHER';
}

export function isPrincipalOrAdminRole(role: AccountRole): boolean {
  return role === 'PRINCIPAL' || role === 'VICE_PRINCIPAL' || role === 'SCHOOL_ORG';
}

export function isStaffRole(role: AccountRole): boolean {
  return role.startsWith('STAFF_') || role === 'EXAM_OFFICER';
}

export function isTechnicalRole(role: AccountRole): boolean {
  return role === 'TECHNICAL_DEPT' || role === 'TECHNICAL_OPERATOR';
}

export interface ParsedStudentQr {
  schoolCode?: string;
  studentCode: string;
}

export function parseQrStudentPayload(raw: string): ParsedStudentQr | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.toUpperCase().startsWith('SHIKSHYAPLUS|')) {
    const parts = trimmed.split('|').map((p) => p.trim());
    const schoolCode = parts[1] ? parts[1].toUpperCase() : undefined;
    const studentCode = parts[2] ? parts[2].toUpperCase() : '';
    if (!studentCode) return null;
    return { schoolCode, studentCode };
  }
  const codeMatch = trimmed.toUpperCase().match(/^(STU-\d{2,6})$/);
  if (codeMatch) {
    return { studentCode: codeMatch[1] };
  }
  return null;
}

export function calculateStudentOverallGpa(
  marks: Array<{ gpa: number; grade: string }>
): { averageGpa: number; overallGrade: string; allPassed: boolean } {
  if (marks.length === 0) {
    return { averageGpa: 0, overallGrade: 'NG', allPassed: false };
  }
  const allPassed = marks.every((m) => m.grade !== 'NG' && Number(m.gpa) > 0);
  const sum = marks.reduce((acc, m) => acc + Number(m.gpa || 0), 0);
  const averageGpa = Math.round((sum / marks.length) * 100) / 100;
  if (!allPassed) {
    return { averageGpa, overallGrade: 'NG', allPassed: false };
  }
  let overallGrade = 'D';
  if (averageGpa >= 3.65) overallGrade = 'A+';
  else if (averageGpa >= 3.25) overallGrade = 'A';
  else if (averageGpa >= 2.85) overallGrade = 'B+';
  else if (averageGpa >= 2.45) overallGrade = 'B';
  else if (averageGpa >= 2.05) overallGrade = 'C+';
  else if (averageGpa >= 1.65) overallGrade = 'C';
  return { averageGpa, overallGrade, allPassed: true };
}

