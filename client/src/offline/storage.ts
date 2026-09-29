// A tiny key-value store in IndexedDB for the offline copy and waiting transactions.
// IndexedDB can be missing or refuse to open (private windows, blocked site data), so
// every call swallows errors: the app then works as before, just without an offline copy.

const DB_NAME = 'flybudget-offline';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        const db = req.result;
        // The browser can close the connection (site data cleared, or a newer version
        // opened elsewhere): open again next time instead of failing from then on
        const reopen = () => {
          dbPromise = null;
        };
        db.onclose = reopen;
        db.onversionchange = () => {
          db.close();
          reopen();
        };
        resolve(db);
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  op: (s: IDBObjectStore) => IDBRequest,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(STORE, mode);
          const req = op(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(req.result as T);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export const readValue = <T>(key: string) => run<T>('readonly', (s) => s.get(key));
export const writeValue = (key: string, value: unknown) =>
  run('readwrite', (s) => s.put(value, key)).then(() => undefined);
export const deleteValue = (key: string) =>
  run('readwrite', (s) => s.delete(key)).then(() => undefined);

/**
 * Reads and rewrites one value in a single transaction. IndexedDB runs overlapping
 * read-write transactions one after another, even across tabs, so no change is lost.
 */
export function updateValue<T>(
  key: string,
  fn: (current: T | undefined) => T,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const tx = db.transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          let next: T | undefined;
          const req = store.get(key);
          req.onsuccess = () => {
            next = fn(req.result as T | undefined);
            store.put(next, key);
          };
          tx.oncomplete = () => resolve(next);
          tx.onerror = () => resolve(undefined);
          tx.onabort = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

/** Whether this browser lets FlyBudget store anything (false in some private windows) */
export const storageWorks = () => openDb().then((db) => db !== null);
