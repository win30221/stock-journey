const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { buildBundle } = require('../scripts/build-static.cjs');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const clone = value => JSON.parse(JSON.stringify(value));
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
const rawDividend = (cash, paymentDate = '2026-03-01') => ({
  CashEarningsDistribution:cash, StockEarningsDistribution:0,
  CashExDividendTradingDate:'2026-02-01', CashDividendPaymentDate:paymentDate,
  AnnouncementDate:'2026-01-01',
});
const oldDividend = {
  id:'old-event', cash:2, stock:0, exDate:'2026-02-01',
  paymentDate:'2026-03-01', announcementDate:'2026-01-01',
};
const transaction = {
  id:'tx-1', symbol:'0050', date:'2026-01-02', quantity:100,
  acquisitionType:'MANUAL_BUY', price:100, fee:0,
};

async function createHarness(t, { fetchData, beforeSave, splitData = async () => [] } = {}) {
  const storage = new Map(), timers = new Set(), listeners = new Map();
  const calls = [], writes = [], events = [], errors = [], alerts = [], notices = [];
  let fixedNow = '2026-09-04T12:00:00Z';
  const scheduled = [];
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [fixedNow])); }
    static now() { return Date.parse(fixedNow); }
  }
  const controls = new Map(['clearMarket', 'clearAll'].map(id => [id, {
    id, tagName:'BUTTON', disabled:false, isConnected:true,
    addEventListener(type, listener) { listeners.set(`${id}:${type}`, listener); },
  }]));
  const rootElement = { innerHTML:'', prepend() {} };
  const noop = () => {};
  const location = { protocol:'file:', hash:'#settings' };
  const sandbox = {
    console:{ log:noop, warn:noop, error:noop }, Date:FixedDate, Intl, URL, URLSearchParams,
    Promise, Map, Set, Math, Number, String, Boolean, Blob, AbortController,
    crypto:{ randomUUID:() => 'test-id' }, navigator:{ onLine:true }, location,
    history:{ replaceState:(_state, _title, hash) => { location.hash = hash; } },
    localStorage:{
      getItem:key => storage.get(key) ?? null,
      setItem:(key, value) => storage.set(key, value),
      removeItem:key => storage.delete(key),
    },
    document:{
      querySelector:selector => selector === '#root' ? rootElement : controls.get(selector.slice(1)) || null,
      querySelectorAll:() => [], addEventListener:noop, hidden:false,
    },
    window:{ addEventListener:noop },
    setTimeout:(callback, delay) => {
      const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
      timers.add(timer);
      scheduled.push({ timer, callback, delay });
      return timer;
    },
    clearTimeout:timer => { timers.delete(timer); clearTimeout(timer); },
    requestAnimationFrame:callback => callback(),
    alert:message => alerts.push(message),
    __beforeSave:beforeSave, __writes:writes, __events:events, __errors:errors, __notices:notices,
    fetch:async (url, options) => {
      const parsed = new URL(url);
      const call = { dataset:parsed.searchParams.get('dataset'), symbol:parsed.searchParams.get('data_id'), start:parsed.searchParams.get('start_date'), signal:options.signal };
      calls.push(call);
      return {
        ok:true,
        json:async () => ({ status:200, data:call.dataset === 'TaiwanStockSplitPrice' ? await splitData(call) : fetchData
          ? await fetchData(call)
          : call.dataset === 'TaiwanStockPrice' ? [{ date:'2026-09-04', close:110 }] : [] }),
      };
    },
  };
  const footer = `
    const lifecycleSchedule = scheduleMarketSyncCheck;
    render=()=>{};
    scheduleMarketSyncCheck=()=>{};
    toast=message=>globalThis.__notices.push(message);
    reportOperationError=error=>globalThis.__errors.push(error.message);
    confirmDestructive=async()=>true;
    const lifecycleSaveRecords=saveRecords;
    saveRecords=async(name,values)=>{
      if(globalThis.__beforeSave)await globalThis.__beforeSave(name,values);
      await lifecycleSaveRecords(name,values);
      globalThis.__writes.push({name,values});
      globalThis.__events.push('save:'+name);
    };
    const lifecycleClearRecords=clearRecords;
    clearRecords=async name=>{
      await lifecycleClearRecords(name);
      globalThis.__events.push('clear:'+name);
    };
    globalThis.__lifecycle={
      sync:syncMarket, restore, cancel:()=>marketTask.cancel(),
      autoSync:maybeAutoSyncMarket, schedule:lifecycleSchedule,
      async seed(txs,caches){
        settingsStore.replace(createDefaultSettings());
        await replaceBrowserData({transactions:txs,marketCache:caches,settings:[settings],budgetPlans:[{id:'default',source:'ITEMIZED',selectedTarget:'NEEDS_AND_WANTS',bufferRateBps:0}],budgetItems:[]});
        transactions=txs;marketCaches=caches;budgetPlans=await budgetPlanRepository.list();budgetItems=[];
        marketCalendarLoaded=true;marketTradingDates=['2026-09-04'];page='settings';bind();
      },
      read:name=>getAllRecords(name),
      defaults:createDefaultSettings,
      schemaVersion:BACKUP_SCHEMA_VERSION,
      state:()=>({busy:marketTask.busy,dataMaintenance,marketSyncInProgress}),
    };
  `;
  const bundle = buildBundle();
  assert.match(bundle, /\nload\(\);\s*$/);
  vm.runInNewContext(bundle.replace(/\nload\(\);\s*$/, footer), sandbox, { filename:'sync-lifecycle.bundle.js' });
  const api = sandbox.__lifecycle;
  t.after(async () => {
    await api.cancel();
    for (const timer of timers) clearTimeout(timer);
  });
  await api.seed([transaction], [{
    id:'finmind:0050', symbol:'0050', name:'測試股票',
    prices:[{ date:'2026-09-03', close:100 }], dividends:[oldDividend],
    priceCoverageFrom:'2026-01-02', priceCheckedThrough:'2026-09-03',
    dividendCoverageFrom:'2025-03-03', dividendCheckedThrough:'2026-09-03', syncErrors:[],
  }]);
  writes.length = 0;
  return {
    ...api, calls, writes, events, errors, alerts, notices, scheduled,
    setNow:value => { fixedNow = value; },
    read:async name => clone(await api.read(name)),
    click:id => {
      const listener = listeners.get(`${id}:click`);
      assert.equal(typeof listener, 'function', `${id} must have its real UI event handler`);
      return listener({ currentTarget:controls.get(id) });
    },
  };
}

