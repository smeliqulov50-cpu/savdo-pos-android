#!/usr/bin/env python3
# Savdo Pos — «yozuvlar ustma-ust chiqmadimi» avtomatik tekshiruvi (fix199-layout).
# Ilovani namunaviy uzun ma'lumot bilan ochadi va har bir ekranni, hisobotni, sozlamani va oynani
# 360 / 412 / 1024 px kenglikda, 6 tilda, oddiy va 130% shriftda tekshiradi.
# Xato hisoblanadi: ikki yozuv ustma-ust, yozuv qutidan chiqqan (oddiy shriftda), ekran yonga aylanadi.
# Ishga tushirish:  python3 tests/ui/check_layout.py            (hammasi, ~15 daqiqa)
#                   python3 tests/ui/check_layout.py --tez      (412 px, o'zbek va rus, ~2 daqiqa)
# Kerak: pip install playwright  va  python3 -m playwright install chromium
import sys, os, json, re, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); WWW = os.path.join(HERE, '..', '..', 'www')
QUICK = '--tez' in sys.argv
WIDTHS = [412] if QUICK else [360, 412, 1024]
LANGS = ['uz', 'ru'] if QUICK else ['uz', 'ru', 'en', 'kk', 'ky', 'tg']
FONTS = [1.0] if QUICK else [1.0, 1.3]
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(H, directory=WWW)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:%d/index.html" % PORT
DETECT = open(os.path.join(HERE, 'detect.js')).read()
SETUP = """([role, rest, lang])=>{
  state.setupDone=false;
  const adm={id:'o1',name:'Ega',pin:'1111',role:'admin',permissions:{customers:true,reports:true,products:true}};
  const cas={id:'k1',name:'Kassir Gulnoza',pin:'2222',role:'cashier',permissions:{customers:true}};
  state.staff=[adm,cas]; state.currentStaff = role==='cashier'?cas:adm; state.currentBranchId=state.currentBranchId||DEFAULT_BRANCH_ID;
  state.settings.lastSeenVersion=APP_VERSION; state.settings.lastDebtExportDate=new Date().toDateString(); state.settings.printerMode='bluetooth'; fbUser=null;
  state.settings.restaurantMode=!!rest; state.view='sale'; state.lang=lang||'uz';
  const B=DEFAULT_BRANCH_ID;
  state.products=[{id:'a',name:'Osh guruch yog\\'li qovurilgan',price:30000,costPrice:15000,stock:100,category:'Taomlar',branchId:B,unit:'dona'},
    {id:'b',name:'Coca-Cola gazli ichimlik',price:12000,costPrice:9000,stock:5,category:'Ichimlik',branchId:B,unit:'dona',variants:[{id:'v1',name:'1L',price:12000,costPrice:9000,stock:3},{id:'v2',name:'0.5L',price:7000,costPrice:5000,stock:2}]},
    {id:'c',name:'Yogurt qulupnayli Nestle 290g',price:9500,costPrice:7000,stock:40,category:'Sut mahsulotlari',branchId:B,unit:'dona',barcode:'4780000000001'},
    {id:'d',name:'Pishloq gollandskiy',price:98000,costPrice:80000,stock:2.5,category:'Sut mahsulotlari',branchId:B,unit:'kg'},
    {id:'e',name:'Qayroq yong\\'oq jigarrang',price:3333,costPrice:2000,stock:0,category:'Yong\\'oqlar',branchId:B,unit:'dona'}];
  state.customers=[{id:'c1',branchId:B,name:'Amirjon avtovokzal',phone:'+998919259489',debt:4921500,bonusBalance:0},{id:'c2',branchId:B,name:'Raxmatilla aka',phone:'+998936019907',debt:6066000},{id:'c3',branchId:B,name:'Xusan aka Yangiyo\\'l',phone:'+998946854664',debt:3798000}];
  state.sales=[{id:'s1',date:new Date().toISOString(),items:[{productId:'a',name:'Osh guruch yog\\'li qovurilgan',qty:2,price:30000,costPrice:15000}],total:60000,subtotal:60000,paymentType:'cash',receiptNumber:'1',branchId:B,customerId:'c1',splitPayments:[{method:'cash',amount:40000},{method:'card',amount:10000},{method:'credit',amount:10000}]},
    {id:'s2',date:new Date().toISOString(),items:[{productId:'c',name:'Yogurt qulupnayli Nestle 290g',qty:1,price:9500,costPrice:7000}],total:9500,subtotal:9500,paymentType:'card',receiptNumber:'2',branchId:B}];
  state.ledger=[{id:'l1',customerId:'c1',type:'sale',amount:50000,date:new Date().toISOString(),note:'Qarzga yozildi'}];
  state.tables=rest?[{id:'t1',name:'1',cart:[],kitchenSent:{}},{id:'t2',name:'VIP yog\\'och',cart:[],kitchenSent:{}}]:[]; state.activeTableId=null; state.cart=[];
  try{document.getElementById('auth-root').style.display='none'}catch(e){}; try{document.getElementById('login-root').innerHTML=''}catch(e){};
  renderAll();
}"""
DATA = r"""()=>{
  const B = DEFAULT_BRANCH_ID, now = Date.now(), iso = (d)=>new Date(now - d*86400000).toISOString();
  const SUP = "Abdug'ofur aka Toshkent ulgurji baza";
  state.staff[1].name = 'Abdurahmonov Muhammadqodir (kassir)';
  const P = (id, name, price, stock, extra)=>Object.assign({id, name, price, costPrice: Math.round(price*0.8), stock, category: extra && extra.cat || 'Ichimliklar va sharbatlar', branchId: B, unit: 'dona'}, extra || {});
  state.products = [
    P('p1', 'Coca-Cola Zero shakarsiz 1,5 litr plastik idishda', 14000, 240, {wholesalePrice: 12500, boxPrice: 72000, unitsPerBox: 6, boxLabel: 'Blok', barcode: '4780000000014'}),
    P('p2', 'Tara RGB 0,25L - Cola (blok)', 78000, 696, {variants: [{id:'v1', name:'Gazli', price:3250, wholesalePrice:3000, boxPrice:78000, stock:300, barcode:'4780000000300'}, {id:'v2', name:'Gazsiz juda uzun variant nomi', price:3250, stock:396}], unitsPerBox: 24, boxLabel: 'Blok'}),
    P('p3', 'Biolife 0,5L', 3000, 480, {variants: [{id:'g0', name:'Gazsiz', price:3000, wholesalePrice:2800, boxPrice:33000, stock:240}, {id:'g1', name:'Gazli', price:3000, stock:240}], unitsPerBox: 12, boxLabel: 'Blok'}),
    P('p4', 'Pishloq gollandskiy 45% yog\'liligi vakuum qadoqda', 152814800, 2.5, {unit: 'kg', cat: 'Sut mahsulotlari'}),
    P('p5', 'Non', 5000, 0, {cat: 'Non'}),
    P('p6', 'Shampun Head & Shoulders Classic Clean 400 ml erkaklar uchun', 64500, 12, {cat: 'Gigiyena va kosmetika vositalari'}),
    P('p7', 'Osh guruch Lazer yog\'li', 30000, 100, {cat: 'Oziq-ovqat'}),
  ];
  for(let i = 8; i <= 14; i++) state.products.push(P('p' + i, 'Mahsulot ' + i + ' — uzun nomli tovar qadoqda', 12345 * i, i * 3));
  state.customers = [
    {id:'c1', branchId:B, name:SUP, phone:'+998901234567', debt:152814800, bonusBalance:1250000, note:'Har hafta seshanba kuni keladi'},
    {id:'c2', branchId:B, name:'Raxmatilla aka Yangiyo\'l bozori 3-qator 15-do\'kon', phone:'+998936019907', debt:6066000},
    {id:'c3', branchId:B, name:'Xusan', phone:'+998946854123', debt:0}
  ];
  const items13 = []; for(let i = 0; i < 13; i++){ const p = state.products[i % state.products.length]; items13.push({productId:p.id, name:p.name, qty: 10 + i, cost: 11754985 + i, price: p.price}); }
  state.purchases = [
    {id:'pu1', date: iso(0), supplier: SUP, note:'HF-2026/10/23-000154-QQ-ULGURJI-BAZA', payMode:'credit', items: items13, total: 152814800, branchId: B, staffName: 'Abdurahmonov Muhammadqodir'},
    {id:'pu2', date: iso(1), supplier: 'Coca-Cola Ichimligi O\'zbekiston MChJ', note:'', payMode:'cash', items: items13.slice(0, 3), total: 2445000, branchId: B},
    {id:'pu3', date: iso(2), supplier: '', note:'Hujjatsiz', payMode:'card', items: items13.slice(0, 1), total: 90000, branchId: B}
  ];
  state.creditors = [{id:'cr1', name: SUP, phone:'+998901234567', note:'', debt:152814800, createdAt: iso(5)}];
  state.creditorLedger = [{id:'cl1', creditorId:'cr1', type:'debt', amount:152814800, note:'13 ta mahsulot · HF-2026/10/23-000154-QQ', date: iso(0), staffName:'Ega'}];
  state.sales = [];
  for(let i = 0; i < 6; i++){
    const it = [{productId:'p1', name:state.products[0].name, qty: 3 + i, price: 14000, costPrice: 11200}, {productId:'p4', name: state.products[3].name, qty: 1, price: 152814800, costPrice: 120000000}];
    const total = it.reduce((a, x)=>a + x.qty * x.price, 0);
    state.sales.push({id:'s' + i, date: iso(i % 3), items: it, total, subtotal: total, paymentType: i % 3 === 0 ? 'credit' : (i % 3 === 1 ? 'card' : 'cash'), receiptNumber: 'B6DE-00' + (60 + i), branchId: B, customerId: i % 2 ? 'c1' : 'c2', cashierName: 'Abdurahmonov Muhammadqodir', staffName: 'Abdurahmonov Muhammadqodir'});
  }
  state.ledger = [{id:'l1', customerId:'c1', type:'sale', amount:152814800, date: iso(0), note:'Qarzga yozildi — chek B6DE-0060'}];
  state.expenses = [{id:'e1', date: iso(0), category:'other', amount: 152814800, note:'Ijara to\'lovi oktabr oyi uchun — Chilonzor 19-kvartal do\'kon', branchId: B, staffName:'Ega'}, {id:'e2', date: iso(1), category:'salary', amount: 4500000, note:'', branchId: B, staffName:'Ega'}];
  try{ saveAll && saveAll(); }catch(e){}
  renderAll();
}"""
SCROLL = r"""()=>{ const mr = document.getElementById('modal-root'); const modalOn = !!(mr && mr.firstElementChild && mr.innerText.trim());
  let sc = null;
  if(modalOn){ sc = [...mr.querySelectorAll('*')].find(e=>{ const c=getComputedStyle(e); return (c.overflowY==='auto'||c.overflowY==='scroll') && e.scrollHeight > e.clientHeight + 4; }); }
  else { const vc = document.getElementById('view-container'); if(vc && vc.scrollHeight > vc.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(vc).overflowY)) sc = vc; else sc = document.scrollingElement; }
  if(!sc) return false;
  const h = sc === document.scrollingElement ? innerHeight : sc.clientHeight;
  if(sc.scrollTop + h >= sc.scrollHeight - 2) return false;
  sc.scrollTop = sc.scrollTop + Math.round(h * 0.75); return true; }"""
