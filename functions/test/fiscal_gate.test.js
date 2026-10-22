'use strict';
/* fix190-fiscal7: STIR (INN) yo'q / noto'g'ri, fiskal rejim o'chiq yoki biznes turi «Ombor» bo'lsa — operatorga HECH NARSA ketmaydi
   (chek, smena ochish/yopish, ulanish tekshiruvi). INN kiritilgach navbatdagilar yuboriladi. Holatda QQS summasi qaytadi. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb } = require('./helpers/tgFake');
const E = require('../src/fiscal/engine');
const P = require('../src/fiscal/providers');
const M = require('../src/fiscal/mock');

const BID = 'bizG', NOW = Date.UTC(2026, 9, 22, 6, 0, 0), IK = '01234567890123456';
function mk(biz) {
  const s0 = {}; s0['businesses/' + BID] = Object.assign({ fiscalMode: true, fiscalProvider: 'mock' }, biz || {});
  const db = fakeDb(s0); let now = NOW;
  const rt = db.runTransaction; let chain = Promise.resolve();
  db.runTransaction = function (fn) { const r = chain.then(function () { return rt(fn); }); chain = r.catch(function () {}); return r; };
  const mock = M.create({});
  const deps = { db: db, nowMs: function () { return now; }, sleep: async function () {}, provider: function (n) { return n === 'mock' ? P.wrap(mock, { timeoutMs: 80 }) : P.create(n); } };
  return { db, deps, mock, setNow: function (t) { now = t; }, biz: function (o) { Object.assign(db.store['businesses/' + BID], o); } };
}
function sale(id) {
  return { id: id, fx: 1, receiptNumber: id.toUpperCase(), date: '2026-10-22T06:00:00.000Z', paymentType: 'cash',
    items: [{ productId: 'a', name: 'Cola', qty: 2, price: 12000, ikpu: IK, pkg: '1', vat: 12 }], subtotal: 24000, total: 24000 };
}
const api = (s, b) => E.api(s.deps, { bid: BID }, b);

test('INN yo\'q: chek, smena, ulanish tekshiruvi — operatorga birorta so\'rov ketmaydi; INN kiritilgach o\'zi yuboriladi', async () => {
  const s = mk();
  s.db.store['businesses/' + BID + '/sales/n1'] = sale('n1');
  const r = await E.processSale(s.deps, BID, sale('n1'));
  assert.deepEqual([r.status, r.error, r.retryable], ['failed', 'no_inn', true]);
  let o = await api(s, { action: 'shiftOpen', appShiftId: 'ap1' }); assert.equal(o.body.result.status, 'failed'); assert.equal(o.body.result.error, 'no_inn');
  o = await api(s, { action: 'ping' }); assert.deepEqual([o.body.result.ok, o.body.result.error], [false, 'no_inn']);
  assert.deepEqual(s.mock.state.calls, [], 'operatorga hech narsa ketmadi');
  s.biz({ businessInn: '12345' }); await E.processSale(s.deps, BID, sale('n1'), { force: true });
  assert.deepEqual(s.mock.state.calls, [], 'noto\'g\'ri INN (5 raqam) — baribir yo\'q');
  s.biz({ businessInn: '123 456 789' }); s.setNow(NOW + 70 * 60000);
  await E.retryTick(s.deps);
  const d = s.db.store['businesses/' + BID + '/fiscal/n1']; assert.equal(d.status, 'sent');
  assert.deepEqual(s.mock.state.calls, ['open', 'sale']);
});

test('INN 14 raqam (YaTT, JShShIR) — qabul qilinadi', async () => {
  const s = mk({ businessInn: '31234567890123' });
  const r = await E.processSale(s.deps, BID, sale('p1')); assert.equal(r.status, 'sent');
  assert.equal(E.innOk({ businessInn: '1234567890' }), false); assert.equal(E.innOk({ businessInn: '123456789' }), true);
});

test('fiskal rejim o\'chiq yoki «Ombor» — hech narsa ketmaydi', async () => {
  let s = mk({ businessInn: '123456789', fiscalMode: false });
  let r = await E.processSale(s.deps, BID, sale('f1')); assert.equal(r.error, 'fiscal_off'); assert.deepEqual(s.mock.state.calls, []);
  s = mk({ businessInn: '123456789', businessType: 'warehouse' });
  r = await E.processSale(s.deps, BID, sale('w1')); assert.equal(r.error, 'warehouse');
  const o = await api(s, { action: 'shiftOpen', appShiftId: 'ap2' }); assert.equal(o.body.result.error, 'warehouse');
  assert.deepEqual(s.mock.state.calls, []);
});

test('ochiq smena bor, INN o\'chirildi — yopish ham operatorga ketmaydi; holatda QQS summasi', async () => {
  const s = mk({ businessInn: '123456789' });
  const r = await E.processSale(s.deps, BID, sale('v1'));
  assert.equal(r.status, 'sent'); assert.equal(r.vat, 257143, 'QQS 12% (tiyinda): 24000 × 12/112');
  const st = await api(s, { action: 'status', ids: ['v1'] }); assert.equal(st.body.map.v1.vat, 257143);
  s.biz({ businessInn: '' });
  const c = await api(s, { action: 'shiftClose', appShiftId: 'x1' });
  assert.notEqual(c.body.result.status, 'closed'); assert.equal(s.mock.state.calls.filter(x => x === 'close').length, 0);
});
