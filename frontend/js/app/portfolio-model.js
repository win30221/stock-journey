import { splitAdjustedPrice } from '../domain/splits.js';
import { calculateHoldingGroups, calculatePortfolioMetrics } from '../domain/portfolio.js';
import { calculateDividendReceipts, calculateProjectedAnnualDividends, summarizeDividends } from '../domain/dividends.js';
import { isIsoCalendarDate } from '../domain/transaction-validation.js';

/**
 * Assemble the data a portfolio screen needs without accessing a browser or store.
 * Dates are explicit so the same inputs produce the same result on any host.
 * asOfDate sets holdings, price and split denomination; dividend reporting
 * still includes announced future payments, using their historical entitlement.
 * Callers treat inputs and returned records as read-only and replace changed arrays.
 */
export function calculatePortfolioSnapshot({
  transactions,
  marketCaches,
  dividendDateBasis,
  asOfDate,
  requiredThroughDate = asOfDate,
}) {
  if (!isIsoCalendarDate(asOfDate) || !isIsoCalendarDate(requiredThroughDate)) {
    throw Error('Portfolio snapshot requires valid asOfDate and requiredThroughDate');
  }
  const holdings = calculateHoldingGroups(transactions, marketCaches, asOfDate);
  const latestBySymbol = new Map();
  let latestMarketDate = null;
  for (const cache of marketCaches) {
    let latest = null;
    for (const price of cache.prices || []) {
      if (price.date > asOfDate || !Number.isFinite(Number(price.close)) || Number(price.close) <= 0) continue;
      if (!latest || price.date > latest.date) latest = price;
      if (!latestMarketDate || price.date > latestMarketDate) latestMarketDate = price.date;
    }
    if (!latestBySymbol.has(cache.symbol)) latestBySymbol.set(cache.symbol, latest ? { ...latest, rawClose:latest.close, close:splitAdjustedPrice(latest, cache.splits, asOfDate) } : null);
  }
  const receipts = calculateDividendReceipts({ transactions, marketCaches, dateBasis:dividendDateBasis });
  // summarizeDividends reads local calendar fields. Construct those fields from the
  // supplied date, rather than letting the server's current time choose a month.
  const [year, month, day] = asOfDate.split('-').map(Number);
  const summary = summarizeDividends(receipts, transactions, new Date(year, month - 1, day, 12), asOfDate);
  const portfolio = calculatePortfolioMetrics(holdings, symbol => latestBySymbol.get(symbol) || null, receipts);
  const forecast = calculateProjectedAnnualDividends({ transactions, marketCaches, asOfDate, requiredThroughDate });
  return {
    holdings,
    pricesBySymbol: Object.fromEntries(latestBySymbol),
    latestMarketDate,
    dividendReceipts: receipts,
    dividendSummary: summary,
    metrics: { ...portfolio, div:summary },
    dividendForecast: { ...forecast, yield:portfolio.market > 0 ? forecast.annual / portfolio.market : 0 },
  };
}
