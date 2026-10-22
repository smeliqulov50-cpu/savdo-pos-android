'use strict';
/* fix121-tg2: Telegram bot 2-bosqich — sozlamalar, kunlik hisobot, kam qolgan tovar, smena, katta chegirma, chek o'chirish/qaytarish, sinov. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb, fakeTg } = require('./helpers/tgFake');
const core = require('../src/telegram/core');
const R = require('../src/telegram/reports');
const M = require('../src/telegram/msgs');
const DR = require('../src/push/dailyReport');

const KEY = core.keyFromToken('123:TEST');
const BID = 'OWNER1';
const NOW = Date.parse('2026-10-16T16:05:00Z');          // Toshkent 21:05
const DAY_ISO = function (hhmm) { return '2026-10-16T' + hhmm + ':00.000Z'; };   // UTC vaqt

function chatsFor(bid, ids) {
  const c = {}; ids.forEach(function (id, i) { c[id] = { name: 'Chat ' + id, username: '', at: 1000 + i, sig: core.sigOf(KEY, bid, id) }; });
  return c;
}
function seedBase(extra) {
  const s = {
    'businesses/OWNER1': { businessName: 'Do\'kon <A&B>', currency: 'UZS', timeZone: 'Asia/Tashkent', lowStockThreshold: 5 },
    'tgBiz/OWNER1': { chats: chatsFor(BID, ['111', '222']), lang: 'uz' },
    'tgChats/111': { bids: [BID] }, 'tgChats/222': { bids: [BID] },
    'staffAuth/STAFF1': { businessId: BID }
  };
  return Object.assign(s, extra || {});
}
function mk(seed, nowMs) {
  const db = fakeDb(seed), tg = fakeTg();
  let t = nowMs || NOW;
  const deps = { db: db, tg: tg, key: KEY, botName: 'savdo_pos_bot', nowMs: function () { return t; }, sleep: async function () {} };
  deps.setNow = function (x) { t = x; };
  return deps;
}
async function prefs(deps, p) { const r = await core.handleApi(deps, BID, { action: 'prefs', prefs: p }); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.prefs; }

/* ---------- sozlamalar ---------- */
test('normPrefs: hammasi standart holatda o\'chiq; vaqt va foiz chegaralanadi', () => {
  assert.deepEqual(R.normPrefs(null), R.DEF);
  const p = R.normPrefs({ daily: 'true', dailyTime: '09:00', low: true, lowTime: '25:00', disc: true, discPct: 150, rcpt: 1, shift: true });
  assert.equal(p.daily, false); assert.equal(p.dailyTime, '12:00');      // kunlik hisobot 12:00 dan oldin bo'lmaydi
  assert.equal(p.low, true); assert.equal(p.lowTime, '09:00');           // noto'g'ri vaqt -> standart
  assert.equal(p.discPct, 90); assert.equal(p.rcpt, false); assert.equal(p.shift, true);
  assert.equal(R.normPrefs({ discPct: 0 }).discPct, 20);
  assert.equal(R.normPrefs({ dailyTime: '23:59' }).dailyTime, '23:50');
  assert.equal(R.normPrefs({ lowTime: '06:30' }).lowTime, '06:30');
});

test('API: faqat ega saqlaydi; status sozlamalarni qaytaradi; xodimga yo\'q', async () => {
  const d = mk(seedBase());
  let st = await core.handleApi(d, BID, { action: 'status' });
  assert.deepEqual(st.body.prefs, R.DEF);
  const saved = await prefs(d, { daily: true, dailyTime: '20:30', disc: true, discPct: 15 });
  assert.equal(saved.daily, true); assert.equal(saved.dailyTime, '20:30'); assert.equal(saved.discPct, 15);
  const doc = d.db.store['tgPrefs/OWNER1'];
  assert.equal(doc.sched, true); assert.equal(doc.any, true); assert.equal(doc.tz, 'Asia/Tashkent');
  st = await core.handleApi(d, BID, { action: 'status' });
  assert.equal(st.body.prefs.dailyTime, '20:30');
  const s2 = await core.handleApi(d, 'STAFF1', { action: 'status' });
  assert.equal(s2.body.owner, false); assert.equal(s2.body.prefs, undefined);
  const s3 = await core.handleApi(d, 'STAFF1', { action: 'prefs', prefs: { daily: false } });
  assert.equal(s3.status, 403); assert.equal(s3.body.code, 'owner_only');
  const s4 = await core.handleApi(d, 'STAFF1', { action: 'test', kind: 'daily' });
  assert.equal(s4.status, 403);
  await prefs(d, { shift: true });
  assert.equal(d.db.store['tgPrefs/OWNER1'].sched, false);   // jadvalga faqat kunlik/kam qolgan kiradi
  assert.equal(d.db.store['tgPrefs/OWNER1'].any, true);
});

