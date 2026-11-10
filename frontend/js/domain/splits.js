import { isIsoCalendarDate } from './transaction-validation.js';

// The feed contains rounded reference prices, not an exact share ratio. Accept
// only an unambiguous small rational within one cent; never use the raw quotient.
export function referenceSplitRatio(before, after) {
  before = Number(before);
  after = Number(after);
  if (!(before > 0 && after > 0 && Number.isFinite(before + after))) return null;
  const candidates = new Set();
  for (let denominator = 1; denominator <= 10; denominator++) {
    for (let numerator = 1; numerator <= 1000; numerator++) {
      const ratio = numerator / denominator;
      if (ratio === 1) continue;
      if (Math.abs(before / ratio - after) <= 0.010001) candidates.add(ratio);
      if (candidates.size > 1) return null;
    }
  }
  return candidates.size === 1 ? [...candidates][0] : null;
}

export function normaliseSplitEvents(rows, symbol, through) {
  if (!Array.isArray(rows)) throw Error('分割清單格式錯誤');
  const events = new Map();
  for (const row of rows) {
    if (!row || !String(row.stock_id ?? row.symbol ?? '').trim()) throw Error('分割清單缺少股票代號');
    if (String(row.stock_id ?? row.symbol) !== symbol) continue;
    if (!isIsoCalendarDate(row.date)) throw Error(`${symbol} 分割日期格式錯誤`);
    if (row.date > through) continue;
    const ratio = referenceSplitRatio(row.before_price, row.after_price);
    if (!ratio) throw Error(`${symbol} ${row.date} 分割比例無法確認`);
    const event = { date:row.date, ratio, type:row.type || (ratio > 1 ? '分割' : '反分割'), beforePrice:Number(row.before_price), afterPrice:Number(row.after_price), ratioSource:'reference-price' };
    if (events.has(row.date) && events.get(row.date).ratio !== ratio) throw Error(`${symbol} ${row.date} 分割資料衝突`);
    events.set(row.date, event);
  }
  return [...events.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Transactions on the effective day already use the NEW share denomination.
export function splitFactor(events = [], from, through) {
  return events.reduce((factor, event) => event.date > from && event.date <= through && Number.isFinite(event.ratio) && event.ratio > 0 ? factor * event.ratio : factor, 1);
}

export function splitAdjustedQuantity(transaction, events, through) {
  if (transaction.date > through) return 0;
  return Number(transaction.quantity) * splitFactor(events, transaction.date, through);
}

export function quantityAtDate(transactions, symbol, events, date) {
  return transactions.filter(row => row.symbol === symbol).reduce((sum, row) => sum + splitAdjustedQuantity(row, events, date), 0);
}

export function splitAdjustedPrice(price, events, through) {
  return Number(price.close) / splitFactor(events, price.date, through);
}

export function splitCoverageComplete(cache, through) {
  return Boolean(cache?.splitCheckedThrough && cache.splitCheckedThrough >= through && !cache.splitError);
}
