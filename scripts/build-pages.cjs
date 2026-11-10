const fs = require('node:fs');
const path = require('node:path');
const { buildBundle } = require('./build-static.cjs');

const projectRoot = path.resolve(__dirname, '..');
const frontendRoot = path.join(projectRoot, 'frontend');
const outputDirectory = path.join(projectRoot, 'dist');

// Publish runtime assets and the sample linked by the UI, never the whole repository.
function buildPages() {
  if (process.env.CF_PAGES_BRANCH && process.env.CF_PAGES_BRANCH !== 'codex/online-platform') {
    throw Error('連線版僅允許從 codex/online-platform 分支部署');
  }
  const assets = new Map([
    ['index.html', fs.readFileSync(path.join(frontendRoot, 'index.html'), 'utf8').replace('<head>', '<head>\n    <meta name="stock-journey-storage" content="cloud" />')],
    ['styles.css', fs.readFileSync(path.join(frontendRoot, 'styles.css'))],
    ['my-stock-transactions.csv', fs.readFileSync(path.join(frontendRoot, 'my-stock-transactions.csv'))],
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
