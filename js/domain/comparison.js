import { isIsoCalendarDate } from './transaction-validation.js';
import { splitAdjustedPrice, splitCoverageComplete } from './splits.js';

export function normaliseComparisonDividends(rows) {
  return rows.map(row => ({
    cash: Number(row.cash ?? (Number(row.CashEarningsDistribution || 0) + Number(row.CashStatutorySurplus || 0))),
    stock: Number(row.stock ?? (Number(row.StockEarningsDistribution || 0) + Number(row.StockStatutorySurplus || 0))),
    exDate: row.exDate || row.CashExDividendTradingDate || null,
    stockExDate: row.stockExDate || row.StockExDividendTradingDate || null,
  })).filter(row => row.cash > 0 || row.stock > 0);
}

function dividendCoverageComplete(cache, from, through) {
  return Boolean(!cache?.dividendError && cache?.dividendCoverageFrom <= from
    && cache?.dividendCheckedThrough >= through);
}

export function calculateStockComparison({ symbols, marketCaches, startDate, endDate, reinvestDividends = false, reinvest = false, mode }) {
  if (!isIsoCalendarDate(startDate) || !isIsoCalendarDate(endDate) || startDate >= endDate) throw Error('請選擇有效日期，結束日期須晚於開始日期。');
  if (symbols.length < 2 || symbols.length > 5 || new Set(symbols).size !== symbols.length) throw Error('請選擇 2～5 檔不同股票。');
  const calculationMode = mode ?? (reinvestDividends || reinvest ? 'total' : 'price');
  if (!['price', 'cash', 'stock', 'total'].includes(calculationMode)) throw Error('未知的比較方式。');
  const shouldReinvest = ['cash', 'total'].includes(calculationMode);
  const includeStock = ['stock', 'total'].includes(calculationMode);
  const includeDividends = includeStock || shouldReinvest;
  const prepared = symbols.map(symbol => {
    const cache = marketCaches.find(row => row.symbol === symbol);
    const prices = new Map((cache?.prices || []).filter(row => isIsoCalendarDate(row.date) && row.date >= startDate && row.date <= endDate && Number(row.close) > 0 && Number.isFinite(Number(row.close))).map(row => [row.date, row]));
    if (!prices.size) throw Error(`${symbol} 在這段期間沒有可用價格。`);
    return { symbol, cache, prices };
  });
  const common = [...prepared[0].prices.keys()].filter(date => prepared.every(item => item.prices.has(date))).sort();
  if (common.length < 2) throw Error('共同交易日不足兩天，請調整日期或股票。');
  const actualStart = common[0], actualEnd = common.at(-1);
  for (const { symbol, cache } of prepared) {
    if (!splitCoverageComplete(cache, actualEnd)) throw Error(`${symbol} 分割資料尚未確認，請重新比較。`);
    if (includeDividends && !dividendCoverageComplete(cache, actualStart, actualEnd)) throw Error(`${symbol} 股息資料尚未確認，請重新比較。`);
  }
  const dates = [...new Set(prepared.flatMap(item => [...item.prices.keys()]))].filter(date => date >= actualStart && date <= actualEnd).sort();
  const series = prepared.map(({ symbol, cache, prices }) => {
    const splitEvents = (cache?.splits || []).filter(event => event.date > actualStart && event.date <= actualEnd);
    const dividendEvents = [];
    if (includeDividends) {
      for (const div of cache.dividends || []) {
        for (const [kind, date, amount] of [
          ['cash', div.exDate, shouldReinvest ? Number(div.cash) : 0],
          ['stock', div.stockExDate, includeStock ? Number(div.stock) : 0],
        ]) {
          if (!(amount > 0)) continue;
          if (!isIsoCalendarDate(date)) throw Error(symbol + ' 股息日期資料不足，無法計算。');
          if (date <= actualStart || date > actualEnd) continue;
          if (kind === 'cash' && !prices.has(date)) throw Error(symbol + ' ' + date + ' 除息日缺少收盤價，無法計算再投入。');
          dividendEvents.push({ date, cash: kind === 'cash' ? amount : 0, stock: kind === 'stock' ? amount : 0 });
        }
      }
      dividendEvents.sort((a, b) => a.date.localeCompare(b.date));
    }

    let values;
    if (!includeDividends) {
      const base = splitAdjustedPrice(prices.get(actualStart), cache?.splits, actualEnd);
      values = dates.map(date => prices.has(date) ? (splitAdjustedPrice(prices.get(date), cache?.splits, actualEnd) / base - 1) * 100 : null);
    } else {
      let currentShares = 1;
      let lastTradedDate = actualStart;
      const startPrice = Number(prices.get(actualStart).close);
      values = dates.map(date => {
        if (!prices.has(date)) return null;
        if (date === actualStart) return 0;
        const windowSplits = (cache?.splits || [])
          .filter(e => e.date > lastTradedDate && e.date <= date)
          .map(e => ({ type: 'split', date: e.date, ratio: Number(e.ratio) }));
        const windowDivs = dividendEvents
          .filter(e => e.date > lastTradedDate && e.date <= date)
          .map(e => ({ type: 'div', date: e.date, cash: e.cash, stock: e.stock }));
        const windowEvents = [...windowSplits, ...windowDivs];
        const eventDates = [...new Set(windowEvents.map(event => event.date))].sort();
        const closePrice = Number(prices.get(date).close);
        for (const eventDate of eventDates) {
          const sameDay = windowEvents.filter(event => event.date === eventDate);
          for (const event of sameDay.filter(event => event.type === 'split')) {
            currentShares *= event.ratio;
          }
          // All distributions on one date use the same eligible shares.
          const eligibleShares = currentShares;
          const cash = sameDay.reduce((sum, event) => sum + (event.cash || 0), 0);
          const stock = sameDay.reduce((sum, event) => sum + (event.stock || 0), 0);
          currentShares += eligibleShares * stock / 10;
          if (cash) currentShares += eligibleShares * cash / Number(prices.get(eventDate).close);
        }
        lastTradedDate = date;
        const currentValue = currentShares * closePrice;
        return (currentValue / startPrice - 1) * 100;
      });
    }

    return {
      symbol,
      name: cache?.name || symbol,
      values,
      change: values.at(-1),
      missing: values.filter(value => value === null).length,
      events: splitEvents,
      dividendEvents,
    };
  });
  return { dates, actualStart, actualEnd, requestedStart: startDate, requestedEnd: endDate, reinvestDividends: shouldReinvest, mode: calculationMode, series };
}
