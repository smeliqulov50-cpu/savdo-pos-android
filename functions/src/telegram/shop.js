'use strict';
/* fix145-botshop: Telegram bot orqali buyurtma (mini ilova).
   Sof mantiq (firebase kutubxonasiga bog'liq emas). deps = { db, tg, key, webKey, botName, nowMs, messaging? }
     webKey — HMAC_SHA256("WebAppData", bot_token): mini ilova initData imzosini tekshirish uchun (token o'zi kelmaydi).
   Ma'lumot (faqat server, Admin SDK — Firestore qoidalari o'zgarmaydi):
     tgShop/{bid}        — do'kon sozlamasi: { enabled, slug, branchId, pickup, delivery, fee, freeFrom, minOrder, note, hours, paused, notifyTg, tz, seq }
     tgSlug/{slug}       — { bid }  (havola nomi band)
     tgOrders/{oid}      — buyurtma (to'liq, tarixi bilan)
     tgCust/{tgUserId}   — mijoz: { phone, phoneOk, name, username, lang, lastShop, recent:[{id,bid,at}], active:{oid:bid}, times:[ms] }
     businesses/{bid}/meta/botInbox — ilova jonli ko'radigan nusxa: { orders: { oid: {...} }, updatedAt }  (a'zolar o'qiy oladi — hozirgi qoidalar bilan) */
const crypto = require('crypto');
const S = require('./shopTexts');
const M = require('./msgs');

const WEB_BASE = process.env.SAVDO_SHOP_WEB || 'https://savdo-pos.pages.dev/tgshop';
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;
const ACTIVE = ['new', 'accepted', 'ready', 'delivering'];
const CLOSED = ['done', 'rejected', 'cancelled'];
const NEXT = { new: ['accepted', 'rejected', 'done'], accepted: ['ready', 'delivering', 'done', 'rejected'], ready: ['delivering', 'done', 'rejected'], delivering: ['done', 'rejected'] };
const HOUR = 3600 * 1000;
const AUTH_MAX_AGE_MS = 24 * HOUR;
const MAX_LINES = 60;
const MAX_QTY = 9999;
const MAX_ACTIVE_PER_CUST = 3;
const ORDERS_PER_HOUR = 6;
const INBOX_MAX = 200;
const INBOX_ACTIVE_MAX = 150;
const CLOSED_KEEP_MS = 48 * HOUR;
const INBOX_MAX_BYTES = 600 * 1024;
const CAT_TTL_MS = 30 * 1000;
const RECENT_MAX = 30;
const IMG_MAX_CHARS = 1400000;
const FRACTION_UNITS = ['kg', 'litr'];

const __cat = new Map();   // bid -> { at, data }

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function str(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n); }
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function money(v) { const n = Math.round(num(v)); return n > 0 ? Math.min(n, 1e12) : 0; }
function okBody(extra) { return { status: 200, body: Object.assign({ ok: true }, extra || {}) }; }
function errBody(status, code, extra) { return { status: status, body: Object.assign({ ok: false, code: code }, extra || {}) }; }
async function getData(ref) { const s = await ref.get(); return s && s.exists ? (s.data() || {}) : null; }
function effBranch(id) { return id || 'main'; }
function validTz(z) { if (!z || typeof z !== 'string') return false; try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch (e) { return false; } }
function hhmm(v) { const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(v || '')); return m ? m[0] : ''; }
function normPhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 9) d = '998' + d;
  if (d.length < 9 || d.length > 15) return '';
  return '+' + d;
}
function round3(n) { return Math.round(n * 1000) / 1000; }
function shopUrl(slug) { return WEB_BASE + '?s=' + encodeURIComponent(slug); }
function startLink(deps, slug) { return deps.botName ? 'https://t.me/' + deps.botName + '?start=s_' + slug : ''; }

/* ---------- sozlama ---------- */
function normCfg(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const h = raw.hours && typeof raw.hours === 'object' ? raw.hours : {};
  const c = {
    enabled: raw.enabled === true,
    slug: SLUG_RE.test(String(raw.slug || '')) ? String(raw.slug) : '',
    branchId: str(raw.branchId, 60) || 'main',
    pickup: raw.pickup !== false,
    delivery: raw.delivery === true,
    fee: money(raw.fee),
    freeFrom: money(raw.freeFrom),
    minOrder: money(raw.minOrder),
    note: str(raw.note, 300),
    hours: { on: h.on === true && !!hhmm(h.from) && !!hhmm(h.to) && hhmm(h.from) !== hhmm(h.to), from: hhmm(h.from) || '09:00', to: hhmm(h.to) || '21:00' },
    paused: raw.paused === true,
    notifyTg: raw.notifyTg !== false,
    tz: validTz(raw.tz) ? String(raw.tz) : 'Asia/Tashkent',
    seq: Math.max(0, Math.floor(num(raw.seq)))
  };
  if (!c.pickup && !c.delivery) c.pickup = true;
  return c;
}
function publicCfg(c) {
  return { enabled: c.enabled, slug: c.slug, branchId: c.branchId, pickup: c.pickup, delivery: c.delivery, fee: c.fee, freeFrom: c.freeFrom, minOrder: c.minOrder,
    note: c.note, hours: c.hours, paused: c.paused, notifyTg: c.notifyTg, tz: c.tz };
}
function localHm(tz, ms) {
  try {
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
    const g = function (t) { const x = p.find(function (y) { return y.type === t; }); return x ? x.value : '00'; };
    return g('hour').replace('24', '00') + ':' + g('minute');
  } catch (e) { return '12:00'; }
}
function isOpen(c, ms) {
  if (!c.hours || !c.hours.on) return true;
  const now = localHm(c.tz, ms), f = c.hours.from, t = c.hours.to;
  return f < t ? (now >= f && now < t) : (now >= f || now < t);
}

