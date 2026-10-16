'use strict';
/* fix120-tg: Savdo Pos Telegram boti — 1-bosqich: ulash / uzish.
   Sof mantiq (firebase kutubxonasiga bog'liq emas): deps = { db, tg(method, params), nowMs(), randCode(), key }.
     key  — bot tokenidan olingan maxfiy kalit (imzolar va webhook sirli sarlavhasi uchun). Token o'zi bu yerga kelmaydi.
   Ma'lumot (faqat server, Admin SDK):
     tgCodes/{sha256(kod)}  — bir martalik ulash kodi: { bid, uid, exp, used, at }  (kodning o'zi saqlanmaydi)
     tgBiz/{bid}            — { chats: { "<chatId>": { name, username, at, sig } }, lang, codeTimes: [ms...] }
     tgChats/{chatId}       — { bids: [...], fails, failAt, lang }
   Imzo (sig): hmac(key, bid|chatId). Imzosi to'g'ri bo'lmagan chat yozuvi e'tiborga olinmaydi (kim yozgan bo'lmasin). */
const crypto = require('crypto');
const { txt, pickLang, LANGS } = require('./texts');

const MAX_CHATS = 3;
const CODE_TTL_MS = 15 * 60 * 1000;
const CODES_PER_HOUR = 10;
const FAILS_PER_HOUR = 8;
const HOUR = 3600 * 1000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 0/O, 1/I yo'q — qo'lda yozganda adashmaslik uchun

