'use strict';
/* fix120-tg: index.js ulanishi — SAVDO_PUSH_ONLY=1 SAVDO_TG=1 bilan yuklash: faqat TELEGRAM_BOT_TOKEN e'lon qilinadi,
   faqat ikkita Telegram funksiyasi uni talab qiladi; HTTP oqimi (sirli sarlavha, setup, ilova so'rovi). */
process.env.SAVDO_PUSH_ONLY = '1';
process.env.SAVDO_TG = '1';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'sardor-pos' });
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const { fakeDb } = require('./helpers/sdFake');
const TG = require('../src/telegram/core');

const TOKEN = '777:REAL-LOOKING-TOKEN';
const declared = {};
const db = fakeDb({ 'businesses/OWNER1': { businessName: 'Do\'kon' } });
const stubs = {
  'firebase-admin': { apps: [1], initializeApp() {}, firestore() { return db; }, messaging() { return {}; },
    auth() { return { verifyIdToken: async function (t) { if (t === 'good') return { uid: 'OWNER1' }; throw new Error('bad'); } }; } },
  'firebase-functions/v2/https': { onRequest(opts, handler) { handler.__opts = opts; return handler; } },
  'firebase-functions/v2': { setGlobalOptions() {} },
  'firebase-functions/v2/firestore': { onDocumentCreated(p, h) { h.__path = p; return h; }, onDocumentWritten(p, h) { h.__path = p; return h; } },
  'firebase-functions/v2/scheduler': { onSchedule(o, h) { h.__opts = o; return h; } },
  'firebase-functions/params': { defineSecret(name) { declared[name] = true; return { name: name, value: () => (name === 'TELEGRAM_BOT_TOKEN' ? TOKEN : '') }; } }
};
const calls = [];
global.fetch = async function (url, init) {
  const method = url.split('/').pop();
  const params = JSON.parse(init.body || '{}');
  calls.push({ url: url, method: method, params: params });
  let result = true;
  if (method === 'getMe') result = { username: 'savdo_pos_bot' };
  if (method === 'getWebhookInfo') result = { url: calls.filter(function (c) { return c.method === 'setWebhook'; }).map(function (c) { return c.params.url; }).pop() || '', pending_update_count: 0 };
  if (method === 'sendMessage') result = { message_id: 1 };
  return { status: 200, json: async function () { return { ok: true, result: result }; } };
};
const origLoad = Module._load;
Module._load = function (request) { if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]; return origLoad.apply(this, arguments); };
const fns = require(path.join(__dirname, '..', 'index.js'));
Module._load = origLoad;

function fakeRes() {
  const r = { code: 200, body: undefined, headers: {} };
  r.status = function (c) { r.code = c; return r; };
  r.json = function (b) { r.body = b; return r; };
  r.send = function (b) { r.body = b; return r; };
  r.end = function () { return r; };
  return r;
}
function req(method, opts) {
  opts = opts || {};
  const h = {}; Object.keys(opts.headers || {}).forEach(function (k) { h[k.toLowerCase()] = opts.headers[k]; });
  return { method: method, query: opts.query || {}, body: opts.body, get: function (k) { return h[String(k).toLowerCase()]; } };
}

test('faqat TELEGRAM_BOT_TOKEN e\'lon qilingan; faqat telegram funksiyalari uni oladi; eski funksiyalar joyida', () => {
  assert.deepEqual(Object.keys(declared), ['TELEGRAM_BOT_TOKEN']);
  assert.equal(fns.telegramApi.__opts.secrets.length, 1); assert.equal(fns.telegramWebhook.__opts.secrets.length, 1);
  assert.equal(fns.telegramApi.__opts.cors, true);
  Object.keys(fns).forEach(function (k) { if (k.indexOf('telegram') !== 0) { const o = fns[k].__opts; if (o && o.secrets) assert.equal(o.secrets.length, 0, k); } });
  ['cleanupAuditLog', 'dailyDebtPush', 'notifySupportMessage', 'sharedDebts', 'sharedDebtIndex', 'sharedDebtBackfill'].forEach(function (k) { assert.equal(typeof fns[k], 'function', k); });
});

