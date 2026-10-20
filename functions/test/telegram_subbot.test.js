'use strict';
/* fix150-subbot: obuna botda oson — ilovadan "to'lash" niyati bilan ulash, /start pay, menyu yangilanishi, tugash eslatmalari. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb, fakeTg } = require('./helpers/tgFake');
const core = require('../src/telegram/core');
const cmds = require('../src/telegram/cmds');
const pay = require('../src/telegram/pay');

const KEY = core.keyFromToken('123:TEST');
const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 20, 5, 0, 0);   // 20.10.2026 10:00 Toshkent
const BID = 'OWNER1', CHAT = '7001', CHAT2 = '7002';
function seed(extra) {
  return Object.assign({
    'businesses/OWNER1': { businessName: 'Salqin ichimliklar', currency: 'UZS', subscriptionExpiresAtMs: NOW - DAY },
    'tgBiz/OWNER1': { chats: { [CHAT]: { name: 'Ega', at: 1, sig: core.sigOf(KEY, BID, CHAT) } }, lang: 'uz' },
    'tgChats/7001': { bids: [BID] }
  }, extra || {});
}
function mk(s, opt) {
  const db = fakeDb(s || seed()); const tg = fakeTg(); let n = 0;
  const deps = Object.assign({ db: db, tg: tg, key: KEY, botName: 'savdo_pos_bot', payToken: 'PROV:TOKEN', nowMs: () => NOW, randCode: () => 'CODE' + String(++n).padStart(6, '0') }, opt || {});
  return { db, tg, deps };
}
const msg = (chat, text) => ({ message: { message_id: 1, chat: { id: Number(chat), type: 'private', first_name: 'Ali' }, from: { id: Number(chat), first_name: 'Ali', language_code: 'uz' }, text: text } });
const texts = (tg, chat) => tg.sent.filter(m => String(m.chat_id) === String(chat)).map(m => m.text);

test('ilovadan "to\'lash" niyati bilan ulash: ulangan xabaridan keyin darhol tariflar', async () => {
  const s = mk(seed({ 'tgBiz/OWNER1': { chats: {}, lang: 'uz' }, 'tgChats/7001': null }));
  delete s.db.store['tgChats/7001'];
  const L = await core.handleApi(s.deps, 'OWNER1', { action: 'link', intent: 'pay' });
  assert.equal(L.status, 200); assert.ok(L.body.url.endsWith('?start=' + L.body.code));
  await core.handleUpdate(s.deps, msg(CHAT, '/start ' + L.body.code));
  const t = texts(s.tg, CHAT);
  assert.match(t[0], /Ulandi|ulandi/);
  const menu = s.tg.sent.filter(m => String(m.chat_id) === CHAT && m.reply_markup && m.reply_markup.inline_keyboard && /\|/.test(JSON.stringify(m.reply_markup)) && /p\|/.test(JSON.stringify(m.reply_markup)));
  assert.equal(menu.length, 1, JSON.stringify(t));
  assert.match(menu[0].text, /tugagan/);
});

test('niyatsiz ulash avvalgidek: tariflar yuborilmaydi', async () => {
  const s = mk(seed({ 'tgBiz/OWNER1': { chats: {}, lang: 'uz' } }));
  delete s.db.store['tgChats/7001'];
  const L = await core.handleApi(s.deps, 'OWNER1', { action: 'link' });
  assert.equal(s.db.store['tgCodes/' + Object.keys(s.db.store).filter(k => k.indexOf('tgCodes/') === 0)[0].slice(8)].intent, undefined);
  await core.handleUpdate(s.deps, msg(CHAT, '/start ' + L.body.code));
  assert.ok(!JSON.stringify(s.tg.sent).includes('"p|'));
});

test('allaqachon ulangan chat to\'lash niyati bilan kelsa ham tariflar chiqadi', async () => {
  const s = mk();
  const L = await core.handleApi(s.deps, 'OWNER1', { action: 'link', intent: 'pay' });
  await core.handleUpdate(s.deps, msg(CHAT, '/start ' + L.body.code));
  assert.ok(JSON.stringify(s.tg.sent).includes('"p|'));
});

test('/start pay: ulangan — tariflar; ulanmagan — qanday ulash yoziladi', async () => {
  const s = mk();
  await core.handleUpdate(s.deps, msg(CHAT, '/start pay'));
  assert.ok(JSON.stringify(s.tg.sent).includes('"p|'));
  await core.handleUpdate(s.deps, msg('9999', '/start pay'));
  assert.match(texts(s.tg, '9999').pop(), /ulanmagan/);
});

test('menyu yangilanishi: til tanlangan chatda /obuna qaytadi, ulangan chatda pastki chap tugma — buyruqlar menyusi', async () => {
  const s = mk(seed({ 'tgChats/7001': { bids: [BID], ulang: 'ru' }, 'tgChats/7002': { bids: [], ulang: 'uz' }, 'tgChats/7003': { bids: [] } }));
  const ok = await cmds.setupCommands(s.deps);
  assert.equal(ok, 7);
  const sc = s.tg.calls.filter(c => c.method === 'setMyCommands' && c.params.scope);
  assert.deepEqual(sc.map(c => c.params.scope.chat_id).sort(), [7001, 7002]);
  assert.ok(sc.every(c => c.params.commands.some(x => x.command === 'obuna' || x.command === 'pay')));
  assert.ok(sc.find(c => c.params.scope.chat_id === 7002).params.commands.some(x => x.command === 'obuna'));
  const mb = s.tg.calls.filter(c => c.method === 'setChatMenuButton');
  assert.deepEqual(mb.map(c => c.params.chat_id), ['7001']);
  assert.deepEqual(mb[0].params.menu_button, { type: 'commands' });   /* fix152-cmdmenu */
});

