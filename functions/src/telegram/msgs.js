'use strict';
/* fix121-tg2: Telegram bot xabarlari (2-bosqich) — kunlik hisobot, smena, kam qolgan tovar, katta chegirma, chek o'chirish/qaytarish.
   6 til. Atamalar ilovadagi tarjimalar bilan bir xil. HTML (parse_mode=HTML): har bir tashqi qiymat esc() dan o'tadi. */
const { esc } = require('./texts');

const L = {
  uz: {
    daily: 'Kunlik hisobot', soFar: 'hozirgacha', sales: 'Sotuv', receipts: 'Cheklar', profit: 'Foyda', expenses: 'Xarajatlar', net: 'Sof foyda',
    cash: 'Naqd', card: 'Karta', credit: 'Nasiya', refunds: 'Qaytarilgan', debtPaid: "Qarzga to'lovlar", totalDebt: 'Umumiy qarzlar',
    top: "Ko'p sotilgan mahsulotlar", branches: 'Filiallar', noSales: "Bugun hali savdo bo'lmadi.",
    shiftClosed: 'Smena yopildi', autoClosed: 'avtomatik yopildi', cashier: 'Kassir', branch: 'Filial', total: 'Jami', discounts: 'Chegirmalar',
    expected: "Kassada bo'lishi kerak", counted: 'Sanab kiritildi', diff: 'Farq', diffNone: "Farq yo'q", short: 'kam', over: 'ortiqcha',
    low: 'Kam qolgan tovarlar', threshold: 'Kam qoldi chegarasi', autoRule: 'Qoida: {d} kunlik savdoga yetmasa', thresholdFb: 'Sotilmagan tovarlar uchun chegara', out: 'tugagan', more: '… yana {n} ta', lowNone: "Kam qolgan tovar yo'q 👍",
    disc: 'Katta chegirma', receipt: 'Chek', discount: 'Chegirma', sum: 'Chek summasi',
    del: "Chek o'chirildi", refund: 'Chek qaytarildi', by: 'Kim', wo: 'Tovar hisobdan chiqarildi',
    testNote: "🧪 Sinov xabari: haqiqiy xabar shunday ko'rinadi.", testData: "🧪 Sinov: hozirgacha bo'lgan haqiqiy ma'lumot.",
    mainBranch: 'Bosh filial', sampleCashier: 'Namuna kassir', units: { dona: 'dona', kg: 'kg', litr: 'litr', paket: 'paket' }, money: "so'm"
  },
  ru: {
    daily: 'Отчёт за день', soFar: 'на текущий момент', sales: 'Продажи', receipts: 'Чеков', profit: 'Прибыль', expenses: 'Расходы', net: 'Чистая прибыль',
    cash: 'Наличными', card: 'Картой', credit: 'В долг', refunds: 'Возвраты', debtPaid: 'Оплаты долгов', totalDebt: 'Общий долг',
    top: 'Популярные товары', branches: 'Филиалы', noSales: 'Сегодня продаж пока не было.',
    shiftClosed: 'Смена закрыта', autoClosed: 'закрыта автоматически', cashier: 'Кассир', branch: 'Филиал', total: 'Итого', discounts: 'Скидки',
    expected: 'Должно быть в кассе', counted: 'Пересчитано', diff: 'Разница', diffNone: 'Разницы нет', short: 'недостача', over: 'излишек',
    low: 'Заканчивающиеся товары', threshold: 'Порог «мало осталось»', autoRule: 'Правило: не хватит на {d} дн. продаж', thresholdFb: 'Порог для товаров без продаж', out: 'закончился', more: '… ещё {n}', lowNone: 'Заканчивающихся товаров нет 👍',
    disc: 'Большая скидка', receipt: 'Чек', discount: 'Скидка', sum: 'Сумма чека',
    del: 'Чек удалён', refund: 'Возврат чека', by: 'Кто', wo: 'Списание товара',
    testNote: '🧪 Тестовое сообщение: так будет выглядеть настоящее.', testData: '🧪 Тест: реальные данные на текущий момент.',
    mainBranch: 'Главный филиал', sampleCashier: 'Пример кассира', units: { dona: 'шт', kg: 'кг', litr: 'литр', paket: 'уп.' }, money: 'сум'
  },
  en: {
    daily: 'Daily report', soFar: 'so far', sales: 'Sales', receipts: 'Receipts', profit: 'Profit', expenses: 'Expenses', net: 'Net profit',
    cash: 'Cash', card: 'Card', credit: 'Credit', refunds: 'Refunds', debtPaid: 'Debt payments', totalDebt: 'Total debt',
    top: 'Top products', branches: 'Branches', noSales: 'No sales yet today.',
    shiftClosed: 'Shift closed', autoClosed: 'closed automatically', cashier: 'Cashier', branch: 'Branch', total: 'Total', discounts: 'Discounts',
    expected: 'Expected cash', counted: 'Counted', diff: 'Difference', diffNone: 'No difference', short: 'short', over: 'over',
    low: 'Low stock', threshold: 'Low stock threshold', autoRule: "Rule: won't last {d} days of sales", thresholdFb: 'Threshold for items with no sales', out: 'out of stock', more: '… {n} more', lowNone: 'Nothing is running low 👍',
    disc: 'Large discount', receipt: 'Receipt', discount: 'Discount', sum: 'Receipt total',
    del: 'Receipt deleted', refund: 'Receipt refunded', by: 'By', wo: 'Stock written off',
    testNote: '🧪 Test message: this is how the real one will look.', testData: '🧪 Test: real data so far.',
    mainBranch: 'Main branch', sampleCashier: 'Sample cashier', units: { dona: 'pcs', kg: 'kg', litr: 'liter', paket: 'pack' }, money: 'UZS'
  },
  kk: {
    daily: 'Күндік есеп', soFar: 'қазіргі сәтке', sales: 'Сатылым', receipts: 'Чектер', profit: 'Пайда', expenses: 'Шығындар', net: 'Таза пайда',
    cash: 'Қолма-қол', card: 'Картамен', credit: 'Несиеге', refunds: 'Қайтарылған', debtPaid: 'Қарыз төлемдері', totalDebt: 'Жалпы қарыз',
    top: 'Көп сатылған тауарлар', branches: 'Филиалдар', noSales: 'Бүгін әзірге сатылым болған жоқ.',
    shiftClosed: 'Смена жабылды', autoClosed: 'автоматты түрде жабылды', cashier: 'Кассир', branch: 'Филиал', total: 'Барлығы', discounts: 'Жеңілдіктер',
    expected: 'Кассада болуы керек', counted: 'Саналды', diff: 'Айырма', diffNone: 'Айырма жоқ', short: 'кем', over: 'артық',
    low: 'Аз қалған тауарлар', threshold: 'Аз қалды шегі', autoRule: 'Ереже: {d} күндік сатуға жетпесе', thresholdFb: 'Сатылмаған тауарлар шегі', out: 'таусылды', more: '… тағы {n}', lowNone: 'Аз қалған тауар жоқ 👍',
    disc: 'Үлкен жеңілдік', receipt: 'Чек', discount: 'Жеңілдік', sum: 'Чек сомасы',
    del: 'Чек жойылды', refund: 'Чек қайтарылды', by: 'Кім', wo: 'Тауар есептен шығарылды',
    testNote: '🧪 Сынақ хабары: нақты хабар осылай көрінеді.', testData: '🧪 Сынақ: қазіргі сәттегі нақты деректер.',
    mainBranch: 'Бас филиал', sampleCashier: 'Үлгі кассир', units: { dona: 'дана', kg: 'кг', litr: 'литр', paket: 'пакет' }, money: 'сом'
  },
  ky: {
    daily: 'Күндүк отчёт', soFar: 'азыркы учурга', sales: 'Сатуу', receipts: 'Чектер', profit: 'Пайда', expenses: 'Чыгымдар', net: 'Таза пайда',
    cash: 'Накта', card: 'Карта менен', credit: 'Насыяга', refunds: 'Кайтарылган', debtPaid: 'Карыз төлөмдөрү', totalDebt: 'Жалпы карыз',
    top: 'Көп сатылган товарлар', branches: 'Филиалдар', noSales: 'Бүгүн азырынча сатуу болгон жок.',
    shiftClosed: 'Смена жабылды', autoClosed: 'автоматтык түрдө жабылды', cashier: 'Кассир', branch: 'Филиал', total: 'Бардыгы', discounts: 'Жеңилдиктер',
    expected: 'Кассада болушу керек', counted: 'Саналды', diff: 'Айырма', diffNone: 'Айырма жок', short: 'кем', over: 'ашык',
    low: 'Аз калган товарлар', threshold: 'Аз калды чеги', autoRule: 'Эреже: {d} күндүк сатууга жетпесе', thresholdFb: 'Сатылбаган товарлар үчүн чек', out: 'түгөндү', more: '… дагы {n}', lowNone: 'Аз калган товар жок 👍',
    disc: 'Чоң жеңилдик', receipt: 'Чек', discount: 'Жеңилдик', sum: 'Чектин суммасы',
    del: 'Чек өчүрүлдү', refund: 'Чек кайтарылды', by: 'Ким', wo: 'Товар эсептен чыгарылды',
    testNote: '🧪 Сыноо билдирүүсү: чыныгы билдирүү ушундай көрүнөт.', testData: '🧪 Сыноо: азыркы учурдагы чыныгы маалымат.',
    mainBranch: 'Башкы филиал', sampleCashier: 'Үлгү кассир', units: { dona: 'даана', kg: 'кг', litr: 'литр', paket: 'пакет' }, money: 'сом'
  },
  tg: {
    daily: 'Ҳисоботи рӯзона', soFar: 'то ҳозир', sales: 'Фурӯш', receipts: 'Чекҳо', profit: 'Фоида', expenses: 'Хароҷот', net: 'Фоидаи софи',
    cash: 'Нақд', card: 'Бо корт', credit: 'Қарз', refunds: 'Баргардонидашуда', debtPaid: 'Пардохти қарзҳо', totalDebt: 'Ҳамаи қарз',
    top: 'Молҳои пурфурӯш', branches: 'Филиалҳо', noSales: 'Имрӯз ҳоло фурӯш набуд.',
    shiftClosed: 'Смена баста шуд', autoClosed: 'худкор баста шуд', cashier: 'Кассир', branch: 'Филиал', total: 'Ҳамагӣ', discounts: 'Тахфифҳо',
    expected: 'Бояд дар кассо бошад', counted: 'Шумурда шуд', diff: 'Фарқ', diffNone: 'Фарқ нест', short: 'кам', over: 'зиёдатӣ',
    low: 'Молҳои кам монда', threshold: 'Ҳадди «кам монд»', autoRule: 'Қоида: ба фурӯши {d} рӯз нарасад', thresholdFb: 'Ҳадд барои молҳои нафурӯхта', out: 'тамом шуд', more: '… боз {n}', lowNone: 'Моли кам монда нест 👍',
    disc: 'Тахфифи калон', receipt: 'Чек', discount: 'Тахфиф', sum: 'Маблағи чек',
    del: 'Чек нест карда шуд', refund: 'Чек баргардонида шуд', by: 'Кӣ', wo: 'Мол аз ҳисоб бароварда шуд',
    testNote: '🧪 Паёми санҷишӣ: паёми воқеӣ ҳамин тавр менамояд.', testData: '🧪 Санҷиш: маълумоти воқеӣ то ҳозир.',
    mainBranch: 'Филиали асосӣ', sampleCashier: 'Кассири намунавӣ', units: { dona: 'дона', kg: 'кг', litr: 'литр', paket: 'баста' }, money: 'сомонӣ'
  }
};
const LANGS = Object.keys(L);
function lg(lang) { return L[lang] ? lang : 'uz'; }
function W(lang) { return L[lg(lang)]; }

