const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

test('generated bundle renders when the page uses file protocol', async () => {
  const source = fs.readFileSync('app.bundle.js', 'utf8');
  const index = fs.readFileSync('index.html', 'utf8');
  assert.match(index, /<script src="\.\/app\.bundle\.js(?:\?[^"\s]+)?"><\/script>/);
  assert.doesNotMatch(index, /type="module"/);
  assert.doesNotMatch(source, /^import |^export /m);

  const root = { innerHTML:'' };
  const noop = () => {};
  const backgroundTimeout = (callback, delay) => { const timer=setTimeout(callback,delay);timer.unref();return timer; };
  const storage = new Map();
  const location = { protocol:'file:', hash:'' };
  const sandbox = {
    console, Date, Intl, URL, URLSearchParams, Promise, Map, Set, Math, Number, String, Boolean, Blob,
    crypto:{ randomUUID:() => 'test-id' },
    fetch:noop,
    navigator:{ onLine:true },
    location,
    history:{ replaceState:(_state,_title,hash) => { location.hash=hash; } },
    localStorage:{
      getItem:key => storage.get(key) || null,
      setItem:(key,value) => storage.set(key,value),
      removeItem:key => storage.delete(key),
    },
    document:{
      querySelector:selector => selector === '#root' ? root : null,
      querySelectorAll:() => [],
      addEventListener:noop,
      hidden:false,
    },
    window:{ addEventListener:noop },
    setTimeout:backgroundTimeout,
    clearTimeout,
    requestAnimationFrame:callback => backgroundTimeout(callback,0),
  };
  vm.runInNewContext(source, sandbox, { filename:'app.bundle.js' });
  await new Promise(resolve => setTimeout(resolve,20));
  assert.match(root.innerHTML, /class="shell"/);
  assert.match(root.innerHTML, /投資總覽/);
  assert.equal(location.hash, '#overview');
});
