const DB_NAME = "drawrace-ghosts";
const DB_VERSION = 1;
const STORE_NAME = "ghosts";

interface CachedGhost {
  ghost_id: string;
  blob: ArrayBuffer;
  time_ms: number;
  name: string;
  fetched_at: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "ghost_id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedGhost(ghostId: string): Promise<CachedGhost | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(ghostId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function putCachedGhost(ghost: CachedGhost): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(ghost);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function evictOldGhosts(maxCount: number = 500): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result as CachedGhost[];
      if (all.length <= maxCount) {
        resolve();
        return;
      }
      all.sort((a, b) => a.fetched_at - b.fetched_at);
      const toDelete = all.slice(0, all.length - maxCount);
      for (const g of toDelete) {
        store.delete(g.ghost_id);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}
