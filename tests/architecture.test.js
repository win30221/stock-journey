const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const domainFiles = fs.readdirSync(path.join(projectRoot, 'js/domain'))
  .filter(name => name.endsWith('.js')).map(name => `js/domain/${name}`);
const portableFiles = [...domainFiles, 'js/app/settings.js', 'js/app/portfolio-model.js', 'js/app/async-state.js'];
const portableUtilities = new Set(['js/lib/constants.js', 'js/lib/date.js', 'js/lib/format.js', 'js/lib/csv.js']);

test('portable modules cannot import the renderer, browser storage or network adapters', () => {
  const allowed = new Set([...portableFiles, ...portableUtilities]);
  for (const file of allowed) {
    const source = fs.readFileSync(path.join(projectRoot, file), 'utf8');
    for (const match of source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
      assert.ok(allowed.has(dependency), `${file} imports non-portable dependency ${match[1]}`);
    }
  }
});

test('portable modules import without starting browser, storage or network work', () => {
  const source = `
    for (const key of ['document','window','localStorage','indexedDB','navigator']) {
      Object.defineProperty(globalThis,key,{configurable:true,get(){throw Error('Unexpected browser access: '+key);}});
    }
    globalThis.fetch=()=>{throw Error('Unexpected network request');};
    for (const file of ${JSON.stringify(portableFiles)}) await import('./'+file);
    process.stdout.write('portable');
  `;
  assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd:projectRoot, encoding:'utf8',
  }), 'portable');
});
