import sys, shutil
F = "www/index.html"
s = open(F, encoding="utf-8").read()
shutil.copy(F, F + ".fix7bak")

def rep(old, new, label):
    global s
    n = s.count(old)
    if n != 1:
        print("XATO:", label, "-", n, "ta topildi. Hech narsa o'zgarmadi."); sys.exit(1)
    s = s.replace(old, new); print("OK", label)

CSS = (" .search-bar .search-clear{position:absolute;right:8px;top:50%;transform:translateY(-50%);width:26px;height:26px;border-radius:50%;border:none;background:var(--surface-soft);color:var(--ink-soft);font-size:18px;line-height:26px;text-align:center;padding:0;display:none;cursor:pointer;z-index:2;}"
       " .search-bar.has-scan .search-clear{right:42px;}"
       " .search-bar.has-text .search-clear{display:block;}"
       " .search-bar.has-text input{padding-right:44px;}"
       " .search-bar.has-scan.has-text input{padding-right:78px;}"
       " #money-keypad{position:fixed;left:0;right:0;bottom:0;z-index:90;background:var(--surface);border-top:1px solid var(--line);box-shadow:0 -8px 24px rgba(22,35,59,0.12);padding:8px 10px calc(8px + max(env(safe-area-inset-bottom, 0px), var(--safe-area-inset-bottom, 0px)));display:none;}"
       " #money-keypad.show{display:block;}"
       " #money-keypad .mk-preview{display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:18px;color:var(--ink);padding:2px 6px 8px;}"
       " #money-keypad .mk-preview span:last-child{font-size:12px;color:var(--ink-faint);font-weight:600;}"
       " #money-keypad .mk-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;max-width:520px;margin:0 auto;}"
       " #money-keypad button{height:48px;border-radius:12px;border:1px solid var(--line);background:var(--surface-soft);color:var(--ink);font-size:20px;font-weight:700;padding:0;}"
       " #money-keypad button.mk-alt{font-size:15px;background:var(--bg);}"
       " #money-keypad button.mk-done{background:var(--gradient-brand);color:#fff;border-color:transparent;font-size:17px;}"
       " #money-keypad button.mk-danger{color:var(--danger);}"
       " body.money-keypad-open .modal-sheet{padding-bottom:270px !important;}"
       " body.money-keypad-open main{padding-bottom:270px !important;}")

rep("nav.bottom-nav::after{content:\"\";position:absolute;left:0;right:0;top:100%;height:120px;background:var(--surface);pointer-events:none;}\n  @media print{",
    "nav.bottom-nav::after{content:\"\";position:absolute;left:0;right:0;top:100%;height:120px;background:var(--surface);pointer-events:none;}" + CSS + "\n  @media print{",
    "CSS")

