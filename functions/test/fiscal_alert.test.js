'use strict';
/* fix189-fiscal6: Telegram — soliqqa yuborilmagan cheklar ogohlantirishi (3 marta urinish yoki 24 soat navbatda). Standart: O'CHIQ. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb, fakeTg } = require('./helpers/tgFake');
const core = require('../src/telegram/core');
const R = require('../src/telegram/reports');
const FT = require('../src/telegram/fiscalTexts');
const E = require('../src/fiscal/engine');
const P = require('../src/fiscal/providers');
const M = require('../src/fiscal/mock');

const KEY = core.keyFromToken('123:TEST');
const BID = 'OWNER1', NOW = Date.parse('2026-10-22T06:00:00Z'), H = 3600000, IK = '01234567890123456';
function chatsFor(bid, ids) { const c = {}; ids.forEach(function (id, i) { c[id] = { name: 'Chat ' + id, username: '', at: 1000 + i, sig: core.sigOf(KEY, bid, id) }; }); return c; }
function seed(withChats) {
  const s = { 'businesses/OWNER1': { businessName: 'Do\'kon <A&B>', currency: 'UZS', timeZone: 'Asia/Tashkent', fiscalMode: true, fiscalProvider: 'mock', businessInn: '123456789' } };
  if (withChats !== false) { s['tgBiz/OWNER1'] = { chats: chatsFor(BID, ['111']), lang: 'uz' }; s['tgChats/111'] = { bids: [BID] }; }
  return s;
}
function mk(mockOpts, withChats) {
  const db = fakeDb(seed(withChats)), tg = fakeTg(), mock = M.create(mockOpts || {});
  const rt = db.runTransaction; let chain = Promise.resolve();
  db.runTransaction = function (fn) { const r = chain.then(function () { return rt(fn); }); chain = r.catch(function () {}); return r; };
  let t = NOW;
  const d = { db: db, tg: tg, key: KEY, botName: 'savdo_pos_bot', nowMs: function () { return t; }, sleep: async function () {},
    provider: function (n) { return n === 'mock' ? P.wrap(mock, { timeoutMs: 60 }) : P.create(n); } };
  d.setNow = function (x) { t = x; }; d.mock = mock;
  return d;
}
function sale(id) {
  return { id: id, fx: 1, receiptNumber: id.toUpperCase(), date: '2026-10-22T06:00:00.000Z', paymentType: 'cash',
    items: [{ productId: 'a', name: 'Cola', qty: 1, price: 12000, ikpu: IK, pkg: '1', vat: 12 }], subtotal: 12000, total: 12000 };
}
async function prefs(d, p) { const r = await core.handleApi(d, BID, { action: 'prefs', prefs: p }); assert.equal(r.status, 200); return r.body.prefs; }
const om = (d) => (d.db.store['fiscalBiz/' + BID] || {}).openMap || {};

test('sozlama: standart o\'chiq; yoqilsa tgPrefs.fx; o\'chiq bo\'lsa hech narsa o\'qilmaydi va yuborilmaydi', async () => {
  assert.equal(R.normPrefs(null).fisc, false); assert.equal(R.DEF.fisc, false); assert.ok(R.KINDS.indexOf('fisc') >= 0);
  const d = mk({ mode: 'fail' });
  for (let i = 0; i < 3; i++) { d.db.store['businesses/' + BID + '/sales/s1'] = sale('s1'); await E.processSale(d, BID, sale('s1'), { force: true }); }
  let r = await R.runFiscal(d); assert.equal(r.checked, 0); assert.equal(d.tg.sent.length, 0);
  const p = await prefs(d, { fisc: true }); assert.equal(p.fisc, true);
  assert.equal(d.db.store['tgPrefs/OWNER1'].fx, true); assert.equal(d.db.store['tgPrefs/OWNER1'].any, true);
  r = await R.runFiscal(d); assert.equal(r.checked, 1); assert.equal(r.alerts, 1);
  await prefs(d, { fisc: false }); r = await R.runFiscal(d); assert.equal(r.checked, 0);
});

test('3 marta urinish: bitta xabar (chek raqami, sabab); takror yuborilmaydi; 1-2 urinishda xabar yo\'q', async () => {
  const d = mk({ mode: 'fail' }); await prefs(d, { fisc: true });
  d.db.store['businesses/' + BID + '/sales/a1'] = sale('a1');
  await E.processSale(d, BID, sale('a1')); assert.equal(om(d).a1.a, 1);
  d.setNow(NOW + 2 * 60000); await E.retryTick(d); assert.equal(om(d).a1.a, 2);
  let r = await R.runFiscal(d); assert.equal(r.alerts, 0); assert.equal(d.tg.sent.length, 0);
  d.setNow(NOW + 10 * 60000); await E.retryTick(d); assert.equal(om(d).a1.a, 3);
  r = await R.runFiscal(d); assert.equal(r.alerts, 1); assert.equal(d.tg.sent.length, 1);
  const txt = d.tg.sent[0].text;
  assert.match(txt, /Soliqqa yuborilmagan cheklar/); assert.match(txt, /Chek №A1 — 3 marta urinildi: operator yoki internet vaqtincha javob bermadi/); assert.match(txt, /Do'kon &lt;A&amp;B&gt;/); assert.match(txt, /Fiskal kassa/);
  r = await R.runFiscal(d); assert.equal(r.alerts, 0); assert.equal(d.tg.sent.length, 1, 'takror yo\'q');
  d.mock.opts.mode = 'ok'; d.setNow(NOW + 40 * 60000); await E.retryTick(d);
  assert.equal(om(d).a1, undefined, 'yuborilgach ro\'yxatdan chiqdi'); assert.equal(d.db.store['fiscalBiz/' + BID].openCount, 0);
});

test('operator rad etgan chek (avtomatik qayta urinilmaydi) — DARHOL xabar (fix190); yangi chek qo\'shilsa — yana bitta xabar', async () => {
  const d = mk({ mode: 'error' }); await prefs(d, { fisc: true });
  await E.processSale(d, BID, sale('b1'));
  let r = await R.runFiscal(d); assert.equal(r.alerts, 1);
  assert.match(d.tg.sent[0].text, /Chek №B1 — operator rad etdi: tovarning IKPU kodi noto'g'ri yoki topilmadi/);
  r = await R.runFiscal(d); assert.equal(r.alerts, 0, 'takror yo\'q');
  d.setNow(NOW + 30 * 60000); await E.processSale(d, BID, sale('b2'));
  r = await R.runFiscal(d); assert.equal(r.alerts, 1);
  assert.match(d.tg.sent[1].text, /2 ta chek/); assert.match(d.tg.sent[1].text, /№B1/); assert.match(d.tg.sent[1].text, /№B2/);
});

test('operator band (qayta urinadi) — 24 soat navbatda tursa xabar', async () => {
  const d = mk({ mode: 'fail' }); await prefs(d, { fisc: true });
  await E.processSale(d, BID, sale('k1'));
  d.setNow(NOW + 23 * H); let r = await R.runFiscal(d); assert.equal(r.alerts, 0);
  d.setNow(NOW + 24 * H + 60000); r = await R.runFiscal(d); assert.equal(r.alerts, 1);
  assert.match(d.tg.sent[0].text, /Chek №K1 — 24 soatdan beri navbatda/);
});

test('chat ulanmagan — belgilanmaydi; ulangach xabar boradi', async () => {
  const d = mk({ mode: 'error' }, false); await prefs(d, { fisc: true });
  await E.processSale(d, BID, sale('c1')); d.setNow(NOW + 25 * H);
  let r = await R.runFiscal(d); assert.equal(r.alerts, 0); assert.equal((d.db.store['tgSent/OWNER1'] || {}).fxKeys, undefined);
  d.db.store['tgBiz/OWNER1'] = { chats: chatsFor(BID, ['111']), lang: 'uz' }; d.db.store['tgChats/111'] = { bids: [BID] };
  r = await R.runFiscal(d); assert.equal(r.alerts, 1);
});

test('savdo o\'chirildi (chek hech qachon yuborilmagan) — ro\'yxatdan chiqadi, xabar bo\'lmaydi', async () => {
  const d = mk({ mode: 'error' }); await prefs(d, { fisc: true });
  await E.processSale(d, BID, sale('d1')); assert.ok(om(d).d1);
  await E.onSaleDeleted(d, BID, 'd1', sale('d1'));
  assert.equal(om(d).d1, undefined); d.setNow(NOW + 30 * H);
  const r = await R.runFiscal(d); assert.equal(r.alerts, 0);
});

test('matn: 6 til, HTML xavfsiz, 5 tadan ko\'p bo\'lsa «yana N ta»; sinov xabari', async () => {
  const items = []; for (let i = 0; i < 7; i++) items.push({ k: ['sale', 'refund', 'edit', 'credit'][i % 4], n: 'N' + i, a: 3, e: '<x>', t: NOW - H });
  ['uz', 'ru', 'en', 'kk', 'ky', 'tg'].forEach(function (l) {
    const t = FT.fiscText(l, { items: items, total: 7 }, { shop: 'S', now: NOW });
    assert.ok(!/\{[a-z]\}/.test(t), l); assert.match(t, /&lt;x&gt;/); assert.equal((t.match(/^• /gm) || []).length, 5, l); assert.match(t, /2/);
  });
  const d = mk(); await prefs(d, {});
  const r = await core.handleApi(d, BID, { action: 'test', kind: 'fisc' });
  assert.equal(r.status, 200); assert.equal(r.body.sent, 1); assert.match(d.tg.sent[0].text, /Sinov xabari/); assert.match(d.tg.sent[0].text, /Qaytarish №998/);
});
