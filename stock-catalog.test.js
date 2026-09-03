const assert = require('node:assert/strict');
const test = require('node:test');

test('stock catalog normalises FinMind rows and removes duplicate symbols', async () => {
  const { normaliseStockCatalog } = await import('./js/domain/stock-catalog.js');
  const rows = normaliseStockCatalog([
    { stock_id:'2330', stock_name:'台積電', type:'twse' },
    { stock_id:'00878', stock_name:'國泰永續高股息', type:'twse' },
    { stock_id:'2330', stock_name:'台積電', type:'twse' },
    { stock_id:'', stock_name:'無效資料' },
  ]);

  assert.deepEqual(rows.map(row => row.symbol), ['00878','2330']);
  assert.equal(rows[1].name, '台積電');
});

test('stock search matches Chinese names and symbols with useful ranking', async () => {
  const { searchStockCatalog } = await import('./js/domain/stock-catalog.js');
  const catalog = [
    { symbol:'2330', name:'台積電' },
    { symbol:'2337', name:'旺宏' },
    { symbol:'00878', name:'國泰永續高股息' },
    { symbol:'00922', name:'國泰台灣領袖50' },
  ];

  assert.deepEqual(searchStockCatalog(catalog,'國泰').map(row => row.symbol), ['00878','00922']);
  assert.deepEqual(searchStockCatalog(catalog,'233').map(row => row.symbol), ['2330','2337']);
  assert.equal(searchStockCatalog(catalog,'台積電')[0].symbol, '2330');
});

test('exact Chinese stock name resolves to the stored stock symbol', async () => {
  const { resolveStockQuery } = await import('./js/domain/stock-catalog.js');
  const catalog = [{ symbol:'2330', name:'台積電' },{ symbol:'00878', name:'國泰永續高股息' }];

  assert.equal(resolveStockQuery(catalog,' 台積電 ').symbol, '2330');
  assert.equal(resolveStockQuery(catalog,'00878').name, '國泰永續高股息');
  assert.equal(resolveStockQuery(catalog,'國泰'), null);
});
