'use strict';
/* Savdo Pos: audit jurnalini saqlash muddati (30 kun). Muddatdan eski yozuvlar bulutdan butunlay o'chiriladi.
   Firebase kutubxonalariga bog'liq EMAS (db tashqaridan beriladi) — shuning uchun alohida sinaladi.
   Har bir biznes alohida so'raladi (collectionGroup indeks talab qilmaydi). */

const KEEP_DAYS = 30;
const BATCH = 400;

async function cleanupAudit(db, nowMs, keepDays) {
  const days = keepDays || KEEP_DAYS;
  const cutoff = new Date((nowMs || Date.now()) - days * 86400000).toISOString();
  const bizRefs = await db.collection('businesses').listDocuments();
  const stats = { businesses: bizRefs.length, deleted: 0, cutoff: cutoff };
  for (let i = 0; i < bizRefs.length; i++) {
    const col = bizRefs[i].collection('audit');
    for (let round = 0; round < 50; round++) {
      const snap = await col.where('date', '<', cutoff).limit(BATCH).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach(function (d) { batch.delete(d.ref); });
      await batch.commit();
      stats.deleted += snap.size;
      if (snap.size < BATCH) break;
    }
  }
  return stats;
}

module.exports = { cleanupAudit, KEEP_DAYS };
