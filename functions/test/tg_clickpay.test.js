'use strict';
/* fix207-clickpay: bot obunasi Click'ning o'z sahifasi orqali — havola, muddat, Prepare/Complete, xabarlar, eski yo'lga qaytish. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb, fakeTg } = require('./helpers/tgFake');
const core = require('../src/telegram/core');
const pay = require('../src/telegram/pay');
const shop = require('../src/telegram/shop');
const CFG = require('../src/config');
const { handleClick, signFor } = require('../src/providers/click');

const KEY = core.keyFromToken('123:TEST');
const BID = 'bizOwnerUid1', CHAT = '5550001', NOW = Date.UTC(2026, 9, 19, 9, 0, 0);
const CLICK = { serviceId: '11111', merchantId: '22222' }, SECRET = 'clickSecretKey';
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
  let now = NOW;
  const deps = Object.assign({ db: db, tg: tg, key: KEY, nowMs: function () { return now; }, payToken: 'PROVIDER:TEST', click: CLICK, genId: function () { return 'cko' + (++idn) + 'abcdefgh'; }, botName: 'savdo_pos_bot' }, opt || {});
  return { db, tg, deps, tick: function (ms) { now += ms; } };
}
const msg = (text, chat) => ({ message: { message_id: 1, chat: { id: Number(chat || CHAT), type: 'private' }, from: { id: 77, language_code: 'uz' }, text: text } });
const cbq = (data, chat) => ({ callback_query: { id: 'cq1', data: data, from: { id: 77, language_code: 'uz' }, message: { message_id: 9, chat: { id: Number(chat || CHAT), type: 'private' } } } });
const cbData = (plan) => 'p|' + pay.bidHash(BID) + '|' + plan;
function lastSent(tg) { return tg.sent[tg.sent.length - 1]; }
function clickReq(orderId, amount, action, extra) {
  const p = Object.assign({ click_trans_id: '900' + orderId.length, service_id: CLICK.serviceId, click_paydoc_id: '55', merchant_trans_id: orderId, amount: String(amount), action: String(action), error: '0', error_note: 'Success', sign_time: '2026-10-19 14:00:00' }, extra || {});
  p.sign_string = signFor(p, SECRET, action === 1);
  return p;
}
const ck = (e, p) => handleClick({ db: e.db, serviceId: CLICK.serviceId, secretKey: SECRET, nowMs: e.deps.nowMs }, p);

test('to\'lov rejimi: Click kalitlari bo\'lsa — redirect, bo\'lmasa — eski yo\'l, hech biri — o\'chiq', () => {
  assert.equal(pay.payMode({ payToken: 'x', click: CLICK }), 'redirect');
  assert.equal(pay.payMode({ payToken: 'x', click: null }), 'telegram');
  assert.equal(pay.payMode({ payToken: 'x', click: { serviceId: '1', merchantId: '' } }), 'telegram');
  assert.equal(pay.payMode({ payToken: '', click: CLICK }), 'redirect');
  assert.equal(pay.payMode({ payToken: '', click: null }), '');
  const old = CFG.TG_PAY_MODE; CFG.TG_PAY_MODE = 'telegram';
  try { assert.equal(pay.payMode({ payToken: 'x', click: CLICK }), 'telegram'); assert.equal(pay.payMode({ payToken: '', click: CLICK }), 'redirect'); }
  finally { CFG.TG_PAY_MODE = old; }
});

test('tarif tugmasi: Click havolasi (URL tugma), karta so\'ralmaydi, sendInvoice yo\'q', async () => {
  const e = mk();
  const r = await core.handleUpdate(e.deps, cbq(cbData('m')));
  assert.ok(r.link);
  assert.ok(!e.tg.calls.some(c => c.method === 'sendInvoice'));
  const m = lastSent(e.tg);
  assert.ok(/Sardor Market/.test(m.text) && /70 000/.test(m.text) && /Karta ma'lumotlari botga berilmaydi/.test(m.text) && /30 daqiqa/.test(m.text));
  const u = new URL(m.reply_markup.inline_keyboard[0][0].url);
  assert.equal(u.origin + u.pathname, 'https://my.click.uz/services/pay');
  assert.equal(u.searchParams.get('service_id'), '11111'); assert.equal(u.searchParams.get('merchant_id'), '22222');
  assert.equal(u.searchParams.get('amount'), '70000'); assert.equal(u.searchParams.get('transaction_param'), r.link);
  assert.equal(u.searchParams.get('return_url'), 'https://t.me/savdo_pos_bot?start=paid_' + r.link);
  assert.equal(m.reply_markup.inline_keyboard[1][0].callback_data, 'pc|' + r.link);
  const o = e.db.store['paymentOrders/' + r.link];
  assert.equal(o.provider, 'click'); assert.equal(o.channel, 'tg'); assert.equal(o.chatId, CHAT); assert.equal(o.expMs, NOW + 30 * 60000); assert.equal(o.status, 'PENDING');
  assert.ok(('l_x paid_' + r.link).length < 64 && ('paid_' + r.link).length <= 64);
});

test('aksiya narxi serverdan; qayta bosilsa o\'sha buyurtma; 5 daqiqadan kam qolsa — yangisi', async () => {
  const e = mk(seed({ 'config/promos': { promos: [{ id: 'pr1xx', name: 'Kuz', active: true, startMs: NOW - 86400000, endMs: NOW + 5 * 86400000, type: 'percent', value: 20, plans: ['monthly'], audience: 'all', limit: 0 }], codes: [], version: 1 } }));
  const r1 = await core.handleUpdate(e.deps, cbq(cbData('m')));
  const o1 = e.db.store['paymentOrders/' + r1.link];
  assert.equal(o1.amount, 56000); assert.equal(o1.baseAmount, 70000); assert.equal(o1.promo.id, 'pr1xx');
  assert.ok(new URL(lastSent(e.tg).reply_markup.inline_keyboard[0][0].url).searchParams.get('amount') === '56000' && /56 000/.test(lastSent(e.tg).text));
  e.tick(20 * 60000);
  const r2 = await core.handleUpdate(e.deps, cbq(cbData('m')));
  assert.equal(r2.link, r1.link, '20 daqiqada — o\'sha havola');
  e.tick(6 * 60000);
  const r3 = await core.handleUpdate(e.deps, cbq(cbData('m')));
  assert.notEqual(r3.link, r1.link, '4 daqiqa qolgan havola qayta berilmaydi');
});

test('Click kalitlari yo\'q — eski yo\'l (sendInvoice) avvalgidek', async () => {
  const e = mk(seed(), { click: null });
  const r = await core.handleUpdate(e.deps, cbq(cbData('m')));
  assert.ok(r.invoice);
  assert.ok(e.tg.calls.some(c => c.method === 'sendInvoice'));
  assert.equal(e.db.store['paymentOrders/' + r.invoice].provider, 'click_tg');
});

test('Prepare + Complete: obuna uzayadi, egasiga xabar; ikkinchi Complete — Already paid, xabar yo\'q', async () => {
  const e = mk();
  const id = (await core.handleUpdate(e.deps, cbq(cbData('m')))).link;
  const p0 = clickReq(id, 70000, 0);
  const a = await ck(e, p0);
  assert.equal(a.error, 0);
  const p1 = clickReq(id, 70000, 1, { merchant_prepare_id: String(a.merchant_prepare_id) });
  const b = await ck(e, p1);
  assert.equal(b.error, 0);
  const biz = e.db.store['businesses/' + BID];
  assert.ok(biz.subscriptionExpiresAtMs > NOW + 30 * 86400000);
  const pmt = e.db.store['payments/' + id];
  assert.equal(pmt.provider, 'click'); assert.equal(pmt.channel, 'tg'); assert.equal(pmt.amount, 70000);
  const n0 = e.tg.sent.length;
  assert.deepEqual(await pay.clickAfter(e.deps, p1, b), { notified: 'paid' });
  assert.ok(/To'lov qabul qilindi/.test(lastSent(e.tg).text) && lastSent(e.tg).chat_id === CHAT && e.tg.sent.length === n0 + 1);
  const c = await ck(e, p1);
  assert.equal(c.error, -4);
  assert.equal(await pay.clickAfter(e.deps, p1, c), null);
  assert.equal(e.tg.sent.length, n0 + 1, 'takroriy Complete — ikkinchi xabar yo\'q');
  const p2 = clickReq(id, 70000, 0, { click_trans_id: '777' });
  assert.equal((await ck(e, p2)).error, -4, 'to\'langan buyurtmaga yangi to\'lov — Already paid');
  // «To'lovni tekshirish» — to'landi
  await core.handleUpdate(e.deps, cbq('pc|' + id));
  assert.ok(/To'lov qabul qilindi/.test(lastSent(e.tg).text));
});

test('muddati o\'tgan buyurtma: Prepare rad etiladi (pul yechilmaydi); Prepare o\'tgan bo\'lsa — Complete kech bo\'lsa ham qabul', async () => {
  const e = mk();
  const id = (await core.handleUpdate(e.deps, cbq(cbData('m')))).link;
  e.tick(41 * 60000);
  assert.equal((await ck(e, clickReq(id, 70000, 0))).error, -9);
  assert.equal(e.db.store['paymentOrders/' + id].status, 'PENDING');
  const e2 = mk();
  const id2 = (await core.handleUpdate(e2.deps, cbq(cbData('m')))).link;
  e2.tick(25 * 60000);
  const a = await ck(e2, clickReq(id2, 70000, 0));
  assert.equal(a.error, 0);
  e2.tick(60 * 60000);
  assert.equal((await ck(e2, clickReq(id2, 70000, 1, { merchant_prepare_id: String(a.merchant_prepare_id) }))).error, 0);
  assert.equal(e2.db.store['paymentOrders/' + id2].status, 'PAID');
});

test('noto\'g\'ri imzo / noto\'g\'ri summa / boshqa xizmat — rad', async () => {
  const e = mk();
  const id = (await core.handleUpdate(e.deps, cbq(cbData('m')))).link;
  const bad = clickReq(id, 70000, 0); bad.sign_string = 'deadbeef' + bad.sign_string.slice(8);
  assert.equal((await ck(e, bad)).error, -1);
  assert.equal((await ck(e, clickReq(id, 1000, 0))).error, -2);
  assert.equal((await ck(e, clickReq(id, 70000, 0, { service_id: '999' }))).error, -8);
  assert.equal(e.db.store['paymentOrders/' + id].status, 'PENDING');
});

test('Click to\'lovni bekor qildi — botda xabar va «Yangi havola olish»', async () => {
  const e = mk();
  const id = (await core.handleUpdate(e.deps, cbq(cbData('m')))).link;
  const a = await ck(e, clickReq(id, 70000, 0));
  const p1 = clickReq(id, 70000, 1, { merchant_prepare_id: String(a.merchant_prepare_id), error: '-5017', error_note: 'Insufficient funds' });
  const b = await ck(e, p1);
  assert.equal(b.error, -9);
  assert.equal(e.db.store['paymentOrders/' + id].status, 'CANCELLED');
  assert.deepEqual(await pay.clickAfter(e.deps, p1, b), { notified: 'failed' });
  const m = lastSent(e.tg);
  assert.ok(/amalga oshmadi/.test(m.text) && m.reply_markup.inline_keyboard[0][0].callback_data === cbData('m'));
  const r = await core.handleUpdate(e.deps, cbq(cbData('m')));
  assert.ok(r.link && r.link !== id, 'qayta urinish — yangi buyurtma');
});

test('/start paid_<id>: holat faqat serverdan; begona chat — rad', async () => {
  const e = mk(seed({ 'tgChats/888': { bids: [] } }));
  const id = (await core.handleUpdate(e.deps, cbq(cbData('m')))).link;
  await core.handleUpdate(e.deps, msg('/start paid_' + id));
  let m = lastSent(e.tg);
  assert.ok(/hali tasdiqlanmadi/.test(m.text) && m.reply_markup.inline_keyboard[0][0].url.indexOf('my.click.uz') !== -1);
  assert.equal(e.db.store['paymentOrders/' + id].status, 'PENDING', 'qaytish to\'lov hisoblanmaydi');
  await core.handleUpdate(e.deps, msg('/start paid_' + id, '888'));
  assert.ok(/tegishli emas/.test(lastSent(e.tg).text));
  await core.handleUpdate(e.deps, msg('/start paid_yoqbuyurtma123'));
  assert.ok(/tegishli emas/.test(lastSent(e.tg).text));
  e.tick(31 * 60000);
  await core.handleUpdate(e.deps, cbq('pc|' + id));
  m = lastSent(e.tg);
  assert.ok(/muddati tugadi/.test(m.text) && m.reply_markup.inline_keyboard[0][0].callback_data === cbData('m'));
  assert.ok(e.tg.calls.some(c => c.method === 'editMessageReplyMarkup' && c.params.reply_markup.inline_keyboard[0][0].callback_data === cbData('m')), 'eski xabar tugmasi «Yangi havola olish» ga aylandi');
});

test('mini ilova (tariflar sahifasi): Click havolasi qaytadi (redirect), chatga ham xabar', async () => {
  const e = mk();
  const info = await shop.handleSub(e.deps, { id: CHAT, lang: 'uz' }, 'subInfo', {});
  assert.equal(info.body.payOn, true); assert.equal(info.body.payMode, 'redirect');
  const r = await shop.handleSub(e.deps, { id: CHAT, lang: 'uz' }, 'subPay', { h: pay.bidHash(BID), k: 'm' });
  assert.equal(r.body.ok, true); assert.equal(r.body.redirect, true);
  assert.ok(r.body.link.indexOf('https://my.click.uz/services/pay?') === 0 && r.body.link.indexOf('transaction_param=' + r.body.order) !== -1);
  assert.ok(!e.tg.calls.some(c => c.method === 'createInvoiceLink'));
  assert.ok(/Click/.test(JSON.stringify(lastSent(e.tg).reply_markup)));
  const e2 = mk(seed(), { click: null });
  const r2 = await shop.handleSub(e2.deps, { id: CHAT, lang: 'uz' }, 'subPay', { h: pay.bidHash(BID), k: 'm' });
  assert.ok(!r2.body.redirect && e2.tg.calls.some(c => c.method === 'createInvoiceLink'), 'kalitsiz — eski yo\'l');
});

test('menyu: faqat Click bo\'lsa ham «Obuna» tugmasi bor; matnlar 6 tilda', async () => {
  const C = require('../src/telegram/cmds');
  const kb = JSON.stringify(C.menuKb({ payToken: '', click: CLICK }, 'uz'));
  assert.ok(kb.length > 10);
  const { T } = require('../src/telegram/payTexts');
  ['payLinkMsg', 'btnClickPay', 'btnPayCheck', 'btnNewLink', 'payWaiting', 'payLinkExpired', 'payClickFail', 'payBadLink'].forEach(function (k) {
    ['uz', 'ru', 'en', 'kk', 'ky', 'tg'].forEach(function (l) { assert.ok(T[k] && T[k][l], k + '.' + l); });
  });
});
