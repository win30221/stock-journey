// The backend is selected once per page session. A transient IndexedDB failure
// after that is surfaced instead of silently splitting data across two stores.
const DB_NAME = 'stock-retirement-dashboard';
const DB_VERSION = 2;
const LOCAL_PREFIX = 'srd-file-fallback:';
const STORE_NAMES = ['transactions', 'settings', 'marketCache', 'budgetPlans', 'budgetItems'];
let databasePromise = null;
let backendPromise = null;

function localKey(name) { return LOCAL_PREFIX + name; }
function localRead(name) {
  const raw = localStorage.getItem(localKey(name));
  if (raw == null) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) throw Error('collection is not an array');
    return value;
  } catch (error) {
    throw Error(`本機「${name}」資料已損壞，系統已停止讀取以避免覆蓋原始內容`, { cause:error });
  }
}
function localWrite(name, value) { localStorage.setItem(localKey(name), JSON.stringify(value)); }
function canUseIndexedDb() { return typeof indexedDB !== 'undefined' && globalThis.location?.protocol !== 'file:'; }

function openDb() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of STORE_NAMES) if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath:'id' });
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => { database.close(); databasePromise = null; backendPromise = null; };
      resolve(database);
    };
    request.onerror = () => { databasePromise = null; reject(request.error); };
  });
  return databasePromise;
}

async function storageBackend() {
  if (!backendPromise) backendPromise = canUseIndexedDb() ? openDb().then(() => 'indexeddb', () => 'local') : Promise.resolve('local');
  return backendPromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || Error('IndexedDB transaction aborted'));
  });
}

async function indexedTransaction(storeNames, mode, action) {
  const database = await openDb();
  const transaction = database.transaction(storeNames, mode);
  const result = action(transaction);
  await transactionDone(transaction);
  return result;
}

export async function getAllRecords(name) {
  if (await storageBackend() === 'local') return localRead(name);
  const database = await openDb();
  return requestResult(database.transaction(name, 'readonly').objectStore(name).getAll());
}

export async function saveRecords(name, values) {
  if (await storageBackend() === 'local') {
    const rows = localRead(name);
    const byId = new Map(rows.map(row => [row.id, row]));
    values.forEach(value => byId.set(value.id, value));
    localWrite(name, [...byId.values()]);
    return;
  }
  await indexedTransaction([name], 'readwrite', transaction => values.forEach(value => transaction.objectStore(name).put(value)));
}

export async function saveRecord(name, value) { return saveRecords(name, [value]); }

export async function removeRecords(name, ids) {
  if (await storageBackend() === 'local') {
    const removed = new Set(ids);
    localWrite(name, localRead(name).filter(row => !removed.has(row.id)));
    return;
  }
  await indexedTransaction([name], 'readwrite', transaction => ids.forEach(id => transaction.objectStore(name).delete(id)));
}

export async function removeRecord(name, id) { return removeRecords(name, [id]); }

export async function clearRecords(name) {
  if (await storageBackend() === 'local') { localStorage.removeItem(localKey(name)); return; }
  await indexedTransaction([name], 'readwrite', transaction => transaction.objectStore(name).clear());
}

export async function replaceAllRecords(recordsByStore) {
  const names = Object.keys(recordsByStore);
  if (names.some(name => !STORE_NAMES.includes(name))) throw Error('Unknown storage collection');
  if (await storageBackend() === 'local') {
    const previous = new Map(names.map(name => [name, localStorage.getItem(localKey(name))]));
    const serialized = new Map(names.map(name => [name, JSON.stringify(recordsByStore[name])]));
    try { names.forEach(name => localStorage.setItem(localKey(name), serialized.get(name))); }
    catch (error) {
      names.forEach(name => { const value=previous.get(name); if (value == null) localStorage.removeItem(localKey(name)); else localStorage.setItem(localKey(name), value); });
      throw error;
    }
    return;
  }
  await indexedTransaction(names, 'readwrite', transaction => names.forEach(name => {
    const store = transaction.objectStore(name);
    store.clear();
    recordsByStore[name].forEach(value => store.put(value));
  }));
}
