'use strict';
/* fix120-tg: Telegram Bot API chaqiruvi (Node 22 fetch). Token faqat manzilda; xato matnlariga tushmaydi. */
function makeTg(token, fetchImpl) {
  const f = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  const hide = function (s) { return String(s == null ? '' : s).split(token).join('***'); };
  return async function tg(method, params) {
    if (!f) throw new Error('fetch yo\'q');
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const to = setTimeout(function () { try { if (ctrl) ctrl.abort(); } catch (e) {} }, 10000);
    try {
      let r, j;
      try {
        r = await f('https://api.telegram.org/bot' + token + '/' + method, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params || {}), signal: ctrl ? ctrl.signal : undefined });
        j = await r.json();
      } catch (e) { const er = new Error('tg ' + method + ': ' + hide(e && e.message)); er.network = true; throw er; }
      if (!j || !j.ok) { const er = new Error('tg ' + method + ': ' + hide((j && j.description) || (r && r.status))); er.tgCode = j && j.error_code; throw er; }
      return j.result;
    } finally { clearTimeout(to); }
  };
}
module.exports = { makeTg };
