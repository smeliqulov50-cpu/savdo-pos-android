'use strict';
/* fix121-tg2: Telegram bot — 2-bosqich: xabarlar (har biri alohida yoqiladi, hammasi standart holatda O'CHIQ).
     1) kunlik hisobot — ega tanlagan alohida vaqtda (12:00–23:50, standart 21:00); har bir filial alohida + jami, top-5 tovar
     2) smena yopildi — kassir, smena summasi, kassadagi naqd farqi
     3) kam qolgan tovarlar — kuniga bir marta, ega tanlagan vaqtda (standart 09:00)
     4) katta chegirma — chek summasining ega belgilagan foizidan (standart 20%) ko'p, faqat XODIM bergan bo'lsa
     5) chek o'chirildi / qaytarildi — faqat XODIM qilgan bo'lsa
   Raqamlar ilovadagi va push "Kunlik xulosa"dagi formulalar bilan bir xil (src/push/dailyReport.js).
   Ma'lumot (faqat server):  tgPrefs/{bid} — sozlamalar;  tgSent/{bid} — kunlik belgilar, ogohlantirish kalitlari (takror yubormaslik), chegaralar.
   Sof mantiq: firebase kutubxonasiga bog'liq emas. deps = { db, tg, nowMs, key, cache?, sleep?, gapMs? } */
const core = require('./core');
const M = require('./msgs');
const DR = require('../push/dailyReport');

const MIN = 60 * 1000, HOUR = 60 * MIN;
const WINDOW_MIN = 120;              // belgilangan vaqtdan keyin shuncha daqiqa ichida yuboriladi (server kechiksa ham)
const RECENT_MS = 12 * HOUR;         // eski ma'lumot (zaxiradan tiklash) uchun ogohlantirish yuborilmaydi
const ALERTS_PER_HOUR = 40;
const TESTS_PER_HOUR = 12;
const DEF = { daily: false, dailyTime: '21:00', shift: false, low: false, lowTime: '09:00', disc: false, discPct: 20, rcpt: false, fisc: false };
const KINDS = ['daily', 'shift', 'low', 'disc', 'rcpt', 'fisc'];
const FT = require('./fiscalTexts');   /* fix189-fiscal6 */
const FX_TRIES = 3, FX_OLD_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TZ = 'Asia/Tashkent';

async function getData(ref) { const s = await ref.get(); return s && s.exists ? (s.data() || {}) : null; }
function okBody(extra) { return { status: 200, body: Object.assign({ ok: true }, extra || {}) }; }
function errBody(status, code) { return { status: status, body: { ok: false, code: code } }; }
function sleep(deps, ms) { return (deps.sleep || function (x) { return new Promise(function (r) { setTimeout(r, x); }); })(ms); }

/* ---------- sozlamalar ---------- */
function hmToMin(v) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(v == null ? '' : v)); if (!m) return null; const h = Number(m[1]), mi = Number(m[2]); if (h > 23 || mi > 59) return null; return h * 60 + mi; }
function minToHm(x) { return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); }
function clampTime(v, def, lo, hi) { let x = hmToMin(v); if (x == null) x = hmToMin(def); return minToHm(Math.max(lo, Math.min(hi, x))); }
function normPrefs(p) {
  p = (p && typeof p === 'object') ? p : {};
  const pct = Math.round(Number(p.discPct));
  return {
    daily: p.daily === true, dailyTime: clampTime(p.dailyTime, DEF.dailyTime, 12 * 60, 23 * 60 + 50),
    shift: p.shift === true,
    low: p.low === true, lowTime: clampTime(p.lowTime, DEF.lowTime, 0, 23 * 60 + 50),
    disc: p.disc === true, discPct: (isFinite(pct) && pct >= 1) ? Math.min(90, pct) : DEF.discPct,
    rcpt: p.rcpt === true,
    fisc: p.fisc === true   /* fix189-fiscal6: soliqqa yuborilmagan cheklar */
  };
}
async function getPrefs(deps, bid) {
  const c = deps.cache, now = deps.nowMs();
  if (c) { const h = c.get(bid); if (h && h.at > now - MIN) return h.p; }
  const p = normPrefs(await getData(deps.db.collection('tgPrefs').doc(bid)));
  if (c) { if (c.size > 5000) c.clear(); c.set(bid, { at: now, p: p }); }
  return p;
}