/* ---------- mini ilova imzosi (Telegram WebApp initData) ---------- */
function webKeyFromToken(token) { return crypto.createHmac('sha256', 'WebAppData').update(String(token || '')).digest(); }
function verifyInitData(webKey, initData, nowMs) {
  if (!webKey || typeof initData !== 'string' || initData.length > 4096 || !initData) return null;
  let params;
  try { params = new URLSearchParams(initData); } catch (e) { return null; }
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const pairs = [];
  params.forEach(function (v, k) { if (k !== 'hash') pairs.push(k + '=' + v); });
  pairs.sort();
  const calc = crypto.createHmac('sha256', webKey).update(pairs.join('\n')).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(hash, 'hex'))) return null;
  const authDate = Number(params.get('auth_date')) * 1000;
  if (!(authDate > 0) || nowMs - authDate > AUTH_MAX_AGE_MS || authDate - nowMs > 5 * 60 * 1000) return { expired: true };
  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch (e) { user = null; }
  if (!user || !(Number(user.id) > 0)) return null;
  return { user: { id: String(Math.floor(Number(user.id))), first: str(user.first_name, 64), last: str(user.last_name, 64), username: str(user.username, 40), lang: str(user.language_code, 8) } };
}

/* ---------- katalog ---------- */
async function resolveSlug(db, slug) {
  slug = String(slug || '').toLowerCase();
  if (!SLUG_RE.test(slug)) return null;
  const m = await getData(db.collection('tgSlug').doc(slug));
  if (!m || typeof m.bid !== 'string') return null;
  const cfg = normCfg(await getData(db.collection('tgShop').doc(m.bid)));
  if (cfg.slug !== slug) return null;
  return { bid: m.bid, cfg: cfg };
}
function imgVer(p) { return String(Math.floor(num(p._u)) || 0).slice(-10); }
function hasImg(p) { return typeof p.image === 'string' && p.image.length < IMG_MAX_CHARS && (/^data:image\/(png|jpe?g|webp|gif);base64,/.test(p.image) || /^https:\/\//.test(p.image)); }
function buildCatalog(docs, biz, cfg) {
  const oversell = !!(biz && biz.allowOversell);
  const items = [], byId = {}, cats = [];
  docs.forEach(function (d) {
    const p = d || {};
    if (!p.id || p._deleted || p.botSell !== true) return;
    if (effBranch(p.branchId) !== effBranch(cfg.branchId)) return;
    const name = str(p.name, 120); if (!name) return;
    const unit = ['dona', 'kg', 'litr', 'paket'].indexOf(p.unit) !== -1 ? p.unit : 'dona';
    const vs = Array.isArray(p.variants) ? p.variants.filter(function (v) { return v && v.id && str(v.name, 80) && money(v.price) > 0; }) : [];
    if (Array.isArray(p.variants) && p.variants.length && !vs.length) return;
    if (!vs.length && !(money(p.price) > 0)) return;
    const stock = vs.length ? vs.reduce(function (a, v) { return a + num(v.stock); }, 0) : num(p.stock);
    const it = { id: String(p.id), n: name, p: vs.length ? Math.min.apply(null, vs.map(function (v) { return money(v.price); })) : money(p.price), u: unit,
      c: str(p.category, 60), f: FRACTION_UNITS.indexOf(unit) !== -1 ? 1 : 0, s: oversell || stock > 0 ? 1 : 0 };
    if (!oversell && !vs.length) it.m = Math.max(0, Math.min(MAX_QTY, round3(stock)));
    if (hasImg(p)) it.i = imgVer(p);
    if (vs.length) it.v = vs.map(function (v) {
      const o = { id: String(v.id), n: str(v.name, 80), p: money(v.price), s: oversell || num(v.stock) > 0 ? 1 : 0 };
      if (!oversell) o.m = Math.max(0, Math.min(MAX_QTY, round3(num(v.stock))));
      return o;
    });
    if (it.c && cats.indexOf(it.c) === -1) cats.push(it.c);
    items.push(it);
    byId[it.id] = { it: it, raw: p };
  });
  items.sort(function (a, b) { return (b.s - a.s) || a.n.localeCompare(b.n); });
  cats.sort(function (a, b) { return a.localeCompare(b); });
  return { items: items, byId: byId, cats: cats, oversell: oversell };
}
async function loadCatalog(deps, bid, cfg, fresh) {
  const now = deps.nowMs();
  const key = bid + '|' + effBranch(cfg.branchId);
  const c = __cat.get(key);
  if (!fresh && c && now - c.at < CAT_TTL_MS) return c.data;
  const ref = deps.db.collection('businesses').doc(bid);
  const res = await Promise.all([getData(ref), ref.collection('products').get()]);
  const biz = res[0] || {};
  const data = buildCatalog(res[1].docs.map(function (d) { return d.data(); }), biz, cfg);
  data.biz = biz;
  __cat.set(key, { at: now, data: data });
  if (__cat.size > 300) __cat.delete(__cat.keys().next().value);
  return data;
}
function clearCatalogCache() { __cat.clear(); }
function shopInfo(cat, cfg, now) {
  const b = cat.biz || {};
  return { name: str(b.businessName || (b.settings && b.settings.businessName) || 'Savdo Pos', 80), address: str(b.businessAddress, 200), phone: str(b.businessPhone, 40),
    cur: str(b.currency || 'UZS', 6), note: cfg.note, pickup: cfg.pickup, delivery: cfg.delivery, fee: cfg.fee, freeFrom: cfg.freeFrom, minOrder: cfg.minOrder,
    hours: cfg.hours, open: isOpen(cfg, now) && !cfg.paused, paused: cfg.paused };
}

/* ---------- matnlar ---------- */
function qtyStr(q) { return Number.isInteger(q) ? String(q) : String(q).replace('.', ','); }
function itemsHtml(o, lang) {
  return (o.items || []).map(function (x) {
    return '• ' + esc(x.name) + (x.vName ? ' (' + esc(x.vName) + ')' : '') + ' × ' + qtyStr(x.qty) + (x.unit && x.unit !== 'dona' ? ' ' + esc(M.unitLabel(lang, x.unit)) : '') + ' — ' + M.money(lang, o.cur, x.sum);
  }).join('\n');
}
function orderBodyHtml(o, lang, owner) {
  const L = [itemsHtml(o, lang), ''];
  if (o.mode === 'delivery') {
    L.push(S.t('goods', lang) + ': ' + M.money(lang, o.cur, o.subtotal));
    L.push(S.t('fee', lang) + ': ' + (o.fee > 0 ? M.money(lang, o.cur, o.fee) : S.t('free', lang)));
  }
  L.push('💰 <b>' + S.t('total', lang) + ': ' + M.money(lang, o.cur, o.total) + '</b>');
  L.push(o.mode === 'delivery' ? S.t('delivery', lang) + (o.address ? ': ' + esc(o.address) : '') : S.t('pickup', lang));
  if (o.mode === 'delivery' && o.loc && owner) L.push('🗺 https://maps.google.com/?q=' + o.loc.lat + ',' + o.loc.lng);
  L.push(S.t(o.pay === 'card' ? 'payCard' : 'payCash', lang));
  if (o.comment) L.push(S.t('note', lang) + ': ' + esc(o.comment));
  return L.join('\n');
}
function webBtn(lang, slug, key) { return { text: S.t(key || 'btnOrder', lang), web_app: { url: shopUrl(slug) } }; }
async function send(deps, chatId, text, kb) {
  const p = { chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (kb) p.reply_markup = kb;
  try { await deps.tg('sendMessage', p); return true; } catch (e) { return false; }
}

/* ---------- inbox (ilova ko'radigan nusxa) ---------- */
function inboxEntry(o) {
  const e = {};
  ['id', 'no', 'status', 'createdAt', 'updatedAt', 'branchId', 'name', 'phone', 'phoneOk', 'tgUser', 'items', 'subtotal', 'fee', 'total', 'cur', 'mode', 'address', 'loc', 'comment', 'pay', 'eta', 'reason', 'saleId', 'saleNo', 'by']
    .forEach(function (k) { if (o[k] !== undefined && o[k] !== null) e[k] = o[k]; });
  if (e.tgUser) e.tgUser = { username: e.tgUser.username || '' };
  return e;
}
function pruneInbox(orders, now) {
  const out = Object.assign({}, orders || {});
  Object.keys(out).forEach(function (k) { const o = out[k]; if (!o || (CLOSED.indexOf(o.status) !== -1 && now - num(o.updatedAt) > CLOSED_KEEP_MS)) delete out[k]; });
  const keys = Object.keys(out);
  if (keys.length > INBOX_MAX) {
    keys.filter(function (k) { return CLOSED.indexOf(out[k].status) !== -1; })
      .sort(function (a, b) { return num(out[a].updatedAt) - num(out[b].updatedAt); })
      .slice(0, keys.length - INBOX_MAX).forEach(function (k) { delete out[k]; });
  }
  /* Firestore hujjati 1 MB dan oshmasin: kerak bo'lsa eng eski yopilganlar tushib qoladi */
  let size = JSON.stringify(out).length;
  if (size > INBOX_MAX_BYTES) {
    const closed = Object.keys(out).filter(function (k) { return CLOSED.indexOf(out[k].status) !== -1; }).sort(function (a, b) { return num(out[a].updatedAt) - num(out[b].updatedAt); });
    for (let i = 0; i < closed.length && size > INBOX_MAX_BYTES; i++) { size -= JSON.stringify(out[closed[i]]).length + closed[i].length + 4; delete out[closed[i]]; }
  }
  return out;
}
function inboxBytes(orders) { return JSON.stringify(orders || {}).length; }
function inboxRef(db, bid) { return db.collection('businesses').doc(bid).collection('meta').doc('botInbox'); }

/* ---------- egaga xabar (Telegram + push) ---------- */
async function notifyOwner(deps, bid, kind, o) {
  let ctx = null;
  try { ctx = await require('./reports').loadCtx(deps, bid); } catch (e) { ctx = null; }
  const shop = ctx ? ctx.shop : 'Savdo Pos';
  let cfgNotify = true;
  try { cfgNotify = normCfg(await getData(deps.db.collection('tgShop').doc(bid))).notifyTg; } catch (e) { cfgNotify = true; }
  if (ctx && cfgNotify && ctx.chats && ctx.chats.length) {
    for (let i = 0; i < ctx.chats.length; i++) {
      const l = ctx.chats[i].lang || 'uz';
      const who = esc(o.name || '') + (o.phone ? ', ' + esc(o.phone) : '');
      const text = kind === 'new' ? S.t('ownerNew', l, { no: o.no, shop: esc(shop), who: who, body: orderBodyHtml(o, l, true) }) : S.t('ownerCancelled', l, { no: o.no, shop: esc(shop) });
      await send(deps, ctx.chats[i].id, text);
    }
  }
  if (deps.messaging) {
    try {
      const N = require('../push/notify');
      const snap = await deps.db.collection('businesses').doc(bid).collection('pushTokens').get();
      const docs = snap.docs.map(function (d) { const x = d.data() || {}; return { token: x.token || d.id, sound: x.sound, ref: d.ref }; });
      const l = (ctx && ctx.lang) || 'uz';
      await N.sendToTokenDocs(deps.messaging, docs, {
        title: S.t(kind === 'new' ? 'pushNew' : 'pushCancel', l, { no: o.no }),
        body: kind === 'new' ? (o.name || '') + ' · ' + M.money(l, o.cur, o.total) : shop,
        channel: 'support', data: { type: 'botOrder', oid: o.id, bizId: bid }
      });
    } catch (e) { /* push ixtiyoriy */ }
  }
}

/* ---------- holat o'zgarishi (yagona joy) ---------- */
async function applyStatus(deps, bid, oid, to, extra, actor) {
  const db = deps.db, now = deps.nowMs();
  const oRef = db.collection('tgOrders').doc(oid), iRef = inboxRef(db, bid);
  const res = await db.runTransaction(async function (tx) {
    const os = await tx.get(oRef);
    const o = os && os.exists ? (os.data() || {}) : null;
    if (!o || o.bid !== bid) return { code: 'not_found' };
    if (o.status === to) return { same: true, o: o };
    const allowed = actor === 'customer' ? (o.status === 'new' && to === 'cancelled') : ((NEXT[o.status] || []).indexOf(to) !== -1);
    if (!allowed) return { code: 'bad_state', status: o.status };
    const cRef = db.collection('tgCust').doc(String(o.tgUser && o.tgUser.id));
    const is = await tx.get(iRef); const inbox = is && is.exists ? (is.data() || {}) : {};
    const cs = await tx.get(cRef); const cust = cs && cs.exists ? (cs.data() || {}) : null;
    const n = Object.assign({}, o, { status: to, updatedAt: now });
    if (extra.reason) n.reason = extra.reason;
    if (extra.eta) n.eta = extra.eta;
    if (extra.saleId) { n.saleId = extra.saleId; n.saleNo = extra.saleNo || ''; }
    if (extra.by) n.by = extra.by;
    n.history = (Array.isArray(o.history) ? o.history : []).concat([{ s: to, at: now, by: actor === 'customer' ? 'customer' : (extra.by || 'shop') }]).slice(-20);
    tx.set(oRef, n);
    const orders = Object.assign({}, inbox.orders || {}); orders[oid] = inboxEntry(n);
    tx.set(iRef, { orders: pruneInbox(orders, now), updatedAt: now });
    if (cust && CLOSED.indexOf(to) !== -1) {
      const act = Object.assign({}, cust.active || {}); delete act[oid];
      tx.set(cRef, Object.assign({}, cust, { active: act }));
    }
    return { o: n, prev: o.status, lang: (cust && cust.lang) || 'uz' };
  });
  if (res.code) return res;
  if (res.same) return { o: res.o, same: true };
  const o = res.o, l = S.lg(res.lang), chat = o.tgUser && o.tgUser.id;
  if (chat) {
    let text = '';
    if (to === 'accepted') text = S.t('accepted', l, { no: o.no, shop: esc(o.shop || ''), eta: o.eta ? S.t('eta', l, { m: o.eta }) : '' });
    else if (to === 'ready') text = S.t('ready', l, { no: o.no, addr: o.shopAddr ? S.t('shopAddr', l, { a: esc(o.shopAddr) }) : '' });
    else if (to === 'delivering') text = S.t('delivering', l, { no: o.no });
    else if (to === 'done') text = S.t('done', l, { no: o.no, total: M.money(l, o.cur, o.total) });
    else if (to === 'rejected') text = S.t('rejected', l, { no: o.no, shop: esc(o.shop || ''), reason: o.reason ? S.t('reason', l, { r: esc(o.reason) }) : '' });
    else if (to === 'cancelled') text = S.t('cancelled', l, { no: o.no });
    if (text) await send(deps, chat, text);
  }
  if (to === 'cancelled') await notifyOwner(deps, bid, 'cancelled', o);
  return { o: o };
}

/* ---------- mini ilova so'rovlari ---------- */
function custSummary(o) {
  return { id: o.id, no: o.no, status: o.status, createdAt: o.createdAt, total: o.total, cur: o.cur, mode: o.mode, n: (o.items || []).length,
    items: (o.items || []).slice(0, 30).map(function (x) { return { name: x.name, vName: x.vName || '', qty: x.qty, sum: x.sum }; }), eta: o.eta || 0, reason: o.reason || '' };
}
function orderIdFor(bid, uid, clientId) { return 'bo' + crypto.createHash('sha256').update(bid + '|' + uid + '|' + clientId).digest('hex').slice(0, 22); }

async function handleWebApp(deps, body) {
  body = body && typeof body === 'object' ? body : {};
  if (!deps.key || !deps.webKey) return errBody(503, 'not_configured');
  const now = deps.nowMs();
  const auth = verifyInitData(deps.webKey, body.initData, now);
  if (!auth) return errBody(401, 'auth');
  if (auth.expired) return errBody(401, 'expired');
  const u = auth.user, db = deps.db;
  const action = str(body.action, 20);
  const shop = await resolveSlug(db, body.slug);
  if (!shop || !shop.cfg.enabled) return errBody(404, 'closed');
  const bid = shop.bid, cfg = shop.cfg;
  const custRef = db.collection('tgCust').doc(u.id);
  const lang = S.LANGS.indexOf(body.lang) !== -1 ? body.lang : S.lg(String(u.lang || '').slice(0, 2));

  if (action === 'catalog') {
    const cat = await loadCatalog(deps, bid, cfg, false);
    const cust = (await getData(custRef)) || {};
    const upd = { lang: lang, lastShop: cfg.slug, name: cust.name || str([u.first, u.last].filter(Boolean).join(' '), 80), username: u.username };
    if (cust.lang !== upd.lang || cust.lastShop !== upd.lastShop || cust.username !== upd.username || !cust.name) await custRef.set(Object.assign({}, cust, upd));
    const act = Object.keys(cust.active || {}).filter(function (k) { return cust.active[k] === bid; }).length;
    return okBody({ shop: shopInfo(cat, cfg, now), cats: cat.cats, items: cat.items, oversell: cat.oversell,
      me: { phone: cust.phone || '', phoneOk: !!cust.phoneOk, name: cust.name || upd.name }, active: act, bot: deps.botName || '' });
  }
  if (action === 'me') {
    const cust = (await getData(custRef)) || {};
    return okBody({ me: { phone: cust.phone || '', phoneOk: !!cust.phoneOk, name: cust.name || '' } });
  }
  if (action === 'orders') {
    const cust = (await getData(custRef)) || {};
    const ids = (Array.isArray(cust.recent) ? cust.recent : []).filter(function (r) { return r && r.bid === bid; }).slice(-10).reverse();
    const out = [];
    for (let i = 0; i < ids.length; i++) {
      const o = await getData(db.collection('tgOrders').doc(String(ids[i].id)));
      if (o && o.bid === bid && o.tgUser && o.tgUser.id === u.id) out.push(custSummary(o));
    }
    return okBody({ orders: out });
  }
  if (action === 'cancel') {
    const oid = str(body.oid, 40);
    const o = /^bo[0-9a-f]{22}$/.test(oid) ? await getData(db.collection('tgOrders').doc(oid)) : null;
    if (!o || o.bid !== bid || !o.tgUser || o.tgUser.id !== u.id) return errBody(404, 'not_found');
    const r = await applyStatus(deps, bid, oid, 'cancelled', {}, 'customer');
    if (r.code) return errBody(409, r.code, { status: r.status || o.status });
    return okBody({ order: custSummary(r.o) });
  }
  if (action !== 'order') return errBody(400, 'bad_action');

  /* ---- yangi buyurtma ---- */
  const clientId = str(body.clientId, 40);
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(clientId)) return errBody(400, 'bad_request');
  const oid = orderIdFor(bid, u.id, clientId);
  const oRef = db.collection('tgOrders').doc(oid);
  const prev = await getData(oRef);
  if (prev) return okBody({ order: custSummary(prev), again: true });
  if (cfg.paused) return errBody(409, 'paused');
  if (!isOpen(cfg, now)) return errBody(409, 'closed_hours', { hours: cfg.hours });
  const mode = body.mode === 'delivery' ? 'delivery' : 'pickup';
  if (mode === 'delivery' && !cfg.delivery) return errBody(400, 'no_delivery');
  if (mode === 'pickup' && !cfg.pickup) return errBody(400, 'no_pickup');
  const address = str(body.address, 300);
  let loc = null;
  if (body.loc && typeof body.loc === 'object') {
    const la = num(body.loc.lat), ln = num(body.loc.lng);
    if (la >= -90 && la <= 90 && ln >= -180 && ln <= 180 && (la || ln)) loc = { lat: Math.round(la * 1e6) / 1e6, lng: Math.round(ln * 1e6) / 1e6 };
  }
  if (mode === 'delivery' && address.length < 3 && !loc) return errBody(400, 'need_address');
  const cust0 = (await getData(custRef)) || {};
  let phone = '', phoneOk = false;
  if (cust0.phone && cust0.phoneOk) { phone = cust0.phone; phoneOk = true; }
  const typed = normPhone(body.phone);
  if (typed && typed !== phone) { phone = typed; phoneOk = !!(cust0.phoneOk && cust0.phone === typed); }
  if (!phone) return errBody(400, 'need_phone');
  const name = str(body.name, 80) || str([u.first, u.last].filter(Boolean).join(' '), 80) || (u.username ? '@' + u.username : 'Telegram');
  const times = (Array.isArray(cust0.times) ? cust0.times : []).filter(function (x) { return x > now - HOUR; });
  if (times.length >= ORDERS_PER_HOUR) return errBody(429, 'too_many');
  const activeHere = Object.keys(cust0.active || {}).filter(function (k) { return cust0.active[k] === bid; }).length;
  if (activeHere >= MAX_ACTIVE_PER_CUST) return errBody(429, 'too_many_active');

  const cat = await loadCatalog(deps, bid, cfg, true);
  const raw = Array.isArray(body.items) ? body.items.slice(0, MAX_LINES + 1) : [];
  if (!raw.length) return errBody(400, 'empty');
  if (raw.length > MAX_LINES) return errBody(400, 'too_many_lines');
  const agg = {}, order = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] || {};
    const pid = str(r.id, 80), vid = str(r.v, 80);
    const e = cat.byId[pid];
    if (!e) return errBody(409, 'changed', { id: pid });
    let q = num(r.q);
    if (!(q > 0) || q > MAX_QTY) return errBody(400, 'bad_qty', { id: pid });
    q = e.it.f ? round3(q) : Math.round(q);
    if (!(q > 0)) return errBody(400, 'bad_qty', { id: pid });
    let v = null;
    if (e.it.v) { v = e.it.v.find(function (x) { return x.id === vid; }); if (!v) return errBody(409, 'changed', { id: pid }); }
    else if (vid) return errBody(409, 'changed', { id: pid });
    const k = pid + '|' + (v ? v.id : '');
    if (!agg[k]) { agg[k] = { e: e, v: v, q: 0 }; order.push(k); }
    agg[k].q = round3(agg[k].q + q);
  }
  const items = []; let subtotal = 0;
  for (let i = 0; i < order.length; i++) {
    const a = agg[order[i]], it = a.e.it, v = a.v;
    const max = v ? v.m : it.m;
    if (!cat.oversell && (v ? !v.s : !it.s)) return errBody(409, 'out_of_stock', { id: it.id, v: v ? v.id : '' });
    if (!cat.oversell && max != null && a.q > max) return errBody(409, 'out_of_stock', { id: it.id, v: v ? v.id : '', max: max });
    const price = v ? v.p : it.p, sum = Math.round(price * a.q);
    subtotal += sum;
    const line = { id: it.id, name: it.n, price: price, qty: a.q, unit: it.u, sum: sum };
    if (v) { line.v = v.id; line.vName = v.n; }
    items.push(line);
  }
  if (cfg.minOrder > 0 && subtotal < cfg.minOrder) return errBody(400, 'min_order', { min: cfg.minOrder });
  const fee = mode === 'delivery' ? ((cfg.freeFrom > 0 && subtotal >= cfg.freeFrom) ? 0 : cfg.fee) : 0;
  const info = shopInfo(cat, cfg, now);
  const base = {
    id: oid, bid: bid, slug: cfg.slug, branchId: effBranch(cfg.branchId), status: 'new', createdAt: now, updatedAt: now,
    tgUser: { id: u.id, username: u.username, first: u.first, last: u.last }, name: name, phone: phone, phoneOk: phoneOk,
    items: items, subtotal: subtotal, fee: fee, total: subtotal + fee, cur: info.cur, mode: mode,
    address: mode === 'delivery' ? address : '', loc: mode === 'delivery' ? loc : null, comment: str(body.comment, 300),
    pay: body.pay === 'card' ? 'card' : 'cash', shop: info.name, shopAddr: info.address, lang: lang,
    history: [{ s: 'new', at: now, by: 'customer' }]
  };
  const sRef = db.collection('tgShop').doc(bid), iRef = inboxRef(db, bid);
  const res = await db.runTransaction(async function (tx) {
    const os = await tx.get(oRef);
    if (os && os.exists) return { again: os.data() };
    const ss = await tx.get(sRef); const sc = ss && ss.exists ? (ss.data() || {}) : {};
    const is = await tx.get(iRef); const inbox = is && is.exists ? (is.data() || {}) : {};
    const cs = await tx.get(custRef); const cust = cs && cs.exists ? (cs.data() || {}) : {};
    const orders = Object.assign({}, inbox.orders || {});
    if (Object.keys(orders).filter(function (k) { return orders[k] && ACTIVE.indexOf(orders[k].status) !== -1; }).length >= INBOX_ACTIVE_MAX) return { busy: true };
    if (inboxBytes(pruneInbox(orders, now)) > INBOX_MAX_BYTES + 200 * 1024) return { busy: true };
    const no = Math.max(0, Math.floor(num(sc.seq))) + 1;
    const o = Object.assign({}, base, { no: no });
    tx.set(sRef, Object.assign({}, sc, { seq: no }));
    tx.set(oRef, o);
    orders[oid] = inboxEntry(o);
    tx.set(iRef, { orders: pruneInbox(orders, now), updatedAt: now });
    const act = Object.assign({}, cust.active || {}); act[oid] = bid;
    const recent = (Array.isArray(cust.recent) ? cust.recent : []).concat([{ id: oid, bid: bid, at: now }]).slice(-RECENT_MAX);
    const nc = Object.assign({}, cust, { active: act, recent: recent, times: (Array.isArray(cust.times) ? cust.times : []).filter(function (x) { return x > now - HOUR; }).concat([now]),
      lang: lang, lastShop: cfg.slug, name: name, username: u.username });
    if (!(cust.phoneOk && cust.phone === phone)) { nc.phone = phone; nc.phoneOk = phoneOk; }
    tx.set(custRef, nc);
    return { o: o };
  });
  if (res.again) return okBody({ order: custSummary(res.again), again: true });
  if (res.busy) return errBody(429, 'busy');
  const o = res.o;
  await send(deps, u.id, S.t('created', lang, { no: o.no, shop: esc(o.shop), body: orderBodyHtml(o, lang, false) }),
    { inline_keyboard: [[{ text: S.t('btnCancel', lang), callback_data: 'bo:c:' + oid }], [webBtn(lang, cfg.slug, 'btnShop')]] });
  await notifyOwner(deps, bid, 'new', o);
  return okBody({ order: custSummary(o) });
}

