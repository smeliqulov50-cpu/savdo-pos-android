'use strict';
/* fix185-fiscal3: fiskal dvigatel — mock provayder bilan: oddiy savdo, chegirma, keshbek, aralash, nasiya, internet yo'q → qaytdi,
   ikki marta bosish (ilova + trigger), ikki qurilma, operator xatosi, sekin javob, fx yo'q savdo — tegilmaydi. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb } = require('./helpers/tgFake');
const E = require('../src/fiscal/engine');
const P = require('../src/fiscal/providers');
const M = require('../src/fiscal/mock');

const BID = 'bizF', NOW = Date.UTC(2026, 9, 22, 9, 0, 0);
const IK = '01234567890123456';
function seed(biz) {
  const s = {};
  s['businesses/' + BID] = Object.assign({ businessName: 'Fiskal do\'kon', fiscalMode: true, fiscalProvider: 'mock', businessInn: '123456789' }, biz || {});
  return s;
}
function sale(id, o) {
  return Object.assign({ id: id, fx: 1, receiptNumber: id.toUpperCase(), date: '2026-10-22T09:00:00.000Z', paymentType: 'cash',
    items: [{ productId: 'a', name: 'Cola', qty: 2, price: 12000, ikpu: IK, pkg: '1495086', vat: 12 }, { productId: 'b', name: 'Non', qty: 1, price: 3000, ikpu: IK, pkg: '1', vat: 0 }],
    subtotal: 27000, total: 27000, discountAmount: 0, promoDiscount: 0, bonusUsed: 0, serviceChargeAmount: 0, deliveryFee: 0 }, o || {});
}
/* provayder: bitta umumiy mock (operator xotirasi testlar davomida saqlanadi), xohlagan rejim bilan */
function mk(mockOpts, biz) {
  const db = fakeDb(seed(biz)); let now = NOW;
  /* haqiqiy Firestore: bir hujjatga parallel tranzaksiyalar ketma-ket (biri yozadi, qolgani qayta o'qiydi) — shuni taqlid */
  const rt = db.runTransaction; let chain = Promise.resolve();
  db.runTransaction = function (fn) { const r = chain.then(function () { return rt(fn); }); chain = r.catch(function () {}); return r; };
  const mock = M.create(mockOpts || {}); const calls = [];
  const deps = { db: db, nowMs: function () { return now; }, provider: function (name) { calls.push(name); return name === 'mock' ? P.wrap(mock, { timeoutMs: 60 }) : P.create(name); } };
  return { db, deps, mock, calls, setNow: function (t) { now = t; } };
}
function fdoc(s, id) { return s.db.store['businesses/' + BID + '/fiscal/' + id]; }

test('oddiy savdo: yuborildi — belgi, raqam, QR, test belgisi; navbat bo\'sh', async () => {
  const s = mk();
  const r = await E.processSale(s.deps, BID, sale('s1'));
  assert.equal(r.status, 'sent'); assert.match(r.sign, /^MOCK/); assert.ok(r.qr && r.number); assert.equal(r.test, true);
  const d = fdoc(s, 's1'); assert.equal(d.open, false); assert.equal(d.attempts, 1); assert.equal(d.total, 2700000);
  assert.deepEqual(s.db.store['fiscalBiz/' + BID].pending, {});
});

test('fx yo\'q savdo (fiskal rejim o\'chiq paytda) — umuman tegilmaydi, hech narsa o\'qilmaydi', async () => {
  const s = mk(); const r0 = s.db.stat.reads;
  assert.equal((await E.onSaleCreated(s.deps, BID, 'x1', Object.assign(sale('x1'), { fx: undefined }))).status, 'skip');
  assert.equal(s.db.stat.reads, r0); assert.equal(fdoc(s, 'x1'), undefined); assert.equal(s.calls.length, 0);
});

test('ikki marta bosish / ilova + trigger / ikki qurilma: bitta chek, operatorga bir marta', async () => {
  const s = mk({ delayMs: 20 });
  const [a, b, c] = await Promise.all([E.processSale(s.deps, BID, sale('s2')), E.onSaleCreated(s.deps, BID, 's2', sale('s2')), E.processSale(s.deps, BID, sale('s2'))]);
  const st = [a, b, c].map(x => x.status).sort();
  assert.ok(st.filter(x => x === 'sent').length >= 1);
  assert.equal(s.mock.state.calls.filter(x => x === 'sale').length, 1, 'operatorga bir marta');
  const again = await E.processSale(s.deps, BID, sale('s2')); assert.equal(again.status, 'sent'); assert.equal(again.sign, fdoc(s, 's2').sign);
  assert.equal(s.mock.state.calls.filter(x => x === 'sale').length, 1);
});