FONTJS = r"""(k)=>{ const els = [...document.querySelectorAll('body *')].filter(e=>!e.dataset.fz && !e.closest('svg')); const fs = els.map(e=>parseFloat(getComputedStyle(e).fontSize)); els.forEach((e, i)=>{ if(fs[i] > 0){ e.style.setProperty('font-size', (fs[i] * k).toFixed(2) + 'px', 'important'); } e.dataset.fz = '1'; }); }"""
STATES = []
for v in ['sale', 'products', 'customers', 'receipts', 'reservations', 'myDebts', 'stocktake', 'purchase', 'supply', 'transfer', 'writeoff', 'promo', 'botOrders', 'reports', 'settings']:
    STATES.append(('view:' + v, "()=>{ closeModal(); state.view='%s'; state.settingsCategory=null; state.reportsCategory=null; renderAll(); }" % v))
STATES.append(('view:sale+savat', "()=>{ closeModal(); state.view='sale'; state.cart=[]; addUnitToCart('p1'); addUnitToCart('p4'); addUnitToCart('p6'); addVariantBoxToCart('p3','g0'); renderAll(); }"))
STATES.append(('dyn:reports', "REPORTS"))
STATES.append(('dyn:settings', "SETTINGS"))
MODALS = [
 ('modal:savat', "()=>{ closeModal(); state.view='sale'; renderAll(); state.cart=[]; addUnitToCart('p1'); addUnitToCart('p4'); addUnitToCart('p6'); addVariantBoxToCart('p3','g0'); addVariantToCart('p2','v2'); openCartModal(); }"),
 ('modal:tolov', "()=>{ closeModal(); state.cart=[]; addUnitToCart('p4'); addUnitToCart('p1'); openCheckoutModal(); }"),
 ('modal:tolov-nasiya', "()=>{ const b=document.querySelector('[data-pt=credit]'); if(b) b.click(); }"),
 ('modal:tolov-aralash', "()=>{ const b=document.querySelector('[data-pt=mixed]'); if(b) b.click(); }"),
 ('modal:mijoz-tanlash', "()=>{ closeModal(); openCustomerHub({onSelect:()=>{}}); }"),
 ('modal:mijoz-karta', "()=>{ closeModal(); openCustomerDetail('c1'); }"),
 ('modal:mijoz-xaridlar', "()=>{ closeModal(); openCustomerPurchases('c1'); }"),
 ('modal:mijoz-hisob', "()=>{ closeModal(); openCustomerLedger('c1'); }"),
 ('modal:mijoz-tahrir', "()=>{ closeModal(); openCustomerEditForm('c1'); }"),
 ('modal:mijoz-yangi', "()=>{ closeModal(); openCustomerForm(); }"),
 ('modal:tovar-tahrir', "()=>{ closeModal(); openProductForm('p1'); }"),
 ('modal:tovar-variant', "()=>{ closeModal(); openProductForm('p2'); }"),
 ('modal:tovar-yangi', "()=>{ closeModal(); openProductForm(null); }"),
 ('modal:import-eksport', "()=>{ closeModal(); openImportExportModal(); }"),
 ('modal:etiketka', "()=>{ closeModal(); openLabelsModal(); }"),
 ('modal:xarajat', "()=>{ closeModal(); openExpenseForm(); }"),
 ('modal:xodim', "()=>{ closeModal(); openStaffForm('k1'); }"),
 ('modal:sotuvdan-keyin', "()=>{ closeModal(); openPostSaleModal(state.sales[0], 152814800); }"),
 ('modal:miqdor', "()=>{ closeModal(); state.cart=[]; addUnitToCart('p1'); openQtyKeypad(cartLineKey(state.cart[0])); }"),
 ('modal:narx', "()=>{ closeModal(); state.cart=[]; addUnitToCart('p4'); openPriceEditModal(cartLineKey(state.cart[0])); }"),
 ('modal:variant-tanlash', "()=>{ closeModal(); state.saleMode='wholesale'; openVariantPicker(state.products.find(p=>p.id==='p2')); }"),
 ('modal:ulgurji-tanlash', "()=>{ closeModal(); state.saleMode='wholesale'; openWholesalePicker(state.products[0]); }"),
 ('modal:kutish', "()=>{ closeModal(); state.saleMode='retail'; openHeldCartsModal(); }"),
 ('modal:kirim-hujjat', "()=>{ closeModal(); __puOpen('pu1'); }"),
 ('modal:kirim-tanlash', "()=>{ closeModal(); state.view='purchase'; renderAll(); openPurchasePicker(); }"),
 ('modal:hisobdan-chiqarish-tanlash', "()=>{ closeModal(); state.view='writeoff'; renderAll(); openWriteOffPicker(); }"),
 ('modal:smena-ochish', "()=>{ closeModal(); openStartShiftModal(); }"),
 ('modal:smena-yopish', "()=>{ closeModal(); openEndShiftModal(); }"),
 ('modal:kassa', "()=>{ closeModal(); openCashBalanceModal(); }"),
 ('modal:filial', "()=>{ closeModal(); openQuickBranchSwitch(); }"),
 ('modal:bron', "()=>{ closeModal(); openReservationForm(); }"),
 ('modal:kreditor', "()=>{ closeModal(); openCreditorDetail('cr1'); }"),
 ('modal:kreditor-yangi', "()=>{ closeModal(); openCreditorForm(); }"),
 ('modal:kreditor-tolov', "()=>{ closeModal(); openCreditorTransactionForm('cr1', 'payment'); }"),
 ('modal:nasiya-yozish', "()=>{ closeModal(); openLedgerForm('c1', 'payment'); }"),
 ('modal:chek-tahrir', "()=>{ closeModal(); openEditReceiptModal('s1'); }"),
 ('modal:tez-skaner', "()=>{ closeModal(); window.Html5Qrcode = class { constructor(){} start(){ return Promise.resolve(); } stop(){ return Promise.resolve(); } clear(){} }; state.view='sale'; renderAll(); openFastScanner(); }"),
 ('modal:tolov-ekrani', "()=>{ __fscClose && __fsc && __fscClose(); closeModal(); openPaymentScreen(); }"),
 ('modal:hisobni-ochirish', "()=>{ closeModal(); openDeleteAccountModal(); }"),
 ('modal:none', "()=>{ closeModal(); state.view='sale'; renderAll(); }"),
]
STATES += MODALS

