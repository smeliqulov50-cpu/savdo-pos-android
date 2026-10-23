#!/usr/bin/env python3
# Savdo Pos — Google orqali kirish (fix205-google) avtomatik tekshiruvi, soxta Firebase bilan (tests/auth/fake_firebase.js).
# Asosiy talab: hech qachon ikkinchi akkaunt va yangi bo'sh do'kon ochilmaydi (Firestore'dagi do'konlar soni bilan tekshiriladi).
# Ishga tushirish:  python3 tests/auth/check_google.py      Kerak: pip install playwright va python3 -m playwright install chromium
import sys, os, threading, http.server, socketserver, functools
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); WWW = os.path.join(HERE, '..', '..', 'www')
FAKE = open(os.path.join(HERE, 'fake_firebase.js'), encoding='utf-8').read()
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(H, directory=WWW)); PORT = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:%d/index.html" % PORT
R = {"ok": 0, "bad": 0}
def ok(n, c, x=None):
    if c: R["ok"] += 1; print("  OK  ", n)
    else: R["bad"] += 1; print("  XATO", n, "" if x is None else str(x)[:500])
NATIVE = """window.androidBridge = { postMessage: function(){} }; window.__nat = [];
window.Capacitor = { isNativePlatform: ()=>true, getPlatform: ()=>'android', isPluginAvailable: (n)=>n === 'FirebaseAuthentication' || n === 'App', PluginHeaders: [{name: 'App', methods: []}, {name: 'FirebaseAuthentication', methods: [{name: 'signInWithGoogle', rtype: 'promise'}]}],
  Plugins: { App: { addListener: ()=>({remove(){}}), minimizeApp: ()=>Promise.resolve() },
    FirebaseAuthentication: { signInWithGoogle: async (o)=>{ window.__nat.push(o); if(!window.__G) { const e = new Error('The user canceled the sign-in flow.'); throw e; } return { user: null, credential: { providerId: 'google.com', idToken: 'id-' + window.__G.sub } }; } } } };"""
NATIVE_NOPLUGIN = """window.androidBridge = { postMessage: function(){} };
window.Capacitor = { isNativePlatform: ()=>true, getPlatform: ()=>'android', isPluginAvailable: (n)=>n === 'App', PluginHeaders: [{name: 'App', methods: []}], Plugins: { App: { addListener: ()=>({remove(){}}), minimizeApp: ()=>Promise.resolve() } } };"""
def route(r):
    u = r.request.url
    if '/vendor/firebase-app-compat.js' in u: return r.fulfill(status=200, content_type='application/javascript', body=FAKE)
    if '/vendor/firebase-' in u and '-compat.js' in u: return r.fulfill(status=200, content_type='application/javascript', body='/* soxta */')
    if u.startswith("http://127.0.0.1"): return r.continue_()
    return r.abort()
SEED = """(o)=>{ (o.users || []).forEach(u=>{ window.__FA.users[u.uid] = Object.assign({created: Date.now() - 864e5, providers: []}, u); });
  Object.assign(window.__FDB.docs, o.docs || {}); if(o.mode) window.__FA.mode = o.mode; window.__G = o.g || null; window.__GUARD.fail = !!o.guardFail; }"""
BIZ = "()=>Object.keys(window.__FDB.docs).filter(p=>/^businesses\\/[^/]+$/.test(p)).sort()"
def txt(pg, sel): return pg.evaluate("(s)=>{ const e=document.querySelector(s); return e ? e.innerText.trim() : null; }", sel)
def opened(pg): return pg.evaluate("()=>document.getElementById('auth-root').innerHTML.trim() === '' && !!fbUser && state.businessId === fbUser.uid && (document.getElementById('login-root').innerHTML.trim() !== '' || document.getElementById('bottom-nav').innerHTML.trim() !== '')")   # do'kon ochildi: kirish ekrani yopildi, xodim/PIN ekrani yoki ilova ko'rinadi
def boot(br, init=None, w=412, h=900):
    ctx = br.new_context(viewport={"width": w, "height": h}); ctx.route("**/*", route)
    if init: ctx.add_init_script(init)
    ctx.add_init_script("try{ localStorage.setItem('sardor_lang', 'uz'); }catch(e){}")
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200])); pg.on("dialog", lambda d: d.dismiss())
    pg.goto(URL); pg.wait_for_selector('#auth-form', timeout=15000); pg.wait_for_timeout(300)
    return ctx, pg, errs
