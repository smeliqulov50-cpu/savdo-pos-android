'use strict';
/* fix114-debts: Savdo Pos do'konlari orasidagi qarzlar.
   Qarz beruvchi (A do'kon) mijozni telefon raqami bilan yozadi — qarz, to'lov, nasiya cheklari faqat A ning o'z bazasida turadi
   va faqat A o'zgartira oladi. Qarzdor (B do'kon) o'z raqamini bir marta "bog'laydi"; shundan keyin B ning "Mening qarzlarim"
   sahifasida A dagi qarzi, to'lovlar tarixi va nasiya cheklari FAQAT KO'RISH uchun chiqadi.
   Ma'lumot faqat shu server (Admin SDK) orqali beriladi: debtLinks / debtPhoneClaims / debtPhoneOwners to'plamlariga ilova
   to'g'ridan-to'g'ri kira olmaydi (Firestore qoidalarida ruxsat yo'q — o'zgartirish ham shart emas).
   Himoya (SMS tasdiqlash yo'q — egasining qarori bilan):
     - bitta raqam faqat bitta biznesga bog'lanadi (birinchi bog'lagan); bo'shatish — egasi yoki superadmin;
     - raqam bog'lash urinishlari kuniga 10 ta, raqam almashtirish 30 kunda 3 marta (raqamlarni terib ko'rishning oldini oladi);
     - qarzdorga do'konning tannarxi (costPrice), xodim ismlari va boshqa ichki ma'lumotlar BERILMAYDI.
   Sof mantiq: firebase kutubxonasiga bog'liq emas (db, messaging tashqaridan beriladi), shuning uchun alohida sinaladi. */

const { sendToTokenDocs, fmtMoney } = require('../push/notify');

const COL_LINKS = 'debtLinks';
const COL_CLAIMS = 'debtPhoneClaims';
const COL_OWNERS = 'debtPhoneOwners';
const COL_META = 'debtIndexMeta';
const BACKFILL_V = 1;
const DAY = 86400000;
const MAX_ATTEMPTS_DAY = 10;
const MAX_LINKS_30D = 3;
const MAX_LIST = 100;
const MAX_LEDGER = 300;
const MAX_SALES = 100;

/* ---------- telefon raqami ---------- */
const CC_BY_CURRENCY = { UZS: '998', TJS: '992', KGS: '996', KZT: '7', RUB: '7' };
function ccOfCurrency(code) { return CC_BY_CURRENCY[code] || '998'; }
/* Raqamni solishtirish kaliti: faqat raqamlar, xalqaro ko'rinishda ("998901234567"). Yaroqsiz bo'lsa ''. */
function phoneKey(raw, cc) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  const intl = s.charAt(0) === '+' || s.indexOf('00') === 0;
  let d = s.replace(/\D/g, '');
  if (s.indexOf('00') === 0) d = d.replace(/^00/, '');
  if (!d) return '';
  cc = cc || '998';
  if (!intl) {
    if (cc === '7') {
      if (d.length === 10) d = '7' + d;
      else if (d.length === 11 && d.charAt(0) === '8') d = '7' + d.slice(1);
    } else {
      if (d.length === 9) d = cc + d;                                                   // 90 123 45 67
      else if (d.length === 10 && d.charAt(0) === '0') d = cc + d.slice(1);             // 0 90 123 45 67
      else if (cc === '998' && d.length === 10 && d.charAt(0) === '8') d = '998' + d.slice(1);   // eski: 8 90 123 45 67
    }
  }
  if (d.length < 11 || d.length > 15) return '';
  return d;
}

/* ---------- yordamchilar ---------- */
function num(v) { const n = Number(v); return isFinite(n) ? Math.round(n) : 0; }
function str(v, n) { const s = String(v == null ? '' : v); return s.length > n ? s.slice(0, n) : s; }
function custActive(c) { return !!c && !c._deleted && !c.hidden; }
function linkId(bid, cid) { return bid + '__' + cid; }
function okBody(extra) { return { status: 200, body: Object.assign({ ok: true }, extra || {}) }; }
function errBody(status, code) { return { status: status, body: { ok: false, code: code } }; }
function shopInfo(biz) {
  biz = biz || {};
  return {
    shop: str(biz.businessName || 'Savdo Pos', 80),
    shopPhone: str(biz.businessPhone || biz.ownerPhone || '', 40),
    shopAddress: str(biz.businessAddress || '', 160),
    currency: str(biz.currency || 'UZS', 6)
  };
}
function creditOfSale(s) {
  if (Array.isArray(s.splitPayments) && s.splitPayments.length) {
    return s.splitPayments.reduce(function (a, p) { return a + (p && p.method === 'credit' ? num(p.amount) : 0); }, 0);
  }
  return s.paymentType === 'credit' ? num(s.total) : 0;
}
async function getData(ref) { const s = await ref.get(); return s.exists ? (s.data() || {}) : null; }

