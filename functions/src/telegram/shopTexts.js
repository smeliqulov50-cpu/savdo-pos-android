'use strict';
/* fix145-botshop: bot orqali buyurtma — mijoz va egaga boradigan xabarlar, 6 til. {x} o'rniga qiymat qo'yiladi. HTML. */
const LANGS = ['uz', 'ru', 'en', 'kk', 'ky', 'tg'];
const T = {
  start: {
    uz: "🛍 <b>{shop}</b>\n\nBuyurtma berish uchun pastdagi tugmani bosing: mahsulotlarni tanlang, savatga qo'shing va yuboring. Buyurtmangiz holati shu chatga yozib boriladi.",
    ru: "🛍 <b>{shop}</b>\n\nЧтобы сделать заказ, нажмите кнопку ниже: выберите товары, добавьте в корзину и отправьте. Статус заказа будет приходить в этот чат.",
    en: "🛍 <b>{shop}</b>\n\nTo place an order, tap the button below: pick products, add them to the cart and send. Order updates will come to this chat.",
    kk: "🛍 <b>{shop}</b>\n\nТапсырыс беру үшін төмендегі түймені басыңыз: тауарларды таңдап, себетке салып, жіберіңіз. Тапсырыс күйі осы чатқа жазылады.",
    ky: "🛍 <b>{shop}</b>\n\nБуйрутма берүү үчүн төмөнкү баскычты басыңыз: товарларды тандап, себетке салып, жөнөтүңүз. Буйрутманын абалы ушул чатка жазылат.",
    tg: "🛍 <b>{shop}</b>\n\nБарои фармоиш тугмаи зеринро пахш кунед: молҳоро интихоб кунед, ба сабад илова кунед ва фиристед. Ҳолати фармоиш ба ҳамин чат меояд."
  },
  startOff: {
    uz: "ℹ️ Bu do'konda hozircha bot orqali buyurtma berib bo'lmaydi.",
    ru: "ℹ️ В этом магазине пока нельзя заказать через бота.",
    en: "ℹ️ This shop does not take orders through the bot yet.",
    kk: "ℹ️ Бұл дүкенде әзірге бот арқылы тапсырыс беруге болмайды.",
    ky: "ℹ️ Бул дүкөндө азырынча бот аркылуу буйрутма берүүгө болбойт.",
    tg: "ℹ️ Дар ин мағоза ҳоло тавассути бот фармоиш додан мумкин нест."
  },
  btnOrder: { uz: "🛍 Buyurtma berish", ru: "🛍 Сделать заказ", en: "🛍 Order now", kk: "🛍 Тапсырыс беру", ky: "🛍 Буйрутма берүү", tg: "🛍 Фармоиш додан" },
  btnShop: { uz: "🛍 Do'kon", ru: "🛍 Магазин", en: "🛍 Shop", kk: "🛍 Дүкен", ky: "🛍 Дүкөн", tg: "🛍 Мағоза" },
  btnCancel: { uz: "❌ Buyurtmani bekor qilish", ru: "❌ Отменить заказ", en: "❌ Cancel order", kk: "❌ Тапсырыстан бас тарту", ky: "❌ Буйрутманы жокко чыгаруу", tg: "❌ Бекор кардани фармоиш" },
  phoneSaved: {
    uz: "✅ Raqamingiz saqlandi: {phone}\nEndi buyurtma sahifasiga qayting.",
    ru: "✅ Номер сохранён: {phone}\nТеперь вернитесь на страницу заказа.",
    en: "✅ Your number is saved: {phone}\nNow go back to the order page.",
    kk: "✅ Нөміріңіз сақталды: {phone}\nЕнді тапсырыс бетіне оралыңыз.",
    ky: "✅ Номериңиз сакталды: {phone}\nЭми буйрутма барагына кайтыңыз.",
    tg: "✅ Рақами шумо сабт шуд: {phone}\nАкнун ба саҳифаи фармоиш баргардед."
  },
  created: {
    uz: "🧾 <b>Buyurtma #{no}</b> · {shop}\n\n{body}\n\n⏳ Do'kon tasdiqlashini kuting. Holati shu yerga yoziladi.",
    ru: "🧾 <b>Заказ #{no}</b> · {shop}\n\n{body}\n\n⏳ Дождитесь подтверждения магазина. Статус придёт сюда.",
    en: "🧾 <b>Order #{no}</b> · {shop}\n\n{body}\n\n⏳ Please wait for the shop to confirm. Updates will come here.",
    kk: "🧾 <b>Тапсырыс #{no}</b> · {shop}\n\n{body}\n\n⏳ Дүкеннің растауын күтіңіз. Күйі осында жазылады.",
    ky: "🧾 <b>Буйрутма #{no}</b> · {shop}\n\n{body}\n\n⏳ Дүкөндүн ырастоосун күтүңүз. Абалы ушул жерге жазылат.",
    tg: "🧾 <b>Фармоиш #{no}</b> · {shop}\n\n{body}\n\n⏳ Тасдиқи мағозаро интизор шавед. Ҳолат ба ин ҷо меояд."
  },
  accepted: {
    uz: "✅ <b>Buyurtma #{no}</b> qabul qilindi · {shop}{eta}",
    ru: "✅ <b>Заказ #{no}</b> принят · {shop}{eta}",
    en: "✅ <b>Order #{no}</b> accepted · {shop}{eta}",
    kk: "✅ <b>Тапсырыс #{no}</b> қабылданды · {shop}{eta}",
    ky: "✅ <b>Буйрутма #{no}</b> кабыл алынды · {shop}{eta}",
    tg: "✅ <b>Фармоиш #{no}</b> қабул шуд · {shop}{eta}"
  },
  eta: {
    uz: "\n⏱ Taxminan {m} daqiqada tayyor bo'ladi.",
    ru: "\n⏱ Будет готов примерно через {m} мин.",
    en: "\n⏱ It will be ready in about {m} min.",
    kk: "\n⏱ Шамамен {m} минутта дайын болады.",
    ky: "\n⏱ Болжол менен {m} мүнөттө даяр болот.",
    tg: "\n⏱ Тақрибан баъди {m} дақиқа тайёр мешавад."
  },
  ready: {
    uz: "📦 <b>Buyurtma #{no}</b> tayyor. Olib ketishingiz mumkin.{addr}",
    ru: "📦 <b>Заказ #{no}</b> готов. Можно забирать.{addr}",
    en: "📦 <b>Order #{no}</b> is ready for pickup.{addr}",
    kk: "📦 <b>Тапсырыс #{no}</b> дайын. Алып кетуге болады.{addr}",
    ky: "📦 <b>Буйрутма #{no}</b> даяр. Алып кетсеңиз болот.{addr}",
    tg: "📦 <b>Фармоиш #{no}</b> тайёр. Метавонед гирифта баред.{addr}"
  },
  delivering: {
    uz: "🚚 <b>Buyurtma #{no}</b> yo'lga chiqdi.",
    ru: "🚚 <b>Заказ #{no}</b> в пути.",
    en: "🚚 <b>Order #{no}</b> is on the way.",
    kk: "🚚 <b>Тапсырыс #{no}</b> жолға шықты.",
    ky: "🚚 <b>Буйрутма #{no}</b> жолго чыкты.",
    tg: "🚚 <b>Фармоиш #{no}</b> дар роҳ аст."
  },
  done: {
    uz: "🎉 <b>Buyurtma #{no}</b> yakunlandi. Jami: <b>{total}</b>.\nXaridingiz uchun rahmat!",
    ru: "🎉 <b>Заказ #{no}</b> выполнен. Итого: <b>{total}</b>.\nСпасибо за покупку!",
    en: "🎉 <b>Order #{no}</b> is complete. Total: <b>{total}</b>.\nThank you for your purchase!",
    kk: "🎉 <b>Тапсырыс #{no}</b> аяқталды. Барлығы: <b>{total}</b>.\nСатып алғаныңызға рахмет!",
    ky: "🎉 <b>Буйрутма #{no}</b> аткарылды. Жалпы: <b>{total}</b>.\nСатып алганыңыз үчүн рахмат!",
    tg: "🎉 <b>Фармоиш #{no}</b> анҷом ёфт. Ҳамагӣ: <b>{total}</b>.\nТашаккур барои харид!"
  },
  rejected: {
    uz: "😔 Kechirasiz, <b>buyurtma #{no}</b> bekor qilindi · {shop}{reason}",
    ru: "😔 К сожалению, <b>заказ #{no}</b> отменён · {shop}{reason}",
    en: "😔 Sorry, <b>order #{no}</b> was cancelled · {shop}{reason}",
    kk: "😔 Кешіріңіз, <b>тапсырыс #{no}</b> бас тартылды · {shop}{reason}",
    ky: "😔 Кечиресиз, <b>буйрутма #{no}</b> жокко чыгарылды · {shop}{reason}",
    tg: "😔 Бубахшед, <b>фармоиш #{no}</b> бекор шуд · {shop}{reason}"
  },
  reason: { uz: "\nSabab: {r}", ru: "\nПричина: {r}", en: "\nReason: {r}", kk: "\nСебебі: {r}", ky: "\nСебеби: {r}", tg: "\nСабаб: {r}" },
  cancelled: {
    uz: "Buyurtma #{no} bekor qilindi.",
    ru: "Заказ #{no} отменён.",
    en: "Order #{no} has been cancelled.",
    kk: "Тапсырыс #{no} бас тартылды.",
    ky: "Буйрутма #{no} жокко чыгарылды.",
    tg: "Фармоиш #{no} бекор шуд."
  },
  cancelLate: {
    uz: "Buyurtmani endi bekor qilib bo'lmaydi: do'kon uni qabul qilgan.{phone}",
    ru: "Заказ уже нельзя отменить: магазин его принял.{phone}",
    en: "The order can no longer be cancelled: the shop has accepted it.{phone}",
    kk: "Тапсырыстан енді бас тартуға болмайды: дүкен оны қабылдады.{phone}",
    ky: "Буйрутманы эми жокко чыгарууга болбойт: дүкөн аны кабыл алды.{phone}",
    tg: "Фармоишро дигар бекор кардан мумкин нест: мағоза онро қабул кардааст.{phone}"
  },
  callShop: { uz: " Do'kon telefoni: {p}", ru: " Телефон магазина: {p}", en: " Shop phone: {p}", kk: " Дүкен телефоны: {p}", ky: " Дүкөндүн телефону: {p}", tg: " Телефони мағоза: {p}" },
  fallback: {
    uz: "🛍 <b>{shop}</b> — buyurtma berish uchun tugmani bosing.",
    ru: "🛍 <b>{shop}</b> — нажмите кнопку, чтобы сделать заказ.",
    en: "🛍 <b>{shop}</b> — tap the button to place an order.",
    kk: "🛍 <b>{shop}</b> — тапсырыс беру үшін түймені басыңыз.",
    ky: "🛍 <b>{shop}</b> — буйрутма берүү үчүн баскычты басыңыз.",
    tg: "🛍 <b>{shop}</b> — барои фармоиш тугмаро пахш кунед."
  },
  goods: { uz: "Mahsulotlar", ru: "Товары", en: "Items", kk: "Тауарлар", ky: "Товарлар", tg: "Молҳо" },
  fee: { uz: "Yetkazib berish", ru: "Доставка", en: "Delivery", kk: "Жеткізу", ky: "Жеткирүү", tg: "Расонидан" },
  free: { uz: "bepul", ru: "бесплатно", en: "free", kk: "тегін", ky: "акысыз", tg: "ройгон" },
  total: { uz: "Jami", ru: "Итого", en: "Total", kk: "Барлығы", ky: "Жалпы", tg: "Ҳамагӣ" },
  pickup: { uz: "🏪 Olib ketish", ru: "🏪 Самовывоз", en: "🏪 Pickup", kk: "🏪 Өзі алып кету", ky: "🏪 Өзү алып кетүү", tg: "🏪 Худ гирифта бурдан" },
  delivery: { uz: "🚚 Yetkazib berish", ru: "🚚 Доставка", en: "🚚 Delivery", kk: "🚚 Жеткізу", ky: "🚚 Жеткирүү", tg: "🚚 Расонидан" },
  payCash: { uz: "💵 To'lov: naqd", ru: "💵 Оплата: наличными", en: "💵 Payment: cash", kk: "💵 Төлем: қолма-қол", ky: "💵 Төлөм: накталай", tg: "💵 Пардохт: нақд" },
  payCard: { uz: "💳 To'lov: karta", ru: "💳 Оплата: картой", en: "💳 Payment: card", kk: "💳 Төлем: карта", ky: "💳 Төлөм: карта", tg: "💳 Пардохт: корт" },
  note: { uz: "💬 Izoh", ru: "💬 Комментарий", en: "💬 Note", kk: "💬 Пікір", ky: "💬 Эскертүү", tg: "💬 Шарҳ" },
  shopAddr: { uz: "\n📍 Manzil: {a}", ru: "\n📍 Адрес: {a}", en: "\n📍 Address: {a}", kk: "\n📍 Мекенжай: {a}", ky: "\n📍 Дарек: {a}", tg: "\n📍 Суроға: {a}" },
  ownerNew: {
    uz: "🛍 <b>Yangi buyurtma #{no}</b> · {shop}\n👤 {who}\n\n{body}\n\nIlovada qabul qiling: «Bot buyurtmalari».",
    ru: "🛍 <b>Новый заказ #{no}</b> · {shop}\n👤 {who}\n\n{body}\n\nПримите его в приложении: «Заказы из бота».",
    en: "🛍 <b>New order #{no}</b> · {shop}\n👤 {who}\n\n{body}\n\nAccept it in the app: “Bot orders”.",
    kk: "🛍 <b>Жаңа тапсырыс #{no}</b> · {shop}\n👤 {who}\n\n{body}\n\nҚолданбада қабылдаңыз: «Бот тапсырыстары».",
    ky: "🛍 <b>Жаңы буйрутма #{no}</b> · {shop}\n👤 {who}\n\n{body}\n\nКолдонмодо кабыл алыңыз: «Бот буйрутмалары».",
    tg: "🛍 <b>Фармоиши нав #{no}</b> · {shop}\n👤 {who}\n\n{body}\n\nДар барнома қабул кунед: «Фармоишҳои бот»."
  },
  ownerCancelled: {
    uz: "❌ Mijoz <b>buyurtma #{no}</b> ni bekor qildi · {shop}",
    ru: "❌ Клиент отменил <b>заказ #{no}</b> · {shop}",
    en: "❌ The customer cancelled <b>order #{no}</b> · {shop}",
    kk: "❌ Клиент <b>тапсырыс #{no}</b> бас тартты · {shop}",
    ky: "❌ Кардар <b>буйрутма #{no}</b> жокко чыгарды · {shop}",
    tg: "❌ Мизоҷ <b>фармоиши #{no}</b>-ро бекор кард · {shop}"
  },
  pushNew: { uz: "Yangi buyurtma #{no}", ru: "Новый заказ #{no}", en: "New order #{no}", kk: "Жаңа тапсырыс #{no}", ky: "Жаңы буйрутма #{no}", tg: "Фармоиши нав #{no}" },
  pushCancel: { uz: "Buyurtma #{no} bekor qilindi", ru: "Заказ #{no} отменён", en: "Order #{no} cancelled", kk: "Тапсырыс #{no} бас тартылды", ky: "Буйрутма #{no} жокко чыгарылды", tg: "Фармоиш #{no} бекор шуд" }
};
function lg(l) { return LANGS.indexOf(l) !== -1 ? l : 'uz'; }
function t(key, lang, vars) {
  const e = T[key]; if (!e) return key;
  let s = e[lg(lang)] || e.uz;
  Object.keys(vars || {}).forEach(function (k) { s = s.split('{' + k + '}').join(String(vars[k])); });
  return s;
}
module.exports = { t, T, LANGS, lg };
