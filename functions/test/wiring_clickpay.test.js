'use strict';
/* fix207-clickpay: Telegram rejimida (SAVDO_PUSH_ONLY=1 + SAVDO_TG=1) Click kalitlari faqat SAVDO_CLICK_REDIRECT=1 bo'lsa ulanadi. */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
function load(env) {
  const keep = {}; ['SAVDO_PUSH_ONLY', 'SAVDO_TG', 'SAVDO_TG_PAY', 'SAVDO_CLICK_REDIRECT'].forEach(function (k) { keep[k] = process.env[k]; delete process.env[k]; });
  Object.assign(process.env, env);
  const declared = [];
  const stubs = {
    'firebase-admin': { apps: [], initializeApp() { this.apps.push(1); }, firestore() { return {}; }, auth() { return {}; }, messaging() { return {}; } },
    'firebase-functions/v2/https': { onRequest(opts, handler) { handler.__opts = opts; return handler; } },
    'firebase-functions/v2': { setGlobalOptions() {} },
    'firebase-functions/v2/firestore': { onDocumentCreated(p, h) { h.__path = p; return h; }, onDocumentWritten(p, h) { h.__path = p; return h; } },
    'firebase-functions/v2/scheduler': { onSchedule(o, h) { h.__opts = o; return h; } },
    'firebase-functions/params': { defineSecret(name) { declared.push(name); return { name: name, value: () => '' }; } }
  };
  const idx = path.join(__dirname, '..', 'index.js');
  Object.keys(require.cache).forEach(function (k) { if (k.indexOf(path.join(__dirname, '..', 'src')) === 0 || k === idx) delete require.cache[k]; });
  const orig = Module._load;
  Module._load = function (request) { if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]; return orig.apply(this, arguments); };
  let fns; try { fns = require(idx); } finally { Module._load = orig; Object.keys(keep).forEach(function (k) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; }); }
  return { fns: fns, declared: declared };
}
const names = (fn) => ((fn.__opts && fn.__opts.secrets) || []).map(function (s) { return s.name; }).sort();
test('kalitlarsiz (odatiy Telegram yuklash): clickWebhook yo\'q, bot Click kalitlarini so\'ramaydi', () => {
  const { fns, declared } = load({ SAVDO_PUSH_ONLY: '1', SAVDO_TG: '1', SAVDO_TG_PAY: '1' });
  assert.equal(fns.clickWebhook, undefined);
  assert.deepEqual(names(fns.telegramWebhook), ['CLICK_TG_PROVIDER_TOKEN', 'TELEGRAM_BOT_TOKEN']);
  assert.ok(declared.indexOf('CLICK_SERVICE_ID') === -1 && declared.indexOf('CLICK_SECRET_KEY') === -1);
});
test('SAVDO_CLICK_REDIRECT=1: clickWebhook (imzo kaliti + bot), bot va mini ilova — xizmat/merchant ID; har kalit bir marta e\'lon qilinadi', () => {
  const { fns, declared } = load({ SAVDO_PUSH_ONLY: '1', SAVDO_TG: '1', SAVDO_TG_PAY: '1', SAVDO_CLICK_REDIRECT: '1' });
  assert.equal(typeof fns.clickWebhook, 'function');
  assert.deepEqual(names(fns.clickWebhook), ['CLICK_SECRET_KEY', 'CLICK_SERVICE_ID', 'TELEGRAM_BOT_TOKEN']);
  assert.deepEqual(names(fns.telegramWebhook), ['CLICK_MERCHANT_ID', 'CLICK_SERVICE_ID', 'CLICK_TG_PROVIDER_TOKEN', 'TELEGRAM_BOT_TOKEN']);
  assert.deepEqual(names(fns.telegramShop), ['CLICK_MERCHANT_ID', 'CLICK_SERVICE_ID', 'CLICK_TG_PROVIDER_TOKEN', 'TELEGRAM_BOT_TOKEN']);
  assert.ok(!fns.clickWebhook.__opts.cors);
  ['CLICK_SERVICE_ID', 'CLICK_MERCHANT_ID', 'CLICK_SECRET_KEY'].forEach(function (n) { assert.equal(declared.filter(function (d) { return d === n; }).length, 1, n); });
});
test('to\'liq rejim (Click yoqilgan): asosiy clickWebhook o\'zgarmagan', () => {
  const { fns, declared } = load({ SAVDO_CLICK_REDIRECT: '1' });
  assert.deepEqual(names(fns.clickWebhook), ['CLICK_SECRET_KEY', 'CLICK_SERVICE_ID']);
  ['CLICK_SERVICE_ID', 'CLICK_MERCHANT_ID', 'CLICK_SECRET_KEY'].forEach(function (n) { assert.equal(declared.filter(function (d) { return d === n; }).length, 1, n); });
});
test('clickWebhook (redirect): imzosiz so\'rov — rad, 200 + JSON', async () => {
  const { fns } = load({ SAVDO_PUSH_ONLY: '1', SAVDO_TG: '1', SAVDO_CLICK_REDIRECT: '1' });
  const r = { code: 0, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } };
  await fns.clickWebhook({ method: 'POST', get: () => '', body: { action: '0', merchant_trans_id: 'x', click_trans_id: '1', amount: '1', sign_string: 'x' } }, r);
  assert.equal(r.code, 200); assert.equal(r.body.error, -1);
});
