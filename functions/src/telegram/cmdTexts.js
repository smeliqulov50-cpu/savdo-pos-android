'use strict';
/* fix144-tgcmd: Telegram bot — 3-bosqich matnlari (buyruqlar, menyu, til tanlash, qarzlar). 6 til. HTML: tashqi qiymatlar esc() dan o'tadi. */
const { esc } = require('./texts');
const LANGS = ['uz', 'ru', 'en', 'kk', 'ky', 'tg'];
const LANG_NAMES = { uz: "🇺🇿 O'zbekcha", ru: '🇷🇺 Русский', en: '🇬🇧 English', kk: '🇰🇿 Қазақша', ky: '🇰🇬 Кыргызча', tg: '🇹🇯 Тоҷикӣ' };
/* Buyruq nomlari: o'zbekcha va xalqaro (boshqa tillar menyusida). Ikkalasi ham har doim ishlaydi. */
const NAMES_UZ = { today: 'bugun', yday: 'kecha', debts: 'qarzlar', low: 'kam_qolgan', pay: 'obuna', lang: 'til', help: 'yordam', stop: 'stop' };
const NAMES_INT = { today: 'today', yday: 'yesterday', debts: 'debts', low: 'low', pay: 'pay', lang: 'lang', help: 'help', stop: 'stop' };
function names(lang) { return lang === 'uz' ? NAMES_UZ : NAMES_INT; }
const T = {
  dToday: { uz: 'Bugungi savdo (hozirgacha)', ru: 'Продажи за сегодня (на текущий момент)', en: "Today's sales (so far)", kk: 'Бүгінгі сауда (қазірге дейін)', ky: 'Бүгүнкү соода (азырга чейин)', tg: 'Савдои имрӯз (то ҳозир)' },
  dYday: { uz: 'Kechagi hisobot', ru: 'Отчёт за вчера', en: "Yesterday's report", kk: 'Кешегі есеп', ky: 'Кечээки отчёт', tg: 'Ҳисоботи дирӯз' },
  dDebts: { uz: 'Qarzlar: mijozlar va yetkazib beruvchilar', ru: 'Долги: клиенты и поставщики', en: 'Debts: customers and suppliers', kk: 'Қарыздар: клиенттер және жеткізушілер', ky: 'Карыздар: кардарлар жана жеткирүүчүлөр', tg: 'Қарзҳо: мизоҷон ва таъминкунандагон' },
  dLow: { uz: 'Kam qolgan tovarlar', ru: 'Заканчивающиеся товары', en: 'Low-stock items', kk: 'Азайған тауарлар', ky: 'Азайып калган товарлар', tg: 'Молҳои камбоқимонда' },
  dPay: { uz: "Obunani to'lash", ru: 'Оплатить подписку', en: 'Pay for the subscription', kk: 'Жазылымды төлеу', ky: 'Жазылууну төлөө', tg: 'Пардохти обуна' },
  dLang: { uz: 'Tilni tanlash', ru: 'Выбрать язык', en: 'Choose language', kk: 'Тілді таңдау', ky: 'Тилди тандоо', tg: 'Интихоби забон' },
  dHelp: { uz: 'Yordam va menyu', ru: 'Помощь и меню', en: 'Help and menu', kk: 'Көмек және мәзір', ky: 'Жардам жана меню', tg: 'Ёрӣ ва меню' },
  dStop: { uz: 'Botni do\'kondan uzish', ru: 'Отключить бота от магазина', en: 'Disconnect the bot from the shop', kk: 'Ботты дүкеннен ажырату', ky: 'Ботту дүкөндөн ажыратуу', tg: 'Ҷудо кардани бот аз мағоза' },
  bToday: { uz: '📊 Bugun', ru: '📊 Сегодня', en: '📊 Today', kk: '📊 Бүгін', ky: '📊 Бүгүн', tg: '📊 Имрӯз' },
  bYday: { uz: '📅 Kecha', ru: '📅 Вчера', en: '📅 Yesterday', kk: '📅 Кеше', ky: '📅 Кечээ', tg: '📅 Дирӯз' },
  bDebts: { uz: '👥 Qarzlar', ru: '👥 Долги', en: '👥 Debts', kk: '👥 Қарыздар', ky: '👥 Карыздар', tg: '👥 Қарзҳо' },
  bLow: { uz: '📦 Kam qolgan', ru: '📦 Заканчиваются', en: '📦 Low stock', kk: '📦 Азайғандар', ky: '📦 Азайгандар', tg: '📦 Камбоқимонда' },
  bPay: { uz: '💳 Obuna', ru: '💳 Подписка', en: '💳 Subscription', kk: '💳 Жазылым', ky: '💳 Жазылуу', tg: '💳 Обуна' },
  bLang: { uz: '🌐 Til', ru: '🌐 Язык', en: '🌐 Language', kk: '🌐 Тіл', ky: '🌐 Тил', tg: '🌐 Забон' },
  helpTitle: { uz: '🤖 <b>Savdo Pos boti</b> — buyruqlar:', ru: '🤖 <b>Бот Savdo Pos</b> — команды:', en: '🤖 <b>Savdo Pos bot</b> — commands:', kk: '🤖 <b>Savdo Pos боты</b> — командалар:', ky: '🤖 <b>Savdo Pos боту</b> — буйруктар:', tg: '🤖 <b>Боти Savdo Pos</b> — фармонҳо:' },
  helpFoot: { uz: 'Yoki pastdagi tugmalarni bosing.', ru: 'Или нажмите кнопки ниже.', en: 'Or tap the buttons below.', kk: 'Немесе төмендегі түймелерді басыңыз.', ky: 'Же төмөндөгү баскычтарды басыңыз.', tg: 'Ё тугмаҳои поёнро пахш кунед.' },
  helpNotLinked: { uz: "ℹ️ Hisobotlar uchun avval ilovada chatni do'konga ulang: <b>Sozlamalar → Bildirishnomalar va ovoz → Telegram bot</b>.", ru: 'ℹ️ Для отчётов сначала подключите чат к магазину в приложении: <b>Настройки → Уведомления и звук → Telegram-бот</b>.', en: 'ℹ️ For reports, first connect this chat to your shop in the app: <b>Settings → Notifications &amp; sound → Telegram bot</b>.', kk: 'ℹ️ Есептер үшін алдымен қолданбада чатты дүкенге қосыңыз: <b>Баптаулар → Хабарландырулар және дыбыс → Telegram бот</b>.', ky: 'ℹ️ Отчёттор үчүн адегенде колдонмодо чатты дүкөнгө туташтырыңыз: <b>Жөндөөлөр → Билдирмелер жана үн → Telegram бот</b>.', tg: 'ℹ️ Барои ҳисоботҳо аввал дар барнома чатро ба мағоза пайваст кунед: <b>Танзимот → Огоҳиномаҳо ва садо → Telegram-бот</b>.' },
  menu: { uz: 'Kerakli bo\'limni tanlang:', ru: 'Выберите нужный раздел:', en: 'Choose what you need:', kk: 'Қажетті бөлімді таңдаңыз:', ky: 'Керектүү бөлүмдү тандаңыз:', tg: 'Бахши лозимиро интихоб кунед:' },
  notLinked: { uz: "Bu chat hech bir do'konga ulanmagan. Avval ilovada <b>Sozlamalar → Bildirishnomalar va ovoz → Telegram bot</b> orqali ulang.", ru: 'Этот чат не подключён ни к одному магазину. Сначала подключите его в приложении: <b>Настройки → Уведомления и звук → Telegram-бот</b>.', en: "This chat isn't connected to any shop. Connect it first in the app: <b>Settings → Notifications &amp; sound → Telegram bot</b>.", kk: 'Бұл чат ешбір дүкенге қосылмаған. Алдымен қолданбада қосыңыз: <b>Баптаулар → Хабарландырулар және дыбыс → Telegram бот</b>.', ky: 'Бул чат эч бир дүкөнгө туташкан эмес. Адегенде колдонмодо туташтырыңыз: <b>Жөндөөлөр → Билдирмелер жана үн → Telegram бот</b>.', tg: 'Ин чат ба ягон мағоза пайваст нест. Аввал дар барнома пайваст кунед: <b>Танзимот → Огоҳиномаҳо ва садо → Telegram-бот</b>.' },
  notLinkedShort: { uz: "Chat do'konga ulanmagan", ru: 'Чат не подключён к магазину', en: 'Chat is not connected', kk: 'Чат дүкенге қосылмаған', ky: 'Чат дүкөнгө туташкан эмес', tg: 'Чат ба мағоза пайваст нест' },
  tooMany: { uz: "⏳ So'rovlar juda ko'p. Birozdan keyin qayta urinib ko'ring.", ru: '⏳ Слишком много запросов. Попробуйте немного позже.', en: '⏳ Too many requests. Please try again a little later.', kk: '⏳ Сұраулар тым көп. Сәл кейін қайталап көріңіз.', ky: '⏳ Суроолор өтө көп. Бир аздан кийин кайра аракет кылыңыз.', tg: '⏳ Дархостҳо хеле зиёд. Каме дертар дубора кӯшиш кунед.' },
  failed: { uz: "⚠️ Ma'lumotni olib bo'lmadi. Birozdan keyin qayta urinib ko'ring.", ru: '⚠️ Не удалось получить данные. Попробуйте немного позже.', en: "⚠️ Couldn't get the data. Please try again a little later.", kk: '⚠️ Деректерді алу мүмкін болмады. Сәл кейін қайталап көріңіз.', ky: '⚠️ Маалыматты алуу мүмкүн болгон жок. Бир аздан кийин кайра аракет кылыңыз.', tg: '⚠️ Маълумотро гирифта натавонистем. Каме дертар дубора кӯшиш кунед.' },
  langPick: { uz: '🌐 Tilni tanlang:', ru: '🌐 Выберите язык:', en: '🌐 Choose a language:', kk: '🌐 Тілді таңдаңыз:', ky: '🌐 Тилди тандаңыз:', tg: '🌐 Забонро интихоб кунед:' },
  langSet: { uz: "✅ Til o'zgartirildi: {name}. Hisobotlar ham shu tilda keladi.", ru: '✅ Язык изменён: {name}. Отчёты тоже будут приходить на этом языке.', en: '✅ Language changed: {name}. Reports will come in this language too.', kk: '✅ Тіл өзгертілді: {name}. Есептер де осы тілде келеді.', ky: '✅ Тил өзгөртүлдү: {name}. Отчёттор да ушул тилде келет.', tg: '✅ Забон иваз шуд: {name}. Ҳисоботҳо низ бо ҳамин забон меоянд.' },
  langHint: { uz: '🌐 Tilni o\'zgartirish: /{cmd}', ru: '🌐 Сменить язык: /{cmd}', en: '🌐 Change language: /{cmd}', kk: '🌐 Тілді өзгерту: /{cmd}', ky: '🌐 Тилди өзгөртүү: /{cmd}', tg: '🌐 Иваз кардани забон: /{cmd}' },
  noSalesDay: { uz: "Bu kunda savdo bo'lmagan.", ru: 'В этот день продаж не было.', en: 'There were no sales on this day.', kk: 'Бұл күні сауда болмаған.', ky: 'Бул күнү соода болгон эмес.', tg: 'Дар ин рӯз савдо набуд.' },
  debts: { uz: 'Qarzlar', ru: 'Долги', en: 'Debts', kk: 'Қарыздар', ky: 'Карыздар', tg: 'Қарзҳо' },
  custDebts: { uz: 'Mijozlar qarzi', ru: 'Долги клиентов', en: 'Customers owe', kk: 'Клиенттер қарызы', ky: 'Кардарлардын карызы', tg: 'Қарзи мизоҷон' },
  supDebts: { uz: 'Mening qarzlarim (yetkazib beruvchilarga)', ru: 'Мои долги (поставщикам)', en: 'I owe (suppliers)', kk: 'Менің қарыздарым (жеткізушілерге)', ky: 'Менин карыздарым (жеткирүүчүлөргө)', tg: 'Қарзҳои ман (ба таъминкунандагон)' },
  people: { uz: '{n} ta', ru: '{n}', en: '{n}', kk: '{n}', ky: '{n}', tg: '{n}' },
  debtsNone: { uz: "Qarz yo'q 👍", ru: 'Долгов нет 👍', en: 'No debts 👍', kk: 'Қарыз жоқ 👍', ky: 'Карыз жок 👍', tg: 'Қарз нест 👍' },
  more: { uz: '… yana {n} ta', ru: '… ещё {n}', en: '… {n} more', kk: '… тағы {n}', ky: '… дагы {n}', tg: '… боз {n}' }
};
function lg(lang) { return LANGS.indexOf(lang) !== -1 ? lang : 'uz'; }
function t(key, lang, vars) {
  const row = T[key] || {};
  let s = row[lg(lang)] || row.uz || '';
  Object.keys(vars || {}).forEach(function (k) { s = s.split('{' + k + '}').join(esc(vars[k])); });
  return s;
}
module.exports = { T, LANGS, LANG_NAMES, NAMES_UZ, NAMES_INT, names, t, lg };
