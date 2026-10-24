#!/usr/bin/env python3
# Savdo Pos — mijoz botidagi «jami qarz» uchun har bir qarz yozuvida amaldan keyingi qarz (fix209-custdebt).
# Ishga tushirish:  python3 tests/ui/check_custdebt.py
# -*- coding: utf-8 -*-
import sys, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
import os
ROOT=sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'www'); PORT=0
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
socketserver.TCPServer.allow_reuse_address=True
srv=socketserver.TCPServer(("127.0.0.1",PORT),functools.partial(H,directory=ROOT)); PORT=srv.server_address[1]; threading.Thread(target=srv.serve_forever,daemon=True).start()
BASE="http://127.0.0.1:%d/index.html"%PORT
passed=failed=0
def ok(n,c,x=None):
    global passed,failed
    if c: passed+=1; print("  OK   "+n)
    else: failed+=1; print("  XATO "+n+("  -> "+str(x) if x is not None else ""))
SEED="""
state.setupDone=true; state.currentStaff=null; state.staff=[]; state.currentBranchId=state.currentBranchId||DEFAULT_BRANCH_ID;
state.settings.lastSeenVersion=APP_VERSION; state.settings.allowOversell=false; state.saleMode='retail';
state.products=[
 {id:'a',name:'Adrenalin 0,45L',price:14000,costPrice:9000,stock:180,category:'Ichimlik',branchId:DEFAULT_BRANCH_ID},
 {id:'neg',name:'Minus tovar',price:5000,costPrice:1,stock:-12,category:'Boshqa',branchId:DEFAULT_BRANCH_ID},
 {id:'g',name:'Garden 0,5L',price:8000,costPrice:5000,stock:0,category:'Ichimlik',branchId:DEFAULT_BRANCH_ID,unitsPerBox:12,boxPrice:96000,boxLabel:'Blok',variants:[{id:'g1',name:'Nok (dona)',price:8000,cost:5000,stock:-12,boxPrice:96000},{id:'g2',name:'Olma',price:8000,cost:5000,stock:30,boxPrice:96000,wholesalePrice:7000}]},
 {id:'w',name:'Ulgurji tovar',price:5000,costPrice:1,stock:50,wholesalePrice:4000,unitsPerBox:10,boxPrice:36000,boxLabel:'Quti',branchId:DEFAULT_BRANCH_ID,barcode:'12345'},
 {id:'lim',name:'Cheklangan',price:1000,costPrice:1,stock:3,branchId:DEFAULT_BRANCH_ID},
 {id:'o',name:'Asl qatorli',price:2000,costPrice:1,stock:1,branchId:DEFAULT_BRANCH_ID},
 {id:'q',name:'Tezkor',price:3000,costPrice:1,stock:9,quickAccess:true,branchId:DEFAULT_BRANCH_ID}
]; state.view='sale'; fbUser=null; state.cart=[]; state.search=''; state.activeCategory=null;

state.customers=[
 {id:'c1',branchId:DEFAULT_BRANCH_ID,name:'Aziz Karimov',phone:'+998901112233',address:'Chilonzor',debt:50000,bonusBalance:0,creditLimit:200000},
 {id:'c2',branchId:DEFAULT_BRANCH_ID,name:'Bobur Toshev',phone:'+998902223344',address:'',debt:0,bonusBalance:0},
 {id:'c3',branchId:DEFAULT_BRANCH_ID,name:'Dilnoza Aliyeva',phone:'+998903334455',address:'',debt:0,bonusBalance:0},
 {id:'c4',branchId:DEFAULT_BRANCH_ID,name:'Eldor Ismoilov',phone:'+998904445566',address:'',debt:120000,bonusBalance:0,creditLimit:150000},
 {id:'c5',branchId:DEFAULT_BRANCH_ID,name:'Farrux Sodiqov',phone:'+998905556677',address:'',debt:0,bonusBalance:0},
 {id:'c6',branchId:DEFAULT_BRANCH_ID,name:'Gulnora Qodirova',phone:'+998906667788',address:'',debt:0,bonusBalance:0},
 {id:'c7',branchId:DEFAULT_BRANCH_ID,name:'Hasan Umarov',phone:'+998907778899',address:'',debt:0,bonusBalance:0}
];
state.ledger=[
 {id:'l1',customerId:'c1',type:'sale',amount:80000,date:'2026-09-01T10:00:00.000Z',note:'',staffName:'Admin',branchId:DEFAULT_BRANCH_ID},
 {id:'l2',customerId:'c1',type:'payment',amount:30000,date:'2026-09-05T10:00:00.000Z',note:'qisman',staffName:'Admin',method:'cash',branchId:DEFAULT_BRANCH_ID}
];
state.sales=[
 {id:'s1',date:'2026-09-01T10:00:00.000Z',items:[{productId:'a',name:'Adrenalin 0,45L',qty:2,price:14000,costPrice:9000}],total:28000,subtotal:28000,paymentType:'cash',receiptNumber:'1001',customerId:'c1',branchId:DEFAULT_BRANCH_ID},
 {id:'s2',date:'2026-10-02T10:00:00.000Z',items:[{productId:'o',name:'Asl qatorli',qty:2,price:2000,costPrice:1}],total:4000,subtotal:4000,paymentType:'cash',receiptNumber:'1002',customerId:'c3',branchId:DEFAULT_BRANCH_ID},
 {id:'s3',date:'2026-10-05T10:00:00.000Z',items:[{productId:'o',name:'Asl qatorli',qty:1,price:2000,costPrice:1}],total:2000,subtotal:2000,paymentType:'cash',receiptNumber:'1003',customerId:'c5',branchId:DEFAULT_BRANCH_ID}
];
try{localStorage.removeItem('savdo_cart_cust');localStorage.removeItem('savdo_cust_picked');}catch(e){}
"""
def mk(br, lang='uz', w=1280, h=800, touch=True):
    ctx=br.new_context(viewport={"width":w,"height":h},has_touch=touch,is_mobile=touch)
    pg=ctx.new_page(); pg.errors=[]
    pg.on("pageerror",lambda e:pg.errors.append(str(e)))
    pg.on("console",lambda m: pg.errors.append("console:"+m.text) if m.type=="error" and "Failed to load resource" not in m.text else None)
    pg.route("**/*",lambda r:r.continue_() if r.request.url.startswith("http://127.0.0.1") else r.abort())
    pg.goto(BASE); pg.wait_for_timeout(1500)
    pg.evaluate(SEED); pg.evaluate("state.lang='%s';try{document.getElementById('auth-root').style.display='none'}catch(e){};renderAll();document.getElementById('changelog-root').innerHTML=''"%lang); pg.wait_for_timeout(300); return pg
