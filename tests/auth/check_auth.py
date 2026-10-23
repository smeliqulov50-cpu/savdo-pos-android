#!/usr/bin/env python3
# Savdo Pos — yangi kirish ekrani (fix204-auth) avtomatik tekshiruvi.
# Mantiq avvalgidek (email+parol, ro'yxatdan o'tish shartlar bilan, parol tiklash, til), xatolar maydon ostida,
# tab almashganda email saqlanadi, ko'z belgisi, Google/Telegram tugmalari o'chiq bo'lsa ko'rinmaydi,
# 360/412/1024 px va yotiq holat, 6 til, klaviatura ochilganda maydon ko'rinadi.
# Ishga tushirish:  python3 tests/auth/check_auth.py   (--shots papka  — suratlar ham olinadi)
import sys, os, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); WWW = os.path.join(HERE, '..', '..', 'www')
SHOTS = sys.argv[sys.argv.index('--shots') + 1] if '--shots' in sys.argv else None
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
STUB = """()=>{ window.__calls = []; window.__fail = null;
  const f = (name)=>async (...a)=>{ window.__calls.push([name, ...a]); await new Promise(r=>setTimeout(r, window.__delay || 30)); if(window.__fail){ const e = new Error(window.__fail); e.code = window.__fail; throw e; } return {}; };
  fbAuth = { signInWithEmailAndPassword: f('signIn'), createUserWithEmailAndPassword: f('signUp'), sendPasswordResetEmail: f('reset'), onAuthStateChanged(){}, signOut: async()=>{} }; }"""
OPEN = """(a)=>{ state.lang = a[0]; try{ closeModal(); }catch(e){} try{ document.getElementById('login-root').innerHTML=''; }catch(e){}
  const ar = document.getElementById('auth-root'); ar.style.display=''; renderAuthGate(a[1]); }"""
def txt(pg, sel): return pg.evaluate("(s)=>{ const e=document.querySelector(s); return e ? e.innerText.trim() : null; }", sel)
def calls(pg): return pg.evaluate("()=>window.__calls")
def boot(br, w, h):
    ctx = br.new_context(viewport={"width": w, "height": h}, device_scale_factor=2 if SHOTS else 1)
    ctx.route("**/*", lambda r: r.continue_() if r.request.url.startswith("http://127.0.0.1") else r.abort())
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200])); pg.on("dialog", lambda d: d.dismiss())
    pg.goto(URL); pg.wait_for_timeout(2600)
    pg.evaluate(STUB)
    return ctx, pg, errs
LAYOUT = """()=>{
  const sc = document.querySelector('#auth-root .au-screen'); const vw = document.documentElement.clientWidth;
  const out = [];
  const els = [...sc.querySelectorAll('.au-title,.au-sub,.au-tab,.au-soc,label,input,.au-link,#auth-submit-btn,.au-hint,.checkbox-row,a,.au-or,.auth-lang-current')].filter(e=>e.offsetParent!==null);
  els.forEach(e=>{ const r = e.getBoundingClientRect(); if(r.left < -1 || r.right > vw + 1) out.push('chiqib ketgan: ' + (e.id || e.className || e.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); });
  // matnlar ustma-ust chiqmasin (bir qatorda turgan ikki element kesishmasin)
  const t = els.filter(e=>!['INPUT','A','LABEL'].includes(e.tagName) || e.tagName==='INPUT');
  for(let i=0;i<t.length;i++) for(let j=i+1;j<t.length;j++){ if(t[i].contains(t[j]) || t[j].contains(t[i])) continue;
    const a=t[i].getBoundingClientRect(), b=t[j].getBoundingClientRect();
    if(a.width && b.width && a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) out.push('ustma-ust: ' + (t[i].id||t[i].className) + ' / ' + (t[j].id||t[j].className)); }
  // tab yozuvi sig'sin (qirqilmasin)
  sc.querySelectorAll('.au-tab').forEach(b=>{ if(b.scrollWidth > b.clientWidth + 1) out.push('tab sig\\'madi: ' + b.innerText); });
  if(document.documentElement.scrollWidth > vw + 1) out.push('gorizontal surilish');
  // til tugmasi sarlavha/logotip bilan ustma-ust tushmasin
  const lg = sc.querySelector('.auth-lang-current').getBoundingClientRect();
  sc.querySelectorAll('.au-logo,.au-brand,.au-title').forEach(e=>{ if(e.offsetParent===null) return; const r=e.getBoundingClientRect(); if(r.left < lg.right && lg.left < r.right && r.top < lg.bottom && lg.top < r.bottom) out.push('til tugmasi ustida: ' + e.className); });
  return out; }"""
