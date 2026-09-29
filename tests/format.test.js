const assert = require('node:assert/strict');
const test = require('node:test');

test('per-share prices retain meaningful decimal places', async () => {
  const { fmtPerShare } = await import('../js/lib/format.js');

  assert.equal(fmtPerShare(105.5), '105.5 元');
  assert.equal(fmtPerShare(20.125), '20.125 元');
  assert.equal(fmtPerShare(106), '106 元');
});

test('signed money makes gains and losses immediately distinguishable', async () => {
  const { fmtSignedMoney } = await import('../js/lib/format.js');

  assert.equal(fmtSignedMoney(2435.4), '+2,435 元');
  assert.equal(fmtSignedMoney(-1200.8), '-1,201 元');
  assert.equal(fmtSignedMoney(0), '0 元');
  assert.equal(fmtSignedMoney(null), '—');
});

test('reverse split equivalent shares retain fractional precision without changing money formatting', async () => {
  const {fmtShares,fmt} = await import('../js/lib/format.js');
  assert.equal(fmtShares(100/6),'16.66666667');
  assert.equal(fmtShares(400),'400');
  assert.equal(fmtShares(null),'—');
  assert.equal(fmt(100/6),'17 元');
});
