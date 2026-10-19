'use strict';
/* INTERFACE: Firebase Cloud Functions (v2) — faqat HTTP <-> ilova mantig'i o'rtasidagi yupqa qatlam.
   Biznes mantig'i src/ ichida (kutubxonalarga bog'liq emas, shuning uchun alohida sinaladi).

   Funksiyalar (faqat yoqilgan to'lov tizimlari uchun, src/config.js):
     createPaymentOrder  — ilova chaqiradi (Firebase ID token bilan), to'lov havolasini qaytaradi
     paymeWebhook        — Payme serveri chaqiradi  (Merchant API, JSON-RPC)      [Payme yoqilganda]
     clickWebhook        — Click serveri chaqiradi  (SHOP-API, Prepare/Complete)  [Click yoqilganda] */

const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');

const { createOrder } = require('./src/app/createOrder');
const { handlePayme } = require('./src/providers/payme');
const { handleClick } = require('./src/providers/click');
const { paymeUrl, clickUrl } = require('./src/providers/checkoutUrls');
const { AppError } = require('./src/domain/errors');
const { ENABLED_PROVIDERS } = require('./src/config');

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });
if (!admin.apps.length) admin.initializeApp();

/* Yuklashda SAVDO_PUSH_ONLY=1 berilsa, to'lov maxfiy kalitlari (Secret Manager) umuman e'lon qilinmaydi — push/audit funksiyalarini alohida yuklash uchun. */
const PUSH_ONLY = process.env.SAVDO_PUSH_ONLY === '1';
const PAYME_ON = !PUSH_ONLY && ENABLED_PROVIDERS.indexOf('payme') !== -1;
const CLICK_ON = !PUSH_ONLY && ENABLED_PROVIDERS.indexOf('click') !== -1;

// Maxfiy qiymatlar (firebase functions:secrets:set ... bilan o'rnatiladi, kodda YOZILMAGAN).
// Faqat YOQILGAN to'lov tizimi uchun e'lon qilinadi.
const PAYME_MERCHANT_ID = PAYME_ON ? defineSecret('PAYME_MERCHANT_ID') : null;
const PAYME_KEY = PAYME_ON ? defineSecret('PAYME_KEY') : null;
const CLICK_SERVICE_ID = CLICK_ON ? defineSecret('CLICK_SERVICE_ID') : null;
const CLICK_MERCHANT_ID = CLICK_ON ? defineSecret('CLICK_MERCHANT_ID') : null;
const CLICK_SECRET_KEY = CLICK_ON ? defineSecret('CLICK_SECRET_KEY') : null;

const nowMs = function () { return Date.now(); };
const genId = function () { return admin.firestore().collection('paymentOrders').doc().id; };

function allowedOrigins() {
  const v = process.env.RETURN_ORIGINS;       // ixtiyoriy: "https://sayt1.uz,https://sayt2.uz"
  return v ? v.split(',').map(function (x) { return x.trim(); }).filter(Boolean) : [];
}

/* ---------- 1) Ilova: to'lov buyurtmasini yaratish ---------- */
const orderSecrets = [];
if (PAYME_ON) orderSecrets.push(PAYME_MERCHANT_ID);
if (CLICK_ON) orderSecrets.push(CLICK_SERVICE_ID, CLICK_MERCHANT_ID);

exports.createPaymentOrder = onRequest(
  { cors: true, secrets: orderSecrets },
  async function (req, res) {
    try {
      if (req.method !== 'POST') { res.status(405).json({ ok: false, code: 'method-not-allowed' }); return; }

      const m = /^Bearer\s+(.+)$/i.exec(req.get('Authorization') || '');
      if (!m) throw new AppError('unauthenticated', 401);
      let decoded;
      try { decoded = await admin.auth().verifyIdToken(m[1]); }
      catch (e) { throw new AppError('unauthenticated', 401); }

      const body = req.body || {};
      const db = admin.firestore();
      const order = await createOrder(
        { db: db, nowMs: nowMs, genId: genId, allowedReturnOrigins: allowedOrigins(), enabledProviders: ENABLED_PROVIDERS },
        { uid: decoded.uid, plan: body.plan, provider: body.provider, returnUrl: body.returnUrl }
      );

      const full = (await db.collection('paymentOrders').doc(order.orderId).get()).data();
      const url = order.provider === 'payme'
        ? paymeUrl({ merchantId: PAYME_MERCHANT_ID.value() }, full, body.lang)
        : clickUrl({ serviceId: CLICK_SERVICE_ID.value(), merchantId: CLICK_MERCHANT_ID.value() }, full);

      res.status(200).json({ ok: true, orderId: order.orderId, url: url });
    } catch (e) {
      if (e instanceof AppError) { res.status(e.httpStatus).json({ ok: false, code: e.code }); return; }
      console.error('createPaymentOrder xatosi', e);
      res.status(500).json({ ok: false, code: 'internal' });
    }
  }
);

