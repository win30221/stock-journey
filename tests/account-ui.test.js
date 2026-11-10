const assert = require('node:assert/strict');
const test = require('node:test');
const { createAppFixture } = require('./support/app-fixture.cjs');

function eventNode() {
  const listeners = new Map();
  return {
    hidden:false, isConnected:true, attributes:{}, children:[], focused:false,
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    fire(type, event = {}) { listeners.get(type)?.(event); },
    setAttribute(name, value) { this.attributes[name] = value; },
    contains(node) { return node === this || this.children.includes(node); },
    focus() { this.focused = true; },
    listeners,
  };
}

test('account disclosure supports Escape, outside click, Tab exit and listener cleanup', async () => {
  const { bindAccountMenu } = await import('../frontend/js/components/account-menu.js');
  const container = eventNode(), toggle = eventNode(), panel = eventNode(), doc = eventNode();
  container.children = [toggle, panel];
  const dispose = bindAccountMenu({ container, toggle, panel, ownerDocument:doc });
  assert.equal(panel.hidden, true);
  toggle.fire('click');
  assert.equal(toggle.attributes['aria-expanded'], 'true');
  doc.fire('pointerdown', { target:panel });
  assert.equal(panel.hidden, false);
  let prevented = false;
  doc.fire('keydown', { key:'Escape', preventDefault:() => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(toggle.focused, true);
  assert.equal(panel.hidden, true);
  toggle.fire('click');
  container.fire('focusout', { relatedTarget:toggle });
  assert.equal(panel.hidden, false);
  container.fire('focusout', { relatedTarget:{} });
  assert.equal(panel.hidden, true);
  toggle.fire('click');
  doc.fire('pointerdown', { target:{} });
  assert.equal(panel.hidden, true);
  dispose();
  assert.equal(doc.listeners.size, 0);
  assert.equal(toggle.listeners.size, 0);
});

function cloudApp(t) {
  const f = createAppFixture(t);
  const shell = f.element('shell');
  shell.inert = false;
  f.nodes.set('.shell', shell);
  f.element('accountSaveStatus');
  f.element('accountLogout');
  f.run(`
    cloudUser={id:'alice',name:'Alice Example',email:'alice@example.com'};
    accountStore={whenIdle:async()=>{}};
    globalThis.logoutRequests=[];
    cloudRequest=async path=>{logoutRequests.push(path);return {};};
    location.reload=()=>{globalThis.reloaded=true;};
  `);
  return f;
}

test('account identity stays inside the disclosure and birth-month storage copy matches the mode', t => {
  const f = cloudApp(t);
  const markup = f.run('accountControls()');
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /id="accountPanel"[^>]* hidden/);
  assert.match(markup, /id="accountLogout">登出/);
  assert.doesNotMatch(markup, /儲存並登出/);
  assert.match(f.run('overviewBirthMonthPrompt()'), /資料會儲存至你的雲端帳號/);
  f.run('cloudUser=null');
  assert.equal(f.run('accountControls()'), '');
  assert.match(f.run('overviewBirthMonthPrompt()'), /資料只留在這台裝置/);
});

test('logout warns on a changed manual form and returning to edit preserves its input', async t => {
  const f = cloudApp(t);
  const form = f.element('budgetItemForm');
  const input = f.element('draftName');
  Object.assign(input, { name:'name', type:'text', value:'餐費' });
  form.querySelectorAll = () => [input];
  form.querySelector = () => input;
  f.run('bindAccountControls()');
  input.value = '新的餐費草稿';
  assert.equal(f.run('accountSaveLabel()'), '表單尚未送出');
  f.run('confirmDestructive=async options=>{globalThis.confirmationOptions=options;return false;};');
  await f.run('logoutCloudAccount()');
  assert.equal(f.context.confirmationOptions.cancelLabel, '返回編輯');
  assert.equal(input.value, '新的餐費草稿');
  assert.equal(f.doc.activeElement, input);
  assert.equal(f.context.logoutRequests.length, 0);
  assert.equal(f.run('dataMaintenance || logoutInProgress'), false);
  f.run('confirmDestructive=async()=>true;');
  await f.run('logoutCloudAccount()');
  assert.deepEqual(Array.from(f.context.logoutRequests), ['/api/logout']);
  assert.equal(f.context.reloaded, true);
});

test('logout without a changed form skips confirmation and waits for pending autosave', async t => {
  const f = cloudApp(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  f.context.waitForSave = () => gate;
  f.run(`
    confirmDestructive=async()=>{throw Error('Unexpected confirmation');};
    useCloudDataStore({repository:()=>({save:()=>waitForSave()})});
    chartSettingsAutosave.schedule({showTotalAsset:false});
  `);
  const logout = f.run('logoutCloudAccount()');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.context.logoutRequests.length, 0);
  assert.equal(f.run('chartSettingsAutosave.hasPending'), true);
  assert.equal(f.nodes.get('#accountLogout').textContent, '正在儲存設定…');
  release();
  await logout;
  assert.equal(f.run('chartSettingsAutosave.hasPending'), false);
  assert.deepEqual(Array.from(f.context.logoutRequests), ['/api/logout']);
});

test('failed autosave blocks logout and expired login offers a new tab without clearing drafts', async t => {
  const f = cloudApp(t);
  f.run(`
    useCloudDataStore({repository:()=>({save:async()=>{throw Object.assign(Error('expired'),{status:401});}})});
    chartSettingsAutosave.schedule({showTotalAsset:false});
  `);
  await assert.rejects(f.run('logoutCloudAccount()'), /設定尚未儲存/);
  assert.equal(f.context.logoutRequests.length, 0);
  assert.equal(f.run('cloudUser.id'), 'alice');
  assert.equal(f.nodes.get('.shell').inert, false);
  assert.equal(f.context.reloaded, undefined);
  const notice = f.nodes.get('#operationError');
  assert.match(notice.textContent, /目前輸入會保留/);
  const link = notice.children.find(node => node.tagName === 'A');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener');
});

test('cloud save status remains saving while queued writes exist and reports failed writes', async () => {
  const { createCloudDataStore } = await import('../frontend/js/repositories/cloud.js');
  const { emptyAccountData } = await import('../backend/server/api.mjs');
  const states = [];
  let release, revision = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const store = createCloudDataStore({
    onWriteState:event => states.push(event.state),
    request:async (_path, options) => {
      if (!options) return { data:emptyAccountData(), revision:0 };
      await gate;
      return { revision:++revision };
    },
  });
  const repo = store.repository('transactions');
  const writes = [repo.save({id:'a'}), repo.save({id:'b'})];
  assert.deepEqual(states, ['saving', 'saving']);
  release();
  await Promise.all(writes);
  assert.deepEqual(states, ['saving', 'saving', 'saving', 'saved']);
  const failing = createCloudDataStore({
    onWriteState:event => states.push(event.state),
    request:async (_path, options) => {
      if (!options) return { data:emptyAccountData(), revision:0 };
      throw Error('network');
    },
  });
  await assert.rejects(failing.repository('transactions').save({id:'a'}), /network/);
  assert.equal(states.at(-1), 'error');
});
