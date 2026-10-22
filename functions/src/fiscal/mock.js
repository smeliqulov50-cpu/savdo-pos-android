'use strict';
/* fix184-fiscal2: soxta (mock) provayder — haqiqiy operator kabi javob beradi. Sinovlar shu bilan.
   Rejimlar (opts): mode: 'ok' | 'error' (rad, qayta urinmaydi) | 'fail' (vaqtinchalik xato) | 'offline' | 'slow'
     failTimes: N — birinchi N ta urinish vaqtinchalik xato, keyin ok
     delayMs: sekin javob
   Xususiyatlari: bir xil chek id — bir xil belgi (operator tomonidagi dublikat himoyasi);
   qaytarish faqat ma'lum asl chekka; smena ochilmagan bo'lsa chek qabul qilinmaydi (agar requireShift);
   jami = qatorlar yig'indisi tekshiriladi. */
function create(opts) {
  opts = Object.assign({ mode: 'ok', failTimes: 0, delayMs: 0, requireShift: false }, opts || {});
  const st = { seq: 0, receipts: {}, calls: [], shift: null, shiftSeq: 0, tries: 0 };
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  async function pre(kind) {
    st.calls.push(kind); st.tries++;
    if (opts.delayMs) await sleep(opts.delayMs);
    if (opts.mode === 'offline') throw new Error('ECONNREFUSED');
    if (opts.mode === 'fail' || st.tries <= opts.failTimes) return { ok: false, error: 'operator_busy', retryable: true };
    if (opts.mode === 'error') return { ok: false, error: 'rejected: IKPU not found', retryable: false };
    return null;
  }
  function check(rc) {
    if (!rc || !rc.id || !Array.isArray(rc.lines) || !rc.lines.length) return 'bad_receipt';
    const sum = rc.lines.reduce(function (a, l) { return a + l.total; }, 0);
    if (sum !== rc.total) return 'sum_mismatch';
    const pay = rc.payments || {}; if ((pay.cash || 0) + (pay.card || 0) + (pay.credit || 0) + (pay.other || 0) !== rc.total) return 'pay_mismatch';
    return '';
  }
  function issue(rc) {
    if (st.receipts[rc.id]) return Object.assign({ dup: true }, st.receipts[rc.id]);
    st.seq++;
    const r = { ok: true, sign: 'MOCK' + String(st.seq).padStart(8, '0'), number: 'FM-TEST/' + st.seq, qr: 'https://ofd.soliq.uz/check?t=MOCK' + st.seq, at: new Date().toISOString() };
    st.receipts[rc.id] = Object.assign({ rc: rc, shift: st.shift && st.shift.id }, r);
    return r;
  }
  return {
    name: 'mock', state: st, opts: opts,
    sendSale: async function (rc) {
      const e = await pre('sale'); if (e) return e;
      if (opts.requireShift && !st.shift) return { ok: false, error: 'shift_closed', retryable: true };
      const bad = check(rc); if (bad) return { ok: false, error: bad, retryable: false };
      return issue(rc);
    },
    sendRefund: async function (rc, orig) {
      const e = await pre('refund'); if (e) return e;
      if (!orig || !orig.sign || !Object.keys(st.receipts).some(function (k) { return st.receipts[k].sign === orig.sign; })) return { ok: false, error: 'original_not_found', retryable: false };
      const bad = check(rc); if (bad) return { ok: false, error: bad, retryable: false };
      return issue(rc);
    },
    openShift: async function (info) {
      const e = await pre('open'); if (e) return e;
      if (!st.shift) { st.shiftSeq++; st.shift = { id: 'S' + st.shiftSeq, at: new Date().toISOString() }; }
      return { ok: true, shiftId: st.shift.id };
    },
    closeShift: async function (info) {
      const e = await pre('close'); if (e) return e;
      const sid = st.shift && st.shift.id;
      const z = { number: st.shiftSeq, sales: 0, refunds: 0, total: 0, cash: 0, card: 0, other: 0 };
      Object.keys(st.receipts).forEach(function (k) {
        const x = st.receipts[k]; if (sid && x.shift !== sid) return;
        const sg = x.rc.refund ? -1 : 1;
        if (x.rc.refund) z.refunds++; else z.sales++;
        z.total += sg * x.rc.total; z.cash += sg * (x.rc.payments.cash || 0); z.card += sg * (x.rc.payments.card || 0); z.other += sg * ((x.rc.payments.other || 0) + (x.rc.payments.credit || 0));
      });
      st.shift = null;
      return { ok: true, z: z };
    },
    checkConnection: async function () { const e = await pre('ping'); if (e) return e; return { ok: true, name: 'mock' }; }
  };
}
module.exports = { create };
