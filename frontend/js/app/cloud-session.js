export function isCloudMode() {
  return globalThis.location?.protocol !== 'file:'
    && document.querySelector('meta[name="stock-journey-storage"]')?.content === 'cloud';
}

export async function cloudRequest(path, { method = 'GET', body, accountId } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method, credentials:'same-origin', cache:'no-store',
      headers:{ Accept:'application/json', ...(body === undefined ? {} : { 'Content-Type':'application/json' }), ...(accountId ? { 'X-Account-ID':accountId } : {}) },
      body:body === undefined ? undefined : JSON.stringify(body),
      signal:AbortSignal.timeout(20000),
    });
  } catch {
    throw Error('無法連線雲端。請保留輸入；若儲存結果不明，重新整理確認後再操作');
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw Error('雲端 API 未正確部署，請稍後重試');
  }
  if (!response.ok) throw Object.assign(Error(result.error || '雲端操作失敗'), { status:response.status });
  return result;
}

let googleScriptPromise = null;

export function loadGoogleSignIn() {
  if (globalThis.google?.accounts?.id) return Promise.resolve();
  if (!googleScriptPromise) {
    googleScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        googleScriptPromise = null;
        script.remove();
        reject(Error('Google 登入元件無法載入，請重新整理後再試'));
      };
      document.head.append(script);
    });
  }
  return googleScriptPromise;
}
