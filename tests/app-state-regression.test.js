const assert=require('node:assert/strict');
const test=require('node:test');
const {createAppFixture}=require('./support/app-fixture.cjs');

function settingsControls(f) {
  const values={basis:'PAYMENT_DATE',trendTooltipEventLimit:'9',gainMilestoneInterval:'200'};
  const switches=['showTotalAsset','showTotalReturn','showNewStockMarker','showManualBuyMarker','showRecurringInvestmentMarker','showDividendReinvestmentMarker','showStockDividendMarker'];
  const controls=Object.entries(values).map(([id,value])=>Object.assign(f.element(id),{value,type:id==='basis'?'select':'number'}));
  controls.push(...switches.map(id=>Object.assign(f.element(id),{checked:false,type:'checkbox'})));
  f.element('settingsSaveStatus');
  f.collections.set('[data-setting-control]',controls);
  return controls;
}

test('settings input is captured before navigation and does not revert hidden controls to defaults',async t=>{
  const f=createAppFixture(t);settingsControls(f);
  f.run('render=()=>{};bind();');
  f.nodes.get('#trendTooltipEventLimit').fire('input');
  f.run("navigateToPage('overview')");
  for(const [selector] of f.nodes)if(selector!=='#root')f.nodes.delete(selector);
  await f.run('chartSettingsAutosave.flush()');
  const saved=JSON.parse(f.storage.get('srd-file-fallback:settings'))[0];
  assert.equal(saved.trendTooltipEventLimit,9);
  assert.equal(saved.gainMilestoneInterval,2000000);
  assert.equal(saved.showTotalAsset,false);assert.equal(saved.showTotalReturn,false);
  assert.equal(saved.showStockDividendMarker,false);
});

test('maintenance rejects new autosave input while old operations are being cancelled',async t=>{
  const f=createAppFixture(t);settingsControls(f);f.run('bind();dataMaintenance=true;');
  f.nodes.get('#trendTooltipEventLimit').fire('input');
  f.run('dataMaintenance=false;');await f.run('chartSettingsAutosave.flush()');
  assert.equal(f.storage.has('srd-file-fallback:settings'),false);
});

test('a failed transaction save retains its editor, reports failure and re-enables submit',async t=>{
  const f=createAppFixture(t),form=f.element('transactionForm'),submit=f.element('saveTransaction');submit.tagName='BUTTON';
  const dialog=f.element('transactionDialog');
  f.nodes.set('[role="dialog"][aria-modal="true"]',dialog);
  form.tagName='FORM';form.fields={date:'2026-09-01',symbol:'0050',acquisitionType:'MANUAL_BUY',quantity:'10',price:'100',fee:'0'};
  form.querySelector=()=>submit;
  f.context.localStorage.setItem=()=>{throw Error('儲存空間不足');};
  f.run('transactionModalOpen=true;');
  await f.run('uiAction(saveManualTransaction)')({currentTarget:form,preventDefault(){}});
  assert.equal(f.run('transactionModalOpen'),true);
  assert.equal(form.fields.quantity,'10');assert.equal(submit.disabled,false);
  assert.match(f.nodes.get('#operationError').textContent,/儲存空間不足/);
  assert.equal(f.nodes.get('#operationError').parentNode,dialog);
  assert.equal(f.run('transactions.length'),0);
});

test('an existing page error moves into the active dialog and its retry preserves input focus',async t=>{
  const f=createAppFixture(t);
  f.run("reportOperationError(Error('第一次失敗'))");
  const notice=f.nodes.get('#operationError'),main=f.nodes.get('#main-content');
  assert.equal(notice.parentNode,main);
  const dialog=f.element('transactionDialog'),input=f.element('transactionQuantity');
  f.nodes.set('[role="dialog"][aria-modal="true"]',dialog);
  input.focus();
  let retries=0,revealed=false;
  f.context.retryModalSave=async()=>{retries++;};
  notice.scrollIntoView=()=>{revealed=true;};
  f.run("reportOperationError(Error('第二次失敗'),'設定尚未儲存',retryModalSave)");
  assert.equal(notice.parentNode,dialog);
  assert.equal(main.children.includes(notice),false);
  assert.equal(notice.getAttribute('role'),'alert');
  assert.match(notice.textContent,/第二次失敗/);
  assert.equal(revealed,true);
  assert.equal(f.doc.activeElement,input);
  await notice.children[0].fire('click');
  assert.equal(retries,1);
  assert.equal(notice.children[0].disabled,false);
});