test('late daily prices preserve old quotes and the scheduled retry fetches the missing date', async t => {
  let rows = [];
  const harness = await createHarness(t, { fetchData:async call => call.dataset === 'TaiwanStockPrice' ? rows : [] });
  harness.setNow('2026-09-04T09:30:00Z');
  await harness.autoSync();
  let [cache] = await harness.read('marketCache');
  assert.equal(cache.prices.at(-1).date, '2026-09-03');
  assert.equal(cache.priceCheckedThrough, '2026-09-03');
  assert.equal(cache.dividendCheckedThrough, '2026-09-04', '股息成功狀態獨立保存');
  assert.equal(cache.syncStatus, 'PARTIAL');
  assert.match(cache.syncErrors[0], /2026-09-04 收盤資料尚未取得/);
  assert.equal(cache.retryAfter, '2026-09-04T09:35:00.000Z');
  const priceCalls = () => harness.calls.filter(call => call.dataset === 'TaiwanStockPrice');
  await harness.autoSync();
  assert.equal(priceCalls().length, 1, '冷卻期間不重複查詢');
  harness.schedule();
  const retryTimer = harness.scheduled.at(-1);
  assert.equal(retryTimer.delay, 5 * 60000);
  rows = [{ date:'2026-09-04', close:110 }];
  harness.setNow('2026-09-04T09:35:00Z');
  clearTimeout(retryTimer.timer);
  await retryTimer.callback();
  [cache] = await harness.read('marketCache');
  assert.equal(priceCalls().length, 2);
  assert.equal(priceCalls().at(-1).start, '2026-09-04');
  assert.equal(cache.prices.length, 2);
  assert.equal(cache.priceCheckedThrough, '2026-09-04');
  assert.equal(cache.syncStatus, 'READY');
  assert.equal(cache.retryAfter, null);
  assert.equal(cache.retryCount, 0);
  assert.deepEqual(cache.syncErrors, []);
});

