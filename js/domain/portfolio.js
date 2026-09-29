import { splitAdjustedQuantity } from './splits.js';
// Pure portfolio calculations. No DOM, IndexedDB, or network dependencies.
export function calculateTransactionCost(transaction) {
  return transaction.acquisitionType === 'STOCK_DIVIDEND'
    ? 0
    : Number(transaction.quantity) * Number(transaction.price || 0) + Number(transaction.fee || 0);
}

export function calculateUnrealizedReturn({ quantity, cost, currentPrice }) {
  const units = Number(quantity);
  const basis = Number(cost);
  const price = Number(currentPrice);
  if (![units, basis, price].every(Number.isFinite) || units <= 0 || basis < 0) return { amount:null, percent:null };
  const amount = price * units - basis;
  return { amount, percent:basis > 0 ? amount / basis * 100 : null };
}

export function calculateHoldingGroups(transactionRows, marketCaches = [], asOfDate = '9999-12-31') {
  const groups = new Map();
  const splits = new Map(marketCaches.map(cache => [cache.symbol, cache.splits || []]));
  transactionRows.filter(row => !row.date || row.date <= asOfDate).forEach(row => {
    const group = groups.get(row.symbol) || { symbol:row.symbol, qty:0, acquisition:0, external:0, reinvested:0 };
    const transactionCost = calculateTransactionCost(row);
    group.qty += splitAdjustedQuantity(row, splits.get(row.symbol), asOfDate);
    group.acquisition += transactionCost;
    if (['MANUAL_BUY', 'RECURRING_INVESTMENT'].includes(row.acquisitionType)) group.external += transactionCost;
    if (row.acquisitionType === 'DIVIDEND_REINVESTMENT') group.reinvested += transactionCost;
    groups.set(row.symbol, group);
  });
  return [...groups.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)).map(group => ({
    ...group,
    avg:group.qty ? group.acquisition / group.qty : null,
  }));
}

export function calculatePortfolioMetrics(holdings, priceForSymbol, dividendRows) {
  const pricedHoldings = holdings.map(holding => ({ ...holding, last: priceForSymbol(holding.symbol) }));
  return {
    holdings: pricedHoldings,
    external: pricedHoldings.reduce((total, holding) => total + holding.external, 0),
    acquisition: pricedHoldings.reduce((total, holding) => total + holding.acquisition, 0),
    reinvested: pricedHoldings.reduce((total, holding) => total + holding.reinvested, 0),
    market: pricedHoldings.reduce((total, holding) => total + (holding.last ? holding.qty * Number(holding.last.close) : holding.acquisition), 0),
    dividends: dividendRows.reduce((total, row) => total + row.amount, 0),
  };
}
