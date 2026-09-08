const assert = require('node:assert/strict');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('settings store imports without touching browser services', () => {
  const moduleUrl = pathToFileURL(require.resolve('../js/app/settings.js')).href;
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    for (const name of ['document', 'localStorage', 'fetch']) {
      Object.defineProperty(globalThis, name, { get() { throw Error('Unexpected access: ' + name); } });
    }
    const { createSettingsStore } = await import(${JSON.stringify(moduleUrl)});
    const store = createSettingsStore({ repository: { save() { throw Error('Unexpected write'); } } });
    if (store.getSnapshot().id !== 'default') throw Error('Missing defaults');
  `]);
});

test('queued settings saves merge with the latest committed snapshot', async () => {
  const { createSettingsStore } = await import('../js/app/settings.js');
  const firstWrite = deferred(), writes = [];
  const initial = { left:0, right:0, preserved:'yes' };
  const store = createSettingsStore({
    initialSettings: initial,
    repository: { async save(value) {
      writes.push(value);
      if (writes.length === 1) await firstWrite.promise;
    } },
  });
  const before = store.getSnapshot(), patch = { left:1 };
  const first = store.save(patch);
  patch.left = 9;
  const second = store.save({ right:2 });
  await Promise.resolve();
  assert.equal(writes.length, 1, 'only one repository write can run at a time');
  assert.equal(store.getSnapshot(), before, 'pending writes do not publish optimistic state');
  assert.equal(store.getRevision(), 0);
  firstWrite.resolve();
  await Promise.all([first, second, store.whenIdle()]);
  assert.deepEqual(writes, [
    { left:1, right:0, preserved:'yes' },
    { left:1, right:2, preserved:'yes' },
  ]);
  assert.deepEqual(store.getSnapshot(), { left:1, right:2, preserved:'yes' });
  assert.deepEqual(initial, { left:0, right:0, preserved:'yes' });
  assert.equal(store.getRevision(), 2);
});

test('failed saves reject without publishing and do not block later saves or whenIdle', async () => {
  const { createSettingsStore } = await import('../js/app/settings.js');
  let attempts = 0;
  const store = createSettingsStore({
    initialSettings:{ expense:100, contribution:10 },
    repository:{ async save() { if (++attempts === 1) throw Error('quota'); } },
  });
  const before = store.getSnapshot(), notifications = [];
  store.subscribe((value, revision) => notifications.push({ value, revision }));
  await assert.rejects(store.save({ expense:999 }), /quota/);
  await store.whenIdle();
  assert.equal(store.getSnapshot(), before);
  assert.equal(store.getRevision(), 0);
  assert.deepEqual(notifications, []);
  await store.save({ contribution:20 });
  assert.deepEqual(store.getSnapshot(), { expense:100, contribution:20 });
  assert.equal(store.getRevision(), 1);
  assert.equal(notifications.length, 1);
});

test('snapshots stay stable between changes and subscriptions can be removed', async () => {
  const { createSettingsStore } = await import('../js/app/settings.js');
  let writes = 0;
  const store = createSettingsStore({ initialSettings:{ value:1 }, repository:{ async save() { writes++; } } });
  const original = store.getSnapshot(), notifications = [];
  const unsubscribe = store.subscribe((value, revision) => notifications.push({ value, revision }));
  assert.equal(store.getSnapshot(), original);
  assert.deepEqual(notifications, []);
  const replacement = store.replace({ value:2, loaded:true });
  assert.equal(writes, 0, 'replace is a memory update after external loading or restoration');
  assert.notEqual(replacement, original);
  assert.equal(store.getSnapshot(), replacement);
  assert.equal(notifications[0].value, replacement);
  assert.equal(notifications[0].revision, 1);
  assert.deepEqual(original, { value:1 });
  unsubscribe();
  unsubscribe();
  await store.save({ value:3 });
  assert.equal(notifications.length, 1);
  assert.equal(store.getRevision(), 2);
  assert.equal(store.getSnapshot(), store.getSnapshot());
});

test('separate store instances isolate settings and subscriptions', async () => {
  const { createSettingsStore } = await import('../js/app/settings.js');
  const firstWrites = [], secondWrites = [];
  const first = createSettingsStore({ repository:{ async save(value) { firstWrites.push(value); } } });
  const second = createSettingsStore({ repository:{ async save(value) { secondWrites.push(value); } } });
  const secondSnapshot = second.getSnapshot();
  let secondNotifications = 0;
  second.subscribe(() => secondNotifications++);
  await first.save({ retirementMonthlyContribution:5000 });
  assert.equal(firstWrites.length, 1);
  assert.equal(secondWrites.length, 0);
  assert.equal(second.getSnapshot(), secondSnapshot);
  assert.equal(second.getSnapshot().retirementMonthlyContribution, 0);
  assert.equal(second.getRevision(), 0);
  assert.equal(secondNotifications, 0);
});

test('a loading adapter can guard its snapshot with the store revision', async () => {
  const { createSettingsStore } = await import('../js/app/settings.js');
  const store = createSettingsStore({ initialSettings:{ annualReturn:6 }, repository:{ async save() {} } });
  const read = deferred();
  await store.whenIdle();
  const readRevision = store.getRevision();
  const loading = read.promise.then(loaded => {
    if (readRevision === store.getRevision()) store.replace(loaded);
  });
  await store.save({ annualReturn:8 });
  read.resolve({ annualReturn:6 });
  await loading;
  assert.equal(store.getSnapshot().annualReturn, 8, 'an older read cannot replace a newer successful write');
  const nextRevision = store.getRevision();
  const freshlyLoaded = { annualReturn:9 };
  if (nextRevision === store.getRevision()) store.replace(freshlyLoaded);
  assert.equal(store.getSnapshot().annualReturn, 9);
  assert.equal(store.getRevision(), nextRevision + 1);
});

test('whenIdle also waits for saves queued by a subscription', async () => {
  const { createSettingsStore } = await import('../js/app/settings.js');
  const gate = deferred();
  const store = createSettingsStore({
    initialSettings:{ value:0 },
    repository:{ async save(value) { if (value.value === 2) await gate.promise; } },
  });
  store.subscribe(value => { if (value.value === 1) void store.save({ value:2 }); });
  const first = store.save({ value:1 });
  let idle = false;
  const waiting = store.whenIdle().then(() => { idle = true; });
  await first;
  await Promise.resolve();
  assert.equal(idle, false);
  gate.resolve();
  await waiting;
  assert.equal(store.getSnapshot().value, 2);
});

test('subscriber failures do not misreport a persisted save as failed', async context => {
  const { createSettingsStore } = await import('../js/app/settings.js');
  const errors = context.mock.method(console, 'error', () => {});
  const store = createSettingsStore({ repository:{ async save() {} } });
  store.subscribe(() => { throw Error('view failed'); });
  let notified = false;
  store.subscribe(() => { notified = true; });
  await store.save({ showTotalReturn:false });
  assert.equal(store.getSnapshot().showTotalReturn, false);
  assert.equal(notified, true);
  assert.equal(errors.mock.callCount(), 1);
});

test('legacy age and withdrawal settings migrate without inventing a confirmed birth month', async () => {
  const { normaliseSettings } = await import('../js/app/settings.js');
  const legacy = normaliseSettings({ retirementCurrentAge:40, retirementWithdrawalRate:4, customNote:'keep' }, { asOfMonth:'2026-09' });
  assert.equal(legacy.retirementBirthMonth, '1986-09');
  assert.equal(legacy.retirementBirthMonthConfirmed, false);
  assert.equal(legacy.retirementCurrentAge, 40);
  assert.equal(legacy.retirementWithdrawalRate, 0, 'the old withdrawal rate used a different meaning');
  assert.equal(legacy.retirementSaleWithdrawalRateVersion, 1);
  assert.equal(legacy.customNote, 'keep');
  const invalidBirth = normaliseSettings({ retirementBirthMonth:'1986-99', retirementBirthMonthConfirmed:true, retirementCurrentAge:40 }, { asOfMonth:'2026-09' });
  assert.equal(invalidBirth.retirementBirthMonth, '1986-09');
  assert.equal(invalidBirth.retirementBirthMonthConfirmed, false);
});

test('confirmed birth months and current withdrawal settings survive normalisation', async () => {
  const { normaliseSettings } = await import('../js/app/settings.js');
  const source = {
    retirementBirthMonth:'1986-10', retirementBirthMonthConfirmed:true, retirementCurrentAge:20,
    retirementWithdrawalRate:4, retirementSaleWithdrawalRateVersion:1,
    showTotalAsset:false, showManualBuyMarker:false,
  };
  const september = normaliseSettings(source, { asOfMonth:'2026-09' });
  const october = normaliseSettings(source, { asOfMonth:'2026-10' });
  assert.equal(september.retirementCurrentAge, 39);
  assert.equal(october.retirementCurrentAge, 40);
  assert.equal(september.retirementBirthMonthConfirmed, true);
  assert.equal(september.retirementWithdrawalRate, 4);
  assert.equal(september.showTotalAsset, false);
  assert.equal(september.showManualBuyMarker, false);
  assert.equal(source.retirementCurrentAge, 20, 'normalisation never edits the source');
});

test('normalisation applies established bounds and resets only requested market state', async () => {
  const {
    normaliseSettings, normaliseGainMilestoneInterval, normaliseTrendTooltipEventLimit,
    normaliseTrendEventMarkerSettings, normaliseProjectionSetting,
  } = await import('../js/app/settings.js');
  assert.equal(normaliseGainMilestoneInterval(1), 10000);
  assert.equal(normaliseGainMilestoneInterval(100000001), 100000000);
  assert.equal(normaliseGainMilestoneInterval(undefined), 1000000);
  assert.equal(normaliseTrendTooltipEventLimit(2.9), 2);
  assert.equal(normaliseTrendTooltipEventLimit(undefined), 3);
  assert.equal(normaliseTrendTooltipEventLimit(99), 20);
  assert.equal(normaliseProjectionSetting('invalid', 6, 0, 20), 6);
  assert.equal(normaliseTrendEventMarkerSettings().showNewStockMarker, true);
  const source = {
    retirementAnnualReturnRate:99, retirementInflationRate:-2, retirementMonthlyContribution:20000000,
    gainMilestoneInterval:0, trendTooltipEventLimit:0, extra:'retained',
    lastSuccessfulMarketSyncDate:'2026-09-01', lastMarketSyncAttemptDate:'2026-09-02', marketAutoSyncPausedUntil:'2026-09-03T00:00:00Z',
  };
  const normal = normaliseSettings(source, { asOfMonth:'2026-09' });
  const restored = normaliseSettings(source, { asOfMonth:'2026-09', resetMarketSync:true });
  assert.equal(normal.retirementAnnualReturnRate, 20);
  assert.equal(normal.retirementInflationRate, 0);
  assert.equal(normal.retirementMonthlyContribution, 10000000);
  assert.equal(normal.gainMilestoneInterval, 10000);
  assert.equal(normal.trendTooltipEventLimit, 1);
  assert.equal(normal.lastSuccessfulMarketSyncDate, source.lastSuccessfulMarketSyncDate);
  assert.deepEqual(restored, { ...normal, lastSuccessfulMarketSyncDate:null, lastMarketSyncAttemptDate:null, marketAutoSyncPausedUntil:null });
});

test('normalisation requires an explicit valid month instead of consulting the system clock', async () => {
  const { normaliseSettings } = await import('../js/app/settings.js');
  assert.throws(() => normaliseSettings({}), /asOfMonth/);
  assert.throws(() => normaliseSettings({}, { asOfMonth:'2026-13' }), /asOfMonth/);
});
