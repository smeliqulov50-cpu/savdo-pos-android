'use strict';
/* fix184-fiscal2: fiskal chek tuzilmasi va provayder interfeysi (mock bilan). Har testda qatorlar yig'indisi = chek jami. */
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/fiscal/receipt');
const P = require('../src/fiscal/providers');

const IK = '01234567890123456', IK2 = '11111111111111111';
const PR = {
  a: { id: 'a', ikpu: IK, packageCode: '1495086', vat: 12, unit: 'dona' },
  b: { id: 'b', ikpu: IK2, packageCode: '1500', vat: 0, unit: 'kg' },
  c: { id: 'c', ikpu: '', packageCode: '', unit: 'dona' }
};
const SET = { fiscalServiceIkpu: '22222222222222222', fiscalDeliveryIkpu: '33333333333333333', fiscalServiceVat: 12 };
function sale(o) {
  return Object.assign({ id: 's1', receiptNumber: '7', date: '2026-10-22T09:00:00.000Z', paymentType: 'cash',
    items: [{ productId: 'a', name: 'Cola', qty: 3, price: 12000 }, { productId: 'b', name: 'Guruch', qty: 2.5, price: 14000 }],
    subtotal: 71000, total: 71000, discountAmount: 0, promoDiscount: 0, bonusUsed: 0, serviceChargeAmount: 0, deliveryFee: 0 }, o || {});
}
function sumOk(rc) {
  const s = rc.lines.reduce((a, l) => a + l.total, 0);
  assert.equal(s, rc.total, 'qatorlar yig\'indisi = jami');
  rc.lines.forEach(l => { assert.ok(Number.isInteger(l.total) && Number.isInteger(l.discount) && l.discount >= 0 && l.total >= 0, l.name); if (l.kind === 'goods') assert.equal(l.gross - l.discount, l.total); });
  const p = rc.payments; assert.equal(p.cash + p.card + p.credit + p.other, rc.total, 'to\'lovlar = jami');
}

test('taqsimlash: tiyin yo\'qolmaydi, og\'irlikdan oshmaydi', () => {
  assert.deepEqual(R.allocate(100, [100, 100, 100]), [34, 33, 33]); assert.deepEqual(R.allocate(100, [1, 1, 1]), [1, 1, 1]);
  assert.equal(R.allocate(7, [5, 5]).reduce((a, b) => a + b, 0), 7);
  assert.deepEqual(R.allocate(10, [3, 0, 2]), [3, 0, 2]);
  assert.deepEqual(R.allocate(0, [3, 4]), [0, 0]);
  for (let t = 0; t < 200; t++) { const w = [Math.floor(Math.random() * 9999) + 1, Math.floor(Math.random() * 9999) + 1, Math.floor(Math.random() * 99) + 1]; const W = w[0] + w[1] + w[2]; const a = Math.floor(Math.random() * W); const r = R.allocate(a, w); assert.equal(r.reduce((x, y) => x + y, 0), a); r.forEach((v, i) => assert.ok(v <= w[i])); }
});

test('oddiy savdo: tiyinda, QQS narx ichida, IKPU/qadoq kodi', () => {
  const r = R.buildReceipt(sale(), PR, SET); assert.ok(r.ok); const rc = r.receipt; sumOk(rc);
  assert.equal(rc.total, 7100000); assert.equal(rc.lines[0].total, 3600000); assert.equal(rc.lines[1].total, 3500000);
  assert.equal(rc.lines[0].vat, Math.round(3600000 * 12 / 112)); assert.equal(rc.lines[1].vat, 0);
  assert.equal(rc.lines[0].ikpu, IK); assert.equal(rc.lines[0].packageCode, '1495086'); assert.equal(rc.payments.cash, 7100000);
  assert.deepEqual(r.missing, []);
});

test('chegirma (qo\'lda) + bonus — barcha qatorlarga mutanosib, yig\'indi aniq', () => {
  const s = sale({ discountAmount: 7100, bonusUsed: 333, total: 71000 - 7100 - 333 });
  const rc = R.buildReceipt(s, PR, SET).receipt; sumOk(rc);
  assert.equal(rc.lines[0].discount + rc.lines[1].discount, 743300);
  assert.ok(Math.abs(rc.lines[0].discount / 3600000 - rc.lines[1].discount / 3500000) < 0.0001);
});

