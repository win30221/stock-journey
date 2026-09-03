const assert = require('node:assert/strict');
const test = require('node:test');

test('portfolio calculations remain UI-independent', async () => {
  const { calculateHoldingGroups, calculatePortfolioMetrics, calculateUnrealizedReturn } = await import('./js/domain/portfolio.js');
  const holdings = calculateHoldingGroups([
    { symbol:'0050', acquisitionType:'MANUAL_BUY', quantity:10, price:100, fee:5 },
    { symbol:'0050', acquisitionType:'DIVIDEND_REINVESTMENT', quantity:1, price:110, fee:0 },
  ]);
  assert.equal(holdings[0].qty, 11);
  assert.equal(holdings[0].external, 1005);
  assert.equal(holdings[0].reinvested, 110);
  const metrics = calculatePortfolioMetrics(holdings, () => ({ close:120 }), [{ amount:200 }]);
  assert.equal(metrics.market, 1320);
  assert.equal(metrics.dividends, 200);

  assert.deepEqual(
    calculateUnrealizedReturn({ quantity:11, cost:1115, currentPrice:120 }),
    { amount:205, percent:205 / 1115 * 100 },
  );
  assert.deepEqual(
    calculateUnrealizedReturn({ quantity:10, cost:0, currentPrice:20 }),
    { amount:200, percent:null },
  );
});

test('retirement budget calculations accept plain data', async () => {
  const { calculateBudgetSummary } = await import('./js/domain/retirement.js');
  const summary = calculateBudgetSummary(
    { selectedTarget:'NEEDS_AND_WANTS', bufferRateBps:1000 },
    [
      { bucket:'NEED', occurrenceAmount:10000, frequency:'MONTHLY', calculationMode:'RECURRING' },
      { bucket:'WANT', occurrenceAmount:12000, frequency:'ANNUAL', calculationMode:'RECURRING' },
    ],
  );
  assert.equal(summary.selectedAnnual, 132000);
  assert.equal(summary.targetMonthly, 12100);
});

test('market sync planning has no app-state dependency', async () => {
  const { createMarketSyncPlan } = await import('./js/domain/market.js');
  const plan = createMarketSyncPlan({ cache:{ prices:[] }, transactionStart:'2026-01-02', target:'2026-08-28' });
  assert.equal(plan.priceNeeded, true);
  assert.equal(plan.priceStart, '2026-01-02');
  assert.equal(plan.dividendStart, '2026-01-02');
});

test('dividend receipts are derived from explicit inputs', async () => {
  const { calculateDividendReceipts } = await import('./js/domain/dividends.js');
  const receipts = calculateDividendReceipts({
    transactions:[{ symbol:'0050', date:'2025-01-02', quantity:100 }],
    marketCaches:[{ symbol:'0050', prices:[{ date:'2026-01-09', close:100 }], dividends:[{ exDate:'2026-01-10', paymentDate:'2026-02-01', cash:2 }] }],
    dateBasis:'PAYMENT_DATE',
  });
  assert.equal(receipts[0].eligible, 100);
  assert.equal(receipts[0].amount, 200);
  assert.equal(receipts[0].basis, '2026-02-01');
});

test('stock dividend expectation uses holdings before the ex-dividend event', async () => {
  const { calculateStockDividendChecks } = await import('./js/domain/dividends.js');
  const checks = calculateStockDividendChecks(
    [
      { symbol:'0050', date:'2026-01-02', acquisitionType:'MANUAL_BUY', quantity:100 },
      { symbol:'0050', date:'2026-08-10', acquisitionType:'STOCK_DIVIDEND', quantity:10 },
    ],
    [{ symbol:'0050', prices:[{date:'2026-08-07'}], dividends:[{exDate:'2026-08-10',stock:1}] }],
  );
  assert.equal(checks[0].eligibleDate, '2026-08-07');
  assert.equal(checks[0].expected, 10);
  assert.equal(checks[0].matching.quantity, 10);
});

test('hash routes stay stable for static hosting and future Next.js pages', async () => {
  const { hashForPage, pageFromHash } = await import('./js/app/router.js');
  assert.equal(pageFromHash('#transactions'), 'transactions');
  assert.equal(pageFromHash('#market-data'), 'market-data');
  assert.equal(pageFromHash('#unknown'), 'overview');
  assert.equal(pageFromHash(''), 'overview');
  assert.equal(hashForPage('settings'), '#settings');
  assert.equal(hashForPage('unknown'), '#overview');
});
