import React, { useEffect, useState } from 'react';
import { CheckCircle2, Download, KeyRound, Laptop, LogOut, Shield, Trash2, X } from 'lucide-react';
import { apiGet, apiMutate } from '../lib/api';
import type { Language } from '../lib/i18n';
import type { AuthUser, UserProfileMeta } from '../types';
import { PWAInstallButton } from './PWAInstallButton';

interface AccountCenterModalProps {
  user: AuthUser;
  profile: UserProfileMeta | null;
  forcedPasswordChange?: boolean;
  language: Language;
  calendar: 'AD' | 'BS';
  darkMode: boolean;
  onChangeLanguage: (lang: Language) => void;
  onChangeCalendar: (cal: 'AD' | 'BS') => void;
  onToggleDark: () => void;
  onUserUpdated: (user: AuthUser) => void;
  onLogoutAll: () => void;
  onClose: () => void;
}

export const AccountCenterModal: React.FC<AccountCenterModalProps> = ({
  user,
  profile,
  forcedPasswordChange,
  language,
  calendar,
  darkMode,
  onChangeLanguage,
  onChangeCalendar,
  onToggleDark,
  onUserUpdated,
  onLogoutAll,
  onClose,
}) => {
  const [tab, setTab] = useState<'profile' | 'security' | 'sessions'>(forcedPasswordChange ? 'security' : 'profile');
  const [fullName, setFullName] = useState(user.fullName);
  const [bio, setBio] = useState(profile?.bio || '');
  const [address, setAddress] = useState(profile?.address || '');
  const [phone, setPhone] = useState(profile?.phone || '');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'SCHOOL_ONLY' | 'PRIVATE'>(profile?.privacy_profile_visibility || 'SCHOOL_ONLY');
  const [messagePolicy, setMessagePolicy] = useState<'SCHOOL_ONLY' | 'CONNECTIONS' | 'RESTRICTED'>(profile?.privacy_message_policy || 'SCHOOL_ONLY');

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [sessions, setSessions] = useState<Array<Record<string, unknown>>>([]);
  const [currentSessionId, setCurrentSessionId] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadSessions = async () => {
    const res = await apiGet<{ sessions: Array<Record<string, unknown>>; currentSessionId: string }>('/auth/sessions');
    if (res.success && res.data) {
      setSessions(res.data.sessions);
      setCurrentSessionId(res.data.currentSessionId);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate<{ user: AuthUser }>('/auth/profile', 'PATCH', {
      fullName,
      bio,
      address,
      phone,
      privacyProfileVisibility: visibility,
      privacyMessagePolicy: messagePolicy,
      preferredLanguage: language,
      preferredCalendar: calendar,
    });
    setFeedback({ ok: res.success, msg: res.message || 'Profile saved.' });
    if (res.success && res.data?.user) {
      onUserUpdated(res.data.user);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiMutate<{ user: AuthUser }>('/auth/change-password', 'POST', { currentPassword, newPassword });
    setFeedback({ ok: res.success, msg: res.message || 'Password updated.' });
    if (res.success) {
      setCurrentPassword('');
      setNewPassword('');
      if (res.data?.user) onUserUpdated(res.data.user);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    const res = await apiMutate(`/auth/sessions/${sessionId}`, 'DELETE');
    if (res.success) loadSessions();
  };

  const handleExportData = async () => {
    const res = await apiGet<Record<string, unknown>>('/auth/export-data');
    if (res.success && res.data) {
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `shikshyaplus-account-${user.username}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setFeedback({ ok: true, msg: 'Personal data JSON exported.' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {forcedPasswordChange ? 'Password Update Required' : 'Account Center & Security'}
            </h2>
            <p className="text-xs text-slate-500">
              {user.email} · {user.activeRole.replace(/_/g, ' ')}
            </p>
          </div>
          {!forcedPasswordChange && (
            <button type="button" onClick={onClose} aria-label="Close Account Center" className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {forcedPasswordChange && (
          <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200">
            Your account was issued a temporary school password. Please set a personal password (8+ characters) before continuing.
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={forcedPasswordChange}
            onClick={() => setTab('profile')}
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${tab === 'profile' ? 'bg-[#0F1E36] text-white dark:bg-blue-600' : 'border border-slate-200 dark:border-slate-700 disabled:opacity-40'}`}
          >
            Profile & Preferences
          </button>
          <button
            type="button"
            onClick={() => setTab('security')}
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${tab === 'security' ? 'bg-[#0F1E36] text-white dark:bg-blue-600' : 'border border-slate-200 dark:border-slate-700'}`}
          >
            Password & Data
          </button>
          <button
            type="button"
            disabled={forcedPasswordChange}
            onClick={() => setTab('sessions')}
            className={`rounded-lg px-3 py-2 text-xs font-semibold ${tab === 'sessions' ? 'bg-[#0F1E36] text-white dark:bg-blue-600' : 'border border-slate-200 dark:border-slate-700 disabled:opacity-40'}`}
          >
            Active Sessions
          </button>
        </div>

        {feedback && (
          <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs ${feedback.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-700'}`}>
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{feedback.msg}</span>
          </div>
        )}

        {tab === 'profile' && (
          <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium mb-1">Full Name</label>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block font-medium mb-1">Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
              </div>
            </div>
            <div>
              <label className="block font-medium mb-1">Address</label>
              <input value={address} onChange={(e) => setAddress(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block font-medium mb-1">Academic Bio</label>
              <textarea rows={2} value={bio} onChange={(e) => setBio(e.target.value)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-medium mb-1">Profile Visibility</label>
                <select value={visibility} onChange={(e) => setVisibility(e.target.value as 'PUBLIC' | 'SCHOOL_ONLY' | 'PRIVATE')} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2">
                  <option value="PUBLIC">Public Educational Profile</option>
                  <option value="SCHOOL_ONLY">School Members Only</option>
                  <option value="PRIVATE">Private</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Direct Message Policy</label>
                <select value={messagePolicy} onChange={(e) => setMessagePolicy(e.target.value as 'SCHOOL_ONLY' | 'CONNECTIONS' | 'RESTRICTED')} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2">
                  <option value="SCHOOL_ONLY">Verified School Contacts</option>
                  <option value="CONNECTIONS">Connections</option>
                  <option value="RESTRICTED">Restricted</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div>
                <label className="block font-medium mb-1">Language</label>
                <select value={language} onChange={(e) => onChangeLanguage(e.target.value as Language)} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2">
                  <option value="en">English (EN)</option>
                  <option value="ne">नेपाली (NE)</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Calendar</label>
                <select value={calendar} onChange={(e) => onChangeCalendar(e.target.value as 'AD' | 'BS')} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-2">
                  <option value="AD">Gregorian (AD)</option>
                  <option value="BS">Bikram Sambat (BS)</option>
                </select>
              </div>
              <div>
                <label className="block font-medium mb-1">Theme</label>
                <button type="button" onClick={onToggleDark} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 py-2 font-semibold">
                  {darkMode ? 'Dark Mode' : 'Light Mode'}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <PWAInstallButton />
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('sp_hide_demo_accounts');
                    localStorage.removeItem('sp_hide_welcome_banner');
                    localStorage.removeItem('sp_hide_install_prompt');
                    setFeedback({ ok: true, msg: 'Dismissed onboarding tips and quick sign-in helpers restored.' });
                  }}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  Restore Dismissed Tips
                </button>
              </div>
              <button type="submit" className="rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-5 py-2.5 font-semibold text-white">
                Save Settings
              </button>
            </div>
          </form>
        )}

        {tab === 'security' && (
          <div className="space-y-5 text-xs">
            <form onSubmit={handleChangePassword} className="space-y-3">
              <div className="flex items-center gap-1.5 font-bold text-sm text-slate-900 dark:text-white">
                <KeyRound className="h-4 w-4 text-blue-600" />
                <span>Change Account Password</span>
              </div>
              <input
                type="password"
                required
                placeholder="Current / Temporary Password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="New Password (8+ characters)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
              <button type="submit" className="rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-4 py-2.5 font-semibold text-white">
                Update Password
              </button>
            </form>

            {!forcedPasswordChange && (
              <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Shield className="h-4 w-4 text-emerald-600" />
                    <span>Personal Data Export</span>
                  </div>
                  <p className="text-slate-500">Download a portable JSON copy of your profile, school memberships, and posts.</p>
                </div>
                <button type="button" onClick={handleExportData} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 font-semibold">
                  <Download className="h-3.5 w-3.5" />
                  <span>Export JSON</span>
                </button>
              </div>
            )}
          </div>
        )}

        {tab === 'sessions' && (
          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-900 dark:text-white">Active Devices & Sessions</div>
              <button
                type="button"
                onClick={onLogoutAll}
                className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Log Out All Devices</span>
              </button>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {sessions.map((s) => (
                <div key={String(s.id)} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <Laptop className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {String(s.device_label || 'Browser')} {String(s.id) === currentSessionId ? '(Current)' : ''}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500">
                        IP {String(s.ip_address)} · {s.revoked_at ? 'Revoked' : 'Active'}
                      </div>
                    </div>
                  </div>
                  {!s.revoked_at && String(s.id) !== currentSessionId && (
                    <button
                      type="button"
                      onClick={() => handleRevokeSession(String(s.id))}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] text-red-600"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>Revoke</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
