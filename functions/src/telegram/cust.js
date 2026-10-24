'use strict';
const { LANGS } = require('./texts');   /* fix183-custeasy */
/* fix155-custbot: mijoz boti 2-bosqich — mijoz o'z qarzi, limiti, bonusi, xaridlari va to'lovlarini botda ko'radi;
   chek va to'lov tasdig'i botga keladi; qarz eslatmalari; chek bo'yicha "to'g'ri / savolim bor".
   Ma'lumot (faqat server, Admin SDK):
     tgCustLink/{bid}_{cid}  — { uid, bid, cid, at, by: 'code'|'phone', notify: true/false, lastRemind }
     tgCust/{uid}.shops      — { bid: { cid, at } }   (tez topish uchun nusxa)
     tgPhone/{digits}        — { uid, at }           (tasdiqlangan raqam → chat)
   Himoya: mijoz faqat o'zi ulangan do'kon ma'lumotini ko'radi; ulash — do'kon bergan havola (3 kun) yoki tasdiqlangan
   (Telegram kontakt) raqam do'kon ro'yxatidagi raqamga mos kelsa. Do'kon egasi xabarlarni o'chira oladi; mijoz ham. */
const crypto = require('crypto');
const C = require('./custTexts');
const M = require('./msgs');
const S = require('./shopTexts');