function keyFromToken(token) { return crypto.createHash('sha256').update('savdo-tg|' + String(token || '')).digest(); }
function hmacHex(key, s) { return crypto.createHmac('sha256', key).update(String(s)).digest('hex'); }
function webhookSecret(key) { return hmacHex(key, 'webhook').slice(0, 48); }
function sigOf(key, bid, chatId) { return hmacHex(key, bid + '|' + chatId).slice(0, 32); }
function codeHash(code) { return crypto.createHash('sha256').update('tgcode|' + String(code || '').toUpperCase()).digest('hex'); }
function newCode() {
  const b = crypto.randomBytes(10); let s = '';
  for (let i = 0; i < 10; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return s;   // 10 belgi, ~50 bit
}
function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

async function getData(ref) { const s = await ref.get(); return s && s.exists ? (s.data() || {}) : null; }
function okBody(extra) { return { status: 200, body: Object.assign({ ok: true }, extra || {}) }; }
function errBody(status, code) { return { status: status, body: { ok: false, code: code } }; }
function validLang(l) { return LANGS.indexOf(l) !== -1 ? l : null; }

/* Imzosi to'g'ri chatlar ro'yxati */
function validChats(key, bid, biz) {
  const out = [];
  const chats = (biz && biz.chats && typeof biz.chats === 'object') ? biz.chats : {};
  Object.keys(chats).forEach(function (id) {
    const c = chats[id] || {};
    if (!/^-?\d{1,20}$/.test(id)) return;
    if (c.sig !== sigOf(key, bid, id)) return;
    out.push({ id: id, name: String(c.name || '').slice(0, 80), username: String(c.username || '').slice(0, 40), at: Number(c.at) || 0 });
  });
  out.sort(function (a, b) { return a.at - b.at; });
  return out;
}

/* Kim chaqiryapti: ega (uid = biznes ID) yoki xodim (staffAuth yozuvi) — ilovadagi va sharedDebts'dagi qoida bilan bir xil */
async function resolveCaller(db, uid) {
  if (!uid) return null;
  const sa = await getData(db.collection('staffAuth').doc(uid));
  if (sa) {
    if (!sa.businessId || typeof sa.businessId !== 'string') return null;
    return { bid: sa.businessId, owner: false };
  }
  return { bid: uid, owner: true };
}

async function shopName(db, bid) {
  const b = await getData(db.collection('businesses').doc(bid));
  const n = b && (b.businessName || (b.settings && b.settings.businessName));
  return String(n || 'Savdo Pos').slice(0, 80);
}

async function sendText(deps, chatId, text) {
  try { await deps.tg('sendMessage', { chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true }); return true; }
  catch (e) { return false; }
}

/* ---------- Ilova so'rovlari (Firebase ID token bilan) ---------- */
async function handleApi(deps, uid, body) {
  body = (body && typeof body === 'object') ? body : {};
  const action = String(body.action || '').slice(0, 20);
  if (!uid) return errBody(401, 'unauthenticated');
  const caller = await resolveCaller(deps.db, uid);
  if (!caller) return errBody(403, 'forbidden');
  if (!deps.key) return okBody({ configured: false, owner: caller.owner, chats: [], max: MAX_CHATS });
  const db = deps.db, now = deps.nowMs();
  const bizRef = db.collection('tgBiz').doc(caller.bid);
  if (action === 'status') {
    const biz = await getData(bizRef);
    const lang = validLang(body.lang);
    if (caller.owner && lang && (!biz || biz.lang !== lang)) await bizRef.set({ lang: lang }, { merge: true });
    const out = { configured: true, owner: caller.owner, bot: deps.botName || '', chats: caller.owner ? validChats(deps.key, caller.bid, biz) : [], max: MAX_CHATS };
    if (caller.owner) out.prefs = await require('./reports').readPrefsForStatus(deps, caller.bid);   /* fix121-tg2 */
    return okBody(out);
  }
  if (!caller.owner) return errBody(403, 'owner_only');
  if (action === 'prefs' || action === 'test') return require('./reports').handleAction(deps, caller, action, body);   /* fix121-tg2: xabar sozlamalari, sinov */
  if (action === 'link') {
    const biz = (await getData(bizRef)) || {};
    if (validChats(deps.key, caller.bid, biz).length >= MAX_CHATS) return errBody(409, 'limit');
    const times = (Array.isArray(biz.codeTimes) ? biz.codeTimes : []).filter(function (t) { return t > now - HOUR; });
    if (times.length >= CODES_PER_HOUR) return errBody(429, 'too_many');
    if (!deps.botName) return errBody(503, 'bot_unavailable');
    const code = (deps.randCode || newCode)();
    await db.collection('tgCodes').doc(codeHash(code)).set({ bid: caller.bid, uid: uid, exp: now + CODE_TTL_MS, used: false, at: now });
    const upd = { codeTimes: times.concat([now]) };
    const lang = validLang(body.lang); if (lang) upd.lang = lang;
    await bizRef.set(upd, { merge: true });
    return okBody({ code: code, bot: deps.botName, url: 'https://t.me/' + deps.botName + '?start=' + code, exp: now + CODE_TTL_MS });
  }
  if (action === 'unlink') {
    const chatId = String(body.chat || '');
    if (!/^-?\d{1,20}$/.test(chatId)) return errBody(400, 'bad_chat');
    const chRef = db.collection('tgChats').doc(chatId);
    const r = await db.runTransaction(async function (tx) {
      const bs = await tx.get(bizRef); const biz = bs && bs.exists ? (bs.data() || {}) : {};
      const cs = await tx.get(chRef); const ch = cs && cs.exists ? (cs.data() || {}) : null;
      const chats = Object.assign({}, biz.chats || {});
      const had = !!chats[chatId];
      delete chats[chatId];
      tx.set(bizRef, Object.assign({}, biz, { chats: chats }));   // to'liq yozuv: merge xaritaning ichidagi kalitni o'chirmaydi
      if (ch) tx.set(chRef, Object.assign({}, ch, { bids: (Array.isArray(ch.bids) ? ch.bids : []).filter(function (b) { return b !== caller.bid; }) }));
      return { had: had, chats: chats, lang: biz.lang };
    });
    if (r.had) await sendText(deps, chatId, txt('unlinked', validLang(r.lang) || 'uz', { shop: await shopName(db, caller.bid) }));
    return okBody({ removed: r.had, chats: validChats(deps.key, caller.bid, { chats: r.chats }) });
  }
  return errBody(400, 'bad_action');
}

/* ---------- Telegram'dan kelgan yangilanish (webhook) ---------- */
async function unbindChatEverywhere(deps, chatId) {
  const db = deps.db;
  const chRef = db.collection('tgChats').doc(String(chatId));
  const ch = await getData(chRef);
  const bids = (ch && Array.isArray(ch.bids)) ? ch.bids : [];
  for (let i = 0; i < bids.length; i++) {
    const r = db.collection('tgBiz').doc(bids[i]);
    const b = await getData(r);
    if (b && b.chats && b.chats[String(chatId)]) { const chats = Object.assign({}, b.chats); delete chats[String(chatId)]; await r.set(Object.assign({}, b, { chats: chats })); }
  }
  if (ch) await chRef.set(Object.assign({}, ch, { bids: [] }));
  return bids.length;
}

async function tryLink(deps, msg, code, lang) {
  const db = deps.db, now = deps.nowMs();
  const chatId = String(msg.chat.id);
  const chRef = db.collection('tgChats').doc(chatId);
  const ch0 = (await getData(chRef)) || {};
  const recentFails = (ch0.failAt && ch0.failAt > now - HOUR) ? (Number(ch0.fails) || 0) : 0;
  if (recentFails >= FAILS_PER_HOUR) return { reply: txt('tooMany', lang) };
  const codeRef = db.collection('tgCodes').doc(codeHash(normCode(code)));
  const res = await db.runTransaction(async function (tx) {
    const cs = await tx.get(codeRef);
    const c = cs && cs.exists ? (cs.data() || {}) : null;
    if (!c || c.used || !(c.exp > now) || typeof c.bid !== 'string') return { bad: true };
    const bizRef = db.collection('tgBiz').doc(c.bid);
    const bs = await tx.get(bizRef);
    const biz = bs && bs.exists ? (bs.data() || {}) : {};
    const chs = await tx.get(chRef);
    const ch = chs && chs.exists ? (chs.data() || {}) : {};
    const valid = validChats(deps.key, c.bid, biz);
    if (valid.some(function (x) { return x.id === chatId; })) { tx.set(codeRef, Object.assign({}, c, { used: true, usedAt: now })); return { bid: c.bid, already: true, lang: biz.lang }; }
    if (valid.length >= MAX_CHATS) return { bid: c.bid, limit: true, lang: biz.lang };
    const name = [msg.from && msg.from.first_name, msg.from && msg.from.last_name].filter(Boolean).join(' ') || (msg.chat.first_name || '');
    const chats = {};
    valid.forEach(function (x) { chats[x.id] = (biz.chats || {})[x.id]; });   // imzosiz (soxta) yozuvlar shu yerda tushib qoladi
    chats[chatId] = { name: String(name).slice(0, 80), username: String((msg.from && msg.from.username) || '').slice(0, 40), at: now, sig: sigOf(deps.key, c.bid, chatId) };
    tx.set(bizRef, Object.assign({}, biz, { chats: chats }));
    const bids = (Array.isArray(ch.bids) ? ch.bids : []).filter(function (b) { return b !== c.bid; }).concat([c.bid]);
    tx.set(chRef, Object.assign({}, ch, { bids: bids, fails: 0, failAt: 0, lang: lang }));
    tx.set(codeRef, Object.assign({}, c, { used: true, usedAt: now, chat: chatId }));
    return { bid: c.bid, linked: true, lang: biz.lang };
  });
  if (res.bad) {
    await chRef.set(Object.assign({}, ch0, { fails: recentFails + 1, failAt: recentFails ? ch0.failAt : now, lang: lang }));
    return { reply: txt('badCode', lang) };
  }
  const l = validLang(res.lang) || lang;
  const shop = await shopName(db, res.bid);
  if (res.limit) return { reply: txt('limit', l, { shop: shop }) };
  if (res.already) return { reply: txt('already', l, { shop: shop }) };
  return { reply: txt('linked', l, { shop: shop }), linked: res.bid };
}

async function handleUpdate(deps, upd) {
  upd = upd || {};
  if (!deps.key) return { skipped: 'no_key' };
  // foydalanuvchi botni bloklasa — hamma do'konlardan uziladi
  const mc = upd.my_chat_member;
  if (mc && mc.chat && mc.chat.type === 'private' && mc.new_chat_member && (mc.new_chat_member.status === 'kicked' || mc.new_chat_member.status === 'left')) {
    const n = await unbindChatEverywhere(deps, mc.chat.id);
    return { blocked: true, unbound: n };
  }
  const msg = upd.message;
  if (!msg || !msg.chat || msg.chat.id == null) return { ignored: true };
  const text = typeof msg.text === 'string' ? msg.text.trim() : '';
  const lang = pickLang(msg.from && msg.from.language_code);
  if (msg.chat.type !== 'private') {
    if (/^\//.test(text)) await sendText(deps, msg.chat.id, txt('privateOnly', lang));
    return { group: true };
  }
  const m = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+([A-Za-z0-9_-]{4,64}))?$/.exec(text);
  let out;
  if (m && m[1]) out = await tryLink(deps, msg, m[1], lang);
  else if (/^\/stop(?:@[A-Za-z0-9_]+)?$/.test(text)) {
    const n = await unbindChatEverywhere(deps, msg.chat.id);
    // har bir do'konga emas, chatning o'ziga bir marta xabar
    out = { reply: n ? txt('stopped', lang) : txt('notLinkedStop', lang), stopped: n };
  } else {
    const ch = await getData(deps.db.collection('tgChats').doc(String(msg.chat.id)));
    const bids = ch && Array.isArray(ch.bids) ? ch.bids : [];
    if (bids.length) {
      const names = [];
      for (let i = 0; i < bids.length && i < 5; i++) names.push(await shopName(deps.db, bids[i]));
      out = { reply: txt('linkedInfo', lang, { shop: names.join(', ') }) };
    } else out = { reply: txt('welcome', lang) };
  }
  if (out && out.reply) await sendText(deps, msg.chat.id, out.reply);
  return out;
}

/* Webhook manzilini o'rnatish (bir xil manzil bo'lsa ham qayta o'rnatish xavfsiz) */
async function setupWebhook(deps, url) {
  const me = await deps.tg('getMe', {});
  await deps.tg('setWebhook', { url: url, secret_token: webhookSecret(deps.key), allowed_updates: ['message', 'my_chat_member'], max_connections: 20 });
  const info = await deps.tg('getWebhookInfo', {});
  return { bot: me && me.username, url: info && info.url, pending: info && info.pending_update_count, ok: !!(info && info.url === url) };
}

module.exports = { handleApi, handleUpdate, setupWebhook, unbindChatEverywhere, validChats, sigOf, codeHash, normCode, newCode, keyFromToken, webhookSecret, resolveCaller, MAX_CHATS, CODE_TTL_MS, CODES_PER_HOUR, FAILS_PER_HOUR };
