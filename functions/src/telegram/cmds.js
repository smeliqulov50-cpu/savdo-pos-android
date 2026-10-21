'use strict';
/* fix144-tgcmd: Telegram bot — 3-bosqich: buyruqlar va menyu (faqat ulangan chatlar uchun ma'lumot).
     /bugun /today       — bugungi savdo (hozirgacha)        /kecha /yesterday — kechagi hisobot
     /qarzlar /debts     — mijozlar qarzi va mening qarzlarim  /kam_qolgan /low   — kam qolgan tovarlar
     /til /lang          — 6 tildan birini tanlash (chat uchun saqlanadi, hisobotlar ham shu tilda)
     /yordam /help       — buyruqlar ro'yxati va tugmali menyu   /obuna /pay — to'lov (fix142)
   Raqamlar 2-bosqichdagi kunlik hisobot va "kam qolgan" bilan bir xil formulada (reports.js). Chat imzosi tekshiriladi.
   Himoya: chat uchun soatiga CMD_PER_HOUR tadan ortiq ma'lumot so'rovi bajarilmaydi. */
const C = require('./cmdTexts');
const { pickLang } = require('./texts');
const M = require('./msgs');
const DR = require('../push/dailyReport');

const HOUR = 3600 * 1000;
const CMD_PER_HOUR = 30;
const MAX_SHOPS = 3;
const KINDS = ['today', 'yday', 'debts', 'low', 'pay', 'my', 'phone', 'lang', 'help'];   /* fix158-custfull */   /* fix155-custbot */
const DATA_KINDS = ['today', 'yday', 'debts', 'low'];
const ALIASES = { today: ['bugun', 'today'], yday: ['kecha', 'yesterday'], debts: ['qarzlar', 'debts'], low: ['kam_qolgan', 'low'],
  pay: ['obuna', 'pay'], my: ['mening', 'my', 'me'], phone: ['raqam', 'phone', 'nomer', 'номер'], lang: ['til', 'lang'], help: ['yordam', 'help', 'menu', 'menyu'] };   /* fix155-custbot */
const TOP_CUST = 10, TOP_SUP = 5;

async function getData(ref) { const s = await ref.get(); return s && s.exists ? (s.data() || {}) : null; }
function R() { return require('./reports'); }   // aylanma bog'liqlik bo'lmasin
function P() { return require('./pay'); }

