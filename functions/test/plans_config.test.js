'use strict';
/* fix203-plans: narxlar bitta manbada (config/plans) — zaxira, kesh, yangi buyurtma, eski buyurtma o'z summasi bilan (Click, Telegram), adminApi. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb, fakeTg } = require('./helpers/tgFake');
const PL = require('../src/domain/plans');
const { createOrder } = require('../src/app/createOrder');
const { handleClick, signFor } = require('../src/providers/click');
const { handleAdmin } = require('../src/admin/plansAdmin');
const core = require('../src/telegram/core');
const pay = require('../src/telegram/pay');

const NOW = Date.UTC(2026, 9, 23, 9, 0, 0);
const SUPER = 'SUPERUID', OWNER = 'ownerUid1';
const cfg = (m, extra) => ({ plans: Object.assign({ monthly: { price: m, months: 1, active: true, order: 1, best: false } }, extra || {}), version: 3 });
let n = 0; const genId = () => 'id' + (++n) + 'xyzxyz';

test('zaxira: hujjat yo\'q yoki buzilgan — hozirgi narxlar', async () => {
  const d = PL.normalizeConfig(null);
  assert.deepEqual([d.plans.monthly.price, d.plans.sixmonth.price, d.plans.yearly.price], [70000, 420000, 840000]);
  assert.equal(d.source, 'default'); assert.equal(d.plans.yearly.best, true);
  const b = PL.normalizeConfig({ plans: { monthly: { price: '80000', months: -1, active: 'ha' }, yearly: { price: 900000, months: 12 } } });
  assert.equal(b.plans.monthly.price, 70000); assert.equal(b.plans.monthly.months, 1); assert.equal(b.plans.monthly.active, true);
  assert.equal(b.plans.yearly.price, 900000);
  const off = PL.normalizeConfig({ plans: { monthly: { active: false }, sixmonth: { active: false }, yearly: { active: false } } });
  assert.ok(PL.PLAN_KEYS.every(k => off.plans[k].active), 'birorta faol tarif qolmasa — hammasi faol');
  const db = { collection() { throw new Error('tarmoq'); } };
  assert.equal((await PL.loadPlans(db, NOW)).plans.monthly.price, 70000);
});

test('kesh: 30 soniya, har bir baza alohida; tozalansa qayta o\'qiladi', async () => {
  const db = fakeDb({ 'config/plans': cfg(80000) });
  assert.equal((await PL.loadPlans(db, NOW)).plans.monthly.price, 80000);
  db.store['config/plans'] = cfg(90000);
  assert.equal((await PL.loadPlans(db, NOW + 10000)).plans.monthly.price, 80000);
  assert.equal((await PL.loadPlans(db, NOW + 31000)).plans.monthly.price, 90000);
  db.store['config/plans'] = cfg(95000); PL.clearPlansCache(db);
  assert.equal((await PL.loadPlans(db, NOW + 32000)).plans.monthly.price, 95000);
  const other = fakeDb({});
  assert.equal((await PL.loadPlans(other, NOW)).plans.monthly.price, 70000);
});

function orderDeps(db) { return { db: db, nowMs: () => NOW, genId: genId, allowedReturnOrigins: [], enabledProviders: ['click'] }; }
const IN = { uid: OWNER, plan: 'monthly', provider: 'click', returnUrl: 'https://savdo-pos.pages.dev/' };

test('yangi buyurtma: summa va muddat config/plans dan; o\'chirilgan tarif — rad', async () => {
  const db = fakeDb({ ['businesses/' + OWNER]: { businessName: 'Do\'kon' }, 'config/plans': cfg(80000, { sixmonth: { price: 450000, months: 6, active: false } }) });
  const o = await createOrder(orderDeps(db), IN);
  assert.equal(o.amount, 80000);
  assert.equal(db.store['paymentOrders/' + o.orderId].months, 1);
  await assert.rejects(createOrder(orderDeps(db), Object.assign({}, IN, { plan: 'sixmonth' })), e => e.code === 'plan-inactive');
  await assert.rejects(createOrder(orderDeps(db), Object.assign({}, IN, { plan: 'weekly' })), e => e.code === 'invalid-plan');
});

test('narx o\'zgarsa kutilayotgan eski buyurtma qayta berilmaydi — yangisi yangi narxda', async () => {
  const db = fakeDb({ ['businesses/' + OWNER]: {}, 'paymentOrders/old1': { orderId: 'old1', businessId: OWNER, plan: 'monthly', months: 1, amount: 70000, provider: 'click', returnUrl: IN.returnUrl, status: 'PENDING', createdAtMs: NOW - 60000, paymeTxId: null }, 'config/plans': cfg(80000) });
  const o = await createOrder(orderDeps(db), IN);
  assert.notEqual(o.orderId, 'old1'); assert.equal(o.amount, 80000);
  const db2 = fakeDb({ ['businesses/' + OWNER]: {}, 'paymentOrders/old2': { orderId: 'old2', businessId: OWNER, plan: 'monthly', months: 1, amount: 70000, provider: 'click', returnUrl: IN.returnUrl, status: 'PENDING', createdAtMs: NOW - 60000, paymeTxId: null } });
  assert.equal((await createOrder(orderDeps(db2), IN)).orderId, 'old2', 'narx o\'zgarmagan bo\'lsa — avvalgidek qayta ishlatiladi');
});

test('Click: narx o\'zgargandan keyin eski havola (70 000) o\'z summasi bilan yakunlanadi', async () => {
  const db = fakeDb({ ['businesses/' + OWNER]: { businessName: 'D', subscriptionExpiresAtMs: NOW - 1000 }, 'config/plans': cfg(80000),
    'paymentOrders/ordA': { orderId: 'ordA', businessId: OWNER, userId: OWNER, plan: 'monthly', months: 1, amount: 70000, provider: 'click', status: 'PENDING', createdAtMs: NOW - 3600000 } });
  const deps = { db: db, serviceId: '111', secretKey: 'SECRET', nowMs: () => NOW };
  const base = { click_trans_id: '9001', service_id: '111', click_paydoc_id: '77', merchant_trans_id: 'ordA', amount: '70000.00', error: '0', error_note: 'ok', sign_time: '2026-10-23 14:00:00' };
  const p = Object.assign({}, base, { action: '0' }); p.sign_string = signFor(p, 'SECRET', false);
  const r1 = await handleClick(deps, p);
  assert.equal(r1.error, 0, JSON.stringify(r1));
  const c = Object.assign({}, base, { action: '1', merchant_prepare_id: String(r1.merchant_prepare_id) }); c.sign_string = signFor(c, 'SECRET', true);
  const r2 = await handleClick(deps, c);
  assert.equal(r2.error, 0, JSON.stringify(r2));
  assert.equal(db.store['paymentOrders/ordA'].status, 'PAID');
  assert.equal(db.store['payments/ordA'].amount, 70000);
  const bad = Object.assign({}, base, { action: '0', click_trans_id: '9002', merchant_trans_id: 'ordA', amount: '80000.00' }); bad.sign_string = signFor(bad, 'SECRET', false);
  assert.notEqual((await handleClick(deps, bad)).error, 0, 'boshqa summa — rad');
});

test('muddat buyurtmadagi oylardan (narx/muddat keyin o\'zgarsa ham)', async () => {
  const { applyPaidInTx } = require('../src/app/applyPayment');
  const db = fakeDb({ ['businesses/' + OWNER]: { subscriptionExpiresAtMs: NOW - 1 } });
  const order = { orderId: 'o9', businessId: OWNER, userId: OWNER, plan: 'monthly', months: 2, amount: 140000, status: 'PENDING' };
  const r = await db.runTransaction(tx => applyPaidInTx(tx, db, order, { provider: 'click', transactionId: 't', nowMs: NOW }));
  assert.equal(new Date(r.newExpiryMs).getUTCMonth(), 11);   // 23-okt + 2 oy = 23-dek
  assert.equal(db.store['payments/o9'].months, 2);
  const old = { orderId: 'o10', businessId: OWNER, userId: OWNER, plan: 'sixmonth', amount: 420000, status: 'PENDING' };   // eski buyurtma: months maydoni yo'q
  const r2 = await db.runTransaction(tx => applyPaidInTx(tx, db, old, { provider: 'click', transactionId: 't2', nowMs: NOW }));
  assert.equal(r2.newExpiryMs > r.newExpiryMs, true);
});

/* Telegram bot */
const KEY = core.keyFromToken('123:TEST'); const BID = 'bizOwnerUid1', CHAT = '5550001';
function tgSeed(extra) {
  const s = {};
  s['tgBiz/' + BID] = { chats: { [CHAT]: { name: 'Ega', at: 1, sig: core.sigOf(KEY, BID, CHAT) } }, lang: 'uz' };
  s['tgChats/' + CHAT] = { bids: [BID], lang: 'uz' };
  s['businesses/' + BID] = { businessName: 'Sardor Market', subscriptionExpiresAtMs: NOW + 5 * 86400000 };
  return Object.assign(s, extra || {});
}
function tgMk(seedObj) { const db = fakeDb(seedObj); const tg = fakeTg(); return { db, tg, deps: { db, tg, key: KEY, nowMs: () => NOW, payToken: 'PROVIDER:TEST', genId: genId, botName: 'savdo_pos_bot' } }; }
const msg = (text) => ({ message: { message_id: 1, chat: { id: Number(CHAT), type: 'private' }, from: { id: 77, language_code: 'uz' }, text: text } });
const cbq = (p) => ({ callback_query: { id: 'cq1', data: 'p|' + pay.bidHash(BID) + '|' + p, from: { id: 77, language_code: 'uz' }, message: { message_id: 9, chat: { id: Number(CHAT), type: 'private' } } } });

