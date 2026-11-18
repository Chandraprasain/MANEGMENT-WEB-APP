import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Calendar,
  CheckCircle2,
  CreditCard,
  GraduationCap,
  Link2,
  Plus,
  School,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { AddActionSpec } from '../lib/domainRules';
import { formatCurrency, formatDateByCalendar } from '../lib/domainRules';
import { apiGet, apiMutate } from '../lib/api';
import type { AppTab, AuthUser, DashboardData } from '../types';

interface RoleDashboardProps {
  user: AuthUser;
  dashboard: DashboardData | null;
  calendar: 'AD' | 'BS';
  onNavigate: (tab: AppTab) => void;
  onTriggerAdd: (action: AddActionSpec) => void;
  onRefreshDashboard: () => void;
}

export const RoleDashboard: React.FC<RoleDashboardProps> = ({
  user,
  dashboard,
  calendar,
  onNavigate,
  onTriggerAdd,
  onRefreshDashboard,
}) => {
  const [children, setChildren] = useState<Array<Record<string, unknown>>>([]);
  const [parentRequests, setParentRequests] = useState<Array<Record<string, unknown>>>([]);
  const [reqForm, setReqForm] = useState({
    studentId: '',
    requestType: 'LEAVE' as 'LEAVE' | 'MEETING' | 'CORRECTION',
    subject: '',
    details: '',
    requestedDate: new Date().toISOString().slice(0, 10),
  });
  const [reqStatus, setReqStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [relationship, setRelationship] = useState('Mother');
  const [linkStatus, setLinkStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [verifyingSchoolId, setVerifyingSchoolId] = useState<string | null>(null);
  const [hideWelcomeBanner, setHideWelcomeBanner] = useState<boolean>(
    () => typeof window !== 'undefined' && localStorage.getItem('sp_hide_welcome_banner') === '1'
  );

  const isParent = user.activeRole === 'PARENT' || user.activeRole === 'LEGAL_GUARDIAN';
  const isSuperAdmin = user.activeRole === 'PLATFORM_SUPER_ADMIN' || user.activeRole === 'PLATFORM_SUPPORT';
  const canReviewRequests = ['PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'TEACHER', 'CLASS_TEACHER'].includes(user.activeRole);

  const loadParentData = async () => {
    if (isParent) {
      const chRes = await apiGet<{ children: Array<Record<string, unknown>> }>('/parents/children', 'parent:children');
      if (chRes.success && chRes.data) {
        setChildren(chRes.data.children);
        if (chRes.data.children[0]) {
          setReqForm((p) => ({ ...p, studentId: p.studentId || String(chRes.data!.children[0].id) }));
        }
      }
    }
    if ((isParent || canReviewRequests) && user.activeSchoolId) {
      const reqRes = await apiGet<{ requests: Array<Record<string, unknown>> }>('/parents/requests', `parent:requests:${user.activeSchoolId}`);
      if (reqRes.success && reqRes.data) setParentRequests(reqRes.data.requests);
    }
  };

  useEffect(() => {
    loadParentData();
  }, [isParent, canReviewRequests, user.activeSchoolId]);

  const handleLinkChild = async (e: React.FormEvent) => {
    e.preventDefault();
    setLinkStatus(null);
    const res = await apiMutate('/parents/link-child', 'POST', { invitationCode: inviteCode.trim(), relationship });
    if (res.success) {
      setLinkStatus({ ok: true, msg: res.message || 'Child linked!' });
      setInviteCode('');
      await loadParentData();
      onRefreshDashboard();
    } else {
      setLinkStatus({ ok: false, msg: res.message || 'Invalid invitation code.' });
    }
  };

  const handleSubmitParentRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setReqStatus(null);
    const res = await apiMutate('/parents/requests', 'POST', reqForm, { queueIfOffline: true, offlineLabel: 'Parent Request' });
    setReqStatus({ ok: res.success, msg: res.message || (res.success ? 'Request submitted.' : 'Failed to submit request.') });
    if (res.success) {
      setReqForm((p) => ({ ...p, subject: '', details: '' }));
      await loadParentData();
    }
  };

  const handleReviewParentRequest = async (reqId: string, status: 'APPROVED' | 'DECLINED') => {
    const res = await apiMutate(`/parents/requests/${reqId}`, 'PATCH', { status });
    if (res.success) await loadParentData();
  };

  const handleSchoolDecision = async (schoolId: string, status: 'APPROVED' | 'REJECTED' | 'SUSPENDED') => {
    setVerifyingSchoolId(schoolId);
    try {
      await apiMutate(`/schools/${schoolId}/verify`, 'POST', {
        status,
        reason: status === 'REJECTED' ? 'Please upload clearer registration certificates.' : undefined,
      });
      onRefreshDashboard();
    } finally {
      setVerifyingSchoolId(null);
    }
  };

  const stats = dashboard?.stats || {};
  const schoolInfo = dashboard?.schoolInfo;
  const actions = dashboard?.permittedAddActions || [];

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          {schoolInfo?.logo_url ? (
            <img
              src={schoolInfo.logo_url}
              alt={`${schoolInfo.name} logo`}
              referrerPolicy="no-referrer"
              className="h-14 w-14 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#0F1E36] text-white shrink-0">
              <GraduationCap className="h-7 w-7" />
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {user.activeRole.replace(/_/g, ' ')}
              {schoolInfo ? ` · ${schoolInfo.school_code} · ${schoolInfo.district}` : ' · Global Identity'}
            </p>
            <h1 className="mt-0.5 text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              Welcome back, {user.fullName}
            </h1>
            {schoolInfo && schoolInfo.status !== 'APPROVED' && (
              <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>School verification status: {schoolInfo.status} (publishing restricted until approved)</span>
              </p>
            )}
          </div>
        </div>

        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions.slice(0, 3).map((act) => (
              <button
                key={act.id}
                type="button"
                onClick={() => onTriggerAdd(act)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:border-blue-600 hover:text-blue-700 dark:hover:text-cyan-300 transition-colors min-h-[40px]"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{act.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!hideWelcomeBanner && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 px-4 py-3 text-xs text-slate-700 dark:text-slate-200">
          <div className="flex items-start sm:items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-cyan-400 shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
            <span>
              Your workspace runs with strict school-tenant isolation and automatic offline caching for diary, results, and drafts.
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              localStorage.setItem('sp_hide_welcome_banner', '1');
              setHideWelcomeBanner(true);
            }}
            className="text-[11px] font-semibold text-blue-700 dark:text-cyan-300 hover:underline self-end sm:self-center shrink-0"
          >
            Don&apos;t show again
          </button>
        </div>
      )}

      {/* Super Admin Platform Overview */}
      {isSuperAdmin ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Total Schools" value={stats.totalSchools ?? 0} icon={<School className="h-4 w-4 text-blue-600" />} />
            <MetricCard label="Pending Approvals" value={stats.pendingSchools ?? 0} icon={<AlertTriangle className="h-4 w-4 text-amber-600" />} />
            <MetricCard label="Verified Schools" value={stats.verifiedSchools ?? 0} icon={<ShieldCheck className="h-4 w-4 text-emerald-600" />} />
            <MetricCard label="Open Moderation" value={stats.openModerationCases ?? 0} icon={<Users className="h-4 w-4 text-cyan-600" />} />
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">School Verification Queue</h2>
              <button type="button" onClick={() => onNavigate('schools_admin')} className="text-xs font-medium text-blue-600 dark:text-cyan-400 hover:underline">
                Open Full Console
              </button>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {(dashboard?.pendingSchoolsList || []).map((s) => (
                <div key={String(s.id)} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{String(s.name)}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      {String(s.school_code)} · {String(s.district)}, {String(s.province)} · Status: {String(s.status)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {String(s.status) !== 'APPROVED' && (
                      <button
                        type="button"
                        disabled={verifyingSchoolId === String(s.id)}
                        onClick={() => handleSchoolDecision(String(s.id), 'APPROVED')}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 min-h-[36px]"
                      >
                        Approve
                      </button>
                    )}
                    {String(s.status) === 'PENDING' && (
                      <button
                        type="button"
                        disabled={verifyingSchoolId === String(s.id)}
                        onClick={() => handleSchoolDecision(String(s.id), 'REJECTED')}
                        className="rounded-lg border border-red-300 dark:border-red-800 px-3 py-1.5 text-xs font-semibold text-red-700 dark:text-red-300 hover:bg-red-50 min-h-[36px]"
                      >
                        Reject
                      </button>
                    )}
                    {String(s.status) === 'APPROVED' && (
                      <button
                        type="button"
                        disabled={verifyingSchoolId === String(s.id)}
                        onClick={() => handleSchoolDecision(String(s.id), 'SUSPENDED')}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 min-h-[36px]"
                      >
                        Suspend
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Role-Scoped KPI Strip */}
          {isParent ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Verified Children" value={stats.linkedChildren ?? children.length} icon={<Users className="h-4 w-4 text-blue-600" />} />
              <MetricCard label="Active Homework" value={stats.pendingHomework ?? 0} icon={<BookOpen className="h-4 w-4 text-indigo-600" />} />
              <MetricCard label="Pending Requests" value={stats.openParentRequests ?? 0} icon={<Calendar className="h-4 w-4 text-cyan-600" />} />
              <MetricCard
                label="Children Fees Due"
                value={formatCurrency(stats.outstandingFees ?? 0, 'NPR')}
                icon={<CreditCard className="h-4 w-4 text-emerald-600" />}
              />
            </div>
          ) : user.activeRole === 'STUDENT' ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Active Homework" value={stats.pendingHomework ?? 0} icon={<BookOpen className="h-4 w-4 text-indigo-600" />} />
              <MetricCard label="Upcoming Exams" value={stats.upcomingExams ?? 0} icon={<GraduationCap className="h-4 w-4 text-cyan-600" />} />
              <MetricCard label="School Notices" value={dashboard?.recentNotices?.length ?? 0} icon={<Users className="h-4 w-4 text-blue-600" />} />
              <MetricCard
                label="Fees Due"
                value={formatCurrency(stats.outstandingFees ?? 0, 'NPR')}
                icon={<CreditCard className="h-4 w-4 text-emerald-600" />}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard label="Students Enrolled" value={stats.totalStudents ?? 0} icon={<Users className="h-4 w-4 text-blue-600" />} />
              <MetricCard label="Teachers & Staff" value={(stats.totalTeachers ?? 0) + (stats.totalStaff ?? 0)} icon={<GraduationCap className="h-4 w-4 text-cyan-600" />} />
              <MetricCard label="Active Homework" value={stats.pendingHomework ?? 0} icon={<BookOpen className="h-4 w-4 text-indigo-600" />} />
              <MetricCard
                label="Fees Collected"
                value={formatCurrency(stats.collectedFees ?? 0, 'NPR')}
                icon={<CreditCard className="h-4 w-4 text-emerald-600" />}
              />
            </div>
          )}

          {/* School Analytics Pulse (Staff & Leadership) */}
          {!isParent && user.activeRole !== 'STUDENT' && user.activeSchoolId && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Attendance Pulse</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    {stats.attendanceRate ?? 100}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, stats.attendanceRate ?? 100))}%` }}
                  />
                </div>
                <div className="text-[11px] text-slate-500">
                  {stats.presentToday ?? 0} present · {stats.absentToday ?? 0} absent recorded
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Fee Collection Rate</span>
                  <span className="font-mono font-bold text-blue-600 dark:text-cyan-400">
                    {stats.feeCollectionRate ?? 100}%
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-blue-600 dark:bg-cyan-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, stats.feeCollectionRate ?? 100))}%` }}
                  />
                </div>
                <div className="text-[11px] text-slate-500">
                  Due outstanding: {formatCurrency(stats.outstandingFees ?? 0, 'NPR')}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Revenue vs Expenses</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {formatCurrency((stats.collectedFees ?? 0) - (stats.totalExpenses ?? 0), 'NPR')}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-500 transition-all"
                    style={{
                      width: `${
                        (stats.collectedFees ?? 0) + (stats.totalExpenses ?? 0) > 0
                          ? Math.min(
                              100,
                              Math.round(
                                ((stats.totalExpenses ?? 0) /
                                  Math.max(1, (stats.collectedFees ?? 0) + (stats.totalExpenses ?? 0))) *
                                  100
                              )
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>
                <div className="text-[11px] text-slate-500">
                  Expenses: {formatCurrency(stats.totalExpenses ?? 0, 'NPR')}
                </div>
              </div>
            </div>
          )}

          {/* Parent Verified Children & Linker */}
          {isParent && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">My Verified Children</h2>
                {children.length === 0 ? (
                  <p className="text-sm text-slate-500">No children linked yet. Enter your school’s invitation code on the right.</p>
                ) : (
                  <div className="space-y-3">
                    {children.map((ch) => (
                      <div key={String(ch.id)} className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">{String(ch.full_name)}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {String(ch.school_name)} · {String(ch.class_name)}-{String(ch.section)} · Roll #{String(ch.roll_number)} · {String(ch.student_code)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onNavigate('academics')}
                          className="inline-flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-blue-600 hover:text-white transition-colors"
                        >
                          <span>Academics</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                <div className="flex items-center gap-2 mb-2">
                  <Link2 className="h-4 w-4 text-blue-600" aria-hidden="true" />
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">Link Verified Child</h2>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  Enter the one-time invitation code issued by your school (demo code: <span className="font-mono font-semibold">INV-SUN-102</span>).
                </p>
                <form onSubmit={handleLinkChild} className="space-y-3">
                  <div>
                    <label htmlFor="link-invite-code" className="block text-xs font-medium mb-1">Invitation Code</label>
                    <input
                      id="link-invite-code"
                      required
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      placeholder="INV-SUN-102"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono uppercase min-h-[42px]"
                    />
                  </div>
                  <div>
                    <label htmlFor="link-relationship" className="block text-xs font-medium mb-1">Relationship</label>
                    <select
                      id="link-relationship"
                      value={relationship}
                      onChange={(e) => setRelationship(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]"
                    >
                      <option value="Mother">Mother</option>
                      <option value="Father">Father</option>
                      <option value="Legal Guardian">Legal Guardian</option>
                    </select>
                  </div>
                  {linkStatus && (
                    <div className={`text-xs flex items-center gap-1.5 ${linkStatus.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>{linkStatus.msg}</span>
                    </div>
                  )}
                  <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white hover:bg-[#193054] min-h-[42px]">
                    Verify & Link Child
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Parent Leave / Meeting / Record Correction Requests */}
          {(isParent || (canReviewRequests && parentRequests.length > 0)) && user.activeSchoolId && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className={isParent ? 'lg:col-span-7' : 'lg:col-span-12'}>
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                  <h2 className="text-base font-bold text-slate-900 dark:text-white mb-3">
                    {isParent ? 'My Leave, Meeting & Correction Requests' : 'Parent Leave & Meeting Requests'}
                  </h2>
                  {parentRequests.length === 0 ? (
                    <p className="text-sm text-slate-500">No requests submitted yet.</p>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {parentRequests.map((r) => (
                        <div key={String(r.id)} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                          <div>
                            <div className="text-sm font-semibold text-slate-900 dark:text-white">
                              {String(r.subject)} · {String(r.student_name)}
                            </div>
                            <p className="mt-0.5 text-slate-600 dark:text-slate-300">{String(r.details)}</p>
                            <div className="mt-0.5 text-slate-500 font-mono">
                              {String(r.request_type)} · {r.requested_date ? formatDateByCalendar(String(r.requested_date), calendar) : ''} · {String(r.status)}
                            </div>
                          </div>
                          {canReviewRequests && String(r.status) === 'PENDING' && (
                            <div className="flex gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleReviewParentRequest(String(r.id), 'APPROVED')}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReviewParentRequest(String(r.id), 'DECLINED')}
                                className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium"
                              >
                                Decline
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {isParent && children.length > 0 && (
                <form onSubmit={handleSubmitParentRequest} className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Submit Request to School</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={reqForm.studentId}
                      onChange={(e) => setReqForm({ ...reqForm, studentId: e.target.value })}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs"
                    >
                      {children.map((ch) => (
                        <option key={String(ch.id)} value={String(ch.id)}>
                          {String(ch.full_name)}
                        </option>
                      ))}
                    </select>
                    <select
                      value={reqForm.requestType}
                      onChange={(e) => setReqForm({ ...reqForm, requestType: e.target.value as 'LEAVE' | 'MEETING' | 'CORRECTION' })}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs"
                    >
                      <option value="LEAVE">Student Leave</option>
                      <option value="MEETING">Teacher Meeting</option>
                      <option value="CORRECTION">Record Correction</option>
                    </select>
                  </div>
                  <input
                    required
                    placeholder="Subject (e.g. Medical Leave Request)"
                    value={reqForm.subject}
                    onChange={(e) => setReqForm({ ...reqForm, subject: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
                  />
                  <input
                    type="date"
                    value={reqForm.requestedDate}
                    onChange={(e) => setReqForm({ ...reqForm, requestedDate: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  />
                  <textarea
                    required
                    rows={2}
                    placeholder="Details for Principal / Class Teacher..."
                    value={reqForm.details}
                    onChange={(e) => setReqForm({ ...reqForm, details: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  />
                  {reqStatus && (
                    <div className={`text-xs ${reqStatus.ok ? 'text-emerald-600' : 'text-red-600'}`}>{reqStatus.msg}</div>
                  )}
                  <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white min-h-[42px]">
                    Submit Request
                  </button>
                </form>
              )}
            </div>
          )}

          {/* Notices & Upcoming Events */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Official School Notices</h2>
                <button type="button" onClick={() => onNavigate('operations')} className="text-xs font-medium text-blue-600 dark:text-cyan-400 hover:underline">
                  View All
                </button>
              </div>
              {!dashboard?.recentNotices || dashboard.recentNotices.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">No notices published yet.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {dashboard.recentNotices.map((n) => (
                    <div key={n.id} className="py-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{n.title}</h3>
                        <span className="text-[11px] font-mono text-slate-500 shrink-0">{formatDateByCalendar(n.created_at, calendar)}</span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {n.notice_type} · Priority: {n.priority}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Upcoming Events</h2>
                <button type="button" onClick={() => onNavigate('my_school')} className="text-xs font-medium text-blue-600 dark:text-cyan-400 hover:underline">
                  My School
                </button>
              </div>
              {!dashboard?.upcomingEvents || dashboard.upcomingEvents.length === 0 ? (
                <p className="text-sm text-slate-500 py-4">No upcoming events scheduled.</p>
              ) : (
                <div className="space-y-3">
                  {dashboard.upcomingEvents.map((ev) => (
                    <div key={ev.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                      <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-cyan-400 font-medium">
                        <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{formatDateByCalendar(ev.event_date, calendar)}</span>
                        <span>·</span>
                        <span>{ev.category}</span>
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{ev.title}</div>
                      <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{ev.location}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const MetricCard: React.FC<{ label: string; value: string | number; icon: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
    <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
      <span>{label}</span>
      {icon}
    </div>
    <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white font-mono tabular-nums">
      {value}
    </div>
  </div>
);
