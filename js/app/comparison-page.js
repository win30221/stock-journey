import { createCancellableTask } from './async-state.js';
import { calculateStockComparison } from '../domain/comparison.js';
import { normaliseSplitEvents } from '../domain/splits.js';
import { escapeHtml } from '../lib/format.js';
import { shiftDate } from '../lib/date.js';

export function createComparisonPage({ stockSearch, fetchData, getCaches, getTargetDate, repaint, isActive, document = globalThis.document }) {
  const task = createCancellableTask();
  const colors = ['#087e9b', '#7945cc', '#b45309', '#2563eb', '#be185d'];
  let selected = [], start = '', end = '', query = '', error = '', progress = '', result = null, revision = 0;
  let plotWidth = 1000;
  let sessionCaches = [], hidden = new Set(), activeSuggestion = -1, focusIndex = 0;
  const percent = value => value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
  const colorFor = symbol => colors[selected.findIndex(stock => stock.symbol === symbol) % colors.length];

  function invalidate() {
    revision++;
    result = null;
    error = '';
    void task.cancel();
  }

  function suggestions() {
    return stockSearch.suggestions(query).filter(stock => !selected.some(item => item.symbol === stock.symbol));
  }

  function renderSuggestions() {
    const list = document.querySelector('#comparisonSuggestions');
    const input = document.querySelector('#comparisonQuery');
    if (!list || !input) return;
    const rows = suggestions();
    activeSuggestion = -1;
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', String(Boolean(query.trim())));
    list.hidden = !query.trim();
    const status = stockSearch.getStatus();
    list.innerHTML = rows.length ? rows.map((stock, index) => `<button type="button" role="option" aria-selected="false" id="comparisonOption${index}" data-comparison-option="${index}" tabindex="-1"><b>${escapeHtml(stock.symbol)}</b> ${escapeHtml(stock.name)}</button>`).join('') : `<p>${status.status === 'loading' ? '股票清單載入中…' : status.error ? '清單連線失敗，可輸入完整代號後按加入。' : '沒有符合的股票，可輸入完整代號後按加入。'}</p>`;
    list.querySelectorAll('[data-comparison-option]').forEach(button => {
      button.addEventListener('mousedown', event => event.preventDefault());
      button.addEventListener('click', () => add(rows[Number(button.dataset.comparisonOption)]));
    });
  }

  function add(stock = stockSearch.resolve(query)) {
    if (!stock && /^[0-9]{4,6}[A-Za-z]?$/.test(query.trim())) stock = { symbol:query.trim().toUpperCase(), name:'' };
    if (!stock) error = '請從搜尋結果選擇股票，或輸入完整股票代號。';
    else if (selected.some(item => item.symbol === stock.symbol)) error = '這檔股票已在比較清單。';
    else if (selected.length >= 5) error = '最多比較 5 檔股票，請先移除一檔。';
    else {
      invalidate();
      selected = [...selected, stock];
      query = '';
    }
    repaint();
    document.querySelector('#comparisonQuery')?.focus();
  }

  async function compare() {
    if (task.busy) return;
    error = '';
    const target = getTargetDate();
    if (selected.length < 2) error = '請加入至少 2 檔股票。';
    else if (!start || !end || start >= end) error = '結束日期須晚於開始日期。';
    if (error) { repaint(); return; }
    const version = ++revision, stocks = [...selected], from = start, through = end;
    result = null;
    try {
      const pending = task.run(async job => {
        progress = '正在確認分割資料…';
        repaint();
        const splitRows = await fetchData('TaiwanStockSplitPrice', null, null, target, { signal:job.signal });
        job.check();
        const caches = [];
        for (const stock of stocks) {
          progress = `取得 ${stock.symbol} 每日價格（${caches.length + 1} / ${stocks.length}）`;
          repaint();
          const cached = [...sessionCaches, ...getCaches()].find(cache => cache.symbol === stock.symbol && cache.priceCoverageFrom <= from && cache.priceCheckedThrough >= through);
          const prices = cached ? cached.prices : (await fetchData('TaiwanStockPrice', stock.symbol, from, through, { signal:job.signal })).map(row => ({ date:row.date, close:Number(row.close) }));
          job.check();
          const verifiedThrough = prices.reduce((latest, row) => row.date <= through && row.date > latest && Number.isFinite(Number(row.close)) && Number(row.close) > 0 ? row.date : latest, target);
          caches.push({ symbol:stock.symbol, name:stock.name || cached?.name, prices, priceCoverageFrom:from, priceCheckedThrough:through < verifiedThrough ? through : verifiedThrough, splits:normaliseSplitEvents(splitRows, stock.symbol, verifiedThrough), splitCheckedThrough:verifiedThrough });
        }
        job.check();
        if (version !== revision) return;
        result = calculateStockComparison({ symbols:stocks.map(stock => stock.symbol), marketCaches:caches, startDate:from, endDate:through });
        sessionCaches = caches;
        hidden = new Set();
        focusIndex = result.dates.length - 1;
      });
      await pending;
    } catch (failure) {
      if (failure.name !== 'AbortError' && version === revision) error = failure.message || '比較失敗，請稍後重試。';
    } finally {
      progress = '';
      if (isActive()) repaint();
    }
  }

  function chart() {
    const visible = result.series.filter(series => !hidden.has(series.symbol));
    const values = visible.flatMap(series => series.values.filter(value => value != null));
    const min = Math.min(0, ...values), max = Math.max(0, ...values), pad = Math.max(1, (max - min) * 0.12);
    const lower = min - pad, upper = max + pad;
    plotWidth = Math.max(320, Math.min(1000, (document.querySelector('#main-content')?.clientWidth || 1056) - 56));
    const x = index => 55 + index / (result.dates.length - 1) * (plotWidth - 75);
    const y = value => 315 - (value - lower) / (upper - lower) * 280;
    const ticks = Array.from({ length:5 }, (_, i) => lower + i / 4 * (upper - lower));
    const labels = plotWidth < 550 ? [0, result.dates.length - 1] : [...new Set([0, Math.floor((result.dates.length - 1) / 2), result.dates.length - 1])];
    return `<div id="comparisonChart" class="comparison-chart" tabindex="0" role="group" aria-label="百分比走勢圖；左右方向鍵查看日期，Home 與 End 跳至起訖日">
      <svg viewBox="0 0 ${plotWidth} 360" role="img" aria-label="分割調整後累積漲跌幅，多檔從 0% 開始；下方提供完整資料表">
      ${ticks.map(tick => `<line x1="55" x2="${plotWidth - 20}" y1="${y(tick)}" y2="${y(tick)}" class="comparison-grid"/><text x="45" y="${y(tick) + 5}" text-anchor="end">${tick.toFixed(1)}%</text>`).join('')}
      <line x1="55" x2="${plotWidth - 20}" y1="${y(0)}" y2="${y(0)}" class="comparison-zero"/>
      ${visible.map(series => {
        let connected = false;
        const path = series.values.map((value, index) => {
          if (value == null) { connected = false; return ''; }
          const command = connected ? 'L' : 'M';
          connected = true;
          return `${command}${x(index)},${y(value)}`;
        }).join(' ');
        return `<path d="${path}" fill="none" stroke="${colorFor(series.symbol)}" stroke-width="2.8" stroke-dasharray="${['','8 4','3 4','10 4 2 4','4 2'][selected.findIndex(stock => stock.symbol === series.symbol)]}" vector-effect="non-scaling-stroke"/><circle cx="${x(series.values.length - 1)}" cy="${y(series.change)}" r="4" fill="${colorFor(series.symbol)}"/>`;
      }).join('')}
      ${labels.map(index => `<text x="${x(index)}" y="348" text-anchor="${index === 0 ? 'start' : index === result.dates.length - 1 ? 'end' : 'middle'}">${result.dates[index]}</text>`).join('')}
      <line id="comparisonCursor" x1="${x(focusIndex)}" x2="${x(focusIndex)}" y1="30" y2="315" class="comparison-cursor" visibility="hidden"/>
      </svg><div id="comparisonFocus" class="comparison-tooltip" role="status" aria-live="polite" hidden>${focusDetails()}</div></div><p class="comparison-touch-hint">滑鼠移動、點按曲線或使用左右方向鍵查看同日數據。</p>`;
  }

  function focusDetails() {
    return `<div class="comparison-tooltip-heading"><b>${result.dates[focusIndex]}</b><small>累積漲跌幅</small></div>${result.series.filter(series => !hidden.has(series.symbol)).map(series => `<div class="comparison-tooltip-row" style="--series-color:${colorFor(series.symbol)}"><span><b>${escapeHtml(series.symbol)}</b><small>${escapeHtml(series.name === series.symbol ? '' : series.name)}</small></span><strong>${percent(series.values[focusIndex])}</strong></div>`).join('')}`;
  }

  function summaryMarkup() {
    const ranking = [...result.series].sort((a, b) => b.change - a.change);
    return `<div class="comparison-summary-heading"><h3>期間股價變化</h3><span>點選卡片顯示或隱藏曲線</span></div>
      <div class="comparison-summary" role="group" aria-label="期間股價變化與曲線顯示">${ranking.map(series => {
        const dash = ['', '8 4', '3 4', '10 4 2 4', '4 2'][selected.findIndex(stock => stock.symbol === series.symbol)];
        return `<button type="button" data-toggle-series="${escapeHtml(series.symbol)}" aria-pressed="${!hidden.has(series.symbol)}" style="--series-color:${colorFor(series.symbol)}">
          <span class="comparison-summary-label"><svg width="24" height="8" viewBox="0 0 24 8" aria-hidden="true"><path d="M0 4 H24" stroke="currentColor" stroke-width="3" stroke-dasharray="${dash}"/></svg><span>${escapeHtml(series.symbol)} ${escapeHtml(series.name === series.symbol ? '' : series.name)}</span></span>
          <strong>${percent(series.change)}</strong>
          ${series.missing ? `<small>${series.missing} 日缺資料，曲線以缺口顯示</small>` : ''}
        </button>`;
      }).join('')}</div>`;
  }

  function resultsMarkup() {
    if (!result) return `<section class="panel comparison-empty"><div class="comparison-empty-icon" aria-hidden="true">↗</div><h2>從 0% 開始，看見表現差異</h2><p>加入股票並選擇日期，即可比較每日走勢。<br>不需要交易紀錄或設定投入金額。</p></section>`;
    const events = result.series.flatMap(series => series.events.map(event => ({ ...event, symbol:series.symbol })));
    return `<section class="panel comparison-results"><div class="panel-title"><div><p class="eyebrow">累積漲跌幅</p><h2>走勢比較</h2><p>實際共同區間：${result.actualStart} ～ ${result.actualEnd} · 分割調整後，不含股息</p></div></div>${result.actualStart !== start || result.actualEnd !== end ? '<p class="split-warning">已使用所選範圍內共同可用的股價資料；資料尚未更新、休市或上市前無資料的日期不納入比較。</p>' : ''}${summaryMarkup()}${chart()}
      ${events.length ? `<details class="split-events"><summary>期間分割事件（${events.length}）</summary><ul>${events.map(event => `<li>${event.date} · ${escapeHtml(event.symbol)} · ${escapeHtml(event.type)} · 股數 × ${Number(event.ratio.toPrecision(8))}</li>`).join('')}</ul></details>` : ''}
      <details class="comparison-data"><summary>查看每日比較數據</summary><div class="price-table-wrap" tabindex="0" role="region" aria-label="每日比較數據，可橫向捲動"><table><caption>累積漲跌百分比；— 表示缺資料</caption><thead><tr><th>日期</th>${result.series.map(series => `<th>${escapeHtml(series.symbol)}</th>`).join('')}</tr></thead><tbody>${result.dates.map((date, index) => `<tr><th scope="row">${date}</th>${result.series.map(series => `<td>${percent(series.values[index])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details></section>`;
  }

  function render() {
    if (!end) { end = getTargetDate(); start = shiftDate(end, -90); }
    return `<div class="comparison-page"><section class="panel comparison-controls"><div class="panel-title"><div><h2>選擇比較標的</h2><p>最多 5 檔股票或 ETF，未持有也能比較。</p></div><span class="comparison-count">${selected.length} / 5</span></div>
      <div class="comparison-search"><label for="comparisonQuery">股票代號或名稱</label><div class="comparison-search-row"><input id="comparisonQuery" value="${escapeHtml(query)}" placeholder="例如 0050、台積電" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="comparisonSuggestions"/><button type="button" class="secondary" id="comparisonAdd">加入</button></div><div id="comparisonSuggestions" class="comparison-suggestions" role="listbox" aria-label="股票搜尋結果" hidden></div></div>
      <div class="comparison-chips">${selected.map(stock => `<button type="button" data-remove-comparison="${escapeHtml(stock.symbol)}" style="--series-color:${colorFor(stock.symbol)}" aria-label="移除 ${escapeHtml(stock.symbol)} ${escapeHtml(stock.name)}"><span></span>${escapeHtml(stock.symbol)} ${escapeHtml(stock.name)} <b aria-hidden="true">×</b></button>`).join('')}</div>
      <form id="comparisonForm"><div class="comparison-dates"><label for="comparisonStart">開始日期<input id="comparisonStart" type="date" value="${start}" required/></label><span aria-hidden="true">—</span><label for="comparisonEnd">結束日期<input id="comparisonEnd" type="date" value="${end}" required/></label><button class="primary" type="submit" ${task.busy ? 'disabled aria-busy="true"' : ''}>${task.busy ? '比較中…' : '開始比較'}</button></div><div class="comparison-ranges">${[['30','近一月'],['90','近三月'],['365','近一年'],['year','今年以來']].map(([key, label]) => `<button type="button" data-comparison-range="${key}">${label}</button>`).join('')}</div></form>
      ${error ? `<p class="operation-error" role="alert">${escapeHtml(error)}</p>` : ''}${progress ? `<p role="status">${escapeHtml(progress)}</p>` : ''}<p class="comparison-method">自動校正已知分割、反分割與面額變更；不含現金股息、配股、減資與交易費用。資料來源：FinMind。比較清單僅保留於本次開啟。</p></section>${resultsMarkup()}</div>`;
  }

  function bind() {
    const input = document.querySelector('#comparisonQuery');
    if (!input) return;
    input.addEventListener('input', () => { query = input.value; renderSuggestions(); });
    input.addEventListener('focus', renderSuggestions);
    input.addEventListener('blur', () => setTimeout(() => {
      if (document.querySelector('#comparisonQuery') !== input) return;
      const list = document.querySelector('#comparisonSuggestions');
      if (list) list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
    }, 140));
    input.addEventListener('keydown', event => {
      const rows = suggestions();
      if (['ArrowDown', 'ArrowUp'].includes(event.key) && rows.length) {
        event.preventDefault();
        activeSuggestion = (activeSuggestion + (event.key === 'ArrowDown' ? 1 : rows.length - 1) + rows.length) % rows.length;
        document.querySelectorAll('[data-comparison-option]').forEach((button, index) => button.setAttribute('aria-selected', String(index === activeSuggestion)));
        input.setAttribute('aria-activedescendant', `comparisonOption${activeSuggestion}`);
      } else if (event.key === 'Enter') { event.preventDefault(); add(activeSuggestion >= 0 ? rows[activeSuggestion] : undefined); }
      else if (event.key === 'Escape') { document.querySelector('#comparisonSuggestions').hidden = true; input.setAttribute('aria-expanded', 'false'); }
    });
    document.querySelector('#comparisonAdd')?.addEventListener('click', () => add());
    document.querySelectorAll('[data-remove-comparison]').forEach(button => button.addEventListener('click', () => {
      invalidate();
      selected = selected.filter(stock => stock.symbol !== button.dataset.removeComparison);
      repaint();
      document.querySelector('#comparisonQuery')?.focus();
    }));
    for (const [id, set] of [['comparisonStart', value => { start = value; }], ['comparisonEnd', value => { end = value; }]]) {
      document.querySelector(`#${id}`)?.addEventListener('change', event => {
        set(event.target.value); invalidate(); repaint(); document.querySelector(`#${id}`)?.focus();
      });
    }
    document.querySelectorAll('[data-comparison-range]').forEach(button => button.addEventListener('click', () => {
      end = getTargetDate();
      start = button.dataset.comparisonRange === 'year' ? `${end.slice(0, 4)}-01-01` : shiftDate(end, -Number(button.dataset.comparisonRange));
      invalidate(); repaint();
      document.querySelector(`[data-comparison-range="${button.dataset.comparisonRange}"]`)?.focus();
    }));
    document.querySelector('#comparisonForm')?.addEventListener('submit', event => { event.preventDefault(); void compare(); });
    document.querySelectorAll('[data-toggle-series]').forEach(button => button.addEventListener('click', () => {
      const symbol = button.dataset.toggleSeries;
      if (hidden.has(symbol)) hidden.delete(symbol);
      else if (hidden.size < selected.length - 1) hidden.add(symbol);
      repaint(); document.querySelector(`[data-toggle-series="${symbol}"]`)?.focus();
    }));
    const chartNode = document.querySelector('#comparisonChart');
    const focus = index => {
      focusIndex = Math.max(0, Math.min(result.dates.length - 1, index));
      const cursor = document.querySelector('#comparisonCursor');
      const position = 55 + focusIndex / (result.dates.length - 1) * (plotWidth - 75);
      cursor?.setAttribute('x1', position); cursor?.setAttribute('x2', position);
      const detail = document.querySelector('#comparisonFocus');
      if (detail) {
        detail.innerHTML = focusDetails();
        detail.hidden = false;
        const box = chartNode.getBoundingClientRect();
        const anchor = position / plotWidth * box.width;
        const tooltipWidth = detail.getBoundingClientRect().width;
        const left = anchor + tooltipWidth + 18 > box.width ? anchor - tooltipWidth - 18 : anchor + 18;
        detail.style.left = `${Math.max(4, Math.min(box.width - tooltipWidth - 4, left))}px`;
      }
      cursor?.setAttribute('visibility', 'visible');
    };
    const point = event => { const box = chartNode.getBoundingClientRect(); focus(Math.round(((event.clientX - box.left) / box.width * plotWidth - 55) / (plotWidth - 75) * (result.dates.length - 1))); };
    chartNode?.addEventListener('pointermove', event => { if (event.pointerType === 'mouse') point(event); });
    chartNode?.addEventListener('pointerdown', point);
    chartNode?.addEventListener('focus', () => focus(focusIndex));
    const hideTooltip = () => {
      const tooltip = document.querySelector('#comparisonFocus');
      if (tooltip) tooltip.hidden = true;
      document.querySelector('#comparisonCursor')?.setAttribute('visibility', 'hidden');
    };
    chartNode?.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse') hideTooltip(); });
    chartNode?.addEventListener('blur', hideTooltip);
    chartNode?.addEventListener('keydown', event => {
      if (event.key === 'Escape') { hideTooltip(); return; }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      focus(event.key === 'Home' ? 0 : event.key === 'End' ? result.dates.length - 1 : focusIndex + (event.key === 'ArrowLeft' ? -1 : 1));
    });
    void stockSearch.ensureCatalog().then(() => { if (document.querySelector('#comparisonQuery') === input && document.activeElement === input) renderSuggestions(); });
  }

  return { render, bind, compare, resize() { if (result) repaint(); }, async reset() {
    revision++;
    await task.cancel();
    sessionCaches = []; result = null; selected = []; query = ''; error = ''; progress = ''; start = ''; end = '';
  } };
}
