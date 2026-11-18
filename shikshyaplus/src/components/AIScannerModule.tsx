import React, { useEffect, useState } from 'react';
import { AlertCircle, Camera, CheckCircle2, RotateCw, ScanLine, Sparkles, Upload } from 'lucide-react';
import { apiGet, apiMutate } from '../lib/api';

interface AIStatusData {
  providers: {
    gemini: { configured: boolean; model: string };
    openai: { configured: boolean; model: string };
  };
  dailyQuota: number;
  usedToday: number;
}

interface HomeworkScanResult {
  provider: string;
  model: string;
  detectedQuestion: string;
  subject: string;
  topic: string;
  concepts: string[];
  formulas: string[];
  steps: string[];
  finalSolution: string;
  verificationNote: string;
  practiceQuestion: string;
  aiDisclaimer: string;
}

export const AIScannerModule: React.FC = () => {
  const [status, setStatus] = useState<AIStatusData | null>(null);
  const [subject, setSubject] = useState('Mathematics');
  const [learningMode, setLearningMode] = useState<'STEP_BY_STEP' | 'EXPLAIN' | 'HINT' | 'PRACTICE' | 'CHECK_ANSWER' | 'EXAM_PREP' | 'NEPALI' | 'ENGLISH'>('STEP_BY_STEP');
  const [provider, setProvider] = useState<'GEMINI' | 'OPENAI'>('GEMINI');
  const [questionText, setQuestionText] = useState('');
  const [studentAnswer, setStudentAnswer] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string>('image/jpeg');
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<HomeworkScanResult | null>(null);

  const loadStatus = async () => {
    const res = await apiGet<AIStatusData>('/ai/status', 'ai:status');
    if (res.success && res.data) setStatus(res.data);
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const handleFileChange = (file: File) => {
    setImageMime(file.type || 'image/jpeg');
    const reader = new FileReader();
    reader.onload = () => {
      setImagePreview(String(reader.result));
      setRotation(0);
    };
    reader.readAsDataURL(file);
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await apiMutate<{ result: HomeworkScanResult }>('/ai/homework-scan', 'POST', {
        questionText: questionText.trim() || undefined,
        imageBase64: imagePreview || undefined,
        imageMimeType: imagePreview ? imageMime : undefined,
        subject,
        learningMode,
        studentAnswer: learningMode === 'CHECK_ANSWER' ? studentAnswer : undefined,
        provider,
      });
      if (!res.success || !res.data?.result) {
        setErrorMsg(res.message || 'Could not process homework scan.');
      } else {
        setResult(res.data.result);
        loadStatus();
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">AI Homework Scanner & Study Tutor</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Upload a question photo or enter a problem for guided step-by-step explanations in English or Nepali
          </p>
        </div>
        {status && (
          <div className="text-xs font-mono text-slate-500 dark:text-slate-400">
            Daily quota: {status.usedToday}/{status.dailyQuota} · Gemini:{' '}
            <strong className={status.providers.gemini.configured ? 'text-emerald-600' : 'text-amber-600'}>
              {status.providers.gemini.configured ? 'Configured' : 'Not Configured'}
            </strong>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form onSubmit={handleScan} className="lg:col-span-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Subject</label>
              <select value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                <option>Mathematics</option>
                <option>Science & Physics</option>
                <option>Chemistry</option>
                <option>Biology</option>
                <option>Computer Science</option>
                <option>English</option>
                <option>Nepali</option>
                <option>Social Studies</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">AI Provider</label>
              <select value={provider} onChange={(e) => setProvider(e.target.value as 'GEMINI' | 'OPENAI')} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
                <option value="GEMINI">Google Gemini</option>
                <option value="OPENAI">OpenAI Adapter</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Learning Mode</label>
            <select value={learningMode} onChange={(e) => setLearningMode(e.target.value as typeof learningMode)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm">
              <option value="STEP_BY_STEP">Step-by-Step Solution</option>
              <option value="EXPLAIN">Explain Concept</option>
              <option value="HINT">Hint Mode (Socratic)</option>
              <option value="PRACTICE">Practice Mode (+ Similar Problem)</option>
              <option value="CHECK_ANSWER">Check My Answer</option>
              <option value="EXAM_PREP">Exam Preparation</option>
              <option value="NEPALI">Nepali Explanation (नेपाली)</option>
              <option value="ENGLISH">English Explanation</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Upload Homework Photo or Capture Camera</label>
            <div className="flex gap-2">
              <label className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 py-3 text-xs font-medium cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                <Upload className="h-4 w-4 text-blue-600" />
                <span>Upload Image</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])} />
              </label>
              <label className="flex-1 flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 py-3 text-xs font-medium cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                <Camera className="h-4 w-4 text-cyan-600" />
                <span>Camera</span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])} />
              </label>
            </div>
          </div>

          {imagePreview && (
            <div className="space-y-2">
              <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 flex justify-center p-2">
                <img
                  src={imagePreview}
                  alt="Homework preview"
                  style={{ transform: `rotate(${rotation}deg)` }}
                  className="max-h-48 object-contain transition-transform"
                />
              </div>
              <div className="flex justify-between text-xs">
                <button type="button" onClick={() => setRotation((r) => (r + 90) % 360)} className="inline-flex items-center gap-1 text-blue-600 hover:underline">
                  <RotateCw className="h-3.5 w-3.5" />
                  <span>Rotate 90°</span>
                </button>
                <button type="button" onClick={() => setImagePreview(null)} className="text-red-600 hover:underline">
                  Remove Image
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium mb-1">Or Type Homework Question</label>
            <textarea
              rows={3}
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              placeholder="e.g. Solve x^2 - 7x + 12 = 0 using the quadratic formula."
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-sm"
            />
          </div>

          {learningMode === 'CHECK_ANSWER' && (
            <div>
              <label className="block text-xs font-medium mb-1">Your Attempted Answer</label>
              <input
                value={studentAnswer}
                onChange={(e) => setStudentAnswer(e.target.value)}
                placeholder="x = 3, x = 4"
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-[#193054] disabled:opacity-60 min-h-[44px]"
          >
            <ScanLine className="h-4 w-4" />
            <span>{loading ? 'Analyzing Question...' : 'Analyze with AI Tutor'}</span>
          </button>
        </form>

        {/* Output Panel */}
        <div className="lg:col-span-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
          {errorMsg ? (
            <div role="alert" className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-4 text-sm text-amber-900 dark:text-amber-200 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">AI Provider Status</div>
                <p className="mt-1 text-xs">{errorMsg}</p>
              </div>
            </div>
          ) : !result ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-12 text-slate-500">
              <Sparkles className="h-8 w-8 text-blue-600 mb-3" />
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">Ready to explain your homework</h2>
              <p className="mt-1 text-xs max-w-md">
                Upload a photo or enter a question on the left. AI responses are labeled clearly and designed to help you understand, not replace your own work.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="text-xs font-mono text-slate-500">
                  {result.provider} · {result.model} · {result.subject} · {result.topic}
                </div>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>

              <div>
                <h3 className="text-xs font-semibold text-slate-500">Detected Question</h3>
                <p className="mt-1 text-sm font-medium text-slate-900 dark:text-white">{result.detectedQuestion}</p>
              </div>

              {result.concepts.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500">Key Concepts</h3>
                  <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">{result.concepts.join(' · ')}</p>
                </div>
              )}

              {result.formulas.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-slate-500">Formulas</h3>
                  <div className="mt-1 space-y-1 font-mono text-xs text-blue-700 dark:text-cyan-400">
                    {result.formulas.map((f, i) => <div key={i}>{f}</div>)}
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-xs font-semibold text-slate-500">Step-by-Step Explanation</h3>
                <ol className="mt-1.5 space-y-2 list-decimal pl-5 text-sm text-slate-700 dark:text-slate-200">
                  {result.steps.map((st, i) => <li key={i}>{st}</li>)}
                </ol>
              </div>

              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 p-4">
                <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Final Solution</div>
                <div className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{result.finalSolution}</div>
                <div className="mt-1 text-xs text-slate-600 dark:text-slate-400">{result.verificationNote}</div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-xs">
                <span className="font-semibold">Practice Next: </span>
                <span>{result.practiceQuestion}</span>
              </div>

              <p className="text-[11px] text-slate-400">{result.aiDisclaimer}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
