'use strict';
/* fix186-fiscal4: qaytarish (to'liq; asl chek yuborilmagan bo'lsa — avval u), chekni tahrirlash (qisman qaytarish ham — oldingi versiyani
   qaytarish + yangi versiya), o'chirish, qarz to'lovi («Кредит» cheki), qayta urinish yo'naltirish, dublikat yo'q. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb } = require('./helpers/tgFake');
const E = require('../src/fiscal/engine');
const P = require('../src/fiscal/providers');
const M = require('../src/fiscal/mock');

const BID = 'bizF', NOW = Date.UTC(2026, 9, 22, 9, 0, 0), IK = '01234567890123456';
function mk(mockOpts, biz) {
  const s0 = {}; s0['businesses/' + BID] = Object.assign({ fiscalMode: true, fiscalProvider: 'mock', fiscalCreditIkpu: '44444444444444444' }, biz || {});
  const db = fakeDb(s0); let now = NOW;
  const rt = db.runTransaction; let chain = Promise.resolve();
  db.runTransaction = function (fn) { const r = chain.then(function () { return rt(fn); }); chain = r.catch(function () {}); return r; };
  const mock = M.create(mockOpts || {});
  const deps = { db: db, nowMs: function () { return now; }, provider: function (n) { return n === 'mock' ? P.wrap(mock, { timeoutMs: 60 }) : P.create(n); } };
  return { db, deps, mock, setNow: function (t) { now = t; } };
}
function sale(id, o) {
  return Object.assign({ id: id, fx: 1, receiptNumber: id.toUpperCase(), date: '2026-10-22T09:00:00.000Z', paymentType: 'cash',
    items: [{ productId: 'a', name: 'Cola', qty: 2, price: 12000, ikpu: IK, pkg: '1', vat: 12 }, { productId: 'b', name: 'Non', qty: 3, price: 3000, ikpu: IK, pkg: '1', vat: 0 }],
    subtotal: 33000, total: 33000 }, o || {});
}
function put(s, sl) { s.db.store['businesses/' + BID + '/sales/' + sl.id] = sl; }
function fd(s, id) { return s.db.store['businesses/' + BID + '/fiscal/' + id]; }
function calls(s, k) { return s.mock.state.calls.filter(x => x === k).length; }
function sumLines(rc) { return rc.lines.reduce((a, l) => a + l.total, 0); }

test('qaytarish: yuborilgan chek → qaytarish cheki aynan o\'sha qatorlar, asl chekka bog\'langan; ikki marta — bir marta', async () => {
  const s = mk(); const sl = sale('s1'); put(s, sl);
  await E.onSaleCreated(s.deps, BID, 's1', sl);
  const after = Object.assign({}, sl, { refunded: true, refundedAt: 'x' }); put(s, after);
  let r = await E.onSaleWritten(s.deps, BID, 's1', sl, after);
  assert.equal(r.status, 'sent'); assert.equal(r.kind, 'refund');
  const rd = fd(s, 's1~R'); assert.equal(rd.rc.refund, true); assert.equal(rd.rc.type, 'refund'); assert.equal(rd.rc.original.sign, fd(s, 's1').sign);
  assert.deepEqual(rd.rc.lines.map(l => l.total), fd(s, 's1').rc.lines.map(l => l.total)); assert.equal(sumLines(rd.rc), rd.rc.total);
  r = await E.onSaleWritten(s.deps, BID, 's1', sl, after); assert.equal(r.status, 'sent'); assert.equal(calls(s, 'refund'), 1);
  r = await E.onSaleWritten(s.deps, BID, 's1', after, Object.assign({}, after, { printed: true })); assert.equal(r.status, 'skip');
});

test('qaytarish: asl chek hali yuborilmagan (internet yo\'q edi) — avval asl chek, keyin qaytarish', async () => {
  const s = mk({ mode: 'offline' }); const sl = sale('s2'); put(s, sl);
  await E.onSaleCreated(s.deps, BID, 's2', sl); assert.equal(fd(s, 's2').status, 'failed');
  const after = Object.assign({}, sl, { refunded: true }); put(s, after);
  let r = await E.onSaleWritten(s.deps, BID, 's2', sl, after); assert.equal(r.status, 'failed'); assert.equal(r.error, 'original_pending');
  s.mock.opts.mode = 'ok'; s.setNow(NOW + 10 * 60000);
  const t = await E.retryTick(s.deps); assert.ok(t.sent >= 1);
  assert.equal(fd(s, 's2').status, 'sent'); assert.equal(fd(s, 's2~R').status, 'sent');
  const issued = Object.values(s.mock.state.receipts).map(x => x.rc.type);
  assert.deepEqual(issued.sort(), ['refund', 'sale'], 'operatorda bitta savdo va bitta qaytarish cheki (oflayn urinishlar chek chiqarmaydi)');
});

test('chekni tahrirlash (qator olib tashlandi — qisman qaytarish): oldingi versiya qaytariladi + yangi versiya; summalar aniq', async () => {
  const s = mk(); const sl = sale('s3'); put(s, sl);
  await E.onSaleCreated(s.deps, BID, 's3', sl);
  const e1 = Object.assign({}, sl, { items: [sl.items[0]], subtotal: 24000, total: 24000, edited: true, editedAt: 'T1' }); put(s, e1);
  let r = await E.onSaleWritten(s.deps, BID, 's3', sl, e1);
  assert.deepEqual([r.status, r.refund, r.n], ['sent', 'sent', 1]);
  assert.equal(fd(s, 's3~r1').rc.total, 3300000); assert.equal(fd(s, 's3~r1').rc.original.sign, fd(s, 's3').sign);
  assert.equal(fd(s, 's3~v1').rc.total, 2400000); assert.equal(fd(s, 's3').cur, 's3~v1');
  // ikkinchi tahrir (miqdor oshirildi): v1 qaytariladi, v2
  const e2 = Object.assign({}, e1, { items: [Object.assign({}, sl.items[0], { qty: 3 })], subtotal: 36000, total: 36000, editedAt: 'T2' }); put(s, e2);
  r = await E.onSaleWritten(s.deps, BID, 's3', e1, e2); assert.equal(r.n, 2);
  assert.equal(fd(s, 's3~r2').rc.original.sign, fd(s, 's3~v1').sign); assert.equal(fd(s, 's3~r2').rc.total, 2400000); assert.equal(fd(s, 's3~v2').rc.total, 3600000);
  // xuddi shu tahrir qayta kelsa — dublikat yo'q
  r = await E.onSaleWritten(s.deps, BID, 's3', e1, e2); assert.equal(r.n, 2); assert.equal(calls(s, 'refund'), 2); assert.equal(calls(s, 'sale'), 3);
  // keyin to'liq qaytarish — eng oxirgi versiya (v2) qaytariladi
  const rf = Object.assign({}, e2, { refunded: true }); put(s, rf);
  r = await E.onSaleWritten(s.deps, BID, 's3', e2, rf); assert.equal(r.status, 'sent'); assert.equal(fd(s, 's3~R').rc.original.sign, fd(s, 's3~v2').sign); assert.equal(fd(s, 's3~R').rc.total, 3600000);
  // jami soliq hisobi: +33000 −33000 +24000 −24000 +36000 −36000 = 0
  const z = await P.wrap(s.mock, {}).closeShift({}); assert.equal(z.z.total, 0);
});

test('tahrir — asl chek hali yuborilmagan bo\'lsa: qaytarishsiz, tahrirlangan holi yuboriladi', async () => {
  const s = mk({ mode: 'offline' }); const sl = sale('s4'); put(s, sl);
  await E.onSaleCreated(s.deps, BID, 's4', sl);
  s.mock.opts.mode = 'ok';
  const e1 = Object.assign({}, sl, { items: [sl.items[1]], subtotal: 9000, total: 9000, editedAt: 'T1' }); put(s, e1);
  s.setNow(NOW + 120000);
  const r = await E.onSaleWritten(s.deps, BID, 's4', sl, e1);
  assert.equal(r.status, 'sent'); assert.equal(fd(s, 's4').rc.total, 900000); assert.equal(fd(s, 's4~r1'), undefined); assert.equal(calls(s, 'refund'), 0);
});

test('o\'chirish: yuborilgan — qaytarish cheki; yuborilmagan — bekor (soliqqa hech narsa ketmaydi)', async () => {
  const s = mk(); const a = sale('s5'); put(s, a);
  await E.onSaleCreated(s.deps, BID, 's5', a);
  delete s.db.store['businesses/' + BID + '/sales/s5'];
  let r = await E.onSaleWritten(s.deps, BID, 's5', a, null); assert.equal(r.status, 'sent'); assert.equal(fd(s, 's5~R').status, 'sent');
  const s2 = mk({ mode: 'offline' }); const b = sale('s6'); put(s2, b);
  await E.onSaleCreated(s2.deps, BID, 's6', b);
  delete s2.db.store['businesses/' + BID + '/sales/s6'];
  r = await E.onSaleWritten(s2.deps, BID, 's6', b, null); assert.equal(r.status, 'cancelled');
  assert.equal(fd(s2, 's6').status, 'cancelled'); assert.equal(fd(s2, 's6').open, false); assert.equal(s2.db.store['fiscalBiz/' + BID].pending.s6, undefined);
  s2.mock.opts.mode = 'ok'; s2.setNow(NOW + 3600000); await E.retryTick(s2.deps); assert.equal(Object.keys(s2.mock.state.receipts).length, 0, 'bekor qilingan chek hech qachon chiqarilmaydi');
  r = await E.onSaleWritten(s2.deps, BID, 'x', null, b); assert.equal(r.status, 'skip', 'yaratilish — boshqa trigger');
  r = await E.onSaleWritten(s2.deps, BID, 's7', Object.assign({}, b, { fx: undefined }), null); assert.equal(r.status, 'skip');
});

test('nasiya savdo: «Продажа» cheki to\'liq summaga (nasiya to\'lov turi sifatida); qarz to\'lovi — «Кредит» cheki (QR/belgisiz)', async () => {
  const s = mk(); const sl = sale('c1', { paymentType: 'credit', customerId: 'k1' }); put(s, sl);
  await E.onSaleCreated(s.deps, BID, 'c1', sl);
  const rc = fd(s, 'c1').rc; assert.equal(rc.type, 'sale'); assert.equal(rc.total, 3300000); assert.equal(rc.payments.credit, 3300000);
  const pay = { id: 'L1', fx: 1, type: 'payment', customerId: 'k1', amount: 10000, method: 'card', date: '2026-10-23T10:00:00.000Z', staffName: 'Vali' };
  let r = await E.onLedgerCreated(s.deps, BID, 'L1', pay);
  assert.equal(r.status, 'sent'); assert.equal(r.sign, ''); assert.equal(r.qr, ''); assert.match(r.number, /^KR-/); assert.equal(r.kind, 'credit');
  const prc = fd(s, 'pay_L1').rc; assert.equal(prc.type, 'credit'); assert.equal(prc.total, 1000000); assert.equal(prc.payments.card, 1000000); assert.equal(prc.lines[0].ikpu, '44444444444444444');
  r = await E.onLedgerCreated(s.deps, BID, 'L1', pay); assert.equal(calls(s, 'sale'), 2, 'ikkinchi marta yuborilmaydi');
  // fiskalsiz / savdo ichidagi to'lov / qaytarish yozuvi — chek yo'q
  assert.equal((await E.onLedgerCreated(s.deps, BID, 'L2', Object.assign({}, pay, { fx: undefined }))).status, 'skip');
  assert.equal((await E.onLedgerCreated(s.deps, BID, 'L3', Object.assign({}, pay, { saleId: 'c1' }))).status, 'skip');
  assert.equal((await E.onLedgerCreated(s.deps, BID, 'L4', Object.assign({}, pay, { type: 'sale' }))).status, 'skip');
  // Z: kredit cheklari soliq summasiga qo'shilmaydi
  const z = await P.wrap(s.mock, {}).closeShift({}); assert.equal(z.z.total, 3300000); assert.equal(z.z.credits, 1);
});

test('aralash to\'lov (naqd + karta + nasiya): bitta to\'liq chek, to\'lovlar alohida', async () => {
  const s = mk(); const sl = sale('m1', { paymentType: 'mixed', splitPayments: [{ method: 'cash', amount: 13000 }, { method: 'card', amount: 10000 }, { method: 'credit', amount: 10000 }] });
  await E.onSaleCreated(s.deps, BID, 'm1', sl);
  assert.deepEqual(fd(s, 'm1').rc.payments, { cash: 1300000, card: 1000000, credit: 1000000, other: 0 });
});

test('qayta urinish yo\'naltirish: kredit, qaytarish, tahrir hujjatlari; «ochiq» ro\'yxatda turlari bilan', async () => {
  const s = mk({ mode: 'offline' });
  const pay = { id: 'L9', fx: 1, type: 'payment', customerId: 'k1', amount: 5000, method: 'cash', date: 'x' };
  s.db.store['businesses/' + BID + '/ledger/L9'] = pay;
  await E.onLedgerCreated(s.deps, BID, 'L9', pay);
  let o = await E.api(s.deps, { bid: BID }, { action: 'open' }); assert.deepEqual(o.body.list.map(x => [x.id, x.kind]), [['pay_L9', 'credit']]);
  s.mock.opts.mode = 'ok';
  const rr = await E.api(s.deps, { bid: BID }, { action: 'retry', ids: ['pay_L9'] }); assert.equal(rr.body.map.pay_L9.status, 'sent');
  o = await E.api(s.deps, { bid: BID }, { action: 'open' }); assert.equal(o.body.list.length, 0);
  assert.equal((await E.retryDoc(s.deps, BID, 'pay_nope')).status, 'no_source');
});

test('operator qaytarishni rad etdi — ochiq ro\'yxatda «refund» turi bilan; tuzatilgach o\'tadi', async () => {
  const s = mk(); const sl = sale('q1'); put(s, sl);
  await E.onSaleCreated(s.deps, BID, 'q1', sl);
  s.mock.opts.mode = 'error';
  const after = Object.assign({}, sl, { refunded: true }); put(s, after);
  await E.onSaleWritten(s.deps, BID, 'q1', sl, after);
  let o = await E.api(s.deps, { bid: BID }, { action: 'open' }); assert.deepEqual(o.body.list.map(x => [x.id, x.kind, x.status, x.saleId]), [['q1~R', 'refund', 'failed', 'q1']]);
  s.mock.opts.mode = 'ok';
  await E.api(s.deps, { bid: BID }, { action: 'retry', all: true });
  assert.equal(fd(s, 'q1~R').status, 'sent');
});

test('api: tahrirlangan chek holati — amaldagi versiya (yangi belgi); «Qayta yuborish» avval eski versiya qaytarishini, keyin yangisini yuboradi', async () => {
  const s = mk(); const sl = sale('s9'); put(s, sl);
  await E.onSaleCreated(s.deps, BID, 's9', sl);
  const sign0 = fd(s, 's9').sign;
  s.mock.opts.mode = 'offline';
  const e1 = Object.assign({}, sl, { items: [sl.items[0]], subtotal: 24000, total: 24000, edited: true, editedAt: 'T1' }); put(s, e1);
  await E.onSaleWritten(s.deps, BID, 's9', sl, e1);
  let st = await E.api(s.deps, { bid: BID }, { action: 'status', ids: ['s9'] });
  assert.notEqual(st.body.map.s9.status, 'sent', 'yangi versiya hali yuborilmagan — «kutilmoqda/xato», eski belgi ko\'rsatilmaydi');
  assert.equal(st.body.map.s9.ver, 's9~v1');
  s.mock.opts.mode = 'ok';
  const r = await E.api(s.deps, { bid: BID }, { action: 'send', sale: e1, force: true });
  assert.equal(r.body.result.status, 'sent'); assert.equal(r.body.result.ver, 's9~v1'); assert.notEqual(r.body.result.sign, sign0);
  assert.equal(fd(s, 's9~r1').status, 'sent'); assert.equal(fd(s, 's9~v1').rc.total, 2400000);
  st = await E.api(s.deps, { bid: BID }, { action: 'status', ids: ['s9', 'zz'] });
  assert.equal(st.body.map.s9.sign, fd(s, 's9~v1').sign); assert.equal(st.body.map.zz.status, 'none');
  assert.deepEqual(Object.values(s.mock.state.receipts).map(x => x.rc.type).sort(), ['refund', 'sale', 'sale'], 'operatorda: asl, uning qaytarishi, yangi versiya — dublikatsiz');
});
