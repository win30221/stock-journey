const assert=require('node:assert/strict');
const test=require('node:test');
const {createAppFixture}=require('./support/app-fixture.cjs');

test('trend history keeps transactions and payouts within the as-of date and aggregates monthly totals',async()=>{
  const {calculateTrendHistory,aggregateTrendMonths}=await import('../js/domain/trend.js');
  const txs=[{date:'2026-01-02',symbol:'0050',quantity:10,price:100,fee:0,acquisitionType:'MANUAL_BUY'},{date:'2026-01-09',symbol:'0050',quantity:2,price:110,fee:0,acquisitionType:'RECURRING_INVESTMENT'}];
  const rows=calculateTrendHistory({transactions:txs,marketCaches:[{symbol:'0050',prices:[{date:'2026-01-02',close:100},{date:'2026-01-09',close:110}],dividends:[{exDate:'2026-01-10',paymentDate:'2026-02-01',cash:1}]}],dateBasis:'PAYMENT_DATE',asOfDate:'2026-01-15'});
  assert.equal(rows.at(-1).date,'2026-01-09');assert.equal(rows.at(-1).market,1320);
  const monthly=aggregateTrendMonths(rows);assert.equal(monthly.length,1);assert.equal(monthly[0].dailyInvest,1220);assert.equal(monthly[0].transactions,2);assert.equal(monthly[0].dividends,0);
});

test('repeated chart lookups reuse history and invalidate after transactions, prices or settings change',t=>{
  const f=createAppFixture(t);
  f.run(`transactions=[{id:'t',date:'2026-01-02',symbol:'0050',quantity:10,price:100,fee:0,acquisitionType:'MANUAL_BUY'}];marketCaches=[{symbol:'0050',prices:[{date:'2026-01-02',close:100}],dividends:[]}];let calculations=0;const originalTrendHistory=calculateTrendHistory;calculateTrendHistory=inputs=>{calculations++;return originalTrendHistory(inputs);};`);
  for(let i=0;i<50;i++)f.run('trendDailySeries();trendSeries();trendSelection();');
  assert.equal(f.run('calculations'),1);
  f.run("marketCaches=[{...marketCaches[0],prices:[{date:'2026-01-02',close:120}]}];trendDailySeries();");
  assert.equal(f.run('calculations'),2);assert.equal(f.run('trendDailySeries().at(-1).market'),1200);
  f.run("settingsStore.replace({...settings,dividendDateBasis:'EX_DIVIDEND_DATE'});trendDailySeries();");assert.equal(f.run('calculations'),3);
  f.run('transactions=[...transactions,{...transactions[0],id:"t2",quantity:1}];trendDailySeries();');assert.equal(f.run('calculations'),4);
});
