'use strict';
/* fix114-debts: do'konlar orasidagi qarzlar — server mantig'i sinovlari */
const test = require('node:test');
const assert = require('node:assert/strict');
const SD = require('../src/debts/shared');

const { fakeDb, fakeMessaging } = require('./helpers/sdFake');

let NOW = Date.parse('2026-10-15T10:00:00Z');
const nowMs = function () { return NOW; };

/* A — qarz beruvchi do'kon, B — qarzdor do'kon (egasi), Bstaff — B ning xodimlari */
function seed() {
  return {
    'businesses/A': { businessName: 'Optom Savdo', businessPhone: '+998 71 200 00 00', currency: 'UZS', businessAddress: 'Toshkent' },
    'businesses/B': { businessName: 'Mini Market', ownerPhone: '+998901234567', currency: 'UZS' },
    'businesses/C': { businessName: 'Dollar Shop', currency: 'USD' },
    'businesses/A/customers/c1': { id: 'c1', name: 'Mini Market (Ali)', phone: '90 123 45 67', debt: 450000, _u: 1700 },
    'businesses/A/customers/c2': { id: 'c2', name: 'Boshqa', phone: '+998 91 000 00 00', debt: 10000 },
    'businesses/C/customers/x1': { id: 'x1', name: 'Ali aka', phone: '+998901234567', debt: 25 },
    'businesses/A/ledger/l1': { id: 'l1', customerId: 'c1', type: 'sale', amount: 500000, date: '2026-10-10T08:00:00.000Z', note: '', staffName: 'Kassir Vali' },
    'businesses/A/ledger/l2': { id: 'l2', customerId: 'c1', type: 'payment', amount: 50000, date: '2026-10-12T08:00:00.000Z', note: 'naqd', method: 'cash', staffName: 'Kassir Vali' },
    'businesses/A/ledger/l3': { id: 'l3', customerId: 'c2', type: 'sale', amount: 10000, date: '2026-10-11T08:00:00.000Z' },
    'businesses/A/sales/s1': { id: 's1', customerId: 'c1', receiptNumber: '17', date: '2026-10-10T08:00:00.000Z', total: 500000, paymentType: 'credit',
      items: [{ name: 'Cola 1L', qty: 20, price: 12000, costPrice: 9000, productId: 'p1' }, { name: 'Non', qty: 26, price: 10000, costPrice: 7000 }] },
    'businesses/A/sales/s2': { id: 's2', customerId: 'c1', receiptNumber: '18', date: '2026-10-11T08:00:00.000Z', total: 30000, paymentType: 'cash', items: [{ name: 'Suv', qty: 5, price: 6000 }] },
    'businesses/A/sales/s3': { id: 's3', customerId: 'c1', receiptNumber: '19', date: '2026-10-13T08:00:00.000Z', total: 100000, paymentType: 'mixed',
      splitPayments: [{ method: 'cash', amount: 40000 }, { method: 'credit', amount: 60000 }], items: [{ name: 'Shakar', qty: 10, price: 10000, costPrice: 8000 }] },
    'staffAuth/uAdm': { businessId: 'B', staffId: 's1', role: 'admin', permissions: {} },
    'staffAuth/uAcc': { businessId: 'B', staffId: 's2', role: 'cashier', permissions: { myDebts: true } },
    'staffAuth/uCash': { businessId: 'B', staffId: 's3', role: 'cashier', permissions: { customers: true } },
    'businesses/B/pushTokens/t1': { token: 't1', admin: true, lang: 'uz' },
    'businesses/B/pushTokens/t2': { token: 't2', admin: true, lang: 'ru', sound: false },
    'businesses/B/pushTokens/t3': { token: 't3', admin: false, lang: 'uz' },
    'businesses/A/pushTokens/a1': { token: 'a1', admin: true, lang: 'uz' }
  };
}
const deps = function (db, msg) { return { db: db, messaging: msg || fakeMessaging(), nowMs: nowMs, superUid: 'SUPER' }; };
const req = function (db, uid, body) { return SD.handleRequest(deps(db), uid, body); };

