'use strict';
const assert = require('node:assert/strict');
/* Soxta Firestore (Admin SDK'ning shu yerda ishlatiladigan qismi): doc get/set(merge)/delete/collection,
   where('==').limit().get(), listDocuments(), batch(), runTransaction (avval o'qish, keyin yozish — Firestore qoidasi tekshiriladi). */
function fakeDb(seed) {
  const store = JSON.parse(JSON.stringify(seed || {}));
  const writes = [];
  function snap(path) { const v = store[path]; return { exists: v !== undefined, id: path.split('/').pop(), ref: ref(path), data: function () { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); } }; }
  function doSet(path, d, o) { writes.push(['set', path]); store[path] = (o && o.merge && store[path]) ? Object.assign({}, store[path], JSON.parse(JSON.stringify(d))) : JSON.parse(JSON.stringify(d)); }
  function doDel(path) { writes.push(['del', path]); delete store[path]; }
  function ref(path) {
    return {
      id: path.split('/').pop(), path: path,
      get: async function () { return snap(path); },
      set: async function (d, o) { doSet(path, d, o); },
      delete: async function () { doDel(path); },
      collection: function (n) { return col(path + '/' + n); }
    };
  }
  function children(base) { return Object.keys(store).filter(function (p) { return p.indexOf(base + '/') === 0 && p.split('/').length === base.split('/').length + 1; }); }
  function col(base, filters, lim) {
    filters = filters || [];
    return {
      doc: function (id) { return ref(base + '/' + id); },
      where: function (f, op, v) { assert.equal(op, '==', 'faqat == ishlatiladi (indeks kerak bo\'lmasin)'); return col(base, filters.concat([[f, v]]), lim); },
      limit: function (n) { return col(base, filters, n); },
      get: async function () {
        let ps = children(base).filter(function (p) { return filters.every(function (f) { return store[p][f[0]] === f[1]; }); });
        if (lim) ps = ps.slice(0, lim);
        return { docs: ps.map(snap), size: ps.length, empty: !ps.length };
      },
      listDocuments: async function () {
        const ids = {};
        Object.keys(store).forEach(function (p) { if (p.indexOf(base + '/') === 0) ids[p.slice(base.length + 1).split('/')[0]] = 1; });
        return Object.keys(ids).map(function (id) { return ref(base + '/' + id); });
      }
    };
  }
  const db = {
    store: store, writes: writes,
    collection: function (n) { return col(n); },
    batch: function () {
      const ops = [];
      return { set: function (r, d, o) { ops.push(function () { doSet(r.path, d, o); }); }, delete: function (r) { ops.push(function () { doDel(r.path); }); },
        commit: async function () { ops.forEach(function (f) { f(); }); } };
    },
    runTransaction: async function (fn) {
      let wrote = false; const ops = [];
      const tx = {
        get: async function (r) { assert.equal(wrote, false, 'tranzaksiyada yozishdan keyin o\'qish mumkin emas'); return snap(r.path); },
        set: function (r, d, o) { wrote = true; ops.push(function () { doSet(r.path, d, o); }); },
        delete: function (r) { wrote = true; ops.push(function () { doDel(r.path); }); }
      };
      const res = await fn(tx);
      ops.forEach(function (f) { f(); });
      return res;
    }
  };
  return db;
}
function fakeMessaging() {
  const sent = [];
  return { sent: sent, sendEach: async function (msgs) { msgs.forEach(function (m) { sent.push(m); }); return { successCount: msgs.length, failureCount: 0, responses: msgs.map(function () { return { success: true }; }) }; } };
}
module.exports = { fakeDb, fakeMessaging };
