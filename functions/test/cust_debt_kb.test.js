'use strict';
/* fix209-custdebt / fix209-custkb: mijoz botidagi «jami qarz» — amaldan KEYINGI qiymat (ilova yozgan debtAfter yoki xavfsiz kutish);
   «Buyurtma berish» / «Mening sahifam» — oddiy matn tugmasi → inline web_app (initData beradi); eski klaviatura signali. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb, fakeTg } = require('./helpers/tgFake');
const core = require('../src/telegram/core');
const shop = require('../src/telegram/shop');
const CU = require('../src/telegram/cust');
const CT = require('../src/telegram/custTexts');

const KEY = core.keyFromToken('123:TEST'), WEBKEY = shop.webKeyFromToken('123:TEST');
const BID = 'bizA', BID2 = 'bizB', OWNER = '5550001', CUST = 777001;
const NOW = Date.UTC(2026, 9, 21, 7, 0, 0);
const CREF = 'businesses/' + BID + '/customers/c1';
function seed(debt) {
  const s = {};
  s['businesses/' + BID] = { businessName: 'Salqin', currency: 'UZS', timeZone: 'Asia/Tashkent' };
  s['businesses/' + BID2] = { businessName: 'Anor', currency: 'UZS' };
  s['tgBiz/' + BID] = { chats: { [OWNER]: { name: 'Ega', at: 1, sig: core.sigOf(KEY, BID, OWNER) } }, lang: 'uz' };
  s['tgChats/' + OWNER] = { bids: [BID] };
  s['tgShop/' + BID] = { enabled: true, slug: 'salqin' }; s['tgSlug/salqin'] = { bid: BID };
  s['tgShop/' + BID2] = { enabled: true, slug: 'anor' }; s['tgSlug/anor'] = { bid: BID2 };
  s[CREF] = { id: 'c1', name: 'Dilnoza', debt: debt == null ? 300000 : debt };
  s['tgCustLink/' + BID + '_c1'] = { uid: String(CUST), bid: BID, cid: 'c1', at: 1, by: 'code', notify: true };
  s['tgCust/' + CUST] = { lang: 'uz', shops: { [BID]: { cid: 'c1', at: 1 } } };
  return s;
}
function mk(s, onSleep) {
  const db = fakeDb(s || seed()); const tg = fakeTg(); let now = NOW, slept = 0;
  const deps = { db, tg, key: KEY, webKey: WEBKEY, botName: 'savdo_pos_bot', nowMs: () => now,
    sleep: async (ms) => { slept += ms; now += ms; if (onSleep) onSleep(slept, db); } };
  return { db, tg, deps, slept: () => slept };
}
const last = (tg) => tg.sent.filter(m => String(m.chat_id) === String(CUST)).pop();
const iso = (ms) => new Date(ms).toISOString();
const msg = (text, extra) => ({ message: Object.assign({ message_id: 1, chat: { id: CUST, type: 'private' }, from: { id: CUST, language_code: 'uz' }, text: text }, extra || {}) });

test('qarz 300 000: +50 000 → jami 350 000; 100 000 to\'lov → qolgan 250 000; nasiya 80 000 → chekda 330 000; to\'liq to\'lov → to\'liq yopildi', async () => {
  const s = mk();   // mijoz hujjati ATAYLAB eski (300 000) — bot faqat yozuvdagi debtAfter'ga tayanadi
  await CU.onLedger(s.deps, BID, { id: 'e1', customerId: 'c1', type: 'sale', amount: 50000, date: iso(NOW), note: '', debtAfter: 350000 });
  assert.match(last(s.tg).text, /qarz yozildi: <b>50 000/); assert.match(last(s.tg).text, /Jami qarzingiz: <b>350 000/);
  await CU.onLedger(s.deps, BID, { id: 'e2', customerId: 'c1', type: 'payment', method: 'cash', amount: 100000, date: iso(NOW), debtAfter: 250000 });
  assert.match(last(s.tg).text, /100 000/); assert.match(last(s.tg).text, /Qolgan qarz: <b>250 000/); assert.ok(!/🎉/.test(last(s.tg).text));
  await CU.onSale(s.deps, BID, { id: 's1', receiptNumber: 'A-1', date: iso(NOW), total: 80000, paymentType: 'credit', customerId: 'c1', items: [{ name: 'Non', qty: 1, price: 80000 }], debtAfter: 330000 });
  assert.match(last(s.tg).text, /Umumiy qarzingiz: <b>330 000/);
  await CU.onLedger(s.deps, BID, { id: 'e3', customerId: 'c1', type: 'payment', method: 'cash', amount: 330000, date: iso(NOW), debtAfter: 0 });
  assert.match(last(s.tg).text, /Qolgan qarz: <b>0/); assert.match(last(s.tg).text, /to'liq yopildi/);
  assert.equal(s.slept(), 0, 'yangi ilova yozuvi — kutilmaydi');
});

test('1 soniya ichida 3 ta amal — har xabarda o\'z raqami (mijoz hujjati hali yangilanmagan)', async () => {
  const s = mk();
  await Promise.all([
    CU.onLedger(s.deps, BID, { id: 'r1', customerId: 'c1', type: 'sale', amount: 10000, date: iso(NOW), debtAfter: 310000 }),
    CU.onLedger(s.deps, BID, { id: 'r2', customerId: 'c1', type: 'payment', method: 'card', amount: 60000, date: iso(NOW + 300), debtAfter: 250000 }),
    CU.onLedger(s.deps, BID, { id: 'r3', customerId: 'c1', type: 'sale', amount: 5000, date: iso(NOW + 700), debtAfter: 255000 })
  ]);
  const t = s.tg.sent.filter(m => String(m.chat_id) === String(CUST)).map(m => m.text);
  assert.equal(t.length, 3);
  assert.ok(t.some(x => /10 000/.test(x) && /310 000/.test(x)) && t.some(x => /60 000/.test(x) && /250 000/.test(x)) && t.some(x => /5 000/.test(x) && /255 000/.test(x)), t.join('\n---\n'));
});

test('eski ilova (debtAfter yo\'q): hujjat yangilanishini kutadi va to\'g\'ri raqam; yangilanmasa — qarz qatorisiz, summa bor', async () => {
  const s = mk(null, (slept, db) => { if (slept === 1500) db.store[CREF].debt = 350000; });   // ilova 1,5 soniyadan keyin qarzni yozadi
  await CU.onLedger(s.deps, BID, { id: 'o1', customerId: 'c1', type: 'sale', amount: 50000, date: iso(NOW) });
  assert.match(last(s.tg).text, /Jami qarzingiz: <b>350 000/); assert.equal(s.slept(), 1500);
  const s2 = mk();   // hujjat umuman yangilanmadi (internet yo'q)
  await CU.onLedger(s2.deps, BID, { id: 'o2', customerId: 'c1', type: 'payment', method: 'cash', amount: 100000, date: iso(NOW) });
  const m = last(s2.tg).text;
  assert.match(m, /100 000/); assert.ok(!/Qolgan qarz/.test(m) && !/300 000/.test(m), m); assert.ok(s2.slept() <= 3000);
  const s3 = mk(null, (slept, db) => { if (slept === 500) db.store[CREF].debt = 260000; });   // boshqa amal aralashdi (−40 000) — kutilgan 200 000 emas
  await CU.onLedger(s3.deps, BID, { id: 'o3', customerId: 'c1', type: 'payment', method: 'cash', amount: 100000, date: iso(NOW) });
  assert.ok(!/Qolgan qarz/.test(last(s3.tg).text), 'noto\'g\'ri raqam ko\'rsatilmaydi');
  const s4 = mk(null, (slept, db) => { if (slept === 1000) db.store[CREF].debt = 380000; });   // eski ilova nasiya cheki
  await CU.onSale(s4.deps, BID, { id: 's2', receiptNumber: 'A-2', date: iso(NOW), total: 80000, paymentType: 'credit', customerId: 'c1', items: [] });
  assert.match(last(s4.tg).text, /Umumiy qarzingiz: <b>380 000/);
  const s5 = mk();
  await CU.onSale(s5.deps, BID, { id: 's3', receiptNumber: 'A-3', date: iso(NOW), total: 80000, paymentType: 'credit', customerId: 'c1', items: [] });
  assert.ok(!/Umumiy qarzingiz/.test(last(s5.tg).text) && /Nasiyaga yozildi/.test(last(s5.tg).text));
  const s6 = mk(seed(0), (slept, db) => { if (slept === 1500) db.store[CREF].debt = 0; });
  await CU.onLedger(s6.deps, BID, { id: 'o6', customerId: 'c1', type: 'payment', method: 'cash', amount: 1, date: iso(NOW) });
  assert.ok(!/to'liq yopildi/.test(last(s6.tg).text) || /Qolgan qarz: <b>0/.test(last(s6.tg).text));
});

test('klaviatura: oddiy matn tugmalari; do\'kon tugmasi — faqat do\'kon bo\'lsa', () => {
  const kb = CU.custKb({}, { lastShop: 'salqin' }, 'uz').keyboard;
  assert.equal(kb[0][0].text, '👤 Mening sahifam'); assert.equal(kb[1][0].text, '🛒 Buyurtma berish');
  assert.ok(kb.every(r => r.every(b => !b.web_app)), 'klaviaturada web_app yo\'q');
  assert.equal(CU.custKb({}, {}, 'uz').keyboard.length, 2, 'do\'koni yo\'q — Buyurtma tugmasi yo\'q');
  assert.equal(CU.custKb({}, { shops: { x: {} } }, 'uz').keyboard.length, 3);
  ['uz', 'ru', 'en', 'kk', 'ky', 'tg'].forEach(l => {
    assert.equal(CU.kbKind(CT.txt('kbShop', l)), 'shop', l); assert.equal(CU.kbKind(CT.txt('btnMy', l)), 'my', l);
    ['shopOne', 'shopPick', 'shopNone', 'kbUpdated'].forEach(k => assert.ok(CT.T[k][l], k + '.' + l));
  });
});

test('«Buyurtma berish»: bitta do\'kon — katalog inline tugmasi; bir nechta — ro\'yxat; do\'kon yo\'q — tushuntirish', async () => {
  const s = mk();
  let r = await core.handleUpdate(s.deps, msg('🛒 Buyurtma berish'));
  assert.equal(r.shops, 1);
  let m = last(s.tg); assert.match(m.text, /Salqin/); assert.ok(m.reply_markup.inline_keyboard[0][0].web_app.url.endsWith('?s=salqin'));
  s.db.store['tgCust/' + CUST] = { lang: 'uz', lastShop: 'anor', shops: { [BID]: { cid: 'c1', at: 1 } } };
  r = await core.handleUpdate(s.deps, msg('🛒 Buyurtma berish'));
  assert.equal(r.shops, 2);
  m = last(s.tg); const urls = m.reply_markup.inline_keyboard.map(x => x[0].web_app.url);
  assert.ok(urls[0].endsWith('?s=anor') && urls[1].endsWith('?s=salqin'), urls.join());
  s.db.store['tgShop/' + BID2].enabled = false;
  r = await core.handleUpdate(s.deps, msg('🛒 Buyurtma berish'));
  assert.equal(r.shops, 1, 'bot orqali sotuvi o\'chiq do\'kon ko\'rsatilmaydi');
  s.db.store['tgCust/' + CUST] = { lang: 'ru' };
  r = await core.handleUpdate(s.deps, msg('🛒 Сделать заказ'));
  assert.equal(r.shops, 0); assert.match(last(s.tg).text, /Пока нет магазина/); assert.ok(last(s.tg).reply_markup.keyboard);
});

test('«Mening sahifam» klaviatura tugmasi — inline web_app (initData beradi)', async () => {
  const s = mk();
  const r = await core.handleUpdate(s.deps, msg('👤 Mening sahifam'));
  assert.ok(r.my);
  const m = last(s.tg); assert.ok(m.reply_markup.inline_keyboard[0][0].web_app.url.endsWith('?v=my'));
});

test('eski klaviaturadan ochilgan sahifa signali (web_app_data): to\'g\'ri tugma + klaviatura bir marta yangilanadi', async () => {
  const s = mk();
  let r = await core.handleUpdate(s.deps, msg(undefined, { web_app_data: { data: JSON.stringify({ v: 'shop', s: 'salqin' }), button_text: '🛒 Buyurtma berish' } }));
  assert.equal(r.webAppData, 'shop'); assert.equal(r.shops, 1);
  const sent = s.tg.sent.filter(m => String(m.chat_id) === String(CUST));
  assert.ok(sent[0].reply_markup.inline_keyboard[0][0].web_app.url.endsWith('?s=salqin'));
  assert.match(sent[1].text, /yangilandi/); assert.ok(sent[1].reply_markup.keyboard.every(row => row.every(b => !b.web_app)));
  assert.equal(s.db.store['tgCust/' + CUST].kbV, CU.KB_V);
  r = await core.handleUpdate(s.deps, msg(undefined, { web_app_data: { data: JSON.stringify({ v: 'my' }) } }));
  assert.equal(r.webAppData, 'my');
  assert.ok(last(s.tg).reply_markup.inline_keyboard[0][0].web_app.url.endsWith('?v=my'));
  assert.equal(s.tg.sent.filter(m => /yangilandi/.test(m.text || '')).length, 1, 'klaviatura faqat bir marta yangilanadi');
  r = await core.handleUpdate(s.deps, msg(undefined, { web_app_data: { data: '{buzuq' } }));
  assert.equal(r.webAppData, 'shop');
  r = await core.handleUpdate(s.deps, msg(undefined, { web_app_data: { data: JSON.stringify({ v: 'shop', s: '../x' }) } }));
  assert.ok(r.shops >= 1);
});

test('egasi chatida eski bot oqimlari buzilmagan: oddiy matn, buyruqlar', async () => {
  const s = mk();
  const r = await core.handleUpdate(s.deps, { message: { message_id: 1, chat: { id: Number(OWNER), type: 'private' }, from: { id: Number(OWNER), language_code: 'uz' }, text: 'salom' } });
  assert.ok(r && r.reply && /Salqin/.test(r.reply));
});
