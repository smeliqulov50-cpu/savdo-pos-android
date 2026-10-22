'use strict';
/* fix185-fiscal3 + fix186-fiscal4: fiskal dvigatel — savdo, qaytarish, chekni tahrirlash, o'chirish, qarz to'lovi.
   Faqat fx === 1 belgili yozuvlar (fiskal rejim yoqilgan paytda yaratilgan) ishlanadi; boshqalarga TEGILMAYDI.
   Hujjatlar (faqat server yozadi): businesses/{bid}/fiscal/{opId}
     {sid}          — savdo cheki («Продажа», nasiya bo'lsa ham to'liq summaga). Qo'shimcha: rc (yuborilgan chek nusxasi),
                      cur (hozirgi amaldagi versiya), editSeq, edits {editedAt: n}
     {sid}~R        — qaytarish (hozirgi versiyaning aynan o'sha qatorlari); asl chek yuborilmagan bo'lsa — avval u
     {sid}~r{n}     — tahrir n: oldingi versiyani qaytarish   |   {sid}~v{n} — tahrir n: yangi versiya cheki (r{n} dan keyin)
     pay_{entryId}  — qarz to'lovi cheki («Кредит», to'langan summaga; QR/fiskal belgisiz)
   Har hujjat: status sending|sent|failed|cancelled, open, attempts, lastError, retryable, sign, number, qr, nextAt, lockAt, kind, saleId.
   fiscalBiz/{bid}.pending {opId: nextAt} — avtomatik qayta urinish navbati. 90 s qulf — bir operatsiya ikki marta yuborilmaydi. */
const R = require('./receipt');
const P = require('./providers');

const LOCK_MS = 90 * 1000;
const BACKOFF_MIN = [1, 5, 15, 30, 60];
const MAX_IDS = 100, RETRY_PER_RUN = 20, BIZ_PER_TICK = 50;

async function getData(ref) { const s = await ref.get(); return s && s.exists ? (s.data() || {}) : null; }
function fCol(db, bid) { return db.collection('businesses').doc(bid).collection('fiscal'); }
function fRef(db, bid, id) { return fCol(db, bid).doc(String(id)); }
function qRef(db, bid) { return db.collection('fiscalBiz').doc(bid); }
function saleRef(db, bid, sid) { return db.collection('businesses').doc(bid).collection('sales').doc(String(sid)); }
function backoff(attempts) { return BACKOFF_MIN[Math.min(BACKOFF_MIN.length - 1, Math.max(0, attempts - 1))] * 60000; }
function pub(d) {
  if (!d) return { status: 'none' };
  return { status: d.status, sign: d.sign || '', number: d.number || '', qr: d.qr || '', error: d.lastError || '', retryable: !!d.retryable, attempts: d.attempts || 0, test: !!d.test, sentAt: d.sentAt || null, kind: d.kind || 'sale' };
}
function productsFromItems(sale) {
  const m = {};
  (sale.items || []).forEach(function (it) { if (it && it.productId && !m[it.productId]) m[it.productId] = { ikpu: it.ikpu || '', packageCode: it.pkg || '', vat: it.vat === undefined ? null : it.vat }; });
  return m;
}
function provOf(deps, pname, biz) { return deps.provider ? deps.provider(pname, biz) : P.create(pname, deps.secrets || null, deps.providerOpts || null); }

async function setQueue(deps, bid, id, nextAt) {
  const ref = qRef(deps.db, bid);
  await deps.db.runTransaction(async function (tx) {
    const s = await tx.get(ref); const d = (s && s.exists ? s.data() : null) || {};
    const p = Object.assign({}, d.pending || {});
    if (nextAt) p[id] = nextAt; else delete p[id];
    tx.set(ref, { pending: p, pendingCount: Object.keys(p).length, updatedAt: deps.nowMs() });
  });
}

