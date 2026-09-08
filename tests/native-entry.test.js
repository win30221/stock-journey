const path = require('node:path');
const assert=require('node:assert/strict');
const test=require('node:test');
const {execFileSync}=require('node:child_process');

test('native ES module entry boots without private globals supplied by the classic bundle',()=>{
  const output=execFileSync(process.execPath,['--input-type=module','-e',`
    const root={innerHTML:''}, storage=new Map(),noop=()=>{};
    globalThis.document={querySelector:selector=>selector==='#root'?root:null,querySelectorAll:()=>[],addEventListener:noop,hidden:false};
    globalThis.window={addEventListener:noop};
    globalThis.location={protocol:'file:',hash:''};
    globalThis.history={replaceState:(_state,_title,hash)=>{location.hash=hash;}};
    globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
    const nativeTimeout=setTimeout;
    globalThis.setTimeout=(callback,delay)=>{const timer=nativeTimeout(callback,delay);timer.unref();return timer;};
    globalThis.requestAnimationFrame=noop;
    await import('./app.js');
    await new Promise(resolve=>setImmediate(resolve));
    if(!root.innerHTML.includes('class="shell"'))throw Error(root.innerHTML||'No page rendered');
    process.stdout.write(location.hash);
  `],{cwd:path.resolve(__dirname,'..'),encoding:'utf8'});
  assert.equal(output,'#overview');
});
