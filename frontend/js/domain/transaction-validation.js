import { ACQUISITIONS } from '../lib/constants.js';

const TRANSACTION_SYMBOL_PATTERN = /^[A-Za-z0-9._-]{1,12}$/;

export function isIsoCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// Keep validation independent from the form, CSV row numbers, and backup messages.
export function validateTransactionFields(row, { acquisitionTypes = Object.keys(ACQUISITIONS) } = {}) {
  if (!isIsoCalendarDate(row.date)) return { field:'date', code:'invalidDate' };
  if (!acquisitionTypes.includes(row.acquisitionType)) return { field:'acquisitionType', code:'invalidAcquisitionType' };
  if (!TRANSACTION_SYMBOL_PATTERN.test(row.symbol || '')) return { field:'symbol', code:'invalidSymbol' };
  const quantity = Number(row.quantity), price = Number(row.price), fee = Number(row.fee);
  if (!(Number.isFinite(quantity) && Number.isInteger(quantity) && quantity >= 1)) return { field:'quantity', code:'invalidQuantity' };
  if (row.acquisitionType !== 'STOCK_DIVIDEND' && !(Number.isFinite(price) && price > 0)) return { field:'price', code:'invalidPrice' };
  if (!(Number.isFinite(fee) && fee >= 0)) return { field:'fee', code:'invalidFee' };
  return null;
}
