'use strict';
/* fix203-promo: yakuniy narx (tarif + aksiya + promokod) — bitta joyda, SERVERDA. Ilova, bot va mini ilova shu natijani ko'rsatadi,
   buyurtma ham shu summa bilan yaratiladi. */
const PL = require('../domain/plans');
const PR = require('../domain/promos');
const { readExpiryMs } = require('../domain/subscription');
const CACHE_MS = 30 * 1000;
const __cache = new WeakMap();
async function loadPromos(db, nowMs) {
  const c = __cache.get(db); if (c && nowMs - c.at < CACHE_MS && nowMs >= c.at) return c.val;
  let val; try { const s = await db.collection('config').doc('promos').get(); val = PR.normalizeConfig(s && s.exists ? s.data() : null); } catch (e) { val = PR.normalizeConfig(null); }
  __cache.set(db, { at: nowMs, val: val }); return val;
}
function clearPromosCache(db) { __cache.delete(db); }
async function ctxFor(db, bizId, cfg, nowMs) {
  let biz = {};
  try { const s = await db.collection('businesses').doc(bizId).get(); biz = s.exists ? s.data() : {}; } catch (e) { biz = {}; }
  const ids = cfg.promos.filter(function (p) { return p.limit > 0; }).map(function (p) { return p.id; }).concat(cfg.codes.map(function (c) { return c.id; }));
  const usage = {};
  for (let i = 0; i < ids.length; i++) { try { const u = await db.collection('promoUsage').doc(ids[i]).get(); if (u.exists) usage[ids[i]] = u.data(); } catch (e) {} }
  return { bizId: bizId, biz: biz, everPaid: !!(biz.lastPaymentAt || biz.lastPaymentOrderId), expiryMs: readExpiryMs(biz), nowMs: nowMs, usage: usage };
}
/* Bitta tarif uchun: null (tarif yo'q/o'chirilgan) yoki {key, months, base, price, promo, code, codeError, codeIgnored} */
async function quote(db, bizId, planKey, codeText, nowMs, pre) {
  const plan = await PL.getPlanLive(db, planKey, nowMs);
  if (!plan || !plan.active) return null;
  const cfg = (pre && pre.cfg) || await loadPromos(db, nowMs);
  const ctx = (pre && pre.ctx) || await ctxFor(db, bizId, cfg, nowMs);
  const r = PR.priceFor(cfg, planKey, plan.price, ctx, codeText || '');
  return Object.assign({ key: planKey, months: plan.months }, r);
}
/* Hamma sotuvdagi tariflar (tartib bilan) */
async function quoteAll(db, bizId, codeText, nowMs) {
  const list = await PL.activePlanList(db, nowMs);
  const cfg = await loadPromos(db, nowMs);
  const ctx = await ctxFor(db, bizId, cfg, nowMs);
  const out = [];
  for (let i = 0; i < list.length; i++) { const q = await quote(db, bizId, list[i].key, codeText, nowMs, { cfg: cfg, ctx: ctx }); if (q) out.push(Object.assign(q, { best: !!list[i].best, name: list[i].name || null })); }
  return out;
}
/* Buyurtmaga yoziladigan maydonlar */
function orderFields(q) {
  return { amount: q.price, baseAmount: q.base, months: q.months, promo: q.promo ? { id: q.promo.id, name: q.promo.name } : null, code: q.code ? { id: q.code.id, code: q.code.code } : null };
}
function sameDeal(o, q) {
  return o.amount === q.price && o.months === q.months && ((o.code && o.code.id) || null) === ((q.code && q.code.id) || null) && ((o.promo && o.promo.id) || null) === ((q.promo && q.promo.id) || null);
}
function daysLeft(endMs, nowMs) { return Math.max(1, Math.ceil((endMs - nowMs) / 86400000)); }
module.exports = { quote, quoteAll, orderFields, sameDeal, loadPromos, clearPromosCache, daysLeft };
