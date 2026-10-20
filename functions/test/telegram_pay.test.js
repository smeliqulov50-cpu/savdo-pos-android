'use strict';
/* fix142-tgpay: obuna to'lovi Telegram bot orqali — menyu, hisob, oldindan tekshiruv, to'lov, takror, soxta so'rovlar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb, fakeTg } = require('./helpers/tgFake');
const core = require('../src/telegram/core');
const pay = require('../src/telegram/pay');
const { PLANS } = require('../src/domain/plans');

const KEY = core.keyFromToken('123:TEST');
const BID = 'bizOwnerUid1', CHAT = '5550001', NOW = Date.UTC(2026, 9, 19, 9, 0, 0);
function seed(extra) {
  const s = {};
  s['tgBiz/' + BID] = { chats: { [CHAT]: { name: 'Ega', at: 1, sig: core.sigOf(KEY, BID, CHAT) } }, lang: 'uz' };
  s['tgChats/' + CHAT] = { bids: [BID], lang: 'uz' };
  s['businesses/' + BID] = { businessName: 'Sardor Market', subscriptionExpiresAtMs: NOW + 5 * 86400000 };
  return Object.assign(s, extra || {});
}
let idn = 0;
function mk(seedObj, opt) {
  const db = fakeDb(seedObj || seed()); const tg = fakeTg();
  const deps = Object.assign({ db: db, tg: tg, key: KEY, nowMs: function () { return NOW; }, payToken: 'PROVIDER:TEST', genId: function () { return 'ord' + (++idn) + 'abcdef'; }, botName: 'savdo_pos_bot' }, opt || {});
  return { db, tg, deps };
}
const msg = (text, chat) => ({ message: { message_id: 1, chat: { id: Number(chat || CHAT), type: 'private' }, from: { id: 77, language_code: 'uz' }, text: text } });
const cbData = (plan) => 'p|' + pay.bidHash(BID) + '|' + plan;
const cbq = (data, chat) => ({ callback_query: { id: 'cq1', data: data, from: { id: 77, language_code: 'uz' }, message: { message_id: 9, chat: { id: Number(chat || CHAT), type: 'private' } } } });

test('/obuna: tariflar tugmalari bilan menyu', async () => {
  const { tg, deps } = mk();
  await core.handleUpdate(deps, msg('/obuna'));
  const m = tg.sent[0];
  assert.ok(m && /Sardor Market/.test(m.text) && /24\.10\.2026/.test(m.text));
  const kb = m.reply_markup.inline_keyboard;
  assert.equal(kb.length, 4);   /* fix146-tgsub: oxirgisi — tariflar katalogi (mini ilova) */
  assert.ok(kb[3][0].web_app && kb[3][0].web_app.url.endsWith('?v=me'));
  assert.equal(kb[0][0].callback_data, cbData('m'));
  assert.ok(/70 000/.test(kb[0][0].text) && /840 000/.test(kb[2][0].text));
  assert.ok(kb.slice(0, 3).every(r => Buffer.byteLength(r[0].callback_data) <= 64));
});

test('token yo\'q bo\'lsa to\'lov taklif qilinmaydi', async () => {
  const { tg, deps } = mk(seed(), { payToken: '' });
  await core.handleUpdate(deps, msg('/obuna'));
  assert.ok(/yoqilmagan/.test(tg.sent[0].text) && !tg.sent[0].reply_markup);
  const r = await core.handleUpdate(deps, cbq(cbData('m')));
  assert.equal(r.off, true);
  assert.ok(!tg.calls.some(c => c.method === 'sendInvoice'));
});

test('ulanmagan chat: menyu ham, hisob ham yo\'q', async () => {
  const { tg, deps } = mk();
  await core.handleUpdate(deps, msg('/obuna', '999'));
  assert.ok(/ulanmagan/.test(tg.sent[0].text));
  const r = await core.handleUpdate(deps, cbq(cbData('m'), '999'));
  assert.equal(r.notLinked, true);
  assert.ok(!tg.calls.some(c => c.method === 'sendInvoice'));
});

test('imzosi soxta chat yozuvi — to\'lov qilinmaydi', async () => {
  const s = seed(); s['tgBiz/' + BID].chats[CHAT].sig = 'fake';
  const { tg, deps } = mk(s);
  const r = await core.handleUpdate(deps, cbq(cbData('y')));
  assert.equal(r.notLinked, true);
  assert.ok(!tg.calls.some(c => c.method === 'sendInvoice'));
});

test('tarif tanlansa: buyurtma va hisob (summa serverdan, tiyinda)', async () => {
  const { db, tg, deps } = mk();
  const r = await core.handleUpdate(deps, cbq(cbData('s')));
  const inv = tg.calls.find(c => c.method === 'sendInvoice').params;
  assert.equal(inv.currency, 'UZS');
  assert.equal(inv.prices[0].amount, PLANS.sixmonth.price * 100);
  assert.equal(inv.provider_token, 'PROVIDER:TEST');
  assert.equal(inv.payload, r.invoice);
  assert.ok(inv.title.length <= 32 && inv.description.length <= 255);
  const o = db.store['paymentOrders/' + r.invoice];
  assert.equal(o.status, 'PENDING'); assert.equal(o.businessId, BID); assert.equal(o.amount, PLANS.sixmonth.price); assert.equal(o.provider, 'click_tg');
  // 30 daqiqa ichida qayta bosilsa — o'sha buyurtma
  const r2 = await core.handleUpdate(deps, cbq(cbData('s')));
  assert.equal(r2.invoice, r.invoice);
  assert.ok(tg.calls.some(c => c.method === 'answerCallbackQuery'));
});