test('bot: menyuda yangi narx, o\'chirilgan tarif ko\'rinmaydi va tanlab bo\'lmaydi', async () => {
  const { tg, deps } = tgMk(tgSeed({ 'config/plans': cfg(80000, { sixmonth: { price: 420000, months: 6, active: false } }) }));
  await core.handleUpdate(deps, msg('/obuna'));
  const kb = tg.sent[0].reply_markup.inline_keyboard;
  assert.equal(kb.length, 3);
  assert.ok(/80 000/.test(kb[0][0].text) && /840 000/.test(kb[1][0].text));
  const r = await core.handleUpdate(deps, cbq('s'));
  assert.equal(r.badPlan, true);
  assert.ok(!tg.calls.some(c => c.method === 'sendInvoice'));
  await core.handleUpdate(deps, cbq('m'));
  const inv = tg.calls.find(c => c.method === 'sendInvoice').params;
  assert.equal(inv.prices[0].amount, 8000000);
});

test('bot: hisob 70 000 da chiqqan, keyin narx 80 000 bo\'ldi — to\'lov o\'tadi, obuna uzayadi', async () => {
  const { db, tg, deps } = tgMk(tgSeed({ 'paymentOrders/tgOldOrder1': { orderId: 'tgOldOrder1', businessId: BID, userId: 'tg:77', plan: 'monthly', months: 1, amount: 70000, provider: 'click_tg', status: 'PENDING', createdAtMs: NOW - 60000, chatId: CHAT }, 'config/plans': cfg(80000) }));
  const pre = await pay.onPreCheckout(deps, { id: 'pq1', invoice_payload: 'tgOldOrder1', currency: 'UZS', total_amount: 7000000 }, 'uz');
  assert.equal(pre.ok, true, JSON.stringify(pre));
  const wrong = await pay.onPreCheckout(deps, { id: 'pq2', invoice_payload: 'tgOldOrder1', currency: 'UZS', total_amount: 8000000 }, 'uz');
  assert.equal(wrong.ok, false);
  const r = await pay.onPaid(deps, { chat: { id: Number(CHAT) }, successful_payment: { invoice_payload: 'tgOldOrder1', currency: 'UZS', total_amount: 7000000, provider_payment_charge_id: 'pc1', telegram_payment_charge_id: 'tc1' } }, 'uz');
  assert.equal(r.applied, true, JSON.stringify(r));
  assert.equal(db.store['payments/tgOldOrder1'].amount, 70000);
});