/* Umumiy: bitta operatsiya (qulf → tayyorlash → provayder → natija). prepare(biz) → {ok, receipt, original} | {ok:false,error,retryable} | {cancel:true} */
async function runOp(deps, bid, id, meta, prepare, opts) {
  opts = opts || {};
  const now = deps.nowMs(), db = deps.db, ref = fRef(db, bid, id);
  const lock = await db.runTransaction(async function (tx) {
    const s = await tx.get(ref); const d = (s && s.exists ? s.data() : null) || null;
    if (d && (d.status === 'sent' || d.status === 'cancelled')) return { done: d };
    if (d && d.status === 'sending' && (d.lockAt || 0) > now - LOCK_MS) return { busy: d };
    if (d && d.status === 'failed' && !opts.force && d.retryable === false) return { done: d };
    if (d && d.status === 'failed' && !opts.force && (d.nextAt || 0) > now) return { done: d };
    const n = Object.assign({}, meta || {}, d || {}, { status: 'sending', open: true, lockAt: now, attempts: ((d && d.attempts) || 0) + 1, updatedAt: now });
    tx.set(ref, n);
    return { go: n };
  });
  if (lock.done) return pub(lock.done);
  if (lock.busy) return pub(lock.busy);
  const st = lock.go;
  const biz = (await getData(db.collection('businesses').doc(bid))) || {};
  const pname = String(biz.fiscalProvider || '');
  let prep;
  try { prep = await prepare(biz, st); } catch (e) { prep = { ok: false, error: 'prepare: ' + (e && e.message || ''), retryable: true }; }
  const t = deps.nowMs();
  let out;
  if (prep && prep.cancel) {
    out = Object.assign({}, st, { status: 'cancelled', open: false, lastError: prep.reason || '', retryable: false, nextAt: null, lockAt: null, updatedAt: t });
  } else {
    let res;
    if (!prep || !prep.ok) res = { ok: false, error: (prep && prep.error) || 'prepare_failed', retryable: prep ? prep.retryable !== false : true };
    else { const pv = provOf(deps, pname, biz); res = prep.receipt.refund ? await pv.sendRefund(prep.receipt, prep.original) : await pv.sendSale(prep.receipt); }
    if (res.ok) {
      out = Object.assign({}, st, { status: 'sent', open: false, sign: res.sign, number: res.number, qr: res.qr, providerId: res.providerId, test: pname === 'mock', sentAt: res.at || new Date(t).toISOString(), lastError: '', retryable: false, nextAt: null, lockAt: null, total: prep.receipt.total, rc: prep.receipt, updatedAt: t });
    } else {
      const retry = res.retryable !== false;
      out = Object.assign({}, st, { status: 'failed', open: true, lastError: String(res.error || 'error').slice(0, 200), retryable: retry, nextAt: retry ? t + backoff(st.attempts) : null, lockAt: null, updatedAt: t });
    }
  }
  // lock paytida boshqa jarayon yozgan maydonlar (cur, editSeq, edits) saqlansin
  const cur = await getData(ref);
  if (cur) ['cur', 'editSeq', 'edits'].forEach(function (k) { if (cur[k] !== undefined) out[k] = cur[k]; });
  await ref.set(out);
  try { await setQueue(deps, bid, id, out.status === 'failed' && out.retryable ? out.nextAt : null); } catch (e) {}
  return pub(out);
}

/* ---------- savdo ---------- */
async function processSale(deps, bid, sale, opts) {
  if (!sale || !sale.id || sale.fx !== 1) return { status: 'skip' };
  const sid = String(sale.id);
  return runOp(deps, bid, sid, { saleId: sid, kind: 'sale', receiptNo: String(sale.receiptNumber || '') }, async function (biz) {
    const b = R.buildReceipt(sale, productsFromItems(sale), biz);
    return b.ok ? { ok: true, receipt: b.receipt } : { ok: false, error: 'receipt_' + b.error, retryable: false };
  }, opts);
}
async function onSaleCreated(deps, bid, sid, sale) {
  if (!sale || sale.fx !== 1) return { status: 'skip' };
  return processSale(deps, bid, Object.assign({ id: sid }, sale));
}

/* Asl chek (yoki amaldagi versiya) yuborilganmi — kerak bo'lsa avval asl chekni yuboradi */
async function ensureOriginal(deps, bid, sid, sale) {
  let base = await getData(fRef(deps.db, bid, sid));
  if (!base || (base.status !== 'sent' && base.status !== 'cancelled')) {
    if (!sale) return { missing: true, base: base };
    await processSale(deps, bid, Object.assign({ id: sid }, sale), { force: true });
    base = await getData(fRef(deps.db, bid, sid));
  }
  if (!base || base.status !== 'sent') return { pending: true, base: base };
  const curId = base.cur || sid;
  const cur = curId === sid ? base : await getData(fRef(deps.db, bid, curId));
  if (!cur || cur.status !== 'sent') return { pending: true, base: base };
  return { ok: true, base: base, cur: cur, curId: curId };
}

