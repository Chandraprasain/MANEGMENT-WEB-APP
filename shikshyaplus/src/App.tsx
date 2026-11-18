import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountCenterModal } from './components/AccountCenterModal';
import { AIScannerModule } from './components/AIScannerModule';
import { AcademicsModule } from './components/AcademicsModule';
import { AppShell } from './components/AppShell';
import { AuthPortal } from './components/AuthPortal';
import { AutomationAndAgentsModule } from './components/AutomationAndAgentsModule';
import { CurriculumAssessmentModule } from './components/CurriculumAssessmentModule';
import { GovernanceTrustModule } from './components/GovernanceTrustModule';
import { MessagingModule } from './components/MessagingModule';
import { ModerationModule } from './components/ModerationModule';
import { OfflineQueueModal } from './components/OfflineQueueModal';
import { OperationsModule, type OpsSection } from './components/OperationsModule';
import { PaymentsHubModule } from './components/PaymentsHubModule';
import { RoleDashboard } from './components/RoleDashboard';
import { SocialModule } from './components/SocialModule';
import { StudentsModule } from './components/StudentsModule';
import { resolveTabForAddAction, UniversalAddModal } from './components/UniversalAddModal';
import { apiGet, apiMutate, syncOfflineQueue } from './lib/api';
import type { AddActionSpec } from './lib/domainRules';
import type { Language } from './lib/i18n';
import { clearOfflineCache, getPendingQueue } from './lib/offlineDb';
import type { AppTab, AuthUser, DashboardData, UserProfileMeta } from './types';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfileMeta | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [activeTab, setActiveTab] = useState<AppTab>('overview');
  const [opsSection, setOpsSection] = useState<OpsSection>('notices');
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [notifications, setNotifications] = useState<Array<{ id: string; title: string; body: string; is_read: number; created_at: string }>>([]);
  const [searchQuery, setSearchQuery] = useState('');

  const [darkMode, setDarkMode] = useState<boolean>(() => localStorage.getItem('sp_theme') === 'dark');
  const [language, setLanguage] = useState<Language>(() => (localStorage.getItem('sp_lang') === 'ne' ? 'ne' : 'en'));
  const [calendar, setCalendar] = useState<'AD' | 'BS'>(() => (localStorage.getItem('sp_cal') === 'BS' ? 'BS' : 'AD'));

  const [showAccountCenter, setShowAccountCenter] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showOfflineQueue, setShowOfflineQueue] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [wsLastMessage, setWsLastMessage] = useState<{ type: string; payload: Record<string, unknown> } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('sp_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem('sp_lang', language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem('sp_cal', calendar);
  }, [calendar]);

  const refreshPendingCount = useCallback(async () => {
    const queue = await getPendingQueue();
    setPendingSyncCount(queue.length);
  }, []);

  const loadDashboardAndNotifs = useCallback(async (u: AuthUser | null) => {
    if (!u) return;
    const [dashRes, notifRes] = await Promise.all([
      apiGet<DashboardData>('/dashboard', `dash:${u.activeSchoolId || 'global'}:${u.activeRole}`),
      apiGet<{ notifications: Array<{ id: string; title: string; body: string; is_read: number; created_at: string }> }>(
        '/communications/notifications',
        `notifs:${u.userId}`
      ),
    ]);
    if (dashRes.success && dashRes.data) setDashboard(dashRes.data);
    if (notifRes.success && notifRes.data) setNotifications(notifRes.data.notifications);
  }, []);

  const handleSyncNow = useCallback(async () => {
    if (!navigator.onLine) return;
    setSyncing(true);
    try {
      await syncOfflineQueue();
      await refreshPendingCount();
      if (user) await loadDashboardAndNotifs(user);
    } finally {
      setSyncing(false);
    }
  }, [user, refreshPendingCount, loadDashboardAndNotifs]);

  useEffect(() => {
    refreshPendingCount();
    const onOnline = () => {
      handleSyncNow();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [handleSyncNow, refreshPendingCount]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiGet<{ user: AuthUser | null; profile?: UserProfileMeta }>('/auth/me', 'auth:me');
      if (!cancelled && res.success && res.data?.user) {
        setUser(res.data.user);
        setProfile(res.data.profile || null);
        if (res.data.profile?.preferred_language) setLanguage(res.data.profile.preferred_language);
        if (res.data.profile?.preferred_calendar) setCalendar(res.data.profile.preferred_calendar);
        await loadDashboardAndNotifs(res.data.user);
      }
      if (!cancelled) setAuthChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDashboardAndNotifs]);

  // Authenticated WebSocket listener
  useEffect(() => {
    if (!user) return;
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;
    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as { type: string; payload: Record<string, unknown> };
        setWsLastMessage(parsed);
        if (parsed.type === 'notification:new') {
          loadDashboardAndNotifs(user);
        }
      } catch {
        // Ignore malformed socket frames
      }
    };
    return () => {
      if (wsRef.current === ws) wsRef.current = null;
      ws.close();
    };
  }, [user?.userId, user?.activeSchoolId]);

  const handleAuthenticated = async (authedUser: AuthUser) => {
    setUser(authedUser);
    setActiveTab('overview');
    await loadDashboardAndNotifs(authedUser);
  };

  const handleSwitchMembership = async (membershipId: string) => {
    const res = await apiMutate<{ user: AuthUser }>('/auth/switch-membership', 'POST', { membershipId });
    if (res.success && res.data?.user) {
      setUser(res.data.user);
      setActiveTab('overview');
      await loadDashboardAndNotifs(res.data.user);
    }
  };

  const handleLogout = async () => {
    await apiMutate('/auth/logout', 'POST');
    await clearOfflineCache();
    setUser(null);
    setDashboard(null);
    setNotifications([]);
  };

  const handleLogoutAll = async () => {
    await apiMutate('/auth/logout-all', 'POST');
    await clearOfflineCache();
    setShowAccountCenter(false);
    setUser(null);
    setDashboard(null);
  };

  const handleMarkAllRead = async () => {
    await apiMutate('/communications/notifications/read-all', 'POST');
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
  };

  const handleTriggerAddAction = (action: AddActionSpec) => {
    const target = resolveTabForAddAction(action.id);
    if (target.opsSection) setOpsSection(target.opsSection);
    setActiveTab(target.tab);
    setShowAddModal(false);
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-300 text-sm">
        Loading ShikshyaPlus workspace...
      </div>
    );
  }

  if (!user) {
    return (
      <AuthPortal
        onAuthenticated={handleAuthenticated}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((v) => !v)}
        language={language}
        onChangeLanguage={setLanguage}
      />
    );
  }

  const permittedAddActions = dashboard?.permittedAddActions || [];
  const unreadNotifications = notifications.filter((n) => Number(n.is_read) === 0).length;

  return (
    <>
      <AppShell
        user={user}
        activeTab={activeTab}
        onSelectTab={(tab) => {
          if (tab === 'staff_accounts') setOpsSection('staff');
          else if (tab === 'operations') setOpsSection('notices');
          setActiveTab(tab);
        }}
        permittedAddActions={permittedAddActions}
        onTriggerAddAction={handleTriggerAddAction}
        onOpenAddModal={() => setShowAddModal(true)}
        onSwitchMembership={handleSwitchMembership}
        onOpenAccountCenter={() => setShowAccountCenter(true)}
        onLogout={handleLogout}
        unreadNotifications={unreadNotifications}
        notifications={notifications}
        onMarkAllRead={handleMarkAllRead}
        darkMode={darkMode}
        onToggleDark={() => setDarkMode((v) => !v)}
        language={language}
        onChangeLanguage={setLanguage}
        pendingSyncCount={pendingSyncCount}
        onSyncNow={handleSyncNow}
        onOpenQueue={() => setShowOfflineQueue(true)}
        syncing={syncing}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
      >
        {(activeTab === 'overview' || activeTab === 'schools_admin') && (
          <RoleDashboard
            user={user}
            dashboard={dashboard}
            calendar={calendar}
            onNavigate={setActiveTab}
            onTriggerAdd={handleTriggerAddAction}
            onRefreshDashboard={() => loadDashboardAndNotifs(user)}
          />
        )}

        {(activeTab === 'global_feed' || activeTab === 'my_school' || activeTab === 'directory' || activeTab === 'profile') && (
          <SocialModule mode={activeTab} user={user} calendar={calendar} searchQuery={searchQuery} />
        )}

        {activeTab === 'students' && <StudentsModule user={user} searchQuery={searchQuery} calendar={calendar} />}

        {activeTab === 'academics' && <AcademicsModule user={user} calendar={calendar} />}

        {activeTab === 'learning_hub' && <CurriculumAssessmentModule user={user} calendar={calendar} />}

        {activeTab === 'payments' && <PaymentsHubModule user={user} calendar={calendar} />}

        {activeTab === 'automation_ai' && <AutomationAndAgentsModule user={user} calendar={calendar} />}

        {activeTab === 'trust_hub' && <GovernanceTrustModule user={user} calendar={calendar} />}

        {activeTab === 'ai_scanner' && <AIScannerModule />}

        {activeTab === 'messaging' && (
          <MessagingModule
            user={user}
            wsLastMessage={wsLastMessage}
            onSendWs={(msg) => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify(msg));
              }
            }}
          />
        )}

        {(activeTab === 'operations' || activeTab === 'staff_accounts') && (
          <OperationsModule
            user={user}
            calendar={calendar}
            initialSection={activeTab === 'staff_accounts' ? 'staff' : opsSection}
          />
        )}

        {activeTab === 'moderation' && <ModerationModule user={user} calendar={calendar} />}
      </AppShell>

      {(showAccountCenter || user.mustChangePassword) && (
        <AccountCenterModal
          user={user}
          profile={profile}
          forcedPasswordChange={user.mustChangePassword}
          language={language}
          calendar={calendar}
          darkMode={darkMode}
          onChangeLanguage={setLanguage}
          onChangeCalendar={setCalendar}
          onToggleDark={() => setDarkMode((v) => !v)}
          onUserUpdated={(updated) => setUser(updated)}
          onLogoutAll={handleLogoutAll}
          onClose={() => setShowAccountCenter(false)}
        />
      )}

      {showAddModal && (
        <UniversalAddModal
          actions={permittedAddActions}
          onSelectAction={(_act, tab, sec) => {
            if (sec) setOpsSection(sec);
            setActiveTab(tab);
            setShowAddModal(false);
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {showOfflineQueue && (
        <OfflineQueueModal
          syncing={syncing}
          onSyncNow={handleSyncNow}
          onQueueChanged={refreshPendingCount}
          onClose={() => setShowOfflineQueue(false)}
        />
      )}
    </>
  );
}
