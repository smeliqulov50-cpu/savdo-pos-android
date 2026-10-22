'use strict';
/* fix184-fiscal2: fiskal chek tuzilmasi (provayderdan mustaqil).
   Barcha summalar TIYINDA (butun son): 1 so'm = 100 tiyin. Qatorlar yig'indisi chek jamiga aynan teng.
   Savdo jami = qatorlar − aksiya − qo'lda chegirma − bonus (keshbek) + xizmat haqi + yetkazib berish.
   Taqsimlash:
     • aksiya — aksiyaga mos qatorlarga (blok, ulgurji, narxi qo'lda o'zgartirilgan — mos emas), og'irlik bo'yicha;
     • qo'lda chegirma + bonus + yaxlitlash farqi — barcha tovar qatorlariga, aksiyadan keyingi summa bo'yicha;
     • xizmat haqi va yetkazib berish — alohida "xizmat" qatorlari (o'z IKPU si bilan).
   Taqsimlash "eng katta qoldiq" usulida: tiyin yo'qolmaydi va ortiqcha qo'shilmaydi.
   QQS narx ichida: qqs = round(jami × stavka / (100 + stavka)). */

function tiyin(v) { const n = Number(v); return isFinite(n) ? Math.round(n * 100) : 0; }
function str(v, n) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n || 200); }
function digits(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

/* amount ni og'irliklarga taqsimlash; har ulush o'z og'irligidan oshmaydi. Qaytaradi: massiv (butun sonlar). */
function allocate(amount, weights) {
  const n = weights.length, out = new Array(n).fill(0);
  const W = weights.reduce(function (a, w) { return a + Math.max(0, w); }, 0);
  if (amount <= 0 || W <= 0) return out;
  const amt = Math.min(amount, W);
  const raw = weights.map(function (w) { return Math.max(0, w) * amt / W; });
  let used = 0;
  for (let i = 0; i < n; i++) { out[i] = Math.min(Math.floor(raw[i]), Math.max(0, weights[i])); used += out[i]; }
  let left = amt - used;
  const order = raw.map(function (r, i) { return { i: i, f: r - Math.floor(r) }; }).sort(function (a, b) { return b.f - a.f || a.i - b.i; });
  for (let k = 0; left > 0 && k < order.length * 2; k++) {
    const i = order[k % order.length].i;
    if (out[i] < Math.max(0, weights[i])) { out[i]++; left--; }
  }
  return out;
}

function vatOf(total, rate) { const r = Number(rate) || 0; return r > 0 ? Math.round(total * r / (100 + r)) : 0; }

function payParts(sale, total) {
  const p = { cash: 0, card: 0, credit: 0, other: 0 };
  const add = function (method, amount) {
    const k = method === 'cash' ? 'cash' : method === 'card' ? 'card' : method === 'credit' ? 'credit' : 'other';
    p[k] += tiyin(amount);
  };
  if (Array.isArray(sale.splitPayments) && sale.splitPayments.length) sale.splitPayments.forEach(function (x) { if (x) add(x.method, x.amount); });
  else add(sale.paymentType || 'cash', sale.total);
  // yaxlitlash farqi — eng katta to'lov turiga
  const sum = p.cash + p.card + p.credit + p.other;
  if (sum !== total) { const k = Object.keys(p).sort(function (a, b) { return p[b] - p[a]; })[0]; p[k] += total - sum; }
  return p;
}

/* sale — ilovadagi savdo yozuvi; products — {id: mahsulot}; settings — biznes sozlamalari.
   Qaytaradi: { ok, receipt, missing: [{productId, variantId, name, field}] , error } */
function buildReceipt(sale, products, settings) {
  products = products || {}; settings = settings || {};
  if (!sale || !sale.id || !Array.isArray(sale.items)) return { ok: false, error: 'bad_sale' };
  const total = tiyin(sale.total);
  const lines = [], missing = [];
  sale.items.forEach(function (it) {
    if (!it) return;
    const p = products[it.productId] || {};
    const qty = Number(it.qty) || 0, price = tiyin(it.price);
    const gross = Math.round(price * qty);
    const ikpu = digits(p.ikpu), pkg = digits(p.packageCode);
    const ln = {
      kind: 'goods', productId: it.productId || null, variantId: it.variantId || null, name: str(it.name, 128),
      ikpu: ikpu, packageCode: pkg, unit: str(p.unit || 'dona', 16), qty: qty, price: price, gross: gross,
      promoOk: it.saleMode !== 'box' && it.priceTier !== 'wholesale' && !it.noPromo,
      vatRate: (p.vat === null || p.vat === undefined || p.vat === '') ? null : Number(p.vat), discount: 0, total: 0, vat: 0
    };
    if (ikpu.length !== 17) missing.push({ productId: ln.productId, variantId: ln.variantId, name: ln.name, field: 'ikpu' });
    if (!pkg) missing.push({ productId: ln.productId, variantId: ln.variantId, name: ln.name, field: 'packageCode' });
    lines.push(ln);
  });
  const svc = tiyin(sale.serviceChargeAmount), dlv = tiyin(sale.deliveryFee);
  const extras = [];
  if (svc > 0) extras.push({ kind: 'service', name: str(settings.fiscalServiceName || 'Xizmat haqi', 128), ikpu: digits(settings.fiscalServiceIkpu), packageCode: digits(settings.fiscalServicePkg), unit: 'xizmat', qty: 1, price: svc, gross: svc, vatRate: settings.fiscalServiceVat == null ? null : Number(settings.fiscalServiceVat), discount: 0, total: svc, vat: 0, sub: 'service' });
  if (dlv > 0) extras.push({ kind: 'service', name: str(settings.fiscalDeliveryName || 'Yetkazib berish', 128), ikpu: digits(settings.fiscalDeliveryIkpu), packageCode: digits(settings.fiscalDeliveryPkg), unit: 'xizmat', qty: 1, price: dlv, gross: dlv, vatRate: settings.fiscalServiceVat == null ? null : Number(settings.fiscalServiceVat), discount: 0, total: dlv, vat: 0, sub: 'delivery' });
  extras.forEach(function (x) { if (x.ikpu.length !== 17) missing.push({ productId: null, variantId: null, name: x.name, field: x.sub === 'service' ? 'serviceIkpu' : 'deliveryIkpu' }); });

  const goodsGross = lines.reduce(function (a, l) { return a + l.gross; }, 0);
  const D = goodsGross + svc + dlv - total;   // jami kamaytirish (aksiya + chegirma + bonus + yaxlitlash)
  if (D < 0) {
    // yaxlitlash natijasida jami biroz ko'p — oxirgi tovar qatoriga qo'shiladi (yoki xizmat)
    const tgt = lines.length ? lines[lines.length - 1] : extras[extras.length - 1];
    if (!tgt) return { ok: false, error: 'empty' };
    tgt.gross += -D; tgt.price = tgt.qty ? Math.round(tgt.gross / tgt.qty) : tgt.gross;
  } else if (D > 0) {
    if (D > goodsGross) return { ok: false, error: 'discount_exceeds' };
    const promo = Math.min(tiyin(sale.promoDiscount), D);
    let pIdx = lines.map(function (l, i) { return l.promoOk ? i : -1; }).filter(function (i) { return i >= 0; });
    if (!pIdx.length) pIdx = lines.map(function (l, i) { return i; });
    const pa = allocate(promo, pIdx.map(function (i) { return lines[i].gross; }));
    let pSum = 0; pIdx.forEach(function (i, k) { lines[i].discount += pa[k]; pSum += pa[k]; });
    const rest = D - pSum;
    const ra = allocate(rest, lines.map(function (l) { return l.gross - l.discount; }));
    ra.forEach(function (v, i) { lines[i].discount += v; });
  }
  const all = lines.concat(extras);
  all.forEach(function (l) { if (l.kind === 'goods') l.total = l.gross - l.discount; l.vat = vatOf(l.total, l.vatRate); delete l.promoOk; });
  const sum = all.reduce(function (a, l) { return a + l.total; }, 0);
  if (sum !== total) return { ok: false, error: 'sum_mismatch', sum: sum, total: total };
  const pay = payParts(sale, total);
  const receipt = {
    id: String(sale.id), number: str(sale.receiptNumber, 40), time: str(sale.date, 40), branchId: sale.branchId || null,
    cashier: str(sale.cashierName || sale.staffName || '', 80), customerId: sale.customerId || null,
    lines: all, total: total, vat: all.reduce(function (a, l) { return a + l.vat; }, 0), payments: pay,
    refund: !!sale.__refund, original: sale.__original || null,
    type: sale.__refund ? 'refund' : 'sale'   /* fix186-fiscal4: «Продажа» — nasiya bo'lsa ham to'liq summaga (Soliq qo'mitasi, 2022/2023) */
  };
  return { ok: true, receipt: receipt, missing: missing };
}

/* Qaytarish cheki: asl chek tuzilmasi, belgisi refund (to'liq). Qisman — lines filtri bilan (A3). */
function buildRefund(sale, products, settings, originalFiscal) {
  const r = buildReceipt(sale, products, settings);
  if (!r.ok) return r;
  r.receipt.id = String(sale.id) + ':R';
  r.receipt.refund = true;
  r.receipt.original = originalFiscal ? { sign: originalFiscal.sign || '', number: originalFiscal.number || '', time: originalFiscal.at || '' } : null;
  return r;
}

/* fix186-fiscal4: yuborilgan chek nusxasidan qaytarish cheki (aynan o'sha qatorlar va to'lovlar) */
function refundOf(rc, newId, originalFiscal) {
  const r = JSON.parse(JSON.stringify(rc || {}));
  r.id = String(newId); r.refund = true; r.type = 'refund';
  r.original = originalFiscal ? { sign: originalFiscal.sign || '', number: originalFiscal.number || '', time: originalFiscal.sentAt || originalFiscal.at || '' } : null;
  return r;
}
/* fix186-fiscal4: qarz to'lovi cheki — «Рассрочка / Кредит» turi, to'langan summaga (QR va fiskal belgi bo'lmaydi,
   soliq hisobotiga tushmaydi, lekin berish majburiy: UP-5813 5-band, VM 943 1-ilova 6–7-bandlar; Soliq qo'mitasi 17.02.2022, 18.10.2023). */
function creditPayReceipt(entry, settings) {
  settings = settings || {};
  const amt = tiyin(entry && entry.amount);
  if (!entry || !entry.id || amt <= 0) return { ok: false, error: 'bad_payment' };
  const ln = { kind: 'service', sub: 'credit', name: str(settings.fiscalCreditName || "Qarz to'lovi", 128), ikpu: digits(settings.fiscalCreditIkpu), packageCode: digits(settings.fiscalCreditPkg), unit: 'xizmat', qty: 1, price: amt, gross: amt, discount: 0, total: amt, vatRate: null, vat: 0 };
  const m = entry.method === 'card' ? 'card' : entry.method === 'cash' || !entry.method ? 'cash' : 'other';
  const pay = { cash: 0, card: 0, credit: 0, other: 0 }; pay[m] = amt;
  const missing = ln.ikpu.length === 17 ? [] : [{ productId: null, variantId: null, name: ln.name, field: 'creditIkpu' }];   // IKPU ixtiyoriy: kredit chekida operator talab qilsa (B qismi)
  return { ok: true, missing: missing, receipt: { id: 'pay_' + String(entry.id), number: '', time: str(entry.date, 40), branchId: entry.branchId || null, cashier: str(entry.staffName || '', 80), customerId: entry.customerId || null, lines: [ln], total: amt, vat: 0, payments: pay, refund: false, original: null, type: 'credit', saleNo: str(entry.receiptNo || '', 40) } };
}

module.exports = { buildReceipt, buildRefund, refundOf, creditPayReceipt, allocate, tiyin, vatOf, payParts };
