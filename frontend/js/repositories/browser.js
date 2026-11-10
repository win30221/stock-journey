import { clearRecords, getAllRecords, removeRecord, removeRecords, replaceAllRecords, saveRecord, saveRecords } from '../lib/storage.js';

let cloudDataStore = null;

export function useCloudDataStore(store) {
  cloudDataStore = store;
}

export async function readLocalPersonalData() {
  const names = ['transactions', 'settings', 'budgetPlans', 'budgetItems'];
  const values = await Promise.all(names.map(name => getAllRecords(name)));
  return Object.fromEntries(names.map((name, index) => [name, values[index]]));
}

function createBrowserRepository(storeName) {
  const local = {
    list: () => getAllRecords(storeName),
    first: async () => (await getAllRecords(storeName))[0] || null,
    save: value => saveRecord(storeName, value),
    saveMany: values => saveRecords(storeName, values),
    remove: id => removeRecord(storeName, id),
    removeMany: ids => removeRecords(storeName, ids),
    clear: () => clearRecords(storeName),
  };
  return Object.freeze(Object.fromEntries(Object.keys(local).map(method => [method, (...args) => {
    if (cloudDataStore && storeName !== 'marketCache') return cloudDataStore.repository(storeName)[method](...args);
    return local[method](...args);
  }])));
}

// Only this file knows the IndexedDB store names. A future Next.js data adapter
// can implement the same repository methods with fetch/server actions instead.
export const transactionRepository = createBrowserRepository('transactions');
export const settingsRepository = createBrowserRepository('settings');
export const marketCacheRepository = createBrowserRepository('marketCache');
export const budgetPlanRepository = createBrowserRepository('budgetPlans');
export const budgetItemRepository = createBrowserRepository('budgetItems');

export function replaceBrowserData(data) {
  if (cloudDataStore) {
    return cloudDataStore.replace(data).then(() => clearRecords('marketCache'));
  }
  return replaceAllRecords({
    transactions:data.transactions || [],
    settings:data.settings || [],
    marketCache:data.marketCache || [],
    budgetPlans:data.budgetPlans || [],
    budgetItems:data.budgetItems || [],
  });
}
