'use strict';
/* DOMAIN: obuna muddatini hisoblash (sof funksiyalar, hech narsaga bog'liq emas). */

// Kalendar oy qo'shish (UTC). Oy oxiri to'g'rilanadi: 31-yanvar + 1 oy = 28/29-fevral.
function addMonths(ms, months) {
  const d = new Date(ms);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.getTime();
}

// Hozirgi muddatni biznes hujjatidan o'qiydi (ms). Yo'q yoki noto'g'ri bo'lsa 0.
function readExpiryMs(biz) {
  if (!biz || typeof biz !== 'object') return 0;
  if (typeof biz.subscriptionExpiresAtMs === 'number' && isFinite(biz.subscriptionExpiresAtMs)) {
    return biz.subscriptionExpiresAtMs;
  }
  if (biz.subscriptionExpiresAt) {
    const t = Date.parse(biz.subscriptionExpiresAt);
    if (isFinite(t)) return t;
  }
  return 0;
}

// Yangi muddat: obuna hali faol bo'lsa — tugash sanasidan, tugagan bo'lsa — hozirdan boshlab.
function computeNewExpiry(currentExpiryMs, nowMs, months) {
  const base = currentExpiryMs > nowMs ? currentExpiryMs : nowMs;
  return addMonths(base, months);
}

module.exports = { addMonths, readExpiryMs, computeNewExpiry };
