const assert = require('node:assert/strict');
const test = require('node:test');
const { createAppFixture } = require('./support/app-fixture.cjs');

function setup(t) {
  const f = createAppFixture(t);
  f.run(`
    transactions=[
      {id:'first',symbol:'0050',date:'2026-01-02',quantity:10,price:100,fee:5,acquisitionType:'MANUAL_BUY'},
      {id:'second',symbol:'0050',date:'2026-02-02',quantity:4,price:110,fee:0,acquisitionType:'DIVIDEND_REINVESTMENT'},
      {id:'other',symbol:'2330',date:'2026-01-02',quantity:1,price:500,fee:0,acquisitionType:'MANUAL_BUY'}
    ];
    marketCaches=[
      {symbol:'0050',prices:[{date:'2026-01-02',close:100},{date:'2026-02-02',close:110},{date:'2026-03-02',close:60}],splits:[{date:'2026-03-02',ratio:2}],dividends:[]},
      {symbol:'2330',prices:[{date:'2026-01-02',close:500}],dividends:[]}
    ];
    const testMount = {clientWidth:800,innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]};
    const lot = createAssetTrendChart({
      getTransactions:()=>[transactions[0]],getMarketCaches:()=>marketCaches,
      getSettings:()=>settings,getDate:today,getMount:()=>testMount,prefix:'lot-',showCost:true,
    });
    const stock = createAssetTrendChart({
      getTransactions:()=>transactions.filter(row=>row.symbol==='0050'),getMarketCaches:()=>marketCaches,
      getSettings:()=>settings,getDate:today,getMount:()=>testMount,prefix:'stock-',showCost:true,
    });
  `);
  return f;
}

test('lot history excludes later purchases and other stocks while keeping split-adjusted value and original cost', t => {
  const f = setup(t);
  assert.equal(f.run('lot.trendDailySeries().at(-1).market'), 1200);
  assert.equal(f.run('lot.trendDailySeries().at(-1).cost'), 1005);
  assert.equal(f.run('stock.trendDailySeries().at(-1).market'), 1680);
  assert.equal(f.run('stock.trendDailySeries().at(-1).cost'), 1445);
  assert.equal(f.run('lot.trendDailySeries().reduce((sum,row)=>sum+row.events.length,0)'), 1);
  assert.equal(f.run('lot.trendDailySeries().at(-1).returnRate'), (1200-1005)/1005*100);
  assert.match(f.run('lot.render()'), /trend-cost-line/);
  assert.match(f.run('lot.render()'), /取得成本/);
});

