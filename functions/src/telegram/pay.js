'use strict';
/* fix142-tgpay: obuna to'lovi Telegram bot orqali (Telegram Payments, provayder — Click).
   Ilova (Google Play) ichida to'lov yo'q — to'lov botda, ilovadan tashqarida.
   Oqim: /obuna → tarif tugmasi → sendInvoice → pre_checkout_query (server tekshiradi) → successful_payment →
         applyPaidInTx (Click/Payme bilan bir xil: obuna uzayadi, 'payments' ga yoziladi, ikki marta qo'llanmaydi).
   Provayder tokeni faqat Secret Manager'da (CLICK_TG_PROVIDER_TOKEN). Yo'q bo'lsa — bot to'lovni taklif qilmaydi.
   Narx va muddat faqat serverdagi domain/plans dan; Telegram'dan kelgan summa tekshiriladi. */
const crypto = require('crypto');
const { getPlan, PLANS, getPlanLive, activePlanList, orderMonths } = require('../domain/plans');   /* fix203-plans */
const PRICING = require('../app/pricing');   /* fix203-promo */
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
  const SH = require('./shop');   /* fix146-tgsub: tariflar katalogi (mini ilova) tugmasi va pastki menyu */
  await SH.ownerMenu(deps, chatId, lang);
  for (let bi = 0; bi < bids.length; bi++) {
    const bid = bids[bi];
    const s = await shopOf(deps.db, bid);
    const exp = readExpiryMs(s.biz);
    const qs = await PRICING.quoteAll(deps.db, bid, '', deps.nowMs());   /* fix203-promo: aksiya narxi bilan */
    const kb = qs.map(function (q) { const k = q.key; const def = PLANS[k] && PLANS[k].months === q.months; return [{ text: (def ? txt('payPlanBtn_' + k, lang, { sum: fmtSum(q.price) }) : txt('payPlanBtnN', lang, { months: q.months, sum: fmtSum(q.price) })) + (q.promo ? ' 🔥' : ''), callback_data: 'p|' + bidHash(bid) + '|' + SHORT_OF[k] }]; });
    const pq = qs.find(function (q) { return q.promo; });
    const promoLine = pq ? '\n\n' + txt('payPromoLine', lang, { name: pq.promo.name, days: PRICING.daysLeft(pq.promo.endMs, deps.nowMs()), old: fmtSum(pq.base), sum: fmtSum(pq.price) }) : '';
    if (bi === bids.length - 1) kb.push([{ text: require('./shopTexts').t('btnPlans', lang), web_app: { url: SH.hubUrl() } }]);
    await deps.tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: txt(exp > deps.nowMs() ? 'payMenu' : 'payMenuExpired', lang, { shop: s.name, date: fmtDate(exp) }) + promoLine, reply_markup: { inline_keyboard: kb } });
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
  const plan = SHORT[m[2]] ? await getPlanLive(deps.db, SHORT[m[2]], deps.nowMs()) : null;   /* fix203-plans */
  if (!plan || !plan.active) { await answer(txt('payBad', lang)); return { badPlan: true }; }
  const r = await orderFor(deps, bid, plan, chatId, (cq.from && cq.from.id) || chatId);
  if (r.badPlan || r.codeError) { await answer(txt('payBad', lang)); return { badPlan: true }; }
  if (r.tooMany) { await answer(txt('payTooMany', lang)); return { tooMany: true }; }
  await deps.tg('sendInvoice', Object.assign({ chat_id: chatId }, await invoiceParams(deps, bid, plan, r.order, lang)));
  await answer('');
  return { invoice: r.order.orderId };
}
/* fix146-tgsub: buyurtma (kutilayotgan bo'lsa — o'sha) va hisob maydonlari — chatdagi tugma ham, mini ilova ham shuni ishlatadi */
async function orderFor(deps, bid, plan, chatId, fromId, code) {
  const now = deps.nowMs(), db = deps.db;
  chatId = String(chatId);
  const q = await PRICING.quote(db, bid, plan.key, code || '', now);   /* fix203-promo: yakuniy narx serverda */
  if (!q) return { badPlan: true };
  if (q.codeError) return { codeError: q.codeError };
  // yaqinda shu chat/tarif uchun yaratilgan kutilayotgan buyurtma bo'lsa — o'sha (spamdan himoya)
  const pend = await db.collection('paymentOrders').where('businessId', '==', bid).where('status', '==', 'PENDING').get();
  let order = null;
  pend.docs.forEach(function (d) { const o = d.data(); if (o.provider === PROVIDER && o.plan === plan.key && o.chatId === chatId && PRICING.sameDeal(o, q) && now - o.createdAtMs < REUSE_MS) order = o;   /* fix203-plans */ });
  const recent = pend.docs.map(function (d) { return d.data(); }).filter(function (o) { return o.provider === PROVIDER && now - o.createdAtMs < 3600 * 1000; });
  if (!order && recent.length >= 10) return { tooMany: true };
  if (!order) {
    order = { orderId: deps.genId(), businessId: bid, userId: 'tg:' + String(fromId || chatId), plan: plan.key, months: q.months, amount: q.price, baseAmount: q.base, promo: q.promo ? { id: q.promo.id, name: q.promo.name } : null, code: q.code ? { id: q.code.id, code: q.code.code } : null,
      provider: PROVIDER, status: 'PENDING', createdAtMs: now, chatId: chatId, paymeTxId: null };
    await db.collection('paymentOrders').doc(order.orderId).set(order);
  }
  return { order: order };
}
async function invoiceParams(deps, bid, plan, order, lang) {
  const s = await shopOf(deps.db, bid);
  return {
    title: txt('payInvTitle_' + plan.key, lang).slice(0, 32),
    description: txt('payInvDesc', lang, { shop: s.name, months: orderMonths(order) || plan.months }).slice(0, 255),
    payload: order.orderId,
    provider_token: deps.payToken,
    currency: 'UZS',
    prices: [{ label: txt('payInvTitle_' + plan.key, lang).slice(0, 32), amount: Number(order.amount) * 100 }]   /* fix203-plans: buyurtma summasi */
  };
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
  if (!plan || q.currency !== 'UZS' || !(Number(o.amount) > 0) || Number(q.total_amount) !== Number(o.amount) * 100) return no('payBad');   /* fix203-plans: narx keyin o'zgarsa ham buyurtma summasi bilan */
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
    if (!plan || sp.currency !== 'UZS' || !(Number(o.amount) > 0) || Number(sp.total_amount) !== Number(o.amount) * 100) return { bad: true, mismatch: true };   /* fix203-plans */
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

/* fix150-subbot: obuna tugashidan 3 kun va 1 kun oldin hamda tugagan kuni egasi chatlariga eslatma (har biri bir marta) */
const DAY_MS = 86400000, TZ_MS = 5 * 3600 * 1000;
function dayIdx(ms) { return Math.floor((ms + TZ_MS) / DAY_MS); }
function remStage(exp, now) {
  const left = dayIdx(exp) - dayIdx(now);
  if (left === 3) return 'd3';
  if (left === 1) return 'd1';
  if (left <= 0 && left >= -2 && exp <= now) return 'end';
  return '';
}
async function subRemind(deps, now) {
  const st = { checked: 0, sent: 0, failed: 0 };
  if (!deps.key || !deps.tg) return st;
  now = now || deps.nowMs();
  const snap = await deps.db.collection('tgBiz').limit(3000).get();
  const docs = snap && snap.docs ? snap.docs : [];
  const SH = require('./shop'), C = require('./cmds');
  for (let i = 0; i < docs.length; i++) {
    const bid = docs[i].id, biz = docs[i].data() || {};
    const chats = validChats(deps.key, bid, biz);
    if (!chats.length) continue;
    st.checked++;
    try {
      const s = await shopOf(deps.db, bid);
      const exp = readExpiryMs(s.biz);
      if (!(exp > 0)) continue;
      const stage = remStage(exp, now);
      if (!stage) continue;
      const mark = exp + '|' + stage;
      if (biz.subRem === mark) continue;
      await deps.db.collection('tgBiz').doc(bid).set({ subRem: mark }, { merge: true });
      const key = stage === 'd3' ? 'remD3' : stage === 'd1' ? 'remD1' : 'remEnd';
      for (let j = 0; j < chats.length; j++) {
        const l = await C.chatLang(deps, chats[j].id, biz.lang);
        try {
          await deps.tg('sendMessage', { chat_id: chats[j].id, parse_mode: 'HTML', text: txt(key, l, { shop: s.name, date: fmtDate(exp) }), reply_markup: { inline_keyboard: [[{ text: txt('btnRenew', l), web_app: { url: SH.hubUrl() } }]] } });
          st.sent++;
        } catch (e) { st.failed++; }
      }
    } catch (e) { st.failed++; }
  }
  return st;
}
module.exports = { subRemind, remStage, sendMenu, onCallback, onPreCheckout, onPaid, linkedBids, bidHash, orderFor, invoiceParams, shopOf, fmtDate, PROVIDER, SHORT };
