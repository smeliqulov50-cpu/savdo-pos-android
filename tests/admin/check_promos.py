#!/usr/bin/env python3
# Savdo Pos — aksiya, promokod va bosh sahifa (fix203-promo, fix203-dash) avtomatik tekshiruvi.
# To'lov ekrani (chizilgan eski narx, «N kun qoldi», promokod, xatolar, buyurtmaga yuboriladigan kod), «Obuna tugadi» ekrani,
# super admin: bosh sahifa (MRR, grafiklar, 7 kunda tugaydiganlar, eslatma), aksiya/promokod/sovg'a kunlari/sinov muddati oynasi.
# Ishga tushirish:  python3 tests/admin/check_promos.py      Kerak: pip install playwright va python3 -m playwright install chromium
import sys, os, json, threading, http.server, socketserver, functools, ast, calendar
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); WWW = os.path.join(HERE, '..', '..', 'www')
SRC = open(os.path.join(HERE, '..', 'ui', 'check_layout.py'), encoding='utf-8').read()
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
PROMO = {'name': "Navro'z", 'days': 3, 'endMs': 1900000000000}
def quote(code):
    q = [{'key': 'monthly', 'months': 1, 'base': 70000, 'price': 49000, 'best': False, 'promo': PROMO, 'code': None, 'codeError': None, 'codeIgnored': None},
         {'key': 'sixmonth', 'months': 6, 'base': 420000, 'price': 420000, 'best': False, 'promo': None, 'code': None, 'codeError': None, 'codeIgnored': None},
         {'key': 'yearly', 'months': 12, 'base': 840000, 'price': 840000, 'best': True, 'promo': None, 'code': None, 'codeError': None, 'codeIgnored': None}]
    if code == 'BAD':
        for x in q: x['codeError'] = 'code-invalid'
    elif code == 'SALE10':
        q[0].update(price=44100, code='SALE10'); q[1].update(price=378000, code='SALE10'); q[2]['codeError'] = 'code-plan'
    return q
NOW = 1900000000000 - 3 * 86400000
STATS = {'atMs': NOW, 'mrr': 1234000, 'mrrPrev': 1000000, 'mrrChangePct': 23.4, 'counts': {'total': 40, 'paid': 12, 'trial': 20, 'expired': 8, 'unlimited': 0},
         'conversion': {'base': 20, 'paid': 12, 'pct': 60}, 'churnMonth': 2, 'signups': {'today': 1, 'week': 5, 'month': 9, 'daily': [i % 3 for i in range(30)]},
         'revenue12': [{'ym': '2026-%02d' % (m if m <= 12 else m - 12), 'sum': m * 100000} for m in range(11, 23)],
         'expiring7': [{'id': 'bizAAA111', 'name': 'Anor market', 'phone': '+998901112233', 'expMs': NOW + 2 * 86400000}, {'id': 'bizBBB222', 'name': 'Bodom', 'phone': '', 'expMs': NOW + 5 * 86400000}], 'expiring7Count': 2}
API = {'calls': [], 'pcfg': {'promos': [], 'codes': [], 'version': 3}, 'trial': 15, 'orderResp': {'ok': False, 'code': 'code-limit'}}
def jr(r, o, st=200): return r.fulfill(status=st, content_type='application/json', body=json.dumps(o))
def route(r):
    u = r.request.url
    if u.startswith("http://127.0.0.1") or u.startswith("https://fonts."): return r.continue_()
    if r.request.method == 'POST':
        try: body = json.loads(r.request.post_data or '{}')
        except Exception: body = {}
        name = u.rstrip('/').split('/')[-1].split('?')[0]
        API['calls'].append((name, body))
        if name == 'planQuote': return jr(r, {'ok': True, 'plans': quote(body.get('code', ''))})
        if name == 'createPaymentOrder': return jr(r, API['orderResp'], 400)
        if name == 'adminApi':
            a = body.get('action')
            if a == 'statsGet': return jr(r, {'ok': True, 'stats': STATS})
            if a == 'remind': return jr(r, {'ok': True, 'count': len(body.get('bizIds') or [])})
            if a == 'promosGet': return jr(r, {'ok': True, 'cfg': API['pcfg'], 'usage': {}, 'log': [], 'trialDays': API['trial']})
            if a == 'promosSet':
                if body.get('version') != API['pcfg']['version']: return jr(r, {'ok': False, 'code': 'conflict'}, 409)
                API['pcfg'] = {'promos': body['promos'], 'codes': body['codes'], 'version': API['pcfg']['version'] + 1}; return jr(r, {'ok': True, 'version': API['pcfg']['version']})
            if a == 'giftDays': return jr(r, {'ok': True, 'count': 7, 'skipped': 0})
            if a == 'trialSet': API['trial'] = body['days']; return jr(r, {'ok': True})
            return jr(r, {'ok': True})
    return r.abort()
