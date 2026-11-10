import { quantityAtDate, splitFactor, splitCoverageComplete } from './splits.js';
function transactionQuantityIndex(transactions, marketCaches = []) {
  const bySymbol = new Map();
  transactions.forEach(row => { const rows=bySymbol.get(row.symbol)||[]; rows.push(row); bySymbol.set(row.symbol,rows); });
  bySymbol.splits = new Map(marketCaches.map(cache => [cache.symbol, cache.splits || []]));
  return bySymbol;
}

function quantityFromIndex(index, symbol, date) {
  return quantityAtDate(index.get(symbol) || [], symbol, index.splits.get(symbol), date);
}

function priceDateIndex(marketCaches) {
  return new Map(marketCaches.map(cache => [cache.symbol, (cache.prices || []).map(price=>price.date).sort()]));
}

function previousDateFromIndex(index, symbol, date) {
  const dates = index.get(symbol) || [];
  let low = 0, high = dates.length - 1, match = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (dates[middle] < date) { match = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return match < 0 ? null : dates[match];
}

export function calculateDividendReceipts({ transactions, marketCaches, dateBasis }) {
  const quantities = transactionQuantityIndex(transactions, marketCaches);
  const priceDates = priceDateIndex(marketCaches);
  return marketCaches
    .flatMap(cache => (cache.dividends || []).map(dividend => ({ ...dividend, symbol:cache.symbol })))
    .filter(dividend => Number(dividend.cash) > 0 && (dividend.paymentDate || dividend.exDate))
    .map(dividend => {
      const basis = dateBasis === 'EX_DIVIDEND_DATE' ? dividend.exDate : (dividend.paymentDate || dividend.exDate);
      const eligibleDate = dividend.exDate ? previousDateFromIndex(priceDates, dividend.symbol, dividend.exDate) : null;
      const eligible = eligibleDate ? quantityFromIndex(quantities, dividend.symbol, eligibleDate) * splitFactor(quantities.splits.get(dividend.symbol), eligibleDate, dividend.exDate) : 0;
      return { ...dividend, basis, eligibleDate, eligible, amount:eligible * Number(dividend.cash) };
    })
    .filter(dividend => dividend.eligible > 0 && dividend.basis);
}

export function calculateProjectedAnnualDividends({ transactions, marketCaches, asOfDate, requiredThroughDate = asOfDate }) {
  const end = /^\d{4}-\d{2}-\d{2}$/.test(asOfDate || '') ? asOfDate : new Date().toISOString().slice(0, 10);
  const startDate = new Date(`${end}T00:00:00Z`);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 1);
  const start = startDate.toISOString().slice(0, 10);
  const quantities = transactionQuantityIndex(transactions, marketCaches);
  const requiredThrough = /^\d{4}-\d{2}-\d{2}$/.test(requiredThroughDate || '') ? requiredThroughDate : end;
  const cachesBySymbol = new Map(marketCaches.map(cache => [cache.symbol, cache]));
  const coverage = [...quantities.keys()]
    .filter(symbol => quantityFromIndex(quantities, symbol, end) > 0)
    .map(symbol => {
      const cache = cachesBySymbol.get(symbol);
      const from = cache?.dividendCoverageFrom || null;
      const through = cache?.dividendCheckedThrough || null;
      return { symbol, from, through, complete:Boolean(from && from <= start && through && through >= requiredThrough && splitCoverageComplete(cache, requiredThrough)) };
    });
  const incompleteSymbols = coverage.filter(row => !row.complete).map(row => row.symbol);
  const rows = marketCaches.flatMap(cache => (cache.dividends || []).map(dividend => ({ ...dividend, symbol:cache.symbol })))
    .filter(dividend => Number(dividend.cash) > 0)
    .filter(dividend => {
      const eventDate=dividend.exDate || dividend.paymentDate;
      return eventDate && eventDate > start && eventDate <= end;
    })
    .map(dividend => {
      const quantity=quantityFromIndex(quantities, dividend.symbol, end);
      const eventDate = dividend.exDate || dividend.paymentDate;
      const cash = Number(dividend.cash) / splitFactor(cachesBySymbol.get(dividend.symbol)?.splits, eventDate, end);
      return { symbol:dividend.symbol, date:eventDate, cash, originalCash:Number(dividend.cash), quantity, amount:quantity * cash };
    })
    .filter(row => row.amount > 0);
  return { start, end, rows, annual:rows.reduce((total,row)=>total+row.amount,0), coverageComplete:incompleteSymbols.length === 0, incompleteSymbols, coverage };
}

export function calculateStockDividendChecks(transactions, marketCaches) {
  const quantities = transactionQuantityIndex(transactions, marketCaches);
  const priceDates = priceDateIndex(marketCaches);
  const events = marketCaches.flatMap(cache => (cache.dividends || []).filter(dividend => Number(dividend.stock) > 0 && dividend.exDate).map(dividend => ({ ...dividend, symbol:cache.symbol })));
  return events.map(event => {
    const eligibleDate = previousDateFromIndex(priceDates, event.symbol, event.exDate);
    return {
      event,
      eligibleDate,
      matching:transactions.find(row => row.acquisitionType === 'STOCK_DIVIDEND' && row.symbol === event.symbol && row.date === event.exDate),
      expected:(eligibleDate ? quantityFromIndex(quantities, event.symbol, eligibleDate) * splitFactor(quantities.splits.get(event.symbol), eligibleDate, event.exDate) : 0) * Number(event.stock) / 10,
    };
  });
}

export function summarizeDividends(receipts, transactionRows, now = new Date(), currentDate = null) {
  const months = [];
  const cursor = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const first = transactionRows.length ? [...transactionRows].sort((a,b) => a.date.localeCompare(b.date))[0].date.slice(0,7) : null;
  while (first && `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}` >= first) {
    months.unshift(`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}`);
    cursor.setMonth(cursor.getMonth()-1);
  }
  const monthly = {}, paidMonthly = {};
  const today = currentDate || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  receipts.forEach(row => {
    const month=row.basis.slice(0,7);
    monthly[month]=(monthly[month]||0)+row.amount;
    if ((row.paymentDate || row.basis) <= today) paidMonthly[month]=(paidMonthly[month]||0)+row.amount;
  });
  const year=now.getFullYear(), elapsedMonths=now.getMonth()+1;
  const yearMonths=Array.from({length:elapsedMonths},(_,index)=>`${year}-${String(index+1).padStart(2,'0')}`);
  const avg=yearMonths.reduce((total,month)=>total+(paidMonthly[month]||0),0)/elapsedMonths;
  return { rows:receipts, months, monthly, paidMonthly, avg, yearMonths, elapsedMonths };
}