/* ---------- kunlik hisobot ---------- */
function salesSeed() {
  return seedBase({
    'businesses/OWNER1': { businessName: 'Do\'kon <A&B>', currency: 'UZS', timeZone: 'Asia/Tashkent', lowStockThreshold: 5,
      branches: [{ id: 'main', name: 'Markaz' }, { id: 'b2', name: 'Chilonzor' }] },
    'businesses/OWNER1/sales/s1': { date: DAY_ISO('05:00'), total: 100000, paymentType: 'cash', branchId: 'main', items: [{ productId: 'p1', name: 'Cola 1L', qty: 10, price: 10000, costPrice: 7000 }] },
    'businesses/OWNER1/sales/s2': { date: DAY_ISO('06:00'), total: 90000, discountAmount: 10000, subtotal: 100000, branchId: 'b2', splitPayments: [{ method: 'card', amount: 50000 }, { method: 'credit', amount: 40000 }],
      items: [{ productId: 'p2', name: 'Non', qty: 20, price: 3000, costPrice: 2000 }, { productId: 'p1', name: 'Cola 1L (quti)', qty: 1, price: 40000, costPrice: 28000, saleMode: 'box', unitsPerBox: 6 }] },
    'businesses/OWNER1/sales/s3': { date: DAY_ISO('07:00'), total: 50000, paymentType: 'card', branchId: 'main', items: [{ productId: 'p3', name: 'Shakar <1kg>', qty: 2, price: 25000, costPrice: 20000 }] },
    'businesses/OWNER1/sales/old': { date: '2026-10-15T10:00:00.000Z', total: 999999, paymentType: 'cash', items: [{ productId: 'p9', name: 'Kecha', qty: 1, price: 999999 }] },
    'businesses/OWNER1/sales/rf': { date: '2026-10-15T10:00:00.000Z', refundedAt: DAY_ISO('08:00'), refunded: true, total: 20000, paymentType: 'cash', items: [] },
    'businesses/OWNER1/expenses/e1': { date: DAY_ISO('09:00'), amount: 15000, branchId: 'b2' },
    'businesses/OWNER1/expenses/e2': { date: DAY_ISO('09:00'), amount: 500000, category: 'purchase' },
    'businesses/OWNER1/ledger/l1': { date: DAY_ISO('10:00'), type: 'payment', method: 'cash', amount: 30000 },
    'businesses/OWNER1/customers/c1': { debt: 70000 }, 'businesses/OWNER1/customers/c2': { debt: 5000, hidden: true }
  });
}
test('kunlik hisobot: raqamlar push "Kunlik xulosa" bilan bir xil; top-5, filiallar, qutidagi dona', async () => {
  const d = mk(salesSeed());
  const day = DR.dayInfo(new Date(NOW), 'Asia/Tashkent');
  const ctx = { biz: d.db.store['businesses/OWNER1'], lang: 'uz', tz: 'Asia/Tashkent', cur: 'UZS', shop: 'X', branches: d.db.store['businesses/OWNER1'].branches };
  const a = await R.computeDaily(d.db, BID, day, ctx);
  const b = await DR.computeSummary(d.db, BID, day);
  ['count', 'revenue', 'cash', 'card', 'credit', 'profit', 'expenses', 'net', 'debtPaid', 'refundCount', 'refundTotal', 'totalDebt'].forEach(function (k) { assert.equal(a[k], b[k], k); });
  assert.equal(a.count, 3); assert.equal(a.revenue, 240000); assert.equal(a.cash, 100000); assert.equal(a.card, 100000); assert.equal(a.credit, 40000);
  assert.equal(a.expenses, 15000); assert.equal(a.totalDebt, 70000); assert.equal(a.refundCount, 1);
  assert.equal(a.top[0].name, 'Cola 1L'); assert.equal(a.top[0].qty, 16); assert.equal(a.top[0].sum, 140000);   // 10 dona + 1 quti (6)
  assert.equal(a.top.length, 3);
  assert.equal(a.branches.length, 2);
  const m = a.branches.filter(function (x) { return x.id === 'main'; })[0], c = a.branches.filter(function (x) { return x.id === 'b2'; })[0];
  assert.equal(m.name, 'Markaz'); assert.equal(m.revenue, 150000); assert.equal(m.count, 2);
  assert.equal(c.name, 'Chilonzor'); assert.equal(c.revenue, 90000); assert.equal(c.expenses, 15000);
  const txt = M.dailyText('uz', a, { shop: 'Do\'kon <A&B>', cur: 'UZS', dateStr: '16.10.2026' });
  assert.match(txt, /Do'kon &lt;A&amp;B&gt;/); assert.match(txt, /Shakar &lt;1kg&gt;/); assert.ok(txt.indexOf('<A&B>') === -1);
  assert.match(txt, /<b>240 000 so'm<\/b>/); assert.match(txt, /Filiallar/); assert.match(txt, /Chilonzor/); assert.match(txt, /Cola 1L — ×16 — 140 000/);
  assert.ok(txt.length < 4000);
});
test('kunlik hisobot: 6 tilda to\'liq, o\'rinbosarlar qolmaydi; savdo bo\'lmasa — "savdo bo\'lmadi" + jami qarz', async () => {
  const d = mk(salesSeed());
  const day = DR.dayInfo(new Date(NOW), 'Asia/Tashkent');
  const a = await R.computeDaily(d.db, BID, day, { biz: {}, lang: 'uz', tz: 'Asia/Tashkent', cur: 'UZS', shop: 'X', branches: [] });
  M.LANGS.forEach(function (l) {
    const t = M.dailyText(l, a, { shop: 'S', cur: 'UZS', dateStr: '16.10.2026', soFar: true, timeStr: '21:05', test: true });
    assert.ok(t.indexOf('{') === -1 && t.indexOf('undefined') === -1 && t.indexOf('NaN') === -1, l);
    assert.ok(t.indexOf('🧪') !== -1, l);
    ['shiftText', 'discText', 'rcptText'].forEach(function (f) {
      const s = M[f](l, { staffName: 'A', salesCount: 1, cashTotal: 1, cardTotal: 0, creditTotal: 0, expectedCash: 5, endCash: 3, receiptNumber: '7', discountAmount: 9, pct: 30, total: 21, cashierName: 'K', action: 'saleRefund', detail: '№ 7' }, { shop: 'S', cur: 'UZS', timeStr: '10:00' });
      assert.ok(s.indexOf('{') === -1 && s.indexOf('undefined') === -1 && s.indexOf('NaN') === -1, l + f);
    });
    const lt = M.lowText(l, { threshold: 5, groups: [{ id: 'main', name: 'M', items: [{ name: 'a', stock: 0, unit: 'kg' }] }] }, { shop: 'S' });
    assert.ok(lt.indexOf('{') === -1 && lt.indexOf('undefined') === -1, l);
  });
  const empty = await R.computeDaily(mk(seedBase({ 'businesses/OWNER1/customers/c1': { debt: 12000 } })).db, BID, day, { biz: {}, lang: 'uz', tz: 'Asia/Tashkent', cur: 'UZS', shop: 'X', branches: [] });
  const t = M.dailyText('uz', empty, { shop: 'S', cur: 'UZS', dateStr: '16.10.2026' });
  assert.match(t, /Bugun hali savdo bo'lmadi/); assert.match(t, /Umumiy qarzlar: 12 000 so'm/);
  assert.ok(t.indexOf('Filiallar') === -1 && t.indexOf("Ko'p sotilgan") === -1);
});

/* ---------- jadval ---------- */
test('jadval: vaqti kelganda bir marta; qayta tekshirishda yo\'q; ertasi kuni yana; vaqti kelmasa hech narsa o\'qilmaydi', async () => {
  const d = mk(salesSeed(), Date.parse('2026-10-16T14:00:00Z'));   // 19:00 Toshkent
  await prefs(d, { daily: true, dailyTime: '21:00' });
  const r0 = d.db.stat.reads;
  let st = await R.runTick(d, new Date(d.nowMs()));
  assert.equal(st.daily, 0); assert.equal(d.tg.sent.length, 0);
  assert.equal(d.db.stat.reads - r0, 1);                              // faqat tgPrefs so'rovi
  d.setNow(Date.parse('2026-10-16T16:01:00Z'));                       // 21:01
  st = await R.runTick(d, new Date(d.nowMs()));
  assert.equal(st.daily, 1); assert.equal(d.tg.sent.length, 2);       // 2 ta chat
  assert.equal(d.tg.sent[0].parse_mode, 'HTML'); assert.match(d.tg.sent[0].text, /Kunlik hisobot/); assert.match(d.tg.sent[0].text, /16\.10\.2026/);
  d.setNow(Date.parse('2026-10-16T16:11:00Z'));
  st = await R.runTick(d, new Date(d.nowMs()));
  assert.equal(st.daily, 0); assert.equal(d.tg.sent.length, 2);       // bugun yuborilgan
  d.setNow(Date.parse('2026-10-16T18:30:00Z'));                       // 23:30 — oyna (2 soat) tugagan bo'lsa ham bugun allaqachon
  st = await R.runTick(d, new Date(d.nowMs())); assert.equal(d.tg.sent.length, 2);
  d.setNow(Date.parse('2026-10-17T16:05:00Z'));                       // ertasi 21:05
  st = await R.runTick(d, new Date(d.nowMs()));
  assert.equal(st.daily, 1); assert.equal(d.tg.sent.length, 4); assert.match(d.tg.sent[3].text, /17\.10\.2026/);
});
test('jadval: oyna 2 soat (server kechiksa ham); o\'chiq bo\'lsa yo\'q; chat yo\'q bo\'lsa belgilanmaydi; soat poyasi', async () => {
  const d = mk(salesSeed(), Date.parse('2026-10-16T17:55:00Z'));   // 22:55 Toshkent — 21:00 dan 1 soat 55 daqiqa keyin
  await prefs(d, { daily: true, dailyTime: '21:00' });
  let st = await R.runTick(d, new Date(d.nowMs())); assert.equal(st.daily, 1);
  const d2 = mk(salesSeed(), Date.parse('2026-10-16T18:05:00Z'));  // 23:05 — 2 soatdan keyin: yuborilmaydi
  await prefs(d2, { daily: true, dailyTime: '21:00' });
  st = await R.runTick(d2, new Date(d2.nowMs())); assert.equal(st.daily, 0);
  const d3 = mk(salesSeed(), Date.parse('2026-10-16T16:05:00Z'));
  await prefs(d3, { daily: false, low: false, shift: true });
  st = await R.runTick(d3, new Date(d3.nowMs())); assert.equal(st.checked, 0); assert.equal(d3.tg.sent.length, 0);
  const s4 = salesSeed(); delete s4['tgBiz/OWNER1'];
  const d4 = mk(s4, Date.parse('2026-10-16T16:05:00Z'));
  await prefs(d4, { daily: true, dailyTime: '21:00' });
  st = await R.runTick(d4, new Date(d4.nowMs())); assert.equal(st.noChats, 1); assert.equal(d4.db.store['tgSent/OWNER1'], undefined);
  const s5 = salesSeed(); s5['businesses/OWNER1'].timeZone = 'Europe/Moscow';   // UTC+3: 16:05Z = 19:05 — hali emas
  const d5 = mk(s5, Date.parse('2026-10-16T16:05:00Z'));
  await prefs(d5, { daily: true, dailyTime: '21:00' });
  st = await R.runTick(d5, new Date(d5.nowMs())); assert.equal(st.daily, 0);
  d5.setNow(Date.parse('2026-10-16T18:02:00Z'));                                 // 21:02 Moskva
  st = await R.runTick(d5, new Date(d5.nowMs())); assert.equal(st.daily, 1);
  const tok = mk(salesSeed()); tok.key = null;
  st = await R.runTick(tok, new Date(NOW)); assert.equal(st.noKey, true);
});

/* ---------- kam qolgan tovarlar ---------- */
test('kam qolgan: ilovadagi stockStatus() qoidasi (har bir variant alohida, qoldiqsiz = 0), filiallar, 50 tadan ortig\'i qisqartiriladi', async () => {
  const seed = seedBase({
    'businesses/OWNER1': { businessName: 'D', timeZone: 'Asia/Tashkent', lowStockThreshold: 3, branches: [{ id: 'main', name: 'Markaz' }, { id: 'b2', name: 'Yunusobod' }] },
    'businesses/OWNER1/products/a': { name: 'Non', stock: 2, unit: 'dona' },
    'businesses/OWNER1/products/b': { name: 'Guruch', stock: 0, unit: 'kg', branchId: 'b2' },
    'businesses/OWNER1/products/c': { name: 'Ko\'p', stock: 50 },
    'businesses/OWNER1/products/d': { name: 'Qoldiqsiz' },
    'businesses/OWNER1/products/f': { name: 'Futbolka', variants: [{ name: 'M', stock: 0 }, { name: 'L', stock: 2 }, { name: 'XL', stock: 9 }] },
    'businesses/OWNER1/products/h': { name: 'Chegarada', stock: 3, unit: 'litr' },
    'businesses/OWNER1/products/m': { name: 'Minus', stock: -4 }
  });
  const d = mk(seed);
  const ctx = { biz: seed['businesses/OWNER1'], lang: 'uz', tz: 'Asia/Tashkent', cur: 'UZS', shop: 'D', branches: seed['businesses/OWNER1'].branches };
  const low = await R.computeLow(d.db, BID, ctx);
  assert.equal(low.threshold, 3);
  const names = low.groups.map(function (g) { return g.name + ':' + g.items.map(function (i) { return i.name; }).join(','); });
  assert.deepEqual(names, ['Markaz:Minus,Futbolka — M,Qoldiqsiz,Futbolka — L,Non,Chegarada', 'Yunusobod:Guruch']);
  const t = M.lowText('uz', low, { shop: 'D' });
  assert.match(t, /Guruch — 0 kg \(tugagan\)/); assert.match(t, /Non — 2 dona/); assert.match(t, /Chegarada — 3 litr/); assert.match(t, /🏬 <b>Yunusobod<\/b>/);
  assert.match(t, /Futbolka — M — 0 dona \(tugagan\)/); assert.match(t, /Minus — −4 dona \(tugagan\)/); assert.ok(t.indexOf('XL') === -1);
  const many = { threshold: 5, groups: [{ id: 'main', name: 'M', items: Array.from({ length: 70 }, function (_, i) { return { name: 'T' + i, stock: 1, unit: 'dona' }; }) }] };
  const tm = M.lowText('uz', many, { shop: 'D' });
  assert.match(tm, /yana 20 ta/); assert.ok(tm.length < 4000);
  await prefs(d, { low: true, lowTime: '09:00' });
  d.setNow(Date.parse('2026-10-17T04:03:00Z'));   // 09:03 Toshkent
  const st = await R.runTick(d, new Date(d.nowMs()));
  assert.equal(st.low, 1); assert.equal(st.daily, 0); assert.match(d.tg.sent[0].text, /Kam qolgan tovarlar/);
  const none = await R.computeLow(mk(seedBase()).db, BID, { biz: {}, lang: 'uz', tz: 'Asia/Tashkent', branches: [] });
  assert.equal(none.threshold, 5); assert.match(M.lowText('uz', none, { shop: 'D' }), /Kam qolgan tovar yo'q/);
});
test('kam qolgan chegarasi: 0 (yangi versiyada saqlangan) = faqat tugaganlar; eski 0 va noto\'g\'ri qiymat = 5', async () => {
  assert.equal(R.lowThresholdOf({ lowStockThreshold: 0, lowStockSetV2: true }), 0);
  assert.equal(R.lowThresholdOf({ lowStockThreshold: 0 }), 5);
  assert.equal(R.lowThresholdOf({ lowStockThreshold: 24, lowStockSetV2: true }), 24);
  assert.equal(R.lowThresholdOf({ lowStockThreshold: 2.5 }), 2.5);
  assert.equal(R.lowThresholdOf({ lowStockThreshold: -1 }), 5); assert.equal(R.lowThresholdOf({ lowStockThreshold: 'x' }), 5); assert.equal(R.lowThresholdOf({}), 5);
  const seed = seedBase({ 'businesses/OWNER1': { businessName: 'D', timeZone: 'Asia/Tashkent', lowStockThreshold: 0, lowStockSetV2: true },
    'businesses/OWNER1/products/a': { name: 'Bir', stock: 1 }, 'businesses/OWNER1/products/b': { name: 'Nol', stock: 0 } });
  const low = await R.computeLow(mk(seed).db, BID, { biz: seed['businesses/OWNER1'], lang: 'uz', tz: 'Asia/Tashkent', branches: [] });
  assert.deepEqual(low.groups.map(function (g) { return g.items.map(function (i) { return i.name; }); }), [['Nol']]);
});

/* ---------- katta chegirma ---------- */
function sale(over) { return Object.assign({ date: new Date(NOW - 60000).toISOString(), receiptNumber: 1234, subtotal: 200000, discountAmount: 50000, total: 150000, cashierId: 'st1', cashierName: 'Ali', branchId: 'main', items: [] }, over || {}); }
test('katta chegirma: faqat xodim, foizdan ko\'p, yoqilgan bo\'lsa; takror va eski hodisa yuborilmaydi', async () => {
  const d = mk(seedBase());
  let r = await R.handleSaleCreated(d, BID, 's1', sale());
  assert.equal(r.skipped, 'off');                                   // standart holatda o'chiq
  await prefs(d, { disc: true, discPct: 20 });
  r = await R.handleSaleCreated(d, BID, 's1', sale());
  assert.equal(r.alert, 'disc'); assert.equal(r.sent, 2);
  assert.match(d.tg.sent[0].text, /Katta chegirma/); assert.match(d.tg.sent[0].text, /№ 1234/); assert.match(d.tg.sent[0].text, /<b>50 000 so'm<\/b> \(25%\)/); assert.match(d.tg.sent[0].text, /Ali/);
  r = await R.handleSaleCreated(d, BID, 's1', sale()); assert.equal(r.skipped, 'dup');   // Firestore hodisani qayta yuborsa
  r = await R.handleSaleCreated(d, BID, 's2', sale({ cashierId: null })); assert.equal(r.skipped, 'owner');
  r = await R.handleSaleCreated(d, BID, 's3', sale({ discountAmount: 30000, total: 170000 })); assert.equal(r.skipped, 'small');   // 15%
  r = await R.handleSaleCreated(d, BID, 's4', sale({ discountAmount: 40000, total: 160000 })); assert.equal(r.alert, 'disc');      // 20% — chegarada
  r = await R.handleSaleCreated(d, BID, 's5', sale({ subtotal: undefined, discountAmount: 30000, total: 70000 })); assert.equal(r.alert, 'disc');   // subtotal yo'q: 30/100
  r = await R.handleSaleCreated(d, BID, 's6', sale({ date: '2026-10-14T10:00:00.000Z' })); assert.equal(r.skipped, 'old');
  r = await R.handleSaleCreated(d, BID, 's7', sale({ discountAmount: 0 })); assert.equal(r.skipped, 'none');
  assert.equal(d.tg.sent.length, 6);
});
test('ogohlantirishlar soatiga 40 tadan oshmaydi (zaxiradan tiklashda to\'lib ketmasin)', async () => {
  const d = mk(seedBase());
  await prefs(d, { disc: true, discPct: 1 });
  let n = 0;
  for (let i = 0; i < 45; i++) { const r = await R.handleSaleCreated(d, BID, 'x' + i, sale()); if (r.alert) n++; }
  assert.equal(n, R.ALERTS_PER_HOUR);
  d.setNow(NOW + 3600 * 1000 + 1000);
  const r = await R.handleSaleCreated(d, BID, 'y1', sale({ date: new Date(NOW + 3600 * 1000).toISOString() }));
  assert.equal(r.alert, 'disc');
});

/* ---------- chek o'chirildi / qaytarildi ---------- */
test('chek o\'chirildi/qaytarildi: faqat xodim, yoqilgan bo\'lsa; matn xavfsiz', async () => {
  const d = mk(seedBase());
  const e = { action: 'saleDelete', detail: '№ 77 — 150 000 so\'m <x>', date: new Date(NOW - 5000).toISOString(), staffId: 'st1', staffName: 'Vali' };
  let r = await R.handleAuditCreated(d, BID, 'a1', e); assert.equal(r.skipped, 'off');
  await prefs(d, { rcpt: true });
  r = await R.handleAuditCreated(d, BID, 'a1', e); assert.equal(r.alert, 'saleDelete');
  assert.match(d.tg.sent[0].text, /Chek o'chirildi/); assert.match(d.tg.sent[0].text, /&lt;x&gt;/); assert.match(d.tg.sent[0].text, /Kim: Vali/);
  r = await R.handleAuditCreated(d, BID, 'a2', Object.assign({}, e, { action: 'saleRefund' })); assert.equal(r.alert, 'saleRefund');
  assert.match(d.tg.sent[2].text, /Chek qaytarildi/);
  r = await R.handleAuditCreated(d, BID, 'a3', Object.assign({}, e, { staffId: null })); assert.equal(r.skipped, 'owner');
  r = await R.handleAuditCreated(d, BID, 'a4', Object.assign({}, e, { action: 'priceChange' })); assert.equal(r.skipped, 'other');
  r = await R.handleAuditCreated(d, BID, 'a1', e); assert.equal(r.skipped, 'dup');
});

/* fix181-woalert: hisobdan chiqarish ham shu sozlama bilan */
test('hisobdan chiqarish: xodim bo\'lsa xabar, matn xavfsiz, 6 tilda so\'z bor', async () => {
  const d = mk(seedBase());
  const e = { action: 'writeOff', detail: "Singan / buzilgan: Cola 1L ×2 — 18 000 so'm <y>", date: new Date(NOW - 5000).toISOString(), staffId: 'st1', staffName: 'Vali' };
  let r = await R.handleAuditCreated(d, BID, 'w1', e); assert.equal(r.skipped, 'off');
  await prefs(d, { rcpt: true });
  r = await R.handleAuditCreated(d, BID, 'w1', e); assert.equal(r.alert, 'writeOff');
  assert.match(d.tg.sent[0].text, /Tovar hisobdan chiqarildi/); assert.match(d.tg.sent[0].text, /&lt;y&gt;/); assert.match(d.tg.sent[0].text, /Kim: Vali/); assert.match(d.tg.sent[0].text, /📦/);
  r = await R.handleAuditCreated(d, BID, 'w2', Object.assign({}, e, { staffId: null })); assert.equal(r.skipped, 'owner');
  ['uz', 'ru', 'en', 'kk', 'ky', 'tg'].forEach(function (l) { assert.ok(M.W(l).wo && M.W(l).wo.length > 3, l); assert.match(M.rcptText(l, e, { shop: 'S' }), /📦/); });
});

/* ---------- smena ---------- */
function shift(over) { return Object.assign({ id: 'sh1', staffName: 'Ali', startTime: new Date(NOW - 8 * 3600e3).toISOString(), endTime: new Date(NOW - 60000).toISOString(), startCash: 100000,
  salesCount: 34, cashTotal: 1300000, cardTotal: 600000, creditTotal: 200000, expectedCash: 1450000, endCash: 1420000, branchId: 'main' }, over || {}); }
test('smena: yangi yopilgan smena — kassir, summa, farq; takror yo\'q; eski yo\'q; yangi smena bo\'lmasa hech narsa o\'qilmaydi', async () => {
  const d = mk(seedBase());
  await prefs(d, { shift: true });
  const reads0 = d.db.stat.reads;
  let r = await R.handleCatalogWrite(d, BID, { shifts: [shift()] }, { shifts: [shift()], staff: [1] });
  assert.equal(r.skipped, 'none'); assert.equal(d.db.stat.reads, reads0);
  r = await R.handleCatalogWrite(d, BID, { shifts: [] }, { shifts: [shift()] });
  assert.equal(r.shifts, 1); assert.equal(r.sent, 2);
  const t = d.tg.sent[0].text;
  assert.match(t, /Smena yopildi/); assert.match(t, /Kassir: <b>Ali<\/b>/); assert.match(t, /Jami: <b>2 100 000 so'm<\/b>/);
  assert.match(t, /Kassada bo'lishi kerak: 1 450 000 so'm/); assert.match(t, /Farq: <b>−30 000 so'm<\/b> \(kam\)/);
  r = await R.handleCatalogWrite(d, BID, { shifts: [] }, { shifts: [shift()] }); assert.equal(r.shifts, 0);   // qayta paydo bo'lsa ham bir marta
  await R.handleCatalogWrite(d, BID, null, { shifts: [shift({ id: 'sh2', endCash: 1460000 })] });
  assert.match(d.tg.sent[2].text, /<b>\+10 000 so'm<\/b> \(ortiqcha\)/);
  await R.handleCatalogWrite(d, BID, null, { shifts: [shift({ id: 'sh3', endCash: 1450000 })] });
  assert.match(d.tg.sent[4].text, /Farq yo'q/);
  await R.handleCatalogWrite(d, BID, null, { shifts: [shift({ id: 'sh4', autoClosed: true, endCash: 1450000 })] });
  assert.match(d.tg.sent[6].text, /avtomatik yopildi/); assert.ok(d.tg.sent[6].text.indexOf('Sanab kiritildi') === -1);
  r = await R.handleCatalogWrite(d, BID, null, { shifts: [shift({ id: 'old', endTime: '2026-10-10T10:00:00.000Z' })] }); assert.equal(r.skipped, 'none');
  r = await R.handleCatalogWrite(d, BID, null, { shifts: [shift({ id: 'open', endTime: undefined })] }); assert.equal(r.skipped, 'none');
  const d2 = mk(seedBase());
  r = await R.handleCatalogWrite(d2, BID, null, { shifts: [shift()] }); assert.equal(r.skipped, 'off');
});

/* ---------- yuborish: bloklangan chat, 429, imzosiz chat ---------- */
test('yuborish: bot bloklangan chat hamma joydan uziladi; 429 da bir marta qayta urinadi; imzosiz chatga yuborilmaydi', async () => {
  const seed = seedBase();
  seed['tgBiz/OWNER1'].chats['999'] = { name: 'Soxta', at: 5, sig: 'bad' };
  const d = mk(seed);
  await prefs(d, { rcpt: true });
  d.tg.fail['222'] = { tgCode: 403, desc: 'Forbidden: bot was blocked by the user' };
  d.tg.fail['111'] = { tgCode: 429, retryAfter: 2, times: 1 };
  let slept = 0; d.sleep = async function (ms) { slept += ms; };
  const r = await R.handleAuditCreated(d, BID, 'z1', { action: 'saleDelete', detail: '№ 1', date: new Date(NOW).toISOString(), staffId: 's', staffName: 'S' });
  assert.equal(r.sent, 1); assert.equal(r.removed, 1); assert.equal(slept, 2000);
  assert.equal(d.tg.sent.length, 1); assert.equal(String(d.tg.sent[0].chat_id), '111');
  assert.equal(d.db.store['tgBiz/OWNER1'].chats['222'], undefined);
  assert.deepEqual(d.db.store['tgChats/222'].bids, []);
  assert.ok(d.tg.sent.every(function (m) { return String(m.chat_id) !== '999'; }));
  d.tg.fail['111'] = { tgCode: 500, desc: 'Internal' };
  const r2 = await R.handleAuditCreated(d, BID, 'z2', { action: 'saleDelete', detail: '№ 2', date: new Date(NOW).toISOString(), staffId: 's', staffName: 'S' });
  assert.equal(r2.failed, 1); assert.ok(d.db.store['tgBiz/OWNER1'].chats['111']);   // vaqtinchalik xatoda uzilmaydi
});

/* ---------- sinov ---------- */
test('sinov: har bir tur hozir yuboriladi (kunlik va kam qolgan — haqiqiy ma\'lumot); chegaralar', async () => {
  const d = mk(salesSeed());
  for (const k of R.KINDS) {
    const r = await core.handleApi(d, BID, { action: 'test', kind: k });
    assert.equal(r.status, 200, k + JSON.stringify(r.body)); assert.equal(r.body.sent, 2, k);
  }
  const texts = d.tg.sent.map(function (m) { return m.text; });
  assert.match(texts[0], /Kunlik hisobot/); assert.match(texts[0], /hozirgacha, 21:05/); assert.match(texts[0], /🧪/); assert.match(texts[0], /240 000/);
  assert.match(texts[2], /Smena yopildi/); assert.match(texts[2], /Namuna kassir/);
  assert.match(texts[4], /Kam qolgan tovarlar/); assert.match(texts[6], /Katta chegirma/); assert.match(texts[8], /Chek o'chirildi/);
  assert.equal((await core.handleApi(d, BID, { action: 'test', kind: 'xyz' })).status, 400);
  for (let i = R.KINDS.length; i < R.TESTS_PER_HOUR; i++) await core.handleApi(d, BID, { action: 'test', kind: 'rcpt' });
  const over = await core.handleApi(d, BID, { action: 'test', kind: 'rcpt' });
  assert.equal(over.status, 429); assert.equal(over.body.code, 'too_many');
  const s = seedBase(); delete s['tgBiz/OWNER1'];
  const d2 = mk(s);
  const nc = await core.handleApi(d2, BID, { action: 'test', kind: 'daily' });
  assert.equal(nc.status, 409); assert.equal(nc.body.code, 'no_chats');
  const sh = mk(seedBase({ 'businesses/OWNER1/meta/catalog': { shifts: [shift({ id: 'a', endTime: '2026-10-15T10:00:00.000Z', staffName: 'Eski' }), shift({ id: 'b', staffName: 'Oxirgi' })] } }));
  await core.handleApi(sh, BID, { action: 'test', kind: 'shift' });
  assert.match(sh.tg.sent[0].text, /Oxirgi/);
  const ru = mk(seedBase()); ru.db.store['tgBiz/OWNER1'].lang = 'ru';
  await core.handleApi(ru, BID, { action: 'test', kind: 'disc' });
  assert.match(ru.tg.sent[0].text, /Большая скидка/); assert.match(ru.tg.sent[0].text, /сум/);
});
test('valyuta: UZS bo\'lmasa kod ko\'rsatiladi', () => {
  assert.equal(M.unitOf('uz', 'KZT'), '₸'); assert.equal(M.unitOf('ru', 'UZS'), 'сум'); assert.equal(M.unitOf('tg', 'UZS'), 'сум'); assert.equal(M.unitOf('tg', 'TJS'), 'сомонӣ');
  assert.equal(M.money('uz', 'USD', 1500), '$1 500.00'); assert.equal(M.money('en', 'USD', -20), '−$20.00');   /* fix149-cents */
  assert.equal(M.money('uz', 'USD', 2.5), '$2.50'); assert.equal(M.money('uz', 'EUR', 1234.567), '€1 234.57'); assert.equal(M.money('uz', 'USD', 0.1 + 0.2), '$0.30'); assert.equal(M.money('uz', 'UZS', 1500.6), "1 501 so'm"); assert.equal(M.money('uz', 'RUB', 99.5), '100 ₽');
  assert.equal(M.fmtC('USD', 1234.5), '1 234.50'); assert.equal(M.fmtC('UZS', 1234.5), '1 235'); assert.equal(M.fmtC('USD', -0.004), '0.00'); assert.equal(M.money('uz', 'UZS', 20, true), "+20 so'm"); assert.equal(M.unitOf('uz', 'XYZ'), 'XYZ');
  assert.equal(M.fmt(-1234567), '−1 234 567'); assert.equal(M.qty(2.5), '2,5');
});
