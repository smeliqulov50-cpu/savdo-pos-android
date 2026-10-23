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
        { uid: decoded.uid, plan: body.plan, provider: body.provider, returnUrl: body.returnUrl, promoCode: typeof body.promoCode === 'string' ? body.promoCode : '' }
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

/* fix203-plans: Super admin API (tariflar; keyingi bosqichlar ham shu yerga). Faqat superadmin UID — Firebase ID token serverda tekshiriladi. Maxfiy qiymat yo'q. */
const __PA = require('./src/admin/plansAdmin');
exports.adminApi = onRequest({ cors: true }, async function (req, res) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ ok: false, code: 'method-not-allowed' }); return; }
    const m = /^Bearer\s+(.+)$/i.exec(req.get('Authorization') || '');
    if (!m) { res.status(401).json({ ok: false, code: 'unauthenticated' }); return; }
    let decoded;
    try { decoded = await __fbAdmin.auth().verifyIdToken(m[1]); }
    catch (e) { res.status(401).json({ ok: false, code: 'unauthenticated' }); return; }
    const db = __fbAdmin.firestore();
    const out = await __PA.handleAdmin({ db: db, nowMs: nowMs, genId: function () { return db.collection('adminLog').doc().id; }, superUid: __SD_SUPER_UID, computeStats: __statsNow }, { uid: decoded.uid, email: decoded.email || '' }, req.body || {});
    res.status(out.status || 200).json(out.body);
  } catch (e) {
    console.error('adminApi xatosi', e);
    res.status(500).json({ ok: false, code: 'internal' });
  }
});

/* fix203-dash: statistika (MRR, obunalar, ro'yxatdan o'tganlar, tushum) — 6 soatda bir marta yig'iladi, panel tayyor hujjatni o'qiydi */
const __ST = require('./src/admin/stats');
async function __authTimes(uids) {
  const out = {};
  for (let i = 0; i < uids.length; i += 100) {
    const r = await __fbAdmin.auth().getUsers(uids.slice(i, i + 100).map(function (u) { return { uid: u }; }));
    r.users.forEach(function (u) { const t = Date.parse(u.metadata && u.metadata.creationTime); if (isFinite(t)) out[u.uid] = t; });
  }
  return out;
}
function __statsNow(db, now) { return __ST.computeStats(db, now, { authTimes: __authTimes }); }
exports.adminStatsTick = onSchedule({ schedule: 'every 6 hours', timeZone: 'Asia/Tashkent', timeoutSeconds: 300 }, async function () {
  try { const db = __fbAdmin.firestore(); await db.collection('adminStats').doc('current').set(await __statsNow(db, nowMs())); }
  catch (e) { console.error('adminStatsTick xatosi', e); }
});
/* fix203-promo: yangi biznes — sinov muddati paneldagi qiymatga (config/plans.trialDays), yaratilgan vaqt yoziladi */
exports.businessCreated = onDocumentCreated('businesses/{bizId}', async function (event) {
  try { const s = event.data; const r = await __PA.onBusinessCreated({ db: __fbAdmin.firestore(), nowMs: nowMs }, event.params.bizId, s && s.data ? s.data() : null); if (r && r.patched) console.log('businessCreated', event.params.bizId, JSON.stringify(r)); }
  catch (e) { console.error('businessCreated xatosi', e); }
});
/* fix203-promo: ilova uchun narxlar (aksiya va promokod bilan) — faqat shu biznes egasi; summa baribir buyurtmada serverda qayta hisoblanadi */
const __PRC = require('./src/app/pricing');
exports.planQuote = onRequest({ cors: true }, async function (req, res) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ ok: false, code: 'method-not-allowed' }); return; }
    const m = /^Bearer\s+(.+)$/i.exec(req.get('Authorization') || '');
    if (!m) { res.status(401).json({ ok: false, code: 'unauthenticated' }); return; }
    let decoded;
    try { decoded = await __fbAdmin.auth().verifyIdToken(m[1]); }
    catch (e) { res.status(401).json({ ok: false, code: 'unauthenticated' }); return; }
    const db = __fbAdmin.firestore();
    const st = await db.collection('staffAuth').doc(decoded.uid).get();
    const bizId = st.exists ? String((st.data() || {}).businessId || '') : decoded.uid;
    const body = req.body || {};
    const code = typeof body.code === 'string' ? body.code.slice(0, 24) : '';
    const qs = await __PRC.quoteAll(db, bizId, code, nowMs());
    const now = nowMs();
    res.status(200).json({ ok: true, plans: qs.map(function (q) { return { key: q.key, months: q.months, base: q.base, price: q.price, best: !!q.best, promo: q.promo ? { name: q.promo.name, days: __PRC.daysLeft(q.promo.endMs, now), endMs: q.promo.endMs } : null, code: q.code ? q.code.code : null, codeError: q.codeError || null, codeIgnored: q.codeIgnored || null }; }) });
  } catch (e) {
    console.error('planQuote xatosi', e);
    res.status(500).json({ ok: false, code: 'internal' });
  }
});

