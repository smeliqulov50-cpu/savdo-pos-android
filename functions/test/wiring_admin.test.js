'use strict';
/* fix203-plans: adminApi ulanishi (SAVDO_PUSH_ONLY=1 rejimida ham, maxfiy qiymatsiz). */
process.env.SAVDO_PUSH_ONLY = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const declared = {};
const stubs = {
  'firebase-admin': { apps: [], initializeApp() { this.apps.push(1); }, firestore() { return {}; }, auth() { return {}; }, messaging() { return {}; } },
  'firebase-functions/v2/https': { onRequest(opts, handler) { handler.__opts = opts; return handler; } },
  'firebase-functions/v2': { setGlobalOptions() {} },
  'firebase-functions/v2/firestore': { onDocumentCreated(p, h) { h.__path = p; return h; }, onDocumentWritten(p, h) { h.__path = p; return h; } },
  'firebase-functions/v2/scheduler': { onSchedule(o, h) { h.__opts = o; return h; } },
  'firebase-functions/params': { defineSecret(name) { declared[name] = true; return { value: () => 'x' }; } }
};
const origLoad = Module._load;
Module._load = function (request) { if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]; return origLoad.apply(this, arguments); };
const fns = require(path.join(__dirname, '..', 'index.js'));
Module._load = origLoad;
/* fix203-plans: adminApi — maxfiy qiymatsiz, cors, POST va token majburiy */
test('adminApi: e\'lon qilingan, cors, maxfiy qiymat yo\'q; tokensiz/GET — rad', async () => {
  assert.equal(typeof fns.adminApi, 'function');
  assert.equal(fns.adminApi.__opts.cors, true);
  assert.ok(!fns.adminApi.__opts.secrets || fns.adminApi.__opts.secrets.length === 0);
  const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
  const a = res(); await fns.adminApi({ method: 'GET', get: () => '' }, a); assert.equal(a.code, 405);
  const b = res(); await fns.adminApi({ method: 'POST', get: () => '', body: {} }, b); assert.equal(b.code, 401);
});
