'use strict';
/* fix151-weborder: sayt katalogidan buyurtma — narx serverda, inbox, egaga xabar, holat va bekor qilish, himoya. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb, fakeTg } = require('./helpers/tgFake');
const core = require('../src/telegram/core');
const shop = require('../src/telegram/shop');
const W = require('../src/telegram/webshop');

const KEY = core.keyFromToken('123:TEST'), WEBKEY = shop.webKeyFromToken('123:TEST');
const BID = 'bizW', CHAT = '5550001';
const NOW = Date.UTC(2026, 9, 20, 9, 0, 0);
function payload(extra) {
  return JSON.stringify(Object.assign({ name: 'Salqin ichimliklar', address: 'Chilonzor 1', phone: '+998901112233', lang: 'uz', currency: "so'm", orders: true, branchId: 'main',
    products: [
      { id: 'p1', name: 'Cola 1L', price: 12000, unitLabel: 'dona', perBox: 0, category: 'Ichimlik', unit: 'dona', inStock: true, variants: [] },
      { id: 'p2', name: 'Futbolka', price: 0, unit: 'dona', inStock: true, variants: [{ name: 'S', price: 50000, inStock: true }, { name: 'M', price: 55000, inStock: false }] },
      { id: 'p3', name: 'Suv', price: 36000, unitLabel: 'Quti (12 dona)', perBox: 12, unit: 'dona', inStock: true, variants: [] },
      { id: 'p4', name: 'Tugagan', price: 5000, unit: 'dona', inStock: false, variants: [] }
    ] }, extra || {}));
}
function seed(pl) {
  return {
    'publicShops/salqin': { ownerUid: BID, businessId: BID, slug: 'salqin', payload: pl || payload() },
    'businesses/bizW': { businessName: 'Salqin', currency: 'UZS' },
    'businesses/bizW/products/p2': { id: 'p2', name: 'Futbolka', variants: [{ id: 'v1', name: 'S', price: 50000, stock: 3 }, { id: 'v2', name: 'M', price: 55000, stock: 0 }] },
    'tgBiz/bizW': { chats: { [CHAT]: { name: 'Ega', at: 1, sig: core.sigOf(KEY, BID, CHAT) } }, lang: 'uz' }
  };
}
function mk(s) { const db = fakeDb(s || seed()); const tg = fakeTg(); let now = NOW; return { db, tg, deps: { db, tg, key: KEY, webKey: WEBKEY, nowMs: () => now }, setNow: (t) => { now = t; } }; }
let n = 0;
const req = (deps, extra, ip) => W.handle(deps, Object.assign({ action: 'siteOrder', slug: 'salqin', clientId: 'cl' + (++n) + 'abcdefgh', name: 'Ali Valiyev', phone: '90 123 45 67', items: [{ id: 'p1', q: 2 }] }, extra || {}), { ip: ip || '1.2.3.4' });

test('buyurtma: narx serverda, inbox va egaga Telegram xabari, raqam bot buyurtmalari bilan umumiy', async () => {
  const s = mk();
  s.db.store['tgShop/bizW'] = { seq: 41 };
  const r = await req(s.deps, { items: [{ id: 'p1', q: 2 }, { id: 'p2', vn: 'S', q: 1 }, { id: 'p3', q: 2 }, { id: 'p1', q: 1 }], mode: 'delivery', address: 'Yunusobod 4', comment: 'Tez', pay: 'card' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.order.no, 42); assert.equal(r.body.t.length, 24);
  const o = s.db.store['tgOrders/' + r.body.order.id];
  assert.equal(o.src, 'web'); assert.equal(o.phone, '+998901234567'); assert.equal(o.phoneOk, false);
  assert.equal(o.total, 12000 * 3 + 50000 + 72000);
  const p1 = o.items.find(x => x.id === 'p1'), p2 = o.items.find(x => x.id === 'p2'), p3 = o.items.find(x => x.id === 'p3');
  assert.equal(p1.qty, 3); assert.equal(p2.v, 'v1'); assert.equal(p2.vName, 'S');
  assert.equal(p3.qty, 24); assert.equal(p3.price, 3000); assert.equal(p3.sum, 72000); assert.match(p3.vName, /2 × Quti/);
  const ib = s.db.store['businesses/bizW/meta/botInbox'].orders[o.id];
  assert.equal(ib.src, 'web'); assert.equal(ib.mode, 'delivery'); assert.equal(ib.address, 'Yunusobod 4');
  const m = s.tg.sent.find(x => String(x.chat_id) === CHAT);
  assert.ok(m && /#42/.test(m.text) && /saytdan/.test(m.text), m && m.text);
});

test('takroriy yuborish (o\'sha clientId) — yangi buyurtma ochilmaydi', async () => {
  const s = mk();
  const a = await req(s.deps, { clientId: 'sameclient123' }), b = await req(s.deps, { clientId: 'sameclient123' });
  assert.equal(a.body.order.id, b.body.order.id); assert.equal(b.body.again, true);
  assert.equal(Object.keys(s.db.store).filter(k => k.indexOf('tgOrders/') === 0).length, 1);
});

test('tekshiruvlar: o\'chirilgan, tugagan, o\'zgargan, telefon/ism, manzil, tuzoq', async () => {
  let s = mk(seed(payload({ orders: false })));
  assert.equal((await req(s.deps)).body.code, 'orders_off');
  s = mk(seed(JSON.stringify({ name: 'x', products: [] })));
  assert.equal((await req(s.deps)).body.code, 'orders_off', 'eski katalog (orders yo\'q) — avvalgidek faqat matn');
  s = mk();
  assert.equal((await req(s.deps, { items: [{ id: 'p4', q: 1 }] })).body.code, 'out_of_stock');
  assert.equal((await req(s.deps, { items: [{ id: 'p2', vn: 'M', q: 1 }] })).body.code, 'out_of_stock');
  assert.equal((await req(s.deps, { items: [{ id: 'p2', vn: 'XL', q: 1 }] })).body.code, 'changed');
  assert.equal((await req(s.deps, { items: [{ id: 'zz', q: 1 }] })).body.code, 'changed');
  assert.equal((await req(s.deps, { items: [{ id: 'p1', q: 0 }] })).body.code, 'bad_qty');
  assert.equal((await req(s.deps, { items: [] })).body.code, 'empty');
  assert.equal((await req(s.deps, { phone: '123' })).body.code, 'need_phone');
  assert.equal((await req(s.deps, { name: 'A' })).body.code, 'need_name');
  assert.equal((await req(s.deps, { mode: 'delivery', address: '' })).body.code, 'need_address');
  assert.equal((await req(s.deps, { hp: 'bot' })).body.code, 'bad_request');
  assert.equal((await W.handle(s.deps, { action: 'siteOrder', slug: 'yoq-dokon', clientId: 'abcdefgh1', name: 'Ali', phone: '901234567', items: [{ id: 'p1', q: 1 }] }, {})).body.code, 'closed');
  assert.equal(Object.keys(s.db.store).filter(k => k.indexOf('tgOrders/') === 0).length, 0);
});

test('himoya: bitta telefonga 3 ta faol, IP soatiga 8 ta; bir soatdan keyin yana mumkin', async () => {
  const s = mk();
  for (let i = 0; i < 3; i++) assert.equal((await req(s.deps, {}, '9.9.9.' + i)).status, 200);
  assert.equal((await req(s.deps, {}, '9.9.9.9')).body.code, 'too_many_active');
  for (let i = 0; i < 5; i++) assert.equal((await req(s.deps, { phone: '+99890000000' + i }, '7.7.7.7')).status, 200);
  assert.equal((await req(s.deps, { phone: '+998911111111' }, '7.7.7.7')).status, 200);
  assert.equal((await req(s.deps, { phone: '+998922222222' }, '7.7.7.7')).status, 200);
  assert.equal((await req(s.deps, { phone: '+998933333333' }, '7.7.7.7')).status, 200);
  assert.equal((await req(s.deps, { phone: '+998944444444' }, '7.7.7.7')).body.code, 'too_many');
  s.setNow(NOW + 3600001);
  assert.equal((await req(s.deps, { phone: '+998944444444' }, '7.7.7.7')).status, 200);
});

test('holat va bekor qilish: token bilan; boshqa token bilan ko\'rinmaydi; qabul qilingach bekor qilinmaydi', async () => {
  const s = mk();
  const r = await req(s.deps);
  const id = r.body.order.id, t = r.body.t;
  let st = await W.handle(s.deps, { action: 'siteStatus', orders: [{ id: id, t: t }, { id: id, t: 'x'.repeat(24) }] });
  assert.equal(st.body.orders.length, 1); assert.equal(st.body.orders[0].status, 'new');
  const r2 = await req(s.deps, { clientId: 'otherclient99' });
  const ok1 = await shop.handleAppApi(s.deps, { bid: BID, owner: true }, BID, 'boSet', { oid: r2.body.order.id, to: 'accepted', eta: 20 });
  assert.equal(ok1.status, 200, JSON.stringify(ok1.body));
  st = await W.handle(s.deps, { action: 'siteStatus', orders: [{ id: r2.body.order.id, t: r2.body.t }] });
  assert.equal(st.body.orders[0].status, 'accepted'); assert.equal(st.body.orders[0].eta, 20);
  assert.equal((await W.handle(s.deps, { action: 'siteCancel', id: r2.body.order.id, t: r2.body.t })).body.code, 'bad_state');
  assert.equal((await W.handle(s.deps, { action: 'siteCancel', id: id, t: 'bad' })).body.code, 'not_found');
  const c = await W.handle(s.deps, { action: 'siteCancel', id: id, t: t });
  assert.equal(c.body.order.status, 'cancelled');
  assert.ok(s.tg.sent.some(m => /bekor/i.test(m.text || '')), 'egaga bekor qilingani haqida xabar');
  assert.equal(s.db.store['businesses/bizW/meta/botInbox'].orders[id].status, 'cancelled');
});

test('dollarda tiyin bilan', async () => {
  const s = mk(seed(payload({ products: [{ id: 'p1', name: 'Cola', price: 1.99, unit: 'dona', inStock: true, variants: [] }] })));
  s.db.store['businesses/bizW'].currency = 'USD';
  const r = await req(s.deps, { items: [{ id: 'p1', q: 3 }] });
  assert.equal(r.body.order.total, 5.97); assert.equal(r.body.order.cur, 'USD');
});

test('band qilish: sayt buyurtmasi bot katalogidagi qoldiqdan ham ayiriladi', async () => {
  const s = mk();
  const r = await req(s.deps, { items: [{ id: 'p2', vn: 'S', q: 2 }] });
  const res = shop.reservedFrom(s.db.store['businesses/bizW/meta/botInbox'].orders, 'main');
  assert.equal(res['p2|v1'], 2, JSON.stringify(res));
  assert.ok(r.body.order.id);
});