/* fix205-google: Google (va keyin Telegram) bilan kirgandan keyin — do'kon ochilishidan oldin tekshiruv: ikkinchi akkaunt/bo'sh do'kon ochilmasin */
const __AUTHG = require('./src/auth/guard');
exports.authGuard = onRequest({ cors: true }, async function (req, res) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ ok: false, code: 'method-not-allowed' }); return; }
    const m = /^Bearer\s+(.+)$/i.exec(req.get('Authorization') || '');
    if (!m) { res.status(401).json({ ok: false, code: 'unauthenticated' }); return; }
    let decoded;
    try { decoded = await __fbAdmin.auth().verifyIdToken(m[1]); }
    catch (e) { res.status(401).json({ ok: false, code: 'unauthenticated' }); return; }
    const A = __fbAdmin.auth();
    const r = await __AUTHG.checkAccount({
      db: __fbAdmin.firestore(), nowMs: nowMs,
      getUserByEmail: async function (em) { try { const u = await A.getUserByEmail(em); return { uid: u.uid }; } catch (e) { return null; } },
      getUser: async function (uid) { const u = await A.getUser(uid); return { uid: u.uid, creationMs: Date.parse((u.metadata && u.metadata.creationTime) || '') || 0, providers: (u.providerData || []).map(function (p) { return p.providerId; }) }; },
      deleteUser: async function (uid) { await A.deleteUser(uid); }
    }, decoded.uid, decoded.email || '');
    if (r.status === 'error') { res.status(400).json({ ok: false, code: r.code }); return; }
    res.status(200).json(Object.assign({ ok: true }, r));
  } catch (e) {
    console.error('authGuard xatosi', e);
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
/* fix207-clickpay: obuna to'lovi Click'ning o'z sahifasi orqali. Blok SAVDO_CLICK_REDIRECT=1 ni faqat 3 ta Click kaliti Secret Manager'da
   bo'lsa qo'yadi; aks holda bot eski yo'lda (Telegram Payments) ishlayveradi. */
const __CLICKR = !!__TG_SECRET && process.env.SAVDO_CLICK_REDIRECT === '1';
const __CK_SID = __CLICKR ? (CLICK_SERVICE_ID || defineSecret('CLICK_SERVICE_ID')) : null;
const __CK_MID = __CLICKR ? (CLICK_MERCHANT_ID || defineSecret('CLICK_MERCHANT_ID')) : null;
const __CK_KEY = __CLICKR ? (CLICK_SECRET_KEY || defineSecret('CLICK_SECRET_KEY')) : null;
function __clickCfg() {
  if (!__CLICKR) return null;
  try { const sid = String(__CK_SID.value() || '').trim(), mid = String(__CK_MID.value() || '').trim(); return sid && mid ? { serviceId: sid, merchantId: mid } : null; } catch (e) { return null; }
}
const __tgHookSecrets = (__TGPAY_SECRET ? __tgSecrets.concat([__TGPAY_SECRET]) : __tgSecrets).concat(__CLICKR ? [__CK_SID, __CK_MID] : []);   /* fix207-clickpay */
function __tgPayToken() { try { const v = __TGPAY_SECRET ? __TGPAY_SECRET.value() : ''; return v ? String(v).trim() : ''; } catch (e) { return ''; } }
function __tgToken() {
  try { const v = __TG_SECRET ? __TG_SECRET.value() : ''; if (v) return String(v).trim(); } catch (e) {}
  return String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
}
let __tgCache = null;
async function __tgDeps() {
  const token = __tgToken();
  const base = { db: __fbAdmin.firestore(), nowMs: nowMs };
  try { base.messaging = __fbAdmin.messaging(); } catch (e) { base.messaging = null; }   /* fix145-botshop: yangi buyurtma push */
  if (!token) return Object.assign(base, { key: null });
  if (!__tgCache || __tgCache.token !== token) __tgCache = { token: token, key: __TG.keyFromToken(token), tg: __makeTg(token), botName: '' };
  if (!__tgCache.webKey) __tgCache.webKey = require('./src/telegram/shop').webKeyFromToken(token);   /* fix145-botshop */
  if (!__tgCache.botName) {
    try { const me = await __tgCache.tg('getMe', {}); __tgCache.botName = (me && me.username) || ''; }
    catch (e) { console.error('telegram getMe xatosi', e && e.message); }
  }
  return Object.assign(base, { key: __tgCache.key, webKey: __tgCache.webKey, tg: __tgCache.tg, botName: __tgCache.botName, payToken: __tgPayToken(), click: __clickCfg(), genId: function () { return __fbAdmin.firestore().collection('paymentOrders').doc().id; } });   /* fix142-tgpay */
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

/* fix206-tglogin: Telegram orqali kirish (ilova). Kirishda ID token yo'q; ulash/holat/uzishda — ID token majburiy.
   Kirish kaliti (custom token) faqat bot orqali raqam tasdiqlangandan keyin, so'rovni ochgan qurilmaga (poll siri) bir marta beriladi. */
const __TGL = require('./src/telegram/login');
exports.telegramLogin = onRequest({ cors: true, secrets: __tgSecrets }, async function (req, res) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ ok: false, code: 'method-not-allowed' }); return; }
    const A = __fbAdmin.auth();
    let uid = null;
    const m = /^Bearer\s+(.+)$/i.exec(req.get('Authorization') || '');
    if (m) { try { uid = (await A.verifyIdToken(m[1])).uid; } catch (e) { res.status(401).json({ ok: false, code: 'unauthenticated' }); return; } }
    const ip = String(req.get('x-forwarded-for') || req.ip || '').split(',')[0].trim();
    const base = await __tgDeps();
    if (!base.key) { res.status(503).json({ ok: false, code: 'no-bot' }); return; }
    const deps = Object.assign({}, base, {
      createToken: function (u) { return A.createCustomToken(u); },
      createUser: async function (name) { const u = await A.createUser({ displayName: String(name || 'Telegram').slice(0, 64) }); return u.uid; },
      userExists: async function (u) { try { await A.getUser(u); return true; } catch (e) { if (e && e.code === 'auth/user-not-found') return false; throw e; } },
      userProviders: async function (u) { const x = await A.getUser(u); return (x.providerData || []).map(function (p) { return p.providerId; }); },
      deleteUser: function (u) { return A.deleteUser(u); }
    });
    const out = await __TGL.handle(deps, req.body || {}, { uid: uid, ip: ip });
    res.status(out.status || 200).json(out.body);
  } catch (e) {
    console.error('telegramLogin xatosi', e && e.message);
    res.status(500).json({ ok: false, code: 'internal' });
  }
});