def openpicker(pg, sale='s1'):
    pg.evaluate("openEditReceiptModal('%s')"%sale); pg.wait_for_timeout(250)
    pg.locator("#er-add-product-btn").tap(); pg.wait_for_timeout(300)
toast=lambda pg:pg.evaluate("(document.getElementById('toast')||{}).textContent||''")
cleartoast=lambda pg:pg.evaluate("document.getElementById('toast')&&(document.getElementById('toast').textContent='')")
def line(pg,pid,vid=None):
    return pg.evaluate("(()=>{const it=editReceiptDraft.items.filter(i=>i.productId==='%s'&&(i.variantId||null)===%s);return it.map(i=>({q:i.qty,m:i.saleMode||'',t:i.priceTier||'',p:i.price,o:!!i._isOriginal}))})()"%(pid, ("'%s'"%vid) if vid else "null"))
def tap(pg,pid): pg.locator("#er-pick-screen [data-erq='%s']"%pid).tap(); pg.wait_for_timeout(250)
def bbox(pg,sel):
    pg.evaluate("document.querySelector(\"%s\").scrollIntoView({block:'center'})"%sel); pg.wait_for_timeout(150)
    return pg.locator(sel).bounding_box()
def norm(h): 
    import re
    return re.sub(r'>\s+<','><',re.sub(r'\s+',' ',h)).strip()

# ---------------- fix209-custdebt: har bir qarz yozuvida amaldan KEYINGI qarz (debtAfter) ----------------
SALE="""async(a)=>{
  activeCart().length=0;
  state.products.forEach(p=>{p.stock=1000; (p.variants||[]).forEach(v=>v.stock=1000)});
  a.cart.forEach(c=>addUnitToCart(c.id,c.q,'set'));
  openCheckoutModal(); await new Promise(r=>setTimeout(r,150));
  const n=state.sales.length;
  await doCheckout(a.pt, ()=>a.cust, a.extras||{serviceChargePercent:0,deliveryFee:0});
  await new Promise(r=>setTimeout(r,300));
  try{closeModal()}catch(e){}
  try{ document.getElementById('modal-root').innerHTML=''; }catch(e){}
  return {n:state.sales.length-n, sale: state.sales.length>n? JSON.parse(JSON.stringify(state.sales[state.sales.length-1])):null};
}"""
debt=lambda pg,c: pg.evaluate("state.customers.find(x=>x.id==='%s').debt"%c)
lastL=lambda pg,c,k=1: pg.evaluate("state.ledger.filter(l=>l.customerId==='%s').slice(-%d)"%(c,k))
def form(pg, c, typ, amt):
    pg.evaluate("openLedgerForm('%s','%s')"%(c,typ)); pg.wait_for_timeout(150)
    pg.evaluate("(a)=>{const i=document.getElementById('lf-amount'); i.value=a; document.getElementById('lf-save-btn').click();}", str(amt)); pg.wait_for_timeout(150)
def hubpay(pg,c,amt):
    pg.evaluate("openCustomerHub({})"); pg.wait_for_timeout(250)
    pg.evaluate("window.__custHub.custId='%s'; window.__custHub.view='pay'; window.__custHub.render();"%c); pg.wait_for_timeout(250)
    pg.evaluate("(a)=>{const i=document.getElementById('ch-p-amt'); i.value=a; i.dispatchEvent(new Event('input',{bubbles:true}));}", str(amt))
    pg.evaluate("document.getElementById('ch-p-save').click()"); pg.wait_for_timeout(250)
    pg.evaluate("try{closeCustomerHub()}catch(e){}")
