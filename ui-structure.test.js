const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

test('settings and transaction actions avoid legacy string slicing and duplicate IDs', () => {
  const source = fs.readFileSync('app.js', 'utf8');
  assert.match(source, /function chartSettingsPanel\(\)/);
  assert.doesNotMatch(source, /baseSettingsPage|groupedSettingsPage|legacy\.slice/);
  assert.doesNotMatch(source, /id="(?:transactionImport|addTransaction)"/);
  assert.match(source, /data-transaction-import/);
  assert.match(source, /data-add-transaction/);
  assert.doesNotMatch(source, /applyBudgetTarget/);
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