/* ---------- ilova so'rovlari (Firebase ID token bilan, core.handleApi orqali) ---------- */
async function handleAppApi(deps, caller, uid, action, body) {
  const db = deps.db, now = deps.nowMs(), bid = caller.bid;
  const sRef = db.collection('tgShop').doc(bid);
  if (action === 'boCfg') {
    const cfg = normCfg(await getData(sRef));
    return okBody({ cfg: publicCfg(cfg), owner: caller.owner, bot: deps.botName || '', link: cfg.slug ? startLink(deps, cfg.slug) : '', web: cfg.slug ? shopUrl(cfg.slug) : '' });
  }
  if (action === 'boList') {
    const ib = (await getData(inboxRef(db, bid))) || {};
    return okBody({ orders: ib.orders || {}, updatedAt: ib.updatedAt || 0 });
  }
  if (action === 'boSave') {
    if (!caller.owner) return errBody(403, 'owner_only');
    const inCfg = body && body.cfg && typeof body.cfg === 'object' ? body.cfg : {};
    const slug = String(inCfg.slug || '').toLowerCase();
    if (!SLUG_RE.test(slug)) return errBody(400, 'bad_slug');
    if (inCfg.tz && !validTz(inCfg.tz)) inCfg.tz = '';
    const ps = await getData(db.collection('publicShops').doc(slug));
    if (ps && (ps.businessId || ps.ownerUid) && (ps.businessId || ps.ownerUid) !== bid && ps.ownerUid !== uid) return errBody(409, 'slug_taken');
    const newRef = db.collection('tgSlug').doc(slug);
    const r = await db.runTransaction(async function (tx) {
      const ss = await tx.get(sRef); const cur = ss && ss.exists ? (ss.data() || {}) : {};
      const ns = await tx.get(newRef); const owner = ns && ns.exists ? (ns.data() || {}) : null;
      if (owner && owner.bid !== bid) return { taken: true };
      const oldSlug = SLUG_RE.test(String(cur.slug || '')) ? String(cur.slug) : '';
      const oldRef = oldSlug && oldSlug !== slug ? db.collection('tgSlug').doc(oldSlug) : null;
      let oldOwn = null;
      if (oldRef) { const os = await tx.get(oldRef); oldOwn = os && os.exists ? (os.data() || {}) : null; }
      const c = normCfg(Object.assign({}, inCfg, { slug: slug, seq: cur.seq || 0 }));
      tx.set(sRef, Object.assign({}, c, { updatedAt: now, by: uid }));
      tx.set(newRef, { bid: bid, at: now });
      if (oldRef && oldOwn && oldOwn.bid === bid) tx.delete(oldRef);
      return { cfg: c };
    });
    if (r.taken) return errBody(409, 'slug_taken');
    clearCatalogCache();
    return okBody({ cfg: publicCfg(r.cfg), bot: deps.botName || '', link: startLink(deps, slug), web: shopUrl(slug) });
  }
  if (action === 'boWipe') {   /* hisob o'chirilganda: do'kon sozlamasi, havola, buyurtmalar */
    if (!caller.owner) return errBody(403, 'owner_only');
    const cur = await getData(sRef);
    if (cur && SLUG_RE.test(String(cur.slug || ''))) {
      const sl = await getData(db.collection('tgSlug').doc(String(cur.slug)));
      if (sl && sl.bid === bid) await db.collection('tgSlug').doc(String(cur.slug)).delete();
    }
    await sRef.delete();
    await inboxRef(db, bid).delete();
    let n = 0;
    for (let g = 0; g < 50; g++) {
      const snap = await db.collection('tgOrders').where('bid', '==', bid).limit(200).get();
      if (!snap.docs.length) break;
      for (let i = 0; i < snap.docs.length; i++) { await snap.docs[i].ref.delete(); n++; }
    }
    clearCatalogCache();
    return okBody({ deleted: n });
  }
  if (action === 'boPause') {
    const cur = await getData(sRef);
    if (!cur) return errBody(404, 'not_found');
    const c = normCfg(Object.assign({}, cur, { paused: body && body.paused === true }));
    await sRef.set(Object.assign({}, cur, { paused: c.paused, updatedAt: now }));
    return okBody({ cfg: publicCfg(c) });
  }
  if (action === 'boSet') {
    const oid = str(body && body.oid, 40), to = str(body && body.to, 20);
    if (!/^bo[0-9a-f]{22}$/.test(oid)) return errBody(400, 'bad_order');
    if (['accepted', 'ready', 'delivering', 'done', 'rejected'].indexOf(to) === -1) return errBody(400, 'bad_status');
    const extra = { by: str(body.by, 60) };
    if (to === 'rejected') extra.reason = str(body.reason, 200);
    if (to === 'accepted') { const e = Math.round(num(body.eta)); if (e > 0 && e <= 1440) extra.eta = e; }
    if (to === 'done' && body.saleId) { extra.saleId = str(body.saleId, 60); extra.saleNo = str(body.saleNo, 30); }
    const r = await applyStatus(deps, bid, oid, to, extra, 'shop');
    if (r.code === 'not_found') return errBody(404, 'not_found');
    if (r.code) return errBody(409, r.code, { status: r.status });
    return okBody({ order: inboxEntry(r.o), same: !!r.same });
  }
  return errBody(400, 'bad_action');
}

