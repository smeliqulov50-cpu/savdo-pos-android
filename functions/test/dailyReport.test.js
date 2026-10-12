'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { handleDailyReports, dayInfo, reportMinutes, validTz, saleProfit, breakdown } = require('../src/push/dailyReport');

/* Soxta Firestore: yo'llar 'a/b/c'. where(>=, <) va doc.get/set qo'llab-quvvatlanadi */
function fakeDb(seed) {
  const store = Object.assign({}, seed);
  const writes = [];
  function ref(path) {
    const parts = path.split('/');
    return {
      id: parts[parts.length - 1], path: path,
      parent: { parent: parts.length >= 3 ? ref(parts.slice(0, -2).join('/')) : null },
      delete: async function () { delete store[path]; },
      get: async function () { return { exists: store[path] !== undefined, data: function () { return store[path]; } }; },
      set: async function (d, o) { writes.push(path); store[path] = (o && o.merge && store[path]) ? Object.assign({}, store[path], d) : d; },
      collection: function (n) { return col(path + '/' + n); }
    };
  }
  function col(base, filters) {
    filters = filters || [];
    const q = {
      where: function (f, op, v) { return col(base, filters.concat([[f, op, v]])); },
      get: async function () {
        const docs = Object.keys(store).filter(function (p) { return p.indexOf(base + '/') === 0 && p.split('/').length === base.split('/').length + 1; })
          .filter(function (p) {
            return filters.every(function (f) {
              const x = store[p][f[0]]; if (x === undefined) return false;
              return f[1] === '>=' ? x >= f[2] : f[1] === '<' ? x < f[2] : false;
            });
          }).map(function (p) { return { id: p.split('/').pop(), ref: ref(p), data: function () { return store[p]; } }; });
        return { docs: docs };
      },
      doc: function (id) { return ref(base + '/' + id); }
    };
    return q;
  }
  return {
    store: store, writes: writes,
    collection: function (n) { return col(n); },
    collectionGroup: function (n) {
      return { get: async function () {
        const docs = Object.keys(store).filter(function (p) { const s = p.split('/'); return s.length >= 3 && s[s.length - 2] === n; })
          .map(function (p) { return { id: p.split('/').pop(), ref: ref(p), data: function () { return store[p]; } }; });
        return { docs: docs };
      } };
    }
  };
}
function fakeMessaging() {
  const sent = [];
  return { sent: sent, sendEach: async function (msgs) { msgs.forEach(function (m) { sent.push(m); }); return { successCount: msgs.length, failureCount: 0, responses: msgs.map(function () { return { success: true }; }) }; } };
}
const T = function (iso) { return new Date(iso); };   // UTC instant