test('aksiya — faqat mos qatorlarga (blok/ulgurji emas)', () => {
  const s = sale({ items: [{ productId: 'a', name: 'Cola', qty: 2, price: 10000 }, { productId: 'b', name: 'Guruch blok', qty: 1, price: 50000, saleMode: 'box', unitsPerBox: 5 }], subtotal: 70000, promoDiscount: 4000, total: 66000 });
  const rc = R.buildReceipt(s, PR, SET).receipt; sumOk(rc);
  assert.equal(rc.lines[0].discount, 400000); assert.equal(rc.lines[1].discount, 0);
});

test('aksiya + chegirma + xizmat haqi + yetkazib berish (restoran)', () => {
  const sub = 71000, promo = 1000, base = sub - promo, disc = 7000, svc = Math.round((base - disc) * 0.1), dlv = 15000;
  const s = sale({ promoDiscount: promo, discountAmount: disc, serviceChargeAmount: svc, deliveryFee: dlv, total: base - disc + svc + dlv });
  const r = R.buildReceipt(s, PR, SET); const rc = r.receipt; sumOk(rc);
  const sv = rc.lines.find(l => l.sub === 'service'), dl = rc.lines.find(l => l.sub === 'delivery');
  assert.equal(sv.total, svc * 100); assert.equal(sv.ikpu, SET.fiscalServiceIkpu); assert.equal(dl.total, 1500000); assert.equal(sv.vat, Math.round(svc * 100 * 12 / 112));
});

test('aralash to\'lov, nasiya, sertifikat — to\'lovlar jamiga teng', () => {
  let rc = R.buildReceipt(sale({ paymentType: 'mixed', splitPayments: [{ method: 'cash', amount: 30000 }, { method: 'card', amount: 21000 }, { method: 'credit', amount: 20000 }] }), PR, SET).receipt; sumOk(rc);
  assert.deepEqual(rc.payments, { cash: 3000000, card: 2100000, credit: 2000000, other: 0 });
  rc = R.buildReceipt(sale({ paymentType: 'credit' }), PR, SET).receipt; sumOk(rc); assert.equal(rc.payments.credit, 7100000);
  rc = R.buildReceipt(sale({ splitPayments: [{ method: 'gift', amount: 10000 }, { method: 'cash', amount: 61000 }] }), PR, SET).receipt; sumOk(rc); assert.equal(rc.payments.other, 1000000);
});

test('kasr valyuta / yaxlitlash: jami qatorlardan 1 tiyin farq qilsa ham aniq', () => {
  const s = sale({ items: [{ productId: 'a', name: 'A', qty: 3, price: 0.33 }, { productId: 'b', name: 'B', qty: 1, price: 0.34 }], subtotal: 1.33, discountAmount: 0.1, total: 1.23 });
  sumOk(R.buildReceipt(s, PR, SET).receipt);
  const s2 = sale({ items: [{ productId: 'a', name: 'A', qty: 1, price: 0.995 }], subtotal: 0.995, total: 1.0 });
  sumOk(R.buildReceipt(s2, PR, SET).receipt);
});

test('IKPU / qadoq kodi yo\'q tovar va xizmat — ro\'yxatga tushadi (chek baribir tuziladi)', () => {
  const s = sale({ items: [{ productId: 'c', name: 'Non', qty: 1, price: 3000 }], subtotal: 3000, serviceChargeAmount: 300, total: 3300 });
  const r = R.buildReceipt(s, PR, {}); assert.ok(r.ok); sumOk(r.receipt);
  assert.deepEqual(r.missing.map(m => m.field).sort(), ['ikpu', 'packageCode', 'serviceIkpu']);
});

test('chegirma chekdan katta bo\'lsa — xato (noto\'g\'ri yozuv)', () => {
  const r = R.buildReceipt(sale({ discountAmount: 999999, total: -1 }), PR, SET); assert.equal(r.ok, false);
});

test('qaytarish cheki: alohida id, asl chekka bog\'langan', () => {
  const r = R.buildRefund(sale(), PR, SET, { sign: 'MOCK1', number: 'FM/1', at: 'x' }); sumOk(r.receipt);
  assert.equal(r.receipt.id, 's1:R'); assert.equal(r.receipt.refund, true); assert.equal(r.receipt.original.sign, 'MOCK1');
});

