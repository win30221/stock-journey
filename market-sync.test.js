const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = [
  'js/lib/constants.js',
  'js/lib/format.js',
  'js/lib/date.js',
  'js/lib/csv.js',
  'js/lib/storage.js',
  'js/domain/portfolio.js',
  'js/domain/retirement.js',
  'js/domain/dividends.js',
  'js/domain/market.js',
  'js/domain/backup.js',
  'js/repositories/browser.js',
  'js/services/finmind.js',
  'js/components/confirmation.js',
  'js/components/toast.js',
  'js/app/router.js',
  'app.js',
].map(file => {
  let contents = fs.readFileSync(file, 'utf8');
  if (file === 'js/lib/date.js') contents = contents.replace('function marketTargetDate', 'function resolveMarketTargetDate');
  return contents.replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
}).join('\n').replace(
  /\nload\(\);\s*$/,
  `\nglobalThis.__marketTest = {
    marketTargetDate, isWaitingForTodayClose, marketSyncPlan, symbolNeedsMarketSync, marketSyncSummary, isMarketAutoSyncPaused, marketCacheDisplayRows, trendDailySeries, trendChart, chartTooltip, normaliseTrendTooltipEventLimit, normaliseGainMilestoneInterval, trendSetFrequency, trendSelection, trendIndexAtClientX,
    setState(nextTransactions, nextCaches, nextTradingDates = []) {
      transactions = nextTransactions;
      marketCaches = nextCaches;
      marketTradingDates = nextTradingDates;
    },
    setPausedUntil(value) { settings = { ...settings, marketAutoSyncPausedUntil: value }; },
  };`,
);

const noop = () => {};
const sandbox = {
  console, Date, Intl, URL, URLSearchParams, Promise, Map, Set, Math, Number, String, Boolean,
  crypto: { randomUUID: () => 'test-id' },
  fetch: noop,
  navigator: {},
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  document: {
    querySelector: selector => selector === '#root' ? { innerHTML: '' } : null,
    querySelectorAll: () => [], addEventListener: noop, hidden: false,
  },
  window: { addEventListener: noop },
  setTimeout: noop,
  clearTimeout: noop,
};
vm.runInNewContext(source, sandbox, { filename: 'app.js' });
const market = sandbox.__marketTest;

assert.equal(market.normaliseTrendTooltipEventLimit(undefined), 3, '未設定 Tooltip 筆數時應使用預設 3 筆');
assert.equal(market.normaliseTrendTooltipEventLimit(99), 20, 'Tooltip 筆數應限制在設定範圍內');
assert.equal(market.normaliseGainMilestoneInterval(10000), 10000, '累積成果間隔應允許設定為 1 萬');
assert.equal(market.normaliseGainMilestoneInterval(0), 10000, '累積成果間隔不可低於 1 萬');

const chartRect = { left: 100, width: 500 };
assert.equal(market.trendIndexAtClientX(100, chartRect, 2, 1000), 0, '圖表左側應命中第一個資料點');
assert.equal(market.trendIndexAtClientX(330, chartRect, 2, 1000), 0, '兩點之間的左半部應維持在左側資料點');
assert.equal(market.trendIndexAtClientX(370, chartRect, 2, 1000), 1, '越過兩點中點後才應切換到右側資料點');
assert.equal(market.trendIndexAtClientX(600, chartRect, 2, 1000), 1, '圖表右側應命中最後一個資料點');

const tradingDates = ['2026-08-27', '2026-08-28', '2026-08-31', '2026-09-01'];
assert.equal(market.marketTargetDate(new Date('2026-08-31T02:00:00Z'), tradingDates), '2026-08-28', '盤中只使用上一交易日');
assert.equal(market.marketTargetDate(new Date('2026-08-31T10:01:00Z'), tradingDates), '2026-08-31', '18:00 後可期待當日資料');
assert.equal(market.marketTargetDate(new Date('2026-08-30T03:00:00Z'), tradingDates), '2026-08-28', '週末回到最近交易日');
assert.equal(market.marketTargetDate(new Date('2026-09-28T11:00:00Z'), ['2026-09-25']), '2026-09-25', '交易日曆可辨識國定假日');

market.setState([{ symbol: '0050', date: '2026-08-31' }], [], tradingDates);
const bootstrap = market.marketSyncPlan('0050', '2026-08-28');
assert.equal(bootstrap.priceStart, '2026-08-28', '今日才買進也要取得上一個完整收盤');
assert.equal(bootstrap.dividendStart, '2026-08-28');

const readyCache = {
  symbol: '0050', prices: [{ date: '2026-08-28', close: 100 }], dividends: [],
  priceCoverageFrom: '2026-08-28', priceCheckedThrough: '2026-08-28',
  dividendCoverageFrom: '2026-08-28', dividendCheckedThrough: '2026-08-28', syncErrors: [],
};
market.setState([{ symbol: '0050', date: '2026-08-31' }], [readyCache], tradingDates);
assert.equal(market.symbolNeedsMarketSync('0050', '2026-08-28'), false, '零配息但已檢查不應視為未同步');
assert.equal(market.symbolNeedsMarketSync('0050', '2026-08-31'), true, '新交易日只需增量更新');