const HOUR = 3600 * 1000, DAY = 24 * HOUR;
const LINK_TTL_MS = 3 * DAY;
const HIST_MAX = 30;
const REMIND_MIN_DAYS = 3;
const WEB_BASE = process.env.SAVDO_SHOP_WEB || 'https://savdo-pos.pages.dev/tgshop';

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function str(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n); }
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function ok(extra) { return { status: 200, body: Object.assign({ ok: true }, extra || {}) }; }
function err(status, code, extra) { return { status: status, body: Object.assign({ ok: false, code: code }, extra || {}) }; }
async function getData(ref) { const s = await ref.get(); return s && s.exists ? (s.data() || {}) : null; }
function phoneKey(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; }
function linkId(bid, cid) { return String(bid) + '_' + String(cid); }
function myUrl() { return WEB_BASE + '?v=my'; }
function myBtn(lang) { return { text: C.txt('btnMy', lang), web_app: { url: myUrl() } }; }
function tzOf(biz) { try { new Intl.DateTimeFormat('en-US', { timeZone: biz.timeZone }); return biz.timeZone; } catch (e) { return 'Asia/Tashkent'; } }
function fmtDT(ms, tz) {
  try { const p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; }); return p.day + '.' + p.month + '.' + p.year + ' ' + p.hour + ':' + p.minute; } catch (e) { return ''; }
}
async function send(deps, chatId, text, kb) {
  const p = { chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (kb) p.reply_markup = kb;
  try { await deps.tg('sendMessage', p); return true; } catch (e) { return false; }
}
async function shopOf(db, bid) {
  const b = (await getData(db.collection('businesses').doc(bid))) || {};
  return { biz: b, name: str(b.businessName || (b.settings && b.settings.businessName) || 'Savdo Pos', 80), cur: str(b.currency || 'UZS', 6), phone: str(b.businessPhone, 40), tz: tzOf(b) };
}
function custName(c) { return str((c && c.name) || '', 80) || '—'; }
async function custDoc(db, bid, cid) { return getData(db.collection('businesses').doc(bid).collection('customers').doc(String(cid))); }

/* ---------- ulash ---------- */
async function setLink(deps, uid, bid, cid, by, lang) {
  const db = deps.db, now = deps.nowMs();
  const lRef = db.collection('tgCustLink').doc(linkId(bid, cid)), cRef = db.collection('tgCust').doc(String(uid));
  const prev = await getData(lRef);
  await lRef.set(Object.assign({}, prev || {}, { uid: String(uid), bid: bid, cid: String(cid), at: (prev && prev.at) || now, by: by, notify: prev ? prev.notify !== false : true }));
  const cust = (await getData(cRef)) || {};
  const shops = Object.assign({}, cust.shops || {}); shops[bid] = { cid: String(cid), at: now };
  const na = Object.assign({}, cust.noAuto || {}); delete na[bid];   /* fix157-custuni */
  await cRef.set(Object.assign({}, cust, { shops: shops, noAuto: na, lang: cust.lang || lang }));
  return { prev: !!prev };
}
async function linkByCode(deps, msg, code, lang) {
  const db = deps.db, now = deps.nowMs(), uid = String(msg.from && msg.from.id || msg.chat.id);
  const core = require('./core');
  const ref = db.collection('tgCodes').doc(core.codeHash(core.normCode(code)));
  const c = await getData(ref);
  if (!c || c.kind !== 'cust' || !(c.exp > now) || (c.used && c.uid !== uid)) return { reply: C.txt('linkBad', lang) };
  await ref.set(Object.assign({}, c, { used: true, usedAt: now, uid: uid }));
  await setLink(deps, uid, c.bid, c.cid, 'code', lang);
  const s = await shopOf(db, c.bid);
  const cust = (await getData(db.collection('tgCust').doc(uid))) || {};
  const l = S.lg(cust.lang || lang);
  try { await deps.tg('setChatMenuButton', { chat_id: String(msg.chat.id), menu_button: { type: 'web_app', text: C.txt('btnMy', l).replace(/^\S+\s/, ''), web_app: { url: myUrl() } } }); } catch (e) {}
  await send(deps, msg.chat.id, C.txt('linked', l, { shop: esc(s.name) }), { inline_keyboard: [[myBtn(l)]] });
  return { custLinked: c.bid, cid: c.cid };
}
/* Tasdiqlangan raqam bo'yicha: mijoz muomala qilgan do'konlar (buyurtma bergan / katalog ochgan) ichida qidiriladi */
/* fix157-custuni: xalqaro raqam kaliti (debtLinks indeksi bilan bir xil: "998901234567") */
function intlKey(p) {
  const raw = String(p || '').trim(); let d = raw.replace(/\D/g, '');
  if (raw.indexOf('00') === 0) d = d.replace(/^00/, '');
  if (d.length === 9) d = '998' + d;
  return d.length >= 11 && d.length <= 15 ? d : '';
}
/* Ilovadagi «Mening qarzlarim» indeksi (debtLinks/{bid__cid}: phoneKey) — raqam qaysi do'konlarda mijoz ekanini beradi */
async function shopsByPhone(db, phone) {
  const key = intlKey(phone); if (!key) return [];
  let docs = []; try { docs = (await db.collection('debtLinks').where('phoneKey', '==', key).limit(50).get()).docs.map(function (x) { return x.data() || {}; }); } catch (e) { docs = []; }
  return docs.filter(function (l) { return l && l.bid && l.cid; });
}
function noAuto(cust, bid) { return !!(cust && cust.noAuto && cust.noAuto[bid]); }
/* Do'kon sotuv/to'lov yozganda: ulanmagan mijozning raqami botga raqam yuborgan odamniki bo'lsa — o'zi ulanadi */
async function autoLink(deps, bid, cid, cfg) {
  if (!cfg || cfg.custByPhone === false) return null;
  const db = deps.db;
  const c = await custDoc(db, bid, cid);
  if (!c || c.hidden || c._deleted) return null;
  const key = phoneKey(c.phone); if (!key) return null;
  const ph = await getData(db.collection('tgPhone').doc(key));
  if (!ph || !ph.uid) return null;
  const cust = (await getData(db.collection('tgCust').doc(String(ph.uid)))) || {};
  if (noAuto(cust, bid)) return null;
  await setLink(deps, ph.uid, bid, cid, 'phone', cust.lang || 'uz');
  try { const b = (await getData(db.collection('businesses').doc(bid))) || {}; await send(deps, ph.uid, C.txt('linked', S.lg(cust.lang), { shop: esc(str(b.businessName || 'Savdo Pos', 80)) }), { inline_keyboard: [[myBtn(S.lg(cust.lang))]] }); } catch (e) {}
  return linkFor(db, bid, cid);
}
async function matchByPhone(deps, uid, bids) {
  const db = deps.db, now = deps.nowMs();
  const cust = (await getData(db.collection('tgCust').doc(String(uid)))) || {};
  if (!cust.phoneOk || !cust.phone) return [];
  const key = phoneKey(cust.phone); if (!key) return [];
  try { await db.collection('tgPhone').doc(key).set({ uid: String(uid), at: now }); } catch (e) {}
  const out = [];
  const seen = {};
  /* fix157-custuni: avval indeks — raqam qaysi do'konlarda bo'lsa, hammasiga */
  const idx = await shopsByPhone(db, cust.phone);
  for (const l of idx) {
    const bid = String(l.bid);
    if (seen[bid] || (cust.shops && cust.shops[bid]) || noAuto(cust, bid)) continue;
    const cfg = await getData(db.collection('tgShop').doc(bid));
    if (cfg && cfg.custByPhone === false) continue;
    const c = await custDoc(db, bid, l.cid);
    if (!c || c.hidden || c._deleted || phoneKey(c.phone) !== key) continue;
    seen[bid] = 1;
    await setLink(deps, uid, bid, String(l.cid), 'phone', cust.lang || 'uz'); out.push({ bid: bid, cid: String(l.cid) });
  }
  for (const bid of (bids || []).slice(0, 10)) {
    if (!bid || seen[bid] || (cust.shops && cust.shops[bid]) || noAuto(cust, bid)) continue; seen[bid] = 1;
    const cfg = await getData(db.collection('tgShop').doc(bid));
    if (cfg && cfg.custByPhone === false) continue;
    let snap = null; try { snap = await db.collection('businesses').doc(bid).collection('customers').limit(4000).get(); } catch (e) { snap = null; }
    const docs = snap && snap.docs ? snap.docs : [];
    const hit = docs.map(function (d) { return d.data() || {}; }).find(function (c) { return c && c.id && !c.hidden && !c._deleted && phoneKey(c.phone) === key; });
    if (hit) { await setLink(deps, uid, bid, hit.id, 'phone', cust.lang || 'uz'); out.push({ bid: bid, cid: String(hit.id) }); }
  }
  return out;
}
async function shopsOfCust(deps, cust) {
  const set = {};
  Object.keys((cust && cust.shops) || {}).forEach(function (b) { set[b] = 1; });
  return set;
}
function recentBids(cust) {
  const s = {};
  (Array.isArray(cust && cust.recent) ? cust.recent : []).forEach(function (r) { if (r && r.bid) s[r.bid] = 1; });
  return Object.keys(s);
}

/* ---------- mini ilova (?v=my) ---------- */
async function debtInfo(db, bid, cid) {
  const c = await custDoc(db, bid, cid);
  if (!c || c.hidden || c._deleted) return null;
  const biz = (await getData(db.collection('businesses').doc(bid))) || {};
  const limit = num(c.creditLimit) || num(biz.defaultCreditLimit) || 0;
  return { name: custName(c), debt: num(c.debt), limit: limit, bonus: num(c.bonusBalance), loyalty: !!biz.loyaltyEnabled, since: c.createdAt || '' };
}
async function history(db, bid, cid, max) {
  const ref = db.collection('businesses').doc(bid);
  let sales = [], pays = [];
  try { const s = await ref.collection('sales').where('customerId', '==', String(cid)).limit(400).get(); sales = s.docs.map(function (d) { return d.data() || {}; }); } catch (e) { sales = []; }
  try { const l = await ref.collection('ledger').where('customerId', '==', String(cid)).limit(400).get(); pays = l.docs.map(function (d) { return d.data() || {}; }).filter(function (e) { return e.type === 'payment' && e.method; }); } catch (e) { pays = []; }
  const rows = sales.filter(function (s) { return s && !s.refunded && !s.cancelled; }).map(function (s) {
    return { k: 's', id: String(s.id || ''), no: s.receiptNumber || '', at: Date.parse(s.date) || 0, total: num(s.total), pay: payKind(s), credit: creditOf(s),
      items: (Array.isArray(s.items) ? s.items : []).slice(0, 40).map(function (it) { return { n: str(it.name, 80), q: num(it.qty), p: num(it.price), u: it.unit || 'dona' }; }) };
  }).concat(pays.map(function (e) { return { k: 'p', id: String(e.id || ''), at: Date.parse(e.date) || 0, total: num(e.amount), method: e.method, note: str(e.note, 120) }; }));
  rows.sort(function (a, b) { return b.at - a.at; });
  return rows.slice(0, max || HIST_MAX);
}
function creditOf(s) {
  if (Array.isArray(s.splitPayments) && s.splitPayments.length) return s.splitPayments.filter(function (p) { return p && p.method === 'credit'; }).reduce(function (a, p) { return a + num(p.amount); }, 0);
  return s.paymentType === 'credit' ? num(s.total) : 0;
}
function payKind(s) {
  if (Array.isArray(s.splitPayments) && s.splitPayments.filter(function (p) { return p && num(p.amount) > 0; }).length > 1) return 'mixed';
  return s.paymentType === 'credit' ? 'credit' : (s.paymentType === 'card' ? 'card' : 'cash');
}
async function handleMy(deps, u, action, body, lang) {
  const db = deps.db;
  const cRef = db.collection('tgCust').doc(String(u.id));
  let cust = (await getData(cRef)) || {};
  if (action === 'myHome') {
    if (cust.phoneOk) { const hits = await matchByPhone(deps, u.id, recentBids(cust).concat(cust.lastShop ? [await bidOfSlug(db, cust.lastShop)] : [])); if (hits.length) cust = (await getData(cRef)) || cust; }
    const shops = [];
    for (const bid of Object.keys(cust.shops || {}).slice(0, 10)) {
      const m = cust.shops[bid]; const link = await getData(db.collection('tgCustLink').doc(linkId(bid, m.cid)));
      if (!link || link.uid !== String(u.id)) continue;
      const s = await shopOf(db, bid); const d = await debtInfo(db, bid, m.cid);
      if (!d) continue;
      const cfg = (await getData(db.collection('tgShop').doc(bid))) || {};
      shops.push({ bid: bid, h: crypto.createHash('sha256').update('my|' + bid + '|' + u.id).digest('hex').slice(0, 12), name: s.name, phone: s.phone, cur: s.cur, slug: cfg.enabled && cfg.slug ? cfg.slug : '',
        me: d.name, debt: d.debt, limit: d.limit, bonus: d.bonus, loyalty: d.loyalty, notify: link.notify !== false });
    }
    return ok({ shops: shops, phoneOk: !!cust.phoneOk });
  }
  const h = str(body.h, 12);
  const bid = Object.keys(cust.shops || {}).find(function (b) { return crypto.createHash('sha256').update('my|' + b + '|' + u.id).digest('hex').slice(0, 12) === h; });
  if (!bid) return err(404, 'not_found');
  const cid = cust.shops[bid].cid;
  const link = await getData(db.collection('tgCustLink').doc(linkId(bid, cid)));
  if (!link || link.uid !== String(u.id)) return err(404, 'not_found');
  if (action === 'myHist') return ok({ rows: await history(db, bid, cid, HIST_MAX), cur: (await shopOf(db, bid)).cur });
  if (action === 'myNotify') { await db.collection('tgCustLink').doc(linkId(bid, cid)).set(Object.assign({}, link, { notify: body.on !== false })); return ok({ notify: body.on !== false }); }
  if (action === 'myUnlink') {
    await db.collection('tgCustLink').doc(linkId(bid, cid)).delete();
    const shops = Object.assign({}, cust.shops || {}); delete shops[bid];
    const na = Object.assign({}, cust.noAuto || {}); na[bid] = true;   /* fix157-custuni */
    await cRef.set(Object.assign({}, cust, { shops: shops, noAuto: na }));
    return ok({ removed: true });
  }
  return err(400, 'bad_action');
}
async function bidOfSlug(db, slug) { const m = slug ? await getData(db.collection('tgSlug').doc(String(slug))) : null; return m && m.bid ? String(m.bid) : ''; }

/* ---------- ilova (egasi) so'rovlari ---------- */
async function handleAppApi(deps, caller, uid, action, body) {
  const db = deps.db, now = deps.nowMs(), bid = caller.bid;
  const cid = str(body && body.customerId, 60);
  if (action === 'cuLink') {
    if (!cid) return err(400, 'bad_request');
    if (!deps.botName) return err(503, 'bot_unavailable');
    const core = require('./core');
    const code = 'C' + (deps.randCode || core.newCode)().slice(0, 9);
    await db.collection('tgCodes').doc(core.codeHash(code)).set({ kind: 'cust', bid: bid, cid: cid, by: uid, exp: now + LINK_TTL_MS, used: false, at: now });
    return ok({ url: 'https://t.me/' + deps.botName + '?start=c_' + code, exp: now + LINK_TTL_MS });
  }
  if (action === 'cuStatus') {
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 200).map(function (x) { return str(x, 60); }).filter(Boolean) : (cid ? [cid] : []);
    const out = {};
    for (const id of ids) { const l = await getData(db.collection('tgCustLink').doc(linkId(bid, id))); if (l && l.uid) out[id] = { at: l.at, by: l.by, notify: l.notify !== false, lastRemind: l.lastRemind || 0 }; }
    return ok({ links: out });
  }
  if (action === 'cuUnlink') {
    if (!cid) return err(400, 'bad_request');
    const l = await getData(db.collection('tgCustLink').doc(linkId(bid, cid)));
    if (l) { await db.collection('tgCustLink').doc(linkId(bid, cid)).delete(); const cRef = db.collection('tgCust').doc(String(l.uid)); const c = await getData(cRef); const sh = Object.assign({}, (c && c.shops) || {}); delete sh[bid]; const na = Object.assign({}, (c && c.noAuto) || {}); na[bid] = true; await cRef.set(Object.assign({}, c || {}, { shops: sh, noAuto: na }));   /* fix157-custuni */ }
    return ok({ removed: !!l });
  }
  if (action === 'cuRemind') {
    if (!cid) return err(400, 'bad_request');
    const r = await remindOne(deps, bid, cid, { force: true, text: str(body.text, 400) });
    if (r.code) return err(r.code === 'not_linked' ? 404 : 409, r.code);
    return ok({ sent: true });
  }
  return err(400, 'bad_action');
}