/* fix207-clickpay: Click SHOP-API (Prepare/Complete) — bot obunasi uchun. To'liq rejimda (CLICK_ON) yuqoridagi clickWebhook ishlaydi;
   Telegram rejimida (SAVDO_PUSH_ONLY=1 + SAVDO_TG=1 + SAVDO_CLICK_REDIRECT=1) — shu nusxa: xuddi o'sha tekshiruv (imzo, summa, Already paid),
   qo'shimcha: Complete'dan keyin egasiga botda xabar. Javob Click'ga 4 soniyadan kechikmaydi. */
if (!CLICK_ON && __CLICKR) {
  exports.clickWebhook = onRequest({ secrets: [__CK_SID, __CK_KEY].concat(__tgSecrets) }, async function (req, res) {
    let out;
    try {
      out = await handleClick({ db: admin.firestore(), serviceId: String(__CK_SID.value() || '').trim(), secretKey: String(__CK_KEY.value() || '').trim(), nowMs: nowMs }, req.body);
    } catch (e) {
      console.error('clickWebhook xatosi', e);
      res.status(200).json({ error: -7, error_note: 'Failed to update user' }); return;
    }
    try {
      const deps = await __tgDeps();
      await Promise.race([require('./src/telegram/pay').clickAfter(deps, req.body || {}, out), new Promise(function (r) { setTimeout(r, 4000); })]);
    } catch (e) { console.error('clickWebhook xabar', e && e.message); }
    res.status(200).json(out);
  });
}

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
    try { const f = await __TGR.runFiscal(__tgDepsLite()); if (f.alerts || f.errors) console.log('fiscalAlert', JSON.stringify(f)); } catch (e) { console.error('fiscalAlert xatosi', e && e.message); }   /* fix189-fiscal6: soliqqa yuborilmagan cheklar */
    const __tn = new Date(); if ((__tn.getUTCHours() + 5) % 24 === 10 && __tn.getUTCMinutes() < 10) { try { const r = await require('./src/telegram/pay').subRemind(__tgDepsLite(), Date.now()); if (r.sent || r.failed) console.log('subRemind', JSON.stringify(r)); } catch (e) { console.error('subRemind xatosi', e && e.message); }
      try { const r2 = await require('./src/telegram/cust').remindTick(__tgDepsLite(), Date.now()); if (r2.sent) console.log('custRemind', JSON.stringify(r2)); } catch (e) { console.error('custRemind xatosi', e && e.message); } }   /* fix150-subbot; fix155-custbot */
    if (new Date().getMinutes() < 10) { try { const n = await require('./src/telegram/shop').cleanupOld(__tgDepsLite()); if (n) console.log('botShopCleanup', n); } catch (e) { console.error('botShopCleanup xatosi', e && e.message); } }   /* fix145-botshop: 90 kundan eski buyurtmalar */
  } catch (e) { console.error('telegramTick xatosi', e && e.message); }
});
exports.telegramSaleAlert = onDocumentCreated({ document: 'businesses/{bizId}/sales/{saleId}', secrets: __tgSecrets }, async function (event) {
  const snap = event.data;
  if (!snap) return;
  try {
    const r = await __TGR.handleSaleCreated(__tgDepsLite(), event.params.bizId, event.params.saleId, snap.data());
    if (r && r.alert) console.log('telegramSaleAlert', JSON.stringify(r));
    try { const c = await require('./src/telegram/cust').onSale(__tgDepsLite(), event.params.bizId, snap.data()); if (c && c.sent) console.log('custReceipt', event.params.saleId); } catch (e) { console.error('custReceipt xatosi', e && e.message); }   /* fix155-custbot */
  } catch (e) { console.error('telegramSaleAlert xatosi', e && e.message); }
});
/* fix155-custbot: qarz to'lovi — mijozga tasdiq */
exports.telegramLedgerAlert = onDocumentCreated({ document: 'businesses/{bizId}/ledger/{entryId}', secrets: __tgSecrets }, async function (event) {
  const snap = event.data;
  if (!snap) return;
  try { const r = await require('./src/telegram/cust').onLedger(__tgDepsLite(), event.params.bizId, snap.data()); if (r && r.sent) console.log('custPaid', event.params.entryId); } catch (e) { console.error('telegramLedgerAlert xatosi', e && e.message); }
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

/* ---------- fix145-botshop: Telegram mini ilova (bot orqali buyurtma) ----------
   POST — mini ilova so'rovlari (Telegram initData imzosi bilan; Firebase login kerak emas).
   GET ?img=<slug>&p=<mahsulot> — mahsulot rasmi (katalogdagi, faqat "Botda sotilsin" belgilanganlari).
   Yuklash: SAVDO_PUSH_ONLY=1 SAVDO_TG=1 firebase deploy --only functions:telegramShop */
exports.telegramShop = onRequest({ cors: true, secrets: __tgHookSecrets, memory: '512MiB' },   /* fix146-tgsub: obuna to'lovi uchun Click tokeni ham */ async function (req, res) {
  let deps;
  try { deps = await __tgDeps(); } catch (e) { console.error('telegramShop deps', e && e.message); res.status(503).json({ ok: false, code: 'not_configured' }); return; }
  const SH = require('./src/telegram/shop');
  try {
    if (req.method === 'GET') {
      const slug = String((req.query && req.query.img) || ''), pid = String((req.query && req.query.p) || '');
      if (!slug || !pid || !deps.key) { res.status(404).end(); return; }
      const im = await SH.productImage(deps, slug, pid);
      if (!im) { res.status(404).end(); return; }
      res.set('Cache-Control', 'public, max-age=86400');
      if (im.redirect) { res.redirect(302, im.redirect); return; }
      res.set('Content-Type', im.type); res.status(200).send(im.buf); return;
    }
    if (req.method !== 'POST') { res.status(405).json({ ok: false, code: 'method-not-allowed' }); return; }
    const __b = req.body || {};
    const __ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
    const out = /^site[A-Z]/.test(String(__b.action || '')) ? await require('./src/telegram/webshop').handle(deps, __b, { ip: __ip }) : await SH.handleWebApp(deps, __b);   /* fix151-weborder: sayt katalogidan buyurtma */
    res.status(out.status || 200).json(out.body);
  } catch (e) {
    console.error('telegramShop xatosi', e && e.message);
    res.status(500).json({ ok: false, code: 'internal' });
  }
});

/* ---------- fix185-fiscal3: fiskalizatsiya (ixtiyoriy; faqat fx === 1 belgili savdolar) ----------
   fiscalApi      — ilova: send (darhol yuborish), status, open (yuborilmaganlar), retry, ping. Firebase ID token bilan.
   fiscalSaleSync — savdo bulutga yozilganda (oflayn navbatdan ham) — yuborilmagan bo'lsa yuboradi.
   fiscalTick     — har 10 daqiqada: navbatdagi (internet/operator xatosi) cheklarni qayta yuborish.
   Operator kalitlari (B qismi) faqat Secret Manager'da; hozir "mock" (sinov) va boshqalar "sozlanmagan". */
const __FX = require('./src/fiscal/engine');
function __fxDeps() { return { db: __fbAdmin.firestore(), nowMs: nowMs }; }
exports.fiscalApi = onRequest({ cors: true }, async function (req, res) {
  try {
    if (req.method !== 'POST') { res.status(405).json({ ok: false, code: 'method-not-allowed' }); return; }
    const m = /^Bearer\s+(.+)$/i.exec(req.get('Authorization') || '');
    if (!m) { res.status(401).json({ ok: false, code: 'unauthenticated' }); return; }
    let decoded;
    try { decoded = await __fbAdmin.auth().verifyIdToken(m[1]); }
    catch (e) { res.status(401).json({ ok: false, code: 'unauthenticated' }); return; }
    const deps = __fxDeps();
    const caller = await __TG.resolveCaller(deps.db, decoded.uid);
    const out = await __FX.api(deps, caller, req.body || {});
    res.status(out.status || 200).json(out.body);
  } catch (e) {
    console.error('fiscalApi xatosi', e && e.message);
    res.status(500).json({ ok: false, code: 'internal' });
  }
});
exports.fiscalSaleSync = onDocumentCreated({ document: 'businesses/{bizId}/sales/{saleId}' }, async function (event) {
  const snap = event.data;
  if (!snap) return;
  const d = snap.data();
  if (!d || d.fx !== 1) return;   // fiskal rejim o'chiq paytdagi savdo — tegilmaydi
  try { const r = await __FX.onSaleCreated(__fxDeps(), event.params.bizId, event.params.saleId, d); if (r && r.status !== 'skip') console.log('fiscalSale', event.params.saleId, r.status); }
  catch (e) { console.error('fiscalSaleSync xatosi', e && e.message); }
});
exports.fiscalTick = onSchedule({ schedule: 'every 10 minutes', timeZone: 'Asia/Tashkent' }, async function () {
  try { const r = await __FX.retryTick(__fxDeps()); if (r.tried) console.log('fiscalTick', JSON.stringify(r)); }
  catch (e) { console.error('fiscalTick xatosi', e && e.message); }
});

/* ---------- fix186-fiscal4: qaytarish, chekni tahrirlash, o'chirish, qarz to'lovi («Кредит» cheki) ----------
   fiscalSaleChange — savdo o'zgarganda/o'chirilganda (yaratilish — fiscalSaleSync). fx bo'lmasa hech narsa o'qilmaydi.
   fiscalLedgerSync — qarz to'lovi yozilganda (faqat fiskal rejimda belgilangan haqiqiy to'lovlar). */
exports.fiscalSaleChange = onDocumentWritten({ document: 'businesses/{bizId}/sales/{saleId}' }, async function (event) {
  const ch = event.data;
  if (!ch) return;
  const before = ch.before && ch.before.exists ? ch.before.data() : null;
  const after = ch.after && ch.after.exists ? ch.after.data() : null;
  if (!before) return;
  if (!((before && before.fx === 1) || (after && after.fx === 1))) return;
  try { const r = await __FX.onSaleWritten(__fxDeps(), event.params.bizId, event.params.saleId, before, after); if (r && r.status !== 'skip') console.log('fiscalSaleChange', event.params.saleId, r.status); }
  catch (e) { console.error('fiscalSaleChange xatosi', e && e.message); }
});
exports.fiscalLedgerSync = onDocumentCreated({ document: 'businesses/{bizId}/ledger/{entryId}' }, async function (event) {
  const snap = event.data;
  if (!snap) return;
  const d = snap.data();
  if (!d || d.fx !== 1) return;
  try { const r = await __FX.onLedgerCreated(__fxDeps(), event.params.bizId, event.params.entryId, d); if (r && r.status !== 'skip') console.log('fiscalLedger', event.params.entryId, r.status); }
  catch (e) { console.error('fiscalLedgerSync xatosi', e && e.message); }
});
