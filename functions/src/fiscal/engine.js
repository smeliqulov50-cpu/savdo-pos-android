'use strict';
/* fix185-fiscal3: fiskal dvigatel — savdoni provayderga yuborish, holat, navbat, qayta urinish.
   Faqat fx === 1 belgili savdolar (sotuv paytida fiskal rejim yoqilgan bo'lgan) ishlanadi; boshqalarga TEGILMAYDI.
   Ma'lumot (faqat server yozadi, Admin SDK):
     businesses/{bid}/fiscal/{saleId} — { saleId, status: sending|sent|failed, open (yuborilmaganmi), attempts, lastError, retryable,
                                          sign, number, qr, providerId, test, sentAt, nextAt, lockAt, receiptNo, total, updatedAt }
     fiscalBiz/{bid}                  — { pending: { saleId: nextAt }, pendingCount } — avtomatik qayta urinish navbati
   Dublikat himoyasi: fiskal hujjat tranzaksiyada "sending" qilinadi (90 s qulf); "sent" bo'lsa qayta yuborilmaydi;
   provayder tomonida ham chek id = savdo id. Ikki yo'l (ilovadan darhol 'send' va savdo triggeri) bir-birini to'sadi. */
const R = require('./receipt');
const P = require('./providers');

const LOCK_MS = 90 * 1000;
const BACKOFF_MIN = [1, 5, 15, 30, 60];
const MAX_IDS = 100, RETRY_PER_RUN = 20, BIZ_PER_TICK = 50;

async function getData(ref) { const s = await ref.get(); return s && s.exists ? (s.data() || {}) : null; }
function fRef(db, bid, sid) { return db.collection('businesses').doc(bid).collection('fiscal').doc(String(sid)); }
function qRef(db, bid) { return db.collection('fiscalBiz').doc(bid); }
function backoff(attempts) { return BACKOFF_MIN[Math.min(BACKOFF_MIN.length - 1, Math.max(0, attempts - 1))] * 60000; }
function pub(d) {
  if (!d) return { status: 'none' };
  return { status: d.status, sign: d.sign || '', number: d.number || '', qr: d.qr || '', error: d.lastError || '', retryable: !!d.retryable, attempts: d.attempts || 0, test: !!d.test, sentAt: d.sentAt || null };
}
/* sotuv paytidagi qiymatlar savdo qatorlarida (it.ikpu, it.pkg, it.vat) — shu bo'yicha mahsulot xaritasi */
function productsFromItems(sale) {
  const m = {};
  (sale.items || []).forEach(function (it) { if (it && it.productId && !m[it.productId]) m[it.productId] = { ikpu: it.ikpu || '', packageCode: it.pkg || '', vat: it.vat === undefined ? null : it.vat }; });
  return m;
}

async function setQueue(deps, bid, sid, nextAt) {
  const ref = qRef(deps.db, bid);
  await deps.db.runTransaction(async function (tx) {
    const s = await tx.get(ref); const d = (s && s.exists ? s.data() : null) || {};
    const p = Object.assign({}, d.pending || {});
    if (nextAt) p[sid] = nextAt; else delete p[sid];
    tx.set(ref, { pending: p, pendingCount: Object.keys(p).length, updatedAt: deps.nowMs() });
  });
}

/* Asosiy: bitta savdoni fiskallashtirish. Qaytaradi: pub() shakli. */
async function processSale(deps, bid, sale, opts) {
  opts = opts || {};
  if (!sale || !sale.id || sale.fx !== 1) return { status: 'skip' };
  const sid = String(sale.id), now = deps.nowMs(), db = deps.db, ref = fRef(db, bid, sid);
  const lock = await db.runTransaction(async function (tx) {
    const s = await tx.get(ref); const d = (s && s.exists ? s.data() : null) || null;
    if (d && d.status === 'sent') return { done: d };
    if (d && d.status === 'sending' && (d.lockAt || 0) > now - LOCK_MS) return { busy: d };
    if (d && d.status === 'failed' && !opts.force && d.retryable === false) return { done: d };
    if (d && d.status === 'failed' && !opts.force && (d.nextAt || 0) > now) return { done: d };
    const n = Object.assign({}, d || {}, { saleId: sid, status: 'sending', open: true, lockAt: now, attempts: ((d && d.attempts) || 0) + 1, receiptNo: String(sale.receiptNumber || ''), updatedAt: now });
    tx.set(ref, n);
    return { go: n };
  });
  if (lock.done) return pub(lock.done);
  if (lock.busy) return pub(lock.busy);
  const st = lock.go;
  const biz = (await getData(db.collection('businesses').doc(bid))) || {};
  const pname = String(biz.fiscalProvider || '');
  const built = R.buildReceipt(sale, productsFromItems(sale), biz);
  let res;
  if (!built.ok) res = { ok: false, error: 'receipt_' + built.error, retryable: false };
  else {
    const prov = deps.provider ? deps.provider(pname, biz) : P.create(pname, deps.secrets || null, deps.providerOpts || null);
    res = await prov.sendSale(built.receipt);
  }
  const t = deps.nowMs();
  let out;
  if (res.ok) {
    out = Object.assign({}, st, { status: 'sent', open: false, sign: res.sign, number: res.number, qr: res.qr, providerId: res.providerId, test: pname === 'mock', sentAt: res.at || new Date(t).toISOString(), lastError: '', retryable: false, nextAt: null, lockAt: null, total: built.receipt.total, updatedAt: t });
  } else {
    const retry = res.retryable !== false;
    out = Object.assign({}, st, { status: 'failed', open: true, lastError: String(res.error || 'error').slice(0, 200), retryable: retry, nextAt: retry ? t + backoff(st.attempts) : null, lockAt: null, updatedAt: t });
  }
  await ref.set(out);
  try { await setQueue(deps, bid, sid, out.status === 'failed' && out.retryable ? out.nextAt : null); } catch (e) {}
  return pub(out);
}

