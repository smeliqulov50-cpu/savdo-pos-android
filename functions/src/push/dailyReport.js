'use strict';
/* Savdo Pos: kunlik hisobot push'lari — ega belgilagan vaqtda (Sozlamalar > Biznes > "Kunlik hisobot vaqti").
   Har 10 daqiqada ishlaydi; har bir biznes uchun o'sha biznesning o'z soat poyasi va o'z vaqti tekshiriladi.
   Vaqti kelgan biznesning ega/admin qurilmalariga:
     1) qarz hisoboti eslatmasi (telefonning ichki eslatmasi YO'Q qurilmalarga — u allaqachon o'zi eslatadi),
     2) "Kunlik xulosa" — bugungi sotuv, foyda, xarajat, jami qarz.
   Kuniga bir marta (businesses/{id}/meta/dailyReport.date belgisi bilan). Sof mantiq: firebase kutubxonasiga bog'liq emas. */
const { sendToTokenDocs, fmtMoney } = require('./notify');

const DEFAULT_TZ = 'Asia/Tashkent';
const REPORT_MIN = 12 * 60, REPORT_MAX = 23 * 60, REPORT_DEFAULT = 21 * 60;
const WINDOW_MIN = 120;   // vaqti kelgandan keyin shuncha daqiqa ichida yuboriladi (server kechikib qolsa ham)

