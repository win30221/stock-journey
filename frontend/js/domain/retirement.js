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

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isYearMonth(value) { return YEAR_MONTH_PATTERN.test(String(value || '')); }
function monthNumber(value) { const [year, month] = String(value).split('-').map(Number);return year * 12 + month - 1; }
export function monthsBetweenYearMonths(from, to) { return isYearMonth(from) && isYearMonth(to) ? monthNumber(to) - monthNumber(from) : 0; }
export function addYearsToYearMonth(value, years) {
  if (!isYearMonth(value)) return '';
  const [year, month] = value.split('-').map(Number);
  return `${year + Math.trunc(Number(years) || 0)}-${String(month).padStart(2, '0')}`;
}
export function ageAtYearMonth(birthMonth, atMonth) {
  if (!isYearMonth(birthMonth) || !isYearMonth(atMonth)) return null;
  return Math.floor(monthsBetweenYearMonths(birthMonth, atMonth) / 12);
}
export function inferBirthMonth(currentAge, atMonth) {
  if (!isYearMonth(atMonth)) return '';
  return addYearsToYearMonth(atMonth, -Math.max(0, Math.floor(Number(currentAge) || 0)));
}
function itemBaseMonth(item, fallback) {
  const timestampMonth = String(item.updatedAt || item.createdAt || '').slice(0, 7);
  return isYearMonth(item.amountBaseMonth) ? item.amountBaseMonth : isYearMonth(timestampMonth) ? timestampMonth : fallback;
}
export function calculateBudgetSummaryAt(plan, items, { inflationRate = 0, asOfMonth, fallbackBaseMonth = asOfMonth } = {}) {
  const rate = Math.max(0, Number(inflationRate) || 0);
  const active = items.filter(item => item.isActive !== false).map(item => {
    const baseMonth = itemBaseMonth(item, fallbackBaseMonth);
    const elapsedYears = Math.max(0, monthsBetweenYearMonths(baseMonth, asOfMonth)) / 12;
    return { ...item, adjustedAnnual:calculateAnnualBudget(item) * (1 + rate) ** elapsedYears, amountBaseMonth:baseMonth };
  });
  const needsAnnual = active.filter(item => item.bucket === 'NEED').reduce((total, item) => total + item.adjustedAnnual, 0);
  const wantsAnnual = active.filter(item => item.bucket === 'WANT').reduce((total, item) => total + item.adjustedAnnual, 0);
  const selectedAnnual = plan?.selectedTarget === 'NEEDS_ONLY' ? needsAnnual : needsAnnual + wantsAnnual;
  const bufferAnnual = selectedAnnual * Number(plan?.bufferRateBps || 0) / 10000;
  return { plan, active, needsAnnual, wantsAnnual, selectedAnnual, bufferAnnual, targetAnnual:selectedAnnual + bufferAnnual, targetMonthly:(selectedAnnual + bufferAnnual) / 12, asOfMonth };
}

export function futureValue({ principal = 0, monthlyContribution = 0, annualReturnRate = 0, years = 0 }) {
  const months = Math.max(0, Math.round(Number(years) * 12));
  const monthlyRate = Number(annualReturnRate) / 12;
  const startingValue = Math.max(0, Number(principal) || 0) * (1 + monthlyRate) ** months;
  const contributionValue = monthlyRate
    ? Math.max(0, Number(monthlyContribution) || 0) * (((1 + monthlyRate) ** months - 1) / monthlyRate)
    : Math.max(0, Number(monthlyContribution) || 0) * months;
  return startingValue + contributionValue;
}

export function calculateRequiredMonthlyContribution({ targetAssets = 0, principal = 0, annualReturnRate = 0, years = 0 }) {
  const months = Math.max(0, Math.round(Number(years) * 12));
  if (!months) return Math.max(0, Number(targetAssets) - Number(principal));
  const monthlyRate = Number(annualReturnRate) / 12;
  const grownPrincipal = Math.max(0, Number(principal) || 0) * (1 + monthlyRate) ** months;
  const contributionFactor = monthlyRate ? ((1 + monthlyRate) ** months - 1) / monthlyRate : months;
  return Math.max(0, (Math.max(0, Number(targetAssets) || 0) - grownPrincipal) / contributionFactor);
}

