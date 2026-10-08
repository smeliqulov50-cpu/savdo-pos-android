'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildMessage, handleSupportMessage, handleDailyDebt, fmtMoney } = require('../src/push/notify');

/* Kichik soxta Firestore: yo'llar 'a/b/c' ko'rinishida */
function fakeDb(seed) {
  const store = Object.assign({}, seed);
  const deleted = [];
  function ref(path) {
    const parts = path.split('/');
    return {
      id: parts[parts.length - 1], path: path,
      parent: { parent: parts.length >= 3 ? ref(parts.slice(0, -2).join('/')) : null },
      delete: async function () { delete store[path]; deleted.push(path); }
    };
  }
  function snapOfPrefix(prefix, depthFilter) {
    const docs = Object.keys(store).filter(depthFilter).map(function (p) {
      return { id: p.split('/').pop(), ref: ref(p), data: function () { return store[p]; } };
    });
    return { docs: docs };
  }
  const col = function (base) {
    return {
      get: async function () { return snapOfPrefix(base, function (p) { return p.indexOf(base + '/') === 0 && p.split('/').length === base.split('/').length + 1; }); },
      doc: function (id) { return { collection: function (n) { return col(base + '/' + id + '/' + n); } }; }
    };
  };
  return {
    deleted: deleted, store: store,
    collection: function (n) { return col(n); },
    collectionGroup: function (n) {
      return { get: async function () { return snapOfPrefix(n, function (p) { const s = p.split('/'); return s.length >= 3 && s[s.length - 2] === n; }); } };
    }
  };
}
function fakeMessaging(failFor) {
  const sent = [];
  return {
    sent: sent,
    sendEach: async function (msgs) {
      msgs.forEach(function (m) { sent.push(m); });
      const responses = msgs.map(function (m) {
        return (failFor && failFor.indexOf(m.token) !== -1) ? { success: false, error: { code: 'messaging/registration-token-not-registered' } } : { success: true };
      });
      return { responses: responses, successCount: responses.filter(function (r) { return r.success; }).length, failureCount: responses.filter(function (r) { return !r.success; }).length };
    }
  };
}

test('buildMessage: ovozli kanal, standart ovoz, yuqori ustuvorlik', function () {
  const m = buildMessage({ token: 'T1' }, { title: 'A', body: 'B', channel: 'support', data: { type: 'support', n: 5 } });
  assert.strictEqual(m.token, 'T1');
  assert.strictEqual(m.android.notification.channelId, 'support');
  assert.strictEqual(m.android.notification.sound, 'default');
  assert.strictEqual(m.android.priority, 'high');
  assert.strictEqual(m.data.n, '5');                       // data qiymatlari faqat satr bo'lishi shart
});
test('buildMessage: ovozi o\'chirilgan qurilma -> quiet kanal, ovozsiz', function () {
  const m = buildMessage({ token: 'T1', sound: false }, { title: 'A', body: 'B', channel: 'reminders' });
  assert.strictEqual(m.android.notification.channelId, 'quiet');
  assert.strictEqual(m.android.notification.sound, undefined);
  assert.strictEqual(m.webpush.notification.silent, true);
});
test('buildMessage: uzun matn qirqiladi', function () {
  const m = buildMessage({ token: 'T' }, { title: 'x'.repeat(200), body: 'y'.repeat(500), channel: 'support' });
  assert.ok(m.notification.title.length <= 80 && m.notification.body.length <= 180);
});
test('fmtMoney', function () { assert.strictEqual(fmtMoney(1234567), '1 234 567'); assert.strictEqual(fmtMoney(950), '950'); });