/* ---------- push matni (qarzdor tomonga) ---------- */
const CUR_SYM = {
  UZS: { uz: "so'm", ru: 'сум', en: 'UZS' }, USD: { uz: '$', ru: '$', en: '$', before: true }, EUR: { uz: '€', ru: '€', en: '€', before: true },
  RUB: { uz: '₽', ru: '₽', en: '₽' }, KZT: { uz: '₸', ru: '₸', en: '₸' }, KGS: { uz: 'сом', ru: 'сом', en: 'som' }, TJS: { uz: 'смн', ru: 'смн', en: 'TJS' }
};
function money(n, cur, lang) {
  const c = CUR_SYM[cur] || CUR_SYM.UZS; const sym = c[lang] || c.uz;
  return c.before ? sym + fmtMoney(n) : fmtMoney(n) + ' ' + sym;
}
const PUSH_TEXT = {
  uz: {
    up: function (d, t) { return 'Yangi qarz yozildi: +' + d + '. Jami qarzingiz: ' + t; },
    down: function (d, t) { return 'Qarzingiz kamaydi: −' + d + '. Qolgan qarz: ' + t; },
    zero: function (d) { return 'Qarzingiz kamaydi: −' + d + '. Qarz to\'liq yopildi.'; }
  },
  ru: {
    up: function (d, t) { return 'Записан новый долг: +' + d + '. Ваш общий долг: ' + t; },
    down: function (d, t) { return 'Ваш долг уменьшился: −' + d + '. Остаток: ' + t; },
    zero: function (d) { return 'Ваш долг уменьшился: −' + d + '. Долг полностью погашен.'; }
  },
  en: {
    up: function (d, t) { return 'New debt recorded: +' + d + '. Your total debt: ' + t; },
    down: function (d, t) { return 'Your debt decreased: −' + d + '. Remaining: ' + t; },
    zero: function (d) { return 'Your debt decreased: −' + d + '. Debt fully paid.'; }
  }
};
function pushBody(lang, oldDebt, newDebt, cur) {
  const L = PUSH_TEXT[lang] ? lang : 'uz'; const T = PUSH_TEXT[L];
  const diff = newDebt - oldDebt;
  if (diff > 0) return T.up(money(diff, cur, L), money(Math.max(0, newDebt), cur, L));
  if (newDebt <= 0) return T.zero(money(-diff, cur, L));
  return T.down(money(-diff, cur, L), money(newDebt, cur, L));
}

/* ---------- 1) Mijoz yozuvi o'zgarganda (Firestore trigger): bog'lanish indeksi + qarzdorga push ---------- */
async function handleCustomerWrite(deps, bid, cid, before, after) {
  const db = deps.db; const now = deps.nowMs();
  const b = before || null, a = after || null;
  const debtA = a ? num(a.debt) : 0, debtB = b ? num(b.debt) : 0;
  const relevant = (!b && !!a) || (!!b && !a) ||
    (b && a && (String(b.phone || '') !== String(a.phone || '') || !!b.hidden !== !!a.hidden || !!b._deleted !== !!a._deleted ||
      String(b.name || '') !== String(a.name || '') || debtA !== debtB));
  if (!relevant) return { skipped: 'same' };
  if (!(a && a.phone) && !(b && b.phone)) return { skipped: 'nophone' };
  const biz = await getData(db.collection('businesses').doc(bid)) || {};
  const cc = ccOfCurrency(biz.currency);
  const keyA = custActive(a) ? phoneKey(a.phone, cc) : '';
  const linkRef = db.collection(COL_LINKS).doc(linkId(bid, cid));
  const out = { link: '', pushed: 0 };
  if (keyA) {
    await linkRef.set({ bid: bid, cid: cid, phoneKey: keyA, name: str(a.name, 80), at: now }, { merge: true });
    out.link = 'set';
  } else {
    await linkRef.delete();
    out.link = 'del';
  }
  /* qarz o'zgardi -> raqami bog'langan qarzdor biznesga push (o'zini o'ziga emas) */
  if (keyA && debtA !== debtB && (b || debtA > 0) && deps.messaging) {
    const claim = await getData(db.collection(COL_CLAIMS).doc(keyA));
    if (claim && claim.bid && claim.bid !== bid) {
      const snap = await db.collection('businesses').doc(claim.bid).collection('pushTokens').get();
      const toks = snap.docs.map(function (d) { const x = d.data() || {}; return { token: x.token || d.id, sound: x.sound, admin: x.admin, lang: x.lang, ref: d.ref }; })
        .filter(function (t) { return t.admin === true; });
      const groups = {};
      toks.forEach(function (t) { const l = PUSH_TEXT[t.lang] ? t.lang : 'uz'; (groups[l] = groups[l] || []).push(t); });
      const info = shopInfo(biz);
      const langs = Object.keys(groups);
      for (let i = 0; i < langs.length; i++) {
        const r = await sendToTokenDocs(deps.messaging, groups[langs[i]], {
          title: info.shop, body: pushBody(langs[i], debtB, debtA, info.currency), channel: 'reminders',
          data: { type: 'sharedDebt', bid: bid, cid: cid }
        });
        out.pushed += r.sent;
      }
    }
  }
  return out;
}