/* ---------- provayder interfeysi ---------- */
test('mock: chek → belgi, raqam, QR; bir xil chek ikki marta — bir xil belgi (dublikat yo\'q)', async () => {
  const p = P.create('mock'); const rc = R.buildReceipt(sale(), PR, SET).receipt;
  const a = await p.sendSale(rc); assert.ok(a.ok); assert.match(a.sign, /^MOCK/); assert.ok(a.qr && a.number); assert.equal(a.providerId, 'mock');
  const b = await p.sendSale(rc); assert.equal(b.sign, a.sign);
});

test('mock: operator band (2 marta) → qayta urinishda o\'tadi; rad etish — qayta urinilmaydi', async () => {
  const p = P.create('mock', null, { mock: { failTimes: 2 } }); const rc = R.buildReceipt(sale(), PR, SET).receipt;
  let r = await p.sendSale(rc); assert.deepEqual([r.ok, r.retryable], [false, true]);
  r = await p.sendSale(rc); assert.equal(r.ok, false);
  r = await p.sendSale(rc); assert.equal(r.ok, true);
  const q = P.create('mock', null, { mock: { mode: 'error' } }); r = await q.sendSale(rc); assert.deepEqual([r.ok, r.retryable], [false, false]); assert.match(r.error, /IKPU/);
});

test('mock: internet yo\'q — tarmoq xatosi (qayta urinadi); sekin javob — vaqt chegarasi', async () => {
  const rc = R.buildReceipt(sale(), PR, SET).receipt;
  let r = await P.create('mock', null, { mock: { mode: 'offline' } }).sendSale(rc); assert.deepEqual([r.ok, r.retryable], [false, true]); assert.match(r.error, /network/);
  r = await P.create('mock', null, { timeoutMs: 50, mock: { delayMs: 300 } }).sendSale(rc); assert.deepEqual([r.ok, r.error, r.retryable], [false, 'timeout', true]);
});

test('mock: yig\'indisi buzilgan chek rad etiladi', async () => {
  const rc = R.buildReceipt(sale(), PR, SET).receipt; rc.lines[0].total += 1;
  const r = await P.create('mock').sendSale(rc); assert.deepEqual([r.ok, r.error, r.retryable], [false, 'sum_mismatch', false]);
});

test('mock: qaytarish faqat ma\'lum asl chekka; smena: ochish, Z-hisobot (sotuv − qaytarish)', async () => {
  const p = P.create('mock', null, { mock: { requireShift: true } });
  const rc = R.buildReceipt(sale(), PR, SET).receipt;
  let r = await p.sendSale(rc); assert.deepEqual([r.ok, r.error], [false, 'shift_closed']);
  assert.ok((await p.openShift({})).ok);
  const a = await p.sendSale(rc); assert.ok(a.ok);
  const rc2 = R.buildReceipt(sale({ id: 's2', paymentType: 'card' }), PR, SET).receipt; assert.ok((await p.sendSale(rc2)).ok);
  r = await p.sendRefund(R.buildRefund(sale(), PR, SET, { sign: 'NOPE' }).receipt, { sign: 'NOPE' }); assert.deepEqual([r.ok, r.error], [false, 'original_not_found']);
  r = await p.sendRefund(R.buildRefund(sale(), PR, SET, a).receipt, a); assert.ok(r.ok);
  const z = await p.closeShift({}); assert.ok(z.ok);
  assert.deepEqual([z.z.sales, z.z.refunds, z.z.total, z.z.cash, z.z.card], [2, 1, 7100000, 0, 7100000]);
  assert.ok((await p.checkConnection()).ok);
});

test('haqiqiy operatorlar hujjat kelguncha — "not_configured" (qayta urinilmaydi), noma\'lum nom ham', async () => {
  for (const n of ['epos', 'rahmat', 'uzkassa', 'qpos', 'xyz', '']) {
    const r = await P.create(n).sendSale({}); assert.equal(r.ok, false); assert.equal(r.retryable, false); assert.match(r.error, /not_configured/);
  }
});
