import { shiftDate } from '../lib/date.js';

export function firstMarketDate(cache) { return (cache?.prices || []).reduce((first,row)=>!first||row.date<first?row.date:first,null); }
export function lastMarketDate(cache) { return (cache?.prices || []).reduce((last,row)=>!last||row.date>last?row.date:last,null); }
export function checkedThrough(cache, kind) { return cache?.[`${kind}CheckedThrough`] || (kind==='price' ? lastMarketDate(cache) : null); }
export function dateMin(...dates) { return dates.filter(Boolean).sort()[0]||null; }
export function dateMax(...dates) { return dates.filter(Boolean).sort().at(-1)||null; }
export function mergeRows(existing, incoming, key) { const rows=new Map((existing||[]).map(row=>[key(row),row]));(incoming||[]).forEach(row=>rows.set(key(row),row));return [...rows.values()]; }
export function dividendKey(row) { return [row.exDate||'',row.paymentDate||'',row.announcementDate||'',row.cash||0,row.stock||0].join('|'); }

export function createMarketSyncPlan({ cache = {}, transactionStart, target, force = false }) {
  const historyStart=dateMin(transactionStart,target), priceFrom=cache.priceCoverageFrom||firstMarketDate(cache), priceThrough=checkedThrough(cache,'price'), dividendThrough=checkedThrough(cache,'dividend');
  const priceBackfill=!priceFrom||(historyStart&&historyStart<priceFrom), dividendBackfill=!cache.dividendCoverageFrom||(historyStart&&historyStart<cache.dividendCoverageFrom);
  const priceNeeded=force||priceBackfill||!priceThrough||priceThrough<target||Boolean(cache.syncErrors?.some(error=>error.startsWith('價格')));
  const dividendNeeded=force||dividendBackfill||!dividendThrough||dividendThrough<target||Boolean(cache.syncErrors?.some(error=>error.startsWith('股息')));
  const priceStart=priceBackfill ? historyStart : force ? dateMax(historyStart,shiftDate(target,-7)) : shiftDate(priceThrough,1);
  const dividendStart=dividendBackfill ? historyStart : dateMax(historyStart,shiftDate(target,-550));
  return {cache,historyStart,priceNeeded,dividendNeeded,priceStart:dateMin(priceStart,target),dividendStart:dateMin(dividendStart,target)};
}
