import { clearRecords, getAllRecords, removeRecord, removeRecords, replaceAllRecords, saveRecord, saveRecords } from '../lib/storage.js';

function createBrowserRepository(storeName) {
  return Object.freeze({
    list: () => getAllRecords(storeName),
    first: async () => (await getAllRecords(storeName))[0] || null,
    save: value => saveRecord(storeName, value),
    saveMany: values => saveRecords(storeName, values),
    remove: id => removeRecord(storeName, id),
    removeMany: ids => removeRecords(storeName, ids),
    clear: () => clearRecords(storeName),
  });
}

// Only this file knows the IndexedDB store names. A future Next.js data adapter
// can implement the same repository methods with fetch/server actions instead.
export const transactionRepository = createBrowserRepository('transactions');
export const settingsRepository = createBrowserRepository('settings');
export const marketCacheRepository = createBrowserRepository('marketCache');
export const budgetPlanRepository = createBrowserRepository('budgetPlans');
export const budgetItemRepository = createBrowserRepository('budgetItems');

export function replaceBrowserData(data) {
  return replaceAllRecords({
    transactions:data.transactions || [],
    settings:data.settings || [],
    marketCache:data.marketCache || [],
    budgetPlans:data.budgetPlans || [],
    budgetItems:data.budgetItems || [],
  });
}
