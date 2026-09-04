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

test('retirement projection accounts for inflation and recommends a monthly contribution', async () => {
  const { calculateRetirementProjection, futureValue } = await import('./js/domain/retirement.js');
  assert.equal(futureValue({ principal:1000000, monthlyContribution:0, annualReturnRate:0, years:10 }), 1000000);
  const projection = calculateRetirementProjection({
    currentAge:40, targetAge:60, currentAssets:3000000, currentMonthlyExpense:50000,
    otherMonthlyIncome:10000, monthlyContribution:20000, annualReturnRate:0.06,
    inflationRate:0.02, withdrawalRate:0.04,
  });
  assert.equal(projection.expenseAtTarget > 50000, true);
  assert.equal(projection.targetAssets > 12000000, true);
  assert.equal(projection.requiredMonthlyContribution >= 0, true);
  assert.equal(projection.series[0].age, 40);
  assert.equal(projection.series.at(-1).age, 90);
});

test('retirement dates keep expense purchasing power anchored to each item base month', async () => {
  const { ageAtYearMonth, calculateBudgetSummaryAt, calculateRetirementProjection } = await import('./js/domain/retirement.js');
  assert.equal(ageAtYearMonth('1992-08','2026-09'), 34);
  const item={bucket:'NEED',occurrenceAmount:10000,frequency:'MONTHLY',calculationMode:'RECURRING',amountBaseMonth:'2025-09'};
  const now=calculateBudgetSummaryAt({selectedTarget:'NEEDS_ONLY',bufferRateBps:0},[item],{inflationRate:0.02,asOfMonth:'2026-09'});
  assert.equal(Math.round(now.targetMonthly), 10200);
  const projection=calculateRetirementProjection({
    currentMonth:'2026-09',birthMonth:'1992-08',targetAge:40,lifeExpectancy:80,currentAssets:0,
    budgetPlan:{selectedTarget:'NEEDS_ONLY',bufferRateBps:0},budgetItems:[item],otherMonthlyIncome:0,
    monthlyContribution:0,annualReturnRate:0,inflationRate:0.02,withdrawalRate:0.04,
  });
  assert.equal(projection.currentAge,34);
  assert.equal(projection.retirementMonth,'2032-08');
  assert.equal(projection.lifeExpectancyMonth,'2072-08');
  assert.equal(projection.expenseAtTarget > now.targetMonthly,true);
  assert.equal(Math.round(projection.series.find(row=>row.age===41).annualWithdrawal),Math.round(projection.expenseAtTarget*12));
});

test('retirement drawdown reports when its sale-rate limit leaves a living-expense shortfall', async () => {
  const { calculateRetirementProjection } = await import('./js/domain/retirement.js');
  const projection=calculateRetirementProjection({
    currentMonth:'2026-09',birthMonth:'1986-09',targetAge:60,lifeExpectancy:70,currentAssets:1200000,
    currentMonthlyExpense:10000,expenseBaseMonth:'2026-09',otherMonthlyIncome:0,monthlyContribution:0,
    annualReturnRate:0,inflationRate:0,withdrawalRate:0.1,
  });
  assert.equal(projection.series[0].age,40);
  assert.equal(projection.series.at(-1).age,70);
  assert.equal(projection.series.find(row=>row.age===61).annualWithdrawal,120000);
  assert.equal(projection.depletedAge,62);
  assert.equal(projection.assetsAtLifeExpectancy>0,true);
  assert.equal(projection.lastsThroughLife,false);
});

test('automatic retirement projection fixes the horizon at 100 and can identify retirement now', async () => {
  const { calculateRetirementProjection } = await import('./js/domain/retirement.js');
  const projection=calculateRetirementProjection({
    currentMonth:'2026-09',birthMonth:'1986-09',autoRetirementAge:true,currentAssets:13200000,
    currentMonthlyExpense:10000,expenseBaseMonth:'2026-09',otherMonthlyIncome:0,monthlyContribution:0,
    annualReturnRate:0,inflationRate:0,withdrawalRate:0.02,
  });
  assert.equal(projection.lifeExpectancy,100);
  assert.equal(projection.targetAge,40);
  assert.equal(projection.retirementMonth,'2026-09');
  assert.equal(projection.series.at(-1).age,100);
  assert.equal(projection.lastsThroughLife,true);
});

test('retirement uses projected dividends before any portfolio sale', async () => {
  const { calculateRetirementProjection } = await import('./js/domain/retirement.js');
  const projection=calculateRetirementProjection({
    currentMonth:'2026-09',birthMonth:'1986-09',autoRetirementAge:true,currentAssets:1000000,
    currentMonthlyExpense:2000,expenseBaseMonth:'2026-09',otherMonthlyIncome:0,monthlyContribution:0,
    annualReturnRate:0.03,dividendYield:0.03,inflationRate:0,withdrawalRate:0,
  });
  assert.equal(projection.targetAge,40);
  const retiredYear=projection.series.find(row=>row.age===41);
  assert.equal(retiredYear.annualDividend,30000);
  assert.equal(retiredYear.fundedWithdrawal,0);
  assert.equal(retiredYear.shortfall,0);
});

test('annual dividend forecast applies current holdings to the latest twelve months of cash dividends', async () => {
  const { calculateProjectedAnnualDividends } = await import('./js/domain/dividends.js');
  const forecast=calculateProjectedAnnualDividends({
    asOfDate:'2026-09-04',transactions:[{symbol:'0050',date:'2025-01-02',quantity:100}],
    marketCaches:[{symbol:'0050',dividends:[{exDate:'2026-03-01',cash:2},{exDate:'2025-02-01',cash:1},{exDate:'2024-08-01',cash:9}]}],
  });
  assert.equal(forecast.annual,200);
});

test('automatic retirement projection reports no age when assets cannot last to 100', async () => {
  const { calculateRetirementProjection } = await import('./js/domain/retirement.js');
  const projection=calculateRetirementProjection({
    currentMonth:'2026-09',birthMonth:'1986-09',autoRetirementAge:true,currentAssets:100000,
    currentMonthlyExpense:10000,expenseBaseMonth:'2026-09',otherMonthlyIncome:0,monthlyContribution:0,
    annualReturnRate:0,inflationRate:0,withdrawalRate:0.1,
  });
  assert.equal(projection.lifeExpectancy,100);
  assert.equal(projection.targetAge,null);
  assert.equal(projection.retirementMonth,null);
  assert.equal(projection.series.at(-1).age,100);
  assert.equal(projection.series.every(row=>row.phase==='accumulation'),true);
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
  assert.equal(pageFromHash('#retirement-calculator'), 'retirement-calculator');
  assert.equal(pageFromHash('#unknown'), 'overview');
  assert.equal(pageFromHash(''), 'overview');
  assert.equal(hashForPage('settings'), '#settings');
  assert.equal(hashForPage('unknown'), '#overview');
});
