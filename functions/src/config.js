'use strict';
/* Qaysi to'lov tizimlari YOQILGAN. Hozircha faqat Click.
   Payme tayyor bo'lganda:  ENABLED_PROVIDERS: ['click', 'payme']  (va qayta yuklash). */
/* fix207-clickpay: bot obunasi qanday to'lanadi.
   'redirect' — Click'ning o'z sahifasi (karta ma'lumotini faqat Click ko'radi); Click kalitlari (CLICK_SERVICE_ID, CLICK_MERCHANT_ID,
   CLICK_SECRET_KEY) serverda bo'lmasa — avtomatik 'telegram' (eski yo'l: Telegram Payments oynasi).
   'telegram' — har doim eski yo'l. */
module.exports = { ENABLED_PROVIDERS: ['click'], TG_PAY_MODE: 'redirect' };