/* ---------- do'kon ma'lumoti ---------- */
function shopNameOf(b) { return String((b && (b.businessName || (b.settings && b.settings.businessName))) || 'Savdo Pos').slice(0, 80); }
async function loadCtx(deps, bid) {
  const db = deps.db;
  const res = await Promise.all([getData(db.collection('businesses').doc(bid)), getData(db.collection('tgBiz').doc(bid))]);
  const b = res[0] || {}, tb = res[1];
  const chats = deps.key ? core.validChats(deps.key, bid, tb) : [];
  const lang0 = M.lg(tb && tb.lang);
  /* fix144-tgcmd: chatda /til bilan tanlangan til bo'lsa — xabarlar o'sha tilda */
  for (let i = 0; i < chats.length; i++) {
    let ul = null;
    try { const ch = await getData(db.collection('tgChats').doc(chats[i].id)); ul = ch && ch.ulang; } catch (e) { ul = null; }
    chats[i].lang = M.LANGS.indexOf(ul) !== -1 ? ul : lang0;
  }
  return {
    biz: b, chats: chats, lang: lang0,
    tz: DR.validTz(b.timeZone) ? b.timeZone : DEFAULT_TZ, cur: b.currency || 'UZS', shop: shopNameOf(b),
    branches: Array.isArray(b.branches) ? b.branches.filter(function (x) { return x && x.id; }) : [],
    now: typeof deps.nowMs === 'function' ? deps.nowMs() : Date.now()   /* fix124-smart: avtomatik "kam qolgan" uchun */
  };
}
function multiBranch(ctx) { return ctx.branches.length > 1; }
/* fix144-tgcmd: ma'lumot bir marta hisoblanadi, filial nomi ("Bosh filial") har bir til uchun qayta yoziladi */
function inLang(ctx, l) { return Object.assign({}, ctx, { lang: M.lg(l) }); }
function relabel(arr, ctx, l) { const c = inLang(ctx, l); return (arr || []).map(function (x) { return Object.assign({}, x, { name: branchName(c, x.id) }); }); }
function dailyIn(d, ctx, l) { return Object.assign({}, d, { branches: relabel(d.branches, ctx, l) }); }
function lowIn(d, ctx, l) { return Object.assign({}, d, { groups: relabel(d.groups, ctx, l) }); }
function branchName(ctx, id) {
  const k = id || 'main';
  const f = ctx.branches.filter(function (x) { return x.id === k; })[0];
  if (f && f.name) return String(f.name).slice(0, 60);
  return k === 'main' ? M.W(ctx.lang).mainBranch : String(k).slice(0, 30);
}
function partsIn(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const o = {}; f.formatToParts(new Date(ms)).forEach(function (p) { if (p.type !== 'literal') o[p.type] = p.value; });
  return o;
}
function dmy(ms, tz) { const p = partsIn(ms, tz); return p.day + '.' + p.month + '.' + p.year; }
function hm(ms, tz) { const p = partsIn(ms, tz); return p.hour + ':' + p.minute; }
function dmyOfYmd(ymd) { const a = String(ymd).split('-'); return a[2] + '.' + a[1] + '.' + a[0]; }

/* ---------- Telegram'ga yuborish ---------- */
async function sendAll(deps, chats, text) {
  const r = { sent: 0, failed: 0, removed: 0 };
  const byLang = {};   /* fix144-tgcmd: text — funksiya bo'lsa har bir chat o'z tilida oladi */
  for (let i = 0; i < chats.length; i++) {
    const c = chats[i];
    let body = text;
    if (typeof text === 'function') { const l = c.lang || 'uz'; if (!(l in byLang)) byLang[l] = text(l); body = byLang[l]; }
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await deps.tg('sendMessage', { chat_id: c.id, text: body, parse_mode: 'HTML', disable_web_page_preview: true }); r.sent++; break; }
      catch (e) {
        if (e && e.tgCode === 429 && attempt === 0) { await sleep(deps, Math.min(10, Number(e.retryAfter) || 1) * 1000); continue; }
        const gone = e && (e.tgCode === 403 || (e.tgCode === 400 && /chat not found|deactivated|blocked/i.test(String(e.desc || e.message || ''))));
        if (gone) { try { await core.unbindChatEverywhere(deps, c.id); } catch (_e) {} r.removed++; } else r.failed++;
        break;
      }
    }
    if (deps.gapMs) await sleep(deps, deps.gapMs);
  }
  return r;
}
function addSt(st, r) { st.sent += r.sent; st.failed += r.failed; st.removed += r.removed; }

