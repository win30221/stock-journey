const assert = require('node:assert/strict');
const test = require('node:test');

test('CSV parser supports quoted commas, escaped quotes, and embedded newlines', async () => {
  const { parseCsvRows } = await import('./js/lib/csv.js');
  const rows = parseCsvRows('symbol,note,quantity\r\n0050,"長期, 核心",10\r\n2330,"股東說""讚""\n第二行",2');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].note, '長期, 核心');
  assert.equal(rows[0]._row, 2);
  assert.equal(rows[1].note, '股東說"讚"\n第二行');
  assert.equal(rows[1]._row, 3);
  assert.throws(() => parseCsvRows('symbol,note\n0050,"未結束'), /未結束/);
});

test('backup validation rejects malformed or duplicate records before restore', async () => {
  const { validateBackupPayload } = await import('./js/domain/backup.js');
  const valid = {
    schemaVersion:3,
    transactions:[{id:'t1',date:'2026-08-30',acquisitionType:'MANUAL_BUY',symbol:'0050',quantity:1,price:100,fee:0}],
    settings:{id:'default'},
    budgetPlans:[{id:'default',selectedTarget:'NEEDS_AND_WANTS',bufferRateBps:0}],
    budgetItems:[{id:'b1',bucket:'NEED',name:'餐費',calculationMode:'RECURRING',occurrenceAmount:1000,frequency:'MONTHLY'}],
  };
  assert.equal(validateBackupPayload(valid, 3, ['MANUAL_BUY']), valid);
  assert.throws(() => validateBackupPayload({...valid,transactions:[valid.transactions[0],valid.transactions[0]]},3,['MANUAL_BUY']), /重複 id/);
  assert.throws(() => validateBackupPayload({...valid,transactions:[{...valid.transactions[0],quantity:.5}]},3,['MANUAL_BUY']), /至少 1 股的整數/);
  assert.throws(() => validateBackupPayload({...valid,transactions:[{...valid.transactions[0],price:0}]},3,['MANUAL_BUY']), /成交價/);
  assert.throws(() => validateBackupPayload({...valid,budgetItems:[{...valid.budgetItems[0],bucket:'UNKNOWN'}]},3,['MANUAL_BUY']), /生活層級/);
  assert.throws(() => validateBackupPayload({...valid,transactions:[{...valid.transactions[0],id:'bad\" onclick=\"x'}]},3,['MANUAL_BUY']), /id 格式不安全/);
  assert.throws(() => validateBackupPayload({...valid,settings:{id:'default',retirementCurrentAge:60,retirementTargetAge:55}},3,['MANUAL_BUY']), /退休年齡必須大於/);
  assert.throws(() => validateBackupPayload({...valid,settings:{id:'default',retirementInflationRate:99}},3,['MANUAL_BUY']), /通膨率/);
  assert.throws(() => validateBackupPayload({...valid,settings:{id:'default',retirementBirthMonth:'1990-99'}},3,['MANUAL_BUY']), /出生年月/);
  assert.throws(() => validateBackupPayload({...valid,settings:{id:'default',retirementTargetAge:70,retirementLifeExpectancy:65}},3,['MANUAL_BUY']), /預估壽命必須大於/);
  assert.throws(() => validateBackupPayload({...valid,settings:{id:'default',retirementTargetAge:60.5}},3,['MANUAL_BUY']), /退休年齡必須是整數/);
  assert.throws(() => validateBackupPayload({...valid,budgetItems:[{...valid.budgetItems[0],amountBaseMonth:'2026-13'}]},3,['MANUAL_BUY']), /金額基準月/);
});

test('corrupted local storage is surfaced without overwriting the raw value', async () => {
  const raw = '{broken json';
  global.localStorage = {
    getItem:() => raw,
    setItem:() => { throw Error('must not write'); },
    removeItem:() => { throw Error('must not remove'); },
  };
  const { getAllRecords } = await import(`./js/lib/storage.js?corrupt=${Date.now()}`);
  await assert.rejects(() => getAllRecords('transactions'), /資料已損壞/);
});

test('CSV import detects the same file and suspicious duplicate rows', async () => {
  const { planCsvTransactionImport } = await import('./js/domain/transaction-import.js');
  let id = 0;
  const csv = 'date,acquisition_type,symbol,quantity,price,fee\n2026-08-30,MANUAL_BUY,0050,10,100,0';
  const first = planCsvTransactionImport(csv, [], () => `id-${++id}`, '2026-08-31T00:00:00.000Z');
  assert.equal(first.records.length, 1);
  assert.equal(first.duplicateFile, false);
  const fractional = planCsvTransactionImport('date,acquisition_type,symbol,quantity,price,fee\n2026-08-30,MANUAL_BUY,0050,0.5,100,0', [], () => `id-${++id}`);
  assert.deepEqual(fractional.errors, ['第 2 列：台股股數須為至少 1 股的整數']);
  const duplicate = planCsvTransactionImport(csv, first.records, () => `id-${++id}`);
  assert.equal(duplicate.duplicateFile, true);
  const overlapping = planCsvTransactionImport(csv + '\n2026-08-31,MANUAL_BUY,2330,1,900,0', first.records.map(row => ({...row,importFileFingerprint:null})), () => `id-${++id}`);
  assert.deepEqual(overlapping.duplicateRows, [2]);
});

test('FinMind requests abort after the configured timeout', async () => {
  const originalFetch = global.fetch;
  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Object.assign(Error('aborted'), { name:'AbortError' })));
  });
  try {
    const { fetchFinMindData } = await import('./js/services/finmind.js');
    await assert.rejects(() => fetchFinMindData('TaiwanStockInfo', null, null, undefined, { timeoutMs:5 }), /連線逾時/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('local storage bulk replacement rolls back all collections on failure', async () => {
  const values = new Map([
    ['srd-file-fallback:transactions', JSON.stringify([{id:'old'}])],
    ['srd-file-fallback:settings', JSON.stringify([{id:'default',value:'old'}])],
  ]);
  let failOnce = true;
  global.localStorage = {
    getItem:key => values.get(key) ?? null,
    setItem:(key, value) => {
      if (key === 'srd-file-fallback:settings' && failOnce) { failOnce=false; throw Error('quota'); }
      values.set(key, value);
    },
    removeItem:key => values.delete(key),
  };
  const { getAllRecords, replaceAllRecords, saveRecords } = await import('./js/lib/storage.js');
  await saveRecords('transactions', [{id:'new'}]);
  assert.deepEqual((await getAllRecords('transactions')).map(row=>row.id), ['old','new']);
  await assert.rejects(() => replaceAllRecords({transactions:[{id:'replacement'}],settings:[{id:'default',value:'new'}]}), /quota/);
  assert.deepEqual(JSON.parse(values.get('srd-file-fallback:transactions')).map(row=>row.id), ['old','new']);
  assert.equal(JSON.parse(values.get('srd-file-fallback:settings'))[0].value, 'old');
});