/* ---------- 2) Payme webhook (faqat Payme yoqilganda yuklanadi) ---------- */
if (PAYME_ON) {
  exports.paymeWebhook = onRequest({ secrets: [PAYME_KEY] }, async function (req, res) {
    try {
      const out = await handlePayme(
        { db: admin.firestore(), key: PAYME_KEY.value(), nowMs: nowMs },
        { authHeader: req.get('Authorization'), body: req.body }
      );
      res.status(200).json(out);            // Payme: xato ham HTTP 200 bilan, JSON ichida qaytadi
    } catch (e) {
      console.error('paymeWebhook xatosi', e);
      res.status(200).json({ error: { code: -32400, message: { ru: 'Системная ошибка', uz: 'Tizim xatosi', en: 'System error' } }, id: (req.body && req.body.id) || null });
    }
  });
}

/* ---------- 3) Click webhook (faqat Click yoqilganda yuklanadi) ---------- */
if (CLICK_ON) {
  exports.clickWebhook = onRequest({ secrets: [CLICK_SERVICE_ID, CLICK_SECRET_KEY] }, async function (req, res) {
    try {
      const out = await handleClick(
        { db: admin.firestore(), serviceId: CLICK_SERVICE_ID.value(), secretKey: CLICK_SECRET_KEY.value(), nowMs: nowMs },
        req.body
      );
      res.status(200).json(out);
    } catch (e) {
      console.error('clickWebhook xatosi', e);
      res.status(200).json({ error: -7, error_note: 'Failed to update user' });
    }
  });
}

/* ---------- fix95-push: ovozli push xabarlar ---------- */
const __fbAdmin = require('firebase-admin');
if (!__fbAdmin.apps.length) __fbAdmin.initializeApp();
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { handleSupportMessage, handleDailyDebt } = require('./src/push/notify');
const { handleDailyReports } = require('./src/push/dailyReport');   /* fix105-report */

/* Yordam chatiga yangi xabar yozilsa: biznes -> super adminga, super admin -> biznesga push (ovoz bilan) */
exports.notifySupportMessage = onDocumentCreated('businesses/{bizId}/support/{msgId}', async function (event) {
  const snap = event.data;
  if (!snap) return;
  try {
    const r = await handleSupportMessage({ db: __fbAdmin.firestore(), messaging: __fbAdmin.messaging() }, event.params.bizId, snap.data());
    console.log('notifySupportMessage', JSON.stringify(r));
  } catch (e) { console.error('notifySupportMessage xatosi', e); }
});

/* fix105-report: Har 10 daqiqada tekshiradi; har bir biznesning o'zi belgilagan kunlik hisobot vaqti kelganda
   ega/admin qurilmalariga "Kunlik xulosa" + qarz eslatmasi yuboradi (ovoz bilan). Kuniga bir marta. */
exports.dailyDebtPush = onSchedule({ schedule: 'every 10 minutes', timeZone: 'Asia/Tashkent' }, async function () {
  try {
    const st = await handleDailyReports({ db: __fbAdmin.firestore(), messaging: __fbAdmin.messaging() }, new Date());
    if (st.businesses || st.errors) console.log('dailyDebtPush', JSON.stringify(st));
  } catch (e) { console.error('dailyDebtPush xatosi', e); }
});

/* ---------- fix96-audit: audit jurnali 30 kun, eskilari bulutdan o'chadi ---------- */
const { cleanupAudit } = require('./src/maintenance/auditCleanup');
exports.cleanupAuditLog = onSchedule({ schedule: '30 3 * * *', timeZone: 'Asia/Tashkent', timeoutSeconds: 540 }, async function () {
  try {
    const st = await cleanupAudit(__fbAdmin.firestore());
    console.log('cleanupAuditLog', JSON.stringify(st));
  } catch (e) { console.error('cleanupAuditLog xatosi', e); }
});