test('dividend calendar includes a first holding in the current month and announced next-year receipts',t=>{
  const f=createAppFixture(t);
  f.run(`transactions=[{id:'t',date:'2026-09-01',symbol:'0050',quantity:100,price:10,fee:0,acquisitionType:'MANUAL_BUY'}];marketCaches=[{symbol:'0050',prices:[{date:'2026-09-02',close:10}],dividends:[{exDate:'2026-09-03',paymentDate:'2026-09-05',cash:2},{exDate:'2026-09-03',paymentDate:'2027-01-05',cash:1}]}];`);
  const html=f.run('dividendsPage()');
  assert.match(html,/<option value="2026"/);assert.match(html,/<option value="2027"/);
  assert.doesNotMatch(html,/undefined 年/);assert.match(html,/2026 年股息月曆/);
});

test('retirement screens distinguish incomplete dividend history from a verified zero dividend',t=>{
  const f=createAppFixture(t);
  f.run(`transactions=[{id:'t',date:'2026-09-01',symbol:'0050',quantity:100,price:10,fee:0,acquisitionType:'MANUAL_BUY'}];marketTradingDates=['2026-09-04'];marketCaches=[{symbol:'0050',prices:[{date:'2026-09-04',close:10}],dividends:[]}];settings.retirementBirthMonth='1986-09';settings.retirementBirthMonthConfirmed=true;`);
  assert.match(f.run('retirementCalculatorPage()'),/資料不足不代表沒有配息/);
  assert.match(f.run('overviewRetirementSnapshot()'),/配息資料待補齊/);
  f.run("marketCaches=[{...marketCaches[0],dividendCoverageFrom:'2025-01-01',dividendCheckedThrough:'2026-09-04'}]");
  assert.equal(f.run('dividendForecast().coverageComplete'),true);
  assert.match(f.run('retirementCalculatorPage()'),/id="projectionDividendAmount">0 元/);
});

test('background market refresh preserves a transaction draft',t=>{
  const f=createAppFixture(t);
  f.run("let renders=0;render=()=>renders++;transactionModalOpen=true;refreshMarketView();");
  assert.equal(f.run('renders'),0);
});

test('retirement market refresh updates asset sources and results without replacing the draft', t => {
  const f = createAppFixture(t);
  const amount = f.element('projectionAssetAmount');
  const form = f.element('retirementProjectionForm');
  const result = f.element('retirementProjectionResult');
  const input = f.element('monthlyContribution');
  form.fields = {
    birthMonth: '1986-09', otherMonthlyIncome: '0', monthlyContribution: '12345',
    annualReturnRate: '12.5', inflationRate: '2', withdrawalRate: '0',
  };
  input.value = '12345';
  input.focus();
  f.run(`
    page = 'retirement-calculator';
    settingsStore.replace({ ...createDefaultSettings(), retirementBirthMonth:'1986-09', retirementBirthMonthConfirmed:true });
    transactions = [{ id:'t', date:'2026-09-01', symbol:'0050', quantity:100, price:100, fee:0, acquisitionType:'MANUAL_BUY' }];
    marketTradingDates = ['2026-09-04'];
    marketCaches = [{ symbol:'0050', prices:[], dividends:[], dividendCoverageFrom:'2025-01-01', dividendCheckedThrough:'2026-09-04' }];
    let refreshedProjection;
    bindProjectionChart = projection => { refreshedProjection = projection; };
    render = () => { throw Error('Market refresh must preserve the existing form'); };
    refreshMarketView();
  `);
  assert.equal(amount.textContent, '10,000 元', 'missing prices use the cost estimate');
  f.run(`
    marketCaches = [{ ...marketCaches[0], prices:[{ date:'2026-09-04', close:200 }] }];
    refreshMarketView();
  `);
  assert.equal(amount.textContent, '20,000 元');
  assert.equal(f.run('refreshedProjection.currentAssets'), 20000);
  assert.equal(f.run('refreshedProjection.monthlyContribution'), 12345);
  assert.equal(f.run('refreshedProjection.annualReturnRate'), 0.125);
  assert.equal(f.nodes.get('#retirementProjectionForm'), form);
  assert.equal(f.nodes.get('#retirementProjectionResult'), result);
  assert.equal(f.doc.activeElement, input);
  assert.equal(input.value, '12345');
});

