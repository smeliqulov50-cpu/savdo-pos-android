'use strict';
/* fix189-fiscal6: Telegram — soliqqa yuborilmagan cheklar ogohlantirishi (6 til). HTML: har bir tashqi qiymat esc() dan o'tadi. */
const { esc } = require('./texts');

const FX = {
  uz: { title: 'Soliqqa yuborilmagan cheklar', lead: '{n} ta chek soliqqa yuborilmayapti:', tries: '{a} marta urinildi', old: '{h} soatdan beri navbatda',
    sale: 'Chek', refund: 'Qaytarish', edit: 'Chek tahriri', credit: "Qarz to'lovi", more: '… yana {n} ta',
    foot: "Savdo to'xtamaydi. Tekshiring: Sozlamalar → Fiskal kassa → Yuborilmagan cheklar." },
  ru: { title: 'Чеки не отправлены в налоговую', lead: 'Не отправляется в налоговую: {n} чек(ов):', tries: 'попыток: {a}', old: 'в очереди {h} ч',
    sale: 'Чек', refund: 'Возврат', edit: 'Исправление чека', credit: 'Оплата долга', more: '… ещё {n}',
    foot: 'Продажи не останавливаются. Проверьте: Настройки → Фискальная касса → Неотправленные чеки.' },
  en: { title: 'Receipts not sent to tax', lead: '{n} receipt(s) are not being sent to tax:', tries: '{a} attempts', old: 'queued for {h} h',
    sale: 'Receipt', refund: 'Refund', edit: 'Receipt correction', credit: 'Debt payment', more: '… {n} more',
    foot: 'Sales are not stopped. Check: Settings → Fiscal register → Unsent receipts.' },
  kk: { title: 'Салыққа жіберілмеген чектер', lead: '{n} чек салыққа жіберілмей жатыр:', tries: '{a} рет әрекет жасалды', old: '{h} сағаттан бері кезекте',
    sale: 'Чек', refund: 'Қайтару', edit: 'Чекті түзету', credit: 'Қарыз төлемі', more: '… тағы {n}',
    foot: 'Сауда тоқтамайды. Тексеріңіз: Баптаулар → Фискалдық касса → Жіберілмеген чектер.' },
  ky: { title: 'Салыкка жөнөтүлбөгөн чектер', lead: '{n} чек салыкка жөнөтүлбөй жатат:', tries: '{a} жолу аракет кылынды', old: '{h} сааттан бери кезекте',
    sale: 'Чек', refund: 'Кайтаруу', edit: 'Чекти оңдоо', credit: 'Карыз төлөмү', more: '… дагы {n}',
    foot: 'Соода токтобойт. Текшериңиз: Жөндөөлөр → Фискалдык касса → Жөнөтүлбөгөн чектер.' },
  tg: { title: 'Чекҳои ба андоз нафиристода', lead: '{n} чек ба андоз фиристода намешавад:', tries: '{a} бор кӯшиш шуд', old: 'аз {h} соат дар навбат',
    sale: 'Чек', refund: 'Баргардонӣ', edit: 'Ислоҳи чек', credit: 'Пардохти қарз', more: '… боз {n}',
    foot: 'Савдо қатъ намешавад. Санҷед: Танзимот → Кассаи фискалӣ → Чекҳои нафиристода.' }
};
const SHOW = 5;
function F(lang) { return FX[lang] || FX.uz; }
function tpl(s, v) { Object.keys(v || {}).forEach(function (k) { s = s.split('{' + k + '}').join(String(v[k])); }); return s; }
function kindLabel(w, k) { return k === 'refund' ? w.refund : (k === 'credit' ? w.credit : ((k === 'edit' || k === 'editRefund') ? w.edit : w.sale)); }
/* data: { items: [{k, n, e, a, t}], total }, ctx: { shop, now, test, testNote } */
function fiscText(lang, data, ctx) {
  const w = F(lang), items = (data && data.items) || [], total = Math.max(items.length, (data && data.total) || 0), now = ctx.now || Date.now();
  const lines = ['🧾 <b>' + esc(w.title) + '</b> · ' + esc(ctx.shop || '')];
  lines.push(esc(tpl(w.lead, { n: total })));
  items.slice(0, SHOW).forEach(function (x) {
    const h = Math.max(1, Math.floor((now - (x.t || now)) / 3600000));
    const why = (x.a || 0) >= 3 ? tpl(w.tries, { a: x.a }) : tpl(w.old, { h: h });
    lines.push('• ' + esc(kindLabel(w, x.k)) + (x.n ? ' №' + esc(x.n) : '') + ' — ' + esc(why) + (x.e ? ': ' + esc(String(x.e).slice(0, 100)) : ''));
  });
  if (total > SHOW) lines.push(esc(tpl(w.more, { n: total - Math.min(SHOW, items.length) })));
  lines.push(''); lines.push(esc(w.foot));
  if (ctx.test && ctx.testNote) { lines.push(''); lines.push('<i>' + esc(ctx.testNote) + '</i>'); }
  return lines.join('\n');
}
module.exports = { FX, fiscText, SHOW };
