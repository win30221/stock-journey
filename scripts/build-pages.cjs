const fs = require('node:fs');
const path = require('node:path');
const { buildBundle } = require('./build-static.cjs');

const projectRoot = path.resolve(__dirname, '..');
const outputDirectory = path.join(projectRoot, 'dist');

// Publish runtime assets and the sample linked by the UI, never the whole repository.
function buildPages() {
  const assets = new Map([
    ['index.html', fs.readFileSync(path.join(projectRoot, 'index.html'))],
    ['styles.css', fs.readFileSync(path.join(projectRoot, 'styles.css'))],
    ['my-stock-transactions.csv', fs.readFileSync(path.join(projectRoot, 'my-stock-transactions.csv'))],
    ['app.bundle.js', buildBundle()],
  ]);

  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const [file, content] of assets) {
    fs.writeFileSync(path.join(outputDirectory, file), content);
  }
  console.log('built dist/ for Cloudflare Pages');
}

if (require.main === module) {
  buildPages();
}