test('webhook: GET — oddiy javob; sirli sarlavhasiz POST — 401 va hech narsa qilinmaydi', async () => {
  let r = fakeRes(); await fns.telegramWebhook(req('GET'), r);
  assert.equal(r.code, 200); assert.equal(r.body, 'ok');
  r = fakeRes(); await fns.telegramWebhook(req('POST', { body: { message: { chat: { id: 1, type: 'private' }, text: '/start' } } }), r);
  assert.equal(r.code, 401);
  r = fakeRes(); await fns.telegramWebhook(req('POST', { headers: { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' }, body: {} }), r);
  assert.equal(r.code, 401);
  assert.equal(calls.filter(function (c) { return c.method === 'sendMessage'; }).length, 0);
});

test('setup: webhook to\'g\'ri manzil va sirli sarlavha bilan o\'rnatiladi', async () => {
  const r = fakeRes(); await fns.telegramWebhook(req('GET', { query: { setup: '1' } }), r);
  assert.equal(r.code, 200); assert.equal(r.body.ok, true); assert.equal(r.body.bot, 'savdo_pos_bot');
  const sw = calls.filter(function (c) { return c.method === 'setWebhook'; }).pop();
  assert.equal(sw.params.url, 'https://us-central1-sardor-pos.cloudfunctions.net/telegramWebhook');
  assert.equal(sw.params.secret_token, TG.webhookSecret(TG.keyFromToken(TOKEN)));
  assert.ok(sw.url.indexOf('https://api.telegram.org/bot' + TOKEN + '/') === 0);
  assert.equal(r.body.url, sw.params.url);
});

test('ilova -> link, Telegram -> /start: to\'liq oqim; javobda token yo\'q', async () => {
  let r = fakeRes(); await fns.telegramApi(req('POST', { body: { action: 'status' } }), r);
  assert.equal(r.code, 401);
  r = fakeRes(); await fns.telegramApi(req('POST', { headers: { Authorization: 'Bearer bad' }, body: { action: 'status' } }), r);
  assert.equal(r.code, 401);
  r = fakeRes(); await fns.telegramApi(req('GET', { headers: { Authorization: 'Bearer good' } }), r);
  assert.equal(r.code, 405);
  r = fakeRes(); await fns.telegramApi(req('POST', { headers: { Authorization: 'Bearer good' }, body: { action: 'link', lang: 'uz' } }), r);
  assert.equal(r.code, 200); assert.equal(r.body.bot, 'savdo_pos_bot');
  assert.ok(JSON.stringify(r.body).indexOf(TOKEN) === -1);
  const code = r.body.code;
  const secret = TG.webhookSecret(TG.keyFromToken(TOKEN));
  const w = fakeRes();
  await fns.telegramWebhook(req('POST', { headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }, body: { update_id: 1, message: { chat: { id: 4242, type: 'private' }, from: { id: 4242, first_name: 'Sardor', language_code: 'ru' }, text: '/start ' + code } } }), w);
  assert.equal(w.code, 200);
  const sm = calls.filter(function (c) { return c.method === 'sendMessage'; }).pop();
  assert.equal(sm.params.chat_id, 4242); assert.match(sm.params.text, /Ulandi/); assert.equal(sm.params.parse_mode, 'HTML');
  r = fakeRes(); await fns.telegramApi(req('POST', { headers: { Authorization: 'Bearer good' }, body: { action: 'status' } }), r);
  assert.equal(r.body.chats.length, 1); assert.equal(r.body.chats[0].name, 'Sardor');
  // ichki xato bo'lsa ham Telegram'ga 200
  const w2 = fakeRes();
  await fns.telegramWebhook(req('POST', { headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }, body: null }), w2);
  assert.equal(w2.code, 200);
});
