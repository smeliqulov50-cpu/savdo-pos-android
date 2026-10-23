'use strict';
/* fix203-dash: super admin bosh sahifasi uchun statistika — serverda yig'iladi va adminStats/current ga yoziladi
   (panel har safar barcha bizneslarni yuklamaydi). Faqat obuna/hisob ma'lumotlari: savdo, mijoz, qarz o'qilmaydi. */
const { readExpiryMs, addMonths } = require('../domain/subscription');
const TZ_MS = 5 * 3600 * 1000;   // Toshkent: UTC+5 (yozgi vaqt yo'q)
const DAY = 86400000;
function dayStart(ms) { return Math.floor((ms + TZ_MS) / DAY) * DAY - TZ_MS; }
function monthKey(ms) { const d = new Date(ms + TZ_MS); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }
function monthStart(ms) { const d = new Date(ms + TZ_MS); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - TZ_MS; }
function mrrAt(payments, t) {
  let s = 0;
  payments.forEach(function (p) { const m = p.months > 0 ? p.months : 1; if (p.paidAtMs <= t && t < addMonths(p.paidAtMs, m)) s += p.amount / m; });
  return Math.round(s);
}
async function computeStats(db, nowMs, opts) {
  opts = opts || {};
  const bs = await db.collection('businesses').get();
  const ps = await db.collection('payments').get();
  const payments = ps.docs.map(function (d) { return d.data(); }).filter(function (p) { return p && p.status !== 'REFUNDED' && typeof p.amount === 'number' && typeof p.paidAtMs === 'number'; });
  const paidBiz = new Set(payments.map(function (p) { return p.businessId; }));
  const biz = bs.docs.map(function (d) { return { id: d.id, d: d.data() || {} }; });
  let created = {};
  if (opts.authTimes) { try { created = await opts.authTimes(biz.filter(function (b) { return !b.d.createdAtMs; }).map(function (b) { return b.id; })); } catch (e) { created = {}; } }
  const counts = { total: biz.length, paid: 0, trial: 0, expired: 0, unlimited: 0 };
  const expiring = []; let churn = 0, convBase = 0, conv = 0;
  const mStart = monthStart(nowMs);
  biz.forEach(function (b) {
    const exp = readExpiryMs(b.d), plan = b.d.subscriptionPlan || '';
    if (!exp) counts.unlimited++;
    else if (exp <= nowMs) counts.expired++;
    else if (plan === 'trial') counts.trial++;
    else counts.paid++;
    if (exp > nowMs && exp - nowMs <= 7 * DAY) expiring.push({ id: b.id, name: String(b.d.businessName || ''), phone: String(b.d.ownerPhone || b.d.businessPhone || ''), email: String(b.d.ownerEmail || ''), plan: plan, expMs: exp });
    if (exp) { if (paidBiz.has(b.id)) conv++; if (paidBiz.has(b.id) || exp <= nowMs || plan !== 'trial') convBase++; }
    if (paidBiz.has(b.id) && exp && exp <= nowMs && exp >= mStart) churn++;
    b.created = typeof b.d.createdAtMs === 'number' ? b.d.createdAtMs : (created[b.id] || 0);
  });
  expiring.sort(function (a, b) { return a.expMs - b.expMs; });
  const today = dayStart(nowMs);
  const daily = []; for (let i = 29; i >= 0; i--) daily.push(0);
  let sToday = 0, sWeek = 0, sMonth = 0;
  biz.forEach(function (b) {
    if (!b.created) return;
    const di = Math.floor((today - dayStart(b.created)) / DAY);
    if (di >= 0 && di < 30) daily[29 - di]++;
    if (b.created >= today) sToday++;
    if (b.created >= today - 6 * DAY) sWeek++;
    if (b.created >= mStart) sMonth++;
  });
  const months = []; { let t = monthStart(nowMs); for (let i = 0; i < 12; i++) { months.unshift(monthKey(t)); t = monthStart(t - DAY); } }
  const rev = {}; months.forEach(function (k) { rev[k] = 0; });
  payments.forEach(function (p) { const k = monthKey(p.paidAtMs); if (Object.prototype.hasOwnProperty.call(rev, k)) rev[k] += p.amount; });
  const mrr = mrrAt(payments, nowMs), mrrPrev = mrrAt(payments, nowMs - 30 * DAY);
  return {
    atMs: nowMs, mrr: mrr, mrrPrev: mrrPrev, mrrChangePct: mrrPrev > 0 ? Math.round((mrr - mrrPrev) / mrrPrev * 1000) / 10 : null,
    counts: counts, conversion: { base: convBase, paid: conv, pct: convBase ? Math.round(conv / convBase * 1000) / 10 : null }, churnMonth: churn,
    signups: { today: sToday, week: sWeek, month: sMonth, daily: daily, known: biz.filter(function (b) { return b.created; }).length },
    revenue12: months.map(function (k) { return { ym: k, sum: Math.round(rev[k]) }; }),
    expiring7: expiring.slice(0, 100), expiring7Count: expiring.length
  };
}
module.exports = { computeStats, mrrAt, monthKey, dayStart, monthStart };