test('phoneKey: turli yozilishlar bir xil kalitga keladi', function () {
  const k = '998901234567';
  ['+998 90 123-45-67', '90 123 45 67', '(90) 1234567', '998901234567', '8 90 123 45 67', '0 90 123 45 67', '0099890 123 45 67', '+998901234567'].forEach(function (s) {
    assert.equal(SD.phoneKey(s, '998'), k, s);
  });
  assert.equal(SD.phoneKey('', '998'), '');
  assert.equal(SD.phoneKey('12345', '998'), '');
  assert.equal(SD.phoneKey('*#06#', '998'), '');
  assert.equal(SD.phoneKey('+7 701 123 45 67', '998'), '77011234567');
  assert.equal(SD.phoneKey('8 701 123 45 67', '7'), '77011234567');
  assert.equal(SD.phoneKey('701 123 45 67', '7'), '77011234567');
  assert.equal(SD.phoneKey('92 777 12 34', '992'), '992927771234');
  assert.equal(SD.phoneKey(null, '998'), '');
  assert.equal(SD.ccOfCurrency('TJS'), '992'); assert.equal(SD.ccOfCurrency('USD'), '998'); assert.equal(SD.ccOfCurrency(undefined), '998');
});

test('bog\'lash: ega bog\'laydi, holat, qayta bog\'lash, xodim huquqlari', async function () {
  const db = fakeDb(seed());
  let r = await req(db, 'B', { action: 'status' });
  assert.equal(r.status, 200); assert.equal(r.body.linked, false); assert.equal(r.body.canLink, true);
  r = await req(db, 'B', { action: 'link', phone: '90 123 45 67' });
  assert.equal(r.status, 200); assert.equal(r.body.phone, '+998901234567');
  assert.deepEqual(db.store['debtPhoneClaims/998901234567'].bid, 'B');
  r = await req(db, 'B', { action: 'status' });
  assert.equal(r.body.linked, true); assert.equal(r.body.phone, '+998901234567');
  r = await req(db, 'B', { action: 'link', phone: '+998 90 123 45 67' });
  assert.equal(r.body.same, true, 'o\'sha raqam qayta — o\'zgarish yo\'q');
  assert.equal((await req(db, 'uCash', { action: 'link', phone: '901112233' })).status, 403, 'oddiy kassir bog\'lay olmaydi');
  assert.equal((await req(db, 'uAcc', { action: 'link', phone: '901112233' })).status, 403, 'hisobchi ham bog\'lay olmaydi (faqat ko\'radi)');
  assert.equal((await req(db, 'uAcc', { action: 'status' })).body.linked, true, 'hisobchi holatni ko\'radi');
  assert.equal((await req(db, 'uAcc', { action: 'status' })).body.canLink, false);
  assert.equal((await req(db, 'uCash', { action: 'list' })).status, 403, 'myDebts huquqisiz kassir ko\'ra olmaydi');
  assert.equal((await req(db, 'B', { action: 'link', phone: 'abc' })).body.code, 'invalid_phone');
  assert.equal((await req(db, 'B', { action: 'nima' })).body.code, 'bad_action');
  assert.equal((await req(db, '', { action: 'status' })).status, 401);
  assert.equal((await req(db, 'NOBIZ', { action: 'link', phone: '901112233' })).body.code, 'no_business', 'biznesi yo\'q hisob bog\'lay olmaydi');
});

test('bitta raqam — bitta biznes; bo\'shatish; superadmin bo\'shatadi', async function () {
  const db = fakeDb(seed());
  assert.equal((await req(db, 'B', { action: 'link', phone: '901234567' })).status, 200);
  let r = await req(db, 'C', { action: 'link', phone: '+998901234567' });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'taken');
  assert.equal(db.store['debtPhoneClaims/998901234567'].bid, 'B', 'egasi o\'zgarmadi');
  r = await req(db, 'C', { action: 'list' });
  assert.equal(r.body.linked, false, 'C hech narsa ko\'rmaydi');
  // superadmin bo'shatadi
  assert.equal((await req(db, 'B', { action: 'adminRelease', phone: '901234567' })).status, 403, 'oddiy foydalanuvchi superadmin amalini qila olmaydi');
  r = await req(db, 'SUPER', { action: 'adminRelease', phone: '+998 90 123 45 67' });
  assert.equal(r.body.released, true); assert.equal(r.body.bid, 'B');
  assert.equal(db.store['debtPhoneClaims/998901234567'], undefined);
  assert.equal((await req(db, 'B', { action: 'status' })).body.linked, false);
  // egasi o'zi bo'shatadi
  assert.equal((await req(db, 'C', { action: 'link', phone: '+998901234567' })).status, 200);
  assert.equal((await req(db, 'C', { action: 'unlink' })).body.linked, false);
  assert.equal(db.store['debtPhoneClaims/998901234567'], undefined);
  assert.equal((await req(db, 'C', { action: 'status' })).body.linked, false);
});

