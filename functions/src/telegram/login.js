'use strict';
/* fix206-tglogin: Telegram orqali kirish (bot + raqamni moslash).
   1) Ilova: start → so'rov (rid) + faqat shu qurilmaga ma'lum «poll» siri + 2 xonali raqam + t.me/<bot>?start=l_<rid> havola.
   2) Bot: /start l_<rid> → 4 ta raqam tugmasi + «Bu men emasman». Faqat havolani birinchi ochgan Telegram foydalanuvchisi bosa oladi.
      To'g'ri raqam — tasdiq; noto'g'ri raqam yoki «Bu men emasman» — so'rov butunlay bekor (qayta urinib bo'lmaydi).
   3) Ilova: poll (rid + poll siri) → tasdiqlangan bo'lsa:
        - Telegram akkauntga ulangan (tgAuth/{tgId}) — o'sha akkaunt uchun Firebase custom token (bir marta);
        - ulanmagan — «tanlov» chiptasi: «Yangi do'kon» (yangi akkaunt, keyin odatdagi shartlar oynasi) yoki
          «Mavjud akkauntimga ulash» (email+parol bilan kirib, chipta bilan ulash).
   Botga ulangan do'konga avtomatik kirilmaydi: botga xodim ham ulangan bo'lishi mumkin — u egaga aylanib qolmasin.
   Muddat 5 daqiqa, bir martalik; poll siri va chipta faqat xesh ko'rinishida saqlanadi; IP bo'yicha cheklov.
   Ma'lumot (faqat server): tgLogins/{rid}, tgAuth/{tgId} = {uid}, tgAuthUid/{uid} = {tgId}, tgLoginRate/{xesh}.
   deps: { db, nowMs(), tg(method, params), botName, createToken(uid), createUser(name) -> uid, userExists(uid), userProviders(uid) -> [] } */
const crypto = require('crypto');
const LT = require('./loginTexts');
const TTL_MS = 5 * 60 * 1000, TICKET_MS = 10 * 60 * 1000, RATE_WIN = 10 * 60 * 1000, RATE_MAX = 10, GLOBAL_MAX = 120;
const RID_RE = /^[A-Za-z0-9_-]{24,40}$/, SECRET_RE = /^[A-Za-z0-9_-]{30,60}$/;

function b64u(buf) { return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function hsh(s) { return crypto.createHash('sha256').update('tglogin|' + String(s)).digest('hex'); }
function eqHex(a, b) { try { const x = Buffer.from(String(a), 'hex'), y = Buffer.from(String(b), 'hex'); return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y); } catch (e) { return false; } }
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function okB(o) { return { status: 200, body: Object.assign({ ok: true }, o || {}) }; }
function errB(s, c) { return { status: s, body: { ok: false, code: c } }; }
async function getData(ref) { const s = await ref.get(); return s && s.exists ? (s.data() || {}) : null; }
function randNums() {
  const num = 10 + crypto.randomInt(90);
  const set = [num];
  while (set.length < 4) { const x = 10 + crypto.randomInt(90); if (set.indexOf(x) === -1) set.push(x); }
  for (let i = set.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); const t = set[i]; set[i] = set[j]; set[j] = t; }
  return { num: num, choices: set };
}
function tgName(u) { u = u || {}; return String([u.first_name, u.last_name].filter(Boolean).join(' ') || (u.username ? '@' + u.username : '') || 'Telegram').slice(0, 64); }

async function rateOk(db, key, now) {
  const ref = db.collection('tgLoginRate').doc(key);
  return db.runTransaction(async function (tx) {
    const s = await tx.get(ref);
    const t = ((s.exists && Array.isArray((s.data() || {}).t)) ? s.data().t : []).filter(function (x) { return now - x < RATE_WIN; });
    if (t.length >= RATE_MAX) return false;
    t.push(now); tx.set(ref, { t: t }); return true;
  });
}

