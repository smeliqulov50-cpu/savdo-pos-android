#!/usr/bin/env python3
# Savdo Pos — xato xabari ko'rinishi (fix208-errui): ekranni to'smaydi, 6 tilda, «Batafsil» ichida texnik matn, o'zi yopiladi;
# sahifadan chiqib ketilgandan keyingi fon xatolari (null) foydalanuvchiga ko'rsatilmaydi.
# Ishga tushirish:  python3 tests/ui/check_errui.py [--shots papka]
import sys, os, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); WWW = os.path.join(HERE, '..', '..', 'www')
SH = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(H, directory=WWW)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:%d/index.html" % PORT
R = {"ok": 0, "bad": 0}
def ok(n, c, x=None):
    if c: R["ok"] += 1; print("  OK  ", n)
    else: R["bad"] += 1; print("  XATO", n, "" if x is None else str(x)[:300])
def route(r):
    if r.request.url.startswith("http://127.0.0.1"): return r.continue_()
    return r.abort()
BOX = "()=>{ const b=document.getElementById('fatal-error-box'); return b ? b.innerText : null; }"
with sync_playwright() as p:
    br = p.chromium.launch(args=["--no-sandbox"])
    for lang, want in [('uz', "Kichik nosozlik"), ('ru', 'небольшой сбой'), ('en', 'small glitch'), ('kk', 'Кішкене ақау'), ('ky', 'Кичине ката'), ('tg', 'Хатои хурд')]:
        ctx = br.new_context(viewport={"width": 360, "height": 740}); ctx.route("**/*", route)
        ctx.add_init_script("try{ localStorage.setItem('sardor_lang', '%s'); }catch(e){}" % lang)
        pg = ctx.new_page(); pg.goto(URL); pg.wait_for_timeout(900)
        pg.evaluate("()=>{ setTimeout(()=>{ null.addEventListener('x', ()=>{}); }, 0); }"); pg.wait_for_timeout(300)
        t = pg.evaluate(BOX) or ''
        ok(lang + ": tushunarli xabar chiqdi", want in t, t)
        if lang == 'uz':
            ok("qizil to'liq oyna va «bu rasmni yuboring» yo'q", 'ILOVADA XATO' not in t and 'rasmni yuboring' not in t)
            r = pg.evaluate("()=>{ const b=document.getElementById('fatal-error-box').getBoundingClientRect(); return [b.top, b.bottom, b.height, innerHeight, b.left, b.right]; }")
            ok("pastda, kichik (ekranning 1/4 qismidan kam), chetdan chiqmaydi", r[0] > 740 / 2 and r[2] < 740 / 4 and r[4] >= 8 and r[5] <= 352, r)
            ok("texnik matn yashirin", not pg.locator('#fatal-error-details').is_visible())
            if SH: pg.screenshot(path=os.path.join(SH, 'err_uz.png'))
            pg.click('#fatal-error-box button:has-text("Batafsil")'); pg.wait_for_timeout(100)
            ok("«Batafsil» — texnik matn ko'rinadi (skrinshot uchun)", "Cannot read properties of null" in pg.inner_text('#fatal-error-details'))
            if SH: pg.screenshot(path=os.path.join(SH, 'err_uz_more.png'))
            pg.wait_for_timeout(8500)
            ok("«Batafsil» ochiq bo'lsa — o'zi yopilmaydi", pg.evaluate(BOX) is not None)
            pg.click('#fatal-error-box button[aria-label="Yopish"]'); pg.wait_for_timeout(100)
            ok("✕ — yopiladi", pg.evaluate(BOX) is None)
            pg.evaluate("()=>{ setTimeout(()=>{ undefinedFn1(); }, 0); setTimeout(()=>{ undefinedFn1(); }, 10); }"); pg.wait_for_timeout(300)
            ok("bir xil xato ikki marta yozilmaydi", pg.evaluate("()=>document.getElementById('fatal-error-details').children.length") == 1)
            pg.wait_for_timeout(8300)
            ok("8 soniyada o'zi yopiladi", pg.evaluate(BOX) is None)
            pg.evaluate("()=>{ Promise.reject(new TypeError(\"Cannot read properties of null (reading 'addEventListener')\")); }"); pg.wait_for_timeout(300)
            ok("fon ishidagi null xato (sahifadan chiqilgan) — ko'rsatilmaydi", pg.evaluate(BOX) is None)
            pg.evaluate("()=>{ Promise.reject(new Error('Tarmoq xatosi 42')); }"); pg.wait_for_timeout(300)
            ok("boshqa promise xatosi — kichik xabar bilan ko'rsatiladi", 'Kichik nosozlik' in (pg.evaluate(BOX) or ''))
            pg.evaluate("()=>showFatalError('FIRESTORE (9.0.0) INTERNAL ASSERTION FAILED: x')")
            ok("Firestore ichki xatosi — avvalgidek tiklanadi (xabarga qo'shilmaydi)", 'INTERNAL ASSERTION' not in pg.inner_text('#fatal-error-details'))
        ctx.close()
    ctx = br.new_context(viewport={"width": 412, "height": 860}, color_scheme='dark'); ctx.route("**/*", route)
    pg = ctx.new_page(); pg.goto(URL); pg.wait_for_timeout(900)
    pg.evaluate("()=>{ document.documentElement.setAttribute('data-theme','dark'); setTimeout(()=>{ null.x(); }, 0); }"); pg.wait_for_timeout(300)
    c = pg.evaluate("()=>{ const b=document.getElementById('fatal-error-box'); const s=getComputedStyle(b); return [s.backgroundColor, s.color]; }")
    ok("tungi rejimda ham o'qiladi (fon va matn rangi farqli)", c[0] != c[1], c)
    if SH: pg.screenshot(path=os.path.join(SH, 'err_dark.png'))
    br.close()
print("JAMI: %d OK, %d XATO" % (R["ok"], R["bad"]))
sys.exit(1 if R["bad"] else 0)
