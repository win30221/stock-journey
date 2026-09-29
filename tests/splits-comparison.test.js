const assert = require('node:assert/strict');
const test = require('node:test');
const { createAppFixture } = require('./support/app-fixture.cjs');
const tx = (date, quantity = 100, price = 100) => ({ id:date, symbol:'0050', date, quantity, price, fee:0, acquisitionType:'MANUAL_BUY' });
const event = (date, ratio) => ({ date, ratio, type:ratio > 1 ? '分割' : '反分割' });
const quote = (date, close) => ({ date, close });
const cache = (overrides = {}) => ({ symbol:'0050', name:'測試 ETF', splits:[event('2026-06-02', 4)], splitCheckedThrough:'2026-09-07', prices:[quote('2026-06-01',100),quote('2026-06-02',25),quote('2026-06-03',30)], dividends:[], dividendCoverageFrom:'2025-01-01', dividendCheckedThrough:'2026-09-07', ...overrides });

test('rounded reference prices resolve exact ratios; invalid or ambiguous events fail closed', async () => {
  const { referenceSplitRatio, normaliseSplitEvents } = await import('../js/domain/splits.js');
  assert.equal(referenceSplitRatio(188.65,47.16),4);
  assert.equal(referenceSplitRatio(443.15,20.14),22);
  assert.equal(referenceSplitRatio(2.04,12.23),1/6);
  assert.equal(referenceSplitRatio(90.6,36.24),2.5);
  assert.equal(referenceSplitRatio(0,25),null);
  assert.equal(referenceSplitRatio(1,0.01),null, 'many possible ratios must not be guessed');
  const rows = [{stock_id:'0050',date:'2026-06-02',before_price:100,after_price:25}];
  assert.equal(normaliseSplitEvents([...rows,...rows], '0050','2026-06-03').length,1);
  assert.deepEqual(normaliseSplitEvents(rows,'0050','2026-06-01'),[]);
  assert.throws(()=>normaliseSplitEvents([{...rows[0],after_price:0}],'0050','2026-06-03'),/無法確認/);
  assert.throws(()=>normaliseSplitEvents([...rows,{...rows[0],after_price:50}],'0050','2026-06-03'),/衝突/);
});

test('holdings, individual lots, price basis and asset history stay consistent over a split', async () => {
  const {calculatePortfolioSnapshot} = await import('../js/app/portfolio-model.js');
  const {calculateTrendHistory} = await import('../js/domain/trend.js');
  const {splitAdjustedQuantity} = await import('../js/domain/splits.js');
  const transactions = [tx('2026-06-01'),tx('2026-06-02',20,25)];
  const caches = [cache()];
  const original = JSON.stringify({transactions,caches});
  const snapshot = calculatePortfolioSnapshot({transactions,marketCaches:caches,dividendDateBasis:'PAYMENT_DATE',asOfDate:'2026-06-03'});
  assert.equal(snapshot.holdings[0].qty,420);
  assert.equal(snapshot.holdings[0].acquisition,10500);
  assert.equal(snapshot.holdings[0].avg,25);
  assert.equal(snapshot.metrics.market,12600);
  assert.equal(splitAdjustedQuantity(transactions[0],caches[0].splits,'2026-06-03'),400);
  assert.equal(splitAdjustedQuantity(transactions[1],caches[0].splits,'2026-06-03'),20);
  const history = calculateTrendHistory({transactions,marketCaches:caches,dateBasis:'PAYMENT_DATE',asOfDate:'2026-06-03'});
  assert.deepEqual(history.map(row=>row.market),[10000,10500,12600]);
  assert.equal(history[1].dailyInvest,500,'only real purchase increases external investment');
  assert.equal(history[1].splits.length,1);
  assert.equal(JSON.stringify({transactions,caches}),original);
  const stale = calculatePortfolioSnapshot({transactions:[transactions[0]],marketCaches:[cache({prices:[quote('2026-06-01',100)]})],dividendDateBasis:'PAYMENT_DATE',asOfDate:'2026-06-03'});
  assert.equal(stale.metrics.market,10000,'stale quote uses the same denomination as current quantity');
});

