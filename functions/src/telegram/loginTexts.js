'use strict';
/* fix206-tglogin: Telegram orqali kirish — bot matnlari (6 tilda). HTML parse_mode. */
const T = {
  askLogin: {
    uz: "🔐 <b>Savdo Pos'ga kirish so'raldi</b>\n\nIlova ekranida ko'rinib turgan raqamni bosing.\n\nAgar siz hozir Savdo Pos'ga kirmayotgan bo'lsangiz — «Bu men emasman» ni bosing va bu raqamni hech kimga aytmang.",
    ru: "🔐 <b>Запрошен вход в Savdo Pos</b>\n\nНажмите число, которое показано на экране приложения.\n\nЕсли вы сейчас не входите в Savdo Pos — нажмите «Это не я» и никому не называйте число.",
    en: "🔐 <b>Sign-in to Savdo Pos requested</b>\n\nTap the number shown on the app screen.\n\nIf you are not signing in to Savdo Pos right now, tap «It's not me» and don't tell anyone the number.",
    kk: "🔐 <b>Savdo Pos-қа кіру сұралды</b>\n\nҚолданба экранындағы санды басыңыз.\n\nҚазір Savdo Pos-қа кірмей жатсаңыз — «Бұл мен емеспін» басыңыз және санды ешкімге айтпаңыз.",
    ky: "🔐 <b>Savdo Pos'ко кирүү суралды</b>\n\nКолдонмонун экранындагы санды басыңыз.\n\nАзыр Savdo Pos'ко кирбей жатсаңыз — «Бул мен эмесмин» басыңыз жана санды эч кимге айтпаңыз.",
    tg: "🔐 <b>Вуруд ба Savdo Pos дархост шуд</b>\n\nРақамеро, ки дар экрани барнома нишон дода шудааст, пахш кунед.\n\nАгар шумо ҳозир ба Savdo Pos ворид намешавед — «Ин ман нестам»-ро пахш кунед ва рақамро ба касе нагӯед."
  },
  askLink: {
    uz: "🔗 <b>Telegram'ni Savdo Pos akkauntiga ulash so'raldi</b>\n\nIlova ekranida ko'rinib turgan raqamni bosing. Keyin shu Telegram bilan kira olasiz.\n\nAgar bu siz bo'lmasangiz — «Bu men emasman» ni bosing.",
    ru: "🔗 <b>Запрошена привязка Telegram к аккаунту Savdo Pos</b>\n\nНажмите число, которое показано на экране приложения. После этого можно будет входить через этот Telegram.\n\nЕсли это не вы — нажмите «Это не я».",
    en: "🔗 <b>Linking Telegram to a Savdo Pos account requested</b>\n\nTap the number shown on the app screen. After that you can sign in with this Telegram.\n\nIf this isn't you, tap «It's not me».",
    kk: "🔗 <b>Telegram-ды Savdo Pos аккаунтына байланыстыру сұралды</b>\n\nҚолданба экранындағы санды басыңыз. Кейін осы Telegram арқылы кіре аласыз.\n\nБұл сіз болмасаңыз — «Бұл мен емеспін» басыңыз.",
    ky: "🔗 <b>Telegram'ды Savdo Pos аккаунтуна байланыштыруу суралды</b>\n\nКолдонмонун экранындагы санды басыңыз. Андан кийин ушул Telegram менен кире аласыз.\n\nБул сиз болбосоңуз — «Бул мен эмесмин» басыңыз.",
    tg: "🔗 <b>Пайваст кардани Telegram ба ҳисоби Savdo Pos дархост шуд</b>\n\nРақамеро, ки дар экрани барнома нишон дода шудааст, пахш кунед. Баъд бо ҳамин Telegram ворид шуда метавонед.\n\nАгар ин шумо набошед — «Ин ман нестам»-ро пахш кунед."
  },
  notMe: { uz: "❌ Bu men emasman", ru: "❌ Это не я", en: "❌ It's not me", kk: "❌ Бұл мен емеспін", ky: "❌ Бул мен эмесмин", tg: "❌ Ин ман нестам" },
  ok: {
    uz: "✅ Tasdiqlandi. Savdo Pos ilovasiga qayting.", ru: "✅ Подтверждено. Вернитесь в приложение Savdo Pos.", en: "✅ Confirmed. Go back to the Savdo Pos app.",
    kk: "✅ Расталды. Savdo Pos қолданбасына оралыңыз.", ky: "✅ Ырасталды. Savdo Pos колдонмосуна кайтыңыз.", tg: "✅ Тасдиқ шуд. Ба барномаи Savdo Pos баргардед."
  },
  wrong: {
    uz: "⛔ Raqam mos kelmadi — so'rov bekor qilindi. Ilovada qaytadan urinib ko'ring.", ru: "⛔ Число не совпало — запрос отменён. Попробуйте снова в приложении.", en: "⛔ The number did not match — the request was cancelled. Try again in the app.",
    kk: "⛔ Сан сәйкес келмеді — сұрау тоқтатылды. Қолданбада қайталап көріңіз.", ky: "⛔ Сан дал келген жок — суроо жокко чыгарылды. Колдонмодо кайра аракет кылыңыз.", tg: "⛔ Рақам мувофиқ наомад — дархост бекор шуд. Дар барнома аз нав кӯшиш кунед."
  },
  denied: { uz: "❌ So'rov bekor qilindi.", ru: "❌ Запрос отменён.", en: "❌ The request was cancelled.", kk: "❌ Сұрау тоқтатылды.", ky: "❌ Суроо жокко чыгарылды.", tg: "❌ Дархост бекор шуд." },
  expired: {
    uz: "⌛ Bu havola eskirgan yoki allaqachon ishlatilgan. Ilovada «Telegram orqali davom etish» ni qaytadan bosing.",
    ru: "⌛ Ссылка устарела или уже использована. Нажмите «Продолжить через Telegram» в приложении ещё раз.",
    en: "⌛ This link has expired or was already used. Tap «Continue with Telegram» in the app again.",
    kk: "⌛ Бұл сілтеме ескірген немесе қолданылған. Қолданбада «Telegram арқылы жалғастыру» батырмасын қайта басыңыз.",
    ky: "⌛ Бул шилтеме эскирген же колдонулган. Колдонмодо «Telegram аркылуу улантуу» баскычын кайра басыңыз.",
    tg: "⌛ Ин пайванд кӯҳна шудааст ё аллакай истифода шудааст. Дар барнома «Идома тавассути Telegram»-ро боз пахш кунед."
  },
  other: {
    uz: "⛔ Bu so'rov boshqa Telegram foydalanuvchisi uchun.", ru: "⛔ Этот запрос для другого пользователя Telegram.", en: "⛔ This request belongs to another Telegram user.",
    kk: "⛔ Бұл сұрау басқа Telegram пайдаланушысы үшін.", ky: "⛔ Бул суроо башка Telegram колдонуучусу үчүн.", tg: "⛔ Ин дархост барои корбари дигари Telegram аст."
  }
};
const LANGS = ['uz', 'ru', 'en', 'kk', 'ky', 'tg'];
function t(key, lang) { const e = T[key] || {}; return e[LANGS.indexOf(lang) !== -1 ? lang : 'uz'] || e.uz || key; }
module.exports = { t, T };
