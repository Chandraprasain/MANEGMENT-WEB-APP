import {
  cacheQueryResult,
  enqueueOfflineMutation,
  getCachedQueryResult,
  getPendingQueue,
  removeQueuedMutation,
} from './offlineDb';

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  fromCache?: boolean;
  cachedAt?: string;
  queuedOffline?: boolean;
  error?: { code: string; details: unknown };
}

export async function apiGet<T = unknown>(endpoint: string, cacheKey?: string): Promise<ApiResponse<T>> {
  const key = cacheKey || `get:${endpoint}`;
  try {
    const res = await fetch(`/api/v1${endpoint}`, { credentials: 'include' });
    const json = (await res.json()) as ApiResponse<T>;
    if (res.ok && json.success) {
      await cacheQueryResult(key, json.data);
    }
    return json;
  } catch {
    const cached = await getCachedQueryResult<T>(key);
    if (cached) {
      return {
        success: true,
        data: cached.data,
        fromCache: true,
        cachedAt: cached.updatedAt,
      };
    }
    return {
      success: false,
      message: 'Offline and no cached data available for this section yet.',
      error: { code: 'OFFLINE_NO_CACHE', details: null },
    };
  }
}

export async function apiMutate<T = unknown>(
  endpoint: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
  options?: { queueIfOffline?: boolean; offlineLabel?: string }
): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`/api/v1${endpoint}`, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json()) as ApiResponse<T>;
    return json;
  } catch {
    if (options?.queueIfOffline) {
      await enqueueOfflineMutation({
        url: `/api/v1${endpoint}`,
        method,
        body,
        label: options.offlineLabel || endpoint,
      });
      return {
        success: true,
        queuedOffline: true,
        message: 'Saved offline. It will sync automatically once your connection returns.',
      };
    }
    return {
      success: false,
      message: 'Network unavailable. Please check your connection and try again.',
      error: { code: 'NETWORK_ERROR', details: null },
    };
  }
}

export async function syncOfflineQueue(): Promise<{ synced: number; failed: number }> {
  if (!navigator.onLine) return { synced: 0, failed: 0 };
  const pending = await getPendingQueue();
  let synced = 0;
  let failed = 0;
  for (const item of pending) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: item.body !== undefined ? JSON.stringify(item.body) : undefined,
      });
      if (res.ok || res.status < 500) {
        await removeQueuedMutation(item.id);
        synced += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    }
  }
  return { synced, failed };
}
