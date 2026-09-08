const assert = require('node:assert/strict');
const test = require('node:test');

function emptyDocument() {
  return { querySelector:() => null, querySelectorAll:() => [] };
}

test('stock search imports as a native module and shares an in-flight catalog request', async () => {
  const { createStockSearch } = await import('../js/app/stock-search.js');
  let requests = 0, finishRequest;
  let marketCaches = [{ symbol:'0050', name:'元大台灣50', securityType:'twse' }];
  const saved = new Map();
  const search = createStockSearch({
    getMarketCaches:() => marketCaches,
    isTransactionModalOpen:() => false,
    document:emptyDocument(),
    getStorage:() => ({ getItem:key => saved.get(key), setItem:(key,value) => saved.set(key,value) }),
    fetchData:dataset => {
      assert.equal(dataset, 'TaiwanStockInfo');
      requests++;
      return new Promise(resolve => { finishRequest = resolve; });
    },
  });
  const first = search.ensureCatalog();
  const second = search.ensureCatalog();
  assert.equal(requests, 1);
  assert.equal(search.resolve('元大台灣50').symbol, '0050', 'cached holdings are usable before the full catalog arrives');
  finishRequest([{ stock_id:'2330', stock_name:'台積電', type:'twse' }]);
  const responses = await Promise.all([first, second]);
  assert.ok(responses.every(rows => rows.some(row => row.symbol === '2330')), 'every waiting caller receives the completed catalog');
  assert.equal(search.resolve('台積電').symbol, '2330');
  assert.equal(search.resolve('0050').name, '元大台灣50');
  assert.equal(saved.size, 1);
  marketCaches = [...marketCaches, { symbol:'0056', name:'元大高股息' }];
  search.refreshKnownCatalog();
  assert.equal(search.resolve('元大高股息').symbol, '0056');
  await search.ensureCatalog();
  assert.equal(requests, 1, 'a ready catalog does not trigger another request');
});

test('stock search keeps valid cached results when the network and storage writes fail', async () => {
  const { createStockSearch } = await import('../js/app/stock-search.js');
  const cached = JSON.stringify({ savedAt:new Date().toISOString(), rows:[{ symbol:'2330', name:'台積電' }] });
  const search = createStockSearch({
    getMarketCaches:() => [],
    isTransactionModalOpen:() => false,
    document:emptyDocument(),
    getStorage:() => ({ getItem:() => cached, setItem:() => { throw Error('quota'); } }),
    fetchData:async () => { throw Error('offline'); },
  });
  await search.ensureCatalog();
  assert.equal(search.resolve('台積電').symbol, '2330');
  assert.doesNotThrow(() => search.setCatalog([{ symbol:'0050', name:'元大台灣50' }]));
  assert.equal(search.resolve('元大台灣50').symbol, '0050');
});

test('editing a stock query clears a stale active option and exposes escaped suggestions', async () => {
  const { createStockSearch } = await import('../js/app/stock-search.js');
  const attributes = new Map(), listeners = new Map();
  const input = {
    value:'',
    addEventListener:(name, handler) => listeners.set(name, handler),
    setAttribute:(name, value) => attributes.set(name, value),
    getAttribute:name => attributes.get(name),
    removeAttribute:name => attributes.delete(name),
  };
  const list = { hidden:true, innerHTML:'', querySelectorAll:() => [] };
  const help = { textContent:'' };
  const elements = { '#transactionSymbol':input, '#transactionStockSuggestions':list, '#transactionStockHelp':help };
  const search = createStockSearch({
    getMarketCaches:() => [],
    isTransactionModalOpen:() => true,
    document:{ querySelector:selector => elements[selector] || null, querySelectorAll:() => [] },
    getStorage:() => null,
  });
  search.setCatalog([{ symbol:'2330', name:'台積電 <測試>' }]);
  search.bind();
  input.value = '台積電';
  attributes.set('aria-activedescendant', 'transactionStockOption7');
  listeners.get('input')();
  assert.equal(attributes.has('aria-activedescendant'), false);
  assert.equal(attributes.get('aria-expanded'), 'true');
  assert.equal(list.hidden, false);
  assert.match(list.innerHTML, /台積電 &lt;測試&gt;/);
  assert.match(help.textContent, /找到 1 筆/);
  input.value = '';
  listeners.get('input')();
  assert.equal(attributes.get('aria-expanded'), 'false');
  assert.equal(list.hidden, true);
});
