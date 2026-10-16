'use strict';
/* fix120-tg: Telegram bot — ulash / uzish mantig'i (soxta Firestore va soxta Telegram bilan). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb } = require('./helpers/sdFake');
const TG = require('../src/telegram/core');
const { makeTg } = require('../src/telegram/tgApi');

const KEY = TG.keyFromToken('123456:TEST-TOKEN');
function setup(seed, opts) {
  opts = opts || {};
  const db = fakeDb(Object.assign({
    'businesses/OWNER1': { businessName: 'Sardor <Market> & Co', currency: 'UZS' },
    'businesses/OWNER2': { businessName: 'Ikkinchi do\'kon' },
    'staffAuth/STAFF1': { businessId: 'OWNER1', role: 'admin' }
  }, seed || {}));
  const sent = [];
  let t = opts.now || 1760000000000;
  let n = 0;
  const deps = {
    db: db, key: opts.noKey ? null : KEY, botName: 'savdo_test_bot',
    nowMs: function () { return t; },
    randCode: function () { n++; return 'CODE' + String(n).padStart(6, '0'); },
    tg: async function (method, params) {
      if (opts.tgFail) throw new Error('network');
      sent.push({ method: method, params: params });
      if (method === 'getMe') return { username: 'savdo_test_bot' };
      if (method === 'getWebhookInfo') return { url: deps.__url || '', pending_update_count: 0 };
      if (method === 'setWebhook') { deps.__url = params.url; return true; }
      return { message_id: sent.length };
    }
  };
  return { db: db, deps: deps, sent: sent, tick: function (ms) { t += ms; } };
}
function msg(chatId, text, from) {
  return { message: { message_id: 1, chat: { id: chatId, type: 'private', first_name: 'Ali' }, from: Object.assign({ id: chatId, first_name: 'Ali', last_name: 'Valiyev', username: 'ali_v', language_code: 'uz' }, from || {}), text: text } };
}
const lastText = function (s) { const m = s.sent.filter(function (x) { return x.method === 'sendMessage'; }); return m.length ? m[m.length - 1].params.text : ''; };

test('status: ega — ulanmagan, til saqlanadi; xodim — ega emas, chatlar ko\'rinmaydi', async () => {
  const s = setup();
  let r = await TG.handleApi(s.deps, 'OWNER1', { action: 'status', lang: 'ru' });
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.configured, true); assert.equal(r.body.owner, true);
  assert.deepEqual(r.body.chats, []); assert.equal(r.body.max, 3); assert.equal(r.body.bot, 'savdo_test_bot');
  assert.equal(s.db.store['tgBiz/OWNER1'].lang, 'ru');
  r = await TG.handleApi(s.deps, 'STAFF1', { action: 'status' });
  assert.equal(r.body.owner, false); assert.deepEqual(r.body.chats, []);
  r = await TG.handleApi(s.deps, 'STAFF1', { action: 'link' });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'owner_only');
  r = await TG.handleApi(s.deps, '', { action: 'status' });
  assert.equal(r.status, 401);
  r = await TG.handleApi(s.deps, 'OWNER1', { action: 'nima' });
  assert.equal(r.status, 400);
});

test('token yo\'q: bot o\'chiq — configured=false, webhook hech narsa qilmaydi', async () => {
  const s = setup({}, { noKey: true });
  const r = await TG.handleApi(s.deps, 'OWNER1', { action: 'link' });
  assert.equal(r.body.configured, false);
  assert.deepEqual(await TG.handleUpdate(s.deps, msg(5, '/start ABC')), { skipped: 'no_key' });
  assert.equal(s.sent.length, 0);
});

test('ulash: kod faqat xesh ko\'rinishida saqlanadi, havola to\'g\'ri, 15 daqiqa', async () => {
  const s = setup();
  const r = await TG.handleApi(s.deps, 'OWNER1', { action: 'link', lang: 'ru' });
  assert.equal(r.status, 200);
  assert.equal(r.body.url, 'https://t.me/savdo_test_bot?start=' + r.body.code);
  assert.equal(r.body.exp - s.deps.nowMs(), 15 * 60 * 1000);
  const doc = s.db.store['tgCodes/' + TG.codeHash(r.body.code)];
  assert.ok(doc); assert.equal(doc.bid, 'OWNER1'); assert.equal(doc.used, false);
  assert.ok(!JSON.stringify(s.db.store).includes(r.body.code), 'kodning o\'zi bazada yo\'q');
  // haqiqiy kod generatori: 10 belgi, adashtiradigan harflarsiz
  for (let i = 0; i < 50; i++) assert.match(TG.newCode(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{10}$/);
});

test('/start <kod>: chat bog\'lanadi, imzo bilan; ega tilida javob; kod qayta ishlamaydi', async () => {
  const s = setup();
  const L = await TG.handleApi(s.deps, 'OWNER1', { action: 'link', lang: 'ru' });
  const out = await TG.handleUpdate(s.deps, msg(7001, '/start ' + L.body.code));
  assert.equal(out.linked, 'OWNER1');
  assert.match(lastText(s), /Подключено/);
  assert.match(lastText(s), /Sardor &lt;Market&gt; &amp; Co/, 'do\'kon nomi HTML uchun xavfsiz');
  const biz = s.db.store['tgBiz/OWNER1'];
  assert.equal(biz.chats['7001'].sig, TG.sigOf(KEY, 'OWNER1', '7001'));
  assert.equal(biz.chats['7001'].name, 'Ali Valiyev'); assert.equal(biz.chats['7001'].username, 'ali_v');
  assert.deepEqual(s.db.store['tgChats/7001'].bids, ['OWNER1']);
  const st = await TG.handleApi(s.deps, 'OWNER1', { action: 'status' });
  assert.equal(st.body.chats.length, 1); assert.equal(st.body.chats[0].id, '7001');
  // ishlatilgan kod — boshqa chat ham, shu chat ham ulana olmaydi
  await TG.handleUpdate(s.deps, msg(7002, '/start ' + L.body.code));
  assert.match(lastText(s), /Kod noto'g'ri/);
  assert.equal(s.db.store['tgBiz/OWNER1'].chats['7002'], undefined);
});

test('qo\'lda yozilgan kod (kichik harf, @bot bilan) ham ishlaydi; /start kodsiz — salomlashish (Telegram tilida)', async () => {
  const s = setup();
  const L = await TG.handleApi(s.deps, 'OWNER1', { action: 'link' });
  await TG.handleUpdate(s.deps, msg(8001, '/start@savdo_test_bot ' + L.body.code.toLowerCase()));
  assert.ok(s.db.store['tgBiz/OWNER1'].chats['8001']);
  await TG.handleUpdate(s.deps, msg(8002, '/start', { language_code: 'kk' }));
  assert.match(lastText(s), /Сәлем/);
  await TG.handleUpdate(s.deps, msg(8003, '/start', { language_code: 'de' }));
  assert.match(lastText(s), /Salom/, 'tanilmagan til — o\'zbekcha');
});

test('muddati o\'tgan kod; 8 marta xato urinishdan keyin 1 soat blok', async () => {
  const s = setup();
  const L = await TG.handleApi(s.deps, 'OWNER1', { action: 'link' });
  s.tick(15 * 60 * 1000 + 1);
  await TG.handleUpdate(s.deps, msg(9001, '/start ' + L.body.code));
  assert.match(lastText(s), /muddati o'tgan/);
  for (let i = 0; i < 7; i++) await TG.handleUpdate(s.deps, msg(9001, '/start WRONGCODE' + i));
  const L2 = await TG.handleApi(s.deps, 'OWNER1', { action: 'link' });
  await TG.handleUpdate(s.deps, msg(9001, '/start ' + L2.body.code));
  assert.match(lastText(s), /Juda ko'p/);
  assert.equal((s.db.store['tgBiz/OWNER1'].chats || {})['9001'], undefined);
  s.tick(3600 * 1000 + 1);
  const L3 = await TG.handleApi(s.deps, 'OWNER1', { action: 'link' });
  await TG.handleUpdate(s.deps, msg(9001, '/start ' + L3.body.code));
  assert.ok(s.db.store['tgBiz/OWNER1'].chats['9001'], '1 soatdan keyin ulanadi');
});

test('3 tagacha chat; 4-si rad etiladi; shu chat qayta — "allaqachon"', async () => {
  const s = setup();
  for (let i = 1; i <= 3; i++) { const L = await TG.handleApi(s.deps, 'OWNER1', { action: 'link' }); await TG.handleUpdate(s.deps, msg(100 + i, '/start ' + L.body.code)); }
  assert.equal(Object.keys(s.db.store['tgBiz/OWNER1'].chats).length, 3);
  const r = await TG.handleApi(s.deps, 'OWNER1', { action: 'link' });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'limit');
  // ilovadan emas, eski kod bilan 4-chat: baribir rad
  const s2 = setup();
  const codes = []; for (let i = 0; i < 4; i++) codes.push((await TG.handleApi(s2.deps, 'OWNER1', { action: 'link' })).body.code);
  for (let i = 0; i < 4; i++) await TG.handleUpdate(s2.deps, msg(200 + i, '/start ' + codes[i]));
  assert.equal(Object.keys(s2.db.store['tgBiz/OWNER1'].chats).length, 3);
  assert.match(lastText(s2), /3 ta chat/);
  const L = await TG.handleApi(s.deps, 'OWNER1', { action: 'unlink', chat: '103' });
  const L2 = await TG.handleApi(s.deps, 'OWNER1', { action: 'link' });
  await TG.handleUpdate(s.deps, msg(101, '/start ' + L2.body.code));
  assert.match(lastText(s), /allaqachon/);
  assert.equal(Object.keys(s.db.store['tgBiz/OWNER1'].chats).length, 2);
});

test('soxta (imzosiz) chat yozuvi e\'tiborga olinmaydi va keyingi ulashda tozalanadi', async () => {
  const s = setup({ 'tgBiz/OWNER1': { chats: { '666': { name: 'Hacker', at: 1, sig: 'bad' }, '667': { name: 'X', at: 2 } } } });
  const st = await TG.handleApi(s.deps, 'OWNER1', { action: 'status' });
  assert.deepEqual(st.body.chats, []);
  const L = await TG.handleApi(s.deps, 'OWNER1', { action: 'link' });
  assert.equal(L.status, 200, 'soxtalar 3 talik chegarani to\'ldirmaydi');
  await TG.handleUpdate(s.deps, msg(300, '/start ' + L.body.code));
  assert.deepEqual(Object.keys(s.db.store['tgBiz/OWNER1'].chats), ['300']);
});

test('uzish (ilovadan): chatga xabar boradi, ro\'yxatdan chiqadi; noto\'g\'ri chat ID rad', async () => {
  const s = setup();
  const L = await TG.handleApi(s.deps, 'OWNER1', { action: 'link', lang: 'en' });
  await TG.handleUpdate(s.deps, msg(400, '/start ' + L.body.code));
  const r = await TG.handleApi(s.deps, 'OWNER1', { action: 'unlink', chat: '400' });
  assert.equal(r.body.removed, true); assert.deepEqual(r.body.chats, []);
  assert.match(lastText(s), /has been disconnected/);
  assert.deepEqual(s.db.store['tgChats/400'].bids, []);
  assert.equal(s.db.store['tgBiz/OWNER1'].lang, 'en', 'boshqa maydonlar saqlanadi');
  const r2 = await TG.handleApi(s.deps, 'OWNER1', { action: 'unlink', chat: 'abc' });
  assert.equal(r2.status, 400);
  const r3 = await TG.handleApi(s.deps, 'STAFF1', { action: 'unlink', chat: '400' });
  assert.equal(r3.status, 403);
});

test('/stop va botni bloklash: chat barcha do\'konlardan uziladi', async () => {
  const s = setup();
  const a = await TG.handleApi(s.deps, 'OWNER1', { action: 'link' });
  const b = await TG.handleApi(s.deps, 'OWNER2', { action: 'link' });
  await TG.handleUpdate(s.deps, msg(500, '/start ' + a.body.code));
  await TG.handleUpdate(s.deps, msg(500, '/start ' + b.body.code));
  assert.deepEqual(s.db.store['tgChats/500'].bids, ['OWNER1', 'OWNER2']);
  await TG.handleUpdate(s.deps, msg(500, 'salom'));
  assert.match(lastText(s), /Sardor &lt;Market&gt; &amp; Co, Ikkinchi do'kon/);
  const out = await TG.handleUpdate(s.deps, msg(500, '/stop'));
  assert.equal(out.stopped, 2);
  assert.match(lastText(s), /barcha do'konlardan uzildi/);
  assert.deepEqual(s.db.store['tgBiz/OWNER1'].chats, {}); assert.deepEqual(s.db.store['tgBiz/OWNER2'].chats, {});
  await TG.handleUpdate(s.deps, msg(500, '/stop'));
  assert.match(lastText(s), /hech qaysi do'konga ulanmagan/);
  // bloklash
  const c = await TG.handleApi(s.deps, 'OWNER1', { action: 'link' });
  await TG.handleUpdate(s.deps, msg(501, '/start ' + c.body.code));
  const before = s.sent.length;
  const r = await TG.handleUpdate(s.deps, { my_chat_member: { chat: { id: 501, type: 'private' }, new_chat_member: { status: 'kicked' } } });
  assert.equal(r.blocked, true); assert.equal(r.unbound, 1);
  assert.deepEqual(s.db.store['tgBiz/OWNER1'].chats, {});
  assert.equal(s.sent.length, before, 'bloklagan odamga xabar yuborilmaydi');
});

test('guruh chatida ishlamaydi; noma\'lum yangilanish — e\'tiborsiz', async () => {
  const s = setup();
  const L = await TG.handleApi(s.deps, 'OWNER1', { action: 'link' });
  const u = msg(-1001, '/start ' + L.body.code); u.message.chat.type = 'supergroup';
  await TG.handleUpdate(s.deps, u);
  assert.match(lastText(s), /shaxsiy chatda/);
  assert.equal((s.db.store['tgBiz/OWNER1'] || {}).chats, undefined);
  assert.deepEqual(await TG.handleUpdate(s.deps, { edited_message: {} }), { ignored: true });
  const u2 = msg(-1001, 'salom'); u2.message.chat.type = 'group';
  const n = s.sent.length; await TG.handleUpdate(s.deps, u2); assert.equal(s.sent.length, n, 'guruhda oddiy matnga javob yo\'q');
});

test('ulash kodi chegarasi: soatiga 10 ta', async () => {
  const s = setup();
  for (let i = 0; i < 10; i++) assert.equal((await TG.handleApi(s.deps, 'OWNER1', { action: 'link' })).status, 200);
  const r = await TG.handleApi(s.deps, 'OWNER1', { action: 'link' });
  assert.equal(r.status, 429);
  s.tick(3600 * 1000 + 1);
  assert.equal((await TG.handleApi(s.deps, 'OWNER1', { action: 'link' })).status, 200);
});

test('Telegram ishlamasa ham (tarmoq xatosi) ulash buzilmaydi', async () => {
  const s = setup({}, { tgFail: true });
  const L = await TG.handleApi(s.deps, 'OWNER1', { action: 'link' });
  const out = await TG.handleUpdate(s.deps, msg(600, '/start ' + L.body.code));
  assert.equal(out.linked, 'OWNER1');
});

test('webhook o\'rnatish: sirli sarlavha tokendan, kerakli yangilanish turlari', async () => {
  const s = setup();
  const r = await TG.setupWebhook(s.deps, 'https://us-central1-p.cloudfunctions.net/telegramWebhook');
  assert.equal(r.ok, true); assert.equal(r.bot, 'savdo_test_bot');
  const sw = s.sent.find(function (x) { return x.method === 'setWebhook'; }).params;
  assert.equal(sw.secret_token, TG.webhookSecret(KEY)); assert.match(sw.secret_token, /^[0-9a-f]{48}$/);
  assert.deepEqual(sw.allowed_updates, ['message', 'my_chat_member']);
  assert.notEqual(TG.webhookSecret(TG.keyFromToken('boshqa')), sw.secret_token);
});

test('tgApi: token xato matniga tushmaydi', async () => {
  const tok = '999:SECRET-ABC';
  const tg = makeTg(tok, async function (url) { assert.ok(url.indexOf(tok) > 0); return { status: 401, json: async function () { return { ok: false, error_code: 401, description: 'Unauthorized ' + tok }; } }; });
  await assert.rejects(tg('getMe', {}), function (e) { assert.ok(e.message.indexOf(tok) === -1); assert.equal(e.tgCode, 401); return true; });
  const tg2 = makeTg(tok, async function () { throw new Error('connect fail to https://api.telegram.org/bot' + tok + '/getMe'); });
  await assert.rejects(tg2('getMe', {}), function (e) { assert.ok(e.message.indexOf(tok) === -1); assert.equal(e.network, true); return true; });
});
