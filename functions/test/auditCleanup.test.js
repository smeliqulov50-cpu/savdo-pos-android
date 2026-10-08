'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { cleanupAudit } = require('../src/maintenance/auditCleanup');

/* Kichik soxta Firestore */
function fakeDb(seed) {
  const store = Object.assign({}, seed);
  let commits = 0;
  function colOf(base) {
    const filters = []; let lim = null;
    const q = {
      where: function (f, op, v) { filters.push([f, op, v]); return q; },
      limit: function (n) { lim = n; return q; },
      get: async function () {
        let keys = Object.keys(store).filter(function (p) { return p.indexOf(base + '/') === 0 && p.split('/').length === base.split('/').length + 1; });
        keys = keys.filter(function (p) { return filters.every(function (fl) { return fl[1] === '<' ? String(store[p][fl[0]]) < String(fl[2]) : true; }); });
        if (lim) keys = keys.slice(0, lim);
        const docs = keys.map(function (p) { return { id: p.split('/').pop(), ref: { path: p }, data: function () { return store[p]; } }; });
        return { docs: docs, empty: !docs.length, size: docs.length };
      }
    };
    return q;
  }
  return {
    store: store, commits: function () { return commits; },
    collection: function () { return { listDocuments: async function () {
      const ids = {}; Object.keys(store).forEach(function (p) { ids[p.split('/')[1]] = 1; });
      return Object.keys(ids).map(function (id) { return { collection: function (n) { return colOf('businesses/' + id + '/' + n); } }; });
    } }; },
    batch: function () { const ops = []; return { delete: function (ref) { ops.push(ref.path); }, commit: async function () { commits++; ops.forEach(function (p) { delete store[p]; }); } }; }
  };
}
const NOW = Date.parse('2026-10-08T00:00:00.000Z');
const iso = function (d) { return new Date(NOW - d * 86400000).toISOString(); };

test('audit: 30 kundan eski yozuvlar o\'chadi, yangilari qoladi (barcha bizneslarda)', async function () {
  const db = fakeDb({
    'businesses/B1/audit/a40': { date: iso(40) }, 'businesses/B1/audit/a31': { date: iso(31) },
    'businesses/B1/audit/a29': { date: iso(29) }, 'businesses/B1/audit/a1': { date: iso(1) },
    'businesses/B2/audit/b60': { date: iso(60) }, 'businesses/B2/audit/b2': { date: iso(2) },
    'businesses/B3/sales/s1': { date: iso(90) }                                   // audit emas — tegilmaydi
  });
  const st = await cleanupAudit(db, NOW);
  assert.strictEqual(st.deleted, 3);
  assert.deepStrictEqual(Object.keys(db.store).sort(), ['businesses/B1/audit/a1', 'businesses/B1/audit/a29', 'businesses/B2/audit/b2', 'businesses/B3/sales/s1']);
});
test('audit: ko\'p yozuv bo\'laklab (400 tadan) o\'chadi', async function () {
  const seed = {}; for (let i = 0; i < 950; i++) seed['businesses/B1/audit/o' + i] = { date: iso(45) };
  seed['businesses/B1/audit/keep'] = { date: iso(3) };
  const db = fakeDb(seed);
  const st = await cleanupAudit(db, NOW);
  assert.strictEqual(st.deleted, 950); assert.strictEqual(db.commits(), 3);
  assert.deepStrictEqual(Object.keys(db.store), ['businesses/B1/audit/keep']);
});
test('audit: o\'chiradigan narsa yo\'q bo\'lsa — hech narsa yozilmaydi', async function () {
  const db = fakeDb({ 'businesses/B1/audit/a1': { date: iso(1) } });
  const st = await cleanupAudit(db, NOW);
  assert.strictEqual(st.deleted, 0); assert.strictEqual(db.commits(), 0);
});
