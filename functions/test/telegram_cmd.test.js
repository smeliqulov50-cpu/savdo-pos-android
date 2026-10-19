'use strict';
/* fix144-tgcmd: 3-bosqich — /bugun /kecha /qarzlar /kam_qolgan, /til (6 til), /yordam, tugmali menyu, cheklov, imzo. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb, fakeTg } = require('./helpers/tgFake');
const core = require('../src/telegram/core');
const cmds = require('../src/telegram/cmds');
const R = require('../src/telegram/reports');
const C = require('../src/telegram/cmdTexts');

const KEY = core.keyFromToken('123:TEST');
const BID = 'bizA', BID2 = 'bizB', CHAT = '7001', CHAT2 = '7002';
const NOW = Date.UTC(2026, 9, 19, 9, 0, 0);          // 19.10.2026 14:00 (Toshkent)
const TODAY = '2026-10-19T07:00:00.000Z', YDAY = '2026-10-18T12:00:00.000Z', OLD = '2026-10-10T12:00:00.000Z';
function sale(id, date, total, extra) { return Object.assign({ id: id, date: date, total: total, subtotal: total, paymentType: 'cash', items: [{ productId: 'p1', name: 'Osh', qty: 1, price: total, costPrice: total / 2 }] }, extra || {}); }
function seed(extra) {
  const s = {};
  s['businesses/' + BID] = { businessName: 'Sardor Market', timeZone: 'Asia/Tashkent', currency: 'UZS', lowStockThreshold: 5 };
  s['tgBiz/' + BID] = { chats: { [CHAT]: { name: 'Ega', at: 1, sig: core.sigOf(KEY, BID, CHAT) }, [CHAT2]: { name: 'Hamkor', at: 2, sig: core.sigOf(KEY, BID, CHAT2) } }, lang: 'uz' };
  s['tgChats/' + CHAT] = { bids: [BID] };
  s['tgChats/' + CHAT2] = { bids: [BID] };
  s['businesses/' + BID + '/sales/s1'] = sale('s1', TODAY, 50000);
  s['businesses/' + BID + '/sales/s2'] = sale('s2', YDAY, 120000);
  s['businesses/' + BID + '/sales/s3'] = sale('s3', OLD, 999000);
  s['businesses/' + BID + '/customers/c1'] = { id: 'c1', name: 'Ali <b>', debt: 300000 };
  s['businesses/' + BID + '/customers/c2'] = { id: 'c2', name: 'Vali', debt: 500000 };
  s['businesses/' + BID + '/customers/c3'] = { id: 'c3', name: 'Yashirin', debt: 900000, hidden: true };
  s['businesses/' + BID + '/customers/c4'] = { id: 'c4', name: 'Toza', debt: 0 };
  s['businesses/' + BID + '/creditors/k1'] = { id: 'k1', name: 'Ulgurji ombor', debt: 2000000 };
  s['businesses/' + BID + '/products/p1'] = { id: 'p1', name: 'Osh', stock: 2, price: 50000 };
  s['businesses/' + BID + '/products/p2'] = { id: 'p2', name: 'Non', stock: 100, price: 4000 };
  return Object.assign(s, extra || {});
}
function mk(seedObj, opt) {
  const db = fakeDb(seedObj || seed()); const tg = fakeTg();
  const deps = Object.assign({ db: db, tg: tg, key: KEY, nowMs: function () { return NOW; }, botName: 'savdo_pos_bot', payToken: '' }, opt || {});
  return { db, tg, deps };
}
const msg = (text, chat, lc) => ({ message: { message_id: 1, chat: { id: Number(chat || CHAT), type: 'private' }, from: { id: 77, language_code: lc || 'uz' }, text: text } });
const cbq = (data, chat, type) => ({ callback_query: { id: 'cq', data: data, from: { id: 77, language_code: 'uz' }, message: { message_id: 9, chat: { id: Number(chat || CHAT), type: type || 'private' } } } });
const last = (tg) => tg.sent[tg.sent.length - 1];

test('/bugun: bugungi savdo hozirgacha, tugmali menyu', async () => {
  const { tg, deps } = mk();
  const r = await core.handleUpdate(deps, msg('/bugun'));
  assert.equal(r.cmd, 'today'); assert.equal(r.sent, 1);
  const m = last(tg);
  assert.match(m.text, /Kunlik hisobot/); assert.match(m.text, /Sardor Market/); assert.match(m.text, /19\.10\.2026 \(hozirgacha, 14:00\)/);
  assert.match(m.text, /50 000 so'm/); assert.ok(!/120 000/.test(m.text), 'kechagi savdo kirmaydi');
  const kb = m.reply_markup.inline_keyboard;
  assert.deepEqual(kb.map(r => r.map(b => b.callback_data)), [['c|today', 'c|yday'], ['c|debts', 'c|low'], ['c|lang']]);
  assert.ok(kb.every(row => row.every(b => Buffer.byteLength(b.callback_data) <= 64)));
});

test('/kecha: faqat kechagi savdo; bo\'sh kun — "Bu kunda savdo bo\'lmagan"', async () => {
  const { tg, deps, db } = mk();
  await core.handleUpdate(deps, msg('/kecha'));
  let t = last(tg).text;
  assert.match(t, /18\.10\.2026/); assert.match(t, /120 000 so'm/); assert.ok(!/hozirgacha/.test(t)); assert.ok(!/50 000 so'm/.test(t));
  delete db.store['businesses/' + BID + '/sales/s2'];
  await core.handleUpdate(deps, msg('/yesterday@savdo_pos_bot'));
  t = last(tg).text;
  assert.match(t, /Bu kunda savdo bo'lmagan/); assert.ok(!/Bugun hali/.test(t));
});

test('/qarzlar: mijozlar (yashirin va 0 lar yo\'q), mening qarzlarim; HTML xavfsiz', async () => {
  const { tg, deps } = mk();
  await core.handleUpdate(deps, msg('/qarzlar'));
  const t = last(tg).text;
  assert.match(t, /Mijozlar qarzi: <b>800 000 so'm<\/b> \(2 ta\)/);
  assert.ok(t.indexOf('Vali') < t.indexOf('Ali &lt;b&gt;'), 'eng kattasi birinchi');
  assert.ok(!/Yashirin|Toza/.test(t));
  assert.match(t, /Mening qarzlarim \(yetkazib beruvchilarga\): <b>2 000 000 so'm<\/b>/);
  assert.match(t, /Ulgurji ombor — 2 000 000/);
  const e = mk(seed({ ['businesses/' + BID + '/customers/c1']: { id: 'c1', name: 'A', debt: 0 }, ['businesses/' + BID + '/customers/c2']: { id: 'c2', name: 'B', debt: -5 }, ['businesses/' + BID + '/creditors/k1']: { id: 'k1', name: 'K', debt: 0 } }));
  await core.handleUpdate(e.deps, msg('/debts'));
  assert.match(last(e.tg).text, /Qarz yo'q/);
});

test('/qarzlar: 10 tadan ko\'p mijoz — "yana N ta"', async () => {
  const s = seed();
  for (let i = 0; i < 14; i++) s['businesses/' + BID + '/customers/x' + i] = { id: 'x' + i, name: 'Mijoz ' + i, debt: 1000 * (i + 1) };
  const { tg, deps } = mk(s);
  await core.handleUpdate(deps, msg('/qarzlar'));
  const t = last(tg).text;
  assert.match(t, /\(16 ta\)/); assert.match(t, /… yana 6 ta/);
  assert.equal((t.match(/^\d+\. /gm) || []).length, 11, '10 mijoz + 1 yetkazib beruvchi');
});

test('/kam_qolgan va /low: kam qolgan tovarlar', async () => {
  const { tg, deps } = mk();
  await core.handleUpdate(deps, msg('/kam_qolgan'));
  assert.match(last(tg).text, /Kam qolgan tovarlar/); assert.match(last(tg).text, /Osh/); assert.ok(!/Non/.test(last(tg).text));
  await core.handleUpdate(deps, msg('/low'));
  assert.match(last(tg).text, /Osh/);
});

test('ulanmagan va imzosi soxta chat — ma\'lumot berilmaydi', async () => {
  const a = mk();
  let r = await core.handleUpdate(a.deps, msg('/bugun', '999'));
  assert.equal(r.notLinked, true); assert.match(last(a.tg).text, /ulanmagan/); assert.ok(!/50 000/.test(last(a.tg).text));
  const s = seed(); s['tgBiz/' + BID].chats[CHAT].sig = 'soxta';
  const b = mk(s);
  r = await core.handleUpdate(b.deps, msg('/qarzlar'));
  assert.equal(r.notLinked, true); assert.ok(!b.tg.sent.some(x => /Vali/.test(x.text)));
});

test('guruhda buyruq ishlamaydi (faqat shaxsiy chat)', async () => {
  const { tg, deps } = mk();
  const g = { message: { message_id: 1, chat: { id: -100, type: 'group' }, from: { id: 1, language_code: 'uz' }, text: '/bugun' } };
  await core.handleUpdate(deps, g);
  assert.match(last(tg).text, /shaxsiy chatda/);
  assert.equal((await core.handleUpdate(deps, cbq('c|today', -100, 'group'))).ignored, true);
});

test('/til: 6 til tugmasi; tanlansa saqlanadi, javoblar va hisobotlar shu tilda', async () => {
  const { tg, deps, db } = mk();
  await core.handleUpdate(deps, msg('/til'));
  const kb = last(tg).reply_markup.inline_keyboard;
  assert.deepEqual([].concat.apply([], kb).map(b => b.callback_data), ['l|uz', 'l|ru', 'l|en', 'l|kk', 'l|ky', 'l|tg']);
  const r = await core.handleUpdate(deps, cbq('l|ru'));
  assert.equal(r.lang, 'ru'); assert.equal(db.store['tgChats/' + CHAT].ulang, 'ru');
  assert.deepEqual(db.store['tgChats/' + CHAT].bids, [BID], 'boshqa maydonlar saqlanib qoladi');
  assert.match(last(tg).text, /Язык изменён: 🇷🇺 Русский/);
  const sc = tg.calls.filter(c => c.method === 'setMyCommands').pop().params;
  assert.deepEqual(sc.scope, { type: 'chat', chat_id: Number(CHAT) }); assert.equal(sc.commands[0].command, 'today'); assert.match(sc.commands[0].description, /Продажи/);
  assert.ok(tg.calls.some(c => c.method === 'answerCallbackQuery'));
  await core.handleUpdate(deps, msg('/bugun', CHAT, 'uz'));
  assert.match(last(tg).text, /Отчёт за день/, 'Telegram tili uz bo\'lsa ham tanlangan til');
  assert.equal(last(tg).reply_markup.inline_keyboard[0][0].text, '📊 Сегодня');
  // kunlik avtomatik hisobot: CHAT — ruscha, CHAT2 — do'kon tili (o'zbekcha)
  await db.collection('tgPrefs').doc(BID).set(Object.assign(R.normPrefs({ daily: true, dailyTime: '21:00' }), { sched: true, tz: 'Asia/Tashkent' }));
  const tg2 = fakeTg(); const d2 = Object.assign({}, deps, { tg: tg2, nowMs: function () { return Date.UTC(2026, 9, 19, 16, 5); } });
  const st = await R.runTick(d2, new Date(d2.nowMs()));
  assert.equal(st.daily, 1); assert.equal(tg2.sent.length, 2);
  const by = {}; tg2.sent.forEach(m => { by[String(m.chat_id)] = m.text; });
  assert.match(by[CHAT], /Отчёт за день/); assert.match(by[CHAT2], /Kunlik hisobot/);
  assert.match(by[CHAT], /50 000 сум/); assert.match(by[CHAT2], /50 000 so'm/);
});

test('tugmalar: c|today ishlaydi, noma\'lum tugma e\'tiborsiz; to\'lov tugmasi avvalgidek', async () => {
  const { tg, deps } = mk();
  const r = await core.handleUpdate(deps, cbq('c|today'));
  assert.equal(r.cmd, 'today'); assert.match(last(tg).text, /Kunlik hisobot/);
  assert.equal((await core.handleUpdate(deps, cbq('c|hack'))).ignored, true);
  assert.equal((await core.handleUpdate(deps, cbq('l|zz'))).ignored, true);
  assert.equal((await core.handleUpdate(deps, cbq('xyz'))).ignored, true);
  const p = await core.handleUpdate(deps, cbq('p|000000000000|m'));
  assert.equal(p.off, true, 'to\'lov tugmasi to\'lov ishlovchisiga boradi');
});

test('cheklov: soatiga 30 tadan ortiq so\'rov — "juda ko\'p"', async () => {
  const { tg, deps } = mk();
  for (let i = 0; i < cmds.CMD_PER_HOUR; i++) { const r = await core.handleUpdate(deps, msg('/bugun')); assert.equal(r.cmd, 'today'); }
  const r = await core.handleUpdate(deps, msg('/qarzlar'));
  assert.equal(r.tooMany, true); assert.match(last(tg).text, /juda ko'p/);
  const r2 = await core.handleUpdate(deps, msg('/yordam'));
  assert.equal(r2.help, true, 'yordam cheklanmaydi');
});

test('/yordam: buyruqlar ro\'yxati; ulanmagan chatga ulash yo\'li', async () => {
  const a = mk();
  await core.handleUpdate(a.deps, msg('/yordam'));
  let t = last(a.tg).text;
  ['/bugun', '/kecha', '/qarzlar', '/kam_qolgan', '/til', '/yordam', '/stop'].forEach(c => assert.ok(t.indexOf(c + ' — ') !== -1, c));
  assert.ok(!/\/obuna/.test(t), 'to\'lov yoqilmagan — /obuna ko\'rsatilmaydi');
  assert.ok(last(a.tg).reply_markup);
  await core.handleUpdate(a.deps, msg('/help', '999', 'en'));
  t = last(a.tg).text;
  assert.match(t, /\/today — /); assert.match(t, /connect this chat/); assert.ok(!last(a.tg).reply_markup);
  const b = mk(seed(), { payToken: 'P:TEST' });
  await core.handleUpdate(b.deps, msg('/yordam'));
  assert.match(last(b.tg).text, /\/obuna — /);
  assert.deepEqual(last(b.tg).reply_markup.inline_keyboard[2].map(x => x.callback_data), ['c|pay', 'c|lang']);
});

test('ikki do\'konga ulangan chat — har biriga alohida javob, menyu oxirgisida', async () => {
  const s = seed();
  s['businesses/' + BID2] = { businessName: 'Ikkinchi', timeZone: 'Asia/Tashkent' };
  s['tgBiz/' + BID2] = { chats: { [CHAT]: { name: 'Ega', at: 1, sig: core.sigOf(KEY, BID2, CHAT) } } };
  s['tgChats/' + CHAT] = { bids: [BID, BID2] };
  const { tg, deps } = mk(s);
  const r = await core.handleUpdate(deps, msg('/bugun'));
  assert.equal(r.shops, 2); assert.equal(tg.sent.length, 2);
  assert.match(tg.sent[0].text, /Sardor Market/); assert.ok(!tg.sent[0].reply_markup);
  assert.match(tg.sent[1].text, /Ikkinchi/); assert.ok(tg.sent[1].reply_markup);
});

test('6 tilning hammasida: /bugun, /kecha, /qarzlar, /kam_qolgan, /yordam — bo\'sh yoki "undefined" matn yo\'q', async () => {
  for (const l of C.LANGS) {
    const { tg, deps, db } = mk();
    db.store['tgChats/' + CHAT].ulang = l;
    for (const c of ['/today', '/yesterday', '/debts', '/low', '/help', '/lang']) {
      await core.handleUpdate(deps, msg(c));
      const m = last(tg);
      assert.ok(m && m.text && m.text.length > 10 && !/undefined|null|NaN|\{[a-z]+\}/.test(m.text), l + ' ' + c + ': ' + (m && m.text));
      if (m.reply_markup) [].concat.apply([], m.reply_markup.inline_keyboard).forEach(b => assert.ok(b.text && !/undefined/.test(b.text), l + ' tugma'));
    }
  }
});

test('ma\'lumot o\'qib bo\'lmasa — xato xabari, bot yiqilmaydi', async () => {
  const { tg, deps, db } = mk();
  const orig = db.collection;
  db.collection = function (n) { const c = orig.call(db, n); if (n === 'businesses') { const d = c.doc; c.doc = function (id) { const r = d(id); r.collection = function () { throw new Error('boom'); }; return r; }; } return c; };
  const r = await core.handleUpdate(deps, msg('/qarzlar'));
  assert.equal(r.cmd, 'debts'); assert.match(last(tg).text, /olib bo'lmadi/);
});

test('ulash: "Ulandi" xabari tugmali menyu bilan; oddiy matn — menyu', async () => {
  const { tg, deps, db } = mk(seed({ ['tgCodes/' + core.codeHash('ABCDEFGHJK')]: { bid: BID, uid: BID, exp: NOW + 60000, used: false, at: NOW } }));
  delete db.store['tgChats/8001'];
  await core.handleUpdate(deps, msg('/start ABCDEFGHJK', '8001'));
  assert.match(last(tg).text, /Ulandi/); assert.ok(last(tg).reply_markup && last(tg).reply_markup.inline_keyboard.length === 3);
  await core.handleUpdate(deps, msg('salom'));
  assert.match(last(tg).text, /ulangan: Sardor Market/); assert.ok(last(tg).reply_markup);
  await core.handleUpdate(deps, msg('salom', '9999'));
  assert.match(last(tg).text, /Salom/); assert.match(last(tg).text, /\/til/); assert.ok(!last(tg).reply_markup);
});

test('webhook o\'rnatilganda: menyu buyruqlari har bir tilda (Telegram talablariga mos)', async () => {
  for (const pt of ['', 'P:TEST']) {
    const { tg, deps } = mk(seed(), { payToken: pt });
    const r = await core.setupWebhook(deps, 'https://x/telegramWebhook');
    const sc = tg.calls.filter(c => c.method === 'setMyCommands').map(c => c.params);
    assert.equal(r.commands, 7); assert.equal(sc.length, 7);
    assert.deepEqual(sc.map(p => p.language_code || '-').sort(), ['-', 'en', 'kk', 'ky', 'ru', 'tg', 'uz']);
    sc.forEach(function (p) {
      assert.equal(p.commands.length, pt ? 8 : 7);
      p.commands.forEach(function (c) { assert.match(c.command, /^[a-z0-9_]{1,32}$/); assert.ok(c.description.length >= 3 && c.description.length <= 256, c.description); });
    });
    assert.equal(sc.find(p => !p.language_code).commands[0].command, 'bugun');
    assert.equal(sc.find(p => p.language_code === 'ru').commands[0].command, 'today');
    assert.ok(sc.every(p => p.commands.some(c => c.command === 'pay' || c.command === 'obuna') === !!pt));
  }
});

test('parse: aliaslar va @bot qo\'shimchasi; boshqa matn — buyruq emas', () => {
  assert.equal(cmds.parse('/bugun'), 'today'); assert.equal(cmds.parse('/BUGUN'), 'today'); assert.equal(cmds.parse('/today@savdo_pos_bot'), 'today');
  assert.equal(cmds.parse('/kam_qolgan'), 'low'); assert.equal(cmds.parse('/menyu'), 'help'); assert.equal(cmds.parse('/obuna'), 'pay');
  assert.equal(cmds.parse('/start'), null); assert.equal(cmds.parse('/stop'), null); assert.equal(cmds.parse('bugun'), null); assert.equal(cmds.parse('/bugun ertaga'), null);
});
