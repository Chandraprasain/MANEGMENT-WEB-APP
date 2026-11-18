import React, { useEffect, useState } from 'react';
import { Building, CalendarCheck, Globe2, HeartHandshake, KeyRound, Lock, ShieldAlert, ShoppingBag, Users, Webhook } from 'lucide-react';
import { apiGet, apiMutate } from '../lib/api';
import { formatCurrency, formatDateByCalendar } from '../lib/domainRules';
import type { AuthUser } from '../types';

export const GovernanceTrustModule: React.FC<{ user: AuthUser; calendar: 'AD' | 'BS' }> = ({ user, calendar }) => {
  const [subTab, setSubTab] = useState<'safeguarding' | 'consents' | 'marketplace' | 'hr' | 'security'>('safeguarding');
  const [sgData, setSgData] = useState<{
    isSafeguardingLead: boolean;
    cases: Array<Record<string, unknown>>;
    appointments: Array<Record<string, unknown>>;
  } | null>(null);
  const [consentData, setConsentData] = useState<{
    consents: Array<Record<string, unknown>>;
    pickups: Array<Record<string, unknown>>;
    linkedChildren?: Array<{ id: string; full_name: string; student_code: string }>;
  } | null>(null);
  const [marketData, setMarketData] = useState<{
    resources: Array<Record<string, unknown>>;
    partnerships: Array<Record<string, unknown>>;
    competitions: Array<Record<string, unknown>>;
  } | null>(null);
  const [hrData, setHrData] = useState<{
    leaves: Array<Record<string, unknown>>;
    facilities: Array<Record<string, unknown>>;
    bookings: Array<Record<string, unknown>>;
  } | null>(null);
  const [devSecData, setDevSecData] = useState<{
    apiKeys: Array<Record<string, unknown>>;
    webhooks: Array<Record<string, unknown>>;
    incidents: Array<Record<string, unknown>>;
    backups: Array<Record<string, unknown>>;
  } | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);

  const [sgForm, setSgForm] = useState({
    category: 'WELLBEING_CONCERN',
    severity: 'HIGH',
    summary: '',
    isAnonymous: false,
  });

  const [wbForm, setWbForm] = useState({
    preferredDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    topic: '',
  });

  const [pickupForm, setPickupForm] = useState({
    studentId: '',
    personName: '',
    relationship: 'Uncle',
    phone: '',
    idLast4: '',
  });

  const [mktForm, setMktForm] = useState({
    title: '',
    resourceType: 'WORKBOOK',
    subjectName: 'Mathematics',
    gradeLevel: 'Class 10',
    priceNpr: '0',
    description: '',
  });

  const [leaveForm, setLeaveForm] = useState({
    leaveDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    reason: '',
  });

  const [facilityForm, setFacilityForm] = useState({
    facilityId: '',
    bookingDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    timeSlot: '10:00 - 11:00',
    purpose: '',
  });

  const [whForm, setWhForm] = useState({
    targetUrl: '',
    eventsCsv: 'invoice.paid,attendance.marked',
  });

  const isParent = user.activeRole === 'PARENT' || user.activeRole === 'LEGAL_GUARDIAN';
  const canPublishResource = ['PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER', 'STAFF_LIBRARIAN'].includes(user.activeRole);
  const canRequestLeave = ['TEACHER', 'CLASS_TEACHER', 'PRINCIPAL', 'VICE_PRINCIPAL'].includes(user.activeRole);
  const canApproveLeave = ['PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG'].includes(user.activeRole);
  const canSeeDevSec = ['PRINCIPAL', 'SCHOOL_ORG', 'TECHNICAL_DEPT', 'PLATFORM_SUPER_ADMIN', 'PLATFORM_SUPPORT'].includes(user.activeRole);
  const canCreateDevCreds = ['PRINCIPAL', 'SCHOOL_ORG', 'TECHNICAL_DEPT', 'PLATFORM_SUPER_ADMIN'].includes(user.activeRole);
  const canVerifyBackups = ['PRINCIPAL', 'PLATFORM_SUPER_ADMIN', 'TECHNICAL_DEPT'].includes(user.activeRole);

  const loadAll = async () => {
    const [sgRes, cnsRes, mktRes, hrRes] = await Promise.all([
      apiGet<typeof sgData>('/safeguarding/cases', `sg:${user.activeSchoolId}:${user.userId}`),
      apiGet<typeof consentData>('/consent', `cns:${user.activeSchoolId}:${user.userId}`),
      apiGet<typeof marketData>('/marketplace', 'mkt:global'),
      apiGet<typeof hrData>('/hr/leaves-and-facilities', `hr:${user.activeSchoolId}`),
    ]);
    if (sgRes.success && sgRes.data) setSgData(sgRes.data);
    if (cnsRes.success && cnsRes.data) {
      setConsentData(cnsRes.data);
      if (cnsRes.data.linkedChildren && cnsRes.data.linkedChildren.length > 0) {
        setPickupForm((prev) => ({ ...prev, studentId: prev.studentId || cnsRes.data!.linkedChildren![0].id }));
      }
    }
    if (mktRes.success && mktRes.data) setMarketData(mktRes.data);
    if (hrRes.success && hrRes.data) {
      setHrData(hrRes.data);
      if (hrRes.data.facilities.length > 0) {
        setFacilityForm((prev) => ({ ...prev, facilityId: prev.facilityId || String(hrRes.data!.facilities[0].id) }));
      }
    }
    if (canSeeDevSec) {
      const dsRes = await apiGet<typeof devSecData>('/developer-security/overview', `ds:${user.activeSchoolId}`);
      if (dsRes.success && dsRes.data) setDevSecData(dsRes.data);
    }
  };

  useEffect(() => {
    loadAll();
  }, [user.activeSchoolId, user.activeRole]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Safeguarding, Family Consents & Campus Governance</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Confidential child safeguarding, granular parent permissions, global school exchanges, facilities, API keys & verified backups
        </p>
      </div>

      {statusMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30 p-3 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          {statusMsg}
        </div>
      )}

      {issuedSecret && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40 p-3.5 text-xs font-mono text-amber-900 dark:text-amber-200 break-all">
          Copy one-time secret now: <strong>{issuedSecret}</strong>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        {(
          [
            ['safeguarding', 'Safeguarding & Wellbeing'],
            ['consents', 'Family Consents & Pickups'],
            ['marketplace', 'Marketplace & Global Exchange'],
            ['hr', 'Leaves & Campus Facilities'],
            ...(canSeeDevSec ? [['security', 'API Keys, Webhooks & DR'] as const] : []),
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

      {/* SAFEGUARDING & WELLBEING */}
      {subTab === 'safeguarding' && sgData && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const res = await apiMutate('/safeguarding/cases', 'POST', sgForm);
                setStatusMsg(res.message || 'Confidential report logged.');
                if (res.success) {
                  setSgForm({ category: 'WELLBEING_CONCERN', severity: 'HIGH', summary: '', isAnonymous: false });
                  await loadAll();
                }
              }}
              className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
            >
              <h2 className="text-sm font-bold flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-red-600" />
                <span>File Confidential Safeguarding Report</span>
              </h2>
              <p className="text-[11px] text-slate-500">
                Strictly visible only to you and the designated Safeguarding Lead / Principal. Hidden from general staff and feeds.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={sgForm.category}
                  onChange={(e) => setSgForm({ ...sgForm, category: e.target.value })}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs"
                >
                  <option value="WELLBEING_CONCERN">Wellbeing Concern</option>
                  <option value="BULLYING">Bullying</option>
                  <option value="HARASSMENT">Harassment</option>
                  <option value="TRANSPORT_SAFETY">Transport Safety</option>
                  <option value="THREAT_SAFETY">Campus Safety Threat</option>
                </select>
                <select
                  value={sgForm.severity}
                  onChange={(e) => setSgForm({ ...sgForm, severity: e.target.value })}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs"
                >
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High Priority</option>
                  <option value="CRITICAL">Critical Urgent</option>
                </select>
              </div>
              <textarea
                required
                rows={4}
                value={sgForm.summary}
                onChange={(e) => setSgForm({ ...sgForm, summary: e.target.value })}
                placeholder="Describe the concern with dates/location..."
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-sm"
              />
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={sgForm.isAnonymous}
                  onChange={(e) => setSgForm({ ...sgForm, isAnonymous: e.target.checked })}
                />
                <span>Mask my name in lead review view (Confidential Reporter)</span>
              </label>
              <button type="submit" className="w-full rounded-lg bg-red-700 hover:bg-red-800 py-2.5 text-xs font-semibold text-white">
                Submit Encrypted Report
              </button>
            </form>

            <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <Lock className="h-4 w-4 text-emerald-600" />
                <span>{sgData.isSafeguardingLead ? 'Restricted Safeguarding Case Queue' : 'My Submitted Safety Reports'}</span>
              </h2>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {sgData.cases.length === 0 ? (
                  <p className="py-6 text-slate-500">No accessible cases to display.</p>
                ) : (
                  sgData.cases.map((c) => (
                    <div key={String(c.id)} className="py-3 space-y-1">
                      <div className="flex items-center justify-between font-bold">
                        <span>
                          {String(c.category)} · {String(c.severity)}
                        </span>
                        <span className="font-mono text-blue-700 dark:text-cyan-400">{String(c.status)}</span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">{String(c.summary)}</p>
                      <div className="text-[11px] font-mono text-slate-500">
                        {formatDateByCalendar(String(c.created_at), calendar)}
                        {sgData.isSafeguardingLead && c.status !== 'RESOLVED' && (
                          <button
                            type="button"
                            onClick={async () => {
                              await apiMutate(`/safeguarding/cases/${c.id}/status`, 'PATCH', {
                                status: 'RESOLVED',
                                actionNote: 'Reviewed & closed by safeguarding lead.',
                              });
                              await loadAll();
                            }}
                            className="ml-3 text-emerald-700 dark:text-emerald-400 underline"
                          >
                            Mark Resolved
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const res = await apiMutate('/wellbeing/appointments', 'POST', wbForm);
                setStatusMsg(res.message || 'Counseling appointment requested.');
                if (res.success) {
                  setWbForm({ ...wbForm, topic: '' });
                  await loadAll();
                }
              }}
              className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
            >
              <h2 className="text-sm font-bold flex items-center gap-2">
                <HeartHandshake className="h-4 w-4 text-blue-600" />
                <span>Request Confidential Counseling</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="date"
                  required
                  value={wbForm.preferredDate}
                  onChange={(e) => setWbForm({ ...wbForm, preferredDate: e.target.value })}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 font-mono"
                />
                <input
                  required
                  value={wbForm.topic}
                  onChange={(e) => setWbForm({ ...wbForm, topic: e.target.value })}
                  placeholder="Counseling topic *"
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                />
              </div>
              <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 font-semibold text-white">
                Request Confidential Counseling
              </button>
            </form>

            <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <h2 className="text-sm font-bold">Wellbeing & Counseling Appointments ({sgData.appointments.length})</h2>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {sgData.appointments.length === 0 ? (
                  <p className="py-4 text-slate-500">No wellbeing appointments requested yet.</p>
                ) : (
                  sgData.appointments.map((a) => (
                    <div key={String(a.id)} className="py-2.5 flex items-center justify-between gap-2">
                      <div>
                        <div className="font-bold text-slate-900 dark:text-white">{String(a.topic)}</div>
                        <div className="text-slate-500 font-mono">
                          {String(a.requester_name)} · {formatDateByCalendar(String(a.preferred_date), calendar)}
                        </div>
                      </div>
                      <span className="font-mono font-semibold text-blue-700 dark:text-cyan-400">{String(a.status)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONSENTS & PICKUPS */}
      {subTab === 'consents' && consentData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-blue-600" />
              <span>Child Permissions & Digital Consents</span>
            </h2>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {consentData.consents.length === 0 ? (
                <p className="py-4 text-slate-500">No linked consent records visible for this role.</p>
              ) : (
                consentData.consents.map((c) => (
                  <div key={String(c.id)} className="py-3 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">{String(c.consent_type).replace(/_/g, ' ')}</div>
                      <div className="text-slate-500">{String(c.student_name)} ({String(c.student_code)})</div>
                    </div>
                    {isParent ? (
                      <button
                        type="button"
                        onClick={async () => {
                          await apiMutate('/consent', 'POST', {
                            studentId: c.student_id,
                            consentType: c.consent_type,
                            granted: !Boolean(c.granted),
                          });
                          await loadAll();
                        }}
                        className={`rounded-lg px-3 py-1.5 font-mono font-semibold ${
                          c.granted ? 'bg-emerald-700 text-white' : 'border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {c.granted ? 'GRANTED' : 'REVOKED'}
                      </button>
                    ) : (
                      <span className="font-mono font-semibold">{c.granted ? 'GRANTED' : 'REVOKED'}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-600" />
              <span>Authorized School Gate Pickups</span>
            </h2>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {consentData.pickups.length === 0 ? (
                <p className="py-4 text-slate-500">No pickup persons listed.</p>
              ) : (
                consentData.pickups.map((p) => (
                  <div key={String(p.id)} className="py-3 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">
                        {String(p.person_name)} · {String(p.relationship)}
                      </div>
                      <div className="text-slate-500 font-mono">
                        For {String(p.student_name)} · {String(p.phone)} · ID ****{String(p.id_last4 || '----')}
                      </div>
                    </div>
                    <span className="font-mono text-emerald-700 dark:text-emerald-400">{String(p.status)}</span>
                  </div>
                ))
              )}
            </div>

            {isParent && consentData.linkedChildren && consentData.linkedChildren.length > 0 && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const res = await apiMutate('/pickups', 'POST', pickupForm);
                  setStatusMsg(res.message || 'Authorized pickup person added.');
                  if (res.success) {
                    setPickupForm({ ...pickupForm, personName: '', phone: '', idLast4: '' });
                    await loadAll();
                  }
                }}
                className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5 text-xs"
              >
                <div className="font-bold text-slate-900 dark:text-white">Add Authorized Gate Pickup Person</div>
                <select
                  required
                  value={pickupForm.studentId}
                  onChange={(e) => setPickupForm({ ...pickupForm, studentId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                >
                  {consentData.linkedChildren.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.full_name} ({ch.student_code})
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    required
                    value={pickupForm.personName}
                    onChange={(e) => setPickupForm({ ...pickupForm, personName: e.target.value })}
                    placeholder="Full Name *"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                  />
                  <input
                    required
                    value={pickupForm.relationship}
                    onChange={(e) => setPickupForm({ ...pickupForm, relationship: e.target.value })}
                    placeholder="Relationship (e.g. Uncle)"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    required
                    value={pickupForm.phone}
                    onChange={(e) => setPickupForm({ ...pickupForm, phone: e.target.value })}
                    placeholder="Mobile Number *"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 font-mono"
                  />
                  <input
                    maxLength={4}
                    value={pickupForm.idLast4}
                    onChange={(e) => setPickupForm({ ...pickupForm, idLast4: e.target.value })}
                    placeholder="ID Last 4 Digits (opt)"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 font-mono"
                  />
                </div>
                <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2 font-semibold text-white">
                  Authorize Gate Pickup
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MARKETPLACE & GLOBAL EXCHANGE */}
      {subTab === 'marketplace' && marketData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-blue-600" />
              <span>Approved Digital Learning Resources</span>
            </h2>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {marketData.resources.map((r) => (
                <div key={String(r.id)} className="py-3">
                  <div className="flex items-center justify-between font-bold text-slate-900 dark:text-white">
                    <span>{String(r.title)}</span>
                    <span className="font-mono text-emerald-700 dark:text-emerald-400 tabular-nums">
                      {Number(r.price_npr) === 0 ? 'FREE OER' : formatCurrency(Number(r.price_npr), 'NPR')}
                    </span>
                  </div>
                  <div className="text-slate-500 mt-0.5">
                    {String(r.subject_name)} · {String(r.grade_level)} · By {String(r.author_name)}
                  </div>
                  <p className="text-slate-600 dark:text-slate-300 mt-1">{String(r.description)}</p>
                </div>
              ))}
            </div>

            {canPublishResource && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const res = await apiMutate('/marketplace/resources', 'POST', {
                    ...mktForm,
                    priceNpr: Number(mktForm.priceNpr || 0),
                  });
                  setStatusMsg(res.message || 'Resource published.');
                  if (res.success) {
                    setMktForm({ ...mktForm, title: '', description: '' });
                    await loadAll();
                  }
                }}
                className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5 text-xs"
              >
                <div className="font-bold text-slate-900 dark:text-white">Publish Resource / Workbook to Catalog</div>
                <input
                  required
                  value={mktForm.title}
                  onChange={(e) => setMktForm({ ...mktForm, title: e.target.value })}
                  placeholder="Resource Title *"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
                />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <select
                    value={mktForm.resourceType}
                    onChange={(e) => setMktForm({ ...mktForm, resourceType: e.target.value })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2"
                  >
                    <option value="WORKBOOK">Workbook</option>
                    <option value="COURSE_GUIDE">Course Guide</option>
                    <option value="QUESTION_PACK">Question Pack</option>
                    <option value="VIDEO_LECTURE">Video Lecture</option>
                  </select>
                  <input
                    required
                    value={mktForm.subjectName}
                    onChange={(e) => setMktForm({ ...mktForm, subjectName: e.target.value })}
                    placeholder="Subject"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2"
                  />
                  <input
                    required
                    value={mktForm.gradeLevel}
                    onChange={(e) => setMktForm({ ...mktForm, gradeLevel: e.target.value })}
                    placeholder="Grade"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2"
                  />
                  <input
                    type="number"
                    min={0}
                    value={mktForm.priceNpr}
                    onChange={(e) => setMktForm({ ...mktForm, priceNpr: e.target.value })}
                    placeholder="NPR (0 = Free)"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 font-mono tabular-nums"
                  />
                </div>
                <input
                  required
                  value={mktForm.description}
                  onChange={(e) => setMktForm({ ...mktForm, description: e.target.value })}
                  placeholder="Short description *"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
                />
                <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2 font-semibold text-white">
                  Publish Learning Resource
                </button>
              </form>
            )}
          </div>

          <div className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 text-xs">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Globe2 className="h-4 w-4 text-emerald-600" />
              <span>International Partnerships & Competitions</span>
            </h2>
            {marketData.partnerships.map((p) => (
              <div key={String(p.id)} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                <div className="font-bold text-slate-900 dark:text-white">
                  {String(p.partner_school_name)} ({String(p.partner_country)})
                </div>
                <div className="text-slate-500 mt-0.5">{String(p.focus_area)}</div>
              </div>
            ))}
            {marketData.competitions.map((cmp) => (
              <div key={String(cmp.id)} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
                <div className="font-bold text-slate-900 dark:text-white">{String(cmp.title)}</div>
                <div className="text-slate-500 mt-0.5">
                  {String(cmp.category)} · Deadline {formatDateByCalendar(String(cmp.deadline), calendar)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* HR LEAVES & FACILITIES */}
      {subTab === 'hr' && hrData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs">
          <div className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Building className="h-4 w-4 text-blue-600" />
              <span>Campus Labs & Rooms</span>
            </h2>
            {hrData.facilities.map((f) => (
              <div key={String(f.id)} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex items-center justify-between">
                <div>
                  <div className="font-bold text-slate-900 dark:text-white">{String(f.name)}</div>
                  <div className="text-slate-500">
                    {String(f.facility_type)} · Capacity {String(f.capacity)}
                  </div>
                </div>
                <span className="font-mono text-emerald-700 dark:text-emerald-400">{String(f.status)}</span>
              </div>
            ))}

            {hrData.facilities.length > 0 && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const res = await apiMutate('/facilities/book', 'POST', facilityForm);
                  setStatusMsg(res.message || 'Facility booked.');
                  if (res.success) {
                    setFacilityForm({ ...facilityForm, purpose: '' });
                    await loadAll();
                  }
                }}
                className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5"
              >
                <div className="font-bold text-slate-900 dark:text-white">Book Lab / Campus Facility</div>
                <select
                  required
                  value={facilityForm.facilityId}
                  onChange={(e) => setFacilityForm({ ...facilityForm, facilityId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                >
                  {hrData.facilities.map((f) => (
                    <option key={String(f.id)} value={String(f.id)}>
                      {String(f.name)} ({String(f.facility_type)})
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    required
                    value={facilityForm.bookingDate}
                    onChange={(e) => setFacilityForm({ ...facilityForm, bookingDate: e.target.value })}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 font-mono"
                  />
                  <input
                    required
                    value={facilityForm.timeSlot}
                    onChange={(e) => setFacilityForm({ ...facilityForm, timeSlot: e.target.value })}
                    placeholder="Time slot (e.g. 10:00 - 11:00)"
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 font-mono"
                  />
                </div>
                <input
                  required
                  value={facilityForm.purpose}
                  onChange={(e) => setFacilityForm({ ...facilityForm, purpose: e.target.value })}
                  placeholder="Session / Experiment purpose *"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
                />
                <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2 font-semibold text-white">
                  Confirm Facility Booking
                </button>
              </form>
            )}

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="font-bold text-slate-900 dark:text-white">Confirmed Reservations ({hrData.bookings.length})</div>
              {hrData.bookings.length === 0 ? (
                <p className="text-slate-500">No upcoming reservations.</p>
              ) : (
                hrData.bookings.map((b) => (
                  <div key={String(b.id)} className="rounded-lg border border-slate-200 dark:border-slate-800 p-2.5 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-900 dark:text-white">{String(b.facility_name)}</div>
                      <div className="text-slate-500">
                        {formatDateByCalendar(String(b.booking_date), calendar)} · {String(b.time_slot)} · {String(b.purpose)} ({String(b.booked_by_name)})
                      </div>
                    </div>
                    <span className="font-mono text-emerald-700 dark:text-emerald-400">{String(b.status)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-bold">Teacher Leave Requests</h2>
            {hrData.leaves.length === 0 ? (
              <p className="text-slate-500 py-2">No leave requests logged.</p>
            ) : (
              <div className="space-y-2.5">
                {hrData.leaves.map((l) => (
                  <div key={String(l.id)} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-slate-900 dark:text-white">{String(l.teacher_name)}</span>
                      <span
                        className={`font-mono font-semibold ${
                          l.status === 'APPROVED'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : l.status === 'REJECTED'
                              ? 'text-red-600'
                              : 'text-amber-600'
                        }`}
                      >
                        {String(l.status)}
                      </span>
                    </div>
                    <div className="text-slate-500">
                      {formatDateByCalendar(String(l.leave_date), calendar)} · {String(l.reason)}
                    </div>
                    {canApproveLeave && l.status === 'PENDING' && (
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await apiMutate(`/hr/leaves/${l.id}`, 'PATCH', { status: 'APPROVED' });
                            setStatusMsg(res.message || 'Leave approved.');
                            await loadAll();
                          }}
                          className="rounded-lg bg-emerald-700 px-3 py-1.5 font-semibold text-white"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            const res = await apiMutate(`/hr/leaves/${l.id}`, 'PATCH', { status: 'REJECTED' });
                            setStatusMsg(res.message || 'Leave rejected.');
                            await loadAll();
                          }}
                          className="rounded-lg border border-red-300 dark:border-red-800 px-3 py-1.5 font-semibold text-red-700 dark:text-red-400"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {canRequestLeave && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const res = await apiMutate('/hr/leaves', 'POST', leaveForm);
                  setStatusMsg(res.message || 'Leave request submitted.');
                  if (res.success) {
                    setLeaveForm({ ...leaveForm, reason: '' });
                    await loadAll();
                  }
                }}
                className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5"
              >
                <div className="font-bold text-slate-900 dark:text-white">Submit Leave & Substitute Request</div>
                <input
                  type="date"
                  required
                  value={leaveForm.leaveDate}
                  onChange={(e) => setLeaveForm({ ...leaveForm, leaveDate: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 font-mono"
                />
                <input
                  required
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })}
                  placeholder="Reason & suggested substitute notes *"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
                />
                <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2 font-semibold text-white">
                  Submit Leave Request
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* DEVELOPER & SECURITY */}
      {subTab === 'security' && canSeeDevSec && devSecData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 text-xs">
          <div className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-blue-600" />
                  <span>API Clients & Scoped Keys</span>
                </h2>
                {canCreateDevCreds && (
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await apiMutate<{ apiKeyOnce: string }>('/developer/api-keys', 'POST', {
                        name: `SIS Sync Client ${new Date().toISOString().slice(11, 16)}`,
                      });
                      if (res.success && res.data?.apiKeyOnce) {
                        setIssuedSecret(res.data.apiKeyOnce);
                        setStatusMsg(res.message || 'API key created.');
                        await loadAll();
                      }
                    }}
                    className="rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-3 py-1.5 font-semibold text-white"
                  >
                    + Issue API Key
                  </button>
                )}
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {devSecData.apiKeys.map((k) => (
                  <div key={String(k.id)} className="py-2.5 flex justify-between font-mono">
                    <span>{String(k.name)} · {String(k.key_prefix)}...</span>
                    <span className="text-emerald-700 dark:text-emerald-400">{String(k.status)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Webhook className="h-4 w-4 text-blue-600" />
                <span>HMAC-SHA256 Webhooks ({devSecData.webhooks.length})</span>
              </h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {devSecData.webhooks.length === 0 ? (
                  <p className="py-2 text-slate-500">No webhook subscriptions configured.</p>
                ) : (
                  devSecData.webhooks.map((w) => (
                    <div key={String(w.id)} className="py-2 flex items-center justify-between gap-2 font-mono">
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-slate-900 dark:text-white">{String(w.target_url)}</div>
                        <div className="text-[11px] text-slate-500 truncate">{String(w.events_csv)}</div>
                      </div>
                      <span className="text-emerald-700 dark:text-emerald-400 shrink-0">{w.is_active ? 'ACTIVE' : 'PAUSED'}</span>
                    </div>
                  ))
                )}
              </div>

              {canCreateDevCreds && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const res = await apiMutate<{ id: string; signingSecretOnce: string }>('/developer/webhooks', 'POST', whForm);
                    if (res.success && res.data?.signingSecretOnce) {
                      setIssuedSecret(res.data.signingSecretOnce);
                      setStatusMsg(res.message || 'Webhook registered.');
                      setWhForm({ targetUrl: '', eventsCsv: 'invoice.paid,attendance.marked' });
                      await loadAll();
                    } else {
                      setStatusMsg(res.message || 'Failed to register webhook.');
                    }
                  }}
                  className="space-y-2 pt-2"
                >
                  <input
                    type="url"
                    required
                    value={whForm.targetUrl}
                    onChange={(e) => setWhForm({ ...whForm, targetUrl: e.target.value })}
                    placeholder="HTTPS Webhook Endpoint URL *"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono"
                  />
                  <input
                    required
                    value={whForm.eventsCsv}
                    onChange={(e) => setWhForm({ ...whForm, eventsCsv: e.target.value })}
                    placeholder="Events CSV (e.g. invoice.paid,attendance.marked)"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 font-mono"
                  />
                  <button type="submit" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 py-2 font-semibold">
                    Register Signed Webhook
                  </button>
                </form>
              )}
            </div>
          </div>

          <div className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold">Verified Backups & Disaster Recovery</h2>
              {canVerifyBackups && (
                <button
                  type="button"
                  onClick={async () => {
                    const res = await apiMutate('/dr/backups/verify', 'POST', {});
                    setStatusMsg(res.message || 'Backup verified.');
                    await loadAll();
                  }}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 font-semibold"
                >
                  Verify Snapshot
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {devSecData.backups.map((b) => (
                <div key={String(b.id)} className="py-2.5">
                  <div className="font-semibold text-slate-900 dark:text-white">{String(b.backup_label)}</div>
                  <div className="font-mono text-[11px] text-slate-500 truncate">SHA-256: {String(b.checksum_sha256)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
