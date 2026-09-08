import { escapeHtml } from '../lib/format.js';
import { mergeStockCatalogs, normaliseStockCatalog, resolveStockQuery, searchStockCatalog } from '../domain/stock-catalog.js';
import { fetchFinMindData } from '../services/finmind.js';

const STOCK_CATALOG_CACHE_KEY = 'stock-journey-stock-catalog-v1';
const STOCK_CATALOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function createStockSearch({
  getMarketCaches,
  isTransactionModalOpen,
  document = globalThis.document,
  getStorage = () => globalThis.localStorage,
  fetchData = fetchFinMindData,
} = {}) {
  let stockCatalog = [], stockCatalogStatus = 'idle', stockCatalogError = '';
  let stockCatalogRequest = null, activeStockSuggestion = -1;

  function knownStockCatalog() {
    const cached = getMarketCaches().filter(row => row.name)
      .map(row => ({ symbol:row.symbol, name:row.name, type:row.securityType }));
    return mergeStockCatalogs(cached);
  }

  function readStockCatalogCache() {
    try {
      const cached = JSON.parse(getStorage()?.getItem(STOCK_CATALOG_CACHE_KEY) || 'null');
      if (!cached?.savedAt || Date.now() - new Date(cached.savedAt).getTime() > STOCK_CATALOG_MAX_AGE_MS) return [];
      return normaliseStockCatalog(cached.rows);
    } catch { return []; }
  }

  function saveStockCatalogCache(rows) {
    try {
      getStorage()?.setItem(STOCK_CATALOG_CACHE_KEY, JSON.stringify({ savedAt:new Date().toISOString(), rows }));
    } catch {}
  }

  function setStockCatalog(rows, persist = true) {
    stockCatalog = mergeStockCatalogs(rows, knownStockCatalog());
    if (persist && stockCatalog.length) saveStockCatalogCache(stockCatalog);
    return stockCatalog;
  }

  async function ensureStockCatalog() {
    if (stockCatalogRequest) return stockCatalogRequest;
    if (stockCatalogStatus === 'ready') return stockCatalog;
    if (!stockCatalog.length) setStockCatalog(readStockCatalogCache(), false);
    stockCatalogStatus = stockCatalog.length ? 'ready' : 'loading';
    refreshStockCombobox();
    stockCatalogRequest = (async () => {
      try {
        const rows = await fetchData('TaiwanStockInfo');
        setStockCatalog(rows);
        stockCatalogStatus = 'ready';
        stockCatalogError = '';
      } catch (error) {
        stockCatalogStatus = stockCatalog.length ? 'ready' : 'error';
        stockCatalogError = error.message || '股票清單載入失敗';
      } finally {
        stockCatalogRequest = null;
        if (isTransactionModalOpen()) refreshStockCombobox();
      }
      return stockCatalog;
    })();
    return stockCatalogRequest;
  }

  function stockSuggestionRows(query) { return searchStockCatalog(stockCatalog, query, 8); }
  function stockTypeLabel(type) {
    return ({ twse:'上市', tpex:'上櫃', emerging:'興櫃' })[String(type || '').toLowerCase()] || type || '';
  }

  function refreshStockCombobox() {
    const input = document.querySelector('#transactionSymbol');
    updateStockCombobox(input?.value || '', input?.getAttribute('aria-expanded') === 'true');
  }

  function setActiveStockSuggestion(index) {
    const input = document.querySelector('#transactionSymbol');
    const options = [...document.querySelectorAll('[data-stock-suggestion]')];
    if (!input || !options.length) {
      activeStockSuggestion = -1;
      input?.removeAttribute('aria-activedescendant');
      return;
    }
    activeStockSuggestion = Math.max(0, Math.min(index, options.length - 1));
    options.forEach((option, optionIndex) => {
      const active = optionIndex === activeStockSuggestion;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-selected', String(active));
    });
    const active = options[activeStockSuggestion];
    input.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView?.({ block:'nearest' });
  }

  function closeStockSuggestions() {
    const input = document.querySelector('#transactionSymbol');
    const list = document.querySelector('#transactionStockSuggestions');
    if (list) list.hidden = true;
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    activeStockSuggestion = -1;
  }

  function chooseStockSuggestion(stock) {
    const input = document.querySelector('#transactionSymbol');
    const help = document.querySelector('#transactionStockHelp');
    if (!input || !stock) return;
    input.value = stock.symbol;
    input.removeAttribute('aria-invalid');
    if (help) help.textContent = `已選擇 ${stock.name}（${stock.symbol}）`;
    closeStockSuggestions();
    input.focus();
  }

  function updateStockCombobox(query, open = false) {
    const input = document.querySelector('#transactionSymbol');
    const list = document.querySelector('#transactionStockSuggestions');
    const help = document.querySelector('#transactionStockHelp');
    if (!input || !list) return;
    const value = String(query || '').trim(), rows = stockSuggestionRows(value);
    activeStockSuggestion = -1;
    input.removeAttribute('aria-activedescendant');
    if (!value) {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      if (help) help.textContent = stockCatalogStatus === 'loading' ? '正在載入台股代號與名稱…' : '可輸入中文名稱或股票代號搜尋。';
      return;
    }
    if (rows.length) {
      list.innerHTML = rows.map((stock, index) => `<button type="button" role="option" tabindex="-1" id="transactionStockOption${index}" data-stock-suggestion="${index}" aria-selected="false"><b>${escapeHtml(stock.symbol)}</b><span>${escapeHtml(stock.name)}</span>${stock.type ? `<small>${escapeHtml(stockTypeLabel(stock.type))}</small>` : ''}</button>`).join('');
      if (help) help.textContent = stockCatalogStatus === 'loading' ? '先顯示已快取結果；完整清單載入中…' : `找到 ${rows.length} 筆最相關結果。`;
    } else {
      const message = stockCatalogStatus === 'loading' ? '正在載入完整股票清單…'
        : stockCatalogStatus === 'error' ? '完整清單暫時無法載入；你仍可直接輸入股票代號。'
        : '找不到符合的股票；可換個名稱或直接輸入代號。';
      list.innerHTML = `<div class="stock-suggestion-status" role="option" aria-disabled="true">${escapeHtml(message)}</div>`;
      if (help) help.textContent = stockCatalogError && stockCatalogStatus === 'error' ? '股票清單連線失敗，仍可直接輸入代號。' : message;
    }
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    list.querySelectorAll('[data-stock-suggestion]').forEach((option, index) => {
      option.addEventListener('mousedown', event => event.preventDefault());
      option.addEventListener('click', () => chooseStockSuggestion(rows[index]));
    });
  }

  function bindStockCombobox() {
    const input = document.querySelector('#transactionSymbol');
    if (!input) return;
    input.addEventListener('input', () => updateStockCombobox(input.value, true));
    input.addEventListener('focus', () => updateStockCombobox(input.value, true));
    input.addEventListener('keydown', event => {
      const options = [...document.querySelectorAll('[data-stock-suggestion]')];
      if (event.key === 'ArrowDown' && options.length) {
        event.preventDefault();
        setActiveStockSuggestion(activeStockSuggestion + 1);
      } else if (event.key === 'ArrowUp' && options.length) {
        event.preventDefault();
        setActiveStockSuggestion(activeStockSuggestion < 0 ? options.length - 1 : activeStockSuggestion - 1);
      } else if (event.key === 'Enter' && activeStockSuggestion >= 0) {
        event.preventDefault();
        chooseStockSuggestion(stockSuggestionRows(input.value)[activeStockSuggestion]);
      } else if (event.key === 'Escape' && !document.querySelector('#transactionStockSuggestions')?.hidden) {
        event.preventDefault();
        closeStockSuggestions();
      }
    });
    input.addEventListener('blur', () => setTimeout(() => {
      if (document.querySelector('#transactionSymbol') === input) closeStockSuggestions();
    }, 120));
  }

  return {
    bind: bindStockCombobox,
    ensureCatalog: ensureStockCatalog,
    setCatalog(rows) {
      const result = setStockCatalog(rows);
      stockCatalogStatus = 'ready';
      stockCatalogError = '';
      if (isTransactionModalOpen()) refreshStockCombobox();
      return result;
    },
    refreshKnownCatalog() { stockCatalog = mergeStockCatalogs(stockCatalog, knownStockCatalog()); },
    resolve(query) { return resolveStockQuery(stockCatalog, query); },
  };
}