/* Bir xil hodisa ikki marta yuborilmasin + soatiga ko'pi bilan ALERTS_PER_HOUR ta ogohlantirish */
async function gate(deps, bid, key) {
  const db = deps.db, now = deps.nowMs(), ref = db.collection('tgSent').doc(bid);
  return db.runTransaction(async function (tx) {
    const s = await tx.get(ref); const d = s && s.exists ? (s.data() || {}) : {};
    const keys = Array.isArray(d.keys) ? d.keys : [];
    if (keys.indexOf(key) !== -1) return false;
    const win = (Array.isArray(d.win) ? d.win : []).filter(function (t) { return t > now - HOUR; });
    if (win.length >= ALERTS_PER_HOUR) return false;
    tx.set(ref, Object.assign({}, d, { keys: keys.concat([key]).slice(-200), win: win.concat([now]) }));
    return true;
  });
}
/* Kuniga bir marta (avval belgilanadi, keyin yuboriladi — ikki marta ketmasin) */
async function markOnce(deps, bid, field, ymd) {
  const db = deps.db, ref = db.collection('tgSent').doc(bid);
  return db.runTransaction(async function (tx) {
    const s = await tx.get(ref); const d = s && s.exists ? (s.data() || {}) : {};
    if (d[field] === ymd) return false;
    const upd = {}; upd[field] = ymd; upd[field + 'At'] = deps.nowMs();
    tx.set(ref, Object.assign({}, d, upd));
    return true;
  });
}

/* ---------- hisob-kitob ---------- */
function docsOf(snap) { return (snap && snap.docs ? snap.docs : []).map(function (d) { return d.data() || {}; }); }
async function computeDaily(db, bid, day, ctx) {
  const ref = db.collection('businesses').doc(bid);
  const range = function (col, f) { return ref.collection(col).where(f, '>=', day.startIso).where(f, '<', day.endIso).get(); };
  const res = await Promise.all([range('sales', 'date'), range('sales', 'refundedAt'), range('expenses', 'date'), range('ledger', 'date'), ref.collection('customers').get()]);
  const sales = docsOf(res[0]).filter(function (s) { return !s.refunded && Array.isArray(s.items); });
  const refunds = docsOf(res[1]).filter(function (s) { return s.refunded; });
  const exps = docsOf(res[2]).filter(function (x) { return x.category !== 'purchase'; });
  const pays = docsOf(res[3]).filter(function (e) { return e.type === 'payment' && e.method; });
  const br = {}, top = {};
  function B(id) { const k = id || 'main'; return (br[k] = br[k] || { id: k, revenue: 0, count: 0, profit: 0, expenses: 0 }); }
  let revenue = 0, profit = 0, cash = 0, card = 0, credit = 0;
  sales.forEach(function (s) {
    const t = Number(s.total) || 0, p = DR.saleProfit(s), b = DR.breakdown(s);
    revenue += t; profit += p; cash += b.cash || 0; card += b.card || 0; credit += b.credit || 0;
    const x = B(s.branchId); x.revenue += t; x.count++; x.profit += p;
    s.items.forEach(function (it) {
      if (!it) return;
      const nm = String(it.name || '—').slice(0, 80);
      const k = (it.productId || nm) + '|' + (it.variantId || '');
      const q = Number(it.qty) || 0;
      const o = (top[k] = top[k] || { name: nm, qty: 0, sum: 0 });
      o.qty += it.saleMode === 'box' ? q * (Number(it.unitsPerBox) || 1) : q;
      o.sum += (Number(it.price) || 0) * q;
      if (nm && nm.length < o.name.length) o.name = nm;   // "(quti)" kabi qo'shimchasiz nomi
    });
  });
  let expenses = 0;
  exps.forEach(function (x) { const a = Number(x.amount) || 0; expenses += a; B(x.branchId).expenses += a; });
  const debtPaid = pays.reduce(function (a, e) { return a + (Number(e.amount) || 0); }, 0);
  let totalDebt = 0;
  docsOf(res[4]).forEach(function (c) { if (!c.hidden && c.debt > 0) totalDebt += Number(c.debt) || 0; });
  const topArr = Object.keys(top).map(function (k) { return top[k]; }).filter(function (o) { return o.sum > 0 || o.qty > 0; })
    .sort(function (a, b) { return (b.sum - a.sum) || (b.qty - a.qty); }).slice(0, 5);
  const brArr = Object.keys(br).map(function (k) { const x = br[k]; x.name = branchName(ctx, x.id); return x; })
    .sort(function (a, b) { return (b.revenue - a.revenue) || a.name.localeCompare(b.name); }).slice(0, 12);
  return {
    count: sales.length, revenue: revenue, cash: cash, card: card, credit: credit, profit: profit, expenses: expenses, net: profit - expenses,
    debtPaid: debtPaid, refundCount: refunds.length, refundTotal: refunds.reduce(function (a, s) { return a + (Number(s.total) || 0); }, 0), totalDebt: totalDebt,
    top: topArr, branches: (multiBranch(ctx) || brArr.length > 1) ? brArr : []
  };
}
/* fix122-stock: ilovadagi stockStatus() bilan bir xil qoida — har bir variant alohida; qoldiq <= 0 tugagan, <= chegara kam qolgan;
   chegara 0 = faqat tugaganlar (eski versiyada saqlangan 0 — avvalgidek 5). */
