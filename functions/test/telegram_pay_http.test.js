'use strict';
/* fix142-tgpay: index.js ulanishi — SAVDO_TG_PAY=1 bilan: CLICK_TG_PROVIDER_TOKEN faqat telegramWebhook ga ulanadi,
   webhook orqali /obuna → tarif → hisob oqimi ishlaydi; telegramApi va jadval funksiyalariga bu sir berilmaydi. */
process.env.SAVDO_PUSH_ONLY = '1';
process.env.SAVDO_TG = '1';
process.env.SAVDO_TG_PAY = '1';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'sardor-pos' });
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const { fakeDb } = require('./helpers/tgFake');
const TG = require('../src/telegram/core');

const TOKEN = '777:REAL-LOOKING-TOKEN', PTOKEN = '398062629:TEST:PROVIDER';
const KEY = TG.keyFromToken(TOKEN);
const declared = {};
const BID = 'OWNER1', CHAT = '4242';
const db = fakeDb({
  ['businesses/' + BID]: { businessName: 'Do\'kon', subscriptionExpiresAtMs: Date.now() + 86400000 },
  ['tgBiz/' + BID]: { chats: { [CHAT]: { name: 'Ega', at: 1, sig: TG.sigOf(KEY, BID, CHAT) } } },
  ['tgChats/' + CHAT]: { bids: [BID] }
});
db.collection('paymentOrders').doc = (function (orig) { return function (id) { return orig(id || ('gen' + Math.random().toString(36).slice(2, 10))); }; })(db.collection('paymentOrders').doc);
const stubs = {
  'firebase-admin': { apps: [1], initializeApp() {}, firestore() { const c = db.collection.bind(db); return Object.assign({}, db, { collection: function (n) { const col = c(n); const d = col.doc; col.doc = function (id) { return d(id || ('gen' + Math.random().toString(36).slice(2, 10))); }; return col; } }); }, messaging() { return {}; },
    auth() { return { verifyIdToken: async function () { return { uid: BID }; } }; } },
  'firebase-functions/v2/https': { onRequest(opts, handler) { handler.__opts = opts; return handler; } },
  'firebase-functions/v2': { setGlobalOptions() {} },
  'firebase-functions/v2/firestore': { onDocumentCreated(p, h) { h.__path = p; return h; }, onDocumentWritten(p, h) { h.__path = p; return h; } },
  'firebase-functions/v2/scheduler': { onSchedule(o, h) { h.__opts = o; return h; } },
  'firebase-functions/params': { defineSecret(name) { declared[name] = true; return { name: name, value: () => (name === 'TELEGRAM_BOT_TOKEN' ? TOKEN : name === 'CLICK_TG_PROVIDER_TOKEN' ? PTOKEN : '') }; } }
};
const calls = [];
global.fetch = async function (url, init) {
  const method = url.split('/').pop(); const params = JSON.parse(init.body || '{}');
  calls.push({ method: method, params: params });
  let result = true;
  if (method === 'getMe') result = { username: 'savdo_pos_bot' };
  if (method === 'sendMessage') result = { message_id: 1 };
  return { status: 200, json: async function () { return { ok: true, result: result }; } };
};
const origLoad = Module._load;
Module._load = function (request) { if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]; return origLoad.apply(this, arguments); };
const fns = require(path.join(__dirname, '..', 'index.js'));
Module._load = origLoad;
function res() { const r = { code: 200, body: null }; r.status = function (c) { r.code = c; return r; }; r.json = function (b) { r.body = b; return r; }; r.send = function (b) { r.body = b; return r; }; r.end = function () { return r; }; return r; }
function req(body) { return { method: 'POST', body: body, get: function (h) { return h === 'X-Telegram-Bot-Api-Secret-Token' ? TG.webhookSecret(KEY) : ''; }, query: {} }; }

test('sir faqat telegramWebhook ga ulanadi', () => {
  assert.ok(declared.TELEGRAM_BOT_TOKEN && declared.CLICK_TG_PROVIDER_TOKEN);
  assert.deepEqual(fns.telegramWebhook.__opts.secrets.map(s => s.name).sort(), ['CLICK_TG_PROVIDER_TOKEN', 'TELEGRAM_BOT_TOKEN']);
  ['telegramApi', 'telegramTick', 'telegramSaleAlert', 'telegramAuditAlert', 'telegramShiftAlert'].forEach(function (k) {
    const s = (fns[k].__opts && fns[k].__opts.secrets) || [];
    assert.ok(!s.some(x => x.name === 'CLICK_TG_PROVIDER_TOKEN'), k);
  });
});

test('webhook orqali: /obuna → tarif → hisob (provayder tokeni bilan)', async () => {
  let r = res();
  await fns.telegramWebhook(req({ message: { message_id: 1, chat: { id: Number(CHAT), type: 'private' }, from: { id: 1, language_code: 'uz' }, text: '/obuna' } }), r);
  assert.equal(r.code, 200);
  const menu = calls.filter(c => c.method === 'sendMessage').pop().params;
  const data = menu.reply_markup.inline_keyboard[0][0].callback_data;
  r = res();
  await fns.telegramWebhook(req({ callback_query: { id: 'q', data: data, from: { id: 1 }, message: { chat: { id: Number(CHAT), type: 'private' } } } }), r);
  const inv = calls.find(c => c.method === 'sendInvoice');
  assert.ok(inv, 'sendInvoice chaqirildi');
  assert.equal(inv.params.provider_token, PTOKEN);
  assert.equal(inv.params.currency, 'UZS');
  assert.ok(!JSON.stringify(calls.filter(c => c.method === 'sendMessage')).includes(PTOKEN), 'token xabarga tushmaydi');
});
