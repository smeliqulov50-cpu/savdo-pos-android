'use strict';
/* APPLICATION: to'lov MUVAFFAQIYATLI bo'lgandagina chaqiriladi (Payme PerformTransaction /
   Click Complete). Bitta Firestore tranzaksiyasida:
     1) buyurtma holati PAID bo'ladi
     2) biznesning obuna muddati (subscriptionExpiresAt / ...Ms) uzayadi
     3) 'payments' jadvaliga to'lov yozuvi (faqat PAID) saqlanadi
   Idempotent: bir buyurtma ikki marta to'langan deb hisoblanmaydi.

   MUHIM (Firestore qoidasi): tranzaksiyada barcha o'qishlar yozishdan OLDIN bo'lishi shart.
   Shu sababli bu funksiya chaqirilishidan oldin chaqiruvchi hali hech narsa YOZMAGAN bo'lishi kerak. */

const { getPlan, orderMonths } = require('../domain/plans');   /* fix203-plans */
const { readExpiryMs, computeNewExpiry } = require('../domain/subscription');

async function applyPaidInTx(tx, db, order, info) {
  // info: { provider, transactionId, nowMs }
  if (order.status === 'PAID') return { applied: false };

  const plan = getPlan(order.plan);
  if (!plan) throw new Error('order-has-unknown-plan:' + order.plan);

  const bizRef = db.collection('businesses').doc(order.businessId);
  const bizSnap = await tx.get(bizRef);                 // o'qish — yozishlardan oldin
  const biz = bizSnap.exists ? bizSnap.data() : {};

  /* fix203-promo: aksiya/promokod ishlatilgani hisoblanadi (o'qishlar yozishdan oldin) */
  const useIds = [order.promo && order.promo.id, order.code && order.code.id].filter(Boolean);
  const useSnaps = [];
  for (let i = 0; i < useIds.length; i++) useSnaps.push(await tx.get(db.collection('promoUsage').doc(useIds[i])));
  const prevExpiryMs = readExpiryMs(biz);
  const months = orderMonths(order) || plan.months;   /* fix203-plans: buyurtma yaratilgan paytdagi muddat */
  const newExpiryMs = computeNewExpiry(prevExpiryMs, info.nowMs, months);
  const nowIso = new Date(info.nowMs).toISOString();

  // 1) obuna muddatini uzaytirish (mavjud maydon nomlari — ilova aynan shularni o'qiydi)
  tx.set(bizRef, {
    subscriptionPlan: plan.key,
    subscriptionExpiresAt: new Date(newExpiryMs).toISOString(),
    subscriptionExpiresAtMs: newExpiryMs,
    lastPaymentAt: nowIso,
    lastPaymentOrderId: order.orderId
  }, { merge: true });

  useIds.forEach(function (id, i) {
    const u = useSnaps[i] && useSnaps[i].exists ? useSnaps[i].data() : {};
    const shops = Object.assign({}, u.shops || {}); shops[order.businessId] = (shops[order.businessId] || 0) + 1;
    tx.set(db.collection('promoUsage').doc(id), { count: (u.count || 0) + 1, shops: shops, lastAtMs: info.nowMs }, { merge: true });
  });

  // 2) buyurtmani PAID qilish
  tx.set(db.collection('paymentOrders').doc(order.orderId), {
    status: 'PAID',
    paidAtMs: info.nowMs,
    providerTransactionId: String(info.transactionId)
  }, { merge: true });

  // 3) 'payments' jadvali — faqat muvaffaqiyatli to'lovlar. Hujjat ID = buyurtma ID
  //    (shu sabab bir buyurtma ikki marta yozilmaydi).
  tx.set(db.collection('payments').doc(order.orderId), {
    orderId: order.orderId,
    userId: order.userId,
    businessId: order.businessId,
    businessName: String(biz.businessName || ''),     // Super Admin jadvali uchun (to'lov paytidagi nusxa)
    ownerEmail: String(biz.ownerEmail || ''),
    amount: order.amount,
    baseAmount: typeof order.baseAmount === 'number' ? order.baseAmount : order.amount,   /* fix203-promo */
    promo: order.promo || null,
    code: order.code || null,
    provider: info.provider,
    channel: order.channel || null,   /* fix207-clickpay: 'tg' — Telegram bot orqali (Click sahifasiga yo'naltirish) */
    transactionId: String(info.transactionId),
    plan: plan.key,
    months: months,
    status: 'PAID',
    paidAtMs: info.nowMs,
    paidAt: nowIso,
    previousExpiryMs: prevExpiryMs,
    newExpiryMs: newExpiryMs
  });

  return { applied: true, newExpiryMs: newExpiryMs, prevExpiryMs: prevExpiryMs, plan: plan };
}

module.exports = { applyPaidInTx };