test('cheklovlar: kuniga 10 urinish, 30 kunda 3 marta raqam almashtirish', async function () {
  const db = fakeDb(seed());
  db.store['debtPhoneClaims/998999999999'] = { bid: 'X' };
  for (let i = 0; i < 10; i++) assert.equal((await req(db, 'B', { action: 'link', phone: '999999999' })).body.code, 'taken');
  assert.equal((await req(db, 'B', { action: 'link', phone: '901234567' })).body.code, 'rate', '11-urinish to\'xtatiladi');
  NOW += 86400000 + 1000;
  assert.equal((await req(db, 'B', { action: 'link', phone: '901234567' })).status, 200, 'ertasi kuni yana mumkin');
  assert.equal((await req(db, 'B', { action: 'link', phone: '901234568' })).status, 200);
  assert.equal((await req(db, 'B', { action: 'link', phone: '901234569' })).status, 200);
  const r = await req(db, 'B', { action: 'link', phone: '901234570' });
  assert.equal(r.body.code, 'rate_links', '30 kunda 4-almashtirish to\'xtatiladi');
  assert.equal(db.store['debtPhoneClaims/998901234567'], undefined, 'eski raqamlar bo\'shatildi');
  assert.equal(db.store['debtPhoneClaims/998901234568'], undefined);
  assert.equal(db.store['debtPhoneClaims/998901234569'].bid, 'B');
  NOW += 31 * 86400000;
  assert.equal((await req(db, 'B', { action: 'link', phone: '901234570' })).status, 200, '30 kundan keyin yana mumkin');
});

