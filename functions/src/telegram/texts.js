'use strict';
/* fix120-tg: Telegram bot xabarlari — 6 til. {shop}, {bot}, {code} o'rniga qiymat qo'yiladi. HTML (parse_mode=HTML). */
const LANGS = ['uz', 'ru', 'en', 'kk', 'ky', 'tg'];
const T = {
  welcome: {
    uz: "👋 Salom! Bu <b>Savdo Pos</b> boti.\n\nDo'koningiz hisobotlarini shu yerda olish uchun ilovada <b>Sozlamalar → Bildirishnomalar va ovoz → Telegram bot</b> bo'limida «Telegram'ga ulash» tugmasini bosing.",
    ru: "👋 Здравствуйте! Это бот <b>Savdo Pos</b>.\n\nЧтобы получать отчёты магазина здесь, в приложении откройте <b>Настройки → Уведомления и звук → Telegram-бот</b> и нажмите «Подключить Telegram».",
    en: "👋 Hello! This is the <b>Savdo Pos</b> bot.\n\nTo get your shop's reports here, open <b>Settings → Notifications &amp; sound → Telegram bot</b> in the app and tap “Connect Telegram”.",
    kk: "👋 Сәлем! Бұл <b>Savdo Pos</b> боты.\n\nДүкен есептерін осында алу үшін қолданбада <b>Баптаулар → Хабарландырулар және дыбыс → Telegram бот</b> бөліміне кіріп, «Telegram-ды қосу» түймесін басыңыз.",
    ky: "👋 Салам! Бул <b>Savdo Pos</b> боту.\n\nДүкөндүн отчётторун ушул жерден алуу үчүн колдонмодо <b>Жөндөөлөр → Билдирмелер жана үн → Telegram бот</b> бөлүмүнө кирип, «Telegram'ды туташтыруу» баскычын басыңыз.",
    tg: "👋 Салом! Ин боти <b>Savdo Pos</b> аст.\n\nБарои дар ин ҷо гирифтани ҳисоботҳои мағоза, дар барнома <b>Танзимот → Огоҳиномаҳо ва садо → Telegram-бот</b>-ро кушоед ва «Пайваст кардани Telegram»-ро пахш кунед."
  },
  linked: {
    uz: "✅ Ulandi! «<b>{shop}</b>» do'konining xabarlari endi shu chatga keladi.\n\nUzish uchun: ilovada Telegram bot bo'limida «Uzish» tugmasi yoki shu yerda /stop.",
    ru: "✅ Подключено! Сообщения магазина «<b>{shop}</b>» теперь будут приходить в этот чат.\n\nЧтобы отключить: кнопка «Отключить» в разделе Telegram-бот в приложении или /stop здесь.",
    en: "✅ Connected! Messages from “<b>{shop}</b>” will now come to this chat.\n\nTo disconnect: tap “Disconnect” in the Telegram bot section of the app, or send /stop here.",
    kk: "✅ Қосылды! «<b>{shop}</b>» дүкенінің хабарлары енді осы чатқа келеді.\n\nАжырату үшін: қолданбадағы Telegram бот бөлімінде «Ажырату» түймесі немесе осында /stop.",
    ky: "✅ Туташты! «<b>{shop}</b>» дүкөнүнүн билдирүүлөрү эми ушул чатка келет.\n\nАжыратуу үчүн: колдонмодогу Telegram бот бөлүмүндө «Ажыратуу» баскычы же ушул жерде /stop.",
    tg: "✅ Пайваст шуд! Паёмҳои мағозаи «<b>{shop}</b>» акнун ба ин чат меоянд.\n\nБарои ҷудо кардан: тугмаи «Ҷудо кардан» дар бахши Telegram-бот дар барнома ё /stop дар ин ҷо."
  },
  already: {
    uz: "ℹ️ Bu chat «<b>{shop}</b>» do'koniga allaqachon ulangan.",
    ru: "ℹ️ Этот чат уже подключён к магазину «<b>{shop}</b>».",
    en: "ℹ️ This chat is already connected to “<b>{shop}</b>”.",
    kk: "ℹ️ Бұл чат «<b>{shop}</b>» дүкеніне бұрыннан қосылған.",
    ky: "ℹ️ Бул чат «<b>{shop}</b>» дүкөнүнө мурунтан туташкан.",
    tg: "ℹ️ Ин чат аллакай ба мағозаи «<b>{shop}</b>» пайваст аст."
  },
  limit: {
    uz: "⚠️ «<b>{shop}</b>» do'koniga 3 ta chat ulangan. Yangisini ulash uchun avval ilovada bittasini uzing.",
    ru: "⚠️ К магазину «<b>{shop}</b>» уже подключены 3 чата. Чтобы подключить новый, сначала отключите один в приложении.",
    en: "⚠️ “<b>{shop}</b>” already has 3 chats connected. Disconnect one in the app first.",
    kk: "⚠️ «<b>{shop}</b>» дүкеніне 3 чат қосылған. Жаңасын қосу үшін алдымен қолданбада біреуін ажыратыңыз.",
    ky: "⚠️ «<b>{shop}</b>» дүкөнүнө 3 чат туташкан. Жаңысын туташтыруу үчүн адегенде колдонмодо бирөөсүн ажыратыңыз.",
    tg: "⚠️ Ба мағозаи «<b>{shop}</b>» 3 чат пайваст шудааст. Барои пайваст кардани нав, аввал дар барнома яктоашро ҷудо кунед."
  },
  badCode: {
    uz: "❌ Kod noto'g'ri yoki muddati o'tgan (kod 15 daqiqa amal qiladi). Ilovada «Telegram'ga ulash» tugmasini qayta bosing.",
    ru: "❌ Код неверный или устарел (код действует 15 минут). Нажмите «Подключить Telegram» в приложении ещё раз.",
    en: "❌ The code is wrong or expired (codes last 15 minutes). Tap “Connect Telegram” in the app again.",
    kk: "❌ Код қате немесе мерзімі өткен (код 15 минут жарамды). Қолданбада «Telegram-ды қосу» түймесін қайта басыңыз.",
    ky: "❌ Код туура эмес же мөөнөтү өткөн (код 15 мүнөт жарактуу). Колдонмодо «Telegram'ды туташтыруу» баскычын кайра басыңыз.",
    tg: "❌ Код нодуруст ё мӯҳлаташ гузаштааст (код 15 дақиқа эътибор дорад). Дар барнома «Пайваст кардани Telegram»-ро боз пахш кунед."
  },
  tooMany: {
    uz: "⏳ Juda ko'p noto'g'ri urinish. 1 soatdan keyin qayta urinib ko'ring.",
    ru: "⏳ Слишком много неверных попыток. Попробуйте снова через 1 час.",
    en: "⏳ Too many wrong attempts. Please try again in 1 hour.",
    kk: "⏳ Тым көп қате әрекет. 1 сағаттан кейін қайталап көріңіз.",
    ky: "⏳ Өтө көп туура эмес аракет. 1 сааттан кийин кайра аракет кылыңыз.",
    tg: "⏳ Кӯшишҳои нодуруст хеле зиёд. Пас аз 1 соат дубора кӯшиш кунед."
  },
  unlinked: {
    uz: "🔌 «<b>{shop}</b>» do'koni bu chatdan uzildi. Endi undan xabar kelmaydi.",
    ru: "🔌 Магазин «<b>{shop}</b>» отключён от этого чата. Сообщения от него больше не придут.",
    en: "🔌 “<b>{shop}</b>” has been disconnected from this chat. No more messages from it.",
    kk: "🔌 «<b>{shop}</b>» дүкені бұл чаттан ажыратылды. Енді одан хабар келмейді.",
    ky: "🔌 «<b>{shop}</b>» дүкөнү бул чаттан ажыратылды. Эми андан билдирүү келбейт.",
    tg: "🔌 Мағозаи «<b>{shop}</b>» аз ин чат ҷудо шуд. Дигар аз он паём намеояд."
  },
  stopped: {
    uz: "🔌 Bu chat barcha do'konlardan uzildi. Qayta ulash uchun ilovada «Telegram'ga ulash» tugmasini bosing.",
    ru: "🔌 Этот чат отключён от всех магазинов. Чтобы подключить снова, нажмите «Подключить Telegram» в приложении.",
    en: "🔌 This chat has been disconnected from all shops. To reconnect, tap “Connect Telegram” in the app.",
    kk: "🔌 Бұл чат барлық дүкендерден ажыратылды. Қайта қосу үшін қолданбада «Telegram-ды қосу» түймесін басыңыз.",
    ky: "🔌 Бул чат бардык дүкөндөрдөн ажыратылды. Кайра туташтыруу үчүн колдонмодо «Telegram'ды туташтыруу» баскычын басыңыз.",
    tg: "🔌 Ин чат аз ҳамаи мағозаҳо ҷудо шуд. Барои дубора пайваст кардан, дар барнома «Пайваст кардани Telegram»-ро пахш кунед."
  },
  notLinkedStop: {
    uz: "Bu chat hech qaysi do'konga ulanmagan.",
    ru: "Этот чат не подключён ни к одному магазину.",
    en: "This chat isn't connected to any shop.",
    kk: "Бұл чат ешбір дүкенге қосылмаған.",
    ky: "Бул чат эч бир дүкөнгө туташкан эмес.",
    tg: "Ин чат ба ягон мағоза пайваст нест."
  },
  linkedInfo: {
    uz: "✅ Bu chat ulangan: {shop}.\nXabarlar shu yerga keladi. Uzish uchun /stop.",
    ru: "✅ Этот чат подключён: {shop}.\nСообщения приходят сюда. Отключить: /stop.",
    en: "✅ This chat is connected: {shop}.\nMessages come here. To disconnect: /stop.",
    kk: "✅ Бұл чат қосылған: {shop}.\nХабарлар осында келеді. Ажырату: /stop.",
    ky: "✅ Бул чат туташкан: {shop}.\nБилдирүүлөр ушул жерге келет. Ажыратуу: /stop.",
    tg: "✅ Ин чат пайваст аст: {shop}.\nПаёмҳо ба ин ҷо меоянд. Ҷудо кардан: /stop."
  },
  privateOnly: {
    uz: "Bot hozircha faqat shaxsiy chatda ishlaydi. Botga to'g'ridan-to'g'ri yozing.",
    ru: "Бот пока работает только в личном чате. Напишите боту напрямую.",
    en: "For now the bot works only in a private chat. Message the bot directly.",
    kk: "Бот әзірге тек жеке чатта жұмыс істейді. Ботқа тікелей жазыңыз.",
    ky: "Бот азырынча жеке чатта гана иштейт. Ботко түз жазыңыз.",
    tg: "Бот ҳоло танҳо дар чати шахсӣ кор мекунад. Ба бот мустақиман нависед."
  }
};
function pickLang(code) {
  const c = String(code || '').toLowerCase().slice(0, 2);
  return LANGS.indexOf(c) !== -1 ? c : 'uz';
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function txt(key, lang, vars) {
  const row = T[key] || {};
  let s = row[LANGS.indexOf(lang) !== -1 ? lang : 'uz'] || row.uz || '';
  Object.keys(vars || {}).forEach(function (k) { s = s.split('{' + k + '}').join(esc(vars[k])); });
  return s;
}
module.exports = { T, LANGS, pickLang, txt, esc };
