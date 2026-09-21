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

const anchor = 'async function shareCustomerHistory(customer, history){';
const helpers = [
  'async function shareFileNative(blob, fileName, shareTitle, shareText){',
  '  try{',
  '    const Fs = window.Capacitor.Plugins.Filesystem;',
  '    const Sh = window.Capacitor.Plugins.Share;',
  '    const base64 = await blobToBase64(blob);',
  '    const written = await Fs.writeFile({ path: fileName, data: base64, directory: \'CACHE\' });',
  '    await Sh.share({ title: shareTitle, text: shareText, url: written.uri });',
  '    return true;',
  '  }catch(e){ return false; }',
  '}',
  'async function shareTextNative(shareTitle, shareText){',
  '  try{',
  '    const Sh = window.Capacitor.Plugins.Share;',
  '    await Sh.share({ title: shareTitle, text: shareText });',
  '    return true;',
  '  }catch(e){ return false; }',
  '}',
  anchor
].join('\n');
replaceOnce(anchor, helpers, 'insert shareFileNative/shareTextNative helpers');

replaceOnce(
  '  const text = lines.join(\'\\n\');\n  const title = `${shop} — ${customer.name}`;\n\n  try{\n    if(navigator.share){',
  '  const text = lines.join(\'\\n\');\n  const title = `${shop} — ${customer.name}`;\n\n  if(isNativeApp()){\n    const ok = await shareTextNative(title, text);\n    if(ok) return;\n  }\n\n  try{\n    if(navigator.share){',
  'shareCustomerHistory native-first branch'
);

replaceOnce(
  '  const text = buildReceiptText(sale, customer);\n  const title = state.settings.businessName||\'Savdo Pos\';\n\n  // Attempt 1: share with image file attached',
  '  const text = buildReceiptText(sale, customer);\n  const title = state.settings.businessName||\'Savdo Pos\';\n\n  if(isNativeApp()){\n    try{\n      const blob = await receiptImageBlob(sale, customer);\n      const ok = await shareFileNative(blob, \'chek.png\', title, text);\n      if(ok) return;\n    }catch(e){}\n  }\n\n  // Attempt 1: share with image file attached',
  'shareReceipt native-first branch'
);

fs.writeFileSync(path, html, 'utf8');
console.log('Done. File saved.');