def calls(n, a=None): return [b for (x, b) in API['calls'] if x == n and (a is None or b.get('action') == a)]
def text(pg, sel): return pg.evaluate("(s)=>{ const e=document.querySelector(s); return e ? e.innerText : ''; }", sel)
def setv(pg, sel, v): pg.evaluate("([s,v])=>{ const e=document.querySelector(s); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); }", [sel, v])   # sana tanlagich (ilovaning o'zi) asl maydonni yashiradi
def nowide(pg): return pg.evaluate("()=>document.documentElement.scrollWidth <= window.innerWidth + 1")
with sync_playwright() as p:
    br = p.chromium.launch(args=["--no-sandbox"])
    ctx = br.new_context(viewport={"width": 360, "height": 800}); ctx.route("**/*", route)
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200])); pg.on("dialog", lambda d: d.dismiss())
    pg.goto(URL); pg.wait_for_timeout(1300); pg.evaluate(SETUP, ['owner', False, 'uz'])
    pg.evaluate("()=>{ fbUser = {uid: 'owner1', getIdToken: async()=>'t'}; window.__pay = null; openPaymentScreen(); }"); pg.wait_for_timeout(500)
    t = text(pg, '#pay-root')
    ok("to'lov: aksiya — eski narx chizilgan (70 000) va yangi narx 49 000", pg.locator('[data-pay-plan-card="monthly"] s.pay-old').count() == 1 and '49 000' in text(pg, '[data-pay-plan-card="monthly"] .pay-price'), t[:300])
    ok("to'lov: «Aksiya «Navro'z»: 3 kun qoldi» yozuvi", "3 kun qoldi" in t and "Navro'z" in t, t[:300])
    ok("to'lov: jami 49 000 (aksiya bilan)", '49 000' in text(pg, '#pay-total-amt'))
    ok("to'lov ekrani 360 px da sig'adi", nowide(pg))
    pg.fill('#pay-code', 'bad'); pg.click('#pay-code-btn'); pg.wait_for_timeout(500)
    ok("noto'g'ri promokod — «Bunday promokod yo'q», narx o'zgarmaydi", "Bunday promokod yo'q" in text(pg, '#pay-root') and '49 000' in text(pg, '#pay-total-amt'))
    pg.fill('#pay-code', 'sale10'); pg.press('#pay-code', 'Enter'); pg.wait_for_timeout(500)
    ok("promokod qo'llandi: jami 44 100, xabar ko'rinadi", '44 100' in text(pg, '#pay-total-amt') and "Promokod qo'llandi: SALE10" in text(pg, '#pay-root'), text(pg, '#pay-root')[-300:])
    ok("promokod serverda tekshirildi (planQuote ga kod yuborildi)", any(b.get('code') == 'SALE10' for b in calls('planQuote')))
    pg.click('#pay-cta'); pg.wait_for_timeout(500)
    oc = calls('createPaymentOrder')
    ok("buyurtma: tarif oylik, promoCode SALE10 (summa serverda hisoblanadi — brauzer summa yubormaydi)", oc and oc[-1].get('promoCode') == 'SALE10' and oc[-1].get('plan') == 'monthly' and 'amount' not in oc[-1], oc[-1:] )
    ok("server rad etsa (limit tugagan) — tushunarli xato", "ishlatib bo'lingan" in text(pg, '#pay-error'), text(pg, '#pay-error'))
    pg.click('[data-pay-plan-card="yearly"]'); pg.wait_for_timeout(300)
    ok("yillik tarifga kod tegishli emas — ogohlantirish ko'rinadi", "tegishli emas" in text(pg, '[data-pay-plan-card="yearly"]'), text(pg, '[data-pay-plan-card="yearly"]'))
    pg.click('#pay-cta'); pg.wait_for_timeout(500)
    oc = calls('createPaymentOrder')
    ok("yillik: kod yuborilmaydi (summa — oddiy narx 840 000)", oc[-1].get('plan') == 'yearly' and oc[-1].get('promoCode') == '' and '840 000' in text(pg, '#pay-total-amt'), oc[-1])
    pg.evaluate("()=>{ const r=document.getElementById('pay-root'); if(r) r.remove(); window.__sxQ = null; state.currentStaff = state.staff[0]; renderSubscriptionExpiredScreen(); }"); pg.wait_for_timeout(800)
    t = pg.evaluate("()=>document.getElementById('subscription-root').innerHTML")
    ok("«Obuna tugadi»: aksiya narxi 49 000, eski 70 000 chizilgan, «3 kun qoldi»", '49 000' in t and '<s class="pay-old">70 000' in t and '3 kun qoldi' in t, t[:200])
    pg.evaluate("()=>{ document.getElementById('subscription-root').innerHTML=''; }")
    # Android (Play) — to'lov oynasi ochilmaydi, narx so'ralmaydi
    n0 = len(calls('planQuote'))
    pg.evaluate("()=>{ window.__payPrevCap = window.Capacitor; window.Capacitor = Object.assign({}, window.Capacitor || {}, {isNativePlatform: ()=>true}); window.__pay = null; openPaymentScreen(); }"); pg.wait_for_timeout(300)
    ok("Android ilovada to'lov oynasi ochilmaydi (Google Play qoidasi)", pg.locator('#pay-root').count() == 0 and len(calls('planQuote')) == n0)
    pg.evaluate("()=>{ window.Capacitor = window.__payPrevCap; }")
    # super admin
    pg.evaluate("()=>{ fbUser = {uid: SUPER_ADMIN_UID, email: 'admin@x.uz', getIdToken: async()=>'tok'}; window.__saUnlocked = true; state.view='superadmin'; renderAll(); }"); pg.wait_for_timeout(900)
    d = text(pg, '#sa-dash')
    ok("bosh sahifa: MRR 1 234 000 va ▲ 23.4%", '1 234 000' in d and '23.4%' in d, d[:300])
    ok("bosh sahifa: pullik 12 / sinovda 20 / tugagan 8, o'tish 60%, ketganlar 2", all(x in d for x in ('12', '20', '8', '60%')) and pg.locator('#sa-dash .sa-stat').count() == 8, d[:400])
    ok("bosh sahifa: 30 kunlik va 12 oylik grafik", pg.locator('#sa-dash svg').count() == 2 and pg.locator('#sa-dash svg').nth(1).locator('rect').count() == 12)
    ok("7 kunda tugaydiganlar: 2 ta do'kon", pg.locator('[data-sa-rem]').count() == 2 and 'Anor market' in d)
    pg.click('[data-sa-rem="bizAAA111"]'); pg.wait_for_timeout(400)
    rc = calls('adminApi', 'remind')
    ok("«Eslatma» — bitta do'konga yuborildi", len(rc) == 1 and rc[0]['bizIds'] == ['bizAAA111'] and '1 ta' in text(pg, '#sa-rem-msg'))
    pg.click('#sa-rem-all'); pg.wait_for_timeout(200)
    ok("«Hammasiga» — birinchi bosishda yubormaydi (tasdiq so'raydi)", len(calls('adminApi', 'remind')) == 1 and '2 ta' in text(pg, '#sa-rem-all'))
    pg.click('#sa-rem-all'); pg.wait_for_timeout(400)
    ok("«Hammasiga» — ikkinchi bosishda 2 ta do'konga", calls('adminApi', 'remind')[-1]['bizIds'] == ['bizAAA111', 'bizBBB222'])
    ok("panel 360 px da sig'adi", nowide(pg))
    pg.evaluate("()=>{ window.__saBizCache = [{id:'bizAAA111', d:{businessName:'Anor market', ownerEmail:'anor@x.uz'}}, {id:'bizBBB222', d:{businessName:'Bodom'}}]; }")
    pg.click('#sa-promos-btn'); pg.wait_for_timeout(600)
    ok("«Aksiyalar va promokodlar» oynasi, 4 bo'lim", pg.locator('#pr-tabs [data-pr-tab]').count() == 4 and "Hali aksiya yo'q" in text(pg, '#pr-body'))
    pg.click('#pr-new'); pg.wait_for_timeout(200)
    pg.fill('#pe-name', "Navro'z"); pg.select_option('#pe-type', 'percent'); pg.fill('#pe-val', '95'); setv(pg, '#pe-start', '2027-03-21T00:00'); setv(pg, '#pe-end', '2027-03-24T23:59')
    pg.click('#pe-save'); pg.wait_for_timeout(200)
    ok("95% — saqlanmaydi (1–90)", not calls('adminApi', 'promosSet') and 'noto' in text(pg, '#pr-err').lower())
    pg.fill('#pe-val', '30'); pg.select_option('#pe-aud', 'selected'); pg.click('#pe-save'); pg.wait_for_timeout(200)
    ok("tanlangan do'konlar bo'sh — saqlanmaydi", not calls('adminApi', 'promosSet') and "do'konni tanlang" in text(pg, '#pr-err'))
    pg.fill('#pe-biz-q', 'anor'); pg.wait_for_selector('[data-pe-sel="bizAAA111"]', timeout=5000); pg.click('[data-pe-sel="bizAAA111"]'); pg.wait_for_timeout(100)
    pg.click('#pe-save'); pg.wait_for_timeout(600)
    ps = calls('adminApi', 'promosSet')
    st = calendar.timegm((2027, 3, 21, 0, 0, 0)) * 1000 - 5 * 3600000
    ok("aksiya saqlandi: 30%, boshlanish Toshkent 21.03 00:00 (UTC 20.03 19:00), tanlangan do'kon, versiya 3", len(ps) == 1 and ps[0]['promos'][0]['value'] == 30 and ps[0]['promos'][0]['startMs'] == st and ps[0]['promos'][0]['bizIds'] == ['bizAAA111'] and ps[0]['version'] == 3, ps)
    ok("ro'yxatda aksiya va «21.03.2027 00:00» (Toshkent)", "Navro'z" in text(pg, '#pr-body') and '21.03.2027 00:00' in text(pg, '#pr-body'), text(pg, '#pr-body')[:300])
    pg.click('[data-pr-tab="codes"]'); pg.wait_for_timeout(150); pg.click('#pr-new'); pg.wait_for_timeout(150)
    ok("promokod: «aksiya bilan birga» sukut bo'yicha o'chiq", pg.is_checked('#pe-with') is False)
    pg.fill('#pe-code', 'a'); pg.click('#pe-save'); pg.wait_for_timeout(150)
    ok("qisqa kod — saqlanmaydi", len(calls('adminApi', 'promosSet')) == 1 and '3–20' in text(pg, '#pr-err'))
    pg.fill('#pe-code', 'bahor-26'); pg.fill('#pe-val', '10'); pg.fill('#pe-max', '100'); pg.fill('#pe-shop', '1'); pg.click('#pe-save'); pg.wait_for_timeout(600)
    ps = calls('adminApi', 'promosSet')
    ok("promokod saqlandi: BAHOR-26, 10%, 100 marta, aksiya o'zgarmadi, versiya 4", len(ps) == 2 and ps[1]['codes'][0]['code'] == 'BAHOR-26' and ps[1]['codes'][0]['maxUses'] == 100 and len(ps[1]['promos']) == 1 and ps[1]['version'] == 4, ps[-1:])
    pg.click('[data-pr-tab="gift"]'); pg.wait_for_timeout(150)
    pg.fill('#pg-days', '5'); pg.fill('#pg-reason', 'Server uzilishi'); pg.click('#pg-go'); pg.wait_for_timeout(150)
    ok("sovg'a: do'kon tanlanmasa — yubormaydi", not calls('adminApi', 'giftDays') and "do'konni tanlang" in text(pg, '#pr-err'))
    pg.select_option('#pg-target', 'all'); pg.click('#pg-go'); pg.wait_for_timeout(150)
    ok("hammaga: tasdiq oynasi (2 ta do'kon, 5 kun)", '2 ta' in text(pg, '#pg-confirm') and '5 kun' in text(pg, '#pg-confirm'))
    pg.click('#pg-yes'); pg.wait_for_timeout(300)
    ok("hammaga: «HAMMAGA» yozilmasa — yubormaydi", not calls('adminApi', 'giftDays'))
    pg.fill('#pg-sure', 'hammaga'); pg.click('#pg-yes'); pg.wait_for_timeout(700)
    g = calls('adminApi', 'giftDays')
    ok("sovg'a yuborildi: hammaga, 5 kun, sabab bilan", len(g) == 1 and g[0]['target'] == 'all' and g[0]['days'] == 5 and g[0]['reason'] == 'Server uzilishi', g)
    pg.click('[data-pr-tab="trial"]'); pg.wait_for_timeout(150)
    pg.fill('#pt-days', '90'); pg.click('#pt-save'); pg.wait_for_timeout(150)
    ok("sinov 90 kun — saqlanmaydi (3–60)", not calls('adminApi', 'trialSet') and '3–60' in text(pg, '#pr-err'))
    pg.fill('#pt-days', '20'); pg.click('#pt-save'); pg.wait_for_timeout(150); pg.click('#pt-yes'); pg.wait_for_timeout(600)
    tc = calls('adminApi', 'trialSet')
    ok("sinov muddati 20 kun saqlandi (tasdiqdan keyin)", len(tc) == 1 and tc[0].get('days') == 20, tc)
    ok("oyna 360 px da sig'adi", nowide(pg))
    ok("sahifa xatolari yo'q", not errs, errs)
    br.close()
print("JAMI: %d OK, %d XATO" % (R["ok"], R["bad"]))
sys.exit(1 if R["bad"] else 0)
