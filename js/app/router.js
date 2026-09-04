export const PAGE_IDS = Object.freeze([
  'overview',
  'budget',
  'retirement-calculator',
  'transactions',
  'dividends',
  'market-data',
  'settings',
]);

const pageSet = new Set(PAGE_IDS);

export function isPageId(value) {
  return pageSet.has(value);
}

export function pageFromHash(hash = '') {
  const candidate = String(hash).replace(/^#/, '').trim();
  return isPageId(candidate) ? candidate : 'overview';
}

export function hashForPage(page) {
  return `#${isPageId(page) ? page : 'overview'}`;
}