/* umumiy cheklov: daqiqasiga GLOBAL_MAX tadan ko'p so'rov ochilmaydi (IP'ni almashtirib spam qilishga qarshi) */
async function globalOk(db, now) {
  const ref = db.collection('tgLoginRate').doc('g_' + Math.floor(now / 60000));
  return db.runTransaction(async function (tx) {
    const s = await tx.get(ref); const n = s.exists ? Number((s.data() || {}).n || 0) : 0;
    if (n >= GLOBAL_MAX) return false;
    tx.set(ref, { n: n + 1 }); return true;
  });
}
/* ---------- Ilova: so'rov ochish ---------- */
async function start(deps, body, ctx) {
  const db = deps.db, now = deps.nowMs();
  const mode = body && (body.mode === 'link' || body.mode === 'verify') ? body.mode : 'login';
  if (mode !== 'login') {
    if (!ctx.uid) return errB(401, 'unauthenticated');
    if (await getData(db.collection('staffAuth').doc(ctx.uid))) return errB(403, 'staff');
    if (mode === 'verify') { const b = await getData(db.collection('tgAuthUid').doc(ctx.uid)); if (!b || !b.tgId) return errB(409, 'not-linked'); }
  }
  if (!deps.botName) return errB(503, 'no-bot');
  if (!(await rateOk(db, hsh('rate|' + (ctx.uid || ctx.ip || 'none')).slice(0, 40), now))) return errB(429, 'too-many');
  if (!(await globalOk(db, now))) return errB(429, 'too-many');
  const rid = b64u(crypto.randomBytes(24)), poll = b64u(crypto.randomBytes(32)), nm = randNums();
  const lang = ['uz', 'ru', 'en', 'kk', 'ky', 'tg'].indexOf(body && body.lang) !== -1 ? body.lang : 'uz';
  await db.collection('tgLogins').doc(rid).set({ mode: mode, createdMs: now, expMs: now + TTL_MS, status: 'pending', pollHash: hsh('poll|' + poll), num: nm.num, choices: nm.choices,
    linkUid: mode !== 'login' ? ctx.uid : null, openerId: null, tgId: null, tgName: '', lang: lang });
  return okB({ rid: rid, poll: poll, num: nm.num, url: 'https://t.me/' + deps.botName + '?start=l_' + rid, expMs: now + TTL_MS });
}