/* ---------- bot chatida (webhook) ---------- */
async function onStart(deps, msg, slug, lang) {
  const shop = await resolveSlug(deps.db, slug);
  const chatId = String(msg.chat.id);
  if (!shop || !shop.cfg.enabled) { await send(deps, chatId, S.t('startOff', lang)); return { shopStart: 'off' }; }
  const ref = deps.db.collection('tgCust').doc(String(msg.from && msg.from.id || chatId));
  const cust = (await getData(ref)) || {};
  await ref.set(Object.assign({}, cust, { lastShop: shop.cfg.slug, lang: cust.lang || lang, username: str(msg.from && msg.from.username, 40) }));
  const l = cust.lang || lang;
  const b = (await getData(deps.db.collection('businesses').doc(shop.bid))) || {};
  const name = str(b.businessName || 'Savdo Pos', 80);
  try { await deps.tg('setChatMenuButton', { chat_id: chatId, menu_button: { type: 'web_app', text: S.t('btnShop', l).replace(/^\S+\s/, ''), web_app: { url: shopUrl(shop.cfg.slug) } } }); } catch (e) { /* ixtiyoriy */ }
  await send(deps, chatId, S.t('start', l, { shop: esc(name) }), { inline_keyboard: [[webBtn(l, shop.cfg.slug)]] });
  return { shopStart: shop.cfg.slug };
}
async function onContact(deps, msg, lang) {
  const c = msg.contact || {};
  if (!msg.from || String(c.user_id || '') !== String(msg.from.id)) return { contact: 'foreign' };
  const phone = normPhone(c.phone_number);
  if (!phone) return { contact: 'bad' };
  const ref = deps.db.collection('tgCust').doc(String(msg.from.id));
  const cust = (await getData(ref)) || {};
  await ref.set(Object.assign({}, cust, { phone: phone, phoneOk: true, phoneAt: deps.nowMs(), name: cust.name || str([c.first_name, c.last_name].filter(Boolean).join(' '), 80) }));
  const l = cust.lang || lang;
  const kb = { remove_keyboard: true };
  await send(deps, msg.chat.id, S.t('phoneSaved', l, { phone: esc(phone) }), kb);
  if (cust.lastShop) await send(deps, msg.chat.id, S.t('fallback', l, { shop: esc(await shopNameBySlug(deps, cust.lastShop)) }), { inline_keyboard: [[webBtn(l, cust.lastShop)]] });
  return { contact: 'saved' };
}
async function shopNameBySlug(deps, slug) {
  const s = await resolveSlug(deps.db, slug);
  if (!s) return 'Savdo Pos';
  const b = (await getData(deps.db.collection('businesses').doc(s.bid))) || {};
  return str(b.businessName || 'Savdo Pos', 80);
}
/* Ega sifatida ulanmagan chat oddiy matn yozsa: oxirgi do'kon tugmasi (bo'lmasa — null, eski javob qoladi) */
async function fallbackPrompt(deps, msg, lang) {
  const cust = await getData(deps.db.collection('tgCust').doc(String(msg.from && msg.from.id || msg.chat.id)));
  if (!cust || !cust.lastShop) return null;
  const shop = await resolveSlug(deps.db, cust.lastShop);
  if (!shop || !shop.cfg.enabled) return null;
  const l = cust.lang || lang;
  return { reply: S.t('fallback', l, { shop: esc(await shopNameBySlug(deps, cust.lastShop)) }), kb: { inline_keyboard: [[webBtn(l, cust.lastShop)]] } };
}
async function onCallback(deps, cq, lang) {
  const data = String((cq && cq.data) || '');
  const m = /^bo:c:(bo[0-9a-f]{22})$/.exec(data);
  if (!m) return null;
  const answer = async function (text) { try { await deps.tg('answerCallbackQuery', { callback_query_id: cq.id, text: text || '', show_alert: !!text }); } catch (e) { } };
  const o = await getData(deps.db.collection('tgOrders').doc(m[1]));
  if (!o || !o.tgUser || String(o.tgUser.id) !== String(cq.from && cq.from.id)) { await answer(''); return { cb: 'not_found' }; }
  const cust = (await getData(deps.db.collection('tgCust').doc(String(o.tgUser.id)))) || {};
  const l = cust.lang || lang;
  if (o.status === 'cancelled') { await answer(S.t('cancelled', l, { no: o.no })); return { cb: 'already' }; }
  if (o.status !== 'new') {
    let ph = '';
    try { const b = (await getData(deps.db.collection('businesses').doc(o.bid))) || {}; if (b.businessPhone) ph = S.t('callShop', l, { p: str(b.businessPhone, 40) }); } catch (e) { ph = ''; }
    await answer(S.t('cancelLate', l, { phone: ph }).replace(/<[^>]+>/g, ''));
    return { cb: 'late' };
  }
  const r = await applyStatus(deps, o.bid, o.id, 'cancelled', {}, 'customer');
  await answer('');
  try { await deps.tg('editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [[webBtn(l, o.slug, 'btnShop')]] } }); } catch (e) { }
  return { cb: r.code ? r.code : 'cancelled' };
}

/* ---------- tozalash: 90 kundan eski buyurtmalar (telegramTick'dan) ---------- */
async function cleanupOld(deps) {
  const cut = deps.nowMs() - 90 * 24 * HOUR;
  const snap = await deps.db.collection('tgOrders').where('createdAt', '<', cut).limit(200).get();
  for (let i = 0; i < snap.docs.length; i++) { try { await snap.docs[i].ref.delete(); } catch (e) { } }
  return snap.docs.length;
}

/* ---------- rasm (GET ?img=slug&p=productId) ---------- */
async function productImage(deps, slug, pid) {
  const shop = await resolveSlug(deps.db, slug);
  if (!shop || !shop.cfg.enabled) return null;
  const cat = await loadCatalog(deps, shop.bid, shop.cfg, false);
  const e = cat.byId[String(pid || '')];
  if (!e || !hasImg(e.raw)) return null;
  const s = e.raw.image;
  if (/^https:\/\//.test(s)) return { redirect: s };
  const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(s);
  if (!m) return null;
  return { type: m[1], buf: Buffer.from(m[2], 'base64') };
}

module.exports = { handleWebApp, handleAppApi, onStart, onContact, onCallback, fallbackPrompt, applyStatus, cleanupOld, productImage, verifyInitData, webKeyFromToken,
  normCfg, buildCatalog, isOpen, INBOX_MAX_BYTES, normPhone, orderIdFor, pruneInbox, clearCatalogCache, shopUrl, SLUG_RE, MAX_ACTIVE_PER_CUST, ORDERS_PER_HOUR, INBOX_MAX };