function lowThresholdOf(biz) {
  const v = Number(biz && biz.lowStockThreshold);
  if (!isFinite(v) || v < 0) return 5;
  if (v === 0 && !(biz && biz.lowStockSetV2 === true)) return 5;
  return v;
}
/* fix124-smart: aqlli chegara — ilovadagi stockThresholdOf() bilan bir xil formula.
   Ustuvorlik: tovarning o'z minimumi (minStock) -> avtomatik (oxirgi 30 kun savdosi, N kunga yetmasa) -> bir xil son.
   Savdo tarixi 7 kundan kam yoki tovar sotilmagan bo'lsa — bir xil son. */
const SV_W = 30, SV_DAY = 86400000;
function lowModeOf(biz) { return (biz && biz.lowStockMode === 'auto') ? 'auto' : 'fixed'; }
function lowAutoDaysOf(biz) { const d = Number(biz && biz.lowStockAutoDays); return (isFinite(d) && d >= 1 && d <= 60) ? d : 3; }
function minStockOf(p) { if (!p || p.minStock === null || p.minStock === undefined || p.minStock === '') return null; const v = Number(p.minStock); return (isFinite(v) && v >= 0) ? v : null; }
function salesVel(sales, olderExists, now) {
  const from = now - SV_W * SV_DAY, first = {}, sold = {};
  sales.forEach(function (s) {
    if (!s) return;
    const t = Date.parse(s.date); if (!isFinite(t) || t < from) return;
    if (s.refunded) return;
    const b = s.branchId || 'main';
    if (!first[b] || t < first[b]) first[b] = t;
    (Array.isArray(s.items) ? s.items : []).forEach(function (it) {
      if (!it || !it.productId) return;
      const units = it.saleMode === 'box' ? (Number(it.qty) || 0) * (Number(it.unitsPerBox) || 1) : (Number(it.qty) || 0);
      const k = b + '|' + it.productId + (it.variantId ? ':' + it.variantId : '');
      sold[k] = (sold[k] || 0) + units;
    });
  });
  const hist = {};
  Object.keys(first).forEach(function (b) {
    const f = first[b];
    hist[b] = (olderExists && f - from <= 7 * SV_DAY) ? SV_W : Math.min(SV_W, Math.max(1, Math.ceil((now - f) / SV_DAY)));
  });
  return { sold: sold, hist: hist };
}
function unitThreshold(p, v, idx, mode, days, fixed, V) {
  const m = minStockOf(p);
  if (m !== null) return m;
  if (mode === 'auto' && V) {
    const b = p.branchId || 'main', hd = V.hist[b] || 0;
    if (hd >= 7) {
      let u = V.sold[b + '|' + p.id + (v ? ':' + v.id : '')] || 0;
      if (v && idx === 0) u += (V.sold[b + '|' + p.id] || 0);
      const vel = u / hd;
      if (vel > 0) return vel * days;
    }
  }
  return fixed;
}
async function computeLow(db, bid, ctx) {
  const ref = db.collection('businesses').doc(bid);
  const snap = await ref.collection('products').get();
  const th = lowThresholdOf(ctx.biz), mode = lowModeOf(ctx.biz), days = lowAutoDaysOf(ctx.biz);
  let V = null;
  if (mode === 'auto') {
    const now = typeof ctx.now === 'number' ? ctx.now : Date.now();
    const fromIso = new Date(now - SV_W * SV_DAY).toISOString();
    const res = await Promise.all([ref.collection('sales').where('date', '>=', fromIso).get(), ref.collection('sales').where('date', '<', fromIso).limit(1).get()]);
    V = salesVel(docsOf(res[0]), docsOf(res[1]).length > 0, now);
  }
  const groups = {};
  (snap && snap.docs ? snap.docs : []).map(function (d) { const x = d.data() || {}; return x.id ? x : Object.assign({ id: d.id }, x); }).forEach(function (p) {
    if (!p || p.hidden || p._deleted) return;
    const vs = (Array.isArray(p.variants) && p.variants.length) ? p.variants : [null];
    vs.forEach(function (v, idx) {
      const q = Number(v ? (v && v.stock) : p.stock) || 0;
      if (q > 0 && q > unitThreshold(p, v, idx, mode, days, th, V)) return;
      const k = p.branchId || 'main';
      const nm = v ? (String(p.name || '—') + ' — ' + String((v && v.name) || '')) : String(p.name || '—');
      (groups[k] = groups[k] || []).push({ name: nm.slice(0, 80), stock: q, unit: p.unit });
    });
  });
  const arr = Object.keys(groups).map(function (k) {
    return { id: k, name: branchName(ctx, k), items: groups[k].sort(function (a, b) { return (a.stock - b.stock) || a.name.localeCompare(b.name); }) };
  }).sort(function (a, b) { return a.id === 'main' ? -1 : b.id === 'main' ? 1 : a.name.localeCompare(b.name); });
  return { threshold: th, mode: mode, autoDays: days, groups: arr, multiBranch: multiBranch(ctx) };
}
function shiftCtx(ctx, sh, extra) {
  const o = Object.assign({ shop: ctx.shop, cur: ctx.cur }, extra || {});
  if (multiBranch(ctx)) o.branchName = branchName(ctx, sh.branchId);
  const a = Date.parse(sh.startTime), b = Date.parse(sh.endTime);
  if (isFinite(a) && isFinite(b)) {
    const sameDay = dmy(a, ctx.tz) === dmy(b, ctx.tz);
    o.timeRange = sameDay ? dmy(b, ctx.tz) + ' · ' + hm(a, ctx.tz) + ' – ' + hm(b, ctx.tz)
      : dmy(a, ctx.tz).slice(0, 5) + ' ' + hm(a, ctx.tz) + ' – ' + dmy(b, ctx.tz).slice(0, 5) + ' ' + hm(b, ctx.tz);
  }
  return o;
}
function discInfo(sale) {
  const da = Number(sale && sale.discountAmount) || 0;
  const base = Number(sale && sale.subtotal) > 0 ? Number(sale.subtotal) : (Number(sale && sale.total) || 0) + da;
  return { da: da, pct: base > 0 ? da * 100 / base : 0 };
}
function recent(deps, iso) { const t = Date.parse(iso); const now = deps.nowMs(); return isFinite(t) && t > now - RECENT_MS && t < now + 10 * MIN; }

