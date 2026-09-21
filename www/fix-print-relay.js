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

replaceOnce(
  [
    '      if(printRelaySeenIds.has(sale.id)) return;',
    '      printRelaySeenIds.add(sale.id);',
    '      if(!wasReady) return; // skip the entire existing backlog on first load',
    '      if(sale.printed) return;'
  ].join('\n'),
  [
    '      // Deliberately NOT a permanent per-id skip: an id only being',
    '      // "seen" once meant a sale that failed to relay-print (its claim',
    '      // released back to printed:false — see claimAndRelayPrintSale)',
    '      // or one that arrived while this device was offline/closed could',
    '      // never be retried by this same device again. The Firestore',
    '      // transaction below is what actually prevents double-printing,',
    '      // so re-checking an already-seen id is safe, not redundant.',
    '      if(!wasReady){ printRelaySeenIds.add(sale.id); return; } // skip the entire existing backlog on first load',
    '      if(sale.printed) return;'
  ].join('\n'),
  'fix print-relay permanent skip bug'
);

fs.writeFileSync(path, html, 'utf8');
console.log('Done. File saved.');
