const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const validTransaction = {
  id: 'transaction-1', date: '2024-02-29', acquisitionType: 'MANUAL_BUY',
  symbol: '0050', quantity: 10, price: 100, fee: 0,
};

function backupWith(transaction) {
  return {
    schemaVersion: 3,
    transactions: [transaction],
    settings: { id:'default' },
    budgetPlans: [],
    budgetItems: [],
  };
}

function csvWith(transaction) {
  return 'date,acquisition_type,symbol,quantity,price,fee\n' + [
    transaction.date, transaction.acquisitionType, transaction.symbol,
    transaction.quantity, transaction.price ?? '', transaction.fee,
  ].join(',');
}

test('transaction entry points reject the same invalid fields with their own context', async () => {
  const { validateTransactionFields } = await import('../js/domain/transaction-validation.js');
  const { planCsvTransactionImport } = await import('../js/domain/transaction-import.js');
  const { validateBackupPayload } = await import('../js/domain/backup.js');
  const cases = [
    ['date', '2023-02-29', 'invalidDate', /日期/],
    ['acquisitionType', 'toString', 'invalidAcquisitionType', /取得方式/],
    ['symbol', '0050<script>', 'invalidSymbol', /股票代號/],
    ['quantity', 0.5, 'invalidQuantity', /至少 1 股的整數/],
    ['quantity', Infinity, 'invalidQuantity', /至少 1 股的整數/],
    ['price', 0, 'invalidPrice', /價格|成交價/],
    ['fee', -1, 'invalidFee', /手續費/],
  ];
  for (const [field, value, code, message] of cases) {
    const transaction = { ...validTransaction, [field]:value };
    assert.deepEqual(validateTransactionFields(transaction), { field, code });
    const csv = planCsvTransactionImport(csvWith(transaction), [], () => 'test-id');
    assert.equal(csv.records.length, 0);
    assert.equal(csv.errors.length, 1);
    assert.match(csv.errors[0], /^第 2 列：/);
    assert.match(csv.errors[0], message);
    assert.throws(() => validateBackupPayload(backupWith(transaction), 3, ['MANUAL_BUY']), error => {
      assert.match(error.message, /^交易紀錄第 1 筆/);
      assert.match(error.message, message);
      return true;
    });
  }
});

test('shared validation preserves valid leap dates, leading-zero symbols, and stock dividends', async () => {
  const { validateTransactionFields, isIsoCalendarDate } = await import('../js/domain/transaction-validation.js');
  const { planCsvTransactionImport, isIsoCalendarDate:legacyDateValidator } = await import('../js/domain/transaction-import.js');
  const { validateBackupPayload } = await import('../js/domain/backup.js');
  assert.equal(isIsoCalendarDate, legacyDateValidator);
  assert.equal(isIsoCalendarDate('2024-02-29'), true);
  assert.equal(isIsoCalendarDate('2024-04-31'), false);
  assert.equal(isIsoCalendarDate(null), false);
  assert.equal(validateTransactionFields(validTransaction), null);
  const stockDividend = { ...validTransaction, acquisitionType:'STOCK_DIVIDEND', price:null };
  assert.equal(validateTransactionFields(stockDividend), null);
  assert.deepEqual(validateTransactionFields(stockDividend, { acquisitionTypes:['MANUAL_BUY'] }), {
    field:'acquisitionType', code:'invalidAcquisitionType',
  });
  const csv = planCsvTransactionImport(csvWith(stockDividend), [], () => 'test-id');
  assert.deepEqual(csv.errors, []);
  assert.equal(csv.records[0].symbol, '0050');
  assert.equal(csv.records[0].price, null);
  const payload = backupWith(stockDividend);
  assert.equal(validateBackupPayload(payload, 3, ['STOCK_DIVIDEND']), payload);
});

test('default settings reset every chart option without sharing mutable state', async () => {
  const { createDefaultSettings } = await import('../js/app/settings.js');
  const { TREND_EVENT_MARKER_SETTINGS } = await import('../js/lib/constants.js');
  const previous = createDefaultSettings();
  previous.showTotalReturn = false;
  previous.gainMilestoneInterval = 10000;
  for (const { id } of TREND_EVENT_MARKER_SETTINGS) previous[id] = false;
  const reset = createDefaultSettings();
  assert.equal(reset.showTotalReturn, true);
  assert.equal(reset.gainMilestoneInterval, 1000000);
  assert.equal(reset.retirementBirthMonth, null);
  assert.equal(reset.retirementBirthMonthConfirmed, false);
  assert.equal(reset.lastSuccessfulMarketSyncDate, null);
  for (const { id } of TREND_EVENT_MARKER_SETTINGS) assert.equal(reset[id], true);
  assert.equal(previous.showTotalReturn, false);
});

test('per-share number formatting is exported without a currency suffix', async () => {
  const { fmtPerShareNumber } = await import('../js/lib/format.js');
  assert.equal(fmtPerShareNumber(-1.23456), '-1.2346');
  assert.equal(fmtPerShareNumber(0), '0');
  assert.equal(fmtPerShareNumber(null), '—');
});

test('importing the build helper cannot rewrite the deployable bundle', () => {
  const scriptPath = require.resolve('../scripts/build-static.cjs');
  execFileSync(process.execPath, ['-e', `
    const fs = require('node:fs');
    fs.writeFileSync = () => { throw Error('Unexpected file write while importing build helper'); };
    const { buildBundle } = require(${JSON.stringify(scriptPath)});
    if (typeof buildBundle !== 'function') throw Error('Missing build helper');
  `]);
  const { buildBundle, sourceFiles } = require('../scripts/build-static.cjs');
  const source = buildBundle();
  assert.ok(sourceFiles.includes('js/domain/transaction-validation.js'));
  assert.ok(sourceFiles.includes('js/app/settings.js'));
  assert.doesNotMatch(source, /^import |^export /m);
  assert.doesNotThrow(() => new vm.Script(source));
});
