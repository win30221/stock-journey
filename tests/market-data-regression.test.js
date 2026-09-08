const assert = require('node:assert/strict');
const test = require('node:test');

test('a new holding fetches dividends from before its purchase for the trailing-year forecast', async () => {
  const { createMarketSyncPlan } = await import('../js/domain/market.js');
  const { calculateProjectedAnnualDividends } = await import('../js/domain/dividends.js');
  const target = '2026-09-04';
  const plan = createMarketSyncPlan({ transactionStart:'2026-09-01', target });
  const history = [{ cash:2, exDate:'2026-02-01', paymentDate:'2026-03-01' }];
  const fetched = history.filter(row => row.exDate >= plan.dividendStart);
  const forecast = calculateProjectedAnnualDividends({
    transactions:[{ symbol:'0050', date:'2026-09-01', quantity:100 }],
    marketCaches:[{ symbol:'0050', dividends:fetched, dividendCoverageFrom:plan.dividendStart, dividendCheckedThrough:target }],
    asOfDate:target,
  });
  assert.equal(plan.priceStart, '2026-09-01');
  assert.ok(plan.dividendStart <= '2025-09-04');
  assert.equal(forecast.annual, 200);
  assert.equal(forecast.coverageComplete, true);
});

test('dividend sync upgrades a recent-purchase cache and refreshes the entire required history', async () => {
  const { createMarketSyncPlan } = await import('../js/domain/market.js');
  const recentCache = {
    priceCoverageFrom:'2026-09-01', priceCheckedThrough:'2026-09-04',
    dividendCoverageFrom:'2026-09-01', dividendCheckedThrough:'2026-09-04',
  };
  const repair = createMarketSyncPlan({ cache:recentCache, transactionStart:'2026-09-01', target:'2026-09-04' });
  assert.equal(repair.priceNeeded, false);
  assert.equal(repair.dividendNeeded, true);
  assert.ok(repair.dividendStart < recentCache.dividendCoverageFrom);
  const older = createMarketSyncPlan({
    cache:{ ...recentCache, dividendCoverageFrom:'2019-01-02' },
    transactionStart:'2019-01-02', target:'2026-09-07',
  });
  assert.equal(older.dividendStart, '2019-01-02');
  assert.equal(older.dividendNeeded, true);
});

test('a corrected dividend amount retains its event identity', async () => {
  const { dividendKey, mergeRows } = await import('../js/domain/market.js');
  const original = { exDate:'2026-02-01', paymentDate:'2026-03-01', announcementDate:'2026-01-01', cash:2, stock:0 };
  const corrected = { ...original, cash:3 };
  const events = mergeRows([original], [corrected], dividendKey);
  assert.equal(events.length, 1);
  assert.equal(events[0].cash, 3);
  assert.equal(dividendKey({ ...original, id:'event-1' }), dividendKey({ ...corrected, id:'event-1', paymentDate:'2026-03-02' }));
});

test('dividend forecasts distinguish absent coverage, covered zero dividends, and weekend freshness', async () => {
  const { calculateProjectedAnnualDividends } = await import('../js/domain/dividends.js');
  const transactions = [{ symbol:'0050', date:'2026-09-01', quantity:100 }];
  const missing = calculateProjectedAnnualDividends({ transactions, marketCaches:[], asOfDate:'2026-09-06' });
  assert.equal(missing.annual, 0);
  assert.equal(missing.coverageComplete, false);
  assert.deepEqual(missing.incompleteSymbols, ['0050']);
  const cache = { symbol:'0050', dividends:[], dividendCoverageFrom:'2025-03-03', dividendCheckedThrough:'2026-09-04' };
  const covered = calculateProjectedAnnualDividends({ transactions, marketCaches:[cache], asOfDate:'2026-09-06', requiredThroughDate:'2026-09-04' });
  assert.equal(covered.annual, 0);
  assert.equal(covered.coverageComplete, true);
  assert.deepEqual(covered.incompleteSymbols, []);
  const stale = calculateProjectedAnnualDividends({ transactions, marketCaches:[cache], asOfDate:'2026-09-07' });
  assert.equal(stale.coverageComplete, false);
});

