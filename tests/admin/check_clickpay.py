#!/usr/bin/env python3
# Savdo Pos — Telegram mini ilova: obuna to'lovi Click sahifasi orqali (fix207-clickpay) tekshiruvi.
# Ishga tushirish:  python3 tests/admin/check_clickpay.py      Kerak: pip install playwright va python3 -m playwright install chromium
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
MODE = {'pay': {'ok': True, 'link': 'https://my.click.uz/services/pay?service_id=1&merchant_id=2&amount=56000&transaction_param=ord1&return_url=x', 'order': 'ord1', 'redirect': True}}
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
        elif a == 'subPay': o = MODE['pay']
        else: o = {'ok': False, 'code': 'x'}
        return r.fulfill(status=200, content_type='application/json', body=json.dumps(o))
    return r.abort()
INIT = """window.Telegram = {WebApp: {initData: 'query_id=1&user=%7B%22id%22%3A1%7D&hash=x', initDataUnsafe: {}, ready(){}, expand(){}, setHeaderColor(){}, setBackgroundColor(){}, onEvent(){}, offEvent(){},
  themeParams: {}, colorScheme: 'light', BackButton: {show(){}, hide(){}, onClick(){}, offClick(){}}, MainButton: {show(){}, hide(){}, setText(){}, onClick(){}, offClick(){}, setParams(){}},
  HapticFeedback: {notificationOccurred(){}, impactOccurred(){}, selectionChanged(){}}, openInvoice(l, cb){ window.__inv = l; cb('cancelled'); }, openTelegramLink(){}, openLink(u){ (window.__ol = window.__ol || []).push(u); }, showAlert(){}, showConfirm(m, cb){ cb && cb(true); }, platform: 'android', version: '7.0', isVersionAtLeast(){ return true; }}};"""
def text(pg): return pg.evaluate("()=>document.getElementById('app').innerText")
with sync_playwright() as p:
    br = p.chromium.launch(args=["--no-sandbox"])
    ctx = br.new_context(viewport={"width": 360, "height": 780}); ctx.route("**/*", route); ctx.add_init_script(INIT)
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(URL); pg.wait_for_timeout(1200)
    pg.click('[data-hpay="m"]'); pg.wait_for_timeout(500)
    ol = pg.evaluate("()=>window.__ol || []")
    ok("Click rejimi: havola Telegram'ning openLink'i bilan (tashqi brauzer) ochildi, Telegram to'lov oynasi ochilmadi", ol == [MODE['pay']['link']] and pg.evaluate("()=>!window.__inv"), ol)
    t = text(pg)
    ok("tushuntirish: «Click sahifasi ochiladi», yashil banner (class tuzatilgan)", "Click sahifasi ochiladi" in t and pg.locator('#app .banner').count() >= 1, t[-300:])
    ok("«Click sahifasini ochish» tugmasi bor", pg.locator('[data-hpaylink]').count() == 1)
    pg.click('[data-hpaylink]'); pg.wait_for_timeout(200)
    ok("tugma — havola qayta ochiladi", pg.evaluate("()=>window.__ol.length") == 2)
    ok("tarif tugmalari qayta faol (band emas)", pg.locator('[data-hpay="m"][disabled]').count() == 0)
    n = len([c for c in CALLS if c.get('action') == 'subInfo'])
    pg.evaluate("()=>{ Object.defineProperty(document, 'visibilityState', {value: 'visible', configurable: true}); document.dispatchEvent(new Event('visibilitychange')); }"); pg.wait_for_timeout(400)
    ok("Click'dan qaytilganda obuna ma'lumoti qayta yuklandi", len([c for c in CALLS if c.get('action') == 'subInfo']) == n + 1)
    MODE['pay'] = {'ok': True, 'link': 'https://evil.example/pay', 'order': 'x', 'redirect': True}
    pg.evaluate("()=>{ window.__ol = []; }"); pg.click('[data-hpay="s"]'); pg.wait_for_timeout(400)
    ok("Click bo'lmagan havola redirect deb ochilmaydi", pg.evaluate("()=>window.__ol.length") == 0 and pg.locator('[data-hpaylink]').count() == 0)
    MODE['pay'] = {'ok': True, 'link': 'https://t.me/$inv', 'order': 'tg1'}
    pg.click('[data-hpay="y"]'); pg.wait_for_timeout(400)
    ok("eski yo'l (kalitlarsiz): Telegram to'lov oynasi avvalgidek", pg.evaluate("()=>window.__inv") == 'https://t.me/$inv')
    for lg in ['ru', 'en', 'kk', 'ky', 'tg']:
        pg.goto(URL.replace('lang=uz', 'lang=' + lg)); pg.wait_for_timeout(900)
        MODE['pay'] = {'ok': True, 'link': 'https://my.click.uz/services/pay?a=1', 'order': 'o', 'redirect': True}
        pg.click('[data-hpay="m"]'); pg.wait_for_timeout(400)
        b = pg.locator('[data-hpaylink]').inner_text() if pg.locator('[data-hpaylink]').count() else ''
        ok(lg + ": matn va tugma tarjima qilingan", 'Click' in b and "sahifasini" not in b and "ochiladi" not in text(pg))
    ok("sahifa xatolari yo'q", not errs, errs)
    br.close()
print("JAMI: %d OK, %d XATO" % (R["ok"], R["bad"]))
sys.exit(1 if R["bad"] else 0)