/* adminApi */
function adeps(db) { return { db: db, nowMs: () => NOW, genId: genId, superUid: SUPER }; }
const PLANS_IN = { monthly: { price: 80000, months: 1, active: true, order: 1, best: false }, sixmonth: { price: 450000, months: 6, active: true, order: 2, best: false }, yearly: { price: 850000, months: 12, active: true, order: 3, best: true, name: { uz: 'Yillik (VIP)' } } };

test('adminApi: faqat superadmin', async () => {
  const db = fakeDb({});
  assert.equal((await handleAdmin(adeps(db), { uid: OWNER }, { action: 'plansGet' })).status, 403);
  assert.equal((await handleAdmin(adeps(db), { uid: OWNER }, { action: 'plansSet', plans: PLANS_IN })).status, 403);
  assert.equal((await handleAdmin(adeps(db), null, { action: 'plansGet' })).status, 403);
  assert.equal(db.store['config/plans'], undefined);
});

test('adminApi: noto\'g\'ri qiymatlar rad etiladi', async () => {
  const db = fakeDb({});
  const bad = (p) => handleAdmin(adeps(db), { uid: SUPER }, { action: 'plansSet', plans: p });
  assert.equal((await bad(Object.assign({}, PLANS_IN, { monthly: Object.assign({}, PLANS_IN.monthly, { price: 500 }) }))).body.code, 'bad-price');
  assert.equal((await bad(Object.assign({}, PLANS_IN, { monthly: Object.assign({}, PLANS_IN.monthly, { price: 80000.5 }) }))).body.code, 'bad-price');
  assert.equal((await bad(Object.assign({}, PLANS_IN, { sixmonth: Object.assign({}, PLANS_IN.sixmonth, { months: 0 }) }))).body.code, 'bad-months');
  assert.equal((await bad({ monthly: PLANS_IN.monthly })).body.code, 'missing-plan');
  const off = {}; Object.keys(PLANS_IN).forEach(k => { off[k] = Object.assign({}, PLANS_IN[k], { active: false }); });
  assert.equal((await bad(off)).body.code, 'no-active-plan');
  assert.equal((await bad(Object.assign({}, PLANS_IN, { monthly: Object.assign({}, PLANS_IN.monthly, { best: true }) }))).body.code, 'many-best');
  assert.equal(db.store['config/plans'], undefined);
});