test('multiple splits and reverse splits preserve cost, including fractional equivalent shares', async () => {
  const {calculateHoldingGroups} = await import('../js/domain/portfolio.js');
  const {calculateTrendHistory,aggregateTrendMonths} = await import('../js/domain/trend.js');
  const c = cache({splits:[event('2026-06-02',4),event('2026-06-03',1/7)],prices:[quote('2026-06-01',100),quote('2026-06-02',25),quote('2026-06-03',175)]});
  const transactions = [tx('2026-06-01')];
  const group = calculateHoldingGroups(transactions,[c],'2026-06-03')[0];
  assert.ok(Math.abs(group.qty - 400/7)<1e-10);
  assert.equal(group.acquisition,10000);
  const daily = calculateTrendHistory({transactions,marketCaches:[c],dateBasis:'PAYMENT_DATE',asOfDate:'2026-06-03'});
  assert.ok(daily.every(row=>Math.abs(row.market-10000)<1e-8));
  assert.equal(aggregateTrendMonths(daily)[0].splits.length,2);
});

test('dividends use ex-date denomination, payment date does not change entitlement, forecast normalises old DPS', async () => {
  const {calculateDividendReceipts,calculateProjectedAnnualDividends} = await import('../js/domain/dividends.js');
  const dividends = [
    {exDate:'2026-06-01',paymentDate:'2026-06-10',cash:4},
    {exDate:'2026-06-02',paymentDate:'2026-06-10',cash:1},
    {exDate:'2026-06-03',paymentDate:'2026-06-10',cash:1},
  ];
  const c=cache({prices:[quote('2026-05-29',100),...cache().prices],dividends});
  const input={transactions:[tx('2026-05-29')],marketCaches:[c],dateBasis:'PAYMENT_DATE'};
  assert.deepEqual(calculateDividendReceipts(input).map(row=>row.amount),[400,400,400]);
  const forecast=calculateProjectedAnnualDividends({...input,asOfDate:'2026-06-10'});
  assert.equal(forecast.annual,1200);
  assert.deepEqual(forecast.rows.map(row=>row.cash),[1,1,1]);
  const laterBuyer=calculateDividendReceipts({...input,transactions:[tx('2026-06-02',100,25)]});
  assert.equal(laterBuyer.length,1);
  assert.equal(laterBuyer[0].amount,100);
});

test('comparison starts at a shared zero, adjusts splits and leaves missing dates as gaps', async () => {
  const {calculateStockComparison} = await import('../js/domain/comparison.js');
  const other=cache({symbol:'2330',splits:[],prices:[quote('2026-06-01',100),quote('2026-06-03',110)]});
  const r=calculateStockComparison({symbols:['0050','2330'],marketCaches:[cache(),other],startDate:'2026-05-30',endDate:'2026-06-05'});
  assert.equal(r.actualStart,'2026-06-01');assert.equal(r.actualEnd,'2026-06-03');
  assert.deepEqual(r.series[0].values.map(x=>Math.round(x)),[0,0,20]);
  assert.equal(r.series[1].values[1],null);
  assert.equal(r.series[1].missing,1);
  assert.ok(Math.abs(r.series[1].change-10)<1e-8);
  assert.equal(r.series[0].events.length,1);
  assert.throws(()=>calculateStockComparison({symbols:['0050','2330'],marketCaches:[cache({splitError:'offline'}),other],startDate:'2026-06-01',endDate:'2026-06-03'}),/分割資料尚未確認/);
  assert.throws(()=>calculateStockComparison({symbols:['0050','0050'],marketCaches:[],startDate:'2026-06-01',endDate:'2026-06-03'}),/不同股票/);
});

test('existing transaction and market views use corrected quantities and split-day change', t => {
  const f=createAppFixture(t);
  f.run(`transactions=${JSON.stringify([tx('2026-06-01')])}; marketCaches=${JSON.stringify([cache({prices:[quote('2026-06-01',100),quote('2026-06-02',25)]})])};`);
  assert.equal(f.run('transactionGroups()[0].quantity'),400);
  assert.equal(f.run('transactionReturn(transactions[0]).percent'),0);
  assert.equal(f.run('groupReturn(transactionGroups()[0]).percent'),0);
  assert.match(f.run('marketDataPage()'),/0\.00%/);
  assert.match(f.run('transactionsPage()'),/調整後 400 股/);
  assert.equal(f.run('projectionInput().currentAssets'),10000);
});

