'use strict';
/* To'lov sahifasiga yo'naltiruvchi havolalar (foydalanuvchi brauzeri shu manzilga o'tadi). */

const PAYME_CHECKOUT = 'https://checkout.paycom.uz';
const CLICK_PAY = 'https://my.click.uz/services/pay';

// Payme interfeysi faqat ru / uz / en tillarini biladi.
function paymeLang(lang) { return lang === 'uz' || lang === 'en' ? lang : 'ru'; }

function paymeUrl(cfg, order, lang, base) {
  const tiyin = order.amount * 100;
  // returnUrl da ';' bo'lishi mumkin emas (createOrder tekshiradi) — Payme parametrlari ';' bilan ajratiladi.
  const raw = 'm=' + cfg.merchantId +
    ';ac.order_id=' + order.orderId +
    ';a=' + tiyin +
    ';l=' + paymeLang(lang) +
    ';c=' + order.returnUrl +
    ';cr=860';
  return (base || PAYME_CHECKOUT) + '/' + Buffer.from(raw, 'utf8').toString('base64');
}

function clickUrl(cfg, order) {
  return CLICK_PAY +
    '?service_id=' + encodeURIComponent(cfg.serviceId) +
    '&merchant_id=' + encodeURIComponent(cfg.merchantId) +
    '&amount=' + encodeURIComponent(String(order.amount)) +
    '&transaction_param=' + encodeURIComponent(order.orderId) +
    '&return_url=' + encodeURIComponent(order.returnUrl);
}

module.exports = { paymeUrl, clickUrl, paymeLang, PAYME_CHECKOUT, CLICK_PAY };