test('oldindan tekshiruv: to\'g\'ri summa — ha; boshqa summa, to\'langan, eski — yo\'q', async () => {
  const { db, tg, deps } = mk();
  const r = await core.handleUpdate(deps, cbq(cbData('m')));
  const q = (amt, payload) => ({ pre_checkout_query: { id: 'pq' + amt, from: { id: 77, language_code: 'uz' }, currency: 'UZS', total_amount: amt, invoice_payload: payload || r.invoice } });
  let x = await core.handleUpdate(deps, q(PLANS.monthly.price * 100));
  assert.equal(x.ok, true);
  assert.deepEqual(tg.calls.filter(c => c.method === 'answerPreCheckoutQuery').pop().params, { pre_checkout_query_id: 'pq' + PLANS.monthly.price * 100, ok: true });
  x = await core.handleUpdate(deps, q(100));
  assert.equal(x.ok, false);
  x = await core.handleUpdate(deps, q(PLANS.monthly.price * 100, 'noSuchOrder1'));
  assert.equal(x.ok, false);
  db.store['paymentOrders/' + r.invoice].createdAtMs = NOW - 25 * 3600 * 1000;
  x = await core.handleUpdate(deps, q(PLANS.monthly.price * 100));
  assert.equal(x.why, 'payExpired');
  db.store['paymentOrders/' + r.invoice].status = 'PAID';
  x = await core.handleUpdate(deps, q(PLANS.monthly.price * 100));
  assert.equal(x.why, 'payAlready');
});

test('to\'lov o\'tdi: obuna 1 oyga uzaydi, payments yozuvi, takror — ikki marta emas', async () => {
  const { db, tg, deps } = mk();
  const r = await core.handleUpdate(deps, cbq(cbData('m')));
  const paid = { message: { message_id: 5, chat: { id: Number(CHAT), type: 'private' }, from: { id: 77, language_code: 'uz' },
    successful_payment: { currency: 'UZS', total_amount: PLANS.monthly.price * 100, invoice_payload: r.invoice, telegram_payment_charge_id: 'tgc1', provider_payment_charge_id: 'click777' } } };
  const a = await core.handleUpdate(deps, paid);
  assert.equal(a.applied, true);
  const biz = db.store['businesses/' + BID];
  assert.equal(biz.subscriptionPlan, 'monthly');
  assert.equal(new Date(biz.subscriptionExpiresAtMs).toISOString().slice(0, 10), '2026-11-24');
  const p = db.store['payments/' + r.invoice];
  assert.equal(p.status, 'PAID'); assert.equal(p.provider, 'click_tg'); assert.equal(p.transactionId, 'click777'); assert.equal(p.amount, PLANS.monthly.price);
  assert.equal(db.store['paymentOrders/' + r.invoice].status, 'PAID');
  assert.ok(/24\.11\.2026/.test(tg.sent.pop().text));
  const b = await core.handleUpdate(deps, paid);
  assert.equal(b.already, true);
  assert.equal(new Date(db.store['businesses/' + BID].subscriptionExpiresAtMs).toISOString().slice(0, 10), '2026-11-24');
});

test('summa mos kelmasa — obuna uzaymaydi, muammo xabari', async () => {
  const { db, tg, deps } = mk();
  const r = await core.handleUpdate(deps, cbq(cbData('y')));
  const bad = { message: { message_id: 6, chat: { id: Number(CHAT), type: 'private' }, from: { id: 77, language_code: 'uz' },
    successful_payment: { currency: 'UZS', total_amount: 100, invoice_payload: r.invoice, telegram_payment_charge_id: 'x', provider_payment_charge_id: 'y' } } };
  const a = await core.handleUpdate(deps, bad);
  assert.equal(a.bad, true);
  assert.equal(db.store['businesses/' + BID].subscriptionExpiresAtMs, NOW + 5 * 86400000);
  assert.ok(/muammo/.test(tg.sent.pop().text));
});

test('muddati tugagan obuna: hozirdan boshlab uzayadi', async () => {
  const s = seed(); s['businesses/' + BID].subscriptionExpiresAtMs = NOW - 10 * 86400000;
  const { db, tg, deps } = mk(s);
  await core.handleUpdate(deps, msg('/obuna'));
  assert.ok(/tugagan/.test(tg.sent[0].text));
  const r = await core.handleUpdate(deps, cbq(cbData('m')));
  await core.handleUpdate(deps, { message: { message_id: 7, chat: { id: Number(CHAT), type: 'private' }, from: { id: 77 }, successful_payment: { currency: 'UZS', total_amount: PLANS.monthly.price * 100, invoice_payload: r.invoice, telegram_payment_charge_id: 'a', provider_payment_charge_id: 'b' } } });
  assert.equal(new Date(db.store['businesses/' + BID].subscriptionExpiresAtMs).toISOString().slice(0, 10), '2026-11-19');
});

test('guruhdagi tugma va boshqa ma\'lumotlar e\'tiborga olinmaydi; ulangan chatga /obuna eslatmasi', async () => {
  const { tg, deps } = mk();
  const g = { callback_query: { id: 'c', data: cbData('m'), from: { id: 1 }, message: { chat: { id: -100, type: 'group' } } } };
  assert.equal((await core.handleUpdate(deps, g)).ignored, true);
  assert.equal((await core.handleUpdate(deps, cbq('xyz'))).ignored, true);
  await core.handleUpdate(deps, msg('salom'));
  assert.ok(/\/obuna/.test(tg.sent.pop().text));
});

test('webhook to\'lov yangilanishlarini ham oladi', async () => {
  const { tg, deps } = mk();
  await core.setupWebhook(deps, 'https://x/telegramWebhook');
  const sw = tg.calls.find(c => c.method === 'setWebhook').params;
  assert.deepEqual(sw.allowed_updates, ['message', 'my_chat_member', 'callback_query', 'pre_checkout_query']);
});