async function comparisonHarness(t, fetchData) {
  const {createComparisonPage} = await import('../js/app/comparison-page.js');
  const f=createAppFixture(t);
  for (const id of ['comparisonQuery','comparisonAdd','comparisonSuggestions','comparisonStart','comparisonEnd','comparisonForm']) f.element(id);
  const catalog=[{symbol:'0050',name:'元大台灣50'},{symbol:'2330',name:'台積電'}];
  const search={suggestions:q=>catalog.filter(s=>s.symbol.includes(q)||s.name.includes(q)),resolve:q=>catalog.find(s=>s.symbol===q||s.name===q),getStatus:()=>({status:'ready'}),ensureCatalog:async()=>catalog};
  const page=createComparisonPage({stockSearch:search,fetchData,getCaches:()=>[],getTargetDate:()=> '2026-06-03',repaint:()=>{},isActive:()=>true,document:f.doc});
  page.render();page.bind();
  function add(query) { const input=f.nodes.get('#comparisonQuery');input.value=query;input.fire('input');f.nodes.get('#comparisonAdd').fire('click'); }
  function date(id,value) {const node=f.nodes.get('#'+id);node.value=value;node.fire('change');}
  add('0050');add('台積電');date('comparisonStart','2026-06-01');date('comparisonEnd','2026-06-03');
  return {page,add,date,f};
}

test('comparison UI fetches unheld stocks, reuses session prices and reports split-service errors', async t => {
  let fail=false;
  const calls=[];
  const h=await comparisonHarness(t, async (dataset,symbol) => {
    calls.push({dataset,symbol});
    if(dataset==='TaiwanStockSplitPrice') {
      if(fail) throw Error('分割服務暫時不可用');
      return [{stock_id:'0050',date:'2026-06-02',before_price:100,after_price:25}];
    }
    return symbol==='0050'?cache().prices:[quote('2026-06-01',100),quote('2026-06-02',105),quote('2026-06-03',110)];
  });
  await h.page.compare();
  assert.match(h.page.render(),/\+20\.00%/);
  assert.doesNotMatch(h.page.render(),/個百分點/);
  assert.equal(calls.filter(c=>c.dataset==='TaiwanStockPrice').length,2);
  await h.page.compare();
  assert.equal(calls.filter(c=>c.dataset==='TaiwanStockPrice').length,2);
  fail=true;await h.page.compare();
  assert.match(h.page.render(),/分割服務暫時不可用/);
  assert.doesNotMatch(h.page.render(),/comparison-summary/,'failed verification must not leave a valid-looking chart');
});

test('comparison cancels obsolete work on edits and clears session data on reset', async t => {
  let release, captured;
  const h=await comparisonHarness(t, async (dataset,symbol,start,end,options) => {
    captured=options.signal;
    await new Promise(resolve=>{release=resolve;});
    return [];
  });
  const pending=h.page.compare();
  await new Promise(resolve=>setImmediate(resolve));
  h.date('comparisonStart','2026-05-01');
  assert.equal(captured.aborted,true);
  release();await pending;
  assert.doesNotMatch(h.page.render(),/comparison-summary/);
  await h.page.reset();
  assert.match(h.page.render(),/0 \/ 5/);
  assert.doesNotMatch(h.page.render(),/data-remove-comparison/);
});

test('comparison missing quotes, duplicates and sixth selection provide recoverable errors', async t => {
  const h=await comparisonHarness(t, async()=>[]);
  h.add('0050');assert.match(h.page.render(),/已在比較清單/);
  h.add('0056');h.add('00878');h.add('00631L');h.add('00632R');
  assert.match(h.page.render(),/最多比較 5 檔/);
  await h.page.compare();
  assert.match(h.page.render(),/沒有可用價格/);
});

test('floating tooltip tracks dates, clamps within chart, supports touch/keyboard and hides on exit', async t => {
  const h=await comparisonHarness(t, async (dataset,symbol) => dataset==='TaiwanStockSplitPrice'
    ? [{stock_id:'0050',date:'2026-06-02',before_price:100,after_price:25}]
    : symbol==='0050'?cache().prices:[quote('2026-06-01',100),quote('2026-06-02',105),quote('2026-06-03',110)]);
  await h.page.compare();
  assert.match(h.page.render(),/class="comparison-tooltip"[^>]*hidden/);
  const chart=h.f.element('comparisonChart');
  chart.getBoundingClientRect=()=>({left:0,width:340});
  const tooltip=h.f.element('comparisonFocus');
  tooltip.hidden=true;tooltip.style={};tooltip.getBoundingClientRect=()=>({width:235});
  const cursor=h.f.element('comparisonCursor');
  h.page.bind();
  chart.fire('pointermove',{pointerType:'mouse',clientX:170});
  assert.equal(tooltip.hidden,false);
  assert.match(tooltip.innerHTML,/2026-06-02/);
  assert.match(tooltip.innerHTML,/\+5\.00%/);
  assert.ok(parseFloat(tooltip.style.left)>=4 && parseFloat(tooltip.style.left)<=101);
  assert.equal(cursor.getAttribute('visibility'),'visible');
  chart.fire('pointerleave',{pointerType:'mouse'});
  assert.equal(tooltip.hidden,true);
  chart.fire('pointerdown',{pointerType:'touch',clientX:330});
  assert.equal(tooltip.hidden,false);
  assert.match(tooltip.innerHTML,/2026-06-03/);
  chart.fire('keydown',{key:'Home'});assert.match(tooltip.innerHTML,/2026-06-01/);
  chart.fire('keydown',{key:'ArrowRight'});assert.match(tooltip.innerHTML,/2026-06-02/);
  chart.fire('keydown',{key:'Escape'});assert.equal(tooltip.hidden,true);
  chart.fire('focus');assert.equal(tooltip.hidden,false);
  chart.fire('blur');assert.equal(tooltip.hidden,true);
});

