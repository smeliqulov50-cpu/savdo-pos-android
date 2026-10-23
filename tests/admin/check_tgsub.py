#!/usr/bin/env python3
# Savdo Pos — Telegram mini ilova (egasi sahifasi, ?v=me): aksiya narxi va promokod (fix203-promo) tekshiruvi.
# Ishga tushirish:  python3 tests/admin/check_tgsub.py      Kerak: pip install playwright va python3 -m playwright install chromium
import sys, os, json, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); WWW = os.path.join(HERE, '..', '..', 'www')
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(H, directory=WWW)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:%d/tgshop.html?v=me&lang=uz" % PORT
R = {"ok": 0, "bad": 0}
def ok(n, c, x=None):
    if c: R["ok"] += 1; print("  OK  ", n)
    else: R["bad"] += 1; print("  XATO", n, "" if x is None else str(x)[:400])
def P(k, key, m, base, price, promo=None, code=None, err=None): return {'k': k, 'key': key, 'months': m, 'base': base, 'price': price, 'best': False, 'promo': promo, 'code': code, 'codeError': err}
PR = {'name': "Navro'z", 'days': 2}
SHOP = {'h': 'abc123', 'name': 'Anor market', 'exp': 1900000000000, 'active': False, 'slug': '', 'link': '',
        'plans': [P('m', 'monthly', 1, 70000, 56000, PR), P('s', 'sixmonth', 6, 420000, 420000), P('y', 'yearly', 12, 840000, 840000)]}
CALLS = []
def route(r):
    u = r.request.url
    if u.startswith("http://127.0.0.1"): return r.continue_()
    if 'telegramShop' in u:
        b = json.loads(r.request.post_data or '{}'); CALLS.append(b); a = b.get('action')
        if a == 'subInfo': o = {'ok': True, 'linked': True, 'payOn': True, 'shops': [SHOP], 'plans': [{'k': 'm', 'months': 1, 'price': 70000}], 'bot': 'savdobot'}
        elif a == 'subQuote':
            c = b.get('code')
            if c == 'YOQ': o = {'ok': True, 'plans': SHOP['plans'], 'codeError': 'code-invalid'}
            else: o = {'ok': True, 'codeError': None, 'plans': [P('m', 'monthly', 1, 70000, 50400, PR, c), P('s', 'sixmonth', 6, 420000, 378000, None, c), P('y', 'yearly', 12, 840000, 840000, None, None, 'code-plan')]}
        elif a == 'subPay': o = {'ok': True, 'link': 'https://t.me/$inv', 'order': 'tg1'}
        else: o = {'ok': False, 'code': 'x'}
        return r.fulfill(status=200, content_type='application/json', body=json.dumps(o))
    return r.abort()
INIT = """window.Telegram = {WebApp: {initData: 'query_id=1&user=%7B%22id%22%3A1%7D&hash=x', initDataUnsafe: {}, ready(){}, expand(){}, setHeaderColor(){}, setBackgroundColor(){}, onEvent(){}, offEvent(){},
  themeParams: {}, colorScheme: 'light', BackButton: {show(){}, hide(){}, onClick(){}, offClick(){}}, MainButton: {show(){}, hide(){}, setText(){}, onClick(){}, offClick(){}, setParams(){}},
  HapticFeedback: {notificationOccurred(){}, impactOccurred(){}, selectionChanged(){}}, openInvoice(l, cb){ window.__inv = l; cb('cancelled'); }, openTelegramLink(){}, openLink(){}, showAlert(){}, showConfirm(m, cb){ cb && cb(true); }, platform: 'android', version: '7.0', isVersionAtLeast(){ return true; }}};"""
def text(pg): return pg.evaluate("()=>document.getElementById('app').innerText")
with sync_playwright() as p:
    br = p.chromium.launch(args=["--no-sandbox"])
    ctx = br.new_context(viewport={"width": 360, "height": 780}); ctx.route("**/*", route); ctx.add_init_script(INIT)
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(URL); pg.wait_for_timeout(1200)
    t = text(pg)
    ok("mini ilova: aksiya — oylik 56 000, eski 70 000 chizilgan", pg.locator('#app s').count() == 1 and '56 000' in t and '70 000' in pg.locator('#app s').inner_text(), t[:300])
    ok("mini ilova: «Navro'z»: 2 kun qoldi", "2 kun qoldi" in t, t[:300])
    ok("promokod maydoni bor", pg.locator('#h-code').count() == 1)
    pg.fill('#h-code', 'yoq'); pg.click('[data-hcode]'); pg.wait_for_timeout(400)
    ok("noto'g'ri kod — «Bunday promokod yo'q»", "Bunday promokod yo'q" in text(pg) and '56 000' in text(pg))
    pg.fill('#h-code', 'bahor'); pg.press('#h-code', 'Enter'); pg.wait_for_timeout(400)
    t = text(pg)
    ok("kod qo'llandi: oylik 50 400, 6 oylik 378 000, xabar", '50 400' in t and '378 000' in t and "Promokod qo'llandi: BAHOR" in t, t[-300:])
    ok("yillikka kod tegishli emas — ogohlantirish", 'Bu tarifga tegishli emas' in t)
    pg.click('[data-hpay="m"]'); pg.wait_for_timeout(400)
    sp = [c for c in CALLS if c.get('action') == 'subPay']
    ok("to'lov: kod bilan (BAHOR), summa yuborilmaydi", sp and sp[-1].get('code') == 'BAHOR' and sp[-1].get('k') == 'm' and 'amount' not in sp[-1], sp)
    pg.click('[data-hpay="y"]'); pg.wait_for_timeout(400)
    sp = [c for c in CALLS if c.get('action') == 'subPay']
    ok("yillik: kod yuborilmaydi", sp[-1].get('code') == '' and sp[-1].get('k') == 'y', sp[-1])
    ok("360 px da sig'adi", pg.evaluate("()=>document.documentElement.scrollWidth <= window.innerWidth + 1"))
    ok("sahifa xatolari yo'q", not errs, errs)
    br.close()
print("JAMI: %d OK, %d XATO" % (R["ok"], R["bad"]))
sys.exit(1 if R["bad"] else 0)