with sync_playwright() as p:
    br = p.chromium.launch(args=["--no-sandbox"])
    ctx, pg, errs = boot(br, 412, 915)
    pg.evaluate("()=>{ AUTH_SOCIAL.google = false; AUTH_SOCIAL.telegram = false; }")   # fix205: Google odatda 'auto' (vebda ko'rinadi) — bu yerda o'chiq holat tekshiriladi
    pg.evaluate(OPEN, ['uz', 'login'])
    ok("kirish ekrani: «Xush kelibsiz!», 2 ta tab («Kirish» faol)", txt(pg, '.au-title') == 'Xush kelibsiz!' and pg.locator('.au-tab').count() == 2 and txt(pg, '.au-tab.on') == 'Kirish')
    ok("Google/Telegram o'chiq bo'lsa — tugmalar ham, «yoki» chizig'i ham yo'q (bo'sh joy qolmaydi)", pg.locator('.au-soc').count() == 0 and pg.locator('.au-or').count() == 0)
    ok("parol maydonida ko'z belgisi", pg.locator('#auth-password ~ .eye-toggle, .au-inp .eye-toggle').count() == 1)
    pg.fill('#auth-password', 'abc'); pg.click('.au-inp .eye-toggle')
    ok("ko'z belgisi parolni ko'rsatadi", pg.evaluate("()=>document.getElementById('auth-password').type") == 'text')
    pg.click('.au-inp .eye-toggle'); pg.fill('#auth-password', '')
    pg.click('#auth-submit-btn'); pg.wait_for_timeout(100)
    ok("bo'sh — xato maydon ostida: «Emailni kiriting» va «Parolni kiriting», serverga yuborilmaydi", txt(pg, '#auth-email-err') == 'Emailni kiriting' and txt(pg, '#auth-password-err') == 'Parolni kiriting' and calls(pg) == [])
    ok("xatoli maydon qizil ramkada", pg.evaluate("()=>document.getElementById('auth-email').closest('.au-field').classList.contains('has-err')"))
    pg.fill('#auth-email', '  ali@test.uz '); pg.wait_for_timeout(50)
    ok("yozishni boshlasa — xato yo'qoladi", txt(pg, '#auth-email-err') == '')
    pg.press('#auth-email', 'Enter')
    ok("emailda Enter — parolga o'tadi (yuborilmaydi)", pg.evaluate("()=>document.activeElement.id") == 'auth-password' and calls(pg) == [])
    pg.fill('#auth-password', 'secret1'); pg.press('#auth-password', 'Enter'); pg.wait_for_timeout(200)
    ok("kirish: signInWithEmailAndPassword('ali@test.uz', 'secret1') — avvalgidek", calls(pg) == [['signIn', 'ali@test.uz', 'secret1']], calls(pg))
    pg.evaluate("()=>{ window.__calls=[]; window.__fail='auth/invalid-credential'; window.__delay=500; }")
    pg.click('#auth-submit-btn'); pg.wait_for_timeout(80)
    ok("kutish paytida tugma bloklanadi (ikki marta bosilmaydi)", pg.evaluate("()=>document.getElementById('auth-submit-btn').disabled") is True)
    pg.click('#auth-submit-btn', force=True); pg.wait_for_timeout(700); pg.evaluate("()=>{ window.__delay=0; }")
    ok("noto'g'ri parol: «Email yoki parol noto'g'ri» parol ostida, bitta so'rov", txt(pg, '#auth-password-err') == "Email yoki parol noto'g'ri" and len(calls(pg)) == 1, calls(pg))
    pg.evaluate("()=>{ window.__fail='auth/user-not-found'; }"); pg.click('#auth-submit-btn'); pg.wait_for_timeout(200)
    ok("hisob topilmadi — email ostida", txt(pg, '#auth-email-err') == 'Bunday hisob topilmadi')
    pg.evaluate("()=>{ window.__fail='auth/network-request-failed'; }"); pg.click('#auth-submit-btn'); pg.wait_for_timeout(200)
    ok("internet yo'q — tushunarli umumiy xabar", 'Internet aloqasi yo' in (txt(pg, '#auth-error') or ''), txt(pg, '#auth-error'))
    pg.evaluate("()=>{ window.__fail='auth/too-many-requests'; }"); pg.click('#auth-submit-btn'); pg.wait_for_timeout(200)
    ok("ko'p urinish — tushunarli xabar", "Juda ko'p urinish" in (txt(pg, '#auth-error') or ''))
    # parol tiklash
    pg.evaluate("()=>{ window.__calls=[]; window.__fail=null; }")
    pg.fill('#auth-email', ''); pg.click('#auth-forgot-btn'); pg.wait_for_timeout(100)
    ok("parol tiklash: email bo'sh — email ostida xato, yuborilmaydi", txt(pg, '#auth-email-err') == 'Emailni kiriting' and calls(pg) == [])
    pg.fill('#auth-email', 'ali@test.uz'); pg.click('#auth-forgot-btn'); pg.wait_for_timeout(200)
    ok("parol tiklash: sendPasswordResetEmail('ali@test.uz'), yashil xabar", calls(pg) == [['reset', 'ali@test.uz']] and 'havolasi emailingizga yuborildi' in (txt(pg, '#auth-error') or ''), [calls(pg), txt(pg, '#auth-error')])
    # tab — ro'yxatdan o'tish
    pg.fill('#auth-password', 'yangi123'); pg.click('[data-au-tab="signup"]'); pg.wait_for_timeout(150)
    ok("«Ro'yxatdan o'tish» tabi: email va parol saqlandi", pg.input_value('#auth-email') == 'ali@test.uz' and pg.input_value('#auth-password') == 'yangi123' and txt(pg, '.au-tab.on') == "Ro'yxatdan o'tish")
    ok("ro'yxatdan o'tish: shartlar matni, havolalar va belgi bor; «Parolni unutdingizmi?» yo'q", pg.locator('#auth-terms-check').count() == 1 and pg.evaluate("()=>document.querySelector('#auth-root a[href^=\"terms-of-service.html\"]').getAttribute('href')") == 'terms-of-service.html?lang=uz' and pg.locator('#auth-root a[href="privacy-policy.html"]').count() == 1 and pg.locator('#auth-forgot-btn').count() == 0)
    ok("parol maydoni yangi parol uchun (autocomplete=new-password), «Kamida 6 ta belgi»", pg.get_attribute('#auth-password', 'autocomplete') == 'new-password' and txt(pg, '.au-hint') == 'Kamida 6 ta belgi')
    pg.evaluate("()=>{ window.__calls=[]; }"); pg.click('#auth-submit-btn'); pg.wait_for_timeout(100)
    ok("shartlarga rozilik belgilanmasa — xato belgi ostida, yuborilmaydi", 'katakchani belgilab' in (txt(pg, '#auth-terms-err') or '') and calls(pg) == [])
    pg.click('label[for="auth-terms-check"]'); pg.wait_for_timeout(50)
    ok("belgini yozuvini bosib ham qo'yish mumkin; xato yo'qoladi", pg.is_checked('#auth-terms-check') and txt(pg, '#auth-terms-err') == '')
    pg.evaluate("()=>{ window.__fail='auth/email-already-in-use'; }"); pg.click('#auth-submit-btn'); pg.wait_for_timeout(200)
    ok("email band — email ostida «allaqachon ro'yxatdan o'tgan»", "allaqachon ro'yxatdan o'tgan" in (txt(pg, '#auth-email-err') or ''))
    pg.evaluate("()=>{ window.__fail='auth/weak-password'; }"); pg.click('#auth-submit-btn'); pg.wait_for_timeout(200)
    ok("kuchsiz parol — parol ostida", 'kamida 6' in (txt(pg, '#auth-password-err') or '').lower())
    pg.evaluate("()=>{ window.__calls=[]; window.__fail=null; }"); pg.click('#auth-submit-btn'); pg.wait_for_timeout(200)
    ok("ro'yxatdan o'tish: createUserWithEmailAndPassword('ali@test.uz', 'yangi123') — avvalgidek", calls(pg) == [['signUp', 'ali@test.uz', 'yangi123']], calls(pg))
    pg.click('#auth-toggle-btn'); pg.wait_for_timeout(100)
    ok("pastdagi «Hisobingiz bormi? Kiring» ham ishlaydi, email saqlanadi", txt(pg, '.au-tab.on') == 'Kirish' and pg.input_value('#auth-email') == 'ali@test.uz')
    # til
    pg.click('#auth-lang-toggle'); pg.click('#auth-lang-dropdown [data-lang="ru"]'); pg.wait_for_timeout(200)
    ok("til ruschaga: matnlar o'zgardi, rejim va email saqlandi", txt(pg, '.au-title') == 'Добро пожаловать!' and txt(pg, '.au-tab.on') == 'Вход' and pg.input_value('#auth-email') == 'ali@test.uz', [txt(pg, '.au-title'), txt(pg, '.au-tab.on')])
    pg.evaluate("()=>{ AUTH_SOCIAL.google = true; AUTH_SOCIAL.telegram = true; }"); pg.evaluate(OPEN, ['uz', 'login'])
    ok("tugmalar yoqilsa: Google, Telegram va «yoki» chizig'i chiqadi (2-bosqich uchun tayyor)", pg.locator('.au-soc').count() == 2 and txt(pg, '.au-or') == 'yoki' and 'Google orqali' in txt(pg, '#auth-google-btn'))
    pg.evaluate("()=>{ AUTH_SOCIAL.google = false; AUTH_SOCIAL.telegram = false; }")
    ok("sahifa xatolari yo'q", not errs, errs)
    ctx.close()
    # ko'rinish: o'lchamlar va tillar
    bad = []; n = 0
    for (w, h) in [(360, 640), (412, 915), (1024, 768), (915, 412), (640, 360)]:
        ctx, pg, errs = boot(br, w, h)
        for lang in ['uz', 'ru', 'en', 'kk', 'ky', 'tg']:
            for mode in ['login', 'signup']:
                for soc in ([False, True] if w in (360, 1024) else [False]):
                    pg.evaluate("(s)=>{ AUTH_SOCIAL.google = s; AUTH_SOCIAL.telegram = s; }", soc)
                    pg.evaluate(OPEN, [lang, mode]); pg.wait_for_timeout(60)
                    pg.click('#auth-submit-btn'); pg.wait_for_timeout(60)   # xatolar ko'rinadigan holat ham tekshirilsin
                    n += 1; out = pg.evaluate(LAYOUT)
                    if out: bad.append('%dx%d %s %s %s: %s' % (w, h, lang, mode, soc, out[:3]))
                    if SHOTS and not soc and w in (360, 412, 1024):
                        pg.evaluate(OPEN, [lang, mode]); pg.wait_for_timeout(80)
                        pg.screenshot(path=os.path.join(SHOTS, 'auth_%s_%s_%d.png' % (lang, mode, w)))
            # tugma pastga surib yetiladimi
        btn = pg.evaluate("()=>{ renderAuthGate('signup'); const b=document.getElementById('auth-submit-btn'); b.scrollIntoView({block:'end'}); const r=b.getBoundingClientRect(); return r.bottom <= innerHeight + 1 && r.top >= 0; }")
        if not btn: bad.append('%dx%d: tugmaga surib yetib bo\'lmadi' % (w, h))
        if errs: bad.append('%dx%d xatolar: %s' % (w, h, errs[:2]))
        ctx.close()
    ok("ko'rinish: 5 o'lcham × 6 til × 2 rejim (+tugmali variant) — %d holat, chiqib ketish/ustma-ust yo'q" % n, not bad, bad[:6])
    # klaviatura: ekran pasayadi (360x640 -> 360x330), faol maydon ko'rinib tursin
    ctx, pg, errs = boot(br, 360, 640)
    pg.evaluate(OPEN, ['ru', 'signup'])
    for fid in ('auth-email', 'auth-password'):
        pg.set_viewport_size({"width": 360, "height": 640}); pg.wait_for_timeout(100)
        pg.evaluate("()=>{ const s=document.querySelector('.au-screen'); s.scrollTop = s.scrollHeight; }")
        pg.focus('#' + fid); pg.set_viewport_size({"width": 360, "height": 330}); pg.wait_for_timeout(900)
        vis = pg.evaluate("(id)=>{ const r=document.getElementById(id).getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }", fid)
        ok("klaviatura ochilganda (balandlik 330 px) %s ko'rinib turadi" % fid, vis)
    ok("sahifa xatolari yo'q (klaviatura)", not errs, errs)
    ctx.close()
    br.close()
print("JAMI: %d OK, %d XATO" % (R["ok"], R["bad"]))
sys.exit(1 if R["bad"] else 0)
