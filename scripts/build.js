const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const requiredFiles = [
  'server.js',
  'services/page-config.js',
  'routes/pages.js',
  'public/page.html',
  'public/page.js',
  'public/pages.html',
  'public/pages-editor.html'
];

const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`Build failed. Missing files: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('Production build verified: Node/Express static deployment requires no compilation step.');