test('a response containing only older prices cannot mark the target day complete', async t => {
  const harness = await createHarness(t, { fetchData:async call => call.dataset === 'TaiwanStockPrice'
    ? [{ date:'2026-09-03', close:101 }] : [] });
  await harness.sync();
  const [cache] = await harness.read('marketCache');
  assert.equal(cache.prices.at(-1).close, 101, '保留來源對舊價格的修訂');
  assert.equal(cache.priceCheckedThrough, '2026-09-03');
  assert.equal(cache.syncStatus, 'PARTIAL');
  assert.ok(cache.retryAfter);
});

test('a zero quote remains pending and is replaced by a valid quote on retry', async t => {
  let close = 0;
  const harness = await createHarness(t, { fetchData:async call => call.dataset === 'TaiwanStockPrice'
    ? [{ date:'2026-09-04', close }] : [] });
  harness.setNow('2026-09-04T09:30:00Z');
  await harness.autoSync();
  let [cache] = await harness.read('marketCache');
  assert.equal(cache.priceCheckedThrough, '2026-09-03');
  assert.equal(cache.syncStatus, 'PARTIAL');
  assert.equal(cache.retryAfter, '2026-09-04T09:35:00.000Z');
  assert.equal(cache.prices.find(row => row.date === '2026-09-03').close, 100);
  close = 110;
  harness.setNow('2026-09-04T09:35:00Z');
  await harness.autoSync();
  [cache] = await harness.read('marketCache');
  assert.equal(cache.prices.length, 2);
  assert.equal(cache.prices.find(row => row.date === '2026-09-04').close, 110);
  assert.equal(cache.priceCheckedThrough, '2026-09-04');
  assert.equal(cache.syncStatus, 'READY');
  assert.equal(cache.retryAfter, null);
});

for (const failedDataset of ['TaiwanStockDividend', 'TaiwanStockSplitPrice']) {
  test(`missing weekend prices do not delay ${failedDataset} error retries`, async t => {
    let failing = true;
    const response = async call => {
      if (failing && call.dataset === failedDataset) throw Error('temporary outage');
      return [];
    };
    const harness = await createHarness(t, { fetchData:response, splitData:response });
    harness.setNow('2026-09-05T01:00:00Z');
    await harness.autoSync();
    let [cache] = await harness.read('marketCache');
    assert.equal(cache.syncErrors.length, 2);
    assert.equal(cache.retryAfter, '2026-09-05T01:05:00.000Z');
    harness.schedule();
    const timer = harness.scheduled.at(-1);
    assert.equal(timer.delay, 5 * 60000);
    failing = false;
    harness.setNow('2026-09-05T01:05:00Z');
    clearTimeout(timer.timer);
    await timer.callback();
    [cache] = await harness.read('marketCache');
    assert.equal(harness.calls.filter(call => call.dataset === failedDataset).length, 2);
    assert.equal(cache.syncErrors.length, 1, 'API 恢復後只剩缺價');
    assert.match(cache.syncErrors[0], /^價格：/);
    assert.equal(cache.retryAfter, '2026-09-07T09:30:00.000Z', '僅缺價時恢復下一個平日排程');
  });
}

test('a stock without quotes waits for the next boundary when a retry would cross midnight', async t => {
  const harness = await createHarness(t, { fetchData:async () => [] });
  harness.setNow('2026-09-04T15:58:00Z');
  await harness.sync();
  const [cache] = await harness.read('marketCache');
  assert.equal(cache.syncStatus, 'PARTIAL');
  assert.equal(cache.retryAfter, '2026-09-07T09:30:00.000Z');
  assert.equal(cache.priceCheckedThrough, '2026-09-03');
});

test('first sync with no prices keeps price coverage unconfirmed', async t => {
  const harness = await createHarness(t, { fetchData:async () => [] });
  await harness.seed([transaction], []);
  await harness.sync();
  const [cache] = await harness.read('marketCache');
  assert.equal(cache.priceCheckedThrough, null);
  assert.equal(cache.syncStatus, 'ERROR');
  assert.ok(cache.retryAfter);
});

