'use strict';
/* fix145-botshop: bot orqali buyurtma — mini ilova imzosi, katalog, buyurtma, holatlar, mijoz bekor qilishi, bot chati, ilova API. */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { fakeDb, fakeTg } = require('./helpers/tgFake');
const core = require('../src/telegram/core');
const shop = require('../src/telegram/shop');

const TOKEN = '123:TEST';
const KEY = core.keyFromToken(TOKEN), WEBKEY = shop.webKeyFromToken(TOKEN);
const BID = 'bizOwner1', BID2 = 'bizOwner2', OWNER_CHAT = '5550001', CUST = 777001, CUST2 = 777002;
const NOW = Date.UTC(2026, 9, 19, 9, 0, 0);   // Toshkent: 14:00
const IMG = 'data:image/png;base64,' + Buffer.from('PNGDATA').toString('base64');

function prod(id, o) { return Object.assign({ id: id, name: 'Mahsulot ' + id, price: 10000, stock: 10, unit: 'dona', category: 'Ichimlik', botSell: true }, o || {}); }
function seed(extra) {
  const s = {};
  s['tgBiz/' + BID] = { chats: { [OWNER_CHAT]: { name: 'Ega', at: 1, sig: core.sigOf(KEY, BID, OWNER_CHAT) } }, lang: 'uz' };
  s['tgChats/' + OWNER_CHAT] = { bids: [BID], lang: 'uz' };
  s['businesses/' + BID] = { businessName: 'Sardor Market', businessAddress: 'Chilonzor 5', businessPhone: '+998901112233', currency: 'UZS' };
  s['tgShop/' + BID] = { enabled: true, slug: 'sardor', branchId: 'main', pickup: true, delivery: true, fee: 15000, freeFrom: 200000, minOrder: 0, notifyTg: true, seq: 0 };
  s['tgSlug/sardor'] = { bid: BID };
  s['businesses/' + BID + '/products/p1'] = prod('p1', { name: 'Cola 1L', price: 12000, image: IMG, _u: 1700000000123 });
  s['businesses/' + BID + '/products/p2'] = prod('p2', { name: 'Non', price: 5000, category: 'Non', stock: 3 });
  s['businesses/' + BID + '/products/p3'] = prod('p3', { name: 'Shakar', price: 14000, unit: 'kg', stock: 2.5 });
  s['businesses/' + BID + '/products/p4'] = prod('p4', { name: 'Maxfiy', botSell: false });
  s['businesses/' + BID + '/products/p5'] = prod('p5', { name: 'Boshqa filial', branchId: 'b2' });
  s['businesses/' + BID + '/products/p6'] = prod('p6', { name: 'Futbolka', price: 0, variants: [{ id: 'v1', name: 'S', price: 50000, stock: 1 }, { id: 'v2', name: 'M', price: 55000, stock: 0 }, { id: 'v3', name: 'Narxsiz', price: 0, stock: 5 }] });
  s['businesses/' + BID + '/products/p7'] = prod('p7', { name: 'Tugagan', stock: 0 });
  s['businesses/' + BID + '/products/p8'] = prod('p8', { name: 'O\'chirilgan', _deleted: true });
  return Object.assign(s, extra || {});
}
function mk(seedObj, opt) {
  shop.clearCatalogCache();
  const db = fakeDb(seedObj || seed()); const tg = fakeTg();
  const pushes = [];
  const messaging = { sendEach: async function (msgs) { pushes.push.apply(pushes, msgs); return { successCount: msgs.length, failureCount: 0, responses: msgs.map(() => ({ success: true })) }; } };
  let now = NOW;
  const deps = Object.assign({ db: db, tg: tg, key: KEY, webKey: WEBKEY, nowMs: function () { return now; }, botName: 'savdo_pos_bot', messaging: messaging }, opt || {});
  return { db, tg, deps, pushes, setNow: function (t) { now = t; } };
}
function initData(user, opt) {
  opt = opt || {};
  const p = new URLSearchParams();
  p.set('auth_date', String(Math.floor((opt.at || NOW) / 1000)));
  p.set('query_id', 'AAH' + user.id);
  p.set('user', JSON.stringify(Object.assign({ id: user.id, first_name: 'Ali', last_name: 'Valiyev', username: 'ali_v', language_code: 'uz' }, user)));
  p.set('signature', 'sigvalue');
  const pairs = []; p.forEach((v, k) => pairs.push(k + '=' + v)); pairs.sort();
  p.set('hash', crypto.createHmac('sha256', opt.key || WEBKEY).update(pairs.join('\n')).digest('hex'));
  return p.toString();
}
const ID1 = initData({ id: CUST }), ID2 = initData({ id: CUST2, first_name: 'Vali', username: 'vali' });
let cid = 0;
function order(deps, extra, id) {
  return shop.handleWebApp(deps, Object.assign({ initData: id || ID1, action: 'order', slug: 'sardor', clientId: 'client' + (++cid) + 'xyz', items: [{ id: 'p1', q: 2 }], mode: 'pickup', phone: '+998 90 123 45 67', pay: 'cash' }, extra || {}));
}
const ownerMsgs = (tg) => tg.sent.filter(m => String(m.chat_id) === OWNER_CHAT);
const custMsgs = (tg, c) => tg.sent.filter(m => String(m.chat_id) === String(c || CUST));

test('initData: to\'g\'ri imzo, soxta imzo, eskirgan, boshqa token', () => {
  const ok = shop.verifyInitData(WEBKEY, ID1, NOW);
  assert.equal(ok.user.id, String(CUST)); assert.equal(ok.user.username, 'ali_v');
  const bad = ID1.replace('Ali', 'Ola');
  assert.equal(shop.verifyInitData(WEBKEY, bad, NOW), null);
  assert.equal(shop.verifyInitData(WEBKEY, initData({ id: CUST }, { key: shop.webKeyFromToken('999:OTHER') }), NOW), null);
  assert.equal(shop.verifyInitData(WEBKEY, initData({ id: CUST }, { at: NOW - 25 * 3600000 }), NOW).expired, true);
  assert.equal(shop.verifyInitData(WEBKEY, '', NOW), null);
  assert.equal(shop.verifyInitData(WEBKEY, 'hash=zz&user=%7B%7D', NOW), null);
});

test('katalog: faqat "botda sotilsin", shu filial, narxi bor; variantlar; qoldiq', async () => {
  const { deps, db } = mk();
  const r = await shop.handleWebApp(deps, { initData: ID1, action: 'catalog', slug: 'sardor', lang: 'ru' });
  assert.equal(r.body.ok, true);
  const ids = r.body.items.map(x => x.id).sort();
  assert.deepEqual(ids, ['p1', 'p2', 'p3', 'p6', 'p7']);
  const p6 = r.body.items.find(x => x.id === 'p6');
  assert.deepEqual(p6.v.map(v => v.id), ['v1', 'v2']);
  assert.equal(p6.p, 50000); assert.equal(p6.v[1].s, 0);
  assert.equal(r.body.items.find(x => x.id === 'p7').s, 0);
  assert.equal(r.body.items.find(x => x.id === 'p3').f, 1);
  assert.equal(r.body.items.find(x => x.id === 'p2').m, 3);
  assert.ok(r.body.items.find(x => x.id === 'p1').i);
  assert.equal(r.body.items[r.body.items.length - 1].id, 'p7');   // tugaganlar oxirida
  assert.deepEqual(r.body.cats, ['Ichimlik', 'Non']);
  assert.equal(r.body.shop.name, 'Sardor Market'); assert.equal(r.body.shop.open, true); assert.equal(r.body.shop.fee, 15000);
  assert.equal(db.store['tgCust/' + CUST].lang, 'ru'); assert.equal(db.store['tgCust/' + CUST].lastShop, 'sardor');
});

test('katalog: o\'chirilgan do\'kon, noma\'lum havola, imzosiz so\'rov', async () => {
  const s = seed(); s['tgShop/' + BID].enabled = false;
  const a = mk(s);
  assert.equal((await shop.handleWebApp(a.deps, { initData: ID1, action: 'catalog', slug: 'sardor' })).body.code, 'closed');
  const b = mk();
  assert.equal((await shop.handleWebApp(b.deps, { initData: ID1, action: 'catalog', slug: 'yoq' })).body.code, 'closed');
  assert.equal((await shop.handleWebApp(b.deps, { initData: 'x', action: 'catalog', slug: 'sardor' })).status, 401);
  assert.equal((await shop.handleWebApp(Object.assign({}, b.deps, { webKey: null }), { initData: ID1, action: 'catalog', slug: 'sardor' })).body.code, 'not_configured');
});

