'use strict';
/* fix121-tg2: soxta Firestore (Admin SDK'ning shu yerda ishlatiladigan qismi) — ==, >=, <, <=, > filtrlar, limit, tranzaksiya
   (avval o'qish, keyin yozish), o'qishlar soni (reads) — "vaqti kelmagan bo'lsa hech narsa o'qilmaydi" ni tekshirish uchun. */
const assert = require('node:assert/strict');
function fakeDb(seed) {
  const store = JSON.parse(JSON.stringify(seed || {}));
  const stat = { reads: 0, writes: 0, readPaths: [] };
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function snap(path) { const v = store[path]; return { exists: v !== undefined, id: path.split('/').pop(), ref: ref(path), data: function () { return clone(v); } }; }
  function doSet(path, d, o) { stat.writes++; store[path] = (o && o.merge && store[path]) ? Object.assign({}, store[path], clone(d)) : clone(d); }
  function ref(path) {
    return {
      id: path.split('/').pop(), path: path,
      get: async function () { stat.reads++; stat.readPaths.push(path); return snap(path); },
      set: async function (d, o) { doSet(path, d, o); },
      delete: async function () { stat.writes++; delete store[path]; },
      collection: function (n) { return col(path + '/' + n); }
    };
  }
  function children(base) { return Object.keys(store).filter(function (p) { return p.indexOf(base + '/') === 0 && p.split('/').length === base.split('/').length + 1; }).sort(); }
  const OPS = { '==': function (a, b) { return a === b; }, '>=': function (a, b) { return a !== undefined && a >= b; }, '<': function (a, b) { return a !== undefined && a < b; },
    '<=': function (a, b) { return a !== undefined && a <= b; }, '>': function (a, b) { return a !== undefined && a > b; } };
  function col(base, filters, lim) {
    filters = filters || [];
    return {
      doc: function (id) { return ref(base + '/' + id); },
      where: function (f, op, v) { assert.ok(OPS[op], 'op ' + op); return col(base, filters.concat([[f, op, v]]), lim); },
      limit: function (n) { return col(base, filters, n); },
      get: async function () {
        let ps = children(base).filter(function (p) { return filters.every(function (f) { return OPS[f[1]](store[p][f[0]], f[2]); }); });
        if (lim) ps = ps.slice(0, lim);
        stat.reads += Math.max(1, ps.length); stat.readPaths.push(base + '?');
        return { docs: ps.map(snap), size: ps.length, empty: !ps.length };
      }
    };
  }
  return {
    store: store, stat: stat,
    collection: function (n) { return col(n); },
    runTransaction: async function (fn) {
      let wrote = false; const ops = [];
      const tx = {
        get: async function (r) { assert.equal(wrote, false, 'tranzaksiyada yozishdan keyin o\'qish mumkin emas'); stat.reads++; return snap(r.path); },
        set: function (r, d, o) { wrote = true; ops.push(function () { doSet(r.path, d, o); }); },
        delete: function (r) { wrote = true; ops.push(function () { stat.writes++; delete store[r.path]; }); }
      };
      const res = await fn(tx);
      ops.forEach(function (f) { f(); });
      return res;
    }
  };
}
/* Soxta Telegram: chiqqan xabarlar ro'yxati; fail[chatId] = {tgCode, desc, retryAfter, times} */
function fakeTg() {
  const sent = [], calls = [], fail = {};
  const tg = async function (method, params) {
    calls.push({ method: method, params: params });
    if (method === 'sendMessage') {
      const f = fail[String(params.chat_id)];
      if (f && (f.times == null || f.times > 0)) {
        if (f.times != null) f.times--;
        const e = new Error('tg sendMessage: ' + (f.desc || f.tgCode)); e.tgCode = f.tgCode; e.desc = f.desc || ''; e.retryAfter = f.retryAfter || 0; throw e;
      }
      sent.push(params);
      return { message_id: sent.length };
    }
    if (method === 'getMe') return { username: 'savdo_pos_bot' };
    return true;
  };
  tg.sent = sent; tg.calls = calls; tg.fail = fail;
  return tg;
}
module.exports = { fakeDb, fakeTg };
