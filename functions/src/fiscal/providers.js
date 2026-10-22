'use strict';
/* fix184-fiscal2: fiskal provayder ulagichlari — yagona interfeys.
   Har bir provayder obyekti:
     sendSale(receipt)                 → natija
     sendRefund(receipt, originalFiscal) → natija
     openShift(info)                   → { ok, shiftId } | xato
     closeShift(info)                  → { ok, z: { number, sales, refunds, total, cash, card, other } } | xato
     checkConnection()                 → { ok, name } | xato
   Natija (normalize): { ok: true, sign, number, qr, providerId, at }  yoki  { ok: false, error, retryable }
   Kalit/parol FAQAT server (Secret Manager) orqali keladi: create(name, secrets, opts). Ilovada hech narsa saqlanmaydi.
   Haqiqiy operatorlar (epos, rahmat, uzkassa, qpos) — operator hujjati kelgach (B qismi). Hozircha "not_configured". */

const NAMES = ['mock', 'epos', 'rahmat', 'uzkassa', 'qpos'];

function fail(error, retryable) { return { ok: false, error: String(error || 'error').slice(0, 200), retryable: !!retryable }; }
function normalize(r, providerId) {
  if (!r || typeof r !== 'object') return fail('empty_response', true);
  if (r.ok === false) return fail(r.error, r.retryable === undefined ? true : !!r.retryable);
  if (!r.sign && !r.number) return fail('no_fiscal_sign', true);
  return { ok: true, sign: String(r.sign || ''), number: String(r.number || ''), qr: String(r.qr || ''), providerId: String(providerId || r.providerId || ''), at: r.at || null };
}

function notConfigured(name) {
  const nc = async function () { return fail(name + '_not_configured', false); };
  return { name: name, sendSale: nc, sendRefund: nc, openShift: nc, closeShift: nc, checkConnection: nc };
}

/* Wrapper: har chaqiruv normalize qilinadi, istisno (exception) — retryable xato, vaqt chegarasi. */
function wrap(p, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 15000;
  const guard = async function (fn, args, kind) {
    let to;
    try {
      const r = await Promise.race([fn.apply(p, args), new Promise(function (_, rej) { to = setTimeout(function () { rej(new Error('timeout')); }, timeoutMs); })]);
      clearTimeout(to);
      if (kind === 'fiscal') return normalize(r, p.name);
      if (!r || r.ok === false) return fail(r && r.error || 'error', r ? r.retryable !== false : true);
      if (kind === 'other' && r.ok !== true) return fail('bad_response', true);
      return r;
    } catch (e) { clearTimeout(to); return fail(e && e.message === 'timeout' ? 'timeout' : 'network: ' + (e && e.message || ''), true); }
  };
  return {
    name: p.name,
    sendSale: function (rc) { return guard(p.sendSale, [rc], 'fiscal'); },
    sendRefund: function (rc, o) { return guard(p.sendRefund, [rc, o], 'fiscal'); },
    openShift: function (i) { return guard(p.openShift, [i], 'other'); },
    closeShift: function (i) { return guard(p.closeShift, [i], 'other'); },
    checkConnection: function () { return guard(p.checkConnection, [], 'other'); }
  };
}

function create(name, secrets, opts) {
  if (NAMES.indexOf(name) === -1) return wrap(notConfigured(String(name || 'none')), opts);
  if (name === 'mock') return wrap(require('./mock').create(opts && opts.mock), opts);
  return wrap(notConfigured(name), opts);   // B qismi: require('./' + name).create(secrets, opts)
}

module.exports = { create, normalize, wrap, NAMES };