/* ---------- xabarlar: chek, to'lov, eslatma ---------- */
/* fix209-custdebt: xabardagi «jami qarz» — AMALDAN KEYINGI qarz.
   Ilova (yangi versiya) yozuvning o'ziga debtAfter qo'yadi — shu ishlatiladi (kutilmaydi).
   Eski ilova versiyasi: mijoz hujjatidagi qarz kutilgan qiymatga (oldingi ± summa) yetishini 3 soniyagacha kutamiz;
   yetmasa yoki boshqacha o'zgarsa — qarz qatori yozilmaydi (noto'g'ri raqam ko'rsatilmaydi). */
const DEBT_WAIT_MS = 3000, DEBT_STEP_MS = 500;
function waitMs(deps, ms) { return deps.sleep ? deps.sleep(ms) : new Promise(function (r) { setTimeout(r, ms); }); }
function hasDebtAfter(rec) { return !!rec && rec.debtAfter !== undefined && rec.debtAfter !== null && rec.debtAfter !== '' && isFinite(Number(rec.debtAfter)); }
async function debtAfterOp(deps, bid, cid, rec, delta) {
  if (hasDebtAfter(rec)) return Math.max(0, num(rec.debtAfter));
  const c0 = await custDoc(deps.db, bid, cid);
  if (!c0) return null;
  const d0 = num(c0.debt), want = Math.max(0, Math.round((d0 + delta) * 100) / 100);
  for (let waited = 0; waited < DEBT_WAIT_MS; waited += DEBT_STEP_MS) {
    await waitMs(deps, DEBT_STEP_MS);
    const c = await custDoc(deps.db, bid, cid); if (!c) return null;
    const d = num(c.debt);
    if (Math.abs(d - want) < 0.01) return d;
    if (Math.abs(d - d0) >= 0.01) return null;   // boshqacha o'zgardi (ketma-ket amallar) — xavfsiz tomonga: ko'rsatilmaydi
  }
  return null;
}
function dropDebtLine(text) { return text.split('\n').filter(function (ln) { return ln.indexOf('\u0000DEBT\u0000') === -1; }).join('\n'); }