/* ---------- qaytarish (to'liq) / o'chirish ---------- */
async function processRefund(deps, bid, sid, opts) {
  sid = String(sid);
  return runOp(deps, bid, sid + '~R', { saleId: sid, kind: 'refund' }, async function () {
    const sale = await getData(saleRef(deps.db, bid, sid));
    const o = await ensureOriginal(deps, bid, sid, sale);
    if (o.missing) {   // savdo o'chirilgan va asl chek hech qachon yuborilmagan — fiskal jihatdan savdo bo'lmagan
      if (o.base && o.base.status !== 'cancelled') { await fRef(deps.db, bid, sid).set(Object.assign({}, o.base, { status: 'cancelled', open: false, retryable: false, nextAt: null, updatedAt: deps.nowMs() })); try { await setQueue(deps, bid, sid, null); } catch (e) {} }
      return { cancel: true, reason: 'original_never_sent' };
    }
    if (o.base && o.base.status === 'cancelled') return { cancel: true, reason: 'original_cancelled' };
    if (o.pending) return { ok: false, error: 'original_pending', retryable: true };
    return { ok: true, receipt: R.refundOf(o.cur.rc, sid + '~R', o.cur), original: { sign: o.cur.sign, number: o.cur.number, at: o.cur.sentAt } };
  }, opts);
}
async function onSaleDeleted(deps, bid, sid, before) {
  if (!before || before.fx !== 1) return { status: 'skip' };
  const base = await getData(fRef(deps.db, bid, sid));
  if (!base) return { status: 'skip' };
  if (base.status === 'sent') return processRefund(deps, bid, sid);
  if (base.status === 'sending') { await setQueue(deps, bid, sid + '~R', deps.nowMs() + 60000); return { status: 'queued' }; }
  if (base.status !== 'cancelled') { await fRef(deps.db, bid, sid).set(Object.assign({}, base, { status: 'cancelled', open: false, retryable: false, nextAt: null, lastError: 'sale_deleted', updatedAt: deps.nowMs() })); try { await setQueue(deps, bid, sid, null); } catch (e) {} }
  return { status: 'cancelled' };
}

/* ---------- chekni tahrirlash: oldingi versiyani qaytarish + yangi versiya ---------- */
async function processEditRefund(deps, bid, sid, n, opts) {
  const id = sid + '~r' + n;
  return runOp(deps, bid, id, { saleId: sid, kind: 'editRefund' }, async function (biz, st) {
    const tgt = st.target ? await getData(fRef(deps.db, bid, st.target)) : null;
    if (!tgt || tgt.status !== 'sent') return { ok: false, error: 'original_pending', retryable: true };
    return { ok: true, receipt: R.refundOf(tgt.rc, id, tgt), original: { sign: tgt.sign, number: tgt.number, at: tgt.sentAt } };
  }, opts);
}
async function processVersion(deps, bid, sid, n, opts) {
  const id = sid + '~v' + n;
  return runOp(deps, bid, id, { saleId: sid, kind: 'edit' }, async function (biz, st) {
    const rf = await getData(fRef(deps.db, bid, sid + '~r' + n));
    if (!rf || rf.status !== 'sent') return { ok: false, error: 'waiting_refund', retryable: true };
    if (!st.src) return { ok: false, error: 'no_source', retryable: false };
    const sale = Object.assign({}, st.src, { id: id });
    const b = R.buildReceipt(sale, productsFromItems(sale), biz);
    return b.ok ? { ok: true, receipt: b.receipt } : { ok: false, error: 'receipt_' + b.error, retryable: false };
  }, opts);
}
async function onSaleEdited(deps, bid, sid, after) {
  if (!after || after.fx !== 1 || after.refunded || !after.editedAt) return { status: 'skip' };
  const db = deps.db, bRef = fRef(db, bid, sid), key = String(after.editedAt);
  const alloc = await db.runTransaction(async function (tx) {
    const s = await tx.get(bRef); const b = (s && s.exists ? s.data() : null) || null;
    if (!b || b.status !== 'sent') return { unsent: true };
    const edits = Object.assign({}, b.edits || {});
    if (edits[key]) return { n: edits[key], again: true };
    const n = (b.editSeq || 0) + 1; edits[key] = n;
    const prevCur = b.cur || sid;
    tx.set(bRef, Object.assign({}, b, { edits: edits, editSeq: n, cur: sid + '~v' + n, updatedAt: deps.nowMs() }));
    return { n: n, prevCur: prevCur };
  });
  if (alloc.unsent) return processSale(deps, bid, Object.assign({ id: sid }, after));   // hali yuborilmagan — tahrirlangan holi yuboriladi
  const n = alloc.n;
  if (!alloc.again) {
    const src = JSON.parse(JSON.stringify(after)); delete src.id;
    const t = deps.nowMs();
    await fRef(db, bid, sid + '~r' + n).set({ saleId: sid, kind: 'editRefund', target: alloc.prevCur, status: 'failed', open: true, retryable: true, attempts: 0, nextAt: t, updatedAt: t, receiptNo: String(after.receiptNumber || '') });
    await fRef(db, bid, sid + '~v' + n).set({ saleId: sid, kind: 'edit', src: src, status: 'failed', open: true, retryable: true, attempts: 0, nextAt: t, updatedAt: t, receiptNo: String(after.receiptNumber || '') });
  }
  const a = await processEditRefund(deps, bid, sid, n);
  const b = await processVersion(deps, bid, sid, n);
  return { status: b.status, refund: a.status, n: n };
}