test('buyurtma: narx serverdan, raqam, ilovaga (inbox), egaga va mijozga xabar, push', async () => {
  const { deps, db, tg, pushes } = mk();
  const r = await order(deps, { items: [{ id: 'p1', q: 2, price: 1 }, { id: 'p2', q: 1 }, { id: 'p1', q: 1 }], comment: 'Tezroq <b>', name: 'Ali aka' });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const o = db.store['tgOrders/' + r.body.order.id];
  assert.equal(o.no, 1); assert.equal(o.status, 'new');
  assert.equal(o.subtotal, 12000 * 3 + 5000); assert.equal(o.total, 41000); assert.equal(o.fee, 0);
  assert.deepEqual(o.items.map(x => [x.id, x.qty, x.price]), [['p1', 3, 12000], ['p2', 1, 5000]]);
  assert.equal(o.phone, '+998901234567'); assert.equal(o.phoneOk, false); assert.equal(o.name, 'Ali aka');
  const ib = db.store['businesses/' + BID + '/meta/botInbox'];
  assert.equal(ib.orders[o.id].no, 1); assert.equal(ib.orders[o.id].tgUser.id, undefined);
  assert.equal(db.store['tgShop/' + BID].seq, 1); assert.equal(db.store['tgShop/' + BID].slug, 'sardor');
  const c = db.store['tgCust/' + CUST];
  assert.equal(c.active[o.id], BID); assert.equal(c.recent.length, 1); assert.equal(c.phone, '+998901234567');
  const cm = custMsgs(tg)[0];
  assert.ok(/#1/.test(cm.text) && /41 000/.test(cm.text) && /Tezroq &lt;b&gt;/.test(cm.text));
  assert.equal(cm.reply_markup.inline_keyboard[0][0].callback_data, 'bo:c:' + o.id);
  assert.ok(cm.reply_markup.inline_keyboard[1][0].web_app.url.indexOf('?s=sardor') !== -1);
  const om = ownerMsgs(tg)[0];
  assert.ok(/Yangi buyurtma #1/.test(om.text) && /\+998901234567/.test(om.text) && /Ali aka/.test(om.text));
  assert.equal(pushes.length, 0);   // push tokeni yo'q
  const r2 = await order(deps);
  assert.equal(db.store['tgOrders/' + r2.body.order.id].no, 2);
});

test('buyurtma: push qurilmalarga boradi', async () => {
  const s = seed(); s['businesses/' + BID + '/pushTokens/tokA'] = { token: 'tokA', sound: true };
  const { deps, pushes } = mk(s);
  await order(deps);
  assert.equal(pushes.length, 1); assert.equal(pushes[0].data.type, 'botOrder'); assert.ok(/#1/.test(pushes[0].notification.title));
});

test('buyurtma: bir xil clientId ikki marta — bitta buyurtma', async () => {
  const { deps, db, tg } = mk();
  const body = { initData: ID1, action: 'order', slug: 'sardor', clientId: 'same-client-1', items: [{ id: 'p1', q: 1 }], mode: 'pickup', phone: '901234567' };
  const a = await shop.handleWebApp(deps, body), b = await shop.handleWebApp(deps, body);
  assert.equal(a.body.order.id, b.body.order.id); assert.equal(b.body.again, true);
  assert.equal(Object.keys(db.store).filter(k => k.indexOf('tgOrders/') === 0).length, 1);
  assert.equal(ownerMsgs(tg).length, 1);
});

test('buyurtma: tekshiruvlar (qoldiq, kg, variant, yashirin, minimal, manzil, telefon)', async () => {
  const { deps } = mk();
  const code = async (x, id) => (await order(deps, x, id)).body.code;
  assert.equal(await code({ items: [{ id: 'p2', q: 4 }] }), 'out_of_stock');
  assert.equal(await code({ items: [{ id: 'p7', q: 1 }] }), 'out_of_stock');
  assert.equal(await code({ items: [{ id: 'p4', q: 1 }] }), 'changed');
  assert.equal(await code({ items: [{ id: 'p5', q: 1 }] }), 'changed');
  assert.equal(await code({ items: [{ id: 'p6', q: 1 }] }), 'changed');
  assert.equal(await code({ items: [{ id: 'p6', v: 'v2', q: 1 }] }), 'out_of_stock');
  assert.equal(await code({ items: [{ id: 'p6', v: 'v3', q: 1 }] }), 'changed');
  assert.equal(await code({ items: [{ id: 'p1', v: 'v1', q: 1 }] }), 'changed');
  assert.equal(await code({ items: [{ id: 'p1', q: 0 }] }), 'bad_qty');
  assert.equal(await code({ items: [{ id: 'p1', q: -2 }] }), 'bad_qty');
  assert.equal(await code({ items: [{ id: 'p1', q: 'abc' }] }), 'bad_qty');
  assert.equal(await code({ items: [] }), 'empty');
  assert.equal(await code({ mode: 'delivery', address: '' }), 'need_address');
  assert.equal(await code({ phone: '' }), 'need_phone');
  assert.equal(await code({ phone: '12' }), 'need_phone');
  assert.equal(await code({ clientId: 'x' }), 'bad_request');
  const ok = await order(deps, { items: [{ id: 'p3', q: 1.25 }, { id: 'p6', v: 'v1', q: 1 }, { id: 'p2', q: 2.6 }] });
  assert.equal(ok.body.ok, true, JSON.stringify(ok.body));
  const o = ok.body.order;
  assert.deepEqual(o.items.map(x => x.qty), [1.25, 1, 3]);
  assert.equal(o.total, Math.round(14000 * 1.25) + 50000 + 15000);
});

test('buyurtma: yetkazib berish narxi va bepul chegarasi, minimal summa', async () => {
  const s = seed(); s['tgShop/' + BID].minOrder = 20000;
  const { deps } = mk(s);
  assert.equal((await order(deps, { items: [{ id: 'p2', q: 1 }] })).body.code, 'min_order');
  const a = await order(deps, { mode: 'delivery', address: 'Yunusobod 7-25', loc: { lat: 41.3, lng: 69.28 } });
  assert.equal(a.body.order.total, 24000 + 15000);
  const s2 = seed(); s2['businesses/' + BID + '/products/p1'].stock = 100;
  const b = mk(s2);
  const r = await order(b.deps, { items: [{ id: 'p1', q: 20 }], mode: 'delivery', address: 'Yunusobod' });
  assert.equal(r.body.order.total, 240000);   // 200 000 dan oshdi — bepul
  const st = b.db.store['tgOrders/' + r.body.order.id];
  assert.equal(st.fee, 0); assert.equal(st.loc, null);
  const s3 = seed(); s3['tgShop/' + BID].delivery = false;
  assert.equal((await order(mk(s3).deps, { mode: 'delivery', address: 'x y z' })).body.code, 'no_delivery');
});

test('buyurtma: pauza, ish vaqti, soatlik cheklov, faol buyurtmalar cheklovi', async () => {
  const s = seed(); s['tgShop/' + BID].paused = true;
  assert.equal((await order(mk(s).deps)).body.code, 'paused');
  const s2 = seed(); s2['tgShop/' + BID].hours = { on: true, from: '18:00', to: '23:00' };
  const h = mk(s2);
  assert.equal((await order(h.deps)).body.code, 'closed_hours');
  const cat = await shop.handleWebApp(h.deps, { initData: ID1, action: 'catalog', slug: 'sardor' });
  assert.equal(cat.body.shop.open, false);
  const s3 = seed(); s3['tgShop/' + BID].hours = { on: true, from: '22:00', to: '15:00' };   // tunda ham ishlaydi
  assert.equal((await order(mk(s3).deps)).body.ok, true);
  const { deps } = mk();
  for (let i = 0; i < shop.MAX_ACTIVE_PER_CUST; i++) assert.equal((await order(deps)).body.ok, true);
  assert.equal((await order(deps)).body.code, 'too_many_active');
  assert.equal((await order(deps, {}, ID2)).body.ok, true);   // boshqa mijoz — mumkin
});

test('soatlik cheklov: 6 tadan keyin', async () => {
  const { deps, db } = mk();
  db.store['tgCust/' + CUST] = { times: [NOW - 1000, NOW - 2000, NOW - 3000, NOW - 4000, NOW - 5000, NOW - 6000] };
  assert.equal((await order(deps)).body.code, 'too_many');
  db.store['tgCust/' + CUST].times = [NOW - 2 * 3600000];
  assert.equal((await order(deps)).body.ok, true);
});

test('ilova: holatlar — qabul (vaqt bilan), tayyor, sotildi; mijozga xabarlar; noto\'g\'ri o\'tish', async () => {
  const { deps, db, tg } = mk();
  const oid = (await order(deps)).body.order.id;
  const owner = { bid: BID, owner: true }, staff = { bid: BID, owner: false };
  let r = await shop.handleAppApi(deps, staff, 'staffUid', 'boSet', { oid: oid, to: 'ready' });
  assert.equal(r.body.code, 'bad_state');
  r = await shop.handleAppApi(deps, staff, 'staffUid', 'boSet', { oid: oid, to: 'accepted', eta: 30, by: 'Kassir Ali' });
  assert.equal(r.body.ok, true); assert.equal(r.body.order.status, 'accepted'); assert.equal(r.body.order.eta, 30);
  assert.ok(/qabul qilindi/.test(custMsgs(tg).pop().text));
  assert.ok(/30 daqiqada/.test(tg.sent[tg.sent.length - 1].text));
  r = await shop.handleAppApi(deps, staff, 'staffUid', 'boSet', { oid: oid, to: 'accepted' });
  assert.equal(r.body.same, true);
  r = await shop.handleAppApi(deps, owner, BID, 'boSet', { oid: oid, to: 'ready' });
  assert.ok(/tayyor/.test(custMsgs(tg).pop().text) && /Chilonzor 5/.test(tg.sent[tg.sent.length - 1].text));
  r = await shop.handleAppApi(deps, owner, BID, 'boSet', { oid: oid, to: 'done', saleId: 'sale123', saleNo: '0042' });
  assert.equal(r.body.order.saleId, 'sale123');
  assert.ok(/yakunlandi/.test(custMsgs(tg).pop().text) && /24 000/.test(tg.sent[tg.sent.length - 1].text));
  assert.equal(db.store['tgCust/' + CUST].active[oid], undefined);
  assert.equal(db.store['businesses/' + BID + '/meta/botInbox'].orders[oid].status, 'done');
  assert.deepEqual(db.store['tgOrders/' + oid].history.map(h => h.s), ['new', 'accepted', 'ready', 'done']);
  r = await shop.handleAppApi(deps, owner, BID, 'boSet', { oid: oid, to: 'rejected' });
  assert.equal(r.body.code, 'bad_state');
  r = await shop.handleAppApi(deps, owner, BID, 'boSet', { oid: 'bo' + 'a'.repeat(22), to: 'accepted' });
  assert.equal(r.status, 404);
  r = await shop.handleAppApi(deps, { bid: BID2, owner: true }, BID2, 'boSet', { oid: oid, to: 'accepted' });
  assert.equal(r.status, 404);   // boshqa do'kon tega olmaydi
});

test('ilova: rad etish sababi bilan; to\'g\'ridan-to\'g\'ri sotish (yangi → sotildi)', async () => {
  const { deps, tg, db } = mk();
  const a = (await order(deps)).body.order.id, b = (await order(deps)).body.order.id;
  await shop.handleAppApi(deps, { bid: BID, owner: false }, 'u', 'boSet', { oid: a, to: 'rejected', reason: 'Mahsulot tugadi' });
  const m = custMsgs(tg).pop();
  assert.ok(/bekor qilindi/.test(m.text) && /Mahsulot tugadi/.test(m.text));
  const r = await shop.handleAppApi(deps, { bid: BID, owner: false }, 'u', 'boSet', { oid: b, to: 'done', saleId: 's1' });
  assert.equal(r.body.order.status, 'done');
  assert.deepEqual(db.store['tgCust/' + CUST].active, {});
});

test('mijoz: bekor qilish (mini ilova va chatdagi tugma), qabul qilingandan keyin — mumkin emas', async () => {
  const { deps, db, tg } = mk();
  const a = (await order(deps)).body.order.id;
  let r = await shop.handleWebApp(deps, { initData: ID2, action: 'cancel', slug: 'sardor', oid: a });
  assert.equal(r.status, 404);   // boshqa mijoz
  r = await shop.handleWebApp(deps, { initData: ID1, action: 'cancel', slug: 'sardor', oid: a });
  assert.equal(r.body.order.status, 'cancelled');
  assert.ok(ownerMsgs(tg).some(x => /bekor qildi/.test(x.text)));
  const b = (await order(deps)).body.order.id;
  await shop.handleAppApi(deps, { bid: BID, owner: true }, BID, 'boSet', { oid: b, to: 'accepted' });
  const cq = { callback_query: { id: 'cq1', data: 'bo:c:' + b, from: { id: CUST, language_code: 'uz' }, message: { message_id: 5, chat: { id: CUST, type: 'private' } } } };
  let out = await core.handleUpdate(deps, cq);
  assert.equal(out.cb, 'late');
  const ans = tg.calls.filter(c => c.method === 'answerCallbackQuery').pop();
  assert.ok(ans.params.show_alert && /qabul qilgan/.test(ans.params.text) && /\+998901112233/.test(ans.params.text));
  const c = (await order(deps)).body.order.id;
  out = await core.handleUpdate(deps, Object.assign({}, cq, { callback_query: Object.assign({}, cq.callback_query, { data: 'bo:c:' + c }) }));
  assert.equal(out.cb, 'cancelled');
  assert.equal(db.store['tgOrders/' + c].status, 'cancelled');
  assert.ok(tg.calls.some(x => x.method === 'editMessageReplyMarkup'));
  out = await core.handleUpdate(deps, Object.assign({}, cq, { callback_query: Object.assign({}, cq.callback_query, { data: 'bo:c:' + c, from: { id: CUST2 } }) }));
  assert.equal(out.cb, 'not_found');
  const list = await shop.handleWebApp(deps, { initData: ID1, action: 'orders', slug: 'sardor' });
  assert.deepEqual(list.body.orders.map(x => x.status), ['cancelled', 'accepted', 'cancelled']);
});

test('bot: /start s_<havola> — tugma va menyu tugmasi; o\'chiq do\'kon; raqam yuborish; oddiy matn', async () => {
  const { deps, db, tg } = mk();
  const m = (text, extra) => ({ message: Object.assign({ message_id: 1, chat: { id: CUST, type: 'private' }, from: { id: CUST, language_code: 'ru', username: 'ali_v' }, text: text }, extra || {}) });
  let out = await core.handleUpdate(deps, m('/start s_sardor'));
  assert.equal(out.shopStart, 'sardor');
  const sm = tg.sent.pop();
  assert.ok(/Sardor Market/.test(sm.text) && /заказ/.test(sm.text));
  assert.ok(sm.reply_markup.inline_keyboard[0][0].web_app.url.endsWith('?s=sardor'));
  const mb = tg.calls.find(c => c.method === 'setChatMenuButton');
  assert.equal(mb.params.menu_button.type, 'web_app');
  assert.equal(db.store['tgCust/' + CUST].lastShop, 'sardor');
  out = await core.handleUpdate(deps, m('/start s_yoq'));
  assert.equal(out.shopStart, 'off');
  out = await core.handleUpdate(deps, m('', { contact: { user_id: CUST, phone_number: '998901234567', first_name: 'Ali' } }));
  assert.equal(out.contact, 'saved');
  assert.equal(db.store['tgCust/' + CUST].phone, '+998901234567'); assert.equal(db.store['tgCust/' + CUST].phoneOk, true);
  out = await core.handleUpdate(deps, m('', { contact: { user_id: 123, phone_number: '998907777777' } }));
  assert.equal(out.contact, 'foreign');
  assert.equal(db.store['tgCust/' + CUST].phone, '+998901234567');
  out = await core.handleUpdate(deps, m('salom'));
  assert.ok(out.kb && out.kb.inline_keyboard[0][0].web_app);
  out = await core.handleUpdate(deps, m('/start'));
  assert.equal(out.custStart, 'back'); { const lm = tg.sent[tg.sent.length - 1]; assert.ok(lm.reply_markup.keyboard[0][0].web_app && /s=/.test(lm.reply_markup.keyboard[1][0].web_app.url)); }   /* fix183-custeasy: doimiy klaviatura (sahifa + do'kon) */
  // ega kodi bilan ulanish avvalgidek ishlaydi (s_ bilan boshlanmaydi)
  out = await core.handleUpdate(deps, m('/start ABCDEFGHJK'));
  assert.ok(out && out.reply && !out.shopStart);
});

test('tasdiqlangan raqam buyurtmada ishlatiladi; qo\'lda boshqa raqam yozilsa — tasdiqlanmagan', async () => {
  const { deps, db } = mk();
  db.store['tgCust/' + CUST] = { phone: '+998901234567', phoneOk: true };
  let r = await order(deps, { phone: '' });
  assert.equal(db.store['tgOrders/' + r.body.order.id].phoneOk, true);
  r = await order(deps, { phone: '+998 93 000 00 00' });
  const o = db.store['tgOrders/' + r.body.order.id];
  assert.equal(o.phone, '+998930000000'); assert.equal(o.phoneOk, false);
  assert.equal(db.store['tgCust/' + CUST].phone, '+998930000000');
});

test('ilova API: sozlama — faqat ega, havola band bo\'lsa rad, havola o\'zgarsa eskisi bo\'shaydi', async () => {
  const s = seed(); s['publicShops/zaynab'] = { ownerUid: BID2, businessId: BID2 }; s['tgSlug/band'] = { bid: BID2 };
  const { deps, db } = mk(s);
  const owner = { bid: BID, owner: true };
  let r = await shop.handleAppApi(deps, { bid: BID, owner: false }, 'st', 'boSave', { cfg: { slug: 'yangi' } });
  assert.equal(r.status, 403);
  r = await shop.handleAppApi(deps, owner, BID, 'boSave', { cfg: { slug: 'zaynab', enabled: true } });
  assert.equal(r.body.code, 'slug_taken');
  r = await shop.handleAppApi(deps, owner, BID, 'boSave', { cfg: { slug: 'band', enabled: true } });
  assert.equal(r.body.code, 'slug_taken');
  r = await shop.handleAppApi(deps, owner, BID, 'boSave', { cfg: { slug: 'A b' } });
  assert.equal(r.body.code, 'bad_slug');
  r = await shop.handleAppApi(deps, owner, BID, 'boSave', { cfg: { slug: 'sardor-market', enabled: true, pickup: false, delivery: false, fee: -5, note: 'x'.repeat(500), hours: { on: true, from: '09:00', to: '25:00' }, tz: 'Mars/Base' } });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.link, 'https://t.me/savdo_pos_bot?start=s_sardor-market');
  assert.equal(r.body.cfg.pickup, true); assert.equal(r.body.cfg.fee, 0); assert.equal(r.body.cfg.note.length, 300);
  assert.equal(r.body.cfg.hours.on, false); assert.equal(r.body.cfg.tz, 'Asia/Tashkent');
  assert.equal(db.store['tgSlug/sardor'], undefined); assert.equal(db.store['tgSlug/sardor-market'].bid, BID);
  assert.equal(db.store['tgShop/' + BID].seq, 0);
  r = await shop.handleAppApi(deps, { bid: BID, owner: false }, 'st', 'boCfg', {});
  assert.equal(r.body.cfg.slug, 'sardor-market'); assert.equal(r.body.owner, false);
  r = await shop.handleAppApi(deps, { bid: BID, owner: false }, 'st', 'boPause', { paused: true });
  assert.equal(r.body.cfg.paused, true); assert.equal(db.store['tgShop/' + BID].slug, 'sardor-market');
  const pub = s['publicShops/zaynab'];
  db.store['publicShops/sardor-market'] = { ownerUid: BID, businessId: BID };   // o'z onlayn katalogi bilan bir xil nom — mumkin
  r = await shop.handleAppApi(deps, owner, BID, 'boSave', { cfg: { slug: 'sardor-market', enabled: true } });
  assert.equal(r.body.ok, true); assert.ok(pub);
});

test('core.handleApi orqali: xodim ham buyurtmalarni ko\'radi va o\'zgartiradi, sozlamani esa saqlay olmaydi', async () => {
  const s = seed(); s['staffAuth/staff1'] = { businessId: BID };
  const { deps } = mk(s);
  const oid = (await order(deps)).body.order.id;
  let r = await core.handleApi(deps, 'staff1', { action: 'boList' });
  assert.equal(r.body.orders[oid].status, 'new');
  r = await core.handleApi(deps, 'staff1', { action: 'boSet', oid: oid, to: 'accepted' });
  assert.equal(r.body.ok, true);
  r = await core.handleApi(deps, 'staff1', { action: 'boSave', cfg: { slug: 'abc' } });
  assert.equal(r.status, 403);
  r = await core.handleApi(deps, 'staff1', { action: 'link' });
  assert.equal(r.body.code, 'owner_only');   // avvalgi qoida o'zgarmadi
});

test('inbox: yopilganlar 48 soatdan keyin va 200 tadan oshsa tushib qoladi, faollar qoladi', () => {
  const o = {};
  for (let i = 0; i < 230; i++) o['k' + i] = { status: i < 20 ? 'new' : 'done', updatedAt: NOW - i * 1000 };
  o.old = { status: 'rejected', updatedAt: NOW - 49 * 3600000 };
  o.oldActive = { status: 'accepted', updatedAt: NOW - 100 * 3600000 };
  const p = shop.pruneInbox(o, NOW);
  assert.equal(Object.keys(p).length, 200);
  assert.ok(p.oldActive && !p.old && p.k0 && p.k19 && p.k20 && !p.k229);
});

test('rasm: faqat bot katalogidagi mahsulot', async () => {
  const { deps } = mk();
  const im = await shop.productImage(deps, 'sardor', 'p1');
  assert.equal(im.type, 'image/png'); assert.equal(im.buf.toString(), 'PNGDATA');
  assert.equal(await shop.productImage(deps, 'sardor', 'p4'), null);
  assert.equal(await shop.productImage(deps, 'sardor', 'p2'), null);
  assert.equal(await shop.productImage(deps, 'yoq', 'p1'), null);
});

test('tozalash: 90 kundan eski buyurtmalar o\'chadi', async () => {
  const { deps, db } = mk();
  db.store['tgOrders/old1'] = { createdAt: NOW - 91 * 86400000 };
  db.store['tgOrders/new1'] = { createdAt: NOW - 5 * 86400000 };
  assert.equal(await shop.cleanupOld(deps), 1);
  assert.ok(!db.store['tgOrders/old1'] && db.store['tgOrders/new1']);
});

test('egaga xabar: notifyTg o\'chiq bo\'lsa Telegram\'ga yozilmaydi; mijoz xabari bormasa ham buyurtma saqlanadi', async () => {
  const s = seed(); s['tgShop/' + BID].notifyTg = false;
  const { deps, tg, db } = mk(s);
  tg.fail[String(CUST)] = { tgCode: 403, desc: 'Forbidden: bot was blocked by the user' };
  const r = await order(deps);
  assert.equal(r.body.ok, true);
  assert.equal(ownerMsgs(tg).length, 0);
  assert.ok(db.store['tgOrders/' + r.body.order.id]);
});

test('ish vaqti: vaqt mintaqasi bo\'yicha', () => {
  const c = shop.normCfg({ hours: { on: true, from: '09:00', to: '18:00' }, tz: 'Asia/Tashkent' });
  assert.equal(shop.isOpen(c, Date.UTC(2026, 9, 19, 3, 59)), false);   // 08:59
  assert.equal(shop.isOpen(c, Date.UTC(2026, 9, 19, 4, 0)), true);     // 09:00
  assert.equal(shop.isOpen(c, Date.UTC(2026, 9, 19, 13, 0)), false);   // 18:00
  assert.equal(shop.normPhone('90 123 45 67'), '+998901234567');
  assert.equal(shop.normPhone('+7 701 123 4567'), '+77011234567');
  assert.equal(shop.normPhone('123'), '');
});

test('hisob o\'chirilganda: boWipe — sozlama, havola, inbox va buyurtmalar o\'chadi (faqat ega)', async () => {
  const { deps, db } = mk();
  await order(deps); await order(deps);
  db.store['tgOrders/other'] = { bid: BID2, createdAt: NOW };
  let r = await shop.handleAppApi(deps, { bid: BID, owner: false }, 'st', 'boWipe', {});
  assert.equal(r.status, 403);
  r = await shop.handleAppApi(deps, { bid: BID, owner: true }, BID, 'boWipe', {});
  assert.equal(r.body.deleted, 2);
  assert.ok(!db.store['tgShop/' + BID] && !db.store['tgSlug/sardor'] && !db.store['businesses/' + BID + '/meta/botInbox'] && db.store['tgOrders/other']);
});

test('inbox: hajmi 600 KB dan oshsa eski yopilganlar tushib qoladi', () => {
  const big = 'x'.repeat(5000), o = {};
  for (let i = 0; i < 150; i++) o['d' + i] = { status: 'done', updatedAt: NOW - i * 1000, comment: big };
  for (let i = 0; i < 20; i++) o['a' + i] = { status: 'new', updatedAt: NOW - 1e9, comment: big };
  const p = shop.pruneInbox(o, NOW);
  assert.ok(JSON.stringify(p).length <= shop.INBOX_MAX_BYTES);
  assert.ok(p.a19 && p.a0 && p.d0 && !p.d149);
});

/* ---------- fix146-tgsub: egasining mini ilovasi — obuna tariflari ---------- */
function subSeed(extra) {
  const s = seed(extra);
  s['tgChats/' + CUST] = { bids: [BID], lang: 'uz' };
  s['tgBiz/' + BID].chats[String(CUST)] = { name: 'Ega', at: 2, sig: core.sigOf(KEY, BID, String(CUST)) };
  s['businesses/' + BID].subscriptionExpiresAtMs = NOW + 3 * 86400000;
  return s;
}
test('obuna katalogi: ulangan ega do\'konlari, muddat, tariflar; ulanmagan — bo\'sh', async () => {
  const { deps } = mk(subSeed(), { payToken: 'PROV:LIVE:x', genId: () => 'ordSub1abc' });
  let r = await shop.handleWebApp(deps, { initData: ID1, action: 'subInfo' });
  assert.equal(r.body.linked, true); assert.equal(r.body.payOn, true);
  assert.equal(r.body.shops.length, 1); assert.equal(r.body.shops[0].name, 'Sardor Market'); assert.equal(r.body.shops[0].active, true);
  assert.equal(r.body.shops[0].slug, 'sardor'); assert.ok(r.body.shops[0].link.endsWith('start=s_sardor'));
  assert.deepEqual(r.body.plans.map(p => p.k), ['m', 's', 'y']);
  r = await shop.handleWebApp(deps, { initData: ID2, action: 'subInfo' });
  assert.equal(r.body.linked, false); assert.equal(r.body.shops.length, 0);
  // soxta (imzosiz) ulanish hisobga olinmaydi
  const s2 = subSeed(); s2['tgBiz/' + BID].chats[String(CUST)].sig = 'bad';
  r = await shop.handleWebApp(mk(s2, { payToken: 'P:LIVE:x' }).deps, { initData: ID1, action: 'subInfo' });
  assert.equal(r.body.linked, false);
});
test('obuna katalogi: to\'lash — serverdagi narx bilan hisob havolasi, buyurtma qayta ishlatiladi; begona do\'kon, o\'chiq to\'lov', async () => {
  let n = 0;
  const { deps, db, tg } = mk(subSeed(), { payToken: 'PROV:LIVE:x', genId: () => 'ordSub' + (++n) + 'abc' });
  tg.calls.length = 0;
  const realTg = deps.tg; deps.tg = async function (m, p) { if (m === 'createInvoiceLink') { tg.calls.push({ method: m, params: p }); return 'https://t.me/$inv' + n; } return realTg(m, p); };
  const h = require('../src/telegram/pay').bidHash(BID);
  let r = await shop.handleWebApp(deps, { initData: ID1, action: 'subPay', h: h, k: 's' });
  assert.equal(r.body.ok, true); assert.ok(r.body.link.startsWith('https://t.me/'));
  const inv = tg.calls.find(c => c.method === 'createInvoiceLink').params;
  const { PLANS } = require('../src/domain/plans');
  assert.equal(inv.prices[0].amount, PLANS.sixmonth.price * 100); assert.equal(inv.currency, 'UZS'); assert.equal(inv.provider_token, 'PROV:LIVE:x');
  const o = db.store['paymentOrders/' + inv.payload];
  assert.equal(o.businessId, BID); assert.equal(o.plan, 'sixmonth'); assert.equal(o.status, 'PENDING'); assert.equal(o.chatId, String(CUST));
  r = await shop.handleWebApp(deps, { initData: ID1, action: 'subPay', h: h, k: 's' });
  assert.equal(r.body.order, inv.payload);   // 30 daqiqa ichida — o'sha buyurtma
  r = await shop.handleWebApp(deps, { initData: ID2, action: 'subPay', h: h, k: 's' });
  assert.equal(r.body.code, 'not_linked');
  r = await shop.handleWebApp(deps, { initData: ID1, action: 'subPay', h: h, k: 'z' });
  assert.equal(r.body.code, 'bad_plan');
  r = await shop.handleWebApp(Object.assign({}, deps, { payToken: '' }), { initData: ID1, action: 'subPay', h: h, k: 'm' });
  assert.equal(r.body.code, 'pay_off');
  // to'lovdan oldingi tekshiruv va to'lov — avvalgi oqim bilan bir xil
  const pay = require('../src/telegram/pay');
  const pc = await pay.onPreCheckout(deps, { id: 'q1', invoice_payload: inv.payload, currency: 'UZS', total_amount: PLANS.sixmonth.price * 100 }, 'uz');
  assert.equal(pc.ok, true);
});
test('egasi: /yordam va /obuna da pastki chap tugma — buyruqlar menyusi (fix152); mijoz oddiy matn yozsa — do\'kon tugmasi', async () => {
  const { deps, tg } = mk(subSeed(), { payToken: 'PROV:LIVE:x' });
  const m = (text) => ({ message: { message_id: 1, chat: { id: CUST, type: 'private' }, from: { id: CUST, language_code: 'uz' }, text: text } });
  await core.handleUpdate(deps, m('/yordam'));
  assert.ok(tg.calls.some(c => c.method === 'setChatMenuButton' && c.params.menu_button.type === 'commands'));
  tg.calls.length = 0;
  await core.handleUpdate(deps, m('/obuna'));
  assert.ok(tg.calls.some(c => c.method === 'setChatMenuButton' && c.params.menu_button.type === 'commands'));
  assert.ok(!tg.calls.some(c => c.method === 'setChatMenuButton' && c.params.menu_button.type === 'web_app'));
  const last = tg.sent[tg.sent.length - 1];
  assert.ok(last.reply_markup.inline_keyboard.pop()[0].web_app.url.endsWith('?v=me'));
  const c = mk();
  await core.handleUpdate(c.deps, { message: { message_id: 1, chat: { id: CUST2, type: 'private' }, from: { id: CUST2, language_code: 'uz' }, text: '/start s_sardor' } });
  c.tg.calls.length = 0;
  await core.handleUpdate(c.deps, { message: { message_id: 2, chat: { id: CUST2, type: 'private' }, from: { id: CUST2, language_code: 'uz' }, text: 'salom' } });
  assert.ok(c.tg.calls.some(x => x.method === 'setChatMenuButton' && x.params.menu_button.web_app.url.endsWith('?s=sardor')));
});

test('fix148-reserve: faol buyurtmadagi miqdor band — boshqa mijoz ololmaydi; rad etilsa bo\'shaydi; variant ham', async () => {
  const { deps } = mk();
  const a = await order(deps, { items: [{ id: 'p2', q: 2 }, { id: 'p6', v: 'v1', q: 1 }] });
  assert.equal(a.body.ok, true);
  let cat = await shop.handleWebApp(deps, { initData: ID2, action: 'catalog', slug: 'sardor' });
  const p2 = cat.body.items.find(x => x.id === 'p2'), p6 = cat.body.items.find(x => x.id === 'p6');
  assert.equal(p2.m, 1); assert.equal(p6.v.find(v => v.id === 'v1').s, 0); assert.equal(p6.s, 0);
  assert.equal((await order(deps, { items: [{ id: 'p2', q: 2 }] }, ID2)).body.code, 'out_of_stock');
  assert.equal((await order(deps, { items: [{ id: 'p2', q: 1 }] }, ID2)).body.ok, true);
  assert.equal((await order(deps, { items: [{ id: 'p2', q: 1 }] }, ID2)).body.code, 'out_of_stock');
  await shop.handleAppApi(deps, { bid: BID, owner: true }, BID, 'boSet', { oid: a.body.order.id, to: 'rejected', reason: 'x' });
  cat = await shop.handleWebApp(deps, { initData: ID2, action: 'catalog', slug: 'sardor' });
  assert.equal(cat.body.items.find(x => x.id === 'p2').m, 2);
  assert.equal(cat.body.items.find(x => x.id === 'p6').v.find(v => v.id === 'v1').s, 1);
});
test('fix148-reserve: boshqa filial buyurtmasi va yakunlangan buyurtma band qilmaydi', () => {
  const r = shop.reservedFrom({ a: { status: 'accepted', branchId: 'main', items: [{ id: 'p1', qty: 2 }] }, b: { status: 'done', branchId: 'main', items: [{ id: 'p1', qty: 5 }] }, c: { status: 'new', branchId: 'b2', items: [{ id: 'p1', qty: 7 }] }, d: { status: 'new', items: [{ id: 'p1', v: 'v1', qty: 1.5 }] } }, 'main');
  assert.deepEqual(r, { 'p1|': 2, 'p1|v1': 1.5 });
});

test('fix149-cents: dollarda narx, yetkazish va jami tiyin bilan; so\'mda butun son', async () => {
  const sd = seed();
  sd['businesses/' + BID].currency = 'USD';
  sd['tgShop/' + BID] = Object.assign({}, sd['tgShop/' + BID], { fee: 1.5, freeFrom: 50, minOrder: 2.25 });
  sd['businesses/' + BID + '/products/p1'] = prod('p1', { name: 'Cola 1L', price: 1.99 });
  sd['businesses/' + BID + '/products/p3'] = prod('p3', { name: 'Shakar', price: 1.333, unit: 'kg', stock: 2.5 });
  sd['businesses/' + BID + '/products/p6'] = prod('p6', { name: 'Futbolka', price: 0, variants: [{ id: 'v1', name: 'S', price: 0.004, stock: 1 }, { id: 'v2', name: 'M', price: 12.5, stock: 3 }] });
  const { deps, db, tg } = mk(sd);
  const c = await shop.handleWebApp(deps, { initData: ID1, action: 'catalog', slug: 'sardor' });
  assert.equal(c.body.items.find(x => x.id === 'p1').p, 1.99);
  assert.equal(c.body.items.find(x => x.id === 'p3').p, 1.33);
  assert.deepEqual(c.body.items.find(x => x.id === 'p6').v.map(v => v.id), ['v2']);   // 0.004$ — narxsiz hisoblanadi
  assert.equal(c.body.shop.fee, 1.5); assert.equal(c.body.shop.minOrder, 2.25); assert.equal(c.body.shop.cur, 'USD');
  const small = await order(deps, { items: [{ id: 'p1', q: 1 }] });
  assert.equal(small.body.code, 'min_order'); assert.equal(small.body.min, 2.25);
  const r = await order(deps, { items: [{ id: 'p1', q: 3 }, { id: 'p3', q: 1.25 }, { id: 'p6', v: 'v2', q: 1 }], mode: 'delivery', address: 'Chilonzor 1' });
  assert.equal(r.body.ok, true, JSON.stringify(r.body));
  const o = db.store['tgOrders/' + r.body.order.id];
  assert.deepEqual(o.items.map(x => x.sum), [5.97, 1.66, 12.5]);
  assert.equal(o.subtotal, 20.13); assert.equal(o.fee, 1.5); assert.equal(o.total, 21.63);
  const txt = ownerMsgs(tg).map(m => m.text).join('\n');
  assert.ok(txt.indexOf('$21.63') !== -1 && txt.indexOf('$5.97') !== -1, txt);
  const { deps: d2, db: db2 } = mk(seed({ ['businesses/' + BID + '/products/p3']: prod('p3', { name: 'Shakar', price: 14000.4, unit: 'kg', stock: 2.5 }) }));
  const r2 = await order(d2, { items: [{ id: 'p3', q: 1.25 }] });
  const o2 = db2.store['tgOrders/' + r2.body.order.id];
  assert.equal(o2.items[0].price, 14000); assert.equal(o2.items[0].sum, 17500); assert.equal(o2.total, 17500);   // so'mda avvalgidek butun
});

/* ---------- fix153-boplus ---------- */
const app = (deps, action, body) => shop.handleAppApi(deps, { bid: BID, owner: true }, BID, action, body);
test('fix153: hamma mahsulot botda — o\'chirilgani (botSell=false) ko\'rinmaydi, belgilanmagani ko\'rinadi', async () => {
  const sd = seed();
  sd['tgShop/' + BID] = Object.assign({}, sd['tgShop/' + BID], { allProducts: true });
  sd['businesses/' + BID + '/products/p9'] = { id: 'p9', name: 'Belgisiz', price: 3000, stock: 5, unit: 'dona' };
  sd['businesses/' + BID + '/products/p4'].botSell = false;
  const { deps } = mk(sd);
  const r = await shop.handleWebApp(deps, { initData: ID1, action: 'catalog', slug: 'sardor' });
  const ids = r.body.items.map(x => x.id);
  assert.ok(ids.includes('p9') && !ids.includes('p4') && ids.includes('p1'), ids.join(','));
  const { deps: d2 } = mk();
  const r2 = await shop.handleWebApp(d2, { initData: ID1, action: 'catalog', slug: 'sardor' });
  assert.ok(!r2.body.items.some(x => x.id === 'p9'), 'o\'chiq bo\'lsa avvalgidek');
});

test('fix153: avtomatik qabul — mijozga "qabul qilindi", egaga "avtomatik qabul" matni, bekor tugmasi yo\'q', async () => {
  const sd = seed();
  sd['tgShop/' + BID] = Object.assign({}, sd['tgShop/' + BID], { autoAccept: true, autoEta: 20 });
  const { deps, db, tg } = mk(sd);
  const r = await order(deps);
  assert.equal(r.body.order.status, 'accepted');
  const o = db.store['tgOrders/' + r.body.order.id];
  assert.equal(o.status, 'accepted'); assert.equal(o.eta, 20); assert.equal(o.auto, true);
  assert.equal(db.store['businesses/' + BID + '/meta/botInbox'].orders[o.id].auto, true);
  const cm = custMsgs(tg);
  assert.ok(!JSON.stringify(cm[0].reply_markup || {}).includes('bo:c:'), 'bekor tugmasi yo\'q');
  assert.ok(cm.some(m => /qabul qilindi/.test(m.text) && /20 daqiqada/.test(m.text)));
  assert.ok(ownerMsgs(tg).some(m => /Avtomatik qabul/.test(m.text)));
  const st = await app(deps, 'boCfg', {});
  assert.equal(st.body.cfg.autoAccept, true); assert.equal(st.body.cfg.autoEta, 20);
});

test('fix153: tahrirlash — miqdor o\'zgaradi, qator olib tashlanadi, jami qayta hisoblanadi, mijozga xabar; qoldiq band qilish ham yangilanadi', async () => {
  const { deps, db, tg } = mk();
  const r = await order(deps, { items: [{ id: 'p1', q: 3 }, { id: 'p2', q: 2 }] });
  const oid = r.body.order.id;
  const e = await app(deps, 'boEdit', { oid: oid, items: [{ id: 'p1', q: 1 }, { id: 'p2', q: 0 }] });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  const o = db.store['tgOrders/' + oid];
  assert.equal(o.items.length, 1); assert.equal(o.items[0].qty, 1); assert.equal(o.total, 12000);
  assert.ok(o.history.some(h => h.s === 'edited')); assert.ok(o.edited > 0);
  assert.equal(db.store['businesses/' + BID + '/meta/botInbox'].orders[oid].total, 12000);
  assert.ok(custMsgs(tg).some(m => /o'zgartirildi/.test(m.text) && /12 000/.test(m.text)));
  assert.equal(shop.reservedFrom(db.store['businesses/' + BID + '/meta/botInbox'].orders, 'main')['p2|'] || 0, 0);
  assert.equal((await app(deps, 'boEdit', { oid: oid, items: [{ id: 'p1', q: 0 }] })).body.code, 'empty');
  assert.equal((await app(deps, 'boEdit', { oid: oid, items: [{ id: 'p1', q: 1 }] })).body.same, true);
  await app(deps, 'boSet', { oid: oid, to: 'done' });
  assert.equal((await app(deps, 'boEdit', { oid: oid, items: [{ id: 'p1', q: 2 }] })).body.code, 'bad_state');
});

test('fix153: do\'kon xabari mijozga, mijoz javobi egaga va ilovaga', async () => {
  const { deps, db, tg } = mk();
  const r = await order(deps);
  const oid = r.body.order.id;
  const m = await app(deps, 'boMsg', { oid: oid, text: '5 daqiqada chiqamiz', by: 'Ega' });
  assert.equal(m.status, 200, JSON.stringify(m.body)); assert.equal(m.body.sent, true);
  assert.ok(custMsgs(tg).some(x => /5 daqiqada chiqamiz/.test(x.text) && /Sardor Market/.test(x.text)));
  const out = await core.handleUpdate(deps, { message: { message_id: 5, chat: { id: CUST, type: 'private' }, from: { id: CUST, language_code: 'uz' }, text: 'Yaxshi, kutaman <3' } });
  assert.equal(out.custMsg, oid);
  assert.ok(custMsgs(tg).pop().text.includes('yuborildi'));
  assert.ok(ownerMsgs(tg).some(x => /mijozdan/.test(x.text) && /Yaxshi, kutaman &lt;3/.test(x.text)));
  const ib = db.store['businesses/' + BID + '/meta/botInbox'].orders[oid];
  assert.deepEqual(ib.msgs.map(x => x.f), ['s', 'c']); assert.equal(ib.canMsg, true);
  await app(deps, 'boSet', { oid: oid, to: 'done' });
  const out2 = await core.handleUpdate(deps, { message: { message_id: 6, chat: { id: CUST, type: 'private' }, from: { id: CUST, language_code: 'uz' }, text: 'rahmat' } });
  assert.ok(!out2.custMsg, 'yopilgan buyurtmadan keyin avvalgi javob (do\'kon tugmasi)');
  assert.equal((await app(deps, 'boMsg', { oid: oid, text: '' })).body.code, 'empty');
});

test('fix153: sayt buyurtmasiga bot xabari yuborilmaydi (Telegram yo\'q)', async () => {
  const { deps, db } = mk();
  const W = require('../src/telegram/webshop');
  db.store['publicShops/sardorweb'] = { ownerUid: BID, businessId: BID, slug: 'sardorweb', payload: JSON.stringify({ name: 'S', orders: true, products: [{ id: 'p1', name: 'Cola', price: 12000, unit: 'dona', inStock: true, variants: [] }] }) };
  const r = await W.handle(deps, { action: 'siteOrder', slug: 'sardorweb', clientId: 'webclient01', name: 'Ali', phone: '901234567', items: [{ id: 'p1', q: 1 }] }, { ip: '1.1.1.1' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await app(deps, 'boMsg', { oid: r.body.order.id, text: 'salom' })).body.code, 'no_chat');
  assert.ok(!db.store['businesses/' + BID + '/meta/botInbox'].orders[r.body.order.id].canMsg);
});

test('fix154-iso: ikki do\'konda faol buyurtma — mijoz xabari aralashmaydi (tanlash tugmalari); egasi ham mijoz sifatida yoza oladi', async () => {
  const sd = seed();
  sd['businesses/' + BID2] = { businessName: 'Ikkinchi', currency: 'UZS' };
  sd['tgShop/' + BID2] = { enabled: true, slug: 'ikki', branchId: 'main', pickup: true, seq: 0 };
  sd['tgSlug/ikki'] = { bid: BID2 };
  sd['businesses/' + BID2 + '/products/z1'] = prod('z1', { name: 'Zet', price: 1000 });
  sd['tgBiz/' + BID2] = { chats: { '5550002': { name: 'Ega2', at: 1, sig: core.sigOf(KEY, BID2, '5550002') } }, lang: 'uz' };
  const { deps, db, tg } = mk(sd);
  const a = await order(deps);
  const b = await shop.handleWebApp(deps, { initData: ID1, action: 'order', slug: 'ikki', clientId: 'clientzzz1', items: [{ id: 'z1', q: 1 }], mode: 'pickup', phone: '+998901234567' });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  const m = (text) => ({ message: { message_id: 1, chat: { id: CUST, type: 'private' }, from: { id: CUST, language_code: 'uz' }, text: text } });
  const r1 = await core.handleUpdate(deps, m('Qachon tayyor?'));
  assert.equal(r1.custMsg, 'choose');
  const kb = custMsgs(tg).pop().reply_markup.inline_keyboard;
  assert.equal(kb.length, 2); assert.ok(kb.some(k => /Ikkinchi/.test(k[0].text)) && kb.some(k => /Sardor/.test(k[0].text)));
  const cb = { callback_query: { id: 'q1', data: 'bo:t:' + a.body.order.id, from: { id: CUST }, message: { message_id: 7, chat: { id: CUST, type: 'private' } } } };
  const r2 = await core.handleUpdate(deps, cb);
  assert.equal(r2.custMsg, a.body.order.id);
  assert.ok(ownerMsgs(tg).some(x => /Qachon tayyor/.test(x.text)), 'Sardor egasiga bordi');
  assert.ok(!tg.sent.some(x => String(x.chat_id) === '5550002' && /Qachon tayyor/.test(x.text || '')), 'Ikkinchi egasiga bormadi');
  assert.ok(custMsgs(tg).pop().text.includes('Sardor Market'));
  const r3 = await core.handleUpdate(deps, m('Yana savol'));
  assert.equal(r3.custMsg, a.body.order.id, 'keyingi xabar tanlangan buyurtmaga');
  // egasi (ulangan chat) boshqa do'konda mijoz
  const own = (text) => ({ message: { message_id: 2, chat: { id: Number(OWNER_CHAT), type: 'private' }, from: { id: Number(OWNER_CHAT), language_code: 'uz' }, text: text } });
  const r4 = await core.handleUpdate(deps, own('salom'));
  assert.ok(!r4.custMsg && /ulangan/.test(r4.reply || ''), 'faol buyurtmasi yo\'q — avvalgidek');
  const IDO = initData({ id: Number(OWNER_CHAT), first_name: 'Ega' });
  const o2 = await shop.handleWebApp(deps, { initData: IDO, action: 'order', slug: 'ikki', clientId: 'clientown01', items: [{ id: 'z1', q: 1 }], mode: 'pickup', phone: '+998901234568' });
  assert.equal(o2.status, 200, JSON.stringify(o2.body));
  const r5 = await core.handleUpdate(deps, own('Men ham mijozman'));
  assert.equal(r5.custMsg, o2.body.order.id);
  assert.ok(tg.sent.some(x => String(x.chat_id) === '5550002' && /Men ham mijozman/.test(x.text || '')));
});

/* fix174-botprice: narx rejimi (chakana/ulgurji/blok) va til — veb katalog bilan bir xil; blok savdosi */
test('fix174: ulgurji rejim — ulgurji narx, narxsiz mahsulot yashirin; blok rejim — blok narxi, blok birligi, qoldiq blokda; buyurtma blokda, band dona hisobida', async () => {
  const sd = seed();
  sd['businesses/' + BID + '/products/p1'].wholesalePrice = 11000;
  sd['businesses/' + BID + '/products/p1'].boxPrice = 120000; sd['businesses/' + BID + '/products/p1'].unitsPerBox = 12; sd['businesses/' + BID + '/products/p1'].boxLabel = 'Blok'; sd['businesses/' + BID + '/products/p1'].stock = 30;
  sd['businesses/' + BID + '/products/p2'].wholesalePrice = 4500;
  sd['tgShop/' + BID].priceMode = 'wholesale'; sd['tgShop/' + BID].lang = 'uz';
  let s = mk(sd);
  let r = await shop.handleWebApp(s.deps, { initData: ID1, action: 'catalog', slug: 'sardor', lang: 'ru' });
  assert.equal(r.body.shop.lang, 'uz'); assert.equal(r.body.shop.priceMode, 'wholesale');
  const by = {}; r.body.items.forEach(i => { by[i.id] = i; });
  assert.equal(by.p1.p, 11000); assert.equal(by.p2.p, 4500);
  assert.ok(!by.p3, 'ulgurji narxi yo\'q — yashirin');
  assert.equal(by.p6.p, 50000, 'variant: ulgurji narx yo\'q bo\'lsa oddiy narx');
  // blok rejim
  s.db.store['tgShop/' + BID].priceMode = 'box'; shop.clearCatalogCache();
  r = await shop.handleWebApp(s.deps, { initData: ID1, action: 'catalog', slug: 'sardor' });
  const b1 = r.body.items.find(i => i.id === 'p1'), b2 = r.body.items.find(i => i.id === 'p2');
  assert.equal(b1.p, 120000); assert.equal(b1.b, 12); assert.equal(b1.u, 'Blok'); assert.equal(b1.m, 2, '30 dona = 2 blok'); assert.equal(b1.f, 0);
  assert.equal(b2.p, 4500, 'blok narxi yo\'q — ulgurji narx');
  // buyurtma: 2 blok
  const o = await order(s.deps, { items: [{ id: 'p1', q: 2 }] });
  assert.ok(o.body.ok, JSON.stringify(o.body));
  const line = o.body.order.items[0];
  assert.equal(line.qty, 2); assert.equal(line.b, 12); assert.equal(line.unit, 'Blok'); assert.equal(line.sum, 240000);
  // band: 24 dona — endi 0 blok qoldi
  shop.clearCatalogCache();
  r = await shop.handleWebApp(s.deps, { initData: ID2, action: 'catalog', slug: 'sardor' });
  const after = r.body.items.find(i => i.id === 'p1');
  assert.equal(after.m, 0); assert.equal(after.s, 0, '6 dona qoldi — bir blokka yetmaydi');
  const o2 = await order(s.deps, { items: [{ id: 'p1', q: 1 }] }, ID2);
  assert.equal(o2.body.code, 'out_of_stock');
  // matnda blok birligi
  const M = require('../src/telegram/msgs');
  assert.equal(M.unitLabel('uz', 'Blok'), 'Blok'); assert.equal(M.unitLabel('uz', 'kg'), M.unitLabel('uz', 'kg'));
  // chakana — avvalgidek
  s.db.store['tgShop/' + BID].priceMode = 'retail'; shop.clearCatalogCache();
  r = await shop.handleWebApp(s.deps, { initData: ID1, action: 'catalog', slug: 'sardor' });
  assert.equal(r.body.items.find(i => i.id === 'p1').p, 12000); assert.ok(r.body.items.find(i => i.id === 'p3'));
});
test('fix174: showOut=false — tugagan mahsulot bot katalogida yashirin (veb kabi); standart — ko\'rinadi', async () => {
  const sd = seed(); sd['tgShop/' + BID].showOut = false;
  const s = mk(sd);
  let r = await shop.handleWebApp(s.deps, { initData: ID1, action: 'catalog', slug: 'sardor' });
  assert.ok(!r.body.items.find(i => i.id === 'p7'), 'tugagan yashirin');
  s.db.store['tgShop/' + BID].showOut = true; shop.clearCatalogCache();
  r = await shop.handleWebApp(s.deps, { initData: ID1, action: 'catalog', slug: 'sardor' });
  assert.ok(r.body.items.find(i => i.id === 'p7'), 'ko\'rinadi (Tugagan belgisi bilan)');
});

/* fix193-both: «Ulgurji: blok va dona — mijoz tanlaydi» */
test('fix193: blok va dona — ikkalasi alohida tanlov; variant va variantsiz; narx, qoldiq, buyurtma qatori (haqiqiy variant + blok), birgalikda qoldiq, tahrir', async () => {
  const sd = seed();
  const P1 = sd['businesses/' + BID + '/products/p1'];
  Object.assign(P1, { wholesalePrice: 11000, boxPrice: 120000, unitsPerBox: 12, boxLabel: 'Blok', stock: 30 });
  sd['businesses/' + BID + '/products/p2'].wholesalePrice = 4500;   // faqat dona
  sd['businesses/' + BID + '/products/p9'] = prod('p9', { name: 'Biolife 0,5L', price: 3000, unitsPerBox: 12, boxLabel: 'Blok', stock: 0,
    variants: [{ id: 'g0', name: 'Gazsiz', price: 3000, wholesalePrice: 2800, boxPrice: 33000, stock: 40 }, { id: 'g1', name: 'Gazli', price: 3000, wholesalePrice: 2800, stock: 5 }] });
  sd['tgShop/' + BID].priceMode = 'both';
  const s = mk(sd);
  let r = await shop.handleWebApp(s.deps, { initData: ID1, action: 'catalog', slug: 'sardor' });
  assert.equal(r.body.shop.priceMode, 'both');
  const by = {}; r.body.items.forEach(i => { by[i.id] = i; });
  assert.deepEqual(by.p1.v.map(v => [v.id, v.p, v.b || 0, v.m, v.k]), [['~u', 11000, 0, 30, 'u'], ['~b', 120000, 12, 2, 'b']]);
  assert.equal(by.p1.p, 11000, 'kartada eng arzon (dona)');
  assert.equal(by.p2.p, 4500); assert.ok(!by.p2.v, 'faqat dona — oddiy tovar');
  assert.deepEqual(by.p9.v.map(v => [v.id, v.n, v.p, v.k || '']), [['g0', 'Gazsiz · dona', 2800, 'u'], ['g0~b', 'Gazsiz · Blok', 33000, 'b'], ['g1', 'Gazli', 2800, '']]);
  assert.equal(by.p9.v[1].m, 3, '40 dona = 3 blok');
  // buyurtma: 1 blok + 5 dona (p1), 2 blok Gazsiz + 3 dona Gazsiz
  const o = await order(s.deps, { items: [{ id: 'p1', v: '~b', q: 1 }, { id: 'p1', v: '~u', q: 5 }, { id: 'p9', v: 'g0~b', q: 2 }, { id: 'p9', v: 'g0', q: 3 }] });
  assert.ok(o.body.ok, JSON.stringify(o.body));
  const L = s.db.store['tgOrders/' + o.body.order.id].items.map(x => [x.id, x.v || '', x.vName || '', x.qty, x.b || 0, x.unit, x.price, x.sum]);
  assert.deepEqual(L, [['p1', '', '', 1, 12, 'Blok', 120000, 120000], ['p1', '', '', 5, 0, 'dona', 11000, 55000], ['p9', 'g0', 'Gazsiz', 2, 12, 'Blok', 33000, 66000], ['p9', 'g0', 'Gazsiz', 3, 0, 'dona', 2800, 8400]]);
  // band: p1 — 12+5 = 17 dona, qoldi 13 → 1 blok, 13 dona
  shop.clearCatalogCache();
  r = await shop.handleWebApp(s.deps, { initData: ID2, action: 'catalog', slug: 'sardor' });
  const p1b = r.body.items.find(i => i.id === 'p1');
  assert.deepEqual(p1b.v.map(v => v.m), [13, 1]);
  // birgalikda qoldiqdan oshmaydi: 1 blok (12) + 2 dona = 14 > 13
  const o2 = await order(s.deps, { items: [{ id: 'p1', v: '~b', q: 1 }, { id: 'p1', v: '~u', q: 2 }] }, ID2);
  assert.equal(o2.body.code, 'out_of_stock');
  const o3 = await order(s.deps, { items: [{ id: 'p1', v: '~b', q: 1 }, { id: 'p1', v: '~u', q: 1 }] }, ID2);
  assert.ok(o3.body.ok, JSON.stringify(o3.body));
  // blok kasr miqdor bo'lmaydi
  const o4 = await order(s.deps, { items: [{ id: 'p9', v: 'g0~b', q: 0.4 }] }, ID2);
  assert.equal(o4.body.code, 'bad_qty');
  // ega tahriri: bir tovarning blok va dona qatorlari alohida (b bilan)
  const oid = o.body.order.id;
  const e = await app(s.deps, 'boEdit', { oid: oid, items: [{ id: 'p1', v: '', b: 1, q: 2 }, { id: 'p1', v: '', b: 0, q: 5 }, { id: 'p9', v: 'g0', b: 1, q: 1 }, { id: 'p9', v: 'g0', b: 0, q: 3 }] });
  assert.ok(e.body.ok, JSON.stringify(e.body));
  const o5 = s.db.store['tgOrders/' + oid];
  assert.deepEqual(o5.items.map(x => [x.id, x.b || 0, x.qty]), [['p1', 12, 2], ['p1', 0, 5], ['p9', 12, 1], ['p9', 0, 3]]);
  // eski ilova (b yubormaydi) — avvalgidek ishlaydi
  const e2 = await app(s.deps, 'boEdit', { oid: oid, items: [{ id: 'p2', q: 0 }, { id: 'p1', q: 3 }] });
  assert.ok(e2.body.ok || e2.body.same, JSON.stringify(e2.body));
});
test('fix193: boshqa rejimlar o\'zgarmagan (blok rejimida variant faqat blok)', async () => {
  const sd = seed();
  sd['businesses/' + BID + '/products/p9'] = prod('p9', { name: 'Biolife', unitsPerBox: 12, boxLabel: 'Blok', variants: [{ id: 'g0', name: 'Gazsiz', price: 3000, wholesalePrice: 2800, boxPrice: 33000, stock: 40 }] });
  sd['tgShop/' + BID].priceMode = 'box';
  const s = mk(sd);
  const r = await shop.handleWebApp(s.deps, { initData: ID1, action: 'catalog', slug: 'sardor' });
  assert.deepEqual(r.body.items.find(i => i.id === 'p9').v.map(v => [v.id, v.p, v.b]), [['g0', 33000, 12]]);
});
