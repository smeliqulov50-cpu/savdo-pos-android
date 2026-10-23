'use strict';
/* DOMAIN: tariflar. Narx va muddat FAQAT serverda belgilanadi —
   mijoz (brauzer) yuborgan summaga hech qachon ishonilmaydi.
   Kalitlar ilovadagi mavjud tarif kalitlari bilan bir xil (monthly/sixmonth/yearly),
   shuning uchun ilovaning eski mantiqi (masalan tarix oynasi) buzilmaydi.

   fix203-plans: narxlar BITTA manbada — Firestore config/plans (faqat superadmin, adminApi orqali yozadi).
   Hujjat yo'q yoki buzilgan bo'lsa — pastdagi PLANS (zaxira) ishlatiladi.
   To'lov doim BUYURTMA yaratilgan paytdagi summa bilan yakunlanadi (order.amount / order.months). */

const PLANS = Object.freeze({
  monthly:  Object.freeze({ key: 'monthly',  months: 1,  price: 70000 }),
  sixmonth: Object.freeze({ key: 'sixmonth', months: 6,  price: 420000 }),
  yearly:   Object.freeze({ key: 'yearly',   months: 12, price: 840000 })
});

const PROVIDERS = Object.freeze(['payme', 'click']);
const PLAN_KEYS = Object.freeze(['monthly', 'sixmonth', 'yearly']);
const LANGS = Object.freeze(['uz', 'ru', 'en', 'kk', 'ky', 'tg']);
const LIMITS = Object.freeze({ minPrice: 1000, maxPrice: 100000000, minMonths: 1, maxMonths: 36, maxName: 40 });
const CACHE_MS = 30 * 1000;

function getPlan(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(PLANS, key) ? PLANS[key] : null;
}
function isProvider(p) {
  return typeof p === 'string' && PROVIDERS.indexOf(p) !== -1;
}
function isInt(v, lo, hi) { return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi; }

function defaults() {
  const out = {};
  PLAN_KEYS.forEach(function (k, i) {
    out[k] = { key: k, months: PLANS[k].months, price: PLANS[k].price, active: true, order: i + 1, best: k === 'yearly', name: null };
  });
  return out;
}
function cleanNames(n) {
  if (!n || typeof n !== 'object') return null;
  const out = {}; let any = false;
  LANGS.forEach(function (l) { const v = typeof n[l] === 'string' ? n[l].trim() : ''; if (v && v.length <= LIMITS.maxName) { out[l] = v; any = true; } });
  return any ? out : null;
}
/* Bardoshli o'qish: noto'g'ri maydon — o'sha maydon zaxiradan olinadi; birorta faol tarif qolmasa — hammasi faol */
function normalizeConfig(raw) {
  const plans = defaults();
  const ok = !!(raw && typeof raw === 'object' && raw.plans && typeof raw.plans === 'object');
  if (ok) {
    PLAN_KEYS.forEach(function (k) {
      const r = raw.plans[k]; if (!r || typeof r !== 'object') return;
      const p = plans[k];
      if (isInt(r.price, LIMITS.minPrice, LIMITS.maxPrice)) p.price = r.price;
      if (isInt(r.months, LIMITS.minMonths, LIMITS.maxMonths)) p.months = r.months;
      if (typeof r.active === 'boolean') p.active = r.active;
      if (isInt(r.order, 0, 99)) p.order = r.order;
      if (typeof r.best === 'boolean') p.best = r.best;
      p.name = cleanNames(r.name);
    });
    if (!PLAN_KEYS.some(function (k) { return plans[k].active; })) PLAN_KEYS.forEach(function (k) { plans[k].active = true; });
  }
  return {
    plans: plans,
    version: ok && isInt(raw.version, 0, 1e9) ? raw.version : 0,
    updatedAtMs: ok && typeof raw.updatedAtMs === 'number' ? raw.updatedAtMs : 0,
    source: ok ? 'config' : 'default'
  };
}
/* Admin yozishi uchun QAT'IY tekshiruv: hamma 3 tarif, to'g'ri qiymatlar, kamida bitta faol, bitta "eng foydali" (yoki hech biri) */
function validateSet(input) {
  if (!input || typeof input !== 'object') return { error: 'bad-input' };
  const out = {};
  for (let i = 0; i < PLAN_KEYS.length; i++) {
    const k = PLAN_KEYS[i], r = input[k];
    if (!r || typeof r !== 'object') return { error: 'missing-plan', plan: k };
    if (!isInt(r.price, LIMITS.minPrice, LIMITS.maxPrice)) return { error: 'bad-price', plan: k };
    if (!isInt(r.months, LIMITS.minMonths, LIMITS.maxMonths)) return { error: 'bad-months', plan: k };
    if (typeof r.active !== 'boolean') return { error: 'bad-active', plan: k };
    const order = r.order == null ? i + 1 : r.order;
    if (!isInt(order, 0, 99)) return { error: 'bad-order', plan: k };
    const best = r.best === true;
    if (r.name != null && typeof r.name !== 'object') return { error: 'bad-name', plan: k };
    if (r.name) for (const l of Object.keys(r.name)) { if (LANGS.indexOf(l) === -1 || typeof r.name[l] !== 'string' || r.name[l].trim().length > LIMITS.maxName) return { error: 'bad-name', plan: k }; }
    out[k] = { months: r.months, price: r.price, active: r.active, order: order, best: best, name: cleanNames(r.name) };
  }
  if (!PLAN_KEYS.some(function (k) { return out[k].active; })) return { error: 'no-active-plan' };
  if (PLAN_KEYS.filter(function (k) { return out[k].best; }).length > 1) return { error: 'many-best' };
  return { plans: out };
}