test('indeks + ro\'yxat + tafsilot: qarzdor faqat o\'z qarzini ko\'radi, ichki ma\'lumot berilmaydi', async function () {
  const db = fakeDb(seed());
  const st = await SD.runBackfill(deps(db));
  assert.equal(st.links, 3);
  assert.equal(db.store['debtLinks/A__c1'].phoneKey, '998901234567');
  assert.equal((await SD.runBackfill(deps(db))).skipped, true, 'bir marta ishlaydi');
  await req(db, 'B', { action: 'link', phone: '+998901234567' });
  let r = await req(db, 'B', { action: 'list' });
  assert.equal(r.body.linked, true);
  assert.equal(r.body.items.length, 2);
  assert.deepEqual(r.body.items.map(function (x) { return [x.shop, x.debt, x.currency]; }), [['Optom Savdo', 450000, 'UZS'], ['Dollar Shop', 25, 'USD']]);
  assert.equal(r.body.items[0].shopPhone, '+998 71 200 00 00');
  assert.equal(r.body.items[0].name, 'Mini Market (Ali)');
  // xodimlar
  assert.equal((await req(db, 'uAdm', { action: 'list' })).body.items.length, 2, 'B admini ko\'radi');
  assert.equal((await req(db, 'uAcc', { action: 'list' })).body.items.length, 2, 'myDebts huquqli xodim ko\'radi');
  // tafsilot
  r = await req(db, 'B', { action: 'detail', bid: 'A', cid: 'c1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.debt, 450000); assert.equal(r.body.shopAddress, 'Toshkent');
  assert.deepEqual(r.body.ledger.map(function (l) { return [l.type, l.amount]; }), [['payment', 50000], ['sale', 500000]], 'yangisi tepada');
  assert.equal(r.body.ledger[0].method, 'cash'); assert.equal(r.body.ledger[0].note, 'naqd');
  assert.deepEqual(r.body.sales.map(function (s) { return [s.no, s.credit]; }), [['19', 60000], ['17', 500000]], 'faqat nasiyali cheklar, aralashda nasiya qismi');
  const json = JSON.stringify(r.body);
  assert.equal(json.indexOf('costPrice'), -1, 'tannarx berilmaydi');
  assert.equal(json.indexOf('9000'), -1, 'tannarx qiymati ham yo\'q');
  assert.equal(json.indexOf('Kassir Vali'), -1, 'xodim ismi berilmaydi');
  assert.equal(json.indexOf('productId'), -1);
  assert.equal(json.indexOf('Suv'), -1, 'naqd chek (nasiyasiz) ko\'rsatilmaydi');
  assert.deepEqual(r.body.sales[1].items[0], { name: 'Cola 1L', qty: 20, price: 12000 });
  // begona mijozni so'rash
  assert.equal((await req(db, 'B', { action: 'detail', bid: 'A', cid: 'c2' })).status, 403, 'boshqa raqamdagi mijoz — taqiqlangan');
  assert.equal((await req(db, 'B', { action: 'detail', bid: 'A', cid: '../x' })).status, 400);
  assert.equal((await req(db, 'B', { action: 'detail', bid: 'B', cid: 'c1' })).status, 403);
  assert.equal((await req(db, 'C', { action: 'detail', bid: 'A', cid: 'c1' })).status, 403, 'raqam bog\'lamagan biznes ko\'ra olmaydi');
  assert.equal((await req(db, 'uCash', { action: 'detail', bid: 'A', cid: 'c1' })).status, 403);
  // o'z biznesidagi o'z raqami (B o'z mijozlariga o'zini yozgan) — ro'yxatda ham, tafsilotda ham yo'q
  db.store['businesses/B/customers/self'] = { id: 'self', name: 'Men', phone: '901234567', debt: 999 };
  await SD.handleCustomerWrite(deps(db), 'B', 'self', null, db.store['businesses/B/customers/self']);
  assert.equal(db.store['debtLinks/B__self'].phoneKey, '998901234567');
  assert.equal((await req(db, 'B', { action: 'list' })).body.items.length, 2, 'o\'zi o\'ziga qarz ko\'rinmaydi');
  assert.equal((await req(db, 'B', { action: 'detail', bid: 'B', cid: 'self' })).status, 403);
  // indeksda yo'q (bog'lanmagan) mijozni to'g'ridan-to'g'ri so'rash — raqami mos bo'lsa ham taqiqlangan
  db.store['businesses/A/customers/c9'] = { id: 'c9', name: 'Yashirin', phone: '+998901234567', debt: 5 };
  assert.equal((await req(db, 'B', { action: 'detail', bid: 'A', cid: 'c9' })).status, 403);
  // qarz beruvchi mijoz raqamini o'zgartirsa (indeks hali yangilanmagan bo'lsa ham) — darhol ko'rinmaydi
  db.store['businesses/A/customers/c1'].phone = '+998 99 999 99 99';
  assert.equal((await req(db, 'B', { action: 'detail', bid: 'A', cid: 'c1' })).status, 403);
  assert.equal((await req(db, 'B', { action: 'list' })).body.items.length, 1);
  // o'chirilgan (yashirilgan) mijoz
  db.store['businesses/A/customers/c1'].phone = '90 123 45 67';
  db.store['businesses/A/customers/c1'].hidden = true;
  assert.equal((await req(db, 'B', { action: 'list' })).body.items.length, 1);
});

test('trigger: mijoz yozuvi o\'zgarishi indeks va push\'ni to\'g\'ri yuritadi', async function () {
  const db = fakeDb(seed());
  const msg = fakeMessaging();
  const d = deps(db, msg);
  await req(db, 'B', { action: 'link', phone: '+998901234567' });
  // yangi mijoz, qarzsiz -> indeks bor, push yo'q
  let r = await SD.handleCustomerWrite(d, 'A', 'n1', null, { name: 'Ali', phone: '901234567' });
  assert.equal(r.link, 'set'); assert.equal(r.pushed, 0);
  assert.equal(db.store['debtLinks/A__n1'].phoneKey, '998901234567');
  // qarz oshdi -> push faqat B ning admin qurilmalariga, tilida
  r = await SD.handleCustomerWrite(d, 'A', 'n1', { name: 'Ali', phone: '901234567', debt: 0 }, { name: 'Ali', phone: '901234567', debt: 150000 });
  assert.equal(r.pushed, 2);
  assert.deepEqual(msg.sent.map(function (m) { return m.token; }).sort(), ['t1', 't2']);
  const uz = msg.sent.find(function (m) { return m.token === 't1'; });
  assert.equal(uz.notification.title, 'Optom Savdo');
  assert.equal(uz.notification.body, "Yangi qarz yozildi: +150 000 so'm. Jami qarzingiz: 150 000 so'm");
  assert.equal(uz.data.type, 'sharedDebt'); assert.equal(uz.data.bid, 'A'); assert.equal(uz.data.cid, 'n1');
  assert.equal(uz.android.notification.channelId, 'reminders');
  const ru = msg.sent.find(function (m) { return m.token === 't2'; });
  assert.equal(ru.notification.body, 'Записан новый долг: +150 000 сум. Ваш общий долг: 150 000 сум');
  assert.equal(ru.android.notification.channelId, 'quiet', 'ovozsiz qurilma');
  // to'lov
  msg.sent.length = 0;
  await SD.handleCustomerWrite(d, 'A', 'n1', { name: 'Ali', phone: '901234567', debt: 150000 }, { name: 'Ali', phone: '901234567', debt: 50000 });
  assert.equal(msg.sent.find(function (m) { return m.token === 't1'; }).notification.body, "Qarzingiz kamaydi: −100 000 so'm. Qolgan qarz: 50 000 so'm");
  msg.sent.length = 0;
  await SD.handleCustomerWrite(d, 'A', 'n1', { name: 'Ali', phone: '901234567', debt: 50000 }, { name: 'Ali', phone: '901234567', debt: 0 });
  assert.equal(msg.sent.find(function (m) { return m.token === 't1'; }).notification.body, "Qarzingiz kamaydi: −50 000 so'm. Qarz to'liq yopildi.");
  // faqat _u o'zgardi -> hech narsa
  const w0 = db.writes.length; msg.sent.length = 0;
  r = await SD.handleCustomerWrite(d, 'A', 'n1', { name: 'Ali', phone: '901234567', debt: 0, _u: 1 }, { name: 'Ali', phone: '901234567', debt: 0, _u: 2 });
  assert.equal(r.skipped, 'same'); assert.equal(db.writes.length, w0); assert.equal(msg.sent.length, 0);
  // raqamsiz mijoz -> hech narsa
  r = await SD.handleCustomerWrite(d, 'A', 'n2', null, { name: 'Raqamsiz', debt: 1000 });
  assert.equal(r.skipped, 'nophone');
  // raqam o'zgardi -> indeks yangi raqamga, qarzdor endi ko'rmaydi
  await SD.handleCustomerWrite(d, 'A', 'n1', { name: 'Ali', phone: '901234567', debt: 0 }, { name: 'Ali', phone: '+998 93 111 22 33', debt: 0 });
  assert.equal(db.store['debtLinks/A__n1'].phoneKey, '998931112233');
  // yashirildi / o'chirildi -> indeks o'chadi
  await SD.handleCustomerWrite(d, 'A', 'n1', { name: 'Ali', phone: '+998 93 111 22 33' }, { name: 'Ali', phone: '+998 93 111 22 33', hidden: true });
  assert.equal(db.store['debtLinks/A__n1'], undefined);
  await SD.handleCustomerWrite(d, 'A', 'c1', { name: 'X', phone: '901234567', debt: 1 }, { _deleted: true, _u: 5 });
  assert.equal(db.store['debtLinks/A__c1'], undefined);
  await SD.handleCustomerWrite(d, 'A', 'c2', { name: 'Boshqa', phone: '+998 91 000 00 00', debt: 10000 }, null);
  assert.equal(db.store['debtLinks/A__c2'], undefined);
  // o'z-o'ziga qarz (B o'z mijozlarida o'z raqamini yozgan) -> push yo'q
  msg.sent.length = 0;
  await SD.handleCustomerWrite(d, 'B', 'self', { name: 'Men', phone: '901234567', debt: 0 }, { name: 'Men', phone: '901234567', debt: 5000 });
  assert.equal(msg.sent.length, 0);
  // bog'lanmagan raqam -> push yo'q
  await SD.handleCustomerWrite(d, 'A', 'n3', { name: 'Z', phone: '977777777', debt: 0 }, { name: 'Z', phone: '977777777', debt: 5000 });
  assert.equal(msg.sent.length, 0);
  // yangi mijoz birdaniga qarz bilan -> push
  await SD.handleCustomerWrite(d, 'C', 'n4', null, { name: 'Ali', phone: '+998901234567', debt: 70 });
  assert.equal(msg.sent.find(function (m) { return m.token === 't1'; }).notification.body, 'Yangi qarz yozildi: +$70. Jami qarzingiz: $70');
});

test('trigger: B o\'z ro\'yxatida trigger yozgan yangi qarzni darhol ko\'radi (backfill bo\'lmasa ham)', async function () {
  const db = fakeDb(seed());
  const d = deps(db);
  await req(db, 'B', { action: 'link', phone: '+998901234567' });
  assert.equal((await req(db, 'B', { action: 'list' })).body.items.length, 0, 'indeks hali bo\'sh');
  db.store['businesses/A/customers/c1'].debt = 460000;
  await SD.handleCustomerWrite(d, 'A', 'c1', { name: 'Mini Market (Ali)', phone: '90 123 45 67', debt: 450000 }, db.store['businesses/A/customers/c1']);
  const r = await req(db, 'B', { action: 'list' });
  assert.equal(r.body.items.length, 1); assert.equal(r.body.items[0].debt, 460000);
});

test('creditOfSale va pushBody chegaraviy holatlar', function () {
  assert.equal(SD.creditOfSale({ paymentType: 'credit', total: 100 }), 100);
  assert.equal(SD.creditOfSale({ paymentType: 'cash', total: 100 }), 0);
  assert.equal(SD.creditOfSale({ paymentType: 'mixed', total: 100, splitPayments: [{ method: 'card', amount: 30 }, { method: 'credit', amount: 70 }] }), 70);
  assert.equal(SD.creditOfSale({ paymentType: 'credit', total: 100, splitPayments: [] }), 100);
  assert.equal(SD.pushBody('xx', 0, 1000, 'UZS'), "Yangi qarz yozildi: +1 000 so'm. Jami qarzingiz: 1 000 so'm");
  assert.equal(SD.pushBody('en', 3000, 1000, 'EUR'), 'Your debt decreased: −€2 000. Remaining: €1 000');
  assert.equal(SD.pushBody('uz', 10, 5, 'NOPE'), "Qarzingiz kamaydi: −5 so'm. Qolgan qarz: 5 so'm");
});

/* fix115-i18n: qozoq / qirg'iz / tojik push matnlari */
test('pushBody: kk / ky / tg tillarida', function () {
  assert.equal(SD.pushBody('kk', 0, 150000, 'UZS'), 'Жаңа қарыз жазылды: +150 000 сом. Жалпы қарызыңыз: 150 000 сом');
  assert.equal(SD.pushBody('ky', 150000, 50000, 'UZS'), 'Карызыңыз азайды: −100 000 сом. Калдык: 50 000 сом');
  assert.equal(SD.pushBody('tg', 50000, 0, 'UZS'), 'Қарзи шумо кам шуд: −50 000 сум. Қарз пурра пардохт шуд.');
  assert.equal(SD.pushBody('tg', 0, 5, 'TJS'), 'Қарзи нав сабт шуд: +5 сомонӣ. Қарзи умумии шумо: 5 сомонӣ');
  assert.equal(SD.pushBody('kk', 0, 7, 'USD'), 'Жаңа қарыз жазылды: +$7. Жалпы қарызыңыз: $7');
});
