const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

test('settings and transaction actions avoid legacy string slicing and duplicate IDs', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  assert.match(source, /function chartSettingsPanel\(\)/);
  assert.doesNotMatch(source, /baseSettingsPage|groupedSettingsPage|legacy\.slice/);
  assert.doesNotMatch(source, /id="(?:transactionImport|addTransaction)"/);
  assert.match(source, /data-transaction-import/);
  assert.match(source, /data-add-transaction/);
  assert.doesNotMatch(source, /applyBudgetTarget/);
});

test('manual transaction stock field supports accessible Chinese autocomplete', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  const styles = fs.readFileSync('styles.css', 'utf8');

  assert.match(source, /股票代號或名稱/);
  assert.match(source, /id="transactionSymbol"[^>]+placeholder="例如：0050 或 元大台灣50"[^>]+value="\$\{escapeHtml\(transaction\?\.symbol\|\|''\)\}"/, 'stock symbol should stay empty and show both a symbol and Chinese name as hints');
  assert.doesNotMatch(source, /placeholder="例如：00878/);
  assert.match(source, /role="combobox"[^>]+aria-autocomplete="list"[^>]+aria-controls="transactionStockSuggestions"/);
  assert.match(source, /id="transactionStockSuggestions" role="listbox"/);
  assert.match(source, /fetchFinMindData\('TaiwanStockInfo'\)/);
  assert.match(source, /event\.key==='ArrowDown'/);
  assert.match(source, /resolveStockQuery\(stockCatalog,symbolQuery\)/);
  assert.match(styles, /\.stock-suggestions\s*\{/);
  assert.match(styles, /\.stock-suggestions button\s*\{[^}]*min-height:\s*44px/);
  assert.match(styles, /\.transaction-form-grid > label, \.transaction-form-grid > \.transaction-field\s*\{[^}]*align-self:\s*start/, 'desktop form fields should align to the top of each grid row');
  assert.match(styles, /\.transaction-field\s*\{[^}]*font-size:\s*\.72rem[^}]*font-weight:\s*700/, 'autocomplete field should inherit the same typography as the other form controls');
});

test('transaction holdings show unrealized amount together with return percentage', () => {
  const source = fs.readFileSync('app.js', 'utf8');

  assert.match(source, /<small>未實現損益<\/small>/);
  assert.match(source, /fmtSignedMoney\(unrealized\.amount\)/);
  assert.match(source, /fmtReturnPercentDetail\(unrealized\.percent\)/);
  assert.match(source, /fmtSignedMoney\(rowReturn\.amount\)/);
  assert.match(source, /`（\$\{fmtReturnPercent\(value\)\}）`/);
  assert.doesNotMatch(source, /<small>目前損益<\/small>/);
});

test('chart event markers stay above the generic blue focus dot', () => {
  const styles = fs.readFileSync('styles.css', 'utf8');
  const focusLayer = styles.match(/\.trend-focus-dot\s*\{[^}]*z-index:\s*(\d+)/)?.[1];
  const markerLayer = styles.match(/\.trend-event-marker\s*\{[^}]*z-index:\s*(\d+)/)?.[1];

  assert.ok(focusLayer, 'trend focus dot should define its layer');
  assert.ok(markerLayer, 'trend event marker should define its layer');
  assert.ok(Number(markerLayer) > Number(focusLayer), 'semantic marker color must not be covered by the focus dot');
});

test('navigation uses a complete selected surface without edge indicators', () => {
  const styles = fs.readFileSync('styles.css', 'utf8');
  const desktopActiveRule = styles.match(/^nav button\.active\s*\{([^}]+)\}/m)?.[1] || '';
  const mobileStyles = styles.match(/@media \(max-width: 800px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const activeRule = mobileStyles.match(/nav button\.active\s*\{([^}]+)\}/)?.[1] || '';

  assert.match(desktopActiveRule, /box-shadow:\s*none/);
  assert.doesNotMatch(desktopActiveRule, /inset/);
  assert.match(activeRule, /border-color:/);
  assert.match(activeRule, /box-shadow:\s*none/);
  assert.doesNotMatch(activeRule, /inset\s+0\s+-3px/);
});

