'use strict';
/* fix203-promo: aksiyalar va promokodlar (sof funksiyalar). Narx DOIM serverda hisoblanadi.
   Qoida: bir nechta aksiya mos kelsa — eng arzon narx beradigani (teng bo'lsa — ertaroq tugaydigani).
   Promokod: «withPromo» belgilangan bo'lsa aksiyadan keyingi narxga qo'llanadi, aks holda aksiya yoki kod — qaysi biri arzon bo'lsa o'sha.
   Narx hech qachon 1 000 so'mdan past bo'lmaydi. Vaqt — ms (UTC); panel Toshkent vaqtida kiritadi. */
const PLAN_KEYS = ['monthly', 'sixmonth', 'yearly'];
const MIN_PRICE = 1000;
const AUD = ['all', 'new', 'expired', 'selected'];
function isInt(v, lo, hi) { return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi; }
function str(v, max) { return typeof v === 'string' ? v.trim().slice(0, max) : ''; }
function plansOf(a) { const p = Array.isArray(a) ? a.filter(function (k) { return PLAN_KEYS.indexOf(k) !== -1; }) : []; return p.length ? Array.from(new Set(p)) : PLAN_KEYS.slice(); }
function normCode(c) { return str(c, 24).toUpperCase().replace(/\s+/g, ''); }