with sync_playwright() as p:
    br=p.chromium.launch(args=["--no-sandbox"]); pg=mk(br)
    pg.evaluate("state.settings.loyaltyEnabled=false; state.settings.defaultCreditLimit=0; state.customers.forEach(c=>{c.creditLimit=0}); state.customers.find(c=>c.id==='c1').debt=300000;")
    print("[1] qo'lda qarz / qo'lda to'lov / mijoz kartasidan to'lov")
    form(pg,'c1','sale',50000); e=lastL(pg,'c1')[0]
    ok("qo'lda qarz +50 000: qarz 350 000, yozuvda debtAfter 350 000", debt(pg,'c1')==350000 and e['type']=='sale' and e.get('debtAfter')==350000, e)
    form(pg,'c1','payment',100000); e=lastL(pg,'c1')[0]
    ok("to'lov 100 000: qarz 250 000, debtAfter 250 000", debt(pg,'c1')==250000 and e.get('debtAfter')==250000, e)
    hubpay(pg,'c1',20000); e=lastL(pg,'c1')[0]
    ok("mijoz kartasidan to'lov 20 000: debtAfter 230 000", debt(pg,'c1')==230000 and e.get('debtAfter')==230000, e)
    print("[2] nasiya sotuv, aralash to'lov")
    r=pg.evaluate(SALE,{"pt":"credit","cust":"c1","cart":[{"id":"a","q":1}]})
    ok("nasiya sotuv 14 000: chekda debtAfter 244 000 = ilovadagi qarz", r['n']==1 and r['sale'].get('debtAfter')==244000 and debt(pg,'c1')==244000, (r['sale'] or {}).get('debtAfter'))
    ok("nasiya sotuv yozuvi ham debtAfter bilan", lastL(pg,'c1')[0].get('debtAfter')==244000)
    pg.evaluate("state.customers.find(c=>c.id==='c3').debt=0")
    r=pg.evaluate(SALE,{"pt":"cash","cust":"c3","cart":[{"id":"a","q":1},{"id":"q","q":1}],"extras":{"serviceChargePercent":0,"deliveryFee":0,"splitMethod":"credit","splitAmount":7000}})
    ok("aralash (naqd 10 000 + nasiya 7 000): qarz 7 000, chekda debtAfter 7 000", debt(pg,'c3')==7000 and r['sale'].get('debtAfter')==7000, (debt(pg,'c3'), r['sale'].get('debtAfter')))
    ok("aralash: oxirgi yozuv (to'lov qismi) debtAfter 7 000", lastL(pg,'c3')[0].get('debtAfter')==7000, lastL(pg,'c3',2))
    print("[3] qaytarish, chek tahriri")
    sid=r['sale']['id']; pg.evaluate("refundSale('%s')"%sid); pg.wait_for_timeout(250)
    pg.click('#modal-root .btn-danger, #modal-root .btn-primary, #confirm-yes', timeout=3000); pg.wait_for_timeout(300)
    e=lastL(pg,'c3')[0]
    ok("qaytarish: qarz 0, yozuv debtAfter 0", debt(pg,'c3')==0 and e.get('debtAfter')==0, e)
    pg.evaluate("state.customers.find(c=>c.id==='c7').debt=0")
    r=pg.evaluate(SALE,{"pt":"credit","cust":"c7","cart":[{"id":"a","q":2}]}); sid=r['sale']['id']
    pg.evaluate("openEditReceiptModal('%s')"%sid); pg.wait_for_timeout(300)
    pg.evaluate("editReceiptDraft.items[0].qty=1; saveEditedReceipt()"); pg.wait_for_timeout(300)
    se=pg.evaluate("state.ledger.find(l=>l.saleId==='%s' && l.type==='sale')"%sid)
    ok("chek tahriri: qarz 14 000 (hisob o'zgarmadi), tahrirlangan eski yozuvga keyingi qarz yozilmaydi", debt(pg,'c7')==14000 and se.get('editedAt') and se.get('debtAfter')==28000, se)
    print("[4] 1 soniya ichida 3 amal")
    pg.evaluate("state.customers.find(c=>c.id==='c5').debt=100000")
    form(pg,'c5','sale',10000); form(pg,'c5','payment',60000); form(pg,'c5','sale',5000)
    da=[x.get('debtAfter') for x in lastL(pg,'c5',3)]
    ok("ketma-ket: 110 000 → 50 000 → 55 000", da==[110000,50000,55000] and debt(pg,'c5')==55000, da)
    print("[5] eski yozuvlar o'zgarmadi, xatosiz")
    ok("oldingi (seed) yozuvlarga debtAfter qo'shilmadi", pg.evaluate("state.ledger.filter(l=>l.id==='l1'||l.id==='l2').every(l=>l.debtAfter===undefined)"))
    ok("JS xatosi yo'q", not pg.errors, pg.errors[:3])
    br.close()
print("JAMI: %d OK, %d XATO" % (passed, failed))
sys.exit(1 if failed else 0)
