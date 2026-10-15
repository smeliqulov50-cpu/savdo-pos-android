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

/* fix115-version: ilova versiyasi (Sozlamalar pastidagi yozuv) android/app/build.gradle'dagi versionName bilan bir xil bo'lsin */
try {
  const g = fs.readFileSync('android/app/build.gradle', 'utf8');
  const m = /versionName\s+"([^"]+)"/.exec(g);
  if (m) {
    const ip = 'www/index.html';
    const h = fs.readFileSync(ip, 'utf8');
    const h2 = h.replace(/const APP_VERSION_NAME = '[^']*';/, "const APP_VERSION_NAME = '" + m[1].replace(/[^0-9A-Za-z._-]/g, '') + "';");
    if (h2 !== h) { fs.writeFileSync(ip, h2); }
    console.log('APP_VERSION_NAME = ' + m[1]);
  }
} catch (e) { console.log('APP_VERSION_NAME yangilanmadi: ' + e.message); }