test('page navigation moves to the top without focus-induced scrolling', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  const transition = source.match(/function renderPageAtTop\(\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.ok(transition.indexOf('scrollTo?.(0, 0)') < transition.indexOf('render()'));
  assert.match(transition, /focus\(\{ preventScroll:true \}\)/);
  assert.match(source, /function navigateToPage[\s\S]*?renderPageAtTop\(\)/);
  assert.match(source, /function syncPageFromHash[\s\S]*?renderPageAtTop\(\)/);
});

test('mobile navigation remains visible while the page scrolls', () => {
  const styles = fs.readFileSync('styles.css', 'utf8');
  const mobileStyles = styles.match(/@media \(max-width: 800px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  const asideRule = mobileStyles.match(/aside\s*\{([^}]+)\}/)?.[1] || '';

  assert.match(asideRule, /position:\s*sticky/);
  assert.match(asideRule, /top:\s*0/);
  assert.match(asideRule, /z-index:\s*40/);
});

test('mobile navigation opens as an accessible side drawer', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  const styles = fs.readFileSync('styles.css', 'utf8');

  assert.match(source, /class="mobile-menu-toggle"[^>]+aria-label="開啟菜單"[^>]+aria-controls="mobileNavigationPanel"[^>]+aria-expanded="false"/);
  assert.doesNotMatch(source, /class="mobile-menu-toggle"[^>]*>[\s\S]*?<span>菜單<\/span>/);
  assert.match(source, /class="mobile-nav-close"[^>]+aria-label="關閉菜單"/);
  assert.match(source, /backdrop\.addEventListener\('click',\(\)=>setOpen\(false,true\)\)/);
  assert.match(source, /panel\.inert=!open/);
  assert.match(styles, /\.mobile-nav-panel\s*\{[^}]*position:\s*fixed[^}]*transform:\s*translateX\(-105%\)/);
  assert.match(styles, /aside\.mobile-nav-is-open \.mobile-nav-panel\s*\{[^}]*transform:\s*translateX\(0\)/);
});

test('chart labels stay readable above markers while the active tooltip stays foremost', () => {
  const styles = fs.readFileSync('styles.css', 'utf8');
  const markerLayer = styles.match(/\.trend-event-marker\s*\{[^}]*z-index:\s*(\d+)/)?.[1];
  const labelLayer = styles.match(/\.trend-milestone-label\s*\{[^}]*z-index:\s*(\d+)/)?.[1];
  const tooltipLayer = styles.match(/\.trend-tooltip\s*\{[^}]*z-index:\s*(\d+)/)?.[1];

  assert.ok(markerLayer, 'trend event marker should define its layer');
  assert.ok(labelLayer, 'trend milestone label should define its layer');
  assert.ok(tooltipLayer, 'trend tooltip should define its layer');
  assert.ok(Number(labelLayer) > Number(markerLayer), 'nearby chart markers must not cover milestone label text');
  assert.ok(Number(tooltipLayer) > Number(labelLayer), 'the active tooltip should remain above persistent labels');
});

test('gold chart markers follow the selected data point and keyboard focus', () => {
  const styles = fs.readFileSync('styles.css', 'utf8');
  const source = fs.readFileSync('app.js', 'utf8');
  const goldInteractionRule = styles.match(/\.trend-event-marker\.new-stock\.is-active \.trend-event-dot,[^{]+\{([^}]+)\}/)?.[1];

  assert.ok(goldInteractionRule, 'gold markers should define selected-point and focus-visible feedback');
  assert.match(goldInteractionRule, /width:\s*23px/);
  assert.match(goldInteractionRule, /height:\s*23px/);
  assert.match(source, /classList\.toggle\('is-active',Number\(marker\.dataset\.trendMarker\)===index\)/);
  assert.doesNotMatch(styles, /trend-event-marker(?:\.new-stock|\.milestone-asset)?:hover \.trend-event-dot/);
});

test('silver gain milestone grows with the selected data point and keyboard focus', () => {
  const styles = fs.readFileSync('styles.css', 'utf8');
  const silverInteractionRule = styles.match(/\.trend-event-marker\.milestone-gain\.is-active \.trend-event-dot,[^{]+\{([^}]+)\}/)?.[1];

  assert.ok(silverInteractionRule, 'silver milestones should define selected-point and focus-visible feedback');
  assert.match(silverInteractionRule, /width:\s*23px/);
  assert.match(silverInteractionRule, /height:\s*23px/);
});

