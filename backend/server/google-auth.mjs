const GOOGLE_KEYS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
let googleKeysCache = null;

function decodePart(part) {
  const bytes = Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
  return bytes;
}

// fetchKeys and now are explicit seams for verification tests; never supplied by a request.
export async function verifyGoogleCredential(credential, clientId, nonce, {
  fetchKeys = fetch, now = Date.now(),
} = {}) {
  if (typeof credential !== 'string' || credential.length > 16000 || !nonce) throw Error('Google 登入憑證無效');
  const parts = credential.split('.');
  if (parts.length !== 3) throw Error('Google 登入憑證無效');
  const header = JSON.parse(new TextDecoder().decode(decodePart(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(decodePart(parts[1])));
  const seconds = Math.floor(now / 1000);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string'
    || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss)
    || claims.aud !== clientId || claims.nonce !== nonce
    || !Number.isFinite(claims.exp) || claims.exp <= seconds
    || !Number.isFinite(claims.iat) || claims.iat > seconds + 60
    || typeof claims.sub !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(claims.sub)) {
    throw Error('Google 登入憑證已失效或不屬於此網站');
  }
  if (!googleKeysCache || googleKeysCache.expires <= now || googleKeysCache.fetchKeys !== fetchKeys) {
    const response = await fetchKeys(GOOGLE_KEYS_URL, { signal:AbortSignal.timeout(10000) });
    if (!response.ok) throw Error('無法驗證 Google 登入，請稍後重試');
    const body = await response.json();
    if (!Array.isArray(body.keys)) throw Error('Google 金鑰格式錯誤');
    googleKeysCache = { keys:body.keys, expires:now + 3600000, fetchKeys };
  }
  const jwk = googleKeysCache.keys.find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) throw Error('Google 登入金鑰已更新，請稍後重試');
  const key = await crypto.subtle.importKey('jwk', jwk, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodePart(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw Error('Google 登入簽章無效');
  return { id:claims.sub, name:String(claims.name || 'Google 使用者').slice(0, 200), email:String(claims.email || '').slice(0, 320) };
}