function fmt(n) {   /* ilovadagi kabi: 1 234 567 (bo'sh joy bilan), manfiy — "−" */
  const v = Math.round(Number(n) || 0);
  const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return v < 0 ? '−' + s : s;
}
/* fix149-cents: USD va EUR — 2 xonali kasr ($2.50); qolgan valyutalar avvalgidek butun son */
function decOf(cur) { return (cur === 'USD' || cur === 'EUR') ? 2 : 0; }
function rnd(n, d) { const v = Number(n) || 0; return d ? Math.round(v * 100 + (v >= 0 ? 1e-7 : -1e-7)) / 100 : Math.round(v); }
function fmtC(cur, n) {
  const d = decOf(cur); if (!d) return fmt(n);
  const v = rnd(n, d), a = Math.abs(v).toFixed(d).split('.');
  const s = a[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + a[1];
  return v < 0 ? '−' + s : s;
}
function qty(n) { const v = Number(n) || 0; return Number.isInteger(v) ? fmt(v) : String(Math.round(v * 100) / 100).replace('.', ','); }
/* Ilovadagi CURRENCY_OPTIONS bilan bir xil (belgisi va joyi) */
const CUR = {
  UZS: { uz: "so'm", ru: 'сум', en: 'UZS', kk: 'сом', ky: 'сом', tg: 'сум', before: false },
  USD: { all: '$', before: true }, EUR: { all: '€', before: true }, RUB: { all: '₽', before: false }, KZT: { all: '₸', before: false },
  KGS: { uz: 'сом', ru: 'сом', en: 'som', kk: 'сом', ky: 'сом', tg: 'сом', before: false },
  TJS: { uz: 'смн', ru: 'смн', en: 'TJS', kk: 'смн', ky: 'смн', tg: 'сомонӣ', before: false }
};
function unitOf(lang, cur) {
  const c = CUR[cur || 'UZS'];
  if (!c) return esc(String(cur || '').slice(0, 6));
  return c.all || c[lg(lang)] || c.uz;
}
function money(lang, cur, n, plus) {
  const c = CUR[cur || 'UZS'] || {}, sym = unitOf(lang, cur), v = rnd(n, decOf(cur));   /* fix149-cents */
  const sign = v < 0 ? '−' : (plus && v > 0 ? '+' : ''), num = fmtC(cur, Math.abs(v));
  return sign + (c.before ? sym + num : num + ' ' + sym);
}
function unitLabel(lang, u) { const m = W(lang).units; return m[u] || (typeof u === 'string' && u.trim() ? u.trim() : m.dona); }   /* fix174-botprice: blok nomi */
function head(icon, title, shop, extra) { return icon + ' <b>' + esc(title) + '</b> · ' + esc(shop) + (extra ? ' ' + extra : ''); }
function tpl(s, vars) { Object.keys(vars || {}).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); }); return s; }

