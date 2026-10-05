import { shiftDate } from '../lib/date.js';

export function firstMarketDate(cache) { return (cache?.prices || []).reduce((first,row)=>!first||row.date<first?row.date:first,null); }
export function lastMarketDate(cache) {
  return (cache?.prices || []).reduce((last, row) => {
    const close = Number(row.close);
    if (!row.date || !Number.isFinite(close) || close <= 0) return last;
    return !last || row.date > last ? row.date : last;
  }, null);
}
export function checkedThrough(cache, kind) { return cache?.[`${kind}CheckedThrough`] || (kind==='price' ? lastMarketDate(cache) : null); }
export function dateMin(...dates) { return dates.filter(Boolean).sort()[0]||null; }
export function dateMax(...dates) { return dates.filter(Boolean).sort().at(-1)||null; }
export function mergeRows(existing, incoming, key) { const rows=new Map((existing||[]).map(row=>[key(row),row]));(incoming||[]).forEach(row=>rows.set(key(row),row));return [...rows.values()]; }
export function dividendKey(row) { return row.id || [row.exDate||'',row.paymentDate||'',row.announcementDate||''].join('|'); }

export function createMarketSyncPlan({ cache = {}, transactionStart, target, force = false }) {
  const historyStart = dateMin(transactionStart, target);
  const priceFrom = cache.priceCoverageFrom || firstMarketDate(cache);
  const latestPriceDate = lastMarketDate(cache);
  // Older caches may have recorded a successful request as complete even
  // though the source had not published the target day's quote yet.
  const priceThrough = latestPriceDate ? dateMin(checkedThrough(cache, 'price'), latestPriceDate) : null;
  const dividendThrough = checkedThrough(cache, 'dividend');
  // Forecasts need dividends from before the first purchase. The extra history
  // also includes announcements that precede events in the trailing year.
  const dividendHistoryStart=dateMin(historyStart,shiftDate(target,-550));
  const priceBackfill=!priceFrom||(historyStart&&historyStart<priceFrom), dividendBackfill=!cache.dividendCoverageFrom||dividendHistoryStart<cache.dividendCoverageFrom;
  const priceNeeded=force||priceBackfill||!priceThrough||priceThrough<target||Boolean(cache.syncErrors?.some(error=>error.startsWith('價格')));
  const dividendNeeded=force||dividendBackfill||!dividendThrough||dividendThrough<target||Boolean(cache.syncErrors?.some(error=>error.startsWith('股息')));
  const priceStart=priceBackfill || !priceThrough ? historyStart : force ? dateMax(historyStart,shiftDate(target,-7)) : shiftDate(priceThrough,1);
  // Each successful dividend response is a complete snapshot of this range.
  // Callers replace that snapshot, including an empty response, so corrections
  // and cancellations do not leave stale events in the cache.
  return {cache,historyStart,dividendHistoryStart,priceNeeded,dividendNeeded,priceStart:dateMin(priceStart,target),dividendStart:dividendHistoryStart};
}