/* ---------- jadval: har 10 daqiqada (kunlik hisobot va kam qolgan tovarlar) ---------- */
async function runTick(deps, now) {
  const st = { checked: 0, daily: 0, low: 0, noChats: 0, errors: 0, sent: 0, failed: 0, removed: 0 };
  if (!deps.key || !deps.tg) { st.noKey = true; return st; }
  now = now || new Date(deps.nowMs());
  const snap = await deps.db.collection('tgPrefs').where('sched', '==', true).get();
  const docs = snap && snap.docs ? snap.docs : [];
  for (let i = 0; i < docs.length; i++) {
    const bid = docs[i].id;
    st.checked++;
    try {
      const raw = docs[i].data() || {}, p = normPrefs(raw);
      const tz0 = DR.validTz(raw.tz) ? raw.tz : DEFAULT_TZ;
      const due = function (tz, on, time) { if (!on) return null; const day = DR.dayInfo(now, tz); const t = hmToMin(time); return (day.minutes >= t && day.minutes < t + WINDOW_MIN) ? day : null; };
      if (!due(tz0, p.daily, p.dailyTime) && !due(tz0, p.low, p.lowTime)) continue;   // vaqti kelmagan — boshqa hech narsa o'qilmaydi
      const ctx = await loadCtx(deps, bid);
      if (!ctx.chats.length) { st.noChats++; continue; }
      const dd = due(ctx.tz, p.daily, p.dailyTime);
      if (dd && await markOnce(deps, bid, 'daily', dd.ymd)) {
        const data = await computeDaily(deps.db, bid, dd, ctx);
        addSt(st, await sendAll(deps, ctx.chats, function (l) { return M.dailyText(l, dailyIn(data, ctx, l), { shop: ctx.shop, cur: ctx.cur, dateStr: dmyOfYmd(dd.ymd) }); }));
        st.daily++;
      }
      const dl = due(ctx.tz, p.low, p.lowTime);
      if (dl && await markOnce(deps, bid, 'low', dl.ymd)) {
        const data = await computeLow(deps.db, bid, ctx);
        addSt(st, await sendAll(deps, ctx.chats, function (l) { return M.lowText(l, lowIn(data, ctx, l), { shop: ctx.shop }); }));
        st.low++;
      }
    } catch (e) { st.errors++; try { console.error('telegramTick xatosi', bid, e && e.message); } catch (_e) {} }
  }
  return st;
}

