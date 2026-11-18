import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  GraduationCap,
  KeyRound,
  Moon,
  ShieldCheck,
  Sun,
  UserCheck,
  Users,
} from 'lucide-react';
import { apiMutate } from '../lib/api';
import type { AuthUser } from '../types';
import type { Language } from '../lib/i18n';
import { PWAInstallButton } from './PWAInstallButton';

interface AuthPortalProps {
  onAuthenticated: (user: AuthUser) => void;
  darkMode: boolean;
  onToggleDark: () => void;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
}

type AuthView = 'LOGIN' | 'REGISTER_SCHOOL' | 'REGISTER_PARENT' | 'REGISTER_STUDENT' | 'FORGOT_PASSWORD';

const DEMO_ACCOUNTS = [
  { label: 'Principal · Sunrise', mode: 'SCHOOL_ID' as const, schoolCode: 'SUNRISE-2026', userCode: 'PRI-001', pw: 'School@2026!' },
  { label: 'Teacher · Sunrise', mode: 'SCHOOL_ID' as const, schoolCode: 'SUNRISE-2026', userCode: 'TCH-001', pw: 'School@2026!' },
  { label: 'Tech Dept · Sunrise', mode: 'SCHOOL_ID' as const, schoolCode: 'SUNRISE-2026', userCode: 'TEC-001', pw: 'School@2026!' },
  { label: 'Accounts · Sunrise', mode: 'SCHOOL_ID' as const, schoolCode: 'SUNRISE-2026', userCode: 'STF-001', pw: 'School@2026!' },
  { label: 'Student · Sunrise', mode: 'SCHOOL_ID' as const, schoolCode: 'SUNRISE-2026', userCode: 'STU-001', pw: 'School@2026!' },
  { label: 'Parent · Kavita', mode: 'GLOBAL' as const, email: 'parent@sunrise.edu.np', pw: 'Parent@2026!' },
  { label: 'Principal · Everest', mode: 'SCHOOL_ID' as const, schoolCode: 'EVEREST-2026', userCode: 'PRI-001', pw: 'School@2026!' },
  { label: 'Platform Super Admin', mode: 'GLOBAL' as const, email: 'superadmin@shikshyaplus.edu.np', pw: 'Admin@2026!' },
];

