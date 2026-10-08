'use strict';
/* SAVDO_PUSH_ONLY=1: hech qanday maxfiy qiymat (Secret Manager) e'lon qilinmaydi, push/audit funksiyalari esa bor. */
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
  'firebase-functions/v2/firestore': { onDocumentCreated(p, h) { h.__path = p; return h; } },
  'firebase-functions/v2/scheduler': { onSchedule(o, h) { h.__opts = o; return h; } },
  'firebase-functions/params': { defineSecret(name) { declared[name] = true; return { value: () => 'x' }; } }
};
const origLoad = Module._load;
Module._load = function (request) { if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]; return origLoad.apply(this, arguments); };
const fns = require(path.join(__dirname, '..', 'index.js'));
Module._load = origLoad;
test('push-only: maxfiy qiymat e\'lon qilinmaydi, hech bir funksiya secrets talab qilmaydi', () => {
  assert.deepEqual(Object.keys(declared), []);
  Object.keys(fns).forEach(function (k) { const o = fns[k].__opts; if (o && o.secrets) assert.equal(o.secrets.length, 0, k); });
  ['cleanupAuditLog', 'dailyDebtPush', 'notifySupportMessage'].forEach(function (k) { assert.equal(typeof fns[k], 'function', k); });
});
