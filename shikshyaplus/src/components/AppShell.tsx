import React, { useState } from 'react';
import {
  Bell,
  BookOpen,
  Bot,
  Briefcase,
  Building2,
  ChevronDown,
  Globe,
  GraduationCap,
  Home,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Plus,
  ScanLine,
  School,
  Search,
  Settings,
  ShieldAlert,
  Sun,
  User,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import type { AddActionSpec } from '../lib/domainRules';
import type { AppTab, AuthUser } from '../types';
import { t, type Language } from '../lib/i18n';
import { OfflineStatusBanner, PWAInstallButton } from './PWAInstallButton';

interface AppShellProps {
  user: AuthUser;
  activeTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  permittedAddActions: AddActionSpec[];
  onTriggerAddAction: (action: AddActionSpec) => void;
  onOpenAddModal?: () => void;
  onSwitchMembership: (membershipId: string) => void;
  onOpenAccountCenter: () => void;
  onLogout: () => void;
  unreadNotifications: number;
  notifications: Array<{ id: string; title: string; body: string; is_read: number; created_at: string }>;
  onMarkAllRead: () => void;
  darkMode: boolean;
  onToggleDark: () => void;
  language: Language;
  onChangeLanguage: (lang: Language) => void;
  pendingSyncCount: number;
  onSyncNow: () => void;
  onOpenQueue?: () => void;
  syncing: boolean;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  user,
  activeTab,
  onSelectTab,
  permittedAddActions,
  onTriggerAddAction,
  onOpenAddModal,
  onSwitchMembership,
  onOpenAccountCenter,
  onLogout,
  unreadNotifications,
  notifications,
  onMarkAllRead,
  darkMode,
  onToggleDark,
  language,
  onChangeLanguage,
  pendingSyncCount,
  onSyncNow,
  onOpenQueue,
  syncing,
  searchQuery,
  onSearchChange,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  const navItems: Array<{ id: AppTab; label: string; icon: React.ReactNode; show: boolean }> = [
    { id: 'overview', label: t(language, 'overview'), icon: <LayoutDashboard className="h-4 w-4" />, show: true },
    { id: 'global_feed', label: t(language, 'globalFeed'), icon: <Globe className="h-4 w-4" />, show: true },
    { id: 'my_school', label: t(language, 'mySchool'), icon: <School className="h-4 w-4" />, show: Boolean(user.activeSchoolId) },
    { id: 'directory', label: t(language, 'directory'), icon: <Building2 className="h-4 w-4" />, show: true },
    { id: 'academics', label: t(language, 'academics'), icon: <BookOpen className="h-4 w-4" />, show: Boolean(user.activeSchoolId) },
    { id: 'learning_hub', label: t(language, 'learningHub'), icon: <GraduationCap className="h-4 w-4" />, show: Boolean(user.activeSchoolId) },
    {
      id: 'payments',
      label: t(language, 'payments'),
      icon: <WalletCards className="h-4 w-4" />,
      show:
        Boolean(user.activeSchoolId) &&
        [
          'PRINCIPAL',
          'VICE_PRINCIPAL',
          'SCHOOL_ORG',
          'STAFF_ACCOUNTANT',
          'STAFF_ADMIN',
          'PLATFORM_SUPER_ADMIN',
          'PARENT',
          'LEGAL_GUARDIAN',
          'STUDENT',
        ].includes(user.activeRole),
    },
    { id: 'automation_ai', label: t(language, 'automationAi'), icon: <Bot className="h-4 w-4" />, show: Boolean(user.activeSchoolId) },
    { id: 'trust_hub', label: t(language, 'trustHub'), icon: <Lock className="h-4 w-4" />, show: Boolean(user.activeSchoolId) },
    {
      id: 'students',
      label: t(language, 'students'),
      icon: <Users className="h-4 w-4" />,
      show:
        Boolean(user.activeSchoolId) &&
        ['PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG', 'TEACHER', 'CLASS_TEACHER', 'TECHNICAL_DEPT', 'TECHNICAL_OPERATOR', 'PARENT', 'LEGAL_GUARDIAN'].includes(
          user.activeRole
        ),
    },
    {
      id: 'staff_accounts',
      label: t(language, 'staffAccounts'),
      icon: <Briefcase className="h-4 w-4" />,
      show: Boolean(user.activeSchoolId) && ['PRINCIPAL', 'VICE_PRINCIPAL', 'SCHOOL_ORG'].includes(user.activeRole),
    },
    { id: 'ai_scanner', label: t(language, 'aiScanner'), icon: <ScanLine className="h-4 w-4" />, show: true },
    { id: 'messaging', label: t(language, 'messaging'), icon: <MessageSquare className="h-4 w-4" />, show: Boolean(user.activeSchoolId) },
    { id: 'operations', label: t(language, 'operations'), icon: <Settings className="h-4 w-4" />, show: Boolean(user.activeSchoolId) },
    { id: 'moderation', label: t(language, 'moderation'), icon: <ShieldAlert className="h-4 w-4" />, show: true },
    {
      id: 'schools_admin',
      label: t(language, 'schoolsAdmin'),
      icon: <Building2 className="h-4 w-4" />,
      show: user.activeRole === 'PLATFORM_SUPER_ADMIN' || user.activeRole === 'PLATFORM_SUPPORT',
    },
    { id: 'profile', label: t(language, 'profile'), icon: <User className="h-4 w-4" />, show: true },
  ];

  const visibleNav = navItems.filter((n) => n.show);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <OfflineStatusBanner pendingSyncCount={pendingSyncCount} onSyncNow={onSyncNow} onOpenQueue={onOpenQueue} syncing={syncing} />

      {/* Top Navigation Bar (Compact 52px on mobile, clean 3-zone on desktop) */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md">
        <div className="flex h-13 lg:h-15 items-center justify-between gap-2 sm:gap-4 px-2.5 sm:px-4 lg:px-6">
          {/* Left Zone: Mobile menu + Brand */}
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 shrink-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden rounded-lg p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[40px] min-w-[40px] flex items-center justify-center"
            >
              <Menu className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => onSelectTab('overview')}
              className="flex items-center gap-2 text-sm sm:text-base font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
            >
              <img src="/icon.svg" alt="" className="h-6 w-6 sm:h-7 sm:w-7 rounded-md shrink-0" />
              <span>{t(language, 'appName')}</span>
            </button>
          </div>

          {/* Center Zone: Desktop Search & School Context */}
          <div className="hidden md:flex flex-1 max-w-md items-center gap-2">
            <div className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder={t(language, 'searchPlaceholder')}
                aria-label="Search workspace"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-9 pr-3 py-1.5 text-sm focus:border-blue-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Right Zone: Universal Add + Notifications + Account Switcher */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <div className="hidden sm:block">
              <PWAInstallButton compact />
            </div>

            {permittedAddActions.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setAddMenuOpen((v) => !v);
                    setNotifOpen(false);
                    setSwitcherOpen(false);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-2.5 sm:px-3 py-2 text-xs font-semibold text-white hover:bg-[#193054] dark:hover:bg-blue-700 whitespace-nowrap shrink-0 min-h-[40px]"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  <span>{t(language, 'addAction')}</span>
                </button>
                {addMenuOpen && (
                  <div className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-xl z-50">
                    <div className="px-2.5 py-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      Quick Actions ({user.activeRole.replace(/_/g, ' ')})
                    </div>
                    <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                      {permittedAddActions.map((act) => (
                        <button
                          key={act.id}
                          type="button"
                          onClick={() => {
                            setAddMenuOpen(false);
                            onTriggerAddAction(act);
                          }}
                          className="w-full rounded-lg px-2.5 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                        >
                          <div className="text-xs font-semibold text-slate-900 dark:text-white">{act.label}</div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">{act.description}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((v) => !v);
                  setAddMenuOpen(false);
                  setSwitcherOpen(false);
                }}
                aria-label="Notifications"
                className="relative rounded-lg border border-slate-200 dark:border-slate-700 p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[40px] min-w-[40px] flex items-center justify-center"
              >
                <Bell className="h-4 w-4" />
                {unreadNotifications > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white tabular-nums">
                    {unreadNotifications}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 mt-2 w-72 sm:w-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-xl z-50">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
                    <span className="text-xs font-semibold">Notifications</span>
                    <button type="button" onClick={onMarkAllRead} className="text-xs text-blue-600 dark:text-cyan-400 hover:underline">
                      Mark all read
                    </button>
                  </div>
                  <div className="mt-2 max-h-72 overflow-y-auto space-y-2">
                    {notifications.length === 0 ? (
                      <p className="py-4 text-center text-xs text-slate-500">All caught up.</p>
                    ) : (
                      notifications.map((n) => (
                        <div key={n.id} className={`rounded-lg p-2.5 text-xs ${n.is_read ? 'opacity-70' : 'bg-blue-50/60 dark:bg-blue-950/30'}`}>
                          <div className="font-semibold text-slate-900 dark:text-white">{n.title}</div>
                          <div className="mt-0.5 text-slate-600 dark:text-slate-300">{n.body}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Account & School Switcher */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setSwitcherOpen((v) => !v);
                  setAddMenuOpen(false);
                  setNotifOpen(false);
                }}
                aria-label="Account and school switcher"
                className="flex items-center gap-1.5 sm:gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-1.5 sm:px-2.5 sm:py-1.5 text-xs hover:bg-slate-100 dark:hover:bg-slate-800 min-h-[40px]"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-600 text-[11px] font-bold text-white shrink-0">
                  {user.fullName.charAt(0).toUpperCase()}
                </div>
                <div className="hidden sm:block text-left max-w-[130px] truncate">
                  <div className="font-semibold text-slate-900 dark:text-white truncate">{user.fullName}</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    {user.activeSchoolCode || user.activeRole.replace(/_/g, ' ')}
                  </div>
                </div>
                <ChevronDown className="hidden sm:block h-3.5 w-3.5 text-slate-400 shrink-0" />
              </button>

              {switcherOpen && (
                <div className="absolute right-0 mt-2 w-72 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 shadow-xl z-50">
                  <div className="px-2.5 py-2 border-b border-slate-100 dark:border-slate-800">
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">{user.fullName}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      {user.activeRole.replace(/_/g, ' ')} · {user.userCode || user.email}
                    </div>
                  </div>

                  {user.memberships.length > 0 && (
                    <div className="py-1.5 border-b border-slate-100 dark:border-slate-800">
                      <div className="px-2.5 py-1 text-[11px] font-medium text-slate-500">Switch Verified School</div>
                      {user.memberships.map((m) => (
                        <button
                          key={m.membershipId}
                          type="button"
                          onClick={() => {
                            setSwitcherOpen(false);
                            onSwitchMembership(m.membershipId);
                          }}
                          className={`w-full rounded-lg px-2.5 py-1.5 text-left text-xs ${
                            m.membershipId === user.activeMembershipId
                              ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-cyan-300 font-semibold'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          <div className="truncate">{m.schoolName}</div>
                          <div className="text-[10px] text-slate-500 font-mono">
                            {m.schoolCode} · {m.role} · {m.userCode}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="pt-1.5 space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setSwitcherOpen(false);
                        onOpenAccountCenter();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <Settings className="h-3.5 w-3.5" />
                      <span>{t(language, 'accountCenter')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeLanguage(language === 'en' ? 'ne' : 'en')}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span>Language</span>
                      <span className="font-mono">{language === 'en' ? 'EN → नेपाली' : 'नेपाली → EN'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={onToggleDark}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span>Appearance</span>
                      {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={onLogout}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>{t(language, 'signOut')}</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Workspace Frame */}
      <div className="flex-1 flex">
        {/* Desktop Left Sidebar */}
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          {user.activeSchoolName && (
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">{user.activeSchoolName}</div>
              <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                {user.activeSchoolCode} · {user.userCode}
              </div>
            </div>
          )}
          <nav aria-label="Workspace navigation" className="flex-1 p-3 space-y-1 overflow-y-auto">
            {visibleNav.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#0F1E36] text-white dark:bg-blue-600'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {item.icon}
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="p-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onOpenAccountCenter}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Settings className="h-4 w-4" />
              <span>{t(language, 'accountCenter')}</span>
            </button>
          </div>
        </aside>

        {/* Mobile Slide-Over Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 lg:hidden flex">
            <div className="fixed inset-0 bg-slate-950/60" onClick={() => setMobileMenuOpen(false)} />
            <div className="relative w-72 max-w-[85vw] bg-white dark:bg-slate-900 h-full flex flex-col border-r border-slate-200 dark:border-slate-800 z-10">
              <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
                <span className="font-bold text-base">{t(language, 'appName')}</span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close navigation menu"
                  className="rounded-lg p-2 text-slate-500 min-h-[44px] min-w-[44px] flex items-center justify-center"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto p-3 space-y-1">
                {visibleNav.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSelectTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium min-h-[44px] ${
                      activeTab === item.id
                        ? 'bg-[#0F1E36] text-white dark:bg-blue-600'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </nav>
              <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <PWAInstallButton />
                <button
                  type="button"
                  onClick={onLogout}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 min-h-[44px]"
                >
                  <LogOut className="h-4 w-4" />
                  <span>{t(language, 'signOut')}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Scrollable Content Area */}
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 pb-24 lg:pb-10">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation Bar (compact 60px, well under 15% viewport height) */}
      <nav
        aria-label="Mobile bottom navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md pb-safe"
      >
        <div className="grid grid-cols-5 items-center h-14">
          <button
            type="button"
            onClick={() => onSelectTab('overview')}
            className={`flex flex-col items-center justify-center h-full text-[10px] font-medium ${
              activeTab === 'overview' ? 'text-blue-600 dark:text-cyan-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Home className="h-5 w-5" />
            <span className="mt-0.5">Home</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectTab('global_feed')}
            className={`flex flex-col items-center justify-center h-full text-[10px] font-medium ${
              activeTab === 'global_feed' ? 'text-blue-600 dark:text-cyan-400' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Globe className="h-5 w-5" />
            <span className="mt-0.5">Global</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (onOpenAddModal && permittedAddActions.length > 0) {
                onOpenAddModal();
              } else if (permittedAddActions[0]) {
                onTriggerAddAction(permittedAddActions[0]);
              }
            }}
            aria-label="Quick Add Action"
            className="flex flex-col items-center justify-center h-full"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0F1E36] dark:bg-blue-600 text-white shadow-sm">
              <Plus className="h-5 w-5" />
            </span>
          </button>
          <button
            type="button"
            onClick={() => onSelectTab(user.activeSchoolId ? 'my_school' : 'directory')}
            className={`flex flex-col items-center justify-center h-full text-[10px] font-medium ${
              activeTab === 'my_school' || activeTab === 'directory'
                ? 'text-blue-600 dark:text-cyan-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <School className="h-5 w-5" />
            <span className="mt-0.5">School</span>
          </button>
          <button
            type="button"
            onClick={() => onSelectTab(user.activeSchoolId ? 'messaging' : 'ai_scanner')}
            className={`flex flex-col items-center justify-center h-full text-[10px] font-medium ${
              activeTab === 'messaging' || activeTab === 'ai_scanner'
                ? 'text-blue-600 dark:text-cyan-400'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <MessageSquare className="h-5 w-5" />
            <span className="mt-0.5">{user.activeSchoolId ? 'Messages' : 'AI Tutor'}</span>
          </button>
        </div>
      </nav>
    </div>
  );
};