OWNER_G = {'uid': 'ownerA1', 'email': 'ali@gmail.com', 'providers': ['password'], 'pw': 'parol1'}
OWNER_M = {'uid': 'ownerB2', 'email': 'vali@mail.uz', 'providers': ['password'], 'pw': 'parol2'}
DOCS = {'businesses/ownerA1': {'ownerEmail': 'ali@gmail.com', 'businessName': 'Ali dokoni', 'schemaVersion': 2, 'subscriptionExpiresAtMs': 4102444800000},
        'businesses/ownerB2': {'ownerEmail': 'vali@mail.uz', 'businessName': 'Vali dokoni', 'schemaVersion': 2, 'subscriptionExpiresAtMs': 4102444800000}}
with sync_playwright() as p:
    br = p.chromium.launch(args=["--no-sandbox"])
    # 1) veb: Google tugmasi chiqadi
    ctx, pg, errs = boot(br)
    ok("veb: «Google orqali davom etish» tugmasi va «yoki» chizig'i bor", pg.locator('#auth-google-btn').count() == 1 and txt(pg, '.au-or') == 'yoki')
    ok("Telegram tugmasi hali yo'q (3-bosqich)", pg.locator('#auth-telegram-btn').count() == 0)
    # bekor qilinsa — jim
    pg.evaluate(SEED, {'users': [OWNER_G], 'docs': DOCS, 'g': None}); pg.click('#auth-google-btn'); pg.wait_for_timeout(400)
    ok("Google oynasi yopilsa — xato chiqmaydi, ekran o'zgarmaydi", txt(pg, '#auth-error') in ('', None) and pg.locator('#auth-form').count() == 1 and pg.evaluate(BIZ) == ['businesses/ownerA1', 'businesses/ownerB2'])
    # 2) mavjud egasi (gmail) Google bilan — o'sha akkaunt va do'kon
    pg.evaluate("()=>{ window.__G = {sub: 'g-ali', email: 'ali@gmail.com'}; }")
    pg.click('#auth-google-btn'); pg.wait_for_timeout(1500)
    ok("parol bilan ochilgan akkaunt (gmail) + Google → o'sha akkaunt (ownerA1), eski do'kon ochildi", opened(pg) and pg.evaluate("()=>fbUser && fbUser.uid") == 'ownerA1' and pg.evaluate("()=>state.businessId") == 'ownerA1', [opened(pg), pg.evaluate("()=>fbUser && fbUser.uid")])
    ok("do'konlar soni o'zgarmadi (2 ta), yangi do'kon yaratilmadi", pg.evaluate(BIZ) == ['businesses/ownerA1', 'businesses/ownerB2'], pg.evaluate(BIZ))
    ok("server tekshiruvi chaqirildi (authGuard)", pg.evaluate("()=>window.__GUARD.calls") == 1)
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 3) mavjud egasi (gmail emas) — «account-exists» → parol so'raladi → Google ulanadi
    ctx, pg, errs = boot(br)
    pg.evaluate(SEED, {'users': [OWNER_G, OWNER_M], 'docs': DOCS, 'g': {'sub': 'g-vali', 'email': 'vali@mail.uz'}})
    pg.click('#auth-google-btn'); pg.wait_for_timeout(700)
    ok("boshqa domen: «Google hisobini ulash» oynasi, email to'ldirilgan va o'zgarmaydi", pg.locator('[data-au-mode="link"]').count() == 1 and pg.input_value('#auth-email') == 'vali@mail.uz' and pg.get_attribute('#auth-email', 'readonly') is not None)
    ok("oynada tushuntirish: «parol orqali ro'yxatdan o'tgansiz — parolni kiriting»", "parolni kiriting, Google hisobingiz unga ulanadi" in (txt(pg, '.au-sub') or ''))
    pg.fill('#auth-password', 'xato'); pg.click('#auth-submit-btn'); pg.wait_for_timeout(500)
    ok("noto'g'ri parol — xato parol ostida, kirilmadi", "noto'g'ri" in (txt(pg, '#auth-password-err') or '') and not opened(pg))
    pg.fill('#auth-password', 'parol2'); pg.click('#auth-submit-btn'); pg.wait_for_timeout(1600)
    ok("to'g'ri parol: eski akkaunt (ownerB2) va do'kon ochildi", opened(pg) and pg.evaluate("()=>fbUser && fbUser.uid") == 'ownerB2')
    ok("Google shu akkauntga ulandi (email + Google)", sorted(pg.evaluate("()=>window.__FA.users.ownerB2.providers")) == ['google.com', 'password'])
    ok("do'konlar soni o'zgarmadi", pg.evaluate(BIZ) == ['businesses/ownerA1', 'businesses/ownerB2'])
    ok("sahifa xatolari yo'q", not errs, errs)
    pg.evaluate("()=>fbAuth.signOut()"); pg.wait_for_timeout(500)
    pg.click('#auth-google-btn'); pg.wait_for_timeout(1500)
    ok("chiqib, endi Google bilan qayta kirish — o'sha akkaunt, parolsiz", opened(pg) and pg.evaluate("()=>fbUser.uid") == 'ownerB2' and pg.evaluate(BIZ) == ['businesses/ownerA1', 'businesses/ownerB2'])
    ctx.close()
    # 4) noto'g'ri Firebase sozlamasi (har provayderga alohida akkaunt) — server tekshiruvi ikkinchi akkauntni to'xtatadi
    ctx, pg, errs = boot(br)
    pg.evaluate(SEED, {'users': [OWNER_G, OWNER_M], 'docs': DOCS, 'mode': 'multi', 'g': {'sub': 'g-vali2', 'email': 'vali@mail.uz'}})
    pg.click('#auth-google-btn'); pg.wait_for_timeout(1200)
    newu = pg.evaluate("()=>Object.keys(window.__FA.users).filter(k=>!['ownerA1','ownerB2'].includes(k))")
    ok("ikkinchi akkaunt ochilib qolsa: server uni o'chirdi, yangi do'kon yaratilmadi", newu == [] and pg.evaluate(BIZ) == ['businesses/ownerA1', 'businesses/ownerB2'], [newu, pg.evaluate(BIZ)])
    ok("…va «parolni kiriting — Google ulanadi» oynasi chiqdi", pg.locator('[data-au-mode="link"]').count() == 1 and pg.input_value('#auth-email') == 'vali@mail.uz')
    pg.fill('#auth-password', 'parol2'); pg.click('#auth-submit-btn'); pg.wait_for_timeout(1600)
    ok("parol bilan — eski akkaunt ochildi, Google unga ulandi, do'konlar soni o'zgarmadi", opened(pg) and pg.evaluate("()=>fbUser.uid") == 'ownerB2' and 'google.com' in pg.evaluate("()=>window.__FA.users.ownerB2.providers") and pg.evaluate(BIZ) == ['businesses/ownerA1', 'businesses/ownerB2'])
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 5) yangi Google foydalanuvchi — shartlar, keyin odatdagi yangi do'kon
    ctx, pg, errs = boot(br)
    pg.evaluate(SEED, {'users': [OWNER_G], 'docs': DOCS, 'g': {'sub': 'g-new', 'email': 'yangi@gmail.com'}})
    pg.click('#auth-google-btn'); pg.wait_for_timeout(1000)
    ok("yangi foydalanuvchi: shartlar oynasi, email ko'rinadi, do'kon hali yaratilmagan", pg.locator('[data-au-mode="gterms"]').count() == 1 and txt(pg, '.au-acct') == 'yangi@gmail.com' and len(pg.evaluate(BIZ)) == 2 and not opened(pg))
    ok("shartlar oynasida havolalar va «boshqa email bilan do'koningiz bormi?» maslahati", pg.locator('#auth-root a[href^="terms-of-service.html"]').count() == 1 and 'Bekor qilish' in (txt(pg, '.au-gt-hint') or ''))
    pg.click('#auth-gterms-ok'); pg.wait_for_timeout(200)
    ok("belgisiz «Davom etish» — xato, do'kon yaratilmaydi", 'katakchani belgilab' in (txt(pg, '#auth-terms-err') or '') and len(pg.evaluate(BIZ)) == 2)
    pg.click('label[for="auth-terms-check"]'); pg.click('#auth-gterms-ok'); pg.wait_for_timeout(2000)
    uid = pg.evaluate("()=>fbUser && fbUser.uid")
    ok("rozilikdan keyin: odatdagi yangi do'kon (sinov muddati bilan) yaratildi va ochildi", opened(pg) and ('businesses/' + str(uid)) in pg.evaluate(BIZ) and pg.evaluate("(u)=>window.__FDB.docs['businesses/' + u].subscriptionPlan", uid) == 'trial' and pg.evaluate("(u)=>window.__FDB.docs['businesses/' + u].ownerEmail", uid) == 'yangi@gmail.com', [opened(pg), pg.evaluate(BIZ)])
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 6) yangi foydalanuvchi «Bekor qilish» — akkaunt o'chiriladi, do'kon yo'q
    ctx, pg, errs = boot(br)
    pg.evaluate(SEED, {'users': [OWNER_G], 'docs': DOCS, 'g': {'sub': 'g-new2', 'email': 'yana@gmail.com'}})
    pg.click('#auth-google-btn'); pg.wait_for_timeout(900); pg.click('#auth-gterms-cancel'); pg.wait_for_timeout(800)
    ok("shartlarda «Bekor qilish»: yangi akkaunt o'chirildi, do'kon yaratilmadi, kirish ekraniga qaytdi", pg.evaluate("()=>Object.keys(window.__FA.users)") == ['ownerA1'] and len(pg.evaluate(BIZ)) == 2 and pg.locator('#auth-form').count() == 1 and not opened(pg))
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 7) yangi foydalanuvchi, shartlar ochiq turganda ilova yopilib qayta ochildi — do'kon baribir ochilmaydi, shartlar qayta so'raladi
    PRE = """try{ localStorage.setItem('sp_au_terms', 'uKill1'); }catch(e){}
(function(){ const t = setInterval(function(){ if(window.__FA){ clearInterval(t); window.__FA.users.uKill1 = {uid: 'uKill1', email: 'kill@gmail.com', providers: ['google.com'], gSub: 'g-kill', created: Date.now()}; window.__FA.preset('uKill1'); } }, 2); })();"""
    ctx = br.new_context(viewport={"width": 412, "height": 900}); ctx.route("**/*", route); ctx.add_init_script(PRE)
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(URL); pg.wait_for_timeout(3500)
    ok("shartlar tugamay ilova qayta ochilsa: shartlar yana so'raladi, do'kon yaratilmadi", pg.locator('[data-au-mode="gterms"]').count() == 1 and pg.evaluate(BIZ) == [] and not opened(pg), [pg.evaluate(BIZ), txt(pg, '#auth-root')[:80] if txt(pg, '#auth-root') else None])
    pg.click('label[for="auth-terms-check"]'); pg.click('#auth-gterms-ok'); pg.wait_for_timeout(1800)
    ok("…rozilikdan keyin do'kon yaratildi va ochildi", opened(pg) and pg.evaluate(BIZ) == ['businesses/uKill1'])
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 8) server tekshiruvi ishlamasa — xavfsiz tomonga: chiqiladi, do'kon yaratilmaydi
    ctx, pg, errs = boot(br)
    pg.evaluate(SEED, {'users': [], 'docs': {}, 'g': {'sub': 'g-off', 'email': 'off@gmail.com'}, 'guardFail': True})
    pg.click('#auth-google-btn'); pg.wait_for_timeout(1200)
    ok("server javob bermasa: do'kon yaratilmadi, kirish ekranida tushunarli xato", pg.evaluate(BIZ) == [] and not opened(pg) and 'tekshirib bo' in (txt(pg, '#auth-error') or ''), txt(pg, '#auth-error'))
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 9) email + parol — avvalgidek (kirish va ro'yxatdan o'tish)
    ctx, pg, errs = boot(br)
    pg.evaluate(SEED, {'users': [OWNER_G], 'docs': DOCS})
    pg.evaluate("()=>localStorage.setItem('sp_au_chk', '1')")   # oldingi Google urinishidan qolgan belgi ham parol bilan kirishga xalaqit bermasin
    pg.fill('#auth-email', 'ali@gmail.com'); pg.fill('#auth-password', 'parol1'); pg.click('#auth-submit-btn'); pg.wait_for_timeout(1500)
    ok("email+parol bilan kirish — avvalgidek, server tekshiruvi chaqirilmaydi (oflayn kirish ham avvalgidek)", opened(pg) and pg.evaluate("()=>fbUser.uid") == 'ownerA1' and pg.evaluate("()=>window.__GUARD.calls") == 0)
    # Sozlamalar → Hisob: kirish usullari
    pg.evaluate("()=>{ document.getElementById('login-root').innerHTML = ''; renderSettingsAccount(document.getElementById('view-container')); }"); pg.wait_for_timeout(400)
    ok("Hisob: «Kirish usullari» — Email ulangan, Google «Ulash», «Uzish» yo'q (yagona usul)", pg.locator('#acct-methods .am-row').count() == 2 and 'ulangan' in txt(pg, '[data-am="password"] .am-sub') and pg.locator('#am-link-google').count() == 1 and pg.locator('#am-unlink-password').count() == 0, txt(pg, '#acct-methods'))
    pg.evaluate("()=>{ window.__G = {sub: 'g-ali', email: 'ali@gmail.com'}; }"); pg.click('#am-link-google'); pg.wait_for_timeout(600)
    ok("Google ulandi — ikkala usulda «Uzish» chiqdi", 'ulangan' in (txt(pg, '[data-am="google"] .am-sub') or '') and pg.locator('#am-unlink-google').count() == 1 and pg.locator('#am-unlink-password').count() == 1)
    pg.click('#am-unlink-google'); pg.wait_for_timeout(200); pg.click('.modal-overlay .btn-danger, .modal-overlay .btn-primary, #confirm-yes', timeout=3000); pg.wait_for_timeout(500)
    ok("Google uzildi (tasdiqdan keyin), email qoldi", pg.evaluate("()=>window.__FA.users.ownerA1.providers") == ['password'] and pg.locator('#am-link-google').count() == 1)
    pg.evaluate("()=>{ openDeleteAccountModal(); }"); pg.wait_for_timeout(200)
    ok("akkauntni o'chirish oynasi: parolli akkauntda parol so'raladi (Google qo'shilgan bo'lsa ham)", pg.locator('#da-password').count() == 1)
    pg.evaluate("()=>closeModal()")
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    ctx, pg, errs = boot(br)
    pg.click('[data-au-tab="signup"]'); pg.fill('#auth-email', 'new@mail.uz'); pg.fill('#auth-password', 'qwerty1'); pg.click('label[for="auth-terms-check"]'); pg.click('#auth-submit-btn'); pg.wait_for_timeout(1800)
    uid = pg.evaluate("()=>fbUser && fbUser.uid")
    ok("ro'yxatdan o'tish (email) — avvalgidek: yangi do'kon yaratildi, server tekshiruvi kerak bo'lmadi", opened(pg) and pg.evaluate(BIZ) == ['businesses/' + str(uid)] and pg.evaluate("()=>window.__GUARD.calls") == 0)
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 10) Google-only akkaunt: Hisob → «Parol o'rnatish»
    ctx, pg, errs = boot(br)
    pg.evaluate(SEED, {'users': [], 'docs': {}, 'g': {'sub': 'g-solo', 'email': 'solo@gmail.com'}})
    pg.click('#auth-google-btn'); pg.wait_for_timeout(900); pg.click('label[for="auth-terms-check"]'); pg.click('#auth-gterms-ok'); pg.wait_for_timeout(1800)
    pg.evaluate("()=>{ document.getElementById('login-root').innerHTML = ''; renderSettingsAccount(document.getElementById('view-container')); }"); pg.wait_for_timeout(400)
    ok("faqat Google: Google ulangan (uzib bo'lmaydi), Email — «Parol o'rnatish»", pg.locator('#am-unlink-google').count() == 0 and pg.locator('#am-set-pw').count() == 1)
    pg.click('#am-set-pw'); pg.fill('#am-pw1', 'abc123'); pg.fill('#am-pw2', 'abc124'); pg.click('#am-pw-go'); pg.wait_for_timeout(200)
    ok("parollar mos kelmasa — xato", 'bir xil emas' in (txt(pg, '#am-pw-err') or ''))
    pg.fill('#am-pw2', 'abc123'); pg.click('#am-pw-go'); pg.wait_for_timeout(600)
    u = pg.evaluate("()=>fbUser.uid")
    ok("parol o'rnatildi — endi email+parol bilan ham kirsa bo'ladi, ikkalasida «Uzish»", sorted(pg.evaluate("(u)=>window.__FA.users[u].providers", u)) == ['google.com', 'password'] and pg.locator('#am-unlink-google').count() == 1)
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    # 11) Android ilova: telefonning Google oynasi (plagin) → signInWithCredential
    ctx, pg, errs = boot(br, NATIVE)
    pg.evaluate(SEED, {'users': [OWNER_G], 'docs': DOCS, 'g': {'sub': 'g-ali', 'email': 'ali@gmail.com'}})
    ok("Android (plagin bor): Google tugmasi bor", pg.locator('#auth-google-btn').count() == 1)
    pg.click('#auth-google-btn'); pg.wait_for_timeout(1500)
    ok("Android: plagin skipNativeAuth bilan chaqirildi, token bilan shu Firebase'ga kirildi, eski do'kon", pg.evaluate("()=>window.__nat") == [{'skipNativeAuth': True}] and ['signInCred', 'google.com', 'id-g-ali'] in pg.evaluate("()=>window.__FA.calls") and opened(pg) and pg.evaluate("()=>fbUser.uid") == 'ownerA1')
    ok("Android: popup ishlatilmadi", ['popup'] not in pg.evaluate("()=>window.__FA.calls"))
    ok("sahifa xatolari yo'q", not errs, errs); ctx.close()
    ctx, pg, errs = boot(br, NATIVE)
    pg.evaluate(SEED, {'users': [], 'docs': {}, 'g': None})
    pg.click('#auth-google-btn'); pg.wait_for_timeout(500)
    ok("Android: foydalanuvchi Google oynasini yopsa — jim, xato yo'q", txt(pg, '#auth-error') in ('', None) and pg.locator('#auth-form').count() == 1)
    ctx.close()
    ctx, pg, errs = boot(br, NATIVE_NOPLUGIN)
    ok("Android (plagin yo'q — eski APK): Google tugmasi ko'rinmaydi, «yoki» ham yo'q", pg.locator('#auth-google-btn').count() == 0 and pg.locator('.au-or').count() == 0)
    ctx.close()
    br.close()
print("JAMI: %d OK, %d XATO" % (R["ok"], R["bad"]))
sys.exit(1 if R["bad"] else 0)
