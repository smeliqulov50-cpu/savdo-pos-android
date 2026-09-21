const fs = require('fs');
const path = 'www/index.html';
let html = fs.readFileSync(path, 'utf8');

function replaceOnce(oldStr, newStr, label){
  const count = html.split(oldStr).length - 1;
  if(count !== 1){
    console.error('SKIP (' + label + '): expected 1 match, found ' + count);
    return;
  }
  html = html.split(oldStr).join(newStr);
  console.log('OK: ' + label);
}

replaceOnce(
  '<div class="modal-title">${editing ? tr(\'editProduct\') : tr(\'addProduct\')}</div>',
  '<div class="back-row"><button onclick="closeModal()">${ICONS.arrowLeft}</button><span class="t-title">${editing ? tr(\'editProduct\') : tr(\'addProduct\')}</span></div>',
  'product edit modal'
);

replaceOnce(
  '<h2 class="section-title">★ ${tr(\'superAdminPanel\')}</h2>',
  '<div class="back-row"><button id="superadmin-back-btn">${ICONS.arrowLeft}</button><span class="t-title">★ ${tr(\'superAdminPanel\')}</span></div>',
  'superadmin title'
);

replaceOnce(
  'document.getElementById(\'superadmin-search\').addEventListener(\'input\', (e)=>{',
  'document.getElementById(\'superadmin-back-btn\').addEventListener(\'click\', ()=>{ state.view=\'settings\'; renderAll(); });\n  document.getElementById(\'superadmin-search\').addEventListener(\'input\', (e)=>{',
  'superadmin back wiring'
);

replaceOnce(
  '<div class="modal-title">${escapeHtml(c.name)}</div>',
  '<div class="back-row"><button onclick="closeModal()">${ICONS.arrowLeft}</button><span class="t-title">${escapeHtml(c.name)}</span></div>',
  'creditor detail modal'
);

replaceOnce(
  '<div class="modal-title">${escapeHtml(cust.name)}</div>',
  '<div class="back-row"><button onclick="closeModal()">${ICONS.arrowLeft}</button><span class="t-title">${escapeHtml(cust.name)}</span></div>',
  'customer detail modal'
);

fs.writeFileSync(path, html, 'utf8');
console.log('Done. File saved.');
