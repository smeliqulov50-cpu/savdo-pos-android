'use strict';
/* DOMAIN: tariflar. Narx va muddat FAQAT shu yerda (serverda) belgilanadi —
   mijoz (brauzer) yuborgan summaga hech qachon ishonilmaydi.
   Kalitlar ilovadagi mavjud tarif kalitlari bilan bir xil (monthly/sixmonth/yearly),
   shuning uchun ilovaning eski mantiqi (masalan tarix oynasi) buzilmaydi. */

const PLANS = Object.freeze({
  monthly:  Object.freeze({ key: 'monthly',  months: 1,  price: 70000 }),
  sixmonth: Object.freeze({ key: 'sixmonth', months: 6,  price: 420000 }),
  yearly:   Object.freeze({ key: 'yearly',   months: 12, price: 840000 })
});

const PROVIDERS = Object.freeze(['payme', 'click']);

function getPlan(key) {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(PLANS, key) ? PLANS[key] : null;
}
function isProvider(p) {
  return typeof p === 'string' && PROVIDERS.indexOf(p) !== -1;
}

module.exports = { PLANS, PROVIDERS, getPlan, isProvider };
