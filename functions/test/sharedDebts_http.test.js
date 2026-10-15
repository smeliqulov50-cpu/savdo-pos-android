'use strict';
/* fix114-debts: index.js ulanishi — HTTP so'rov (token tekshiruvi, CORS, xato kodlari) va Firestore trigger hodisasi shakli */
process.env.SAVDO_PUSH_ONLY = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const { fakeDb, fakeMessaging } = require('./helpers/sdFake');

const db = fakeDb({
  'businesses/A': { businessName: 'Optom', currency: 'UZS' },
  'businesses/B': { businessName: 'Mini' },
  'businesses/B/pushTokens/t1': { token: 't1', admin: true, lang: 'uz' }
});
const msg = fakeMessaging();
const stubs = {
  'firebase-admin': {
    apps: [], initializeApp() { this.apps.push(1); },
    firestore() { return db; }, messaging() { return msg; },
    auth() { return { verifyIdToken: async function (t) { if (t === 'tokB') return { uid: 'B' }; throw new Error('bad'); } }; }
  },
  'firebase-functions/v2/https': { onRequest(opts, handler) { handler.__opts = opts; return handler; } },
  'firebase-functions/v2': { setGlobalOptions() {} },
  'firebase-functions/v2/firestore': { onDocumentCreated(p, h) { h.__path = p; return h; }, onDocumentWritten(p, h) { h.__path = p; return h; } },
  'firebase-functions/v2/scheduler': { onSchedule(o, h) { h.__opts = o; return h; } },
  'firebase-functions/params': { defineSecret() { return { value: () => 'x' }; } }
};
const origLoad = Module._load;
Module._load = function (request) { if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]; return origLoad.apply(this, arguments); };
const fns = require(path.join(__dirname, '..', 'index.js'));
Module._load = origLoad;

function call(method, auth, body) {
  return new Promise(function (resolve) {
    const req = { method: method, body: body, get: function (h) { return h.toLowerCase() === 'authorization' ? auth : undefined; } };
    const res = { code: 200, status: function (c) { this.code = c; return this; }, json: function (j) { resolve({ code: this.code, body: j }); } };
    fns.sharedDebts(req, res);
  });
}
function snap(d) { return { exists: d !== null && d !== undefined, data: function () { return d; } }; }

test('HTTP: usul, token, xato kodlari', async function () {
  assert.equal((await call('GET', 'Bearer tokB', {})).code, 405);
  assert.equal((await call('POST', '', { action: 'status' })).code, 401);
  assert.equal((await call('POST', 'Bearer yomon', { action: 'status' })).code, 401);
  let r = await call('POST', 'Bearer tokB', { action: 'status' });
  assert.equal(r.code, 200); assert.equal(r.body.ok, true); assert.equal(r.body.linked, false);
  r = await call('POST', 'Bearer tokB', { action: 'link', phone: '+998 90 123 45 67' });
  assert.equal(r.code, 200); assert.equal(r.body.phone, '+998901234567');
  r = await call('POST', 'Bearer tokB', { action: 'detail', bid: 'A', cid: 'zz' });
  assert.equal(r.code, 403); assert.equal(r.body.ok, false);
  r = await call('POST', 'Bearer tokB', undefined);
  assert.equal(r.code, 400); assert.equal(r.body.code, 'bad_action');
});

test('Trigger: v2 hodisa shakli (event.data.before/after, event.params) bilan ishlaydi', async function () {
  await fns.sharedDebtIndex({ params: { bizId: 'A', custId: 'c1' }, data: { before: snap(null), after: snap({ name: 'Mini', phone: '901234567', debt: 1000 }) } });
  assert.equal(db.store['debtLinks/A__c1'].phoneKey, '998901234567');
  assert.equal(msg.sent.length, 1, 'bog\'langan B ga push');
  assert.equal(msg.sent[0].data.type, 'sharedDebt');
  await fns.sharedDebtIndex({ params: { bizId: 'A', custId: 'c1' }, data: { before: snap({ name: 'Mini', phone: '901234567', debt: 1000 }), after: { exists: false, data: function () { return undefined; } } } });
  assert.equal(db.store['debtLinks/A__c1'], undefined);
  await fns.sharedDebtIndex({ params: { bizId: 'A', custId: 'c1' }, data: null });   // bo'sh hodisa — xatosiz
  const r = await call('POST', 'Bearer tokB', { action: 'list' });
  assert.equal(r.body.items.length, 0);
});

test('Backfill: jadval bilan, bir marta', async function () {
  assert.equal(fns.sharedDebtBackfill.__opts.schedule, 'every 60 minutes');
  db.store['businesses/A/customers/c5'] = { name: 'Mini', phone: '+998901234567', debt: 7 };
  await fns.sharedDebtBackfill();
  assert.equal(db.store['debtLinks/A__c5'].phoneKey, '998901234567');
  assert.equal(db.store['debtIndexMeta/_global'].v, 1);
  const r = await call('POST', 'Bearer tokB', { action: 'list' });
  assert.equal(r.body.items.length, 1); assert.equal(r.body.items[0].debt, 7);
});
