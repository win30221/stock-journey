const assert = require('node:assert/strict');
const test = require('node:test');

test('per-share prices retain meaningful decimal places', async () => {
  const { fmtPerShare } = await import('./js/lib/format.js');

  assert.equal(fmtPerShare(105.5), '105.5 元');
  assert.equal(fmtPerShare(20.125), '20.125 元');
  assert.equal(fmtPerShare(106), '106 元');
});

test('signed money makes gains and losses immediately distinguishable', async () => {
  const { fmtSignedMoney } = await import('./js/lib/format.js');

  assert.equal(fmtSignedMoney(2435.4), '+2,435 元');
  assert.equal(fmtSignedMoney(-1200.8), '-1,201 元');
  assert.equal(fmtSignedMoney(0), '0 元');
  assert.equal(fmtSignedMoney(null), '—');
});
