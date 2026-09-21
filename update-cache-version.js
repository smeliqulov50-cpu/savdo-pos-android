const fs = require('fs');
const path = 'www/sw.js';
let content = fs.readFileSync(path, 'utf8');
const version = Date.now();
content = content.replace(
  /const CACHE_NAME = '[^']*';/,
  `const CACHE_NAME = 'sardor-pos-v${version}';`
);
fs.writeFileSync(path, content);
console.log('CACHE_NAME updated to sardor-pos-v' + version);
