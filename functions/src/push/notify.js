'use strict';
/* Savdo Pos: ovozli push xabarlar (FCM). Sof mantiq — firebase kutubxonalariga bog'liq EMAS, shuning uchun alohida sinaladi.
   Android'da ovoz BILDIRISHNOMA KANALIDAN keladi (ilova 'support', 'reminders', 'quiet' kanallarini yaratadi):
     support / reminders  — standart bildirishnoma ovozi (SMS kelgandagidek) + qalqib chiqadi
     quiet                — ovozsiz (qurilmada "Bildirishnoma ovozi" o'chirilgan bo'lsa) */

const INVALID_TOKEN_CODES = ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token', 'messaging/invalid-argument'];

function strData(d) {
  const out = {};
  Object.keys(d || {}).forEach(function (k) { if (d[k] !== undefined && d[k] !== null) out[k] = String(d[k]); });
  return out;
}

function clip(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/* token = {token, sound?}; o = {title, body, channel, data} */
function buildMessage(token, o) {
  const quiet = token.sound === false;
  const android = {
    priority: 'high',
    notification: {
      channelId: quiet ? 'quiet' : o.channel,
      priority: quiet ? 'low' : 'high',
      defaultVibrateTimings: !quiet
    }
  };
  if (!quiet) { android.notification.sound = 'default'; android.notification.defaultSound = true; }
  return {
    token: token.token,
    notification: { title: clip(o.title, 80), body: clip(o.body, 180) },
    data: strData(o.data),
    android: android,
    webpush: { notification: { icon: '/icon-192.png', requireInteraction: false, silent: quiet } }
  };
}

/* Yuborish + yaroqsiz tokenlarni tozalash. docs: [{token, sound, ref:{delete()}}] */
async function sendToTokenDocs(messaging, docs, o) {
  const list = docs.filter(function (d) { return d && d.token; });
  if (!list.length) return { sent: 0, failed: 0, removed: 0 };
  const res = await messaging.sendEach(list.map(function (d) { return buildMessage(d, o); }));
  let removed = 0;
  const jobs = [];
  (res.responses || []).forEach(function (r, i) {
    if (!r.success && r.error && INVALID_TOKEN_CODES.indexOf(r.error.code) !== -1 && list[i].ref && list[i].ref.delete) {
      removed++; jobs.push(list[i].ref.delete().catch(function () {}));
    }
  });
  await Promise.all(jobs);
  return { sent: res.successCount || 0, failed: res.failureCount || 0, removed: removed };
}

function tokenDocsOf(snap) {
  return snap.docs.map(function (d) {
    const x = d.data() || {};
    return { token: x.token || d.id, sound: x.sound, admin: x.admin, debtDaily: x.debtDaily, localDebt: x.localDebt, lang: x.lang, ref: d.ref, bizId: d.ref && d.ref.parent && d.ref.parent.parent ? d.ref.parent.parent.id : null };
  });
}

/* ---------- 1) Yordam chati: yangi xabar ---------- */
async function handleSupportMessage(deps, bizId, msg) {
  if (!msg || !msg.text) return { skipped: 'empty' };
  const db = deps.db;
  if (msg.from === 'business') {
    const snap = await db.collection('superAdminTokens').get();
    return sendToTokenDocs(deps.messaging, tokenDocsOf(snap), {
      title: msg.businessName || 'Savdo Pos', body: msg.text, channel: 'support',
      data: { type: 'support', bizId: bizId, from: 'business' }
    });
  }
  if (msg.from === 'admin') {
    const snap = await db.collection('businesses').doc(bizId).collection('pushTokens').get();
    return sendToTokenDocs(deps.messaging, tokenDocsOf(snap), {
      title: 'Savdo Pos', body: msg.text, channel: 'support',
      data: { type: 'support', bizId: bizId, from: 'admin' }
    });
  }
  return { skipped: 'from' };
}

/* ---------- 2) Kunlik qarz hisoboti eslatmasi ---------- */
function fmtMoney(n) {
  const s = String(Math.round(Math.abs(n)));
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
const DEBT_TEXT = {
  uz: { title: 'Kunlik qarz hisoboti', body: function (t) { return 'Bugungi jami qarz: ' + t + " so'm. Hisobotni yuklab oling."; } },
  ru: { title: 'Ежедневный отчёт по долгам', body: function (t) { return 'Общий долг на сегодня: ' + t + ' сум. Скачайте отчёт.'; } },
  en: { title: 'Daily debt report', body: function (t) { return "Today's total debt: " + t + ' UZS. Download the report.'; } }
};

async function handleDailyDebt(deps) {
  const db = deps.db;
  const snap = await db.collectionGroup('pushTokens').get();
  const byBiz = {};
  tokenDocsOf(snap).forEach(function (t) {
    if (!t.bizId || t.admin !== true || t.debtDaily === false || t.localDebt === true) return;   // faqat ega/admin qurilmalari
    (byBiz[t.bizId] = byBiz[t.bizId] || []).push(t);
  });
  const stats = { businesses: 0, sent: 0, failed: 0, removed: 0, skippedNoDebt: 0 };
  const ids = Object.keys(byBiz);
  for (let i = 0; i < ids.length; i++) {
    const bizId = ids[i];
    const cs = await db.collection('businesses').doc(bizId).collection('customers').get();
    let total = 0;
    cs.docs.forEach(function (d) { const c = d.data() || {}; if (!c.hidden && c.debt > 0) total += Number(c.debt) || 0; });
    if (total <= 0) { stats.skippedNoDebt++; continue; }
    stats.businesses++;
    const groups = {};
    byBiz[bizId].forEach(function (t) { const l = DEBT_TEXT[t.lang] ? t.lang : 'uz'; (groups[l] = groups[l] || []).push(t); });
    const langs = Object.keys(groups);
    for (let j = 0; j < langs.length; j++) {
      const L = DEBT_TEXT[langs[j]];
      const r = await sendToTokenDocs(deps.messaging, groups[langs[j]], {
        title: L.title, body: L.body(fmtMoney(total)), channel: 'reminders', data: { type: 'debtReport', total: Math.round(total) }
      });
      stats.sent += r.sent; stats.failed += r.failed; stats.removed += r.removed;
    }
  }
  return stats;
}

module.exports = { buildMessage, sendToTokenDocs, handleSupportMessage, handleDailyDebt, fmtMoney };