BAD = {'ustma-ust', 'gorizontal-aylanish'}; BAD_NORMAL = {'toshgan'}
fails = []; total = 0
def route(r):
    u = r.request.url
    if u.startswith("http://127.0.0.1") or u.startswith("https://fonts.") : return r.continue_()
    return r.abort()
with sync_playwright() as p:
    br = p.chromium.launch(args=["--no-sandbox"])
    for W in WIDTHS:
        for lang in LANGS:
            for fk in FONTS:
                ctx = br.new_context(viewport={"width": W, "height": 860 if W < 900 else 768}); ctx.route("**/*", route)
                pg = ctx.new_page(); pg.on("dialog", lambda d: d.dismiss())
                pg.goto(URL); pg.wait_for_timeout(1300)
                pg.evaluate(SETUP, ['owner', False, lang]); pg.evaluate("()=>{ window.open = ()=>null; window.print = ()=>{}; }")
                pg.evaluate(DATA); pg.wait_for_timeout(300)
                states = []
                for name, js in STATES:
                    if js == 'REPORTS': states += [('report:' + i, "()=>{ closeModal(); state.view='reports'; state.reportsCategory='%s'; renderAll(); }" % i) for i in pg.evaluate("()=>reportsMenuItems().map(i=>i.id)")]
                    elif js == 'SETTINGS': states += [('settings:' + i, "()=>{ closeModal(); state.view='settings'; state.reportsCategory=null; state.settingsCategory='%s'; renderAll(); }" % i) for i in pg.evaluate("()=>settingsMenuItems().map(i=>i.id).filter(x=>x!=='superadmin')")]
                    else: states.append((name, js))
                for name, js in states:
                    try: pg.evaluate(js)
                    except Exception: pass
                    pg.wait_for_timeout(300)
                    if fk != 1: pg.evaluate(FONTJS, fk); pg.wait_for_timeout(60)
                    for step in range(10):
                        d = pg.evaluate(DETECT, {})
                        for it in d['issues']:
                            if it['kind'] in BAD or (it['kind'] in BAD_NORMAL and fk == 1):
                                key = (name, it['kind'], it['el'])
                                if key not in [f[0] for f in fails]: fails.append((key, W, lang, fk, it['text'][:50]))
                        if not pg.evaluate(SCROLL): break
                        pg.wait_for_timeout(100)
                    total += 1
                ctx.close()
                print('%d px, %s, shrift %s: tekshirildi' % (W, lang, fk), flush=True)
    br.close()
print('Tekshirilgan holatlar:', total)
if fails:
    print('XATO: %d ta joyda yozuvlar ustma-ust yoki sig\'magan:' % len(fails))
    for (name, kind, el), W, lang, fk, t in fails: print('  %s | %s | %s px, %s, %s | %s | %s' % (name, kind, W, lang, fk, t, el[-90:]))
    sys.exit(1)
print('OK: ustma-ust chiqqan yozuv yo\'q.')
