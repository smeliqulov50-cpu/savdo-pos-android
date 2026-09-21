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

// 1. Add a new "website" entry to the settings menu list, right after 'support'.
replaceOnce(
  "    {id:'support', icon:ICONS.chat, color:'var(--violet)', label:tr('supportSection'), show:true, group:'other'}\n  ].filter(i=>i.show);",
  "    {id:'support', icon:ICONS.chat, color:'var(--violet)', label:tr('supportSection'), show:true, group:'other'},\n    {id:'website', icon:ICONS.globe, color:'var(--accent)', label:'Veb-sayt (savdo-pos.netlify.app)', show:true, group:'other'}\n  ].filter(i=>i.show);",
  "add website menu item"
);

// 2. Handle taps on it: open the site in the system browser instead of
//    navigating into a settingsCategory sub-page (same special-case
//    pattern already used for the superadmin entry above it).
replaceOnce(
  "      if(el.dataset.cat === 'superadmin'){ state.view = 'superadmin'; renderAll(); return; }",
  "      if(el.dataset.cat === 'superadmin'){ state.view = 'superadmin'; renderAll(); return; }\n      if(el.dataset.cat === 'website'){ openExternalUrl('https://savdo-pos.netlify.app/'); return; }",
  "wire website menu item tap"
);

// 3. Add the openExternalUrl() helper, native-aware (Capacitor Browser
//    plugin) with a plain window.open() fallback for the web build.
replaceOnce(
  'function settingsMenuItems(){',
  [
    'function openExternalUrl(url){',
    '  if(isNativeApp()){',
    '    try{',
    '      const Br = window.Capacitor.Plugins.Browser;',
    '      if(Br){ Br.open({ url }); return; }',
    '    }catch(e){}',
    '  }',
    '  window.open(url, \'_blank\');',
    '}',
    'function settingsMenuItems(){'
  ].join('\n'),
  'insert openExternalUrl() helper'
);

fs.writeFileSync(path, html, 'utf8');
console.log('Done. File saved.');
