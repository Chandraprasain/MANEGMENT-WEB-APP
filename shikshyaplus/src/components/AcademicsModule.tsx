import React, { useEffect, useRef, useState } from 'react';
import { Award, BookOpen, Calendar, Camera, CheckCircle2, ClipboardCheck, Clock, Download, FileText, Paperclip, Plus, Printer, QrCode, X } from 'lucide-react';
import { apiGet, apiMutate } from '../lib/api';
import { formatDateByCalendar } from '../lib/domainRules';
import { generateReportCardPdf } from '../lib/pdfGenerator';
import type { AuthUser } from '../types';

interface AcademicsModuleProps {
  user: AuthUser;
  calendar: 'AD' | 'BS';
}

type SubTab = 'homework' | 'attendance' | 'exams' | 'diary' | 'timetable';

export const AcademicsModule: React.FC<AcademicsModuleProps> = ({ user, calendar }) => {
  const [subTab, setSubTab] = useState<SubTab>('homework');
  const [classes, setClasses] = useState<Array<Record<string, unknown>>>([]);
  const [students, setStudents] = useState<Array<Record<string, unknown>>>([]);
  const [homework, setHomework] = useState<Array<Record<string, unknown>>>([]);
  const [attendance, setAttendance] = useState<Array<Record<string, unknown>>>([]);
  const [exams, setExams] = useState<Array<Record<string, unknown>>>([]);
  const [diary, setDiary] = useState<Array<Record<string, unknown>>>([]);
  const [timetable, setTimetable] = useState<Array<Record<string, unknown>>>([]);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const isTeacherOrPrincipal = ['PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER', 'EXAM_OFFICER'].includes(user.activeRole);
  const canQrCheckIn = isTeacherOrPrincipal || user.activeRole === 'STAFF_RECEPTION';
  const canManageStructure = ['PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG'].includes(user.activeRole);
  const isStudent = user.activeRole === 'STUDENT';

  // Forms
  const [hwForm, setHwForm] = useState({ classId: '', subjectName: 'Compulsory Mathematics', title: '', instructions: '', dueDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10) });
  const [subTextMap, setSubTextMap] = useState<Record<string, string>>({});
  const [subAttachmentMap, setSubAttachmentMap] = useState<Record<string, { url: string; name: string } | null>>({});
  const [uploadingHwId, setUploadingHwId] = useState<string | null>(null);
  const [reviewMarksMap, setReviewMarksMap] = useState<Record<string, string>>({});
  const [reviewFeedbackMap, setReviewFeedbackMap] = useState<Record<string, string>>({});
  const [attClassId, setAttClassId] = useState('');
  const [attDate, setAttDate] = useState(new Date().toISOString().slice(0, 10));
  const [attMarks, setAttMarks] = useState<Record<string, 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED'>>({});
  const [qrInput, setQrInput] = useState('');
  const [qrStatus, setQrStatus] = useState<'PRESENT' | 'LATE'>('PRESENT');
  const [qrLoading, setQrLoading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraMsg, setCameraMsg] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [selectedPdfStudentMap, setSelectedPdfStudentMap] = useState<Record<string, string>>({});
  const [diaryForm, setDiaryForm] = useState({ classId: '', entryDate: new Date().toISOString().slice(0, 10), subjectName: 'Science & Technology', topic: '', classwork: '', homeworkSummary: '', nextDayPrep: '' });
  const [examForm, setExamForm] = useState({ name: '', classId: '', examDate: new Date().toISOString().slice(0, 10) });
  const [markForm, setMarkForm] = useState({ examId: '', studentId: '', subjectName: 'Compulsory Mathematics', theoryMarks: '65', practicalMarks: '22', fullMarks: '100', passMarks: '40' });
  const [classForm, setClassForm] = useState({ name: '', section: 'A', room: 'Room 101' });
  const [teachers, setTeachers] = useState<Array<Record<string, unknown>>>([]);
  const [ttForm, setTtForm] = useState({
    classId: '',
    dayOfWeek: 'Sunday',
    periodNumber: '1',
    timeSlot: '09:30 - 10:15',
    subjectName: 'Compulsory Mathematics',
    teacherUserId: '',
    room: 'Room 204',
  });

  const loadAll = async () => {
    const [cRes, sRes, hRes, aRes, eRes, dRes, tRes, mRes] = await Promise.all([
      apiGet<{ classes: Array<Record<string, unknown>> }>('/academics/classes', `classes:${user.activeSchoolId}`),
      apiGet<{ students: Array<Record<string, unknown>> }>('/students', `students:${user.activeSchoolId}`),
      apiGet<{ homework: Array<Record<string, unknown>> }>('/academics/homework', `hw:${user.activeSchoolId}`),
      apiGet<{ records: Array<Record<string, unknown>> }>('/academics/attendance', `att:${user.activeSchoolId}`),
      apiGet<{ exams: Array<Record<string, unknown>> }>('/academics/exams', `exams:${user.activeSchoolId}`),
      apiGet<{ entries: Array<Record<string, unknown>> }>('/academics/diary', `diary:${user.activeSchoolId}`),
      apiGet<{ timetable: Array<Record<string, unknown>> }>('/academics/timetable', `tt:${user.activeSchoolId}`),
      canManageStructure && user.activeSchoolId
        ? apiGet<{ members: Array<Record<string, unknown>> }>(`/schools/${user.activeSchoolId}/members`, `ops:members:${user.activeSchoolId}`)
        : Promise.resolve({ success: false, data: undefined }),
    ]);
    if (cRes.success && cRes.data) {
      setClasses(cRes.data.classes);
      if (cRes.data.classes[0]) {
        const cid = String(cRes.data.classes[0].id);
        setHwForm((p) => ({ ...p, classId: p.classId || cid }));
        setAttClassId((p) => p || cid);
        setDiaryForm((p) => ({ ...p, classId: p.classId || cid }));
        setExamForm((p) => ({ ...p, classId: p.classId || cid }));
        setTtForm((p) => ({ ...p, classId: p.classId || cid }));
      }
    }
    if (sRes.success && sRes.data) {
      setStudents(sRes.data.students);
      if (sRes.data.students[0]) {
        setMarkForm((p) => ({ ...p, studentId: p.studentId || String(sRes.data!.students[0].id) }));
      }
    }
    if (hRes.success && hRes.data) setHomework(hRes.data.homework);
    if (aRes.success && aRes.data) setAttendance(aRes.data.records);
    if (eRes.success && eRes.data) {
      setExams(eRes.data.exams);
      if (eRes.data.exams[0]) {
        setMarkForm((p) => ({ ...p, examId: p.examId || String(eRes.data!.exams[0].id) }));
      }
    }
    if (dRes.success && dRes.data) setDiary(dRes.data.entries);
    if (tRes.success && tRes.data) setTimetable(tRes.data.timetable);
    if (mRes.success && mRes.data) {
      const teachingStaff = mRes.data.members.filter((m) =>
        ['TEACHER', 'CLASS_TEACHER', 'PRINCIPAL', 'VICE_PRINCIPAL'].includes(String(m.role))
      );
      setTeachers(teachingStaff);
      if (teachingStaff[0]) {
        setTtForm((p) => ({ ...p, teacherUserId: p.teacherUserId || String(teachingStaff[0].user_id) }));
      }
    }
  };

  useEffect(() => {
    loadAll();
  }, [user.activeSchoolId]);

  const handleCreateHomework = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/academics/homework', 'POST', hwForm, { queueIfOffline: true, offlineLabel: 'Assign Homework' });
    setFeedbackMsg(res.message || 'Homework created.');
    if (res.success) {
      setHwForm((p) => ({ ...p, title: '', instructions: '' }));
      loadAll();
    }
  };

  const handleUploadHomeworkFile = async (hwId: string, file: File) => {
    setUploadingHwId(hwId);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('visibility', 'SCHOOL_PRIVATE');
      const res = await fetch('/api/v1/files/upload', { method: 'POST', credentials: 'include', body: fd });
      const json = (await res.json()) as { success: boolean; data?: { url: string; originalName: string }; message?: string };
      if (json.success && json.data?.url) {
        setSubAttachmentMap((prev) => ({ ...prev, [hwId]: { url: json.data!.url, name: json.data!.originalName || file.name } }));
      } else {
        setFeedbackMsg(json.message || 'Attachment upload failed.');
      }
    } catch {
      setFeedbackMsg('Network error uploading homework attachment.');
    } finally {
      setUploadingHwId(null);
    }
  };

  const handleSubmitHomework = async (hwId: string) => {
    const att = subAttachmentMap[hwId];
    const rawText = (subTextMap[hwId] || '').trim();
    const submissionText = rawText || (att ? `Attached file: ${att.name}` : '');
    const res = await apiMutate(
      `/academics/homework/${hwId}/submit`,
      'POST',
      { submissionText, attachmentPath: att?.url },
      { queueIfOffline: true, offlineLabel: 'Homework Submission' }
    );
    setFeedbackMsg(res.message || 'Submitted.');
    if (res.success) {
      setSubTextMap((prev) => ({ ...prev, [hwId]: '' }));
      setSubAttachmentMap((prev) => ({ ...prev, [hwId]: null }));
      loadAll();
    }
  };

  const handleReviewSubmission = async (subId: string) => {
    const marks = Number(reviewMarksMap[subId] ?? 10);
    const feedback = reviewFeedbackMap[subId] || 'Well done.';
    const res = await apiMutate(`/academics/homework/submissions/${subId}/review`, 'POST', {
      marks,
      feedback,
      status: 'REVIEWED',
    });
    setFeedbackMsg(res.message || 'Submission reviewed.');
    if (res.success) loadAll();
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/academics/classes', 'POST', classForm);
    setFeedbackMsg(res.message || 'Class created.');
    if (res.success) {
      setClassForm({ name: '', section: 'A', room: 'Room 101' });
      loadAll();
    }
  };

  const handleScheduleTimetable = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/academics/timetable', 'POST', ttForm);
    setFeedbackMsg(res.message || 'Timetable updated.');
    if (res.success) loadAll();
  };

  const stopCameraScan = () => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOpen(false);
  };

  useEffect(() => {
    return () => {
      stopCameraScan();
    };
  }, []);

  const submitQrCheckIn = async (payloadText: string) => {
    const trimmed = payloadText.trim();
    if (!trimmed) return;
    setQrLoading(true);
    const res = await apiMutate('/academics/attendance/qr-checkin', 'POST', {
      qrPayload: trimmed,
      sessionDate: attDate,
      status: qrStatus,
    });
    setQrLoading(false);
    setFeedbackMsg(res.message || 'QR check-in processed.');
    if (res.success) {
      setQrInput('');
      loadAll();
    }
  };

  const handleQrFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitQrCheckIn(qrInput);
  };

  const handleStartCameraScan = async () => {
    setCameraMsg(null);
    const win = window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => { detect: (src: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>> } };
    if (!win.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setCameraMsg('Camera QR detector is unavailable in this browser. Enter Student ID (e.g. STU-001) or paste a scanned QR code above.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      setCameraOpen(true);
      const detector = new win.BarcodeDetector({ formats: ['qr_code'] });
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        const scanTick = async () => {
          if (!videoRef.current || !streamRef.current) return;
          try {
            if (videoRef.current.readyState >= 2) {
              const codes = await detector.detect(videoRef.current);
              const val = codes.find((c) => c.rawValue)?.rawValue;
              if (val) {
                stopCameraScan();
                setQrInput(val);
                await submitQrCheckIn(val);
                return;
              }
            }
          } catch {
            // Continue scanning frames cleanly
          }
          rafRef.current = window.requestAnimationFrame(scanTick);
        };
        rafRef.current = window.requestAnimationFrame(scanTick);
      }, 60);
    } catch {
      stopCameraScan();
      setCameraMsg('Unable to access camera. Check permissions or type the Student ID manually above.');
    }
  };

  const handleSaveAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    const classStudents = students.filter((s) => String(s.class_id) === attClassId);
    const entries = classStudents.map((s) => ({
      studentId: String(s.id),
      status: attMarks[String(s.id)] || 'PRESENT',
    }));
    const res = await apiMutate('/academics/attendance', 'POST', { classId: attClassId, sessionDate: attDate, entries }, { queueIfOffline: true, offlineLabel: 'Attendance Sheet' });
    setFeedbackMsg(res.message || 'Attendance recorded.');
    if (res.success) loadAll();
  };

  const handleCreateDiary = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/academics/diary', 'POST', diaryForm, { queueIfOffline: true, offlineLabel: 'Daily Diary Entry' });
    setFeedbackMsg(res.message || 'Diary entry published.');
    if (res.success) {
      setDiaryForm((p) => ({ ...p, topic: '', classwork: '', homeworkSummary: '' }));
      loadAll();
    }
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate('/academics/exams', 'POST', examForm);
    setFeedbackMsg(res.message || 'Exam created.');
    if (res.success) {
      setExamForm((p) => ({ ...p, name: '' }));
      loadAll();
    }
  };

  const handleSaveMarks = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate(`/academics/exams/${markForm.examId}/marks`, 'POST', {
      studentId: markForm.studentId,
      subjectName: markForm.subjectName,
      theoryMarks: Number(markForm.theoryMarks),
      practicalMarks: Number(markForm.practicalMarks),
      fullMarks: Number(markForm.fullMarks),
      passMarks: Number(markForm.passMarks),
    });
    setFeedbackMsg(res.message || 'Marks saved.');
    if (res.success) loadAll();
  };

  const handleExamStatus = async (examId: string, status: 'SUBMITTED' | 'APPROVED' | 'PUBLISHED') => {
    const res = await apiMutate(`/academics/exams/${examId}/status`, 'POST', { status });
    setFeedbackMsg(res.message || `Exam updated to ${status}.`);
    if (res.success) loadAll();
  };

  const tabs: Array<{ id: SubTab; label: string; icon: React.ReactNode }> = [
    { id: 'homework', label: 'Homework', icon: <BookOpen className="h-3.5 w-3.5" /> },
    { id: 'attendance', label: 'Attendance', icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
    { id: 'exams', label: 'Exams & Results', icon: <Award className="h-3.5 w-3.5" /> },
    { id: 'diary', label: 'Daily Diary', icon: <Calendar className="h-3.5 w-3.5" /> },
    { id: 'timetable', label: 'Timetable', icon: <Clock className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Academic Operations</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Homework, attendance, examinations, daily diary, and class timetables
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setSubTab(tb.id)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                subTab === tb.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
              }`}
            >
              {tb.icon}
              <span>{tb.label}</span>
            </button>
          ))}
        </div>
      </div>

      {feedbackMsg && (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* HOMEWORK */}
      {subTab === 'homework' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {isTeacherOrPrincipal && (
            <div className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 h-fit">
              <h2 className="text-base font-bold mb-3">Assign Homework</h2>
              <form onSubmit={handleCreateHomework} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Class</label>
                  <select value={hwForm.classId} onChange={(e) => setHwForm({ ...hwForm, classId: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                    {classes.map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}-{String(c.section)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Subject</label>
                  <input required value={hwForm.subjectName} onChange={(e) => setHwForm({ ...hwForm, subjectName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Title</label>
                  <input required value={hwForm.title} onChange={(e) => setHwForm({ ...hwForm, title: e.target.value })} placeholder="Chapter 6 Trigonometry Set" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Instructions</label>
                  <textarea required rows={3} value={hwForm.instructions} onChange={(e) => setHwForm({ ...hwForm, instructions: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Due Date</label>
                  <input type="date" required value={hwForm.dueDate} onChange={(e) => setHwForm({ ...hwForm, dueDate: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                </div>
                <button type="submit" className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white min-h-[42px]">
                  <Plus className="h-3.5 w-3.5" />
                  <span>Publish Homework</span>
                </button>
              </form>
            </div>
          )}

          <div className={`${isTeacherOrPrincipal ? 'lg:col-span-8' : 'lg:col-span-12'} space-y-4`}>
            {homework.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500">
                No homework assigned yet.
              </div>
            ) : (
              homework.map((hw) => (
                <div key={String(hw.id)} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-medium text-blue-600 dark:text-cyan-400">
                      {String(hw.subject_name)} · {String(hw.class_name)}-{String(hw.section)} · Due {formatDateByCalendar(String(hw.due_date), calendar)}
                    </div>
                    <span className="text-xs font-mono text-slate-500">By {String(hw.teacher_name)}</span>
                  </div>
                  <h3 className="mt-1.5 text-base font-bold text-slate-900 dark:text-white">{String(hw.title)}</h3>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{String(hw.instructions)}</p>

                  {isStudent && (
                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                      {hw.mySubmission ? (
                        <div className="text-xs text-emerald-700 dark:text-emerald-300 space-y-1.5">
                          <div>
                            Status: <strong>{String((hw.mySubmission as Record<string, unknown>).status)}</strong> —{' '}
                            {String((hw.mySubmission as Record<string, unknown>).submission_text)}
                          </div>
                          {Boolean((hw.mySubmission as Record<string, unknown>).attachment_path) && (
                            <div>
                              <a
                                href={String((hw.mySubmission as Record<string, unknown>).attachment_path)}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-blue-600 dark:text-cyan-400 hover:underline font-medium"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                <span>View Uploaded Attachment</span>
                              </a>
                            </div>
                          )}
                          {(hw.mySubmission as Record<string, unknown>).marks !== null &&
                            (hw.mySubmission as Record<string, unknown>).marks !== undefined && (
                              <div className="font-mono text-blue-700 dark:text-cyan-300">
                                Marks: {String((hw.mySubmission as Record<string, unknown>).marks)}/100 · Feedback:{' '}
                                {String((hw.mySubmission as Record<string, unknown>).feedback || '')}
                              </div>
                            )}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex flex-col sm:flex-row gap-2">
                            <input
                              value={subTextMap[String(hw.id)] || ''}
                              onChange={(e) => setSubTextMap({ ...subTextMap, [String(hw.id)]: e.target.value })}
                              placeholder="Write your solution notes or summary..."
                              className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]"
                            />
                            <label className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[40px] shrink-0">
                              <Paperclip className="h-3.5 w-3.5" />
                              <span>{uploadingHwId === String(hw.id) ? 'Uploading...' : 'Attach File'}</span>
                              <input
                                type="file"
                                className="hidden"
                                disabled={uploadingHwId === String(hw.id)}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleUploadHomeworkFile(String(hw.id), file);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => handleSubmitHomework(String(hw.id))}
                              className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 min-h-[40px] shrink-0"
                            >
                              Submit Work
                            </button>
                          </div>
                          {subAttachmentMap[String(hw.id)] && (
                            <div className="inline-flex items-center gap-2 text-[11px] text-blue-700 dark:text-cyan-400">
                              <FileText className="h-3.5 w-3.5" />
                              <span>Attached: {subAttachmentMap[String(hw.id)]!.name}</span>
                              <button
                                type="button"
                                onClick={() => setSubAttachmentMap((prev) => ({ ...prev, [String(hw.id)]: null }))}
                                className="text-slate-500 hover:text-red-600"
                                aria-label="Remove attachment"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {isTeacherOrPrincipal && Array.isArray(hw.submissions) && (hw.submissions as Array<Record<string, unknown>>).length > 0 && (
                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                      <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Student Submissions ({(hw.submissions as Array<Record<string, unknown>>).length})
                      </div>
                      {(hw.submissions as Array<Record<string, unknown>>).map((sub) => {
                        const subId = String(sub.id);
                        return (
                          <div key={subId} className="rounded-xl bg-slate-50 dark:bg-slate-950 p-3 text-xs space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold text-slate-900 dark:text-white">
                                {String(sub.student_name)} ({String(sub.student_code)})
                              </span>
                              <span className="font-mono text-blue-600 dark:text-cyan-400">
                                {String(sub.status)}
                                {sub.marks !== null && sub.marks !== undefined ? ` · ${String(sub.marks)}/100` : ''}
                              </span>
                            </div>
                            <p className="text-slate-600 dark:text-slate-300">{String(sub.submission_text)}</p>
                            {Boolean(sub.attachment_path) && (
                              <div>
                                <a
                                  href={String(sub.attachment_path)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-blue-600 dark:text-cyan-400 hover:underline font-medium"
                                >
                                  <FileText className="h-3.5 w-3.5" />
                                  <span>View Submitted File</span>
                                </a>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-2 items-center">
                              <input
                                type="number"
                                min={0}
                                max={100}
                                placeholder="Marks /100"
                                value={reviewMarksMap[subId] ?? (sub.marks !== null && sub.marks !== undefined ? String(sub.marks) : '')}
                                onChange={(e) => setReviewMarksMap({ ...reviewMarksMap, [subId]: e.target.value })}
                                className="w-24 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs font-mono"
                              />
                              <input
                                placeholder="Feedback for student..."
                                value={reviewFeedbackMap[subId] ?? String(sub.feedback || '')}
                                onChange={(e) => setReviewFeedbackMap({ ...reviewFeedbackMap, [subId]: e.target.value })}
                                className="flex-1 min-w-[160px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => handleReviewSubmission(subId)}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                              >
                                Save Grade
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ATTENDANCE */}
      {subTab === 'attendance' && (
        <div className="space-y-6">
          {canQrCheckIn && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <QrCode className="h-4 w-4 text-blue-600 dark:text-cyan-400" />
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">Instant QR ID Attendance Check-In</h2>
                </div>
                <span className="text-[11px] font-mono text-slate-500">
                  Accepts Student ID (STU-001) or SHIKSHYAPLUS|SCHOOL|STU-XXX
                </span>
              </div>
              <form onSubmit={handleQrFormSubmit} className="flex flex-col sm:flex-row gap-2">
                <input
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  placeholder="Scan QR or enter Student ID (e.g. STU-001)"
                  aria-label="QR payload or Student ID"
                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-mono min-h-[40px]"
                />
                <select
                  value={qrStatus}
                  onChange={(e) => setQrStatus(e.target.value as 'PRESENT' | 'LATE')}
                  aria-label="QR Check-in Status"
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-semibold min-h-[40px]"
                >
                  <option value="PRESENT">PRESENT</option>
                  <option value="LATE">LATE</option>
                </select>
                <button
                  type="submit"
                  disabled={qrLoading || !qrInput.trim()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 min-h-[40px]"
                >
                  <QrCode className="h-3.5 w-3.5" />
                  <span>{qrLoading ? 'Checking In...' : 'Check In'}</span>
                </button>
                <button
                  type="button"
                  onClick={cameraOpen ? stopCameraScan : handleStartCameraScan}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[40px]"
                >
                  <Camera className="h-3.5 w-3.5" />
                  <span>{cameraOpen ? 'Stop Camera' : 'Scan Camera QR'}</span>
                </button>
              </form>
              {cameraMsg && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  {cameraMsg}
                </div>
              )}
              {cameraOpen && (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 p-3 max-w-sm">
                  <video ref={videoRef} className="w-full rounded-lg aspect-video object-cover" muted playsInline />
                  <p className="mt-1.5 text-[11px] text-slate-300 text-center">Point camera at student QR identity card...</p>
                </div>
              )}
            </div>
          )}
          {isTeacherOrPrincipal && (
            <form onSubmit={handleSaveAttendance} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">Class</label>
                    <select value={attClassId} onChange={(e) => setAttClassId(e.target.value)} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                      {classes.map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}-{String(c.section)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Date</label>
                    <input type="date" value={attDate} onChange={(e) => setAttDate(e.target.value)} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                  </div>
                </div>
                <button type="submit" className="rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white min-h-[40px]">
                  Save Attendance Roll
                </button>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {students.filter((s) => String(s.class_id) === attClassId).map((s) => {
                  const sid = String(s.id);
                  const current = attMarks[sid] || 'PRESENT';
                  return (
                    <div key={sid} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="text-sm">
                        <span className="font-mono text-xs text-slate-500 mr-2">#{String(s.roll_number)}</span>
                        <span className="font-medium">{String(s.full_name)}</span>
                      </div>
                      <div className="flex gap-1">
                        {(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'] as const).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setAttMarks({ ...attMarks, [sid]: st })}
                            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold ${
                              current === st
                                ? st === 'PRESENT'
                                  ? 'bg-emerald-600 text-white'
                                  : st === 'ABSENT'
                                    ? 'bg-red-600 text-white'
                                    : 'bg-amber-600 text-white'
                                : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </form>
          )}

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Student</th>
                  <th className="py-3 px-4">Class</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {attendance.map((r) => (
                  <tr key={String(r.id)}>
                    <td className="py-2.5 px-4 font-mono text-xs">{formatDateByCalendar(String(r.session_date), calendar)}</td>
                    <td className="py-2.5 px-4">{String(r.student_name)}</td>
                    <td className="py-2.5 px-4 text-xs">{String(r.class_name)}-{String(r.section)}</td>
                    <td className={`py-2.5 px-4 text-xs font-semibold ${String(r.status) === 'PRESENT' ? 'text-emerald-600' : String(r.status) === 'ABSENT' ? 'text-red-600' : 'text-amber-600'}`}>
                      {String(r.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* EXAMS & RESULTS */}
      {subTab === 'exams' && (
        <div className="space-y-6">
          {isTeacherOrPrincipal && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <form onSubmit={handleCreateExam} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                <h2 className="text-base font-bold">Schedule Examination</h2>
                <input required value={examForm.name} onChange={(e) => setExamForm({ ...examForm, name: e.target.value })} placeholder="Second Terminal Exam 2083" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                <div className="grid grid-cols-2 gap-3">
                  <select value={examForm.classId} onChange={(e) => setExamForm({ ...examForm, classId: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                    {classes.map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}-{String(c.section)}</option>)}
                  </select>
                  <input type="date" value={examForm.examDate} onChange={(e) => setExamForm({ ...examForm, examDate: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
                </div>
                <button type="submit" className="rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white">Create Draft Exam</button>
              </form>

              <form onSubmit={handleSaveMarks} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                <h2 className="text-base font-bold">Enter Subject Marks</h2>
                <div className="grid grid-cols-2 gap-2">
                  <select value={markForm.examId} onChange={(e) => setMarkForm({ ...markForm, examId: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs">
                    {exams.map((ex) => <option key={String(ex.id)} value={String(ex.id)}>{String(ex.name)}</option>)}
                  </select>
                  <select value={markForm.studentId} onChange={(e) => setMarkForm({ ...markForm, studentId: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs">
                    {students.map((st) => <option key={String(st.id)} value={String(st.id)}>{String(st.full_name)}</option>)}
                  </select>
                  <input value={markForm.subjectName} onChange={(e) => setMarkForm({ ...markForm, subjectName: e.target.value })} placeholder="Subject" className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs" />
                  <div className="grid grid-cols-2 gap-2">
                    <input type="number" value={markForm.theoryMarks} onChange={(e) => setMarkForm({ ...markForm, theoryMarks: e.target.value })} placeholder="Theory" className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-xs" />
                    <input type="number" value={markForm.practicalMarks} onChange={(e) => setMarkForm({ ...markForm, practicalMarks: e.target.value })} placeholder="Prac" className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-xs" />
                  </div>
                </div>
                <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white">Save & Compute Grade</button>
              </form>
            </div>
          )}

          {exams.map((ex) => {
            const examMarks = (ex.marks as Array<Record<string, unknown>>) || [];
            const studentGroups = new Map<
              string,
              {
                studentId: string;
                studentName: string;
                studentCode: string;
                marks: Array<{
                  subject_name: string;
                  theory_marks: number;
                  practical_marks: number;
                  full_marks: number;
                  grade: string;
                  gpa: number;
                }>;
              }
            >();
            for (const m of examMarks) {
              const sid = String(m.student_id || m.student_code);
              if (!studentGroups.has(sid)) {
                studentGroups.set(sid, {
                  studentId: sid,
                  studentName: String(m.student_name),
                  studentCode: String(m.student_code),
                  marks: [],
                });
              }
              studentGroups.get(sid)!.marks.push({
                subject_name: String(m.subject_name),
                theory_marks: Number(m.theory_marks),
                practical_marks: Number(m.practical_marks),
                full_marks: Number(m.full_marks),
                grade: String(m.grade),
                gpa: Number(m.gpa),
              });
            }
            const groupedStudents = Array.from(studentGroups.values());
            const examIdStr = String(ex.id);
            const chosenStudentId = selectedPdfStudentMap[examIdStr] || groupedStudents[0]?.studentId || '';
            const chosenGroup = studentGroups.get(chosenStudentId) || groupedStudents[0];

            return (
            <div key={examIdStr} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-mono text-slate-500">
                    {String(ex.class_name)}-{String(ex.section)} · {formatDateByCalendar(String(ex.exam_date), calendar)} · Status: <strong>{String(ex.status)}</strong>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{String(ex.name)}</h3>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {groupedStudents.length > 1 && (
                    <select
                      aria-label={`Select student for ${String(ex.name)} marksheet PDF`}
                      value={chosenStudentId}
                      onChange={(e) => setSelectedPdfStudentMap((prev) => ({ ...prev, [examIdStr]: e.target.value }))}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
                    >
                      {groupedStudents.map((gs) => (
                        <option key={gs.studentId} value={gs.studentId}>
                          {gs.studentName} ({gs.studentCode})
                        </option>
                      ))}
                    </select>
                  )}
                  {chosenGroup && (
                    <button
                      type="button"
                      onClick={() =>
                        generateReportCardPdf({
                          school: {
                            name: user.activeSchoolName || 'ShikshyaPlus School',
                            schoolCode: user.activeSchoolCode || '',
                          },
                          examName: String(ex.name),
                          examDate: String(ex.exam_date),
                          calendar,
                          studentName: chosenGroup.studentName,
                          studentCode: chosenGroup.studentCode,
                          className: `${String(ex.class_name)}-${String(ex.section)}`,
                          marks: chosenGroup.marks,
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-cyan-300 hover:bg-blue-100"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Marksheet PDF ({chosenGroup.studentCode})</span>
                    </button>
                  )}
                  <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium">
                    <Printer className="h-3.5 w-3.5" />
                    <span>Print Report Card</span>
                  </button>
                  {isTeacherOrPrincipal && String(ex.status) === 'DRAFT' && (
                    <button type="button" onClick={() => handleExamStatus(examIdStr, 'SUBMITTED')} className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white">
                      Submit for Review
                    </button>
                  )}
                  {(user.activeRole === 'PRINCIPAL' || user.activeRole === 'EXAM_OFFICER') && String(ex.status) !== 'PUBLISHED' && (
                    <button type="button" onClick={() => handleExamStatus(examIdStr, 'PUBLISHED')} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white">
                      Approve & Publish
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                      <th className="py-2 pr-4">Student</th>
                      <th className="py-2 pr-4">Subject</th>
                      <th className="py-2 pr-4 text-right">Theory</th>
                      <th className="py-2 pr-4 text-right">Practical</th>
                      <th className="py-2 pr-4 text-right">Total</th>
                      <th className="py-2 pr-4 text-right">Grade</th>
                      <th className="py-2 text-right">GPA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {((ex.marks as Array<Record<string, unknown>>) || []).map((m) => (
                      <tr key={String(m.id)}>
                        <td className="py-2 pr-4 font-medium">{String(m.student_name)} ({String(m.student_code)})</td>
                        <td className="py-2 pr-4">{String(m.subject_name)}</td>
                        <td className="py-2 pr-4 text-right font-mono tabular-nums">{String(m.theory_marks)}</td>
                        <td className="py-2 pr-4 text-right font-mono tabular-nums">{String(m.practical_marks)}</td>
                        <td className="py-2 pr-4 text-right font-mono tabular-nums font-semibold">{Number(m.theory_marks) + Number(m.practical_marks)}/{String(m.full_marks)}</td>
                        <td className="py-2 pr-4 text-right font-mono font-bold text-blue-700 dark:text-cyan-400">{String(m.grade)}</td>
                        <td className="py-2 text-right font-mono tabular-nums">{Number(m.gpa).toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* DAILY DIARY */}
      {subTab === 'diary' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {isTeacherOrPrincipal && (
            <form onSubmit={handleCreateDiary} className="lg:col-span-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
              <h2 className="text-base font-bold">Add Daily Diary Entry</h2>
              <select value={diaryForm.classId} onChange={(e) => setDiaryForm({ ...diaryForm, classId: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                {classes.map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}-{String(c.section)}</option>)}
              </select>
              <input type="date" value={diaryForm.entryDate} onChange={(e) => setDiaryForm({ ...diaryForm, entryDate: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
              <input required value={diaryForm.subjectName} onChange={(e) => setDiaryForm({ ...diaryForm, subjectName: e.target.value })} placeholder="Subject" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
              <input required value={diaryForm.topic} onChange={(e) => setDiaryForm({ ...diaryForm, topic: e.target.value })} placeholder="Today's Topic" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
              <textarea required rows={2} value={diaryForm.classwork} onChange={(e) => setDiaryForm({ ...diaryForm, classwork: e.target.value })} placeholder="Classwork covered" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-sm" />
              <textarea required rows={2} value={diaryForm.homeworkSummary} onChange={(e) => setDiaryForm({ ...diaryForm, homeworkSummary: e.target.value })} placeholder="Homework summary" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-sm" />
              <input value={diaryForm.nextDayPrep} onChange={(e) => setDiaryForm({ ...diaryForm, nextDayPrep: e.target.value })} placeholder="Next-day preparation" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
              <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white">Publish Diary Entry</button>
            </form>
          )}
          <div className={`${isTeacherOrPrincipal ? 'lg:col-span-8' : 'lg:col-span-12'} space-y-4`}>
            {diary.map((d) => (
              <div key={String(d.id)} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-semibold text-blue-600 dark:text-cyan-400">{String(d.subject_name)} · {String(d.class_name)}-{String(d.section)}</span>
                  <span className="font-mono">{formatDateByCalendar(String(d.entry_date), calendar)}</span>
                </div>
                <h3 className="text-base font-bold">{String(d.topic)}</h3>
                <p className="text-sm text-slate-600 dark:text-slate-300"><strong>Classwork:</strong> {String(d.classwork)}</p>
                <p className="text-sm text-slate-600 dark:text-slate-300"><strong>Homework:</strong> {String(d.homework_summary)}</p>
                {Boolean(d.next_day_prep) && <p className="text-xs text-slate-500"><strong>Next Day Prep:</strong> {String(d.next_day_prep)}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TIMETABLE & CLASSES */}
      {subTab === 'timetable' && (
        <div className="space-y-6">
          {canManageStructure && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <form onSubmit={handleCreateClass} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Create Class & Section</h2>
                <div className="grid grid-cols-3 gap-2">
                  <input required placeholder="Class (e.g. Class 9)" value={classForm.name} onChange={(e) => setClassForm({ ...classForm, name: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
                  <input required placeholder="Section (A)" value={classForm.section} onChange={(e) => setClassForm({ ...classForm, section: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
                  <input required placeholder="Room" value={classForm.room} onChange={(e) => setClassForm({ ...classForm, room: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs min-h-[40px]" />
                </div>
                <button type="submit" className="rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white">Add Class</button>
              </form>

              <form onSubmit={handleScheduleTimetable} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Schedule Timetable Period</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <select value={ttForm.classId} onChange={(e) => setTtForm({ ...ttForm, classId: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-xs">
                    {classes.map((c) => <option key={String(c.id)} value={String(c.id)}>{String(c.name)}-{String(c.section)}</option>)}
                  </select>
                  <select value={ttForm.dayOfWeek} onChange={(e) => setTtForm({ ...ttForm, dayOfWeek: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-xs">
                    {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <input required type="number" min={1} max={10} placeholder="Period #" value={ttForm.periodNumber} onChange={(e) => setTtForm({ ...ttForm, periodNumber: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-xs font-mono" />
                  <input required placeholder="Time Slot" value={ttForm.timeSlot} onChange={(e) => setTtForm({ ...ttForm, timeSlot: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-xs font-mono" />
                  <input required placeholder="Subject" value={ttForm.subjectName} onChange={(e) => setTtForm({ ...ttForm, subjectName: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-xs" />
                  <input required placeholder="Room" value={ttForm.room} onChange={(e) => setTtForm({ ...ttForm, room: e.target.value })} className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 text-xs" />
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <select value={ttForm.teacherUserId} onChange={(e) => setTtForm({ ...ttForm, teacherUserId: e.target.value })} className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 text-xs">
                    {teachers.map((tr) => (
                      <option key={String(tr.user_id)} value={String(tr.user_id)}>
                        {String(tr.full_name)} ({String(tr.user_code)})
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white">Add Slot</button>
                </div>
              </form>
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                  <th className="py-3 px-4">Day</th>
                  <th className="py-3 px-4">Period</th>
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">Class</th>
                  <th className="py-3 px-4">Subject</th>
                  <th className="py-3 px-4">Teacher</th>
                  <th className="py-3 px-4">Room</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {timetable.map((t) => (
                  <tr key={String(t.id)}>
                    <td className="py-3 px-4 font-medium">{String(t.day_of_week)}</td>
                    <td className="py-3 px-4 font-mono text-xs">{String(t.period_number)}</td>
                    <td className="py-3 px-4 font-mono text-xs">{String(t.time_slot)}</td>
                    <td className="py-3 px-4 text-xs">{String(t.class_name)}-{String(t.section)}</td>
                    <td className="py-3 px-4 font-semibold">{String(t.subject_name)}</td>
                    <td className="py-3 px-4 text-xs">{String(t.teacher_name)}</td>
                    <td className="py-3 px-4 font-mono text-xs">{String(t.room)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