market.setState([{ symbol: '0050', date: '2025-01-02' }], [{ ...readyCache, priceCoverageFrom: '2026-01-02' }], tradingDates);
assert.equal(market.marketSyncPlan('0050', '2026-08-31').priceStart, '2025-01-02', '補匯更早交易要回補歷史缺口');

market.setPausedUntil('2026-08-31T10:05:00.000Z');
assert.equal(market.isMarketAutoSyncPaused(new Date('2026-08-31T09:00:00.000Z')), true, '手動清除後、下次排程前應暫停自動重建');
assert.equal(market.isMarketAutoSyncPaused(new Date('2026-08-31T10:06:00.000Z')), false, '到下次排程後恢復自動同步');

const cachedOnly = { ...readyCache, symbol: '0056', name: '元大高股息' };
market.setState([{ symbol: '0050', date: '2026-08-31' }], [readyCache, cachedOnly], tradingDates);
const cacheRows = market.marketCacheDisplayRows(market.marketSyncSummary(new Date('2026-08-31T02:00:00Z')));
assert.deepEqual(Array.from(cacheRows, row=>row.symbol), ['0050', '0056'], '市場資料頁應完整列出快取，不受目前持股篩選');
assert.equal(cacheRows.find(row=>row.symbol==='0056').cachedOnly, true, '已刪除持股但仍存在的快取要標示為快取保留');
assert.match(cacheRows.find(row=>row.symbol==='0056').name, /無持股・快取保留/);

const trendTransactions = [
  { id:'t1', symbol:'0050', date:'2026-08-27', acquisitionType:'RECURRING_INVESTMENT', quantity:10, price:100, fee:0 },
  { id:'t2', symbol:'0050', date:'2026-08-28', acquisitionType:'MANUAL_BUY', quantity:1, price:110, fee:0 },
  { id:'t3', symbol:'2330', date:'2026-08-28', acquisitionType:'MANUAL_BUY', quantity:1, price:500, fee:0 },
];
const trendCaches = [
  { symbol:'0050', prices:[{date:'2026-08-27',close:105},{date:'2026-08-28',close:110}], dividends:[] },
  { symbol:'2330', prices:[{date:'2026-08-28',close:500}], dividends:[] },
];
market.setState(trendTransactions, trendCaches);
const trendRows = market.trendDailySeries();
assert.equal(trendRows.length, 2, '資產序列應保留兩個交易日');
assert.equal(trendRows[0].events[0].isNew, true, '股票第一筆取得紀錄應標記為首次持有');
assert.equal(trendRows[1].events.find(event=>event.symbol==='0050').isNew, false, '既有股票後續買進不應再次標記');
assert.equal(trendRows[1].events.find(event=>event.symbol==='2330').isNew, true, '同日新增的另一檔股票應標記');
assert.equal(trendRows[1].marketChange, 660, '應計算與前一個資產資料點的差額');
assert.equal(trendRows[0].marketChange, null, '第一個資料點沒有前期比較值');
const trendMarkup = market.trendChart();
assert.match(trendMarkup, /<button type="button" class="trend-event-marker/, '事件點應使用不受 SVG 比例拉伸的 HTML 圓形按鈕');
assert.doesNotMatch(trendMarkup, /<circle[^>]+trend-event-dot/, 'SVG 內不應再繪製會被拉成橢圓的事件圓點');
const manyEvents = Array.from({length:8},(_,index)=>({type:'MANUAL_BUY',label:'自行買進',symbol:'0050',quantity:index+1,amount:1000+index,isNew:false}));
const tooltipMarkup = market.chartTooltip({...trendRows[1],events:manyEvents,milestones:[{kind:'gain',label:'累積成果 100萬'}]});
assert.equal((tooltipMarkup.match(/class="trend-event-row/g)||[]).length, 3, 'Tooltip 預設只直接列出前三筆交易');
assert.match(tooltipMarkup, /查看全部 8 筆/, '超過顯示上限時，Tooltip 應提供完整明細入口');
assert.match(tooltipMarkup, /trend-milestone-banner is-gain/, '累積成果應使用獨立銀色樣式');

const longRangeTransactions = [
  { id:'t1', symbol:'0050', date:'2024-01-02', acquisitionType:'MANUAL_BUY', quantity:1, price:100, fee:0 },
  { id:'t2', symbol:'0050', date:'2025-09-01', acquisitionType:'MANUAL_BUY', quantity:1, price:100, fee:0 },
];
const longRangeCaches = [{
  symbol:'0050', prices:[
    { date:'2024-01-02', close:100 }, { date:'2025-08-29', close:100 },
    { date:'2025-09-01', close:100 }, { date:'2026-08-28', close:100 },
  ], dividends:[],
}];
market.setState(longRangeTransactions, longRangeCaches);
market.trendSetFrequency('day');
assert.deepEqual(
  Array.from(market.trendSelection().points, row=>row.date),
  ['2025-08-29', '2025-09-01', '2026-08-28'],
  '切換每日時，圖表應立刻套用 1 年區間，而不是沿用全部資料',
);

console.log('market sync scenarios: ok');
