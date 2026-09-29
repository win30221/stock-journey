import { isIsoCalendarDate } from './transaction-validation.js';
import { splitAdjustedPrice, splitCoverageComplete } from './splits.js';

export function calculateStockComparison({ symbols, marketCaches, startDate, endDate }) {
  if (!isIsoCalendarDate(startDate) || !isIsoCalendarDate(endDate) || startDate >= endDate) throw Error('請選擇有效日期，結束日期須晚於開始日期。');
  if (symbols.length < 2 || symbols.length > 5 || new Set(symbols).size !== symbols.length) throw Error('請選擇 2～5 檔不同股票。');
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
  }
  const dates = [...new Set(prepared.flatMap(item => [...item.prices.keys()]))].filter(date => date >= actualStart && date <= actualEnd).sort();
  const series = prepared.map(({ symbol, cache, prices }) => {
    const base = splitAdjustedPrice(prices.get(actualStart), cache.splits, actualEnd);
    const values = dates.map(date => prices.has(date) ? (splitAdjustedPrice(prices.get(date), cache.splits, actualEnd) / base - 1) * 100 : null);
    return { symbol, name:cache.name || symbol, values, change:values.at(-1), missing:values.filter(value => value === null).length, events:(cache.splits || []).filter(event => event.date > actualStart && event.date <= actualEnd) };
  });
  return { dates, actualStart, actualEnd, requestedStart:startDate, requestedEnd:endDate, series };
}