/* ---------- fix114-debts: do'konlar orasidagi qarzlar (qarzdor "Mening qarzlarim"da faqat ko'radi) ---------- */
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const __SD = require('./src/debts/shared');
const __SD_SUPER_UID = 'M0CZxwtteTMxbs6nyeR5kVrJ68X2';   // ilovadagi SUPER_ADMIN_UID bilan bir xil

/* Mijoz yozuvi o'zgarganda: telefon raqami bo'yicha indeks + qarz o'zgarsa, raqamini bog'lagan qarzdor do'konga push */
exports.sharedDebtIndex = onDocumentWritten('businesses/{bizId}/customers/{custId}', async function (event) {
  const ch = event.data;
  if (!ch) return;
  try {
    const before = ch.before && ch.before.exists ? ch.before.data() : null;
    const after = ch.after && ch.after.exists ? ch.after.data() : null;
    const r = await __SD.handleCustomerWrite({ db: __fbAdmin.firestore(), messaging: __fbAdmin.messaging(), nowMs: nowMs }, event.params.bizId, event.params.custId, before, after);
    if (r && r.pushed) console.log('sharedDebtIndex', JSON.stringify(r));
  } catch (e) { console.error('sharedDebtIndex xatosi', e); }
});

/* Ilova so'rovlari: status / link / unlink / list / detail (+ superadmin: adminRelease). Firebase ID token bilan. */
exports.sharedDebts = onRequest({ cors: true }, async function (req, res) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ ok: false, code: 'method-not-allowed' }); return; }
    const m = /^Bearer\s+(.+)$/i.exec(req.get('Authorization') || '');
    if (!m) { res.status(401).json({ ok: false, code: 'unauthenticated' }); return; }
    let decoded;
    try { decoded = await __fbAdmin.auth().verifyIdToken(m[1]); }
    catch (e) { res.status(401).json({ ok: false, code: 'unauthenticated' }); return; }
    const out = await __SD.handleRequest({ db: __fbAdmin.firestore(), nowMs: nowMs, superUid: __SD_SUPER_UID }, decoded.uid, req.body || {});
    res.status(out.status || 200).json(out.body);
  } catch (e) {
    console.error('sharedDebts xatosi', e);
    res.status(500).json({ ok: false, code: 'internal' });
  }
});

/* Server qo'yilishidan oldingi mijozlarni bir marta indeksga yozadi (keyin har soatda faqat 1 ta belgini o'qib chiqadi) */
exports.sharedDebtBackfill = onSchedule({ schedule: 'every 60 minutes', timeZone: 'Asia/Tashkent', timeoutSeconds: 540 }, async function () {
  try {
    const st = await __SD.runBackfill({ db: __fbAdmin.firestore(), nowMs: nowMs });
    if (!st.skipped) console.log('sharedDebtBackfill', JSON.stringify(st));
  } catch (e) { console.error('sharedDebtBackfill xatosi', e); }
});

/* ---------- fix120-tg: Telegram bot — ega uchun hisobotlar (1-bosqich: ulash / uzish) ----------
   Token faqat Secret Manager'da (TELEGRAM_BOT_TOKEN). Kodda, ilovada va repoda yo'q.
   Yuklash:  SAVDO_PUSH_ONLY=1 SAVDO_TG=1 firebase deploy --only functions:telegramApi,functions:telegramWebhook
   Token o'rnatilmagan bo'lsa ikkala funksiya ham hech narsa yubormaydi (bot o'chiq). */
