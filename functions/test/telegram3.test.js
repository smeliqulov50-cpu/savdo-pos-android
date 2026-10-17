'use strict';
/* fix124-smart: Telegram "kam qolgan" ro'yxati — aqlli chegara (avtomatik rejim, tovar minimumi, variantlar, quti, qaytarilgan, yangi filial). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb } = require('./helpers/tgFake');
const R = require('../src/telegram/reports');
const M = require('../src/telegram/msgs');
const SC = require('./helpers/lowScenario');

const BID = 'OWNER1';
const NOW = Date.parse('2026-10-16T16:05:00Z');
function seedFrom(sc) {
  const s = { 'businesses/OWNER1': Object.assign({ businessName: 'D', timeZone: 'Asia/Tashkent', currency: 'UZS', branches: [{ id: 'main', name: 'Markaz' }, { id: 'b2', name: 'Yangi' }] }, sc.settings) };
  sc.products.forEach(function (p) { s['businesses/OWNER1/products/' + p.id] = p; });
  sc.sales.forEach(function (x) { s['businesses/OWNER1/sales/' + x.id] = x; });
  return s;
}
async function lowOf(opts) {
  const seed = seedFrom(SC.build(NOW, opts));
  const db = fakeDb(seed);
  const biz = seed['businesses/OWNER1'];
  const r = await R.computeLow(db, BID, { biz: biz, lang: 'uz', tz: 'Asia/Tashkent', cur: 'UZS', shop: 'D', branches: biz.branches, now: NOW });
  return { r: r, names: r.groups.map(function (g) { return g.id + ':' + g.items.map(function (i) { return i.name; }).join(','); }), stat: db.stat };
}
test('avtomatik rejim: 3 kunlik savdoga yetmaganlar, minimum ustun, variant alohida, quti, qaytarilgan hisobga olinmaydi, yangi filial — bir xil son', async () => {
  const x = await lowOf({});
  assert.deepEqual(x.names, ['main:N nol,C sotilmagan,F futbolka — M,A tez,E min25,G quti']);
  assert.equal(x.r.mode, 'auto'); assert.equal(x.r.autoDays, 3); assert.equal(x.r.threshold, 5);
  const t = M.lowText('uz', x.r, { shop: 'D' });
  assert.match(t, /Qoida: 3 kunlik savdoga yetmasa/); assert.match(t, /Sotilmagan tovarlar uchun chegara: ≤ 5/);
  assert.ok(t.indexOf('B sekin') === -1 && t.indexOf('I yangi') === -1 && t.indexOf('H qaytarilgan') === -1 && t.indexOf('D min2') === -1);
  assert.match(M.lowText('ru', x.r, { shop: 'D' }), /не хватит на 3 дн\. продаж/);
});
test('bir xil son rejimi: avvalgidek (savdo o\'qilmaydi), minimum baribir ustun', async () => {
  const x = await lowOf({ mode: 'fixed' });
  assert.deepEqual(x.names, ['main:N nol,C sotilmagan,F futbolka — M,E min25']);
  assert.ok(!x.stat.readPaths.some(function (p) { return p.indexOf('/sales') !== -1; }), 'bir xil son rejimida savdo o\'qilmaydi');
  assert.match(M.lowText('uz', x.r, { shop: 'D' }), /Kam qoldi chegarasi: ≤ 5/);
});
test('savdo tarixi 7 kundan kam — bir xil son; 10 kunlik tarix — o\'sha 10 kunga bo\'linadi', async () => {
  const a = await lowOf({ older: false, firstDaysAgo: 5 });
  assert.deepEqual(a.names, ['main:N nol,C sotilmagan,F futbolka — M,E min25']);
  const b = await lowOf({ older: false, firstDaysAgo: 10, days: 3 });
  assert.deepEqual(b.names, ['main:N nol,C sotilmagan,F futbolka — M,A tez,E min25,G quti']);
  const c = await lowOf({ days: 1 });   // 1 kun: A (3.9), M (2.9), G (11.6) chegaradan yuqori -> faqat tugagan, sotilmagan va minimumli
  assert.deepEqual(c.names, ['main:N nol,C sotilmagan,E min25']);
});
test('yordamchilar: rejim, kunlar, minimum', () => {
  assert.equal(R.lowModeOf({ lowStockMode: 'auto' }), 'auto'); assert.equal(R.lowModeOf({}), 'fixed'); assert.equal(R.lowModeOf({ lowStockMode: 'x' }), 'fixed');
  assert.equal(R.lowAutoDaysOf({}), 3); assert.equal(R.lowAutoDaysOf({ lowStockAutoDays: 7 }), 7); assert.equal(R.lowAutoDaysOf({ lowStockAutoDays: 0 }), 3); assert.equal(R.lowAutoDaysOf({ lowStockAutoDays: 99 }), 3);
  assert.equal(R.minStockOf({}), null); assert.equal(R.minStockOf({ minStock: null }), null); assert.equal(R.minStockOf({ minStock: '' }), null);
  assert.equal(R.minStockOf({ minStock: 0 }), 0); assert.equal(R.minStockOf({ minStock: '2.5' }), 2.5); assert.equal(R.minStockOf({ minStock: -1 }), null);
});