async function linkFor(db, bid, cid) { const l = cid ? await getData(db.collection('tgCustLink').doc(linkId(bid, String(cid)))) : null; return l && l.uid && l.notify !== false ? l : null; }
async function langOf(db, uid) { const c = await getData(db.collection('tgCust').doc(String(uid))); return S.lg(c && c.lang); }
function itemsText(items, cur, l) {
  return (Array.isArray(items) ? items : []).slice(0, 25).map(function (it) {
    const q = num(it.qty), u = it.unit && it.unit !== 'dona' ? ' ' + esc(M.unitLabel(l, it.unit)) : '';
    return '• ' + esc(str(it.name, 60)) + ' × ' + (Number.isInteger(q) ? q : String(Math.round(q * 1000) / 1000).replace('.', ',')) + u + ' — ' + M.money(l, cur, num(it.price) * q);
  }).join('\n') + ((items || []).length > 25 ? '\n…' : '');
}
async function onSale(deps, bid, sale) {
  if (!deps.key || !deps.tg || !sale || !sale.customerId) return { skipped: 'no_cust' };
  const db = deps.db;
  const cfg = (await getData(db.collection('tgShop').doc(bid))) || {};
  if (cfg.custReceipts === false) return { skipped: 'off' };
  const link = (await linkFor(db, bid, sale.customerId)) || (await autoLink(deps, bid, String(sale.customerId), cfg));   /* fix157-custuni */
  if (!link) return { skipped: 'not_linked' };
  const t = Date.parse(sale.date); if (!isFinite(t) || t < deps.nowMs() - 12 * HOUR) return { skipped: 'old' };
  const s = await shopOf(db, bid), l = await langOf(db, link.uid);
  const credit = creditOf(sale), kind = payKind(sale);
  let pay = kind === 'mixed' ? C.txt('payMixed', l) : kind === 'card' ? C.txt('payCard', l) : kind === 'credit' ? '' : C.txt('payCash', l);
  if (credit > 0) pay = (pay ? pay + '\n' : '') + C.txt('payCredit', l, { sum: M.money(l, s.cur, credit) });
  let debt = '';
  if (credit > 0) { const da = await debtAfterOp(deps, bid, sale.customerId, sale, credit); if (da !== null) debt = C.txt('debtNow', l, { debt: M.money(l, s.cur, da) }); }   /* fix209-custdebt */
  const text = C.txt('receipt', l, { no: esc(sale.receiptNumber || ''), shop: esc(s.name), date: fmtDT(t, s.tz), items: itemsText(sale.items, s.cur, l), total: M.money(l, s.cur, num(sale.total)), pay: pay, debt: debt });
  const kb = credit > 0 ? { inline_keyboard: [[{ text: C.txt('btnOk', l), callback_data: 'cu:ok:' + bid + ':' + str(sale.id, 40) }, { text: C.txt('btnQ', l), callback_data: 'cu:q:' + bid + ':' + str(sale.id, 40) }]] } : null;
  const sent = await send(deps, link.uid, text, kb);
  return { sent: sent, credit: credit };
}
async function onLedger(deps, bid, entry) {
  if (!deps.key || !deps.tg || !entry || !entry.customerId) return { skipped: 'not_payment' };
  if (entry.type === 'sale' && !entry.saleId && num(entry.amount) > 0) return onManualDebt(deps, bid, entry);   /* fix158-custfull: qo'lda yozilgan qarz */
  if (entry.type !== 'payment' || !entry.method) return { skipped: 'not_payment' };
  const db = deps.db;
  const cfg = (await getData(db.collection('tgShop').doc(bid))) || {};
  if (cfg.custReceipts === false) return { skipped: 'off' };
  const link = (await linkFor(db, bid, entry.customerId)) || (await autoLink(deps, bid, String(entry.customerId), cfg));   /* fix157-custuni */
  if (!link) return { skipped: 'not_linked' };
  const t = Date.parse(entry.date); if (!isFinite(t) || t < deps.nowMs() - 12 * HOUR) return { skipped: 'old' };
  const s = await shopOf(db, bid), l = await langOf(db, link.uid);
  const debt = await debtAfterOp(deps, bid, entry.customerId, entry, -num(entry.amount));   /* fix209-custdebt: amaldan keyingi qarz */
  let text = C.txt('paid', l, { shop: esc(s.name), date: fmtDT(t, s.tz), sum: M.money(l, s.cur, num(entry.amount)), note: entry.note ? ' · ' + esc(str(entry.note, 80)) : '', debt: debt === null ? '\u0000DEBT\u0000' : M.money(l, s.cur, debt), thanks: debt !== null && debt <= 0 ? C.txt('paidAll', l) : '' });
  if (debt === null) text = dropDebtLine(text);
  return { sent: await send(deps, link.uid, text) };
}
/* fix158-custfull: ilovada mijoz kartasidan qo'lda qarz yozilganda (sotuvsiz) */
async function onManualDebt(deps, bid, entry) {
  const db = deps.db;
  const cfg = (await getData(db.collection('tgShop').doc(bid))) || {};
  if (cfg.custReceipts === false) return { skipped: 'off' };
  const link = (await linkFor(db, bid, entry.customerId)) || (await autoLink(deps, bid, String(entry.customerId), cfg));
  if (!link) return { skipped: 'not_linked' };
  const t = Date.parse(entry.date); if (!isFinite(t) || t < deps.nowMs() - 12 * HOUR) return { skipped: 'old' };
  const s = await shopOf(db, bid), l = await langOf(db, link.uid);
  const debt = await debtAfterOp(deps, bid, entry.customerId, entry, num(entry.amount));   /* fix209-custdebt: amaldan keyingi qarz */
  let text = C.txt('debtAdded', l, { shop: esc(s.name), date: fmtDT(t, s.tz), sum: M.money(l, s.cur, num(entry.amount)), note: entry.note ? ' · ' + esc(str(entry.note, 80)) : '', debt: debt === null ? '\u0000DEBT\u0000' : M.money(l, s.cur, debt) });
  if (debt === null) text = dropDebtLine(text);
  return { sent: await send(deps, link.uid, text, { inline_keyboard: [[myBtn(l)]] }), manualDebt: true };
}
async function remindOne(deps, bid, cid, opt) {
  opt = opt || {};
  const db = deps.db, now = deps.nowMs();
  const lRef = db.collection('tgCustLink').doc(linkId(bid, cid));
  const link = await getData(lRef);
  if (!link || !link.uid) return { code: 'not_linked' };
  if (link.notify === false) return { code: 'muted' };
  const c = await custDoc(db, bid, cid);
  if (!c || !(num(c.debt) > 0)) return { code: 'no_debt' };
  if (!opt.force && num(link.lastRemind) > now - REMIND_MIN_DAYS * DAY) return { code: 'too_soon' };
  const s = await shopOf(db, bid), l = await langOf(db, link.uid);
  const biz = s.biz, limit = num(c.creditLimit) || num(biz.defaultCreditLimit) || 0;
  const near = limit > 0 && num(c.debt) >= limit * 0.8;
  let text = C.txt('remind', l, { shop: esc(s.name), debt: M.money(l, s.cur, num(c.debt)), limit: near ? C.txt('remindLimit', l, { limit: M.money(l, s.cur, limit) }) : '', phone: s.phone ? C.txt('callShop', l, { p: esc(s.phone) }) : '' });
  if (opt.text) text += '\n\n💬 ' + esc(opt.text);
  const sent = await send(deps, link.uid, text);
  if (sent) await lRef.set(Object.assign({}, link, { lastRemind: now }));
  return sent ? { sent: true } : { code: 'send_failed' };
}
/* Har kuni (telegramTick, 10:00 atrofida): tgShop.debtRemind = { on, days, minDebt } bo'lgan do'konlar */
async function remindTick(deps, now) {
  const st = { shops: 0, sent: 0 };
  if (!deps.key || !deps.tg) return st;
  now = now || deps.nowMs();
  const db = deps.db;
  const snap = await db.collection('tgShop').limit(3000).get();
  for (const d of (snap && snap.docs ? snap.docs : [])) {
    const bid = d.id, cfg = d.data() || {}, dr = cfg.debtRemind || {};
    if (dr.on !== true) continue;
    const days = Math.max(REMIND_MIN_DAYS, Math.min(60, Math.round(num(dr.days)) || 7)), minDebt = num(dr.minDebt);
    if (num(dr.lastRun) > now - DAY + HOUR) continue;
    st.shops++;
    let links = []; try { links = (await db.collection('tgCustLink').where('bid', '==', bid).limit(2000).get()).docs.map(function (x) { return x.data() || {}; }); } catch (e) { links = []; }
    let n = 0;
    for (const l of links) {
      if (!l.cid || l.notify === false || num(l.lastRemind) > now - days * DAY) continue;
      const c = await custDoc(db, bid, l.cid);
      if (!c || !(num(c.debt) > 0) || num(c.debt) < minDebt) continue;
      if (c.lastSaleAt && Date.parse(c.lastSaleAt) > now - days * DAY) continue;
      const r = await remindOne(deps, bid, l.cid, { force: true });
      if (r.sent) n++;
    }
    try { await db.collection('tgShop').doc(bid).set(Object.assign({}, cfg, { debtRemind: Object.assign({}, dr, { lastRun: now }) })); } catch (e) {}
    if (n) {
      st.sent += n;
      try { const ctx = await require('./reports').loadCtx(deps, bid); for (const ch of ctx.chats) await send(deps, ch.id, C.txt('remindOwner', ch.lang || 'uz', { n: n, shop: esc(ctx.shop) })); } catch (e) {}
    }
  }
  return st;
}