function parse(text) {
  const m = /^\/([A-Za-z_]{2,32})(?:@[A-Za-z0-9_]+)?\s*$/.exec(String(text || '').trim());
  if (!m) return null;
  const c = m[1].toLowerCase();
  for (const k of Object.keys(ALIASES)) if (ALIASES[k].indexOf(c) !== -1) return k;
  return null;
}
async function chatLang(deps, chatId, fallbackCode) {
  try { const ch = await getData(deps.db.collection('tgChats').doc(String(chatId))); if (ch && C.LANGS.indexOf(ch.ulang) !== -1) return ch.ulang; } catch (e) {}
  return pickLang(fallbackCode);
}
function menuKb(deps, lang) {
  const b = function (k, cb) { return { text: C.t(k, lang), callback_data: 'c|' + cb }; };
  const rows = [[b('bToday', 'today'), b('bYday', 'yday')], [b('bDebts', 'debts'), b('bLow', 'low')]];
  rows.push(deps.payToken ? [b('bPay', 'pay'), b('bLang', 'lang')] : [b('bLang', 'lang')]);
  rows.push([require('./shop').hubBtn(lang)]);   /* fix146-tgsub: obuna tariflari va o'z katalogi (mini ilova) */
  return { inline_keyboard: rows };
}
function langKb() {
  const L = C.LANGS.map(function (l) { return { text: C.LANG_NAMES[l], callback_data: 'l|' + l }; });
  return { inline_keyboard: [[L[0], L[1]], [L[2], L[3]], [L[4], L[5]]] };
}
async function send(deps, chatId, text, kb) {
  const p = { chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (kb) p.reply_markup = kb;
  try { await deps.tg('sendMessage', p); return true; } catch (e) { return false; }
}
function cmdList(deps, lang) {
  const n = C.names(lang);
  const ks = ['today', 'yday', 'debts', 'low'].concat(deps.payToken ? ['pay'] : []).concat(['my', 'phone', 'lang', 'help', 'stop']);   /* fix158-custfull */   /* fix155-custbot */
  const D = { today: 'dToday', yday: 'dYday', debts: 'dDebts', low: 'dLow', pay: 'dPay', my: 'dMy', phone: 'dPhone', lang: 'dLang', help: 'dHelp', stop: 'dStop' };
  const E = { today: '📊', yday: '📅', debts: '👥', low: '📦', pay: '💳', my: '👤', phone: '📱', lang: '🌐', help: '❓', stop: '🔌' };   /* fix161-cmdicons */
  return ks.map(function (k) { return { command: n[k], description: E[k] + ' ' + C.T[D[k]][C.lg(lang)] }; });
}
function helpHtml(deps, lang, linked) {
  const lines = [C.t('helpTitle', lang), ''];
  cmdList(deps, lang).forEach(function (c) { lines.push('/' + c.command + ' — ' + require('./texts').esc(c.description)); });
  lines.push('');
  lines.push(linked ? C.t('helpFoot', lang) : C.t('helpNotLinked', lang));
  return lines.join('\n');
}
/* Soatiga CMD_PER_HOUR tadan ko'p emas (chat bo'yicha) */
async function allow(deps, chatId) {
  const db = deps.db, now = deps.nowMs(), ref = db.collection('tgChats').doc(String(chatId));
  return db.runTransaction(async function (tx) {
    const s = await tx.get(ref); const d = s && s.exists ? (s.data() || {}) : {};
    const times = (Array.isArray(d.cmdTimes) ? d.cmdTimes : []).filter(function (x) { return x > now - HOUR; });
    if (times.length >= CMD_PER_HOUR) return false;
    tx.set(ref, Object.assign({}, d, { cmdTimes: times.concat([now]) }));
    return true;
  });
}

/* ---------- qarzlar ---------- */
async function computeDebts(db, bid) {
  const ref = db.collection('businesses').doc(bid);
  const res = await Promise.all([ref.collection('customers').get(), ref.collection('creditors').get()]);
  const D = R().docsOf;
  const pick = function (arr) {
    const xs = arr.filter(function (c) { return c && !c.hidden && !c._deleted && Number(c.debt) > 0; })
      .map(function (c) { return { name: String(c.name || '—').slice(0, 60), debt: Number(c.debt) || 0, branchId: c.branchId || 'main' }; })
      .sort(function (a, b) { return (b.debt - a.debt) || a.name.localeCompare(b.name); });
    return { total: xs.reduce(function (a, x) { return a + x.debt; }, 0), count: xs.length, list: xs };
  };
  return { cust: pick(D(res[0])), sup: pick(D(res[1])) };
}
function debtsText(lang, d, ctx) {
  const esc = require('./texts').esc;
  const lines = ['👥 <b>' + esc(C.t('debts', lang)) + '</b> · ' + esc(ctx.shop)];
  lines.push('🕐 ' + esc(ctx.dateStr) + ' ' + esc(ctx.timeStr));
  if (!d.cust.count && !d.sup.count) { lines.push(''); lines.push(esc(C.t('debtsNone', lang))); return lines.join('\n'); }
  const block = function (icon, title, g, top) {
    lines.push('');
    lines.push(icon + ' ' + esc(C.t(title, lang)) + ': <b>' + M.money(lang, ctx.cur, g.total) + '</b> (' + esc(C.t('people', lang, { n: g.count })) + ')');
    g.list.slice(0, top).forEach(function (x, i) {
      lines.push((i + 1) + '. ' + esc(x.name) + (ctx.multi ? ' (' + esc(ctx.br(x.branchId)) + ')' : '') + ' — ' + M.fmtC(ctx.cur, x.debt));
    });
    if (g.count > top) lines.push(esc(C.t('more', lang, { n: g.count - top })));
  };
  block('💰', 'custDebts', d.cust, TOP_CUST);
  if (d.sup.count) block('🏭', 'supDebts', d.sup, TOP_SUP);
  return lines.join('\n');
}

/* ---------- bitta do'kon uchun javob matni ---------- */
async function shopReport(deps, bid, kind, lang) {
  const Rp = R(), db = deps.db;
  const ctx = Rp.inLang(await Rp.loadCtx(deps, bid), lang);
  const now = deps.nowMs();
  if (kind === 'today' || kind === 'yday') {
    let day = DR.dayInfo(new Date(now), ctx.tz);
    if (kind === 'yday') day = DR.dayInfo(new Date(Date.parse(day.startIso) - 1), ctx.tz);
    const data = await Rp.computeDaily(db, bid, day, ctx);
    const o = { shop: ctx.shop, cur: ctx.cur, dateStr: Rp.dmyOfYmd(day.ymd) };
    if (kind === 'today') { o.soFar = true; o.timeStr = Rp.hm(now, ctx.tz); }
    else o.noSalesHtml = C.t('noSalesDay', lang);
    return M.dailyText(lang, data, o);
  }
  if (kind === 'low') return M.lowText(lang, await Rp.computeLow(db, bid, ctx), { shop: ctx.shop });
  const d = await computeDebts(db, bid);
  return debtsText(lang, d, { shop: ctx.shop, cur: ctx.cur, dateStr: Rp.dmy(now, ctx.tz), timeStr: Rp.hm(now, ctx.tz),
    multi: Rp.multiBranch(ctx), br: function (id) { return Rp.branchName(ctx, id); } });
}

/* ---------- buyruqni bajarish ---------- */
async function run(deps, chatId, kind, lang) {
  chatId = String(chatId);
  if (KINDS.indexOf(kind) === -1) return { ignored: true };
  if (kind === 'lang') { await send(deps, chatId, C.t('langPick', lang), langKb()); return { langMenu: true }; }
  if (kind === 'my') return require('./cust').sendMy(deps, chatId, lang);   /* fix155-custbot */
  if (kind === 'phone') return require('./cust').askPhone(deps, chatId, lang);   /* fix158-custfull */
  if (kind === 'pay') {
    const out = await P().sendMenu(deps, chatId, lang);
    if (out && out.reply) await send(deps, chatId, out.reply);
    return Object.assign({ cmd: 'pay' }, out);
  }
  const bids = await P().linkedBids(deps, chatId);
  if (kind === 'help') { if (bids.length) await require('./shop').ownerMenu(deps, chatId, lang); await send(deps, chatId, helpHtml(deps, lang, bids.length > 0), bids.length ? menuKb(deps, lang) : null); return { help: true, linked: bids.length }; }
  if (!bids.length) { await send(deps, chatId, C.t('notLinked', lang)); return { notLinked: true }; }
  if (!(await allow(deps, chatId))) { await send(deps, chatId, C.t('tooMany', lang)); return { tooMany: true }; }
  const use = bids.slice(0, MAX_SHOPS);
  let ok = 0;
  for (let i = 0; i < use.length; i++) {
    let text;
    try { text = await shopReport(deps, use[i], kind, lang); }
    catch (e) { try { console.error('telegram cmd xatosi', kind, e && e.message); } catch (_e) {} text = C.t('failed', lang); }
    if (await send(deps, chatId, text, i === use.length - 1 ? menuKb(deps, lang) : null)) ok++;
  }
  return { cmd: kind, shops: use.length, sent: ok };
}

/* ---------- tugmalar (callback_query): "c|<buyruq>" va "l|<til>" ---------- */
async function onCallback(deps, cq, lang) {
  const data = String((cq && cq.data) || '');
  const chatId = String(cq.message.chat.id);
  const answer = function (text) { return Promise.resolve(deps.tg('answerCallbackQuery', { callback_query_id: cq.id, text: text || '' })).catch(function () {}); };
  let m = /^c\|([a-z]{2,8})$/.exec(data);
  if (m) {
    if (KINDS.indexOf(m[1]) === -1) { await answer(''); return { ignored: true }; }
    await answer('');
    return run(deps, chatId, m[1], lang);
  }
  m = /^l\|([a-z]{2})$/.exec(data);
  if (m && C.LANGS.indexOf(m[1]) !== -1) {
    const l = m[1];
    await deps.db.collection('tgChats').doc(chatId).set({ ulang: l }, { merge: true });
    await answer('');
    const bids = await P().linkedBids(deps, chatId);
    await send(deps, chatId, C.t('langSet', l, { name: C.LANG_NAMES[l] }), bids.length ? menuKb(deps, l) : null);
    try { await deps.tg('setMyCommands', { commands: cmdList(deps, l), scope: { type: 'chat', chat_id: Number(chatId) } }); } catch (e) {}
    return { lang: l };
  }
  return null;   // boshqa tugma (masalan, to'lov) — keyingi ishlovchiga
}

/* Webhook o'rnatilganda: menyu buyruqlari har bir tilda (Telegram foydalanuvchi tiliga qarab ko'rsatadi) */
async function setupCommands(deps) {
  let ok = 0;
  const list = [null].concat(C.LANGS.filter(function (l) { return l !== 'uz'; }));
  for (const l of list) {
    const p = { commands: cmdList(deps, l || 'uz') };
    if (l) p.language_code = l;
    try { await deps.tg('setMyCommands', p); ok++; } catch (e) {}
  }
  try { await deps.tg('setMyCommands', { commands: cmdList(deps, 'uz'), language_code: 'uz' }); ok++; } catch (e) {}
  /* fix150-subbot: /til tanlangan chatlarda ro'yxat o'sha paytdagi holatda qolib ketardi (/obuna yo'q edi) — yangilanadi;
     ulangan chatlarda pastki "💳 Obuna · Do'konim" tugmasi qo'yiladi */
  try {
    const snap = await deps.db.collection('tgChats').limit(1000).get();
    const docs = snap && snap.docs ? snap.docs : [];
    for (let i = 0; i < docs.length; i++) {
      const id = String(docs[i].id), ch = docs[i].data() || {};
      if (!/^\d{1,20}$/.test(id)) continue;
      const ul = C.LANGS.indexOf(ch.ulang) !== -1 ? ch.ulang : '';
      if (ul) { try { await deps.tg('setMyCommands', { commands: cmdList(deps, ul), scope: { type: 'chat', chat_id: Number(id) } }); } catch (e) {} }
      if (Array.isArray(ch.bids) && ch.bids.length) await require('./shop').ownerMenu(deps, id, ul || (C.LANGS.indexOf(ch.lang) !== -1 ? ch.lang : 'uz'));
    }
  } catch (e) {}
  return ok;
}

module.exports = { parse, run, onCallback, chatLang, menuKb, langKb, helpHtml, cmdList, computeDebts, debtsText, setupCommands, CMD_PER_HOUR, ALIASES, KINDS, DATA_KINDS };