/* ---------- fix189-fiscal6: soliqqa yuborilmagan cheklar (3 marta urinish yoki 24 soat navbatda) ----------
   Faqat ega yoqqan bizneslar (tgPrefs.fx == true). Har bir chek uchun bir marta xabar (tgSent.fxKeys). Bir xabarda hammasi. */
function fiscDue(om, now) {
  return Object.keys(om || {}).map(function (id) { const x = om[id] || {}; return ((x.a || 0) >= FX_TRIES || now - (x.t || now) >= FX_OLD_MS) ? { id: id, k: x.k || 'sale', n: x.n || '', e: x.e || '', a: x.a || 0, t: x.t || now } : null; })
    .filter(Boolean).sort(function (a, b) { return a.t - b.t; });
}
async function runFiscal(deps) {
  const st = { checked: 0, alerts: 0, sent: 0, failed: 0, removed: 0, errors: 0 };
  if (!deps.key || !deps.tg) { st.noKey = true; return st; }
  const now = deps.nowMs(), db = deps.db;
  const snap = await db.collection('tgPrefs').where('fx', '==', true).get();
  const docs = snap && snap.docs ? snap.docs : [];
  for (let i = 0; i < docs.length; i++) {
    const bid = docs[i].id; st.checked++;
    try {
      const q = await getData(db.collection('fiscalBiz').doc(bid));
      if (!q || !q.openCount) continue;                        // yuborilmagan chek yo'q — boshqa hech narsa o'qilmaydi
      const due = fiscDue(q.openMap, now);
      if (!due.length) continue;
      const ref = db.collection('tgSent').doc(bid);
      const pre = await getData(ref); const known = (pre && Array.isArray(pre.fxKeys)) ? pre.fxKeys : [];
      if (!due.some(function (x) { return known.indexOf(x.id) === -1; })) continue;
      const ctx = await loadCtx(deps, bid);
      if (!ctx.chats.length) continue;                         // chat ulanmagan — belgilanmaydi, ulanganda xabar boradi
      const go = await db.runTransaction(async function (tx) {
        const s = await tx.get(ref); const d = s && s.exists ? (s.data() || {}) : {};
        const keys = Array.isArray(d.fxKeys) ? d.fxKeys : [];
        const nw = due.filter(function (x) { return keys.indexOf(x.id) === -1; });
        if (!nw.length) return false;
        const win = (Array.isArray(d.win) ? d.win : []).filter(function (t) { return t > now - HOUR; });
        if (win.length >= ALERTS_PER_HOUR) return false;
        tx.set(ref, Object.assign({}, d, { fxKeys: keys.concat(nw.map(function (x) { return x.id; })).slice(-300), win: win.concat([now]) }));
        return true;
      });
      if (!go) continue;
      addSt(st, await sendAll(deps, ctx.chats, function (l) { return FT.fiscText(l, { items: due, total: due.length }, { shop: ctx.shop, now: now }); }));
      st.alerts++;
    } catch (e) { st.errors++; try { console.error('fiscalAlert xatosi', bid, e && e.message); } catch (_e) {} }
  }
  return st;
}

