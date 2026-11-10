const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { createAppFixture } = require('./support/app-fixture.cjs');

function d1Fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync('backend/migrations/0001_accounts.sql', 'utf8'));
  t.after(() => sqlite.close());
  const db = {
    prepare(sql) {
      return {
        args:[],
        bind(...args) { this.args = args; return this; },
        async first() { return sqlite.prepare(sql).get(...this.args) || null; },
        async run() { return { meta:{ changes:Number(sqlite.prepare(sql).run(...this.args).changes) } }; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { db, sqlite };
}

async function apiFixture(t) {
  const { handleApi } = await import('../backend/server/api.mjs');
  const { db, sqlite } = d1Fixture(t);
  const env = { DB:db, GOOGLE_CLIENT_ID:'test-client' };
  const options = { now:1800000000000, verifyCredential:async (credential, client, nonce) => {
    assert.equal(client, 'test-client');
    assert.ok(nonce);
    if (!['alice', 'bob'].includes(credential)) throw Error('invalid');
    return { id:credential, name:credential, email:`${credential}@example.com` };
  } };
  async function call(path, { method = 'GET', body, cookie = '', accountId, origin = 'https://stocks.example' } = {}) {
    return handleApi(new Request(`https://stocks.example/api/${path}`, {
      method, headers:{ Cookie:cookie, Origin:origin, 'Content-Type':'application/json', ...(accountId ? { 'X-Account-ID':accountId } : {}) },
      body:body === undefined ? undefined : JSON.stringify(body),
    }), env, options);
  }
  async function login(id) {
    const config = await call('config');
    const nonce = config.headers.getSetCookie()[0].split(';')[0];
    const response = await call('login', { method:'POST', cookie:nonce, body:{ credential:id } });
    assert.equal(response.status, 200);
    return response.headers.getSetCookie()[0].split(';')[0];
  }
  return { call, login, sqlite, env, handleApi, options };
}

test('D1 API isolates accounts, compares revisions and atomically replaces/restores personal data', async t => {
  const { call, login, sqlite } = await apiFixture(t);
  const alice = await login('alice');
  const bob = await login('bob');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
  assert.equal(sqlite.prepare('SELECT token_hash FROM sessions LIMIT 1').get().token_hash.includes(alice.split('=')[1]), false);
  const get = (cookie, accountId) => call('data', { cookie, accountId });
  const initial = await (await get(alice, 'alice')).json();
  const data = { ...initial.data, transactions:[{ id:'trade1', date:'2026-11-10', symbol:'0050', quantity:10, price:100, fee:0, acquisitionType:'MANUAL_BUY' }] };
  const save = await call('data', { method:'PUT', cookie:alice, accountId:'alice', body:{ revision:0, data } });
  assert.equal(save.status, 200);
  assert.equal((await (await get(bob, 'bob')).json()).data.transactions.length, 0);
  assert.equal((await get(alice, 'bob')).status, 409);
  assert.equal((await call('data', { method:'PUT', cookie:alice, accountId:'alice', body:{ revision:0, data:initial.data } })).status, 409);
  const invalid = structuredClone(data);
  invalid.transactions[0].quantity = -1;
  assert.equal((await call('data', { method:'PUT', cookie:alice, accountId:'alice', body:{ revision:1, data:invalid } })).status, 400);
  assert.deepEqual((await (await get(alice, 'alice')).json()).data, data);
  assert.equal((await call('data', { method:'PUT', cookie:alice, accountId:'alice', body:{ revision:1, data:initial.data } })).status, 200);
  assert.deepEqual((await (await get(alice, 'alice')).json()).data, initial.data);
});

test('sessions require nonce, same origin, account binding and expire/revoke without cacheable responses', async t => {
  const { call, login, handleApi, env, options } = await apiFixture(t);
  assert.equal((await call('login', { method:'POST', body:{ credential:'alice' } })).status, 401);
  assert.equal((await call('data')).status, 401);
  const cookie = await login('alice');
  const response = await call('session', { cookie });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal((await call('logout', { method:'POST', body:{}, cookie, accountId:'alice', origin:'https://evil.example' })).status, 403);
  assert.equal((await call('logout', { method:'POST', body:{}, cookie, accountId:'bob' })).status, 409);
  const expired = await handleApi(new Request('https://stocks.example/api/session', { headers:{ Cookie:cookie } }), env, { ...options, now:options.now + 8 * 86400000 });
  assert.equal(expired.status, 401);
  const logout = await call('logout', { method:'POST', body:{}, cookie, accountId:'alice' });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.getSetCookie()[0], /HttpOnly; Secure; SameSite=Lax; Max-Age=0/);
  assert.equal((await call('session', { cookie })).status, 401);
});

test('cloud repositories queue writes, retain failed revisions and never publish a failed save', async () => {
  const { createCloudDataStore } = await import('../frontend/js/repositories/cloud.js');
  const { emptyAccountData } = await import('../backend/server/api.mjs');
  let data = emptyAccountData(), revision = 0, fail = false, reads = 0;
  const store = createCloudDataStore({ request:async (path, options) => {
    if (!options) { reads++; return { data:structuredClone(data), revision }; }
    if (fail || options.body.revision !== revision) throw Error('conflict');
    data = options.body.data;
    return { revision:++revision };
  } });
  const repo = store.repository('transactions');
  await Promise.all([repo.save({ id:'a' }), repo.save({ id:'b' })]);
  assert.equal(reads, 1);
  assert.deepEqual((await repo.list()).map(row => row.id), ['a', 'b']);
  const exposed = await repo.list();
  exposed[0].id = 'mutated';
  assert.equal((await repo.list())[0].id, 'a');
  fail = true;
  await assert.rejects(repo.remove('a'), /conflict/);
  assert.equal((await repo.list()).length, 2);
  fail = false;
  await repo.removeMany(['a']);
  await store.replace(emptyAccountData());
  assert.deepEqual(await repo.list(), []);
});

test('Google JWT verification checks the signature, audience, issuer, expiry and nonce', async () => {
  const { verifyGoogleCredential } = await import('../backend/server/google-auth.mjs');
  const pair = await crypto.subtle.generateKey({ name:'RSASSA-PKCS1-v1_5', modulusLength:2048, publicExponent:new Uint8Array([1, 0, 1]), hash:'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid:'test' };
  const now = 1800000000000;
  const fetchKeys = async () => Response.json({ keys:[jwk] });
  const claims = { sub:'123456', aud:'client', iss:'https://accounts.google.com', iat:now / 1000, exp:now / 1000 + 300, nonce:'challenge' };
  async function sign(body, header = { alg:'RS256', kid:'test' }) {
    const input = [header, body].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input));
    return `${input}.${Buffer.from(signature).toString('base64url')}`;
  }
  const token = await sign(claims);
  assert.equal((await verifyGoogleCredential(token, 'client', 'challenge', { fetchKeys, now })).id, '123456');
  for (const patch of [{ aud:'other' }, { iss:'https://evil.example' }, { exp:now / 1000 }, { nonce:'other' }]) {
    await assert.rejects(verifyGoogleCredential(await sign({ ...claims, ...patch }), 'client', 'challenge', { fetchKeys, now }));
  }
  const pieces = token.split('.');
  pieces[2] = Buffer.alloc(256).toString('base64url');
  await assert.rejects(verifyGoogleCredential(pieces.join('.'), 'client', 'challenge', { fetchKeys, now }), /簽章/);
});

test('cloud startup waits for Google login without reading or seeding private browser data', async t => {
  const f = createAppFixture(t);
  f.context.location.protocol = 'https:';
  f.element('loginStatus');
  f.nodes.set('meta[name="stock-journey-storage"]', { content:'cloud' });
  f.context.AbortSignal = AbortSignal;
  let initialization;
  f.context.google = { accounts:{ id:{ initialize:options => { initialization = options; }, renderButton:() => {} } } };
  const paths = [];
  f.context.fetch = async path => {
    paths.push(path);
    return path === '/api/session' ? Response.json({ error:'login' }, { status:401 }) : Response.json({ clientId:'client', nonce:'challenge' });
  };
  await f.run('load()');
  assert.deepEqual(paths, ['/api/session', '/api/config']);
  assert.equal(f.storage.size, 0);
  assert.equal(f.run('transactions.length + budgetPlans.length + budgetItems.length'), 0);
  assert.equal(initialization.nonce, 'challenge');
});

test('authenticated frontend loads and saves through D1 and rejects another tab changing the account', async t => {
  const { handleApi, env, options, login, call } = await apiFixture(t);
  let cookie = await login('alice');
  const f = createAppFixture(t);
  f.context.location.protocol = 'https:';
  f.nodes.set('meta[name="stock-journey-storage"]', { content:'cloud' });
  f.context.AbortSignal = AbortSignal;
  f.context.fetch = async (path, init) => handleApi(new Request(`https://stocks.example${path}`, {
    ...init, headers:{ ...init.headers, Cookie:cookie, Origin:'https://stocks.example' },
  }), env, options);
  await f.run('load()');
  assert.equal(f.run('cloudUser.id'), 'alice');
  assert.equal(f.run('budgetPlans.length'), 1);
  assert.equal(f.storage.size, 0);
  await f.run(`transactionRepository.save({ id:'online-trade', date:'2026-11-10', symbol:'0050', quantity:5, price:100, fee:0, acquisitionType:'MANUAL_BUY' })`);
  const response = await call('data', { cookie, accountId:'alice' });
  assert.equal((await response.json()).data.transactions[0].id, 'online-trade');
  cookie = await login('bob');
  await assert.rejects(f.run(`transactionRepository.remove('online-trade')`), /帳號已變更/);
  assert.equal((await (await call('data', { cookie, accountId:'bob' })).json()).data.transactions.length, 0);
});
