'use strict';
/* INTERFACE ADAPTER: Click SHOP-API (Prepare / Complete).
   Hujjat: https://docs.click.uz — so'rovlar application/x-www-form-urlencoded, javob JSON.
   Summalar SO'MDA (kasr bo'lishi mumkin: "70000.00").
   Imzo (sign_string) har ikki bosqichda MD5 bilan tekshiriladi. */

const crypto = require('crypto');
const { applyPaidInTx } = require('../app/applyPayment');

const E = {
  OK:             { error: 0,  note: 'Success' },
  SIGN:           { error: -1, note: 'SIGN CHECK FAILED!' },
  AMOUNT:         { error: -2, note: 'Incorrect parameter amount' },
  ACTION:         { error: -3, note: 'Action not found' },
  ALREADY_PAID:   { error: -4, note: 'Already paid' },
  NO_ORDER:       { error: -5, note: 'User does not exist' },
  NO_TRANSACTION: { error: -6, note: 'Transaction does not exist' },
  BAD_REQUEST:    { error: -8, note: 'Error in request from click' },
  CANCELLED:      { error: -9, note: 'Transaction cancelled' }
};

function md5(s) { return crypto.createHash('md5').update(s, 'utf8').digest('hex'); }
function safeEqual(a, b) {
  const ba = Buffer.from(String(a).toLowerCase()); const bb = Buffer.from(String(b).toLowerCase());
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
const s = function (v) { return v === undefined || v === null ? '' : String(v); };

function signFor(params, secret, withPrepareId) {
  const parts = [s(params.click_trans_id), s(params.service_id), secret, s(params.merchant_trans_id)];
  if (withPrepareId) parts.push(s(params.merchant_prepare_id));
  parts.push(s(params.amount), s(params.action), s(params.sign_time));
  return md5(parts.join(''));
}

function reply(e, params, extra) {
  const out = {
    click_trans_id: params.click_trans_id === undefined ? null : params.click_trans_id,
    merchant_trans_id: params.merchant_trans_id === undefined ? null : params.merchant_trans_id,
    error: e.error,
    error_note: e.note
  };
  return Object.assign(out, extra || {});
}

async function handleClick(deps, params) {
  // deps: { db, serviceId, secretKey, nowMs }   params: so'rov maydonlari (satrlar)
  const db = deps.db;
  if (!params || typeof params !== 'object') return reply(E.BAD_REQUEST, {});

  const action = parseInt(params.action, 10);
  if (action !== 0 && action !== 1) return reply(E.ACTION, params);

  // 1) imzo
  if (!deps.secretKey || !params.sign_string ||
      !safeEqual(signFor(params, deps.secretKey, action === 1), params.sign_string)) {
    return reply(E.SIGN, params);
  }
  // 2) xizmat ID
  if (s(params.service_id) !== s(deps.serviceId)) return reply(E.BAD_REQUEST, params);

  const orderId = s(params.merchant_trans_id);
  const clickTransId = s(params.click_trans_id);
  const amount = Number(params.amount);
  if (!orderId || !clickTransId || !isFinite(amount)) return reply(E.BAD_REQUEST, params);
  const nowMs = deps.nowMs();

  if (action === 0) {
    // ------------------------------ PREPARE
    const out = await db.runTransaction(async function (tx) {
      const orderRef = db.collection('paymentOrders').doc(orderId);
      const snap = await tx.get(orderRef);
      if (!snap.exists) return { e: E.NO_ORDER };
      const o = snap.data();
      if (o.provider !== 'click') return { e: E.NO_ORDER };
      if (o.status === 'PAID') return { e: E.ALREADY_PAID };
      if (o.status === 'CANCELLED') return { e: E.CANCELLED };
      if (Math.abs(amount - o.amount) > 0.001) return { e: E.AMOUNT };

      // Qayta yuborilgan Prepare (bir xil click_trans_id) — o'sha prepare ID qaytariladi
      if (o.click && o.click.transId === clickTransId && o.click.prepareId) {
        return { e: E.OK, extra: { merchant_prepare_id: o.click.prepareId } };
      }
      const prepareId = nowMs;
      tx.set(orderRef, {
        click: { transId: clickTransId, paydocId: s(params.click_paydoc_id), prepareId: prepareId, preparedAtMs: nowMs }
      }, { merge: true });
      return { e: E.OK, extra: { merchant_prepare_id: prepareId } };
    });
    return reply(out.e, params, out.extra);
  }

  // ------------------------------ COMPLETE
  const out = await db.runTransaction(async function (tx) {
    const orderRef = db.collection('paymentOrders').doc(orderId);
    const snap = await tx.get(orderRef);
    if (!snap.exists) return { e: E.NO_ORDER };
    const o = snap.data();
    if (o.provider !== 'click') return { e: E.NO_ORDER };
    if (o.status === 'PAID') return { e: E.ALREADY_PAID };
    if (o.status === 'CANCELLED') return { e: E.CANCELLED };

    // Prepare bosqichi o'tgan va ID lar mos bo'lishi shart
    if (!o.click || s(o.click.prepareId) !== s(params.merchant_prepare_id) || o.click.transId !== clickTransId) {
      return { e: E.NO_TRANSACTION };
    }
    if (Math.abs(amount - o.amount) > 0.001) return { e: E.AMOUNT };

    // Click o'zi to'lov xato bilan tugaganini xabar qilsa — buyurtma bekor qilinadi
    const clickError = parseInt(params.error, 10);
    if (isFinite(clickError) && clickError < 0) {
      tx.set(orderRef, { status: 'CANCELLED', cancelledAtMs: nowMs }, { merge: true });
      return { e: E.CANCELLED };
    }

    await applyPaidInTx(tx, db, o, { provider: 'click', transactionId: clickTransId, nowMs: nowMs });
    return { e: E.OK, extra: { merchant_confirm_id: o.orderId } };
  });
  return reply(out.e, params, out.extra);
}

module.exports = { handleClick, signFor, md5, E };