test('automatic sync repairs caches previously marked complete with only yesterday quotes', async t => {
  const harness = await createHarness(t);
  await harness.seed([transaction], [{
    id:'finmind:0050', symbol:'0050', name:'測試股票',
    prices:[{ date:'2026-09-03', close:100 }], dividends:[], splits:[],
    priceCoverageFrom:'2026-01-02', priceCheckedThrough:'2026-09-04',
    dividendCoverageFrom:'2025-03-03', dividendCheckedThrough:'2026-09-04',
    splitCheckedThrough:'2026-09-04', syncStatus:'READY', syncErrors:[],
  }]);
  await harness.autoSync();
  const [cache] = await harness.read('marketCache');
  assert.equal(cache.prices.at(-1).date, '2026-09-04');
  assert.equal(cache.syncStatus, 'READY');
  const prices = harness.calls.filter(call => call.dataset === 'TaiwanStockPrice');
  assert.equal(prices.length, 1);
  assert.equal(prices[0].start, '2026-09-04');
  assert.equal(harness.calls.some(call => call.dataset === 'TaiwanStockDividend'), false);
});

test('sync replaces corrected dividend announcements and removes a cancelled snapshot', async t => {
  let snapshot = [rawDividend(3, '2026-03-02')];
  const harness = await createHarness(t, { fetchData:async call => call.dataset === 'TaiwanStockDividend'
    ? snapshot : [{ date:'2026-09-04', close:110 }] });
  await harness.sync();
  let [cache] = await harness.read('marketCache');
  assert.equal(cache.dividends.length, 1);
  assert.equal(cache.dividends[0].cash, 3);
  assert.equal(cache.dividends[0].paymentDate, '2026-03-02');
  assert.ok(cache.dividendCoverageFrom <= '2025-09-04');
  snapshot = [];
  await harness.sync();
  [cache] = await harness.read('marketCache');
  assert.deepEqual(cache.dividends, []);
  assert.equal(cache.dividendCheckedThrough, '2026-09-04');
  assert.deepEqual(harness.errors, []);
});

test('clearing market cache cancels both response bodies before clearing and does not write them back', async t => {
  const body = deferred(), started = deferred();
  let requests = 0;
  const harness = await createHarness(t, { fetchData:async () => {
    if (++requests === 2) started.resolve();
    return body.promise;
  } });
  const sync = harness.sync();
  await started.promise;
  await harness.click('clearMarket');
  await sync;
  assert.equal(harness.calls.filter(call => call.dataset !== 'TaiwanStockSplitPrice').length, 2);
  assert.ok(harness.calls.filter(call => call.dataset !== 'TaiwanStockSplitPrice').every(call => call.signal.aborted));
  assert.deepEqual(await harness.read('marketCache'), []);
  const [settings] = await harness.read('settings');
  assert.ok(settings.marketAutoSyncPausedUntil);
  assert.equal(settings.lastSuccessfulMarketSyncDate, null);
  body.resolve([rawDividend(99)]);
  await nextTurn();
  assert.deepEqual(await harness.read('marketCache'), []);
  assert.equal(harness.writes.filter(write => write.name === 'marketCache').length, 0);
  assert.deepEqual(harness.errors, []);
});

test('restoring a backup during sync cancels stale data and retains the restored transactions and settings', async t => {
  const body = deferred(), started = deferred();
  let requests = 0;
  const harness = await createHarness(t, { fetchData:async () => {
    if (++requests === 2) started.resolve();
    return body.promise;
  } });
  const sync = harness.sync();
  await started.promise;
  const restoredTransaction = { ...transaction, id:'restored-tx', symbol:'2330', quantity:7 };
  const payload = {
    schemaVersion:harness.schemaVersion, transactions:[restoredTransaction],
    settings:{ ...harness.defaults(), retirementOtherMonthlyIncome:3456 },
    budgetPlans:[{ id:'default', source:'ITEMIZED', selectedTarget:'NEEDS_AND_WANTS', bufferRateBps:0 }], budgetItems:[],
  };
  await harness.restore({ text:async () => JSON.stringify(payload) });
  await sync;
  body.resolve([rawDividend(99)]);
  await nextTurn();
  assert.deepEqual(harness.alerts, []);
  assert.ok(harness.calls.filter(call => call.dataset !== 'TaiwanStockSplitPrice').every(call => call.signal.aborted));
  assert.deepEqual((await harness.read('transactions')).map(row => [row.id,row.symbol,row.quantity]), [['restored-tx','2330',7]]);
  assert.equal((await harness.read('settings'))[0].retirementOtherMonthlyIncome, 3456);
  assert.equal((await harness.read('settings'))[0].lastSuccessfulMarketSyncDate, null);
  assert.deepEqual(await harness.read('marketCache'), []);
  assert.equal(harness.writes.filter(write => write.name === 'marketCache').length, 0);
  assert.deepEqual(harness.errors, []);
});