/* Savdo hujjati yaratilganda (trigger) */
async function onSaleCreated(deps, bid, sid, sale) {
  if (!sale || sale.fx !== 1) return { status: 'skip' };
  return processSale(deps, bid, Object.assign({ id: sid }, sale));
}

/* Har 10 daqiqada: navbatdagi (vaqti kelgan) cheklarni qayta yuborish */
async function retryTick(deps) {
  const now = deps.nowMs();
  const snap = await deps.db.collection('fiscalBiz').where('pendingCount', '>', 0).limit(BIZ_PER_TICK).get();
  let tried = 0, sent = 0;
  for (const d of snap.docs) {
    const bid = d.id, p = (d.data() || {}).pending || {};
    const due = Object.keys(p).filter(function (k) { return (p[k] || 0) <= now; }).slice(0, RETRY_PER_RUN);
    for (const sid of due) {
      const sale = await getData(deps.db.collection('businesses').doc(bid).collection('sales').doc(sid));
      if (!sale || sale.fx !== 1) { await setQueue(deps, bid, sid, null); continue; }
      tried++;
      const r = await processSale(deps, bid, Object.assign({ id: sid }, sale));
      if (r.status === 'sent') sent++;
    }
  }
  return { tried: tried, sent: sent };
}

/* Ilova so'rovlari (Firebase ID token bilan; caller = resolveCaller natijasi {bid}) */
async function api(deps, caller, body) {
  if (!caller || !caller.bid) return { status: 403, body: { ok: false, code: 'forbidden' } };
  const bid = caller.bid, a = String((body && body.action) || '');
  const db = deps.db;
  if (a === 'send') {
    const s = body.sale;
    if (!s || !s.id || typeof s.id !== 'string' || s.id.length > 80 || !Array.isArray(s.items)) return { status: 400, body: { ok: false, code: 'bad_sale' } };
    const stored = await getData(db.collection('businesses').doc(bid).collection('sales').doc(s.id));
    const sale = stored ? Object.assign({ id: s.id }, stored) : s;   // bulutdagi nusxa ustun
    if (sale.fx !== 1) return { status: 200, body: { ok: true, result: { status: 'skip' } } };
    return { status: 200, body: { ok: true, result: await processSale(deps, bid, sale, { force: body.force === true }) } };   // force — foydalanuvchi «Qayta yuborish» bosganda (yuborilgan chek baribir qayta ketmaydi)
  }
  if (a === 'status') {
    const ids = Array.isArray(body.ids) ? body.ids.filter(function (x) { return typeof x === 'string' && x.length <= 80; }).slice(0, MAX_IDS) : [];
    const out = {};
    for (const id of ids) out[id] = pub(await getData(fRef(db, bid, id)));
    return { status: 200, body: { ok: true, map: out } };
  }
  if (a === 'open') {
    const snap = await db.collection('businesses').doc(bid).collection('fiscal').where('open', '==', true).limit(200).get();
    const list = snap.docs.map(function (d) { return Object.assign({ id: d.id, receiptNo: (d.data() || {}).receiptNo || '' }, pub(d.data())); });
    return { status: 200, body: { ok: true, list: list } };
  }
  if (a === 'retry') {
    let ids = Array.isArray(body.ids) ? body.ids.filter(function (x) { return typeof x === 'string' && x.length <= 80; }) : [];
    if (body.all) { const snap = await db.collection('businesses').doc(bid).collection('fiscal').where('open', '==', true).limit(RETRY_PER_RUN).get(); ids = snap.docs.map(function (d) { return d.id; }); }
    ids = ids.slice(0, RETRY_PER_RUN);
    const out = {}; let sent = 0;
    for (const id of ids) {
      const sale = await getData(db.collection('businesses').doc(bid).collection('sales').doc(id));
      if (!sale) { out[id] = { status: 'no_sale' }; continue; }
      out[id] = await processSale(deps, bid, Object.assign({ id: id }, sale), { force: true });
      if (out[id].status === 'sent') sent++;
    }
    return { status: 200, body: { ok: true, map: out, sent: sent, tried: ids.length } };
  }
  if (a === 'ping') {
    const biz = (await getData(db.collection('businesses').doc(bid))) || {};
    const pname = String(biz.fiscalProvider || '');
    const prov = deps.provider ? deps.provider(pname, biz) : P.create(pname, deps.secrets || null, deps.providerOpts || null);
    const r = await prov.checkConnection();
    return { status: 200, body: { ok: true, result: r.ok ? { ok: true, provider: pname } : { ok: false, error: r.error, provider: pname } } };
  }
  return { status: 400, body: { ok: false, code: 'bad_action' } };
}

module.exports = { processSale, onSaleCreated, retryTick, api, backoff, pub, productsFromItems, LOCK_MS };