test('retirement forecast is incomplete until split data is verified, even with full dividend history', async () => {
  const {calculateProjectedAnnualDividends} = await import('../js/domain/dividends.js');
  const input={transactions:[tx('2026-06-01')],marketCaches:[cache({splitCheckedThrough:null})],asOfDate:'2026-09-07'};
  assert.equal(calculateProjectedAnnualDividends(input).coverageComplete,false);
  input.marketCaches=[cache()];
  assert.equal(calculateProjectedAnnualDividends(input).coverageComplete,true);
});

test('zero trade quotes and unheld split events cannot introduce an artificial asset drop', async () => {
  const {calculatePortfolioSnapshot} = await import('../js/app/portfolio-model.js');
  const {calculateTrendHistory} = await import('../js/domain/trend.js');
  const transactions=[tx('2026-06-01')];
  const marketCaches=[cache({prices:[quote('2026-06-01',100),quote('2026-06-02',0)]}),cache({symbol:'2330',prices:[],splits:[event('2026-06-03',2)]})];
  const snapshot=calculatePortfolioSnapshot({transactions,marketCaches,dividendDateBasis:'PAYMENT_DATE',asOfDate:'2026-06-03'});
  assert.equal(snapshot.metrics.market,10000);
  const daily=calculateTrendHistory({transactions,marketCaches,dateBasis:'PAYMENT_DATE',asOfDate:'2026-06-03'});
  assert.deepEqual(daily.map(row=>row.date),['2026-06-01','2026-06-02']);
  assert.deepEqual(daily.map(row=>row.market),[10000,10000]);
});

test('selected end date may exceed the newest prices; split coverage is required only through actual end', async () => {
  const {calculateStockComparison} = await import('../js/domain/comparison.js');
  const data=['0050','2330'].map(symbol=>cache({symbol,splits:[],splitCheckedThrough:'2026-09-24',prices:[quote('2026-06-30',100),quote('2026-09-24',110)]}));
  const r=calculateStockComparison({symbols:['0050','2330'],marketCaches:data,startDate:'2026-06-30',endDate:'2026-09-28'});
  assert.equal(r.requestedEnd,'2026-09-28');
  assert.equal(r.actualEnd,'2026-09-24');
  assert.ok(Math.abs(r.series[0].change-10)<1e-8);
  data[0].splitCheckedThrough='2026-09-23';
  assert.throws(()=>calculateStockComparison({symbols:['0050','2330'],marketCaches:data,startDate:'2026-06-30',endDate:'2026-09-28'}),/分割資料尚未確認/);
});

test('comparison date fields do not impose the market-calendar maximum and later query dates use available quotes', async t => {
  const requests=[];
  const h=await comparisonHarness(t,async(dataset,symbol,start,end)=>{
    if(dataset==='TaiwanStockSplitPrice')return [];
    requests.push({symbol,start,end});
    return [quote('2026-06-01',100),quote('2026-06-03',110)];
  });
  h.date('comparisonEnd','2026-06-10');
  assert.doesNotMatch(h.page.render(),/id="comparison(?:Start|End)"[^>]*max=/);
  await h.page.compare();
  assert.equal(requests.length,2);
  assert.ok(requests.every(request=>request.end==='2026-06-10'));
  assert.match(h.page.render(),/實際共同區間：2026-06-01 ～ 2026-06-03/);
  assert.match(h.page.render(),/資料尚未更新/);
  await h.page.compare();
  assert.equal(requests.length,4,'querying beyond known coverage must allow new prices to arrive');
});