test('clearing all data during sync prevents an old request from repopulating the cleared portfolio', async t => {
  const body = deferred(), started = deferred();
  let requests = 0;
  const harness = await createHarness(t, { fetchData:async () => {
    if (++requests === 2) started.resolve();
    return body.promise;
  } });
  const sync = harness.sync();
  await started.promise;
  await harness.click('clearAll');
  await sync;
  body.resolve([]);
  await nextTurn();
  assert.ok(harness.calls.filter(call => call.dataset !== 'TaiwanStockSplitPrice').every(call => call.signal.aborted));
  assert.deepEqual(await harness.read('transactions'), []);
  assert.deepEqual(await harness.read('marketCache'), []);
  assert.equal((await harness.read('settings'))[0].lastSuccessfulMarketSyncDate, null);
  assert.deepEqual(harness.errors, []);
});

test('data replacement waits for an already-started repository write and then clears its result', async t => {
  const write = deferred(), started = deferred();
  t.after(() => write.resolve());
  const harness = await createHarness(t, { beforeSave:async name => {
    if (name === 'marketCache') { started.resolve(); await write.promise; }
  } });
  const sync = harness.sync();
  await started.promise;
  let clearFinished = false;
  const clear = harness.click('clearMarket').then(() => { clearFinished = true; });
  await nextTurn();
  assert.equal(clearFinished, false);
  assert.ok(!harness.events.includes('clear:marketCache'));
  assert.equal(harness.state().dataMaintenance, true);
  write.resolve();
  await Promise.all([sync, clear]);
  assert.ok(harness.events.indexOf('save:marketCache') < harness.events.indexOf('clear:marketCache'));
  assert.deepEqual(await harness.read('marketCache'), []);
  assert.ok((await harness.read('settings'))[0].marketAutoSyncPausedUntil);
  assert.equal(harness.state().busy, false);
  assert.deepEqual(harness.errors, []);
});

test('sync records exact split ratios, replaces corrected snapshots and retains old events on failure', async t => {
  let splitRows=[{stock_id:'0050',date:'2026-06-18',before_price:188.65,after_price:47.16}], failed=false;
  const harness=await createHarness(t,{splitData:async()=>{
    if(failed)throw Error('分割服務無法連線');
    return splitRows;
  }});
  await harness.sync();
  let [cache]=await harness.read('marketCache');
  assert.equal(cache.splits[0].ratio,4);
  assert.equal(cache.splitCheckedThrough,'2026-09-04');
  failed=true;
  await harness.sync();
  [cache]=await harness.read('marketCache');
  assert.equal(cache.splits[0].ratio,4);
  assert.match(cache.splitError,/FinMind 回傳格式無法解析/);
  assert.equal(cache.syncStatus,'PARTIAL');
  assert.equal(cache.prices.at(-1).close,110,'price updates remain independent');
  failed=false;splitRows=[];
  await harness.sync();
  [cache]=await harness.read('marketCache');
  assert.deepEqual(cache.splits,[],'cancelled events disappear after successful full refresh');
  assert.equal(cache.splitError,null);
  assert.equal(cache.syncStatus,'READY');
});

test('clearing data during split-list loading cancels it before any cache can be committed', async t => {
  const pending=deferred(), started=deferred();
  const harness=await createHarness(t,{splitData:async()=>{started.resolve();return pending.promise;}});
  const sync=harness.sync();
  await started.promise;
  await harness.click('clearMarket');
  await sync;
  assert.ok(harness.calls.find(call=>call.dataset==='TaiwanStockSplitPrice').signal.aborted);
  pending.resolve([{stock_id:'0050',date:'2026-06-18',before_price:188.65,after_price:47.16}]);
  await nextTurn();
  assert.deepEqual(await harness.read('marketCache'),[]);
  assert.equal(harness.writes.filter(write=>write.name==='marketCache').length,0);
});