/* ---------- darhol ogohlantirishlar (Firestore hodisalari) ---------- */
async function handleSaleCreated(deps, bid, sid, sale) {
  if (!deps.key || !deps.tg) return { skipped: 'no_key' };
  if (!sale || !sale.cashierId) return { skipped: 'owner' };   // faqat xodim bergan chegirma
  const di = discInfo(sale);
  if (di.da <= 0) return { skipped: 'none' };
  if (!recent(deps, sale.date)) return { skipped: 'old' };
  const p = await getPrefs(deps, bid);
  if (!p.disc) return { skipped: 'off' };
  if (di.pct + 1e-9 < p.discPct) return { skipped: 'small' };
  const ctx = await loadCtx(deps, bid);
  if (!ctx.chats.length) return { skipped: 'no_chats' };
  if (!(await gate(deps, bid, 'sd:' + sid))) return { skipped: 'dup' };
  const r = await sendAll(deps, ctx.chats, function (l) {
    const o = { shop: ctx.shop, cur: ctx.cur, timeStr: hm(Date.parse(sale.date), ctx.tz) };
    if (multiBranch(ctx)) o.branchName = branchName(inLang(ctx, l), sale.branchId);
    return M.discText(l, { receiptNumber: sale.receiptNumber, discountAmount: di.da, pct: Math.round(di.pct), total: sale.total, cashierName: sale.cashierName }, o);
  });
  return Object.assign({ alert: 'disc' }, r);
}
async function handleAuditCreated(deps, bid, aid, entry) {
  if (!deps.key || !deps.tg) return { skipped: 'no_key' };
  if (!entry || (entry.action !== 'saleDelete' && entry.action !== 'saleRefund' && entry.action !== 'writeOff')) return { skipped: 'other' };   /* fix181-woalert */
  if (!entry.staffId) return { skipped: 'owner' };
  if (!recent(deps, entry.date)) return { skipped: 'old' };
  const p = await getPrefs(deps, bid);
  if (!p.rcpt) return { skipped: 'off' };
  const ctx = await loadCtx(deps, bid);
  if (!ctx.chats.length) return { skipped: 'no_chats' };
  if (!(await gate(deps, bid, 'au:' + aid))) return { skipped: 'dup' };
  const r = await sendAll(deps, ctx.chats, function (l) { return M.rcptText(l, { action: entry.action, detail: String(entry.detail || '').slice(0, 200), staffName: entry.staffName }, { shop: ctx.shop, timeStr: hm(Date.parse(entry.date), ctx.tz) }); });
  return Object.assign({ alert: entry.action }, r);
}
function newClosedShifts(deps, before, after) {
  const aft = after && Array.isArray(after.shifts) ? after.shifts : [];
  if (!aft.length) return [];
  const bef = {}; (before && Array.isArray(before.shifts) ? before.shifts : []).forEach(function (x) { if (x && x.id) bef[x.id] = 1; });
  return aft.filter(function (x) { return x && x.id && x.endTime && !bef[x.id] && recent(deps, x.endTime); }).slice(-5);
}
async function handleCatalogWrite(deps, bid, before, after) {
  if (!deps.key || !deps.tg) return { skipped: 'no_key' };
  const fresh = newClosedShifts(deps, before, after);
  if (!fresh.length) return { skipped: 'none' };            // ko'p yozuvlar shu yerda tugaydi — hech narsa o'qilmaydi
  const p = await getPrefs(deps, bid);
  if (!p.shift) return { skipped: 'off' };
  const ctx = await loadCtx(deps, bid);
  if (!ctx.chats.length) return { skipped: 'no_chats' };
  const st = { alert: 'shift', shifts: 0, sent: 0, failed: 0, removed: 0 };
  for (let i = 0; i < fresh.length; i++) {
    if (!(await gate(deps, bid, 'sh:' + fresh[i].id))) continue;
    const sh = fresh[i];
    addSt(st, await sendAll(deps, ctx.chats, function (l) { return M.shiftText(l, sh, shiftCtx(inLang(ctx, l), sh)); }));
    st.shifts++;
  }
  return st;
}