test('reportMinutes: standart 21:00, 12:00–23:00 oralig\'iga siqiladi', function () {
  assert.strictEqual(reportMinutes(undefined), 1260);
  assert.strictEqual(reportMinutes(''), 1260);
  assert.strictEqual(reportMinutes('abc'), 1260);
  assert.strictEqual(reportMinutes('18:30'), 1110);
  assert.strictEqual(reportMinutes('09:00'), 720);
  assert.strictEqual(reportMinutes('23:59'), 1380);
  assert.strictEqual(reportMinutes('12:00'), 720);
});
test('validTz', function () {
  assert.ok(validTz('Asia/Tashkent')); assert.ok(!validTz('Mars/Olympus')); assert.ok(!validTz('')); assert.ok(!validTz(null));
});
test('dayInfo: Toshkent (UTC+5) kun chegaralari', function () {
  const d = dayInfo(T('2026-10-13T16:30:00Z'), 'Asia/Tashkent');   // 21:30
  assert.strictEqual(d.ymd, '2026-10-13'); assert.strictEqual(d.minutes, 21 * 60 + 30);
  assert.strictEqual(d.startIso, '2026-10-12T19:00:00.000Z'); assert.strictEqual(d.endIso, '2026-10-13T19:00:00.000Z');
  const e = dayInfo(T('2026-10-12T19:00:00Z'), 'Asia/Tashkent');   // aynan yarim tun -> yangi kun
  assert.strictEqual(e.ymd, '2026-10-13'); assert.strictEqual(e.minutes, 0);
  const f = dayInfo(T('2026-10-12T18:59:59Z'), 'Asia/Tashkent');
  assert.strictEqual(f.ymd, '2026-10-12'); assert.strictEqual(f.minutes, 23 * 60 + 59);
});
test('dayInfo: boshqa poyaslar (UTC, Moskva, Nyu-York DST)', function () {
  assert.strictEqual(dayInfo(T('2026-10-13T16:30:00Z'), 'UTC').startIso, '2026-10-13T00:00:00.000Z');
  assert.strictEqual(dayInfo(T('2026-10-13T16:30:00Z'), 'Europe/Moscow').startIso, '2026-10-12T21:00:00.000Z');
  const ny = dayInfo(T('2026-10-13T16:30:00Z'), 'America/New_York');   // EDT = UTC-4
  assert.strictEqual(ny.startIso, '2026-10-13T04:00:00.000Z'); assert.strictEqual(ny.endIso, '2026-10-14T04:00:00.000Z');
  const dstEnd = dayInfo(T('2026-11-01T12:00:00Z'), 'America/New_York');  // 1-noyabr: kun 25 soat
  assert.strictEqual(dstEnd.startIso, '2026-11-01T04:00:00.000Z'); assert.strictEqual(dstEnd.endIso, '2026-11-02T05:00:00.000Z');
});
test('saleProfit va breakdown mijoz formulalari bilan bir xil', function () {
  const s = { items: [{ qty: 3, price: 14000, costPrice: 9000 }, { qty: 2, price: 36000, costPrice: 2500, saleMode: 'box', unitsPerBox: 10 }], discountAmount: 2000, bonusUsed: 500, serviceChargeAmount: 1000, deliveryFee: 300 };
  assert.strictEqual(saleProfit(s), 15000 + 22000 - 2000 - 500 + 1000 + 300);
  assert.deepStrictEqual(breakdown({ total: 100, paymentType: 'card' }), { cash: 0, card: 100, credit: 0 });
  assert.deepStrictEqual(breakdown({ total: 100, paymentType: 'credit', splitPayments: [{ method: 'cash', amount: 30 }, { method: 'credit', amount: 70 }] }), { cash: 30, card: 0, credit: 70 });
});

const B = 'businesses/B1';
function seed(extra) {
  return Object.assign({
    'businesses/B1': { dailyReportTime: '21:00', currency: 'UZS' },
    'businesses/B1/pushTokens/A1': { token: 'A1', admin: true, lang: 'uz', sound: true },
    'businesses/B1/pushTokens/A2': { token: 'A2', admin: true, lang: 'ru', sound: false, localDebt: true },
    'businesses/B1/pushTokens/K1': { token: 'K1', admin: false, lang: 'uz' },
    'businesses/B1/pushTokens/A3': { token: 'A3', admin: true, lang: 'uz', debtDaily: false },
    [B + '/sales/s1']: { date: '2026-10-13T08:00:00.000Z', items: [{ qty: 3, price: 14000, costPrice: 9000 }], total: 42000, paymentType: 'cash' },
    [B + '/sales/s2']: { date: '2026-10-12T20:00:00.000Z', items: [{ qty: 1, price: 14000, costPrice: 9000 }], total: 14000, paymentType: 'card' },
    [B + '/sales/s3']: { date: '2026-10-12T18:59:59.000Z', items: [{ qty: 9, price: 14000, costPrice: 9000 }], total: 126000, paymentType: 'cash' },   // kecha 23:59
    [B + '/sales/s4']: { date: '2026-10-13T09:00:00.000Z', items: [{ qty: 1, price: 5000, costPrice: 1000 }], total: 5000, paymentType: 'cash', refunded: true, refundedAt: '2026-10-13T10:00:00.000Z' },
    [B + '/expenses/e1']: { date: '2026-10-13T06:00:00.000Z', category: 'rent', amount: 10000 },
    [B + '/expenses/e2']: { date: '2026-10-13T06:00:00.000Z', category: 'purchase', amount: 99999 },
    [B + '/ledger/l1']: { date: '2026-10-13T08:30:00.000Z', type: 'payment', amount: 7000, method: 'cash' },
    [B + '/ledger/l2']: { date: '2026-10-13T08:31:00.000Z', type: 'payment', amount: 1111 },
    [B + '/customers/c1']: { debt: 300000 }, [B + '/customers/c2']: { debt: 50000, hidden: true }, [B + '/customers/c3']: { debt: 0 }
  }, extra || {});
}

