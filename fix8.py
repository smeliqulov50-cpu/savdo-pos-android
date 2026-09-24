import sys, shutil
F = "www/index.html"
s = open(F, encoding="utf-8").read()
shutil.copy(F, F + ".fix8bak")

def rep(old, new, label, count=1):
    global s
    n = s.count(old)
    if n != count:
        print("XATO:", label, "-", n, "ta topildi,", count, "kutilgan. Hech narsa o'zgarmadi."); sys.exit(1)
    s = s.replace(old, new); print("OK", label)

rep('  paymentType:{uz:"To\'lov turi",',
    '  cashTenderedLabel:{uz:"Mijoz berdi",ru:"Получено от клиента",en:"Cash received",kk:"Клиент берді",ky:"Кардар берди",tg:"Муштарӣ дод"},\n'
    '  changeDueLabel:{uz:"Qaytim",ru:"Сдача",en:"Change",kk:"Қайтарым",ky:"Кайтарым",tg:"Бақия"},\n'
    '  tenderExactLabel:{uz:"Aniq",ru:"Точно",en:"Exact",kk:"Дәл",ky:"Так",tg:"Дақиқ"},\n'
    '  paymentType:{uz:"To\'lov turi",', "translations")

rep("  let paymentType = 'cash';\n  let orderType = state.takeawayMode ? 'takeaway' : 'dine_in';",
    "  let paymentType = 'cash';\n  let tenderedAmount = 0;\n  let orderType = state.takeawayMode ? 'takeaway' : 'dine_in';", "tendered var")

rep("""      <div id="split-summary-rows" style="${(splitOn && splitAmount>0)?'':'display:none;'}">""",
"""      <div id="cash-tender-block" style="${paymentType==='cash'?'':'display:none;'}margin:-6px 0 14px;padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--surface-soft);">
        <label class="field-label">${tr('cashTenderedLabel')}</label>
        <input type="text" inputmode="numeric" id="cf-tendered" placeholder="${fmt(grandTotal())}" value="${tenderedAmount?formatMoneyInputValue(tenderedAmount):''}">
        <div id="tender-quick" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;"></div>
        <div class="row" style="margin-top:10px;"><span class="subtle">${tr('changeDueLabel')}</span><strong id="change-due-display" style="font-size:18px;color:var(--teal);">${fmt(0)}</strong></div>
      </div>
      <div id="split-summary-rows" style="${(splitOn && splitAmount>0)?'':'display:none;'}">""", "tender UI")

rep("""        document.getElementById('credit-fields').innerHTML = creditFieldsHtml();
        bindCreditFieldEvents();
        refreshTotals();
      });
    });
    document.querySelectorAll('#modal-root [data-ot]').forEach(el=>{""",
"""        document.getElementById('credit-fields').innerHTML = creditFieldsHtml();
        bindCreditFieldEvents();
        const tb = document.getElementById('cash-tender-block');
        if(tb) tb.style.display = paymentType==='cash' ? '' : 'none';
        refreshTotals();
      });
    });
    bindTenderEvents();
    document.querySelectorAll('#modal-root [data-ot]').forEach(el=>{""", "tender handler hook")

rep("""  function attachCheckoutHandlers(){
    const backBtn = document.getElementById('checkout-back-btn');""",
"""  function tenderQuickAmounts(){
    const total = grandTotal();
    const notes = [1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000];
    const out = [];
    notes.forEach(n=>{ const v = Math.ceil(total / n) * n; if(v > total && !out.includes(v)) out.push(v); });
    return out.slice(0, 4);
  }
  function updateChangeDue(){
    const el = document.getElementById('change-due-display');
    if(!el) return;
    const total = grandTotal();
    const change = tenderedAmount > total ? tenderedAmount - total : 0;
    el.textContent = fmt(change);
    el.style.color = (tenderedAmount > 0 && tenderedAmount < total) ? 'var(--danger)' : 'var(--teal)';
  }
  function bindTenderEvents(){
    const input = document.getElementById('cf-tendered');
    const quick = document.getElementById('tender-quick');
    if(!input || !quick) return;
    const render = ()=>{
      quick.innerHTML = `<button type="button" class="btn btn-outline btn-sm" data-tender="exact" style="width:auto;">${tr('tenderExactLabel')}</button>` +
        tenderQuickAmounts().map(v=>`<button type="button" class="btn btn-outline btn-sm" data-tender="${v}" style="width:auto;">${fmt(v)}</button>`).join('');
      quick.querySelectorAll('[data-tender]').forEach(b=>b.addEventListener('click', ()=>{
        tenderedAmount = b.dataset.tender==='exact' ? grandTotal() : parseInt(b.dataset.tender,10);
        input.value = formatMoneyInputValue(tenderedAmount);
        updateChangeDue();
      }));
    };
    render();
    input.addEventListener('input', ()=>{
      const v = parseMoneyInput(input.value);
      tenderedAmount = isNaN(v) ? 0 : v;
      input.value = formatMoneyInputValue(input.value);
      updateChangeDue();
    });
    updateChangeDue();
  }
  function attachCheckoutHandlers(){
    const backBtn = document.getElementById('checkout-back-btn');""", "tender functions")

rep("  function refreshTotals(){\n",
    "  function refreshTotals(){\n    updateChangeDue();\n", "refreshTotals hook")

rep("""          bonusRedeemAmount: bonusAmount()
        });""",
"""          bonusRedeemAmount: bonusAmount(),
          cashTendered: (paymentType==='cash' && !splitOn) ? tenderedAmount : 0
        });""", "extras cashTendered")

rep("""    printed: false
  };
  state.sales.push(sale);""",
"""    printed: false,
    cashTendered: extras.cashTendered || 0,
    changeDue: (extras.cashTendered && extras.cashTendered > total) ? extras.cashTendered - total : 0
  };
  state.sales.push(sale);""", "sale fields")

rep("""  lines.push(`${trR('paymentType')}: ${paymentTypeDisplayText(sale)}`);
  if(s.receiptFooter){ lines.push(sep); lines.push(centerLine(s.receiptFooter, width)); }""",
"""  lines.push(`${trR('paymentType')}: ${paymentTypeDisplayText(sale)}`);
  if(sale.cashTendered > 0){
    lines.push(padLine(trR('cashTenderedLabel'), fmt(sale.cashTendered), width));
    lines.push(padLine(trR('changeDueLabel'), fmt(sale.changeDue||0), width));
  }
  if(s.receiptFooter){ lines.push(sep); lines.push(centerLine(s.receiptFooter, width)); }""", "receipt text")

rep("""    <div style="margin-top:4px;">${trR('paymentType')}: ${paymentTypeDisplayText(sale)}</div>
    ${s.receiptFooter?""",
"""    <div style="margin-top:4px;">${trR('paymentType')}: ${paymentTypeDisplayText(sale)}</div>
    ${sale.cashTendered > 0 ? `<div style="margin-top:2px;">${trR('cashTenderedLabel')}: ${fmt(sale.cashTendered)} &nbsp;·&nbsp; ${trR('changeDueLabel')}: ${fmt(sale.changeDue||0)}</div>` : ''}
    ${s.receiptFooter?""", "receipt html")

rep("'ef-amount','ct-amount']);", "'ef-amount','ct-amount','cf-tendered']);", "keypad for tendered")
open(F, "w", encoding="utf-8").write(s)
print("TAYYOR")