/* ---------- tugmalar: to'g'ri / savol ---------- */
async function onCallback(deps, cq, lang) {
  const data = String((cq && cq.data) || '');
  const m = /^cu:(ok|q):([A-Za-z0-9_-]{1,60}):([A-Za-z0-9_-]{1,40})$/.exec(data);
  if (!m) return null;
  const db = deps.db, uid = String(cq.from && cq.from.id);
  const answer = async function (t) { try { await deps.tg('answerCallbackQuery', { callback_query_id: cq.id, text: t || '' }); } catch (e) {} };
  const bid = m[2], sid = m[3];
  const cust = (await getData(db.collection('tgCust').doc(uid))) || {};
  const map = cust.shops && cust.shops[bid];
  if (!map) { await answer(''); return { cb: 'not_linked' }; }
  const sale = await getData(db.collection('businesses').doc(bid).collection('sales').doc(sid));
  if (!sale || String(sale.customerId) !== String(map.cid)) { await answer(''); return { cb: 'not_found' }; }
  const l = S.lg(cust.lang || lang);
  const s = await shopOf(db, bid);
  const who = esc(custName(await custDoc(db, bid, map.cid)));
  if (m[1] === 'ok') {
    await answer(C.txt('okThanks', l));
    try { await deps.tg('editMessageReplyMarkup', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }); } catch (e) {}
    try { const ctx = await require('./reports').loadCtx(deps, bid); for (const ch of ctx.chats) await send(deps, ch.id, C.txt('okOwner', ch.lang || 'uz', { who: who, no: esc(sale.receiptNumber || '') })); } catch (e) {}
    return { cb: 'ok' };
  }
  await answer('');
  await db.collection('tgCust').doc(uid).set(Object.assign({}, cust, { askAbout: { bid: bid, sid: sid, no: sale.receiptNumber || '', at: deps.nowMs() } }));
  await send(deps, uid, C.txt('qAsk', l, { no: esc(sale.receiptNumber || '') }));
  return { cb: 'ask' };
}
/* Mijoz "savolim bor" dan keyin matn yozsa — egasiga */
async function onText(deps, msg, lang) {
  const text = str(msg.text, 500);
  if (!text || /^\//.test(text)) return null;
  const db = deps.db, uid = String(msg.from && msg.from.id || msg.chat.id);
  const cRef = db.collection('tgCust').doc(uid);
  const cust = await getData(cRef);
  const a = cust && cust.askAbout;
  if (!a || !a.bid || num(a.at) < deps.nowMs() - HOUR) return null;
  const map = cust.shops && cust.shops[a.bid];
  if (!map) return null;
  await cRef.set(Object.assign({}, cust, { askAbout: null }));
  const l = S.lg(cust.lang || lang);
  const s = await shopOf(db, a.bid);
  const who = esc(custName(await custDoc(db, a.bid, map.cid)));
  let n = 0;
  try { const ctx = await require('./reports').loadCtx(deps, a.bid); for (const ch of ctx.chats) { if (await send(deps, ch.id, C.txt('qOwner', ch.lang || 'uz', { who: who, no: esc(a.no), text: esc(text) }))) n++; } } catch (e) {}
  return { reply: C.txt('qSent', l, { shop: esc(s.name) }), custQ: a.sid, n: n };
}
/* fix158-custfull: raqam so'rash (bir bosishda kontakt) */
function phoneKb(l) { return { keyboard: [[{ text: C.txt('phoneBtn', l), request_contact: true }]], resize_keyboard: true, one_time_keyboard: true }; }
async function askPhone(deps, chatId, lang) {
  const cust = (await getData(deps.db.collection('tgCust').doc(String(chatId)))) || {};
  const l = S.lg(cust.lang || lang);
  await send(deps, chatId, C.txt('phoneAsk', l), phoneKb(l));
  return { askPhone: true };
}
/* /mening buyrug'i yoki "Mening sahifam" */
async function sendMy(deps, chatId, lang) {
  try { await custCommands(deps, chatId, S.lg(lang)); } catch (e) {}   /* fix183-custeasy */
  let cust = (await getData(deps.db.collection('tgCust').doc(String(chatId)))) || {};
  if (cust.phoneOk && cust.phone) { try { if ((await matchByPhone(deps, chatId, [])).length) cust = (await getData(deps.db.collection('tgCust').doc(String(chatId)))) || cust; } catch (e) {} }   /* fix157-custuni */
  const l = S.lg(cust.lang || lang);
  const has = cust.shops && Object.keys(cust.shops).length;
  if (!has && !cust.phoneOk) { await send(deps, chatId, C.txt('myNone', l) + '\n\n' + C.txt('phoneAsk', l), phoneKb(l)); return { my: false, askPhone: true }; }   /* fix158-custfull */
  await send(deps, chatId, has ? C.txt('myHint', l) : C.txt('phoneNone', l), { inline_keyboard: [[myBtn(l)]] });
  return { my: !!has };
}

/* fix183-custeasy: mijoz uchun doimiy pastki klaviatura va «/» menyusi */
/* fix209-custkb: pastki klaviatura tugmalari ODDIY MATN. Telegram klaviatura (reply) tugmasidan ochilgan mini ilovaga initData bermaydi —
   shu sabab «Buyurtma berish» / «Mening sahifam» ishlamasdi. Endi bosilganda bot xabar ichidagi (inline) tugma yuboradi — u initData beradi. */
const KB_V = 2;
function custKb(deps, cust, l) {
  const rows = [[{ text: C.txt('btnMy', l) }]];
  if (cust && (cust.lastShop || (cust.shops && Object.keys(cust.shops).length))) rows.push([{ text: C.txt('kbShop', l) }]);
  rows.push([{ text: C.txt('kbHelp', l) }, { text: C.txt('kbLang', l) }]);
  return { keyboard: rows, resize_keyboard: true, is_persistent: true };
}
function kbKind(text) {
  const t = String(text || '').trim(); if (!t) return null;
  for (const l of LANGS) { if (C.txt('kbHelp', l) === t) return 'help'; if (C.txt('kbLang', l) === t) return 'lang'; if (C.txt('btnMy', l) === t) return 'my'; if (C.txt('kbShop', l) === t) return 'shop'; }
  return null;
}
/* Buyurtma berish mumkin bo'lgan do'konlar: oxirgi ochilgani, mijoz bog'langanlari, yaqinda buyurtma berganlari (bot orqali sotuv yoqilganlari) */
async function shopChoices(deps, cust, pref) {
  const db = deps.db, out = [], seen = {};
  const add = async function (bid) {
    if (!bid || seen[bid] || out.length >= 8) return; seen[bid] = 1;
    const cfg = await getData(db.collection('tgShop').doc(bid));
    if (!cfg || !cfg.enabled || !cfg.slug) return;
    const b = await getData(db.collection('businesses').doc(bid));
    out.push({ bid: bid, slug: String(cfg.slug), name: str((b && (b.businessName || (b.settings && b.settings.businessName))) || cfg.slug, 40) });
  };
  if (pref) { await add(await bidOfSlug(db, pref)); if (out.length) return out; }
  if (cust.lastShop) await add(await bidOfSlug(db, cust.lastShop));
  const ids = Object.keys(cust.shops || {}).concat(recentBids(cust));
  for (let i = 0; i < ids.length; i++) await add(ids[i]);
  return out;
}
async function sendShops(deps, chatId, lang, pref) {
  const cust = (await getData(deps.db.collection('tgCust').doc(String(chatId)))) || {};
  const l = S.lg(cust.lang || lang);
  const list = await shopChoices(deps, cust, pref || '');
  const SH = require('./shop');
  if (!list.length) { await send(deps, chatId, C.txt('shopNone', l), custKb(deps, cust, l)); return { shops: 0 }; }
  if (list.length === 1) await send(deps, chatId, C.txt('shopOne', l, { shop: esc(list[0].name) }), { inline_keyboard: [[{ text: C.txt('kbShop', l), web_app: { url: SH.shopUrl(list[0].slug) } }]] });
  else await send(deps, chatId, C.txt('shopPick', l), { inline_keyboard: list.map(function (x) { return [{ text: '🛒 ' + x.name, web_app: { url: SH.shopUrl(x.slug) } }]; }) });
  return { shops: list.length };
}
/* Eski (web_app) klaviatura tugmasidan ochilgan sahifa initData'siz — sahifa Telegram.WebApp.sendData bilan botga signal yuboradi:
   bot to'g'ri (inline) tugmani yuboradi va klaviaturani yangisiga almashtiradi (bir marta). */
async function onWebAppData(deps, msg, lang) {
  const chatId = String(msg.chat.id);
  let d = {}; try { d = JSON.parse(String((msg.web_app_data && msg.web_app_data.data) || '').slice(0, 300)) || {}; } catch (e) { d = {}; }
  const ref = deps.db.collection('tgCust').doc(chatId);
  const cust = (await getData(ref)) || {};
  const l = S.lg(cust.lang || lang);
  const r = d.v === 'my' ? await sendMy(deps, chatId, l) : await sendShops(deps, chatId, l, typeof d.s === 'string' && /^[a-z0-9-]{2,40}$/i.test(d.s) ? d.s : '');
  if (cust.kbV !== KB_V && !(await isOwnerChat(deps, chatId))) {
    await send(deps, chatId, C.txt('kbUpdated', l), custKb(deps, cust, l));
    await ref.set({ kbV: KB_V }, { merge: true });
  }
  return Object.assign({ webAppData: d.v === 'my' ? 'my' : 'shop' }, r || {});
}
async function isOwnerChat(deps, chatId) {
  try { const ch = await getData(deps.db.collection('tgChats').doc(String(chatId))); return !!(ch && Array.isArray(ch.bids) && ch.bids.length); } catch (e) { return false; }
}
function custCmdList(l) {
  const n = require('./cmdTexts').names(l), D = require('./cmdTexts').T;
  const lg = LANGS.indexOf(l) !== -1 ? l : 'uz';
  return [{ command: n.my, description: '👤 ' + D.dMy[lg] }, { command: n.phone, description: '📱 ' + D.dPhone[lg] }, { command: n.lang, description: '🌐 ' + D.dLang[lg] }, { command: n.help, description: '❓ ' + D.dHelp[lg] }, { command: 'stop', description: '🔌 ' + C.txt('dStop', l) }];
}
async function custCommands(deps, chatId, l) {
  if (await isOwnerChat(deps, chatId)) return false;
  try { await deps.tg('setMyCommands', { commands: custCmdList(l), scope: { type: 'chat', chat_id: Number(chatId) } }); return true; } catch (e) { return false; }
}
/* /start (havolasiz) yoki tushunarsiz matn — ega bo'lmagan chat */
async function custStart(deps, chatId, lang) {
  const cust = (await getData(deps.db.collection('tgCust').doc(String(chatId)))) || {};
  const l = S.lg(cust.lang || lang);
  const has = !!(cust.phoneOk || (cust.shops && Object.keys(cust.shops).length));
  await custCommands(deps, chatId, l);
  if (has) { await send(deps, chatId, C.txt('custBack', l), custKb(deps, cust, l)); return { custStart: 'back' }; }
  await send(deps, chatId, C.txt('custStart', l), phoneKb(l));
  return { custStart: 'new', askPhone: true };
}
async function custHelp(deps, chatId, lang) {
  const cust = (await getData(deps.db.collection('tgCust').doc(String(chatId)))) || {};
  const l = S.lg(cust.lang || lang);
  await custCommands(deps, chatId, l);
  await send(deps, chatId, C.txt('custHelp', l), custKb(deps, cust, l));
  return { custHelp: true };
}
module.exports = { sendShops, shopChoices, onWebAppData, KB_V, debtAfterOp, custKb, kbKind, custStart, custHelp, custCommands, custCmdList, isOwnerChat, askPhone, phoneKb, shopsByPhone, autoLink, intlKey, linkByCode, matchByPhone, handleMy, handleAppApi, onSale, onLedger, remindOne, remindTick, onCallback, onText, sendMy, myBtn, myUrl, phoneKey, linkId, creditOf, payKind, LINK_TTL_MS };
