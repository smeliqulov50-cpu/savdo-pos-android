'use strict';
/* fix189-fiscal6: Telegram — soliqqa yuborilmagan cheklar ogohlantirishi (6 til). HTML: har bir tashqi qiymat esc() dan o'tadi. */
const { esc } = require('./texts');

const FX = {
  uz: { e_rej: 'operator rad etdi', e_net: 'operator yoki internet vaqtincha javob bermadi', e_ikpu: "tovarning IKPU kodi noto'g'ri yoki topilmadi", e_pkg: "qadoq kodi yo'q yoki noto'g'ri", e_nc: 'provayder hali ulanmagan', e_inn: 'STIR (INN) kiritilmagan', e_off: "fiskal rejim o'chirilgan", e_wh: 'biznes turi «Ombor»', e_sh: "soliq smenasini ochib bo'lmadi", e_orig: 'asl chek hali yuborilmagan', e_sum: 'chek summasi mos kelmadi', e_other: 'operator xatosi', title: 'Soliqqa yuborilmagan cheklar', lead: '{n} ta chek soliqqa yuborilmayapti:', tries: '{a} marta urinildi', old: '{h} soatdan beri navbatda',
    sale: 'Chek', refund: 'Qaytarish', edit: 'Chek tahriri', credit: "Qarz to'lovi", more: '… yana {n} ta',
    foot: "Savdo to'xtamaydi. Tekshiring: Sozlamalar → Fiskal kassa → Yuborilmagan cheklar." },
  ru: { e_rej: 'оператор отклонил', e_net: 'оператор или интернет временно не ответил', e_ikpu: 'ИКПУ товара неверный или не найден', e_pkg: 'нет или неверный код упаковки', e_nc: 'провайдер ещё не подключён', e_inn: 'ИНН не указан', e_off: 'фискальный режим выключен', e_wh: 'тип бизнеса «Склад»', e_sh: 'не удалось открыть налоговую смену', e_orig: 'исходный чек ещё не отправлен', e_sum: 'сумма чека не сходится', e_other: 'ошибка оператора', title: 'Чеки не отправлены в налоговую', lead: 'Не отправляется в налоговую: {n} чек(ов):', tries: 'попыток: {a}', old: 'в очереди {h} ч',
    sale: 'Чек', refund: 'Возврат', edit: 'Исправление чека', credit: 'Оплата долга', more: '… ещё {n}',
    foot: 'Продажи не останавливаются. Проверьте: Настройки → Фискальная касса → Неотправленные чеки.' },
  en: { e_rej: 'rejected by the operator', e_net: 'operator or internet did not respond', e_ikpu: 'product IKPU code is wrong or not found', e_pkg: 'package code missing or wrong', e_nc: 'provider not connected yet', e_inn: 'tax ID (INN) not set', e_off: 'fiscal mode is off', e_wh: 'business type is «Warehouse»', e_sh: 'could not open the tax shift', e_orig: 'original receipt not sent yet', e_sum: 'receipt total mismatch', e_other: 'operator error', title: 'Receipts not sent to tax', lead: '{n} receipt(s) are not being sent to tax:', tries: '{a} attempts', old: 'queued for {h} h',
    sale: 'Receipt', refund: 'Refund', edit: 'Receipt correction', credit: 'Debt payment', more: '… {n} more',
    foot: 'Sales are not stopped. Check: Settings → Fiscal register → Unsent receipts.' },
  kk: { e_rej: 'оператор қабылдамады', e_net: 'оператор немесе интернет уақытша жауап бермеді', e_ikpu: 'тауардың ИКПУ коды қате немесе табылмады', e_pkg: 'қаптама коды жоқ немесе қате', e_nc: 'провайдер әлі қосылмаған', e_inn: 'СТН (ИНН) енгізілмеген', e_off: 'фискалдық режим өшірілген', e_wh: 'бизнес түрі «Қойма»', e_sh: 'салық ауысымын ашу мүмкін болмады', e_orig: 'бастапқы чек әлі жіберілмеген', e_sum: 'чек сомасы сәйкес емес', e_other: 'оператор қатесі', title: 'Салыққа жіберілмеген чектер', lead: '{n} чек салыққа жіберілмей жатыр:', tries: '{a} рет әрекет жасалды', old: '{h} сағаттан бері кезекте',
    sale: 'Чек', refund: 'Қайтару', edit: 'Чекті түзету', credit: 'Қарыз төлемі', more: '… тағы {n}',
    foot: 'Сауда тоқтамайды. Тексеріңіз: Баптаулар → Фискалдық касса → Жіберілмеген чектер.' },
  ky: { e_rej: 'оператор четке какты', e_net: 'оператор же интернет убактылуу жооп берген жок', e_ikpu: 'товардын ИКПУ коду туура эмес же табылган жок', e_pkg: 'таңгак коду жок же туура эмес', e_nc: 'провайдер азырынча туташкан жок', e_inn: 'СТН (ИНН) киргизилген жок', e_off: 'фискалдык режим өчүрүлгөн', e_wh: 'бизнес түрү «Кампа»', e_sh: 'салык сменасын ачуу мүмкүн болгон жок', e_orig: 'баштапкы чек азырынча жөнөтүлгөн жок', e_sum: 'чектин суммасы туура келбейт', e_other: 'оператордун катасы', title: 'Салыкка жөнөтүлбөгөн чектер', lead: '{n} чек салыкка жөнөтүлбөй жатат:', tries: '{a} жолу аракет кылынды', old: '{h} сааттан бери кезекте',
    sale: 'Чек', refund: 'Кайтаруу', edit: 'Чекти оңдоо', credit: 'Карыз төлөмү', more: '… дагы {n}',
    foot: 'Соода токтобойт. Текшериңиз: Жөндөөлөр → Фискалдык касса → Жөнөтүлбөгөн чектер.' },
  tg: { e_rej: 'оператор рад кард', e_net: 'оператор ё интернет муваққатан ҷавоб надод', e_ikpu: 'рамзи ИКПУ-и мол нодуруст ё ёфт нашуд', e_pkg: 'рамзи бастабандӣ нест ё нодуруст', e_nc: 'провайдер ҳоло пайваст нашудааст', e_inn: 'РМА (ИНН) ворид нашудааст', e_off: 'реҷаи фискалӣ хомӯш аст', e_wh: 'навъи бизнес «Анбор»', e_sh: 'басти андозро кушодан нашуд', e_orig: 'чеки аслӣ ҳоло фиристода нашудааст', e_sum: 'маблағи чек мувофиқ нест', e_other: 'хатои оператор', title: 'Чекҳои ба андоз нафиристода', lead: '{n} чек ба андоз фиристода намешавад:', tries: '{a} бор кӯшиш шуд', old: 'аз {h} соат дар навбат',
    sale: 'Чек', refund: 'Баргардонӣ', edit: 'Ислоҳи чек', credit: 'Пардохти қарз', more: '… боз {n}',
    foot: 'Савдо қатъ намешавад. Санҷед: Танзимот → Кассаи фискалӣ → Чекҳои нафиристода.' }
};
const SHOW = 5;
function F(lang) { return FX[lang] || FX.uz; }
function tpl(s, v) { Object.keys(v || {}).forEach(function (k) { s = s.split('{' + k + '}').join(String(v[k])); }); return s; }
/* fix190-fiscal7: xom xato kodi o'rniga tushunarli matn (ilovadagi __fxErrText bilan bir xil guruhlar) */
function errText(lang, e) {
  const w = F(lang), x = String(e || '');
  if (!x) return '';
  if (/IKPU|ikpu|mxik/i.test(x)) return w.e_ikpu;
  if (/package|qadoq|pkg/i.test(x)) return w.e_pkg;
  if (/^no_inn$/.test(x)) return w.e_inn;
  if (/^fiscal_off$/.test(x)) return w.e_off;
  if (/^warehouse$/.test(x)) return w.e_wh;
  if (/_not_configured$/.test(x)) return w.e_nc;
  if (/^shift_/.test(x)) return w.e_sh;
  if (/^original_/.test(x)) return w.e_orig;
  if (/sum_mismatch|pay_mismatch|discount_exceeds/.test(x)) return w.e_sum;
  if (/operator_busy|timeout|network|ECONN|empty_response|no_fiscal_sign|bad_response/i.test(x)) return w.e_net;
  if (/^rejected/i.test(x)) return w.e_rej + ': ' + x.replace(/^rejected:\s*/i, '');
  return w.e_other + ': ' + x;
}
function kindLabel(w, k) { return k === 'refund' ? w.refund : (k === 'credit' ? w.credit : ((k === 'edit' || k === 'editRefund') ? w.edit : w.sale)); }
/* data: { items: [{k, n, e, a, t}], total }, ctx: { shop, now, test, testNote } */
function fiscText(lang, data, ctx) {
  const w = F(lang), items = (data && data.items) || [], total = Math.max(items.length, (data && data.total) || 0), now = ctx.now || Date.now();
  const lines = ['🧾 <b>' + esc(w.title) + '</b> · ' + esc(ctx.shop || '')];
  lines.push(esc(tpl(w.lead, { n: total })));
  items.slice(0, SHOW).forEach(function (x) {
    const h = Math.max(1, Math.floor((now - (x.t || now)) / 3600000));
    const why = x.r === 0 ? w.e_rej : ((x.a || 0) >= 3 ? tpl(w.tries, { a: x.a }) : tpl(w.old, { h: h }));   // fix190: rad etilgan — darhol
    let et = errText(lang, x.e); if (x.r === 0 && et.indexOf(w.e_rej + ': ') === 0) et = et.slice(w.e_rej.length + 2);
    lines.push('• ' + esc(kindLabel(w, x.k)) + (x.n ? ' №' + esc(x.n) : '') + ' — ' + esc(why) + (et ? ': ' + esc(String(et).slice(0, 140)) : ''));
  });
  if (total > SHOW) lines.push(esc(tpl(w.more, { n: total - Math.min(SHOW, items.length) })));
  lines.push(''); lines.push(esc(w.foot));
  if (ctx.test && ctx.testNote) { lines.push(''); lines.push('<i>' + esc(ctx.testNote) + '</i>'); }
  return lines.join('\n');
}
module.exports = { FX, fiscText, errText, SHOW };
