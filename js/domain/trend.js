import { ACQUISITIONS } from '../lib/constants.js';
import { calculateTransactionCost } from './portfolio.js';
import { calculateDividendReceipts } from './dividends.js';

export function calculateTrendHistory({ transactions, marketCaches, dateBasis, asOfDate }) {
  if (!transactions.length) return [];
  const cachesBySymbol = new Map(marketCaches.map(cache => [cache.symbol, cache]));
  const first = [...transactions].sort((a, b) => a.date.localeCompare(b.date))[0].date;
  const symbols = [...new Set(transactions.map(transaction => transaction.symbol))];
  const prices = Object.fromEntries(symbols.map(symbol => [
    symbol,
    [...(cachesBySymbol.get(symbol)?.prices || [])]
      .filter(price => price.date >= first)
      .sort((a, b) => a.date.localeCompare(b.date)),
  ]));
  const dividends = calculateDividendReceipts({ transactions, marketCaches, dateBasis })
    .reduce((map, row) => {
      map[row.basis] = (map[row.basis] || 0) + row.amount;
      return map;
    }, {});
  // Dividend data contains announced future payment dates. They are useful in the
  // dividend view, but must never extend an asset-history chart beyond today.
  const dates = [...new Set([
    ...transactions.map(transaction => transaction.date),
    ...Object.values(prices).flat().map(price => price.date),
    ...Object.keys(dividends),
  ])].filter(date => date >= first && date <= asOfDate).sort();
  const firstDates = transactions.reduce((map, transaction) => {
    if (!map[transaction.symbol] || transaction.date < map[transaction.symbol]) {
      map[transaction.symbol] = transaction.date;
    }
    return map;
  }, {});
  const transactionsByDate = transactions.reduce((map, transaction) => {
    (map[transaction.date] ||= []).push(transaction);
    return map;
  }, {});
  const cursor = Object.fromEntries(symbols.map(symbol => [symbol, 0]));
  const latest = Object.fromEntries(symbols.map(symbol => [symbol, null]));
  const quantities = Object.fromEntries(symbols.map(symbol => [symbol, 0]));
  const bookValues = Object.fromEntries(symbols.map(symbol => [symbol, 0]));
  let external = 0, reinvested = 0;

  return dates.map(date => {
    for (const symbol of symbols) {
      while (cursor[symbol] < prices[symbol].length && prices[symbol][cursor[symbol]].date <= date) {
        latest[symbol] = prices[symbol][cursor[symbol]++];
      }
    }
    let dailyInvest = 0, dailyReinvest = 0;
    const todayTransactions = transactionsByDate[date] || [];
    for (const transaction of todayTransactions) {
      const amount = calculateTransactionCost(transaction);
      quantities[transaction.symbol] += Number(transaction.quantity);
      bookValues[transaction.symbol] += amount;
      if (['MANUAL_BUY', 'RECURRING_INVESTMENT'].includes(transaction.acquisitionType)) {
        external += amount;
        dailyInvest += amount;
      }
      if (transaction.acquisitionType === 'DIVIDEND_REINVESTMENT') {
        reinvested += amount;
        dailyReinvest += amount;
      }
    }
    const missing = [];
    const market = symbols.reduce((sum, symbol) => {
      if (!quantities[symbol]) return sum;
      if (latest[symbol]) return sum + quantities[symbol] * Number(latest[symbol].close);
      missing.push(symbol);
      return sum + bookValues[symbol];
    }, 0);
    const events = todayTransactions.map(transaction => ({
      type: transaction.acquisitionType,
      label: ACQUISITIONS[transaction.acquisitionType],
      symbol: transaction.symbol,
      quantity: Number(transaction.quantity),
      amount: calculateTransactionCost(transaction),
      isNew: firstDates[transaction.symbol] === date,
    }));
    return {
      date, market, external, reinvested, dailyInvest, dailyReinvest,
      dividends: dividends[date] || 0,
      missing,
      estimated: missing.length > 0,
      transactions: todayTransactions.length,
      events,
    };
  });
}

export function aggregateTrendMonths(daily) {
  const months = new Map();
  for (const row of daily) {
    const key = row.date.slice(0, 7), previous = months.get(key);
    months.set(key, {
      ...row,
      dailyInvest:(previous?.dailyInvest || 0) + row.dailyInvest,
      dailyReinvest:(previous?.dailyReinvest || 0) + row.dailyReinvest,
      dividends:(previous?.dividends || 0) + row.dividends,
      missing:[...new Set([...(previous?.missing || []), ...row.missing])],
      estimated:Boolean(previous?.estimated || row.estimated),
      transactions:(previous?.transactions || 0) + row.transactions,
      events:[...(previous?.events || []), ...row.events],
      milestones:[],
    });
  }
  return [...months.values()];
}

// Keep only the current dataset. Source arrays are replaced after every data write.
export function memoizeLatest(compute) {
  let previousKeys = null, value;
  return (...keys) => {
    if (!previousKeys || keys.length !== previousKeys.length || keys.some((key,index) => key !== previousKeys[index])) {
      value = compute(...keys);
      previousKeys = keys;
    }
    return value;
  };
}
