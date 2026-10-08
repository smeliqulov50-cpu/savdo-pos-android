'use strict';
/* INTERFACE ADAPTER: Payme Merchant API (JSON-RPC 2.0).
   Hujjat: https://developer.help.paycom.uz  — usullar: CheckPerformTransaction,
   CreateTransaction, PerformTransaction, CancelTransaction, CheckTransaction, GetStatement.
   Barcha javoblar HTTP 200 bilan qaytadi (xato ham JSON ichida). Summalar TIYINDA (1 so'm = 100 tiyin). */

const crypto = require('crypto');
const { applyPaidInTx } = require('../app/applyPayment');

const TX_TIMEOUT_MS = 12 * 60 * 60 * 1000;   // Payme: yaratilgan tranzaksiya 12 soat kutadi
const STATE = { CREATED: 1, PERFORMED: 2, CANCELLED: -1, CANCELLED_AFTER_PERFORM: -2 };
const REASON_TIMEOUT = 4;

const ERRORS = {
  AUTH:           { code: -32504, message: { ru: 'Недостаточно привилегий для выполнения метода', uz: 'Metodni bajarish uchun huquq yetarli emas', en: 'Insufficient privileges' } },
  PARSE:          { code: -32700, message: { ru: 'Ошибка разбора JSON', uz: 'JSON xatosi', en: 'Parse error' } },
  INVALID_REQUEST:{ code: -32600, message: { ru: 'Неверный запрос', uz: "Noto'g'ri so'rov", en: 'Invalid request' } },
  NO_METHOD:      { code: -32601, message: { ru: 'Метод не найден', uz: 'Metod topilmadi', en: 'Method not found' } },
  INVALID_AMOUNT: { code: -31001, message: { ru: 'Неверная сумма', uz: "Noto'g'ri summa", en: 'Invalid amount' } },
  TX_NOT_FOUND:   { code: -31003, message: { ru: 'Транзакция не найдена', uz: 'Tranzaksiya topilmadi', en: 'Transaction not found' } },
  CANT_PERFORM:   { code: -31008, message: { ru: 'Невозможно выполнить операцию', uz: "Operatsiyani bajarib bo'lmaydi", en: 'Unable to perform operation' } },
  CANT_CANCEL:    { code: -31007, message: { ru: 'Заказ выполнен. Невозможно отменить транзакцию.', uz: "Buyurtma bajarilgan. Tranzaksiyani bekor qilib bo'lmaydi.", en: 'Order completed. Transaction cannot be cancelled.' } },
  NO_ORDER:       { code: -31050, message: { ru: 'Заказ не найден', uz: 'Buyurtma topilmadi', en: 'Order not found' }, data: 'order_id' },
  ORDER_BUSY:     { code: -31099, message: { ru: 'Для заказа уже есть ожидающая транзакция', uz: 'Buyurtma uchun kutilayotgan tranzaksiya mavjud', en: 'The order already has a pending transaction' }, data: 'order_id' }
};

function fail(err, id) {
  const e = { code: err.code, message: err.message };
  if (err.data) e.data = err.data;
  return { error: e, id: id === undefined ? null : id };
}
function ok(result, id) { return { result: result, id: id === undefined ? null : id }; }

