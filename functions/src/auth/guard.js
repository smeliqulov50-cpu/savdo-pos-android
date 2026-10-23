'use strict';
/* fix205-google: ikkinchi akkaunt (va yangi bo'sh do'kon) ochilmasligi uchun server tekshiruvi.
   Google (keyin Telegram) bilan kirgandan keyin ilova do'konni ochishdan OLDIN shu yerdan so'raydi:
   - 'staff'    — xodim akkaunti;
   - 'own'      — bu akkauntning do'koni bor (eski do'kon ochiladi);
   - 'conflict' — shu email bilan BOSHQA akkaunt yoki do'kon bor. Yangi bo'sh akkaunt o'chiriladi (agar u hozirgina,
                   faqat Google bilan yaratilgan bo'lsa), ilova esa «parolni kiriting — Google unga ulanadi» oynasini ko'rsatadi;
   - 'new'      — haqiqatan yangi foydalanuvchi: ilova shartlarga rozilik so'raydi, keyin odatdagi «yangi do'kon» oqimi.
   deps: { db, getUserByEmail(email) -> {uid}|null, getUser(uid) -> {uid, creationMs, providers[]}|null, deleteUser(uid), nowMs() } */
const FRESH_MS = 30 * 60 * 1000;   // faqat oxirgi 30 daqiqada yaratilgan akkaunt avtomatik o'chiriladi
const SAFE_PROVIDERS = ['google.com'];   // parolli akkaunt hech qachon avtomatik o'chirilmaydi

async function exists(db, path) {
  const parts = path.split('/');
  const s = await db.collection(parts[0]).doc(parts[1]).get();
  return s.exists;
}

async function checkAccount(deps, uid, email) {
  const db = deps.db;
  if (!uid || typeof uid !== 'string') return { status: 'error', code: 'bad-uid' };
  if (await exists(db, 'staffAuth/' + uid)) return { status: 'staff' };
  if (await exists(db, 'businesses/' + uid)) return { status: 'own' };
  const em = typeof email === 'string' ? email.trim() : '';
  if (!em) return { status: 'new' };
  let other = null;
  try {
    const u = await deps.getUserByEmail(em);
    if (u && u.uid && u.uid !== uid) other = u.uid;
  } catch (e) { /* topilmadi */ }
  if (!other) {
    const vals = Array.from(new Set([em, em.toLowerCase()]));
    for (let i = 0; i < vals.length && !other; i++) {
      const s = await db.collection('businesses').where('ownerEmail', '==', vals[i]).limit(5).get();
      const d = s.docs.find(function (x) { return x.id !== uid; });
      if (d) other = d.id;
    }
  }
  if (!other) return { status: 'new' };
  let removed = false;
  try {
    const me = await deps.getUser(uid);
    const fresh = me && typeof me.creationMs === 'number' && deps.nowMs() - me.creationMs <= FRESH_MS;
    const onlySafe = me && Array.isArray(me.providers) && me.providers.length > 0 && me.providers.every(function (p) { return SAFE_PROVIDERS.indexOf(p) !== -1; });
    if (fresh && onlySafe) { await deps.deleteUser(uid); removed = true; }
  } catch (e) { removed = false; }
  return { status: 'conflict', email: em, removed: removed };
}

module.exports = { checkAccount, FRESH_MS };
