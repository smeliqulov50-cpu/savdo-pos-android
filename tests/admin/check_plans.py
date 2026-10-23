#!/usr/bin/env python3
# Savdo Pos — tariflar bitta manbadan (fix203-plans) avtomatik tekshiruvi.
# Ilova: to'lov ekrani, «Obuna tugadi» ekrani, internet yo'q holat (oxirgi ma'lum narx), zaxira narx (150 000 emas),
# super admin «Tariflar» bo'limi (narx o'zgartirish, tasdiq, serverga yuborilgan ma'lumot, xatolar), kalendar oy bilan uzaytirish.
# Ishga tushirish:  python3 tests/admin/check_plans.py      Kerak: pip install playwright va python3 -m playwright install chromium
import sys, os, json, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); WWW = os.path.join(HERE, '..', '..', 'www')
SRC = open(os.path.join(HERE, '..', 'ui', 'check_layout.py'), encoding='utf-8').read()
import ast
SETUP = next(ast.literal_eval(n.value) for n in ast.parse(SRC).body if isinstance(n, ast.Assign) and getattr(n.targets[0], 'id', '') == 'SETUP')
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(H, directory=WWW)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:%d/index.html" % PORT
R = {"ok": 0, "bad": 0}
def ok(n, c, x=None):
    if c: R["ok"] += 1; print("  OK  ", n)
    else: R["bad"] += 1; print("  XATO", n, "" if x is None else str(x)[:400])
CFG = {'plans': {'monthly': {'price': 80000, 'months': 1, 'active': True, 'order': 1, 'best': False},
                 'sixmonth': {'price': 420000, 'months': 6, 'active': False, 'order': 2, 'best': False},
                 'yearly': {'price': 840000, 'months': 12, 'active': True, 'order': 3, 'best': True, 'name': {'uz': 'Yillik VIP', 'ru': 'Годовой VIP'}}}, 'version': 4}
STUB = """(cfg)=>{ window.__cfg = cfg; fbDb = { collection: (c)=>({ doc: (d)=>({ get: async ()=>{ if(window.__offline) throw new Error('offline'); return { exists: !!window.__cfg, data: ()=>window.__cfg }; } }) }) }; }"""
API = {'calls': []}
def route(r):
    u = r.request.url
    if u.endswith('/adminApi'):
        body = json.loads(r.request.post_data or '{}'); API['calls'].append(body)
        if body.get('action') == 'plansGet':
            return r.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'cfg': {'plans': API['cur'], 'version': API['ver'], 'source': 'config'}, 'log': API.get('log', [])}))
        if body.get('action') == 'plansSet':
            API['cur'] = body['plans']; API['ver'] += 1; API['log'] = [{'atMs': 1761200000000, 'by': 'admin@x.uz', 'before': CFG['plans'], 'after': body['plans']}]
            return r.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'version': API['ver']}))
    if u.startswith("http://127.0.0.1") or u.startswith("https://fonts."): return r.continue_()
    return r.abort()
