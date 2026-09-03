// Pure retirement-budget calculations. It is ready to be consumed by server or UI code.
export function calculateAnnualBudget(item) {
  const amount = Number(item.occurrenceAmount || 0);
  if (!(amount >= 0)) return 0;
  if (item.calculationMode === 'REPLACEMENT') return amount / Math.max(Number(item.replacementCycleYears || 1), 0.1);
  const interval = Math.max(Number(item.intervalCount || 1), 1);
  const factors = { DAILY:365, WEEKLY:52, MONTHLY:12, BIMONTHLY:6, QUARTERLY:4, SEMIANNUAL:2, ANNUAL:1, EVERY_N_MONTHS:12 / interval, EVERY_N_YEARS:1 / interval };
  return amount * (factors[item.frequency] ?? 12);
}

export function calculateBudgetSummary(plan, items) {
  const active = items.filter(item => item.isActive !== false);
  const needsAnnual = active.filter(item => item.bucket === 'NEED').reduce((total, item) => total + calculateAnnualBudget(item), 0);
  const wantsAnnual = active.filter(item => item.bucket === 'WANT').reduce((total, item) => total + calculateAnnualBudget(item), 0);
  const selectedAnnual = plan?.selectedTarget === 'NEEDS_ONLY' ? needsAnnual : needsAnnual + wantsAnnual;
  const bufferAnnual = selectedAnnual * Number(plan?.bufferRateBps || 0) / 10000;
  return { plan, active, needsAnnual, wantsAnnual, selectedAnnual, bufferAnnual, targetAnnual:selectedAnnual + bufferAnnual, targetMonthly:(selectedAnnual + bufferAnnual) / 12 };
}
