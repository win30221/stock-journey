const assert=require('node:assert/strict');
const test=require('node:test');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};

test('an autosave retry never overwrites a newer queued value',async()=>{
  const {createAutosave}=await import('../js/app/async-state.js');
  const started=deferred(),release=deferred();let first=true,retry;const values=[];
  const writer=createAutosave(async value=>{
    if(first){first=false;throw Error('quota');}
    if(value.count===2&&values.length===0){started.resolve();await release.promise;}
    values.push(value.count);
  },{onError:(_error,tryAgain)=>retry=tryAgain});
  writer.schedule({count:1});await writer.flush();
  writer.schedule({count:2});const latest=writer.flush();await started.promise;
  const retried=retry();release.resolve();await Promise.all([latest,retried]);
  assert.deepEqual(values,[2,2]);
});

test('autosave snapshots input and cancellation invalidates retries and scheduled writes',async()=>{
  const {createAutosave}=await import('../js/app/async-state.js');
  const values=[];let retry,fail=false;
  const writer=createAutosave(async value=>{if(fail)throw Error('quota');values.push(value.count);},{onError:(_error,callback)=>retry=callback});
  const source={count:9};writer.schedule(source);source.count=1;await writer.flush();
  assert.deepEqual(values,[9]);
  fail=true;writer.schedule({count:5});await writer.flush();
  writer.schedule({count:6});await writer.cancel();fail=false;await retry();
  assert.deepEqual(values,[9]);
  writer.schedule({count:7});await writer.flush();assert.deepEqual(values,[9,7]);
});

test('cancel waits for an in-flight task write and blocks a second stale write',async()=>{
  const {createCancellableTask}=await import('../js/app/async-state.js');
  const task=createCancellableTask(),started=deferred(),release=deferred(),events=[];
  const run=task.run(async context=>{context.check();started.resolve();await release.promise;events.push('write');context.check();events.push('stale write');});
  await started.promise;let cancelled=false;const stopped=task.cancel().then(()=>cancelled=true);
  assert.equal(cancelled,false);release.resolve();await assert.rejects(run,{name:'AbortError'});await stopped;
  assert.deepEqual(events,['write']);assert.equal(task.busy,false);
});
