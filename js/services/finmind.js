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
  let timedOut = false;
  let rejectAborted;
  const aborted = new Promise((_resolve, reject) => { rejectAborted = reject; });
  const onAbort = () => rejectAborted(timedOut
    ? Error('FinMind 連線逾時，系統稍後會自動重試')
    : Object.assign(Error('FinMind 同步已取消'), { name:'AbortError' }));
  const onExternalAbort = () => controller.abort(options.signal?.reason);
  controller.signal.addEventListener('abort', onAbort, { once:true });
  options.signal?.addEventListener('abort', onExternalAbort, { once:true });
  if (options.signal?.aborted) onExternalAbort();
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const request = async () => {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal:controller.signal });
    let body = null;
    try { body = await response.json(); }
    catch (error) {
      if (response.ok) throw Error('FinMind 回傳格式無法解析', { cause:error });
    }
    if (!response.ok) {
      if (response.status === 402) throw Error('FinMind 免費 API 額度已用完，請稍後再手動同步');
      throw Error(body?.msg || `FinMind HTTP ${response.status}`);
    }
    if (!body) throw Error('FinMind 回傳格式無法解析');
    if (body.status && body.status !== 200) throw Error(body.msg || `FinMind status ${body.status}`);
    if (!Array.isArray(body.data)) throw Error('FinMind 回傳資料集合格式錯誤');
    return body.data;
  };
  try {
    if (controller.signal.aborted) return await aborted;
    return await Promise.race([request(), aborted]);
  } finally {
    clearTimeout(timeout);
    controller.signal.removeEventListener('abort', onAbort);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}
