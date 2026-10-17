'use strict';
/* fix124-smart: "aqlli kam qolgan" uchun umumiy namuna — server testi va ilova sinovi (Playwright) bir xil ma'lumotda
   bir xil natija berishini tekshirish uchun. now — ms. */
const DAY = 86400000;
function iso(ms) { return new Date(ms).toISOString(); }
function build(now, opts) {
  const o = Object.assign({ mode: 'auto', days: 3, threshold: 5, older: true, firstDaysAgo: 29, b2FirstDaysAgo: 3 }, opts || {});
  const settings = { lowStockThreshold: o.threshold, lowStockSetV2: true, lowStockMode: o.mode, lowStockAutoDays: o.days };
  const products = [
    { id: 'A', name: 'A tez', stock: 10, unit: 'dona' },                 // kuniga 4 -> 3 kun = 12 -> kam
    { id: 'B', name: 'B sekin', stock: 10, unit: 'dona' },               // kuniga 1 -> 3 -> yetarli
    { id: 'C', name: 'C sotilmagan', stock: 4, unit: 'dona' },           // sotuv yo'q -> 5 -> kam
    { id: 'D', name: 'D min2', stock: 4, unit: 'dona', minStock: 2 },    // minimum 2 -> yetarli
    { id: 'E', name: 'E min25', stock: 20, unit: 'dona', minStock: 25 }, // minimum 25 -> kam
    { id: 'F', name: 'F futbolka', stock: 11, unit: 'dona', variants: [{ id: 'm', name: 'M', stock: 5 }, { id: 'l', name: 'L', stock: 6 }] },  // M kuniga 3 -> 9 -> kam; L sotuvsiz 6 > 5 -> yetarli
    { id: 'G', name: 'G quti', stock: 30, unit: 'dona' },                // kuniga 1 quti x 12 -> 36 -> kam
    { id: 'H', name: 'H qaytarilgan', stock: 10, unit: 'dona' },         // faqat qaytarilgan savdo -> 5 -> yetarli
    { id: 'N', name: 'N nol', stock: 0, unit: 'dona' },                  // tugagan
    { id: 'I', name: 'I yangi filial', stock: 8, unit: 'dona', branchId: 'b2' }  // b2 tarixi 3 kun -> 5 -> yetarli
  ];
  const sales = [];
  let n = 0;
  function sale(ms, items, extra) { n++; sales.push(Object.assign({ id: 'S' + n, date: iso(ms), total: 1000, paymentType: 'cash', items: items }, extra || {})); }
  if (o.older) sale(now - 60 * DAY, [{ productId: 'B', qty: 1, price: 1000 }]);
  for (let d = o.firstDaysAgo; d >= 1; d--) {
    const t = now - d * DAY + 3600000;
    sale(t, [{ productId: 'A', qty: 4, price: 1000 }, { productId: 'B', qty: 1, price: 1000 }, { productId: 'F', variantId: 'm', qty: 2, price: 1000 }, { productId: 'F', qty: 1, price: 1000 },
      { productId: 'G', qty: 1, saleMode: 'box', unitsPerBox: 12, price: 12000 }]);
    sale(t + 600000, [{ productId: 'H', qty: 10, price: 1000 }], { refunded: true });
  }
  for (let d = o.b2FirstDaysAgo; d >= 1; d--) sale(now - d * DAY + 7200000, [{ productId: 'I', qty: 10, price: 1000 }], { branchId: 'b2' });
  return { settings: settings, products: products, sales: sales };
}
module.exports = { build: build, DAY: DAY };