/* ---------- 2) Bir martalik to'ldirish: server qo'yilishidan oldingi mijozlar ham indeksga tushsin ---------- */
async function runBackfill(deps) {
  const db = deps.db;
  const metaRef = db.collection(COL_META).doc('_global');
  const m = await getData(metaRef);
  if (m && num(m.v) >= BACKFILL_V) return { skipped: true };
  const st = { businesses: 0, customers: 0, links: 0 };
  const refs = await db.collection('businesses').listDocuments();
  let batch = db.batch(), n = 0;
  for (let i = 0; i < refs.length; i++) {
    const bizRef = refs[i];
    const biz = await getData(bizRef) || {};
    const cc = ccOfCurrency(biz.currency);
    const cs = await bizRef.collection('customers').get();
    st.businesses++;
    for (let j = 0; j < cs.docs.length; j++) {
      const doc = cs.docs[j]; const c = doc.data() || {};
      st.customers++;
      if (!custActive(c)) continue;
      const key = phoneKey(c.phone, cc);
      if (!key) continue;
      batch.set(db.collection(COL_LINKS).doc(linkId(bizRef.id, doc.id)), { bid: bizRef.id, cid: doc.id, phoneKey: key, name: str(c.name, 80), at: deps.nowMs() }, { merge: true });
      st.links++; n++;
      if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
  }
  if (n) await batch.commit();
  await metaRef.set({ v: BACKFILL_V, at: deps.nowMs(), stats: st });
  return st;
}

/* ---------- 3) Ilova so'rovlari (HTTP) ---------- */
async function resolveCaller(db, uid) {
  if (!uid) return null;
  const sa = await getData(db.collection('staffAuth').doc(uid));
  if (sa) {   // xodim: biznes va huquqlar serverdagi yozuvdan
    if (!sa.businessId || typeof sa.businessId !== 'string') return null;
    const admin = sa.role === 'admin';
    const perms = sa.permissions || {};
    return { bid: sa.businessId, owner: false, admin: admin, canView: admin || perms.myDebts === true };
  }
  return { bid: uid, owner: true, admin: true, canView: true };   // ega: uid = biznes ID (ilovadagi bilan bir xil qoida)
}
async function claimOf(db, bid) {
  const o = await getData(db.collection(COL_OWNERS).doc(bid));
  if (!o || !o.key) return null;
  const c = await getData(db.collection(COL_CLAIMS).doc(o.key));
  if (!c || c.bid !== bid) return null;
  return { key: o.key, phone: o.phone || ('+' + o.key), at: o.at || null };
}

async function actStatus(deps, caller) {
  const cl = await claimOf(deps.db, caller.bid);
  return okBody({ linked: !!cl, phone: cl ? cl.phone : '', since: cl ? cl.at : null, canLink: caller.admin });
}

async function actLink(deps, caller, body) {
  const db = deps.db; const now = deps.nowMs();
  if (!caller.admin) return errBody(403, 'forbidden');
  const biz = await getData(db.collection('businesses').doc(caller.bid));
  if (!biz) return errBody(403, 'no_business');
  const key = phoneKey(body.phone, ccOfCurrency(biz.currency));
  if (!key) return errBody(400, 'invalid_phone');
  const ownerRef = db.collection(COL_OWNERS).doc(caller.bid);
  const claimRef = db.collection(COL_CLAIMS).doc(key);
  return db.runTransaction(async function (tx) {
    const os = await tx.get(ownerRef); const o = os.exists ? (os.data() || {}) : {};
    const cs = await tx.get(claimRef); const c = cs.exists ? (cs.data() || {}) : null;
    let oldClaim = null, oldRef = null;
    if (o.key && o.key !== key) { oldRef = db.collection(COL_CLAIMS).doc(o.key); const s = await tx.get(oldRef); oldClaim = s.exists ? (s.data() || {}) : null; }
    const attempts = (Array.isArray(o.attempts) ? o.attempts : []).filter(function (t) { return now - t < DAY; });
    const links = (Array.isArray(o.links) ? o.links : []).filter(function (t) { return now - t < 30 * DAY; });
    if (c && c.bid === caller.bid && o.key === key) return okBody({ linked: true, phone: '+' + key, since: o.at || null, same: true });
    if (attempts.length >= MAX_ATTEMPTS_DAY) return errBody(429, 'rate');
    attempts.push(now);
    if (c && c.bid && c.bid !== caller.bid) {
      tx.set(ownerRef, { attempts: attempts.slice(-20) }, { merge: true });
      return errBody(409, 'taken');
    }
    if (links.length >= MAX_LINKS_30D) {
      tx.set(ownerRef, { attempts: attempts.slice(-20) }, { merge: true });
      return errBody(429, 'rate_links');
    }
    links.push(now);
    if (oldRef && oldClaim && oldClaim.bid === caller.bid) tx.delete(oldRef);
    tx.set(claimRef, { bid: caller.bid, phone: '+' + key, at: now });
    tx.set(ownerRef, { key: key, phone: '+' + key, at: now, attempts: attempts.slice(-20), links: links.slice(-10) }, { merge: true });
    return okBody({ linked: true, phone: '+' + key, since: now });
  });
}

async function actUnlink(deps, caller) {
  const db = deps.db;
  if (!caller.admin) return errBody(403, 'forbidden');
  const ownerRef = db.collection(COL_OWNERS).doc(caller.bid);
  return db.runTransaction(async function (tx) {
    const os = await tx.get(ownerRef); const o = os.exists ? (os.data() || {}) : {};
    if (!o.key) return okBody({ linked: false });
    const ref = db.collection(COL_CLAIMS).doc(o.key);
    const cs = await tx.get(ref); const c = cs.exists ? (cs.data() || {}) : null;
    if (c && c.bid === caller.bid) tx.delete(ref);
    tx.set(ownerRef, { key: null, phone: null }, { merge: true });
    return okBody({ linked: false });
  });
}

async function actList(deps, caller) {
  const db = deps.db;
  if (!caller.canView) return errBody(403, 'forbidden');
  const cl = await claimOf(db, caller.bid);
  if (!cl) return okBody({ linked: false, items: [] });
  const snap = await db.collection(COL_LINKS).where('phoneKey', '==', cl.key).limit(MAX_LIST).get();
  const links = snap.docs.map(function (d) { return d.data() || {}; }).filter(function (l) { return l.bid && l.cid && l.bid !== caller.bid; });
  const bizCache = {};
  const items = await Promise.all(links.map(async function (l) {
    if (!bizCache[l.bid]) bizCache[l.bid] = getData(db.collection('businesses').doc(l.bid));
    const biz = await bizCache[l.bid];
    const c = await getData(db.collection('businesses').doc(l.bid).collection('customers').doc(l.cid));
    if (!biz || !custActive(c)) return null;
    if (phoneKey(c.phone, ccOfCurrency(biz.currency)) !== cl.key) return null;   // raqam o'zgargan (indeks hali yangilanmagan)
    const s = shopInfo(biz);
    return { bid: l.bid, cid: l.cid, shop: s.shop, shopPhone: s.shopPhone, currency: s.currency, debt: num(c.debt), name: str(c.name, 80), updatedAt: num(c._u) || null };
  }));
  const list = items.filter(Boolean).sort(function (x, y) { return (y.debt - x.debt) || String(x.shop).localeCompare(String(y.shop)); });
  return okBody({ linked: true, phone: cl.phone, items: list });
}

async function actDetail(deps, caller, body) {
  const db = deps.db;
  if (!caller.canView) return errBody(403, 'forbidden');
  const cb = str(body.bid, 128), cid = str(body.cid, 128);
  if (!cb || !cid || cb.indexOf('/') !== -1 || cid.indexOf('/') !== -1 || cb.indexOf('__') !== -1) return errBody(400, 'bad_request');
  const cl = await claimOf(db, caller.bid);
  if (!cl) return errBody(403, 'not_linked');
  if (cb === caller.bid) return errBody(403, 'forbidden');
  const link = await getData(db.collection(COL_LINKS).doc(linkId(cb, cid)));
  if (!link || link.phoneKey !== cl.key) return errBody(403, 'forbidden');
  const bizRef = db.collection('businesses').doc(cb);
  const biz = await getData(bizRef);
  const c = await getData(bizRef.collection('customers').doc(cid));
  if (!biz || !custActive(c) || phoneKey(c.phone, ccOfCurrency(biz.currency)) !== cl.key) return errBody(403, 'forbidden');
  const [ls, ss] = await Promise.all([
    bizRef.collection('ledger').where('customerId', '==', cid).limit(1000).get(),
    bizRef.collection('sales').where('customerId', '==', cid).limit(1000).get()
  ]);
  const ledger = ls.docs.map(function (d) { const l = d.data() || {}; return { id: str(l.id || d.id, 64), date: str(l.date, 40), type: str(l.type, 20), amount: num(l.amount), note: str(l.note, 200), method: str(l.method, 20) }; })
    .filter(function (l) { return l.date && l.amount; })
    .sort(function (x, y) { return y.date < x.date ? -1 : (y.date > x.date ? 1 : 0); }).slice(0, MAX_LEDGER);
  const sales = ss.docs.map(function (d) { const s = d.data() || {}; return { s: s, id: d.id }; })
    .filter(function (x) { return creditOfSale(x.s) > 0; })
    .map(function (x) {
      const s = x.s;
      const items = (Array.isArray(s.items) ? s.items : []).slice(0, 200).map(function (it) { return { name: str(it && it.name, 120), qty: Number(it && it.qty) || 0, price: num(it && it.price) }; });
      return { id: str(s.id || x.id, 64), date: str(s.date, 40), no: str(s.receiptNumber, 20), total: num(s.total), credit: creditOfSale(s), discount: num(s.discountAmount), refunded: !!s.refunded, items: items };
    })
    .sort(function (x, y) { return y.date < x.date ? -1 : (y.date > x.date ? 1 : 0); }).slice(0, MAX_SALES);
  const info = shopInfo(biz);
  return okBody(Object.assign(info, { bid: cb, cid: cid, debt: num(c.debt), name: str(c.name, 80), updatedAt: num(c._u) || null, ledger: ledger, sales: sales }));
}

async function actAdminRelease(deps, body) {
  const db = deps.db;
  const key = phoneKey(body.phone, '998');
  if (!key) return errBody(400, 'invalid_phone');
  const claimRef = db.collection(COL_CLAIMS).doc(key);
  return db.runTransaction(async function (tx) {
    const cs = await tx.get(claimRef); const c = cs.exists ? (cs.data() || {}) : null;
    if (!c) return okBody({ released: false, phone: '+' + key });
    let oref = null, o = null;
    if (c.bid) { oref = db.collection(COL_OWNERS).doc(c.bid); const s = await tx.get(oref); o = s.exists ? (s.data() || {}) : null; }
    tx.delete(claimRef);
    if (oref && o && o.key === key) tx.set(oref, { key: null, phone: null }, { merge: true });
    return okBody({ released: true, phone: '+' + key, bid: c.bid || '' });
  });
}

async function handleRequest(deps, uid, body) {
  body = (body && typeof body === 'object') ? body : {};
  const action = str(body.action, 20);
  if (!uid) return errBody(401, 'unauthenticated');
  if (action === 'adminRelease') {
    if (!deps.superUid || uid !== deps.superUid) return errBody(403, 'forbidden');
    return actAdminRelease(deps, body);
  }
  const caller = await resolveCaller(deps.db, uid);
  if (!caller) return errBody(403, 'forbidden');
  if (action === 'status') return actStatus(deps, caller);
  if (action === 'link') return actLink(deps, caller, body);
  if (action === 'unlink') return actUnlink(deps, caller);
  if (action === 'list') return actList(deps, caller);
  if (action === 'detail') return actDetail(deps, caller, body);
  return errBody(400, 'bad_action');
}

module.exports = { phoneKey, ccOfCurrency, handleCustomerWrite, runBackfill, handleRequest, resolveCaller, pushBody, creditOfSale,
  COL_LINKS, COL_CLAIMS, COL_OWNERS, COL_META };