const __TG = require('./src/telegram/core');
const { makeTg: __makeTg } = require('./src/telegram/tgApi');
const __TG_SECRET = (PUSH_ONLY && process.env.SAVDO_TG !== '1') ? null : defineSecret('TELEGRAM_BOT_TOKEN');
const __tgSecrets = __TG_SECRET ? [__TG_SECRET] : [];
/* fix142-tgpay: Click provayder tokeni (Telegram Payments) — faqat Secret Manager'da. SAVDO_TG_PAY=1 bilan yuklanganda ulanadi. */
const __TGPAY_SECRET = (__TG_SECRET && process.env.SAVDO_TG_PAY === '1') ? defineSecret('CLICK_TG_PROVIDER_TOKEN') : null;
const __tgHookSecrets = __TGPAY_SECRET ? __tgSecrets.concat([__TGPAY_SECRET]) : __tgSecrets;
function __tgPayToken() { try { const v = __TGPAY_SECRET ? __TGPAY_SECRET.value() : ''; return v ? String(v).trim() : ''; } catch (e) { return ''; } }
function __tgToken() {
  try { const v = __TG_SECRET ? __TG_SECRET.value() : ''; if (v) return String(v).trim(); } catch (e) {}
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}
let __tgCache = null;
async function __tgDeps() {
  const token = __tgToken();
  const base = { db: __fbAdmin.firestore(), nowMs: nowMs };
  if (!token) return Object.assign(base, { key: null });
  if (!__tgCache || __tgCache.token !== token) __tgCache = { token: token, key: __TG.keyFromToken(token), tg: __makeTg(token), botName: '' };
  if (!__tgCache.botName) {
    try { const me = await __tgCache.tg('getMe', {}); __tgCache.botName = (me && me.username) || ''; }
    catch (e) { console.error('telegram getMe xatosi', e && e.message); }
  }
  return Object.assign(base, { key: __tgCache.key, tg: __tgCache.tg, botName: __tgCache.botName, payToken: __tgPayToken(), genId: function () { return __fbAdmin.firestore().collection('paymentOrders').doc().id; } });   /* fix142-tgpay */
}
function __tgProjectId() {
  try { const c = JSON.parse(process.env.FIREBASE_CONFIG || '{}'); if (c.projectId) return c.projectId; } catch (e) {}
  return process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
}
function __tgWebhookUrl() { return 'https://us-central1-' + __tgProjectId() + '.cloudfunctions.net/telegramWebhook'; }

/* Ilova: status / link / unlink. Firebase ID token bilan (sharedDebts bilan bir xil tekshiruv). */
exports.telegramApi = onRequest({ cors: true, secrets: __tgSecrets }, async function (req, res) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ ok: false, code: 'method-not-allowed' }); return; }
    const m = /^Bearer\s+(.+)$/i.exec(req.get('Authorization') || '');
    if (!m) { res.status(401).json({ ok: false, code: 'unauthenticated' }); return; }
    let decoded;
    try { decoded = await __fbAdmin.auth().verifyIdToken(m[1]); }
    catch (e) { res.status(401).json({ ok: false, code: 'unauthenticated' }); return; }
    const out = await __TG.handleApi(await __tgDeps(), decoded.uid, req.body || {});
    res.status(out.status || 200).json(out.body);
  } catch (e) {
    console.error('telegramApi xatosi', e && e.message);
    res.status(500).json({ ok: false, code: 'internal' });
  }
});

/* Telegram serveri chaqiradi. Sirli sarlavha (X-Telegram-Bot-Api-Secret-Token) tokendan hisoblanadi — boshqa hech kim yubora olmaydi.
   GET ?setup=1 — webhook manzilini o'rnatadi (yuklashdan keyin bir marta; qayta chaqirish xavfsiz). */
exports.telegramWebhook = onRequest({ secrets: __tgHookSecrets }, async function (req, res) {
  let deps;
  try { deps = await __tgDeps(); } catch (e) { console.error('telegramWebhook deps', e && e.message); res.status(200).json({ ok: false }); return; }
  if (req.method === 'GET') {
    if (!(req.query && req.query.setup === '1')) { res.status(200).send('ok'); return; }
    if (!deps.key) { res.status(503).json({ ok: false, code: 'no_token' }); return; }
    try { const r = await __TG.setupWebhook(deps, __tgWebhookUrl()); res.status(200).json(Object.assign({ ok: true }, r)); }
    catch (e) { res.status(502).json({ ok: false, code: 'tg_error', message: String((e && e.message) || '').slice(0, 200) }); }
    return;
  }
  if (req.method !== 'POST') { res.status(405).end(); return; }
  if (!deps.key || req.get('X-Telegram-Bot-Api-Secret-Token') !== __TG.webhookSecret(deps.key)) { res.status(401).end(); return; }
  try {
    const r = await __TG.handleUpdate(deps, req.body || {});
    if (r && (r.linked || r.stopped || r.blocked)) console.log('telegramWebhook', JSON.stringify({ linked: !!r.linked, stopped: r.stopped || 0, blocked: !!r.blocked }));
    if (r && (r.invoice || r.applied || r.already || r.bad || r.why)) console.log('telegramPay', JSON.stringify({ invoice: r.invoice || null, applied: !!r.applied, already: !!r.already, bad: !!r.bad, why: r.why || null }));   /* fix142-tgpay */
  } catch (e) { console.error('telegramWebhook xatosi', e && e.message); }
  res.status(200).json({ ok: true });   // Telegram qayta-qayta yubormasligi uchun har doim 200
});

