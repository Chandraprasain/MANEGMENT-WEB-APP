import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Flag, Gavel, ShieldAlert } from 'lucide-react';
import { apiGet, apiMutate } from '../lib/api';
import { formatDateByCalendar } from '../lib/domainRules';
import type { AuthUser } from '../types';

interface ModerationModuleProps {
  user: AuthUser;
  calendar: 'AD' | 'BS';
}

export const ModerationModule: React.FC<ModerationModuleProps> = ({ user, calendar }) => {
  const isModerator = ['PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT', 'PRINCIPAL'].includes(user.activeRole);
  const [cases, setCases] = useState<Array<Record<string, unknown>>>([]);
  const [appeals, setAppeals] = useState<Array<Record<string, unknown>>>([]);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const [reportForm, setReportForm] = useState({
    targetUserId: user.userId,
    contentType: 'POST' as 'POST' | 'COMMENT' | 'MESSAGE' | 'PROFILE',
    contentExcerpt: '',
    reason: '',
    severity: 'STANDARD' as 'STANDARD' | 'CRITICAL_CHILD_SAFETY',
  });

  const [appealCaseId, setAppealCaseId] = useState('');
  const [appealExplanation, setAppealExplanation] = useState('');
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});

  const loadModeration = async () => {
    const res = await apiGet<{ cases: Array<Record<string, unknown>>; appeals: Array<Record<string, unknown>> }>(
      '/moderation/cases',
      `mod:cases:${user.userId}`
    );
    if (res.success && res.data) {
      setCases(res.data.cases);
      setAppeals(res.data.appeals);
      if (!appealCaseId && res.data.cases[0]) {
        setAppealCaseId(String(res.data.cases[0].id));
      }
    }
  };

  useEffect(() => {
    loadModeration();
  }, [user.userId, user.activeRole]);

  const handleFileReport = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/moderation/report', 'POST', reportForm);
    setFeedback({ ok: res.success, msg: res.message || 'Safety report filed.' });
    if (res.success) {
      setReportForm((p) => ({ ...p, contentExcerpt: '', reason: '' }));
      loadModeration();
    }
  };

  const handleCaseDecision = async (caseId: string, decision: 'CONFIRM_VIOLATION' | 'DISMISS') => {
    const note = decisionNotes[caseId]?.trim() || (decision === 'CONFIRM_VIOLATION' ? 'Confirmed policy violation by moderator.' : 'Dismissed after review.');
    const res = await apiMutate(`/moderation/cases/${caseId}/decision`, 'POST', { decision, note });
    setFeedback({ ok: res.success, msg: res.message || 'Decision recorded.' });
    if (res.success) loadModeration();
  };

  const handleSubmitAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!appealCaseId) return;
    const res = await apiMutate('/moderation/appeals', 'POST', { caseId: appealCaseId, explanation: appealExplanation });
    setFeedback({ ok: res.success, msg: res.message || 'Appeal submitted.' });
    if (res.success) {
      setAppealExplanation('');
      loadModeration();
    }
  };

  const handleAppealDecision = async (appealId: string, decision: 'APPROVE_RESTORE' | 'UPHOLD') => {
    const note = decisionNotes[appealId]?.trim() || (decision === 'APPROVE_RESTORE' ? 'Appeal accepted; account restored.' : 'Original strike upheld.');
    const res = await apiMutate(`/moderation/appeals/${appealId}/review`, 'POST', { decision, note });
    setFeedback({ ok: res.success, msg: res.message || 'Appeal reviewed.' });
    if (res.success) loadModeration();
  };

  return (
    <div className="space-y-6">
      {/* Strike & Child Safety Policy Header */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 shrink-0">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">Safety, 3-Strike Moderation & Appeals</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Strike 1: Formal Warning · Strike 2: 7-Day Posting/Messaging Restriction · Strike 3 or Critical Child Safety Violation: Permanent Platform Ban.
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 px-4 py-2 text-xs shrink-0">
          <div className="text-slate-500">Your Account Standing</div>
          <div className="font-mono font-bold text-slate-900 dark:text-white">
            {user.accountStatus} · {user.strikeCount}/3 Strikes
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs font-medium ${
            feedback.ok
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'
          }`}
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{feedback.msg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Moderation Queue & Strike Actions */}
        <div className="lg:col-span-7 space-y-5">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">
              {isModerator ? 'Moderation Review Queue' : 'Your Safety Reports & Cases'}
            </h2>
            {cases.length === 0 ? (
              <p className="text-sm text-slate-500">No moderation cases found.</p>
            ) : (
              <div className="space-y-3">
                {cases.map((c) => (
                  <div key={String(c.id)} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {String(c.target_name || 'User')} · {String(c.content_type)} · {String(c.severity)}
                      </span>
                      <span className="font-mono text-slate-500">
                        {String(c.status)} · {formatDateByCalendar(String(c.created_at), calendar)}
                      </span>
                    </div>
                    <p className="rounded-lg bg-slate-50 dark:bg-slate-950 p-2.5 text-slate-700 dark:text-slate-300">
                      “{String(c.content_excerpt)}”
                    </p>
                    <div className="text-slate-500">
                      Reason: {String(c.reason)} · Target Strikes: <span className="font-mono">{String(c.target_strikes ?? 0)}</span> ({String(c.target_status || 'ACTIVE')})
                    </div>
                    {isModerator && String(c.status) === 'OPEN' && (
                      <div className="pt-2 space-y-2 border-t border-slate-100 dark:border-slate-800">
                        <input
                          placeholder="Moderator decision note..."
                          value={decisionNotes[String(c.id)] || ''}
                          onChange={(e) => setDecisionNotes((p) => ({ ...p, [String(c.id)]: e.target.value }))}
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleCaseDecision(String(c.id), 'CONFIRM_VIOLATION')}
                            className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                          >
                            <Gavel className="h-3.5 w-3.5" />
                            <span>Confirm Violation (Apply Strike)</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCaseDecision(String(c.id), 'DISMISS')}
                            className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            Dismiss
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Appeals Queue */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">Moderation Appeals</h2>
            {appeals.length === 0 ? (
              <p className="text-sm text-slate-500">No appeals submitted yet.</p>
            ) : (
              <div className="space-y-3">
                {appeals.map((ap) => (
                  <div key={String(ap.id)} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-900 dark:text-white">{String(ap.appellant_name || user.fullName)}</span>
                      <span className="font-mono font-semibold text-blue-600 dark:text-cyan-400">{String(ap.status)}</span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-300">{String(ap.explanation)}</p>
                    {isModerator && String(ap.status) === 'PENDING' && (
                      <div className="pt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleAppealDecision(String(ap.id), 'APPROVE_RESTORE')}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        >
                          Approve & Restore Account
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAppealDecision(String(ap.id), 'UPHOLD')}
                          className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium"
                        >
                          Uphold Strike
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: File Report + Submit Appeal */}
        <div className="lg:col-span-5 space-y-5">
          <form onSubmit={handleFileReport} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Flag className="h-4 w-4 text-red-600" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">File Safety Report</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={reportForm.contentType}
                onChange={(e) => setReportForm({ ...reportForm, contentType: e.target.value as 'POST' | 'COMMENT' | 'MESSAGE' | 'PROFILE' })}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
              >
                <option value="POST">Community Post</option>
                <option value="COMMENT">Comment</option>
                <option value="MESSAGE">Direct Message</option>
                <option value="PROFILE">User Profile</option>
              </select>
              <select
                value={reportForm.severity}
                onChange={(e) => setReportForm({ ...reportForm, severity: e.target.value as 'STANDARD' | 'CRITICAL_CHILD_SAFETY' })}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
              >
                <option value="STANDARD">Standard Violation</option>
                <option value="CRITICAL_CHILD_SAFETY">Critical Child Safety</option>
              </select>
            </div>
            <textarea
              required
              rows={2}
              placeholder="Quote or excerpt of problematic content..."
              value={reportForm.contentExcerpt}
              onChange={(e) => setReportForm({ ...reportForm, contentExcerpt: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
            />
            <input
              required
              placeholder="Reason for report (e.g. bullying, unsafe link, spam)"
              value={reportForm.reason}
              onChange={(e) => setReportForm({ ...reportForm, reason: e.target.value })}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
            />
            <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white min-h-[42px]">
              Submit Safety Report
            </button>
          </form>

          <form onSubmit={handleSubmitAppeal} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">Submit Strike Appeal</h3>
            </div>
            <select
              value={appealCaseId}
              onChange={(e) => setAppealCaseId(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
            >
              {cases.length === 0 ? (
                <option value="">No active cases to appeal</option>
              ) : (
                cases.map((c) => (
                  <option key={String(c.id)} value={String(c.id)}>
                    {String(c.id)} — {String(c.reason).slice(0, 40)}
                  </option>
                ))
              )}
            </select>
            <textarea
              required
              rows={3}
              placeholder="Explain why this strike or moderation decision should be reconsidered..."
              value={appealExplanation}
              onChange={(e) => setAppealExplanation(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
            />
            <button
              type="submit"
              disabled={!appealCaseId}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 py-2.5 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 min-h-[42px]"
            >
              Submit Appeal
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
