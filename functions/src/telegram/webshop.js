'use strict';
/* fix151-weborder: sayt katalogidan (savdo-pos.pages.dev/s/<slug>) buyurtma — bot buyurtmalari bilan bir ro'yxatga
   (businesses/{bid}/meta/botInbox) tushadi. Telegram'siz: mijoz ism va telefon yozadi; holatni sahifada kuzatadi.
   Narxlar egasi nashr qilgan katalogdan (publicShops/{slug}.payload) olinadi va serverda qayta hisoblanadi.
   Himoya: tuzoq maydon, telefon/IP/do'kon bo'yicha soatlik chegara, bitta telefonga 3 tagacha faol buyurtma.
   Ma'lumot: tgWeb/{bid} — { t:[ms], ph:{hash:[ms]}, ip:{hash:[ms]} } (faqat oxirgi soat). */
const crypto = require('crypto');
const SH = require('./shop');
const M = require('./msgs');

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28})[a-z0-9]$/;
const HOUR = 3600 * 1000;
const MAX_LINES = 60, MAX_QTY = 9999;
const SHOP_PER_HOUR = 40, PHONE_PER_HOUR = 4, IP_PER_HOUR = 8, PHONE_ACTIVE_MAX = 3;
const ACTIVE = ['new', 'accepted', 'ready', 'delivering'];
const INBOX_ACTIVE_MAX = 150;

