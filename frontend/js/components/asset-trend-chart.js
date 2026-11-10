import { calculateTrendHistory, aggregateTrendMonths, memoizeLatest } from '../domain/trend.js';
import { TREND_EVENT_MARKER_SETTINGS } from '../lib/constants.js';
import { escapeHtml, fmt, money } from '../lib/format.js';
import { normaliseGainMilestoneInterval, normaliseTrendTooltipEventLimit } from '../app/settings.js';

// Each instance owns its selection, DOM scope, pending frames and drag listeners.
export function createAssetTrendChart({ getTransactions, getMarketCaches, getSettings, getDate,
  getMount, getState, prefix = '', showCost = false }) {
  const localState = { frequency:'month', range:'all', start:null, end:null };
  getState ||= () => localState;
  const trendState = new Proxy({}, {
    get:(_, key) => getState()[key],
    set:(_, key, value) => { getState()[key] = value; return true; },
  });
  let trendDetailDate = null;
  const ownerDocument = globalThis.document;
  const frames = new Set();
  const bindingCleanups = [];
  const dragListeners = new Set();
  const selector = value => prefix ? value.replace(/#([\w-]+)/g, (_, id) => '#' + prefix + id) : value;
  const document = {
    querySelector: value => value === '#trendChartMount' ? getMount() : (prefix ? getMount()?.querySelector(selector(value)) : ownerDocument.querySelector(value)),
    querySelectorAll: value => prefix ? (getMount()?.querySelectorAll(selector(value)) || []) : ownerDocument.querySelectorAll(value),
    createElement: tag => ownerDocument.createElement(tag),
    addEventListener: (type, listener) => {
      dragListeners.add({ type, listener });
      ownerDocument.addEventListener(type, listener);
    },
    removeEventListener: (type, listener) => {
      for (const entry of dragListeners) {
        if (entry.type === type && entry.listener === listener) dragListeners.delete(entry);
      }
      ownerDocument.removeEventListener(type, listener);
    },
  };
  function requestAnimationFrame(callback) {
    const id = globalThis.requestAnimationFrame(() => { frames.delete(id); callback(); });
    frames.add(id);
    return id;
  }
  function cancelAnimationFrame(id) {
    frames.delete(id);
    globalThis.cancelAnimationFrame(id);
  }
  function listen(target, type, listener) {
    if (!target) return;
    target.addEventListener(type, listener);
    bindingCleanups.push(() => target.removeEventListener?.(type, listener));
  }
  function bindClick(button, callback) {
    button.onclick = callback;
    bindingCleanups.push(() => { button.onclick = null; });
  }
  function dispose() {
    bindingCleanups.splice(0).forEach(cleanup => cleanup());
    frames.forEach(id => globalThis.cancelAnimationFrame(id));
    frames.clear();
    dragListeners.forEach(({ type, listener }) => ownerDocument.removeEventListener(type, listener));
    dragListeners.clear();
    trendPreviewFrame = null;
  }
  function renderChart() {
    const html = trendChart();
    return prefix ? html.replace(/id="([^"]+)"/g, (_, id) => 'id="' + prefix + id + '"')
      .replace(/url\(#([^)]+)\)/g, (_, id) => 'url(#' + prefix + id + ')') : html;
  }
  function fmtReturnPercent(value) {
    return value == null || !Number.isFinite(value) ? '—' : (value >= 0 ? '+' : '') + value.toFixed(2) + '%';
  }
const readTrendDataset=memoizeLatest((txs,caches,dateBasis,asOfDate,interval)=>{
  const daily=enrichTrendRows(calculateTrendHistory({transactions:txs,marketCaches:caches,dateBasis,asOfDate}));
  return {daily,month:enrichTrendRows(aggregateTrendMonths(daily))};
});
function trendDataset() {
  return readTrendDataset(getTransactions(),getMarketCaches(),getSettings().dividendDateBasis,getDate(),gainMilestoneInterval());
}
function trendDailySeries() { return trendDataset().daily; }

function milestoneStep(value) { if(value>=10000000)return 1000000;if(value>=1000000)return 500000;return 100000; }

function gainMilestoneInterval() { return normaliseGainMilestoneInterval(getSettings().gainMilestoneInterval); }

function enrichTrendRows(rows) {
  if(!rows.length)return rows;
  const maxMarket=Math.max(...rows.map(row=>row.market),0),assetStep=milestoneStep(maxMarket),gainStep=gainMilestoneInterval();
  let lastAsset=Math.floor(rows[0].market/assetStep)*assetStep,lastGain=Math.floor(Math.max(0,rows[0].market-rows[0].external)/gainStep)*gainStep;
  return rows.map((row,index)=>{const previous=rows[index-1],marketChange=previous?row.market-previous.market:null,marketChangeRate=previous&&previous.market?marketChange/previous.market*100:null,milestones=[];let assetLevel=index===0?lastAsset:Math.floor(row.market/assetStep)*assetStep,gainLevel=Math.floor(Math.max(0,row.market-row.external)/gainStep)*gainStep;if(assetLevel>0&&(index===0||assetLevel>lastAsset))milestones.push({kind:'asset',value:assetLevel,label:`持股資產 ${compact(assetLevel)}`});if(gainLevel>0&&(index===0||gainLevel>lastGain))milestones.push({kind:'gain',value:gainLevel,label:`累積成果 ${compact(gainLevel)}`});lastAsset=Math.max(lastAsset,assetLevel);lastGain=Math.max(lastGain,gainLevel);return {...row,marketChange,marketChangeRate,returnRate:showCost?(row.cost?(row.market-row.cost)/row.cost*100:null):(row.external?(row.market-row.external)/row.external*100:null),milestones:showCost?[]:milestones};});
}
function trendSeries() { const dataset=trendDataset();return trendState.frequency==='day'?dataset.daily:dataset.month; }
function trendSelection(all = trendSeries()) {
  if (!all.length) return { points:[], start:0, end:0 };
  const max = all.length - 1;
  if (trendState.range !== 'custom') {
    trendState.start = 0;
    trendState.end = max;
    if (trendState.range !== 'all') {
      const target = new Date(`${all[max].date}T00:00:00Z`);
      const months = { '1m':1, '3m':3, '6m':6, '1y':12, '3y':36 }[trendState.range] || 12;
      target.setUTCMonth(target.getUTCMonth() - months);
      const date = target.toISOString().slice(0, 10);
      trendState.start = Math.max(0, all.findIndex(row => row.date >= date));
    }
  } else if (trendState.start == null || trendState.end == null || trendState.end > max) {
    trendState.start = 0;
    trendState.end = max;
  }
  trendState.start = Math.max(0, Math.min(trendState.start, max));
  trendState.end = Math.max(trendState.start, Math.min(trendState.end, max));
  return { points:all.slice(trendState.start, trendState.end + 1), start:trendState.start, end:trendState.end };
}
function trendDateLabel(date) { const [y,m,d]=date.split('-');return trendState.frequency==='day'?`${y}/${m}/${d}`:`${y} 年 ${m} 月`; }
function compact(value) { return `${(value/10000).toLocaleString('zh-TW',{maximumFractionDigits:value<1000000?0:1})}萬`; }
function trendSvgLine(points,key,x,y) { return points.map((p,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' '); }
function signedMoney(value) { if(value==null)return '—';return `${value>=0?'+':'−'}${fmt(Math.abs(value))}`; }

function trendTooltipEventLimit() { return normaliseTrendTooltipEventLimit(getSettings().trendTooltipEventLimit); }
function trendEventRows(events) { return `<div class="trend-event-list">${events.map(event=>`<div class="trend-event-row event-${event.type.toLowerCase()}"><i aria-hidden="true"></i><span><b>${escapeHtml(event.symbol)} · +${money.format(event.quantity)} 股</b><small>${escapeHtml(event.label)}${event.amount>0?` · ${fmt(event.amount)}`:''}</small></span></div>`).join('')}</div>`; }
function trendMilestoneBanner(milestone) { return `<div class="trend-milestone-banner ${milestone.kind==='gain'?'is-gain':'is-asset'}"><span aria-hidden="true">◆</span><div><b>${milestone.kind==='gain'?'累積成果里程碑':'資產里程碑'}</b><small>${escapeHtml(milestone.label)}</small></div></div>`; }
function visibleTrendMilestones(milestones = []) { return milestones.filter(milestone => milestone.kind==='asset' ? getSettings().showTotalAsset : getSettings().showTotalReturn); }
function trendEventTypeVisible(type) { const marker=TREND_EVENT_MARKER_SETTINGS.find(item=>item.type===type); return marker ? getSettings()[marker.id] ?? true : true; }
function visibleTrendMarkerEvents(events = []) { return events.filter(event => (event.isNew && (getSettings().showNewStockMarker ?? true)) || trendEventTypeVisible(event.type)); }
function trendMilestoneSummary(milestones) { const visible=visibleTrendMilestones(milestones); return visible.length ? `<div class="trend-milestones${visible.length===1?' is-single':''}">${visible.map(trendMilestoneBanner).join('')}</div>` : ''; }
function trendReturnClass(value) {
  return value > 0 ? 'positive' : value < 0 ? 'negative' : '';
}
function chartTooltip(item) { const comparison=trendState.frequency==='day'?'較前一交易日':'較上月',milestones=item.milestones||[],limit=trendTooltipEventLimit(),visibleEvents=item.events.slice(0,limit),remaining=item.events.length-visibleEvents.length,eventSections=visibleEvents.length?`<div class="trend-event-section"><b>${trendState.frequency==='day'?'當日':'本月'}交易 · ${item.events.length} 筆</b>${trendEventRows(visibleEvents)}${remaining>0?`<button type="button" class="trend-tooltip-more" data-trend-detail-date="${item.date}">查看全部 ${item.events.length} 筆</button>`:''}</div>`:'';return `<b class="trend-tooltip-date">${trendDateLabel(item.date)}</b>${trendMilestoneSummary(milestones)}${(item.splits||[]).map(event=>`<p class="split-row-note">${escapeHtml(event.symbol)} · ${escapeHtml(event.type)}（股數 × ${event.ratio.toFixed(4).replace(/0+$/,'').replace(/\.$/,'')}）</p>`).join('')}<div class="trend-value-block"><span>目前持有市值${item.estimated?' · 估算':''}</span><strong>${fmt(item.market)} ${item.returnRate==null?'':`<em class="${trendReturnClass(item.returnRate)}">(${fmtReturnPercent(item.returnRate)})</em>`}</strong></div><div class="trend-value-block trend-change-block"><span>${comparison}</span><strong class="${trendReturnClass(item.marketChange)}">${signedMoney(item.marketChange)} ${item.marketChangeRate==null?'':`<em>(${fmtReturnPercent(item.marketChangeRate)})</em>`}</strong></div>${eventSections}${item.missing.length?`<p class="trend-warning">${escapeHtml(item.missing.join('、'))} 缺少當期價格，以取得成本估算。</p>`:''}`; }
function trendDetailDrawer(item) { if(!item)return '';const newEvents=item.events.filter(event=>event.isNew),otherEvents=item.events.filter(event=>!event.isNew);return `<aside class="trend-detail-drawer" tabindex="-1" aria-label="${trendDateLabel(item.date)}交易明細"><div class="trend-detail-heading"><div><span>交易明細</span><strong>${trendDateLabel(item.date)}</strong></div><button type="button" class="trend-detail-close" data-trend-detail-close aria-label="關閉交易明細">×</button></div>${trendMilestoneSummary(item.milestones||[])}${newEvents.length?`<div class="trend-event-section is-new"><b>首次持有${newEvents.length>1?` · ${newEvents.length} 檔`:''}</b>${trendEventRows(newEvents)}</div>`:''}${otherEvents.length?`<div class="trend-event-section"><b>${trendState.frequency==='day'?'當日':'本月'}交易 · ${otherEvents.length} 筆</b>${trendEventRows(otherEvents)}</div>`:''}${!item.events.length?`<p class="trend-detail-empty">這個日期沒有交易紀錄。</p>`:''}</aside>`; }
function trendScale(points) { const values=points.flatMap(row=>showCost?[row.market,row.cost]:[row.market]),min=Math.min(...values),max=Math.max(...values),span=Math.max(max-min,max*.04,1),roughStep=span*1.3/4,power=10**Math.floor(Math.log10(roughStep)),normal=roughStep/power,nice=normal<=1?1:normal<=2?2:normal<=5?5:10,step=nice*power,yMin=Math.max(0,Math.floor((min-span*.15)/step)*step),yMax=Math.ceil((max+span*.15)/step)*step;return {yMin,yMax:yMax<=yMin?yMin+step*4:yMax,ticks:Array.from({length:5},(_,i)=>yMin+(yMax-yMin)*i/4)}; }
function isCompactTrendChart() { return trendChartWidth() <= 520 || (typeof matchMedia === 'function' && matchMedia('(max-width: 520px)').matches); }
function trendChartWidth() {
  const stageWidth = document.querySelector('#assetTrendChart')?.clientWidth || getMount()?.clientWidth;
  const contentWidth = document.querySelector('#main-content')?.clientWidth;
  return stageWidth || (contentWidth ? Math.max(240, contentWidth - 56) : 1000);
}
function trendChartMetrics(width=trendChartWidth()) { return width<=600?{left:82,right:18,top:36,bottom:48}:{left:80,right:24,top:52,bottom:55}; }
function trendAxisDateLabel(date, points) {
  const [year, month, day] = date.split('-');
  const firstDate = points[0].date;
  const lastDate = points[points.length - 1].date;
  const duration = (Date.parse(lastDate) - Date.parse(firstDate)) / 86400000;
  if (trendState.frequency === 'month' || duration >= 183) {
    return trendChartWidth() < 380 ? `${year}/${month}` : `${year} 年 ${Number(month)} 月`;
  }
  if (firstDate.slice(0, 4) !== lastDate.slice(0, 4)) {
    return `${year}/${month}/${day}`;
  }
  return `${Number(month)} 月 ${Number(day)} 日`;
}
function trendAxisLabelIndexes(points) {
  const width = trendChartWidth();
  const { left, right } = trendChartMetrics(width);
  const count = Math.max(2, Math.min(6, Math.floor((width - left - right) / 140)));
  if (points.length <= count) return points.map((_, index) => index);
  return Array.from({ length:count }, (_, index) => Math.round(index * (points.length - 1) / (count - 1)));
}
function compactMilestoneLabels(points) { const candidates=points.flatMap((row,index)=>visibleTrendMilestones(row.milestones).map(milestone=>({index,kind:milestone.kind}))),selected=[];['asset','gain'].forEach(kind=>{const latest=candidates.findLast(candidate=>candidate.kind===kind);if(latest)selected.push(latest);});const minGap=Math.max(2,Math.ceil(points.length/8));for(let i=candidates.length-1;i>=0&&selected.length<3;i--){const candidate=candidates[i],duplicate=selected.some(item=>item.index===candidate.index&&item.kind===candidate.kind),spaced=selected.every(item=>item.index===candidate.index||Math.abs(item.index-candidate.index)>=minGap);if(!duplicate&&spaced)selected.push(candidate);}return selected.slice(0,3); }
function milestoneLabelIndexes(points) { const indexes=points.map((row,index)=>visibleTrendMilestones(row.milestones).length?index:null).filter(index=>index!=null);if(isCompactTrendChart())return new Set(compactMilestoneLabels(points).map(item=>item.index));if(indexes.length<=5)return new Set(indexes);const stride=Math.ceil(indexes.length/5),selected=indexes.filter((_,position)=>position%stride===0);if(selected.at(-1)!==indexes.at(-1))selected.push(indexes.at(-1));return new Set(selected); }
function trendMarkerLabel(item, events = visibleTrendMarkerEvents(item.events)) { const newSymbols=(getSettings().showNewStockMarker ?? true)?events.filter(event=>event.isNew).map(event=>event.symbol):[],milestones=visibleTrendMilestones(item.milestones),parts=[];if(newSymbols.length)parts.push(`首次持有 ${newSymbols.join('、')}`);else if(events.length)parts.push(`${events.length} 筆交易`);if(milestones.length)parts.push(milestones.map(row=>row.label).join('、'));return `${trendDateLabel(item.date)}，${parts.join('，')}`; }
function trendMarkerOverlays(points,x,y,width,height,milestoneIndexes=new Set()) { return points.map((item,index)=>{const events=visibleTrendMarkerEvents(item.events),milestones=visibleTrendMilestones(item.milestones);if(!events.length&&(!milestones.length||(isCompactTrendChart()&&!milestoneIndexes.has(index))))return '';const isNew=(getSettings().showNewStockMarker ?? true)&&events.some(event=>event.isNew),hasAsset=milestones.some(row=>row.kind==='asset'),hasGain=milestones.some(row=>row.kind==='gain'),kind=events.length===1?events[0].type.toLowerCase():'mixed',className=isNew?'new-stock':hasAsset?'milestone-asset':hasGain?'milestone-gain':`event-${kind}`;return `<button type="button" class="trend-event-marker ${className}" data-trend-marker="${index}" aria-label="${escapeHtml(trendMarkerLabel(item,events))}" style="left:${x(index)/width*100}%;top:${y(item.market)/height*100}%"><span class="trend-event-halo" aria-hidden="true"></span><span class="trend-event-dot" aria-hidden="true"></span></button>`;}).join(''); }
function trendMilestoneOverlays(points,indexes,x,y,width,height) { const compact=isCompactTrendChart(),compactLabels=compact?compactMilestoneLabels(points):[],minLeft=compact?18:8,maxLeft=compact?82:92;return points.map((item,index)=>{if(!indexes.has(index))return '';const milestones=visibleTrendMilestones(item.milestones).filter(milestone=>!compact||compactLabels.some(label=>label.index===index&&label.kind===milestone.kind));return milestones.map((milestone,offset)=>{const left=Math.max(minLeft,Math.min(maxLeft,x(index)/width*100)),top=y(item.market)/height*100,mobileLane=compactLabels.findIndex(label=>label.index===index&&label.kind===milestone.kind),raise=12+(compact?mobileLane*27:offset*30);return `<span class="trend-milestone-label ${milestone.kind==='gain'?'is-gain':'is-asset'}" aria-hidden="true" style="left:${left}%;top:${top}%;transform:translate(-50%,-100%) translateY(-${raise}px)">${escapeHtml(milestone.label)}</span>`;}).join('');}).join(''); }
function trendMonthlyDataTable(points) {
  const months=new Map();
  points.forEach(row=>months.set(row.date.slice(0,7),row));
  return `<details class="chart-data-table"><summary>查看月份資產明細（${months.size} 個月）</summary><div class="chart-data-scroll" tabindex="0" role="region" aria-label="月份資產資料，可捲動"><table><caption>目前區間各月最後一筆可用資料；含估算時以文字標示。金額單位為 TWD。</caption><thead><tr><th scope="col">資料日期</th><th scope="col">持股資產</th><th scope="col">${showCost?'取得成本':'累積外部投入'}</th><th scope="col">資料狀態</th></tr></thead><tbody>${[...months.values()].map(row=>`<tr><th scope="row">${escapeHtml(row.date)}</th><td>${fmt(row.market)}</td><td>${fmt(showCost?row.cost:row.external)}</td><td>${row.estimated?'含成本估算':'依市場價格'}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function trendChart() {
  const all=trendSeries(),selected=trendSelection(all),points=selected.points;
  if(!points.length)return `<p class="trend-empty">目前沒有可顯示的歷史資料，請確認交易日期並同步市場資料。</p>`;
  const width=trendChartWidth(),height=340,{left,right,top,bottom}=trendChartMetrics(width),chartWidth=width-left-right,chartHeight=height-top-bottom,{yMin,yMax,ticks}=trendScale(points),x=i=>left+i*chartWidth/Math.max(1,points.length-1),y=v=>top+chartHeight-(v-yMin)/(yMax-yMin)*chartHeight,labels=trendAxisLabelIndexes(points),miniMin=Math.min(...all.map(row=>row.market)),miniMax=Math.max(...all.map(row=>row.market)),miniSpan=Math.max(1,miniMax-miniMin),mini=all.map((p,i)=>`${i?'L':'M'}${10+i*980/Math.max(1,all.length-1)},${36-(p.market-miniMin)/miniSpan*28}`).join(' '),startPct=selected.start/Math.max(1,all.length-1)*100,endPct=selected.end/Math.max(1,all.length-1)*100,selectionPct=endPct-startPct,compactSelection=selectionPct<4,startDate=trendDateLabel(all[selected.start].date),endDate=trendDateLabel(all[selected.end].date),labelIndexes=milestoneLabelIndexes(points),handleAria=(edge,date,index)=>`class="navigator-handle ${edge}" data-navigator-handle="${edge}" role="slider" aria-label="調整${edge==='start'?'開始':'結束'}日期，目前 ${date}" aria-valuemin="0" aria-valuemax="${all.length-1}" aria-valuenow="${index}" aria-valuetext="${date}" title="${date}；可拖曳或使用方向鍵微調"`,markers=trendMarkerOverlays(points,x,y,width,height,labelIndexes),milestoneLabels=trendMilestoneOverlays(points,labelIndexes,x,y,width,height);
  const detailItem=trendDetailDate?points.find(item=>item.date===trendDetailDate):null;
  return `<div class="trend-controls"><div class="segmented" role="group" aria-label="資料頻率"><button aria-pressed="${trendState.frequency==='month'}" data-trend-frequency="month" class="${trendState.frequency==='month'?'selected':''}">每月</button><button aria-pressed="${trendState.frequency==='day'}" data-trend-frequency="day" class="${trendState.frequency==='day'?'selected':''}">每日</button></div><div class="range trend-ranges" role="group" aria-label="顯示區間">${[['1m','1個月'],['3m','3個月'],['6m','半年'],['1y','1年'],['3y','3年'],['all','全部']].map(([key,label])=>`<button aria-pressed="${trendState.range===key}" data-trend-range="${key}" class="${trendState.range===key?'selected':''}">${label}</button>`).join('')}</div></div><p class="mobile-chart-hint">點按曲線查看明細；拖曳下方把手調整日期區間</p><div class="trend-workspace${detailItem?' has-detail':''}"><div class="trend-chart-core"><div class="trend-chart-visual"><div class="asset-chart-stage" id="assetTrendChart" tabindex="0" aria-label="持股資產走勢圖，可使用左右方向鍵查看各日期"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#0f91b8" stop-opacity=".2"/><stop offset="1" stop-color="#0f91b8" stop-opacity=".015"/></linearGradient></defs>${ticks.map(t=>`<line x1="${left}" x2="${width-right}" y1="${y(t)}" y2="${y(t)}" class="chart-grid"/>`).join('')}<path d="${trendSvgLine(points,'market',x,y)} L${x(points.length-1)},${top+chartHeight} L${x(0)},${top+chartHeight} Z" fill="url(#trendFill)"/><path d="${trendSvgLine(points,'market',x,y)}" class="trend-market-line"/>${showCost ? `<path d="${trendSvgLine(points,'cost',x,y)}" class="trend-cost-line"/>` : ''}${points.length===1?`<circle cx="${x(0)}" cy="${y(points[0].market)}" r="4" fill="#0f91b8"/>`: ''}<g id="trendFocus"></g></svg>${markers}${milestoneLabels}<span class="trend-focus-dot" id="trendFocusDot" aria-hidden="true"></span><div class="chart-y-axis" aria-hidden="true">${ticks.map(t=>`<span style="left:${left/width*100}%;top:${y(t)/height*100}%">${compact(t)}</span>`).join('')}</div><div class="chart-x-axis" aria-hidden="true">${labels.map((i,labelIndex)=>`<span class="${labelIndex===0?'is-first':labelIndex===labels.length-1?'is-last':''}" style="left:${x(i)/width*100}%">${trendAxisDateLabel(points[i].date, points)}</span>`).join('')}</div></div><div class="trend-tooltip" id="trendTooltip" role="status" aria-live="polite"></div></div><div class="trend-navigator-wrap"><div class="trend-navigator-dates"><span data-navigator-date="start">${startDate}</span><span data-navigator-date="end">${endDate}</span></div><div class="trend-navigator" id="trendNavigator" aria-label="拖曳以選擇圖表日期區間"><svg viewBox="0 0 1000 42" preserveAspectRatio="none"><path d="${mini}" class="navigator-line"/></svg><div class="navigator-selection${compactSelection?' compact':''}" style="left:${startPct}%;right:${100-endPct}%"><button ${handleAria('start',startDate,selected.start)}></button><button ${handleAria('end',endDate,selected.end)}></button></div></div></div></div>${trendDetailDrawer(detailItem)}</div>${trendMonthlyDataTable(points)}`;
}
function trendIndexAtClientX(clientX,rect,length,viewWidth=trendChartWidth()) { if(length<=1)return 0;const {left,right}=trendChartMetrics(viewWidth),chartX=(clientX-rect.left)/Math.max(1,rect.width)*viewWidth,pointGap=(viewWidth-left-right)/(length-1),nearest=Math.round((chartX-left)/pointGap);return Math.max(0,Math.min(length-1,nearest)); }
function trendIndexAtStageClientX(stage,clientX,length) { const svg=stage.querySelector('svg'),rect=svg?.getBoundingClientRect()||stage.getBoundingClientRect(),viewWidth=svg?.viewBox?.baseVal?.width||trendChartWidth();return trendIndexAtClientX(clientX,rect,length,viewWidth); }
function updateTrendFocus(index) { const points=trendSelection().points,item=points[index],stage=document.querySelector('#assetTrendChart');if(!item||!stage)return;const svg=stage.querySelector('svg'),width=svg?.viewBox?.baseVal?.width||trendChartWidth(),height=svg?.viewBox?.baseVal?.height||340,{left,right,top,bottom}=trendChartMetrics(width),chartWidth=width-left-right,chartHeight=height-top-bottom,{yMin,yMax}=trendScale(points),x=left+index*chartWidth/Math.max(1,points.length-1),y=value=>top+chartHeight-(value-yMin)/(yMax-yMin)*chartHeight,focus=document.querySelector('#trendFocus'),focusDot=document.querySelector('#trendFocusDot'),tip=document.querySelector('#trendTooltip');if(!focus||!focusDot||!tip)return;stage.dataset.focusIndex=index;stage.querySelectorAll('[data-trend-marker]').forEach(marker=>marker.classList.toggle('is-active',Number(marker.dataset.trendMarker)===index));focus.innerHTML=`<line x1="${x}" x2="${x}" y1="${top}" y2="${top+chartHeight}" class="trend-crosshair"/>`;focusDot.style.left=`${x/width*100}%`;focusDot.style.top=`${y(item.market)/height*100}%`;focusDot.classList.add('show');tip.innerHTML=chartTooltip(item);tip.classList.add('show');const rect=stage.getBoundingClientRect(),anchor=x/width*rect.width;tip.style.left=`${anchor}px`;tip.classList.toggle('right',anchor>rect.width*.62); }
function trendSetRange(range) {
  trendState.range = range;
  trendSelection();
  repaintTrend();
}
function trendSetFrequency(frequency) {
  trendState.frequency = frequency;
  trendState.start = null;
  trendState.end = null;
  trendSetRange(frequency === 'day' ? '1y' : 'all');
  document.querySelector(`[data-trend-frequency="${frequency}"]`)?.focus();
}
function indexForNavigator(clientX,rect,length) { return Math.max(0,Math.min(length-1,Math.round((clientX-rect.left)/rect.width*(length-1)))); }
function trendNavigatorDragMode({clientX,selectionRect,handleEdge,compact,mobile=isCompactTrendChart()}) { if(!selectionRect)return 'jump';if(mobile){const edgeZone=Math.min(18,selectionRect.width/2);if(clientX<=selectionRect.left+edgeZone)return 'start';if(clientX>=selectionRect.right-edgeZone)return 'end';return 'move';}if(handleEdge&&compact)return clientX<(selectionRect.left+selectionRect.right)/2?'start':'end';return handleEdge||'move'; }
function repaintTrend() {
  const mount = document.querySelector('#trendChartMount');
  if (!mount) return;
  dispose();
  mount.innerHTML = renderChart();
  bindTrendInteractions();
}
function previewTrendNavigator(navigator,all) { const selected=trendSelection(all),denominator=Math.max(1,all.length-1),startPct=selected.start/denominator*100,endPct=selected.end/denominator*100,selection=navigator.querySelector('.navigator-selection'),startDate=trendDateLabel(all[selected.start].date),endDate=trendDateLabel(all[selected.end].date);if(selection){selection.style.left=`${startPct}%`;selection.style.right=`${100-endPct}%`;selection.classList.toggle('compact',endPct-startPct<4);}const startLabel=document.querySelector('[data-navigator-date="start"]'),endLabel=document.querySelector('[data-navigator-date="end"]'),rangeLabel=document.querySelector('[data-navigator-range-label]');if(startLabel)startLabel.textContent=startDate;if(endLabel)endLabel.textContent=endDate;if(rangeLabel)rangeLabel.textContent='自訂區間';[['start',selected.start,startDate],['end',selected.end,endDate]].forEach(([edge,index,date])=>{const handle=navigator.querySelector(`[data-navigator-handle="${edge}"]`);if(handle){handle.setAttribute('aria-valuenow',index);handle.setAttribute('aria-valuetext',date);handle.setAttribute('aria-label',`調整${edge==='start'?'開始':'結束'}日期，目前 ${date}`);handle.title=`${date}；可拖曳或使用方向鍵微調`;}}); }
let trendPreviewFrame=null;
function previewTrendChart() { if(trendPreviewFrame!=null)return;trendPreviewFrame=requestAnimationFrame(()=>{trendPreviewFrame=null;const template=document.createElement('template');template.innerHTML=renderChart();const currentStage=document.querySelector('#assetTrendChart'),nextStage=template.content.querySelector(selector('#assetTrendChart'));if(currentStage&&nextStage)currentStage.replaceWith(nextStage);}); }
function bindTrendInteractions() {
  dispose();
  document.querySelectorAll('[data-trend-frequency]').forEach(button=>bindClick(button,()=>trendSetFrequency(button.dataset.trendFrequency)));
  document.querySelectorAll('[data-trend-range]').forEach(button=>bindClick(button,()=>trendSetRange(button.dataset.trendRange)));
  const stage=document.querySelector('#assetTrendChart');
  if(stage){
    let pointerFrame=null,pointerX=null;
    listen(stage,'pointermove',event=>{if(event.target.closest?.('[data-trend-detail-date]'))return;pointerX=event.clientX;if(pointerFrame!==null)return;pointerFrame=requestAnimationFrame(()=>{pointerFrame=null;if(!stage.isConnected)return;const points=trendSelection().points,index=trendIndexAtStageClientX(stage,pointerX,points.length);if(Number(stage.dataset.focusIndex)!==index||!document.querySelector('#trendTooltip')?.classList.contains('show'))updateTrendFocus(index);});});
    listen(stage,'pointerdown',event=>{if(event.target.closest?.('[data-trend-marker]'))return;const points=trendSelection().points,index=trendIndexAtStageClientX(stage,event.clientX,points.length);updateTrendFocus(index);});
    listen(stage,'click',event=>{const more=event.target.closest?.('[data-trend-detail-date]');if(more)openTrendDetailByDate(more.dataset.trendDetailDate);});
    listen(stage,'keydown',event=>{const points=trendSelection().points;if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!points.length)return;event.preventDefault();const current=Number(stage.dataset.focusIndex ?? points.length-1),next=event.key==='Home'?0:event.key==='End'?points.length-1:Math.max(0,Math.min(points.length-1,current+(event.key==='ArrowLeft'?-1:1)));updateTrendFocus(next);});
    listen(stage,'pointerleave',()=>{if(pointerFrame!==null){cancelAnimationFrame(pointerFrame);pointerFrame=null;}if(typeof matchMedia==='function'&&!matchMedia('(hover: hover)').matches)return;document.querySelector('#trendTooltip')?.classList.remove('show');document.querySelector('#trendFocusDot')?.classList.remove('show');stage.querySelectorAll('[data-trend-marker].is-active').forEach(marker=>marker.classList.remove('is-active'));});
    stage.querySelectorAll('[data-trend-marker]').forEach(marker=>{
      const show=()=>updateTrendFocus(Number(marker.dataset.trendMarker));
      listen(marker,'focus',show);
      listen(marker,'click',event=>{const points=trendSelection().points,index=event.clientX||event.clientY?trendIndexAtStageClientX(stage,event.clientX,points.length):Number(marker.dataset.trendMarker);openTrendDetail(index);});
      listen(marker,'keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openTrendDetail(marker.dataset.trendMarker);}});
    });
  }
  listen(document.querySelector('#trendTooltip'),'click',event=>{const more=event.target.closest?.('[data-trend-detail-date]');if(more)openTrendDetailByDate(more.dataset.trendDetailDate);});
  listen(document.querySelector('[data-trend-detail-close]'),'click',()=>{trendDetailDate=null;repaintTrend();});
  const navigator=document.querySelector('#trendNavigator');
  if(!navigator || trendSeries().length < 2)return;
  navigator.querySelectorAll('[data-navigator-handle]').forEach(handle=>listen(handle,'keydown',event=>{
    const edge=handle.dataset.navigatorHandle,all=trendSeries(),selected=trendSelection(all),step=event.shiftKey?10:1;
    let next=edge==='start'?selected.start:selected.end;
    if(event.key==='ArrowLeft')next-=step;
    else if(event.key==='ArrowRight')next+=step;
    else if(event.key==='Home')next=edge==='start'?0:selected.start+1;
    else if(event.key==='End')next=edge==='start'?selected.end-1:all.length-1;
    else return;
    event.preventDefault();
    if(edge==='start')trendState.start=Math.max(0,Math.min(next,selected.end-1));
    else trendState.end=Math.min(all.length-1,Math.max(next,selected.start+1));
    trendState.range='custom';
    repaintTrend();
    requestAnimationFrame(()=>document.querySelector(`[data-navigator-handle="${edge}"]`)?.focus());
  }));
  listen(navigator,'pointerdown',event=>{
    const all=trendSeries(),selected=trendSelection(all),rect=navigator.getBoundingClientRect(),target=event.target,handle=target.closest?.('[data-navigator-handle]'),selection=target.closest?.('.navigator-selection'),selectionRect=selection?.getBoundingClientRect(),mode=trendNavigatorDragMode({clientX:event.clientX,selectionRect,handleEdge:handle?.dataset.navigatorHandle,compact:selection?.classList.contains('compact')}),origin=indexForNavigator(event.clientX,rect,all.length),start=selected.start,end=selected.end;
    if(mode==='jump'){
      const span=end-start;
      trendState.start=Math.max(0,Math.min(all.length-1-span,origin-Math.round(span/2)));
      trendState.end=trendState.start+span;
      trendState.range='custom';
      repaintTrend();
      return;
    }
    const move=e=>{
      const idx=indexForNavigator(e.clientX,rect,all.length),delta=idx-origin;
      if(mode==='start'){trendState.start=Math.max(0,Math.min(idx,end-1));trendState.end=end;}
      else if(mode==='end'){trendState.start=start;trendState.end=Math.min(all.length-1,Math.max(idx,start+1));}
      else{const span=end-start;trendState.start=Math.max(0,Math.min(all.length-1-span,start+delta));trendState.end=trendState.start+span;}
      trendState.range='custom';
      previewTrendNavigator(navigator,all);
      previewTrendChart();
    };
    const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);if(trendPreviewFrame!=null){cancelAnimationFrame(trendPreviewFrame);trendPreviewFrame=null;}repaintTrend();};
    document.addEventListener('pointermove',move);
    document.addEventListener('pointerup',up);
    document.addEventListener('pointercancel',up);
    event.preventDefault();
  });
}
function openTrendDetail(index) { const item=trendSelection().points[Number(index)];if(item)openTrendDetailByDate(item.date); }
function openTrendDetailByDate(date) { trendDetailDate=date;repaintTrend();requestAnimationFrame(()=>document.querySelector('.trend-detail-drawer')?.focus()); }

  return { render:renderChart, bind:bindTrendInteractions, repaint:repaintTrend, dispose, trendDailySeries, trendSeries, trendSelection, chartTooltip, trendSetFrequency, trendIndexAtClientX, trendChartWidth, trendChartMetrics, trendAxisLabelIndexes, trendAxisDateLabel };
}
