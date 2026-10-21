'use strict';
/* fix155-custbot: mijoz boti 2-bosqich — ulash (havola, raqam), mening sahifam, chek va to'lov xabarlari, savol, eslatmalar, izolyatsiya. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb, fakeTg } = require('./helpers/tgFake');
const core = require('../src/telegram/core');
const shop = require('../src/telegram/shop');
const CU = require('../src/telegram/cust');

const KEY = core.keyFromToken('123:TEST'), WEBKEY = shop.webKeyFromToken('123:TEST');
const BID = 'bizA', BID2 = 'bizB', OWNER = '5550001', OWNER2 = '5550002', CUST = 777001, CUST2 = 777002;
const NOW = Date.UTC(2026, 9, 21, 7, 0, 0);
const DAY = 86400000;
function seed() {
  const s = {};
  s['businesses/' + BID] = { businessName: 'Salqin', businessPhone: '+998901112233', currency: 'UZS', defaultCreditLimit: 500000, loyaltyEnabled: true, timeZone: 'Asia/Tashkent' };
  s['businesses/' + BID2] = { businessName: 'Boshqa', currency: 'UZS' };
  s['tgBiz/' + BID] = { chats: { [OWNER]: { name: 'Ega', at: 1, sig: core.sigOf(KEY, BID, OWNER) } }, lang: 'uz' };
  s['tgBiz/' + BID2] = { chats: { [OWNER2]: { name: 'Ega2', at: 1, sig: core.sigOf(KEY, BID2, OWNER2) } }, lang: 'uz' };
  s['tgChats/' + OWNER] = { bids: [BID] }; s['tgChats/' + OWNER2] = { bids: [BID2] };
  s['tgShop/' + BID] = { enabled: true, slug: 'salqin', branchId: 'main', pickup: true, seq: 0 };
  s['tgSlug/salqin'] = { bid: BID };
  s['businesses/' + BID + '/customers/c1'] = { id: 'c1', name: 'Dilnoza', phone: '+998 93 555 66 77', debt: 120000, bonusBalance: 3500, createdAt: '2026-01-01T00:00:00.000Z' };
  s['businesses/' + BID + '/customers/c2'] = { id: 'c2', name: 'Ali', phone: '901234567', debt: 0 };
  s['businesses/' + BID2 + '/customers/x1'] = { id: 'x1', name: 'Dilnoza B', phone: '935556677', debt: 999 };
  s['businesses/' + BID + '/sales/s1'] = { id: 's1', receiptNumber: 'A-101', date: new Date(NOW - 2 * DAY).toISOString(), total: 50000, paymentType: 'cash', customerId: 'c1', items: [{ name: 'Cola', qty: 2, price: 12000, unit: 'dona' }, { name: 'Shakar', qty: 1.5, price: 14000, unit: 'kg' }] };
  s['businesses/' + BID + '/sales/s2'] = { id: 's2', receiptNumber: 'A-102', date: new Date(NOW - DAY).toISOString(), total: 70000, paymentType: 'credit', customerId: 'c1', items: [{ name: 'Non', qty: 10, price: 7000, unit: 'dona' }] };
  s['businesses/' + BID + '/sales/s3'] = { id: 's3', receiptNumber: 'A-103', date: new Date(NOW - DAY).toISOString(), total: 1000, paymentType: 'cash', customerId: 'c2', items: [] };
  s['businesses/' + BID + '/ledger/l1'] = { id: 'l1', customerId: 'c1', type: 'payment', method: 'cash', amount: 30000, date: new Date(NOW - 3 * DAY).toISOString(), note: '' };
  s['businesses/' + BID + '/ledger/l2'] = { id: 'l2', customerId: 'c1', type: 'sale', amount: 70000, date: new Date(NOW - DAY).toISOString() };
  return s;
}
function mk(s, opt) {
  const db = fakeDb(s || seed()); const tg = fakeTg(); let n = 0, now = NOW;
  const deps = Object.assign({ db, tg, key: KEY, webKey: WEBKEY, botName: 'savdo_pos_bot', nowMs: () => now, randCode: () => 'CODE' + String(++n).padStart(6, '0') }, opt || {});
  return { db, tg, deps, setNow: (t) => { now = t; } };
}
function initData(user) {
  const crypto = require('crypto'); const p = new URLSearchParams();
  p.set('auth_date', String(Math.floor(NOW / 1000))); p.set('query_id', 'AAH' + user.id); p.set('user', JSON.stringify(Object.assign({ first_name: 'Dilnoza', language_code: 'uz' }, user))); p.set('signature', 's');
  const pairs = []; p.forEach((v, k) => pairs.push(k + '=' + v)); pairs.sort();
  p.set('hash', crypto.createHmac('sha256', WEBKEY).update(pairs.join('\n')).digest('hex')); return p.toString();
}
const ID1 = initData({ id: CUST });
const msg = (chat, text) => ({ message: { message_id: 1, chat: { id: Number(chat), type: 'private', first_name: 'D' }, from: { id: Number(chat), first_name: 'Dilnoza', language_code: 'uz' }, text } });
const to = (tg, chat) => tg.sent.filter(m => String(m.chat_id) === String(chat));
const app = (deps, action, body, owner) => core.handleApi(deps, owner ? BID : 'u', Object.assign({ action }, body || {}));

test('havola bilan ulash: ilova kod beradi, mijoz /start c_KOD bosadi; ikkinchi mijozga ishlamaydi; 3 kundan keyin eskiradi', async () => {
  const s = mk();
  s.db.store['staffAuth/u'] = { businessId: BID, role: 'admin' };
  const r = await app(s.deps, 'cuLink', { customerId: 'c1' }, true);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.match(r.body.url, /^https:\/\/t\.me\/savdo_pos_bot\?start=c_C/);
  const code = r.body.url.split('start=c_')[1];
  const out = await core.handleUpdate(s.deps, msg(CUST, '/start c_' + code));
  assert.equal(out.custLinked, BID); assert.equal(out.cid, 'c1');
  assert.ok(to(s.tg, CUST).pop().text.includes('Salqin'));
  assert.ok(s.tg.calls.some(c => c.method === 'setChatMenuButton' && c.params.menu_button.web_app.url.endsWith('?v=my')));
  assert.equal(s.db.store['tgCustLink/' + BID + '_c1'].uid, String(CUST));
  const o2 = await core.handleUpdate(s.deps, msg(CUST2, '/start c_' + code));
  assert.ok(/eskirgan|noto/.test(o2.reply));
  const st = await app(s.deps, 'cuStatus', { ids: ['c1', 'c2'] }, true);
  assert.ok(st.body.links.c1 && st.body.links.c1.by === 'code' && !st.body.links.c2);
  const r2 = await app(s.deps, 'cuLink', { customerId: 'c2' }, true);
  s.setNow(NOW + 4 * DAY);
  const o3 = await core.handleUpdate(s.deps, msg(CUST2, '/start c_' + r2.body.url.split('start=c_')[1]));
  assert.ok(/eskirgan/.test(o3.reply));
});

test('raqam bilan ulash: Telegram kontakt + mijoz muomala qilgan do\'kon; boshqa do\'konga avtomatik ulanmaydi', async () => {
  const s = mk();
  s.db.store['tgCust/' + CUST] = { lastShop: 'salqin', recent: [], lang: 'uz' };
  const r = await core.handleUpdate(s.deps, { message: { message_id: 2, chat: { id: CUST, type: 'private' }, from: { id: CUST, language_code: 'uz' }, contact: { user_id: CUST, phone_number: '998935556677', first_name: 'Dilnoza' } } });
  assert.equal(r.contact, 'saved');
  assert.equal(s.db.store['tgCustLink/' + BID + '_c1'].by, 'phone');
  assert.ok(!s.db.store['tgCustLink/' + BID2 + '_x1'], 'Boshqa do\'kon — muomala bo\'lmagan');
  assert.ok(to(s.tg, CUST).some(m => /mijozi sifatida ulandingiz/.test(m.text) && /Salqin/.test(m.text)));
  assert.equal(s.db.store['tgPhone/935556677'].uid, String(CUST));
});

test('mening sahifam: qarz, limit, bonus, tarix (cheklar va to\'lovlar); boshqa mijoz ko\'rmaydi; xabarlarni o\'chirish; uzish', async () => {
  const s = mk();
  await CU.linkByCode; s.db.store['tgCustLink/' + BID + '_c1'] = { uid: String(CUST), bid: BID, cid: 'c1', at: 1, by: 'code', notify: true };
  s.db.store['tgCust/' + CUST] = { shops: { [BID]: { cid: 'c1', at: 1 } }, lang: 'uz' };
  const h = await shop.handleWebApp(s.deps, { initData: ID1, action: 'myHome' });
  assert.equal(h.status, 200, JSON.stringify(h.body));
  const sh = h.body.shops[0];
  assert.equal(sh.name, 'Salqin'); assert.equal(sh.me, 'Dilnoza'); assert.equal(sh.debt, 120000); assert.equal(sh.limit, 500000); assert.equal(sh.bonus, 3500); assert.equal(sh.slug, 'salqin'); assert.equal(sh.notify, true);
  const hist = await shop.handleWebApp(s.deps, { initData: ID1, action: 'myHist', h: sh.h });
  assert.equal(hist.body.rows.length, 3);
  assert.deepEqual(hist.body.rows.map(r => r.k), ['s', 's', 'p']);
  assert.equal(hist.body.rows[0].no, 'A-102'); assert.equal(hist.body.rows[0].credit, 70000); assert.equal(hist.body.rows[0].pay, 'credit');
  assert.equal(hist.body.rows[1].items.length, 2); assert.equal(hist.body.rows[2].total, 30000);
  assert.ok(!hist.body.rows.some(r => r.no === 'A-103'), 'boshqa mijoz cheki yo\'q');
  const other = await shop.handleWebApp(s.deps, { initData: initData({ id: CUST2 }), action: 'myHist', h: sh.h });
  assert.equal(other.body.code, 'not_found');
  await shop.handleWebApp(s.deps, { initData: ID1, action: 'myNotify', h: sh.h, on: false });
  assert.equal(s.db.store['tgCustLink/' + BID + '_c1'].notify, false);
  const r = await CU.onSale(s.deps, BID, s.db.store['businesses/' + BID + '/sales/s2']);
  assert.equal(r.skipped, 'not_linked', 'o\'chirilgan — chek kelmaydi');
  await shop.handleWebApp(s.deps, { initData: ID1, action: 'myUnlink', h: sh.h });
  assert.ok(!s.db.store['tgCustLink/' + BID + '_c1']);
  assert.equal((await shop.handleWebApp(s.deps, { initData: ID1, action: 'myHome' })).body.shops.length, 0);
});

test('chek botga: naqd — oddiy; nasiya — qarz va "to\'g\'ri / savolim bor"; savol egasiga; eski chek yuborilmaydi; do\'kon o\'chirsa yuborilmaydi', async () => {
  const s = mk();
  s.db.store['tgCustLink/' + BID + '_c1'] = { uid: String(CUST), bid: BID, cid: 'c1', at: 1, by: 'code', notify: true };
  s.db.store['tgCust/' + CUST] = { shops: { [BID]: { cid: 'c1', at: 1 } }, lang: 'uz' };
  const sale = { id: 's9', receiptNumber: 'A-200', date: new Date(NOW - 60000).toISOString(), total: 94000, paymentType: 'credit', customerId: 'c1', splitPayments: [{ method: 'cash', amount: 50000 }, { method: 'credit', amount: 44000 }], items: [{ name: 'Cola <1L>', qty: 2, price: 12000, unit: 'dona' }, { name: 'Shakar', qty: 5, price: 14000, unit: 'kg' }] };
  const r = await CU.onSale(s.deps, BID, sale);
  assert.equal(r.sent, true); assert.equal(r.credit, 44000);
  const m = to(s.tg, CUST).pop();
  assert.ok(/Chek №A-200/.test(m.text) && /Cola &lt;1L&gt; × 2/.test(m.text) && /Shakar × 5 kg/.test(m.text) && /94 000/.test(m.text) && /Aralash/.test(m.text) && /Nasiyaga yozildi: <b>44 000/.test(m.text) && /Umumiy qarzingiz: <b>120 000/.test(m.text), m.text);
  assert.equal(m.reply_markup.inline_keyboard[0].length, 2);
  const cb = (d) => ({ callback_query: { id: 'q', data: d, from: { id: CUST }, message: { message_id: 3, chat: { id: CUST, type: 'private' } } } });
  s.db.store['businesses/' + BID + '/sales/s9'] = sale;
  let o = await core.handleUpdate(s.deps, cb('cu:ok:' + BID + ':s9'));
  assert.equal(o.cb, 'ok'); assert.ok(to(s.tg, OWNER).pop().text.includes('tasdiqladi'));
  o = await core.handleUpdate(s.deps, cb('cu:q:' + BID + ':s9'));
  assert.equal(o.cb, 'ask');
  const t = await core.handleUpdate(s.deps, msg(CUST, 'Shakar 4 kg edi'));
  assert.equal(t.custQ, 's9'); assert.equal(t.n, 1);
  assert.ok(to(s.tg, OWNER).pop().text.includes('Shakar 4 kg edi'));
  const o2 = await core.handleUpdate(s.deps, cb('cu:ok:' + BID + ':s3'));
  assert.equal(o2.cb, 'not_found', 'boshqa mijoz cheki');
  const cash = Object.assign({}, sale, { id: 's10', paymentType: 'cash', splitPayments: null });
  await CU.onSale(s.deps, BID, cash);
  const m2 = to(s.tg, CUST).pop(); assert.ok(/Naqd/.test(m2.text) && !m2.reply_markup);
  assert.equal((await CU.onSale(s.deps, BID, Object.assign({}, cash, { date: new Date(NOW - 2 * DAY).toISOString() }))).skipped, 'old');
  assert.equal((await CU.onSale(s.deps, BID, Object.assign({}, cash, { customerId: 'c2' }))).skipped, 'not_linked');
  s.db.store['tgShop/' + BID].custReceipts = false;
  assert.equal((await CU.onSale(s.deps, BID, cash)).skipped, 'off');
});

test('to\'lov tasdig\'i: summa, qoldiq; to\'liq yopilsa — rahmat; oddiy "sale" yozuvi yuborilmaydi', async () => {
  const s = mk();
  s.db.store['tgCustLink/' + BID + '_c1'] = { uid: String(CUST), bid: BID, cid: 'c1', at: 1, by: 'code', notify: true };
  s.db.store['tgCust/' + CUST] = { shops: { [BID]: { cid: 'c1', at: 1 } }, lang: 'ru' };
  let r = await CU.onLedger(s.deps, BID, { id: 'l9', customerId: 'c1', type: 'payment', method: 'cash', amount: 20000, date: new Date(NOW - 1000).toISOString(), note: 'qisman' });
  assert.equal(r.sent, true);
  let m = to(s.tg, CUST).pop(); assert.ok(/Оплата принята/.test(m.text) && /20 000/.test(m.text) && /120 000/.test(m.text) && /qisman/.test(m.text) && !/🎉/.test(m.text), m.text);
  s.db.store['businesses/' + BID + '/customers/c1'].debt = 0;
  await CU.onLedger(s.deps, BID, { id: 'l10', customerId: 'c1', type: 'payment', method: 'card', amount: 120000, date: new Date(NOW).toISOString() });
  assert.ok(/🎉/.test(to(s.tg, CUST).pop().text));
  assert.equal((await CU.onLedger(s.deps, BID, { id: 'l11', customerId: 'c1', type: 'sale', amount: 5000, date: new Date(NOW).toISOString() })).skipped, 'not_payment');
});

test('eslatma: ilovadan bir mijozga (matn bilan); jadval bo\'yicha — faqat yoqilgan do\'kon, 3 kundan tez emas, limitga yaqin ogohlantirish, egaga hisobot', async () => {
  const s = mk();
  s.db.store['staffAuth/u'] = { businessId: BID, role: 'admin' };
  s.db.store['tgCustLink/' + BID + '_c1'] = { uid: String(CUST), bid: BID, cid: 'c1', at: 1, by: 'code', notify: true };
  s.db.store['tgCust/' + CUST] = { shops: { [BID]: { cid: 'c1', at: 1 } }, lang: 'uz' };
  let r = await app(s.deps, 'cuRemind', { customerId: 'c1', text: 'Iltimos, juma kuni' }, true);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let m = to(s.tg, CUST).pop(); assert.ok(/eslatma/.test(m.text) && /120 000/.test(m.text) && /juma kuni/.test(m.text) && /\+998901112233/.test(m.text) && !/limitga/.test(m.text), m.text);
  assert.equal((await app(s.deps, 'cuRemind', { customerId: 'c2' }, true)).body.code, 'not_linked');
  let t = await CU.remindTick(s.deps, NOW + DAY);
  assert.equal(t.shops, 0, 'jadval yoqilmagan');
  s.db.store['tgShop/' + BID].debtRemind = { on: true, days: 7, minDebt: 50000 };
  t = await CU.remindTick(s.deps, NOW + DAY);
  assert.equal(t.shops, 1); assert.equal(t.sent, 0, 'kecha eslatilgan — 7 kun o\'tmagan');
  s.db.store['businesses/' + BID + '/customers/c1'].debt = 450000;
  t = await CU.remindTick(s.deps, NOW + 8 * DAY);
  assert.equal(t.sent, 1);
  m = to(s.tg, CUST).pop(); assert.ok(/450 000/.test(m.text) && /limitga yaqin/.test(m.text) && /500 000/.test(m.text), m.text);
  assert.ok(to(s.tg, OWNER).pop().text.includes('1 ta mijozga'));
  t = await CU.remindTick(s.deps, NOW + 8 * DAY + 3600000);
  assert.equal(t.shops, 0, 'bugun yuborilgan');
});

test('/mening buyrug\'i: ulanmagan — yo\'riqnoma, ulangan — sahifa tugmasi; menyuda /mening bor', async () => {
  const s = mk();
  let r = await core.handleUpdate(s.deps, msg(CUST2, '/mening'));
  assert.equal(r.my, false); assert.ok(/ulanmagan/.test(to(s.tg, CUST2).pop().text));
  s.db.store['tgCust/' + CUST] = { shops: { [BID]: { cid: 'c1', at: 1 } } };
  r = await core.handleUpdate(s.deps, msg(CUST, '/my'));
  assert.equal(r.my, true); assert.ok(to(s.tg, CUST).pop().reply_markup.inline_keyboard[0][0].web_app.url.endsWith('?v=my'));
  const cmds = require('../src/telegram/cmds').cmdList(s.deps, 'uz');
  assert.ok(cmds.some(c => c.command === 'mening'));
});

/* fix157-custuni: universal — raqam bo'yicha barcha do'konlar (indeks), sotuv/to'lovda o'zi ulanish, uzilgan qayta ulanmaydi */
test('universal: kontakt yuborilsa indeksdagi barcha do\'konlarga ulanadi; o\'chirilgan do\'kon va raqami mos kelmagan yozuv o\'tkazib yuboriladi', async () => {
  const s = mk();
  s.db.store['debtLinks/' + BID + '__c1'] = { bid: BID, cid: 'c1', phoneKey: '998935556677', name: 'Dilnoza' };
  s.db.store['debtLinks/' + BID2 + '__x1'] = { bid: BID2, cid: 'x1', phoneKey: '998935556677', name: 'Dilnoza B' };
  s.db.store['debtLinks/bizC__z1'] = { bid: 'bizC', cid: 'z1', phoneKey: '998935556677' };
  s.db.store['businesses/bizC'] = { businessName: 'C' }; s.db.store['businesses/bizC/customers/z1'] = { id: 'z1', phone: '+998 90 000 00 00' };
  s.db.store['debtLinks/bizD__d1'] = { bid: 'bizD', cid: 'd1', phoneKey: '998935556677' };
  s.db.store['businesses/bizD'] = { businessName: 'D' }; s.db.store['businesses/bizD/customers/d1'] = { id: 'd1', phone: '935556677' }; s.db.store['tgShop/bizD'] = { custByPhone: false };
  s.db.store['tgCust/' + CUST] = { lang: 'uz' };
  const r = await core.handleUpdate(s.deps, { message: { message_id: 2, chat: { id: CUST, type: 'private' }, from: { id: CUST, language_code: 'uz' }, contact: { user_id: CUST, phone_number: '+998935556677', first_name: 'Dilnoza' } } });
  assert.equal(r.contact, 'saved');
  assert.equal(s.db.store['tgCustLink/' + BID + '_c1'].by, 'phone');
  assert.equal(s.db.store['tgCustLink/' + BID2 + '_x1'].by, 'phone', 'muomala qilmagan do\'kon ham — indeks orqali');
  assert.ok(!s.db.store['tgCustLink/bizC_z1'], 'raqami mos emas');
  assert.ok(!s.db.store['tgCustLink/bizD_d1'], 'do\'kon raqam bo\'yicha ulanishni o\'chirgan');
  const msgs = to(s.tg, CUST).filter(m => /ulandingiz/.test(m.text));
  assert.equal(msgs.length, 2); assert.ok(msgs.some(m => /Boshqa/.test(m.text)));
  assert.equal(CU.intlKey('+998 93 555 66 77'), '998935556677'); assert.equal(CU.intlKey('935556677'), '998935556677'); assert.equal(CU.intlKey('0099893'), '');
});
test('universal: do\'kon nasiya sotuv yozganda ulanmagan mijoz raqami botdagi raqamga mos kelsa — o\'zi ulanadi va chek keladi; to\'lovda ham; raqam yo\'q bo\'lsa — yo\'q', async () => {
  const s = mk();
  s.db.store['tgCust/' + CUST] = { lang: 'uz', phone: '+998935556677', phoneOk: true };
  s.db.store['tgPhone/935556677'] = { uid: String(CUST), at: 1 };
  const sale = { id: 's9', receiptNumber: 'B-7', date: new Date(NOW).toISOString(), total: 50000, paymentType: 'credit', customerId: 'x1', items: [{ name: 'Osh', qty: 1, price: 50000 }] };
  const r = await CU.onSale(s.deps, BID2, sale);
  assert.ok(r.sent, JSON.stringify(r));
  assert.equal(s.db.store['tgCustLink/' + BID2 + '_x1'].by, 'phone');
  assert.ok(to(s.tg, CUST).some(m => /ulandingiz/.test(m.text) && /Boshqa/.test(m.text)));
  assert.ok(to(s.tg, CUST).some(m => /50 000/.test(m.text) && /B-7/.test(m.text)), 'chek');
  const r2 = await CU.onLedger(s.deps, BID2, { id: 'l9', customerId: 'x1', type: 'payment', method: 'cash', amount: 100, date: new Date(NOW).toISOString() });
  assert.ok(r2.sent);
  const r3 = await CU.onSale(s.deps, BID, Object.assign({}, sale, { id: 's10', customerId: 'c2' }));
  assert.equal(r3.skipped, 'not_linked', 'c2 raqami (901234567) botda yo\'q');
  assert.ok(!s.db.store['tgCustLink/' + BID + '_c2']);
});
test('universal: mijoz do\'kondan uzilsa — sotuvda qayta avtomatik ulanmaydi; havola bilan qayta ulansa — yana ishlaydi; /mening raqam bor bo\'lsa indeksdan topadi', async () => {
  const s = mk();
  s.db.store['tgCust/' + CUST] = { lang: 'uz', phone: '+998935556677', phoneOk: true, shops: { [BID2]: { cid: 'x1', at: 1 } } };
  s.db.store['tgPhone/935556677'] = { uid: String(CUST), at: 1 };
  s.db.store['tgCustLink/' + BID2 + '_x1'] = { uid: String(CUST), bid: BID2, cid: 'x1', at: 1, by: 'phone', notify: true };
  const u = await CU.handleMy(s.deps, { id: CUST }, 'myUnlink', { bid: BID2, h: require('crypto').createHash('sha256').update('my|' + BID2 + '|' + CUST).digest('hex').slice(0, 12) });
  assert.ok(u.body.removed, JSON.stringify(u));
  const sale = { id: 's9', receiptNumber: 'B-8', date: new Date(NOW).toISOString(), total: 500, paymentType: 'credit', customerId: 'x1', items: [] };
  assert.equal((await CU.onSale(s.deps, BID2, sale)).skipped, 'not_linked');
  assert.ok(!s.db.store['tgCustLink/' + BID2 + '_x1']);
  // egadan havola bilan qayta ulash
  const l = await core.handleApi(s.deps, BID2, { action: 'cuLink', customerId: 'x1' });
  const code = l.body.url.split('start=c_')[1];
  await core.handleUpdate(s.deps, { message: { message_id: 3, chat: { id: CUST, type: 'private' }, from: { id: CUST }, text: '/start c_' + code } });
  assert.equal(s.db.store['tgCustLink/' + BID2 + '_x1'].by, 'code');
  assert.ok(!s.db.store['tgCust/' + CUST].noAuto[BID2]);
  assert.ok((await CU.onSale(s.deps, BID2, Object.assign({}, sale, { id: 's11' }))).sent);
  // /mening: do'kon yo'q, raqam bor — indeksdan
  const s2 = mk();
  s2.db.store['tgCust/' + CUST] = { lang: 'uz', phone: '+998935556677', phoneOk: true };
  s2.db.store['debtLinks/' + BID + '__c1'] = { bid: BID, cid: 'c1', phoneKey: '998935556677' };
  const m = await CU.sendMy(s2.deps, CUST, 'uz');
  assert.equal(m.my, true); assert.equal(s2.db.store['tgCustLink/' + BID + '_c1'].by, 'phone');
});