test('vaqti kelmagan: hech narsa yuborilmaydi (20:59)', async function () {
  const db = fakeDb(seed()), ms = fakeMessaging();
  const st = await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T15:59:00Z'));
  assert.strictEqual(ms.sent.length, 0); assert.strictEqual(st.notDue, 1); assert.strictEqual(db.writes.length, 0);
});
test('aynan 21:00: xulosa + qarz eslatmasi, to\'g\'ri qurilmalarga', async function () {
  const db = fakeDb(seed()), ms = fakeMessaging();
  const st = await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T16:00:00Z'));
  const sum = ms.sent.filter(function (m) { return m.data.type === 'dailySummary'; });
  const debt = ms.sent.filter(function (m) { return m.data.type === 'debtReport'; });
  assert.deepStrictEqual(sum.map(function (m) { return m.token; }).sort(), ['A1', 'A2']);      // kassir (K1) va eslatma o'chirgan (A3) yo'q
  assert.deepStrictEqual(debt.map(function (m) { return m.token; }), ['A1']);                   // A2 ning telefon eslatmasi bor
  const a1 = sum.find(function (m) { return m.token === 'A1'; }), a2 = sum.find(function (m) { return m.token === 'A2'; });
  // bugun: s1 (42000) + s2 (14000, 01:00 Toshkent) = 56000; foyda 15000+5000=20000; xarajat 10000; sof 10000; qarz 300000
  assert.ok(a1.notification.body.indexOf('56 000') !== -1, a1.notification.body);
  assert.ok(a1.notification.body.indexOf('2 ta chek') !== -1, a1.notification.body);
  assert.ok(a1.notification.body.indexOf('Foyda: 20 000') !== -1, a1.notification.body);
  assert.ok(a1.notification.body.indexOf('Xarajat: 10 000') !== -1, a1.notification.body);
  assert.ok(a1.notification.body.indexOf('Sof foyda: 10 000') !== -1, a1.notification.body);
  assert.ok(a1.notification.body.indexOf('Jami qarz: 300 000') !== -1, a1.notification.body);
  assert.strictEqual(a1.notification.title, 'Kunlik xulosa');
  assert.ok(/Итоги|Продажи/.test(a2.notification.title + a2.notification.body) && a2.notification.body.indexOf('56 000') !== -1);
  assert.strictEqual(a1.android.notification.channelId, 'reminders'); assert.strictEqual(a2.android.notification.channelId, 'quiet');
  assert.ok(debt[0].notification.body.indexOf('300 000') !== -1);
  assert.strictEqual(st.summarySent, 2); assert.strictEqual(st.debtSent, 1);
});
test('kuniga bir marta: ikkinchi ishga tushishda yuborilmaydi; ertasi kuni yana', async function () {
  const db = fakeDb(seed()), ms = fakeMessaging();
  await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T16:00:00Z'));
  const n = ms.sent.length;
  const st2 = await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T16:10:00Z'));
  assert.strictEqual(ms.sent.length, n); assert.strictEqual(st2.alreadySent, 1);
  await handleDailyReports({ db: db, messaging: ms }, T('2026-10-14T16:00:00Z'));
  assert.ok(ms.sent.length > n);
  assert.strictEqual(db.store['businesses/B1/meta/dailyReport'].date, '2026-10-14');
});
test('ega vaqtni 18:30 qilgan: 18:30 gacha yuborilmaydi, undan keyin yuboriladi; oyna tugagach yo\'q', async function () {
  const mk = function () { return fakeDb(seed({ 'businesses/B1': { dailyReportTime: '18:30', currency: 'UZS' } })); };
  let db = mk(), ms = fakeMessaging();
  await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T13:29:00Z'));   // 18:29
  assert.strictEqual(ms.sent.length, 0);
  await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T13:30:00Z'));   // 18:30
  assert.ok(ms.sent.length > 0);
  db = mk(); ms = fakeMessaging();
  await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T15:30:00Z'));   // 20:30 = 18:30 + 120 daqiqa -> oyna tugadi
  assert.strictEqual(ms.sent.length, 0);
});
test('vaqt belgilanmagan yoki buzuq -> 21:00; 12:00 dan oldingi qiymat 12:00 ga siqiladi', async function () {
  let db = fakeDb(seed({ 'businesses/B1': { currency: 'UZS' } })), ms = fakeMessaging();
  await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T15:59:00Z')); assert.strictEqual(ms.sent.length, 0);
  await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T16:00:00Z')); assert.ok(ms.sent.length > 0);
  db = fakeDb(seed({ 'businesses/B1': { dailyReportTime: '03:00' } })); ms = fakeMessaging();
  await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T06:59:00Z')); assert.strictEqual(ms.sent.length, 0);   // 11:59
  await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T07:00:00Z')); assert.ok(ms.sent.length > 0);           // 12:00
});
test('biznesning o\'z soat poyasi hisobga olinadi', async function () {
  const db = fakeDb(seed({ 'businesses/B1': { dailyReportTime: '21:00', timeZone: 'Europe/Moscow' } })), ms = fakeMessaging();
  await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T16:00:00Z'));   // Moskva 19:00 -> hali erta
  assert.strictEqual(ms.sent.length, 0);
  await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T18:00:00Z'));   // Moskva 21:00
  assert.ok(ms.sent.length > 0);
});
test('sotuv yo\'q kun: "bugun sotuv bo\'lmadi" + qarz; qarz yo\'q bo\'lsa qarz eslatmasi yuborilmaydi', async function () {
  const s = {
    'businesses/B9': { dailyReportTime: '21:00' }, 'businesses/B9/pushTokens/Z1': { token: 'Z1', admin: true, lang: 'en' },
    'businesses/B9/customers/c1': { debt: 0 }
  };
  const db = fakeDb(s), ms = fakeMessaging();
  await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T16:00:00Z'));
  assert.strictEqual(ms.sent.length, 1);
  assert.ok(/No sales yet today/.test(ms.sent[0].notification.body), ms.sent[0].notification.body);
  assert.strictEqual(ms.sent[0].data.type, 'dailySummary');
});
test('boshqa biznes ma\'lumoti aralashmaydi', async function () {
  const extra = {
    'businesses/B2': { dailyReportTime: '21:00' }, 'businesses/B2/pushTokens/Y1': { token: 'Y1', admin: true, lang: 'uz' },
    'businesses/B2/sales/x1': { date: '2026-10-13T08:00:00.000Z', items: [{ qty: 1, price: 1000, costPrice: 500 }], total: 1000, paymentType: 'cash' },
    'businesses/B2/customers/c1': { debt: 777 }
  };
  const db = fakeDb(seed(extra)), ms = fakeMessaging();
  await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T16:00:00Z'));
  const y = ms.sent.find(function (m) { return m.token === 'Y1' && m.data.type === 'dailySummary'; });
  assert.ok(y.notification.body.indexOf('Sotuv: 1 000') !== -1 && y.notification.body.indexOf('Jami qarz: 777') !== -1, y.notification.body);
});
test('bir biznes xato bersa boshqalari baribir yuboriladi', async function () {
  const extra = { 'businesses/B2': { dailyReportTime: '21:00' }, 'businesses/B2/pushTokens/Y1': { token: 'Y1', admin: true, lang: 'uz' } };
  const db = fakeDb(seed(extra)); const ms = fakeMessaging();
  const orig = db.collection;
  db.collection = function (n) { const c = orig(n); return c; };
  const origDoc = db.collection('businesses').doc;
  // B1 ning sales so'rovini buzamiz
  const realStore = db.store; Object.defineProperty(realStore, 'businesses/B1/sales/bad', { enumerable: true, get: function () { throw new Error('boom'); } });
  const st = await handleDailyReports({ db: db, messaging: ms }, T('2026-10-13T16:00:00Z'));
  assert.ok(st.errors >= 1);
  assert.ok(ms.sent.some(function (m) { return m.token === 'Y1'; }));
});
