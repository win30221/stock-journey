export function quantityAtDate(transactions, symbol, date) {
  return transactions.reduce((total, row) => row.symbol === symbol && row.date <= date ? total + Number(row.quantity) : total, 0);
}

export function previousTradingDate(marketCaches, symbol, date) {
  const cache = marketCaches.find(row => row.symbol === symbol);
  return (cache?.prices || []).reduce((latest, price) => price.date < date && (!latest || price.date > latest) ? price.date : latest, null);
}

function transactionQuantityIndex(transactions) {
  const bySymbol = new Map();
  transactions.forEach(row => { const rows=bySymbol.get(row.symbol)||[]; rows.push(row); bySymbol.set(row.symbol,rows); });
  for (const [symbol, rows] of bySymbol) {
    let quantity = 0;
    bySymbol.set(symbol, rows.sort((a,b)=>a.date.localeCompare(b.date)).map(row => ({ date:row.date, quantity:(quantity += Number(row.quantity)) })));
  }
  return bySymbol;
}

function quantityFromIndex(index, symbol, date) {
  const rows = index.get(symbol) || [];
  let low = 0, high = rows.length - 1, match = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (rows[middle].date <= date) { match = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return match < 0 ? 0 : rows[match].quantity;
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
  const quantities = transactionQuantityIndex(transactions);
  const priceDates = priceDateIndex(marketCaches);
  return marketCaches
    .flatMap(cache => (cache.dividends || []).map(dividend => ({ ...dividend, symbol:cache.symbol })))
    .filter(dividend => Number(dividend.cash) > 0 && (dividend.paymentDate || dividend.exDate))
    .map(dividend => {
      const basis = dateBasis === 'EX_DIVIDEND_DATE' ? dividend.exDate : (dividend.paymentDate || dividend.exDate);
      const eligibleDate = dividend.exDate ? previousDateFromIndex(priceDates, dividend.symbol, dividend.exDate) : null;
      const eligible = eligibleDate ? quantityFromIndex(quantities, dividend.symbol, eligibleDate) : 0;
      return { ...dividend, basis, eligibleDate, eligible, amount:eligible * Number(dividend.cash) };
    })
    .filter(dividend => dividend.eligible > 0 && dividend.basis);
}

export function calculateStockDividendChecks(transactions, marketCaches) {
  const quantities = transactionQuantityIndex(transactions);
  const priceDates = priceDateIndex(marketCaches);
  const events = marketCaches.flatMap(cache => (cache.dividends || []).filter(dividend => Number(dividend.stock) > 0 && dividend.exDate).map(dividend => ({ ...dividend, symbol:cache.symbol })));
  return events.map(event => {
    const eligibleDate = previousDateFromIndex(priceDates, event.symbol, event.exDate);
    return {
      event,
      eligibleDate,
      matching:transactions.find(row => row.acquisitionType === 'STOCK_DIVIDEND' && row.symbol === event.symbol && row.date === event.exDate),
      expected:(eligibleDate ? quantityFromIndex(quantities, event.symbol, eligibleDate) : 0) * Number(event.stock) / 10,
    };
  });
}

export function summarizeDividends(receipts, transactionRows, now = new Date(), currentDate = null) {
  const months = [];
  const cursor = new Date(now.getFullYear(), now.getMonth(), 0);
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