test('adminApi: saqlash — versiya, jurnal (kim, qachon, eski -> yangi), ziddiyat, o\'zgarmasa jurnal yo\'q', async () => {
  const db = fakeDb({});
  const r = await handleAdmin(adeps(db), { uid: SUPER, email: 'admin@x.uz' }, { action: 'plansSet', plans: PLANS_IN, version: 0 });
  assert.equal(r.status, 200); assert.equal(r.body.version, 1);
  const c = db.store['config/plans'];
  assert.equal(c.plans.monthly.price, 80000); assert.equal(c.updatedBy.email, 'admin@x.uz'); assert.equal(c.version, 1);
  const logs = Object.keys(db.store).filter(k => k.indexOf('adminLog/') === 0).map(k => db.store[k]);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].before.monthly.price, 70000); assert.equal(logs[0].after.monthly.price, 80000); assert.equal(logs[0].email, 'admin@x.uz'); assert.equal(logs[0].atMs, NOW);
  assert.equal((await PL.getPlanLive(db, 'monthly', NOW + 999999)).price, 80000, 'kesh tozalanadi, server yangi narxni oladi');
  const conf = await handleAdmin(adeps(db), { uid: SUPER }, { action: 'plansSet', plans: PLANS_IN, version: 0 });
  assert.equal(conf.status, 409);
  const same = await handleAdmin(adeps(db), { uid: SUPER }, { action: 'plansSet', plans: PLANS_IN, version: 1 });
  assert.equal(same.body.same, true);
  assert.equal(Object.keys(db.store).filter(k => k.indexOf('adminLog/') === 0).length, 1);
  const g = await handleAdmin(adeps(db), { uid: SUPER }, { action: 'plansGet' });
  assert.equal(g.body.cfg.plans.yearly.name.uz, 'Yillik (VIP)'); assert.equal(g.body.log.length, 1); assert.equal(g.body.cfg.version, 1);
  assert.equal(g.body.defaults.monthly.price, 70000);
});