test('mobile asset chart keeps labels readable and details below the plot', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  const styles = fs.readFileSync('styles.css', 'utf8');
  const mobileStyles = styles.match(/@media \(max-width: 520px\) \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(source, /trendChartMetrics[\s\S]*?left:82/);
  assert.match(source, /function trendAxisLabelIndexes[\s\S]*?isCompactTrendChart\(\)\?3:6/);
  assert.match(source, /class="trend-chart-visual"[\s\S]*?id="trendTooltip"/);
  assert.match(source, /tabindex="0" aria-label="持股資產走勢圖，可使用左右方向鍵查看各日期"/);
  assert.match(mobileStyles, /\.trend-tooltip\s*\{[^}]*position:\s*relative[^}]*width:\s*100%/);
  assert.match(mobileStyles, /\.trend-event-halo\s*\{[^}]*width:\s*20px[^}]*height:\s*20px/);
  assert.match(mobileStyles, /\.trend-navigator-wrap\s*\{[^}]*display:\s*block/);
  assert.match(mobileStyles, /\.navigator-handle\s*\{[^}]*width:\s*44px[^}]*height:\s*48px/);
  assert.match(source, /function trendNavigatorDragMode[\s\S]*?edgeZone=Math\.min\(18,selectionRect\.width\/2\)/);
  assert.match(source, /return 'move';\}if\(handleEdge&&compact\)/);
  assert.match(source, /function compactMilestoneLabels[\s\S]*?selected\.slice\(0,3\)/);
  assert.match(source, /function milestoneLabelIndexes[\s\S]*?compactMilestoneLabels\(points\)/);
  assert.match(source, /minLeft=compact\?18:8,maxLeft=compact\?82:92/);
  assert.match(mobileStyles, /\.trend-milestone-label\s*\{[^}]*display:\s*block[^}]*min-width:\s*92px/);
  assert.doesNotMatch(mobileStyles, /\.trend-milestone-label\s*\{[^}]*display:\s*none/);
});

test('mobile milestone labels prioritize both categories and one spaced history point', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  const functionSource = source.match(/function compactMilestoneLabels[^\n]+/)?.[0];
  const sandbox = { visibleTrendMilestones:milestones => milestones || [] };
  const points = Array.from({length:12},() => ({milestones:[]}));
  points[2].milestones = [{kind:'asset'}];
  points[8].milestones = [{kind:'asset'}];
  points[10].milestones = [{kind:'gain'}];
  points[11].milestones = [{kind:'asset'}];
  sandbox.points = points;
  vm.runInNewContext(`${functionSource}; result = compactMilestoneLabels(points);`, sandbox);

  assert.deepEqual(Array.from(sandbox.result, item => `${item.index}:${item.kind}`), ['11:asset','10:gain','8:asset']);
});

test('mobile navigator reserves its center for moving the selected range', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  const functionSource = source.match(/function trendNavigatorDragMode[^\n]+/)?.[0];
  const sandbox = { isCompactTrendChart:() => true };
  vm.runInNewContext(`${functionSource}; result = [
    trendNavigatorDragMode({clientX:50,selectionRect:{left:20,right:80,width:60},handleEdge:'end',compact:false}),
    trendNavigatorDragMode({clientX:24,selectionRect:{left:20,right:80,width:60},handleEdge:'start',compact:false}),
    trendNavigatorDragMode({clientX:76,selectionRect:{left:20,right:80,width:60},handleEdge:'end',compact:false})
  ];`, sandbox);

  assert.deepEqual(Array.from(sandbox.result), ['move','start','end']);
});

test('onboarding state accurately derives progress and completion from items and transactions', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  const functionSource = source.match(/function getOnboardingState\([\s\S]*?\n\}/)?.[0];
  assert.ok(functionSource, 'getOnboardingState function must exist in app.js');

  const sandbox = {};
  vm.runInNewContext(`${functionSource}; result = [
    getOnboardingState([], []),
    getOnboardingState([{isActive:true, occurrenceAmount:1000}], []),
    getOnboardingState([], [{symbol:'0050'}]),
    getOnboardingState([{isActive:true, occurrenceAmount:1000}], [{symbol:'0050'}])
  ];`, sandbox);

  const results = JSON.parse(JSON.stringify(sandbox.result));
  assert.deepEqual(results[0], {
    budgetDone: false,
    holdingsDone: false,
    completedCount: 0,
    totalSteps: 2,
    progressPercent: 0,
    isComplete: false,
  });
  assert.deepEqual(results[1], {
    budgetDone: true,
    holdingsDone: false,
    completedCount: 1,
    totalSteps: 2,
    progressPercent: 50,
    isComplete: false,
  });
  assert.deepEqual(results[2], {
    budgetDone: false,
    holdingsDone: true,
    completedCount: 1,
    totalSteps: 2,
    progressPercent: 50,
    isComplete: false,
  });
  assert.deepEqual(results[3], {
    budgetDone: true,
    holdingsDone: true,
    completedCount: 2,
    totalSteps: 2,
    progressPercent: 100,
    isComplete: true,
  });
});

