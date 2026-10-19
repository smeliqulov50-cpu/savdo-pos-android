'use strict';
/* fix142-tgpay: obuna to'lovi Telegram bot orqali (Telegram Payments, provayder — Click).
   Ilova (Google Play) ichida to'lov yo'q — to'lov botda, ilovadan tashqarida.
   Oqim: /obuna → tarif tugmasi → sendInvoice → pre_checkout_query (server tekshiradi) → successful_payment →
         applyPaidInTx (Click/Payme bilan bir xil: obuna uzayadi, 'payments' ga yoziladi, ikki marta qo'llanmaydi).
   Provayder tokeni faqat Secret Manager'da (CLICK_TG_PROVIDER_TOKEN). Yo'q bo'lsa — bot to'lovni taklif qilmaydi.
   Narx va muddat faqat serverdagi domain/plans dan; Telegram'dan kelgan summa tekshiriladi. */
const crypto = require('crypto');
const { getPlan, PLANS } = require('../domain/plans');
const { readExpiryMs } = require('../domain/subscription');
const { applyPaidInTx } = require('../app/applyPayment');
const { validChats } = require('./core');
const { txt } = require('./payTexts');

const PROVIDER = 'click_tg';
const REUSE_MS = 30 * 60 * 1000;
const ORDER_TTL_MS = 24 * 3600 * 1000;
const SHORT = { m: 'monthly', s: 'sixmonth', y: 'yearly' };
const SHORT_OF = { monthly: 'm', sixmonth: 's', yearly: 'y' };

async function getData(ref) { const s = await ref.get(); return s && s.exists ? (s.data() || {}) : null; }
function bidHash(bid) { return crypto.createHash('sha256').update('tgpay|' + bid).digest('hex').slice(0, 12); }
function fmtSum(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function fmtDate(ms) { if (!ms) return '—'; const d = new Date(ms + 5 * 3600 * 1000); return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear(); }
async function shopOf(db, bid) { const b = await getData(db.collection('businesses').doc(bid)); return { biz: b || {}, name: String((b && (b.businessName || (b.settings && b.settings.businessName))) || 'Savdo Pos').slice(0, 80) }; }

/* Shu chat qaysi do'konlarga HAQIQATDAN ulangan (imzo bilan) */
async function linkedBids(deps, chatId) {
  const ch = await getData(deps.db.collection('tgChats').doc(String(chatId)));
  const bids = (ch && Array.isArray(ch.bids)) ? ch.bids.slice(0, 5) : [];
  const out = [];
  for (const bid of bids) {
    const biz = await getData(deps.db.collection('tgBiz').doc(bid));
    if (validChats(deps.key, bid, biz).some(function (x) { return x.id === String(chatId); })) out.push(bid);
  }
  return out;
}

async function sendMenu(deps, chatId, lang) {
  if (!deps.payToken) return { reply: txt('payOff', lang) };
  const bids = await linkedBids(deps, chatId);
  if (!bids.length) return { reply: txt('payNotLinked', lang) };
  for (const bid of bids) {
    const s = await shopOf(deps.db, bid);
    const exp = readExpiryMs(s.biz);
    const kb = Object.keys(PLANS).map(function (k) { const p = PLANS[k]; return [{ text: txt('payPlanBtn_' + k, lang, { sum: fmtSum(p.price) }), callback_data: 'p|' + bidHash(bid) + '|' + SHORT_OF[k] }]; });
    await deps.tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: txt(exp > deps.nowMs() ? 'payMenu' : 'payMenuExpired', lang, { shop: s.name, date: fmtDate(exp) }), reply_markup: { inline_keyboard: kb } });
  }
  return { menu: bids.length };
}

