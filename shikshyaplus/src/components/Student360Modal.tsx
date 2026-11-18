import React, { useEffect, useState } from 'react';
import { Award, BookOpen, CreditCard, Download, GraduationCap, QrCode, ShieldCheck, Users, X } from 'lucide-react';
import { apiGet } from '../lib/api';
import { formatCurrency, formatDateByCalendar } from '../lib/domainRules';
import { generateQrDataUrl, generateStudentIdCardPdf } from '../lib/pdfGenerator';

interface Student360ProfileData {
  student: Record<string, unknown>;
  attendanceSummary: { present: number; absent: number; total: number; rate: number };
  recentAttendance: Array<Record<string, unknown>>;
  examMarks: Array<Record<string, unknown>>;
  overallGpa: { averageGpa: number; overallGrade: string; allPassed: boolean };
  invoices: Array<Record<string, unknown>>;
  libraryIssues: Array<Record<string, unknown>>;
  certificates: Array<Record<string, unknown>>;
  guardians: Array<Record<string, unknown>>;
}

interface Student360ModalProps {
  studentId: string;
  calendar: 'AD' | 'BS';
  onClose: () => void;
}

export const Student360Modal: React.FC<Student360ModalProps> = ({ studentId, calendar, onClose }) => {
  const [data, setData] = useState<Student360ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiGet<Student360ProfileData>(`/students/${studentId}/profile`, `stu_profile:${studentId}`);
        if (cancelled) return;
        if (res.success && res.data) {
          setData(res.data);
          const s = res.data.student;
          const qr = await generateQrDataUrl(
            `SHIKSHYAPLUS|${String(s.school_code)}|${String(s.student_code)}|${String(s.full_name)}`
          );
          if (!cancelled) setQrDataUrl(qr);
        } else {
          setError(res.message || 'Could not load student profile.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const handleDownloadIdCard = async () => {
    if (!data) return;
    setPdfBusy(true);
    try {
      const s = data.student;
      await generateStudentIdCardPdf({
        school: {
          name: String(s.school_name || 'ShikshyaPlus School'),
          schoolCode: String(s.school_code || ''),
          district: String(s.school_district || 'Nepal'),
        },
        student: {
          studentCode: String(s.student_code),
          fullName: String(s.full_name),
          className: `${String(s.class_name)}-${String(s.section)}`,
          rollNumber: String(s.roll_number),
          admissionNumber: String(s.admission_number),
          guardianName: String(s.guardian_name || ''),
          guardianPhone: String(s.guardian_phone || ''),
          address: String(s.address || ''),
        },
      });
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-4xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-[#0F1E36] text-white">
          <div className="flex items-center gap-2.5">
            <GraduationCap className="h-5 w-5 text-cyan-400" />
            <div>
              <h2 className="text-base font-bold">Student 360° Academic & Identity Profile</h2>
              <p className="text-[11px] text-slate-300">Verified Tenant Record & Digital QR ID Card</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Student 360 modal"
            className="rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500">Loading 360° student dossier...</div>
          ) : error || !data ? (
            <div className="py-8 text-center text-sm text-red-600">{error || 'Profile unavailable.'}</div>
          ) : (
            <>
              {/* Identity + QR ID Card Preview */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 p-5">
                <div className="md:col-span-8 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-blue-700 dark:text-cyan-400">
                      {String(data.student.student_code)}
                    </span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs font-mono text-slate-600 dark:text-slate-300">
                      {String(data.student.admission_number)}
                    </span>
                    <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {String(data.student.enrollment_status)}
                    </span>
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900 dark:text-white">{String(data.student.full_name)}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 text-xs">
                    <div>
                      <span className="text-slate-500 block">Class & Section</span>
                      <strong className="text-slate-900 dark:text-white">
                        {String(data.student.class_name)}-{String(data.student.section)} (Roll #{String(data.student.roll_number)})
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Primary Guardian</span>
                      <strong className="text-slate-900 dark:text-white">{String(data.student.guardian_name)}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block">Contact Phone</span>
                      <strong className="font-mono text-slate-900 dark:text-white">{String(data.student.guardian_phone)}</strong>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-4 flex flex-col items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
                  {qrDataUrl ? (
                    <img src={qrDataUrl} alt="Student QR Identity Code" className="h-24 w-24 rounded-lg border border-slate-100" />
                  ) : (
                    <QrCode className="h-20 w-20 text-slate-400" />
                  )}
                  <div className="text-[10px] font-mono text-slate-500 text-center">
                    QR ID · {String(data.student.school_code)}
                  </div>
                  <button
                    type="button"
                    disabled={pdfBusy}
                    onClick={handleDownloadIdCard}
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-[#193054] disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>{pdfBusy ? 'Generating PDF...' : 'Download ID Card PDF'}</span>
                  </button>
                </div>
              </div>

              {/* KPI Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <div className="text-[11px] text-slate-500">Attendance Rate</div>
                  <div className="mt-1 text-xl font-bold font-mono tabular-nums text-emerald-600">
                    {data.attendanceSummary.rate}%
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {data.attendanceSummary.present} present / {data.attendanceSummary.total} days
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <div className="text-[11px] text-slate-500">Aggregate GPA</div>
                  <div className="mt-1 text-xl font-bold font-mono tabular-nums text-blue-600 dark:text-cyan-400">
                    {data.examMarks.length > 0 ? data.overallGpa.averageGpa.toFixed(2) : '—'}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Grade: {data.examMarks.length > 0 ? data.overallGpa.overallGrade : 'No published exams'}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <div className="text-[11px] text-slate-500">Fee Invoices</div>
                  <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {data.invoices.length}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {data.invoices.filter((i) => String(i.status) !== 'PAID').length} unpaid
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                  <div className="text-[11px] text-slate-500">Certificates & Books</div>
                  <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                    {data.certificates.length} / {data.libraryIssues.filter((b) => !b.returned_at).length}
                  </div>
                  <div className="text-[11px] text-slate-500">Issued certs / active books</div>
                </div>
              </div>

              {/* Exam Results */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Award className="h-4 w-4 text-blue-600" />
                  <span>Academic Marks & Transcript Summary</span>
                </h4>
                {data.examMarks.length === 0 ? (
                  <p className="text-xs text-slate-500">No examination marks recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                          <th className="py-2 pr-3">Exam</th>
                          <th className="py-2 pr-3">Subject</th>
                          <th className="py-2 pr-3 text-right">Theory + Prac</th>
                          <th className="py-2 pr-3 text-right">Grade</th>
                          <th className="py-2 text-right">GPA</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {data.examMarks.map((m) => (
                          <tr key={String(m.id)}>
                            <td className="py-2 pr-3">{String(m.exam_name)}</td>
                            <td className="py-2 pr-3 font-medium">{String(m.subject_name)}</td>
                            <td className="py-2 pr-3 text-right font-mono tabular-nums">
                              {Number(m.theory_marks) + Number(m.practical_marks)}/{String(m.full_marks)}
                            </td>
                            <td className="py-2 pr-3 text-right font-mono font-bold text-blue-600 dark:text-cyan-400">
                              {String(m.grade)}
                            </td>
                            <td className="py-2 text-right font-mono tabular-nums">{Number(m.gpa).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Fees, Library & Certificates */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2.5">
                  <h4 className="text-sm font-bold flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-emerald-600" />
                    <span>Fee Ledger</span>
                  </h4>
                  {data.invoices.length === 0 ? (
                    <p className="text-xs text-slate-500">No invoices billed.</p>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                      {data.invoices.map((inv) => (
                        <div key={String(inv.id)} className="py-2 flex items-center justify-between">
                          <div>
                            <div className="font-semibold">{String(inv.title)}</div>
                            <div className="text-[11px] text-slate-500">
                              Due {formatDateByCalendar(String(inv.due_date), calendar)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-mono font-semibold">
                              {formatCurrency(Number(inv.amount) - Number(inv.discount || 0), 'NPR')}
                            </div>
                            <div className={`text-[11px] font-mono ${String(inv.status) === 'PAID' ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {String(inv.status)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                  <h4 className="text-sm font-bold flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-indigo-600" />
                    <span>Library & Guardians</span>
                  </h4>
                  {data.libraryIssues.length === 0 ? (
                    <p className="text-xs text-slate-500">No library books issued.</p>
                  ) : (
                    <div className="space-y-1.5 text-xs">
                      {data.libraryIssues.map((b) => (
                        <div key={String(b.id)} className="flex justify-between">
                          <span className="truncate">{String(b.book_title)}</span>
                          <span className="font-mono text-slate-500 shrink-0 ml-2">
                            {b.returned_at ? 'Returned' : `Due ${formatDateByCalendar(String(b.due_date), calendar)}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="text-xs font-semibold flex items-center gap-1.5 mb-1.5">
                      <Users className="h-3.5 w-3.5 text-blue-600" />
                      <span>Linked App Guardians ({data.guardians.length})</span>
                    </div>
                    {data.guardians.length === 0 ? (
                      <p className="text-[11px] text-slate-500">Guardian app account not yet linked via invite code.</p>
                    ) : (
                      data.guardians.map((g, idx) => (
                        <div key={idx} className="text-xs text-slate-600 dark:text-slate-300">
                          {String(g.full_name)} ({String(g.relationship)}) · <span className="font-mono">{String(g.phone)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
