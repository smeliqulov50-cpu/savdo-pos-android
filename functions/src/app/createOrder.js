'use strict';
/* APPLICATION: to'lov buyurtmasini yaratish.
   Brauzerdan faqat {tarif kaliti, to'lov tizimi, qaytish manzili} keladi.
   Summa, muddat va biznes ID — SERVERDA aniqlanadi. */

const { getPlan, getPlanLive, isProvider } = require('../domain/plans');   /* fix203-plans */
const { AppError } = require('../domain/errors');
const PRICING = require('./pricing');   /* fix203-promo */

const REUSE_WINDOW_MS = 30 * 60 * 1000;   // 30 daqiqa ichidagi bir xil kutilayotgan buyurtma qayta ishlatiladi

function validateReturnUrl(url, allowedOrigins) {
  if (typeof url !== 'string' || url.length === 0 || url.length > 300) return false;
  if (!/^https:\/\/[^\s;]+$/.test(url)) return false;
  if (allowedOrigins && allowedOrigins.length) {
    let origin;
    try { origin = new URL(url).origin; } catch (e) { return false; }
    return allowedOrigins.indexOf(origin) !== -1;
  }
  return true;
}

// Faqat biznes EGASI to'lay oladi: xodimlar staffAuth/{uid} da yoziladi.
async function resolveOwnerBusiness(db, uid) {
  if (typeof uid !== 'string' || !uid) throw new AppError('unauthenticated', 401);
  const staff = await db.collection('staffAuth').doc(uid).get();
  if (staff.exists) throw new AppError('only-owner-can-pay', 403);
  const biz = await db.collection('businesses').doc(uid).get();
  if (!biz.exists) throw new AppError('business-not-found', 404);
  return uid;
}

async function createOrder(deps, input) {
  const db = deps.db;
  const nowMs = deps.nowMs();
  if (!getPlan(input.plan)) throw new AppError('invalid-plan', 400);
  const plan = await getPlanLive(db, input.plan, nowMs);   /* fix203-plans: narx bitta manbadan (config/plans), zaxira — PLANS */
  if (!plan || !plan.active) throw new AppError('plan-inactive', 400);
  if (!isProvider(input.provider)) throw new AppError('invalid-provider', 400);
  // Hali ulanmagan to'lov tizimi (masalan Payme) uchun buyurtma yaratilmaydi
  if (deps.enabledProviders && deps.enabledProviders.indexOf(input.provider) === -1) throw new AppError('provider-disabled', 400);
  if (!validateReturnUrl(input.returnUrl, deps.allowedReturnOrigins)) throw new AppError('invalid-return-url', 400);

  const businessId = await resolveOwnerBusiness(db, input.uid);
  /* fix203-promo: yakuniy narx (aksiya + promokod) serverda; noto'g'ri promokod — buyurtma yaratilmaydi */
  const q = await PRICING.quote(db, businessId, plan.key, input.promoCode ? String(input.promoCode).slice(0, 40) : '', nowMs);
  if (!q) throw new AppError('plan-inactive', 400);
  if (q.codeError) throw new AppError(q.codeError, 400);

  // Spamdan himoya: shu biznesning shu tarif/tizim uchun yaqinda yaratilgan kutilayotgan buyurtmasi bo'lsa — o'sha qaytariladi.
  const pending = await db.collection('paymentOrders')
    .where('businessId', '==', businessId)
    .where('status', '==', 'PENDING')
    .get();
  let reuse = null;
  pending.docs.forEach(function (d) {
    const o = d.data();
    if (o.plan === plan.key && o.provider === input.provider && o.returnUrl === input.returnUrl && PRICING.sameDeal(o, q) &&   /* fix203-plans: narx/aksiya/kod o'zgargan bo'lsa — yangi buyurtma */
        nowMs - o.createdAtMs < REUSE_WINDOW_MS && !o.paymeTxId) {
      reuse = o;
    }
  });
  if (reuse) return { orderId: reuse.orderId, amount: reuse.amount, plan: reuse.plan, provider: reuse.provider };

  const orderId = deps.genId();
  const order = {
    orderId: orderId,
    businessId: businessId,
    userId: input.uid,
    plan: plan.key,
    months: q.months,
    amount: q.price,                   // so'm — aksiya/promokoddan keyin (fix203-promo)
    baseAmount: q.base,
    promo: q.promo ? { id: q.promo.id, name: q.promo.name } : null,
    code: q.code ? { id: q.code.id, code: q.code.code } : null,
    provider: input.provider,
    returnUrl: input.returnUrl,
    status: 'PENDING',
    createdAtMs: nowMs,
    paymeTxId: null
  };
  await db.collection('paymentOrders').doc(orderId).set(order);
  return { orderId: orderId, amount: order.amount, plan: order.plan, provider: order.provider };
}

module.exports = { createOrder, validateReturnUrl, resolveOwnerBusiness, REUSE_WINDOW_MS };
