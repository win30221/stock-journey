import { today } from '../lib/date.js';

const FINMIND_ENDPOINT = 'https://api.finmindtrade.com/api/v4/data';
const DEFAULT_TIMEOUT_MS = 20000;

export async function fetchFinMindData(dataset, symbol = null, startDate = null, endDate = today(), options = {}) {
  const url = new URL(FINMIND_ENDPOINT);
  const params = { dataset };
  if (symbol) params.data_id = symbol;
  if (startDate) Object.assign(params, { start_date: startDate, end_date: endDate });
  url.search = new URLSearchParams(params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, signal:controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw Error('FinMind 連線逾時，系統稍後會自動重試');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    if (response.status === 402) throw Error('FinMind 免費 API 額度已用完，請稍後再手動同步');
    throw Error(body?.msg || `FinMind HTTP ${response.status}`);
  }
  if (!body) throw Error('FinMind 回傳格式無法解析');
  if (body.status && body.status !== 200) throw Error(body.msg || `FinMind status ${body.status}`);
  return body.data || [];
}