test('fix152: egasi o\'z do\'koni havolasini ochsa ham buyruqlar menyusi o\'zgarmaydi; oddiy mijozda — do\'kon tugmasi', async () => {
  const s = mk(seed({ 'tgShop/OWNER1': { enabled: true, slug: 'salqin', branchId: 'main', pickup: true }, 'tgSlug/salqin': { bid: BID } }));
  await core.handleUpdate(s.deps, msg(CHAT, '/start s_salqin'));
  assert.ok(!s.tg.calls.some(c => c.method === 'setChatMenuButton'));
  await core.handleUpdate(s.deps, msg('9911', '/start s_salqin'));
  assert.ok(s.tg.calls.some(c => c.method === 'setChatMenuButton' && c.params.chat_id === '9911' && c.params.menu_button.type === 'web_app'));
});

test('eslatma bosqichlari: 3 kun, 1 kun, tugagan (2 kungacha); boshqa kunlarda yo\'q', () => {
  assert.equal(pay.remStage(NOW + 3 * DAY, NOW), 'd3');
  assert.equal(pay.remStage(NOW + 2 * DAY, NOW), '');
  assert.equal(pay.remStage(NOW + DAY, NOW), 'd1');
  assert.equal(pay.remStage(NOW + 3600000, NOW), '');   // bugun kechroq tugaydi — hali tugamagan
  assert.equal(pay.remStage(NOW - 60000, NOW), 'end');
  assert.equal(pay.remStage(NOW - 2 * DAY, NOW), 'end');
  assert.equal(pay.remStage(NOW - 3 * DAY, NOW), '');
  assert.equal(pay.remStage(NOW + 10 * DAY, NOW), '');
});

test('eslatma: har bir bosqich bir marta, faqat imzoli chatlarga, tugma — tariflar sahifasi', async () => {
  const s = mk(seed({
    'businesses/OWNER1': { businessName: 'Salqin', subscriptionExpiresAtMs: NOW + 3 * DAY },
    'tgBiz/OWNER1': { chats: { [CHAT]: { name: 'Ega', at: 1, sig: core.sigOf(KEY, BID, CHAT) }, [CHAT2]: { name: 'Soxta', at: 1, sig: 'bad' } }, lang: 'uz' },
    'businesses/B2': { businessName: 'Uzoq', subscriptionExpiresAtMs: NOW + 40 * DAY },
    'tgBiz/B2': { chats: { '8001': { name: 'X', at: 1, sig: core.sigOf(KEY, 'B2', '8001') } }, lang: 'ru' }
  }));
  let r = await pay.subRemind(s.deps, NOW);
  assert.equal(r.sent, 1); assert.equal(r.checked, 2);
  const m = s.tg.sent[0];
  assert.equal(String(m.chat_id), CHAT); assert.match(m.text, /3 kun qoldi/); assert.match(m.text, /23\.10\.2026/);
  assert.equal(m.reply_markup.inline_keyboard[0][0].text, '💳 Obunani uzaytirish');
  assert.ok(m.reply_markup.inline_keyboard[0][0].web_app.url.endsWith('?v=me'));
  r = await pay.subRemind(s.deps, NOW + 3600000);
  assert.equal(r.sent, 0, 'qayta yuborilmaydi');
  r = await pay.subRemind(s.deps, NOW + 2 * DAY);
  assert.equal(r.sent, 1); assert.match(s.tg.sent[1].text, /ertaga/);
  r = await pay.subRemind(s.deps, NOW + 3 * DAY + 60000);
  assert.equal(r.sent, 1); assert.match(s.tg.sent[2].text, /tugadi/);
  r = await pay.subRemind(s.deps, NOW + 4 * DAY);
  assert.equal(r.sent, 0);
  s.db.store['businesses/OWNER1'].subscriptionExpiresAtMs = NOW + 33 * DAY;   // to'landi — yangi muddat, yangi eslatmalar keyin
  r = await pay.subRemind(s.deps, NOW + 4 * DAY);
  assert.equal(r.sent, 0);
});

test('eslatma: kalit yo\'q bo\'lsa hech narsa qilinmaydi', async () => {
  const s = mk(seed(), { key: null });
  const r = await pay.subRemind(s.deps, NOW);
  assert.equal(r.sent, 0); assert.equal(s.tg.sent.length, 0);
});

test('bot tugmasi ikki marta bosilsa: o\'sha chat — yana tariflar; boshqa chat — kod yaroqsiz', async () => {
  const s = mk(seed({ 'tgBiz/OWNER1': { chats: {}, lang: 'uz' } }));
  delete s.db.store['tgChats/7001'];
  const L = await core.handleApi(s.deps, 'OWNER1', { action: 'link', intent: 'pay' });
  await core.handleUpdate(s.deps, msg(CHAT, '/start ' + L.body.code));
  const n1 = s.tg.sent.filter(m => /"p\|/.test(JSON.stringify(m.reply_markup || {}))).length;
  const out = await core.handleUpdate(s.deps, msg(CHAT, '/start ' + L.body.code));
  const n2 = s.tg.sent.filter(m => /"p\|/.test(JSON.stringify(m.reply_markup || {}))).length;
  assert.equal(n1, 1); assert.equal(n2, 2); assert.ok(!/noto/.test(out.reply), out.reply);
  const o3 = await core.handleUpdate(s.deps, msg('7009', '/start ' + L.body.code));
  assert.match(o3.reply, /noto|eskirgan/i);
  s.deps.nowMs = () => NOW + 16 * 60000;
  const o4 = await core.handleUpdate(s.deps, msg(CHAT, '/start ' + L.body.code));
  assert.match(o4.reply, /noto|eskirgan/i);
});