/* ---------- kunlik hisobot ---------- */
function dailyText(lang, d, ctx) {
  const w = W(lang), cur = ctx.cur;
  const lines = [head('📊', w.daily, ctx.shop)];
  lines.push('📅 ' + esc(ctx.dateStr) + (ctx.soFar ? ' (' + esc(w.soFar) + ', ' + esc(ctx.timeStr) + ')' : ''));
  lines.push('');
  if (!d.count && !d.expenses && !d.debtPaid && !d.refundCount) {
    lines.push(ctx.noSalesHtml || esc(w.noSales));   /* fix144-tgcmd: kecha uchun boshqa matn */
  } else {
    lines.push('💰 ' + esc(w.sales) + ': <b>' + money(lang, cur, d.revenue) + '</b>');
    lines.push('🧾 ' + esc(w.receipts) + ': ' + fmt(d.count));
    lines.push('📈 ' + esc(w.profit) + ': ' + fmtC(cur, d.profit) + ' · ' + esc(w.expenses) + ': ' + fmtC(cur, d.expenses));
    lines.push('✅ ' + esc(w.net) + ': <b>' + money(lang, cur, d.net) + '</b>');
    lines.push('');
    lines.push('💵 ' + esc(w.cash) + ': ' + fmtC(cur, d.cash));
    lines.push('💳 ' + esc(w.card) + ': ' + fmtC(cur, d.card));
    lines.push('📝 ' + esc(w.credit) + ': ' + fmtC(cur, d.credit));
    if (d.refundCount) lines.push('↩️ ' + esc(w.refunds) + ': ' + fmt(d.refundCount) + ' · ' + fmtC(cur, d.refundTotal));
    if (d.debtPaid) lines.push('🤝 ' + esc(w.debtPaid) + ': ' + fmtC(cur, d.debtPaid));
  }
  lines.push('👥 ' + esc(w.totalDebt) + ': ' + money(lang, cur, d.totalDebt));
  if (d.top && d.top.length) {
    lines.push('');
    lines.push('🏆 <b>' + esc(w.top) + '</b>');
    d.top.forEach(function (t, i) { lines.push((i + 1) + '. ' + esc(t.name) + ' — ×' + qty(t.qty) + ' — ' + fmtC(cur, t.sum)); });
  }
  if (d.branches && d.branches.length > 1) {
    lines.push('');
    lines.push('🏬 <b>' + esc(w.branches) + '</b>');
    d.branches.forEach(function (b) {
      lines.push('• ' + esc(b.name) + ': <b>' + fmtC(cur, b.revenue) + '</b> (' + esc(w.receipts) + ': ' + fmt(b.count) + ') · ' + esc(w.profit) + ': ' + fmtC(cur, b.profit) + (b.expenses ? ' · ' + esc(w.expenses) + ': ' + fmtC(cur, b.expenses) : ''));
    });
  }
  if (ctx.test) { lines.push(''); lines.push('<i>' + esc(w.testData) + '</i>'); }
  return lines.join('\n');
}

