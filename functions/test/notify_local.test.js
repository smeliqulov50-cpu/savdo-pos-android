'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { handleDailyDebt } = require('../src/push/notify');

function ref(path) { const p = path.split('/'); return { id: p[p.length - 1], path: path, parent: { parent: p.length >= 3 ? ref(p.slice(0, -2).join('/')) : null }, delete: async function () {} }; }
function fakeDb(store) {
  const list = function (pred) { return { docs: Object.keys(store).filter(pred).map(function (k) { return { id: k.split('/').pop(), ref: ref(k), data: function () { return store[k]; } }; }) }; };
  return {
    collectionGroup: function (n) { return { get: async function () { return list(function (k) { const s = k.split('/'); return s.length >= 3 && s[s.length - 2] === n; }); } }; },
    collection: function () { return { doc: function (id) { return { collection: function (n) { return { get: async function () { return list(function (k) { return k.indexOf('businesses/' + id + '/' + n + '/') === 0; }); } }; } }; } }; }
  };
}
test('kunlik qarz: telefonida o\'z eslatmasi (localDebt) bor qurilmaga server yubormaydi, qolganlarga yuboradi', async function () {
  const db = fakeDb({
    'businesses/B1/pushTokens/L1': { token: 'L1', admin: true, localDebt: true },
    'businesses/B1/pushTokens/L2': { token: 'L2', admin: true, localDebt: false },
    'businesses/B1/pushTokens/L3': { token: 'L3', admin: true },
    'businesses/B1/customers/c1': { debt: 5000 }
  });
  const sent = [];
  const messaging = { sendEach: async function (m) { m.forEach(function (x) { sent.push(x.token); }); return { responses: m.map(function () { return { success: true }; }), successCount: m.length, failureCount: 0 }; } };
  await handleDailyDebt({ db: db, messaging: messaging });
  assert.deepStrictEqual(sent.sort(), ['L2', 'L3']);
});
