// IndexedDB Offline Cache & Mutation Sync Queue for ShikshyaPlus PWA

const DB_NAME = 'shikshyaplus_offline_v1';
const DB_VERSION = 1;
const CACHE_STORE = 'query_cache';
const QUEUE_STORE = 'sync_queue';

export interface QueuedMutation {
  id: string;
  url: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body: unknown;
  label: string;
  createdAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function cacheQueryResult(key: string, data: unknown): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put({ key, data, updatedAt: new Date().toISOString() });
  } catch {
    // Ignore storage quota or SSR errors
  }
}

export async function getCachedQueryResult<T>(key: string): Promise<{ data: T; updatedAt: string } | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const req = tx.objectStore(CACHE_STORE).get(key);
      req.onsuccess = () => resolve((req.result as { data: T; updatedAt: string }) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function enqueueOfflineMutation(mutation: Omit<QueuedMutation, 'id' | 'createdAt'>): Promise<QueuedMutation> {
  const item: QueuedMutation = {
    ...mutation,
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  try {
    const db = await openDb();
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    tx.objectStore(QUEUE_STORE).put(item);
  } catch {
    // Ignore
  }
  return item;
}

export async function getPendingQueue(): Promise<QueuedMutation[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(QUEUE_STORE, 'readonly');
      const req = tx.objectStore(QUEUE_STORE).getAll();
      req.onsuccess = () => resolve((req.result as QueuedMutation[]) || []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function removeQueuedMutation(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(QUEUE_STORE, 'readwrite');
    tx.objectStore(QUEUE_STORE).delete(id);
  } catch {
    // Ignore
  }
}

export async function clearOfflineCache(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction([CACHE_STORE, QUEUE_STORE], 'readwrite');
    tx.objectStore(CACHE_STORE).clear();
    tx.objectStore(QUEUE_STORE).clear();
  } catch {
    // Ignore
  }
}
