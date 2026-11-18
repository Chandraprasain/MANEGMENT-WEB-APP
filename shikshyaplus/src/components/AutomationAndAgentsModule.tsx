import React, { useEffect, useState } from 'react';
import { Bot, CheckCircle2, Play, Shield, Sparkles, Workflow } from 'lucide-react';
import { apiGet, apiMutate } from '../lib/api';
import { formatDateByCalendar } from '../lib/domainRules';
import type { AuthUser } from '../types';

export const AutomationAndAgentsModule: React.FC<{ user: AuthUser; calendar: 'AD' | 'BS' }> = ({ user, calendar }) => {
  const [subTab, setSubTab] = useState<'workflows' | 'agents' | 'governance'>('workflows');
  const [wfData, setWfData] = useState<{
    workflows: Array<Record<string, unknown>>;
    executions: Array<Record<string, unknown>>;
    approvals: Array<Record<string, unknown>>;
  } | null>(null);
  const [govData, setGovData] = useState<{
    policy: Record<string, unknown>;
    runs: Array<Record<string, unknown>>;
  } | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const [wfForm, setWfForm] = useState({
    name: '',
    triggerType: 'ATTENDANCE_ABSENT',
    actionType: 'SEND_NOTIFICATION',
    targetRole: 'PARENT',
    actionTemplate: '',
    requiresHumanApproval: false,
  });

  const defaultAgentForRole =
    user.activeRole === 'STUDENT'
      ? 'STUDENT_TUTOR'
      : user.activeRole === 'PARENT' || user.activeRole === 'LEGAL_GUARDIAN'
      ? 'PARENT_GUIDE'
      : user.activeRole === 'TEACHER' || user.activeRole === 'CLASS_TEACHER'
      ? 'TEACHER_PEDAGOGY'
      : user.activeRole === 'TECHNICAL_DEPT'
      ? 'TECH_SUPPORT'
      : 'PRINCIPAL_OPS';

  const [agentType, setAgentType] = useState<string>(defaultAgentForRole);
  const [agentPrompt, setAgentPrompt] = useState('');
  const [agentResult, setAgentResult] = useState<Record<string, unknown> | null>(null);
  const [agentLoading, setAgentLoading] = useState(false);

  const canManageWorkflows = ['PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'TECHNICAL_DEPT'].includes(user.activeRole);

  const loadAll = async () => {
    const [wfRes, govRes] = await Promise.all([
      apiGet<typeof wfData>('/workflows', `wf:${user.activeSchoolId}`),
      apiGet<typeof govData>('/ai/governance', `aigov:${user.activeSchoolId}`),
    ]);
    if (wfRes.success && wfRes.data) setWfData(wfRes.data);
    if (govRes.success && govRes.data) setGovData(govRes.data);
  };

  useEffect(() => {
    loadAll();
  }, [user.activeSchoolId, user.activeRole]);

  const handleRunAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setAgentLoading(true);
    setStatusMsg(null);
    setAgentResult(null);
    try {
      const res = await apiMutate<{ result: Record<string, unknown> }>('/ai/agents/run', 'POST', {
        agentType,
        prompt: agentPrompt,
      });
      if (!res.success || !res.data?.result) {
        setStatusMsg(res.message || 'Agent request failed.');
      } else {
        setAgentResult(res.data.result);
        await loadAll();
      }
    } finally {
      setAgentLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Intelligent Automation & Role AI Agents</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Event-driven school workflows with human approval gates, scoped Role Copilots, and transparent AI Governance quotas
        </p>
      </div>

      {statusMsg && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3 text-xs font-medium text-amber-900 dark:text-amber-200">
          {statusMsg}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        {(
          [
            ['workflows', 'Workflow Builder & Approvals'],
            ['agents', 'Role-Scoped AI Agents'],
            ['governance', 'AI Governance & Audit'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={`rounded-lg px-3.5 py-2 text-xs font-semibold whitespace-nowrap min-h-[40px] ${
              subTab === id
                ? 'bg-[#0F1E36] text-white dark:bg-blue-600'
                : 'border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* WORKFLOWS */}
      {subTab === 'workflows' && wfData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {canManageWorkflows && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const res = await apiMutate('/workflows', 'POST', wfForm);
                setStatusMsg(res.message || 'Workflow saved.');
                if (res.success) {
                  setWfForm({ ...wfForm, name: '', actionTemplate: '' });
                  await loadAll();
                }
              }}
              className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
            >
              <h2 className="text-sm font-bold flex items-center gap-2">
                <Workflow className="h-4 w-4 text-blue-600" />
                <span>Create Automation Workflow</span>
              </h2>
              <input
                required
                value={wfForm.name}
                onChange={(e) => setWfForm({ ...wfForm, name: e.target.value })}
                placeholder="Workflow name *"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={wfForm.triggerType}
                  onChange={(e) => setWfForm({ ...wfForm, triggerType: e.target.value })}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs"
                >
                  <option value="ATTENDANCE_ABSENT">Trigger: Attendance Absent</option>
                  <option value="HOMEWORK_DUE_SOON">Trigger: Homework Due</option>
                  <option value="EXAM_PUBLISHED">Trigger: Exam Published</option>
                  <option value="TEACHER_LEAVE_REQUESTED">Trigger: Teacher Leave</option>
                  <option value="FEE_OVERDUE">Trigger: Fee Overdue</option>
                  <option value="MANUAL_TEST">Trigger: Manual Test</option>
                </select>
                <select
                  value={wfForm.actionType}
                  onChange={(e) => setWfForm({ ...wfForm, actionType: e.target.value })}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs"
                >
                  <option value="SEND_NOTIFICATION">Action: Notify Role</option>
                  <option value="CREATE_SUPPORT_TICKET">Action: Create Ticket</option>
                  <option value="PUBLISH_OFFICIAL_GRADES">Action: Grade Broadcast (Gated)</option>
                </select>
              </div>
              <input
                value={wfForm.actionTemplate}
                onChange={(e) => setWfForm({ ...wfForm, actionTemplate: e.target.value })}
                placeholder="Notification template message"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={wfForm.requiresHumanApproval}
                  onChange={(e) => setWfForm({ ...wfForm, requiresHumanApproval: e.target.checked })}
                />
                <span>Require human approval before executing action</span>
              </label>
              <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white">
                Save Active Workflow
              </button>
            </form>
          )}

          <div className={`${canManageWorkflows ? 'lg:col-span-7' : 'lg:col-span-12'} space-y-6`}>
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h2 className="text-sm font-bold">Configured School Workflows ({wfData.workflows.length})</h2>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {wfData.workflows.map((wf) => (
                  <div key={String(wf.id)} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{String(wf.name)}</div>
                      <div className="text-slate-500 font-mono mt-0.5">
                        {String(wf.trigger_type)} → {String(wf.action_type)} · {wf.requires_human_approval ? 'Human Approval Gate' : 'Auto-Safe'} ·{' '}
                        <span className={wf.status === 'ACTIVE' ? 'text-emerald-600' : 'text-amber-600'}>{String(wf.status)}</span>
                      </div>
                    </div>
                    {canManageWorkflows && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await apiMutate(`/workflows/${wf.id}/test`, 'POST', {});
                            setStatusMsg(res.message || 'Test executed.');
                            await loadAll();
                          }}
                          className="inline-flex items-center gap-1 rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 font-semibold"
                        >
                          <Play className="h-3 w-3" />
                          <span>Test</span>
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const next = wf.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
                            await apiMutate(`/workflows/${wf.id}/status`, 'PATCH', { status: next });
                            await loadAll();
                          }}
                          className="rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1.5 font-semibold"
                        >
                          {wf.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {wfData.approvals.length > 0 && (
              <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-white dark:bg-slate-900 p-5 space-y-3">
                <h2 className="text-sm font-bold">Human Approval Queue</h2>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {wfData.approvals.map((a) => (
                    <div key={String(a.id)} className="py-2.5 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold">{String(a.summary)}</div>
                        <div className="font-mono text-slate-500">
                          {String(a.status)} · Requested by {String(a.requester_name)}
                        </div>
                      </div>
                      {a.status === 'PENDING' && ['PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG'].includes(user.activeRole) && (
                        <button
                          type="button"
                          onClick={async () => {
                            await apiMutate(`/approvals/${a.id}/review`, 'POST', { decision: 'APPROVED' });
                            await loadAll();
                          }}
                          className="rounded bg-emerald-700 px-3 py-1.5 text-white font-semibold"
                        >
                          Approve
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-2">
              <h2 className="text-sm font-bold">Recent Workflow Executions</h2>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {wfData.executions.length === 0 ? (
                  <p className="py-4 text-slate-500">No executions logged yet.</p>
                ) : (
                  wfData.executions.slice(0, 8).map((ex) => (
                    <div key={String(ex.id)} className="py-2 flex items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold">{String(ex.workflow_name)}</span> · {String(ex.result_summary)}
                      </div>
                      <span className="font-mono text-slate-500 shrink-0 tabular-nums">
                        {String(ex.status)} · {formatDateByCalendar(String(ex.executed_at), calendar)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ROLE AI AGENTS */}
      {subTab === 'agents' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleRunAgent} className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Bot className="h-4 w-4 text-blue-600" />
              <span>Role-Scoped AI Assistant</span>
            </h2>
            <select
              value={agentType}
              onChange={(e) => setAgentType(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="PRINCIPAL_OPS">Principal Operations Copilot</option>
              <option value="TEACHER_PEDAGOGY">Teacher Lesson & Rubric Agent</option>
              <option value="STUDENT_TUTOR">Student Study & Mastery Coach</option>
              <option value="PARENT_GUIDE">Parent Engagement Guide</option>
              <option value="TECH_SUPPORT">Technical SIS & OneRoster Copilot</option>
            </select>
            <textarea
              required
              rows={4}
              value={agentPrompt}
              onChange={(e) => setAgentPrompt(e.target.value)}
              placeholder="Ask your scoped AI agent to analyze attendance trends, draft a rubric, or explain a unit..."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-sm"
            />
            <button
              type="submit"
              disabled={agentLoading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white disabled:opacity-60"
            >
              <Sparkles className="h-4 w-4" />
              <span>{agentLoading ? 'Consulting Scoped Agent...' : 'Run Role Agent'}</span>
            </button>
          </form>

          <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            {!agentResult ? (
              <div className="py-12 text-center text-xs text-slate-500">
                Role AI Agents strictly read only data permitted for your school membership & role, and prepare human-reviewed drafts instead of mutating grades or records automatically.
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                <div className="font-mono text-slate-500">
                  {String(agentResult.provider)} · {String(agentResult.model)} · {String(agentResult.agentType)}
                </div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">{String(agentResult.summary)}</p>
                {Array.isArray(agentResult.insights) && agentResult.insights.length > 0 && (
                  <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-300">
                    {(agentResult.insights as string[]).map((ins, i) => (
                      <li key={i}>{ins}</li>
                    ))}
                  </ul>
                )}
                {Boolean(agentResult.proposedAction) && (
                  <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/30 p-3.5">
                    <div className="font-bold text-blue-800 dark:text-cyan-300">
                      Proposed Draft (Requires Human Confirmation): {String((agentResult.proposedAction as { title?: string }).title)}
                    </div>
                    <p className="mt-1 text-slate-700 dark:text-slate-200">{String((agentResult.proposedAction as { draftPayload?: string }).draftPayload)}</p>
                  </div>
                )}
                <p className="text-[11px] text-slate-400">{String(agentResult.aiDisclaimer)}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* AI GOVERNANCE */}
      {subTab === 'governance' && govData && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <Shield className="h-4 w-4 text-emerald-600" />
            <span>School AI Governance Policy & Quotas</span>
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-slate-500">Daily School Quota</div>
              <div className="text-base font-bold mt-1 tabular-nums">{String(govData.policy.daily_school_limit)} runs</div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-slate-500">Student Daily Cap</div>
              <div className="text-base font-bold mt-1 tabular-nums">{String(govData.policy.student_daily_limit)} runs</div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-slate-500">Human Review Gate</div>
              <div className="text-base font-bold mt-1 text-emerald-700">{govData.policy.require_human_review_for_actions ? 'ENFORCED' : 'OPTIONAL'}</div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
              <div className="text-slate-500">Prompt Version</div>
              <div className="text-base font-bold mt-1">{String(govData.policy.prompt_version)}</div>
            </div>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800 pt-2">
            {govData.runs.length === 0 ? (
              <p className="py-4 text-slate-500">No role agent audit logs yet.</p>
            ) : (
              govData.runs.map((r) => (
                <div key={String(r.id)} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold">{String(r.user_name)}</span> · <span className="font-mono">{String(r.agent_type)}</span> — {String(r.prompt_excerpt)}
                  </div>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