test('chegirma, keshbek, aralash to\'lov, nasiya, xizmat haqi — yuboriladi, jami aniq', async () => {
  const s = mk();
  const cases = [
    sale('d1', { discountAmount: 2700, total: 24300 }),
    sale('d2', { bonusUsed: 1000, total: 26000 }),
    sale('d3', { paymentType: 'mixed', splitPayments: [{ method: 'cash', amount: 7000 }, { method: 'card', amount: 10000 }, { method: 'credit', amount: 10000 }] }),
    sale('d4', { paymentType: 'credit' }),
    sale('d5', { serviceChargeAmount: 2700, total: 29700 })
  ];
  for (const c of cases) { const r = await E.processSale(s.deps, BID, c); assert.equal(r.status, 'sent', c.id + ' ' + r.error); }
  const rcs = Object.values(s.mock.state.receipts).map(x => x.rc);
  rcs.forEach(rc => assert.equal(rc.lines.reduce((a, l) => a + l.total, 0), rc.total));
  assert.equal(fdoc(s, 'd1').total, 2430000); assert.equal(fdoc(s, 'd5').total, 2970000);
});

test('internet yo\'q → navbatda (1 daq), qayta urinishlar 1/5/15 daq; internet qaytdi → yuborildi, navbatdan chiqdi', async () => {
  const s = mk({ mode: 'offline' });
  let r = await E.processSale(s.deps, BID, sale('o1'));
  assert.equal(r.status, 'failed'); assert.equal(r.retryable, true); assert.match(r.error, /network/);
  assert.equal(s.db.store['fiscalBiz/' + BID].pending.o1, NOW + 60000);
  s.db.store['businesses/' + BID + '/sales/o1'] = sale('o1');
  let t = await E.retryTick(s.deps); assert.equal(t.tried, 0, 'vaqti kelmagan');
  s.setNow(NOW + 61000); t = await E.retryTick(s.deps); assert.equal(t.tried, 1); assert.equal(fdoc(s, 'o1').attempts, 2);
  assert.equal(s.db.store['fiscalBiz/' + BID].pending.o1, NOW + 61000 + 5 * 60000);
  s.mock.opts.mode = 'ok';
  s.setNow(NOW + 61000 + 5 * 60000); t = await E.retryTick(s.deps); assert.deepEqual(t, { tried: 1, sent: 1 });
  assert.equal(fdoc(s, 'o1').status, 'sent'); assert.equal(s.db.store['fiscalBiz/' + BID].pendingCount, 0);
});

test('operator rad etdi (qayta urinilmaydi) — ochiq ro\'yxatda; "Qayta yuborish" (force) — tuzatilgach o\'tadi', async () => {
  const s = mk({ mode: 'error' });
  let r = await E.processSale(s.deps, BID, sale('e1')); assert.deepEqual([r.status, r.retryable], ['failed', false]); assert.match(r.error, /IKPU/);
  assert.equal(s.db.store['fiscalBiz/' + BID].pending.e1, undefined, 'avtomatik navbatda emas');
  r = await E.processSale(s.deps, BID, sale('e1')); assert.equal(s.mock.state.calls.length, 1, 'force siz qayta yuborilmaydi');
  s.db.store['businesses/' + BID + '/sales/e1'] = sale('e1');
  let o = await E.api(s.deps, { bid: BID }, { action: 'open' }); assert.deepEqual(o.body.list.map(x => [x.id, x.status, x.receiptNo]), [['e1', 'failed', 'E1']]);
  s.mock.opts.mode = 'ok';
  const rr = await E.api(s.deps, { bid: BID }, { action: 'retry', all: true }); assert.equal(rr.body.sent, 1); assert.equal(rr.body.map.e1.status, 'sent');
  o = await E.api(s.deps, { bid: BID }, { action: 'open' }); assert.equal(o.body.list.length, 0);
});

