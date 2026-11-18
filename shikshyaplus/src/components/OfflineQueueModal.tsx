import React, { useEffect, useState } from 'react';
import { RefreshCw, Trash2, WifiOff, X } from 'lucide-react';
import { getPendingQueue, removeQueuedMutation, type QueuedMutation } from '../lib/offlineDb';

interface OfflineQueueModalProps {
  syncing: boolean;
  onSyncNow: () => Promise<void>;
  onQueueChanged: () => Promise<void>;
  onClose: () => void;
}

export const OfflineQueueModal: React.FC<OfflineQueueModalProps> = ({
  syncing,
  onSyncNow,
  onQueueChanged,
  onClose,
}) => {
  const [items, setItems] = useState<QueuedMutation[]>([]);
  const [loading, setLoading] = useState(true);

  const loadQueue = async () => {
    setLoading(true);
    try {
      const q = await getPendingQueue();
      setItems(q);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQueue();
  }, []);

  const handleDeleteItem = async (id: string) => {
    await removeQueuedMutation(id);
    await loadQueue();
    await onQueueChanged();
  };

  const handleClearAll = async () => {
    for (const item of items) {
      await removeQueuedMutation(item.id);
    }
    await loadQueue();
    await onQueueChanged();
  };

  const handleSync = async () => {
    await onSyncNow();
    await loadQueue();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <WifiOff className="h-4 w-4 text-cyan-600" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Offline Sync Queue</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close offline queue"
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Changes saved while offline are stored locally in IndexedDB and transmitted automatically once connectivity resumes.
        </p>

        <div className="mt-4 flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {loading ? (
            <p className="py-6 text-center text-xs text-slate-500">Loading queued mutations...</p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">All offline changes have synced with the server.</p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900 dark:text-white truncate">{item.label}</div>
                  <div className="font-mono text-[11px] text-slate-500 truncate">
                    {item.method} {item.url} · {new Date(item.createdAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleDeleteItem(item.id)}
                  aria-label={`Remove ${item.label}`}
                  className="rounded-lg p-2 text-slate-400 hover:text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          {items.length > 0 ? (
            <button
              type="button"
              onClick={handleClearAll}
              className="rounded-lg border border-red-200 dark:border-red-900 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              Discard All ({items.length})
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 dark:border-slate-700 px-4 py-2 text-xs font-semibold"
            >
              Close
            </button>
            {items.length > 0 && (
              <button
                type="button"
                disabled={syncing || !navigator.onLine}
                onClick={handleSync}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E36] dark:bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
