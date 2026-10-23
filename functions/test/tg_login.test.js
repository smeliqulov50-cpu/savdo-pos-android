'use strict';
/* fix206-tglogin: Telegram orqali kirish — xavfsizlik va oqimlar. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb, fakeTg } = require('./helpers/tgFake');
const core = require('../src/telegram/core');
const login = require('../src/telegram/login');

const TOKEN = '123:TEST', KEY = core.keyFromToken(TOKEN);
const NOW = Date.UTC(2026, 9, 24, 9, 0, 0);
const TG1 = 900001, TG2 = 900002;

function mk(seed) {
  const db = fakeDb(seed || {}); const tg = fakeTg();
  let now = NOW, nUid = 0;
  const users = { ownerA: ['password'], ownerB: ['google.com'], staff1: [] };
  const tokens = [];
  const deps = {
    db: db, tg: tg, key: KEY, botName: 'savdo_pos_bot', nowMs: function () { return now; },
    createToken: async function (uid) { tokens.push(uid); return 'TOKEN:' + uid; },
    createUser: async function (name) { const u = 'tgUser' + (++nUid); users[u] = []; users[u].name = name; return u; },
    userExists: async function (uid) { return !!users[uid]; },
    userProviders: async function (uid) { return users[uid] || []; },
    deleteUser: async function (uid) { delete users[uid]; }
  };
  return { db: db, tg: tg, deps: deps, users: users, tokens: tokens, tick: function (ms) { now += ms; } };
}
const H = function (e, body, ctx) { return login.handle(e.deps, body, ctx || { ip: '1.2.3.4' }); };
function startMsg(tgId, rid, name) { return { update_id: 1, message: { message_id: 1, chat: { id: tgId, type: 'private' }, from: { id: tgId, first_name: name || 'Ali', language_code: 'uz' }, text: '/start l_' + rid } }; }
function cb(tgId, data, name) { return { update_id: 2, callback_query: { id: 'q' + tgId, data: data, from: { id: tgId, first_name: name || 'Ali', last_name: 'Valiyev' }, message: { message_id: 5, chat: { id: tgId, type: 'private' } } } }; }
async function begin(e, body, ctx) { const r = await H(e, Object.assign({ action: 'start' }, body || {}), ctx); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; }
async function confirm(e, s, tgId) {
  await core.handleUpdate(e.deps, startMsg(tgId || TG1, s.rid));
  return core.handleUpdate(e.deps, cb(tgId || TG1, 'lg:' + s.rid + ':' + s.num));
}
const poll = function (e, s) { return H(e, { action: 'poll', rid: s.rid, poll: s.poll }); };

test('start: havola, raqam, sirlar faqat xesh holida saqlanadi', async function () {
  const e = mk(); const s = await begin(e);
  assert.match(s.url, /^https:\/\/t\.me\/savdo_pos_bot\?start=l_[A-Za-z0-9_-]{32}$/);
  assert.ok(s.num >= 10 && s.num <= 99);
  const d = e.db.store['tgLogins/' + s.rid];
  assert.equal(d.status, 'pending'); assert.equal(d.expMs, NOW + login.TTL_MS);
  assert.equal(d.choices.length, 4); assert.ok(d.choices.indexOf(s.num) !== -1); assert.equal(new Set(d.choices).size, 4);
  assert.ok(JSON.stringify(e.db.store).indexOf(s.poll) === -1, 'poll siri bazada ochiq turmasligi kerak');
  // start parametri bot regex'iga sig'adi (/start <=64 belgi)
  assert.ok(('l_' + s.rid).length <= 64);
});

test('bot: raqam tugmalari, to\'g\'ri raqam → ulanmagan Telegram uchun tanlov', async function () {
  const e = mk(); const s = await begin(e);
  assert.equal((await poll(e, s)).body.status, 'pending');
  const r1 = await core.handleUpdate(e.deps, startMsg(TG1, s.rid));
  assert.equal(r1.login, 'ask');
  const m = e.tg.sent[e.tg.sent.length - 1];
  assert.equal(m.reply_markup.inline_keyboard[0].length, 4);
  assert.equal(m.reply_markup.inline_keyboard[1][0].callback_data, 'lg:' + s.rid + ':x');
  assert.ok(m.text.indexOf(String(s.num)) === -1, 'raqamning o\'zi xabarda ko\'rsatilmaydi');
  const r2 = await core.handleUpdate(e.deps, cb(TG1, 'lg:' + s.rid + ':' + s.num));
  assert.equal(r2.login, 'ok');
  assert.ok(e.tg.calls.some(function (c) { return c.method === 'editMessageText'; }));
  const p = await poll(e, s);
  assert.equal(p.body.status, 'choose'); assert.ok(p.body.ticket); assert.equal(p.body.name, 'Ali Valiyev');
  assert.equal(e.tokens.length, 0, 'tanlovdan oldin hech qanday kirish kaliti berilmaydi');
});

test('noto\'g\'ri raqam yoki «Bu men emasman» — so\'rov butunlay yonadi', async function () {
  const e = mk(); const s = await begin(e);
  await core.handleUpdate(e.deps, startMsg(TG1, s.rid));
  const wrong = e.db.store['tgLogins/' + s.rid].choices.find(function (n) { return n !== s.num; });
  assert.equal((await core.handleUpdate(e.deps, cb(TG1, 'lg:' + s.rid + ':' + wrong))).login, 'wrong');
  assert.equal((await core.handleUpdate(e.deps, cb(TG1, 'lg:' + s.rid + ':' + s.num))).login, 'expired', 'qayta urinib bo\'lmaydi');
  assert.equal((await poll(e, s)).body.status, 'denied');
  const s2 = await begin(e);
  await core.handleUpdate(e.deps, startMsg(TG1, s2.rid));
  assert.equal((await core.handleUpdate(e.deps, cb(TG1, 'lg:' + s2.rid + ':x'))).login, 'denied');
  assert.equal((await poll(e, s2)).body.status, 'denied');
  assert.equal(e.tokens.length, 0);
});

test('havolani faqat birinchi ochgan Telegram foydalanuvchisi tasdiqlay oladi', async function () {
  const e = mk(); const s = await begin(e);
  await core.handleUpdate(e.deps, startMsg(TG1, s.rid));
  assert.equal((await core.handleUpdate(e.deps, startMsg(TG2, s.rid))).login, 'other');
  assert.equal((await core.handleUpdate(e.deps, cb(TG2, 'lg:' + s.rid + ':' + s.num))).login, 'other');
  assert.equal(e.db.store['tgLogins/' + s.rid].status, 'pending');
  // havolani ochmagan foydalanuvchi to'g'ridan-to'g'ri tugma ma'lumotini yuborsa ham
  const s2 = await begin(e);
  assert.equal((await core.handleUpdate(e.deps, cb(TG2, 'lg:' + s2.rid + ':' + s2.num))).login, 'other');
});

test('5 daqiqa muddati: eskirgan havola va tasdiq ishlamaydi', async function () {
  const e = mk(); const s = await begin(e);
  await core.handleUpdate(e.deps, startMsg(TG1, s.rid));
  e.tick(login.TTL_MS + 1000);
  assert.equal((await core.handleUpdate(e.deps, cb(TG1, 'lg:' + s.rid + ':' + s.num))).login, 'expired');
  assert.equal((await poll(e, s)).body.status, 'expired');
  const s2 = await begin(e); e.tick(login.TTL_MS + 1);
  assert.equal((await core.handleUpdate(e.deps, startMsg(TG1, s2.rid))).login, 'expired');
  assert.equal((await core.handleUpdate(e.deps, startMsg(TG1, 'yoq_rid_bunday_narsa_yoq_1234567'))).login, 'expired');
});

test('poll siri noto\'g\'ri bo\'lsa — hech narsa berilmaydi', async function () {
  const e = mk(); const s = await begin(e); await confirm(e, s);
  const bad = await H(e, { action: 'poll', rid: s.rid, poll: s.poll.slice(0, -2) + (s.poll.slice(-2) === 'AA' ? 'BB' : 'AA') });
  assert.equal(bad.status, 403);
  assert.equal((await H(e, { action: 'poll', rid: s.rid })).status, 400);
  assert.equal((await H(e, { action: 'poll', rid: '../x', poll: s.poll })).status, 400);
  assert.equal((await poll(e, s)).body.status, 'choose');
});

test('ulangan Telegram → o\'sha akkauntga kirish (bir marta)', async function () {
  const e = mk({ 'tgAuth/900001': { uid: 'ownerA' }, 'tgAuthUid/ownerA': { tgId: '900001' } });
  const s = await begin(e); await confirm(e, s);
  const p = await poll(e, s);
  assert.deepEqual(p.body, { ok: true, status: 'ok', token: 'TOKEN:ownerA' });
  assert.equal((await poll(e, s)).body.status, 'used', 'kalit ikkinchi marta berilmaydi');
  assert.deepEqual(e.tokens, ['ownerA']);
});

test('ulangan akkaunt o\'chirilgan bo\'lsa — ulanish tozalanadi, tanlov beriladi', async function () {
  const e = mk({ 'tgAuth/900001': { uid: 'gone' }, 'tgAuthUid/gone': { tgId: '900001' } });
  const s = await begin(e); await confirm(e, s);
  const p = await poll(e, s);
  assert.equal(p.body.status, 'choose'); assert.equal(e.db.store['tgAuth/900001'], undefined);
  assert.equal(e.tokens.length, 0);
});

test('tanlov → «Yangi do\'kon»: bitta yangi akkaunt, chipta bir martalik', async function () {
  const e = mk(); const s = await begin(e); await confirm(e, s);
  const c = (await poll(e, s)).body;
  const bad = await H(e, { action: 'new', rid: s.rid, poll: s.poll, ticket: c.ticket.slice(0, -2) + 'zz' });
  assert.equal(bad.body.status, 'used');
  const r = await H(e, { action: 'new', rid: s.rid, poll: s.poll, ticket: c.ticket });
  assert.equal(r.body.status, 'ok'); assert.equal(r.body.token, 'TOKEN:tgUser1');
  assert.equal(e.users.tgUser1.name, 'Ali Valiyev');
  assert.deepEqual(e.db.store['tgAuth/900001'].uid, 'tgUser1');
  assert.equal(e.db.store['tgAuthUid/tgUser1'].tgId, '900001');
  assert.equal((await H(e, { action: 'new', rid: s.rid, poll: s.poll, ticket: c.ticket })).body.status, 'used');
  assert.equal(Object.keys(e.users).filter(function (u) { return /^tgUser/.test(u); }).length, 1, 'ikkinchi akkaunt yaratilmaydi');
  // keyingi safar shu Telegram → o'sha akkaunt (yangi akkaunt emas)
  const s2 = await begin(e); await confirm(e, s2);
  assert.equal((await poll(e, s2)).body.token, 'TOKEN:tgUser1');
  assert.equal(Object.keys(e.users).filter(function (u) { return /^tgUser/.test(u); }).length, 1);
});

test('chipta muddati 10 daqiqa', async function () {
  const e = mk(); const s = await begin(e); await confirm(e, s);
  const c = (await poll(e, s)).body; e.tick(login.TICKET_MS + 1);
  assert.equal((await H(e, { action: 'new', rid: s.rid, poll: s.poll, ticket: c.ticket })).body.status, 'expired');
  assert.equal(e.tokens.length, 0);
});

test('tanlov → «Mavjud akkauntimga ulash»: faqat kirgan ega, xodim emas', async function () {
  const e = mk({ 'staffAuth/staff1': { bid: 'ownerA' } }); const s = await begin(e); await confirm(e, s);
  const c = (await poll(e, s)).body;
  const body = { action: 'link', rid: s.rid, poll: s.poll, ticket: c.ticket };
  assert.equal((await H(e, body, {})).status, 401);
  assert.equal((await H(e, body, { uid: 'staff1' })).status, 403);
  const r = await H(e, body, { uid: 'ownerA' });
  assert.deepEqual(r.body, { ok: true, status: 'linked', name: 'Ali Valiyev' });
  assert.equal(e.db.store['tgAuth/900001'].uid, 'ownerA');
  assert.equal((await H(e, body, { uid: 'ownerB' })).body.status, 'used');
  assert.equal(e.tokens.length, 0, 'ulashda kirish kaliti berilmaydi');
  const s2 = await begin(e); await confirm(e, s2);
  assert.equal((await poll(e, s2)).body.token, 'TOKEN:ownerA');
});

test('Sozlamalar → ulash rejimi: kirgan ega; boshqa akkauntga ulangan Telegram — rad', async function () {
  const e = mk({ 'tgAuth/900002': { uid: 'ownerB' }, 'tgAuthUid/ownerB': { tgId: '900002' }, 'staffAuth/staff1': { bid: 'ownerA' } });
  assert.equal((await H(e, { action: 'start', mode: 'link' })).status, 401);
  assert.equal((await H(e, { action: 'start', mode: 'link' }, { uid: 'staff1' })).status, 403);
  const s = await begin(e, { mode: 'link' }, { uid: 'ownerA' });
  await core.handleUpdate(e.deps, startMsg(TG1, s.rid));
  assert.ok(/ulash/i.test(e.tg.sent[e.tg.sent.length - 1].text));
  await core.handleUpdate(e.deps, cb(TG1, 'lg:' + s.rid + ':' + s.num));
  assert.deepEqual((await poll(e, s)).body, { ok: true, status: 'linked', name: 'Ali Valiyev' });
  assert.equal((await H(e, { action: 'status' }, { uid: 'ownerA' })).body.linked, true);
  // boshqa Telegram'ga almashtirish — eskisi uziladi
  // TG2 ownerB'ga ulangan → ownerA'ga ulab bo'lmaydi
  const s2 = await begin(e, { mode: 'link' }, { uid: 'ownerA' });
  await confirm(e, s2, TG2);
  assert.equal((await poll(e, s2)).body.status, 'tg-used');
  assert.equal(e.db.store['tgAuth/900002'].uid, 'ownerB');
  assert.equal(e.db.store['tgAuth/900001'].uid, 'ownerA');
  assert.equal(e.tokens.length, 0);
});

test('uzish: yagona kirish usuli bo\'lsa — rad; boshqa usul bo\'lsa — uziladi', async function () {
  const e = mk({ 'tgAuth/900001': { uid: 'tgOnly' }, 'tgAuthUid/tgOnly': { tgId: '900001', name: 'Ali' }, 'tgAuth/900002': { uid: 'ownerB' }, 'tgAuthUid/ownerB': { tgId: '900002', name: 'Vali' } });
  e.users.tgOnly = [];
  assert.equal((await H(e, { action: 'unlink' }, { uid: 'tgOnly' })).body.code, 'last-method');
  assert.equal(e.db.store['tgAuth/900001'].uid, 'tgOnly');
  assert.deepEqual((await H(e, { action: 'status' }, { uid: 'ownerB' })).body, { ok: true, linked: true, name: 'Vali' });
  assert.deepEqual((await H(e, { action: 'unlink' }, { uid: 'ownerB' })).body, { ok: true, linked: false });
  assert.equal(e.db.store['tgAuth/900002'], undefined); assert.equal(e.db.store['tgAuthUid/ownerB'], undefined);
  assert.equal((await H(e, { action: 'unlink' }, {})).status, 401);
});

test('cheklov: bir manzildan 10 daqiqada 10 tadan ko\'p so\'rov ochilmaydi', async function () {
  const e = mk();
  for (let i = 0; i < login.RATE_MAX; i++) assert.equal((await H(e, { action: 'start' })).status, 200);
  assert.equal((await H(e, { action: 'start' })).status, 429);
  assert.equal((await H(e, { action: 'start' }, { ip: '5.6.7.8' })).status, 200);
  e.tick(10 * 60 * 1000 + 1);
  assert.equal((await H(e, { action: 'start' })).status, 200);
});

test('bot o\'chiq / noto\'g\'ri amal', async function () {
  const e = mk(); e.deps.botName = '';
  assert.equal((await H(e, { action: 'start' })).status, 503);
  assert.equal((await H(e, { action: 'nima' })).status, 400);
});

test('mavjud bot oqimlari buzilmagan: boshqa callback va /start parametrlar login\'ga tushmaydi', async function () {
  const e = mk();
  const r = await core.handleUpdate(e.deps, { update_id: 3, message: { message_id: 1, chat: { id: TG1, type: 'private' }, from: { id: TG1, language_code: 'uz' }, text: '/start ABCDEFGHJK' } });
  assert.ok(!r || r.login === undefined);
  const r2 = await core.handleUpdate(e.deps, cb(TG1, 'lg:qisqa:12'));
  assert.ok(!r2 || r2.login === undefined);
});

test('tasdiqlash (verify): faqat shu akkauntga ulangan Telegram', async function () {
  const e = mk({ 'tgAuth/900001': { uid: 'ownerA' }, 'tgAuthUid/ownerA': { tgId: '900001' }, 'staffAuth/staff1': { bid: 'ownerA' } });
  assert.equal((await H(e, { action: 'start', mode: 'verify' }, { uid: 'ownerB' })).body.code, 'not-linked');
  assert.equal((await H(e, { action: 'start', mode: 'verify' }, { uid: 'staff1' })).status, 403);
  assert.equal((await H(e, { action: 'start', mode: 'verify' })).status, 401);
  const s = await begin(e, { mode: 'verify' }, { uid: 'ownerA' }); await confirm(e, s, TG1);
  assert.equal((await poll(e, s)).body.status, 'verified');
  assert.equal((await poll(e, s)).body.status, 'used');
  const s2 = await begin(e, { mode: 'verify' }, { uid: 'ownerA' }); await confirm(e, s2, TG2);
  assert.equal((await poll(e, s2)).body.status, 'mismatch');
  assert.equal(e.db.store['tgAuth/900002'], undefined, 'tasdiqlashda yangi ulanish yaratilmaydi');
  assert.equal(e.tokens.length, 0);
});

test('forget: akkaunt o\'chirilganda ulanish o\'chadi; faqat-Telegram akkaunt server tomonida o\'chadi', async function () {
  const e = mk({ 'tgAuth/900001': { uid: 'tgOnly' }, 'tgAuthUid/tgOnly': { tgId: '900001' }, 'businesses/tgOnly': { a: 1 },
    'tgAuth/900002': { uid: 'ownerA' }, 'tgAuthUid/ownerA': { tgId: '900002' } });
  e.users.tgOnly = [];
  assert.equal((await H(e, { action: 'forget' }, {})).status, 401);
  // do'kon hali o'chirilmagan — akkaunt o'chmaydi
  assert.deepEqual((await H(e, { action: 'forget' }, { uid: 'tgOnly' })).body, { ok: true, deleted: false });
  assert.ok(e.users.tgOnly); assert.equal(e.db.store['tgAuth/900001'], undefined);
  delete e.db.store['businesses/tgOnly'];
  assert.deepEqual((await H(e, { action: 'forget' }, { uid: 'tgOnly' })).body, { ok: true, deleted: true });
  assert.equal(e.users.tgOnly, undefined);
  // parolli akkaunt — faqat ulanish o'chadi
  assert.deepEqual((await H(e, { action: 'forget' }, { uid: 'ownerA' })).body, { ok: true, deleted: false });
  assert.ok(e.users.ownerA); assert.equal(e.db.store['tgAuthUid/ownerA'], undefined);
});
