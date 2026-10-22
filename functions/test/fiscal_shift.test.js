'use strict';
/* fix188-fiscal5: fiskal smena — chek kelganda o'zi ochiladi, ilova smenasi bilan bog'lanadi, yopishda Z-hisobot (provayder + o'z hisobimiz),
   23,5 soatdan eski smena yopiladi, yopish xatosi navbatda, parallel cheklar bitta smena ochadi, navbat va smena maydonlari bir-birini o'chirmaydi. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb } = require('./helpers/tgFake');
const E = require('../src/fiscal/engine');
const P = require('../src/fiscal/providers');
const M = require('../src/fiscal/mock');

const BID = 'bizS', NOW = Date.UTC(2026, 9, 22, 4, 0, 0), IK = '01234567890123456', H = 3600000;
function mk(mockOpts) {
  const s0 = {}; s0['businesses/' + BID] = { fiscalMode: true, fiscalProvider: 'mock', fiscalKassaId: 'K1', businessInn: '123456789' };
  const db = fakeDb(s0); let now = NOW;
  const rt = db.runTransaction; let chain = Promise.resolve();
  db.runTransaction = function (fn) { const r = chain.then(function () { return rt(fn); }); chain = r.catch(function () {}); return r; };
  const mock = M.create(mockOpts || {});
  const deps = { db: db, nowMs: function () { return now; }, sleep: function () { return new Promise(function (r) { setTimeout(r, 5); }); },
    provider: function (n) { return n === 'mock' ? P.wrap(mock, { timeoutMs: 80 }) : P.create(n); } };
  return { db, deps, mock, setNow: function (t) { now = t; }, now: function () { return now; } };
}
function sale(id, o) {
  return Object.assign({ id: id, fx: 1, receiptNumber: id.toUpperCase(), date: '2026-10-22T09:00:00.000Z', paymentType: 'cash',
    items: [{ productId: 'a', name: 'Cola', qty: 2, price: 12000, ikpu: IK, pkg: '1', vat: 12 }], subtotal: 24000, total: 24000 }, o || {});
}
const q = (s) => s.db.store['fiscalBiz/' + BID] || {};
const fd = (s, id) => s.db.store['businesses/' + BID + '/fiscal/' + id];
const shDoc = (s, id) => s.db.store['businesses/' + BID + '/fiscalShifts/' + id];
const n = (s, k) => s.mock.state.calls.filter(x => x === k).length;
const api = (s, b) => E.api(s.deps, { bid: BID }, b);

test('ilova smena ochmagan: birinchi chek smenani o\'zi ochadi; keyingi cheklar shu smenada', async () => {
  const s = mk({ requireShift: true });
  await E.processSale(s.deps, BID, sale('a1')); await E.processSale(s.deps, BID, sale('a2'));
  assert.equal(n(s, 'open'), 1);
  const e = q(s).shifts.main; assert.ok(e.fsid); assert.equal(q(s).shiftOpenCount, 1);
  assert.equal(fd(s, 'a1').fshift, e.fsid); assert.equal(fd(s, 'a2').fshift, e.fsid); assert.equal(fd(s, 'a1').status, 'sent');
  assert.equal(shDoc(s, e.fsid).auto, true);
});

test('ilova: smena ochish → cheklar → yopish: Z-hisobot (provayder va o\'z hisobimiz), keyingi chek yangi smenada', async () => {
  const s = mk();
  let r = await api(s, { action: 'shiftOpen', appShiftId: 'app1', branchId: null });
  assert.equal(r.body.result.status, 'open'); assert.equal(r.body.result.opened, true);
  const fsid = r.body.result.id;
  await E.processSale(s.deps, BID, sale('b1'));
  await E.processSale(s.deps, BID, sale('b2', { paymentType: 'card' }));
  const b3 = sale('b3'); s.db.store['businesses/' + BID + '/sales/b3'] = b3; await E.processSale(s.deps, BID, b3);
  await E.onSaleWritten(s.deps, BID, 'b3', b3, Object.assign({}, b3, { refunded: true }));
  await E.processCreditPay(s.deps, BID, 'L1', { fx: 1, type: 'payment', amount: 5000, customerId: 'c1', method: 'cash', date: 'x' });
  assert.equal(n(s, 'open'), 1);
  r = await api(s, { action: 'shiftClose', appShiftId: 'app1', branchId: null });
  const res = r.body.result;
  assert.equal(res.status, 'closed'); assert.equal(res.id, fsid);
  assert.deepEqual(res.zApp, { sales: 3, refunds: 1, total: 4800000, cash: 2400000, card: 2400000, other: 0, credits: 1, creditSum: 500000, vat: res.zApp.vat });
  assert.ok(res.zApp.vat > 0);
  assert.equal(res.z.total, 4800000); assert.equal(res.z.sales, 3); assert.equal(res.z.refunds, 1); assert.equal(res.z.credits, 1);
  assert.equal(q(s).shifts.main, undefined); assert.equal(q(s).shiftOpenCount, 0); assert.equal(q(s).zRecent.length, 1); assert.equal(q(s).appMap.app1, fsid);
  await E.processSale(s.deps, BID, sale('b4'));
  assert.equal(n(s, 'open'), 2); assert.notEqual(fd(s, 'b4').fshift, fsid);
  r = await api(s, { action: 'shiftClose', appShiftId: 'app1' });
  assert.equal(r.body.result.status, 'closed'); assert.equal(r.body.result.id, fsid); assert.equal(n(s, 'close'), 1, 'eski smena qayta yopilmaydi, yangisi tegilmaydi');
  r = await api(s, { action: 'shiftInfo', ids: ['app1', 'nope'] });
  assert.equal(r.body.map.app1.status, 'closed'); assert.equal(r.body.map.nope, undefined); assert.equal(r.body.open.length, 1); assert.equal(r.body.recent[0].id, fsid);
});

test('cheklar smenani oldinroq ochgan bo\'lsa — ilova smenasi unga bog\'lanadi (yangi smena ochilmaydi)', async () => {
  const s = mk();
  await E.processSale(s.deps, BID, sale('c1'));
  const r = await api(s, { action: 'shiftOpen', appShiftId: 'app2' });
  assert.equal(r.body.result.opened, false); assert.equal(n(s, 'open'), 1);
  assert.equal(q(s).appMap.app2, q(s).shifts.main.fsid); assert.equal(shDoc(s, q(s).shifts.main.fsid).apps.app2, 1);
});

test('24 soat: eski smena yangi chekdan oldin yopiladi; cheksiz qolgan smenani 10 daqiqalik tekshiruv yopadi', async () => {
  const s = mk();
  await E.processSale(s.deps, BID, sale('d1')); const f1 = q(s).shifts.main.fsid;
  s.setNow(NOW + 24 * H);
  await E.processSale(s.deps, BID, sale('d2'));
  assert.equal(shDoc(s, f1).status, 'closed'); assert.equal(shDoc(s, f1).reason, '24h'); assert.notEqual(fd(s, 'd2').fshift, f1);
  assert.equal(shDoc(s, f1).zApp.sales, 1);
  const f2 = q(s).shifts.main.fsid;
  s.setNow(NOW + 24 * H + 23 * H);
  let t = await E.retryTick(s.deps); assert.equal(t.closed, undefined, '23 soat — hali yopilmaydi');
  s.setNow(NOW + 24 * H + 23.6 * H);
  t = await E.retryTick(s.deps); assert.equal(t.closed, 1);
  assert.equal(shDoc(s, f2).status, 'closed'); assert.equal(q(s).shiftOpenCount, 0); assert.equal(q(s).zRecent.length, 2);
});

test('yopish xatosi (operator band / internet yo\'q): smena ochiq qoladi, navbatda; cheklar davom etadi; keyin yopiladi', async () => {
  const s = mk();
  await api(s, { action: 'shiftOpen', appShiftId: 'app3' }); const f = q(s).shifts.main.fsid;
  await E.processSale(s.deps, BID, sale('e1'));
  s.mock.opts.shiftMode = 'fail';
  let r = await api(s, { action: 'shiftClose', appShiftId: 'app3' });
  assert.equal(r.body.result.status, 'close_failed'); assert.equal(r.body.result.error, 'operator_busy');
  assert.ok(q(s).pending['shift~' + f]); assert.equal(q(s).shifts.main.fsid, f); assert.equal(q(s).shifts.main.closing, false);
  await E.processSale(s.deps, BID, sale('e2')); assert.equal(fd(s, 'e2').status, 'sent'); assert.equal(fd(s, 'e2').fshift, f);
  s.mock.opts.shiftMode = undefined; s.setNow(NOW + 2 * 60000);
  const t = await E.retryTick(s.deps); assert.equal(t.sent, 1);
  assert.equal(shDoc(s, f).status, 'closed'); assert.equal(shDoc(s, f).zApp.sales, 2); assert.equal(q(s).pending['shift~' + f], undefined);
  r = await api(s, { action: 'shiftInfo', ids: ['app3'] }); assert.equal(r.body.map.app3.status, 'closed');
  s.mock.opts.mode = 'offline';
  await api(s, { action: 'shiftOpen', appShiftId: 'app4' });
  assert.equal(q(s).shiftOpenCount, 0, 'internet yo\'q — smena ochilmadi, savdo baribir saqlanadi');
  s.db.store['businesses/' + BID + '/sales/e3'] = sale('e3'); const rs = await E.processSale(s.deps, BID, sale('e3')); assert.equal(rs.status, 'failed'); assert.equal(rs.retryable, true);
  s.mock.opts.mode = 'ok'; s.setNow(NOW + 10 * 60000);
  await E.retryTick(s.deps); assert.equal(fd(s, 'e3').status, 'sent'); assert.ok(fd(s, 'e3').fshift);
});

test('bir vaqtda ikki chek — provayderda bitta smena ochiladi; navbat va smena maydonlari bir-birini o\'chirmaydi', async () => {
  const s = mk({ delayMs: 20 });
  const [r1, r2] = await Promise.all([E.processSale(s.deps, BID, sale('f1')), E.processSale(s.deps, BID, sale('f2'))]);
  assert.equal(r1.status, 'sent'); assert.equal(r2.status, 'sent'); assert.equal(n(s, 'open'), 1);
  assert.equal(fd(s, 'f1').fshift, fd(s, 'f2').fshift);
  s.mock.opts.mode = 'fail';
  await E.processSale(s.deps, BID, sale('f3'));
  assert.ok(q(s).pending.f3); assert.ok(q(s).shifts.main.fsid, 'navbat yozuvi smenani o\'chirmadi');
  await api(s, { action: 'shiftInfo' }); assert.ok(q(s).pending.f3);
});

test('smena so\'rovlari: noto\'g\'ri id — rad; smena rad etilsa chek yuborilmaydi (xato bilan, savdo saqlanadi)', async () => {
  const s = mk({ shiftMode: 'error' });
  let r = await api(s, { action: 'shiftOpen', appShiftId: '../x' }); assert.equal(r.status, 400);
  r = await api(s, { action: 'shiftClose' }); assert.equal(r.status, 400);
  r = await api(s, { action: 'shiftOpen', appShiftId: 'ok1' }); assert.equal(r.body.result.status, 'failed'); assert.equal(r.body.result.error, 'shift_rejected');
  const rs = await E.processSale(s.deps, BID, sale('g1')); assert.deepEqual([rs.status, rs.error, rs.retryable], ['failed', 'shift_rejected', false]);
  assert.equal(n(s, 'sale'), 0); assert.equal(q(s).shiftOpenCount || 0, 0);
});

test('oflayn yopilgan eski ilova smenasi keyin yuborilsa — undan keyin ochilgan smena yopilmaydi', async () => {
  const s = mk();
  s.setNow(NOW + 2 * H); await E.processSale(s.deps, BID, sale('h1')); const f = q(s).shifts.main.fsid;
  let r = await api(s, { action: 'shiftClose', appShiftId: 'oldApp', endedAt: NOW + H });
  assert.equal(r.body.result.status, 'none'); assert.equal(q(s).shifts.main.fsid, f); assert.equal(n(s, 'close'), 0);
  r = await api(s, { action: 'shiftClose', appShiftId: 'curApp', endedAt: NOW + 3 * H });
  assert.equal(r.body.result.status, 'closed'); assert.equal(r.body.result.id, f);
});