test('a load holding an older settings snapshot cannot overwrite a newer successful settings save',async t=>{
  const f=createAppFixture(t);
  let releaseCollections,settingsWereRead;
  const blockedCollection=new Promise(resolve=>{releaseCollections=resolve;});
  const settingsRead=new Promise(resolve=>{settingsWereRead=resolve;});
  t.after(()=>releaseCollections());
  f.context.__blockedCollection=blockedCollection;
  f.context.__settingsWereRead=settingsWereRead;
  f.run('render=()=>{};scheduleMarketSyncCheck=()=>{};maybeAutoSyncMarket=async()=>{};');
  await f.run("saveSettingsPatch({trendTooltipEventLimit:3,showTotalReturn:true})");
  await f.run("budgetPlanRepository.save({id:'default',source:'ITEMIZED',selectedTarget:'NEEDS_AND_WANTS',bufferRateBps:0})");
  f.run(`
    const settingsRaceRead=getAllRecords;
    getAllRecords=async name=>{
      const rows=await settingsRaceRead(name);
      if(name==='settings')globalThis.__settingsWereRead(rows);
      if(name==='budgetItems')await globalThis.__blockedCollection;
      return rows;
    };
  `);
  const loading=f.run('load()');
  const oldSnapshot=await settingsRead;
  assert.equal(oldSnapshot[0].trendTooltipEventLimit,3);
  await f.run('saveSettingsPatch({trendTooltipEventLimit:9,showTotalReturn:false})');
  releaseCollections();
  await loading;
  assert.equal(f.run('settings.trendTooltipEventLimit'),9);
  assert.equal(f.run('settings.showTotalReturn'),false);
  const persisted=JSON.parse(f.storage.get('srd-file-fallback:settings'))[0];
  assert.equal(persisted.trendTooltipEventLimit,9);
  assert.equal(persisted.showTotalReturn,false);
});

test('replacement waits for an old load migration write before removing its budget data',async t=>{
  const f=createAppFixture(t),events=[];
  let releaseMigration,migrationStarted;
  const migrationGate=new Promise(resolve=>{releaseMigration=resolve;});
  const started=new Promise(resolve=>{migrationStarted=resolve;});
  t.after(()=>releaseMigration());
  f.context.__migrationGate=migrationGate;
  f.context.__migrationStarted=migrationStarted;
  f.context.__migrationEvents=events;
  f.run('render=()=>{};scheduleMarketSyncCheck=()=>{};maybeAutoSyncMarket=async()=>{};');
  await f.run(`replaceBrowserData({
    settings:[createDefaultSettings()],budgetPlans:[{id:'default',source:'ITEMIZED'}],
    budgetItems:[{id:'old-budget',bucket:'NEED',name:'房租',calculationMode:'RECURRING',occurrenceAmount:1000,frequency:'MONTHLY'}]
  })`);
  f.run(`
    const migrationRaceSave=saveRecords;
    saveRecords=async(name,rows)=>{
      const migrating=name==='budgetItems'&&rows.some(row=>row.id==='old-budget');
      if(migrating){globalThis.__migrationStarted();await globalThis.__migrationGate;}
      await migrationRaceSave(name,rows);
      if(migrating)globalThis.__migrationEvents.push('migration-write');
    };
  `);
  const oldLoad=f.run('load()');
  await started;
  let replacementFinished=false;
  const replacement=f.run(`replaceDataSafely(async()=>{
    await replaceBrowserData({settings:[createDefaultSettings()],budgetPlans:[{id:'default',source:'ITEMIZED'}],budgetItems:[]});
    globalThis.__migrationEvents.push('replacement');
    settingsStore.replace(createDefaultSettings());budgetItems=[];budgetPlans=[];
    await load();
  })`).then(()=>{replacementFinished=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(replacementFinished,false);
  assert.deepEqual(events,[]);
  assert.equal(f.run('dataMaintenance'),true);
  releaseMigration();
  await Promise.all([oldLoad,replacement]);
  assert.deepEqual(events,['migration-write','replacement']);
  assert.deepEqual(JSON.parse(f.storage.get('srd-file-fallback:budgetItems')),[]);
  assert.equal(f.run('budgetItems.length'),0);
  assert.equal(f.run('dataMaintenance'),false);
});