function reportMinutes(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v == null ? '' : v));
  if (!m) return REPORT_DEFAULT;
  const x = Number(m[1]) * 60 + Number(m[2]);
  if (!isFinite(x)) return REPORT_DEFAULT;
  return Math.max(REPORT_MIN, Math.min(REPORT_MAX, x));
}
function validTz(z) {
  if (!z || typeof z !== 'string') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: z }); return true; } catch (e) { return false; }
}
function partsIn(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = {};
  f.formatToParts(date).forEach(function (p) { if (p.type !== 'literal') o[p.type] = Number(p.value); });
  return o;
}
function offsetMs(date, tz) { const p = partsIn(date, tz); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000; }
/* {ymd, minutes, startIso, endIso} — "bugun" shu soat poyasi bo'yicha */
function dayInfo(now, tz) {
  const p = partsIn(now, tz);
  const ymd = p.year + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');
  function startOf(y, m, d) {
    const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
    const off1 = offsetMs(new Date(guess - offsetMs(now, tz)), tz);
    return new Date(guess - off1);
  }
  const start = startOf(p.year, p.month, p.day);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const end = startOf(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  return { ymd: ymd, minutes: p.hour * 60 + p.minute, startIso: start.toISOString(), endIso: end.toISOString() };
}

/* ---- mijoz ilovadagi formulalar bilan bir xil ---- */
function saleItemProfit(it) {
  const cost = it.saleMode === 'box' ? (it.costPrice || 0) * (it.unitsPerBox || 1) : (it.costPrice || 0);
  return ((it.price || 0) - cost) * (it.qty || 0);
}
function saleProfit(s) {
  const items = Array.isArray(s.items) ? s.items : [];
  return items.reduce(function (a, it) { return a + saleItemProfit(it); }, 0) - (s.discountAmount || 0) - (s.bonusUsed || 0) + (s.serviceChargeAmount || 0) + (s.deliveryFee || 0);
}
function breakdown(s) {
  const out = { cash: 0, card: 0, credit: 0 };
  if (Array.isArray(s.splitPayments) && s.splitPayments.length) s.splitPayments.forEach(function (p) { out[p.method] = (out[p.method] || 0) + (Number(p.amount) || 0); });
  else out[s.paymentType] = (out[s.paymentType] || 0) + (Number(s.total) || 0);
  return out;
}
function docsOf(snap) { return (snap && snap.docs ? snap.docs : []).map(function (d) { return d.data() || {}; }); }

async function computeSummary(db, bizId, day) {
  const biz = db.collection('businesses').doc(bizId);
  const range = function (col, field) { return biz.collection(col).where(field, '>=', day.startIso).where(field, '<', day.endIso).get(); };
  const res = await Promise.all([range('sales', 'date'), range('sales', 'refundedAt'), range('expenses', 'date'), range('ledger', 'date'), biz.collection('customers').get()]);
  const sales = docsOf(res[0]).filter(function (s) { return !s.refunded && Array.isArray(s.items); });
  const refunds = docsOf(res[1]).filter(function (s) { return s.refunded; });
  let revenue = 0, profit = 0, cash = 0, card = 0, credit = 0;
  sales.forEach(function (s) {
    revenue += Number(s.total) || 0; profit += saleProfit(s);
    const b = breakdown(s); cash += b.cash || 0; card += b.card || 0; credit += b.credit || 0;
  });
  const expenses = docsOf(res[2]).filter(function (x) { return x.category !== 'purchase'; }).reduce(function (a, x) { return a + (Number(x.amount) || 0); }, 0);
  const debtPaid = docsOf(res[3]).filter(function (e) { return e.type === 'payment' && e.method; }).reduce(function (a, e) { return a + (Number(e.amount) || 0); }, 0);
  let totalDebt = 0;
  docsOf(res[4]).forEach(function (c) { if (!c.hidden && c.debt > 0) totalDebt += Number(c.debt) || 0; });
  return {
    count: sales.length, revenue: revenue, cash: cash, card: card, credit: credit, profit: profit, expenses: expenses, net: profit - expenses,
    debtPaid: debtPaid, refundCount: refunds.length, refundTotal: refunds.reduce(function (a, s) { return a + (Number(s.total) || 0); }, 0), totalDebt: totalDebt
  };
}

/* ---- matnlar ---- */
function unit(lang, cur) {
  if (cur && cur !== 'UZS') return cur;
  return { uz: "so'm", ru: 'сум', en: 'UZS', kk: 'сом', ky: 'сом', tg: 'сомонӣ' }[lang] || "so'm";
}
const SUM_TEXT = {
  uz: { title: 'Kunlik xulosa', body: function (d, u, f) { return 'Sotuv: ' + f(d.revenue) + ' ' + u + ' (' + d.count + ' ta chek). Foyda: ' + f(d.profit) + '. Xarajat: ' + f(d.expenses) + '. Sof foyda: ' + f(d.net) + '. Jami qarz: ' + f(d.totalDebt) + '.'; }, none: 'Bugun hali sotuv bo\'lmadi. Jami qarz: ' },
  ru: { title: 'Итоги дня', body: function (d, u, f) { return 'Продажи: ' + f(d.revenue) + ' ' + u + ' (чеков: ' + d.count + '). Прибыль: ' + f(d.profit) + '. Расходы: ' + f(d.expenses) + '. Чистая: ' + f(d.net) + '. Общий долг: ' + f(d.totalDebt) + '.'; }, none: 'Сегодня продаж ещё не было. Общий долг: ' },
  en: { title: "Today's summary", body: function (d, u, f) { return 'Sales: ' + f(d.revenue) + ' ' + u + ' (' + d.count + ' receipts). Profit: ' + f(d.profit) + '. Expenses: ' + f(d.expenses) + '. Net: ' + f(d.net) + '. Total debt: ' + f(d.totalDebt) + '.'; }, none: 'No sales yet today. Total debt: ' },
  kk: { title: 'Күн қорытындысы', body: function (d, u, f) { return 'Сатылым: ' + f(d.revenue) + ' ' + u + ' (' + d.count + ' чек). Пайда: ' + f(d.profit) + '. Шығын: ' + f(d.expenses) + '. Таза: ' + f(d.net) + '. Жалпы қарыз: ' + f(d.totalDebt) + '.'; }, none: 'Бүгін әлі сатылым болмады. Жалпы қарыз: ' },
  ky: { title: 'Күндүн жыйынтыгы', body: function (d, u, f) { return 'Сатуу: ' + f(d.revenue) + ' ' + u + ' (' + d.count + ' чек). Пайда: ' + f(d.profit) + '. Чыгым: ' + f(d.expenses) + '. Таза: ' + f(d.net) + '. Жалпы карыз: ' + f(d.totalDebt) + '.'; }, none: 'Бүгүн азырынча сатуу болгон жок. Жалпы карыз: ' },
  tg: { title: 'Хулосаи рӯз', body: function (d, u, f) { return 'Фурӯш: ' + f(d.revenue) + ' ' + u + ' (' + d.count + ' чек). Фоида: ' + f(d.profit) + '. Хароҷот: ' + f(d.expenses) + '. Софӣ: ' + f(d.net) + '. Қарзи умумӣ: ' + f(d.totalDebt) + '.'; }, none: 'Имрӯз ҳанӯз фурӯш нашуд. Қарзи умумӣ: ' }
};
const DEBT_TEXT = {
  uz: { title: 'Kunlik qarz hisoboti', body: function (t, u) { return 'Bugungi jami qarz: ' + t + ' ' + u + '. Hisobotni yuklab oling.'; } },
  ru: { title: 'Ежедневный отчёт по долгам', body: function (t, u) { return 'Общий долг на сегодня: ' + t + ' ' + u + '. Скачайте отчёт.'; } },
  en: { title: 'Daily debt report', body: function (t, u) { return "Today's total debt: " + t + ' ' + u + '. Download the report.'; } },
  kk: { title: 'Күнделікті қарыз есебі', body: function (t, u) { return 'Бүгінгі жалпы қарыз: ' + t + ' ' + u + '. Есепті жүктеп алыңыз.'; } },
  ky: { title: 'Күндөлүк карыз отчёту', body: function (t, u) { return 'Бүгүнкү жалпы карыз: ' + t + ' ' + u + '. Отчётту жүктөп алыңыз.'; } },
  tg: { title: 'Ҳисоботи рӯзонаи қарз', body: function (t, u) { return 'Қарзи умумии имрӯза: ' + t + ' ' + u + '. Ҳисоботро боргирӣ кунед.'; } }
};
function byLang(tokens) {
  const g = {};
  tokens.forEach(function (t) { const l = SUM_TEXT[t.lang] ? t.lang : 'uz'; (g[l] = g[l] || []).push(t); });
  return g;
}
function tokenDocsOf(snap) {
  return snap.docs.map(function (d) {
    const x = d.data() || {};
    return { token: x.token || d.id, sound: x.sound, admin: x.admin, debtDaily: x.debtDaily, localDebt: x.localDebt, lang: x.lang, ref: d.ref, bizId: d.ref && d.ref.parent && d.ref.parent.parent ? d.ref.parent.parent.id : null };
  });
}

async function handleDailyReports(deps, now) {
  now = now || new Date();
  const db = deps.db;
  const snap = await db.collectionGroup('pushTokens').get();
  const byBiz = {};
  tokenDocsOf(snap).forEach(function (t) {
    if (!t.bizId || t.admin !== true || t.debtDaily === false) return;   // faqat ega/admin; ularning eslatma sozlamasi o'chirilmagan bo'lsa
    (byBiz[t.bizId] = byBiz[t.bizId] || []).push(t);
  });
  const st = { businesses: 0, notDue: 0, alreadySent: 0, summarySent: 0, debtSent: 0, failed: 0, removed: 0, errors: 0 };
  const ids = Object.keys(byBiz);
  for (let i = 0; i < ids.length; i++) {
    const bizId = ids[i];
    try {
      const bdoc = await db.collection('businesses').doc(bizId).get();
      const bd = (bdoc && bdoc.exists !== false && bdoc.data && bdoc.data()) || {};
      const tz = validTz(bd.timeZone) ? bd.timeZone : DEFAULT_TZ;
      const rm = reportMinutes(bd.dailyReportTime);
      const day = dayInfo(now, tz);
      if (day.minutes < rm || day.minutes >= rm + WINDOW_MIN) { st.notDue++; continue; }
      const markRef = db.collection('businesses').doc(bizId).collection('meta').doc('dailyReport');
      const mk = await markRef.get();
      if (mk && mk.exists !== false && mk.data && (mk.data() || {}).date === day.ymd) { st.alreadySent++; continue; }
      await markRef.set({ date: day.ymd, sentAt: now.toISOString() }, { merge: true });   // avval belgilanadi: ikki marta yuborilmasin
      st.businesses++;
      const d = await computeSummary(db, bizId, day);
      const cur = bd.currency || 'UZS';
      const groups = byLang(byBiz[bizId]);
      const langs = Object.keys(groups);
      for (let j = 0; j < langs.length; j++) {
        const l = langs[j], toks = groups[l], u = unit(l, cur);
        // 1) kunlik xulosa — hamma ega/admin qurilmalariga
        const T = SUM_TEXT[l];
        const body = d.count || d.expenses || d.debtPaid ? T.body(d, u, fmtMoney) : (T.none + fmtMoney(d.totalDebt) + ' ' + u + '.');
        const r1 = await sendToTokenDocs(deps.messaging, toks, { title: T.title, body: body, channel: 'reminders', data: { type: 'dailySummary', revenue: Math.round(d.revenue), profit: Math.round(d.profit) } });
        st.summarySent += r1.sent; st.failed += r1.failed; st.removed += r1.removed;
        // 2) qarz eslatmasi — telefonning o'z eslatmasi yo'q qurilmalarga, qarz bo'lsa
        if (d.totalDebt > 0) {
          const plain = toks.filter(function (t) { return t.localDebt !== true; });
          if (plain.length) {
            const D = DEBT_TEXT[l];
            const r2 = await sendToTokenDocs(deps.messaging, plain, { title: D.title, body: D.body(fmtMoney(d.totalDebt), u), channel: 'reminders', data: { type: 'debtReport', total: Math.round(d.totalDebt) } });
            st.debtSent += r2.sent; st.failed += r2.failed; st.removed += r2.removed;
          }
        }
      }
    } catch (e) { st.errors++; console.error('dailyReport xatosi', ids[i], e && e.message); }
  }
  return st;
}

module.exports = { handleDailyReports, computeSummary, dayInfo, reportMinutes, validTz, saleProfit, breakdown, SUM_TEXT, DEBT_TEXT, REPORT_DEFAULT, WINDOW_MIN };