test('yordam: biznes yozdi -> faqat super admin tokenlariga', async function () {
  const db = fakeDb({ 'superAdminTokens/S1': { token: 'S1' }, 'superAdminTokens/S2': { token: 'S2', sound: false }, 'businesses/B1/pushTokens/X1': { token: 'X1' } });
  const ms = fakeMessaging();
  const r = await handleSupportMessage({ db: db, messaging: ms }, 'B1', { from: 'business', text: 'Salom', businessName: 'Do\'kon 1' });
  assert.strictEqual(r.sent, 2);
  assert.deepStrictEqual(ms.sent.map(function (m) { return m.token; }).sort(), ['S1', 'S2']);
  assert.strictEqual(ms.sent[0].notification.title, "Do'kon 1");
  assert.strictEqual(ms.sent.find(function (m) { return m.token === 'S2'; }).android.notification.channelId, 'quiet');
  assert.strictEqual(ms.sent[0].data.type, 'support');
});
test('yordam: super admin javob berdi -> o\'sha biznes tokenlariga', async function () {
  const db = fakeDb({ 'businesses/B1/pushTokens/X1': { token: 'X1' }, 'businesses/B2/pushTokens/Y1': { token: 'Y1' }, 'superAdminTokens/S1': { token: 'S1' } });
  const ms = fakeMessaging();
  const r = await handleSupportMessage({ db: db, messaging: ms }, 'B1', { from: 'admin', text: 'Javob' });
  assert.strictEqual(r.sent, 1); assert.strictEqual(ms.sent[0].token, 'X1');
});
test('yordam: bo\'sh matn va noma\'lum yuboruvchi yuborilmaydi', async function () {
  const ms = fakeMessaging(); const db = fakeDb({});
  assert.deepStrictEqual(await handleSupportMessage({ db: db, messaging: ms }, 'B1', { from: 'admin', text: '' }), { skipped: 'empty' });
  assert.deepStrictEqual(await handleSupportMessage({ db: db, messaging: ms }, 'B1', { from: 'x', text: 'a' }), { skipped: 'from' });
  assert.strictEqual(ms.sent.length, 0);
});
test('yaroqsiz token bazadan o\'chiriladi', async function () {
  const db = fakeDb({ 'businesses/B1/pushTokens/X1': { token: 'X1' }, 'businesses/B1/pushTokens/X2': { token: 'X2' } });
  const ms = fakeMessaging(['X2']);
  const r = await handleSupportMessage({ db: db, messaging: ms }, 'B1', { from: 'admin', text: 'a' });
  assert.strictEqual(r.sent, 1); assert.strictEqual(r.removed, 1);
  assert.deepStrictEqual(db.deleted, ['businesses/B1/pushTokens/X2']);
});

test('kunlik qarz: jami qarz hisoblanadi, faqat admin qurilmalariga, yashirinlar hisobga olinmaydi', async function () {
  const db = fakeDb({
    'businesses/B1/pushTokens/A1': { token: 'A1', admin: true, lang: 'uz' },
    'businesses/B1/pushTokens/A2': { token: 'A2', admin: false },                 // kassir qurilmasi — yuborilmaydi
    'businesses/B1/pushTokens/A3': { token: 'A3' },                               // eski token (admin belgisi yo'q) — yuborilmaydi
    'businesses/B1/pushTokens/A4': { token: 'A4', admin: true, debtDaily: false },// o'chirib qo'ygan
    'businesses/B1/pushTokens/A5': { token: 'A5', admin: true, lang: 'ru', sound: false },
    'businesses/B1/customers/c1': { debt: 150000 }, 'businesses/B1/customers/c2': { debt: 1234567 },
    'businesses/B1/customers/c3': { debt: 999999, hidden: true }, 'businesses/B1/customers/c4': { debt: 0 },
    'businesses/B2/pushTokens/Z1': { token: 'Z1', admin: true },
    'businesses/B2/customers/c1': { debt: 0 }
  });
  const ms = fakeMessaging();
  const st = await handleDailyDebt({ db: db, messaging: ms });
  assert.deepStrictEqual(ms.sent.map(function (m) { return m.token; }).sort(), ['A1', 'A5']);
  const a1 = ms.sent.find(function (m) { return m.token === 'A1'; });
  const a5 = ms.sent.find(function (m) { return m.token === 'A5'; });
  assert.ok(a1.notification.body.indexOf('1 384 567') !== -1, a1.notification.body);
  assert.strictEqual(a1.notification.title, 'Kunlik qarz hisoboti');
  assert.strictEqual(a1.android.notification.channelId, 'reminders');
  assert.ok(a5.notification.body.indexOf('1 384 567') !== -1 && /долг/.test(a5.notification.body));
  assert.strictEqual(a5.android.notification.channelId, 'quiet');
  assert.strictEqual(a1.data.type, 'debtReport');
  assert.strictEqual(st.skippedNoDebt, 1);                                         // B2: qarz yo'q
});