test('navigation renders actionable step badges during onboarding and hides them when complete', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  const styles = fs.readFileSync('styles.css', 'utf8');

  assert.match(source, /function navBadge\(/, 'navBadge helper should exist');
  assert.match(source, /nav-badge/, 'nav markup should include nav-badge');
  assert.match(styles, /\.nav-badge\s*\{/, 'styles.css should define .nav-badge');
  assert.match(styles, /\.nav-badge\.pending/, 'styles.css should define .nav-badge.pending');
  assert.match(styles, /\.nav-badge\.done/, 'styles.css should define .nav-badge.done');

  const functionSource = source.match(/function navBadge\([\s\S]*?\n\}/)?.[0];
  assert.ok(functionSource, 'navBadge function source should be extractable');

  const sandbox = {};
  vm.runInNewContext(`${functionSource}; result = [
    navBadge('budget', { isComplete: false, budgetDone: false }),
    navBadge('budget', { isComplete: false, budgetDone: true }),
    navBadge('transactions', { isComplete: false, holdingsDone: false }),
    navBadge('transactions', { isComplete: false, holdingsDone: true }),
    navBadge('budget', { isComplete: true, budgetDone: true }),
    navBadge('overview', { isComplete: false })
  ];`, sandbox);

  assert.match(sandbox.result[0], /pending.*待設定/);
  assert.match(sandbox.result[1], /done.*✓/);
  assert.match(sandbox.result[2], /pending.*待匯入/);
  assert.match(sandbox.result[3], /done.*✓/);
  assert.equal(sandbox.result[4], '');
  assert.equal(sandbox.result[5], '');
});

test('overview renders comprehensive journey progress card with dual task steps', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  const styles = fs.readFileSync('styles.css', 'utf8');

  assert.match(source, /function overviewJourneyCard\(/);
  assert.match(source, /overviewJourneyCard\(/);
  assert.match(styles, /\.journey-card\s*\{/);
  assert.match(styles, /\.journey-progress\s*\{/);
  assert.match(styles, /\.journey-tasks\s*\{/);

  const functionSource = source.match(/function overviewJourneyCard\([\s\S]*?\n\}/)?.[0];
  assert.ok(functionSource, 'overviewJourneyCard function source should be extractable');

  const sandbox = {};
  vm.runInNewContext(`${functionSource}; result = [
    overviewJourneyCard({ isComplete: true }),
    overviewJourneyCard({ isComplete: false, completedCount: 0, totalSteps: 2, progressPercent: 0, budgetDone: false, holdingsDone: false }),
    overviewJourneyCard({ isComplete: false, completedCount: 1, totalSteps: 2, progressPercent: 50, budgetDone: true, holdingsDone: false })
  ];`, sandbox);

  assert.equal(sandbox.result[0], '');
  assert.match(sandbox.result[1], /role="progressbar"/);
  assert.match(sandbox.result[1], /aria-valuenow="0"/);
  assert.match(sandbox.result[1], /data-onboarding-action="budget"/);
  assert.match(sandbox.result[1], /data-onboarding-action="transactions"/);
  assert.match(sandbox.result[1], /前往新增生活費/);
  assert.match(sandbox.result[1], /class="secondary" data-onboarding-action="transactions"/);

  assert.match(sandbox.result[2], /aria-valuenow="50"/);
  assert.match(sandbox.result[2], /查看預算明細/);
  assert.match(sandbox.result[2], /class="primary" data-onboarding-action="transactions"/);
});

test('budget and transaction pages render contextual step banners during onboarding', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  const styles = fs.readFileSync('styles.css', 'utf8');

  assert.match(source, /function contextualStepBanner\(/);
  assert.match(source, /contextualStepBanner\('budget'/);
  assert.match(source, /contextualStepBanner\('transactions'/);
  assert.match(source, /data-step-action/);
  assert.match(styles, /\.step-banner\s*\{/);

  const iconSource = source.match(/function stepBannerIcon\([\s\S]*?\n\}/)?.[0];
  const functionSource = source.match(/function contextualStepBanner\([\s\S]*?\n\}/)?.[0];
  assert.ok(iconSource, 'stepBannerIcon function source should be extractable');
  assert.ok(functionSource, 'contextualStepBanner function source should be extractable');

  const sandbox = {};
  vm.runInNewContext(`${iconSource}; ${functionSource}; result = [
    contextualStepBanner('budget', { isComplete: true }, false),
    contextualStepBanner('budget', { isComplete: false, budgetDone: false, holdingsDone: false }, false),
    contextualStepBanner('budget', { isComplete: false, budgetDone: true, holdingsDone: false }, false),
    contextualStepBanner('transactions', { isComplete: false, budgetDone: true, holdingsDone: false }, false),
    contextualStepBanner('transactions', { isComplete: true, budgetDone: true, holdingsDone: true }, true),
    contextualStepBanner('transactions', { isComplete: true, budgetDone: true, holdingsDone: true }, false)
  ];`, sandbox);

  assert.equal(sandbox.result[0], '');
  assert.match(sandbox.result[1], /第 1 步：新增一筆生活費/);
  assert.match(sandbox.result[2], /data-step-action="transactions"/);
  assert.match(sandbox.result[3], /第 2 步：加入持股資料/);
  assert.match(sandbox.result[4], /兩項基礎資料已備齊/);
  assert.match(sandbox.result[4], /data-step-action="overview"/);
  assert.equal(sandbox.result[5], '', 'completion notice should disappear after its first render');
  assert.match(sandbox.result[2], /下一步：加入持股資料/);
  assert.doesNotMatch(sandbox.result[2], /role="status"|is-done/, 'persistent next-step guidance should not look like a fresh success');
  assert.doesNotMatch(source, /🎯|🎉|✅/, 'onboarding should use the existing vector icon language');
});

test('completion notice survives incidental rerenders and clears on navigation', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  assert.match(source, /announceOnboardingCompletion\s*&&\s*!wasOnboardingComplete\s*&&\s*getOnboardingState\(\)\.isComplete/);
  assert.match(source, /if\s*\(onboardingCompletedNow\)\s*onboardingCompletionNoticeVisible\s*=\s*true;/);
  assert.match(source, /function navigateToPage\([\s\S]*?onboardingCompletionNoticeVisible\s*=\s*false;/);
  const renderSource = source.match(/function render\(\)[\s\S]*?\n\}/)?.[0] || '';
  assert.doesNotMatch(renderSource, /onboardingCompletionNoticeVisible\s*=\s*false/, 'background rerenders must not consume the visible completion notice');
  assert.equal((source.match(/load\(\{ announceOnboardingCompletion:true \}\)/g) || []).length, 3, 'only budget save, CSV import, and transaction save should announce completion');
  assert.equal((source.match(/if\(!onboardingCompleted\)toast/g) || []).length, 3, 'completion banner should replace the competing success toast');
  assert.match(source, /failures\.length\s*\|\|\s*!automatic\s*\|\|\s*!onboardingCompletionNoticeVisible/, 'successful auto-sync should not compete with the completion announcement');
});

test('onboarding navigation does not open an unrelated blank budget editor', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  const handler = source.match(/document\.querySelectorAll\('\[data-onboarding-action\]'\)[\s\S]*?\n  \}\)\);/)?.[0];
  assert.ok(handler, 'onboarding action handler should be extractable');
  assert.doesNotMatch(handler, /startBudgetItem/, 'journey navigation should not auto-open the new-item editor');
});

test('mobile transaction actions use a two-row hierarchy without narrow equal-width buttons', () => {
  const styles = fs.readFileSync('styles.css', 'utf8');
  assert.match(styles, /\.transaction-page-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,/s);
  assert.match(styles, /\.transaction-page-actions \.primary\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
});

test('styles.css has balanced braces without unclosed selectors', () => {
  const styles = fs.readFileSync('styles.css', 'utf8');
  const openCount = (styles.match(/\{/g) || []).length;
  const closeCount = (styles.match(/\}/g) || []).length;
  assert.equal(openCount, closeCount, 'number of opening braces must match closing braces in styles.css');
});
