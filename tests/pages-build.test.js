const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildBundle, sourceFiles } = require('../scripts/build-static.cjs');

test('Pages build publishes fresh runtime assets and removes stale or personal files', t => {
  const projectRoot = path.resolve(__dirname, '..');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-journey-pages-'));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));

  for (const file of [...sourceFiles, 'index.html', 'styles.css',
    'scripts/build-static.cjs', 'scripts/build-pages.cjs']) {
    const target = path.join(fixture, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, file), target);
  }
  fs.writeFileSync(path.join(fixture, 'private.csv'), 'personal transactions');
  fs.writeFileSync(path.join(fixture, 'app.bundle.js'), 'stale bundle');
  const output = path.join(fixture, 'dist');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'private.csv'), 'stale personal file');

  execFileSync(process.execPath, [path.join(fixture, 'scripts/build-pages.cjs')]);

  assert.deepEqual(fs.readdirSync(output).sort(), ['app.bundle.js', 'index.html', 'styles.css']);
  assert.equal(fs.readFileSync(path.join(output, 'app.bundle.js'), 'utf8'), buildBundle());
  for (const file of ['index.html', 'styles.css']) {
    assert.deepEqual(fs.readFileSync(path.join(output, file)), fs.readFileSync(path.join(projectRoot, file)));
  }
  assert.equal(fs.readFileSync(path.join(fixture, 'app.bundle.js'), 'utf8'), 'stale bundle');
});