const __cache = typeof WeakMap === 'function' ? new WeakMap() : null;   // har bir db uchun alohida (sinovlarda aralashmaydi)
async function loadPlans(db, nowMs) {
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  if (__cache && db && typeof db === 'object') { const c = __cache.get(db); if (c && now - c.at < CACHE_MS && now >= c.at) return c.val; }
  let val;
  try {
    const s = await db.collection('config').doc('plans').get();
    val = normalizeConfig(s && s.exists ? s.data() : null);
  } catch (e) { val = normalizeConfig(null); }
  if (__cache && db && typeof db === 'object') __cache.set(db, { at: now, val: val });
  return val;
}
function clearPlansCache(db) { if (__cache && db) __cache.delete(db); }
/* Yangi buyurtma uchun joriy tarif: {key, months, price, active} yoki null */
async function getPlanLive(db, key, nowMs) {
  if (!getPlan(key)) return null;
  const c = await loadPlans(db, nowMs);
  const p = c.plans[key];
  return Object.freeze({ key: key, months: p.months, price: p.price, active: p.active });
}
async function activePlanList(db, nowMs) {
  const c = await loadPlans(db, nowMs);
  return PLAN_KEYS.map(function (k) { return c.plans[k]; }).filter(function (p) { return p.active; })
    .sort(function (a, b) { return a.order - b.order || PLAN_KEYS.indexOf(a.key) - PLAN_KEYS.indexOf(b.key); });
}
/* Buyurtmadagi oylar (yaratilgan paytdagi); eski buyurtmalarda yo'q bo'lsa — tarif zaxirasidan */
function orderMonths(order) {
  if (order && isInt(order.months, LIMITS.minMonths, LIMITS.maxMonths)) return order.months;
  const p = getPlan(order && order.plan); return p ? p.months : 0;
}

module.exports = { PLANS, PROVIDERS, PLAN_KEYS, LANGS, LIMITS, getPlan, isProvider, defaults, normalizeConfig, validateSet, loadPlans, clearPlansCache, getPlanLive, activePlanList, orderMonths };