/* ---------- smena yopildi ---------- */
function shiftText(lang, sh, ctx) {
  const w = W(lang), cur = ctx.cur;
  const lines = [head('🔒', w.shiftClosed, ctx.shop, sh.autoClosed ? '(' + esc(w.autoClosed) + ')' : '')];
  lines.push('👤 ' + esc(w.cashier) + ': <b>' + esc(sh.staffName || '—') + '</b>');
  if (ctx.branchName) lines.push('🏬 ' + esc(w.branch) + ': ' + esc(ctx.branchName));
  if (ctx.timeRange) lines.push('🕐 ' + esc(ctx.timeRange));
  const total = (Number(sh.cashTotal) || 0) + (Number(sh.cardTotal) || 0) + (Number(sh.creditTotal) || 0);
  lines.push('🧾 ' + esc(w.receipts) + ': ' + fmt(sh.salesCount) + ' · ' + esc(w.total) + ': <b>' + money(lang, cur, total) + '</b>');
  lines.push('💵 ' + esc(w.cash) + ': ' + fmtC(cur, sh.cashTotal) + ' · 💳 ' + esc(w.card) + ': ' + fmtC(cur, sh.cardTotal) + ' · 📝 ' + esc(w.credit) + ': ' + fmtC(cur, sh.creditTotal));
  if (Number(sh.discountTotal) > 0) lines.push('🏷 ' + esc(w.discounts) + ': ' + fmtC(cur, sh.discountTotal));
  if (Number(sh.refundedTotal) > 0) lines.push('↩️ ' + esc(w.refunds) + ': ' + fmtC(cur, sh.refundedTotal));
  lines.push('💰 ' + esc(w.expected) + ': ' + money(lang, cur, sh.expectedCash));
  if (!sh.autoClosed) {
    lines.push('✍️ ' + esc(w.counted) + ': ' + money(lang, cur, sh.endCash));
    const diff = rnd((Number(sh.endCash) || 0) - (Number(sh.expectedCash) || 0), decOf(cur));
    if (diff === 0) lines.push('✅ ' + esc(w.diffNone));
    else if (diff < 0) lines.push('⚠️ ' + esc(w.diff) + ': <b>' + money(lang, cur, diff) + '</b> (' + esc(w.short) + ')');
    else lines.push('➕ ' + esc(w.diff) + ': <b>' + money(lang, cur, diff, true) + '</b> (' + esc(w.over) + ')');
  }
  if (ctx.test) { lines.push(''); lines.push('<i>' + esc(w.testNote) + '</i>'); }
  return lines.join('\n');
}

