import React, { useEffect, useState } from 'react';
import { Award, BookCheck, CheckCircle2, ClipboardList, Clock, Download, FileCheck2, Layers, Plus, Sparkles } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { apiGet, apiMutate } from '../lib/api';
import { formatDateByCalendar } from '../lib/domainRules';
import type { AuthUser } from '../types';

export const CurriculumAssessmentModule: React.FC<{ user: AuthUser; calendar: 'AD' | 'BS' }> = ({ user, calendar }) => {
  const [subTab, setSubTab] = useState<'curriculum' | 'cbt' | 'qbank' | 'badges'>('curriculum');
  const [curriculumData, setCurriculumData] = useState<{
    frameworks: Array<Record<string, unknown>>;
    objectives: Array<Record<string, unknown>>;
    progress: Array<Record<string, unknown>>;
    ilps: Array<Record<string, unknown>>;
  } | null>(null);
  const [assessmentsData, setAssessmentsData] = useState<{
    assessments: Array<{
      id: string;
      title: string;
      subject_name: string;
      class_name: string;
      section: string;
      duration_minutes: number;
      total_marks: number;
      questions: Array<{ id: string; prompt: string; options_json: string; question_type: string; marks: number }>;
    }>;
    attempts: Array<Record<string, unknown>>;
  } | null>(null);
  const [questions, setQuestions] = useState<Array<Record<string, unknown>>>([]);
  const [badges, setBadges] = useState<Array<Record<string, unknown>>>([]);
  const [students, setStudents] = useState<Array<{ id: string; full_name: string; student_code: string; class_name?: string; section?: string }>>([]);
  const [classes, setClasses] = useState<Array<{ id: string; name: string; section: string }>>([]);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyResult, setVerifyResult] = useState<Record<string, unknown> | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // CBT Active Exam Runner
  const [activeExamId, setActiveExamId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Educator Forms
  const [fwForm, setFwForm] = useState({
    name: '',
    board: 'NEB Nepal',
    gradeLevel: 'Class 10',
    subjectName: 'Compulsory Mathematics',
    version: '1.0',
  });
  const [objForm, setObjForm] = useState({
    frameworkId: '',
    unitTitle: '',
    objectiveCode: '',
    description: '',
    competencyTag: 'CORE',
  });
  const [masteryForm, setMasteryForm] = useState({
    studentId: '',
    objectiveId: '',
    masteryLevel: 'PROFICIENT',
    evidenceNote: '',
  });
  const [ilpForm, setIlpForm] = useState({
    studentId: '',
    goalTitle: '',
    accommodations: '',
    targetDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  });
  const [cbtForm, setCbtForm] = useState({
    classId: '',
    title: '',
    subjectName: 'Compulsory Mathematics',
    durationMinutes: '25',
    maxAttempts: '2',
    questionIds: [] as string[],
  });
  const [badgeForm, setBadgeForm] = useState({
    studentId: '',
    badgeName: '',
    criteria: '',
  });

  // Create Question Form
  const [qForm, setQForm] = useState({
    subjectName: 'Compulsory Mathematics',
    gradeLevel: 'Class 10',
    prompt: '',
    opt1: '',
    opt2: '',
    opt3: '',
    opt4: '',
    correctAnswer: '',
    marks: '2',
  });

  const isEducator = ['PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER', 'EXAM_OFFICER', 'SCHOOL_ORG'].includes(user.activeRole);
  const canEditCurriculum = ['PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER'].includes(user.activeRole);
  const canCreateAssessments = ['PRINCIPAL', 'VICE_PRINCIPAL', 'TEACHER', 'CLASS_TEACHER', 'EXAM_OFFICER'].includes(user.activeRole);
  const canExportOneRoster = ['PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'TECHNICAL_DEPT', 'PLATFORM_SUPER_ADMIN'].includes(user.activeRole);

  const loadAll = async () => {
    const [curRes, asmtRes, bdgRes] = await Promise.all([
      apiGet<typeof curriculumData>('/curriculum', `cur:${user.activeSchoolId}`),
      apiGet<typeof assessmentsData>('/assessments', `asmt:${user.activeSchoolId}`),
      apiGet<{ badges: Array<Record<string, unknown>> }>('/interoperability/badges', `bdg:${user.activeSchoolId}`),
    ]);
    if (curRes.success && curRes.data) {
      setCurriculumData(curRes.data);
      if (curRes.data.frameworks.length > 0) {
        setObjForm((prev) => ({ ...prev, frameworkId: prev.frameworkId || String(curRes.data!.frameworks[0].id) }));
      }
      if (curRes.data.objectives.length > 0) {
        setMasteryForm((prev) => ({ ...prev, objectiveId: prev.objectiveId || String(curRes.data!.objectives[0].id) }));
      }
    }
    if (asmtRes.success && asmtRes.data) setAssessmentsData(asmtRes.data);
    if (bdgRes.success && bdgRes.data) setBadges(bdgRes.data.badges);
    if (isEducator) {
      const [qbRes, stuRes, clsRes] = await Promise.all([
        apiGet<{ questions: Array<Record<string, unknown>> }>('/question-bank', `qb:${user.activeSchoolId}`),
        apiGet<{ students: Array<{ id: string; full_name: string; student_code: string; class_name?: string; section?: string }> }>('/students', `stu:${user.activeSchoolId}`),
        apiGet<{ classes: Array<{ id: string; name: string; section: string }> }>('/academics/classes', `cls:${user.activeSchoolId}`),
      ]);
      if (qbRes.success && qbRes.data) setQuestions(qbRes.data.questions);
      if (stuRes.success && stuRes.data) {
        setStudents(stuRes.data.students);
        if (stuRes.data.students.length > 0) {
          const firstStu = stuRes.data.students[0].id;
          setMasteryForm((prev) => ({ ...prev, studentId: prev.studentId || firstStu }));
          setIlpForm((prev) => ({ ...prev, studentId: prev.studentId || firstStu }));
          setBadgeForm((prev) => ({ ...prev, studentId: prev.studentId || firstStu }));
        }
      }
      if (clsRes.success && clsRes.data) {
        setClasses(clsRes.data.classes);
        if (clsRes.data.classes.length > 0) {
          setCbtForm((prev) => ({ ...prev, classId: prev.classId || clsRes.data!.classes[0].id }));
        }
      }
    }
  };

  useEffect(() => {
    loadAll();
  }, [user.activeSchoolId, user.activeRole]);

  const handlePrintPaperPdf = (exam: NonNullable<typeof assessmentsData>['assessments'][number]) => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text(`${user.activeSchoolName || 'School'} — Question Paper`, 40, 48);
    doc.setFontSize(11);
    doc.text(`${exam.title} · ${exam.subject_name} (${exam.class_name}-${exam.section})`, 40, 68);
    doc.text(`Time: ${exam.duration_minutes} mins · Full Marks: ${exam.total_marks}`, 40, 84);
    doc.line(40, 94, 555, 94);
    let y = 118;
    exam.questions.forEach((q, idx) => {
      doc.setFontSize(10);
      doc.text(`${idx + 1}. ${q.prompt} [${q.marks}m]`, 40, y);
      y += 16;
      const opts = JSON.parse(q.options_json || '[]') as string[];
      if (opts.length > 0) {
        doc.text(`    ${opts.map((o, i) => `${String.fromCharCode(65 + i)}) ${o}`).join('   ')}`, 40, y);
        y += 20;
      }
    });
    doc.save(`${exam.id}-question-paper.pdf`);
  };

  const handleSubmitCbt = async (examId: string) => {
    const res = await apiMutate<{ objectiveScore: number; maxScore: number }>(`/assessments/${examId}/submit`, 'POST', { answers });
    setStatusMsg(res.message || 'Assessment submitted.');
    if (res.success) {
      setActiveExamId(null);
      setAnswers({});
      await loadAll();
    }
  };

  const handleVerifyBadge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyCode.trim()) return;
    const res = await apiGet<Record<string, unknown>>(`/interoperability/badges/verify/${verifyCode.trim()}`);
    if (res.success && res.data) {
      setVerifyResult(res.data);
    } else {
      setVerifyResult({ verified: false, error: res.message || 'Not found' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Curriculum, CBT Exams & Global Standards</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Competency mastery tracking, ILPs, online CBT exams, question paper PDF builder, OneRoster 1.2 & signed Open Badges 3.0
          </p>
        </div>
        {canExportOneRoster && (
          <a
            href="/api/v1/interoperability/oneroster/users"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export OneRoster 1.2 CSV</span>
          </a>
        )}
      </div>

      {statusMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30 p-3 text-xs font-medium text-emerald-800 dark:text-emerald-300">
          {statusMsg}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
        {(
          [
            ['curriculum', 'Curriculum & Mastery'],
            ['cbt', 'CBT Online Exams'],
            ...(canCreateAssessments ? [['qbank', 'Question Bank'] as const] : []),
            ['badges', 'Open Badges 3.0 & Verify'],
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

      {/* CURRICULUM, MASTERY & ILPs */}
      {subTab === 'curriculum' && curriculumData && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
              <h2 className="text-sm font-bold flex items-center gap-2">
                <Layers className="h-4 w-4 text-blue-600" />
                <span>Curriculum Frameworks & Objectives</span>
              </h2>
              {curriculumData.frameworks.map((fw) => (
                <div key={String(fw.id)} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-xs">
                  <div className="font-bold text-slate-900 dark:text-white">{String(fw.name)}</div>
                  <div className="text-slate-500 mt-0.5">
                    {String(fw.board)} · {String(fw.grade_level)} · {String(fw.subject_name)} · v{String(fw.version)}
                  </div>
                </div>
              ))}
              <div className="divide-y divide-slate-100 dark:divide-slate-800 pt-1">
                {curriculumData.objectives.map((obj) => (
                  <div key={String(obj.id)} className="py-2.5 text-xs">
                    <div className="font-mono font-semibold text-blue-700 dark:text-cyan-400">
                      {String(obj.objective_code)} · {String(obj.unit_title)}
                    </div>
                    <p className="text-slate-600 dark:text-slate-300 mt-0.5">{String(obj.description)}</p>
                  </div>
                ))}
              </div>

              {canEditCurriculum && (
                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-4">
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const res = await apiMutate('/curriculum/frameworks', 'POST', fwForm);
                      setStatusMsg(res.message || 'Curriculum framework created.');
                      if (res.success) {
                        setFwForm({ ...fwForm, name: '' });
                        await loadAll();
                      }
                    }}
                    className="space-y-2.5 text-xs"
                  >
                    <div className="font-bold text-slate-900 dark:text-white">Add Curriculum Framework</div>
                    <input
                      required
                      value={fwForm.name}
                      onChange={(e) => setFwForm({ ...fwForm, name: e.target.value })}
                      placeholder="Framework title (e.g. CDC Nepal Grade 10 Science)"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        required
                        value={fwForm.board}
                        onChange={(e) => setFwForm({ ...fwForm, board: e.target.value })}
                        placeholder="Board (NEB / CDC)"
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                      />
                      <input
                        required
                        value={fwForm.gradeLevel}
                        onChange={(e) => setFwForm({ ...fwForm, gradeLevel: e.target.value })}
                        placeholder="Grade"
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                      />
                      <input
                        required
                        value={fwForm.subjectName}
                        onChange={(e) => setFwForm({ ...fwForm, subjectName: e.target.value })}
                        placeholder="Subject"
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                      />
                    </div>
                    <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2 font-semibold text-white">
                      Save Curriculum Framework
                    </button>
                  </form>

                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const res = await apiMutate('/curriculum/objectives', 'POST', objForm);
                      setStatusMsg(res.message || 'Learning objective added.');
                      if (res.success) {
                        setObjForm({ ...objForm, unitTitle: '', objectiveCode: '', description: '' });
                        await loadAll();
                      }
                    }}
                    className="space-y-2.5 text-xs pt-3 border-t border-slate-200 dark:border-slate-800"
                  >
                    <div className="font-bold text-slate-900 dark:text-white">Add Learning Objective</div>
                    <select
                      required
                      value={objForm.frameworkId}
                      onChange={(e) => setObjForm({ ...objForm, frameworkId: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                    >
                      <option value="">Select Framework *</option>
                      {curriculumData.frameworks.map((fw) => (
                        <option key={String(fw.id)} value={String(fw.id)}>
                          {String(fw.name)}
                        </option>
                      ))}
                    </select>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        required
                        value={objForm.objectiveCode}
                        onChange={(e) => setObjForm({ ...objForm, objectiveCode: e.target.value })}
                        placeholder="Code (e.g. MATH-10.3)"
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 font-mono"
                      />
                      <input
                        required
                        value={objForm.unitTitle}
                        onChange={(e) => setObjForm({ ...objForm, unitTitle: e.target.value })}
                        placeholder="Unit Title"
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                      />
                    </div>
                    <input
                      required
                      value={objForm.description}
                      onChange={(e) => setObjForm({ ...objForm, description: e.target.value })}
                      placeholder="Measurable competency description *"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
                    />
                    <button type="submit" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 py-2 font-semibold">
                      Add Learning Objective
                    </button>
                  </form>
                </div>
              )}
            </div>

            <div className="lg:col-span-6 space-y-6">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <BookCheck className="h-4 w-4 text-emerald-600" />
                  <span>Student Competency Mastery</span>
                </h2>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {curriculumData.progress.length === 0 ? (
                    <p className="py-4 text-slate-500">No competency assessments recorded yet.</p>
                  ) : (
                    curriculumData.progress.map((p) => (
                      <div key={String(p.id)} className="py-3">
                        <div className="flex items-center justify-between font-semibold">
                          <span>
                            {String(p.student_name)} · {String(p.objective_code)}
                          </span>
                          <span className="font-mono text-emerald-700 dark:text-emerald-400">{String(p.mastery_level)}</span>
                        </div>
                        <p className="text-slate-500 mt-0.5">{String(p.evidence_note || p.objective_desc)}</p>
                      </div>
                    ))
                  )}
                </div>

                {canEditCurriculum && students.length > 0 && curriculumData.objectives.length > 0 && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const res = await apiMutate('/curriculum/mastery', 'POST', masteryForm);
                      setStatusMsg(res.message || 'Competency mastery updated.');
                      if (res.success) {
                        setMasteryForm({ ...masteryForm, evidenceNote: '' });
                        await loadAll();
                      }
                    }}
                    className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5 text-xs"
                  >
                    <div className="font-bold text-slate-900 dark:text-white">Record Competency Mastery</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <select
                        required
                        value={masteryForm.studentId}
                        onChange={(e) => setMasteryForm({ ...masteryForm, studentId: e.target.value })}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                      >
                        {students.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.full_name} ({s.student_code})
                          </option>
                        ))}
                      </select>
                      <select
                        required
                        value={masteryForm.objectiveId}
                        onChange={(e) => setMasteryForm({ ...masteryForm, objectiveId: e.target.value })}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                      >
                        {curriculumData.objectives.map((o) => (
                          <option key={String(o.id)} value={String(o.id)}>
                            {String(o.objective_code)} · {String(o.unit_title)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <select
                        value={masteryForm.masteryLevel}
                        onChange={(e) => setMasteryForm({ ...masteryForm, masteryLevel: e.target.value })}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 font-mono"
                      >
                        <option value="NOT_STARTED">NOT_STARTED</option>
                        <option value="DEVELOPING">DEVELOPING</option>
                        <option value="PROFICIENT">PROFICIENT</option>
                        <option value="MASTERED">MASTERED</option>
                      </select>
                      <input
                        value={masteryForm.evidenceNote}
                        onChange={(e) => setMasteryForm({ ...masteryForm, evidenceNote: e.target.value })}
                        placeholder="Evidence / rubric note"
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                      />
                    </div>
                    <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2 font-semibold text-white">
                      Save Mastery Level
                    </button>
                  </form>
                )}
              </div>

              {/* INDIVIDUAL LEARNING PLANS */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-blue-600" />
                  <span>Individual Learning Plans (ILPs)</span>
                </h2>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {curriculumData.ilps.length === 0 ? (
                    <p className="py-3 text-slate-500">No Individual Learning Plans recorded yet.</p>
                  ) : (
                    curriculumData.ilps.map((ilp) => (
                      <div key={String(ilp.id)} className="py-2.5">
                        <div className="flex items-center justify-between font-bold text-slate-900 dark:text-white">
                          <span>
                            {String(ilp.student_name)} · {String(ilp.goal_title)}
                          </span>
                          <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
                            {String(ilp.status)} · {formatDateByCalendar(String(ilp.target_date), calendar)}
                          </span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300 mt-0.5">{String(ilp.accommodations)}</p>
                      </div>
                    ))
                  )}
                </div>

                {canEditCurriculum && students.length > 0 && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const res = await apiMutate('/curriculum/ilps', 'POST', ilpForm);
                      setStatusMsg(res.message || 'Individual Learning Plan saved.');
                      if (res.success) {
                        setIlpForm({ ...ilpForm, goalTitle: '', accommodations: '' });
                        await loadAll();
                      }
                    }}
                    className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5 text-xs"
                  >
                    <div className="font-bold text-slate-900 dark:text-white">Create Individual Learning Plan</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <select
                        required
                        value={ilpForm.studentId}
                        onChange={(e) => setIlpForm({ ...ilpForm, studentId: e.target.value })}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                      >
                        {students.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.full_name} ({s.student_code})
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        required
                        value={ilpForm.targetDate}
                        onChange={(e) => setIlpForm({ ...ilpForm, targetDate: e.target.value })}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 font-mono"
                      />
                    </div>
                    <input
                      required
                      value={ilpForm.goalTitle}
                      onChange={(e) => setIlpForm({ ...ilpForm, goalTitle: e.target.value })}
                      placeholder="Learning Goal Title *"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
                    />
                    <input
                      required
                      value={ilpForm.accommodations}
                      onChange={(e) => setIlpForm({ ...ilpForm, accommodations: e.target.value })}
                      placeholder="Accommodations & weekly support plan *"
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
                    />
                    <button type="submit" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 py-2 font-semibold">
                      Save Individual Learning Plan
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CBT EXAMS */}
      {subTab === 'cbt' && assessmentsData && (
        <div className="space-y-6">
          {canCreateAssessments && classes.length > 0 && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const res = await apiMutate('/assessments', 'POST', {
                  classId: cbtForm.classId,
                  title: cbtForm.title,
                  subjectName: cbtForm.subjectName,
                  durationMinutes: Number(cbtForm.durationMinutes),
                  maxAttempts: Number(cbtForm.maxAttempts),
                  questionIds: cbtForm.questionIds,
                });
                setStatusMsg(res.message || 'CBT assessment published.');
                if (res.success) {
                  setCbtForm({ ...cbtForm, title: '', questionIds: [] });
                  await loadAll();
                }
              }}
              className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs"
            >
              <h2 className="text-sm font-bold flex items-center gap-2">
                <Plus className="h-4 w-4 text-blue-600" />
                <span>Publish CBT Online Assessment</span>
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                <select
                  required
                  value={cbtForm.classId}
                  onChange={(e) => setCbtForm({ ...cbtForm, classId: e.target.value })}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} - {c.section}
                    </option>
                  ))}
                </select>
                <input
                  required
                  value={cbtForm.title}
                  onChange={(e) => setCbtForm({ ...cbtForm, title: e.target.value })}
                  placeholder="Assessment Title *"
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2 lg:col-span-2"
                />
                <input
                  required
                  value={cbtForm.subjectName}
                  onChange={(e) => setCbtForm({ ...cbtForm, subjectName: e.target.value })}
                  placeholder="Subject"
                  className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                />
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={5}
                    max={240}
                    value={cbtForm.durationMinutes}
                    onChange={(e) => setCbtForm({ ...cbtForm, durationMinutes: e.target.value })}
                    title="Duration in minutes"
                    className="w-1/2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 font-mono tabular-nums"
                  />
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={cbtForm.maxAttempts}
                    onChange={(e) => setCbtForm({ ...cbtForm, maxAttempts: e.target.value })}
                    title="Max attempts"
                    className="w-1/2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2 font-mono tabular-nums"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="font-semibold text-slate-700 dark:text-slate-300">
                  Select Questions from Bank ({cbtForm.questionIds.length} selected):
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                  {questions.map((q) => {
                    const qid = String(q.id);
                    const checked = cbtForm.questionIds.includes(qid);
                    return (
                      <label
                        key={qid}
                        className="flex items-start gap-2 rounded-lg border border-slate-200 dark:border-slate-800 p-2 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            setCbtForm((prev) => ({
                              ...prev,
                              questionIds: e.target.checked
                                ? [...prev.questionIds, qid]
                                : prev.questionIds.filter((id) => id !== qid),
                            }));
                          }}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="font-semibold text-slate-900 dark:text-white">{String(q.prompt)}</span>{' '}
                          <span className="font-mono text-slate-500">({String(q.marks)}m)</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <button
                type="submit"
                disabled={cbtForm.questionIds.length === 0}
                className="rounded-lg bg-[#0F1E36] dark:bg-blue-600 disabled:opacity-50 px-4 py-2 font-semibold text-white"
              >
                Publish CBT Assessment
              </button>
            </form>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {assessmentsData.assessments.map((exam) => (
              <div key={exam.id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">{exam.title}</h3>
                    <div className="text-xs text-slate-500 mt-0.5">
                      {exam.subject_name} · {exam.class_name}-{exam.section} · {exam.duration_minutes} mins · {exam.total_marks} marks
                    </div>
                  </div>
                  <Clock className="h-4 w-4 text-blue-600 shrink-0" />
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  {user.activeRole === 'STUDENT' && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveExamId(exam.id);
                        setAnswers({});
                      }}
                      className="rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-3 py-2 text-xs font-semibold text-white"
                    >
                      Start Online Assessment
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handlePrintPaperPdf(exam)}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Paper PDF</span>
                  </button>
                  {canCreateAssessments && (
                    <a
                      href={`/api/v1/interoperability/qti/${exam.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-semibold"
                    >
                      QTI 3.0 XML
                    </a>
                  )}
                </div>

                {activeExamId === exam.id && (
                  <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
                    {exam.questions.map((q, idx) => {
                      const opts = JSON.parse(q.options_json || '[]') as string[];
                      return (
                        <div key={q.id} className="space-y-1.5 text-xs">
                          <div className="font-semibold">
                            {idx + 1}. {q.prompt} <span className="font-mono text-slate-500">({q.marks}m)</span>
                          </div>
                          {opts.length > 0 ? (
                            <div className="space-y-1">
                              {opts.map((opt) => (
                                <label key={opt} className="flex items-center gap-2 cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`ans-${q.id}`}
                                    checked={answers[q.id] === opt}
                                    onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt }))}
                                  />
                                  <span>{opt}</span>
                                </label>
                              ))}
                            </div>
                          ) : (
                            <input
                              value={answers[q.id] || ''}
                              onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                              className="w-full rounded border border-slate-300 dark:border-slate-700 px-2.5 py-1.5"
                            />
                          )}
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => handleSubmitCbt(exam.id)}
                      className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-semibold text-white"
                    >
                      Submit & Grade Now
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {assessmentsData.attempts.length > 0 && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h3 className="text-sm font-bold mb-3">Attempt Results & Analytics</h3>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {assessmentsData.attempts.map((a) => (
                  <div key={String(a.id)} className="py-2.5 flex items-center justify-between">
                    <span>
                      {String(a.student_name)} ({String(a.student_code)})
                    </span>
                    <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
                      Score: {String(a.objective_score)} / {String(a.max_score)} · {String(a.status)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* QUESTION BANK */}
      {subTab === 'qbank' && canCreateAssessments && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const res = await apiMutate('/question-bank', 'POST', {
                subjectName: qForm.subjectName,
                gradeLevel: qForm.gradeLevel,
                questionType: 'MCQ',
                prompt: qForm.prompt,
                options: [qForm.opt1, qForm.opt2, qForm.opt3, qForm.opt4].filter(Boolean),
                correctAnswer: qForm.correctAnswer,
                marks: Number(qForm.marks),
              });
              setStatusMsg(res.message || 'Question added.');
              if (res.success) {
                setQForm({ ...qForm, prompt: '', opt1: '', opt2: '', opt3: '', opt4: '', correctAnswer: '' });
                await loadAll();
              }
            }}
            className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
          >
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Plus className="h-4 w-4 text-blue-600" />
              <span>Add Question Bank Item</span>
            </h2>
            <input
              required
              value={qForm.prompt}
              onChange={(e) => setQForm({ ...qForm, prompt: e.target.value })}
              placeholder="Question prompt *"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={qForm.opt1}
                onChange={(e) => setQForm({ ...qForm, opt1: e.target.value })}
                placeholder="Option A"
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
              />
              <input
                value={qForm.opt2}
                onChange={(e) => setQForm({ ...qForm, opt2: e.target.value })}
                placeholder="Option B"
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
              />
              <input
                value={qForm.opt3}
                onChange={(e) => setQForm({ ...qForm, opt3: e.target.value })}
                placeholder="Option C"
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
              />
              <input
                value={qForm.opt4}
                onChange={(e) => setQForm({ ...qForm, opt4: e.target.value })}
                placeholder="Option D"
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1.5 text-xs"
              />
            </div>
            <input
              required
              value={qForm.correctAnswer}
              onChange={(e) => setQForm({ ...qForm, correctAnswer: e.target.value })}
              placeholder="Exact Correct Answer *"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            />
            <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white">
              Add to Question Bank
            </button>
          </form>

          <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-emerald-600" />
              <span>School Question Repository ({questions.length})</span>
            </h2>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {questions.map((q) => (
                <div key={String(q.id)} className="py-3">
                  <div className="font-semibold text-slate-900 dark:text-white">{String(q.prompt)}</div>
                  <div className="text-slate-500 mt-0.5 font-mono">
                    {String(q.subject_name)} · {String(q.difficulty)} · Answer: {String(q.correct_answer)} · {String(q.marks)} marks
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* OPEN BADGES 3.0 */}
      {subTab === 'badges' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-600" />
              <span>Signed Open Badges 3.0 Credentials</span>
            </h2>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {badges.map((b) => (
                <div key={String(b.id)} className="py-3">
                  <div className="font-bold text-slate-900 dark:text-white">{String(b.badge_name)}</div>
                  <div className="text-slate-600 dark:text-slate-300 mt-0.5">
                    {String(b.student_name)} ({String(b.student_code)}) · {String(b.criteria)}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-blue-700 dark:text-cyan-400">
                    Verification Code: {String(b.verification_code)} · {formatDateByCalendar(String(b.issued_at), calendar)}
                  </div>
                </div>
              ))}
            </div>

            {canEditCurriculum && students.length > 0 && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const res = await apiMutate<{ id: string; verificationCode: string }>('/interoperability/badges', 'POST', badgeForm);
                  if (res.success && res.data) {
                    setStatusMsg(`Open Badge 3.0 issued. Verification Code: ${res.data.verificationCode}`);
                    setVerifyCode(res.data.verificationCode);
                    setBadgeForm({ ...badgeForm, badgeName: '', criteria: '' });
                    await loadAll();
                  } else {
                    setStatusMsg(res.message || 'Failed to issue badge.');
                  }
                }}
                className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5 text-xs"
              >
                <div className="font-bold text-slate-900 dark:text-white">Issue Signed Open Badge 3.0</div>
                <select
                  required
                  value={badgeForm.studentId}
                  onChange={(e) => setBadgeForm({ ...badgeForm, studentId: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-2"
                >
                  {students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name} ({s.student_code})
                    </option>
                  ))}
                </select>
                <input
                  required
                  value={badgeForm.badgeName}
                  onChange={(e) => setBadgeForm({ ...badgeForm, badgeName: e.target.value })}
                  placeholder="Badge Title (e.g. Science Olympiad Gold Medalist) *"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
                />
                <input
                  required
                  value={badgeForm.criteria}
                  onChange={(e) => setBadgeForm({ ...badgeForm, criteria: e.target.value })}
                  placeholder="Verification Criteria *"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2"
                />
                <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 font-semibold text-white">
                  Sign & Issue Open Badge 3.0
                </button>
              </form>
            )}
          </div>

          <form onSubmit={handleVerifyBadge} className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 self-start">
            <h2 className="text-sm font-bold flex items-center gap-2">
              <FileCheck2 className="h-4 w-4 text-emerald-600" />
              <span>Cryptographic Badge Verifier</span>
            </h2>
            <input
              required
              value={verifyCode}
              onChange={(e) => setVerifyCode(e.target.value)}
              placeholder="Enter Verification Code"
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono uppercase"
            />
            <button type="submit" className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-xs font-semibold text-white">
              Verify HMAC-SHA256 Signature
            </button>
            {verifyResult && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <CheckCircle2 className={`h-4 w-4 ${verifyResult.verified ? 'text-emerald-600' : 'text-red-600'}`} />
                  <span>{verifyResult.verified ? 'Cryptographic Signature Valid' : 'Verification Failed'}</span>
                </div>
                {Boolean(verifyResult.verified) && (
                  <div className="text-slate-600 dark:text-slate-300">
                    {String(verifyResult.badgeName)} · {String(verifyResult.studentName)} · {String(verifyResult.schoolName)}
                  </div>
                )}
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
};
