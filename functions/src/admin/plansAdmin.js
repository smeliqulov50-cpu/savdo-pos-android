'use strict';
/* fix203: Super admin API. Faqat superadmin UID (Firebase ID token serverda tekshiriladi). Har o'zgarish adminLog ga (kim, qachon, eski -> yangi).
   1-bosqich (fix203-plans): tariflar — config/plans. Yangi narx faqat YANGI buyurtmalarga; ochiq buyurtmalar o'z summasi bilan.
   2-bosqich (fix203-promo): aksiyalar va promokodlar — config/promos; sovg'a kunlari; sinov muddati (config/plans.trialDays).
   3-bosqich (fix203-dash): statistika (adminStats/current) va obuna eslatmasi (yordam chati orqali — push bilan).
   MAXFIYLIK: savdo, mijoz, qarz ma'lumotlari bu yerda o'qilmaydi. */
const PL = require('../domain/plans');
const PR = require('../domain/promos');
const PRICING = require('../app/pricing');
const { readExpiryMs } = require('../domain/subscription');
const DAY = 86400000;

function ok(body) { return { status: 200, body: Object.assign({ ok: true }, body || {}) }; }
function err(status, code, extra) { return { status: status, body: Object.assign({ ok: false, code: code }, extra || {}) }; }
function summary(plans) {
  const o = {};
  PL.PLAN_KEYS.forEach(function (k) { const p = plans[k]; o[k] = { price: p.price, months: p.months, active: p.active, best: !!p.best, order: p.order, name: p.name || null }; });
  return o;
}
function isInt(v, lo, hi) { return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi; }
function trialOf(raw) { return raw && isInt(raw.trialDays, 3, 60) ? raw.trialDays : 15; }
async function logOf(db, actions, n) {
  const out = [];
  for (let i = 0; i < actions.length; i++) { const s = await db.collection('adminLog').where('action', '==', actions[i]).get(); s.docs.forEach(function (d) { out.push(d.data()); }); }
  return out.sort(function (a, b) { return (b.atMs || 0) - (a.atMs || 0); }).slice(0, n || 30);
}
const REMIND = {
  uz: "Hurmatli mijoz, «{shop}» obunasi {date} da tugaydi. Ish to'xtamasligi uchun obunani uzaytiring: Sozlamalar → Obuna yoki Telegram botda /obuna.",
  ru: "Уважаемый клиент, подписка «{shop}» заканчивается {date}. Чтобы работа не остановилась, продлите подписку: Настройки → Подписка или /obuna в Telegram-боте.",
  en: "Dear customer, the «{shop}» subscription ends on {date}. To keep working without a stop, renew it: Settings → Subscription or /obuna in the Telegram bot.",
  kk: "Құрметті клиент, «{shop}» жазылымы {date} күні аяқталады. Жұмыс тоқтамауы үшін жазылымды ұзартыңыз: Баптаулар → Жазылым немесе Telegram ботта /obuna.",
  ky: "Урматтуу кардар, «{shop}» жазылуусу {date} күнү бүтөт. Иш токтобошу үчүн жазылууну узартыңыз: Жөндөөлөр → Жазылуу же Telegram ботто /obuna.",
  tg: "Мизоҷи гиромӣ, обунаи «{shop}» {date} ба охир мерасад. Барои қатъ нашудани кор обунаро дароз кунед: Танзимот → Обуна ё /obuna дар боти Telegram."
};
function fmtDate(ms) { const d = new Date(ms + 5 * 3600000); return String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear(); }