/* ---------- kam qolgan tovarlar ---------- */
const LOW_MAX = 50;
function lowText(lang, data, ctx) {
  const w = W(lang);
  const lines = [head('📦', w.low, ctx.shop)];
  if (data.mode === 'auto') {   /* fix124-smart */
    lines.push(esc(tpl(w.autoRule, { d: qty(data.autoDays) })));
    lines.push(esc(w.thresholdFb) + ': ≤ ' + qty(data.threshold));
  } else lines.push(esc(w.threshold) + ': ≤ ' + qty(data.threshold));
  if (!data.groups.length) { lines.push(''); lines.push(esc(w.lowNone)); }
  let shown = 0, total = 0;
  data.groups.forEach(function (g) { total += g.items.length; });
  data.groups.forEach(function (g) {
    if (shown >= LOW_MAX) return;
    lines.push('');
    if (data.groups.length > 1 || data.multiBranch) lines.push('🏬 <b>' + esc(g.name) + '</b>');
    g.items.forEach(function (p) {
      if (shown >= LOW_MAX) return;
      shown++;
      lines.push('• ' + esc(p.name) + ' — ' + qty(p.stock) + ' ' + esc(unitLabel(lang, p.unit)) + (p.stock <= 0 ? ' (' + esc(w.out) + ')' : ''));
    });
  });
  if (total > shown) lines.push(tpl(esc(w.more), { n: fmt(total - shown) }));
  if (ctx.test) { lines.push(''); lines.push('<i>' + esc(w.testData) + '</i>'); }
  return lines.join('\n');
}

