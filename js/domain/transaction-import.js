import { ACQUISITIONS } from '../lib/constants.js';
import { parseCsvRows } from '../lib/csv.js';

const SYMBOL_PATTERN = /^[A-Za-z0-9._-]{1,12}$/;

function isIsoCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function csvSymbol(value) {
  const symbol = String(value || '').trim();
  const match = symbol.match(/^="([^"]+)"$/);
  return match ? match[1] : symbol;
}

function importFingerprint(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `csv:${source.length}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function signature(row) {
  return [row.date, row.acquisitionType, row.symbol, Number(row.quantity), row.price == null ? '' : Number(row.price), Number(row.fee)].join('|');
}

export function planCsvTransactionImport(text, existingTransactions, createId, createdAt = new Date().toISOString()) {
  const fingerprint = importFingerprint(text);
  if (existingTransactions.some(row => row.importFileFingerprint === fingerprint)) {
    return { fingerprint, duplicateFile:true, records:[], errors:[], duplicateRows:[] };
  }

  const existingSignatures = new Set(existingTransactions.map(signature));
  const batchSignatures = new Set();
  const importBatchId = createId();
  const records = [];
  const errors = [];
  const duplicateRows = [];

  parseCsvRows(text).forEach(row => {
    const rawDate = String(row.date || '');
    const date = /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(rawDate) ? rawDate.replaceAll('/', '-') : '';
    const acquisitionType = String(row.acquisition_type || '');
    const symbol = csvSymbol(row.symbol);
    const quantity = Number(row.quantity);
    const price = row.price === '' ? null : Number(row.price);
    const fee = Number(row.fee);
    const error = !isIsoCalendarDate(date) ? '日期必須是有效的 YYYY-MM-DD'
      : !Object.hasOwn(ACQUISITIONS, acquisitionType) ? `取得方式必須是 ${Object.keys(ACQUISITIONS).join('、')}`
      : !SYMBOL_PATTERN.test(symbol) ? '股票代號只能包含英數字、句點、底線或連字號，且最多 12 字元'
      : !(Number.isFinite(quantity) && quantity > 0) ? '股數必須是大於 0 的有限數字'
      : acquisitionType !== 'STOCK_DIVIDEND' && !(Number.isFinite(price) && price > 0) ? '此取得方式的價格必須是大於 0 的有限數字'
      : !(Number.isFinite(fee) && fee >= 0) ? '手續費必須是大於或等於 0 的有限數字'
      : '';
    if (error) { errors.push(`第 ${row._row} 列：${error}`); return; }

    const record = { id:createId(), date, acquisitionType, symbol, quantity, price, fee, importBatchId, importFileFingerprint:fingerprint, sourceRowNumber:row._row, createdAt };
    const rowSignature = signature(record);
    if (existingSignatures.has(rowSignature) || batchSignatures.has(rowSignature)) duplicateRows.push(row._row);
    batchSignatures.add(rowSignature);
    records.push(record);
  });

  return { fingerprint, duplicateFile:false, records, errors, duplicateRows };
}

export { isIsoCalendarDate };