test('chart instances keep frequency, selection and SVG IDs independent', t => {
  const f = setup(t);
  f.run("lot.trendSetFrequency('day');");
  assert.equal(f.run('lot.trendSeries().length'), 3);
  assert.equal(f.run('stock.trendSeries().length'), 3);
  assert.match(f.run('lot.render()'), /id="lot-assetTrendChart"/);
  assert.match(f.run('lot.render()'), /url\(#lot-trendFill\)/);
  assert.match(f.run('stock.render()'), /id="stock-assetTrendChart"/);
  f.run(`marketCaches=[{...marketCaches[0],prices:[...marketCaches[0].prices,{date:'2026-03-03',close:65}]},marketCaches[1]];`);
  assert.equal(f.run('lot.trendSeries().length'), 4);
  assert.equal(f.run('stock.trendSeries().length'), 3, 'stock chart retains monthly frequency');
  assert.equal(f.run('lot.trendDailySeries().at(-1).market'), 1300);
});

test('dialog controls repaint their own mount and zero-cost or missing-price data remain finite', t => {
  const f = setup(t);
  f.run(`
    const rangeButton={dataset:{trendRange:'1m'}};
    testMount.querySelectorAll=selector=>selector==='[data-trend-range]'?[rangeButton]:[];
    lot.bind();
    rangeButton.onclick();
  `);
  assert.match(f.run('testMount.innerHTML'), /id="lot-assetTrendChart"/);
  assert.equal(f.run('lot.trendSelection().points.length'), 2);
  f.run(`transactions=[{...transactions[0],price:0,fee:0,acquisitionType:'STOCK_DIVIDEND'}];marketCaches=[];`);
  assert.equal(f.run('lot.trendDailySeries()[0].estimated'), true);
  assert.equal(f.run('lot.trendDailySeries()[0].returnRate'), null);
  const html = f.run('lot.render()');
  assert.doesNotMatch(html, /NaN|Infinity/);
  assert.match(html, /含成本估算/);
  assert.match(html, /<circle /, 'a single observation stays visible');
});

test('future transactions produce an empty chart and no future points', t => {
  const f = setup(t);
  f.run("transactions=[{...transactions[0],date:'2099-01-01'}];");
  assert.equal(f.run('lot.trendDailySeries().length'), 0);
  assert.match(f.run('lot.render()'), /沒有可顯示的歷史資料/);
});

test('disposing a chart removes active drag listeners and cancels queued previews', t => {
  const f = setup(t);
  const listeners = new Map(), frames = new Map();
  let frameId = 0;
  f.doc.addEventListener = (type, listener) => listeners.set(type, listener);
  f.doc.removeEventListener = (type, listener) => {
    if (listeners.get(type) === listener) listeners.delete(type);
  };
  f.context.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  f.context.cancelAnimationFrame = id => frames.delete(id);
  f.run(`
    const dragHandlers={};
    const navigatorNode={
      querySelector:()=>null,querySelectorAll:()=>[],getBoundingClientRect:()=>({left:0,width:800}),
      addEventListener:(type,listener)=>{dragHandlers[type]=listener;},
    };
    testMount.querySelector=selector=>selector==='#lot-trendNavigator'?navigatorNode:null;
    lot.bind();
    dragHandlers.pointerdown({clientX:400,target:{closest:selector=>selector==='.navigator-selection'?{getBoundingClientRect:()=>({left:0,right:800,width:800}),classList:{contains:()=>false}}:null},preventDefault:()=>{}});
  `);
  assert.equal(listeners.size, 3);
  listeners.get('pointermove')({clientX:450});
  assert.ok(frames.size > 0);
  f.run('lot.dispose();');
  assert.equal(listeners.size, 0);
  assert.equal(frames.size, 0);
});

test('chart extraction preserves settings page and backup settings boundaries', t => {
  const f = setup(t);
  assert.match(f.run('chartSettingsPanel()'), /資產走勢顯示內容/);
  assert.equal(f.run('backupSettings().gainMilestoneInterval'), f.run('normaliseGainMilestoneInterval(settings.gainMilestoneInterval)'));
  assert.equal(f.run('backupSettings().trendTooltipEventLimit'), f.run('normaliseTrendTooltipEventLimit(settings.trendTooltipEventLimit)'));
});

test('holding dialog opens for one transaction and Escape closes it without changing home selection', t => {
  const f = setup(t);
  const summary = f.element('holdingTrendSummary');
  f.element('holdingTrendMount');
  const dialog = f.element();
  const close = f.element();
  dialog.removeEventListener = () => {};
  dialog.getClientRects = () => [{}];
  const createElement = f.doc.createElement;
  let backdrop;
  f.doc.createElement = tag => {
    const element = createElement(tag);
    if (tag === 'div') {
      backdrop = element;
      element.querySelector = selector => selector === '[role="dialog"]' ? dialog : close;
      // The fixture does not parse HTML; register the dialog backdrop explicitly.
      f.nodes.set('#holdingTrendBackdrop', element);
    }
    return element;
  };
  f.context.trigger = { dataset:{trendTransaction:'first'}, isConnected:true, focus:() => {} };
  f.run(`trendState.range='3y';openHoldingTrend(trigger);`);
  assert.equal(f.run('holdingTrend.trendDailySeries().at(-1).market'), 1200);
  assert.match(backdrop.innerHTML, /單筆交易走勢/);
  assert.match(summary.innerHTML, /1,005/);
  f.run(`marketCaches=[{...marketCaches[0],prices:[...marketCaches[0].prices,{date:'2026-03-03',close:65}]},marketCaches[1]];refreshMarketView();`);
  assert.match(summary.innerHTML, /1,300/);
  dialog.fire('keydown', { key:'Escape' });
  assert.equal(f.run('holdingTrend'), null);
  assert.equal(f.run('trendState.range'), '3y');
  assert.equal(backdrop.isConnected, false);
});

test('holding profit amount and percentage share red/green classes while zero and missing data stay neutral', t => {
  const f = setup(t);
  const check = (price, className) => {
    f.run(`marketCaches=[{symbol:'0050',prices:[{date:'2026-01-02',close:${price}}],dividends:[],splits:[]}];`);
    const html = f.run('holdingTrendSummary([transactions[0]])');
    assert.match(html, new RegExp('<strong class="' + className + '">'));
    assert.match(html, new RegExp('<small class="' + className + '">'));
    return html;
  };
  assert.match(check(120, 'positive'), /\+195/);
  assert.match(check(90, 'negative'), /-105|−105/);
  check(100.5, '');
  f.run('marketCaches=[];');
  const missing = f.run('holdingTrendSummary([transactions[0]])');
  assert.match(missing, /資料不足/);
  assert.doesNotMatch(missing, /class="(?:positive|negative)"/);
});

for (const viewportWidth of [320, 375, 390, 430, 768]) {
  test(`touch inspection selects the correct date in a ${viewportWidth}px viewport`, t => {
    const f = setup(t);
    // Reserve modal safe area, padding and scrollbar space before measuring the stage.
    const width = viewportWidth - 64;
    const stage = f.element();
    const focus = f.element(), dot = f.element(), tip = f.element();
    dot.style = {}; tip.style = {};
    stage.clientWidth = width;
    stage.getBoundingClientRect = () => ({ left:0, width });
    stage.querySelector = () => ({
      viewBox:{baseVal:{width,height:340}},
      getBoundingClientRect:() => ({left:0,width}),
    });
    f.context.touchNodes = {
      '#lot-assetTrendChart':stage, '#lot-trendFocus':focus,
      '#lot-trendFocusDot':dot, '#lot-trendTooltip':tip,
    };
    f.context.stageWidth = width;
    f.run(`
      testMount.clientWidth=stageWidth;
      testMount.querySelector=selector=>touchNodes[selector]||null;
      lot.trendSetFrequency('day');
      lot.bind();
    `);
    stage.fire('pointerdown', {pointerType:'touch',clientX:0});
    assert.equal(stage.dataset.focusIndex, 0);
    assert.match(tip.innerHTML, /2026\/01\/02/);
    stage.fire('pointerdown', {pointerType:'touch',clientX:width});
    assert.equal(stage.dataset.focusIndex, 2);
    assert.match(tip.innerHTML, /2026\/03\/02/);
    assert.match(tip.innerHTML, /positive/);
    assert.ok(parseFloat(tip.style.left) <= width);
    stage.fire('keydown', { key:'Home' });
    assert.equal(stage.dataset.focusIndex, 0);
    stage.fire('keydown', { key:'End' });
    assert.equal(stage.dataset.focusIndex, 2);
    assert.doesNotMatch(f.run('lot.render()'), /NaN|Infinity/);
  });
}