export const AuthPortal: React.FC<AuthPortalProps> = ({
  onAuthenticated,
  darkMode,
  onToggleDark,
  language,
  onChangeLanguage,
}) => {
  const [view, setView] = useState<AuthView>('LOGIN');
  const [loginMode, setLoginMode] = useState<'SCHOOL_ID' | 'GLOBAL'>('SCHOOL_ID');
  const [schoolCode, setSchoolCode] = useState('SUNRISE-2026');
  const [userCode, setUserCode] = useState('PRI-001');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [hideDemoHelpers, setHideDemoHelpers] = useState<boolean>(
    () => typeof window !== 'undefined' && localStorage.getItem('sp_hide_demo_accounts') === '1'
  );

  // School registration state
  const [schForm, setSchForm] = useState({
    schoolName: '',
    schoolType: 'Private Secondary',
    category: 'K-12 General & STEM',
    country: 'Nepal',
    province: 'Bagmati Province',
    district: 'Kathmandu',
    municipality: 'Kathmandu Metropolitan',
    ward: '10',
    address: '',
    telephone: '',
    officialEmail: '',
    website: '',
    establishedYear: '2018',
    registrationNumber: '',
    educationBoard: 'NEB Nepal',
    principalName: '',
    principalEmail: '',
    principalPhone: '',
    password: '',
  });

  // Parent registration state
  const [parForm, setParForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    address: '',
    relationship: 'Mother',
    invitationCode: '',
    password: '',
  });

  // Student registration state
  const [stuForm, setStuForm] = useState({
    fullName: '',
    schoolCode: 'SUNRISE-2026',
    admissionNumber: '',
    className: 'Class 10',
    section: 'A',
    guardianPhone: '',
    email: '',
    password: '',
  });

  // Forgot password state
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [resetNewPw, setResetNewPw] = useState('');
  const [resetRequested, setResetRequested] = useState(false);
  const [devResetPreview, setDevResetPreview] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      const payload =
        loginMode === 'SCHOOL_ID'
          ? { mode: 'SCHOOL_ID', schoolCode: schoolCode.trim(), userCode: userCode.trim(), password }
          : { mode: 'GLOBAL', email: email.trim(), password };
      const res = await apiMutate<{ user: AuthUser }>('/auth/login', 'POST', payload);
      if (!res.success || !res.data?.user) {
        setErrorMsg(res.message || 'Authentication failed.');
      } else {
        onAuthenticated(res.data.user);
      }
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = async (preset: (typeof DEMO_ACCOUNTS)[number]) => {
    setErrorMsg(null);
    setLoading(true);
    try {
      const payload =
        preset.mode === 'SCHOOL_ID'
          ? { mode: 'SCHOOL_ID', schoolCode: preset.schoolCode, userCode: preset.userCode, password: preset.pw }
          : { mode: 'GLOBAL', email: preset.email, password: preset.pw };
      const res = await apiMutate<{ user: AuthUser }>('/auth/login', 'POST', payload);
      if (res.success && res.data?.user) {
        onAuthenticated(res.data.user);
      } else {
        setErrorMsg(res.message || 'Sign in failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSchool = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await apiMutate<{ schoolCode: string; user: AuthUser }>('/auth/register-school', 'POST', schForm);
      if (!res.success || !res.data?.user) {
        setErrorMsg(res.message || 'School registration failed.');
      } else {
        onAuthenticated(res.data.user);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterParent = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await apiMutate<{ user: AuthUser }>('/auth/register-parent', 'POST', parForm);
      if (!res.success || !res.data?.user) {
        setErrorMsg(res.message || 'Parent registration failed.');
      } else {
        onAuthenticated(res.data.user);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await apiMutate<{ user: AuthUser }>('/auth/register-student', 'POST', stuForm);
      if (!res.success || !res.data?.user) {
        setErrorMsg(res.message || 'Student registration failed.');
      } else {
        onAuthenticated(res.data.user);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setLoading(true);
    try {
      const res = await apiMutate<{ devResetCodePreview?: string }>('/auth/forgot-password', 'POST', { email: resetEmail });
      if (res.success) {
        setResetRequested(true);
        setSuccessMsg(res.message || 'Reset code generated.');
        if (res.data?.devResetCodePreview) setDevResetPreview(res.data.devResetCodePreview);
      } else {
        setErrorMsg(res.message || 'Could not initiate password reset.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await apiMutate('/auth/reset-password', 'POST', {
        email: resetEmail,
        tokenCode: resetCode,
        newPassword: resetNewPw,
      });
      if (res.success) {
        setSuccessMsg('Password updated. You can now sign in.');
        setView('LOGIN');
        setLoginMode('GLOBAL');
        setEmail(resetEmail);
      } else {
        setErrorMsg(res.message || 'Invalid reset code.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Top 3-Zone Header */}
      <header className="w-full border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 py-3">
          <a href="/" className="flex items-center gap-2.5 text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0">
            <img
              src="/icon.svg"
              alt="ShikshyaPlus emblem"
              className="h-8 w-8 rounded-lg"
            />
            <span>ShikshyaPlus</span>
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
            <button type="button" onClick={() => setView('LOGIN')} className="hover:text-blue-600 dark:hover:text-cyan-400 transition-colors whitespace-nowrap shrink-0">
              Sign In
            </button>
            <button type="button" onClick={() => setView('REGISTER_SCHOOL')} className="hover:text-blue-600 dark:hover:text-cyan-400 transition-colors whitespace-nowrap shrink-0">
              Register School
            </button>
            <button type="button" onClick={() => setView('REGISTER_PARENT')} className="hover:text-blue-600 dark:hover:text-cyan-400 transition-colors whitespace-nowrap shrink-0">
              Parent Portal
            </button>
            <button type="button" onClick={() => setView('REGISTER_STUDENT')} className="hover:text-blue-600 dark:hover:text-cyan-400 transition-colors whitespace-nowrap shrink-0">
              Student Enrollment
            </button>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onChangeLanguage(language === 'en' ? 'ne' : 'en')}
              aria-label="Toggle language"
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[40px]"
            >
              {language === 'en' ? 'नेपाली' : 'EN'}
            </button>
            <button
              type="button"
              onClick={onToggleDark}
              aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
              className="rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <PWAInstallButton compact />
          </div>
        </div>
      </header>

      {/* Main Split Content */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 lg:py-10 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left Editorial Campus Showcase (Desktop & Tablet) */}
        <section className="hidden lg:flex lg:col-span-6 flex-col justify-between rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-[#0F1E36] text-white relative">
          <img
            src="/src/assets/images/school_hero_campus_1794923107830.jpg"
            alt="Secondary school campus in Himalayan foothills"
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover opacity-45"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0B1528] via-[#0F1E36]/75 to-[#0F1E36]/40" />

          <div className="relative z-10 p-8 flex flex-col justify-between h-full gap-8">
            <div>
              <p className="text-xs font-medium tracking-wide text-cyan-300">
                Nepal-First · Multi-Tenant SaaS · digital PWA by chandra prasad prasain
              </p>
              <h1 className="mt-3 text-3xl xl:text-4xl font-bold tracking-tight leading-tight text-balance">
                One global education network. Completely isolated school workspaces.
              </h1>
              <p className="mt-4 text-sm text-slate-200 leading-relaxed max-w-xl">
                Unify Principal administration, Teacher classrooms, Technical Student Information Systems,
                verified Parent linking, AI Homework Scanning, and moderated school communities in one secure platform.
              </p>
            </div>

            <div className="space-y-4 border-t border-white/15 pt-6">
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-semibold text-white">Strict Tenant & Safeguarding Isolation</h2>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Every school operates inside an isolated database boundary with verified guardian invitation codes and 3-strike AI safety moderation.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Globe className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-semibold text-white">Global Feed + Private My School Community</h2>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Publish STEM achievements globally while keeping private notices, marks, attendance, and parent messages inside your school.
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <GraduationCap className="h-5 w-5 text-cyan-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-semibold text-white">Offline-Capable Mobile & Desktop Access</h2>
                  <p className="text-xs text-slate-300 mt-0.5">
                    Browse cached homework, daily diary, results, and timetable offline; edits queue and synchronize automatically on reconnect.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Right Auth & Registration Card */}
        <section className="lg:col-span-6 flex flex-col justify-center">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-xs">
            {view !== 'LOGIN' && (
              <button
                type="button"
                onClick={() => {
                  setView('LOGIN');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-cyan-400 hover:underline min-h-[36px]"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to Sign In</span>
              </button>
            )}

            {errorMsg && (
              <div role="alert" className="mb-4 flex items-start gap-2.5 rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3 text-xs text-red-800 dark:text-red-200">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div role="status" className="mb-4 flex items-start gap-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/50 p-3 text-xs text-emerald-800 dark:text-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                <span>{successMsg}</span>
              </div>
            )}

            {view === 'LOGIN' && (
              <>
                <div className="mb-5">
                  <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                    Sign in to ShikshyaPlus
                  </h2>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                    Use your School ID & User ID, or sign in with your Global Identity email.
                  </p>
                </div>

                {/* Segmented Login Mode Toggle */}
                <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
                  <button
                    type="button"
                    onClick={() => setLoginMode('SCHOOL_ID')}
                    className={`rounded-lg py-2.5 text-xs font-semibold transition-colors min-h-[42px] ${
                      loginMode === 'SCHOOL_ID'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    School ID + User ID
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoginMode('GLOBAL')}
                    className={`rounded-lg py-2.5 text-xs font-semibold transition-colors min-h-[42px] ${
                      loginMode === 'GLOBAL'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Global Email (Parent / Admin)
                  </button>
                </div>

                <form onSubmit={handleLogin} className="space-y-4">
                  {loginMode === 'SCHOOL_ID' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="login-school-code" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          School ID
                        </label>
                        <input
                          id="login-school-code"
                          type="text"
                          required
                          value={schoolCode}
                          onChange={(e) => setSchoolCode(e.target.value)}
                          placeholder="e.g. SUNRISE-2026"
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm font-mono uppercase focus:border-blue-600 focus:outline-none min-h-[44px]"
                        />
                      </div>
                      <div>
                        <label htmlFor="login-user-code" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                          User ID
                        </label>
                        <input
                          id="login-user-code"
                          type="text"
                          required
                          value={userCode}
                          onChange={(e) => setUserCode(e.target.value)}
                          placeholder="PRI-001, TCH-001, STU-001"
                          className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm font-mono uppercase focus:border-blue-600 focus:outline-none min-h-[44px]"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="login-email" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                        Email Address
                      </label>
                      <input
                        id="login-email"
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="parent@sunrise.edu.np"
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm focus:border-blue-600 focus:outline-none min-h-[44px]"
                      />
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label htmlFor="login-password" className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => setView('FORGOT_PASSWORD')}
                        className="text-xs font-medium text-blue-600 dark:text-cyan-400 hover:underline"
                      >
                        Forgot Password?
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password"
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 pr-11 text-sm focus:border-blue-600 focus:outline-none min-h-[44px]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-3 text-sm font-semibold text-white hover:bg-[#193054] dark:hover:bg-blue-700 disabled:opacity-60 transition-colors min-h-[46px]"
                  >
                    {loading ? 'Authenticating...' : 'Sign In Securely'}
                  </button>
                </form>

                {/* Registration Pathways */}
                <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-3">
                    Create a verified account
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setView('REGISTER_SCHOOL')}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[44px]"
                    >
                      <Building2 className="h-3.5 w-3.5 text-blue-600 dark:text-cyan-400 shrink-0" aria-hidden="true" />
                      <span>Sign Up as School</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('REGISTER_PARENT')}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[44px]"
                    >
                      <Users className="h-3.5 w-3.5 text-blue-600 dark:text-cyan-400 shrink-0" aria-hidden="true" />
                      <span>Sign Up as Parent</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setView('REGISTER_STUDENT')}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 min-h-[44px]"
                    >
                      <UserCheck className="h-3.5 w-3.5 text-blue-600 dark:text-cyan-400 shrink-0" aria-hidden="true" />
                      <span>Sign Up as Student</span>
                    </button>
                  </div>
                </div>

                {/* Seeded Quick Access Switcher for Verification */}
                {!hideDemoHelpers && (
                  <div className="mt-6 pt-5 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                        Quick role sign-in (Seeded Multi-Tenant Accounts)
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          localStorage.setItem('sp_hide_demo_accounts', '1');
                          setHideDemoHelpers(true);
                        }}
                        className="text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline shrink-0"
                      >
                        Don&apos;t show again
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {DEMO_ACCOUNTS.map((acc) => (
                        <button
                          key={acc.label}
                          type="button"
                          disabled={loading}
                          onClick={() => quickLogin(acc)}
                          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2.5 py-2 text-left text-[11px] font-medium text-slate-700 dark:text-slate-300 hover:border-blue-500 hover:text-blue-700 dark:hover:text-cyan-300 transition-colors min-h-[40px]"
                        >
                          {acc.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {view === 'REGISTER_SCHOOL' && (
              <form onSubmit={handleRegisterSchool} className="space-y-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Register School Institution</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Creates a tenant workspace pending verification by Platform Administrators.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">School Name</label>
                    <input required value={schForm.schoolName} onChange={(e) => setSchForm({ ...schForm, schoolName: e.target.value })} placeholder="Himalaya Model Academy" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Registration Number</label>
                    <input required value={schForm.registrationNumber} onChange={(e) => setSchForm({ ...schForm, registrationNumber: e.target.value })} placeholder="REG-KTM-2026-101" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Province</label>
                    <input required value={schForm.province} onChange={(e) => setSchForm({ ...schForm, province: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">District</label>
                    <input required value={schForm.district} onChange={(e) => setSchForm({ ...schForm, district: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Municipality & Address</label>
                    <input required value={schForm.address} onChange={(e) => setSchForm({ ...schForm, address: e.target.value })} placeholder="Ward 4, Lalitpur" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Official School Email</label>
                    <input type="email" required value={schForm.officialEmail} onChange={(e) => setSchForm({ ...schForm, officialEmail: e.target.value })} placeholder="info@school.edu.np" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">School Telephone</label>
                    <input required value={schForm.telephone} onChange={(e) => setSchForm({ ...schForm, telephone: e.target.value })} placeholder="+977-1-5521000" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Principal Full Name</label>
                    <input required value={schForm.principalName} onChange={(e) => setSchForm({ ...schForm, principalName: e.target.value })} placeholder="Dr. Suman Acharya" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Principal Email</label>
                    <input type="email" required value={schForm.principalEmail} onChange={(e) => setSchForm({ ...schForm, principalEmail: e.target.value })} placeholder="principal@school.edu.np" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Principal Phone</label>
                    <input required value={schForm.principalPhone} onChange={(e) => setSchForm({ ...schForm, principalPhone: e.target.value })} placeholder="+9779841000000" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Principal Password (min 8 chars)</label>
                  <input type="password" required minLength={8} value={schForm.password} onChange={(e) => setSchForm({ ...schForm, password: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                </div>
                <button type="submit" disabled={loading} className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-[#193054] min-h-[44px]">
                  {loading ? 'Submitting Registration...' : 'Submit School for Verification'}
                </button>
              </form>
            )}

            {view === 'REGISTER_PARENT' && (
              <form onSubmit={handleRegisterParent} className="space-y-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Parent / Guardian Sign Up</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Create one global parent identity. Link children securely using a school-issued invitation code (e.g. INV-SUN-102).
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">Full Name</label>
                    <input required value={parForm.fullName} onChange={(e) => setParForm({ ...parForm, fullName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Email</label>
                    <input type="email" required value={parForm.email} onChange={(e) => setParForm({ ...parForm, email: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Phone (+97798...)</label>
                    <input required value={parForm.phone} onChange={(e) => setParForm({ ...parForm, phone: e.target.value })} placeholder="+9779841234567" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Relationship</label>
                    <select value={parForm.relationship} onChange={(e) => setParForm({ ...parForm, relationship: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]">
                      <option value="Mother">Mother</option>
                      <option value="Father">Father</option>
                      <option value="Legal Guardian">Legal Guardian</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Address</label>
                  <input required value={parForm.address} onChange={(e) => setParForm({ ...parForm, address: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">School Invitation Code (Optional now, required to link child)</label>
                  <input value={parForm.invitationCode} onChange={(e) => setParForm({ ...parForm, invitationCode: e.target.value })} placeholder="INV-SUN-102" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono uppercase min-h-[42px]" />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Password (min 8 chars)</label>
                  <input type="password" required minLength={8} value={parForm.password} onChange={(e) => setParForm({ ...parForm, password: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                </div>
                <button type="submit" disabled={loading} className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-[#193054] min-h-[44px]">
                  {loading ? 'Creating Parent Profile...' : 'Register Parent Account'}
                </button>
              </form>
            )}

            {view === 'REGISTER_STUDENT' && (
              <form onSubmit={handleRegisterStudent} className="space-y-3">
                <div>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Student Enrollment Sign Up</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Creates a provisional student account verified by your school’s Technical Department.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">Student Full Name</label>
                    <input required value={stuForm.fullName} onChange={(e) => setStuForm({ ...stuForm, fullName: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">School ID</label>
                    <input required value={stuForm.schoolCode} onChange={(e) => setStuForm({ ...stuForm, schoolCode: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm font-mono uppercase min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Admission Number</label>
                    <input required value={stuForm.admissionNumber} onChange={(e) => setStuForm({ ...stuForm, admissionNumber: e.target.value })} placeholder="ADM-2026-205" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Guardian Phone</label>
                    <input required value={stuForm.guardianPhone} onChange={(e) => setStuForm({ ...stuForm, guardianPhone: e.target.value })} placeholder="+9779841000000" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Class</label>
                    <input required value={stuForm.className} onChange={(e) => setStuForm({ ...stuForm, className: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Section</label>
                    <input required value={stuForm.section} onChange={(e) => setStuForm({ ...stuForm, section: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Password (min 8 chars)</label>
                  <input type="password" required minLength={8} value={stuForm.password} onChange={(e) => setStuForm({ ...stuForm, password: e.target.value })} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm min-h-[42px]" />
                </div>
                <button type="submit" disabled={loading} className="w-full rounded-lg bg-[#0F1E36] dark:bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-[#193054] min-h-[44px]">
                  {loading ? 'Submitting Enrollment...' : 'Register Student Account'}
                </button>
              </form>
            )}

            {view === 'FORGOT_PASSWORD' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-blue-600" aria-hidden="true" />
                  <h2 className="text-xl font-bold text-slate-900 dark:text-white">Reset Password</h2>
                </div>
                {!resetRequested ? (
                  <form onSubmit={handleRequestReset} className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium mb-1">Account Email</label>
                      <input type="email" required value={resetEmail} onChange={(e) => setResetEmail(e.target.value)} placeholder="principal@sunrise.edu.np" className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm min-h-[44px]" />
                    </div>
                    <button type="submit" disabled={loading} className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 min-h-[44px]">
                      Generate Reset Code
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleConfirmReset} className="space-y-3">
                    {devResetPreview && (
                      <p className="rounded-lg border border-cyan-200 dark:border-cyan-800 bg-cyan-50 dark:bg-cyan-950/40 p-3 text-xs font-mono">
                        Verification code (no SMTP key configured): <strong>{devResetPreview}</strong>
                      </p>
                    )}
                    <div>
                      <label className="block text-xs font-medium mb-1">6-Digit Verification Code</label>
                      <input required value={resetCode} onChange={(e) => setResetCode(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm font-mono min-h-[44px]" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">New Password (min 8 chars)</label>
                      <input type="password" required minLength={8} value={resetNewPw} onChange={(e) => setResetNewPw(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2.5 text-sm min-h-[44px]" />
                    </div>
                    <button type="submit" disabled={loading} className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 min-h-[44px]">
                      Set New Password
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