function str(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n); }
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function ok(extra) { return { status: 200, body: Object.assign({ ok: true }, extra || {}) }; }
function err(status, code, extra) { return { status: status, body: Object.assign({ ok: false, code: code }, extra || {}) }; }
async function getData(ref) { const s = await ref.get(); return s && s.exists ? (s.data() || {}) : null; }
function normPhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 9) d = '998' + d;
  if (d.length < 9 || d.length > 15) return '';
  return '+' + d;
}
function h12(s) { return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12); }
function tokenFor(deps, oid) { return crypto.createHmac('sha256', deps.webKey).update('web|' + oid).digest('hex').slice(0, 24); }
function tokOk(deps, oid, t) { const a = Buffer.from(tokenFor(deps, oid)), b = Buffer.from(String(t || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); }
function recent(arr, now) { return (Array.isArray(arr) ? arr : []).filter(function (x) { return x > now - HOUR; }); }
function pruneMap(m, now) { const o = {}; Object.keys(m || {}).forEach(function (k) { const r = recent(m[k], now); if (r.length) o[k] = r; }); return o; }
function summary(o) {
  return { id: o.id, no: o.no, status: o.status, createdAt: o.createdAt, total: o.total, cur: o.cur, mode: o.mode, eta: o.eta || 0, reason: o.reason || '',
    items: (o.items || []).slice(0, 30).map(function (x) { return { name: x.name, vName: x.vName || '', qty: x.qty, sum: x.sum }; }) };
}
async function loadShop(db, slug) {
  slug = String(slug || '').toLowerCase();
  if (!SLUG_RE.test(slug)) return null;
  const d = await getData(db.collection('publicShops').doc(slug));
  if (!d || typeof d.payload !== 'string') return null;
  let p; try { p = JSON.parse(d.payload); } catch (e) { return null; }
  const bid = String(d.businessId || d.ownerUid || '');
  if (!bid || !p || !Array.isArray(p.products)) return null;
  return { bid: bid, slug: slug, p: p };
}

async function handle(deps, body, meta) {
  body = body && typeof body === 'object' ? body : {};
  meta = meta || {};
  if (!deps.webKey) return err(503, 'not_configured');
  const db = deps.db, now = deps.nowMs();
  const action = str(body.action, 20);
  if (action === 'siteStatus') {
    const list = Array.isArray(body.orders) ? body.orders.slice(0, 10) : [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const x = list[i] || {}, oid = str(x.id, 40);
      if (!/^bo[0-9a-f]{22}$/.test(oid) || !tokOk(deps, oid, x.t)) continue;
      const o = await getData(db.collection('tgOrders').doc(oid));
      if (o && o.src === 'web') out.push(summary(o));
    }
    return ok({ orders: out });
  }
  if (action === 'siteCancel') {
    const oid = str(body.id, 40);
    if (!/^bo[0-9a-f]{22}$/.test(oid) || !tokOk(deps, oid, body.t)) return err(404, 'not_found');
    const o = await getData(db.collection('tgOrders').doc(oid));
    if (!o || o.src !== 'web') return err(404, 'not_found');
    const r = await SH.applyStatus(deps, o.bid, oid, 'cancelled', {}, 'customer');
    if (r.code) return err(409, r.code, { status: r.status || o.status });
    return ok({ order: summary(r.o) });
  }
  if (action !== 'siteOrder') return err(400, 'bad_action');
  if (str(body.hp, 50)) return err(400, 'bad_request');   // tuzoq maydon (odam ko'rmaydi)
  const shop = await loadShop(db, body.slug);
  if (!shop) return err(404, 'closed');
  const P = shop.p, bid = shop.bid;
  if (P.orders !== true) return err(403, 'orders_off');
  const clientId = str(body.clientId, 40);
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(clientId)) return err(400, 'bad_request');
  const phone = normPhone(body.phone);
  if (!phone) return err(400, 'need_phone');
  const name = str(body.name, 80);
  if (name.length < 2) return err(400, 'need_name');
  const oid = 'bo' + crypto.createHash('sha256').update(bid + '|web:' + phone + '|' + clientId).digest('hex').slice(0, 22);
  const oRef = db.collection('tgOrders').doc(oid);
  const prev = await getData(oRef);
  if (prev) return ok({ order: summary(prev), t: tokenFor(deps, oid), again: true });
  const mode = body.mode === 'delivery' ? 'delivery' : 'pickup';
  const address = str(body.address, 300), comment = str(body.comment, 300);
  if (mode === 'delivery' && address.length < 3) return err(400, 'need_address');
  const biz = (await getData(db.collection('businesses').doc(bid))) || {};
  const cur = str(biz.currency || 'UZS', 6), D = M.decOf(cur);
  const byId = {}; P.products.forEach(function (p) { if (p && p.id != null) byId[String(p.id)] = p; });
  const raw = Array.isArray(body.items) ? body.items.slice(0, MAX_LINES + 1) : [];
  if (!raw.length) return err(400, 'empty');
  if (raw.length > MAX_LINES) return err(400, 'too_many_lines');
  const agg = {}, keys = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i] || {}, pid = str(r.id, 80), vn = str(r.vn, 80);
    const p = byId[pid];
    if (!p) return err(409, 'changed', { id: pid });
    let q = Math.round(num(r.q));
    if (!(q > 0) || q > MAX_QTY) return err(400, 'bad_qty', { id: pid });
    let v = null;
    const vs = Array.isArray(p.variants) ? p.variants : [];
    if (vs.length) { v = vs.find(function (x) { return x && x.name === vn; }); if (!v) return err(409, 'changed', { id: pid }); }
    else if (vn) return err(409, 'changed', { id: pid });
    if ((v ? v.inStock : p.inStock) === false) return err(409, 'out_of_stock', { id: pid, vn: vn });
    const price = SH.money(v ? v.price : p.price, D);
    if (!(price > 0)) return err(409, 'changed', { id: pid });
    const k = pid + '|' + vn;
    if (!agg[k]) { agg[k] = { p: p, v: v, q: 0, price: price }; keys.push(k); }
    agg[k].q = Math.min(MAX_QTY, agg[k].q + q);
  }
  const prods = {};
  const items = []; let subtotal = 0;
  for (let i = 0; i < keys.length; i++) {
    const a = agg[keys[i]], p = a.p, pid = String(p.id);
    const sum = M.rnd(a.price * a.q, D);
    subtotal = M.rnd(subtotal + sum, D);
    const per = Math.floor(num(p.perBox));
    const line = { id: pid, name: str(p.name, 120), price: a.price, qty: a.q, unit: ['dona', 'kg', 'litr', 'paket'].indexOf(p.unit) !== -1 ? p.unit : 'dona', sum: sum };
    if (per > 1 && !a.v) { line.qty = a.q * per; line.price = a.price / per; line.vName = a.q + ' × ' + str(p.unitLabel, 60); }   /* quti: ombordagi dona soni */
    if (a.v) {
      if (!(pid in prods)) prods[pid] = await getData(db.collection('businesses').doc(bid).collection('products').doc(pid));
      const real = prods[pid] && Array.isArray(prods[pid].variants) ? prods[pid].variants.find(function (x) { return x && x.name === a.v.name; }) : null;
      if (!real || !real.id) return err(409, 'changed', { id: pid });
      line.v = String(real.id); line.vName = str(a.v.name, 80);
    }
    items.push(line);
  }
  const ip = h12(meta.ip || 'none'), ph = h12(phone);
  const sRef = db.collection('tgShop').doc(bid), iRef = db.collection('businesses').doc(bid).collection('meta').doc('botInbox'), wRef = db.collection('tgWeb').doc(bid);
  const base = {
    id: oid, bid: bid, slug: shop.slug, src: 'web', branchId: str(P.branchId, 60) || 'main', status: 'new', createdAt: now, updatedAt: now,
    name: name, phone: phone, phoneOk: false, items: items, subtotal: subtotal, fee: 0, total: subtotal, cur: cur, mode: mode,
    address: mode === 'delivery' ? address : '', comment: comment, pay: body.pay === 'card' ? 'card' : 'cash',
    shop: str(P.name || biz.businessName || 'Savdo Pos', 80), shopAddr: str(P.address || biz.businessAddress, 200), lang: P.lang === 'ru' ? 'ru' : 'uz',
    history: [{ s: 'new', at: now, by: 'customer' }]
  };
  const res = await db.runTransaction(async function (tx) {
    const os = await tx.get(oRef);
    if (os && os.exists) return { again: os.data() };
    const ss = await tx.get(sRef); const sc = ss && ss.exists ? (ss.data() || {}) : {};
    const is = await tx.get(iRef); const inbox = is && is.exists ? (is.data() || {}) : {};
    const ws = await tx.get(wRef); const w = ws && ws.exists ? (ws.data() || {}) : {};
    const t = recent(w.t, now), phm = pruneMap(w.ph, now), ipm = pruneMap(w.ip, now);
    if (t.length >= SHOP_PER_HOUR || (phm[ph] || []).length >= PHONE_PER_HOUR || (ipm[ip] || []).length >= IP_PER_HOUR) return { many: true };
    const orders = Object.assign({}, inbox.orders || {});
    const act = Object.keys(orders).filter(function (k) { return orders[k] && ACTIVE.indexOf(orders[k].status) !== -1; });
    if (act.length >= INBOX_ACTIVE_MAX) return { busy: true };
    if (act.filter(function (k) { return orders[k].src === 'web' && orders[k].phone === phone; }).length >= PHONE_ACTIVE_MAX) return { manyActive: true };
    const no = Math.max(0, Math.floor(num(sc.seq))) + 1;
    const o = Object.assign({}, base, { no: no });
    tx.set(sRef, Object.assign({}, sc, { seq: no }));
    tx.set(oRef, o);
    orders[oid] = SH.inboxEntry(o);
    tx.set(iRef, { orders: SH.pruneInbox(orders, now), updatedAt: now });
    phm[ph] = (phm[ph] || []).concat([now]); ipm[ip] = (ipm[ip] || []).concat([now]);
    tx.set(wRef, { t: t.concat([now]), ph: phm, ip: ipm });
    return { o: o };
  });
  if (res.again) return ok({ order: summary(res.again), t: tokenFor(deps, oid), again: true });
  if (res.many) return err(429, 'too_many');
  if (res.manyActive) return err(429, 'too_many_active');
  if (res.busy) return err(429, 'busy');
  SH.dropCatalog(bid);
  let o = res.o;
  try { o = await SH.autoAccept(deps, bid, SH.normCfg(await getData(sRef)), o); } catch (e) {}   /* fix153-boplus */
  try { await SH.notifyOwner(deps, bid, 'new', o); } catch (e) {}
  return ok({ order: summary(o), t: tokenFor(deps, oid) });
}

module.exports = { handle, tokenFor, loadShop };