JS = r"""
/* ---------- Search "x" buttons + money keypad (00 / 000) ---------- */
const MONEY_INPUT_IDS = new Set(['start-cash-input','actual-cash-input','pf-price','pf-cost','pf-wholesale-price','pf-box-price','pe-price','cf-split-amount','cf-discount-value','cf-delivery-fee-custom','cf-service-charge-custom','cf-bonus-amount','sf-salary','sf-plan-monthly','sf-plan-daily','s-credit-limit','ce-credit-limit','lf-amount','ef-amount','ct-amount']);
function isMoneyInput(el){ return !!(el && el.tagName==='INPUT' && (MONEY_INPUT_IDS.has(el.id) || el.hasAttribute('data-money') || el.dataset.moneyFormatted)); }
function isTouchDevice(){ return ('ontouchstart' in window) || (window.matchMedia && window.matchMedia('(pointer:coarse)').matches); }
let mkEl = null, mkTarget = null;
function moneyKeypadEl(){
  if(mkEl) return mkEl;
  mkEl = document.createElement('div');
  mkEl.id = 'money-keypad';
  mkEl.innerHTML = `<div class="mk-preview"><span id="mk-preview-value">0</span><span>${escapeHtml(currencyLabel())}</span></div>
    <div class="mk-grid">
      <button type="button" data-mk="1">1</button><button type="button" data-mk="2">2</button><button type="button" data-mk="3">3</button><button type="button" class="mk-alt mk-danger" data-mk="back">&#9003;</button>
      <button type="button" data-mk="4">4</button><button type="button" data-mk="5">5</button><button type="button" data-mk="6">6</button><button type="button" class="mk-alt mk-danger" data-mk="clear">C</button>
      <button type="button" data-mk="7">7</button><button type="button" data-mk="8">8</button><button type="button" data-mk="9">9</button><button type="button" class="mk-alt" data-mk="000">000</button>
      <button type="button" class="mk-alt" data-mk="00">00</button><button type="button" data-mk="0">0</button><button type="button" class="mk-done" data-mk="done" style="grid-column:span 2;">OK</button>
    </div>`;
  document.body.appendChild(mkEl);
  mkEl.addEventListener('pointerdown', (e)=>{ e.preventDefault(); });
  mkEl.addEventListener('click', (e)=>{
    const k = e.target.closest('[data-mk]');
    if(!k || !mkTarget) return;
    moneyKeypadPress(k.dataset.mk);
  });
  return mkEl;
}
function moneyKeypadPress(k){
  const el = mkTarget;
  let v = String(el.value||'').replace(/[^\d]/g,'');
  if(k==='done'){ hideMoneyKeypad(true); return; }
  if(k==='back') v = v.slice(0,-1);
  else if(k==='clear') v = '';
  else {
    if(v==='0') v = '';
    if(v==='' && (k==='00' || k==='000')) return;
    if(v.length + k.length > 12) return;
    v += k;
  }
  el.value = v;
  document.getElementById('mk-preview-value').textContent = v ? Number(v).toLocaleString('ru-RU') : '0';
  el.dispatchEvent(new Event('input', {bubbles:true}));
}
function showMoneyKeypad(el){
  mkTarget = el;
  const box = moneyKeypadEl();
  const v = String(el.value||'').replace(/[^\d]/g,'');
  document.getElementById('mk-preview-value').textContent = v ? Number(v).toLocaleString('ru-RU') : '0';
  box.classList.add('show');
  document.body.classList.add('money-keypad-open');
  setTimeout(()=>{ try{ el.scrollIntoView({block:'center', behavior:'smooth'}); }catch(e){} }, 50);
}
function hideMoneyKeypad(fireChange){
  if(!mkEl) return;
  const el = mkTarget;
  mkEl.classList.remove('show');
  document.body.classList.remove('money-keypad-open');
  mkTarget = null;
  if(el){ if(fireChange) el.dispatchEvent(new Event('change', {bubbles:true})); if(document.activeElement===el) el.blur(); }
}
document.addEventListener('focusin', (e)=>{
  const el = e.target;
  if(isMoneyInput(el) && isTouchDevice()){ showMoneyKeypad(el); return; }
  if(mkEl && mkEl.classList.contains('show') && !mkEl.contains(el)) hideMoneyKeypad(true);
});
document.addEventListener('focusout', (e)=>{
  if(!mkTarget || e.target!==mkTarget) return;
  setTimeout(()=>{ if(mkTarget && document.activeElement!==mkTarget && !(mkEl && mkEl.contains(document.activeElement))) hideMoneyKeypad(true); }, 150);
});
function enhanceInputs(root){
  if(!root.querySelectorAll) return;
  const inputs = [...root.querySelectorAll('input')]; if(root.matches && root.matches('input')) inputs.push(root);
  const bars = [...root.querySelectorAll('.search-bar')]; if(root.matches && root.matches('.search-bar')) bars.push(root);
  inputs.forEach(inp=>{
    if(isMoneyInput(inp) && isTouchDevice() && inp.getAttribute('inputmode')!=='none'){ inp.setAttribute('inputmode','none'); inp.setAttribute('autocomplete','off'); }
  });
  bars.forEach(bar=>{
    if(bar.querySelector('.search-clear')) return;
    const inp = bar.querySelector('input');
    if(!inp) return;
    if(bar.querySelector('button')) bar.classList.add('has-scan');
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'search-clear'; btn.innerHTML = '&times;'; btn.setAttribute('aria-label','clear');
    btn.addEventListener('pointerdown', (e)=>e.preventDefault());
    btn.addEventListener('click', ()=>{ inp.value=''; inp.dispatchEvent(new Event('input', {bubbles:true})); inp.focus(); bar.classList.remove('has-text'); });
    inp.addEventListener('input', ()=>bar.classList.toggle('has-text', !!inp.value));
    bar.classList.toggle('has-text', !!inp.value);
    bar.appendChild(btn);
  });
}
new MutationObserver((muts)=>{
  muts.forEach(m=>m.addedNodes.forEach(n=>{ if(n.nodeType===1) enhanceInputs(n); }));
}).observe(document.documentElement, {childList:true, subtree:true});
document.addEventListener('DOMContentLoaded', ()=>enhanceInputs(document));
"""
rep("\n(async function init(){", JS + "\n(async function init(){", "JS")
open(F, "w", encoding="utf-8").write(s)
s = open(F, encoding="utf-8").read()
rep("  el.dataset.moneyFormatted = '1';\n  el.addEventListener('input', ()=>{",
    "  el.dataset.moneyFormatted = '1';\n  if(isTouchDevice()){ el.setAttribute('inputmode','none'); el.setAttribute('autocomplete','off'); }\n  el.addEventListener('input', ()=>{",
    "money inputs: no OS keyboard on touch")
open(F, "w", encoding="utf-8").write(s)
print("TAYYOR")