async function handleAdmin(deps, caller, body) {
  const db = deps.db;
  body = body || {};
  if (!caller || !caller.uid || caller.uid !== deps.superUid) return err(403, 'forbidden');
  const action = String(body.action || '');
  const now = deps.nowMs();
  const who = { uid: caller.uid, email: caller.email || '' };
  const writeLog = function (tx, o) { const doc = Object.assign({ atMs: now, at: new Date(now).toISOString(), uid: who.uid, email: who.email }, o); if (tx) tx.set(db.collection('adminLog').doc(deps.genId()), doc); else return db.collection('adminLog').doc(deps.genId()).set(doc); };

  if (action === 'plansGet') {
    const snap = await db.collection('config').doc('plans').get();
    const raw = snap.exists ? snap.data() : null;
    const cfg = PL.normalizeConfig(raw);
    const log = (await logOf(db, ['plans.set'])).map(function (l) { return { atMs: l.atMs, by: l.email || l.uid, before: l.before, after: l.after }; });
    return ok({ cfg: { plans: summary(cfg.plans), version: cfg.version, updatedAtMs: cfg.updatedAtMs, source: cfg.source, trialDays: trialOf(raw) }, defaults: summary(PL.defaults()), limits: PL.LIMITS, log: log });
  }
  if (action === 'plansSet') {
    const v = PL.validateSet(body.plans);
    if (v.error) return err(400, v.error, { plan: v.plan || null });
    const ref = db.collection('config').doc('plans');
    const res = await db.runTransaction(async function (tx) {
      const s = await tx.get(ref);
      const raw = s.exists ? s.data() : null;
      const cur = PL.normalizeConfig(raw);
      if (typeof body.version === 'number' && body.version !== cur.version) return { conflict: true, version: cur.version };
      const before = summary(cur.plans), after = summary(v.plans);
      if (JSON.stringify(before) === JSON.stringify(after)) return { same: true, version: cur.version };
      const version = cur.version + 1;
      tx.set(ref, { plans: v.plans, version: version, updatedAtMs: now, updatedAt: new Date(now).toISOString(), updatedBy: who, trialDays: trialOf(raw) });
      writeLog(tx, { action: 'plans.set', before: before, after: after, version: version });
      return { version: version };
    });
    if (res.conflict) return err(409, 'conflict', { version: res.version });
    PL.clearPlansCache(db);
    return ok({ version: res.version, same: !!res.same });
  }
  if (action === 'trialSet') {
    if (!isInt(body.days, 3, 60)) return err(400, 'bad-days');
    const ref = db.collection('config').doc('plans');
    const r = await db.runTransaction(async function (tx) {
      const s = await tx.get(ref); const raw = s.exists ? s.data() : {};
      const before = trialOf(raw); if (before === body.days) return { same: true };
      tx.set(ref, { trialDays: body.days }, { merge: true });
      writeLog(tx, { action: 'trial.set', before: before, after: body.days });
      return {};
    });
    return ok({ same: !!r.same, trialDays: body.days });
  }
  if (action === 'promosGet') {
    const s = await db.collection('config').doc('promos').get();
    const cfg = PR.normalizeConfig(s.exists ? s.data() : null);
    const usage = {};
    const ids = cfg.promos.map(function (p) { return p.id; }).concat(cfg.codes.map(function (c) { return c.id; }));
    for (let i = 0; i < ids.length; i++) { const u = await db.collection('promoUsage').doc(ids[i]).get(); usage[ids[i]] = u.exists ? (u.data().count || 0) : 0; }
    const log = (await logOf(db, ['promos.set', 'gift.days', 'trial.set'])).map(function (l) { return { atMs: l.atMs, by: l.email || l.uid, action: l.action, summary: l.summary || null, days: l.days, count: l.count, reason: l.reason, before: l.action === 'trial.set' ? l.before : undefined, after: l.action === 'trial.set' ? l.after : undefined }; });
    const ps = await db.collection('config').doc('plans').get();
    return ok({ cfg: cfg, usage: usage, log: log, trialDays: trialOf(ps.exists ? ps.data() : null), nowMs: now });
  }
  if (action === 'promosSet') {
    const v = PR.validateConfig({ promos: body.promos, codes: body.codes });
    if (v.error) return err(400, v.error, { index: v.index == null ? null : v.index, kind: v.kind || null });
    const ref = db.collection('config').doc('promos');
    const res = await db.runTransaction(async function (tx) {
      const s = await tx.get(ref);
      const cur = PR.normalizeConfig(s.exists ? s.data() : null);
      if (typeof body.version === 'number' && body.version !== cur.version) return { conflict: true, version: cur.version };
      if (JSON.stringify({ p: cur.promos, c: cur.codes }) === JSON.stringify({ p: v.promos, c: v.codes })) return { same: true, version: cur.version };
      const version = cur.version + 1;
      tx.set(ref, { promos: v.promos, codes: v.codes, version: version, updatedAtMs: now, updatedBy: who });
      const names = function (a) { return a.map(function (x) { return x.name || x.code; }); };
      writeLog(tx, { action: 'promos.set', version: version, before: { promos: cur.promos, codes: cur.codes }, after: { promos: v.promos, codes: v.codes },
        summary: { promos: names(v.promos), codes: names(v.codes), removed: names(cur.promos.concat(cur.codes).filter(function (x) { return !v.promos.concat(v.codes).some(function (y) { return y.id === x.id; }); })) } });
      return { version: version };
    });
    if (res.conflict) return err(409, 'conflict', { version: res.version });
    PRICING.clearPromosCache(db);
    return ok({ version: res.version, same: !!res.same });
  }
  if (action === 'giftDays') {
    const days = body.days, reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';
    if (!isInt(days, 1, 365)) return err(400, 'bad-days');
    if (reason.length < 3) return err(400, 'need-reason');
    let ids;
    if (body.target === 'all') ids = (await db.collection('businesses').get()).docs.map(function (d) { return d.id; });
    else if (Array.isArray(body.bizIds) && body.bizIds.length && body.bizIds.length <= 500 && body.bizIds.every(function (x) { return /^[A-Za-z0-9_-]{6,64}$/.test(String(x)); })) ids = Array.from(new Set(body.bizIds.map(String)));
    else return err(400, 'bad-target');
    let n = 0, skipped = 0;
    for (let i = 0; i < ids.length; i++) {
      const ref = db.collection('businesses').doc(ids[i]);
      const r = await db.runTransaction(async function (tx) {
        const s = await tx.get(ref); if (!s.exists) return { skip: true };
        const exp = readExpiryMs(s.data()); if (!exp) return { skip: true };   // muddatsiz (cheksiz) — tegilmaydi
        const ne = Math.max(exp, now) + days * DAY;
        tx.set(ref, { subscriptionExpiresAtMs: ne, subscriptionExpiresAt: new Date(ne).toISOString() }, { merge: true });
        return {};
      });
      if (r.skip) skipped++; else n++;
    }
    await writeLog(null, { action: 'gift.days', days: days, reason: reason, target: body.target === 'all' ? 'all' : 'list', bizIds: body.target === 'all' ? null : ids, count: n, skipped: skipped });
    return ok({ count: n, skipped: skipped });
  }
  if (action === 'statsGet') {
    const ref = db.collection('adminStats').doc('current');
    const s = await ref.get();
    let st = s.exists ? s.data() : null;
    if (!st || body.refresh === true || now - (st.atMs || 0) > 6 * 3600 * 1000) {
      st = await deps.computeStats(db, now);
      await ref.set(st);
    }
    return ok({ stats: st });
  }
  if (action === 'remind') {
    if (!Array.isArray(body.bizIds) || !body.bizIds.length || body.bizIds.length > 200 || !body.bizIds.every(function (x) { return /^[A-Za-z0-9_-]{6,64}$/.test(String(x)); })) return err(400, 'bad-target');
    let n = 0;
    for (let i = 0; i < body.bizIds.length; i++) {
      const id = String(body.bizIds[i]);
      const s = await db.collection('businesses').doc(id).get(); if (!s.exists) continue;
      const b = s.data(); const exp = readExpiryMs(b); if (!exp) continue;
      const lang = REMIND[b.language] ? b.language : (REMIND[b.receiptLanguage] ? b.receiptLanguage : 'uz');
      const text = REMIND[lang].split('{shop}').join(String(b.businessName || 'Savdo Pos')).split('{date}').join(fmtDate(exp));
      const mid = deps.genId();
      await db.collection('businesses').doc(id).collection('support').doc(mid).set({ id: mid, text: text, from: 'admin', auto: false, kind: 'subRemind', businessName: String(b.businessName || ''), email: '', date: new Date(now).toISOString() });
      n++;
    }
    await writeLog(null, { action: 'remind.send', count: n, bizIds: body.bizIds.map(String) });
    return ok({ count: n });
  }
  return err(400, 'bad-action');
}

