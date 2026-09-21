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

const anchor = 'async function initPushMessagingNative(){';
const fn = [
  'let networkListenerRegistered = false;',
  'function setupNativeNetworkSync(){',
  '  if(networkListenerRegistered) return;',
  '  networkListenerRegistered = true;',
  '  try{',
  '    const Net = window.Capacitor.Plugins.Network;',
  '    if(!Net) return;',
  '    Net.addListener(\'networkStatusChange\', (status)=>{',
  '      if(status && status.connected && fbUser) retryPendingSync().then(()=>renderAll());',
  '    });',
  '  }catch(e){}',
  '}',
  anchor
].join('\n');
replaceOnce(anchor, fn, 'insert missing setupNativeNetworkSync() definition');

fs.writeFileSync(path, html, 'utf8');
console.log('Done. File saved.');
