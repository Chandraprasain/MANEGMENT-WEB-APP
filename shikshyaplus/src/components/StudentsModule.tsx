import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, KeyRound, Plus, Printer, QrCode, Search, Upload, UserCheck, X } from 'lucide-react';
import { apiGet, apiMutate } from '../lib/api';
import { generateStudentIdCardPdf } from '../lib/pdfGenerator';
import type { AuthUser } from '../types';
import { Student360Modal } from './Student360Modal';

interface StudentsModuleProps {
  user: AuthUser;
  searchQuery: string;
  calendar?: 'AD' | 'BS';
}

interface LoginCardData {
  schoolName: string;
  schoolCode: string;
  studentId: string;
  studentCode: string;
  studentName: string;
  className: string;
  temporaryPassword: string;
  parentInvitationCode: string;
}

export const StudentsModule: React.FC<StudentsModuleProps> = ({ user, searchQuery, calendar = 'AD' }) => {
  const [students, setStudents] = useState<Array<Record<string, unknown>>>([]);
  const [classes, setClasses] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [loginCard, setLoginCard] = useState<LoginCardData | null>(null);
  const [inviteToast, setInviteToast] = useState<string | null>(null);
  const [student360Id, setStudent360Id] = useState<string | null>(null);

  const [form, setForm] = useState({
    fullName: '',
    classId: '',
    rollNumber: '',
    admissionNumber: '',
    guardianName: '',
    guardianPhone: '',
    guardianEmail: '',
    address: '',
  });
  const [formError, setFormError] = useState<string | null>(null);

  // Bulk CSV Import state
  const [csvText, setCsvText] = useState(
    'fullName,admissionNumber,rollNumber,guardianName,guardianPhone\nBikram KC,ADM-2026-150,15,Nirmala KC,+9779841222333\nPrakriti Rai,ADM-2026-151,16,Suresh Rai,+9779841444555'
  );
  const [importClassId, setImportClassId] = useState('');
  const [previewRows, setPreviewRows] = useState<Array<Record<string, unknown>>>([]);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const canManage = ['PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'TEACHER', 'CLASS_TEACHER', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR'].includes(
    user.activeRole
  );
  const isTechOrPrincipal = ['PRINCIPAL', 'VICE_PRINCIPAL', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR'].includes(user.activeRole);

  const loadData = async () => {
    setLoading(true);
    try {
      const [stuRes, clsRes] = await Promise.all([
        apiGet<{ students: Array<Record<string, unknown>> }>('/students', `students:${user.activeSchoolId}`),
        apiGet<{ classes: Array<Record<string, unknown>> }>('/academics/classes', `classes:${user.activeSchoolId}`),
      ]);
      if (stuRes.success && stuRes.data) setStudents(stuRes.data.students);
      if (clsRes.success && clsRes.data) {
        setClasses(clsRes.data.classes);
        if (clsRes.data.classes[0]) {
          const firstId = String(clsRes.data.classes[0].id);
          setForm((prev) => ({ ...prev, classId: prev.classId || firstId }));
          setImportClassId((prev) => prev || firstId);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [user.activeSchoolId]);

  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const res = await apiMutate<{ loginCard: LoginCardData }>('/students', 'POST', form);
    if (!res.success) {
      setFormError(res.message || 'Could not create student account.');
      return;
    }
    setShowCreateModal(false);
    setForm({ fullName: '', classId: classes[0]?.id ? String(classes[0].id) : '', rollNumber: '', admissionNumber: '', guardianName: '', guardianPhone: '', guardianEmail: '', address: '' });
    if (res.data?.loginCard) {
      setLoginCard(res.data.loginCard);
    }
    loadData();
  };

  const handlePreviewCsv = async () => {
    setImportMsg(null);
    const res = await apiMutate<{ preview: Array<Record<string, unknown>> }>('/students/import/preview', 'POST', {
      csvText,
      classId: importClassId,
    });
    if (res.success && res.data) {
      setPreviewRows(res.data.preview);
    } else {
      setImportMsg(res.message || 'Failed to parse CSV.');
    }
  };

  const handleConfirmImport = async () => {
    const validRows = previewRows
      .filter((r) => Boolean(r.valid))
      .map((r) => ({
        fullName: String(r.fullName),
        admissionNumber: String(r.admissionNumber),
        rollNumber: Number(r.rollNumber),
        guardianName: String(r.guardianName),
        guardianPhone: String(r.guardianPhone),
      }));
    const res = await apiMutate<{ skipped: number }>('/students/import/confirm', 'POST', {
      classId: importClassId,
      rows: validRows,
    });
    if (res.success) {
      setImportMsg(res.message || 'Imported successfully.');
      setPreviewRows([]);
      loadData();
    } else {
      setImportMsg(res.message || 'Import failed.');
    }
  };

  const handleGenerateInvite = async (studentId: string) => {
    const res = await apiMutate<{ invitationCode: string }>(`/students/${studentId}/parent-invitation`, 'POST', {});
    if (res.success && res.data) {
      setInviteToast(`One-time parent invitation code: ${res.data.invitationCode}`);
    }
  };

  const handleVerifyProvisional = async (studentId: string) => {
    const res = await apiMutate(`/students/${studentId}`, 'PATCH', { enrollmentStatus: 'VERIFIED' });
    if (res.success) loadData();
  };

  const q = (filter || searchQuery).trim().toLowerCase();
  const visible = students.filter((s) =>
    q ? `${s.full_name} ${s.student_code} ${s.admission_number} ${s.class_name}`.toLowerCase().includes(q) : true
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Student Information & Accounts</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Tenant-isolated student roster for {user.activeSchoolName}
          </p>
        </div>
        {canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/v1/students/export"
              download
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 min-h-[40px]"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              <span>Export CSV</span>
            </a>
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 min-h-[40px]"
            >
              <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
              <span>Bulk CSV Import</span>
            </button>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#193054] min-h-[40px]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span>Create Student Account</span>
            </button>
          </div>
        )}
      </div>

      {inviteToast && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-cyan-200 dark:border-cyan-800 bg-cyan-50 dark:bg-cyan-950/40 px-4 py-3 text-xs font-mono text-cyan-900 dark:text-cyan-200">
          <span>{inviteToast}</span>
          <button type="button" onClick={() => setInviteToast(null)} aria-label="Dismiss code">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Search bar */}
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name, STU ID, admission #..."
          aria-label="Filter students"
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm min-h-[40px]"
        />
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {loading ? (
          <div className="p-8 text-center text-sm text-slate-500">Loading student roster...</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No student records match your filter.</div>
        ) : (
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                <th className="py-3 px-4 font-semibold">Student ID</th>
                <th className="py-3 px-4 font-semibold">Full Name</th>
                <th className="py-3 px-4 font-semibold">Class</th>
                <th className="py-3 px-4 font-semibold">Roll</th>
                <th className="py-3 px-4 font-semibold">Guardian</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visible.map((s) => (
                <tr key={String(s.id)} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4 font-mono text-xs font-semibold text-blue-700 dark:text-cyan-400">{String(s.student_code)}</td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900 dark:text-white">{String(s.full_name)}</div>
                    <div className="text-[11px] font-mono text-slate-500">{String(s.admission_number)}</div>
                  </td>
                  <td className="py-3 px-4 text-xs">{String(s.class_name)}-{String(s.section)}</td>
                  <td className="py-3 px-4 font-mono text-xs tabular-nums">{String(s.roll_number)}</td>
                  <td className="py-3 px-4 text-xs">
                    <div>{String(s.guardian_name)}</div>
                    <div className="text-[11px] text-slate-500 font-mono">{String(s.guardian_phone)}</div>
                  </td>
                  <td className="py-3 px-4 text-xs">
                    <span className={String(s.enrollment_status) === 'VERIFIED' ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                      {String(s.enrollment_status)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setStudent360Id(String(s.id))}
                      className="inline-flex items-center gap-1 rounded-md border border-blue-200 dark:border-cyan-800 bg-blue-50/70 dark:bg-cyan-950/30 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-cyan-300 hover:bg-blue-100 dark:hover:bg-cyan-900/40"
                    >
                      <QrCode className="h-3 w-3" />
                      <span>360° &amp; ID Card</span>
                    </button>
                    {canManage && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleGenerateInvite(String(s.id))}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <KeyRound className="h-3 w-3" />
                          <span>Parent Code</span>
                        </button>
                        {isTechOrPrincipal && String(s.enrollment_status) === 'PROVISIONAL' && (
                          <button
                            type="button"
                            onClick={() => handleVerifyProvisional(String(s.id))}
                            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                          >
                            <UserCheck className="h-3 w-3" />
                            <span>Verify</span>
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Student Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">Create Student Account</h2>
              <button type="button" onClick={() => setShowCreateModal(false)} aria-label="Close modal" className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            {formError && <p className="mb-3 text-xs text-red-600">{formError}</p>}
            <form onSubmit={handleCreateStudent} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Student Full Name</label>
                  <input required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Class & Section</label>
                  <select required value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]">
                    {classes.map((c) => (
                      <option key={String(c.id)} value={String(c.id)}>
                        {String(c.name)}-{String(c.section)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Roll Number</label>
                  <input type="number" min={1} required value={form.rollNumber} onChange={(e) => setForm({ ...form, rollNumber: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Admission Number</label>
                  <input required value={form.admissionNumber} onChange={(e) => setForm({ ...form, admissionNumber: e.target.value })} placeholder="ADM-2026-088" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Guardian Name</label>
                  <input required value={form.guardianName} onChange={(e) => setForm({ ...form, guardianName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Guardian Phone</label>
                  <input required value={form.guardianPhone} onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })} placeholder="+9779841000000" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Address</label>
                <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
              </div>
              <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-[#193054] min-h-[44px]">
                Create Student Account & Generate Login Card
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Printable Student Login Card Modal */}
      {loginCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm">
                <CheckCircle2 className="h-4 w-4" />
                <span>Student Login Card Issued</span>
              </div>
              <button type="button" onClick={() => setLoginCard(null)} aria-label="Close card" className="p-1.5 rounded-lg hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="rounded-xl border border-slate-300 dark:border-slate-700 p-4 space-y-2 bg-slate-50 dark:bg-slate-950 text-xs">
              <div className="font-bold text-sm text-slate-900 dark:text-white">{loginCard.schoolName}</div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div><span className="text-slate-500">Student:</span> <strong className="block text-slate-900 dark:text-white">{loginCard.studentName}</strong></div>
                <div><span className="text-slate-500">Class:</span> <strong className="block">{loginCard.className}</strong></div>
                <div><span className="text-slate-500">School ID:</span> <strong className="block font-mono">{loginCard.schoolCode}</strong></div>
                <div><span className="text-slate-500">Student ID:</span> <strong className="block font-mono">{loginCard.studentCode}</strong></div>
                <div><span className="text-slate-500">One-Time Password:</span> <strong className="block font-mono text-blue-700 dark:text-cyan-400">{loginCard.temporaryPassword}</strong></div>
                <div><span className="text-slate-500">Parent Invite Code:</span> <strong className="block font-mono">{loginCard.parentInvitationCode}</strong></div>
              </div>
              <p className="pt-2 text-[11px] text-slate-500">
                Student will be prompted to set a permanent password on first sign-in. Save this card now; the temporary password is not stored in plain text.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  generateStudentIdCardPdf({
                    school: { name: loginCard.schoolName, schoolCode: loginCard.schoolCode },
                    student: {
                      studentCode: loginCard.studentCode,
                      fullName: loginCard.studentName,
                      className: loginCard.className,
                      rollNumber: '-',
                      admissionNumber: loginCard.studentCode,
                    },
                  })
                }
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-blue-200 dark:border-cyan-800 py-2 text-xs font-semibold text-blue-700 dark:text-cyan-300"
              >
                <Download className="h-3.5 w-3.5" />
                <span>QR ID Card PDF</span>
              </button>
              <button type="button" onClick={() => window.print()} className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 py-2 text-xs font-semibold">
                <Printer className="h-3.5 w-3.5" />
                <span>Print</span>
              </button>
              <button type="button" onClick={() => setLoginCard(null)} className="flex-1 rounded-lg bg-[#0F1E36] py-2 text-xs font-semibold text-white">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk CSV Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Bulk Student Import (CSV)</h2>
              <button type="button" onClick={() => setShowImportModal(false)} aria-label="Close import modal" className="p-2 rounded-lg hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Target Class</label>
                <select value={importClassId} onChange={(e) => setImportClassId(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                  {classes.map((c) => (
                    <option key={String(c.id)} value={String(c.id)}>{String(c.name)}-{String(c.section)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">CSV Content (fullName,admissionNumber,rollNumber,guardianName,guardianPhone)</label>
                <textarea rows={4} value={csvText} onChange={(e) => setCsvText(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-xs font-mono" />
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={handlePreviewCsv} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold">
                  <Upload className="h-3.5 w-3.5" />
                  <span>Validate & Preview</span>
                </button>
                {previewRows.some((r) => Boolean(r.valid)) && (
                  <button type="button" onClick={handleConfirmImport} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">
                    <span>Confirm Import ({previewRows.filter((r) => Boolean(r.valid)).length} valid)</span>
                  </button>
                )}
              </div>
              {importMsg && <p className="text-xs font-medium text-blue-700 dark:text-cyan-400">{importMsg}</p>}
              {previewRows.length > 0 && (
                <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800">
                      <tr>
                        <th className="p-2">Name</th>
                        <th className="p-2">Admission #</th>
                        <th className="p-2">Roll</th>
                        <th className="p-2">Validation</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {previewRows.map((r, i) => (
                        <tr key={i}>
                          <td className="p-2">{String(r.fullName)}</td>
                          <td className="p-2 font-mono">{String(r.admissionNumber)}</td>
                          <td className="p-2 font-mono">{String(r.rollNumber)}</td>
                          <td className={`p-2 ${r.valid ? 'text-emerald-600' : 'text-red-600'}`}>
                            {r.valid ? 'Ready' : (r.errors as string[]).join(', ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {student360Id && (
        <Student360Modal
          studentId={student360Id}
          calendar={calendar}
          onClose={() => setStudent360Id(null)}
        />
      )}
    </div>
  );
};
