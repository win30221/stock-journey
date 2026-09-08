const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function appFunction(name) {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'app.js'), 'utf8');
  const result = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`))?.[0];
  assert.ok(result, `${name} should exist`);
  return result;
}

function fixture() {
  const document = { activeElement:null, querySelector:selector => nodes.get(selector) || null };
  const nodes = new Map(), frames = [];
  function element() {
    const listeners = new Map(), attributes = new Map(), classes = new Set();
    return {
      listeners, attributes, children:[], inert:false, hidden:false, disabled:false, tabIndex:0, isConnected:true, dataset:{},
      classList:{ add:value => classes.add(value), remove:value => classes.delete(value), contains:value => classes.has(value), toggle:(value,on) => on ? classes.add(value) : classes.delete(value) },
      setAttribute:(name,value) => attributes.set(name,String(value)), removeAttribute:name => attributes.delete(name), getAttribute:name => attributes.get(name),
      addEventListener(name,fn) { if (!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name).add(fn); },
      removeEventListener:(name,fn) => listeners.get(name)?.delete(fn),
      fire(name,extra={}) { const event = { target:this, defaultPrevented:false, preventDefault() { this.defaultPrevented=true; }, ...extra }; for (const fn of listeners.get(name) || []) fn(event); return event; },
      focus() { document.activeElement=this; },
      contains(node) { return node===this || this.children.includes(node); },
      querySelector(selector) { return this.selectors?.[selector] || null; },
      querySelectorAll() { return this.children; },
      closest() { return this.hidden || this.inert ? this : null; },
      getClientRects() { return this.hidden ? [] : [{}]; },
      scrollIntoView(options) { this.scrolled=options.block; },
    };
  }
  document.body=element();
  const context={ document, requestAnimationFrame:callback => frames.push(callback) };
  const flush=()=>{ while(frames.length) frames.shift()(); };
  return { document,nodes,element,context,flush };
}

test('custom dialogs contain keyboard focus, respect combobox Escape and restore their trigger', () => {
  const f=fixture(), background=f.element(), trigger=f.element(), dialog=f.element();
  const first=f.element(), field=f.element(), hidden=f.element(), disabled=f.element(), last=f.element();
  hidden.hidden=true; disabled.disabled=true;
  dialog.children=[first,field,hidden,disabled,last]; dialog.selectors={'#field':field};
  f.nodes.set('.shell',background); trigger.focus();
  let closed=0;
  vm.createContext(f.context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'js/components/dialog.js'),'utf8').replace(/^export /gm,''),f.context);
  f.context.bindDialogFocus(dialog,{initialFocus:'#field',onClose:()=>closed++,returnFocus:()=>trigger.focus()});
  f.flush();
  assert.equal(f.document.activeElement,field);
  assert.equal(background.inert,true);
  assert.equal(f.document.body.classList.contains('dialog-open'),true);
  first.focus();
  assert.equal(dialog.fire('keydown',{key:'Tab',shiftKey:true}).defaultPrevented,true);
  assert.equal(f.document.activeElement,last);
  assert.equal(dialog.fire('keydown',{key:'Tab'}).defaultPrevented,true);
  assert.equal(f.document.activeElement,first);
  dialog.fire('keydown',{key:'Escape',defaultPrevented:true});
  assert.equal(closed,0,'the first Escape belongs to an open combobox');
  dialog.fire('keydown',{key:'Escape'});
  assert.equal(closed,1);
  f.context.bindDialogFocus(null);
  f.flush();
  assert.equal(background.inert,false);
  assert.equal(f.document.body.classList.contains('dialog-open'),false);
  assert.equal(f.document.activeElement,trigger);
  assert.equal(dialog.listeners.get('keydown').size,0);
});

test('replacing an open dialog removes old handlers and keeps the new background inert', () => {
  const f=fixture(), background=f.element(), oldDialog=f.element(), nextDialog=f.element();
  f.nodes.set('.shell',background);
  oldDialog.children=[f.element()]; nextDialog.children=[f.element()];
  vm.createContext(f.context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '..', 'js/components/dialog.js'),'utf8').replace(/^export /gm,''),f.context);
  f.context.bindDialogFocus(oldDialog); oldDialog.isConnected=false;
  f.context.bindDialogFocus(nextDialog); f.flush();
  assert.equal(f.document.activeElement,nextDialog.children[0]);
  assert.equal(oldDialog.listeners.get('keydown').size,0);
  assert.equal(background.inert,true);
  f.context.clearDialogFocus();
  assert.equal(background.inert,false);
});

test('navigation remains operable across 800px in both directions and cleans breakpoint listeners', () => {
  const f=fixture(), aside=f.element(), panel=f.element(), toggle=f.element(), close=f.element(), backdrop=f.element(), currentPage=f.element();
  panel.children=[close,currentPage]; panel.selectors={'[aria-current="page"]':currentPage};
  for (const [selector,node] of [['.shell > aside',aside],['#mobileNavigationPanel',panel],['.mobile-menu-toggle',toggle],['.mobile-nav-close',close],['.mobile-nav-backdrop',backdrop]]) f.nodes.set(selector,node);
  const breakpoint=f.element(); breakpoint.matches=false;
  Object.assign(f.context,{ mobileNavigationCleanup:null, matchMedia:()=>breakpoint });
  vm.createContext(f.context); vm.runInContext(appFunction('bindMobileNavigation'),f.context);
  f.context.bindMobileNavigation();
  assert.equal(panel.inert,false);
  breakpoint.matches=true; breakpoint.fire('change');
  assert.equal(panel.inert,true);
  toggle.fire('click'); f.flush();
  assert.equal(panel.inert,false);
  assert.equal(toggle.getAttribute('aria-expanded'),'true');
  assert.equal(f.document.activeElement,close);
  panel.fire('keydown',{key:'Escape'});
  assert.equal(panel.inert,true);
  assert.equal(f.document.activeElement,toggle);
  breakpoint.matches=false; breakpoint.fire('change');
  assert.equal(panel.inert,false);
  assert.equal(panel.getAttribute('aria-hidden'),undefined);
  assert.equal(f.document.activeElement,currentPage);
  f.context.bindMobileNavigation();
  assert.equal(breakpoint.listeners.get('change').size,1);
});

test('budget validation summary focuses the invalid field without changing the page hash', () => {
  const f=fixture(), form=f.element(), summary=f.element(), field=f.element(), hint=f.element(), list={innerHTML:''};
  const location={hash:'#budget'};
  form.selectors={'#budgetErrorSummary':summary,'#budgetName':field,'#budgetName-error':hint};
  form.querySelectorAll=()=>[];
  summary.selectors={ul:list}; summary.hidden=true;
  let errorButton;
  summary.querySelectorAll=()=>{
    errorButton=f.element(); errorButton.dataset.errorField='budgetName'; return [errorButton];
  };
  Object.assign(f.context,{location,escapeHtml:value=>String(value)});
  vm.createContext(f.context); vm.runInContext(appFunction('showBudgetErrors'),f.context);
  f.context.showBudgetErrors(form,[{field:'budgetName',message:'請填寫項目名稱。'}]);
  assert.equal(summary.hidden,false);
  assert.equal(f.document.activeElement,summary);
  assert.match(list.innerHTML,/<button type="button"/);
  assert.doesNotMatch(list.innerHTML,/<a\b|href=/);
  errorButton.fire('click');
  assert.equal(f.document.activeElement,field);
  assert.equal(field.scrolled,'center');
  assert.equal(field.getAttribute('aria-invalid'),'true');
  assert.equal(location.hash,'#budget');
});

test('JSON backup import keeps its native file control keyboard reachable with a visible focus surface', () => {
  const styles=fs.readFileSync(path.resolve(__dirname, '..', 'styles.css'),'utf8'), source=fs.readFileSync(path.resolve(__dirname, '..', 'app.js'),'utf8');
  const inputRules=[...styles.matchAll(/\.file-label input\s*\{([^}]+)\}/g)].map(match=>match[1]).join(' ');
  assert.match(source,/<input id="restore" type="file"[^>]+aria-label="匯入 JSON 備份"/);
  assert.doesNotMatch(inputRules,/display:\s*none|visibility:\s*hidden/);
  assert.match(inputRules,/position:\s*absolute/);
  assert.match(inputRules,/opacity:\s*0/);
  assert.match(styles,/\.file-label:has\(input:focus-visible\)\s*\{[^}]*outline:/);
});

test('monthly chart table uses the last selected observation and keeps estimation status visible', () => {
  const context={Map,escapeHtml:String,fmt:value=>`TWD ${value}`};
  vm.createContext(context); vm.runInContext(appFunction('trendMonthlyDataTable'),context);
  const html=context.trendMonthlyDataTable([
    {date:'2026-01-02',market:100,external:90,estimated:false},
    {date:'2026-01-29',market:120,external:90,estimated:true},
    {date:'2026-02-06',market:130,external:100,estimated:false},
  ]);
  assert.doesNotMatch(html,/2026-01-02/);
  assert.match(html,/2026-01-29/); assert.match(html,/2026-02-06/);
  assert.match(html,/含成本估算/); assert.match(html,/依市場價格/);
  assert.equal((html.match(/<th scope="row">/g)||[]).length,2);
});