/* ---------- katta chegirma ---------- */
function discText(lang, a, ctx) {
  const w = W(lang), cur = ctx.cur;
  const lines = [head('🏷', w.disc, ctx.shop)];
  lines.push('🧾 ' + esc(w.receipt) + (a.receiptNumber ? ' № ' + esc(a.receiptNumber) : '') + (ctx.timeStr ? ' · ' + esc(ctx.timeStr) : ''));
  lines.push(esc(w.discount) + ': <b>' + money(lang, cur, a.discountAmount) + '</b> (' + Math.round(Number(a.pct) || 0) + '%)');
  lines.push(esc(w.sum) + ': ' + money(lang, cur, a.total));
  lines.push('👤 ' + esc(w.cashier) + ': ' + esc(a.cashierName || '—'));
  if (ctx.branchName) lines.push('🏬 ' + esc(w.branch) + ': ' + esc(ctx.branchName));
  if (ctx.test) { lines.push(''); lines.push('<i>' + esc(w.testNote) + '</i>'); }
  return lines.join('\n');
}

/* ---------- chek o'chirildi / qaytarildi ---------- */
function rcptText(lang, a, ctx) {
  const w = W(lang);
  const del = a.action === 'saleDelete', wo = a.action === 'writeOff';   /* fix181-woalert */
  const lines = [head(wo ? '📦' : (del ? '🗑' : '↩️'), wo ? w.wo : (del ? w.del : w.refund), ctx.shop)];
  if (a.detail) lines.push('🧾 ' + esc(a.detail));
  lines.push('👤 ' + esc(w.by) + ': ' + esc(a.staffName || '—') + (ctx.timeStr ? ' · ' + esc(ctx.timeStr) : ''));
  if (ctx.test) { lines.push(''); lines.push('<i>' + esc(w.testNote) + '</i>'); }
  return lines.join('\n');
}

module.exports = { L, LANGS, lg, W, fmt, fmtC, decOf, rnd, qty, unitOf, money, CUR, unitLabel, dailyText, shiftText, lowText, discText, rcptText, LOW_MAX };
