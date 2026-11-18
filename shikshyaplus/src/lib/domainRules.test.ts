import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAppealRestoration,
  calculateGradeAndGpa,
  calculateStudentOverallGpa,
  canAccessSchoolResource,
  canInitiateConversation,
  canPublishToAudience,
  evaluateModerationStrike,
  formatCurrency,
  formatDateByCalendar,
  getPermittedAddActions,
  isValidNepalOrIntlPhone,
  parseQrStudentPayload,
} from './domainRules';

test('tenant isolation prevents School A from accessing School B records', () => {
  assert.equal(
    canAccessSchoolResource({
      actorRole: 'PRINCIPAL',
      actorAccountStatus: 'ACTIVE',
      actorSchoolIds: ['school-a'],
      targetSchoolId: 'school-b',
    }),
    false
  );
  assert.equal(
    canAccessSchoolResource({
      actorRole: 'PRINCIPAL',
      actorAccountStatus: 'ACTIVE',
      actorSchoolIds: ['school-a'],
      targetSchoolId: 'school-a',
    }),
    true
  );
  assert.equal(
    canAccessSchoolResource({
      actorRole: 'PRINCIPAL',
      actorAccountStatus: 'BANNED',
      actorSchoolIds: ['school-a'],
      targetSchoolId: 'school-a',
    }),
    false
  );
});

test('universal Add registry enforces role permissions and restriction status', () => {
  const teacherAdds = getPermittedAddActions('TEACHER', 'ACTIVE', 'APPROVED').map((a) => a.id);
  assert.ok(teacherAdds.includes('add_student'));
  assert.ok(teacherAdds.includes('add_homework'));
  assert.ok(!teacherAdds.includes('add_school_admin'));
  assert.ok(!teacherAdds.includes('add_invoice'));

  const studentAdds = getPermittedAddActions('STUDENT', 'ACTIVE', 'APPROVED').map((a) => a.id);
  assert.ok(studentAdds.includes('ask_ai'));
  assert.ok(studentAdds.includes('create_post'));
  assert.ok(!studentAdds.includes('add_student'));

  const restrictedStudentAdds = getPermittedAddActions('STUDENT', 'TEMPORARILY_RESTRICTED', 'APPROVED').map((a) => a.id);
  assert.ok(!restrictedStudentAdds.includes('create_post'));

  const bannedAdds = getPermittedAddActions('PRINCIPAL', 'BANNED', 'APPROVED');
  assert.equal(bannedAdds.length, 0);
});

test('social audience enforcement protects student safety and suspended schools', () => {
  assert.equal(canPublishToAudience('STUDENT', 'ACTIVE', 'APPROVED', 'PUBLIC'), false);
  assert.equal(canPublishToAudience('STUDENT', 'ACTIVE', 'APPROVED', 'CLASS_COMMUNITY'), true);
  assert.equal(canPublishToAudience('PRINCIPAL', 'ACTIVE', 'APPROVED', 'PUBLIC'), true);
  assert.equal(canPublishToAudience('PRINCIPAL', 'ACTIVE', 'SUSPENDED', 'PUBLIC'), false);
});

test('child safeguarding blocks cross-school or unauthorized adult DMs to students', () => {
  const crossSchool = canInitiateConversation({
    senderRole: 'TEACHER',
    senderSchoolId: 'school-a',
    recipientRole: 'STUDENT',
    recipientSchoolId: 'school-b',
  });
  assert.equal(crossSchool.allowed, false);

  const unrelatedParent = canInitiateConversation({
    senderRole: 'PARENT',
    senderSchoolId: 'school-a',
    recipientRole: 'STUDENT',
    recipientSchoolId: 'school-a',
    isVerifiedGuardianOfStudent: false,
  });
  assert.equal(unrelatedParent.allowed, false);

  const assignedTeacher = canInitiateConversation({
    senderRole: 'TEACHER',
    senderSchoolId: 'school-a',
    recipientRole: 'STUDENT',
    recipientSchoolId: 'school-a',
    isTeacherOfStudent: true,
  });
  assert.equal(assignedTeacher.allowed, true);
});

test('grade and GPA calculation computes Nepal NEB/SEE grading scale accurately', () => {
  assert.deepEqual(calculateGradeAndGpa(94, 100, 40), {
    percentage: 94,
    grade: 'A+',
    gpa: 4.0,
    passed: true,
  });
  assert.deepEqual(calculateGradeAndGpa(32, 100, 40), {
    percentage: 32,
    grade: 'NG',
    gpa: 0,
    passed: false,
  });
});

test('three-strike moderation escalates properly and supports appeal restoration', () => {
  const s1 = evaluateModerationStrike({ currentStrikes: 0, severity: 'STANDARD' });
  assert.equal(s1.newStrikeCount, 1);
  assert.equal(s1.resultingStatus, 'ACTIVE');
  assert.equal(s1.actionTaken, 'WARNING');

  const s2 = evaluateModerationStrike({ currentStrikes: 1, severity: 'STANDARD' });
  assert.equal(s2.newStrikeCount, 2);
  assert.equal(s2.resultingStatus, 'TEMPORARILY_RESTRICTED');
  assert.equal(s2.restrictionDays, 7);

  const s3 = evaluateModerationStrike({ currentStrikes: 2, severity: 'STANDARD' });
  assert.equal(s3.newStrikeCount, 3);
  assert.equal(s3.resultingStatus, 'BANNED');

  const restored = applyAppealRestoration(3);
  assert.equal(restored.newStrikeCount, 2);
  assert.equal(restored.restoredStatus, 'TEMPORARILY_RESTRICTED');

  const critical = evaluateModerationStrike({ currentStrikes: 0, severity: 'CRITICAL_CHILD_SAFETY' });
  assert.equal(critical.resultingStatus, 'BANNED');
  assert.equal(critical.actionTaken, 'IMMEDIATE_ESCALATION_BAN');
});

test('localization helpers format BS dates, NPR currency, and Nepal phones', () => {
  assert.ok(formatDateByCalendar('2026-11-17T00:00:00Z', 'BS').startsWith('2083'));
  assert.equal(formatCurrency(12500, 'NPR'), 'NPR 12,500.00');
  assert.equal(isValidNepalOrIntlPhone('+9779841234567'), true);
  assert.equal(isValidNepalOrIntlPhone('9812345678'), true);
  assert.equal(isValidNepalOrIntlPhone('12345'), false);
});

test('QR student payload parser and overall GPA calculation work accurately', () => {
  assert.deepEqual(parseQrStudentPayload('SHIKSHYAPLUS|SUNRISE-2026|STU-001|Aarav Sharma'), {
    schoolCode: 'SUNRISE-2026',
    studentCode: 'STU-001',
  });
  assert.deepEqual(parseQrStudentPayload('stu-002'), {
    studentCode: 'STU-002',
  });
  assert.equal(parseQrStudentPayload('invalid-code'), null);

  const passedSummary = calculateStudentOverallGpa([
    { grade: 'A+', gpa: 4.0 },
    { grade: 'A', gpa: 3.6 },
  ]);
  assert.deepEqual(passedSummary, {
    averageGpa: 3.8,
    overallGrade: 'A+',
    allPassed: true,
  });

  const failedSummary = calculateStudentOverallGpa([
    { grade: 'A+', gpa: 4.0 },
    { grade: 'NG', gpa: 0 },
  ]);
  assert.deepEqual(failedSummary, {
    averageGpa: 2.0,
    overallGrade: 'NG',
    allPassed: false,
  });
});