async function onCallback(deps, cq, lang) {
  const data = String((cq && cq.data) || '');
  const m = /^p\|([0-9a-f]{12})\|([msy])$/.exec(data);
  if (!m || !cq.message || !cq.message.chat) return { ignored: true };
  const chatId = String(cq.message.chat.id);
  const answer = function (text) { return deps.tg('answerCallbackQuery', { callback_query_id: cq.id, text: text || '' }).catch(function () {}); };
  if (!deps.payToken) { await answer(txt('payOffShort', lang)); return { off: true }; }
  const bid = (await linkedBids(deps, chatId)).find(function (b) { return bidHash(b) === m[1]; });
  if (!bid) { await answer(txt('payNotLinkedShort', lang)); return { notLinked: true }; }
  const plan = getPlan(SHORT[m[2]]);
  const now = deps.nowMs(), db = deps.db;
  // yaqinda shu chat/tarif uchun yaratilgan kutilayotgan buyurtma bo'lsa — o'sha (spamdan himoya)
  const pend = await db.collection('paymentOrders').where('businessId', '==', bid).where('status', '==', 'PENDING').get();
  let order = null;
  pend.docs.forEach(function (d) { const o = d.data(); if (o.provider === PROVIDER && o.plan === plan.key && o.chatId === chatId && now - o.createdAtMs < REUSE_MS) order = o; });
  const recent = pend.docs.map(function (d) { return d.data(); }).filter(function (o) { return o.provider === PROVIDER && now - o.createdAtMs < 3600 * 1000; });
  if (!order && recent.length >= 10) { await answer(txt('payTooMany', lang)); return { tooMany: true }; }
  if (!order) {
    order = { orderId: deps.genId(), businessId: bid, userId: 'tg:' + String((cq.from && cq.from.id) || chatId), plan: plan.key, months: plan.months, amount: plan.price,
      provider: PROVIDER, status: 'PENDING', createdAtMs: now, chatId: chatId, paymeTxId: null };
    await db.collection('paymentOrders').doc(order.orderId).set(order);
  }
  const s = await shopOf(db, bid);
  await deps.tg('sendInvoice', {
    chat_id: chatId,
    title: txt('payInvTitle_' + plan.key, lang).slice(0, 32),
    description: txt('payInvDesc', lang, { shop: s.name, months: plan.months }).slice(0, 255),
    payload: order.orderId,
    provider_token: deps.payToken,
    currency: 'UZS',
    prices: [{ label: txt('payInvTitle_' + plan.key, lang).slice(0, 32), amount: plan.price * 100 }]
  });
  await answer('');
  return { invoice: order.orderId };
}

/* Telegram to'lovdan oldin so'raydi: 10 soniya ichida javob kerak */
async function onPreCheckout(deps, q, lang) {
  const no = function (key) { return deps.tg('answerPreCheckoutQuery', { pre_checkout_query_id: q.id, ok: false, error_message: txt(key, lang) }).then(function () { return { ok: false, why: key }; }); };
  if (!deps.payToken) return no('payOffShort');
  const orderId = String(q.invoice_payload || '');
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(orderId)) return no('payBad');
  const o = await getData(deps.db.collection('paymentOrders').doc(orderId));
  if (!o || o.provider !== PROVIDER) return no('payBad');
  if (o.status === 'PAID') return no('payAlready');
  if (o.status !== 'PENDING' || deps.nowMs() - o.createdAtMs > ORDER_TTL_MS) return no('payExpired');
  const plan = getPlan(o.plan);
  if (!plan || q.currency !== 'UZS' || Number(q.total_amount) !== plan.price * 100 || Number(o.amount) !== plan.price) return no('payBad');
  await deps.tg('answerPreCheckoutQuery', { pre_checkout_query_id: q.id, ok: true });
  return { ok: true, orderId: orderId };
}

/* To'lov o'tdi — obuna uzaytiriladi (ikki marta emas) */
async function onPaid(deps, msg, lang) {
  const sp = msg.successful_payment || {};
  const orderId = String(sp.invoice_payload || '');
  const db = deps.db, chatId = String(msg.chat.id);
  const tid = String(sp.provider_payment_charge_id || sp.telegram_payment_charge_id || '');
  const ref = db.collection('paymentOrders').doc(orderId);
  const r = await db.runTransaction(async function (tx) {
    const s = await tx.get(ref);
    const o = s && s.exists ? s.data() : null;
    if (!o || o.provider !== PROVIDER) return { bad: true };
    const plan = getPlan(o.plan);
    if (!plan || sp.currency !== 'UZS' || Number(sp.total_amount) !== plan.price * 100) return { bad: true, mismatch: true };
    if (o.status === 'PAID') return { already: true, bid: o.businessId };
    const res = await applyPaidInTx(tx, db, o, { provider: PROVIDER, transactionId: tid || orderId, nowMs: deps.nowMs() });
    tx.set(ref, { tgChargeId: String(sp.telegram_payment_charge_id || ''), providerChargeId: String(sp.provider_payment_charge_id || ''), chatId: chatId }, { merge: true });
    return { applied: res.applied, bid: o.businessId, newExpiryMs: res.newExpiryMs };
  });
  if (r.bad) { await deps.tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: txt('payProblem', lang, { id: orderId }) }).catch(function () {}); return r; }
  const s = await shopOf(db, r.bid);
  const exp = r.newExpiryMs || readExpiryMs(s.biz);
  await deps.tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: txt('payDone', lang, { shop: s.name, date: fmtDate(exp) }) }).catch(function () {});
  return r;
}

module.exports = { sendMenu, onCallback, onPreCheckout, onPaid, linkedBids, bidHash, PROVIDER };
