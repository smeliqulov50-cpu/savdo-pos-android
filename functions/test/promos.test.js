'use strict';
/* fix203-promo / fix203-dash: aksiyalar, promokodlar, sovg'a kunlari, sinov muddati, statistika, eslatma. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb, fakeTg } = require('./helpers/tgFake');
const PR = require('../src/domain/promos');
const PRICING = require('../src/app/pricing');
const { createOrder } = require('../src/app/createOrder');
const { applyPaidInTx } = require('../src/app/applyPayment');
const { handleAdmin, onBusinessCreated } = require('../src/admin/plansAdmin');
const { computeStats } = require('../src/admin/stats');
const core = require('../src/telegram/core');
const pay = require('../src/telegram/pay');

const T0 = Date.UTC(2026, 9, 31, 19, 0, 0);          // 2026-11-01 00:00 Toshkent
const T1 = Date.UTC(2026, 10, 7, 19, 0, 0);          // 2026-11-08 00:00 Toshkent
const OWNER = 'ownerUid1', SUPER = 'SUPERUID';
let n = 0; const genId = () => 'id' + (++n) + 'abcdef';
const promo = (o) => Object.assign({ id: 'pr' + (++n) + 'xx', name: 'Kuzgi aksiya', plans: ['monthly', 'sixmonth', 'yearly'], type: 'percent', value: 20, startMs: T0, endMs: T1, audience: 'all', limit: 0, active: true }, o || {});
const code = (o) => Object.assign({ id: 'cd' + (++n) + 'xx', code: 'SAVDO10', type: 'percent', value: 10, plans: ['monthly', 'sixmonth', 'yearly'], startMs: T0, endMs: T1, maxUses: 0, perShop: 1, withPromo: false, active: true }, o || {});
const ctx = (o) => Object.assign({ bizId: OWNER, biz: {}, everPaid: false, expiryMs: T0 + 5 * 86400000, nowMs: T0 + 3600000, usage: {} }, o || {});
const cfgOf = (promos, codes) => ({ promos: (promos || []).map(p => p), codes: codes || [], version: 1 });

test('aksiya: foiz, summa, aniq narx; eng arzoni tanlanadi; 1 000 so\'mdan past emas', () => {
  const a = promo({ value: 20 }), b = promo({ type: 'amount', value: 20000 }), c = promo({ type: 'price', prices: { monthly: 49000, sixmonth: 300000, yearly: 600000 } });
  const cfg = PR.normalizeConfig({ promos: [a, b, c] });
  assert.equal(PR.priceFor(cfg, 'monthly', 70000, ctx()).price, 49000);
  assert.equal(PR.priceFor(PR.normalizeConfig({ promos: [a] }), 'monthly', 70000, ctx()).price, 56000);
  assert.equal(PR.priceFor(PR.normalizeConfig({ promos: [b] }), 'monthly', 70000, ctx()).price, 50000);
  assert.equal(PR.priceFor(PR.normalizeConfig({ promos: [promo({ type: 'amount', value: 69900 })] }), 'monthly', 70000, ctx()).price, 1000);
  assert.equal(PR.priceFor(PR.normalizeConfig({ promos: [promo({ plans: ['yearly'] })] }), 'monthly', 70000, ctx()).promo, null, 'boshqa tarifga tegishli emas');
});

test('aksiya chegaralari (Toshkent vaqti): boshlanishidan oldin yo\'q, boshida bor, tugash soatida yo\'q', () => {
  const cfg = PR.normalizeConfig({ promos: [promo()] });
  assert.equal(PR.priceFor(cfg, 'monthly', 70000, ctx({ nowMs: T0 - 1 })).promo, null);
  assert.ok(PR.priceFor(cfg, 'monthly', 70000, ctx({ nowMs: T0 })).promo);
  assert.ok(PR.priceFor(cfg, 'monthly', 70000, ctx({ nowMs: T1 - 1 })).promo);
  assert.equal(PR.priceFor(cfg, 'monthly', 70000, ctx({ nowMs: T1 })).promo, null);
  assert.equal(PR.priceFor(PR.normalizeConfig({ promos: [promo({ active: false })] }), 'monthly', 70000, ctx()).promo, null);
});

test('aksiya kimga: yangi / muddati tugagan / tanlangan; qo\'llash limiti', () => {
  const nw = PR.normalizeConfig({ promos: [promo({ audience: 'new' })] });
  assert.ok(PR.priceFor(nw, 'monthly', 70000, ctx()).promo); assert.equal(PR.priceFor(nw, 'monthly', 70000, ctx({ everPaid: true })).promo, null);
  const ex = PR.normalizeConfig({ promos: [promo({ audience: 'expired' })] });
  assert.equal(PR.priceFor(ex, 'monthly', 70000, ctx()).promo, null); assert.ok(PR.priceFor(ex, 'monthly', 70000, ctx({ expiryMs: T0 - 1000 })).promo);
  const se = PR.normalizeConfig({ promos: [promo({ audience: 'selected', bizIds: ['otherBiz99'] })] });
  assert.equal(PR.priceFor(se, 'monthly', 70000, ctx()).promo, null); assert.ok(PR.priceFor(se, 'monthly', 70000, ctx({ bizId: 'otherBiz99' })).promo);
  const p = promo({ limit: 2 }); const li = PR.normalizeConfig({ promos: [p] });
  assert.ok(PR.priceFor(li, 'monthly', 70000, ctx({ usage: { [p.id]: { count: 1 } } })).promo);
  assert.equal(PR.priceFor(li, 'monthly', 70000, ctx({ usage: { [p.id]: { count: 2 } } })).promo, null);
});

test('promokod: noto\'g\'ri, muddati o\'tgan, boshlanmagan, tarif, limit, bitta do\'kon limiti', () => {
  const c = code({ maxUses: 3, perShop: 1, plans: ['monthly'] });
  const cfg = PR.normalizeConfig({ codes: [c] });
  assert.equal(PR.priceFor(cfg, 'monthly', 70000, ctx(), 'savdo10').price, 63000, 'katta-kichik harf farqi yo\'q');
  assert.equal(PR.priceFor(cfg, 'monthly', 70000, ctx(), 'YOQKOD').codeError, 'code-invalid');
  assert.equal(PR.priceFor(cfg, 'monthly', 70000, ctx({ nowMs: T1 }), 'SAVDO10').codeError, 'code-expired');
  assert.equal(PR.priceFor(cfg, 'monthly', 70000, ctx({ nowMs: T0 - 1 }), 'SAVDO10').codeError, 'code-not-started');
  assert.equal(PR.priceFor(cfg, 'yearly', 840000, ctx(), 'SAVDO10').codeError, 'code-plan');
  assert.equal(PR.priceFor(cfg, 'monthly', 70000, ctx({ usage: { [c.id]: { count: 3 } } }), 'SAVDO10').codeError, 'code-limit');
  assert.equal(PR.priceFor(cfg, 'monthly', 70000, ctx({ usage: { [c.id]: { count: 1, shops: { [OWNER]: 1 } } } }), 'SAVDO10').codeError, 'code-shop-limit');
});

test('aksiya + promokod: birga ishlamasa — arzoni; «aksiya bilan birga» belgilansa — ketma-ket', () => {
  const p = promo({ value: 20 });
  const solo = PR.normalizeConfig({ promos: [p], codes: [code({ value: 10 })] });
  const r1 = PR.priceFor(solo, 'monthly', 70000, ctx(), 'SAVDO10');
  assert.equal(r1.price, 56000); assert.equal(r1.codeIgnored, 'promo-better'); assert.equal(r1.code, null);
  const big = PR.normalizeConfig({ promos: [p], codes: [code({ value: 30 })] });
  const r2 = PR.priceFor(big, 'monthly', 70000, ctx(), 'SAVDO10');
  assert.equal(r2.price, 49000); assert.equal(r2.promo, null); assert.ok(r2.code);
  const stack = PR.normalizeConfig({ promos: [p], codes: [code({ value: 10, withPromo: true })] });
  const r3 = PR.priceFor(stack, 'monthly', 70000, ctx(), 'SAVDO10');
  assert.equal(r3.price, 50400); assert.ok(r3.promo && r3.code);
});

const IN = { uid: OWNER, plan: 'monthly', provider: 'click', returnUrl: 'https://savdo-pos.pages.dev/' };
const odeps = (db, now) => ({ db: db, nowMs: () => now, genId: genId, allowedReturnOrigins: [], enabledProviders: ['click'] });
test('buyurtma: aksiya va promokod bilan summa serverda; noto\'g\'ri kod — buyurtma yo\'q; to\'lovda ishlatish soni oshadi', async () => {
  const p = promo({ value: 20 }), c = code({ value: 30, maxUses: 5 });
  const db = fakeDb({ ['businesses/' + OWNER]: { businessName: 'D', subscriptionExpiresAtMs: T0 + 9e8 }, 'config/promos': { promos: [p], codes: [c], version: 1 } });
  const now = T0 + 3600000;
  const o1 = await createOrder(odeps(db, now), IN);
  assert.equal(o1.amount, 56000);
  assert.deepEqual(db.store['paymentOrders/' + o1.orderId].promo, { id: p.id, name: 'Kuzgi aksiya' });
  assert.equal(db.store['paymentOrders/' + o1.orderId].baseAmount, 70000);
  await assert.rejects(createOrder(odeps(db, now), Object.assign({}, IN, { promoCode: 'XATO' })), e => e.code === 'code-invalid');
  const o2 = await createOrder(odeps(db, now), Object.assign({}, IN, { promoCode: 'savdo10' }));
  assert.equal(o2.amount, 49000); assert.notEqual(o2.orderId, o1.orderId);
  const ord = db.store['paymentOrders/' + o2.orderId];
  await db.runTransaction(tx => applyPaidInTx(tx, db, ord, { provider: 'click', transactionId: 'x', nowMs: now }));
  assert.equal(db.store['promoUsage/' + c.id].count, 1); assert.equal(db.store['promoUsage/' + c.id].shops[OWNER], 1);
  assert.equal(db.store['payments/' + o2.orderId].baseAmount, 70000); assert.equal(db.store['payments/' + o2.orderId].code.code, 'SAVDO10');
  PRICING.clearPromosCache(db);
  await assert.rejects(createOrder(odeps(db, now + 60000), Object.assign({}, IN, { promoCode: 'SAVDO10' })), e => e.code === 'code-shop-limit');
});

const KEY = core.keyFromToken('123:TEST'), CHAT = '5550001', BID = 'bizOwnerUid1';
test('bot: menyuda aksiya narxi 🔥 va «N kun qoldi»; hisob aksiya summasida', async () => {
  const s = {};
  s['tgBiz/' + BID] = { chats: { [CHAT]: { name: 'Ega', at: 1, sig: core.sigOf(KEY, BID, CHAT) } }, lang: 'uz' };
  s['tgChats/' + CHAT] = { bids: [BID], lang: 'uz' };
  s['businesses/' + BID] = { businessName: 'Sardor Market', subscriptionExpiresAtMs: T0 + 5 * 86400000 };
  s['config/promos'] = { promos: [promo({ value: 20, plans: ['monthly'] })], codes: [] };
  const db = fakeDb(s), tg = fakeTg(); const now = T0 + 3600000;
  const deps = { db, tg, key: KEY, nowMs: () => now, payToken: 'PROVIDER:TEST', genId: genId, botName: 'savdo_pos_bot' };
  await core.handleUpdate(deps, { message: { message_id: 1, chat: { id: Number(CHAT), type: 'private' }, from: { id: 77, language_code: 'uz' }, text: '/obuna' } });
  const m = tg.sent[0];
  assert.ok(/56 000/.test(m.reply_markup.inline_keyboard[0][0].text) && /🔥/.test(m.reply_markup.inline_keyboard[0][0].text));
  assert.ok(/Kuzgi aksiya/.test(m.text) && /<s>70 000<\/s>/.test(m.text) && /7 kun qoldi/.test(m.text), m.text);
  await core.handleUpdate(deps, { callback_query: { id: 'cq', data: 'p|' + pay.bidHash(BID) + '|m', from: { id: 77, language_code: 'uz' }, message: { message_id: 9, chat: { id: Number(CHAT), type: 'private' } } } });
  assert.equal(tg.calls.find(c => c.method === 'sendInvoice').params.prices[0].amount, 5600000);
});

const ad = (db, now, extra) => Object.assign({ db: db, nowMs: () => now, genId: genId, superUid: SUPER, computeStats: computeStats }, extra || {});
test('adminApi: aksiya/promokod saqlash — tekshiruv, versiya, jurnal; superadmin emas — 403', async () => {
  const db = fakeDb({}); const now = T0;
  for (const a of ['promosSet', 'giftDays', 'trialSet', 'statsGet', 'remind', 'promosGet']) assert.equal((await handleAdmin(ad(db, now), { uid: OWNER }, { action: a })).status, 403, a);
  assert.equal((await handleAdmin(ad(db, now), { uid: SUPER }, { action: 'promosSet', promos: [promo({ value: 95 })], codes: [] })).body.code, 'bad-value');
  assert.equal((await handleAdmin(ad(db, now), { uid: SUPER }, { action: 'promosSet', promos: [promo({ endMs: T0 })], codes: [] })).body.code, 'bad-dates');
  assert.equal((await handleAdmin(ad(db, now), { uid: SUPER }, { action: 'promosSet', promos: [], codes: [code(), code()] })).body.code, 'dup-code');
  const r = await handleAdmin(ad(db, now), { uid: SUPER, email: 'a@x.uz' }, { action: 'promosSet', promos: [promo()], codes: [code()], version: 0 });
  assert.equal(r.body.version, 1);
  assert.equal(db.store['config/promos'].promos.length, 1);
  const g = await handleAdmin(ad(db, now), { uid: SUPER }, { action: 'promosGet' });
  assert.equal(g.body.cfg.codes[0].code, 'SAVDO10'); assert.equal(g.body.log[0].action, 'promos.set');
  assert.equal((await handleAdmin(ad(db, now), { uid: SUPER }, { action: 'promosSet', promos: [], codes: [], version: 0 })).status, 409);
});

test('sovg\'a kunlari: tanlanganlarga va hammaga; cheksizga tegilmaydi; sabab majburiy; jurnalga', async () => {
  const now = T0;
  const db = fakeDb({ 'businesses/bizAAAAAA1': { subscriptionExpiresAtMs: now + 2 * 86400000 }, 'businesses/bizBBBBBB2': { subscriptionExpiresAtMs: now - 5 * 86400000 }, 'businesses/bizCCCCCC3': { businessName: 'cheksiz' } });
  assert.equal((await handleAdmin(ad(db, now), { uid: SUPER }, { action: 'giftDays', target: 'list', bizIds: ['bizAAAAAA1'], days: 10, reason: '' })).body.code, 'need-reason');
  const r = await handleAdmin(ad(db, now), { uid: SUPER }, { action: 'giftDays', target: 'list', bizIds: ['bizAAAAAA1'], days: 10, reason: 'Kechirim' });
  assert.equal(r.body.count, 1); assert.equal(db.store['businesses/bizAAAAAA1'].subscriptionExpiresAtMs, now + 12 * 86400000);
  const a = await handleAdmin(ad(db, now), { uid: SUPER }, { action: 'giftDays', target: 'all', days: 3, reason: 'Bayram sovg\'asi' });
  assert.equal(a.body.count, 2); assert.equal(a.body.skipped, 1);
  assert.equal(db.store['businesses/bizBBBBBB2'].subscriptionExpiresAtMs, now + 3 * 86400000, 'tugaganiga — hozirdan');
  assert.equal(db.store['businesses/bizCCCCCC3'].subscriptionExpiresAtMs, undefined);
  assert.equal(Object.keys(db.store).filter(k => k.startsWith('adminLog/') && db.store[k].action === 'gift.days').length, 2);
});

test('sinov muddati: paneldan 30 kun — yangi biznes 30 kun oladi (server to\'g\'rilaydi), yaratilgan vaqt yoziladi', async () => {
  const now = T0; const db = fakeDb({});
  assert.equal((await handleAdmin(ad(db, now), { uid: SUPER }, { action: 'trialSet', days: 100 })).body.code, 'bad-days');
  await handleAdmin(ad(db, now), { uid: SUPER }, { action: 'trialSet', days: 30 });
  assert.equal(db.store['config/plans'].trialDays, 30);
  db.store['businesses/newBiz001'] = { subscriptionPlan: 'trial', subscriptionExpiresAtMs: now + 15 * 86400000 };
  await onBusinessCreated({ db: db, nowMs: () => now }, 'newBiz001', db.store['businesses/newBiz001']);
  assert.equal(db.store['businesses/newBiz001'].subscriptionExpiresAtMs, now + 30 * 86400000);
  assert.equal(db.store['businesses/newBiz001'].createdAtMs, now);
  await handleAdmin(ad(db, now), { uid: SUPER, email: 'a' }, { action: 'plansSet', plans: { monthly: { price: 70000, months: 1, active: true }, sixmonth: { price: 400000, months: 6, active: true }, yearly: { price: 840000, months: 12, active: true, best: true } } });
  assert.equal(db.store['config/plans'].trialDays, 30, 'narx saqlanganda sinov muddati yo\'qolmaydi');
});

test('statistika: MRR va o\'tgan oyga nisbatan, holatlar, konversiya, ketganlar, 12 oy tushum, 7 kunda tugaydiganlar', async () => {
  const now = Date.UTC(2026, 9, 23, 7, 0, 0), D = 86400000;
  const s = {
    'businesses/b1xxxx': { businessName: 'Pullik', subscriptionPlan: 'monthly', subscriptionExpiresAtMs: now + 3 * D, createdAtMs: now - 40 * D },
    'businesses/b2xxxx': { businessName: 'Sinov', subscriptionPlan: 'trial', subscriptionExpiresAtMs: now + 10 * D, createdAtMs: now - 2 * 3600000 },
    'businesses/b3xxxx': { businessName: 'Ketgan', subscriptionPlan: 'monthly', subscriptionExpiresAtMs: now - 2 * D, createdAtMs: now - 100 * D },
    'businesses/b4xxxx': { businessName: 'Cheksiz' },
    'payments/p1': { businessId: 'b1xxxx', amount: 70000, months: 1, paidAtMs: now - 27 * D, status: 'PAID' },
    'payments/p2': { businessId: 'b3xxxx', amount: 420000, months: 6, paidAtMs: now - 185 * D, status: 'PAID' }
  };
  const st = await computeStats(fakeDb(s), now);
  assert.deepEqual(st.counts, { total: 4, paid: 1, trial: 1, expired: 1, unlimited: 1 });
  assert.equal(st.mrr, 70000);
  assert.equal(st.mrrPrev, 70000, '30 kun oldin: b3 ning 6 oylik to\'lovi (70 000/oy) faol edi');
  assert.equal(st.churnMonth, 1);
  assert.equal(st.conversion.paid, 2);
  assert.equal(st.signups.today, 1); assert.equal(st.signups.daily[29], 1);
  assert.equal(st.revenue12.length, 12); assert.equal(st.revenue12[11].ym, '2026-10'); assert.equal(st.revenue12[11].sum, 0); assert.equal(st.revenue12[10].sum, 70000);
  assert.equal(st.expiring7.length, 1); assert.equal(st.expiring7[0].id, 'b1xxxx');
  const db = fakeDb(s);
  const g = await handleAdmin(ad(db, now), { uid: SUPER }, { action: 'statsGet' });
  assert.equal(g.body.stats.mrr, 70000); assert.ok(db.store['adminStats/current']);
});

test('eslatma: do\'kon tilida yordam chatiga yoziladi (push trigger orqali boradi), jurnalga', async () => {
  const now = T0; const db = fakeDb({ 'businesses/b1xxxx': { businessName: 'Market', language: 'ru', subscriptionExpiresAtMs: Date.UTC(2026, 10, 3, 10) } });
  const r = await handleAdmin(ad(db, now), { uid: SUPER }, { action: 'remind', bizIds: ['b1xxxx'] });
  assert.equal(r.body.count, 1);
  const k = Object.keys(db.store).find(x => x.startsWith('businesses/b1xxxx/support/'));
  assert.ok(k && db.store[k].from === 'admin' && /Market/.test(db.store[k].text) && /03\.11\.2026/.test(db.store[k].text) && /подписка/.test(db.store[k].text));
});
