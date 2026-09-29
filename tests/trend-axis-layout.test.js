const assert = require('node:assert/strict');
const test = require('node:test');
const { createAppFixture } = require('./support/app-fixture.cjs');

test('asset axes fit a narrow container even when the viewport is desktop sized', t => {
  const fixture = createAppFixture(t);
  const stage = fixture.element('assetTrendChart');
  fixture.run(`trendState.frequency = 'month'`);
  const points = Array.from({ length:60 }, (_, index) => ({
    date:`${2021 + Math.floor(index / 12)}-${String(index % 12 + 1).padStart(2, '0')}-01`,
  }));
  fixture.context.axisPoints = points;
  for (const width of [280, 360, 550, 1000]) {
    stage.clientWidth = width;
    const layout = fixture.run(`(() => {
      const width = trendChartWidth();
      return { width, ...trendChartMetrics(width), indexes:trendAxisLabelIndexes(axisPoints) };
    })()`);
    assert.equal(layout.width, width);
    assert.ok(layout.left >= 80, 'reserve space for monetary labels without scaling it down');
    assert.equal(layout.indexes[0], 0);
    assert.equal(layout.indexes.at(-1), points.length - 1);
    const bounds = layout.indexes.map((index, position) => {
      const text = fixture.run(`trendAxisDateLabel(axisPoints[${index}].date, axisPoints)`);
      const labelWidth = [...text].reduce((sum, char) => sum + (/[^\x00-\x7F]/.test(char) ? 14 : 8), 0);
      const x = layout.left + index / (points.length - 1) * (width - layout.left - layout.right);
      const left = position === 0 ? x : position === layout.indexes.length - 1 ? x - labelWidth : x - labelWidth / 2;
      return { left, right:left + labelWidth };
    });
    for (let i = 1; i < bounds.length; i++) {
      assert.ok(bounds[i].left >= bounds[i - 1].right + 8, `date labels need separation at ${width}px`);
    }
  }
});