/* ---------- Bot: /start l_<rid> ---------- */
async function send(deps, chatId, text, kb) {
  const p = { chat_id: chatId, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (kb) p.reply_markup = kb;
  try { await deps.tg('sendMessage', p); } catch (e) {}
}
async function onStart(deps, msg, rid, lang) {
  const db = deps.db, now = deps.nowMs(), from = String((msg.from && msg.from.id) || msg.chat.id);
  if (!RID_RE.test(rid)) { await send(deps, msg.chat.id, LT.t('expired', lang)); return { login: 'expired' }; }
  const ref = db.collection('tgLogins').doc(rid);
  const r = await db.runTransaction(async function (tx) {
    const s = await tx.get(ref); const d = s.exists ? (s.data() || {}) : null;
    if (!d || d.status !== 'pending' || now > d.expMs) return { res: 'expired' };
    if (d.openerId && d.openerId !== from) return { res: 'other' };
    if (!d.openerId) tx.set(ref, { openerId: from, openedMs: now }, { merge: true });
    return { res: 'ask', d: d };
  });
  if (r.res !== 'ask') { await send(deps, msg.chat.id, LT.t(r.res, lang)); return { login: r.res }; }
  const kb = { inline_keyboard: [r.d.choices.map(function (n) { return { text: String(n), callback_data: 'lg:' + rid + ':' + n }; }), [{ text: LT.t('notMe', lang), callback_data: 'lg:' + rid + ':x' }]] };
  await send(deps, msg.chat.id, LT.t(r.d.mode === 'link' ? 'askLink' : 'askLogin', lang), kb);
  return { login: 'ask' };
}

/* ---------- Bot: raqam tugmasi ---------- */
async function onCallback(deps, cq, lang) {
  const m = /^lg:([A-Za-z0-9_-]{24,40}):(\d{2}|x)$/.exec(String(cq.data || ''));
  if (!m) return null;
  const db = deps.db, now = deps.nowMs(), from = String((cq.from && cq.from.id) || '');
  try { await deps.tg('answerCallbackQuery', { callback_query_id: cq.id }); } catch (e) {}
  const ref = db.collection('tgLogins').doc(m[1]);
  const res = await db.runTransaction(async function (tx) {
    const s = await tx.get(ref); const d = s.exists ? (s.data() || {}) : null;
    if (!d || d.status !== 'pending' || now > d.expMs) return 'expired';
    if (!from || d.openerId !== from) return 'other';
    if (m[2] === 'x') { tx.set(ref, { status: 'denied', deniedMs: now }, { merge: true }); return 'denied'; }
    if (Number(m[2]) !== d.num) { tx.set(ref, { status: 'denied', wrong: true, deniedMs: now }, { merge: true }); return 'wrong'; }
    tx.set(ref, { status: 'confirmed', tgId: from, tgName: tgName(cq.from), confirmedMs: now }, { merge: true });
    return 'ok';
  });
  if (res !== 'other') {
    try { await deps.tg('editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: LT.t(res, lang), parse_mode: 'HTML' }); }
    catch (e) { await send(deps, cq.message.chat.id, LT.t(res, lang)); }
  }
  return { login: res };
}

/* ---------- Ilova: holatni so'rash ---------- */
async function loadOwned(deps, body) {
  const rid = String((body && body.rid) || ''), poll = String((body && body.poll) || '');
  if (!RID_RE.test(rid) || !SECRET_RE.test(poll)) return { err: errB(400, 'bad-request') };
  const ref = deps.db.collection('tgLogins').doc(rid);
  const d = await getData(ref);
  if (!d) return { err: errB(404, 'not-found') };
  if (!eqHex(d.pollHash, hsh('poll|' + poll))) return { err: errB(403, 'forbidden') };
  return { ref: ref, d: d, rid: rid };
}
function setMapping(db, tx, tgId, uid, name, now, oldForUid) {
  if (oldForUid && oldForUid !== tgId) tx.delete(db.collection('tgAuth').doc(oldForUid));
  tx.set(db.collection('tgAuth').doc(tgId), { uid: uid, name: name, at: now });
  tx.set(db.collection('tgAuthUid').doc(uid), { tgId: tgId, name: name, at: now });
}
async function poll(deps, body) {
  const o = await loadOwned(deps, body); if (o.err) return o.err;
  const db = deps.db, now = deps.nowMs(), d = o.d;
  if (d.status === 'pending') return okB({ status: now > d.expMs ? 'expired' : 'pending', expMs: d.expMs });
  if (d.status === 'denied') return okB({ status: 'denied' });
  if (d.status !== 'confirmed') return okB({ status: 'used' });
  if (now > d.expMs + 2 * 60 * 1000) return okB({ status: 'expired' });
  // bir martalik: holatni tranzaksiyada o'zgartiramiz
  const r = await db.runTransaction(async function (tx) {
    const s = await tx.get(o.ref); const x = s.exists ? (s.data() || {}) : null;
    if (!x || x.status !== 'confirmed') return { status: 'used' };
    const mapRef = db.collection('tgAuth').doc(x.tgId);
    const map = await tx.get(mapRef); const mp = map.exists ? (map.data() || {}) : null;
    if (x.mode === 'verify') {   // egalikni qayta tasdiqlash (masalan, PIN'ni tiklash): shu akkauntga ulangan Telegram bo'lishi shart
      tx.set(o.ref, { status: 'used', usedMs: now, result: 'verify' }, { merge: true });
      return { status: (mp && mp.uid === x.linkUid) ? 'verified' : 'mismatch' };
    }
    if (x.mode === 'link') {
      const back = await tx.get(db.collection('tgAuthUid').doc(x.linkUid)); const bk = back.exists ? (back.data() || {}) : null;
      if (mp && mp.uid && mp.uid !== x.linkUid) { tx.set(o.ref, { status: 'used', usedMs: now, result: 'tg-used' }, { merge: true }); return { status: 'tg-used' }; }
      setMapping(db, tx, x.tgId, x.linkUid, x.tgName, now, bk && bk.tgId);
      tx.set(o.ref, { status: 'used', usedMs: now, result: 'linked' }, { merge: true });
      return { status: 'linked', name: x.tgName };
    }
    if (mp && mp.uid) { tx.set(o.ref, { status: 'used', usedMs: now, result: 'login' }, { merge: true }); return { status: 'login', uid: mp.uid, tgId: x.tgId }; }
    const ticket = b64u(crypto.randomBytes(32));
    tx.set(o.ref, { status: 'choose', ticketHash: hsh('ticket|' + ticket), ticketExp: now + TICKET_MS }, { merge: true });
    return { status: 'choose', ticket: ticket, name: x.tgName };
  });
  if (r.status === 'login') {
    if (!(await deps.userExists(r.uid))) {   // akkaunt o'chirilgan — ulanish ham o'chadi, tanlov beriladi
      const ticket = b64u(crypto.randomBytes(32));
      await db.runTransaction(async function (tx) { tx.delete(db.collection('tgAuth').doc(r.tgId)); tx.delete(db.collection('tgAuthUid').doc(r.uid)); tx.set(o.ref, { status: 'choose', ticketHash: hsh('ticket|' + ticket), ticketExp: now + TICKET_MS }, { merge: true }); });
      return okB({ status: 'choose', ticket: ticket, name: d.tgName });
    }
    let token; try { token = await deps.createToken(r.uid); } catch (e) { return errB(500, 'token'); }
    return okB({ status: 'ok', token: token });
  }
  return okB(r);
}
async function useTicket(deps, body) {
  const o = await loadOwned(deps, body); if (o.err) return o;
  const ticket = String((body && body.ticket) || ''), now = deps.nowMs();
  if (!SECRET_RE.test(ticket)) return { err: errB(400, 'bad-request') };
  if (o.d.status !== 'choose' || !eqHex(o.d.ticketHash, hsh('ticket|' + ticket))) return { err: okB({ status: 'used' }) };
  if (now > o.d.ticketExp) return { err: okB({ status: 'expired' }) };
  return o;
}
/* «Yangi do'kon ochish»: yangi akkaunt (do'kon keyin — shartlarga rozilikdan so'ng ilovada) */
async function createNew(deps, body) {
  const o = await useTicket(deps, body); if (o.err) return o.err;
  const db = deps.db, now = deps.nowMs();
  const r = await db.runTransaction(async function (tx) {
    const s = await tx.get(o.ref); const x = s.exists ? (s.data() || {}) : null;
    if (!x || x.status !== 'choose') return { status: 'used' };
    const map = await tx.get(db.collection('tgAuth').doc(x.tgId)); const mp = map.exists ? (map.data() || {}) : null;
    tx.set(o.ref, { status: 'used', usedMs: now, result: 'new' }, { merge: true });
    return { status: 'go', x: x, mp: mp };
  });
  if (r.status !== 'go') return okB({ status: r.status });
  let uid = r.mp && r.mp.uid && (await deps.userExists(r.mp.uid)) ? r.mp.uid : null;
  if (!uid) {
    try { uid = await deps.createUser(r.x.tgName); } catch (e) { return errB(500, 'create'); }
    await db.runTransaction(async function (tx) { setMapping(db, tx, r.x.tgId, uid, r.x.tgName, now, null); });
  }
  let token; try { token = await deps.createToken(uid); } catch (e) { return errB(500, 'token'); }
  return okB({ status: 'ok', token: token });
}
/* «Mavjud akkauntimga ulash»: foydalanuvchi email+parol bilan kirgan (ID token) — chipta bilan Telegram shu akkauntga ulanadi */
async function linkTicket(deps, body, ctx) {
  if (!ctx.uid) return errB(401, 'unauthenticated');
  const db = deps.db, now = deps.nowMs();
  if (await getData(db.collection('staffAuth').doc(ctx.uid))) return errB(403, 'staff');
  const o = await useTicket(deps, body); if (o.err) return o.err;
  const r = await db.runTransaction(async function (tx) {
    const s = await tx.get(o.ref); const x = s.exists ? (s.data() || {}) : null;
    if (!x || x.status !== 'choose') return { status: 'used' };
    const map = await tx.get(db.collection('tgAuth').doc(x.tgId)); const mp = map.exists ? (map.data() || {}) : null;
    const back = await tx.get(db.collection('tgAuthUid').doc(ctx.uid)); const bk = back.exists ? (back.data() || {}) : null;
    if (mp && mp.uid && mp.uid !== ctx.uid) { tx.set(o.ref, { status: 'used', usedMs: now, result: 'tg-used' }, { merge: true }); return { status: 'tg-used' }; }
    setMapping(db, tx, x.tgId, ctx.uid, x.tgName, now, bk && bk.tgId);
    tx.set(o.ref, { status: 'used', usedMs: now, result: 'linked' }, { merge: true });
    return { status: 'linked', name: x.tgName };
  });
  return okB(r);
}
/* Sozlamalar → Hisob: holat va uzish */
async function status(deps, ctx) {
  if (!ctx.uid) return errB(401, 'unauthenticated');
  const b = await getData(deps.db.collection('tgAuthUid').doc(ctx.uid));
  return okB({ linked: !!(b && b.tgId), name: b ? String(b.name || '') : '' });
}
async function unlink(deps, ctx) {
  if (!ctx.uid) return errB(401, 'unauthenticated');
  const db = deps.db;
  const b = await getData(db.collection('tgAuthUid').doc(ctx.uid));
  if (!b || !b.tgId) return okB({ linked: false });
  const prov = await deps.userProviders(ctx.uid);
  if (!prov || !prov.length) return errB(409, 'last-method');   // Telegram yagona kirish usuli — uzib bo'lmaydi
  await db.runTransaction(async function (tx) { tx.delete(db.collection('tgAuth').doc(b.tgId)); tx.delete(db.collection('tgAuthUid').doc(ctx.uid)); });
  return okB({ linked: false });
}
/* Akkauntni o'chirishda: Telegram ulanishi o'chadi; faqat Telegram bilan kiriladigan akkaunt (boshqa usul yo'q) va
   do'koni allaqachon o'chirilgan bo'lsa — akkauntning o'zi ham server tomonida o'chiriladi (qayta kirish talab qilinmasin). */
async function forget(deps, ctx) {
  if (!ctx.uid) return errB(401, 'unauthenticated');
  const db = deps.db;
  if (await getData(db.collection('staffAuth').doc(ctx.uid))) return errB(403, 'staff');
  const b = await getData(db.collection('tgAuthUid').doc(ctx.uid));
  if (b && b.tgId) await db.runTransaction(async function (tx) { tx.delete(db.collection('tgAuth').doc(b.tgId)); tx.delete(db.collection('tgAuthUid').doc(ctx.uid)); });
  let deleted = false;
  const prov = await deps.userProviders(ctx.uid);
  if ((!prov || !prov.length) && !(await getData(db.collection('businesses').doc(ctx.uid)))) { await deps.deleteUser(ctx.uid); deleted = true; }
  return okB({ deleted: deleted });
}
async function handle(deps, body, ctx) {
  body = body || {}; ctx = ctx || {};
  const a = String(body.action || '');
  if (a === 'start') return start(deps, body, ctx);
  if (a === 'poll') return poll(deps, body);
  if (a === 'new') return createNew(deps, body);
  if (a === 'link') return linkTicket(deps, body, ctx);
  if (a === 'status') return status(deps, ctx);
  if (a === 'unlink') return unlink(deps, ctx);
  if (a === 'forget') return forget(deps, ctx);
  return errB(400, 'bad-action');
}
module.exports = { handle, onStart, onCallback, hsh, TTL_MS, TICKET_MS, RATE_MAX };