test('forecast coverage checks every current holding without requiring future holdings', async () => {
  const { calculateProjectedAnnualDividends } = await import('../js/domain/dividends.js');
  const forecast = calculateProjectedAnnualDividends({
    transactions:[
      { symbol:'0050', date:'2026-09-01', quantity:100 },
      { symbol:'2330', date:'2026-09-02', quantity:10 },
      { symbol:'0056', date:'2027-01-01', quantity:10 },
    ],
    marketCaches:[{ symbol:'0050', dividends:[], dividendCoverageFrom:'2025-01-01', dividendCheckedThrough:'2026-09-04' }],
    asOfDate:'2026-09-04',
  });
  assert.deepEqual(forecast.incompleteSymbols, ['2330']);
  assert.deepEqual(forecast.coverage.map(row => row.symbol), ['0050', '2330']);
});

test('completed dividend months do not repeat or skip at month-end boundaries', async () => {
  const { summarizeDividends } = await import('../js/domain/dividends.js');
  const transactions = [{ date:'2026-05-01' }];
  const summary = summarizeDividends([], transactions, new Date(2026, 8, 6), '2026-09-06');
  assert.deepEqual(summary.months, ['2026-05', '2026-06', '2026-07', '2026-08']);
  const january = summarizeDividends([], [{ date:'2025-11-01' }], new Date(2026, 0, 3), '2026-01-03');
  assert.deepEqual(january.months, ['2025-11', '2025-12']);
  const leapYear = summarizeDividends([], [{ date:'2024-01-01' }], new Date(2024, 3, 1), '2024-04-01');
  assert.deepEqual(leapYear.months, ['2024-01', '2024-02', '2024-03']);
});

test('FinMind timeout includes response-body delivery after headers arrive', async t => {
  const { fetchFinMindData } = await import('../js/services/finmind.js');
  let signal;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    signal = options.signal;
    return { ok:true, json:() => new Promise(() => {}) };
  });
  await assert.rejects(() => fetchFinMindData('TaiwanStockInfo', null, null, undefined, { timeoutMs:5 }), /連線逾時/);
  assert.equal(signal.aborted, true);
});

test('FinMind accepts external cancellation while reading the body', async t => {
  const { fetchFinMindData } = await import('../js/services/finmind.js');
  const controller = new AbortController();
  let readingBody;
  const bodyStarted = new Promise(resolve => { readingBody = resolve; });
  let requestSignal;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requestSignal = options.signal;
    return { ok:true, json:() => { readingBody(); return new Promise(() => {}); } };
  });
  const pending = fetchFinMindData('TaiwanStockInfo', null, null, undefined, { signal:controller.signal });
  await bodyStarted;
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(requestSignal.aborted, true);
});

test('FinMind skips the network for an already-cancelled request', async t => {
  const { fetchFinMindData } = await import('../js/services/finmind.js');
  const controller = new AbortController();
  controller.abort();
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw Error('should not fetch'); });
  await assert.rejects(() => fetchFinMindData('TaiwanStockInfo', null, null, undefined, { signal:controller.signal }), error => error.name === 'AbortError');
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('FinMind rejects malformed datasets rather than treating them as a zero-dividend snapshot', async t => {
  const { fetchFinMindData } = await import('../js/services/finmind.js');
  t.mock.method(globalThis, 'fetch', async () => ({ ok:true, json:async () => ({ status:200, data:null }) }));
  await assert.rejects(() => fetchFinMindData('TaiwanStockDividend'), /資料集合格式錯誤/);
});

test('FinMind preserves a valid empty snapshot and quota errors', async t => {
  const { fetchFinMindData } = await import('../js/services/finmind.js');
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => ++requests === 1
    ? { ok:true, json:async () => ({ status:200, data:[] }) }
    : { ok:false, status:402, json:async () => { throw Error('invalid response body'); } });
  assert.deepEqual(await fetchFinMindData('TaiwanStockDividend'), []);
  await assert.rejects(() => fetchFinMindData('TaiwanStockDividend'), /免費 API 額度已用完/);
});