export function calculateRetirementProjection(input) {
  const currentMonth = isYearMonth(input.currentMonth) ? input.currentMonth : '2026-01';
  const birthMonth = isYearMonth(input.birthMonth) ? input.birthMonth : inferBirthMonth(input.currentAge, currentMonth);
  const derivedAge = ageAtYearMonth(birthMonth, currentMonth);
  const currentAge = Math.max(18, Math.min(79, derivedAge == null ? Number(input.currentAge) || 18 : derivedAge));
  const automaticRetirementAge = input.autoRetirementAge === true;
  const requestedTargetAge = Math.max(currentAge + 1, Math.min(90, Math.floor(Number(input.targetAge) || currentAge + 1)));
  const lifeExpectancy = automaticRetirementAge ? 100 : Math.max(requestedTargetAge + 1, Math.min(110, Math.floor(Number(input.lifeExpectancy) || 90)));
  const currentAssets = Math.max(0, Number(input.currentAssets) || 0);
  const otherMonthlyIncome = Math.max(0, Number(input.otherMonthlyIncome) || 0);
  const monthlyContribution = Math.max(0, Number(input.monthlyContribution) || 0);
  const annualReturnRate = Math.max(0, Number(input.annualReturnRate) || 0);
  const inflationRate = Math.max(0, Number(input.inflationRate) || 0);
  const withdrawalRate = Math.max(0, Number(input.withdrawalRate) || 0);
  const dividendYield = Math.max(0, Number(input.dividendYield) || 0);
  const priceGrowthRate = annualReturnRate - dividendYield;
  const hasItemizedBudget = Array.isArray(input.budgetItems) && input.budgetItems.length > 0;
  const fallbackExpenseBaseMonth = isYearMonth(input.expenseBaseMonth) ? input.expenseBaseMonth : currentMonth;
  const expenseAtMonth = month => hasItemizedBudget
    ? calculateBudgetSummaryAt(input.budgetPlan, input.budgetItems, { inflationRate, asOfMonth:month, fallbackBaseMonth:fallbackExpenseBaseMonth }).targetMonthly
    : Math.max(0, Number(input.currentMonthlyExpense) || 0) * (1 + inflationRate) ** (Math.max(0, monthsBetweenYearMonths(fallbackExpenseBaseMonth, month)) / 12);
  const currentMonthlyExpense = expenseAtMonth(currentMonth);
  const monthAtAge = age => age === currentAge ? currentMonth : addYearsToYearMonth(birthMonth, age);
  const targetFor = (expense, monthlyIncome=otherMonthlyIncome) => {
    const coverageRate=dividendYield + withdrawalRate, annualGap=Math.max(0, expense - monthlyIncome) * 12;
    return annualGap === 0 ? 0 : coverageRate > 0 ? annualGap / coverageRate : null;
  };
  const simulateCandidate = candidateAge => {
    const candidateMonth=monthAtAge(candidateAge),years=Math.max(0,monthsBetweenYearMonths(currentMonth,candidateMonth))/12,expense=expenseAtMonth(candidateMonth),target=targetFor(expense),assets=futureValue({principal:currentAssets,monthlyContribution,annualReturnRate,years});
    let balance=assets,depletedAge=null;
    for(let age=candidateAge+1;age<=lifeExpectancy;age+=1){const withdrawalMonth=monthAtAge(age-1),annualExpense=expenseAtMonth(withdrawalMonth)*12,dividendIncome=balance*dividendYield,requiredSale=Math.max(0,annualExpense-otherMonthlyIncome*12-dividendIncome),allowedSale=balance*withdrawalRate,saleWithdrawal=Math.min(requiredSale,allowedSale),shortfall=Math.max(0,requiredSale-saleWithdrawal);balance=Math.max(0,balance*(1+priceGrowthRate)-saleWithdrawal);if(depletedAge==null&&(balance<=0||shortfall>0))depletedAge=age;}
    return { candidateMonth, years, expense, target, assets, balance, depletedAge, feasible:(target==null?Math.max(0,expense-otherMonthlyIncome)===0:assets>=target)&&depletedAge==null };
  };
  let retirementAge = automaticRetirementAge ? null : requestedTargetAge;
  if (automaticRetirementAge) for (let age=currentAge;age<lifeExpectancy;age+=1) { if (simulateCandidate(age).feasible) { retirementAge=age;break; } }
  const targetAge = retirementAge ?? lifeExpectancy;
  const retirementMonth = monthAtAge(targetAge);
  const lifeExpectancyMonth = addYearsToYearMonth(birthMonth, lifeExpectancy);
  const yearsToTarget = Math.max(0, monthsBetweenYearMonths(currentMonth, retirementMonth)) / 12;
  const expenseAtTarget = expenseAtMonth(retirementMonth);
  const incomeAtTarget = otherMonthlyIncome;
  const targetAssets = targetFor(expenseAtTarget, incomeAtTarget);
  const projectedAssets = futureValue({ principal:currentAssets, monthlyContribution, annualReturnRate, years:yearsToTarget });
  const requiredMonthlyContribution = targetAssets == null ? null : calculateRequiredMonthlyContribution({ targetAssets, principal:currentAssets, annualReturnRate, years:yearsToTarget });
  const series = [];
  let achievedAge = automaticRetirementAge ? retirementAge : null;
  for (let age = currentAge; age <= lifeExpectancy; age += 1) {
    const pointMonth = monthAtAge(age);
    const years = Math.max(0, monthsBetweenYearMonths(currentMonth, pointMonth)) / 12;
    const expense = expenseAtMonth(pointMonth);
    const required = targetFor(expense);
    const accumulationAssets = futureValue({ principal:currentAssets, monthlyContribution, annualReturnRate, years });
    if (!automaticRetirementAge && achievedAge == null && accumulationAssets >= required) achievedAge = age;
    if (age <= targetAge) series.push({ age, year:Number(pointMonth.slice(0,4)), month:pointMonth, phase:retirementAge!=null&&age===targetAge?'retirement-start':'accumulation', assets:accumulationAssets, openingAssets:null, investmentReturn:null, annualContribution:age===currentAge?0:monthlyContribution*12, monthlyExpense:expense, annualWithdrawal:0, fundedWithdrawal:0, shortfall:0, actualWithdrawalRate:0, targetAssets:required });
  }
  let balance = projectedAssets, depletedAge = null;
  for (let age = targetAge + 1; retirementAge != null && age <= lifeExpectancy; age += 1) {
    const pointMonth=addYearsToYearMonth(birthMonth,age),withdrawalMonth=addYearsToYearMonth(birthMonth,age-1),openingAssets=balance,investmentReturn=openingAssets*priceGrowthRate,monthlyExpense=expenseAtMonth(withdrawalMonth),annualDividend=openingAssets*dividendYield,annualNeed=monthlyExpense*12,annualWithdrawal=Math.max(0,annualNeed-otherMonthlyIncome*12-annualDividend),allowedWithdrawal=openingAssets*withdrawalRate,fundedWithdrawal=Math.min(annualWithdrawal,allowedWithdrawal),shortfall=Math.max(0,annualWithdrawal-fundedWithdrawal);
    balance=Math.max(0,openingAssets+investmentReturn-fundedWithdrawal);
    if (depletedAge==null && (balance<=0 || shortfall>0)) depletedAge=age;
    series.push({ age, year:Number(pointMonth.slice(0,4)), month:pointMonth, phase:'retirement', assets:balance, openingAssets, investmentReturn, annualContribution:0, monthlyExpense, annualDividend, annualWithdrawal, allowedWithdrawal, fundedWithdrawal, shortfall, actualWithdrawalRate:openingAssets>0?fundedWithdrawal/openingAssets:0, targetAssets:null });
  }
  return {
    birthMonth, currentMonth, retirementMonth:retirementAge==null?null:retirementMonth, lifeExpectancyMonth, currentAge, targetAge:retirementAge, lifeExpectancy, yearsToTarget, currentAssets, currentMonthlyExpense, otherMonthlyIncome,
    monthlyContribution, annualReturnRate, inflationRate, withdrawalRate, dividendYield, priceGrowthRate, expenseAtTarget,
    incomeAtTarget, targetAssets, projectedAssets, requiredMonthlyContribution, achievedAge,
    onTime:retirementAge!=null&&projectedAssets >= targetAssets, depletedAge, assetsAtLifeExpectancy:retirementAge==null?null:balance, lastsThroughLife:retirementAge!=null&&depletedAge==null, series,
  };
}