function validatePromo(p) {
  if (!p || typeof p !== 'object') return 'bad-promo';
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(String(p.id || ''))) return 'bad-id';
  if (!str(p.name, 60)) return 'bad-name';
  if (['percent', 'amount', 'price'].indexOf(p.type) === -1) return 'bad-type';
  if (p.type === 'percent' && !isInt(p.value, 1, 90)) return 'bad-value';
  if (p.type === 'amount' && !isInt(p.value, 100, 50000000)) return 'bad-value';
  if (p.type === 'price') { if (!p.prices || typeof p.prices !== 'object') return 'bad-value'; const ks = plansOf(p.plans); for (let i = 0; i < ks.length; i++) if (!isInt(p.prices[ks[i]], MIN_PRICE, 100000000)) return 'bad-value'; }
  if (!isInt(p.startMs, 0, 4e12) || !isInt(p.endMs, 0, 4e12) || p.endMs <= p.startMs) return 'bad-dates';
  if (AUD.indexOf(p.audience) === -1) return 'bad-audience';
  if (p.audience === 'selected' && (!Array.isArray(p.bizIds) || !p.bizIds.length || p.bizIds.length > 500 || p.bizIds.some(function (x) { return !/^[A-Za-z0-9_-]{6,64}$/.test(String(x)); }))) return 'bad-biz';
  if (p.limit != null && !isInt(p.limit, 0, 1000000)) return 'bad-limit';
  if (typeof p.active !== 'boolean') return 'bad-active';
  return null;
}
function validateCode(c) {
  if (!c || typeof c !== 'object') return 'bad-code';
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(String(c.id || ''))) return 'bad-id';
  if (!/^[A-Z0-9-]{3,20}$/.test(normCode(c.code))) return 'bad-code-text';
  if (['percent', 'amount'].indexOf(c.type) === -1) return 'bad-type';
  if (c.type === 'percent' && !isInt(c.value, 1, 90)) return 'bad-value';
  if (c.type === 'amount' && !isInt(c.value, 100, 50000000)) return 'bad-value';
  if (!isInt(c.startMs, 0, 4e12) || !isInt(c.endMs, 0, 4e12) || c.endMs <= c.startMs) return 'bad-dates';
  if (c.maxUses != null && !isInt(c.maxUses, 0, 1000000)) return 'bad-limit';
  if (c.perShop != null && !isInt(c.perShop, 1, 1000)) return 'bad-limit';
  if (typeof c.active !== 'boolean') return 'bad-active';
  return null;
}
function cleanPromo(p) {
  const o = { id: String(p.id), name: str(p.name, 60), plans: plansOf(p.plans), type: p.type, startMs: p.startMs, endMs: p.endMs, audience: p.audience, limit: p.limit || 0, active: p.active };
  if (p.type === 'price') { o.prices = {}; o.plans.forEach(function (k) { o.prices[k] = p.prices[k]; }); } else o.value = p.value;
  if (p.audience === 'selected') o.bizIds = Array.from(new Set(p.bizIds.map(String)));
  return o;
}
function cleanCode(c) {
  return { id: String(c.id), code: normCode(c.code), type: c.type, value: c.value, plans: plansOf(c.plans), startMs: c.startMs, endMs: c.endMs, maxUses: c.maxUses || 0, perShop: c.perShop || 1, withPromo: c.withPromo === true, active: c.active };
}
function validateConfig(input) {
  if (!input || typeof input !== 'object') return { error: 'bad-input' };
  const promos = Array.isArray(input.promos) ? input.promos : [], codes = Array.isArray(input.codes) ? input.codes : [];
  if (promos.length > 50 || codes.length > 200) return { error: 'too-many' };
  const ids = new Set(), texts = new Set();
  for (let i = 0; i < promos.length; i++) { const e = validatePromo(promos[i]); if (e) return { error: e, index: i, kind: 'promo' }; if (ids.has(promos[i].id)) return { error: 'dup-id' }; ids.add(promos[i].id); }
  for (let i = 0; i < codes.length; i++) { const e = validateCode(codes[i]); if (e) return { error: e, index: i, kind: 'code' }; if (ids.has(codes[i].id)) return { error: 'dup-id' }; ids.add(codes[i].id); const t = normCode(codes[i].code); if (texts.has(t)) return { error: 'dup-code', index: i, kind: 'code' }; texts.add(t); }
  return { promos: promos.map(cleanPromo), codes: codes.map(cleanCode) };
}
/* O'qishda bardoshli: noto'g'ri yozuvlar tashlab yuboriladi */
function normalizeConfig(raw) {
  const out = { promos: [], codes: [], version: 0 };
  if (!raw || typeof raw !== 'object') return out;
  (Array.isArray(raw.promos) ? raw.promos : []).forEach(function (p) { if (!validatePromo(p)) out.promos.push(cleanPromo(p)); });
  (Array.isArray(raw.codes) ? raw.codes : []).forEach(function (c) { if (!validateCode(c)) out.codes.push(cleanCode(c)); });
  out.version = isInt(raw.version, 0, 1e9) ? raw.version : 0;
  return out;
}
function discounted(base, kind, value) {
  const v = kind === 'percent' ? Math.round(base * (100 - value) / 100) : base - value;
  return Math.max(MIN_PRICE, Math.min(base, v));
}
function promoPriceFor(p, planKey, base) {
  if (p.plans.indexOf(planKey) === -1) return null;
  const v = p.type === 'price' ? Math.max(MIN_PRICE, Math.min(base, p.prices[planKey])) : discounted(base, p.type, p.value);
  return v < base ? v : null;
}
/* ctx: {bizId, biz (hujjat), everPaid: bool, expiryMs, nowMs, usage: {id: {count, shops}}} */
function promoMatches(p, ctx) {
  if (!p.active || ctx.nowMs < p.startMs || ctx.nowMs >= p.endMs) return false;
  if (p.limit > 0 && ((ctx.usage[p.id] && ctx.usage[p.id].count) || 0) >= p.limit) return false;
  if (p.audience === 'new') return !ctx.everPaid;
  if (p.audience === 'expired') return !!ctx.expiryMs && ctx.expiryMs <= ctx.nowMs;
  if (p.audience === 'selected') return (p.bizIds || []).indexOf(ctx.bizId) !== -1;
  return true;
}
function bestPromo(cfg, planKey, base, ctx) {
  let best = null;
  cfg.promos.forEach(function (p) {
    if (!promoMatches(p, ctx)) return;
    const v = promoPriceFor(p, planKey, base); if (v == null) return;
    if (!best || v < best.price || (v === best.price && p.endMs < best.promo.endMs)) best = { price: v, promo: p };
  });
  return best;
}
function findCode(cfg, code) { const t = normCode(code); return t ? cfg.codes.find(function (c) { return c.code === t; }) || null : null; }
function checkCode(c, planKey, ctx) {
  if (!c || !c.active) return 'code-invalid';
  if (ctx.nowMs < c.startMs) return 'code-not-started';
  if (ctx.nowMs >= c.endMs) return 'code-expired';
  if (c.plans.indexOf(planKey) === -1) return 'code-plan';
  const u = ctx.usage[c.id] || {};
  if (c.maxUses > 0 && (u.count || 0) >= c.maxUses) return 'code-limit';
  if (((u.shops || {})[ctx.bizId] || 0) >= (c.perShop || 1)) return 'code-shop-limit';
  return null;
}
/* Yakuniy narx: {base, price, promo|null, code|null, codeError|null, codeIgnored|null} */
function priceFor(cfg, planKey, base, ctx, codeText) {
  const bp = bestPromo(cfg, planKey, base, ctx);
  const res = { base: base, price: bp ? bp.price : base, promo: bp ? { id: bp.promo.id, name: bp.promo.name, endMs: bp.promo.endMs } : null, code: null, codeError: null, codeIgnored: null };
  if (codeText) {
    const c = findCode(cfg, codeText);
    const e = c ? checkCode(c, planKey, ctx) : 'code-invalid';
    if (e) { res.codeError = e; return res; }
    if (c.withPromo) {
      res.price = discounted(res.price, c.type, c.value); res.code = { id: c.id, code: c.code };
    } else {
      const v = discounted(base, c.type, c.value);
      if (v < res.price) { res.price = v; res.promo = null; res.code = { id: c.id, code: c.code }; }
      else res.codeIgnored = 'promo-better';
    }
  }
  return res;
}
module.exports = { PLAN_KEYS, MIN_PRICE, normCode, validateConfig, normalizeConfig, priceFor, bestPromo, checkCode, discounted, promoMatches };