/* ---------- fix121-tg2: Telegram bot — 2-bosqich: xabarlar (har biri ilovada alohida yoqiladi; hammasi standart holatda O'CHIQ) ----------
   Kunlik hisobot, kam qolgan tovarlar (jadval, har 10 daqiqada tekshiradi); smena yopildi, katta chegirma, chek o'chirildi/qaytarildi (darhol).
   Token bo'lmasa yoki ega yoqmagan bo'lsa hech narsa yuborilmaydi. Mavjud funksiyalarga tegilmaydi.
   Yuklash: SAVDO_PUSH_ONLY=1 SAVDO_TG=1 firebase deploy --only functions:telegramApi,functions:telegramTick,functions:telegramSaleAlert,functions:telegramAuditAlert,functions:telegramShiftAlert */
const __TGR = require('./src/telegram/reports');
const __tgPrefsCache = new Map();
function __tgDepsLite() {
  const token = __tgToken();
  const base = { db: __fbAdmin.firestore(), nowMs: nowMs, cache: __tgPrefsCache, gapMs: 40 };
  if (!token) return Object.assign(base, { key: null });
  if (!__tgCache || __tgCache.token !== token) __tgCache = { token: token, key: __TG.keyFromToken(token), tg: __makeTg(token), botName: '' };
  return Object.assign(base, { key: __tgCache.key, tg: __tgCache.tg });
}
exports.telegramTick = onSchedule({ schedule: 'every 10 minutes', timeZone: 'Asia/Tashkent', timeoutSeconds: 300, secrets: __tgSecrets }, async function () {
  try {
    const st = await __TGR.runTick(__tgDepsLite(), new Date());
    if (st.daily || st.low || st.errors) console.log('telegramTick', JSON.stringify(st));
  } catch (e) { console.error('telegramTick xatosi', e && e.message); }
});
exports.telegramSaleAlert = onDocumentCreated({ document: 'businesses/{bizId}/sales/{saleId}', secrets: __tgSecrets }, async function (event) {
  const snap = event.data;
  if (!snap) return;
  try {
    const r = await __TGR.handleSaleCreated(__tgDepsLite(), event.params.bizId, event.params.saleId, snap.data());
    if (r && r.alert) console.log('telegramSaleAlert', JSON.stringify(r));
  } catch (e) { console.error('telegramSaleAlert xatosi', e && e.message); }
});
exports.telegramAuditAlert = onDocumentCreated({ document: 'businesses/{bizId}/audit/{auditId}', secrets: __tgSecrets }, async function (event) {
  const snap = event.data;
  if (!snap) return;
  try {
    const r = await __TGR.handleAuditCreated(__tgDepsLite(), event.params.bizId, event.params.auditId, snap.data());
    if (r && r.alert) console.log('telegramAuditAlert', JSON.stringify(r));
  } catch (e) { console.error('telegramAuditAlert xatosi', e && e.message); }
});
exports.telegramShiftAlert = onDocumentWritten({ document: 'businesses/{bizId}/meta/catalog', secrets: __tgSecrets }, async function (event) {
  const ch = event.data;
  if (!ch) return;
  try {
    const before = ch.before && ch.before.exists ? ch.before.data() : null;
    const after = ch.after && ch.after.exists ? ch.after.data() : null;
    const r = await __TGR.handleCatalogWrite(__tgDepsLite(), event.params.bizId, before, after);
    if (r && r.alert) console.log('telegramShiftAlert', JSON.stringify(r));
  } catch (e) { console.error('telegramShiftAlert xatosi', e && e.message); }
});
