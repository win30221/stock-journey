import { verifyGoogleCredential } from './google-auth.mjs';
import { validateBackupPayload } from '../../frontend/js/domain/backup.js';
import { ACQUISITIONS, BACKUP_SCHEMA_VERSION } from '../../frontend/js/lib/constants.js';

const SESSION_COOKIE = '__Host-sj_session';
const NONCE_COOKIE = '__Host-sj_nonce';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
export const MAX_ACCOUNT_BYTES = 512 * 1024;

export function emptyAccountData() {
  return { transactions:[], settings:[], budgetPlans:[], budgetItems:[] };
}

function apiError(status, message) {
  return Object.assign(Error(message), { status });
}

function jsonResponse(body, status = 200, cookies = []) {
  const headers = new Headers({ 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(body), { status, headers });
}

function cookieValue(request, name) {
  return (request.headers.get('Cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}

function authCookie(name, value, age) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
}

async function tokenHash(token) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function readJsonBody(request, maximum) {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw apiError(415, '僅接受 JSON 資料');
  const reader = request.body?.getReader();
  if (!reader) throw apiError(400, '缺少資料');
  let size = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) {
      await reader.cancel();
      throw apiError(413, '資料超過第一版容量上限（512 KiB），請減少資料後重試');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw apiError(400, 'JSON 格式錯誤');
  }
}

export function validateAccountData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || Object.keys(data).some(key => !['transactions', 'settings', 'budgetPlans', 'budgetItems'].includes(key))
    || !Array.isArray(data.settings) || data.settings.length > 1
    || data.settings.some(value => !value || value.id !== 'default')) throw apiError(400, '帳號資料格式錯誤');
  try {
    validateBackupPayload({ ...data, schemaVersion:BACKUP_SCHEMA_VERSION, settings:data.settings[0] || {} }, BACKUP_SCHEMA_VERSION, Object.keys(ACQUISITIONS));
    if (data.budgetPlans.length > 1) throw Error('每個帳號僅能有一份退休計畫');
    const planIds = new Set(data.budgetPlans.map(plan => plan.id));
    if (data.budgetItems.some(item => !planIds.has(item.planId))) throw Error('預算項目缺少對應退休計畫');
  } catch (error) {
    throw apiError(400, error.message);
  }
  const serialized = JSON.stringify(data);
  if (new TextEncoder().encode(serialized).byteLength > MAX_ACCOUNT_BYTES) throw apiError(413, '帳號資料超過 512 KiB 上限');
  return serialized;
}

async function requireSession(request, db, now) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!/^[a-f0-9]{64}$/.test(token)) throw apiError(401, '請重新使用 Google 登入；尚未儲存的輸入請先保留');
  const hash = await tokenHash(token);
  const user = await db.prepare('SELECT users.id, users.name, users.email FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').bind(hash, now).first();
  if (!user) throw apiError(401, '登入已過期，請重新登入；尚未儲存的輸入請先保留');
  return { user, hash };
}

export async function handleApi(request, env, { verifyCredential = verifyGoogleCredential, now = Date.now() } = {}) {
  try {
    const url = new URL(request.url);
    if (url.protocol !== 'https:') throw apiError(400, '雲端登入需要 HTTPS');
    if (!env.DB || !env.GOOGLE_CLIENT_ID) throw apiError(503, '雲端服務尚未設定完成，請設定 DB 與 GOOGLE_CLIENT_ID');
    const path = url.pathname.replace(/\/$/, '');
    const method = request.method;
    if (!['GET', 'POST', 'PUT'].includes(method)) throw apiError(405, '不支援此操作');
    if (method !== 'GET' && request.headers.get('Origin') !== url.origin) throw apiError(403, '請從本站進行操作');
    if (path === '/api/config' && method === 'GET') {
      const nonce = crypto.randomUUID();
      return jsonResponse({ clientId:env.GOOGLE_CLIENT_ID, nonce }, 200, [authCookie(NONCE_COOKIE, nonce, 600)]);
    }
    if (path === '/api/login' && method === 'POST') {
      const body = await readJsonBody(request, 20000);
      const nonce = cookieValue(request, NONCE_COOKIE);
      if (!nonce) throw apiError(401, '登入頁已過期，請重新整理');
      let user;
      try {
        user = await verifyCredential(body.credential, env.GOOGLE_CLIENT_ID, nonce);
      } catch {
        throw apiError(401, 'Google 登入驗證失敗，請重新整理後再試');
      }
      const token = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
      const hash = await tokenHash(token);
      const oldHash = await tokenHash(cookieValue(request, SESSION_COOKIE));
      await env.DB.batch([
        env.DB.prepare('INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, email = excluded.email').bind(user.id, user.name, user.email, now),
        env.DB.prepare('INSERT OR IGNORE INTO account_data (user_id, revision, payload, updated_at) VALUES (?, 0, ?, ?)').bind(user.id, JSON.stringify(emptyAccountData()), now),
        env.DB.prepare('DELETE FROM sessions WHERE token_hash = ? OR expires_at <= ?').bind(oldHash, now),
        env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(hash, user.id, now + SESSION_SECONDS * 1000),
      ]);
      return jsonResponse({ user }, 200, [authCookie(SESSION_COOKIE, token, SESSION_SECONDS), authCookie(NONCE_COOKIE, '', 0)]);
    }
    if (path === '/api/logout' && method === 'POST') {
      await readJsonBody(request, 1000);
      const current = await requireSession(request, env.DB, now);
      if (request.headers.get('X-Account-ID') !== current.user.id) throw apiError(409, '登入帳號已變更，請重新整理');
      const hash = await tokenHash(cookieValue(request, SESSION_COOKIE));
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
      return jsonResponse({ ok:true }, 200, [authCookie(SESSION_COOKIE, '', 0)]);
    }
    const { user } = await requireSession(request, env.DB, now);
    if (path === '/api/session' && method === 'GET') return jsonResponse({ user });
    if (request.headers.get('X-Account-ID') !== user.id) throw apiError(409, '登入帳號已變更，請先保留輸入，再重新整理');
    if (path === '/api/data' && method === 'GET') {
      const record = await env.DB.prepare('SELECT revision, payload FROM account_data WHERE user_id = ?').bind(user.id).first();
      if (!record) throw apiError(500, '帳號資料尚未建立');
      return jsonResponse({ revision:record.revision, data:JSON.parse(record.payload) });
    }
    if (path === '/api/data' && method === 'PUT') {
      const body = await readJsonBody(request, MAX_ACCOUNT_BYTES + 100);
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw apiError(400, '缺少資料版本');
      const payload = validateAccountData(body.data);
      const result = await env.DB.prepare('UPDATE account_data SET payload = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?').bind(payload, now, user.id, body.revision).run();
      if (result.meta.changes !== 1) throw apiError(409, '另一個分頁或裝置已更新資料。請先保留目前輸入，再重新整理後重試');
      return jsonResponse({ revision:body.revision + 1 });
    }
    throw apiError(404, '找不到 API');
  } catch (error) {
    return jsonResponse({ error:error.status ? error.message : '雲端服務暫時無法使用，請稍後重試' }, error.status || 500);
  }
}