/* Savdo hujjati o'zgarganda (yaratilish — onSaleCreated da) */
async function onSaleWritten(deps, bid, sid, before, after) {
  if (!before) return { status: 'skip' };
  if (!after) return onSaleDeleted(deps, bid, sid, before);
  if (after.fx !== 1) return { status: 'skip' };
  if (after.refunded && !before.refunded) return processRefund(deps, bid, sid);
  if (after.editedAt && after.editedAt !== before.editedAt && !after.refunded) return onSaleEdited(deps, bid, sid, after);
  return { status: 'skip' };
}

/* ---------- qarz to'lovi («Кредит» cheki) ---------- */
function isCreditPay(e) { return !!(e && e.fx === 1 && e.type === 'payment' && !e.saleId && Number(e.amount) > 0 && e.customerId); }
async function processCreditPay(deps, bid, eid, entry, opts) {
  const id = 'pay_' + String(eid);
  return runOp(deps, bid, id, { kind: 'credit', entryId: String(eid), receiptNo: '' }, async function (biz) {
    const b = R.creditPayReceipt(Object.assign({ id: eid }, entry), biz);
    return b.ok ? { ok: true, receipt: b.receipt } : { ok: false, error: 'receipt_' + b.error, retryable: false };
  }, opts);
}
async function onLedgerCreated(deps, bid, eid, entry) {
  if (!isCreditPay(entry)) return { status: 'skip' };
  return processCreditPay(deps, bid, eid, entry);
}

/* ---------- qayta urinish: hujjat id bo'yicha yo'naltirish ---------- */
async function retryDoc(deps, bid, id, opts) {
  const db = deps.db; let m;
  if ((m = /^pay_(.+)$/.exec(id))) {
    const e = await getData(db.collection('businesses').doc(bid).collection('ledger').doc(m[1]));
    if (!isCreditPay(e)) { await setQueue(deps, bid, id, null); return { status: 'no_source' }; }
    return processCreditPay(deps, bid, m[1], e, opts);
  }
  if ((m = /^(.+)~R$/.exec(id))) return processRefund(deps, bid, m[1], opts);
  if ((m = /^(.+)~r(\d+)$/.exec(id))) return processEditRefund(deps, bid, m[1], Number(m[2]), opts);
  if ((m = /^(.+)~v(\d+)$/.exec(id))) return processVersion(deps, bid, m[1], Number(m[2]), opts);
  const sale = await getData(saleRef(db, bid, id));
  if (!sale) {
    const base = await getData(fRef(db, bid, id));
    if (base && base.status !== 'sent') return onSaleDeleted(deps, bid, id, { fx: 1 });
    await setQueue(deps, bid, id, null); return { status: 'no_sale' };
  }
  if (sale.fx !== 1) { await setQueue(deps, bid, id, null); return { status: 'skip' }; }
  return processSale(deps, bid, Object.assign({ id: id }, sale), opts);
}

/* Har 10 daqiqada */
async function retryTick(deps) {
  const now = deps.nowMs();
  const snap = await deps.db.collection('fiscalBiz').where('pendingCount', '>', 0).limit(BIZ_PER_TICK).get();
  let tried = 0, sent = 0;
  for (const d of snap.docs) {
    const bid = d.id, p = (d.data() || {}).pending || {};
    const due = Object.keys(p).filter(function (k) { return (p[k] || 0) <= now; }).sort(function (a, b) { return p[a] - p[b]; }).slice(0, RETRY_PER_RUN);
    for (const id of due) {
      tried++;
      const r = await retryDoc(deps, bid, id);
      if (r.status === 'sent') sent++;
    }
  }
  return { tried: tried, sent: sent };
}

