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

/* Yordam chatiga yangi xabar yozilsa: biznes -> super adminga, super admin -> biznesga push (ovoz bilan) */
exports.notifySupportMessage = onDocumentCreated('businesses/{bizId}/support/{msgId}', async function (event) {
  const snap = event.data;
  if (!snap) return;
  try {
    const r = await handleSupportMessage({ db: __fbAdmin.firestore(), messaging: __fbAdmin.messaging() }, event.params.bizId, snap.data());
    console.log('notifySupportMessage', JSON.stringify(r));
  } catch (e) { console.error('notifySupportMessage xatosi', e); }
});

/* Har kuni 21:00 (Toshkent) — ega/admin qurilmalariga kunlik qarz hisoboti eslatmasi (ovoz bilan) */
exports.dailyDebtPush = onSchedule({ schedule: '0 21 * * *', timeZone: 'Asia/Tashkent' }, async function () {
  try {
    const st = await handleDailyDebt({ db: __fbAdmin.firestore(), messaging: __fbAdmin.messaging() });
    console.log('dailyDebtPush', JSON.stringify(st));
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