def text(pg, sel): return pg.evaluate("(s)=>{ const e=document.querySelector(s); return e ? e.innerText : ''; }", sel)
with sync_playwright() as p:
    br = p.chromium.launch(args=["--no-sandbox"])
    ctx = br.new_context(viewport={"width": 412, "height": 860}); ctx.route("**/*", route)
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200])); pg.on("dialog", lambda d: d.dismiss())
    pg.goto(URL); pg.wait_for_timeout(1300); pg.evaluate(SETUP, ['owner', False, 'uz'])
    ok("zaxira narx (config yo'q): oylik 70 000, «Obuna tugadi» dagi 150 000 xatosi yo'q", pg.evaluate("()=>livePlan('monthly').price") == 70000)
    pg.evaluate(STUB, CFG)
    ok("config/plans o'qildi (narx o'zgardi)", pg.evaluate("async ()=>await refreshPlans()") is True)
    ok("sotuvdagi tariflar: oylik va yillik (6 oylik o'chirilgan)", pg.evaluate("()=>livePlanList().map(p=>p.key)") == ['monthly', 'yearly'])
    pg.evaluate("()=>{ fbUser = {uid: 'owner1', getIdToken: async()=>'t'}; window.__pay = null; openPaymentScreen(); }"); pg.wait_for_timeout(300)
    t = text(pg, '#pay-root')
    ok("to'lov ekrani: 80 000 va 840 000, 6 oylik yo'q, paneldagi nom «Yillik VIP», jami 80 000", "80 000" in t and "840 000" in t and "420 000" not in t and "Yillik VIP" in t and "80 000" in text(pg, '#pay-total-amt'), t[:300])
    pg.evaluate("()=>{ const r=document.getElementById('pay-root'); if(r) r.remove(); state.currentStaff = state.staff[0]; renderSubscriptionExpiredScreen(); }"); pg.wait_for_timeout(300)
    t = pg.evaluate("()=>document.getElementById('subscription-root').innerHTML")
    ok("«Obuna tugadi»: 80 000 va 840 000, 150 000 / 1 300 000 yo'q", "80 000" in t and "840 000" in t and "150 000" not in t and "1 300 000" not in t, t[:200])
    pg.evaluate("()=>{ document.getElementById('subscription-root').innerHTML=''; }")
    ok("kalendar oy bilan uzaytirish (31-yanvar + 1 oy = 28-fevral)", pg.evaluate("()=>new Date(__addMonthsUtc(Date.UTC(2027,0,31), 1)).toISOString().slice(0,10)") == '2027-02-28')
    pg.reload(); pg.wait_for_timeout(1300); pg.evaluate(SETUP, ['owner', False, 'uz'])
    pg.evaluate("()=>{ window.__offline = true; fbDb = { collection: ()=>({ doc: ()=>({ get: async ()=>{ throw new Error('offline'); } }) }) }; }")
    pg.evaluate("async ()=>await refreshPlans()")
    ok("internet yo'q (qayta ochildi): oxirgi ma'lum narx 80 000", pg.evaluate("()=>livePlan('monthly').price") == 80000)
    # super admin «Tariflar»
    API['cur'] = CFG['plans']; API['ver'] = 4
    pg.evaluate("()=>{ fbUser = {uid: SUPER_ADMIN_UID, email: 'admin@x.uz', getIdToken: async()=>'tok'}; window.__saUnlocked = true; state.view='superadmin'; renderAll(); }"); pg.wait_for_timeout(300)
    ok("panelda «Tariflar» tugmasi", pg.locator('#sa-plans-btn').count() == 1)
    pg.evaluate("()=>{ window.__offline = false; }"); pg.evaluate(STUB, CFG)
    pg.click('#sa-plans-btn'); pg.wait_for_timeout(500)
    ok("3 ta tarif kartasi, narxlar serverdan", pg.locator('.sap-card').count() == 3 and pg.input_value('[data-sap="monthly"] [data-sap-price]').replace('\xa0', ' ') == '80 000')
    calc = text(pg, '[data-sap="yearly"] [data-sap-calc]')
    ok("kunlik narx va oylikka nisbatan tejash avtomatik", 'Kunlik' in calc and '%' in calc, calc)
    pg.fill('[data-sap="monthly"] [data-sap-price]', '500'); pg.click('#sap-save'); pg.wait_for_timeout(150)
    ok("noto'g'ri narx (500) — saqlanmaydi, xato yoziladi", 'kamida 1 000' in text(pg, '#sap-err') and not any(c.get('action') == 'plansSet' for c in API['calls']))
    pg.fill('[data-sap="monthly"] [data-sap-price]', '85000'); pg.wait_for_timeout(100); pg.click('#sap-save'); pg.wait_for_timeout(200)
    cf = text(pg, '#sap-confirm')
    ok("tasdiq oynasi: «Oylik: 80 000 → 85 000» va izoh", '80 000' in cf and '85 000' in cf and "to'langan obunalarga ta'sir qilmaydi" in cf, cf)
    pg.click('#sap-yes'); pg.wait_for_timeout(700)
    sent = [c for c in API['calls'] if c.get('action') == 'plansSet']
    ok("serverga yuborildi: oylik 85 000, versiya 4 (ziddiyatdan himoya)", len(sent) == 1 and sent[0]['plans']['monthly']['price'] == 85000 and sent[0]['version'] == 4 and sent[0]['plans']['yearly']['name']['uz'] == 'Yillik VIP', sent)
    ok("saqlangandan keyin tarix ko'rinadi", '85 000' in text(pg, '#sap-body') and 'admin@x.uz' in text(pg, '#sap-body'))
    for k in ('monthly', 'yearly'): pg.uncheck('[data-sap="%s"] [data-sap-active]' % k)
    pg.click('#sap-save'); pg.wait_for_timeout(150)
    ok("hamma tarif o'chirilsa — saqlanmaydi", 'Kamida bitta tarif' in text(pg, '#sap-err'))
    ok("sahifa xatolari yo'q", not errs, errs)
    br.close()
print("JAMI: %d OK, %d XATO" % (R["ok"], R["bad"]))
sys.exit(1 if R["bad"] else 0)
