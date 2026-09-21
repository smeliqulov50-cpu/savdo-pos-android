const fs = require('fs');
const path = 'www/index.html';
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

const anchor = 'async function exportCreditorsPdf(){';
const helper = [
  'function blobToBase64(blob){',
  '  return new Promise((resolve, reject)=>{',
  '    const reader = new FileReader();',
  '    reader.onloadend = ()=> resolve(String(reader.result).split(\',\')[1]);',
  '    reader.onerror = reject;',
  '    reader.readAsDataURL(blob);',
  '  });',
  '}',
  'async function sharePdfBlob(doc, fileName, shareTitle){',
  '  const blob = doc.output(\'blob\');',
  '  if(isNativeApp()){',
  '    try{',
  '      const Fs = window.Capacitor.Plugins.Filesystem;',
  '      const Sh = window.Capacitor.Plugins.Share;',
  '      const base64 = await blobToBase64(blob);',
  '      const written = await Fs.writeFile({ path: fileName, data: base64, directory: \'CACHE\' });',
  '      await Sh.share({ title: shareTitle, url: written.uri });',
  '      return;',
  '    }catch(e){ /* native share failed — fall through to the web path below as a safety net */ }',
  '  }',
  '  const file = new File([blob], fileName, {type:\'application/pdf\'});',
  '  if(navigator.canShare && navigator.canShare({files:[file]})){',
  '    try{',
  '      await navigator.share({files:[file], title:shareTitle});',
  '      return;',
  '    }catch(e){ /* user cancelled or share failed — fall through to download */ }',
  '  }',
  '  doc.save(fileName);',
  '}',
  anchor
].join('\n');
replaceOnce(anchor, helper, 'insert sharePdfBlob helper');

['creditorsListTitle','debtorsListTitle','productsListTitle'].forEach(titleKey=>{
  const old = [
    '  const blob = doc.output(\'blob\');',
    '  const file = new File([blob], fileName, {type:\'application/pdf\'});',
    '  if(navigator.canShare && navigator.canShare({files:[file]})){',
    '    try{',
    '      await navigator.share({files:[file], title:tr(\'' + titleKey + '\')});',
    '      return;',
    '    }catch(e){ /* user cancelled or share failed — fall through to download */ }',
    '  }',
    '  doc.save(fileName);',
    '}'
  ].join('\n');
  const now = '  await sharePdfBlob(doc, fileName, tr(\'' + titleKey + '\'));\n}';
  replaceOnce(old, now, 'rewire PDF export (' + titleKey + ')');
});

fs.writeFileSync(path, html, 'utf8');
console.log('Done. File saved.');