/* ---------- ilova so'rovlari: prefs (saqlash), test (hozir yuborib ko'rish). Faqat ega. ---------- */
async function readPrefsForStatus(deps, bid) { return normPrefs(await getData(deps.db.collection('tgPrefs').doc(bid))); }
async function actPrefs(deps, bid, body) {
  const p = normPrefs(body && body.prefs);
  const biz = (await getData(deps.db.collection('businesses').doc(bid))) || {};
  const doc = Object.assign({}, p, { sched: p.daily || p.low, fx: p.fisc, any: p.daily || p.low || p.shift || p.disc || p.rcpt || p.fisc, tz: DR.validTz(biz.timeZone) ? biz.timeZone : DEFAULT_TZ, at: deps.nowMs() });
  await deps.db.collection('tgPrefs').doc(bid).set(doc);
  if (deps.cache) deps.cache.delete(bid);
  return okBody({ prefs: p });
}
async function lastClosedShift(db, bid) {
  const c = await getData(db.collection('businesses').doc(bid).collection('meta').doc('catalog'));
  const arr = (c && Array.isArray(c.shifts) ? c.shifts : []).filter(function (x) { return x && x.endTime; });
  arr.sort(function (a, b) { return String(a.endTime).localeCompare(String(b.endTime)); });
  return arr.length ? arr[arr.length - 1] : null;
}
async function actTest(deps, bid, body) {
  const kind = String((body && body.kind) || '');
  if (KINDS.indexOf(kind) === -1) return errBody(400, 'bad_kind');
  if (!deps.tg) return errBody(503, 'bot_unavailable');
  const db = deps.db, now = deps.nowMs(), ref = db.collection('tgSent').doc(bid);
  const allowed = await db.runTransaction(async function (tx) {
    const s = await tx.get(ref); const d = s && s.exists ? (s.data() || {}) : {};
    const t = (Array.isArray(d.testTimes) ? d.testTimes : []).filter(function (x) { return x > now - HOUR; });
    if (t.length >= TESTS_PER_HOUR) return false;
    tx.set(ref, Object.assign({}, d, { testTimes: t.concat([now]) }));
    return true;
  });
  if (!allowed) return errBody(429, 'too_many');
  const ctx = await loadCtx(deps, bid);
  if (!ctx.chats.length) return errBody(409, 'no_chats');
  /* fix144-tgcmd: har bir chat o'z tilida — ma'lumot bir marta o'qiladi */
  let data = null, sh0 = null;
  if (kind === 'daily') data = { day: DR.dayInfo(new Date(now), ctx.tz) };
  if (kind === 'daily') data.d = await computeDaily(db, bid, data.day, ctx);
  if (kind === 'low') data = await computeLow(db, bid, ctx);
  if (kind === 'shift') sh0 = await lastClosedShift(db, bid);
  const text = function (l) {
    const w = M.W(l), cx = inLang(ctx, l);
    let text;
    if (kind === 'daily') {
      text = M.dailyText(l, dailyIn(data.d, ctx, l), { shop: ctx.shop, cur: ctx.cur, dateStr: dmyOfYmd(data.day.ymd), soFar: true, timeStr: hm(now, ctx.tz), test: true });
    } else if (kind === 'low') {
      text = M.lowText(l, lowIn(data, ctx, l), { shop: ctx.shop, test: true });
    } else if (kind === 'shift') {
      const sh = sh0 || { staffName: w.sampleCashier, startTime: new Date(now - 8 * HOUR).toISOString(), endTime: new Date(now).toISOString(),
        salesCount: 34, cashTotal: 1300000, cardTotal: 600000, creditTotal: 200000, expectedCash: 1450000, endCash: 1420000 };
      text = M.shiftText(l, sh, shiftCtx(cx, sh, { test: true }));
    } else if (kind === 'disc') {
      text = M.discText(l, { receiptNumber: '1001', discountAmount: 50000, pct: 25, total: 150000, cashierName: w.sampleCashier }, { shop: ctx.shop, cur: ctx.cur, timeStr: hm(now, ctx.tz), test: true });
    } else if (kind === 'fisc') {   /* fix189-fiscal6 */
      text = FT.fiscText(l, { items: [{ k: 'sale', n: '1001', a: 3, e: 'operator_busy', t: now - 2 * HOUR }, { k: 'refund', n: '998', a: 1, e: 'rejected: IKPU not found', t: now - 26 * HOUR }], total: 2 }, { shop: ctx.shop, now: now, test: true, testNote: w.testNote });
    } else {
      text = M.rcptText(l, { action: 'saleDelete', detail: '№ 1001 — ' + M.money(l, ctx.cur, 150000), staffName: w.sampleCashier }, { shop: ctx.shop, timeStr: hm(now, ctx.tz), test: true });
    }
    return text;
  };
  const r = await sendAll(deps, ctx.chats, text);
  return okBody({ sent: r.sent, failed: r.failed, removed: r.removed });
}
async function handleAction(deps, caller, action, body) {
  if (action === 'prefs') return actPrefs(deps, caller.bid, body);
  if (action === 'test') return actTest(deps, caller.bid, body);
  return errBody(400, 'bad_action');
}

module.exports = { runFiscal, fiscDue, FX_TRIES, FX_OLD_MS, loadCtx, inLang, dailyIn, lowIn, hm, dmy, dmyOfYmd, branchName, multiBranch, docsOf,   /* fix144-tgcmd */
  normPrefs, getPrefs, runTick, handleSaleCreated, handleAuditCreated, handleCatalogWrite, handleAction, readPrefsForStatus,
  computeDaily, computeLow, lowThresholdOf, lowModeOf, lowAutoDaysOf, minStockOf, salesVel, sendAll, gate, newClosedShifts, discInfo, DEF, KINDS, WINDOW_MIN, RECENT_MS, ALERTS_PER_HOUR, TESTS_PER_HOUR };
