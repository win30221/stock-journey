const vm = require('node:vm');
const { buildBundle } = require('../../scripts/build-static.cjs');

function createAppFixture(t, { now = '2026-09-07T04:00:00Z' } = {}) {
  const nodes = new Map(), collections = new Map(), storage = new Map(), timers = new Set();
  const noop = () => {};
  const doc = {
    activeElement:null, hidden:false, addEventListener:noop,
    querySelector:selector => nodes.get(selector) || null,
    querySelectorAll:selector => collections.get(selector) || [],
  };
  function element(id = '') {
    const listeners = new Map(), attributes = new Map();
    const node = {
      id, isConnected:true, tagName:'DIV', disabled:false, dataset:{}, value:'', checked:false,
      innerHTML:'', textContent:'', children:[], classList:{add:noop,remove:noop,toggle:noop},
      addEventListener:(type,callback) => listeners.set(type,callback),
      fire:(type,event={}) => listeners.get(type)?.({currentTarget:node,target:node,preventDefault:noop,...event}),
      setAttribute:(key,value) => attributes.set(key,String(value)),getAttribute:key=>attributes.get(key),removeAttribute:key=>attributes.delete(key),
      querySelector:()=>null,querySelectorAll:()=>[],closest:()=>null,
      prepend(child){child.remove();child.parentNode=this;child.isConnected=true;this.children.unshift(child);if(child.id)nodes.set('#'+child.id,child);},
      append(child){child.remove();child.parentNode=this;child.isConnected=true;this.children.push(child);if(child.id)nodes.set('#'+child.id,child);},
      remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);this.parentNode=null;this.isConnected=false;nodes.delete('#'+this.id);},
      focus(){doc.activeElement=node;},
    };
    if(id)nodes.set('#'+id,node);
    return node;
  }
  element('root');element('main-content');
  doc.createElement=tag=>Object.assign(element(),{tagName:tag.toUpperCase()});
  class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
  const context=vm.createContext({
    document:doc,console:{log:noop,warn:noop,error:noop},Date:Clock,Intl,URL,URLSearchParams,AbortController,
    Blob,crypto:{randomUUID:()=> 'fixture-id'},navigator:{onLine:false},location:{protocol:'file:',hash:'#settings'},
    history:{replaceState:noop},window:{addEventListener:noop},requestAnimationFrame:noop,
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    setTimeout:(callback,delay)=>{const timer=setTimeout(callback,delay);timer.unref();timers.add(timer);return timer;},
    clearTimeout:timer=>{clearTimeout(timer);timers.delete(timer);},
    FormData:class {constructor(form){this.fields=form.fields;}get(name){return this.fields[name]??null;}},
  });
  vm.runInContext(buildBundle().replace(/\nload\(\);\s*$/,''),context);
  t.after(()=>{for(const timer of timers)clearTimeout(timer);});
  return {context,run:code=>vm.runInContext(code,context),nodes,collections,storage,element,doc};
}
module.exports={createAppFixture};
