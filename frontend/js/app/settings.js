import { TREND_EVENT_MARKER_SETTINGS } from '../lib/constants.js';
import { ageAtYearMonth, inferBirthMonth, isYearMonth } from '../domain/retirement.js';

export function createDefaultSettings() {
  return {
    id: 'default',
    monthlyExpenseTarget: 0,
    dividendDateBasis: 'PAYMENT_DATE',
    retirementBirthMonth: null,
    retirementBirthMonthConfirmed: false,
    retirementCurrentAge: 40,
    retirementTargetAge: 60,
    retirementLifeExpectancy: 90,
    retirementOtherMonthlyIncome: 0,
    retirementMonthlyContribution: 0,
    retirementAnnualReturnRate: 6,
    retirementInflationRate: 2,
    retirementWithdrawalRate: 0,
    retirementSaleWithdrawalRateVersion: 1,
    trendTooltipEventLimit: 3,
    showTotalAsset: true,
    showTotalReturn: true,
    gainMilestoneInterval: 1000000,
    ...Object.fromEntries(TREND_EVENT_MARKER_SETTINGS.map(({ id }) => [id, true])),
    lastSuccessfulMarketSyncDate: null,
    lastMarketSyncAttemptDate: null,
    marketAutoSyncPausedUntil: null,
  };
}

export function normaliseProjectionSetting(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
}

export function normaliseGainMilestoneInterval(value) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.max(10000, Math.min(100000000, parsed)) : 1000000;
}

export function normaliseTrendTooltipEventLimit(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(20, parsed)) : 3;
}

export function normaliseTrendEventMarkerSettings(source) {
  return Object.fromEntries(TREND_EVENT_MARKER_SETTINGS.map(({ id }) => [id, source?.[id] ?? true]));
}

export function normaliseSettings(source, { asOfMonth, resetMarketSync = false } = {}) {
  if (!isYearMonth(asOfMonth)) throw new TypeError('normaliseSettings requires a valid asOfMonth (YYYY-MM).');
  const saved = source || {}, defaults = createDefaultSettings();
  const legacyAge = normaliseProjectionSetting(saved.retirementCurrentAge, defaults.retirementCurrentAge, 18, 79);
  const hasBirthMonth = isYearMonth(saved.retirementBirthMonth);
  const birthMonth = hasBirthMonth ? saved.retirementBirthMonth : inferBirthMonth(legacyAge, asOfMonth);
  return {
    ...defaults,
    ...saved,
    id: saved.id || defaults.id,
    monthlyExpenseTarget: saved.monthlyExpenseTarget ?? defaults.monthlyExpenseTarget,
    dividendDateBasis: saved.dividendDateBasis || defaults.dividendDateBasis,
    retirementBirthMonth: birthMonth,
    retirementBirthMonthConfirmed: saved.retirementBirthMonthConfirmed === true && hasBirthMonth,
    retirementCurrentAge: ageAtYearMonth(birthMonth, asOfMonth) ?? legacyAge,
    retirementTargetAge: normaliseProjectionSetting(saved.retirementTargetAge, defaults.retirementTargetAge, 19, 90),
    retirementLifeExpectancy: normaliseProjectionSetting(saved.retirementLifeExpectancy, defaults.retirementLifeExpectancy, 20, 110),
    retirementOtherMonthlyIncome: normaliseProjectionSetting(saved.retirementOtherMonthlyIncome, 0, 0, 10000000),
    retirementMonthlyContribution: normaliseProjectionSetting(saved.retirementMonthlyContribution, 0, 0, 10000000),
    retirementAnnualReturnRate: normaliseProjectionSetting(saved.retirementAnnualReturnRate, defaults.retirementAnnualReturnRate, 0, 20),
    retirementInflationRate: normaliseProjectionSetting(saved.retirementInflationRate, defaults.retirementInflationRate, 0, 10),
    retirementWithdrawalRate: saved.retirementSaleWithdrawalRateVersion === 1
      ? normaliseProjectionSetting(saved.retirementWithdrawalRate, 0, 0, 10) : 0,
    retirementSaleWithdrawalRateVersion: 1,
    trendTooltipEventLimit: normaliseTrendTooltipEventLimit(saved.trendTooltipEventLimit),
    showTotalAsset: saved.showTotalAsset ?? true,
    showTotalReturn: saved.showTotalReturn ?? true,
    gainMilestoneInterval: normaliseGainMilestoneInterval(saved.gainMilestoneInterval),
    ...normaliseTrendEventMarkerSettings(saved),
    lastSuccessfulMarketSyncDate: resetMarketSync ? null : saved.lastSuccessfulMarketSyncDate || null,
    lastMarketSyncAttemptDate: resetMarketSync ? null : saved.lastMarketSyncAttemptDate || null,
    marketAutoSyncPausedUntil: resetMarketSync ? null : saved.marketAutoSyncPausedUntil || null,
  };
}

// Consumers treat snapshots as immutable; persistence and UI adapters stay outside this store.
export function createSettingsStore({ repository, initialSettings = createDefaultSettings() }) {
  let snapshot = { ...initialSettings }, revision = 0, queue = Promise.resolve();
  const listeners = new Set();

  function replace(nextSnapshot) {
    snapshot = { ...nextSnapshot };
    revision++;
    const published = snapshot, publishedRevision = revision;
    for (const listener of [...listeners]) {
      try { listener(published, publishedRevision); }
      catch (error) {
        // A subscriber must not turn a successful repository write into a failed save.
        console.error('Settings subscriber failed:', error);
      }
    }
    return published;
  }

  return {
    getSnapshot: () => snapshot,
    getRevision: () => revision,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    save(patch) {
      const changes = { ...patch };
      const write = queue.then(async () => {
        const next = { ...snapshot, ...changes };
        await repository.save(next);
        return replace(next);
      });
      queue = write.catch(() => {});
      return write;
    },
    replace,
    async whenIdle() {
      let pending;
      do {
        pending = queue;
        await pending;
      } while (pending !== queue);
    },
  };
}