test('operator sekin javob berdi — vaqt chegarasi, navbatga; keyingi urinishda o\'tadi', async () => {
  const s = mk({ delayMs: 200 });
  let r = await E.processSale(s.deps, BID, sale('t1')); assert.deepEqual([r.status, r.error, r.retryable], ['failed', 'timeout', true]);
  s.mock.opts.delayMs = 0;
  s.db.store['businesses/' + BID + '/sales/t1'] = sale('t1');
  s.setNow(NOW + 61000); await E.retryTick(s.deps);
  assert.equal(fdoc(s, 't1').status, 'sent');
});

test('IKPU yo\'q yoki provayder sozlanmagan — tushunarli xato, savdo yo\'qolmaydi', async () => {
  let s = mk({}, { fiscalProvider: 'epos' });
  let r = await E.processSale(s.deps, BID, sale('n1')); assert.deepEqual([r.status, r.retryable], ['failed', false]); assert.match(r.error, /epos_not_configured/);
  s = mk({}, { fiscalProvider: '' });
  r = await E.processSale(s.deps, BID, sale('n2')); assert.match(r.error, /not_configured/);
  s = mk();
  r = await E.processSale(s.deps, BID, sale('n3', { discountAmount: 999999, total: -5 })); assert.match(r.error, /receipt_/); assert.equal(r.retryable, false);
});

test('ilova API: send (bulut nusxasi ustun), status, ping; boshqa biznes / chaqiruvchisiz — rad', async () => {
  const s = mk();
  s.db.store['businesses/' + BID + '/sales/a1'] = sale('a1', { total: 27000 });
  let r = await E.api(s.deps, { bid: BID }, { action: 'send', sale: sale('a1', { total: 1 }) });
  assert.equal(r.body.result.status, 'sent'); assert.equal(fdoc(s, 'a1').total, 2700000, 'bulutdagi savdo ishlatildi');
  r = await E.api(s.deps, { bid: BID }, { action: 'send', sale: Object.assign(sale('a2'), { fx: 0 }) }); assert.equal(r.body.result.status, 'skip');
  r = await E.api(s.deps, { bid: BID }, { action: 'status', ids: ['a1', 'zz'] }); assert.equal(r.body.map.a1.status, 'sent'); assert.equal(r.body.map.zz.status, 'none');
  r = await E.api(s.deps, { bid: BID }, { action: 'ping' }); assert.deepEqual(r.body.result, { ok: true, provider: 'mock' });
  assert.equal((await E.api(s.deps, null, { action: 'status' })).status, 403);
  assert.equal((await E.api(s.deps, { bid: BID }, { action: 'send', sale: { id: 5 } })).status, 400);
  assert.equal((await E.api(s.deps, { bid: BID }, { action: 'x' })).status, 400);
  r = await E.api(s.deps, { bid: 'other' }, { action: 'status', ids: ['a1'] }); assert.equal(r.body.map.a1.status, 'none', 'boshqa biznes ko\'rmaydi');
});

test('qulf: "sending" 90 soniyadan eski bo\'lsa (funksiya to\'xtab qolgan) — qayta yuboriladi', async () => {
  const s = mk();
  s.db.store['businesses/' + BID + '/fiscal/l1'] = { saleId: 'l1', status: 'sending', open: true, lockAt: NOW - 30000, attempts: 1 };
  let r = await E.processSale(s.deps, BID, sale('l1')); assert.equal(r.status, 'sending');
  s.setNow(NOW + 100000); r = await E.processSale(s.deps, BID, sale('l1')); assert.equal(r.status, 'sent'); assert.equal(fdoc(s, 'l1').attempts, 2);
});

test('ilova: rad etilgan chek — oddiy send qayta yubormaydi, force bilan yuboradi; yuborilganini force ham qayta yubormaydi', async () => {
  const s = mk({ mode: 'error' });
  await E.api(s.deps, { bid: BID }, { action: 'send', sale: sale('f1') });
  s.mock.opts.mode = 'ok';
  let r = await E.api(s.deps, { bid: BID }, { action: 'send', sale: sale('f1') }); assert.equal(r.body.result.status, 'failed');
  r = await E.api(s.deps, { bid: BID }, { action: 'send', sale: sale('f1'), force: true }); assert.equal(r.body.result.status, 'sent');
  const n = s.mock.state.calls.length;
  r = await E.api(s.deps, { bid: BID }, { action: 'send', sale: sale('f1'), force: true }); assert.equal(r.body.result.status, 'sent'); assert.equal(s.mock.state.calls.length, n);
  assert.equal((await E.api(s.deps, { bid: BID }, { action: 'send', sale: sale('f2'), force: 'yes' })).body.result.status, 'sent');
});

