const assert = require('node:assert/strict');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { createAppFixture } = require('./support/app-fixture.cjs');

const model = import('../js/app/portfolio-model.js');
const transaction = { id:'t', symbol:'0050', date:'2026-01-01', quantity:100, price:10, fee:0, acquisitionType:'MANUAL_BUY' };
function input() {
  return {
    transactions:[{ ...transaction }],
    marketCaches:[{
      symbol:'0050',
      prices:[{ date:'2026-09-04', close:15 }, { date:'2026-01-30', close:12 }],
      dividends:[{ exDate:'2026-02-01', paymentDate:'2026-03-01', cash:2 }],
      dividendCoverageFrom:'2025-01-01', dividendCheckedThrough:'2026-09-04',
    }],
    dividendDateBasis:'PAYMENT_DATE', asOfDate:'2026-09-07', requiredThroughDate:'2026-09-04',
  };
}

test('portfolio read model shares consistent holdings, paid dividends and forecast without mutating input', async () => {
  const { calculatePortfolioSnapshot } = await model;
  const source = input(), previous = structuredClone(source);
  const snapshot = calculatePortfolioSnapshot(source);
  assert.equal(snapshot.metrics.market, 1500);
  assert.equal(snapshot.metrics.external, 1000);
  assert.equal(snapshot.holdings[0].qty, 100);
  assert.equal(snapshot.pricesBySymbol['0050'].date, '2026-09-04');
  assert.equal(snapshot.dividendSummary.paidMonthly['2026-03'], 200);
  assert.equal(snapshot.dividendSummary.avg, 200 / 9);
  assert.equal(snapshot.dividendForecast.annual, 200);
  assert.equal(snapshot.dividendForecast.yield, 200 / 1500);
  assert.equal(snapshot.dividendForecast.coverageComplete, true);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)), snapshot);
  assert.deepEqual(source, previous);
});

test('missing market data retains the acquisition-cost estimate and incomplete dividend coverage', async () => {
  const { calculatePortfolioSnapshot } = await model;
  const snapshot = calculatePortfolioSnapshot({ ...input(), marketCaches:[] });
  assert.equal(snapshot.metrics.market, 1000);
  assert.equal(snapshot.metrics.holdings[0].last, null);
  assert.equal(snapshot.latestMarketDate, null);
  assert.equal(snapshot.dividendForecast.coverageComplete, false);
  assert.deepEqual(snapshot.dividendForecast.incompleteSymbols, ['0050']);
});

test('explicit calendar dates give the same reporting month on servers in different timezones', () => {
  const source = `
    import { calculatePortfolioSnapshot } from './js/app/portfolio-model.js';
    const result = calculatePortfolioSnapshot({transactions:[],marketCaches:[],dividendDateBasis:'PAYMENT_DATE',asOfDate:'2026-01-01'});
    process.stdout.write(JSON.stringify(result));
  `;
  const snapshots = ['UTC', 'Asia/Taipei', 'America/Los_Angeles'].map(TZ =>
    execFileSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd:path.resolve(__dirname, '..'), env:{ ...process.env, TZ }, encoding:'utf8',
    }));
  assert.equal(snapshots[0], snapshots[1]);
  assert.equal(snapshots[1], snapshots[2]);
  assert.deepEqual(JSON.parse(snapshots[0]).dividendSummary.yearMonths, ['2026-01']);
});

test('legacy views share a snapshot and refresh it when prices, transactions or date basis change', t => {
  const f = createAppFixture(t);
  f.context.modelInput = input();
  f.run(`
    transactions=modelInput.transactions;marketCaches=modelInput.marketCaches;
    let snapshotCalculations=0;
    const originalPortfolioSnapshot=calculatePortfolioSnapshot;
    calculatePortfolioSnapshot=values=>{snapshotCalculations++;return originalPortfolioSnapshot(values);};
  `);
  for (let index = 0; index < 20; index++) f.run('grouped();metrics();dividendSummary();dividendForecast();');
  assert.equal(f.run('snapshotCalculations'), 1);
  assert.equal(f.run("lastPrice('constructor')"), null);
  f.run("marketCaches=[{...marketCaches[0],prices:[{date:'2026-09-04',close:20}]}];");
  assert.equal(f.run('metrics().market'), 2000);
  assert.equal(f.run('snapshotCalculations'), 2);
  f.run('transactions=[{...transactions[0],quantity:200}];');
  assert.equal(f.run('metrics().market'), 4000);
  assert.equal(f.run('snapshotCalculations'), 3);
  f.run("settingsStore.replace({...settings,dividendDateBasis:'EX_DIVIDEND_DATE'});dividendSummary();");
  assert.equal(f.run('snapshotCalculations'), 4);
});
