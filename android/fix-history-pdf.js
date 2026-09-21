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

const anchor = 'async function shareCustomerHistory(customer, history){';
const newFn = [
  'async function shareCustomerHistoryPdf(customer, history){',
  '  if(typeof window.jspdf === \'undefined\'){ showToast(tr(\'pdfLibFailed\')); return; }',
  '  const { jsPDF } = window.jspdf;',
  '  const doc = new jsPDF({unit:\'pt\', format:\'a4\'});',
  '  const pageW = doc.internal.pageSize.getWidth();',
  '  const pageH = doc.internal.pageSize.getHeight();',
  '  const marginX = 40;',
  '  let y = 50;',
  '',
  '  function drawHeader(){',
  '    doc.setFont(\'helvetica\',\'bold\'); doc.setFontSize(17); doc.setTextColor(31,79,184);',
  '    doc.text(state.settings.businessName||\'Savdo Pos\', pageW/2, y, {align:\'center\'});',
  '    y += 20;',
  '    doc.setFontSize(13); doc.setTextColor(20,30,50);',
  '    doc.text(customer.name, pageW/2, y, {align:\'center\'});',
  '    y += 16;',
  '    if(customer.phone){',
  '      doc.setFont(\'helvetica\',\'normal\'); doc.setFontSize(10); doc.setTextColor(81,103,126);',
  '      doc.text(customer.phone, pageW/2, y, {align:\'center\'});',
  '      y += 14;',
  '    }',
  '    doc.setFontSize(9); doc.setTextColor(120,120,120);',
  '    doc.text(new Date().toLocaleString(), pageW/2, y, {align:\'center\'});',
  '    y += 12;',
  '    doc.setDrawColor(31,79,184); doc.setLineWidth(1.5);',
  '    doc.line(marginX, y, pageW-marginX, y);',
  '    y += 22;',
  '  }',
  '  function drawTableHeader(){',
  '    doc.setFillColor(31,79,184);',
  '    doc.roundedRect(marginX, y-14, pageW-marginX*2, 22, 4, 4, \'F\');',
  '    doc.setFont(\'helvetica\',\'bold\'); doc.setFontSize(9); doc.setTextColor(255,255,255);',
  '    doc.text(\'Sana\', marginX+10, y);',
  '    doc.text(\'Summa\', pageW-marginX-10, y, {align:\'right\'});',
  '    y += 22;',
  '  }',
  '  function ensureSpace(){',
  '    if(y > pageH - 90){ doc.addPage(); y = 50; drawTableHeader(); }',
  '  }',
  '',
  '  drawHeader();',
  '  drawTableHeader();',
  '  const sorted = [...history].sort((a,b)=>new Date(a.date)-new Date(b.date));',
  '  doc.setFont(\'helvetica\',\'normal\'); doc.setFontSize(9.5);',
  '  if(!sorted.length){',
  '    doc.setTextColor(150,150,150);',
  '    doc.text(tr(\'noHistory\'), pageW/2, y+10, {align:\'center\'});',
  '    y += 30;',
  '  }',
  '  sorted.forEach((h,i)=>{',
  '    ensureSpace();',
  '    const isDebt = h.type === \'sale\';',
  '    const rowH = (h.staffName || h.note) ? 30 : 20;',
  '    if(i%2===0){ doc.setFillColor(247,250,253); doc.rect(marginX, y-12, pageW-marginX*2, rowH, \'F\'); }',
  '    doc.setTextColor(40,50,65); doc.setFont(\'helvetica\',\'normal\');',
  '    doc.text(new Date(h.date).toLocaleString(), marginX+10, y);',
  '    doc.setFont(\'helvetica\',\'bold\');',
  '    doc.setTextColor(...(isDebt ? [192,57,43] : [31,138,90]));',
  '    doc.text(`${isDebt?\'+\':\'−\'}${fmt(h.amount)}`, pageW-marginX-10, y, {align:\'right\'});',
  '    if(h.staffName || h.note){',
  '      doc.setFont(\'helvetica\',\'normal\'); doc.setFontSize(7.5); doc.setTextColor(120,120,120);',
  '      const noteLine = `${h.staffName?(tr(\'cashier\')+\': \'+h.staffName):\'\'}${h.staffName && h.note?\' · \':\'\'}${h.note||\'\'}`;',
  '      doc.text(noteLine, marginX+10, y+11);',
  '      doc.setFontSize(9.5);',
  '    }',
  '    y += rowH;',
  '  });',
  '',
  '  ensureSpace();',
  '  y += 8;',
  '  doc.setFillColor(234,243,252);',
  '  doc.roundedRect(marginX, y-14, pageW-marginX*2, 30, 5, 5, \'F\');',
  '  doc.setFont(\'helvetica\',\'bold\'); doc.setFontSize(13); doc.setTextColor(31,79,184);',
  '  doc.text(`${tr(\'debt\')}: ${fmt(customer.debt||0)}`, pageW-marginX-12, y+5, {align:\'right\'});',
  '  y += 30;',
  '',
  '  const fileName = `${customer.name.replace(/[^a-zA-Z0-9]+/g,\'_\')}-tarix-${new Date().toISOString().slice(0,10)}.pdf`;',
  '  await sharePdfBlob(doc, fileName, `${state.settings.businessName||\'Savdo Pos\'} — ${customer.name}`);',
  '}',
  anchor
].join('\n');
replaceOnce(anchor, newFn, 'insert shareCustomerHistoryPdf()');

replaceOnce(
  'document.getElementById(\'share-history-btn\').addEventListener(\'click\', ()=>shareCustomerHistory(cust, history));',
  'document.getElementById(\'share-history-btn\').addEventListener(\'click\', ()=>shareCustomerHistoryPdf(cust, history));',
  'rewire share-history-btn to PDF'
);

fs.writeFileSync(path, html, 'utf8');
console.log('Done. File saved.');
