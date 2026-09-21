const fs = require('fs');
const path = 'index.html';
let html = fs.readFileSync(path, 'utf8');

function replaceOnce(oldStr, newStr, label){
  const count = html.split(oldStr).length - 1;
  if(count !== 1){
    console.error('SKIP (' + label + '): expected 1 match, found ' + count);
    return false;
  }
  html = html.split(oldStr).join(newStr);
  console.log('OK: ' + label);
  return true;
}

// 1. When entering superadmin, push a history entry so it has its own
//    back-stop (same as settingsCategory/reportsCategory already do).
replaceOnce(
  "      if(el.dataset.cat === 'superadmin'){ state.view = 'superadmin'; renderAll(); return; }",
  "      if(el.dataset.cat === 'superadmin'){ state.view = 'superadmin'; renderAll(); history.pushState({}, '', ''); return; }",
  "push history entry on entering superadmin"
);

// 2. Handle a physical/gesture back-press from superadmin by returning to
//    Settings specifically, not falling through to the generic
//    "any non-sale view -> sale" catch-all (which would skip past Settings
//    entirely). Must run BEFORE that generic check.
replaceOnce(
  "  if(state.view !== 'sale'){\n    state.view = 'sale';\n    renderAll();\n    history.pushState({}, '', '');\n    return;\n  }",
  "  if(state.view === 'superadmin'){\n    state.view = 'settings';\n    renderAll();\n    history.pushState({}, '', '');\n    return;\n  }\n  if(state.view !== 'sale'){\n    state.view = 'sale';\n    renderAll();\n    history.pushState({}, '', '');\n    return;\n  }",
  "add superadmin case to popstate handler"
);

// 3. Route the on-screen "<-" button through the SAME history.back() path
//    instead of mutating state directly, so both the physical button and
//    this one always stay in sync with the history stack.
replaceOnce(
  "  document.getElementById('superadmin-back-btn').addEventListener('click', ()=>{ state.view='settings'; renderAll(); });",
  "  document.getElementById('superadmin-back-btn').addEventListener('click', ()=>{ history.back(); });",
  "route on-screen superadmin back button through history.back()"
);

fs.writeFileSync(path, html, 'utf8');
console.log('Done. File saved.');
