#!/usr/bin/env python3
# Savdo Pos — mini ilova initData'siz ochilganda (eski pastki klaviatura tugmasi) — tushunarli xabar va botga signal (fix209-custkb).
# Ishga tushirish:  python3 tests/admin/check_noinit.py
import sys, os, json, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); WWW = os.path.join(HERE, '..', '..', 'www')
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(H, directory=WWW)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:%d/tgshop.html" % PORT
R = {"ok": 0, "bad": 0}
def ok(n, c, x=None):
    if c: R["ok"] += 1; print("  OK  ", n)
    else: R["bad"] += 1; print("  XATO", n, "" if x is None else str(x)[:300])
CALLS = []
def route(r):
    u = r.request.url
    if u.startswith("http://127.0.0.1"): return r.continue_()
    if 'telegramShop' in u: CALLS.append(u); return r.fulfill(status=200, content_type='application/json', body='{"ok":false,"code":"bad_init"}')
    return r.abort()
def tg(platform, init):
    return """window.Telegram = {WebApp: {initData: %s, initDataUnsafe: {}, ready(){}, expand(){}, setHeaderColor(){}, setBackgroundColor(){}, onEvent(){}, offEvent(){},
  themeParams: {}, colorScheme: 'light', BackButton: {show(){}, hide(){}, onClick(){}, offClick(){}}, MainButton: {show(){}, hide(){}, setText(){}, onClick(){}, offClick(){}, setParams(){}},
  HapticFeedback: {notificationOccurred(){}, impactOccurred(){}, selectionChanged(){}}, sendData(d){ (window.__sd = window.__sd || []).push(d); }, openTelegramLink(){}, openLink(){}, showAlert(){}, platform: %s, version: '7.0', isVersionAtLeast(){ return true; }}};""" % (json.dumps(init), json.dumps(platform))
def text(pg): return pg.evaluate("()=>document.getElementById('app').innerText")
with sync_playwright() as p:
    br = p.chromium.launch(args=["--no-sandbox"])
    for lang, title, btn in [('uz', 'botdagi tugma orqali oching', 'Davom etish'), ('ru', 'через кнопку в боте', 'Продолжить'), ('en', 'button in the bot', 'Continue'), ('kk', 'батырма арқылы', 'Жалғастыру'), ('ky', 'баскыч аркылуу', 'Улантуу'), ('tg', 'тугмаи бот', 'Идома')]:
        ctx = br.new_context(viewport={"width": 360, "height": 740}); ctx.route("**/*", route); ctx.add_init_script(tg('android', ''))
        pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.goto(BASE + "?s=salqin&lang=" + lang); pg.wait_for_timeout(900)
        t = text(pg)
        ok(lang + ": katalog initData'siz — tushunarli xabar va «%s» tugmasi" % btn, title in t and pg.locator('#b-noinit').inner_text() == btn and 'Telegram ichida ochiladi' not in t, t[:200])
        if lang == 'uz':
            ok("serverga initData'siz so'rov yuborilmadi", not CALLS, CALLS)
            pg.click('#b-noinit'); pg.wait_for_timeout(200)
            ok("tugma — botga signal (do'kon va havola nomi bilan)", pg.evaluate("()=>window.__sd") == [json.dumps({'v': 'shop', 's': 'salqin'}).replace(' ', '')], pg.evaluate("()=>window.__sd"))
            pg.goto(BASE + "?v=my&lang=uz"); pg.wait_for_timeout(800); pg.click('#b-noinit'); pg.wait_for_timeout(200)
            ok("«Mening sahifam» initData'siz — signal {v:'my'}", pg.evaluate("()=>JSON.parse(window.__sd[0]).v") == 'my')
            ok("sahifa xatolari yo'q", not errs, errs)
        ctx.close()
    ctx = br.new_context(viewport={"width": 360, "height": 740}); ctx.route("**/*", route); ctx.add_init_script(tg('unknown', ''))
    pg = ctx.new_page(); pg.goto(BASE + "?s=salqin&lang=uz"); pg.wait_for_timeout(800)
    ok("oddiy brauzerda (Telegram tashqarisi) — avvalgi xabar", 'Telegram ichida ochiladi' in text(pg) and pg.locator('#b-noinit').count() == 0, text(pg)[:150])
    ctx.close(); br.close()
print("JAMI: %d OK, %d XATO" % (R["ok"], R["bad"]))
sys.exit(1 if R["bad"] else 0)
