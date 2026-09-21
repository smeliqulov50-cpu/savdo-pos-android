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

replaceOnce(
  '    if(fbUser) autoReconnectBluetooth();\n    if(fbUser) refreshSettingsFromCloud();\n    return;',
  '    if(fbUser) autoReconnectBluetooth();\n    if(fbUser) refreshSettingsFromCloud();\n    if(fbUser){ retryPendingSync().then(()=>renderAll()); }\n    return;',
  'sync on app resume'
);

replaceOnce(
  'let fcmMessagingInstance = null;\nasync function initPushMessagingNative(){',
  'let networkListenerRegistered = false;\nfunction setupNativeNetworkSync(){\n  if(networkListenerRegistered) return;\n  networkListenerRegistered = true;\n  try{\n    const Net = window.Capacitor.Plugins.Network;\n    if(!Net) return;\n    Net.addListener(\'networkStatusChange\', (status)=>{\n      if(status && status.connected && fbUser) retryPendingSync().then(()=>renderAll());\n    });\n  }catch(e){}\n}\nlet fcmMessagingInstance = null;\nasync function initPushMessagingNative(){',
  'insert setupNativeNetworkSync()'
);

replaceOnce(
  '        if(isNativeApp()) initPushMessagingNative(); else initPushMessaging();',
  '        if(isNativeApp()){ initPushMessagingNative(); setupNativeNetworkSync(); } else initPushMessaging();',
  'call setupNativeNetworkSync() at login'
);

fs.writeFileSync(path, html, 'utf8');
console.log('Done. File saved.');
