function stockSearchText(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-Hant').replace(/\s+/g, '');
}

export function normaliseStockCatalog(rows = []) {
  const stocks = new Map();
  rows.forEach(row => {
    const symbol = String(row.symbol ?? row.stock_id ?? '').trim().toUpperCase();
    const name = String(row.name ?? row.stock_name ?? '').trim();
    if (!symbol || !name) return;
    const existing = stocks.get(symbol);
    stocks.set(symbol, {
      symbol,
      name,
      type: String(row.type ?? row.securityType ?? existing?.type ?? '').trim() || null,
    });
  });
  return [...stocks.values()].sort((a, b) => a.symbol.localeCompare(b.symbol, 'zh-Hant', { numeric:true }));
}

export function mergeStockCatalogs(...catalogs) {
  return normaliseStockCatalog(catalogs.flat());
}

export function searchStockCatalog(catalog, query, limit = 8) {
  const needle = stockSearchText(query);
  if (!needle) return [];
  return catalog
    .map(stock => {
      const symbol = stockSearchText(stock.symbol), name = stockSearchText(stock.name);
      const rank = symbol === needle ? 0 : name === needle ? 1 : symbol.startsWith(needle) ? 2 : name.startsWith(needle) ? 3 : symbol.includes(needle) ? 4 : name.includes(needle) ? 5 : 99;
      return { stock, rank };
    })
    .filter(result => result.rank < 99)
    .sort((a, b) => a.rank - b.rank || a.stock.symbol.localeCompare(b.stock.symbol, 'zh-Hant', { numeric:true }))
    .slice(0, Math.max(1, limit))
    .map(result => result.stock);
}

export function resolveStockQuery(catalog, query) {
  const needle = stockSearchText(query);
  if (!needle) return null;
  return catalog.find(stock => stockSearchText(stock.symbol) === needle)
    || catalog.find(stock => stockSearchText(stock.name) === needle)
    || null;
}