/* Yangi biznes yaratilganda (trigger): sinov muddati paneldagi qiymatga (config/plans.trialDays) to'g'rilanadi, yaratilgan vaqt yoziladi.
   Admin SDK — Firestore qoidalarini chetlab o'tadi, shuning uchun ilova 15 kun bilan yaratsa ham server to'g'rilaydi. */
async function onBusinessCreated(deps, bizId, data) {
  const db = deps.db, now = deps.nowMs();
  if (!data || typeof data !== 'object') return { skipped: 'no-data' };
  const patch = {};
  if (typeof data.createdAtMs !== 'number') patch.createdAtMs = now;
  if (data.subscriptionPlan === 'trial') {
    let raw = null; try { const s = await db.collection('config').doc('plans').get(); raw = s.exists ? s.data() : null; } catch (e) {}
    const days = trialOf(raw);
    const want = now + days * DAY, cur = readExpiryMs(data);
    if (Math.abs(want - cur) > 3600 * 1000) { patch.subscriptionExpiresAtMs = want; patch.subscriptionExpiresAt = new Date(want).toISOString(); patch.trialDays = days; }
  }
  if (!Object.keys(patch).length) return { skipped: 'ok' };
  await db.collection('businesses').doc(bizId).set(patch, { merge: true });
  return { patched: Object.keys(patch) };
}

module.exports = { handleAdmin, onBusinessCreated, trialOf };