/* ---------- ilova so'rovlari ---------- */
/* Savdo holati = amaldagi (oxirgi tahrir) versiya holati; ver — versiya hujjati */
async function curView(db, bid, id, d) {
  if (d && d.cur && d.cur !== id) { const c = await getData(fRef(db, bid, d.cur)); return Object.assign(pub(c || { status: 'pending' }), { ver: d.cur }); }
  return pub(d);
}
async function api(deps, caller, body) {
  if (!caller || !caller.bid) return { status: 403, body: { ok: false, code: 'forbidden' } };
  const bid = caller.bid, a = String((body && body.action) || '');
  const db = deps.db;
  const okId = function (x) { return typeof x === 'string' && x.length > 0 && x.length <= 100 && !/[\/]/.test(x); };
  if (a === 'send') {
    const s = body.sale;
    if (!s || !okId(s.id) || !Array.isArray(s.items)) return { status: 400, body: { ok: false, code: 'bad_sale' } };
    const stored = await getData(saleRef(db, bid, s.id));
    const sale = stored ? Object.assign({ id: s.id }, stored) : s;   // bulutdagi nusxa ustun
    if (sale.fx !== 1) return { status: 200, body: { ok: true, result: { status: 'skip' } } };
    const force = body.force === true;
    const res = await processSale(deps, bid, sale, { force: force });
    const b = await getData(fRef(db, bid, s.id));
    if (b && b.cur && b.cur !== s.id) {   // chek tahrirlangan — amaldagi versiya (avval eski versiyani qaytarish)
      const n = /~v(\d+)$/.exec(b.cur);
      if (n) { await retryDoc(deps, bid, s.id + '~r' + n[1], { force: force }); await retryDoc(deps, bid, b.cur, { force: force }); }
      return { status: 200, body: { ok: true, result: await curView(db, bid, s.id, await getData(fRef(db, bid, s.id))) } };
    }
    return { status: 200, body: { ok: true, result: res } };   // force — «Qayta yuborish» (yuborilgan chek baribir qayta ketmaydi)
  }
  if (a === 'status') {
    const ids = Array.isArray(body.ids) ? body.ids.filter(okId).slice(0, MAX_IDS) : [];
    const out = {};
    for (const id of ids) out[id] = await curView(db, bid, id, await getData(fRef(db, bid, id)));   // tahrirlangan chek — amaldagi versiya holati
    return { status: 200, body: { ok: true, map: out } };
  }
  if (a === 'open') {
    const snap = await fCol(db, bid).where('open', '==', true).limit(200).get();
    const list = snap.docs.map(function (d) { const x = d.data() || {}; return Object.assign({ id: d.id, receiptNo: x.receiptNo || '', saleId: x.saleId || null, entryId: x.entryId || null }, pub(x)); });
    return { status: 200, body: { ok: true, list: list } };
  }
  if (a === 'retry') {
    let ids = Array.isArray(body.ids) ? body.ids.filter(okId) : [];
    if (body.all) { const snap = await fCol(db, bid).where('open', '==', true).limit(RETRY_PER_RUN).get(); ids = snap.docs.map(function (d) { return d.id; }); }
    ids = ids.slice(0, RETRY_PER_RUN);
    const out = {}; let sent = 0;
    for (const id of ids) { out[id] = await retryDoc(deps, bid, id, { force: true }); if (out[id].status === 'sent') sent++; }
    return { status: 200, body: { ok: true, map: out, sent: sent, tried: ids.length } };
  }
  if (a === 'ping') {
    const biz = (await getData(db.collection('businesses').doc(bid))) || {};
    const pname = String(biz.fiscalProvider || '');
    const r = await provOf(deps, pname, biz).checkConnection();
    return { status: 200, body: { ok: true, result: r.ok ? { ok: true, provider: pname } : { ok: false, error: r.error, provider: pname } } };
  }
  return { status: 400, body: { ok: false, code: 'bad_action' } };
}

module.exports = { processSale, processRefund, processEditRefund, processVersion, processCreditPay, onSaleCreated, onSaleWritten, onSaleEdited, onSaleDeleted, onLedgerCreated, isCreditPay, retryDoc, retryTick, api, backoff, pub, productsFromItems, LOCK_MS };