function safeEqual(a, b) {
  const ba = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function isAuthorized(authHeader, key) {
  if (typeof authHeader !== 'string' || !key) return false;
  const m = /^Basic\s+(.+)$/i.exec(authHeader.trim());
  if (!m) return false;
  let decoded;
  try { decoded = Buffer.from(m[1], 'base64').toString('utf8'); } catch (e) { return false; }
  return safeEqual(decoded, 'Paycom:' + key);
}

function txView(t) {
  return {
    create_time: t.create_time,
    perform_time: t.perform_time || 0,
    cancel_time: t.cancel_time || 0,
    transaction: t.id,
    state: t.state,
    reason: t.reason === undefined ? null : t.reason
  };
}

// Buyurtmani tekshirish. null qaytsa — hammasi joyida, aks holda Payme xato obyekti.
function validateOrderForPayment(order, amountTiyin) {
  if (!order || order.provider !== 'payme') return ERRORS.NO_ORDER;
  if (order.status !== 'PENDING') return ERRORS.CANT_PERFORM;
  if (!Number.isInteger(amountTiyin) || amountTiyin !== order.amount * 100) return ERRORS.INVALID_AMOUNT;
  return null;
}

function getOrderId(params) {
  const a = params && params.account;
  return a && typeof a.order_id === 'string' && a.order_id ? a.order_id : null;
}

async function handlePayme(deps, req) {
  // deps: { db, key, nowMs }   req: { authHeader, body }
  const db = deps.db;
  const body = req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(ERRORS.PARSE, null);
  const id = body.id === undefined ? null : body.id;

  if (!isAuthorized(req.authHeader, deps.key)) return fail(ERRORS.AUTH, id);
  if (typeof body.method !== 'string' || !body.params || typeof body.params !== 'object') return fail(ERRORS.INVALID_REQUEST, id);

  const p = body.params;
  const nowMs = deps.nowMs();

  switch (body.method) {
    case 'CheckPerformTransaction': {
      const orderId = getOrderId(p);
      if (!orderId) return fail(ERRORS.NO_ORDER, id);
      const snap = await db.collection('paymentOrders').doc(orderId).get();
      const err = validateOrderForPayment(snap.exists ? snap.data() : null, p.amount);
      return err ? fail(err, id) : ok({ allow: true }, id);
    }

    case 'CreateTransaction': {
      if (typeof p.id !== 'string' || !p.id) return fail(ERRORS.INVALID_REQUEST, id);
      const orderId = getOrderId(p);
      if (!orderId) return fail(ERRORS.NO_ORDER, id);
      const out = await db.runTransaction(async function (tx) {
        const pmRef = db.collection('paymeTransactions').doc(p.id);
        const orderRef = db.collection('paymentOrders').doc(orderId);
        const pmSnap = await tx.get(pmRef);
        const orderSnap = await tx.get(orderRef);

        if (pmSnap.exists) {                       // shu ID bilan tranzaksiya allaqachon bor
          const t = pmSnap.data();
          if (t.state !== STATE.CREATED) return { err: ERRORS.CANT_PERFORM };
          if (nowMs - t.create_time > TX_TIMEOUT_MS) {
            tx.set(pmRef, { state: STATE.CANCELLED, reason: REASON_TIMEOUT, cancel_time: nowMs }, { merge: true });
            tx.set(orderRef, { paymeTxId: null }, { merge: true });
            return { err: ERRORS.CANT_PERFORM };
          }
          return { result: { create_time: t.create_time, transaction: t.id, state: STATE.CREATED } };
        }

        const order = orderSnap.exists ? orderSnap.data() : null;
        const vErr = validateOrderForPayment(order, p.amount);
        if (vErr) return { err: vErr };

        if (order.paymeTxId) {                     // buyurtmada boshqa tranzaksiya bormi?
          const otherSnap = await tx.get(db.collection('paymeTransactions').doc(order.paymeTxId));
          if (otherSnap.exists && otherSnap.data().state === STATE.CREATED) {
            const o = otherSnap.data();
            if (nowMs - o.create_time <= TX_TIMEOUT_MS) return { err: ERRORS.ORDER_BUSY };
            tx.set(db.collection('paymeTransactions').doc(order.paymeTxId),
              { state: STATE.CANCELLED, reason: REASON_TIMEOUT, cancel_time: nowMs }, { merge: true });
          }
        }

        const t = {
          id: p.id, orderId: orderId, amount: p.amount, time: p.time,
          create_time: nowMs, perform_time: 0, cancel_time: 0, state: STATE.CREATED, reason: null
        };
        tx.set(pmRef, t);
        tx.set(orderRef, { paymeTxId: p.id }, { merge: true });
        return { result: { create_time: nowMs, transaction: p.id, state: STATE.CREATED } };
      });
      return out.err ? fail(out.err, id) : ok(out.result, id);
    }

    case 'PerformTransaction': {
      if (typeof p.id !== 'string' || !p.id) return fail(ERRORS.INVALID_REQUEST, id);
      const out = await db.runTransaction(async function (tx) {
        const pmRef = db.collection('paymeTransactions').doc(p.id);
        const pmSnap = await tx.get(pmRef);
        if (!pmSnap.exists) return { err: ERRORS.TX_NOT_FOUND };
        const t = pmSnap.data();
        const orderRef = db.collection('paymentOrders').doc(t.orderId);
        const orderSnap = await tx.get(orderRef);

        if (t.state === STATE.PERFORMED) {
          return { result: { transaction: t.id, perform_time: t.perform_time, state: STATE.PERFORMED } };
        }
        if (t.state !== STATE.CREATED) return { err: ERRORS.CANT_PERFORM };

        if (nowMs - t.create_time > TX_TIMEOUT_MS) {
          tx.set(pmRef, { state: STATE.CANCELLED, reason: REASON_TIMEOUT, cancel_time: nowMs }, { merge: true });
          if (orderSnap.exists) tx.set(orderRef, { paymeTxId: null }, { merge: true });
          return { err: ERRORS.CANT_PERFORM };
        }
        if (!orderSnap.exists) return { err: ERRORS.CANT_PERFORM };

        // To'lov muvaffaqiyatli: obunani uzaytirish + payments ga yozish (o'qishlar avval, yozishlar keyin)
        await applyPaidInTx(tx, db, orderSnap.data(), { provider: 'payme', transactionId: t.id, nowMs: nowMs });
        tx.set(pmRef, { state: STATE.PERFORMED, perform_time: nowMs }, { merge: true });
        return { result: { transaction: t.id, perform_time: nowMs, state: STATE.PERFORMED } };
      });
      return out.err ? fail(out.err, id) : ok(out.result, id);
    }

    case 'CancelTransaction': {
      if (typeof p.id !== 'string' || !p.id) return fail(ERRORS.INVALID_REQUEST, id);
      const reason = Number.isInteger(p.reason) ? p.reason : null;
      const out = await db.runTransaction(async function (tx) {
        const pmRef = db.collection('paymeTransactions').doc(p.id);
        const pmSnap = await tx.get(pmRef);
        if (!pmSnap.exists) return { err: ERRORS.TX_NOT_FOUND };
        const t = pmSnap.data();
        const orderRef = db.collection('paymentOrders').doc(t.orderId);
        const orderSnap = await tx.get(orderRef);

        if (t.state === STATE.CREATED) {
          tx.set(pmRef, { state: STATE.CANCELLED, reason: reason, cancel_time: nowMs }, { merge: true });
          if (orderSnap.exists) tx.set(orderRef, { paymeTxId: null }, { merge: true });
          return { result: { transaction: t.id, cancel_time: nowMs, state: STATE.CANCELLED } };
        }
        if (t.state === STATE.PERFORMED) {
          // Obuna allaqachon berilgan: qaytarish (refund) avtomatik qilinmaydi — Payme qo'llab-quvvatlashi orqali qo'lda hal qilinadi.
          return { err: ERRORS.CANT_CANCEL };
        }
        return { result: { transaction: t.id, cancel_time: t.cancel_time, state: t.state } };   // allaqachon bekor qilingan
      });
      return out.err ? fail(out.err, id) : ok(out.result, id);
    }

    case 'CheckTransaction': {
      if (typeof p.id !== 'string' || !p.id) return fail(ERRORS.INVALID_REQUEST, id);
      const snap = await db.collection('paymeTransactions').doc(p.id).get();
      if (!snap.exists) return fail(ERRORS.TX_NOT_FOUND, id);
      return ok(txView(snap.data()), id);
    }

    case 'GetStatement': {
      if (!Number.isFinite(p.from) || !Number.isFinite(p.to)) return fail(ERRORS.INVALID_REQUEST, id);
      const snap = await db.collection('paymeTransactions')
        .where('create_time', '>=', p.from)
        .where('create_time', '<=', p.to)
        .get();
      const list = snap.docs.map(function (d) { return d.data(); })
        .sort(function (a, b) { return a.create_time - b.create_time; })
        .map(function (t) {
          return {
            id: t.id, time: t.time, amount: t.amount, account: { order_id: t.orderId },
            create_time: t.create_time, perform_time: t.perform_time || 0, cancel_time: t.cancel_time || 0,
            transaction: t.id, state: t.state, reason: t.reason === undefined ? null : t.reason
          };
        });
      return ok({ transactions: list }, id);
    }

    default:
      return fail(ERRORS.NO_METHOD, id);
  }
}

module.exports = { handlePayme, isAuthorized, ERRORS, STATE, TX_TIMEOUT_MS };
