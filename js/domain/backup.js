const SAFE_ID = /^[A-Za-z0-9:_-]{1,100}$/;
const SAFE_SYMBOL = /^[A-Za-z0-9._-]{1,12}$/;
const BACKUP_BUDGET_BUCKETS = new Set(['NEED', 'WANT']);
const BACKUP_BUDGET_MODES = new Set(['RECURRING', 'REPLACEMENT']);
const BACKUP_BUDGET_FREQUENCIES = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'EVERY_N_MONTHS', 'EVERY_N_YEARS']);

function isPlainObject(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function isFiniteNumber(value) { return Number.isFinite(Number(value)); }
function backupIsoCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function assertRecordIds(records, label) {
  const ids = new Set();
  records.forEach((record, index) => {
    if (!isPlainObject(record) || !String(record.id || '').trim()) throw Error(`${label}第 ${index + 1} 筆缺少 id`);
    if (!SAFE_ID.test(record.id)) throw Error(`${label}第 ${index + 1} 筆的 id 格式不安全`);
    if (ids.has(record.id)) throw Error(`${label}包含重複 id：${record.id}`);
    ids.add(record.id);
  });
}

export function validateBackupPayload(data, expectedSchemaVersion, acquisitionTypes) {
  if (!isPlainObject(data) || data.schemaVersion !== expectedSchemaVersion) throw Error(`請選擇目前版本的備份檔（schemaVersion: ${expectedSchemaVersion}）`);
  if (!Array.isArray(data.transactions) || !isPlainObject(data.settings) || !Array.isArray(data.budgetPlans) || !Array.isArray(data.budgetItems)) throw Error('備份檔缺少必要的資料集合');
  assertRecordIds(data.transactions, '交易紀錄');
  assertRecordIds(data.budgetPlans, '退休計畫');
  assertRecordIds(data.budgetItems, '退休預算');
  if (data.settings.id != null && !SAFE_ID.test(data.settings.id)) throw Error('設定 id 格式不安全');
  data.transactions.forEach((transaction, index) => {
    const prefix = `交易紀錄第 ${index + 1} 筆`;
    if (!backupIsoCalendarDate(transaction.date)) throw Error(`${prefix}日期格式錯誤`);
    if (!acquisitionTypes.includes(transaction.acquisitionType)) throw Error(`${prefix}取得方式錯誤`);
    if (!SAFE_SYMBOL.test(transaction.symbol || '')) throw Error(`${prefix}股票代號格式錯誤`);
    if (!(isFiniteNumber(transaction.quantity) && Number(transaction.quantity) > 0)) throw Error(`${prefix}股數必須是大於 0 的有限數字`);
    if (transaction.acquisitionType !== 'STOCK_DIVIDEND' && !(isFiniteNumber(transaction.price) && Number(transaction.price) > 0)) throw Error(`${prefix}成交價必須是大於 0 的有限數字`);
    if (!(isFiniteNumber(transaction.fee) && Number(transaction.fee) >= 0)) throw Error(`${prefix}手續費不得小於 0`);
  });
  if (data.settings.dividendDateBasis != null && !['PAYMENT_DATE', 'EX_DIVIDEND_DATE'].includes(data.settings.dividendDateBasis)) throw Error('設定中的股息日期基準錯誤');
  data.budgetPlans.forEach((plan, index) => {
    const prefix = `退休計畫第 ${index + 1} 筆`;
    if (plan.selectedTarget != null && !['NEEDS_ONLY', 'NEEDS_AND_WANTS'].includes(plan.selectedTarget)) throw Error(`${prefix}目標類型錯誤`);
    if (plan.bufferRateBps != null && !(isFiniteNumber(plan.bufferRateBps) && Number(plan.bufferRateBps) >= 0 && Number(plan.bufferRateBps) <= 5000)) throw Error(`${prefix}緩衝比例錯誤`);
  });
  data.budgetItems.forEach((item, index) => {
    const prefix = `退休預算第 ${index + 1} 筆`;
    if (!BACKUP_BUDGET_BUCKETS.has(item.bucket)) throw Error(`${prefix}生活層級錯誤`);
    if (!String(item.name || '').trim() || String(item.name).length > 40) throw Error(`${prefix}項目名稱錯誤`);
    if (!BACKUP_BUDGET_MODES.has(item.calculationMode)) throw Error(`${prefix}計算方式錯誤`);
    if (!(isFiniteNumber(item.occurrenceAmount) && Number(item.occurrenceAmount) >= 0)) throw Error(`${prefix}金額錯誤`);
    if (item.calculationMode === 'REPLACEMENT') {
      if (!(isFiniteNumber(item.replacementCycleYears) && Number(item.replacementCycleYears) >= 0.1 && Number(item.replacementCycleYears) <= 50)) throw Error(`${prefix}汰換週期錯誤`);
    } else {
      if (!BACKUP_BUDGET_FREQUENCIES.has(item.frequency)) throw Error(`${prefix}頻率錯誤`);
      if (['EVERY_N_MONTHS', 'EVERY_N_YEARS'].includes(item.frequency) && !(isFiniteNumber(item.intervalCount) && Number(item.intervalCount) >= 1 && Number(item.intervalCount) <= 120)) throw Error(`${prefix}間隔錯誤`);
    }
    if (item.note != null && String(item.note).length > 120) throw Error(`${prefix}備註過長`);
  });
  return data;
}
