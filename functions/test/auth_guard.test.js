'use strict';
/* fix205-google: ikkinchi akkaunt / yangi bo'sh do'kon ochilmasligi — server tekshiruvi */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDb } = require('./helpers/tgFake');
const G = require('../src/auth/guard');
const NOW = 1900000000000;
function deps(seed, users) {
  users = users || {};
  const deleted = [];
  return {
    deleted: deleted,
    db: fakeDb(seed),
    nowMs: () => NOW,
    getUserByEmail: async (em) => { const u = Object.values(users).find((x) => String(x.email).toLowerCase() === String(em).toLowerCase()); return u ? { uid: u.uid } : null; },
    getUser: async (uid) => { const u = users[uid]; if (!u) throw new Error('no user'); return { uid: u.uid, creationMs: u.creationMs, providers: u.providers }; },
    deleteUser: async (uid) => { deleted.push(uid); delete users[uid]; }
  };
}
test('eski egasi Google bilan kirdi (bitta akkaunt) — «own», hech narsa o\'chirilmaydi', async () => {
  const d = deps({ 'businesses/ownerA1': { ownerEmail: 'ali@gmail.com' } }, { ownerA1: { uid: 'ownerA1', email: 'ali@gmail.com', creationMs: NOW - 9e9, providers: ['password', 'google.com'] } });
  const r = await G.checkAccount(d, 'ownerA1', 'ali@gmail.com');
  assert.equal(r.status, 'own'); assert.deepEqual(d.deleted, []);
});
test('xodim akkaunti — «staff»', async () => {
  const d = deps({ 'staffAuth/st1': { businessId: 'ownerA1' } });
  assert.equal((await G.checkAccount(d, 'st1', 'x@savdopos-staff.internal')).status, 'staff');
});
test('haqiqatan yangi foydalanuvchi — «new» (shartlar va odatdagi yangi do\'kon oqimi)', async () => {
  const d = deps({ 'businesses/other9': { ownerEmail: 'boshqa@mail.ru' } }, { newG1: { uid: 'newG1', email: 'yangi@gmail.com', creationMs: NOW - 1000, providers: ['google.com'] } });
  const r = await G.checkAccount(d, 'newG1', 'yangi@gmail.com');
  assert.equal(r.status, 'new'); assert.deepEqual(d.deleted, []);
});
test('shu email bilan boshqa akkaunt bor (ikkinchi akkaunt ochilib qolgan) — «conflict», yangi bo\'sh akkaunt o\'chiriladi', async () => {
  const users = { ownerA1: { uid: 'ownerA1', email: 'ali@mail.uz', creationMs: NOW - 9e9, providers: ['password'] }, newG1: { uid: 'newG1', email: 'ali@mail.uz', creationMs: NOW - 5000, providers: ['google.com'] } };
  const d = deps({ 'businesses/ownerA1': { ownerEmail: 'ali@mail.uz' } }, users);
  const r = await G.checkAccount(d, 'newG1', 'ali@mail.uz');
  assert.equal(r.status, 'conflict'); assert.equal(r.removed, true); assert.deepEqual(d.deleted, ['newG1']);
  assert.equal(d.db.store['businesses/newG1'], undefined, 'yangi do\'kon yaratilmagan');
});
test('auth\'da topilmasa ham, do\'kon egasi emaili (katta-kichik harf) bo\'yicha topiladi — «conflict»', async () => {
  const d = deps({ 'businesses/ownerB2': { ownerEmail: 'vali@mail.uz' } }, { newG2: { uid: 'newG2', email: 'Vali@Mail.uz', creationMs: NOW - 1000, providers: ['google.com'] } });
  const r = await G.checkAccount(d, 'newG2', 'Vali@Mail.uz');
  assert.equal(r.status, 'conflict'); assert.deepEqual(d.deleted, ['newG2']);
});
test('parolli yoki eski akkaunt hech qachon avtomatik o\'chirilmaydi (faqat yangi, faqat Google)', async () => {
  const seed = { 'businesses/ownerA1': { ownerEmail: 'ali@mail.uz' } };
  const d1 = deps(seed, { ownerA1: { uid: 'ownerA1', email: 'ali@mail.uz', creationMs: 0, providers: ['password'] }, x1: { uid: 'x1', email: 'ali@mail.uz', creationMs: NOW - 1000, providers: ['password', 'google.com'] } });
  const r1 = await G.checkAccount(d1, 'x1', 'ali@mail.uz');
  assert.equal(r1.status, 'conflict'); assert.equal(r1.removed, false); assert.deepEqual(d1.deleted, []);
  const d2 = deps(seed, { ownerA1: { uid: 'ownerA1', email: 'ali@mail.uz', creationMs: 0, providers: ['password'] }, x2: { uid: 'x2', email: 'ali@mail.uz', creationMs: NOW - G.FRESH_MS - 1, providers: ['google.com'] } });
  const r2 = await G.checkAccount(d2, 'x2', 'ali@mail.uz');
  assert.equal(r2.status, 'conflict'); assert.equal(r2.removed, false); assert.deepEqual(d2.deleted, []);
});
test('emailsiz akkaunt — «new» (bo\'sh qidiruv qilinmaydi)', async () => {
  const d = deps({ 'businesses/o1': { ownerEmail: '' } });
  assert.equal((await G.checkAccount(d, 'tg123', '')).status, 'new');
});
test('noto\'g\'ri uid — xato', async () => {
  const d = deps({});
  assert.equal((await G.checkAccount(d, '', 'a@b.c')).status, 'error');
});
