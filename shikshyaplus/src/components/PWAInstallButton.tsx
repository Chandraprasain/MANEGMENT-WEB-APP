import React, { useState } from 'react';
import { Download, RefreshCw, WifiOff, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);
  const [hidden, setHidden] = useState<boolean>(
    () => typeof window !== 'undefined' && localStorage.getItem('sp_hide_install_prompt') === '1'
  );

  if (isInstalled || hidden) return null;

  if (isInstallable) {
    return (
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={install}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{compact ? 'Install' : 'Install App'}</span>
        </button>
        {!compact && (
          <button
            type="button"
            onClick={() => {
              localStorage.setItem('sp_hide_install_prompt', '1');
              setHidden(true);
            }}
            className="text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 underline px-1.5"
          >
            Don&apos;t show again
          </button>
        )}
      </div>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0 min-h-[40px]"
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Install App</span>
        </button>
        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
            <div className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">Install on iPhone or iPad</h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Close install instructions"
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <ol className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-300 list-decimal pl-5">
                <li>Tap the <strong>Share</strong> icon in your Safari toolbar.</li>
                <li>Scroll down and choose <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong> to enable offline workspace access.</li>
              </ol>
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem('sp_hide_install_prompt', '1');
                    setHidden(true);
                    setShowIOSGuide(false);
                  }}
                  className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Don&apos;t show again
                </button>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="flex-1 rounded-lg bg-slate-900 dark:bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-slate-800 dark:hover:bg-blue-700"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineStatusBanner: React.FC<{
  pendingSyncCount: number;
  onSyncNow: () => void;
  onOpenQueue?: () => void;
  syncing: boolean;
}> = ({ pendingSyncCount, onSyncNow, onOpenQueue, syncing }) => {
  const isOnline = useOnlineStatus();

  if (isOnline && pendingSyncCount === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs font-medium border-b ${
        !isOnline
          ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-800'
          : 'bg-cyan-50 dark:bg-cyan-950/50 text-cyan-900 dark:text-cyan-200 border-cyan-200 dark:border-cyan-800'
      }`}
    >
      <div className="flex items-center gap-2">
        <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          {!isOnline
            ? 'Offline mode active — viewing cached school workspace. New drafts will queue and sync when online.'
            : `${pendingSyncCount} offline change${pendingSyncCount === 1 ? '' : 's'} ready to sync with your school server.`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {pendingSyncCount > 0 && onOpenQueue && (
          <button
            type="button"
            onClick={onOpenQueue}
            className="rounded-md border border-current px-2.5 py-1 text-xs font-medium hover:opacity-80"
          >
            Manage Queue ({pendingSyncCount})
          </button>
        )}
        {isOnline && pendingSyncCount > 0 && (
          <button
            type="button"
            onClick={onSyncNow}
            disabled={syncing}
            className="inline-flex items-center gap-1.5 rounded-md bg-cyan-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-cyan-800 disabled:opacity-60"
          >
            <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
          </button>
        )}
      </div>
    </div>
  );
};
