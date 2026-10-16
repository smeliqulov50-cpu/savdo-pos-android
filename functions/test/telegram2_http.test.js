'use strict';
/* fix121-tg2: index.js ulanishi — 4 ta yangi funksiya (jadval + 3 ta Firestore hodisasi), faqat TELEGRAM_BOT_TOKEN,
   hodisalar to'liq oqimda Telegram'ga yetib boradi; token bo'lmasa hech narsa qilinmaydi. */
process.env.SAVDO_PUSH_ONLY = '1';
process.env.SAVDO_TG = '1';
process.env.FIREBASE_CONFIG = JSON.stringify({ projectId: 'sardor-pos' });
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const { fakeDb } = require('./helpers/tgFake');
const TG = require('../src/telegram/core');

const TOKEN = '777:REAL-LOOKING-TOKEN';
const KEY = TG.keyFromToken(TOKEN);
const declared = {};
const NOW = Date.now();
const db = fakeDb({
  'businesses/OWNER1': { businessName: 'Do\'kon', timeZone: 'Asia/Tashkent' },
  'tgBiz/OWNER1': { chats: { '4242': { name: 'Sardor', at: 1, sig: TG.sigOf(KEY, 'OWNER1', '4242') } }, lang: 'uz' },
  'tgChats/4242': { bids: ['OWNER1'] },
  'tgPrefs/OWNER1': { disc: true, discPct: 20, rcpt: true, shift: true, daily: false, low: false, sched: false }
});
const stubs = {
  'firebase-admin': { apps: [1], initializeApp() {}, firestore() { return db; }, messaging() { return {}; }, auth() { return { verifyIdToken: async function () { return { uid: 'OWNER1' }; } }; } },
  'firebase-functions/v2/https': { onRequest(opts, handler) { handler.__opts = opts; return handler; } },
  'firebase-functions/v2': { setGlobalOptions() {} },
  'firebase-functions/v2/firestore': { onDocumentCreated(p, h) { h.__path = p; return h; }, onDocumentWritten(p, h) { h.__path = p; return h; } },
  'firebase-functions/v2/scheduler': { onSchedule(o, h) { h.__opts = o; return h; } },
  'firebase-functions/params': { defineSecret(name) { declared[name] = true; return { name: name, value: () => (name === 'TELEGRAM_BOT_TOKEN' ? TOKEN : '') }; } }
};
const calls = [];
global.fetch = async function (url, init) {
  const method = url.split('/').pop();
  calls.push({ url: url, method: method, params: JSON.parse(init.body || '{}') });
  return { status: 200, json: async function () { return { ok: true, result: method === 'getMe' ? { username: 'savdo_pos_bot' } : { message_id: 1 } }; } };
};
const origLoad = Module._load;
Module._load = function (request) { if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]; return origLoad.apply(this, arguments); };
const fns = require(path.join(__dirname, '..', 'index.js'));
Module._load = origLoad;
const sends = function () { return calls.filter(function (c) { return c.method === 'sendMessage'; }); };

test('4 ta yangi funksiya: to\'g\'ri yo\'llar, jadval, faqat TELEGRAM_BOT_TOKEN; eskilari joyida', () => {
  assert.deepEqual(Object.keys(declared), ['TELEGRAM_BOT_TOKEN']);
  assert.equal(fns.telegramTick.__opts.schedule, 'every 10 minutes'); assert.equal(fns.telegramTick.__opts.secrets.length, 1);
  assert.equal(fns.telegramSaleAlert.__path.document, 'businesses/{bizId}/sales/{saleId}');
  assert.equal(fns.telegramAuditAlert.__path.document, 'businesses/{bizId}/audit/{auditId}');
  assert.equal(fns.telegramShiftAlert.__path.document, 'businesses/{bizId}/meta/catalog');
  ['telegramSaleAlert', 'telegramAuditAlert', 'telegramShiftAlert'].forEach(function (k) { assert.equal(fns[k].__path.secrets.length, 1, k); });
  ['telegramApi', 'telegramWebhook', 'cleanupAuditLog', 'dailyDebtPush', 'notifySupportMessage', 'sharedDebts', 'sharedDebtIndex', 'sharedDebtBackfill'].forEach(function (k) { assert.equal(typeof fns[k], 'function', k); });
  Object.keys(fns).forEach(function (k) { if (k.indexOf('telegram') !== 0) { const o = fns[k].__opts; if (o && o.secrets) assert.equal(o.secrets.length, 0, k); } });
});

test('hodisalar: chegirma, chek o\'chirish, smena — Telegram\'ga yetadi; tokensiz chaqiruvda xato yo\'q', async () => {
  const iso = new Date(NOW - 60000).toISOString();
  await fns.telegramSaleAlert({ params: { bizId: 'OWNER1', saleId: 's1' }, data: { data: function () { return { date: iso, receiptNumber: 5, subtotal: 100000, discountAmount: 30000, total: 70000, cashierId: 'k1', cashierName: 'Ali' }; } } });
  assert.equal(sends().length, 1); assert.equal(sends()[0].params.chat_id, '4242'); assert.match(sends()[0].params.text, /Katta chegirma/);
  assert.ok(sends()[0].url.indexOf('https://api.telegram.org/bot' + TOKEN + '/sendMessage') === 0);
  await fns.telegramAuditAlert({ params: { bizId: 'OWNER1', auditId: 'a1' }, data: { data: function () { return { action: 'saleRefund', detail: '№ 5', date: iso, staffId: 'k1', staffName: 'Ali' }; } } });
  assert.equal(sends().length, 2); assert.match(sends()[1].params.text, /Chek qaytarildi/);
  const sh = { id: 'z', staffName: 'Ali', startTime: new Date(NOW - 3600e3).toISOString(), endTime: iso, salesCount: 1, cashTotal: 1, cardTotal: 0, creditTotal: 0, expectedCash: 1, endCash: 1 };
  await fns.telegramShiftAlert({ params: { bizId: 'OWNER1' }, data: { before: { exists: true, data: function () { return { shifts: [] }; } }, after: { exists: true, data: function () { return { shifts: [sh] }; } } } });
  assert.equal(sends().length, 3); assert.match(sends()[2].params.text, /Smena yopildi/);
  await fns.telegramShiftAlert({ params: { bizId: 'OWNER1' }, data: null });
  await fns.telegramSaleAlert({ params: { bizId: 'OWNER1', saleId: 's2' }, data: null });
  await fns.telegramTick();
  assert.equal(sends().length, 3);
});
